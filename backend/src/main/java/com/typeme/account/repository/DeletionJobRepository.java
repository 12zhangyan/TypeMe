package com.typeme.account.repository;

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

    public void insertPending(String id, String userId, Instant now) {
        jdbc.update("""
                INSERT INTO account_deletion_job (id, user_id, status, requested_at, completed_at,
                                                  attempt_count, last_error_code)
                VALUES (?, ?, 'PENDING', ?, NULL, 0, NULL)
                """, id, userId, Timestamp.from(now));
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
