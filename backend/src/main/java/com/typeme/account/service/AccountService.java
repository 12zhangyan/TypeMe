package com.typeme.account.service;

import com.typeme.account.dto.LoginResponse;
import com.typeme.account.dto.MeResponse;
import com.typeme.account.dto.RecoveryCodesResponse;
import com.typeme.account.dto.RegisterResponse;
import com.typeme.account.repository.RecoveryCodeRecord;
import com.typeme.account.repository.RecoveryCodeRepository;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserSessionRepository;
import com.typeme.common.ApiErrorCodes;
import com.typeme.common.ApiException;
import com.typeme.security.RecoveryCodeGenerator;
import com.typeme.security.SessionRegistryService;
import com.typeme.security.TypemeUserPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 注册 / 登录 / 登出 / 凭据变更（契约 §7.2 认证与账号部分）。
 *
 * <p><b>为什么登录自己调 {@code AuthenticationManager} 而不放一个
 * {@code UsernamePasswordAuthenticationFilter}</b>：契约要求登录接口是
 * {@code POST /api/v3/auth/login} + JSON 请求体，响应体是固定的
 * {@code {userId, username, nickname}}。用默认过滤器就得改它的 success/failure handler 去迁就形状，
 * 而过滤器跑在 MVC 之前，拿不到 {@code @Valid} 的字段级错误。显式调用把"认证"变成
 * 一段可读、可测、可断言的代码。
 */
@Service
public class AccountService {

    private static final Logger log = LoggerFactory.getLogger(AccountService.class);

    /**
     * 恢复码策略版本：随"格式/字母表/数量"的变更递增，前端据此显示对应说明文案。
     * 它不是密码学参数，所以不走配置。
     */
    public static final String RECOVERY_CODE_POLICY_VERSION = "typeme-recovery-code-v1";

    /**
     * 免责声明同意在请求体/错误体里的字段名。
     *
     * <p>与 `frontend/src/api/v3.ts` 的 `FIELD_LABELS` 对齐（那边把它渲染成「免责声明同意」）。
     * 字段名写错不会报错、只会让用户看到一串英文，所以这里定义常量而不是散着写字符串。
     */
    public static final String DISCLAIMER_FIELD = "disclaimerAccepted";

    private final UserRepository users;
    private final RecoveryCodeRepository recoveryCodes;
    private final UserSessionRepository sessions;
    private final SessionRegistryService sessionRegistry;
    private final PasswordEncoder passwordEncoder;
    private final RecoveryCodeGenerator codeGenerator;
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy;
    private final SecurityContextRepository securityContextRepository;
    private final AuthenticationManager authenticationManager;
    private final TypemeProperties properties;
    private final InvitationService invitations;

    public AccountService(UserRepository users,
                          RecoveryCodeRepository recoveryCodes,
                          UserSessionRepository sessions,
                          SessionRegistryService sessionRegistry,
                          PasswordEncoder passwordEncoder,
                          RecoveryCodeGenerator codeGenerator,
                          SessionAuthenticationStrategy sessionAuthenticationStrategy,
                          SecurityContextRepository securityContextRepository,
                          AuthenticationManager authenticationManager,
                          TypemeProperties properties, InvitationService invitations) {
        this.users = users;
        this.recoveryCodes = recoveryCodes;
        this.sessions = sessions;
        this.sessionRegistry = sessionRegistry;
        this.passwordEncoder = passwordEncoder;
        this.codeGenerator = codeGenerator;
        this.sessionAuthenticationStrategy = sessionAuthenticationStrategy;
        this.securityContextRepository = securityContextRepository;
        this.authenticationManager = authenticationManager;
        this.properties = properties;
        this.invitations = invitations;
    }

    // ------------------------------------------------------------------ 注册

