package com.typeme.ai.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * {@code typeme.ai.*} 的文件/环境变量配置（契约 03 §1）。
 *
 * <p>这只是**兜底值**：数据库单行设置表 {@code typeme_ai_setting}（管理员后台，V6 由账号模块建）
 * 有值时优先，见 {@link AiRuntimeSettingsProvider}。默认值必须与契约 §1 一致。
 *
 * <p>注意：这里**永远不写真实 key**；{@code api-key} 只从环境变量 {@code DEEPSEEK_API_KEY} 读。
 */
@ConfigurationProperties(prefix = "typeme.ai")
public class AiProperties {

    /** 总开关；false 时创建接口 503 AI_NOT_CONFIGURED。 */
    private boolean enabled = false;

    /** 只允许来自部署配置/数据库设置，不得被请求参数覆盖（防 SSRF）。 */
    private String baseUrl = "https://api.deepseek.com";

    /** 只从环境变量读，不写进 YAML 真实值/前端/日志/仓库/文档。 */
    private String apiKey = "";

    private String model = "deepseek-flash";

    /** 默认提示词版本；v4 加强证据解释与行动建议，沿用 v3 的数据范围和输出契约。 */
    private String promptVersion = "typeme-ai-prompt-v4";

    private Duration connectTimeout = Duration.ofSeconds(5);

    private Duration requestDeadline = Duration.ofSeconds(90);

    private int maxTokens = 2600;

    private double temperature = 0.4;

    private int dailyLimitPerUser = 2;

    private int retryLimitPerHour = 3;

    private long globalDailyTokenBudget = 200_000L;

    private long globalDailyCallBudget = 200L;

    private int workerConcurrency = 2;

    private Duration workerPollInterval = Duration.ofSeconds(2);

    private Duration leaseDuration = Duration.ofSeconds(120);

    /** JSON；未配置时**不估算费用**，只记 token 与实际调用数。 */
    private String usagePrices = "";

    private boolean mockMode = false;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getPromptVersion() {
        return promptVersion;
    }

    public void setPromptVersion(String promptVersion) {
        this.promptVersion = promptVersion;
    }

    public Duration getConnectTimeout() {
        return connectTimeout;
    }

    public void setConnectTimeout(Duration connectTimeout) {
        this.connectTimeout = connectTimeout;
    }

    public Duration getRequestDeadline() {
        return requestDeadline;
    }

    public void setRequestDeadline(Duration requestDeadline) {
        this.requestDeadline = requestDeadline;
    }

    public int getMaxTokens() {
        return maxTokens;
    }

    public void setMaxTokens(int maxTokens) {
        this.maxTokens = maxTokens;
    }

    public double getTemperature() {
        return temperature;
    }

    public void setTemperature(double temperature) {
        this.temperature = temperature;
    }

    public int getDailyLimitPerUser() {
        return dailyLimitPerUser;
    }

    public void setDailyLimitPerUser(int dailyLimitPerUser) {
        this.dailyLimitPerUser = dailyLimitPerUser;
    }

    public int getRetryLimitPerHour() {
        return retryLimitPerHour;
    }

    public void setRetryLimitPerHour(int retryLimitPerHour) {
        this.retryLimitPerHour = retryLimitPerHour;
    }

    public long getGlobalDailyTokenBudget() {
        return globalDailyTokenBudget;
    }

    public void setGlobalDailyTokenBudget(long globalDailyTokenBudget) {
        this.globalDailyTokenBudget = globalDailyTokenBudget;
    }

    public long getGlobalDailyCallBudget() {
        return globalDailyCallBudget;
    }

    public void setGlobalDailyCallBudget(long globalDailyCallBudget) {
        this.globalDailyCallBudget = globalDailyCallBudget;
    }

    public int getWorkerConcurrency() {
        return workerConcurrency;
    }

    public void setWorkerConcurrency(int workerConcurrency) {
        this.workerConcurrency = workerConcurrency;
    }

    public Duration getWorkerPollInterval() {
        return workerPollInterval;
    }

    public void setWorkerPollInterval(Duration workerPollInterval) {
        this.workerPollInterval = workerPollInterval;
    }

    public Duration getLeaseDuration() {
        return leaseDuration;
    }

    public void setLeaseDuration(Duration leaseDuration) {
        this.leaseDuration = leaseDuration;
    }

    public String getUsagePrices() {
        return usagePrices;
    }

    public void setUsagePrices(String usagePrices) {
        this.usagePrices = usagePrices;
    }

    public boolean isMockMode() {
        return mockMode;
    }

    public void setMockMode(boolean mockMode) {
        this.mockMode = mockMode;
    }
}
