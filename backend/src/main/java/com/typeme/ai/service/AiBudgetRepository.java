package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * {@code ai_usage_budget} 的原子读写（契约 02 §5.3）。
 *
 * <p>核心是"**用一条 SQL 完成预留**"：先 INSERT，冲突就 +1，然后校验是否超限、超限再补偿回退。
 * 绝不能写成"先 SELECT 再 UPDATE"——两个并发请求会同时读到旧值，双双通过校验
 * （这正是额度类缺陷最常见的形态）。
 *
 * <p>方言处理：只用 "INSERT ... ON DUPLICATE KEY UPDATE ... +1" 一条 SQL ——
 * MySQL 8 与 H2 的 {@code MODE=MySQL} 都支持它，因此不必按数据库产品名分叉
 * （H2 的 {@code MERGE ... KEY} 是整行替换，会把累加变成覆盖，见 {@link #reserve}）。
 */
@Repository
public class AiBudgetRepository {

    /** scope_key 的两个形态：{@code user:<uuid>} 与 {@code global}（不用 nullable user_id）。 */
    public static final String GLOBAL_SCOPE = "global";

    private static final String COLUMNS =
            "(scope_key, budget_date, reserved_calls, actual_calls, actual_tokens, estimated_cost_micros, revision)";

    private final JdbcTemplate jdbcTemplate;
    private final AiClock clock;

    public AiBudgetRepository(JdbcTemplate jdbcTemplate, AiClock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    /** 额度按 **UTC 日期**分桶（契约 §5.3）。 */
    public LocalDate today() {
        return clock.nowUtc().toLocalDate();
    }

    /* ── 预留与补偿 ─────────────────────────────────────────────────────── */

    /**
     * 原子预留一次调用。
     *
     * <p>只用一条 "INSERT ... ON DUPLICATE KEY UPDATE ... +1"：MySQL 8 与 H2 的
     * {@code MODE=MySQL} **都**支持这个子句（H2 2.x 的 MySQL 兼容模式实现了它），
     * 所以不需要按方言写两套 SQL。
     *
     * <p>曾经用过 H2 的 {@code MERGE INTO ... KEY (...)}：那是**整行替换**，
     * 第二次预留会把 {@code reserved_calls} 覆盖回 1 而不是累加到 2 ——
     * 额度统计静默失真，比直接报错更危险。这条分支现在由
     * {@code AnalysisFlowTest#budgetIsReservedAtomicallyAndRolledBackOnReject} 与
     * {@code AiSqlDialectMySqlIT} 在 H2 和真实 MySQL 上双向钉住。
     *
     * @return 预留后的累计值（调用方据此校验是否超限）
     */
    public int reserve(String scopeKey, java.time.Instant at) {
        LocalDate date = AiClock.toUtc(at).toLocalDate();
        jdbcTemplate.update("INSERT INTO ai_usage_budget " + COLUMNS + " VALUES (?, ?, 1, 0, 0, 0, 1) "
                + "ON DUPLICATE KEY UPDATE reserved_calls = reserved_calls + 1, revision = revision + 1",
                scopeKey, date);
        return reservedCalls(scopeKey, date);
    }

    /** 超限补偿：同事务内回退预留，避免"校验失败却泄漏额度"。 */
    public void releaseReservation(String scopeKey, LocalDate date) {
        // 用 CASE 保证不会减到负数：并发场景下预留与回退的顺序无法完全预测，
        // 让 reserved_calls 变成负值会让后续所有校验永久失效。
        jdbcTemplate.update("""
                UPDATE ai_usage_budget
                   SET reserved_calls = CASE WHEN reserved_calls > 0 THEN reserved_calls - 1 ELSE 0 END,
                       revision = revision + 1
                 WHERE scope_key = ? AND budget_date = ?
                """, scopeKey, date);
    }

    /* ── 回填 ───────────────────────────────────────────────────────────── */

    /** 成功：用官方 usage 回填实际调用数、token 与估算费用。 */
    public void finishSuccess(String scopeKey, LocalDate date, long tokens, long costMicros) {
        jdbcTemplate.update("""
                UPDATE ai_usage_budget
                   SET actual_calls = actual_calls + 1,
                       actual_tokens = actual_tokens + ?,
                       estimated_cost_micros = estimated_cost_micros + ?,
                       revision = revision + 1
                 WHERE scope_key = ? AND budget_date = ?
                """, tokens, costMicros, scopeKey, date);
    }

    /* ── 读取 ───────────────────────────────────────────────────────────── */

    public int reservedCalls(String scopeKey, LocalDate date) {
        Integer value = jdbcTemplate.queryForObject(
                "SELECT reserved_calls FROM ai_usage_budget WHERE scope_key = ? AND budget_date = ?",
                Integer.class, scopeKey, date);
        return value == null ? 0 : value;
    }

    /** 实际已消耗的 token（用于全局 token 预算判定）。 */
    public long actualTokens(String scopeKey, LocalDate date) {
        Long value = jdbcTemplate.queryForObject(
                "SELECT actual_tokens FROM ai_usage_budget WHERE scope_key = ? AND budget_date = ?",
                Long.class, scopeKey, date);
        return value == null ? 0L : value;
    }

    /** 供 worker 计算"预留日期"用：与 reserve 用同一个时钟来源。 */
    LocalDateTime nowUtc() {
        return clock.nowUtc();
    }
}
