package com.typeme.ai.client;

/**
 * Mock 适配器可被参数化的故障模式（契约 03 §6.1）。
 *
 * <p>存在的意义：真实 DeepSeek 的这些失败（空内容、截断、非法 json、429）无法按需复现，
 * 而它们恰好是最容易写错的分支 —— 必须能在 CI 里稳定重现。
 */
public enum MockFailureMode {

    /** 正常：返回确定性、能通过校验的 JSON。 */
    OK,
    /** 401：key 无效/未授权。 */
    UNAUTHORIZED,
    /** 402：余额不足。 */
    PAYMENT,
    /** 429：限流（带 Retry-After）。 */
    RATE_LIMITED,
    /** 5xx：服务端错误（执行状态未知）。 */
    SERVER_ERROR,
    /** 超时（执行状态未知）。 */
    TIMEOUT,
    /** 空内容（官方明确"偶尔返回空内容"）。 */
    EMPTY_CONTENT,
    /** 内容不是合法 JSON。 */
    INVALID_JSON,
    /** 被 max_tokens 截断（finish_reason=length）。 */
    TRUNCATED,
    /** 类型不符：referenceType 被改成别的值。 */
    TYPE_MISMATCH,
    /** 内容违规：正文出现"确诊/准确率"这类被禁表述。 */
    CONTENT_VIOLATION,
    /** 提示注入成功场景：模型被 userNote 说服改判类型（用于证明服务端仍会拒绝）。 */
    PROMPT_INJECTION;

    /** 从配置/系统属性解析；未知值一律回落到 OK（并会被调用方记 WARN）。 */
    public static MockFailureMode parse(String token) {
        if (token == null || token.isBlank()) {
            return OK;
        }
        String normalized = token.trim().toUpperCase(java.util.Locale.ROOT).replace('-', '_');
        for (MockFailureMode mode : values()) {
            if (mode.name().equals(normalized)) {
                return mode;
            }
        }
        return OK;
    }
}
