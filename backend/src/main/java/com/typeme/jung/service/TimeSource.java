package com.typeme.jung.service;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

/**
 * 时间与 ID 的唯一来源。
 *
 * <p>数据库里**全部时间以 UTC 存储**（`DATETIME(6)`）。把这些转换集中在这里，
 * 是为了避免某个 repository 顺手用了 `LocalDateTime.now()`（服务器本地时区），
 * 造成同一份报告在不同部署机器上的时间不一致 —— 这类缺陷在开发机上永远看不出来。
 */
@Component
public class TimeSource {

    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_INSTANT;

    private final JdbcTemplate jdbcTemplate;

    public TimeSource(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    /** 当前 UTC 时刻（可注入时钟的替代：测试用 {@link #withFixed} 构造固定时间源）。 */
    public Instant now() {
        return Instant.now();
    }

    public LocalDateTime nowUtc() {
        return LocalDateTime.ofInstant(now(), ZoneOffset.UTC);
    }

    /**
     * 固定时刻的时间源（测试用）。
     *
     * <p>刻意**不提供**「读数据库时钟」的方法：那会引入 `UTC_TIMESTAMP()` 这类 MySQL 专有函数，
     * 让 H2 集成测试跑不通，也会让应用时钟与数据库时钟漂移变成隐藏依赖。
     * 应用层是唯一时间来源，部署时保证 NTP 同步即可。
     */
    public static TimeSource withFixed(Instant instant) {
        return new TimeSource(null) {
            @Override
            public Instant now() {
                return instant;
            }
        };
    }

    public static LocalDateTime toUtc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    public static Instant toInstant(LocalDateTime utc) {
        return utc.toInstant(ZoneOffset.UTC);
    }

    public static String iso(Instant instant) {
        return instant == null ? null : ISO.format(instant);
    }

    public static String isoFromUtc(LocalDateTime utc) {
        return utc == null ? null : ISO.format(toInstant(utc));
    }
}
