package com.typeme.account.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

/**
 * {@code PUT /api/v3/admin/ai-settings} 请求体。
 *
 * <p>所有字段可选（null = 不改动）。DTO 里**没有** {@code apiKeyFingerprint} /
 * {@code apiKeySource} / {@code updatedBy}：指纹由服务端从明文算出，来源由服务端判定，
 * 审计字段取自认证主体 —— 让客户端能指定这些值等于把审计日志的完整性交给调用方。
 *
 * <p>{@code apiKey} 的语义：{@code null}=不改、空串=清除、非空=替换。
 */
public record AdminAiSettingsUpdateRequest(
        Boolean enabled,

        @Size(max = 255, message = "baseUrl 过长")
        @Pattern(regexp = "^https?://.+", message = "baseUrl 必须是 http(s):// 开头")
        String baseUrl,

        @Size(max = 64, message = "model 过长")
        String model,

        @Size(max = 32, message = "promptVersion 过长")
        String promptVersion,

        @Positive(message = "dailyLimitPerUser 必须为正数")
        Integer dailyLimitPerUser,

        @Positive(message = "retryLimitPerHour 必须为正数")
        Integer retryLimitPerHour,

        @Positive(message = "globalDailyCallBudget 必须为正数")
        Integer globalDailyCallBudget,

        @Positive(message = "globalDailyTokenBudget 必须为正数")
        Long globalDailyTokenBudget,

        @Positive(message = "workerConcurrency 必须为正数")
        Integer workerConcurrency,

        @Positive(message = "connectTimeoutMs 必须为正数")
        Integer connectTimeoutMs,

        @Positive(message = "requestDeadlineMs 必须为正数")
        Integer requestDeadlineMs,

        @Positive(message = "maxTokens 必须为正数")
        Integer maxTokens,

        Boolean mockMode,

        @Size(max = 400, message = "apiKey 过长")
        String apiKey
) {

    @Override
    public String toString() {
        // 默认 record toString 会把 apiKey 明文打出来；后台配置页的日志最容易踩这个坑。
        return "AdminAiSettingsUpdateRequest[enabled=" + enabled + ", baseUrl=" + baseUrl
                + ", model=" + model + ", promptVersion=" + promptVersion
                + ", mockMode=" + mockMode + ", apiKey=" + (apiKey == null ? "unchanged" : "***") + "]";
    }
}
