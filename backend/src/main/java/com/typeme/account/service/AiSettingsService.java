package com.typeme.account.service;

import com.typeme.account.dto.AdminAiSettingsUpdateRequest;
import com.typeme.account.repository.AiSettingRecord;
import com.typeme.account.repository.AiSettingRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.encrypt.TextEncryptor;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 后台 AI 设置：读写 {@code typeme_ai_setting}，并给 AI 模块提供 {@link #effectiveSettings()}。
 *
 * <p><b>取值优先级</b>：DB 值优先，环境变量（{@code typeme.ai.*}）兜底。
 * 只有 DB 里为 {@code null}/{@code 空}的字段才回落到环境变量 —— 这样运维可以用环境变量做
 * "带默认值的部署"，同时允许后台在不重启的情况下覆盖。
 *
 * <p><b>apiKey 的三条纪律</b>：
 * <ol>
 *   <li>落库前必须经 {@link TextEncryptor}（{@code Encryptors.delux}，密钥来自配置）；</li>
 *   <li>任何响应/日志都不得出现明文，也不得出现密文；对外只有
 *       {@code apiKeyConfigured} 与 {@code apiKeyFingerprint}（sha256 前 8 位）；</li>
 *   <li>指纹只用于"确认换没换"，不可逆 —— 8 位十六进制来自完整 key 的 sha256，
 *       但**不做**"key 是否有效"的判断（那要真的调上游，属于 AI 模块的职责）。</li>
 * </ol>
 *
 * <p>未配置加密密钥时：读取照常（只是 {@code apiKeySource} 会显示 env/none），
 * 而任何"写入 key"的请求会被拒绝（{@code 503 NOT_CONFIGURED}）。
 * 这样应用能在没配密钥的开发环境启动，但绝不会用一个硬编码密钥加密生产 key。
 */
@Service
public class AiSettingsService {

    private static final Logger log = LoggerFactory.getLogger(AiSettingsService.class);

    private final AiSettingRepository repository;
    private final TextEncryptor textEncryptor;
    private final TypemeProperties properties;

    public AiSettingsService(AiSettingRepository repository, TextEncryptor textEncryptor,
                             TypemeProperties properties) {
        this.repository = repository;
        this.textEncryptor = textEncryptor;
        this.properties = properties;
    }

    /**
     * 给 AI 模块消费的生效配置。
     *
     * <p>{@code apiKey} 字段在这里**有值**（解密后的明文）：这是 AI 模块发请求唯一需要的形态。
     * 本记录绝不能被序列化进任何响应体 —— 后台读取走 {@link #adminView()}。
     */
    public EffectiveAiSettings effectiveSettings() {
        Optional<AiSettingRecord> stored = repository.find();
        TypemeProperties.Ai env = properties.ai();

        if (stored.isEmpty()) {
            // 还没有写过库：完全按环境变量工作（这正是"新部署、只在 CI 注入环境变量"的场景）。
            boolean envKey = !env.apiKey().isBlank();
            return new EffectiveAiSettings(
                    env.enabled(), env.baseUrl(), env.apiKey(),
                    envKey ? AiSettingRecord.SOURCE_ENV : AiSettingRecord.SOURCE_NONE,
                    envKey ? fingerprint(env.apiKey()) : null,
                    env.model(), env.promptVersion(), env.dailyLimitPerUser(), env.retryLimitPerHour(),
                    env.globalDailyCallBudget(), env.globalDailyTokenBudget(), env.workerConcurrency(),
                    env.connectTimeoutMs(), env.requestDeadlineMs(), env.maxTokens(), env.mockMode(),
                    null, null);
        }

        AiSettingRecord row = stored.get();
        String baseUrl = blankToNull(row.baseUrl()) == null ? env.baseUrl() : row.baseUrl();
        String model = blankToNull(row.model()) == null ? env.model() : row.model();
        String promptVersion = blankToNull(row.promptVersion()) == null ? env.promptVersion() : row.promptVersion();

        String apiKey;
        String source;
        String fingerprint;
        if (blankToNull(row.apiKeyEncrypted()) != null) {
            apiKey = decryptOrEmpty(row.apiKeyEncrypted());
            source = AiSettingRecord.SOURCE_DB;
            fingerprint = row.apiKeyFingerprint();
        } else if (!env.apiKey().isBlank()) {
            apiKey = env.apiKey();
            source = AiSettingRecord.SOURCE_ENV;
            fingerprint = fingerprint(env.apiKey());
        } else {
            apiKey = "";
            source = AiSettingRecord.SOURCE_NONE;
            fingerprint = null;
        }
        return new EffectiveAiSettings(
                row.enabled(), baseUrl, apiKey, source, fingerprint,
                model,
                promptVersion,
                positive(row.dailyLimitPerUser(), env.dailyLimitPerUser()),
                positive(row.retryLimitPerHour(), env.retryLimitPerHour()),
                positive(row.globalDailyCallBudget(), env.globalDailyCallBudget()),
                positive(row.globalDailyTokenBudget(), env.globalDailyTokenBudget()),
                positive(row.workerConcurrency(), env.workerConcurrency()),
                positive(row.connectTimeoutMs(), env.connectTimeoutMs()),
                positive(row.requestDeadlineMs(), env.requestDeadlineMs()),
                positive(row.maxTokens(), env.maxTokens()),
                row.mockMode(),
                row.updatedAt(), row.updatedBy());
    }

    /** 后台读取视图：**非敏感**字段 + key 的存在性/指纹。 */
    public Map<String, Object> adminView() {
        EffectiveAiSettings settings = effectiveSettings();
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("enabled", settings.enabled());
        view.put("baseUrlHost", hostOf(settings.baseUrl()));
        view.put("model", settings.model());
        view.put("promptVersion", settings.promptVersion());
        view.put("dailyLimitPerUser", settings.dailyLimitPerUser());
        view.put("retryLimitPerHour", settings.retryLimitPerHour());
        view.put("globalDailyCallBudget", settings.globalDailyCallBudget());
        view.put("globalDailyTokenBudget", settings.globalDailyTokenBudget());
        view.put("workerConcurrency", settings.workerConcurrency());
        view.put("connectTimeoutMs", settings.connectTimeoutMs());
        view.put("requestDeadlineMs", settings.requestDeadlineMs());
        view.put("maxTokens", settings.maxTokens());
        view.put("mockMode", settings.mockMode());
        view.put("apiKeyConfigured", !settings.apiKey().isBlank());
        view.put("apiKeyFingerprint", settings.apiKeyFingerprint());
        view.put("apiKeySource", settings.apiKeySource());
        view.put("updatedAt", settings.updatedAt() == null ? null : settings.updatedAt().toString());
        view.put("updatedBy", settings.updatedBy());
        return view;
    }

    /**
     * 后台写入。{@code apiKey} 为 null 表示"不改动现有 key"；为空串表示"清除 key"。
     *
     * <p>为什么区分 null 与空串：后台表单里"没填"和"我要删掉 key"是两种意图。
     * 用同一个 null 表达会让"想清除"变成一个做不到的操作，而运维确实需要它（例如换 key 提供方）。
     */
    public Map<String, Object> update(AdminAiSettingsUpdateRequest update, String adminUserId) {
        Optional<AiSettingRecord> stored = repository.find();
        EffectiveAiSettings current = effectiveSettings();
        Instant now = Instant.now();

        String encrypted = stored.map(AiSettingRecord::apiKeyEncrypted).orElse(null);
        String fingerprint = stored.map(AiSettingRecord::apiKeyFingerprint).orElse(null);
        String source = stored.map(AiSettingRecord::apiKeySource).orElse(AiSettingRecord.SOURCE_NONE);

        if (update.apiKey() != null) {
            String raw = update.apiKey().trim();
            if (raw.isEmpty()) {
                encrypted = null;
                fingerprint = null;
                source = properties.ai().apiKey().isBlank()
                        ? AiSettingRecord.SOURCE_NONE : AiSettingRecord.SOURCE_ENV;
                log.info("ai api key cleared by admin");
            } else {
                // encrypt() 内部先要求加密密钥存在（缺失即 503），绝不落明文。
                encrypted = encrypt(raw);
                fingerprint = fingerprint(raw);
                source = AiSettingRecord.SOURCE_DB;
                log.info("ai api key updated by admin fingerprint={}", fingerprint);
            }
        }

        AiSettingRecord record = new AiSettingRecord(
                AiSettingRepository.SINGLETON_ID,
                update.enabled() == null ? current.enabled() : update.enabled(),
                update.baseUrl() == null ? current.baseUrl() : blankToNull(update.baseUrl()),
                encrypted,
                fingerprint,
                source,
                update.model() == null || update.model().isBlank() ? current.model() : update.model().trim(),
                update.promptVersion() == null || update.promptVersion().isBlank()
                        ? current.promptVersion() : update.promptVersion().trim(),
                positive(update.dailyLimitPerUser() == null ? 0 : update.dailyLimitPerUser(), current.dailyLimitPerUser()),
                positive(update.retryLimitPerHour() == null ? 0 : update.retryLimitPerHour(), current.retryLimitPerHour()),
                positive(update.globalDailyCallBudget() == null ? 0 : update.globalDailyCallBudget(),
                        current.globalDailyCallBudget()),
                positive(update.globalDailyTokenBudget() == null ? 0L : update.globalDailyTokenBudget(),
                        current.globalDailyTokenBudget()),
                positive(update.workerConcurrency() == null ? 0 : update.workerConcurrency(),
                        current.workerConcurrency()),
                positive(update.connectTimeoutMs() == null ? 0 : update.connectTimeoutMs(),
                        current.connectTimeoutMs()),
                positive(update.requestDeadlineMs() == null ? 0 : update.requestDeadlineMs(),
                        current.requestDeadlineMs()),
                positive(update.maxTokens() == null ? 0 : update.maxTokens(), current.maxTokens()),
                update.mockMode() == null ? current.mockMode() : update.mockMode(),
                now, adminUserId);
        repository.save(record);
        return adminView();
    }

    private String encrypt(String raw) {
        // 加密密钥缺失时仓库层的行为由 TypemeProperties.requireSettingsSecret() 决定（抛 503）。
        properties.security().requireSettingsSecret();
        return textEncryptor.encrypt(raw);
    }

    private String decryptOrEmpty(String encrypted) {
        try {
            return textEncryptor.decrypt(encrypted);
        } catch (RuntimeException ex) {
            // 密钥轮换后旧密文解不开：这是**预期**行为，但绝不能让后台读取 500。
            // 记 WARN 让运维知道"需要重新填一次 key"，对外表现为 apiKey 未配置。
            log.warn("ai api key decryption failed (settings secret rotated?)");
            return "";
        }
    }

    /** 指纹 = sha256(camelCase key) 的前 8 位十六进制，只用于"换没换"的确认。 */
    static String fingerprint(String apiKey) {
        if (apiKey == null || apiKey.isBlank()) {
            return null;
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(apiKey.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(8);
            for (int i = 0; i < 4; i++) {
                hex.append(String.format("%02x", digest[i]));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 不可用", ex);
        }
    }

    /**
     * 只暴露 host（含端口），**丢弃 path/query**：baseUrl 的 query 里可能带凭据风格的参数，
     * 后台页面不需要它，能不给就不给。
     */
    static String hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return null;
        }
        try {
            java.net.URI uri = java.net.URI.create(baseUrl.trim());
            if (uri.getHost() == null) {
                return null;
            }
            return uri.getPort() > 0 ? uri.getHost() + ":" + uri.getPort() : uri.getHost();
        } catch (IllegalArgumentException ex) {
            // 非法 URL 不回显原文（它可能含用户信息），只表示"无法解析"。
            return null;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static int positive(int candidate, int fallback) {
        return candidate > 0 ? candidate : fallback;
    }

    private static long positive(long candidate, long fallback) {
        return candidate > 0 ? candidate : fallback;
    }

    /**
     * 生效的 AI 设置。{@code apiKey} 是明文，**只允许**流到 AI 模块的 HTTP 客户端。
     *
     * <p>record 的默认 {@code toString()} 会把每个分量都打出来，包括 {@code apiKey} ——
     * 而 record 的 toString 最常见的去处就是日志。因此这里显式覆盖，把凭据替换成 {@code ***}。
     */
    public record EffectiveAiSettings(
            boolean enabled,
            String baseUrl,
            String apiKey,
            String apiKeySource,
            String apiKeyFingerprint,
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

        @Override
        public String toString() {
            return "EffectiveAiSettings[enabled=" + enabled + ", baseUrlHost=" + hostOf(baseUrl)
                    + ", apiKey=***, apiKeySource=" + apiKeySource + ", model=" + model
                    + ", mockMode=" + mockMode + "]";
        }
    }

    /** 后台写入请求见 {@link com.typeme.account.dto.AdminAiSettingsUpdateRequest}（null 字段 = 不改动）。 */
}
