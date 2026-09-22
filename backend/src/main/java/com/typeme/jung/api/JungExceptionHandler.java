package com.typeme.jung.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.slf4j.MDC;

import com.typeme.jung.service.JungApiException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 新测与平台模块共用的异常映射。
 *
 * <p>`basePackages` 限定在 `com.typeme.jung` 与 `com.typeme.platform`：账号模块有自己的
 * 统一错误处理，两边同时注册 `@RestControllerAdvice` 时若都覆盖 `Exception.class`，
 * 谁生效取决于注册顺序 —— 那正是"同一个错误在不同接口返回不同形状"的经典来源。
 *
 * <p>平台模块（`/api/v3/platform`）刻意**复用同一份映射**而不是自己写一份：错误形状
 * 必须一致，否则前端的错误处理要按路径分叉；而两份实现迟早会在
 * "500 要不要带 details"这种地方分叉。
 *
 * <p>错误形状与契约 §7.1 一致：`{code, message, requestId, details}`；
 * 500 不泄露堆栈，只留 requestId 供对账。
 *
 * <p><b>为什么还要在此映射 {@code com.typeme.common.ApiException}（2026-09-21）：</b>
 * `com.typeme.security.RateLimitService` 是为全站共用的限流能力（它在 `com.typeme.security`，
 * 不属哪个业务模块），但它抛的是账号模块的错误类型 `ApiException`。
 * 新测目录公开化（A58）后，`JungController#catalogReadAllowed` 成了
 * jung/platform 控制器里第一个会抛这个类型的地方 —— 而本 advice 原先只认
 * {@link JungApiException}，于是匿名限流命中时会被 MVC 当成“未处理异常”
 * 往外抛（测试里表现为 `ServletException` 而非 429，_API 里表现为 500 与一条 error 级日志）。
 *
 * <p>这里只加**这一个**显式类型映射，**不**把 `basePackages` 扩到重叠：
 * 与账号模块的 `GlobalExceptionHandler` 同时覆盖 `Exception.class` 这类公共父型时，
 * 谁生效取决于 advice 顺序 —— 那正是本类注释开头警告的那个坑。
 */
@RestControllerAdvice(basePackages = {"com.typeme.jung", "com.typeme.platform"})
public class JungExceptionHandler {

    @ExceptionHandler(JungApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(JungApiException ex) {
        return ResponseEntity.status(ex.httpStatus())
                .body(body(ex.code(), ex.getMessage(), ex.details()));
    }

    /**
     * 共用的平台能力（限流）抛出的账号模块异常。
     *
     * <p>用全限定名而不是 import：这个依赖是“平台能力”而不是“账号模块”，
     * 保留 FQN 能让读过本类注释的人一眼看到它跨了哪个包边界。
     */
    @ExceptionHandler(com.typeme.common.ApiException.class)
    public ResponseEntity<Map<String, Object>> handleSharedApi(com.typeme.common.ApiException ex) {
        return ResponseEntity.status(ex.httpStatus())
                .body(body(ex.code(), ex.getMessage(), ex.details()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, Object> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error ->
                fields.put(error.getField(), error.getDefaultMessage()));
        return ResponseEntity.badRequest()
                .body(body("VALIDATION_FAILED", "请求参数不合法。", Map.of("fields", fields)));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleUnreadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest()
                .body(body("VALIDATION_FAILED", "请求体无法解析为约定的 JSON 结构。", Map.of()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(IllegalStateException ex) {
        // 走到这里说明是服务端自身的数据一致性问题（例如报告 JSON 被外部改写）。
        // 对用户只说"服务端数据异常"，细节留给日志与 requestId。
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(body("INTERNAL", "服务端数据异常，请稍后重试或联系我们。", Map.of()));
    }

    private static Map<String, Object> body(String code, String message, Map<String, Object> details) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("code", code);
        body.put("message", message);
        body.put("requestId", MDC.get("requestId"));
        body.put("details", details == null ? Map.of() : details);
        return body;
    }
}
