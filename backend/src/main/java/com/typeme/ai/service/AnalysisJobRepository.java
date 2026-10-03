package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * {@code ai_analysis_job} 的读写（契约 02 §5.1）。
 *
 * <p>为什么把 SQL 集中在这里：这个模块的竞态全在状态迁移上（认领、lease 恢复、写回、重试），
 * 把"哪些行会被更新"钉在一个文件里，才能一眼看出并发语义，而不是散在 service 里靠读代码推断。
 *
 * <p>几个刻意的选择：
 * <ul>
 *   <li>{@code lease_owner} 标识一次执行，每次认领均换新；写回必须携带原认领标识，
 *       防止过期执行覆盖同一任务的新一轮重试。</li>
 *   <li>所有时间戳由 {@link AiClock} 产生（UTC {@code LocalDateTime}），SQL 里不出现 {@code NOW()}：
 *       MySQL 与 H2 的 NOW() 语义不同，而测试必须能推进时间。</li>
 * </ul>
 */
@Repository
public class AnalysisJobRepository {

    /** 写回结果用的列顺序（与 {@link #insert} 的 VALUES 一一对应，改一处必须改另一处）。 */
    private static final String COLUMNS = """
            id, user_id, report_id, idempotency_key, request_hash, prompt_version, topic,
            model_requested, model_returned, status, attempt_count, lease_until, lease_owner, next_run_at,
            requested_at, response_json, usage_json, error_code, created_at, finished_at
            """;

    private static final int COLUMN_COUNT = 20;

    private final JdbcTemplate jdbcTemplate;
    private final AiClock clock;

    public AnalysisJobRepository(JdbcTemplate jdbcTemplate, AiClock clock) {
        this.jdbcTemplate = jdbcTemplate;
        this.clock = clock;
    }

    /**
     * 任务行。
     *
     * @param status        QUEUED/RUNNING/SUCCEEDED/FAILED/UNKNOWN/CANCELLED
     * @param requestedAt   发出上游请求**之前**写入；用于 lease 恢复时区分"从未发出"与"已发出结果未知"
     */
    public record JobRow(
            String id,
            String userId,
            String reportId,
            String idempotencyKey,
            String requestHash,
            String promptVersion,
            String topic,
            String modelRequested,
            String modelReturned,
            String status,
            int attemptCount,
            LocalDateTime leaseUntil,
            String leaseOwner,
            LocalDateTime nextRunAt,
            LocalDateTime requestedAt,
            String responseJson,
            String usageJson,
            String errorCode,
            LocalDateTime createdAt,
            LocalDateTime finishedAt) {

        public boolean succeeded() {
            return "SUCCEEDED".equals(status);
        }

        public boolean terminal() {
            return "SUCCEEDED".equals(status) || "FAILED".equals(status)
                    || "UNKNOWN".equals(status) || "CANCELLED".equals(status);
        }
    }

    /* ── 插入 / 查找 ────────────────────────────────────────────────────── */

