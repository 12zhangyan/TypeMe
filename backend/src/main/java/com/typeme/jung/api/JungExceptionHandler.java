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
 * 新测模块的异常映射。
 *
 * <p>`basePackages` 限定在本模块：账号模块有自己的统一错误处理，两边同时注册
 * `@RestControllerAdvice` 时若都覆盖 `Exception.class`，谁生效取决于注册顺序 ——
 * 那正是"同一个错误在不同接口返回不同形状"的经典来源。这里只声明本模块自己的包。
 *
 * <p>错误形状与契约 §7.1 一致：`{code, message, requestId, details}`；
 * 500 不泄露堆栈，只留 requestId 供对账。
 */
@RestControllerAdvice(basePackages = "com.typeme.jung")
public class JungExceptionHandler {

    @ExceptionHandler(JungApiException.class)
    public ResponseEntity<Map<String, Object>> handleApi(JungApiException ex) {
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
