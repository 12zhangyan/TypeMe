package com.typeme.jung.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 定期清掉过期的 {@code api_idempotency} 记录（容量治理）。
 *
 * <p>这张表每来一次"建测评 / 交卷 / 建分析"就多一行，TTL 24 小时；在它之前，
 * 只有**账号注销**会删（按用户删全部）。也就是说：一个从不注销的活跃账号会让这些行
 * 一直留着，`idx_idempotency_expires` 这个索引建了却没有消费者。
 *
 * <p>为什么不在这次清理里顺手删别的表：注销清理（{@code AccountDataDeletionService}）
 * 已经有完整的分步与失败可观测性，两处都删同一批表迟早会不一致。
 * 这里只负责"过期",不负责"某人要求删掉"。
 */
@Component
public class IdempotencyCleanupJob {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyCleanupJob.class);

    /** 每次最多删多少行：避免一轮里长时间持锁，剩下的下一轮继续。 */
    private static final int BATCH_SIZE = 500;

    private final IdempotencyGuard guard;
    private final TimeSource time;

    public IdempotencyCleanupJob(IdempotencyGuard guard, TimeSource time) {
        this.guard = guard;
        this.time = time;
    }

    /**
     * 调度入口。
     *
     * <p>{@code fixedDelay} 而不是 {@code fixedRate}：清理耗时不可预测，
     * fixedRate 会在上一轮还没结束时叠加调度。
     *
     * <p><b>取值必须写成 ISO-8601（PT1H）或纯毫秒数字</b>：{@code @Scheduled} 的
     * {@code String} 形式只认这两种，写 {@code "1h"} 会让**整个应用起不来**
     * （同一个坑在注销 worker 上踩过，见 {@code AccountDeletionService} 的注释）。
     */
    @Scheduled(fixedDelayString = "${typeme.idempotency.cleanup-interval:PT1H}",
            initialDelayString = "${typeme.idempotency.cleanup-initial-delay:PT10M}")
    public void runCleanup() {
        try {
            int deleted = guard.deleteExpired(time.nowUtc(), BATCH_SIZE);
            if (deleted > 0) {
                log.info("清理过期幂等记录 deleted={}", deleted);
            }
        } catch (RuntimeException ex) {
            // 定时任务抛异常会让调度器把它标记为失败并可能停掉后续调度；
            // 这里只记日志：一次清理失败不影响任何用户请求，下一轮会再试。
            log.warn("清理过期幂等记录失败（下一轮重试）：{}", ex.getMessage());
        }
    }
}
