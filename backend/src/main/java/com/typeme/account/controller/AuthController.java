package com.typeme.account.controller;

import com.typeme.account.dto.CsrfTokenResponse;
import com.typeme.account.dto.LoginRequest;
import com.typeme.account.dto.LoginResponse;
import com.typeme.account.dto.RecoverRequest;
import com.typeme.account.dto.RegisterRequest;
import com.typeme.account.dto.RegisterResponse;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.service.AccountService;
import com.typeme.security.ClientIpResolver;
import com.typeme.security.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code /api/v3/auth/**}（契约 §7.2 认证）。
 *
 * <p>本控制器的四个接口在安全配置里是 {@code permitAll}（未登录也要能访问），
 * 但它们**仍然受 CSRF 保护**：注册/登录/恢复都会创建或改变认证状态，
 * 不做 CSRF 就等于允许第三方站点代替用户发起登录（会话固定 + 强制登录攻击的第一步）。
 *
 * <p>响应缓存：注册（含恢复码）、CSRF token 都带 {@code Cache-Control: no-store}。
 * 恢复码尤其关键 —— 它会经过代理、浏览器缓存、以及"后退一下还能看到"的历史记录。
 */
@RestController
@RequestMapping("/api/v3/auth")
public class AuthController {

    private final AccountService accountService;
    private final RateLimitService rateLimit;
    private final ClientIpResolver clientIpResolver;

    public AuthController(AccountService accountService, RateLimitService rateLimit,
                          ClientIpResolver clientIpResolver) {
        this.accountService = accountService;
        this.rateLimit = rateLimit;
        this.clientIpResolver = clientIpResolver;
    }

    /**
     * 取 CSRF token。
     *
     * <p>token 由 Spring Security 的 {@code CsrfFilter} 解析后注入；本方法只是把它暴露成 JSON，
     * 让前端在没有可读 cookie 的场景（例如首屏还没有任何响应）也能拿到它。
     * 同时 cookie {@code XSRF-TOKEN} 会被写出 —— 前端两种方式任选，服务端两套都支持。
     */
    @GetMapping("/csrf")
    public ResponseEntity<CsrfTokenResponse> csrf(CsrfToken csrfToken) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new CsrfTokenResponse(csrfToken.getToken(), csrfToken.getHeaderName(),
                        csrfToken.getParameterName()));
    }

    /**
     * 注册：创建账号 → 返回**仅此一次**的恢复码 → 立即建立会话（用户不用再登录一次）。
     *
     * <p>限流按来源 IP：注册是最容易被脚本刷的入口（每个账号都写两行数据 + 8 次 PBKDF2）。
     */
    @PostMapping("/register")
    public ResponseEntity<RegisterResponse> register(@Valid @RequestBody RegisterRequest request,
                                                     HttpServletRequest httpRequest) {
        rateLimit.checkRegisterIp(clientIpResolver.resolve(httpRequest));
        RegisterResponse response = accountService.register(
                request.username(), request.password(), request.nickname(),
                Boolean.TRUE.equals(request.disclaimerAccepted()));
        // 建立会话：注册后立刻可用（契约 §7.2）。
        accountService.establishSessionForNewUser(httpRequest, response.userId(), response.username());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    /**
     * 登录。
     *
     * <p>限流同时按 IP 与用户名两个 key：只按 IP 挡不住分布式撞库（每个 IP 少量尝试），
     * 只按用户名会让"用字典扫大量用户名"畅通无阻。两个 key 各自有上限。
     */
    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request,
                                               HttpServletRequest httpRequest) {
        rateLimit.checkLoginIp(clientIpResolver.resolve(httpRequest));
        rateLimit.checkLoginUsername(UserRepository.normalize(request.normalizedUsername()));
        LoginResponse response = accountService.login(httpRequest, request.username(), request.password());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    /** 登出：撤销当前会话，返回 204（契约 §7.2）。 */
    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest httpRequest) {
        accountService.logout(httpRequest);
        return ResponseEntity.noContent().build();
    }

    /**
     * 用恢复码重置密码。
     *
     * <p>成功后**不自动登录**：用户刚刚经历"账号可能已泄露"的场景，让他用新密码主动登录一次，
     * 是让"新密码确实能用"这件事被验证的最短路径（否则客户端可能拿着旧会话继续跑，
     * 直到闲置超时才发现密码已经变了）。
     */
    @PostMapping("/recover")
    public ResponseEntity<Void> recover(@Valid @RequestBody RecoverRequest request,
                                        HttpServletRequest httpRequest) {
        rateLimit.checkRecoverIp(clientIpResolver.resolve(httpRequest));
        accountService.recover(request.username(), request.recoveryCode(), request.newPassword());
        return ResponseEntity.noContent().build();
    }
}
