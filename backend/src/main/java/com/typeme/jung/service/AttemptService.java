package com.typeme.jung.service;

import com.typeme.jung.api.JungDtos;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungStage;
import com.typeme.jung.scoring.JungScorer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 测评 attempt：草稿、答案保存、覆盖检查与澄清安排。
 *
 * <p>所有查询都带 `user_id = ?`。**"id 不易枚举"不算鉴权**：每个按 id 取资源的方法都必须
 * 显式校验 owner，找不到时返回 404（与"不存在"同形），不返回 403 —— 否则 403/404 的差别
 * 就成了枚举别人资源是否存在的接口。
 *
 * <p>并发用 `revision` 乐观锁：客户端必须带上它读到的 `expectedRevision`。冲突返回 409 并附
 * `currentRevision`，让前端提示"另一台设备已更新进度"并让用户选择 —— 而不是整份 last-write-wins。
 */
@Service
public class AttemptService {

    private static final Set<String> ATTEMPT_STATUSES = Set.of(
            "BASE_IN_PROGRESS", "CLARIFICATION_IN_PROGRESS", "SUBMITTED");

    private final JdbcTemplate jdbc;
    private final JungPackageLoader loader;
    private final TimeSource time;

    public AttemptService(JdbcTemplate jdbc, JungPackageLoader loader, TimeSource time) {
        this.jdbc = jdbc;
        this.loader = loader;
        this.time = time;
    }

    /* ── 创建与读取 ─────────────────────────────────────────────────────── */

