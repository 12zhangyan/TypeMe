package com.typeme.account.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * {@code app_user} 的数据访问（JdbcTemplate；本项目刻意不引入 JPA）。
 *
 * <p>所有查询都用参数占位符，没有任何字符串拼接的 SQL —— 用户名是用户输入，
 * 拼接就等于把账号表交给 SQL 注入。
 */
@Repository
public class UserRepository {

    private static final String COLUMNS =
            "id, username_normalized, username_display, password_hash, nickname, status, role, "
                    + "created_at, password_changed_at, recovery_code_version, deletion_requested_at, ai_daily_limit";

    private static final RowMapper<UserRecord> MAPPER = (rs, rowNum) -> new UserRecord(
            rs.getString("id"),
            rs.getString("username_normalized"),
            rs.getString("username_display"),
            rs.getString("password_hash"),
            rs.getString("nickname"),
            rs.getString("status"),
            rs.getString("role"),
            toInstant(rs.getTimestamp("created_at")),
            toInstant(rs.getTimestamp("password_changed_at")),
            rs.getInt("recovery_code_version"),
            toInstant(rs.getTimestamp("deletion_requested_at")),
            (Integer) rs.getObject("ai_daily_limit"));

    private final JdbcTemplate jdbc;

    public UserRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 用户名规范化：契约 §2.1 规定 `toLowerCase(Locale.ROOT)`。 */
    public static String normalize(String username) {
        return username == null ? null : username.toLowerCase(Locale.ROOT);
    }

    public Optional<UserRecord> findById(String id) {
        List<UserRecord> rows = jdbc.query("SELECT " + COLUMNS + " FROM app_user WHERE id = ?", MAPPER, id);
        return rows.stream().findFirst();
    }

    public Optional<UserRecord> findByNormalizedUsername(String usernameNormalized) {
        List<UserRecord> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM app_user WHERE username_normalized = ?", MAPPER, usernameNormalized);
        return rows.stream().findFirst();
    }

    public boolean existsByNormalizedUsername(String usernameNormalized) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_user WHERE username_normalized = ?", Integer.class, usernameNormalized);
        return count != null && count > 0;
    }

    /** 系统里是否已有管理员（管理员引导与"最后一个管理员"判断都靠它）。 */
    public boolean existsAdmin() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_user WHERE role = ? AND status <> ?",
                Integer.class, UserRecord.ROLE_ADMIN, UserRecord.STATUS_DELETED);
        return count != null && count > 0;
    }

    public int countAdmins() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_user WHERE role = ? AND status <> ?",
                Integer.class, UserRecord.ROLE_ADMIN, UserRecord.STATUS_DELETED);
        return count == null ? 0 : count;
    }

    /** 插入一行；主键由调用方给出（注册时同时要用它建会话，先有 id 更简单）。 */
    public void insert(String id, String usernameNormalized, String usernameDisplay, String passwordHash,
                       String nickname, String role, Instant now) {
        jdbc.update("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, role, created_at, password_changed_at, recovery_code_version,
                                      deletion_requested_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                id, usernameNormalized, usernameDisplay, passwordHash, nickname,
                UserRecord.STATUS_ACTIVE, role, Timestamp.from(now), Timestamp.from(now), 0);
    }

    public void updateNickname(String id, String nickname) {
        jdbc.update("UPDATE app_user SET nickname = ? WHERE id = ?", nickname, id);
    }

    public void updatePasswordHash(String id, String passwordHash, Instant now) {
        jdbc.update("UPDATE app_user SET password_hash = ?, password_changed_at = ? WHERE id = ?",
                passwordHash, Timestamp.from(now), id);
    }

    /** 重发恢复码时 +1；恢复流程也用它把旧码一次性作废（契约 §2.2）。 */
    public void bumpRecoveryCodeVersion(String id) {
        jdbc.update("UPDATE app_user SET recovery_code_version = recovery_code_version + 1 WHERE id = ?", id);
    }

    public void updateRole(String id, String role) {
        jdbc.update("UPDATE app_user SET role = ? WHERE id = ?", role, id);
    }

    /** 注销第一步：立即禁止登录并记录申请时间。 */
    public void updateAiDailyLimit(String userId, Integer limit) {
        jdbc.update("UPDATE app_user SET ai_daily_limit = ? WHERE id = ?", limit, userId);
    }

    public void markDisabledForDeletion(String id, Instant now) {
        jdbc.update("UPDATE app_user SET status = ?, deletion_requested_at = ? WHERE id = ?",
                UserRecord.STATUS_DISABLED, Timestamp.from(now), id);
    }

    public void markDisabled(String id) {
        jdbc.update("UPDATE app_user SET status = ? WHERE id = ?", UserRecord.STATUS_DISABLED, id);
    }

    /**
     * 清理完成：把用户名改写成 {@code deleted:<uuid>} 并置 DELETED。
     *
     * <p>为什么要改写而不是保留原名：契约 §6.2 要求"释放用户名且不复活"。
     * 用户名占着 `uk_app_user_username` 会导致原主人（或任何想注册的人）永远拿不到这个名字，
     * 而账号本身又已经不可登录 —— 那是最糟的组合。改写成带 uuid 的形式同时满足
     * "不在列表里露出已删除账号"和"将来若重放备份也不会复活原账号"。
     */
    public void markDeletedWithRewrittenUsername(String id, Instant now) {
        jdbc.update("UPDATE app_user SET status = ?, username_normalized = ? WHERE id = ?",
                UserRecord.STATUS_DELETED, "deleted:" + id, id);
    }

    /** 分页列出用户（后台用）；按创建时间倒序，id 兜底保证顺序稳定。 */
    public List<UserRecord> page(int offset, int limit) {
        return jdbc.query("SELECT " + COLUMNS + " FROM app_user WHERE status <> ? "
                        + "ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?",
                MAPPER, UserRecord.STATUS_DELETED, limit, offset);
    }

    public long count() {
        Long count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_user WHERE status <> ?", Long.class, UserRecord.STATUS_DELETED);
        return count == null ? 0L : count;
    }

    /** 生成主键；集中在仓储层是为了让"id 一律是 36 位 UUID 文本"只有一处约定。 */
    public static String newId() {
        return UUID.randomUUID().toString();
    }

    private static Instant toInstant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }
}
