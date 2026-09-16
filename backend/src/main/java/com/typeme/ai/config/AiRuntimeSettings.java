package com.typeme.ai.config;

import java.time.Duration;

/**
 * AI 侧运行时设置的**一次快照**。
 *
 * <p>为什么是一个不可变快照而不是散落的 {@code @Value}：管理员改配置后必须立刻生效，
 * 所以每次创建/重试/worker 执行都重新取一份快照（带 5 秒内存缓存，见
 * {@link AiRuntimeSettingsProvider}）。这样请求内部不会出现"前半段用旧超时、后半段用新模型"的撕裂。
 *
 * @param enabled              总开关；false → 创建接口 503 AI_NOT_CONFIGURED
 * @param baseUrl              只能来自部署配置/数据库设置，绝不接受用户输入（防 SSRF）
 * @param model                请求模型名
 * @param apiKey               明文 key（只在内存里；永不写日志、永不回显）
 * @param apiKeySource         key 的来源：db / env / none
 * @param promptVersion        入库并进去重键
 * @param mockMode             true = 使用 MockDeepSeekClient（结果带 mock:true）
 * @param dailyLimitPerUser    每用户每日新建分析次数
 * @param retryLimitPerHour    失败后主动重试次数/小时
 * @param globalDailyCallBudget 全局每日调用数预算
 * @param globalDailyTokenBudget 全局每日 token 预算
 * @param workerConcurrency    worker 并发（由数据库 lease + 在途计数实现，不用内存信号量代替）
 * @param connectTimeout       连接超时
 * @param requestDeadline      单次总 deadline（必须 < leaseDuration）
 * @param maxTokens            输出上限
 * @param temperature          采样温度
 * @param leaseDuration        lease 时长
 */
public record AiRuntimeSettings(
        boolean enabled,
        String baseUrl,
        String model,
        String apiKey,
        AiKeySource apiKeySource,
        String promptVersion,
        boolean mockMode,
        int dailyLimitPerUser,
        int retryLimitPerHour,
        long globalDailyCallBudget,
        long globalDailyTokenBudget,
        int workerConcurrency,
        Duration connectTimeout,
        Duration requestDeadline,
        int maxTokens,
        double temperature,
        Duration leaseDuration) {

    /** key 的来源。响应里只出现这个枚举名，绝不回显 key 本身。 */
    public enum AiKeySource {
        /** 管理员在后台配置（数据库）。 */
        DB("db"),
        /** 来自环境变量 DEEPSEEK_API_KEY。 */
        ENV("env"),
        /** 没有任何可用 key。 */
        NONE("none");

        private final String wire;

        AiKeySource(String wire) {
            this.wire = wire;
        }

        /** 对外（GET /ai/status）的小写标识。 */
        public String wire() {
            return wire;
        }
    }

    /** key 是否可用（非空）。注意 enabled 与 key 可用性是两件事，两个都要判。 */
    public boolean hasApiKey() {
        return apiKey != null && !apiKey.isBlank();
    }

    /** "能真正发起调用"：开关打开且 key 可用。 */
    public boolean usable() {
        return enabled && hasApiKey();
    }
}
