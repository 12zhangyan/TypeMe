package com.typeme.account.repository;

import java.time.Instant;

/**
 * {@code typeme_ai_setting} 的一行。
 *
 * <p>{@code apiKeyEncrypted} 是 {@code TextEncryptor} 的输出，**只允许**在本记录与
 * {@code AiSettingsService} 内部流转：任何 DTO 都不得包含它，否则后台读接口会变成
 * "把加密后的 key 也一起回给前端"，那是没必要的暴露面。
 */
public record AiSettingRecord(
        String id,
        boolean enabled,
        String baseUrl,
        String apiKeyEncrypted,
        String apiKeyFingerprint,
        String apiKeySource,
        String model,
        String promptVersion,
        int dailyLimitPerUser,
        int retryLimitPerHour,
        int globalDailyCallBudget,
        long globalDailyTokenBudget,
        int workerConcurrency,
        int connectTimeoutMs,
        int requestDeadlineMs,
        int maxTokens,
        boolean mockMode,
        Instant updatedAt,
        String updatedBy
) {

    public static final String SOURCE_DB = "db";
    public static final String SOURCE_ENV = "env";
    public static final String SOURCE_NONE = "none";
}
