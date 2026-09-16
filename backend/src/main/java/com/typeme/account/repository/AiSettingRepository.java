package com.typeme.account.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * {@code typeme_ai_setting}：后台 AI 配置的单行表。
 *
 * <p>单行由主键值固定为 {@value #SINGLETON_ID} + {@code ck_ai_setting_singleton} 保证，
 * 应用层不需要"先查再插"的竞态处理。
 */
@Repository
public class AiSettingRepository {

    /** 单行配置的固定主键。 */
    public static final String SINGLETON_ID = "default";

    private static final String COLUMNS =
            "id, enabled, base_url, api_key_encrypted, api_key_fingerprint, api_key_source, model, "
                    + "prompt_version, daily_limit_per_user, retry_limit_per_hour, global_daily_call_budget, "
                    + "global_daily_token_budget, worker_concurrency, connect_timeout_ms, request_deadline_ms, "
                    + "max_tokens, mock_mode, updated_at, updated_by";

    private static final RowMapper<AiSettingRecord> MAPPER = (rs, rowNum) -> new AiSettingRecord(
            rs.getString("id"),
            rs.getInt("enabled") != 0,
            rs.getString("base_url"),
            rs.getString("api_key_encrypted"),
            rs.getString("api_key_fingerprint"),
            rs.getString("api_key_source"),
            rs.getString("model"),
            rs.getString("prompt_version"),
            rs.getInt("daily_limit_per_user"),
            rs.getInt("retry_limit_per_hour"),
            rs.getInt("global_daily_call_budget"),
            rs.getLong("global_daily_token_budget"),
            rs.getInt("worker_concurrency"),
            rs.getInt("connect_timeout_ms"),
            rs.getInt("request_deadline_ms"),
            rs.getInt("max_tokens"),
            rs.getInt("mock_mode") != 0,
            rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toInstant(),
            rs.getString("updated_by"));

    private final JdbcTemplate jdbc;

    public AiSettingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<AiSettingRecord> find() {
        List<AiSettingRecord> rows = jdbc.query(
                "SELECT " + COLUMNS + " FROM typeme_ai_setting WHERE id = ?", MAPPER, SINGLETON_ID);
        return rows.stream().findFirst();
    }

    /**
     * 插入或整行更新配置。
     *
     * <p>用"先 UPDATE、影响 0 行再 INSERT"而不是 {@code ON DUPLICATE KEY UPDATE}：
     * 后者是 MySQL 方言，H2 只在 MODE=MySQL 下支持，而这个模块的集成测试正是要证明
     * **同一段代码在两种引擎下都成立**。先 UPDATE 再 INSERT 是纯标准 SQL，
     * 且并发时最坏情况是 INSERT 撞主键（事务内重试一次即可，实际上后台改配置是极低频操作）。
     */
    public void save(AiSettingRecord record) {
        int updated = jdbc.update("""
                UPDATE typeme_ai_setting SET
                    enabled = ?, base_url = ?, api_key_encrypted = ?, api_key_fingerprint = ?,
                    api_key_source = ?, model = ?, prompt_version = ?, daily_limit_per_user = ?,
                    retry_limit_per_hour = ?, global_daily_call_budget = ?, global_daily_token_budget = ?,
                    worker_concurrency = ?, connect_timeout_ms = ?, request_deadline_ms = ?,
                    max_tokens = ?, mock_mode = ?, updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                record.enabled() ? 1 : 0, record.baseUrl(), record.apiKeyEncrypted(), record.apiKeyFingerprint(),
                record.apiKeySource(), record.model(), record.promptVersion(), record.dailyLimitPerUser(),
                record.retryLimitPerHour(), record.globalDailyCallBudget(), record.globalDailyTokenBudget(),
                record.workerConcurrency(), record.connectTimeoutMs(), record.requestDeadlineMs(),
                record.maxTokens(), record.mockMode() ? 1 : 0,
                Timestamp.from(record.updatedAt()), record.updatedBy(), SINGLETON_ID);
        if (updated == 0) {
            jdbc.update("""
                    INSERT INTO typeme_ai_setting (id, enabled, base_url, api_key_encrypted, api_key_fingerprint,
                                                   api_key_source, model, prompt_version, daily_limit_per_user,
                                                   retry_limit_per_hour, global_daily_call_budget,
                                                   global_daily_token_budget, worker_concurrency, connect_timeout_ms,
                                                   request_deadline_ms, max_tokens, mock_mode, updated_at, updated_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    SINGLETON_ID, record.enabled() ? 1 : 0, record.baseUrl(), record.apiKeyEncrypted(),
                    record.apiKeyFingerprint(), record.apiKeySource(), record.model(), record.promptVersion(),
                    record.dailyLimitPerUser(), record.retryLimitPerHour(), record.globalDailyCallBudget(),
                    record.globalDailyTokenBudget(), record.workerConcurrency(), record.connectTimeoutMs(),
                    record.requestDeadlineMs(), record.maxTokens(), record.mockMode() ? 1 : 0,
                    Timestamp.from(record.updatedAt()), record.updatedBy());
        }
    }

    /** 供测试与运维断言"确实还没写过库"。 */
    public boolean exists() {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM typeme_ai_setting WHERE id = ?", Integer.class, SINGLETON_ID);
        return count != null && count > 0;
    }

    /** 只在配置表不存在时使用：返回 false 表示"表还没建"（并行迁移未落盘时不炸）。 */
    public boolean tableAvailable() {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM typeme_ai_setting", Integer.class);
            return true;
        } catch (org.springframework.dao.DataAccessException ex) {
            return false;
        }
    }

    static Instant now() {
        return Instant.now();
    }
}
