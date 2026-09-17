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

    /**
     * 把 JDBC 取回来的时间值统一成 UTC 的 {@link LocalDateTime}。
     *
     * <p><b>为什么必须有它</b>（2026-09-17 用内存 H2 起真实后端时抓到）：
     * {@code JdbcTemplate.queryForList(...)} 走的是 {@code ColumnMapRowMapper}，
     * 它对 {@code DATETIME}/{@code TIMESTAMP} 列调的是 {@code ResultSet.getObject(name)}，
     * 返回什么类型**由驱动决定**：
     * <ul>
     *   <li>H2 2.x 返回 {@link java.sql.Timestamp}；</li>
     *   <li>Connector/J 8 的默认时区行为下 {@code DATETIME} 返回 {@link LocalDateTime}。</li>
     * </ul>
     * 于是 {@code (LocalDateTime) row.get("started_at")} 这类写法在 MySQL 上跑得通、
     * 在 H2 上抛 {@code ClassCastException: java.sql.Timestamp cannot be cast to
     * java.time.LocalDateTime}。表现是 **{@code GET /api/v3/attempts/{id}} 直接 500**，
     * 也就是"注册能成功、一进答题页就全黑"——而当时的自动化测试全绿，因为它们
     * 要么用 RowMapper（{@code rs.getObject(name, LocalDateTime.class)}），
     * 要么整类只在真 MySQL 上跑。
     *
     * <p>只接受能**无歧义**换算的三种类型；其它类型直接抛，不做"尽力而为"的猜测 ——
     * 静默返回错误时间比抛异常更难查。
     */
    public static LocalDateTime utcFromJdbc(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof LocalDateTime local) {
            return local;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toLocalDateTime();
        }
        if (value instanceof java.time.OffsetDateTime offset) {
            return LocalDateTime.ofInstant(offset.toInstant(), ZoneOffset.UTC);
        }
        throw new IllegalArgumentException(
                "无法把 JDBC 时间值换算成 UTC LocalDateTime：类型 " + value.getClass().getName());
    }

    public static String iso(Instant instant) {
        return instant == null ? null : ISO.format(instant);
    }

    public static String isoFromUtc(LocalDateTime utc) {
        return utc == null ? null : ISO.format(toInstant(utc));
    }
}
