package com.typeme.security;

import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;

/**
 * 带**用户 id** 的认证主体。
 *
 * <p><b>为什么不能直接用 Spring Security 的 {@code User}</b>（这是个真实缺陷，
 * 2026-09-16 端到端实测才发现）：新测模块与 AI 模块都要拿"当前用户的 id"去过滤自己的数据，
 * 而它们刻意**不依赖**账号模块的类名（并行开发时跨模块编译依赖会互相卡住），
 * 采用的是"主体上反射调用 {@code getUserId()}"这个约定，取不到才退回
 * {@code Authentication#getName()}。
 *
 * <p>但账号模块此前建立会话时用的是
 * {@code new UsernamePasswordAuthenticationToken(username, null, authorities)} ——
 * 主体就是**用户名字符串**，根本没有 {@code getUserId()}。于是那两个模块**每次都走退路**，
 * 把 username 当成 userId 用。后果：
 * <pre>
 *   Cannot add or update a child row: a foreign key constraint fails
 *   (`assessment_attempt`, CONSTRAINT `fk_attempt_user`
 *    FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))
 * </pre>
 * 也就是**登录、注册都正常，但一个测评、一次 AI 分析都建不出来** ——
 * 而且报错是外键违例，看起来像数据库问题，真实原因是"把用户名当成了主键"。
 *
 * <p>为什么测试没抓到：集成测试大量使用 {@code @WithMockUser} 或测试自己的假主体
 * （{@code AiTestAuthentication} 就显式实现了 {@code getUserId()}），
 * 于是"约定"在测试里被满足了、在生产里没有。这类缺陷只有对着**真实登录流程**
 * 发一次请求才会暴露。
 *
 * <p>实现 {@link UserDetails} 而不是只做一个裸 record：认证链上的
 * {@code DaoAuthenticationProvider} 与 session 固定防护都按 {@code UserDetails} 语义工作，
 * 保持这个类型能让替换对框架完全透明。
 */
public final class TypemeUserPrincipal implements UserDetails {

    private final String userId;
    private final String username;
    private final String password;
    private final List<GrantedAuthority> authorities;

    public TypemeUserPrincipal(String userId, String username, String password,
                               Collection<? extends GrantedAuthority> authorities) {
        this.userId = userId;
        this.username = username;
        this.password = password;
        this.authorities = authorities == null ? List.of() : List.copyOf(authorities);
    }

    /**
     * 用户主键（{@code app_user.id}）。
     *
     * <p><b>方法名不能改</b>：新测模块（{@code jung.api.CurrentUser}）与 AI 模块
     * （{@code ai.controller.AiCurrentUser}）用反射按这个名字取用户 id。
     * 改名不会编译失败，只会让那两个模块静默退回 username，然后在外键上炸掉。
     */
    public String getUserId() {
        return userId;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return authorities;
    }

    @Override
    public String getPassword() {
        return password;
    }

    @Override
    public String getUsername() {
        return username;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }

    /**
     * 刻意**不**把 password 与 userId 打进 toString：这个对象会被日志框架打印
     * （例如调试认证问题时），凭据与内部主键不该出现在日志里。
     */
    @Override
    public String toString() {
        return "TypemeUserPrincipal[username=" + username + ", authorities=" + authorities + "]";
    }
}
