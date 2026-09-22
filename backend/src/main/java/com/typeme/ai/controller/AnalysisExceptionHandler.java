package com.typeme.ai.controller;

import com.typeme.ai.config.AiException;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 控制器的**局部**异常映射。
 *
 * <p>错误形状与契约 02 §7.1 一致：{@code {code,message,requestId,details}}；
 * 500 不泄露内部细节，只留 requestId 供对账。
 *
 * <p><b>为什么是"局部"而不是全站统一 advice</b>：全局异常处理由账号模块统一收敛（一处口径）。
 * 并行开发期间如果两边各写一个覆盖 {@code Exception.class} 的 {@code @RestControllerAdvice}，
 * 谁生效取决于注册顺序 —— 那正是"同一个错误在不同接口形状不同"的经典来源。
 * 因此这里用 {@code basePackages} 把自己限制在 {@code com.typeme.ai}，
 * 等账号模块的全局形状定稿后，这个类可以整体删掉、改由全局 advice 统一渲染。
 */
@RestControllerAdvice(basePackages = "com.typeme.ai")
public class AnalysisExceptionHandler {

    @ExceptionHandler(AiException.class)
    public ResponseEntity<Map<String, Object>> handleAi(AiException ex) {
        return ResponseEntity.status(ex.httpStatus())
                .body(body(ex.code(), ex.getMessage(), ex.details()));
    }

    /**
     * 共用的平台能力（限流）抛出的账号模块异常；理由同 `JungExceptionHandler#handleSharedApi`。
     */
    @ExceptionHandler(com.typeme.common.ApiException.class)
    public ResponseEntity<Map<String, Object>> handleSharedApi(com.typeme.common.ApiException ex) {
        return ResponseEntity.status(ex.httpStatus())
                .body(body(ex.code(), ex.getMessage(), ex.details()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleUnreadable(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest()
                .body(body("VALIDATION_FAILED", "请求体无法解析为约定的 JSON 结构。", Map.of()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(IllegalStateException ex) {
        // 走到这里说明是服务端自身的数据一致性问题（例如报告快照被外部改写）。
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
