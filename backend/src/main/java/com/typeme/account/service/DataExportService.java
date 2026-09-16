package com.typeme.account.service;

import com.typeme.account.repository.UserRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 个人数据导出（契约 §7.2 的 {@code GET /me/export}）。
 *
 * <p><b>包含</b>：账号基本资料、attempts + answers、reports（含 report_json）、自我理解、
 * AI 任务状态与结构化输出。
 * <b>不含</b>：password_hash、恢复码 hash、会话、内部幂等记录 —— 前两者是凭据材料
 * （导出文件会被下载、转发、长期保存，绝不能带上可直接冒用的东西），
 * 后两者是内部运行数据，对用户没有价值却会扩大暴露面。
 *
 * <p>为什么用 {@code JdbcTemplate} 直接查表名而不是复用并行模块的实体类：
 * attempt/report/AI 的表归对方所有，导出只是"把 user_id 名下的行原样交给用户"。
 * 用 Map/queryForList 输出既避免了跨模块的编译期耦合，也天然保证"导出内容随 schema 自动跟进"。
 *
 * <p>**容忍表不存在**：并行开发期间迁移文件可能还没落盘。缺表时该段落输出空数组并写 WARN，
 * 而不是让整个导出 500 —— 用户要导出的是自己的数据，不该因为某张表还没建就拿不到。
 */
@Service
public class DataExportService {

    private static final Logger log = LoggerFactory.getLogger(DataExportService.class);

    private final JdbcTemplate jdbc;

    public DataExportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> export(UserRecord user) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", 1);
        root.put("exportedAt", Instant.now().toString());
        root.put("profile", profile(user));
        root.put("attempts", attempts(user.id()));
        root.put("reports", reports(user.id()));
        root.put("selfReflections", selfReflections(user.id()));
        root.put("aiJobs", aiJobs(user.id()));
        // 明确写出"没导出什么"：用户与审计都能确认这不是遗漏，而是刻意的取舍。
        root.put("excluded", List.of("passwordHash", "recoveryCodeHash", "sessions", "apiIdempotency"));
        return root;
    }

    private static Map<String, Object> profile(UserRecord user) {
        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("userId", user.id());
        profile.put("username", user.usernameDisplay());
        profile.put("nickname", user.nickname());
        profile.put("createdAt", user.createdAt() == null ? null : user.createdAt().toString());
        profile.put("passwordChangedAt", user.passwordChangedAt() == null ? null : user.passwordChangedAt().toString());
        return profile;
    }

    /**
     * attempts 连同其答案。答案用一次 IN 查询取回后在内存里分组：
     * "每个 attempt 一次查询"在记录多时就是 N+1，而导出恰恰是记录最多的一次调用。
     */
    private List<Map<String, Object>> attempts(String userId) {
        if (!tableExists("assessment_attempt")) {
            warnMissing("assessment_attempt");
            return List.of();
        }
        List<Map<String, Object>> attempts = safeQuery(
                "SELECT id, package_id, status, revision, current_question_id, clarification_dimensions, "
                        + "clarification_skipped, base_attempt_id, started_at, updated_at, submitted_at "
                        + "FROM assessment_attempt WHERE user_id = ? ORDER BY started_at ASC", userId);
        Map<String, List<Map<String, Object>>> answersByAttempt = answersByAttempt(userId);
        for (Map<String, Object> attempt : attempts) {
            Object attemptId = attempt.get("id");
            attempt.put("answers", attemptId == null
                    ? List.of()
                    : answersByAttempt.getOrDefault(String.valueOf(attemptId), List.of()));
        }
        return attempts;
    }

    private Map<String, List<Map<String, Object>>> answersByAttempt(String userId) {
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        if (!tableExists("assessment_answer")) {
            warnMissing("assessment_answer");
            return grouped;
        }
        List<Map<String, Object>> rows = safeQuery(
                "SELECT a.attempt_id, a.question_id, a.kind, a.rating, a.updated_at FROM assessment_answer a "
                        + "JOIN assessment_attempt t ON t.id = a.attempt_id WHERE t.user_id = ? "
                        + "ORDER BY a.attempt_id ASC, a.question_id ASC", userId);
        for (Map<String, Object> row : rows) {
            String attemptId = String.valueOf(row.get("attempt_id"));
            row.remove("attempt_id");
            grouped.computeIfAbsent(attemptId, key -> new java.util.ArrayList<>()).add(row);
        }
        return grouped;
    }

    private List<Map<String, Object>> reports(String userId) {
        if (!tableExists("assessment_report")) {
            warnMissing("assessment_report");
            return List.of();
        }
        return safeQuery("SELECT id, attempt_id, status, computed_type_code, score_json, report_json, "
                + "report_hash, created_at FROM assessment_report WHERE user_id = ? ORDER BY created_at ASC", userId);
    }

    private List<Map<String, Object>> selfReflections(String userId) {
        if (!tableExists("report_self_reflection")) {
            warnMissing("report_self_reflection");
            return List.of();
        }
        return safeQuery("SELECT report_id, self_selected_type_code, note, updated_at "
                + "FROM report_self_reflection WHERE user_id = ? ORDER BY updated_at ASC", userId);
    }

    /**
     * AI 任务：只导出状态与**校验通过的结构化输出**。
     * 刻意不导出 lease_owner/lease_until 之类 worker 内部字段（对用户无意义，且会暴露部署细节）。
     */
    private List<Map<String, Object>> aiJobs(String userId) {
        if (!tableExists("ai_analysis_job")) {
            warnMissing("ai_analysis_job");
            return List.of();
        }
        return safeQuery("SELECT id, report_id, topic, prompt_version, model_requested, model_returned, "
                + "status, error_code, response_json, usage_json, created_at, finished_at "
                + "FROM ai_analysis_job WHERE user_id = ? ORDER BY created_at ASC", userId);
    }

    private List<Map<String, Object>> safeQuery(String sql, Object... args) {
        try {
            return jdbc.queryForList(sql, args);
        } catch (DataAccessException ex) {
            // 缺表、缺列（并行模块改了 schema）都归到这里：导出降级为空数组而不是 500。
            log.warn("export section failed: {}", ex.getClass().getSimpleName());
            return List.of();
        }
    }

    private boolean tableExists(String table) {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE 1 = 0", Long.class);
            return true;
        } catch (DataAccessException ex) {
            return false;
        }
    }

    private static void warnMissing(String table) {
        log.warn("export skip table={} (not available yet)", table);
    }
}
