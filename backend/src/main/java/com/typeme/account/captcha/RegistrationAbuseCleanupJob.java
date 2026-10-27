package com.typeme.account.captcha;

import com.typeme.security.RateLimitService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;

/**
 * 定期清理注册防刷产生的过期数据：已使用的验证码令牌，以及早已过期的限流桶。
 *
 * <p>限流桶此前没有任何清理（每个 IP 每个窗口一行，只增不减）；验证码方案会让它增长更快，
 * 所以在这里一并清理。
 */
@Component
public class RegistrationAbuseCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(RegistrationAbuseCleanupJob.class);

    private static final int BATCH_SIZE = 500;

    /**
     * 限流桶的保留期。所有窗口当前最长 1 小时；取 24 小时留足余量。
     * 若有人把某个窗口配到超过 24 小时，仍在计数的桶会被提前删掉（计数重新开始），
     * 配置那样长的窗口时需要同步调大这里。
     */
    private static final Duration BUCKET_RETENTION = Duration.ofHours(24);

    private final CaptchaNonceStore nonces;
    private final RateLimitService rateLimit;

    public RegistrationAbuseCleanupJob(CaptchaNonceStore nonces, RateLimitService rateLimit) {
        this.nonces = nonces;
        this.rateLimit = rateLimit;
    }

    /**
     * 取值必须写成 ISO-8601（PT1H）或纯毫秒数字：{@code @Scheduled} 的字符串形式不认 "1h"，
     * 写错会让整个应用起不来（同一个坑在注销 worker 上踩过）。
     */
    @Scheduled(fixedDelayString = "${typeme.registration.cleanup-interval:PT1H}",
            initialDelayString = "${typeme.registration.cleanup-initial-delay:PT10M}")
    public void runCleanup() {
        try {
            runOnce(Instant.now());
        } catch (RuntimeException ex) {
            // 清理失败不影响任何用户请求，下一轮会再试。
            log.warn("清理注册防刷过期数据失败（下一轮重试）：{}", ex.getMessage());
        }
    }

    /** 供测试直接驱动，不依赖调度时机。 */
    int runOnce(Instant now) {
        int tokens = nonces.deleteExpired(now, BATCH_SIZE);
        int buckets = rateLimit.deleteStaleBuckets(now.minus(BUCKET_RETENTION), BATCH_SIZE);
        if (tokens + buckets > 0) {
            log.info("清理注册防刷过期数据 tokens={} buckets={}", tokens, buckets);
        }
        return tokens + buckets;
    }
}
