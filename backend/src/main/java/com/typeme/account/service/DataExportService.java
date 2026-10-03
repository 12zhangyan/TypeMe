package com.typeme.account.service;

import com.typeme.account.repository.UserRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
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
 * <p><b>容忍表不存在</b>：并行开发期间迁移文件可能还没落盘。缺表时该段落输出空数组并写 WARN，
 * 而不是让整个导出 500 —— 用户要导出的是自己的数据，不该因为某张表还没建就拿不到。
 *
 * <p><b>但"降级"必须说出来</b>（2026-09-17 第 15 轮修正）：此前任何查询失败都被
 * 吞成一个空数组，响应里没有任何标记，页面却告诉用户"报告与 AI 分析记录都在里面"。
 * 而账号页同时写着"注销会删除你的全部测评记录与报告……导出是唯一能把它们带走的办法"——
 * 于是用户按页面指引先导出、再注销，实际没导出成功的那部分**永久丢失且事后无从发现**。
 * 现在失败会被记进 {@code degradedSections} 随响应一起返回，页面据此如实告知
 * "这不是完整备份"。（"表还没建"属于部署未就绪，单独记一种原因，便于区分。）
 */
@Service
public class DataExportService {

    private static final Logger log = LoggerFactory.getLogger(DataExportService.class);

    /** 本次导出里失败的段落。段名对外可见，原因用于让人一眼判断是部署问题还是数据问题。 */
    private record DegradedSection(String section, String reason) {
    }

    private final JdbcTemplate jdbc;

    public DataExportService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Map<String, Object> export(UserRecord user) {
        List<DegradedSection> degraded = new ArrayList<>();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", 1);
        root.put("exportedAt", Instant.now().toString());
        root.put("profile", profile(user));
        root.put("attempts", attempts(user.id(), degraded));
        root.put("reports", reports(user.id(), degraded));
        root.put("selfReflections", selfReflections(user.id(), degraded));
        root.put("aiJobs", aiJobs(user.id(), degraded));
        // 明确写出"没导出什么"：用户与审计都能确认这不是遗漏，而是刻意的取舍。
        root.put("excluded", List.of("passwordHash", "recoveryCodeHash", "sessions", "apiIdempotency"));
        // 与 `excluded` 相反：这些是**本该有、但这次没拿到**的部分。
        // 空数组表示"这次导出是完整的"，页面据此才敢说"都在里面"。
        root.put("degradedSections", degraded.stream()
                .map(item -> Map.of("section", item.section(), "reason", item.reason()))
                .toList());
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
    private List<Map<String, Object>> attempts(String userId, List<DegradedSection> degraded) {
        if (!tableExists("assessment_attempt")) {
            warnMissing("attempts", "assessment_attempt", degraded);
            return List.of();
        }
        List<Map<String, Object>> attempts = safeQuery("attempts",
                "SELECT id, package_id, status, revision, current_question_id, clarification_dimensions, "
                        + "clarification_skipped, base_attempt_id, started_at, updated_at, submitted_at "
                        + "FROM assessment_attempt WHERE user_id = ? ORDER BY started_at ASC", degraded, userId);
        Map<String, List<Map<String, Object>>> answersByAttempt = answersByAttempt(userId, degraded);
        for (Map<String, Object> attempt : attempts) {
            Object attemptId = attempt.get("id");
            attempt.put("answers", attemptId == null
                    ? List.of()
                    : answersByAttempt.getOrDefault(String.valueOf(attemptId), List.of()));
        }
        return attempts;
    }

    private Map<String, List<Map<String, Object>>> answersByAttempt(String userId, List<DegradedSection> degraded) {
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        if (!tableExists("assessment_answer")) {
            warnMissing("answers", "assessment_answer", degraded);
            return grouped;
        }
        List<Map<String, Object>> rows = safeQuery("answers",
                "SELECT a.attempt_id, a.question_id, a.kind, a.rating, a.updated_at FROM assessment_answer a "
                        + "JOIN assessment_attempt t ON t.id = a.attempt_id WHERE t.user_id = ? "
                        + "ORDER BY a.attempt_id ASC, a.question_id ASC", degraded, userId);
        for (Map<String, Object> row : rows) {
            String attemptId = String.valueOf(row.get("attempt_id"));
            row.remove("attempt_id");
            grouped.computeIfAbsent(attemptId, key -> new java.util.ArrayList<>()).add(row);
        }
        return grouped;
    }

    private List<Map<String, Object>> reports(String userId, List<DegradedSection> degraded) {
        if (!tableExists("assessment_report")) {
            warnMissing("reports", "assessment_report", degraded);
            return List.of();
        }
        return safeQuery("reports",
                "SELECT id, attempt_id, status, computed_type_code, score_json, report_json, "
                        + "report_hash, created_at FROM assessment_report WHERE user_id = ? "
                        + "ORDER BY created_at ASC", degraded, userId);
    }

    private List<Map<String, Object>> selfReflections(String userId, List<DegradedSection> degraded) {
        if (!tableExists("report_self_reflection")) {
            warnMissing("selfReflections", "report_self_reflection", degraded);
            return List.of();
        }
        return safeQuery("selfReflections",
                "SELECT report_id, self_selected_type_code, note, updated_at "
                        + "FROM report_self_reflection WHERE user_id = ? ORDER BY updated_at ASC",
                degraded, userId);
    }

    /**
     * AI 任务：只导出状态与**校验通过的结构化输出**。
     * 刻意不导出 lease_owner/lease_until 之类 worker 内部字段（对用户无意义，且会暴露部署细节）。
     */
    private List<Map<String, Object>> aiJobs(String userId, List<DegradedSection> degraded) {
        if (!tableExists("ai_analysis_job")) {
            warnMissing("aiJobs", "ai_analysis_job", degraded);
            return List.of();
        }
        return safeQuery("aiJobs",
                "SELECT id, report_id, topic, prompt_version, model_requested, model_returned, "
                        + "status, error_code, response_json, usage_json, created_at, finished_at "
                        + "FROM ai_analysis_job WHERE user_id = ? ORDER BY created_at ASC", degraded, userId);
    }

    /**
     * 查询失败**不再静默降级**：记录段名与原因，由 {@link #export} 一并返回给用户。
     *
     * <p>日志以前只打异常类名，连哪一段、什么原因都没有，排查时基本没用；
     * 现在把段名与异常消息一起写进日志。
     */
    private List<Map<String, Object>> safeQuery(String section, String sql,
                                                List<DegradedSection> degraded, Object... args) {
        try {
            return jdbc.queryForList(sql, args);
        } catch (DataAccessException ex) {
            // 缺列（并行模块改了 schema）、连接抖动等都归到这里。
            log.warn("export section={} failed: {}", section, ex.getMessage());
            degraded.add(new DegradedSection(section, "查询失败（" + ex.getClass().getSimpleName() + "）"));
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

    /**
     * 缺表 = 部署还没就绪，与"查询失败"是两回事：前者重试也不会好，后者重试可能就好。
     *
     * <p>两处的 `section` 刻意都用**段名**（`attempts`/`reports`…）而不是表名，
     * 这样前端只需要一张映射表，且缺表与查询失败报的是同一个段落名。
     * 表名只进日志，不给用户看。
     */
    private static void warnMissing(String section, String table, List<DegradedSection> degraded) {
        log.warn("export skip section={} table={} (not available yet)", section, table);
        degraded.add(new DegradedSection(section, "数据表尚未就绪（部署未完成）"));
    }
}
