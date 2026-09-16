package com.typeme.ai.client;

/**
 * DeepSeek 客户端请求（单次请求、单条 system + 单条 user；禁用多轮与工具调用，契约 03 §5）。
 *
 * @param model           本次请求的模型名（来自运行时设置，不来自用户输入）
 * @param systemPrompt    系统段（固定提示词，含 "json" 字样与结构示例）
 * @param userPrompt      用户段（单个 JSON 字符串，含 report/evidence/userNote/outputSchema）
 * @param maxTokens       输出上限
 * @param temperature     采样温度（thinking 关闭时有效）
 * @param responseFormatJsonObject 是否带 response_format={"type":"json_object"}
 */
public record DeepSeekRequest(
        String model,
        String systemPrompt,
        String userPrompt,
        int maxTokens,
        double temperature,
        boolean responseFormatJsonObject) {

    /** 契约默认形态：JSON 输出、非流式。 */
    public static DeepSeekRequest of(String model, String systemPrompt, String userPrompt, int maxTokens, double temperature) {
        return new DeepSeekRequest(model, systemPrompt, userPrompt, maxTokens, temperature, true);
    }
}
