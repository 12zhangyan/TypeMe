package com.typeme.account.repository;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code account_deletion_job}：注销清理任务（契约 §6.2）。
 *
 * <p>注销不是"删完返回"，而是"立即禁止登录 + 记一条任务"。原因：清理要跨多张表、
 * 还要重试，把它塞进删除接口的事务里会让用户体验变成"转圈等半天然后可能失败"。
 */
@Repository
public class DeletionJobRepository {

    private static final String COLUMNS =
            "id, user_id, status, requested_at, completed_at, attempt_count, last_error_code";

    private static final RowMapper<DeletionJobRecord> MAPPER = (rs, rowNum) -> new DeletionJobRecord(
            rs.getString("id"),
            rs.getString("user_id"),
            rs.getString("status"),
            toInstant(rs.getTimestamp("requested_at")),
            toInstant(rs.getTimestamp("completed_at")),
            rs.getInt("attempt_count"),
            rs.getString("last_error_code"));

    private final JdbcTemplate jdbc;

    public DeletionJobRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 建 PENDING 任务；**同一个账号已经有任务时返回那一行，而不是抛异常**。
     *
     * <p>为什么不能把 {@code uk_deletion_job_user} 的冲突直接抛上去：两个并发的
     * `DELETE /me` 会双双通过前置校验 —— `requireActive` 读的是**各自事务快照**里的
     * ACTIVE，第一个请求还没提交，第二个看到的仍是"可注销"。第二个走到 INSERT 时
     * 撞唯一约束，{@code DuplicateKeyException} 一路上抛到全局异常处理器就变成 **500**，
     * 而事实是他的注销申请**已经被受理过**了。用户看到"服务器错误"会一直重试，
     * 而正确语义是幂等：重复申请返回同一份任务（与"重复提交同一份测评返回同一份报告"同形）。
     *
     * @return 任务 id：新建的，或已存在的那一份
     */
    public String insertPendingOrGetExisting(String id, String userId, Instant now) {
        try {
            jdbc.update("""
                    INSERT INTO account_deletion_job (id, user_id, status, requested_at, completed_at,
                                                      attempt_count, last_error_code)
                    VALUES (?, ?, 'PENDING', ?, NULL, 0, NULL)
                    """, id, userId, Timestamp.from(now));
            return id;
        } catch (DuplicateKeyException ex) {
            // 普通一致性读在这里是**读不到**对方刚提交那一行的（REPEATABLE READ 的快照
            // 建立于本事务第一条 SELECT），所以必须用当前读。
            return findByUserIdForUpdate(userId).map(DeletionJobRecord::id).orElseThrow(() -> ex);
        }
    }

    /**
     * 按 user_id 取任务并加行锁（当前读，能看到最新已提交版本）。
     *
     * <p>只用在"唯一约束冲突之后确认到底有没有那一行"这一条路径上：那里必须拿到
     * 最新已提交状态，普通 SELECT 会给出过期快照。
     */
    public Optional<DeletionJobRecord> findByUserIdForUpdate(String userId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_deletion_job WHERE user_id = ? FOR UPDATE",
                MAPPER, userId).stream().findFirst();
    }

    public Optional<DeletionJobRecord> findByUserId(String userId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_deletion_job WHERE user_id = ?", MAPPER, userId)
                .stream().findFirst();
    }

    public Optional<DeletionJobRecord> findById(String id) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_deletion_job WHERE id = ?", MAPPER, id)
                .stream().findFirst();
    }

    /** worker 取一批待处理任务；按申请时间先到先服务。 */
    public List<DeletionJobRecord> findPending(int limit) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_deletion_job WHERE status IN ('PENDING', 'FAILED') "
                + "ORDER BY requested_at ASC LIMIT ?", MAPPER, limit);
    }

    public void markRunning(String id) {
        jdbc.update("UPDATE account_deletion_job SET status = 'RUNNING', attempt_count = attempt_count + 1 "
                + "WHERE id = ?", id);
    }

    public void markDone(String id, Instant now) {
        jdbc.update("UPDATE account_deletion_job SET status = 'DONE', completed_at = ?, last_error_code = NULL "
                + "WHERE id = ?", Timestamp.from(now), id);
    }

    public void markFailed(String id, String errorCode) {
        jdbc.update("UPDATE account_deletion_job SET status = 'FAILED', last_error_code = ? WHERE id = ?",
                errorCode, id);
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
