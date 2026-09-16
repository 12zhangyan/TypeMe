package com.typeme.account.controller;

import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserRecord;
import com.typeme.common.ApiException;
import com.typeme.account.service.AccountService;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * 从认证主体取当前用户。
 *
 * <p><b>这是本模块最重要的一条边界</b>：userId 只能来自服务端认证链
 * （{@code SecurityContext} → {@code app_user.username_normalized}），
 * 请求体/查询串里的任何 {@code userId}/{@code owner} 字段一律忽略（契约 §7 明文要求）。
 * 控制器里刻意没有"从 body 读 userId"这种代码路径，因为它们最容易在"顺手支持一下"时被加进来。
 *
 * <p>为什么再查一次库而不是直接用 principal 上的 {@code getUserId()}：账号可能在会话
 * 有效期内被禁用或注销；每次取用户时都经过 {@link AccountService#requireActive}
 * 才能让"禁用立即生效"成立。principal 里的 id 只代表"登录那一刻是谁"，
 * 不能替代"现在还能不能用"的检查。
 */
@Component
public class CurrentUser {

    private final AccountService accountService;

    public CurrentUser(AccountService accountService) {
        this.accountService = accountService;
    }

    /** 当前登录用户（要求 ACTIVE）；未登录或账号不可用时抛 401。 */
    public UserRecord require() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            /*
             * 注意这里**不能**再额外判"principal 是不是 String"。
             *
             * 本模块的认证主体是 TypemeUserPrincipal（见 AccountService#establishSession），
             * 而更早的版本用的是"用户名"这个字符串。两种形态都代表**登录成功**，
             * 都不是异常形态。早期版本多写了"principal 是 String → 401"这一条判断，
             * 结果所有已登录接口都 401 —— 表现为"注册/登录 200，但紧接着 GET /me 401"，
             * 很容易被误判成会话没保存。
             * 真正代表"未登录"的是上面的 null / !isAuthenticated / 匿名主体三件事。
             */
            throw ApiException.unauthenticated();
        }
        String normalizedUsername = UserRepository.normalize(String.valueOf(authentication.getName()));
        if (normalizedUsername.isBlank()) {
            throw ApiException.unauthenticated();
        }
        UserRecord user = accountService.findUserByNormalizedUsername(normalizedUsername)
                .orElseThrow(ApiException::unauthenticated);
        if (!user.active()) {
            throw ApiException.unauthenticated();
        }
        return user;
    }

    public String requireId() {
        return require().id();
    }

    /** 当前 HttpSession 的 id（保留当前会话时需要）；没有会话时为 null。 */
    public static String currentSessionId(jakarta.servlet.http.HttpServletRequest request) {
        var session = request.getSession(false);
        return session == null ? null : session.getId();
    }
}