    /**
     * 新建 attempt。`baseReportId` 非空时必须属于同一用户（"从旧报告派生"），
     * 派生出来的 attempt 只记录来源 id，**不复制**旧答案 —— 复测要重新作答。
     */
    @Transactional
    public JungDtos.AttemptSummary create(String userId, String baseReportId) {
        JungPackage pkg = loader.current();
        // 先确认内容包已经登记在 assessment_package 里。
        // 建表时有指向它的外键，没登记就插入会得到一个外键违例 —— 那会被上层当成
        // "服务故障"（500）而真实原因是"部署时内容未就绪"。这里提前给出 503 +
        // PACKAGE_NOT_SEEDED，让运维一眼看出是内容没落库而不是数据库坏了。
        // 正常情况下 JungPackageRegistrar 在启动期已经登记过，这个分支只在
        // "有人删了那行 / 迁移与内容版本不匹配"时命中。
        Integer packageRows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?",
                Integer.class, pkg.packageId());
        if (packageRows == null || packageRows == 0) {
            throw JungApiException.packageNotSeeded(pkg.packageId());
        }
        String baseAttemptId = null;
        if (baseReportId != null && !baseReportId.isBlank()) {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT attempt_id FROM assessment_report WHERE id = ? AND user_id = ?",
                    baseReportId, userId);
            if (rows.isEmpty()) {
                throw JungApiException.notFound("要派生的报告");
            }
            baseAttemptId = (String) rows.get(0).get("attempt_id");
        }

        String attemptId = UUID.randomUUID().toString();
        LocalDateTime now = time.nowUtc();
        String firstQuestionId = pkg.baseItems().isEmpty() ? null : pkg.baseItems().get(0).id();

        jdbc.update("""
                INSERT INTO assessment_attempt
                  (id, user_id, package_id, status, revision, current_question_id,
                   clarification_dimensions, clarification_skipped, base_attempt_id,
                   started_at, updated_at, submitted_at)
                VALUES (?, ?, ?, 'BASE_IN_PROGRESS', 0, ?, '', 0, ?, ?, ?, NULL)
                """,
                attemptId, userId, pkg.packageId(), firstQuestionId, baseAttemptId, now, now);

        return new JungDtos.AttemptSummary(
                attemptId, pkg.packageId(), "BASE_IN_PROGRESS", 0, firstQuestionId,
                List.of(), false, TimeSource.isoFromUtc(now), TimeSource.isoFromUtc(now), null, null);
    }

    public JungDtos.AttemptListResponse list(String userId, String statusFilter, int page, int size) {
        int safePage = Math.max(0, page);
        int safeSize = Math.min(50, Math.max(1, size));
        boolean filterSubmitted = "submitted".equalsIgnoreCase(statusFilter);
        boolean filterDraft = "draft".equalsIgnoreCase(statusFilter);

        String where = "WHERE a.user_id = ?";
        List<Object> args = new ArrayList<>();
        args.add(userId);
        if (filterSubmitted) {
            where += " AND a.status = 'SUBMITTED'";
        } else if (filterDraft) {
            where += " AND a.status <> 'SUBMITTED'";
        }

        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_attempt a " + where, Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(safeSize);
        pageArgs.add(safePage * safeSize);

        List<JungDtos.AttemptSummary> items = jdbc.query("""
                SELECT a.id, a.package_id, a.status, a.revision, a.current_question_id,
                       a.clarification_dimensions, a.clarification_skipped,
                       a.started_at, a.updated_at, a.submitted_at,
                       (SELECT r.id FROM assessment_report r WHERE r.attempt_id = a.id) AS report_id
                  FROM assessment_attempt a
                """ + where + " ORDER BY a.updated_at DESC LIMIT ? OFFSET ?",
                (rs, rowNum) -> new JungDtos.AttemptSummary(
                        rs.getString("id"),
                        rs.getString("package_id"),
                        rs.getString("status"),
                        rs.getLong("revision"),
                        rs.getString("current_question_id"),
                        splitDimensions(rs.getString("clarification_dimensions")),
                        rs.getBoolean("clarification_skipped"),
                        TimeSource.isoFromUtc(rs.getObject("started_at", LocalDateTime.class)),
                        TimeSource.isoFromUtc(rs.getObject("updated_at", LocalDateTime.class)),
                        TimeSource.isoFromUtc(rs.getObject("submitted_at", LocalDateTime.class)),
                        rs.getString("report_id")),
                pageArgs.toArray());

        return new JungDtos.AttemptListResponse(items, safePage, safeSize, total == null ? 0 : total);
    }

    /** 读取 attempt 详情（含锁定包的题目快照，答题页只需要这一次请求）。 */
    public JungDtos.AttemptDetail detail(String userId, String attemptId) {
        Map<String, Object> row = requireRow(userId, attemptId);
        JungPackage pkg = loader.current();
        if (!pkg.packageId().equals(row.get("package_id"))) {
            // 历史 attempt 指向的内容包与当前发布包不同：明确报错，绝不拿新题面套旧答案
            throw new JungApiException("PACKAGE_UNAVAILABLE", 409,
                    "这份测评锁定的题目版本当前不可用，不能继续作答。");
        }
        List<JungDtos.AnswerView> answers = readAnswers(attemptId);
        return new JungDtos.AttemptDetail(
                attemptId,
                (String) row.get("package_id"),
                (String) row.get("status"),
                ((Number) row.get("revision")).longValue(),
                (String) row.get("current_question_id"),
                splitDimensions((String) row.get("clarification_dimensions")),
                toBoolean(row.get("clarification_skipped")),
                TimeSource.isoFromUtc((LocalDateTime) row.get("started_at")),
                TimeSource.isoFromUtc((LocalDateTime) row.get("updated_at")),
                TimeSource.isoFromUtc((LocalDateTime) row.get("submitted_at")),
                (String) row.get("base_attempt_id"),
                findReportId(attemptId),
                answers,
                coverageViews(JungScorer.checkCoverage(pkg, answerMap(answers))),
                JungDtos.packageView(loader));
    }

    /* ── 答案保存 ───────────────────────────────────────────────────────── */

    /**
     * 批量合并答案（PATCH 语义）。
     *
     * <p>**任一条非法就整批拒绝**，不做部分裁剪：静默丢弃非法项会让用户以为答案存上了。
     * 澄清阶段改主测答案会退回主测并清除已安排的澄清题与已答的澄清答案 —— 这是明确的
     * 用户改答行为，且**不**自动清空 48 道主测答案。
     */
    @Transactional
    public JungDtos.PatchAnswersResponse patchAnswers(
            String userId, String attemptId, JungDtos.PatchAnswersRequest request) {

        Map<String, Object> row = requireRow(userId, attemptId);
        if ("SUBMITTED".equals(row.get("status"))) {
            throw new JungApiException("ATTEMPT_SUBMITTED", 409,
                    "这份测评已经提交，报告不可修改。想改答案请从旧报告派生一份新的测评。");
        }
        if (request == null || request.expectedRevision() == null) {
            throw JungApiException.validation("缺少 expectedRevision：并发控制必须由客户端带上它读到的版本号。");
        }
        long currentRevision = ((Number) row.get("revision")).longValue();
        if (request.expectedRevision() != currentRevision) {
            throw JungApiException.conflict("另一台设备已经更新了这份草稿，请先读取最新版本再合并。",
                    Map.of("currentRevision", currentRevision));
        }
        if (request.responses() == null || request.responses().isEmpty()) {
            if (request.currentQuestionId() == null) {
                throw JungApiException.validation("responses 与 currentQuestionId 不能同时为空。");
            }
        }

        JungPackage pkg = loader.current();
        Set<JungDimension> scheduled = parseDimensions((String) row.get("clarification_dimensions"));
        String currentStatus = (String) row.get("status");

        List<JungDtos.ResponseInput> inputs = request.responses() == null ? List.of() : request.responses();
        List<JungAnswer> toWrite = new ArrayList<>(inputs.size());
        boolean touchesBase = false;
        boolean touchesClarification = false;
        Set<String> seen = new LinkedHashSet<>();

        for (JungDtos.ResponseInput input : inputs) {
            if (input == null || input.questionId() == null) {
                throw JungApiException.invalid("每条回答都必须有 questionId。");
            }
            if (!seen.add(input.questionId())) {
                throw JungApiException.invalid("同一次请求里重复出现题号：" + input.questionId());
            }
            JungItem item = pkg.item(input.questionId());
            if (item == null) {
                throw JungApiException.invalid("未知题号：" + input.questionId());
            }
            if (item.stage() == JungStage.CLARIFICATION && !scheduled.contains(item.dimension())) {
                // 未安排的澄清题不能提交：否则用户就能自由挑对自己有利的题
                throw JungApiException.invalid("这一维的补充题还没有安排，不能提交：" + input.questionId());
            }
            String kind = input.kind() == null ? null : input.kind().trim().toUpperCase(java.util.Locale.ROOT);
            if ("RATING".equals(kind)) {
                if (input.rating() == null || input.rating() < 1 || input.rating() > 5) {
                    throw JungApiException.invalid("分值必须是 1..5：" + input.questionId());
                }
                toWrite.add(JungAnswer.rating(input.questionId(), input.rating()));
            } else if ("UNKNOWN".equals(kind)) {
                if (input.rating() != null) {
                    throw JungApiException.invalid("「无法判断」不能同时带分值：" + input.questionId());
                }
                toWrite.add(JungAnswer.unknown(input.questionId()));
            } else {
                throw JungApiException.invalid("kind 只能是 RATING 或 UNKNOWN：" + input.questionId());
            }
            if (item.stage() == JungStage.BASE) {
                touchesBase = true;
            } else {
                touchesClarification = true;
            }
        }

        if (request.currentQuestionId() != null && !pkg.hasItem(request.currentQuestionId())) {
            throw JungApiException.invalid("currentQuestionId 不是本内容包的题目：" + request.currentQuestionId());
        }

        // 澄清阶段改主测答案 → 退回主测，清掉旧的澄清安排与澄清答案
        boolean resetClarification = "CLARIFICATION_IN_PROGRESS".equals(currentStatus) && touchesBase;
        boolean wasScheduled = !scheduled.isEmpty();

        for (JungAnswer answer : toWrite) {
            jdbc.update("""
                    INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE kind = VALUES(kind), rating = VALUES(rating), updated_at = VALUES(updated_at)
                    """,
                    attemptId, answer.questionId(), answer.kind().name(), answer.rating(), time.nowUtc());
        }

        String nextStatus = currentStatus;
        if (resetClarification) {
            jdbc.update("DELETE FROM assessment_answer WHERE attempt_id = ? AND question_id LIKE '%-C%'", attemptId);
            jdbc.update("""
                    UPDATE assessment_attempt
                       SET clarification_dimensions = '', clarification_skipped = 0, status = 'BASE_IN_PROGRESS'
                     WHERE id = ? AND user_id = ?
                    """, attemptId, userId);
            nextStatus = "BASE_IN_PROGRESS";
            scheduled = new LinkedHashSet<>();
        } else if (wasScheduled) {
            nextStatus = "CLARIFICATION_IN_PROGRESS";
        }

        long newRevision = currentRevision + 1;
        LocalDateTime now = time.nowUtc();
        jdbc.update("""
                UPDATE assessment_attempt
                   SET revision = ?, current_question_id = COALESCE(?, current_question_id),
                       updated_at = ?, status = ?
                 WHERE id = ? AND user_id = ? AND revision = ?
                """,
                newRevision,
                request.currentQuestionId(),
                now,
                nextStatus,
                attemptId,
                userId,
                currentRevision);

        // 上面的 UPDATE 带 revision 条件；受影响 0 行说明并发插入抢先，按冲突返回
        Integer affected = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_attempt WHERE id = ? AND revision = ?",
                Integer.class, attemptId, newRevision);
        if (affected == null || affected == 0) {
            throw JungApiException.conflict("另一台设备已经更新了这份草稿，请先读取最新版本再合并。",
                    Map.of("currentRevision", currentRevision));
        }

        return new JungDtos.PatchAnswersResponse(
                newRevision,
                nextStatus,
                orderedDimensions(scheduled),
                resetClarification && wasScheduled,
                request.currentQuestionId() == null
                        ? (String) row.get("current_question_id")
                        : request.currentQuestionId());
    }

    /* ── review ─────────────────────────────────────────────────────────── */

    /**
     * 覆盖检查 + 固定澄清题集合。幂等：重复调用返回同一结果。
     *
     * <p>触发集合由**服务端**决定并写入 attempt；客户端不能自行指定要答哪些补充题。
     */
    @Transactional
    public JungDtos.ReviewResponse review(String userId, String attemptId) {
        Map<String, Object> row = requireRow(userId, attemptId);
        if ("SUBMITTED".equals(row.get("status"))) {
            throw new JungApiException("ATTEMPT_SUBMITTED", 409, "这份测评已经提交。");
        }
        JungPackage pkg = loader.current();
        Map<String, JungAnswer> answers = answerMap(readAnswers(attemptId));
        JungScorer.CoverageReport coverage = JungScorer.checkCoverage(pkg, answers);

        if (!coverage.coverageOk()) {
            return new JungDtos.ReviewResponse(
                    (String) row.get("status"),
                    true,
                    splitDimensions((String) row.get("clarification_dimensions")),
                    coverageViews(coverage),
                    coverage.insufficientDimensions(pkg.scoringPolicy().minBaseRatingsPerDimension()).stream()
                            .map(JungDimension::name).toList());
        }

        List<JungDimension> needs = JungScorer.reviewClarification(pkg, answers);
        Set<JungDimension> previous = parseDimensions((String) row.get("clarification_dimensions"));
        Set<JungDimension> next = new LinkedHashSet<>(needs);

        boolean changed = !previous.equals(next);
        if (changed) {
            // 不再安排的维度：清掉它的澄清答案，避免留下"无主答案"被后续提交读到
            Set<JungDimension> removed = new LinkedHashSet<>(previous);
            removed.removeAll(next);
            for (JungDimension dimension : removed) {
                List<String> ids = pkg.clarificationItems(dimension).stream().map(JungItem::id).toList();
                for (String id : ids) {
                    jdbc.update("DELETE FROM assessment_answer WHERE attempt_id = ? AND question_id = ?",
                            attemptId, id);
                }
            }
        }

        String nextStatus = next.isEmpty() ? "BASE_IN_PROGRESS" : "CLARIFICATION_IN_PROGRESS";
        jdbc.update("""
                UPDATE assessment_attempt
                   SET clarification_dimensions = ?, status = ?, updated_at = ?
                 WHERE id = ? AND user_id = ?
                """,
                orderDimensions(next), nextStatus, time.nowUtc(), attemptId, userId);
        return new JungDtos.ReviewResponse(
                nextStatus,
                false,
                orderedDimensions(next),
                coverageViews(coverage),
                List.of());
    }

    /* ── 删除草稿 ───────────────────────────────────────────────────────── */

    @Transactional
    public void deleteDraft(String userId, String attemptId) {
        Map<String, Object> row = requireRow(userId, attemptId);
        if ("SUBMITTED".equals(row.get("status"))) {
            throw new JungApiException("ATTEMPT_SUBMITTED", 409,
                    "已提交的测评不能删除。要删除已生成的报告，请使用报告删除入口。");
        }
        jdbc.update("DELETE FROM assessment_answer WHERE attempt_id = ?", attemptId);
        jdbc.update("DELETE FROM assessment_attempt WHERE id = ? AND user_id = ?", attemptId, userId);
    }

    /* ── 内部工具（供 ReportService 复用） ─────────────────────────────── */

    /** 取 attempt 行并校验 owner；不存在或不属于当前用户都返回 404 同形。 */
    Map<String, Object> requireRow(String userId, String attemptId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, user_id, package_id, status, revision, current_question_id,
                       clarification_dimensions, clarification_skipped, base_attempt_id,
                       started_at, updated_at, submitted_at
                  FROM assessment_attempt WHERE id = ? AND user_id = ?
                """, attemptId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份测评");
        }
        return rows.get(0);
    }

    List<JungDtos.AnswerView> readAnswers(String attemptId) {
        return jdbc.query("""
                SELECT question_id, kind, rating FROM assessment_answer
                 WHERE attempt_id = ? ORDER BY question_id
                """,
                (rs, rowNum) -> new JungDtos.AnswerView(
                        rs.getString("question_id"),
                        rs.getString("kind"),
                        rs.getObject("rating") == null ? null : rs.getInt("rating")),
                attemptId);
    }

    Map<String, JungAnswer> answerMap(List<JungDtos.AnswerView> answers) {
        Map<String, JungAnswer> map = new LinkedHashMap<>();
        for (JungDtos.AnswerView answer : answers) {
            if ("RATING".equals(answer.kind()) && answer.rating() != null) {
                map.put(answer.questionId(), JungAnswer.rating(answer.questionId(), answer.rating()));
            } else {
                map.put(answer.questionId(), JungAnswer.unknown(answer.questionId()));
            }
        }
        return map;
    }

    List<JungDtos.CoverageView> coverageViews(JungScorer.CoverageReport report) {
        int min = loader.current().scoringPolicy().minBaseRatingsPerDimension();
        List<JungDtos.CoverageView> views = new ArrayList<>(4);
        for (var coverage : report.coverages()) {
            views.add(new JungDtos.CoverageView(
                    coverage.dimension().name(),
                    coverage.baseRatingCount(),
                    coverage.baseUnknownCount(),
                    coverage.baseUnprocessedCount(),
                    coverage.needsClarification(),
                    coverage.coverageOk(min)));
        }
        return List.copyOf(views);
    }

    String findReportId(String attemptId) {
        List<String> ids = jdbc.queryForList(
                "SELECT id FROM assessment_report WHERE attempt_id = ?", String.class, attemptId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /**
     * 把 `clarification_dimensions` 列的 CSV 还原成维度集合。
     *
     * <p>与 {@link #splitDimensions(String)} 的区别是返回枚举集合而不是字符串列表：
     * 调用方几乎都要拿它做 {@code contains} / 集合比较，用字符串会让"E"与"EI"这类
     * 拼写错误一路滑到业务逻辑里才发现。解析仍然走 {@link JungDimension#of}，
     * 碰到库里存了脏值当场报错，而不是静默丢一个维度（丢维度会让用户看到少一维的报告）。
     */
    static Set<JungDimension> parseDimensions(String csv) {
        Set<JungDimension> result = new LinkedHashSet<>(4);
        for (String token : splitDimensions(csv)) {
            result.add(JungDimension.of(token));
        }
        return result;
    }

    /** 按权威序把维度集合转成列表，供 DTO 回显。 */
    static List<String> orderedDimensions(Set<JungDimension> dimensions) {
        return splitDimensions(orderDimensions(dimensions));
    }

    static List<String> splitDimensions(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        List<String> result = new ArrayList<>(4);
        for (String token : csv.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            result.add(JungDimension.of(trimmed).name());
        }
        return List.copyOf(result);
    }

    /** 按权威序 `EI,SN,TF,JP` 序列化维度集合。 */
    static String orderDimensions(Set<JungDimension> dimensions) {
        if (dimensions.isEmpty()) {
            return "";
        }
        List<String> ordered = new ArrayList<>(4);
        for (JungDimension dimension : JungDimension.values()) {
            if (dimensions.contains(dimension)) {
                ordered.add(dimension.name());
            }
        }
        return String.join(",", ordered);
    }

    static boolean toBoolean(Object value) {
        if (value == null) {
            return false;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        if (value instanceof Number number) {
            return number.intValue() != 0;
        }
        return Boolean.parseBoolean(String.valueOf(value));
    }

    /** 便于测试断言：把 attempt 的答案转成计分器要的 map。 */
    Map<JungDimension, List<JungAnswer>> answersByDimension(String attemptId) {
        Map<JungDimension, List<JungAnswer>> result = new EnumMap<>(JungDimension.class);
        for (JungDimension dimension : JungDimension.values()) {
            result.put(dimension, new ArrayList<>());
        }
        for (JungAnswer answer : answerMap(readAnswers(attemptId)).values()) {
            JungItem item = loader.current().item(answer.questionId());
            if (item != null) {
                result.get(item.dimension()).add(answer);
            }
        }
        return result;
    }

    /** 供控制器断言状态枚举；防止有人往数据库写第四个状态。 */
    static void assertKnownStatus(String status) {
        if (!ATTEMPT_STATUSES.contains(status)) {
            throw new IllegalStateException("未知的 attempt 状态：" + status);
        }
    }
}
