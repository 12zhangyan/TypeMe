package com.typeme.security;

import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 从 {@code app_user} 加载认证主体（按 {@code username_normalized} 查）。
 *
 * <p>三条设计约束：
 * <ol>
 *   <li><b>不区分"用户名不存在"与"密码错误"</b>：本类对不存在的用户抛
 *       {@link UsernameNotFoundException}，而控制器统一把它翻译成
 *       {@code 401 INVALID_CREDENTIALS}。响应体逐字相同，账号无法被枚举。</li>
 *   <li><b>状态非 ACTIVE 直接拒绝</b>：DISABLED（注销申请中）与 DELETED 分别抛
 *       {@link DisabledException} 与 {@link LockedException}，同样**对外都映射为
 *       INVALID_CREDENTIALS**。如果这里对注销中的账号返回别的码，攻击者就能用"这个码不同"
 *       判断某个用户名是否刚注销过。</li>
 *   <li><b>权限名 ROLE_&lt;role&gt;</b>：ADMIN 得到 {@code ROLE_ADMIN}，供
 *       {@code @PreAuthorize("hasRole('ADMIN')")} 使用。</li>
 * </ol>
 */
@Service
public class TypemeUserDetailsService implements UserDetailsService {

    private static final Logger log = LoggerFactory.getLogger(TypemeUserDetailsService.class);

    private final UserRepository users;

    public TypemeUserDetailsService(UserRepository users) {
        this.users = users;
    }

    @Override
    public UserDetails loadUserByUsername(String rawUsername) throws UsernameNotFoundException {
        String normalized = UserRepository.normalize(rawUsername == null ? "" : rawUsername.trim());
        Optional<UserRecord> found = users.findByNormalizedUsername(normalized);
        if (found.isEmpty()) {
            // 消息里**不带**用户名：认证失败日志与异常消息是最常见的账号枚举泄漏渠道。
            throw new UsernameNotFoundException("账号或凭据不正确");
        }
        UserRecord user = found.get();
        if (UserRecord.STATUS_DISABLED.equals(user.status())) {
            log.info("login rejected: account disabled");
            throw new DisabledException("账号不可用");
        }
        if (!UserRecord.STATUS_ACTIVE.equals(user.status())) {
            log.info("login rejected: account not active");
            throw new LockedException("账号不可用");
        }

        String role = UserRecord.ROLE_ADMIN.equals(user.role()) ? UserRecord.ROLE_ADMIN : UserRecord.ROLE_USER;
        // 用 TypemeUserPrincipal 而不是 Spring Security 的 User：只有它带 getUserId()，
        // 而那正是新测/AI 模块取"当前用户主键"的约定入口。用 User 会让那两个模块
        // 静默退回 username，然后在 assessment_attempt.user_id 的外键上炸掉。
        // 详见 TypemeUserPrincipal 的注释。
        return new TypemeUserPrincipal(
                user.id(),
                user.usernameNormalized(),
                user.passwordHash(),
                List.of(new SimpleGrantedAuthority("ROLE_" + role)));
    }
}