    /** 插入新任务（状态由调用方给出；创建路径固定为 QUEUED）。 */
    public void insert(JobRow job) {
        jdbcTemplate.update("""
                INSERT INTO ai_analysis_job (""" + COLUMNS + """
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                job.id(), job.userId(), job.reportId(), job.idempotencyKey(), job.requestHash(),
                job.promptVersion(), job.topic(), job.modelRequested(), job.modelReturned(), job.status(),
                job.attemptCount(), ts(job.leaseUntil()), job.leaseOwner(), ts(job.nextRunAt()),
                ts(job.requestedAt()), job.responseJson(), job.usageJson(), job.errorCode(),
                ts(job.createdAt()), ts(job.finishedAt()));
    }

    public Optional<JobRow> findById(String jobId) {
        List<JobRow> rows = jdbcTemplate.query("SELECT " + COLUMNS + " FROM ai_analysis_job WHERE id = ?",
                AnalysisJobRepository::map, jobId);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * 落用户近况（V7 新增列；创建事务内写入，worker 执行时读回）。
     *
     * <p>为什么单独一条 UPDATE 而不是塞进 {@code insert}：note 是**输入材料**，
     * 不是任务状态机的组成部分；把它排除在 {@link JobRow} 之外，
     * 状态机相关代码就不必永远拖着一个 320 字符的字段走。
     */
    public void saveUserNote(String jobId, String normalizedNote) {
        String note = normalizedNote == null || normalizedNote.isBlank() ? null : normalizedNote;
        jdbcTemplate.update("UPDATE ai_analysis_job SET user_note = ? WHERE id = ?", note, jobId);
    }

    /** 读用户近况；没有（V7 之前创建的行，或用户没写）返回 null。 */
    public String findUserNote(String jobId) {
        List<String> notes = jdbcTemplate.queryForList(
                "SELECT user_note FROM ai_analysis_job WHERE id = ?", String.class, jobId);
        return notes.isEmpty() ? null : notes.get(0);
    }

    /** 幂等键命中：{@code uk_ai_job_idem} 保证同用户同 key 最多一行。 */
    public Optional<JobRow> findByIdempotencyKey(String userId, String idempotencyKey) {
        List<JobRow> rows = jdbcTemplate.query(
                "SELECT " + COLUMNS + " FROM ai_analysis_job WHERE user_id = ? AND idempotency_key = ?",
                AnalysisJobRepository::map, userId, idempotencyKey);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /** 去重键命中：{@code uk_ai_job_request} 保证同用户同输入最多一行。 */
    public Optional<JobRow> findByRequestHash(String userId, String requestHash) {
        List<JobRow> rows = jdbcTemplate.query(
                "SELECT " + COLUMNS + " FROM ai_analysis_job WHERE user_id = ? AND request_hash = ?",
                AnalysisJobRepository::map, userId, requestHash);
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    public List<JobRow> listByReport(String userId, String reportId) {
        // 按创建时间倒序；同一毫秒时用 id 兜底，保证分页/展示顺序稳定。
        return jdbcTemplate.query("SELECT " + COLUMNS
                        + " FROM ai_analysis_job WHERE user_id = ? AND report_id = ?"
                        + " ORDER BY created_at DESC, id DESC",
                AnalysisJobRepository::map, userId, reportId);
    }

    /* ── 状态迁移（全部是"带条件的 UPDATE"，受影响行数决定成败） ───────── */

    /**
     * 原子认领：只有 {@code status='QUEUED'} 才能被抢到，受影响行数必须为 1。
     *
     * <p>{@code attempt_count} 在这里就 +1：它统计的是"真正开始执行"的次数，而不是"被创建"的次数。
     */
    public boolean claim(String jobId, String leaseOwner, Instant leaseUntil) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'RUNNING', lease_owner = ?, lease_until = ?, attempt_count = attempt_count + 1,
                       requested_at = NULL
                 WHERE id = ? AND status = 'QUEUED'
                """, leaseOwner, ts(AiClock.toUtc(leaseUntil)), jobId);
        return updated == 1;
    }

