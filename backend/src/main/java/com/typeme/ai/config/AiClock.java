package com.typeme.ai.config;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

/**
 * AI 模块的**唯一时间来源**（"可注入的 Clock"，契约要求：不要到处散落 {@code Instant.now()}）。
 *
 * <p>理由不只是"测试方便"：
 * <ul>
 *   <li>lease 到期、Retry-After 退避、每小时重试窗口都依赖"现在几点"，散落的 now() 会让
 *       这些判定在测试里变成不可复现的 flaky；</li>
 *   <li>数据库里全部时间以 UTC 存 {@code DATETIME(6)}，换算只应该在一处发生。</li>
 * </ul>
 */
@Component
public class AiClock {

    private final Clock clock;

    public AiClock() {
        this(Clock.systemUTC());
    }

    public AiClock(Clock clock) {
        this.clock = clock;
    }

    /** 便于测试固定/推进时间。 */
    public static AiClock fixedAt(Instant instant) {
        return new AiClock(Clock.fixed(instant, ZoneOffset.UTC));
    }

    public Instant now() {
        return clock.instant();
    }

    public LocalDateTime nowUtc() {
        return LocalDateTime.ofInstant(now(), ZoneOffset.UTC);
    }

    public Instant plus(Duration duration) {
        return now().plus(duration);
    }

    public static LocalDateTime toUtc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    public static Instant toInstant(LocalDateTime utc) {
        return utc.toInstant(ZoneOffset.UTC);
    }
}
