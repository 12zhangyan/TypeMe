package com.typeme.jung.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.jung.api.JungDtos;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungResultStatus;
import com.typeme.jung.domain.JungScoringResult;
import com.typeme.jung.domain.JungTypeCode;
import com.typeme.jung.scoring.JungScorer;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.report.ReportEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 提交计分与不可变报告。
 *
 * <p>三条不可妥协的性质：
 * <ol>
 *   <li><b>Java 是唯一权威</b>：客户端提交的 body 里没有任何分数或类型字段，服务端重新读答案重算。</li>
 *   <li><b>提交后不可变</b>：报告只 INSERT；改答走派生新 attempt。</li>
 *   <li><b>重复提交幂等</b>：`assessment_report.attempt_id` 唯一，冲突时读回既有报告 id，
 *       返回同一个 reportId，不产生第二份报告。</li>
 * </ol>
 */
@Service
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    private final JdbcTemplate jdbc;
    private final JungPackageLoader loader;
    private final AttemptService attempts;
    private final TimeSource time;
    private final ObjectMapper mapper;

    public ReportService(
            JdbcTemplate jdbc,
            JungPackageLoader loader,
            AttemptService attempts,
            TimeSource time,
            ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.loader = loader;
        this.attempts = attempts;
        this.time = time;
        this.mapper = mapper;
    }

    /* ── 提交 ───────────────────────────────────────────────────────────── */

    @Transactional
    public JungDtos.SubmitResponse submit(
            String userId, String attemptId, JungDtos.SubmitRequest request) {

        Map<String, Object> row = attempts.requireRowForUpdate(userId, attemptId);
        String status = (String) row.get("status");
        long revision = ((Number) row.get("revision")).longValue();

        // 这份草稿锁定的题目版本。**先解析再分支**：已提交分支里的覆盖信息也要按它算，
        // 否则旧草稿的幂等重放会因为"当前包已经换成新版"而已读不到旧题目。
        JungPackage pkg = attempts.requirePackage(row);

        if ("SUBMITTED".equals(status)) {
            // 幂等：已提交就返回既有报告（同一份 attempt 只有一份报告）
            String reportId = attempts.findReportId(attemptId);
            if (reportId == null) {
                throw new IllegalStateException("attempt 标记为已提交但没有报告，数据不一致：" + attemptId);
            }
            Map<String, Object> existing = readReportRow(reportId, userId);
            return new JungDtos.SubmitResponse(
                    reportId,
                    attemptId,
                    (String) existing.get("status"),
                    (String) existing.get("computed_type_code"),
                    candidateCodesFromJson((String) existing.get("report_json")),
                    attempts.coverageViews(pkg, JungScorer.checkCoverage(pkg,
                            attempts.answerMap(attempts.readAnswers(attemptId)))),
                    true);
        }

        if (request != null && request.expectedRevision() != null && request.expectedRevision() != revision) {
            throw JungApiException.conflict("另一台设备已经更新了这份草稿，请先读取最新版本再提交。",
                    Map.of("currentRevision", revision));
        }

        List<JungDtos.AnswerView> answers = attempts.readAnswers(attemptId);
        Map<String, JungAnswer> answerMap = attempts.answerMap(answers);

        JungScorer.CoverageReport coverage = JungScorer.checkCoverage(pkg, answerMap);
        boolean skipped = request != null && Boolean.TRUE.equals(request.clarificationSkipped());
        if (request != null && Boolean.TRUE.equals(request.clarificationSkipped())) {
            jdbc.update("UPDATE assessment_attempt SET clarification_skipped = 1 WHERE id = ? AND user_id = ?",
                    attemptId, userId);
        } else {
            List<Map<String, Object>> existingSkipped = jdbc.queryForList(
                    "SELECT clarification_skipped FROM assessment_attempt WHERE id = ? AND user_id = ?",
                    attemptId, userId);
            skipped = !existingSkipped.isEmpty() && AttemptService.toBoolean(existingSkipped.get(0).get("clarification_skipped"));
        }

        if (!coverage.coverageOk()) {
            // 覆盖不足：不生成报告，返回 200 + NEEDS_REVIEW，让前端引导回看具体缺哪几题
            return new JungDtos.SubmitResponse(
                    null, attemptId, "NEEDS_REVIEW", null, List.of(),
                    attempts.coverageViews(pkg, coverage), false);
        }

        // 服务端重新计算澄清集合，并校验"已安排题必须全部被处理"
        List<JungDimension> scheduled = JungScorer.reviewClarification(pkg, answerMap);
        if (!skipped) {
            for (JungDimension dimension : scheduled) {
                for (JungItem item : pkg.clarificationItems(dimension)) {
                    if (!answerMap.containsKey(item.id())) {
                        throw new JungApiException("CLARIFICATION_INCOMPLETE", 409,
                                "这一维的补充题还没有全部作答：" + dimension.displayName()
                                        + "。可以逐题作答，或者明确选择跳过补充题。");
                    }
                }
            }
        } else {
            for (JungDimension dimension : scheduled) {
                for (JungItem item : pkg.clarificationItems(dimension)) {
                    if (answerMap.containsKey(item.id())) {
                        throw JungApiException.invalid(
                                "已选择跳过补充题，就不应该再有补充题答案：" + item.id());
                    }
                }
            }
        }

        JungScoringResult result = JungScorer.score(pkg, answerMap, skipped);
        if (result.status() == JungResultStatus.NEEDS_REVIEW) {
            return new JungDtos.SubmitResponse(
                    null, attemptId, "NEEDS_REVIEW", null, List.of(),
                    attempts.coverageViews(pkg, coverage), false);
        }

        // 报告 id 由 attemptId 派生：同一 attempt 的重复提交天然得到同一个 id，
        // 即使并发穿过唯一约束也不会产生两份报告。
        String reportId = UUID.nameUUIDFromBytes(("typeme-report:" + attemptId).getBytes(StandardCharsets.UTF_8))
                .toString();
        LocalDateTime now = time.nowUtc();
        // 报告体按**这份草稿锁定的内容包与它引用的报告版本**构造，
        // 然后用中性外壳包起来（外壳负责声明"这是什么量表、哪一版"）。
        Map<String, Object> body = JungReportBuilder.build(
                pkg,
                loader.findTypeReports(pkg.reportContentVersion()),
                loader.processCopy(),
                loader,
                result,
                reportId,
                attemptId,
                now,
                now);
        Map<String, Object> report = ReportEnvelope.wrap(
                AssessmentRelease.ofJung(pkg), reportId, attemptId,
                TimeSource.isoFromUtc(now), body);
        // 追加 reportHash 这一步收在 Builder 里：哈希必须覆盖除自己以外的每个字段，
        // 散在这里的话，谁在两次序列化之间插一个字段就会让它逃出哈希覆盖。
        String reportJson = JungReportBuilder.finalizeWithHash(mapper, report);
        String reportHash = (String) report.get("reportHash");

        Map<String, Object> score = scoreJson(pkg, result, reportHash);
        String typeCode = result.computedTypeCode() == null ? null : result.computedTypeCode().value();

        try {
            jdbc.update("""
                    INSERT INTO assessment_report
                      (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    reportId, attemptId, userId, result.status().name(), typeCode,
                    writeJson(score), reportJson, reportHash, now);
        } catch (DuplicateKeyException ex) {
            // 唯一约束兜底：另一路已经提交成功，返回既有报告，不再插入
            log.info("重复提交被唯一约束拦截，返回既有报告 attemptId={}", attemptId);
            Map<String, Object> existing = readReportRowForUpdate(reportId, userId);
            return new JungDtos.SubmitResponse(
                    reportId,
                    attemptId,
                    (String) existing.get("status"),
                    (String) existing.get("computed_type_code"),
                    candidateCodesFromJson((String) existing.get("report_json")),
                    attempts.coverageViews(pkg, coverage),
                    true);
        }

        jdbc.update("""
                UPDATE assessment_attempt
                   SET status = 'SUBMITTED', submitted_at = ?, updated_at = ?, clarification_dimensions = ?
                 WHERE id = ? AND user_id = ?
                """,
                now, now, AttemptService.orderDimensions(new java.util.LinkedHashSet<>(scheduled)), attemptId, userId);

        return new JungDtos.SubmitResponse(
                reportId,
                attemptId,
                result.status().name(),
                typeCode,
                result.candidates().stream().map(candidate -> candidate.typeCode().value()).toList(),
                attempts.coverageViews(pkg, coverage),
                true);
    }

    /* ── 读取 ───────────────────────────────────────────────────────────── */

    public JungDtos.ReportListResponse list(String userId, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.min(50, Math.max(1, size));
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_report WHERE user_id = ?", Long.class, userId);

        List<JungDtos.ReportSummary> items = jdbc.query("""
                SELECT r.id, r.attempt_id, r.created_at, r.status, r.computed_type_code,
                       r.report_json, a.package_id,
                       s.self_selected_type_code
                  FROM assessment_report r
                  JOIN assessment_attempt a ON a.id = r.attempt_id
                  LEFT JOIN report_self_reflection s ON s.report_id = r.id AND s.user_id = r.user_id
                 WHERE r.user_id = ?
                 ORDER BY r.created_at DESC, r.id DESC
                 LIMIT ? OFFSET ?
                """,
                (rs, rowNum) -> new JungDtos.ReportSummary(
                        rs.getString("id"),
                        rs.getString("attempt_id"),
                        TimeSource.isoFromUtc(rs.getObject("created_at", LocalDateTime.class)),
                        rs.getString("status"),
                        rs.getString("computed_type_code"),
                        rs.getString("self_selected_type_code"),
                        summaryLine(rs.getString("report_json")),
                        rs.getString("package_id"),
                        // 每行按**它自己绑定的内容包**取计分版本：
                        // 用 loader.current() 会把所有历史报告标注成当前版本，
                        // 而报告页正是靠这个字段说明"这份结论是按哪版算法算的"。
                        scoringVersionOf(rs.getString("package_id"))),
                userId, safeSize, safePage * safeSize);

        return new JungDtos.ReportListResponse(items, safePage, safeSize, total == null ? 0 : total);
    }

    /** 历史报告**读快照**，不重算。 */
    public JungDtos.ReportDetail detail(String userId, String reportId) {
        Map<String, Object> row = readReportRow(reportId, userId);
        Map<String, Object> report = readJsonMap((String) row.get("report_json"));
        String attemptId = (String) row.get("attempt_id");
        long revision = jdbc.queryForObject(
                "SELECT revision FROM assessment_attempt WHERE id = ?", Long.class, attemptId);
        return new JungDtos.ReportDetail(report, selfReflection(userId, reportId), attemptId, revision);
    }

    public JungDtos.ReportDetail detailByAttempt(String userId, String attemptId) {
        String reportId = attempts.findReportId(attemptId);
        if (reportId == null) {
            throw JungApiException.notFound("这份测评的报告");
        }
        return detail(userId, reportId);
    }

    /* ── 自我理解（与问卷结果隔离） ─────────────────────────────────────── */

    @Transactional
    public JungDtos.SelfReflectionView saveSelfReflection(
            String userId, String reportId, JungDtos.SelfReflectionRequest request) {

        readReportRow(reportId, userId); // owner 校验
        String code = request == null ? null : request.selfSelectedTypeCode();
        if (code != null && !code.isBlank() && !JungTypeCode.isLegal(code)) {
            // 严格校验：不 trim、不大写、不猜。IMFJ / XXXX / enfp 一律拒绝
            throw new JungApiException("INVALID_TYPE_CODE", 400,
                    "自我选择的类型码必须形如 ENFP（四个位置依次是 E/I、S/N、T/F、J/P）。");
        }
        String note = request == null ? null : request.note();
        if (note != null && note.length() > 500) {
            throw JungApiException.validation("备注最多 500 字。");
        }
        LocalDateTime now = time.nowUtc();
        jdbc.update("""
                INSERT INTO report_self_reflection
                  (report_id, user_id, self_selected_type_code, note, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE self_selected_type_code = VALUES(self_selected_type_code),
                                        note = VALUES(note), updated_at = VALUES(updated_at)
                """,
                reportId, userId, (code == null || code.isBlank()) ? null : code, note, now);

        // 明确不改 assessment_report 的任何列：问卷结果与个人理解并列保存
        return new JungDtos.SelfReflectionView(
                (code == null || code.isBlank()) ? null : code, note, TimeSource.isoFromUtc(now));
    }

    public JungDtos.SelfReflectionView selfReflection(String userId, String reportId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT self_selected_type_code, note, updated_at FROM report_self_reflection
                 WHERE report_id = ? AND user_id = ?
                """, reportId, userId);
        if (rows.isEmpty()) {
            return new JungDtos.SelfReflectionView(null, null, null);
        }
        Map<String, Object> row = rows.get(0);
        return new JungDtos.SelfReflectionView(
                (String) row.get("self_selected_type_code"),
                (String) row.get("note"),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("updated_at"))));
    }

    /* ── 删除 ───────────────────────────────────────────────────────────── */

    /**
     * 删除报告及其派生数据：报告 → attempt → 答案 → AI 任务/同意 → 自我理解。
     *
     * <p>删除顺序是刻意的：先删 AI 任务（`ai_analysis_job.report_id` 外键指向报告），
     * 再删自我理解，最后删报告本体。AI 表可能还没建（并行交付顺序），用 try/catch 容忍。
     */
    @Transactional
    public void delete(String userId, String reportId) {
        Map<String, Object> row = readReportRow(reportId, userId);
        String attemptId = (String) row.get("attempt_id");

        try {
            jdbc.update("DELETE FROM ai_consent WHERE job_id IN (SELECT id FROM ai_analysis_job WHERE report_id = ?)",
                    reportId);
            jdbc.update("DELETE FROM ai_analysis_job WHERE report_id = ?", reportId);
        } catch (org.springframework.jdbc.BadSqlGrammarException ex) {
            log.warn("AI 相关表尚不可用，跳过删除（reportId={}）：{}", reportId, ex.getMostSpecificCause().getMessage());
        }
        jdbc.update("DELETE FROM report_self_reflection WHERE report_id = ? AND user_id = ?", reportId, userId);
        jdbc.update("DELETE FROM assessment_report WHERE id = ? AND user_id = ?", reportId, userId);
        jdbc.update("DELETE FROM assessment_answer WHERE attempt_id = ?", attemptId);
        jdbc.update("DELETE FROM assessment_attempt WHERE id = ? AND user_id = ?", attemptId, userId);
    }

    /* ── 复测比较 ───────────────────────────────────────────────────────── */

    /**
     * 两次复测比较。
     *
     * <p>只有**同一内容包版本**才计算各维变化；不同版本只并列阅读并给出说明 ——
     * 题面变了却去算"成长幅度"是没有意义的。
     */
    public JungDtos.CompareResponse compare(String userId, List<String> reportIds) {
        if (reportIds == null || reportIds.size() != 2) {
            throw JungApiException.validation("请选择两份报告进行比较。");
        }
        if (reportIds.get(0).equals(reportIds.get(1))) {
            throw JungApiException.validation("请选择两份不同的报告。");
        }
        List<JungDtos.ReportSummary> summaries = new ArrayList<>(2);
        List<Map<String, Object>> reports = new ArrayList<>(2);
        for (String reportId : reportIds) {
            Map<String, Object> row = readReportRow(reportId, userId);
            Map<String, Object> report = readJsonMap((String) row.get("report_json"));
            reports.add(report);
            Map<String, Object> methodology = asMap(report.get("methodology"));
            JungDtos.ReportSummary summary = new JungDtos.ReportSummary(
                    reportId,
                    (String) row.get("attempt_id"),
                    TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("created_at"))),
                    (String) row.get("status"),
                    (String) row.get("computed_type_code"),
                    null,
                    asString(report.get("summary")),
                    methodology == null ? null : asString(methodology.get("packageId")),
                    methodology == null ? null : asString(methodology.get("scoringVersion")));
            summaries.add(summary);
        }

        Map<String, Object> first = reports.get(0);
        Map<String, Object> second = reports.get(1);
        Map<String, Object> firstMethod = asMap(first.get("methodology"));
        Map<String, Object> secondMethod = asMap(second.get("methodology"));
        boolean samePackage = firstMethod != null && secondMethod != null
                && java.util.Objects.equals(firstMethod.get("packageId"), secondMethod.get("packageId"))
                && java.util.Objects.equals(firstMethod.get("scoringVersion"), secondMethod.get("scoringVersion"));

        List<JungDtos.DimensionDifference> differences = new ArrayList<>(4);
        List<String> notes = new ArrayList<>();
        Map<String, Object> firstDimensions = dimensionIndex(first);
        Map<String, Object> secondDimensions = dimensionIndex(second);
        for (JungDimension dimension : JungDimension.values()) {
            Map<String, Object> a = asMap(firstDimensions.get(dimension.name()));
            Map<String, Object> b = asMap(secondDimensions.get(dimension.name()));
            if (a == null || b == null) {
                continue;
            }
            String fromPole = asString(a.get("computedPole"));
            String toPole = asString(b.get("computedPole"));
            Double fromM = asDouble(a.get("mFinal"));
            Double toM = asDouble(b.get("mFinal"));
            differences.add(new JungDtos.DimensionDifference(
                    dimension.name(),
                    fromPole,
                    toPole,
                    fromM,
                    toM,
                    samePackage && !java.util.Objects.equals(fromPole, toPole)));
        }
        if (!samePackage) {
            notes.add("两次测评用的题目或规则版本不同，只并列阅读，不计算变化幅度。");
        } else {
            notes.add("两次作答的时间、状态与当时的理解都可能影响结果，变化不等于成长或退步。");
        }

        return new JungDtos.CompareResponse(summaries, differences, samePackage, notes);
    }

    /* ── 导出 ───────────────────────────────────────────────────────────── */

    /**
     * 导出本人数据。
     *
     * <p>**不含**密码 hash、恢复码 hash、内部会话、幂等记录。
     * 这些字段在 SQL 里就不选，而不是查出来再删 —— 少一次"忘了删"的机会。
     */
    public Map<String, Object> exportData(String userId) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("exportedAt", TimeSource.iso(time.now()));
        data.put("schemaVersion", 1);
        data.put("attempts", jdbc.queryForList("""
                SELECT id, package_id, status, revision, current_question_id,
                       clarification_dimensions, clarification_skipped, base_attempt_id,
                       started_at, updated_at, submitted_at
                  FROM assessment_attempt WHERE user_id = ? ORDER BY started_at
                """, userId));
        data.put("answers", jdbc.queryForList("""
                SELECT aa.attempt_id, aa.question_id, aa.kind, aa.rating, aa.updated_at
                  FROM assessment_answer aa
                  JOIN assessment_attempt a ON a.id = aa.attempt_id
                 WHERE a.user_id = ? ORDER BY aa.attempt_id, aa.question_id
                """, userId));
        List<Map<String, Object>> reports = jdbc.queryForList("""
                SELECT id, attempt_id, status, computed_type_code, score_json, report_json,
                       report_hash, created_at
                  FROM assessment_report WHERE user_id = ? ORDER BY created_at
                """, userId);
        for (Map<String, Object> report : reports) {
            Object timestamp = report.get("created_at");
            if (timestamp instanceof LocalDateTime utc) {
                report.put("created_at", TimeSource.isoFromUtc(utc));
            }
        }
        data.put("reports", reports);
        data.put("selfReflections", jdbc.queryForList("""
                SELECT report_id, self_selected_type_code, note, updated_at
                  FROM report_self_reflection WHERE user_id = ? ORDER BY updated_at
                """, userId));
        try {
            data.put("aiAnalyses", jdbc.queryForList("""
                    SELECT id, report_id, topic, prompt_version, model_requested, model_returned,
                           status, error_code, usage_json, response_json, created_at, finished_at
                      FROM ai_analysis_job WHERE user_id = ? ORDER BY created_at
                    """, userId));
        } catch (org.springframework.jdbc.BadSqlGrammarException ex) {
            log.warn("AI 相关表尚不可用，导出中 AI 部分为空：{}", ex.getMostSpecificCause().getMessage());
            data.put("aiAnalyses", List.of());
        }
        return data;
    }

    /* ── 内部工具 ───────────────────────────────────────────────────────── */

    Map<String, Object> readReportRow(String reportId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, attempt_id, user_id, status, computed_type_code, report_json, report_hash, created_at
                  FROM assessment_report WHERE id = ? AND user_id = ?
                """, reportId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份报告");
        }
        return rows.get(0);
    }

    /**
     * 锁定读报告行（当前读）。**"重复提交被唯一约束拦截"那条分支必须用它。**
     *
     * <p>2026-09-18 在真实 MySQL 8.4 上确认过的失败形态：两个并发提交里，第二个事务的
     * 快照建立于它自己的第一条 SELECT（`requireRow`）。第一个事务随后提交了报告行，
     * 而那一行对第二个事务的**普通一致性读永远不可见** —— 于是"唯一约束已经拦住了
     * 重复插入"之后却读不到既有报告，`readReportRow` 抛 404「这份报告」。
     * 用户提交成功了却被告知报告不存在。
     *
     * <p>`FOR UPDATE` 是当前读：能看到最新已提交版本（也会等对方事务结束再返回）。
     * 顺带把这一行锁住，避免第三个并发请求在读到行之后、返回之前又被删掉。
     */
    Map<String, Object> readReportRowForUpdate(String reportId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, attempt_id, user_id, status, computed_type_code, report_json, report_hash, created_at
                  FROM assessment_report WHERE id = ? AND user_id = ? FOR UPDATE
                """, reportId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份报告");
        }
        return rows.get(0);
    }

    private Map<String, Object> scoreJson(JungPackage pkg, JungScoringResult result, String reportHash) {
        Map<String, Object> score = new LinkedHashMap<>();
        score.put("scoringVersion", pkg.scoringVersion());
        score.put("status", result.status().name());
        score.put("computedTypeCode", result.computedTypeCode() == null ? null : result.computedTypeCode().value());
        score.put("coverageOk", result.coverageOk());
        score.put("tiedDimensions", result.tiedDimensions().stream().map(JungDimension::name).toList());
        score.put("clarificationDimensions",
                result.clarificationDimensions().stream().map(JungDimension::name).toList());
        score.put("clarificationSkipped", result.clarificationSkipped());
        List<Map<String, Object>> dimensions = new ArrayList<>(4);
        for (var dimension : result.dimensions()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("dimension", dimension.dimension().name());
            row.put("SBase", dimension.baseS());
            row.put("nBase", dimension.baseN());
            row.put("SFinal", dimension.finalS());
            row.put("nFinal", dimension.finalN());
            row.put("mFinal", dimension.finalM());
            row.put("computedPole", dimension.computedPole() == null
                    ? null : String.valueOf(dimension.computedPole().letter()));
            row.put("boundary", dimension.boundary());
            row.put("clarificationApplied", dimension.effective());
            dimensions.add(row);
        }
        score.put("dimensions", dimensions);
        score.put("candidates", result.candidates().stream()
                .map(candidate -> Map.of(
                        "typeCode", candidate.typeCode().value(),
                        "cost", candidate.cost()))
                .toList());
        score.put("reportHash", reportHash);
        return score;
    }

    private String summaryLine(String reportJson) {
        Map<String, Object> report = reportBody(readJsonMap(reportJson));
        String summary = asString(report.get("summary"));
        if (summary == null) {
            return "";
        }
        return summary.length() <= 80 ? summary : summary.substring(0, 80) + "…";
    }

    /**
     * 取出报告体：v2 报告是"中性外壳 + {@code report} 体"，v1 报告体就是根节点。
     *
     * <p>这个判断只做一次并且**只用于读**：历史报告的结构一个字节都不能改。
     * 判据是"根节点有 {@code report} 且它是个对象"，而不是 schemaVersion ——
     * 有些早期快照没有写 schemaVersion 字段，用版本号判会把它们误判成 v2。
     */
    private static Map<String, Object> reportBody(Map<String, Object> root) {
        Map<String, Object> nested = asMap(root.get("report"));
        return nested == null ? root : nested;
    }

    /**
     * 按内容包取计分版本；包已经不在 classpath 时返回 {@code null} 而不是抛错。
     *
     * <p>列表页是"能看到的都列出来"：某一份历史报告的旧内容包已经下线，
     * 不应该让整页 500（那份报告本身仍然可以按快照打开）。
     */
    private String scoringVersionOf(String packageId) {
        JungPackage pkg = loader.find(packageId);
        return pkg == null ? null : pkg.scoringVersion();
    }

    private Map<String, Object> dimensionIndex(Map<String, Object> report) {
        Map<String, Object> source = reportBody(report);
        Map<String, Object> index = new LinkedHashMap<>();
        Object value = source.get("dimensions");
        if (value instanceof List<?> list) {
            for (Object item : list) {
                Map<String, Object> row = asMap(item);
                if (row != null) {
                    index.put(asString(row.get("dimension")), row);
                }
            }
        }
        return index;
    }

    private List<String> candidateCodesFromJson(String reportJson) {
        Map<String, Object> report = reportBody(readJsonMap(reportJson));
        List<String> codes = new ArrayList<>();
        Object value = report.get("candidates");
        if (value instanceof List<?> list) {
            for (Object item : list) {
                Map<String, Object> row = asMap(item);
                if (row != null) {
                    codes.add(asString(row.get("typeCode")));
                }
            }
        }
        return List.copyOf(codes);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJsonMap(String json) {
        try {
            return mapper.readValue(json, LinkedHashMap.class);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("报告 JSON 无法解析（数据被外部改写过？）", ex);
        }
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("报告 JSON 无法序列化", ex);
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : null;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static Double asDouble(Object value) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        return value == null ? null : Double.valueOf(String.valueOf(value));
    }
}
