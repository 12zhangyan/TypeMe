package com.typeme.jung.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * {@link TimeSource#utcFromJdbc(Object)} 的回归。
 *
 * <p>它存在的唯一理由是 2026-09-17 用内存 H2 起真实后端时抓到的
 * <b>{@code GET /api/v3/attempts/{id}} 500</b>：
 * {@code JdbcTemplate.queryForList(...)} 的 {@code ColumnMapRowMapper} 调的是
 * {@code ResultSet.getObject(name)}，返回类型由驱动决定（H2 2.x 给
 * {@link Timestamp}，Connector/J 给 {@link LocalDateTime}），
 * 于是 `(LocalDateTime) row.get("started_at")` 在 MySQL 上通过、在 H2 上抛
 * {@code ClassCastException}。
 *
 * <p>所以这里**必须真的用 {@link Timestamp}** 断言，而不是只测 LocalDateTime 那条
 * 无痛路径 —— 后者正是让缺陷漏到运行期的原因。
 */
class TimeSourceJdbcConversionTest {

    @Test
    @DisplayName("H2 返回的 java.sql.Timestamp 能换成 UTC LocalDateTime（原缺陷路径）")
    void acceptsSqlTimestamp() {
        LocalDateTime utc = LocalDateTime.of(2026, 9, 17, 8, 30, 15, 123_456_000);
        Timestamp fromDriver = Timestamp.valueOf(utc);

        assertThat(TimeSource.utcFromJdbc(fromDriver)).isEqualTo(utc);
        assertThat(TimeSource.isoFromUtc(TimeSource.utcFromJdbc(fromDriver)))
                .isEqualTo("2026-09-17T08:30:15.123456Z");
    }

    @Test
    @DisplayName("Connector/J 返回的 LocalDateTime 原样通过")
    void acceptsLocalDateTime() {
        LocalDateTime utc = LocalDateTime.of(2026, 9, 17, 8, 30, 15);
        assertThat(TimeSource.utcFromJdbc(utc)).isEqualTo(utc);
    }

    @Test
    @DisplayName("null 仍是 null（submitted_at 本来就可为空）")
    void nullStaysNull() {
        assertThat(TimeSource.utcFromJdbc(null)).isNull();
        assertThat(TimeSource.isoFromUtc(TimeSource.utcFromJdbc(null))).isNull();
    }

    @Test
    @DisplayName("带偏移的时间值按同一时刻换算到 UTC，而不是丢掉偏移")
    void offsetDateTimeIsConvertedNotTruncated() {
        OffsetDateTime withOffset = OffsetDateTime.of(2026, 9, 17, 16, 30, 0, 0, ZoneOffset.ofHours(8));
        assertThat(TimeSource.utcFromJdbc(withOffset))
                .as("东八区 16:30 就是 UTC 08:30 —— 直接丢偏移会算错 8 小时")
                .isEqualTo(LocalDateTime.of(2026, 9, 17, 8, 30));
        assertThat(TimeSource.toInstant(TimeSource.utcFromJdbc(withOffset)))
                .isEqualTo(Instant.parse("2026-09-17T08:30:00Z"));
    }

    @Test
    @DisplayName("无法无歧义换算的类型直接抛，不猜")
    void rejectsUnknownTypes() {
        assertThatThrownBy(() -> TimeSource.utcFromJdbc("2026-09-17T08:30:00Z"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("无法把 JDBC 时间值换算成 UTC LocalDateTime");
    }
}
