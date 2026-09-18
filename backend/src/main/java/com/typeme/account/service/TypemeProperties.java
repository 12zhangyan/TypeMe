package com.typeme.account.service;

import com.typeme.common.ApiException;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * {@code typeme.*} 的配置绑定（application.yml 的注释解释了每个值的取向）。
 *
 * <p>用不可变 record + 紧凑构造器补默认值：配置缺项时给**安全的一侧**兜底
 * （例如限流窗口缺了就按最严格的来），而不是给 {@code null} 让下游 NPE。
 */
@ConfigurationProperties(prefix = "typeme")
public record TypemeProperties(
        Auth auth,
        RateLimit ratelimit,
        Security security,
        Admin admin,
        Ai ai
) {

    public TypemeProperties {
        auth = auth == null ? Auth.defaults() : auth;
        ratelimit = ratelimit == null ? RateLimit.defaults() : ratelimit;
        security = security == null ? Security.defaults() : security;
        admin = admin == null ? Admin.defaults() : admin;
        ai = ai == null ? Ai.defaults() : ai;
    }

    /** 账号与会话。 */
    public record Auth(
            Duration sessionAbsoluteTtl,
            Duration sessionLastSeenThrottle,
            boolean cookieSecure,
            String cookieSameSite,
            String passwordEncoder,
            int pbkdf2Iterations,
            boolean disclaimerRequired
    ) {
        public Auth {
            sessionAbsoluteTtl = sessionAbsoluteTtl == null ? Duration.ofDays(7) : sessionAbsoluteTtl;
            sessionLastSeenThrottle = sessionLastSeenThrottle == null ? Duration.ofSeconds(60) : sessionLastSeenThrottle;
            cookieSameSite = cookieSameSite == null || cookieSameSite.isBlank() ? "Lax" : cookieSameSite;
            passwordEncoder = passwordEncoder == null || passwordEncoder.isBlank() ? "pbkdf2" : passwordEncoder;
            // 这里只做"不能是 0 或负数"的兜底（0 次迭代等于不加密）；真正的强度下限由
            // AccountModuleConfiguration 在启动期显式检查，避免把安全策略藏在一个 record 里。
            pbkdf2Iterations = pbkdf2Iterations <= 0 ? 210_000 : pbkdf2Iterations;
        }

        static Auth defaults() {
            return new Auth(Duration.ofDays(7), Duration.ofSeconds(60), false, "Lax", "pbkdf2", 210_000, true);
        }
    }

    /** 限流：每个操作一个窗口与上限。 */
    public record RateLimit(boolean enabled, Window register, Login login, Window recover, Login ai) {
        public RateLimit {
            register = register == null ? new Window(Duration.ofHours(1), 5, 0) : register;
            login = login == null ? new Login(Duration.ofMinutes(15), 20, 10) : login;
            recover = recover == null ? new Window(Duration.ofHours(1), 10, 0) : recover;
            ai = ai == null ? new Login(Duration.ofHours(1), 30, 20) : ai;
        }

        static RateLimit defaults() {
            return new RateLimit(true,
                    new Window(Duration.ofHours(1), 5, 0),
                    new Login(Duration.ofMinutes(15), 20, 10),
                    new Window(Duration.ofHours(1), 10, 0),
                    new Login(Duration.ofHours(1), 30, 20));
        }
    }

    /** 只有 ip 维度的窗口。 */
    public record Window(Duration window, int ipLimit, int userLimit) {
        public Window {
            window = window == null || window.isZero() || window.isNegative() ? Duration.ofHours(1) : window;
            ipLimit = ipLimit <= 0 ? 5 : ipLimit;
            userLimit = userLimit < 0 ? 0 : userLimit;
        }
    }

    /** 同时有 ip 与 user 两个维度的窗口（登录与 AI 创建）。 */
    public record Login(Duration window, int ipLimit, int userLimit) {
        public Login {
            window = window == null || window.isZero() || window.isNegative() ? Duration.ofMinutes(15) : window;
            ipLimit = ipLimit <= 0 ? 20 : ipLimit;
            userLimit = userLimit <= 0 ? 10 : userLimit;
        }
    }

    /** 安全相关的杂项。 */
    public record Security(String trustedProxies, String settingsSecret) {
        public Security {
            trustedProxies = trustedProxies == null ? "" : trustedProxies.trim();
            settingsSecret = settingsSecret == null ? "" : settingsSecret;
        }

        static Security defaults() {
            return new Security("", "");
        }

        /** 逗号分隔的代理地址列表；空列表表示"不信任任何转发头"。 */
        public java.util.List<String> trustedProxyList() {
            if (trustedProxies.isBlank()) {
                return java.util.List.of();
            }
            return java.util.Arrays.stream(trustedProxies.split(","))
                    .map(String::trim)
                    .filter(value -> !value.isEmpty())
                    .toList();
        }

        /** 加密密钥是否可用：不可用时禁止写入 apiKey，但读取设置照常。 */
        public boolean settingsSecretConfigured() {
            return settingsSecret.length() >= 16;
        }

        /** 取加密密钥；未配置时抛 503 而不是回退到硬编码密钥。 */
        public String requireSettingsSecret() {
            if (!settingsSecretConfigured()) {
                throw ApiException.notConfigured(
                        "后台 AI 设置缺少加密密钥（typeme.security.settings-secret / TYPEME_SETTINGS_SECRET），"
                                + "无法安全保存 apiKey。");
            }
            return settingsSecret;
        }
    }

    /** 管理员引导。 */
    public record Admin(String bootstrapUsername, String bootstrapPassword) {
        public Admin {
            bootstrapUsername = bootstrapUsername == null ? "typeme_admin" : bootstrapUsername.trim();
            bootstrapPassword = bootstrapPassword == null ? "" : bootstrapPassword;
        }

        @Override public String toString() { return "Admin[credentials=redacted]"; }

        static Admin defaults() {
            return new Admin("typeme_admin", "");
        }
    }

    /**
     * AI 侧配置的**环境变量兜底**。数据库（typeme_ai_setting）有值时数据库优先，
     * 只有 DB 里为空/null 的字段才回落到这里（见 AiSettingsService）。
     */
    public record Ai(
            boolean enabled,
            String baseUrl,
            String apiKey,
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
            boolean mockMode
    ) {
        public Ai {
            baseUrl = baseUrl == null ? "" : baseUrl.trim();
            apiKey = apiKey == null ? "" : apiKey.trim();
            model = model == null || model.isBlank() ? "deepseek-chat" : model;
            promptVersion = promptVersion == null || promptVersion.isBlank() ? "typeme-ai-prompt-v3" : promptVersion;
            dailyLimitPerUser = dailyLimitPerUser <= 0 ? 10 : dailyLimitPerUser;
            retryLimitPerHour = retryLimitPerHour <= 0 ? 5 : retryLimitPerHour;
            globalDailyCallBudget = globalDailyCallBudget <= 0 ? 500 : globalDailyCallBudget;
            globalDailyTokenBudget = globalDailyTokenBudget <= 0 ? 2_000_000L : globalDailyTokenBudget;
            workerConcurrency = workerConcurrency <= 0 ? 4 : workerConcurrency;
            connectTimeoutMs = connectTimeoutMs <= 0 ? 5_000 : connectTimeoutMs;
            requestDeadlineMs = requestDeadlineMs <= 0 ? 60_000 : requestDeadlineMs;
            maxTokens = maxTokens <= 0 ? 2_000 : maxTokens;
        }

        static Ai defaults() {
            return new Ai(false, "", "", "deepseek-chat", "typeme-ai-prompt-v3",
                    10, 5, 500, 2_000_000L, 4, 5_000, 60_000, 2_000, false);
        }
    }
}