    /**
     * 注册：建账号 → 生成 8 个恢复码（只存 hash）→ 返回明文（仅此一次）。
     *
     * <p>事务边界：写账号与写恢复码必须同事务（否则会出现"有账号没恢复码"的中间态）。
     * 会话建立刻意放在事务外（由控制器在提交后调用 {@link #establishSession}）：
     * HttpSession 与账本行属于外部状态，把它们绑进业务事务只会制造
     * "事务回滚了但浏览器已经拿到 cookie"的不一致。
     */
    @Transactional
    public RegisterResponse register(String rawUsername, String rawPassword, String rawNickname,
                                     boolean disclaimerAccepted, String invitationCode) {
        requireDisclaimerIfConfigured(disclaimerAccepted);
        String display = rawUsername.trim();
        String normalized = UserRepository.normalize(display);
        if (normalized.equals(UserRepository.normalize(properties.admin().bootstrapUsername()))) {
            throw ApiException.validation("该用户名为管理员保留，请使用其他名称。", Map.of("username", "管理员保留名称"));
        }
        String nickname = normalizeNickname(rawNickname);

        Instant now = Instant.now();
        String userId = UserRepository.newId();
        try {
            users.insert(userId, normalized, display, passwordEncoder.encode(rawPassword),
                    nickname, UserRecord.ROLE_USER, now);
        } catch (DuplicateKeyException duplicate) {
            // 唯一键是权威判定：先 SELECT 再 INSERT 在并发注册下必然漏（两个请求都查到"不存在"）。
            throw new ApiException(ApiErrorCodes.CONFLICT, HttpStatus.CONFLICT, "该用户名已被注册。");
        }

        invitations.consume(invitationCode, userId);
        List<String> plainCodes = issueRecoveryCodes(userId, now);
        log.info("account registered");
        return new RegisterResponse(userId, display, nickname, plainCodes, RECOVERY_CODE_POLICY_VERSION);
    }

    /**
     * 注册时的免责声明同意校验（2026-09-17 新增）。
     *
     * <p>为什么必须有：账号一建立，作答内容就开始存到服务器上。产品要求里有这条
     * （`docs/任务拆解.md` L105「免责声明」），但历史实现里前端没有这一项、后端也不读
     * 任何 `disclaimer*` 字段 —— 脚本发的键被静默忽略（见
     * `docs/2026-09-16/verification/acceptance-evidence.md` §9.1）。
     *
     * <p>为什么默认**必填**：静默忽略一个表示"我同意"的字段，比拒绝注册更糟 ——
     * 用户以为自己的同意被记录了，其实没有。所以缺省即拒绝，并且拒绝时回
     * {@code VALIDATION_FAILED} + 字段名，前端会渲染成"免责声明同意：…"。
     *
     * <p>为什么留一个开关：这是一处对外的接口行为收紧（旧请求体 `{username, password}`
     * 会开始返回 400）。开关默认 {@code true}（要同意），只有在需要灰度放量、
     * 让旧客户端先跑一段时间时才显式配 `typeme.auth.disclaimer-required=false`。
     * 关闭时服务端只是不拦，前端仍然会显示勾选项 —— 也就是说关闭开关不会假装用户同意过。
     */
    private void requireDisclaimerIfConfigured(boolean accepted) {
        if (!properties.auth().disclaimerRequired()) {
            return;
        }
        if (!accepted) {
            throw ApiException.validation("注册前需要先阅读并同意测评定位与数据处理说明。",
                    Map.of(DISCLAIMER_FIELD, "请先勾选「我已阅读并理解」再创建账号。"));
        }
        // 只记事件名：同意这是"发生过"的事实，不是需要追溯的个人数据。
        // 用户名、IP 一律不进这条日志（SecurityLoggingDisciplineIT 会检查日志纪律）。
        log.info("registration disclaimer accepted");
    }

    // ------------------------------------------------------------------ 登录 / 登出

