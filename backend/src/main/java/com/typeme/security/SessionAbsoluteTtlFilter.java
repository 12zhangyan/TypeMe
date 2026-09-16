package com.typeme.security;

import com.typeme.account.repository.UserSessionRepository;
import com.typeme.account.service.TypemeProperties;
import com.typeme.common.ApiErrorCodes;
import com.typeme.common.ApiErrorWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * 绝对会话期限（契约 §2.3 / 开发方案 §5）：容器只管闲置超时，7 天上限必须由服务端自己落实。
 *
 * <p>每个已认证请求做两件事：
 * <ol>
 *   <li>读 {@code app_user_session.absolute_expires_at}，过期则让会话失效并返回 401 JSON。
 *       会话行不存在同样按过期处理 —— "查不到账"就是"这个会话不该继续用"。</li>
 *   <li>刷新 {@code last_seen_at}，但**节流**：仅在距上次写入超过阈值时才落库，
 *       否则每个请求一次 UPDATE 会把会话表变成写热点。</li>
 * </ol>
 *
 * <p>节流状态放在会话属性里（而不是再查一次库或放进程缓存）：会话本身有生命周期，
 * 容器回收时状态一起消失，不需要额外的过期管理。
 *
 * <p>过滤器顺序排在 Spring Security 之后：只有认证已建立时才有 userId 可用；
 * Security 自己的 {@code SecurityContextHolderFilter} 在链的前面，因此这里读得到上下文。
 */
@Component
public class SessionAbsoluteTtlFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(SessionAbsoluteTtlFilter.class);

    /** 上一次写 last_seen_at 的时间戳（毫秒）在会话里的键。 */
    static final String LAST_SEEN_ATTR = "typeme.session.lastSeenWrittenAt";

    private final UserSessionRepository sessions;
    private final ApiErrorWriter errorWriter;
    private final TypemeProperties properties;

    public SessionAbsoluteTtlFilter(UserSessionRepository sessions, ApiErrorWriter errorWriter,
                                    TypemeProperties properties) {
        this.sessions = sessions;
        this.errorWriter = errorWriter;
        this.properties = properties;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof AnonymousAuthenticationToken) {
            // 匿名请求：绝对期限无从谈起。
            //
            // 这里**不判** "principal 是不是 String"：本模块的认证主体就是用户名字符串
            // （AccountService#establishSession），那样判会把所有真实登录的请求跳过，
            // 绝对会话期限就等于没做。
            chain.doFilter(request, response);
            return;
        }

        HttpSession session = request.getSession(false);
        if (session == null) {
            // 已认证却没有会话：只可能来自测试里的 SecurityMockMvcRequestPostProcessors 或
            // 将来的无状态认证。这里不越权判断，交给 Security 的链继续。
            chain.doFilter(request, response);
            return;
        }

        String sessionId = session.getId();
        Optional<Instant> absoluteExpiresAt = sessions.findAbsoluteExpiresAt(sessionId);
        Instant now = Instant.now();
        if (absoluteExpiresAt.isEmpty() || !absoluteExpiresAt.get().isAfter(now)) {
            expire(session, sessionId, absoluteExpiresAt.isPresent());
            errorWriter.write(request, response, HttpStatus.UNAUTHORIZED, ApiErrorCodes.UNAUTHENTICATED,
                    "会话已过期，请重新登录。");
            return;
        }

        touchIfStale(session, sessionId, now);
        chain.doFilter(request, response);
    }

    /** 让会话失效并删掉账本行；随后由 Security 的上下文清理保证旧 Cookie 不再可用。 */
    private void expire(HttpSession session, String sessionId, boolean rowExisted) {
        sessions.deleteBySessionId(sessionId);
        try {
            session.invalidate();
        } catch (IllegalStateException alreadyInvalid) {
            log.debug("session already invalid on ttl expiry sessionId={}", sessionId);
        }
        if (rowExisted) {
            log.info("session expired by absolute ttl");  // 只记事件，不记 sessionId/用户名
        }
    }

    private void touchIfStale(HttpSession session, String sessionId, Instant now) {
        Duration throttle = properties.auth().sessionLastSeenThrottle();
        Object lastWritten = session.getAttribute(LAST_SEEN_ATTR);
        if (lastWritten instanceof Long lastMillis && now.toEpochMilli() - lastMillis < throttle.toMillis()) {
            return;
        }
        sessions.touchLastSeen(sessionId, now);
        session.setAttribute(LAST_SEEN_ATTR, now.toEpochMilli());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        // 只处理 /api/v3：其它路径（旧 v1/v2 内容接口、静态资源、actuator）本来就无需会话，
        // 在这里对它们做表查询只会给每次静态请求加一次无谓的 IO。
        String path = request.getRequestURI();
        return path == null || !path.startsWith("/api/v3/");
    }
}
