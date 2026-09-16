package com.typeme.ai.testsupport;

import com.typeme.ai.config.AiClock;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

/**
 * 可推进的测试时钟。
 *
 * <p>为什么需要它（而不是直接用系统时钟 + {@code Thread.sleep}）：
 * lease 是否过期、429 的 Retry-After 是否到点、每小时重试窗口是否滑出，
 * 全都依赖"现在几点"。用 sleep 驱动的测试既慢又 flaky；把时钟握在手里才能真正确定性复现。
 */
public class MutableAiClock extends AiClock {

    private final Instant base;
    private volatile Instant current;

    public MutableAiClock(Instant base) {
        super(Clock.fixed(base, ZoneOffset.UTC));
        this.base = base;
        this.current = base;
    }

    @Override
    public Instant now() {
        return current;
    }

    public void advance(Duration duration) {
        current = current.plus(duration);
    }

    public void reset() {
        current = base;
    }

    public Instant base() {
        return base;
    }
}