    /** 发出上游请求**之前**写 requested_at：此后任何崩溃都必须按"结果未知"处理。 */
    public boolean markRequested(String jobId, String executionOwner, Instant requestedAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job SET requested_at = ?
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ? AND lease_until > ?
                """, ts(AiClock.toUtc(requestedAt)), jobId, executionOwner, ts(AiClock.toUtc(requestedAt)));
        return updated == 1;
    }

    /** 写回成功结果：状态与执行标识同时匹配，避免旧执行覆盖新一轮重试。 */
    public boolean markSucceeded(String jobId, String executionOwner, String responseJson, String usageJson,
                                String modelReturned, Instant finishedAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'SUCCEEDED', response_json = ?, usage_json = ?, model_returned = ?,
                       error_code = NULL, finished_at = ?, lease_owner = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
                """, responseJson, usageJson, modelReturned, ts(AiClock.toUtc(finishedAt)), jobId, executionOwner);
        return updated == 1;
    }

    /** 写回明确失败（含校验失败）：这些错误不自动重试，用户可主动重试。 */
    public boolean markFailed(String jobId, String executionOwner, String errorCode, String message, Instant finishedAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'FAILED', error_code = ?, usage_json = ?, finished_at = ?,
                       lease_owner = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
                """, errorCode, message, ts(AiClock.toUtc(finishedAt)), jobId, executionOwner);
        return updated == 1;
    }

    /** 执行状态未知（超时/断流/5xx）：保留 requested_at 与预算预留，绝不自动重发。 */
    public boolean markUnknown(String jobId, String executionOwner, String errorCode, String message, Instant finishedAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'UNKNOWN', error_code = ?, usage_json = ?, finished_at = ?,
                       lease_owner = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
                """, errorCode, message, ts(AiClock.toUtc(finishedAt)), jobId, executionOwner);
        return updated == 1;
    }

    /** 报告/账号已不存在：晚到结果必须被丢弃（不重建已删数据）。 */
    public boolean markCancelled(String jobId, String executionOwner, String reason, Instant finishedAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'CANCELLED', error_code = COALESCE(error_code, ?), finished_at = ?,
                       lease_owner = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
                """, reason, ts(AiClock.toUtc(finishedAt)), jobId, executionOwner);
        return updated == 1;
    }

    /**
     * 用户主动重试或重新生成：**复用同一行**，允许从 FAILED / UNKNOWN / SUCCEEDED 出发。
     *
     * <p>条件里带这些终态是做"原子去重"：两个窗口同时点时，只有第一个 UPDATE 会命中。
     * {@code SUCCEEDED} 必须包含在内：同一份发送范围只能有一行任务，再生成只能重新入队。
     */
    public boolean requeueForRetry(String jobId, Instant now) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'QUEUED', next_run_at = ?, lease_owner = NULL, lease_until = NULL,
                       error_code = NULL, finished_at = NULL
                 WHERE id = ? AND status IN ('FAILED', 'UNKNOWN', 'SUCCEEDED')
                """, ts(AiClock.toUtc(now)), jobId);
        return updated == 1;
    }

    /**
     * 429 自动重试的重新入队：从 **RUNNING** 回到 QUEUED，并写入退避时刻与"已自动重试过"的标记。
     *
     * <p>为什么不能复用 {@link #requeueForRetry}：那条只认 FAILED/UNKNOWN，而 429 发生在执行中，
     * 此时状态还是 RUNNING —— 用它必然受影响行数为 0，于是"自动重试一次"永远不会发生
     * （任务会一直挂到 lease 过期才被判 UNKNOWN）。这是必须由测试钉住的分支。
     *
     * <p>{@code attempt_count} 不在这里 +1：它已经由 {@link #claim} 记过这一次尝试，
     * 重试执行时再 claim 会自己 +1。
     *
     * <p>{@code error_code} 被用作标记位（V4 已外发，不加列）：值为 {@code UPSTREAM_429} 表示
     * "这一行已经用过自动重试"，下一次 429 直接判失败。
     */
    public boolean requeueRunningAfterBackoff(String jobId, String executionOwner, String marker, Instant nextRunAt) {
        int updated = jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'QUEUED', next_run_at = ?, error_code = ?, finished_at = NULL,
                       lease_owner = NULL, lease_until = NULL
                 WHERE id = ? AND status = 'RUNNING' AND lease_owner = ?
                """, ts(AiClock.toUtc(nextRunAt)), marker, jobId, executionOwner);
        return updated == 1;
    }

    /* ── worker 扫描与 lease 恢复 ──────────────────────────────────────── */

    /** 待办：按创建时间升序，保证先来先做，避免老任务被新任务挤到永远排不上。 */
    public List<JobRow> findQueued(Instant now, int limit) {
        return jdbcTemplate.query("SELECT " + COLUMNS + """
                        FROM ai_analysis_job
                        WHERE status = 'QUEUED' AND (next_run_at IS NULL OR next_run_at <= ?)
                        ORDER BY created_at ASC, id ASC
                        LIMIT ?
                        """,
                AnalysisJobRepository::map, ts(AiClock.toUtc(now)), Math.max(1, limit));
    }

    /**
     * 统计"当前在途"（RUNNING 且 lease 未过期）的任务数。
     *
     * <p>并发上限靠它 + 原子认领共同实现：内存信号量在多实例部署下完全失效
     * （每个实例各放行 N 个，全局就是 N×实例数），而 lease 是全局可见的。
     */
    public int countInFlight(Instant now) {
        Integer count = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM ai_analysis_job
                 WHERE status = 'RUNNING' AND lease_until IS NOT NULL AND lease_until > ?
                """, Integer.class, ts(AiClock.toUtc(now)));
        return count == null ? 0 : count;
    }

    /**
     * lease 过期恢复之一：**从未发出请求**（requested_at IS NULL）→ 重新排队。
     *
     * <p>这类任务可以安全重跑：上游根本没收到过请求，不存在重复计费。
     *
     * @return 受影响行数
     */
    public int requeueExpiredNeverSent(Instant now) {
        return jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'QUEUED', lease_owner = NULL, lease_until = NULL
                 WHERE status = 'RUNNING' AND lease_until IS NOT NULL AND lease_until < ?
                   AND requested_at IS NULL
                """, ts(AiClock.toUtc(now)));
    }

    /**
     * lease 过期恢复之二：**已经发出请求**（requested_at IS NOT NULL）→ UNKNOWN，绝不自动重发。
     *
     * <p>这是整个模块最重要的一条语义：进程崩溃后我们无法知道上游是否已经跑完并计费，
     * 自动重发就是替用户重复付费。所以只标记未知，把决定权交给用户（POST /retry）。
     *
     * @return 受影响行数
     */
    public int markExpiredAsUnknown(Instant now) {
        return jdbcTemplate.update("""
                UPDATE ai_analysis_job
                   SET status = 'UNKNOWN', lease_owner = NULL, lease_until = NULL,
                       error_code = COALESCE(error_code, 'UNKNOWN'), finished_at = ?
                 WHERE status = 'RUNNING' AND lease_until IS NOT NULL AND lease_until < ?
                   AND requested_at IS NOT NULL
                """, ts(AiClock.toUtc(now)), ts(AiClock.toUtc(now)));
    }

    /**
     * 每小时重试上限的近似实现：用 {@code attempt_count - 1} 当作"用户主动重试次数"
     * （第一次执行不算重试），并要求最近一次执行落在最近一小时内。
     *
     * <p>为什么不用独立的 retry 计数列：契约 02 §5.1 的列清单里没有它，而 V4 已经外发，
     * 加列需要新迁移。这里的近似只会**更严格**（跨小时窗口后 attempt_count 不会自动清零，
     * 但因为同时要求 finished_at 在一小时内，跨窗口的任务可以重试），不会放松护栏。
     */
    public int retryAttemptsWithinLastHour(JobRow job, Instant now) {
        LocalDateTime reference = job.finishedAt() != null ? job.finishedAt()
                : (job.createdAt() != null ? job.createdAt() : AiClock.toUtc(now));
        boolean withinHour = !reference.isBefore(AiClock.toUtc(now.minus(Duration.ofHours(1))));
        if (!withinHour) {
            return 0;
        }
        return Math.max(0, job.attemptCount() - 1);
    }

    /** 供测试/诊断：按状态统计（不要用于业务判定）。 */
    public Map<String, Integer> countByStatus() {
        Map<String, Integer> counts = new HashMap<>();
        jdbcTemplate.query("SELECT status, COUNT(*) AS c FROM ai_analysis_job GROUP BY status",
                rs -> {
                    counts.put(rs.getString("status"), rs.getInt("c"));
                });
        return counts;
    }

    /* ── 映射 ───────────────────────────────────────────────────────────── */

    private static JobRow map(java.sql.ResultSet rs, int rowNum) throws java.sql.SQLException {
        return new JobRow(
                rs.getString("id"),
                rs.getString("user_id"),
                rs.getString("report_id"),
                rs.getString("idempotency_key"),
                rs.getString("request_hash"),
                rs.getString("prompt_version"),
                rs.getString("topic"),
                rs.getString("model_requested"),
                rs.getString("model_returned"),
                rs.getString("status"),
                rs.getInt("attempt_count"),
                utc(rs.getTimestamp("lease_until")),
                rs.getString("lease_owner"),
                utc(rs.getTimestamp("next_run_at")),
                utc(rs.getTimestamp("requested_at")),
                rs.getString("response_json"),
                rs.getString("usage_json"),
                rs.getString("error_code"),
                utc(rs.getTimestamp("created_at")),
                utc(rs.getTimestamp("finished_at")));
    }

    private static Timestamp ts(LocalDateTime utc) {
        return utc == null ? null : Timestamp.valueOf(utc);
    }

    private static LocalDateTime utc(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toLocalDateTime();
    }

    /** 列数自检：INSERT 的占位符个数与列清单必须一致（改列时立刻炸，而不是运行时才炸）。 */
    static int columnCount() {
        return COLUMN_COUNT;
    }
}
