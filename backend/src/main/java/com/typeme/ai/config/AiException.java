package com.typeme.ai.config;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 模块的业务异常。
 *
 * <p>错误码沿用契约 02 §7.1 的全站枚举（NOT_FOUND / VALIDATION_FAILED / IDEMPOTENCY_KEY_REUSED /
 * BUDGET_EXCEEDED / AI_NOT_CONFIGURED / RATE_LIMITED / INTERNAL ...），由控制器**局部**
 * {@code @ExceptionHandler} 渲染成 {@code {code,message,requestId,details}}。
 *
 * <p>为什么不用全局 {@code @RestControllerAdvice}：全局异常处理由账号模块统一收敛（一处口径），
 * 并行开发时两边各写一个覆盖 {@code Exception.class} 的 advice，谁生效取决于注册顺序 ——
 * 那正是"同一错误在不同接口形状不同"的来源。这里只在本模块的控制器上做局部映射，
 * 等账号模块的全局形状定稿后可以随时摘掉。
 */
public class AiException extends RuntimeException {

    private final String code;
    private final int httpStatus;
    private final Map<String, Object> details;

    public AiException(String code, int httpStatus, String message) {
        this(code, httpStatus, message, Map.of());
    }

    public AiException(String code, int httpStatus, String message, Map<String, Object> details) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.details = details == null ? Map.of() : Map.copyOf(details);
    }

    public String code() {
        return code;
    }

    public int httpStatus() {
        return httpStatus;
    }

    public Map<String, Object> details() {
        return details;
    }

    /* ── 契约里的固定形状 ─────────────────────────────────────────────── */

    /** 「不存在」与「不属于当前用户」同形，避免用错误码枚举别人的资源 id。 */
    public static AiException notFound(String what) {
        return new AiException("NOT_FOUND", 404, what + "不存在。");
    }

    public static AiException validation(String message) {
        return new AiException("VALIDATION_FAILED", 400, message);
    }

    /** 未知字段/非法取值等"请求本身不合约定"的 400。 */
    public static AiException invalidRequest(String message) {
        return new AiException("INVALID_REQUEST", 400, message);
    }

    public static AiException consentRequired(String message) {
        return new AiException("CONSENT_REQUIRED", 400, message);
    }

    public static AiException idempotencyReused() {
        return new AiException("IDEMPOTENCY_KEY_REUSED", 409,
                "同一个 Idempotency-Key 已用于不同的请求内容，请换一个新的键。");
    }

    public static AiException notConfigured() {
        return new AiException("AI_NOT_CONFIGURED", 503,
                "AI 分析尚未配置（缺少 API key），请联系管理员。");
    }

    public static AiException budgetExceeded(String scope, Map<String, Object> extra) {
        Map<String, Object> details = new LinkedHashMap<>();
        details.put("scope", scope);
        if (extra != null) {
            details.putAll(extra);
        }
        return new AiException("BUDGET_EXCEEDED", 429, "今天的 AI 分析额度已经用完了。", details);
    }

    public static AiException rateLimited(int retryAfterSeconds) {
        return new AiException("RATE_LIMITED", 429, "请求过于频繁，请稍后再试。",
                Map.of("retryAfterSeconds", retryAfterSeconds));
    }

    public static AiException conflict(String message) {
        return new AiException("CONFLICT", 409, message);
    }

    public static AiException unauthenticated() {
        return new AiException("UNAUTHENTICATED", 401, "请先登录。");
    }
}
