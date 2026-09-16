package com.typeme.common;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

/**
 * 把错误体写到裸的 {@code HttpServletResponse} 上。
 *
 * <p>为什么需要它：Spring Security 的 {@code AuthenticationEntryPoint} 与
 * {@code AccessDeniedHandler} 运行在**过滤器链**里，早于 MVC 的异常处理，
 * {@link GlobalExceptionHandler} 根本拦不到它们。若各写各的 JSON，401/403 的形状
 * 就会与其它错误不一致（历史上最常见的形态就是 401 返回一坨 HTML 重定向）。
 * 所以两条路径共用本类，形状只在这里定义一次。
 */
@Component
public class ApiErrorWriter {

    private final ObjectMapper objectMapper;

    public ApiErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response,
                      HttpStatus status, String code, String message) throws IOException {
        write(request, response, status, code, message, Map.of());
    }

    public void write(HttpServletRequest request, HttpServletResponse response,
                      HttpStatus status, String code, String message, Map<String, Object> details) throws IOException {
        if (response.isCommitted()) {
            // 已经写出去了就不能再改状态码；静默返回比抛 IllegalStateException 更能保住原始响应。
            return;
        }
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(),
                new ApiErrorBody(code, message, requestId(request), details));
    }

    /**
     * 取当前请求的 requestId。{@link RequestIdFilter} 排在过滤器链最前面，正常情况下一定已经写过；
     * 极少数容器级错误下拿不到时回退成空串而不是 null —— 前端与日志都假定这个字段是字符串。
     */
    private static String requestId(HttpServletRequest request) {
        Object existing = request.getAttribute(RequestIdFilter.ATTRIBUTE);
        return existing instanceof String value && !value.isBlank() ? value : "";
    }
}
