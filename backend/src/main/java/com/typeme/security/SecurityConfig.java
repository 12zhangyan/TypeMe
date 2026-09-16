package com.typeme.security;

import com.typeme.common.ApiErrorCodes;
import com.typeme.common.ApiErrorWriter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.security.web.csrf.CsrfTokenRequestHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.security.web.session.HttpSessionEventPublisher;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;

/**
 * Spring Security 配置（契约 02 §7.3 / 开发方案 §5）。
 *
 * <p><b>最容易被顺手破坏的一件事</b>：旧的 v1/v2 内容接口与 SPA 静态回退必须原样可用。
 * 因此本配置**只**约束 {@code /api/v3/**}，其余路径统一 {@code permitAll}，
 * 不加 CSP（会打断现有前端的行内脚本）、不加 CORS、不开启表单登录页。
 *
 * <p>CSRF 的策略是"默认开、按需放行"：
 * <ul>
 *   <li>{@link CookieCsrfTokenRepository#withHttpOnlyFalse()}：前端要读 cookie 回填 header，
 *       HttpOnly 会让它读不到；cookie 名 {@code XSRF-TOKEN}，header {@code X-XSRF-TOKEN}。</li>
 *   <li>只有写方法（非 GET/HEAD/TRACE/OPTIONS）才真正校验，读接口不受影响。</li>
 *   <li>{@code /api/v1/**} 与 {@code /api/v2/**} 的写方法**不**做 CSRF：它们本来就是只读契约，
 *       现有测试断言未映射的写方法返回 405；若在这里拦成 403 就改变了既有行为。</li>
 *   <li>会话建立前（register/login/recover）也要 CSRF：这三个接口都会创建/改变认证状态。</li>
 * </ul>
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    /** 写方法才校验 CSRF；其余方法（读）直接放行，避免给所有 GET 增加一次无效判断。 */
    private static final RequestMatcher WRITE_METHODS = request ->
            !(HttpMethod.GET.matches(request.getMethod())
                    || HttpMethod.HEAD.matches(request.getMethod())
                    || HttpMethod.TRACE.matches(request.getMethod())
                    || HttpMethod.OPTIONS.matches(request.getMethod()));

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   ApiErrorWriter errorWriter,
                                                   SessionAbsoluteTtlFilter absoluteTtlFilter,
                                                   SessionAuthenticationStrategy sessionAuthenticationStrategy)
            throws Exception {
        CookieCsrfTokenRepository csrfRepository = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfRepository.setCookieName("XSRF-TOKEN");
        csrfRepository.setHeaderName("X-XSRF-TOKEN");

        http
                // 不用表单登录页、不用 httpBasic：认证由 AuthController 显式调用 AuthenticationManager。
                .formLogin(form -> form.disable())
                .httpBasic(basic -> basic.disable())
                // 不用默认登出页：POST /api/v3/auth/logout 自己处理（需要撤销会话账本行）。
                .logout(logout -> logout.disable())
                // 不配 CORS：同源部署，禁止跨域凭据（契约 §7.3）。
                .cors(cors -> cors.disable())
                .csrf(csrf -> csrf
                        .csrfTokenRepository(csrfRepository)
                        .csrfTokenRequestHandler(alwaysResolveTokenHandler())
                        // 只对我们真正拥有的 API 家族启用 CSRF；旧 v1/v2 的只读契约保持原样。
                        .requireCsrfProtectionMatcher(request ->
                                WRITE_METHODS.matches(request)
                                        && request.getRequestURI() != null
                                        && request.getRequestURI().startsWith("/api/v3/")));

        http
                .authorizeHttpRequests(auth -> auth
                        // 1) 认证入口：公开（其余 /api/v3/** 一律要认证）。
                        .requestMatchers("/api/v3/auth/csrf",
                                "/api/v3/auth/register",
                                "/api/v3/auth/login",
                                "/api/v3/auth/recover").permitAll()
                        // 2) /api/v3 的其它路径（含 admin）一律要认证；admin 的 ADMIN 判定在方法级
                        //    @PreAuthorize，这样"忘记加 ADMIN 检查"会同时被测试与注解双重约束。
                        .requestMatchers("/api/v3/**").authenticated()
                        // 3) 其它一切（v1/v2 内容接口、actuator、SPA 静态与前端路由）保持原样可访问。
                        //    这一条是本轮最关键的兼容性承诺：新增安全模块不得改动既有 API 的可达性。
                        .anyRequest().permitAll())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(jsonAuthenticationEntryPoint(errorWriter))
                        .accessDeniedHandler(jsonAccessDeniedHandler(errorWriter)))
                .sessionManagement(session -> session
                        // 会话固定防护：认证成功时更换 sessionId（契约 §7.3）。
                        .sessionAuthenticationStrategy(sessionAuthenticationStrategy)
                        // 会话由容器 + app_user_session 表共同管理（绝对期限在过滤链里落实）。
                        .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
                .headers(headers -> headers
                        .contentTypeOptions(Customizer.withDefaults())        // X-Content-Type-Options: nosniff
                        .referrerPolicy(referrer -> referrer.policy(
                                org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter
                                        .ReferrerPolicy.SAME_ORIGIN))
                        .frameOptions(frame -> frame.deny())
                        // 刻意不配置 CSP：本轮不动前端，加 CSP 会打断既有行内脚本（契约 §7.3 同义）。
                        // 这里给一个空配置 lambda（等价于"不加这条头"），而不是调用某个 disable()：
                        // HeadersConfigurer 没有为 CSP 提供 disable()，用空 lambda 表达"我们明确不加"。
                        .contentSecurityPolicy(csp -> {
                        }));

        // 绝对期限过滤器排在 BasicAuthenticationFilter 之后：那时 SecurityContext 已经装好，
        // 我们才知道这次请求属于哪个用户、该查哪个会话的期限。
        http.addFilterAfter(absoluteTtlFilter, BasicAuthenticationFilter.class);

        return http.build();
    }

    /**
     * 会话固定防护策略：认证成功时把当前会话换成新的 sessionId。
     *
     * <p>显式声明而不是靠默认值：默认值随 Spring Security 版本变过（migrateSession → changeSessionId），
     * 而这个行为有安全含义，必须是"我们选的"。
     */
    @Bean
    public SessionAuthenticationStrategy sessionAuthenticationStrategy() {
        return new ChangeSessionIdAuthenticationStrategy();
    }

    /**
     * CSRF token 处理器：**强制**在进入链时就解析 token。
     *
     * <p>Spring Security 6 默认用延迟（deferred）token，只有控制器主动读取时才生成；
     * 结果是"登录响应里没有 XSRF-TOKEN cookie"，前端下一次写请求必然 403。
     * 这里显式解析：每个请求都会带上/刷新 token，`GET /api/v3/auth/csrf` 也就天然返回有效值。
     */
    private static CsrfTokenRequestHandler alwaysResolveTokenHandler() {
        CsrfTokenRequestAttributeHandler delegate = new CsrfTokenRequestAttributeHandler();
        return new CsrfTokenRequestHandler() {
            @Override
            public void handle(HttpServletRequest request, HttpServletResponse response,
                               java.util.function.Supplier<CsrfToken> csrfToken) {
                delegate.handle(request, response, csrfToken);
                csrfToken.get();  // 立即生成，保证 Set-Cookie 被写出
            }

            @Override
            public String resolveCsrfTokenValue(HttpServletRequest request, CsrfToken csrfToken) {
                return delegate.resolveCsrfTokenValue(request, csrfToken);
            }
        };
    }

    /** 未认证：401 + 契约 §7.1 的 JSON 形状（**绝不**返回重定向 HTML）。 */
    private static AuthenticationEntryPoint jsonAuthenticationEntryPoint(ApiErrorWriter errorWriter) {
        return (request, response, authException) ->
                errorWriter.write(request, response, org.springframework.http.HttpStatus.UNAUTHORIZED,
                        ApiErrorCodes.UNAUTHENTICATED, "请先登录。");
    }

    /**
     * 已认证但无权限：403 JSON。
     *
     * <p>这里同时承担 CSRF 失败的输出？不是 —— CSRF 失败由 {@code CsrfFilter} 直接
     * 转发到 {@code AccessDeniedHandler}，所以必须在这里把"是 CSRF 还是真越权"分开：
     * 请求属性里带 {@code CsrfFilter} 的 {@code InvalidCsrfTokenException} 时给 {@code CSRF_INVALID}。
     * 前端靠这个码决定"重新取 token 重试"还是"提示无权限"。
     */
    private static AccessDeniedHandler jsonAccessDeniedHandler(ApiErrorWriter errorWriter) {
        return (request, response, accessDeniedException) -> {
            boolean csrf = request.getAttribute("org.springframework.security.web.csrf.CsrfException") != null
                    || accessDeniedException instanceof org.springframework.security.web.csrf.CsrfException;
            if (csrf) {
                errorWriter.write(request, response, org.springframework.http.HttpStatus.FORBIDDEN,
                        ApiErrorCodes.CSRF_INVALID, "CSRF 校验失败，请刷新页面后重试。");
            } else {
                errorWriter.write(request, response, org.springframework.http.HttpStatus.FORBIDDEN,
                        ApiErrorCodes.FORBIDDEN, "没有访问该资源的权限。");
            }
        };
    }

    /**
     * 暴露 {@link AuthenticationManager}：AuthController 显式调用它完成认证，
     * 而不是走 UsernamePasswordAuthenticationFilter（那会引入表单登录语义与默认登录页）。
     */
    @Bean
    public AuthenticationManager authenticationManager(UserDetailsService userDetailsService,
                                                       PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider provider = new DaoAuthenticationProvider();
        provider.setUserDetailsService(userDetailsService);
        provider.setPasswordEncoder(passwordEncoder);
        // 显式写出（true 也是默认值）：用户不存在与密码错误必须走同一个失败分支，
        // 否则 UsernameNotFoundException 会被翻译成不同响应，登录接口就成了账号枚举器。
        provider.setHideUserNotFoundExceptions(true);
        return new ProviderManager(provider);
    }

    /**
     * 安全上下文的仓储。显式成为一个 bean 是刻意的：AuthController 登录成功时需要
     * **立即**把上下文写进会话（这条链上没有 SecurityContextPersistenceFilter 的隐式保存），
     * 两处各自 new 一个实现类迟早会漂移。
     *
     * <p>实现类就是 Spring Security 的默认值 {@code HttpSessionSecurityContextRepository} ——
     * 我们没有换存储，只是把它显式化。
     */
    @Bean
    public org.springframework.security.web.context.SecurityContextRepository securityContextRepository() {
        return new org.springframework.security.web.context.HttpSessionSecurityContextRepository();
    }

    /**
     * 让容器把 session 生命周期事件发给 {@link org.springframework.security.web.session.HttpSessionEventPublisher}，
     * 进而通知 {@link SessionRegistryService}（它实现了 {@link jakarta.servlet.http.HttpSessionListener}）。
     */
    @Bean
    public HttpSessionEventPublisher httpSessionEventPublisher() {
        return new HttpSessionEventPublisher();
    }

    /** 供 {@code @PreAuthorize("hasRole('ADMIN')")} 之外的显式判断复用，避免角色字符串散落各处。 */
    public static final String ROLE_ADMIN = "ADMIN";
}