    /**
     * 登录：认证 → 会话固定防护 → 写会话账本。
     *
     * <p>失败一律 {@code 401 INVALID_CREDENTIALS}：用户名不存在、密码错误、账号被禁用/注销，
     * 对外全都是同一个码、同一句文案。任何区分都会把登录接口变成账号枚举器。
     */
    @Transactional
    public LoginResponse login(HttpServletRequest request, String rawUsername, String rawPassword) {
        String username = rawUsername.trim();
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(UserRepository.normalize(username), rawPassword));
        } catch (DisabledException | LockedException disabledOrLocked) {
            // 账号存在但不可用：**仍然**回 INVALID_CREDENTIALS（不与"用户名不存在"区分）。
            log.info("login rejected: account unavailable");
            throw ApiException.invalidCredentials();
        } catch (BadCredentialsException badCredentials) {
            throw ApiException.invalidCredentials();
        } catch (AuthenticationException other) {
            log.warn("login rejected: authentication-exception={}", other.getClass().getSimpleName());
            throw ApiException.invalidCredentials();
        }

        UserDetails principal = (UserDetails) authentication.getPrincipal();
        UserRecord user = users.findByNormalizedUsername(principal.getUsername())
                .orElseThrow(ApiException::invalidCredentials);

        establishSession(request, authentication, user.id());
        log.info("login succeeded");
        return new LoginResponse(user.id(), user.usernameDisplay(), user.nickname());
    }

    /**
     * 登出：撤销**当前**会话（删账本行 + 让 HttpSession 失效 + 清安全上下文）。
     *
     * <p>为什么不用 Spring Security 的默认 logout filter：它自带重定向与登出页语义，
     * 而契约要求 {@code 204}。这里手工做三件事，顺带保证账本行与进程内注册表也一起清掉。
     */
    public void logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            SecurityContextHolder.clearContext();
            return;
        }
        String sessionId = session.getId();
        // 必须在删行之前读出 userId：删掉账本行之后就查不到了。
        String userId = sessions.findUserId(sessionId).orElse(null);
        sessions.deleteBySessionId(sessionId);
        if (userId != null) {
            // 让注册表同步清理；invalidate() 也会触发 listener，双保险。
            sessionRegistry.invalidateAllForUser(userId, null);
        }
        try {
            session.invalidate();
        } catch (IllegalStateException alreadyInvalid) {
            log.debug("session already invalid on logout");
        }
        SecurityContextHolder.clearContext();
    }

    // ------------------------------------------------------------------ 会话建立

    /**
     * 建立认证会话。步骤顺序错了就会踩中经典的会话固定/上下文丢失问题：
     * <ol>
     *   <li>先换 sessionId（{@link SessionAuthenticationStrategy}），</li>
     *   <li>再写 {@code app_user_session}（绝对期限账本），</li>
     *   <li>最后存 SecurityContext 并登记到进程内注册表。</li>
     * </ol>
     */
    public void establishSession(HttpServletRequest request, Authentication authentication, String userId) {
        Instant now = Instant.now();
        HttpSession session = request.getSession(true);
        // 轮换 id（会话固定防护）。必须在 SecurityContext 落库之前：否则上下文被写进旧会话。
        // 这里必须先用 getSession(true) 建出会话：ChangeSessionIdAuthenticationStrategy
        // 在"没有会话"时会退化成新建会话（结果同样是新的 sessionId），但我们希望
        // 会话属性（如果有）被正确迁移，所以显式先建。
        sessionAuthenticationStrategy.onAuthentication(authentication, request, servletResponse());

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        // 显式保存：这条链上没有 SecurityContextPersistenceFilter 的隐式保存，
        // 不显式写的话下一个请求读不到认证信息（表现为"登录成功但立刻 401"）。
        securityContextRepository.saveContext(context, request, servletResponse());

        HttpSession current = request.getSession(false);
        if (current != null) {
            Duration ttl = properties.auth().sessionAbsoluteTtl();
            sessions.insert(current.getId(), userId, now, now.plus(ttl));
            sessionRegistry.register(current.getId(), userId, current);
        }
    }

    /**
     * 取当前响应对象。{@code SecurityContextRepository#saveContext} 的签名要求它。
     * 用 {@code RequestContextHolder} 而不是自己翻请求属性：MVC 环境（含 MockMvc）
     * 一定已经把 {@code ServletRequestAttributes} 绑定到当前线程。
     */
    private static jakarta.servlet.http.HttpServletResponse servletResponse() {
        var attributes = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if (attributes instanceof org.springframework.web.context.request.ServletRequestAttributes servlet) {
            return servlet.getResponse();
        }
        return null;
    }

    /**
     * 登录/注册成功后调用（认证对象由这里构造）。
     *
     * <p>主体必须用 {@link TypemeUserPrincipal}：新测与 AI 模块按"主体上有
     * {@code getUserId()}"这个约定取用户主键，拿不到就退回 username ——
     * 而 username 不是 {@code app_user} 的主键，会在外键上炸掉。
     * 见 {@link TypemeUserPrincipal} 的注释（这是一个实测发现的真实缺陷）。
     */
    public void establishSession(HttpServletRequest request, String userId, String username, String role) {
        String granted = UserRecord.ROLE_ADMIN.equals(role) ? UserRecord.ROLE_ADMIN : UserRecord.ROLE_USER;
        Authentication authentication = new UsernamePasswordAuthenticationToken(
                new TypemeUserPrincipal(userId, username, null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + granted))),
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + granted)));
        establishSession(request, authentication, userId);
    }

    /** 注册成功后调用：新账号一定是 USER 角色。 */
    public void establishSessionForNewUser(HttpServletRequest request, String userId, String username) {
        establishSession(request, userId, UserRepository.normalize(username), UserRecord.ROLE_USER);
    }

    // ------------------------------------------------------------------ 账号资料

    public MeResponse currentUser(String userId) {
        return toMe(requireActive(userId));
    }

    @Transactional
    public MeResponse updateNickname(String userId, String rawNickname) {
        UserRecord user = requireActive(userId);
        String nickname = normalizeNickname(rawNickname);
        if (nickname == null) {
            throw ApiException.validation("昵称不能为空。", Map.of("nickname", "昵称不能为空"));
        }
        users.updateNickname(user.id(), nickname);
        return toMe(users.findById(user.id()).orElse(user));
    }

    // ------------------------------------------------------------------ 改密 / 恢复码

    /**
     * 改密：校验旧密码 → 更新 hash → 撤销**除当前会话外**的全部会话。
     *
     * <p>为什么保留当前会话：用户刚刚证明了自己是本人，把他自己踢下线只会制造
     * "改完密码就被登出"的困惑，而安全收益为零（攻击者拿不到新密码）。
     */
    @Transactional
    public void changePassword(String userId, String currentSessionId, String currentPassword, String newPassword) {
        UserRecord user = requireActive(userId);
        if (!passwordEncoder.matches(currentPassword, user.passwordHash())) {
            // 失败不是"参数错误"而是"凭据错误"：给 401，前端才知道要重新输入当前密码。
            throw new ApiException(ApiErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED,
                    "当前密码不正确。");
        }
        Instant now = Instant.now();
        users.updatePasswordHash(user.id(), passwordEncoder.encode(newPassword), now);
        revokeOtherSessions(user.id(), currentSessionId);
        log.info("password changed");
    }

    /**
     * 重发恢复码：重新验证密码 → 作废旧码 → 生成新码（只返回一次）→
     * {@code recovery_code_version + 1}。
     */
    @Transactional
    public RecoveryCodesResponse regenerateRecoveryCodes(String userId, String currentPassword) {
        UserRecord user = requireActive(userId);
        if (!passwordEncoder.matches(currentPassword, user.passwordHash())) {
            throw new ApiException(ApiErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED,
                    "当前密码不正确。");
        }
        Instant now = Instant.now();
        recoveryCodes.revokeAllUsable(user.id(), now);
        users.bumpRecoveryCodeVersion(user.id());
        List<String> plain = issueRecoveryCodes(user.id(), now);
        log.info("recovery codes regenerated count={}", plain.size());
        return new RecoveryCodesResponse(plain);
    }

    /**
     * 用恢复码重置密码（契约 §7.2 的 {@code POST /auth/recover}）。
     *
     * <p>关键点是**原子消费**：先用匹配出的 codeId 做
     * {@code UPDATE ... WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL}，
     * 并断言受影响行数为 1。并发用同一个码时只有一个请求能拿到这 1 行，另一个拿到 0 行 →
     * 统一抛 {@code 401}。这一步不能退化成"先读后写"：那样两个并发请求都会认为自己成功。
     *
     * <p>同一事务内还要：改密码、{@code recovery_code_version + 1}、作废其余未用码。
     * 任何一步失败都必须整体回滚 —— 否则可能出现"码被消费了但密码没改"的死局。
     */
    @Transactional
    public void recover(String rawUsername, String rawRecoveryCode, String newPassword) {
        String normalized = UserRepository.normalize(rawUsername.trim());
        Optional<UserRecord> found = users.findByNormalizedUsername(normalized);
        if (found.isEmpty() || !found.get().active()) {
            // 与"码不对"同一个响应：不能通过恢复接口探测账号是否存在/是否已注销。
            throw ApiException.invalidCredentials();
        }
        UserRecord user = found.get();

        String candidate = RecoveryCodeGenerator.normalize(rawRecoveryCode);
        String matchedId = null;
        for (RecoveryCodeRecord code : recoveryCodes.findUsable(user.id())) {
            if (passwordEncoder.matches(candidate, code.codeHash())) {
                matchedId = code.id();
                break;
            }
        }
        if (matchedId == null) {
            throw ApiException.invalidCredentials();
        }

        Instant now = Instant.now();
        int consumed = recoveryCodes.consume(matchedId, now);
        if (consumed != 1) {
            // 并发下没抢到：视为凭据无效，不是 500（对用户而言结果就是"这个码不能用"）。
            log.info("recovery code consumption lost the race");
            throw ApiException.invalidCredentials();
        }

        users.updatePasswordHash(user.id(), passwordEncoder.encode(newPassword), now);
        users.bumpRecoveryCodeVersion(user.id());
        // 作废其余未使用码：恢复意味着"这套码可能已经泄露"，只作废用掉的那个是不够的。
        recoveryCodes.revokeAllUsable(user.id(), now);
        // 恢复后撤销全部旧会话（契约 §7.2）：这是"我认为账号被别人控制了"的场景。
        revokeAllSessions(user.id());
        log.info("password recovered via recovery code");
    }

    // ------------------------------------------------------------------ 注销申请

    /**
     * 注销第一步：校验密码 → 立即禁止登录 → 撤销全部会话。
     *
     * <p>顺序不能换：先标记 DISABLED 再撤会话，否则窗口期内（会话还活着、账号还没禁用）
     * 用户/攻击者仍能操作；先撤会话再标记则会有"会话没了但还能重新登录"的窗口。
     *
     * <p>本方法只做"立即止血"的部分；建删除任务、取消 AI 任务在
     * {@code AccountDeletionService}（同一个调用方事务里）。
     */
    @Transactional
    public void disableForDeletion(String userId, String currentPassword) {
        UserRecord user = requireActive(userId);
        if (!passwordEncoder.matches(currentPassword, user.passwordHash())) {
            throw new ApiException(ApiErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED,
                    "当前密码不正确。");
        }
        users.markDisabledForDeletion(user.id(), Instant.now());
        revokeAllSessions(user.id());
    }

    // ------------------------------------------------------------------ 内部工具

    /** 按 userId 取账号并要求 ACTIVE；非 ACTIVE 一律按"未认证"处理。 */
    public UserRecord requireActive(String userId) {
        UserRecord user = users.findById(userId)
                .orElseThrow(ApiException::unauthenticated);
        if (!user.active()) {
            throw ApiException.unauthenticated();
        }
        return user;
    }

    /** 删除任务用：注销后账号已 DISABLED，这里允许读取。 */
    public Optional<UserRecord> findUser(String userId) {
        return users.findById(userId);
    }

    /** 按规范化用户名取账号（控制器从认证主体反查 userId 时用）。 */
    public Optional<UserRecord> findUserByNormalizedUsername(String normalizedUsername) {
        return users.findByNormalizedUsername(normalizedUsername);
    }

    private List<String> issueRecoveryCodes(String userId, Instant now) {
        List<String> plain = codeGenerator.generateSet();
        int index = 1;
        for (String code : plain) {
            recoveryCodes.insert(UserRepository.newId(), userId,
                    passwordEncoder.encode(RecoveryCodeGenerator.normalize(code)), index++, now);
        }
        return plain;
    }

    /** 撤销除当前会话外的全部会话：删账本行 + 让进程内 HttpSession 立即失效。 */
    public void revokeOtherSessions(String userId, String currentSessionId) {
        List<String> others = sessions.findSessionIdsForUserExcept(userId, currentSessionId);
        sessions.deleteByUserIdExcept(userId, currentSessionId);
        sessionRegistry.invalidateAllForUser(userId, currentSessionId);
        log.info("sessions revoked count={} keptCurrent={}", others.size(), currentSessionId != null);
    }

    /** 撤销该用户全部会话（注销、恢复、管理员禁用）。 */
    public void revokeAllSessions(String userId) {
        int rows = sessions.deleteByUserId(userId);
        int live = sessionRegistry.invalidateAllForUser(userId, null);
        log.info("all sessions revoked rows={} live={}", rows, live);
    }

    private MeResponse toMe(UserRecord user) {
        return new MeResponse(user.id(), user.usernameDisplay(), user.nickname(),
                user.createdAt(), user.passwordChangedAt());
    }

    /** 昵称规范化：trim；空白→null（表示"不设置"）。长度按 Unicode 码点再校验一次。 */
    static String normalizeNickname(String rawNickname) {
        if (rawNickname == null) {
            return null;
        }
        String trimmed = rawNickname.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (trimmed.codePointCount(0, trimmed.length()) > 32) {
            throw ApiException.validation("昵称最多 32 个字符。", Map.of("nickname", "昵称最多 32 个字符"));
        }
        return trimmed;
    }

    /** 供登出流程在删行前读 userId。 */
    public Optional<String> sessionOwner(String sessionId) {
        return sessions.findUserId(sessionId);
    }
}
