package com.typeme.account.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * {@code account_recovery_code} 的数据访问。
 *
 * <p><b>只存 hash</b>（契约 §2.2）：注册/重发时把明文交给 {@code PasswordEncoder}，
 * 明文只存在于那一次响应里。任何查询方法都拿不到明文 —— 数据库里根本没有。
 */
@Repository
public class RecoveryCodeRepository {

    private static final String COLUMNS = "id, user_id, code_hash, code_index, used_at, created_at, revoked_at";

    private static final RowMapper<RecoveryCodeRecord> MAPPER = (rs, rowNum) -> new RecoveryCodeRecord(
            rs.getString("id"),
            rs.getString("user_id"),
            rs.getString("code_hash"),
            rs.getInt("code_index"),
            toInstant(rs.getTimestamp("used_at")),
            toInstant(rs.getTimestamp("created_at")),
            toInstant(rs.getTimestamp("revoked_at")));

    private final JdbcTemplate jdbc;

    public RecoveryCodeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String id, String userId, String codeHash, int codeIndex, Instant now) {
        jdbc.update("""
                INSERT INTO account_recovery_code (id, user_id, code_hash, code_index, used_at, created_at, revoked_at)
                VALUES (?, ?, ?, ?, NULL, ?, NULL)
                """, id, userId, codeHash, codeIndex, Timestamp.from(now));
    }

    /** 该用户当前可用的恢复码（未使用且未作废）；恢复流程用它挑出匹配的那一条。 */
    public List<RecoveryCodeRecord> findUsable(String userId) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_recovery_code "
                + "WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL ORDER BY code_index ASC",
                MAPPER, userId);
    }

    public Optional<RecoveryCodeRecord> findById(String id) {
        return jdbc.query("SELECT " + COLUMNS + " FROM account_recovery_code WHERE id = ?", MAPPER, id)
                .stream().findFirst();
    }

    /**
     * 原子消费（契约 §2.2 的原文条件）。返回受影响行数，调用方**必须**断言等于 1。
     *
     * <p>为什么把 {@code used_at IS NULL AND revoked_at IS NULL} 写进 WHERE 而不是先 SELECT 再 UPDATE：
     * 两个并发请求会同时通过"先读后判"，只有一个能把行从"未使用"改成"已使用"。
     * 受影响的 0 行就是"这次没抢到"，而不是"系统出错"。
     */
    public int consume(String id, Instant now) {
        return jdbc.update("UPDATE account_recovery_code SET used_at = ? "
                        + "WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL",
                Timestamp.from(now), id);
    }

    /** 作废该用户其余未使用的恢复码（恢复与重发都走这里）。 */
    public int revokeAllUsable(String userId, Instant now) {
        return jdbc.update("UPDATE account_recovery_code SET revoked_at = ? "
                        + "WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL",
                Timestamp.from(now), userId);
    }

    /** 注销清理：直接删行（保留 used_at 记录没有意义，账号本身都要没了）。 */
    public int deleteAllForUser(String userId) {
        return jdbc.update("DELETE FROM account_recovery_code WHERE user_id = ?", userId);
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
