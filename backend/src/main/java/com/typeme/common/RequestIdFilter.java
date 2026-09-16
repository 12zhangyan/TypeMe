package com.typeme.common;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;

/**
 * 给每个请求分配 requestId，放进 MDC 与响应头 {@code X-Request-Id}，并出现在所有错误体里。
 *
 * <p>为什么单独一个过滤器而不是在各处随手生成：排障时要能把"用户看到的 requestId"与
 * 服务端日志行**一对一**对上，这就要求同一个请求的所有日志行共享同一个 id。
 * MDC 是整个请求线程的，MDC 里没有 id 的话 {@link GlobalExceptionHandler} 只能编一个，
 * 于是用户手里的 id 在日志里根本搜不到——那比没有 id 更糟。
 *
 * <p>顺序取 {@link Ordered#HIGHEST_PRECEDENCE}：必须早于 Spring Security 的过滤器链，
 * 否则 401/403（由 Security 的 EntryPoint/DeniedHandler 直接写响应）会拿不到 id。
 *
 * <p>客户端传来的 {@code X-Request-Id} **不采纳**（只用于内部生成的追踪 id，不是透传字段）：
 * 允许客户端指定日志关联键等于允许它污染日志关联关系。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    /** 响应头名，约定 `X-Request-Id`（契约 §7.1 的 requestId 来源）。 */
    public static final String HEADER = "X-Request-Id";

    /** 请求属性名：控制器/异常处理器也能直接读。 */
    public static final String ATTRIBUTE = "typeme.requestId";

    public static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = UUID.randomUUID().toString();
        request.setAttribute(ATTRIBUTE, requestId);
        response.setHeader(HEADER, requestId);
        MDC.put(MDC_KEY, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            // 线程池复用线程：不清理 MDC 会把上一个请求的 id 泄漏给下一个请求（日志会串）。
            MDC.remove(MDC_KEY);
        }
    }
}
