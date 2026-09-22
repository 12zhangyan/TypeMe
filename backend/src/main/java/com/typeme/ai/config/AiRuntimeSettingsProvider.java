package com.typeme.ai.config;

import com.typeme.account.service.AiSettingsCacheInvalidator;
import com.typeme.ai.port.SecretCipher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AI 运行时设置的唯一入口：**数据库优先、文件/环境变量兜底**。
 *
 * <p>取值顺序（每条独立判断，不是整行回退）：
 * <ol>
 *   <li>{@code typeme_ai_setting}（固定 id='default'，由账号模块的 V6 建表）中**非 NULL** 的字段；</li>
 *   <li>{@code typeme.ai.*}（{@link AiProperties}，即 application.yml + 环境变量）；</li>
 *   <li>key 兜底：环境变量 {@code DEEPSEEK_API_KEY}（apiKeySource='env'）。</li>
 * </ol>
 *
 * <p><b>每次调用都重新读，但带 5–10 秒内存缓存</b>：这样管理员在后台改完配置**无需重启**即可生效
 * （最多 10 秒延迟），同时避免 worker 每轮扫描都打一次库。缓存的是"最后一次成功读到的设置"，
 * 读表失败不会清空缓存（否则数据库抖动会让 AI 突然不可用）。
 *
 * <p>表不存在 / 表里没有行 / 字段为 NULL 都**不是错误**：本模块的测试与首次部署都会遇到
 * "V6 还没跑"的状态，那时必须安静地回退到文件配置。因此这里捕获 {@link DataAccessException}
 * 并降级（首次降级打一次 WARN，之后 DEBUG，避免刷日志）。
 */
@Component
public class AiRuntimeSettingsProvider implements AiSettingsStore, AiSettingsCacheInvalidator {

    private static final Logger log = LoggerFactory.getLogger(AiRuntimeSettingsProvider.class);

    private static final String SELECT_SETTINGS = """
            SELECT enabled, base_url, api_key_encrypted, model, prompt_version,
                   daily_limit_per_user, retry_limit_per_hour,
                   global_daily_call_budget, global_daily_token_budget,
                   worker_concurrency, connect_timeout_ms, request_deadline_ms,
                   max_tokens, mock_mode
            FROM typeme_ai_setting WHERE id = 'default'
            """;

    /** 缓存有效期：管理员改配置后最多 10 秒生效，同时避免每次调用都打库。 */
    private static final Duration CACHE_TTL = Duration.ofSeconds(10);

    private final JdbcTemplate jdbcTemplate;
    private final AiProperties properties;
    private final ObjectProvider<SecretCipher> cipherProvider;

    private final AtomicBoolean tableMissingLogged = new AtomicBoolean(false);

    private volatile AiRuntimeSettings cached;
    private volatile Instant cachedAt = Instant.EPOCH;

    public AiRuntimeSettingsProvider(JdbcTemplate jdbcTemplate,
                                     AiProperties properties,
                                     ObjectProvider<SecretCipher> cipherProvider) {
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
        this.cipherProvider = cipherProvider;
    }

    /** 当前设置（带短缓存）。 */
    public AiRuntimeSettings settings() {
        AiRuntimeSettings snapshot = cached;
        if (snapshot != null && Duration.between(cachedAt, Instant.now()).compareTo(CACHE_TTL) < 0) {
            return snapshot;
        }
        synchronized (this) {
            snapshot = cached;
            if (snapshot != null && Duration.between(cachedAt, Instant.now()).compareTo(CACHE_TTL) < 0) {
                return snapshot;
            }
            AiRuntimeSettings loaded = loadFromDatabase();
            if (loaded == null) {
                loaded = fromProperties();
            }
            cached = loaded;
            cachedAt = Instant.now();
            return loaded;
        }
    }

    /**
     * 让下一次读取必须打库。
     *
     * <p>两个调用方：后台保存设置后由 {@link com.typeme.account.service.AiSettingsService}
     * 通过 {@link AiSettingsCacheInvalidator} 调用（否则"保存后立刻生成分析"会按上一版配置跑）；
     * 以及测试。**不做任何写入**，幂等、可重复调用。
     */
    @Override
    public void invalidate() {
        cachedAt = Instant.EPOCH;
    }

