package com.typeme.ai.client;

/**
 * 上游返回的可解析结果。
 *
 * <p>刻意保留 {@code finishReason} 与原始 {@code content}：截断（length）与空内容必须能被上层
 * 区分出来，否则会写出"把被截断的半截 JSON 当成功"的经典缺陷（契约 03 §3 规则 9）。
 *
 * @param content       choices[0].message.content，可能为空串（官方明确"偶尔返回空内容"）
 * @param finishReason  choices[0].finish_reason，可能缺失（按 null 处理）
 * @param modelReturned 响应顶层 model，用于记录"实际用哪个模型答的"
 * @param usage         官方 usage；字段可能缺失，缺失按 0 处理
 */
public record DeepSeekResponse(
        String content,
        String finishReason,
        String modelReturned,
        TokenUsage usage) {

    /** 官方 usage 子集（缓存命中/未命中分别计价，契约 03 §0）。 */
    public record TokenUsage(
            long promptTokens,
            long completionTokens,
            long promptCacheHitTokens,
            long promptCacheMissTokens) {

        public static final TokenUsage EMPTY = new TokenUsage(0, 0, 0, 0);

        public long totalTokens() {
            return promptTokens + completionTokens;
        }
    }
}
