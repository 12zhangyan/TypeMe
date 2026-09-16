package com.typeme.account.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * {@code app_user_session}：会话的绝对期限账本（契约 §2.3 的替代实现）。
 *
 * <p>表里存的是 sessionId 到 absolute_expires_at 的映射。**撤销 = 删行 + 让进程内的
 * HttpSession 立即失效**，两者缺一不可：只删行，旧 Cookie 仍能在容器里命中活着的会话；
 * 只失效内存会话，重启后又会被表里的行"复活"。
 */
@Repository
public class UserSessionRepository {

    private final JdbcTemplate jdbc;

    public UserSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String sessionId, String userId, Instant now, Instant absoluteExpiresAt) {
        jdbc.update("""
                INSERT INTO app_user_session (session_id, user_id, created_at, last_seen_at, absolute_expires_at)
                VALUES (?, ?, ?, ?, ?)
                """, sessionId, userId, Timestamp.from(now), Timestamp.from(now), Timestamp.from(absoluteExpiresAt));
    }

    public Optional<Instant> findAbsoluteExpiresAt(String sessionId) {
        List<Timestamp> rows = jdbc.queryForList(
                "SELECT absolute_expires_at FROM app_user_session WHERE session_id = ?", Timestamp.class, sessionId);
        return rows.stream().filter(java.util.Objects::nonNull).findFirst().map(Timestamp::toInstant);
    }

    public Optional<String> findUserId(String sessionId) {
        List<String> rows = jdbc.queryForList(
                "SELECT user_id FROM app_user_session WHERE session_id = ?", String.class, sessionId);
        return rows.stream().findFirst();
    }

    /** 节流写 last_seen_at：只有超过阈值的请求才落库，避免每个请求一次 UPDATE。 */
    public void touchLastSeen(String sessionId, Instant lastSeenAt) {
        jdbc.update("UPDATE app_user_session SET last_seen_at = ? WHERE session_id = ?",
                Timestamp.from(lastSeenAt), sessionId);
    }

    public int deleteBySessionId(String sessionId) {
        return jdbc.update("DELETE FROM app_user_session WHERE session_id = ?", sessionId);
    }

    /** 删掉该用户**除当前会话外**的全部会话行（改密码时用：当前设备不该被踢）。 */
    public List<String> findSessionIdsForUserExcept(String userId, String exceptSessionId) {
        return jdbc.queryForList(
                "SELECT session_id FROM app_user_session WHERE user_id = ? AND session_id <> ?",
                String.class, userId, exceptSessionId == null ? "" : exceptSessionId);
    }

    public List<String> findSessionIdsForUser(String userId) {
        return jdbc.queryForList("SELECT session_id FROM app_user_session WHERE user_id = ?", String.class, userId);
    }

    public int deleteByUserId(String userId) {
        return jdbc.update("DELETE FROM app_user_session WHERE user_id = ?", userId);
    }

    public int deleteByUserIdExcept(String userId, String exceptSessionId) {
        return jdbc.update("DELETE FROM app_user_session WHERE user_id = ? AND session_id <> ?",
                userId, exceptSessionId == null ? "" : exceptSessionId);
    }

    public int countForUser(String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_user_session WHERE user_id = ?", Integer.class, userId);
        return count == null ? 0 : count;
    }
}