    /* ── 数据库优先 ─────────────────────────────────────────────────────── */

    private AiRuntimeSettings loadFromDatabase() {
        Map<String, Object> row;
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(SELECT_SETTINGS);
            row = rows.isEmpty() ? null : rows.get(0);
        } catch (DataAccessException ex) {
            // V6 还没跑（表不存在）或数据库暂时不可用：降级到文件配置，不算致命。
            if (tableMissingLogged.compareAndSet(false, true)) {
                log.warn("读取 typeme_ai_setting 失败，本次回退到 typeme.ai.* 文件/环境变量配置（原因：{}）。"
                        + "后续同样失败只记 DEBUG。", ex.getMostSpecificCause().getMessage());
            } else {
                log.debug("读取 typeme_ai_setting 再次失败，继续使用文件配置：{}", ex.getMessage());
            }
            return null;
        }
        if (row == null) {
            return null;
        }

        AiRuntimeSettings file = fromProperties();

        boolean enabled = bool(row.get("enabled"), file.enabled());
        String baseUrl = nonBlank(string(row.get("base_url")), file.baseUrl());
        String model = nonBlank(string(row.get("model")), file.model());
        String promptVersion = nonBlank(string(row.get("prompt_version")), file.promptVersion());
        int dailyLimit = positiveInt(row.get("daily_limit_per_user"), file.dailyLimitPerUser());
        int retryLimit = positiveInt(row.get("retry_limit_per_hour"), file.retryLimitPerHour());
        long callBudget = positiveLong(row.get("global_daily_call_budget"), file.globalDailyCallBudget());
        long tokenBudget = positiveLong(row.get("global_daily_token_budget"), file.globalDailyTokenBudget());
        int concurrency = positiveInt(row.get("worker_concurrency"), file.workerConcurrency());
        Duration connectTimeout = positiveMillis(row.get("connect_timeout_ms"), file.connectTimeout());
        Duration deadline = positiveMillis(row.get("request_deadline_ms"), file.requestDeadline());
        int maxTokens = positiveInt(row.get("max_tokens"), file.maxTokens());
        boolean mockMode = bool(row.get("mock_mode"), file.mockMode());

        // key：数据库密文优先（apiKeySource='db'），解不开或没有就回退环境变量（'env'）。
        String encrypted = string(row.get("api_key_encrypted"));
        String apiKey = null;
        AiRuntimeSettings.AiKeySource source = AiRuntimeSettings.AiKeySource.NONE;
        if (encrypted != null && !encrypted.isBlank()) {
            String decrypted = decrypt(encrypted);
            if (decrypted != null && !decrypted.isBlank()) {
                apiKey = decrypted.trim();
                source = AiRuntimeSettings.AiKeySource.DB;
            } else {
                log.warn("typeme_ai_setting 里的 api_key_encrypted 无法解密（缺少 SecretCipher 实现或密钥不匹配），"
                        + "本次回退到环境变量 DEEPSEEK_API_KEY。");
            }
        }
        if (apiKey == null) {
            String envKey = envApiKey();
            if (envKey != null) {
                apiKey = envKey;
                source = AiRuntimeSettings.AiKeySource.ENV;
            }
        }

        return new AiRuntimeSettings(enabled, baseUrl, model, apiKey, source, promptVersion, mockMode,
                dailyLimit, retryLimit, callBudget, tokenBudget, concurrency,
                connectTimeout, deadline, maxTokens, file.temperature(), file.leaseDuration());
    }

    private String decrypt(String cipherText) {
        SecretCipher cipher = cipherProvider.getIfAvailable();
        if (cipher == null) {
            return null;
        }
        try {
            return cipher.decrypt(cipherText);
        } catch (RuntimeException ex) {
            log.warn("SecretCipher({}) 解密后台 apiKey 失败：{}", cipher.providerName(), ex.getMessage());
            return null;
        }
    }

    /* ── 文件/环境变量兜底 ──────────────────────────────────────────────── */

    private AiRuntimeSettings fromProperties() {
        String envKey = envApiKey();
        String key = nonBlank(properties.getApiKey(), envKey);
        // 文件里的 api-key 本身就是 ${DEEPSEEK_API_KEY:}，所以两者等价时也记 env；无 key 记 none。
        AiRuntimeSettings.AiKeySource source = key == null
                ? AiRuntimeSettings.AiKeySource.NONE
                : AiRuntimeSettings.AiKeySource.ENV;
        return new AiRuntimeSettings(
                properties.isEnabled(),
                nonBlank(properties.getBaseUrl(), "https://api.deepseek.com"),
                nonBlank(properties.getModel(), "deepseek-flash"),
                key,
                source,
                nonBlank(properties.getPromptVersion(), "typeme-ai-prompt-v4"),
                properties.isMockMode(),
                properties.getDailyLimitPerUser(),
                properties.getRetryLimitPerHour(),
                properties.getGlobalDailyCallBudget(),
                properties.getGlobalDailyTokenBudget(),
                properties.getWorkerConcurrency(),
                properties.getConnectTimeout(),
                properties.getRequestDeadline(),
                properties.getMaxTokens(),
                properties.getTemperature(),
                properties.getLeaseDuration());
    }

    /**
     * 环境变量 key：主名 {@code DEEPSEEK_API_KEY}（契约 03 §1），兼容别名 {@code TYPEME_AI_API_KEY}。
     * 两者都读 System.getProperty 是为了让测试/本地脚本不必真的设置进程环境。
     */
    private String envApiKey() {
        String primary = firstNonBlank(System.getenv("DEEPSEEK_API_KEY"), System.getProperty("DEEPSEEK_API_KEY"));
        if (primary != null) {
            return primary;
        }
        return firstNonBlank(System.getenv("TYPEME_AI_API_KEY"), System.getProperty("TYPEME_AI_API_KEY"));
    }

    /** 启动后的自检日志：enabled=true 但 key 为空时打 WARN（创建接口会返回 503，不生成半成品任务）。 */
    public void logStartupDiagnostics() {
        AiRuntimeSettings s = settings();
        if (s.enabled() && !s.hasApiKey()) {
            log.warn("typeme.ai.enabled=true 但没有任何可用 apiKey（数据库未配置且 DEEPSEEK_API_KEY 为空）："
                    + "AI 创建接口将返回 503 AI_NOT_CONFIGURED。");
        } else {
            log.info("AI 设置已加载：enabled={}, model={}, apiKeySource={}, mockMode={}, baseUrl={}",
                    s.enabled(), s.model(), s.apiKeySource().wire(), s.mockMode(), s.baseUrl());
        }
    }

    /* ── AiSettingsStore（给 worker/controller 用的最小能力） ───────────── */

    /** 同意政策的版本：目前取自配置，未配置时用默认值（不阻塞创建）。 */
    @Override
    public String loadConsentPolicyVersion() {
        return "typeme-ai-consent-v1";
    }

    @Override
    public Duration loadLeaseDuration() {
        return settings().leaseDuration();
    }

    @Override
    public int loadWorkerBatchSize() {
        // 单轮认领量：并发上限与批量都从同一份设置快照取，避免出现"并发 2 却一次拉 50 条"的护栏失效。
        return Math.max(1, settings().workerConcurrency());
    }

    /* ── 小工具 ─────────────────────────────────────────────────────────── */

    private static String string(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text.trim();
    }

    private static String nonBlank(String candidate, String fallback) {
        return candidate == null || candidate.isBlank() ? fallback : candidate.trim();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first.trim();
        }
        if (second != null && !second.isBlank()) {
            return second.trim();
        }
        return null;
    }

    private static boolean bool(Object value, boolean fallback) {
        if (value == null) {
            return fallback;
        }
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof Number n) {
            return n.intValue() != 0;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    private static int positiveInt(Object value, int fallback) {
        Integer parsed = parseInt(value);
        return parsed == null || parsed <= 0 ? fallback : parsed;
    }

    private static long positiveLong(Object value, long fallback) {
        Long parsed = parseLong(value);
        return parsed == null || parsed <= 0 ? fallback : parsed;
    }

    private static Duration positiveMillis(Object value, Duration fallback) {
        Long parsed = parseLong(value);
        return parsed == null || parsed <= 0 ? fallback : Duration.ofMillis(parsed);
    }

    private static Integer parseInt(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number n) {
            return n.intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(value).trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static Long parseLong(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number n) {
            return n.longValue();
        }
        try {
            return Long.valueOf(String.valueOf(value).trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
