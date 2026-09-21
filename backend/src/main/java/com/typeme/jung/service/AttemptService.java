package com.typeme.jung.service;

import com.typeme.jung.api.JungDtos;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungStage;
import com.typeme.jung.scoring.JungScorer;
import com.typeme.platform.catalog.AssessmentRelease;
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

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AttemptService.class);

    private static final Set<String> ATTEMPT_STATUSES = Set.of(
            "BASE_IN_PROGRESS", "CLARIFICATION_IN_PROGRESS", "SUBMITTED");

    private final JdbcTemplate jdbc;
    private final JungPackageLoader loader;
    private final TimeSource time;
    private final IdempotencyGuard idempotency;

    public AttemptService(JdbcTemplate jdbc, JungPackageLoader loader, TimeSource time,
                          IdempotencyGuard idempotency) {
        this.jdbc = jdbc;
        this.loader = loader;
        this.time = time;
        this.idempotency = idempotency;
    }

    /** 幂等表里的操作名（契约 02 §6.1 列出的三个之一）。 */
    private static final String OP_CREATE_ATTEMPT = "create_attempt";

    /* ── 创建与读取 ─────────────────────────────────────────────────────── */

    /**
     * 新建 attempt（**幂等**）。`baseReportId` 非空时必须属于同一用户（"从旧报告派生"），
     * 派生出来的 attempt 只记录来源 id，**不复制**旧答案 —— 复测要重新作答。
     *
     * <p>带上 `Idempotency-Key` 时，同一个键 + 同一份请求内容只会产生**一份**草稿：
     * 第一次创建资源，之后每次重放都返回第一次那个 `attemptId`（契约 02 §6.1）。
     * 这条路径是为"请求超时/断网，用户点重试"准备的 —— 没有它，用户每点一次重试
     * 就多一份自己**看不见**的草稿（草稿列表当时还没做，`GET /attempts?status=draft`
     * 虽然存在但没有前端消费者）。
     *
     * <p><b>为什么占用 / 创建 / 标记完成分三个事务</b>：
     * <ul>
     *   <li>占用必须在自己的事务里立即提交，否则并发同 key 的两个请求会**都**以为
     *       自己占到了（互相看不见对方未提交的行）；</li>
     *   <li>资源创建保持原样的事务边界（它自己会写 attempt 行）；</li>
     *   <li>标记完成若与创建同事务，一旦创建成功而标记失败就会连资源一起回滚 ——
     *       而我们要的恰恰相反：**资源已经存在**，记录没写成只是下次重放会多建一份，
     *       所以标记失败只记日志、不影响这次响应。</li>
     * </ul>
     */
    public JungDtos.AttemptSummary create(
            String userId, String baseReportId, String idempotencyKey, AssessmentRelease release) {
        String key = IdempotencyGuard.normalizeKey(idempotencyKey);
        if (key == null) {
            return createOnce(userId, baseReportId, release);
        }
        IdempotencyGuard.requireUsableKey(key);
        // 指纹里必须包含**这一版内容包**：同一个 Idempotency-Key 先后用于两个不同版本的量表
        // 是两件不同的事，指纹相同会让第二次重放直接拿到另一个版本的草稿。
        String hash = IdempotencyGuard.fingerprint(OP_CREATE_ATTEMPT, release.packageId(), baseReportId);

        // 1) 这个键已经完成过 → 把上次那个资源原样还回去（不新建）。
        String replayId = idempotency.completedRef(userId, OP_CREATE_ATTEMPT, key, hash);
        if (replayId != null) {
            JungDtos.AttemptSummary replay = findSummary(userId, replayId);
            if (replay != null) {
                return replay;
            }
            // 记录指向的测评已经不在了（被删、或账号注销清理过）：
            // 不能让一条悬空记录把这个键永久占用，清掉后走新建。
            // 注意这里必须删整行（release 只删 IN_PROGRESS）：留着一行 COMPLETED
            // 会让"用户删掉草稿后再点一次"永远拿到一个 404 的 id。
            idempotency.forgetDangling(userId, OP_CREATE_ATTEMPT, key, replayId);
        }

        // 2) 占用这个键。拿不到说明同一个键的另一个请求正在处理中。
        if (!idempotency.claim(userId, OP_CREATE_ATTEMPT, key, hash)) {
            String racedId = idempotency.completedRef(userId, OP_CREATE_ATTEMPT, key, hash);
            if (racedId != null) {
                JungDtos.AttemptSummary raced = findSummary(userId, racedId);
                if (raced != null) {
                    return raced;
                }
            }
            throw JungApiException.idempotencyInProgress();
        }

        // 3) 真正创建。失败就把占用释放掉，让用户的重试能重新走这条路
        //    （不释放的话他会在 2 分钟内一直看到"上一次请求还在处理中"）。
        JungDtos.AttemptSummary created;
        try {
            created = createOnce(userId, baseReportId, release);
        } catch (RuntimeException e) {
            idempotency.release(userId, OP_CREATE_ATTEMPT, key);
            throw e;
        }
        try {
            idempotency.complete(userId, OP_CREATE_ATTEMPT, key, created.attemptId());
        } catch (RuntimeException e) {
            // 资源已经建好了：绝不能因为"记不上账"就让用户以为失败（他会再点一次，
            // 而重放此时拿不到记录 → 又建一份）。所以只记日志，响应照常返回。
            log.warn("idempotency complete failed (attempt already created), attemptId={}", created.attemptId(), e);
        }
        return created;
    }

    /** 按 id 取一份"本来就属于这个用户"的摘要；不属于/不存在都返回 null。 */
    private JungDtos.AttemptSummary findSummary(String userId, String attemptId) {
        List<JungDtos.AttemptSummary> rows = jdbc.query("""
                SELECT a.id, a.package_id, a.status, a.revision, a.current_question_id,
                       a.clarification_dimensions, a.clarification_skipped,
                       a.started_at, a.updated_at, a.submitted_at,
                       (SELECT r.id FROM assessment_report r WHERE r.attempt_id = a.id) AS report_id
                  FROM assessment_attempt a
                 WHERE a.id = ? AND a.user_id = ?
                """, (rs, rowNum) -> new JungDtos.AttemptSummary(
                        rs.getString("id"),
                        rs.getString("package_id"),
                        rs.getString("status"),
                        rs.getLong("revision"),
                        rs.getString("current_question_id"),
                        splitDimensions(rs.getString("clarification_dimensions")),
                        rs.getBoolean("clarification_skipped"),
                        // 与 list() 一样按目标类型取时间列：H2 给 Timestamp、Connector/J 给
                        // LocalDateTime，直接强转会只在其中一个引擎上炸（第 3 轮的 A5）。
                        TimeSource.isoFromUtc(rs.getObject("started_at", LocalDateTime.class)),
                        TimeSource.isoFromUtc(rs.getObject("updated_at", LocalDateTime.class)),
                        TimeSource.isoFromUtc(rs.getObject("submitted_at", LocalDateTime.class)),
                        rs.getString("report_id")),
                attemptId, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * 真正插入一份新草稿（无幂等语义）。
     *
     * <p>先确认内容包已经登记在 `assessment_package` 里：
     * 建表时有指向它的外键，没登记就插入会得到一个外键违例 —— 那会被上层当成
     * "服务故障"（500）而真实原因是"部署时内容未就绪"。这里提前给出 503 +
     * PACKAGE_NOT_SEEDED，让运维一眼看出是内容没落库而不是数据库坏了。
     * 正常情况下 JungPackageRegistrar 在启动期已经登记过，这个分支只在
     * "有人删了那行 / 迁移与内容版本不匹配"时命中。
     *
     * <p><b>为什么把内容包作为入参而不是自己查"当前包"</b>：新建草稿要绑定的版本由
     * 目录决定（哪一项测评的默认版本），而"按 packageId 解析已有草稿"是另一件事。
     * 让这个方法自己去猜"当前包"，就是这次改造要修掉的那个缺陷 ——
     * 一旦默认版本前移，用它建出来的草稿会悄悄绑到新题面上。
     */
    @Transactional
    public JungDtos.AttemptSummary createOnce(
            String userId, String baseReportId, AssessmentRelease release) {
        Integer packageRows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?",
                Integer.class, release.packageId());
        if (packageRows == null || packageRows == 0) {
            throw JungApiException.packageNotSeeded(release.packageId());
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
        // 第一题取**主测轮**的第一题：中性视图按包内顺序排列，第一道必然是主测题
        // （内容包的连续性校验保证了这一点，不靠"碰巧第一个不是补充题"）。
        String firstQuestionId = release.items().isEmpty() ? null : release.items().get(0).id();

        jdbc.update("""
                INSERT INTO assessment_attempt
                  (id, user_id, package_id, status, revision, current_question_id,
                   clarification_dimensions, clarification_skipped, base_attempt_id,
                   started_at, updated_at, submitted_at)
                VALUES (?, ?, ?, 'BASE_IN_PROGRESS', 0, ?, '', 0, ?, ?, ?, NULL)
                """,
                attemptId, userId, release.packageId(), firstQuestionId, baseAttemptId, now, now);

        return new JungDtos.AttemptSummary(
                attemptId, release.packageId(), "BASE_IN_PROGRESS", 0, firstQuestionId,
                List.of(), false, TimeSource.isoFromUtc(now), TimeSource.isoFromUtc(now), null, null);
    }

    /**
     * 按 attempt 自己锁定的 package_id 解析内容包。
     *
     * <p>**所有**需要题面/政策的地方都必须走这里。解析不到就是 409 PACKAGE_UNAVAILABLE：
     * 明确告诉用户"这份草稿的题目版本当前不可用"，而不是拿另一版题面套旧答案。
     *
     * @throws JungApiException 404 attempt 不存在，或 409 内容包不可用
     */
    public JungPackage requirePackage(Map<String, Object> attemptRow) {
        String packageId = (String) attemptRow.get("package_id");
        JungPackage pkg = loader.find(packageId);
        if (pkg == null) {
            throw new JungApiException("PACKAGE_UNAVAILABLE", 409,
                    "这份测评锁定的题目版本当前不可用，不能继续作答。");
        }
        return pkg;
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
        // 按**这份草稿自己锁定的版本**加载：历史草稿在发布新版本后仍然可以继续作答，
        // 而不会拿到新题面。
        JungPackage pkg = requirePackage(row);
        List<JungDtos.AnswerView> answers = readAnswers(attemptId);
        return new JungDtos.AttemptDetail(
                attemptId,
                (String) row.get("package_id"),
                (String) row.get("status"),
                ((Number) row.get("revision")).longValue(),
                (String) row.get("current_question_id"),
                splitDimensions((String) row.get("clarification_dimensions")),
                toBoolean(row.get("clarification_skipped")),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("started_at"))),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("updated_at"))),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("submitted_at"))),
                (String) row.get("base_attempt_id"),
                findReportId(attemptId),
                answers,
                coverageViews(pkg, JungScorer.checkCoverage(pkg, answerMap(answers))),
                JungDtos.packageView(pkg, loader.findTypeReports(pkg.reportContentVersion())));
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

        Map<String, Object> row = requireRowForUpdate(userId, attemptId);
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

        JungPackage pkg = requirePackage(row);
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
        int affected = jdbc.update("""
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

        // 必须检查本次 UPDATE 的结果，不能把别人的新版本当作本次写入成功。
        if (affected != 1) {
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
        Map<String, Object> row = requireRowForUpdate(userId, attemptId);
        if ("SUBMITTED".equals(row.get("status"))) {
            throw new JungApiException("ATTEMPT_SUBMITTED", 409, "这份测评已经提交。");
        }
        JungPackage pkg = requirePackage(row);
        Map<String, JungAnswer> answers = answerMap(readAnswers(attemptId));
        JungScorer.CoverageReport coverage = JungScorer.checkCoverage(pkg, answers);

        if (!coverage.coverageOk()) {
            return new JungDtos.ReviewResponse(
                    (String) row.get("status"),
                    true,
                    splitDimensions((String) row.get("clarification_dimensions")),
                    coverageViews(pkg, coverage),
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
                coverageViews(pkg, coverage),
                List.of());
    }

    /* ── 删除草稿 ───────────────────────────────────────────────────────── */

    @Transactional
    public void deleteDraft(String userId, String attemptId) {
        Map<String, Object> row = requireRowForUpdate(userId, attemptId);
        if ("SUBMITTED".equals(row.get("status"))) {
            throw new JungApiException("ATTEMPT_SUBMITTED", 409,
                    "已提交的测评不能删除。要删除已生成的报告，请使用报告删除入口。");
        }
        jdbc.update("DELETE FROM assessment_answer WHERE attempt_id = ?", attemptId);
        jdbc.update("DELETE FROM assessment_attempt WHERE id = ? AND user_id = ?", attemptId, userId);
    }

    /* ── 内部工具（供 ReportService 复用） ─────────────────────────────── */

    /** 取 attempt 行并校验 owner；不存在或不属于当前用户都返回 404 同形。 */
    /**
     * 按 owner 读取 attempt 行；找不到就 404（与"不存在"同形，不泄露资源是否存在）。
     *
     * <p>公开给平台层：大五等其他量表的草稿也在同一张表上，
     * 各自复制的 owner 校验只要有一处漏掉 {@code user_id} 就是越权。
     */
    public Map<String, Object> requireRow(String userId, String attemptId) {
        return requireRow(userId, attemptId, false);
    }

    /** 写流程必须在事务内调用：同一草稿的读答案、改答案和提交共用这把行锁。 */
    public Map<String, Object> requireRowForUpdate(String userId, String attemptId) {
        return requireRow(userId, attemptId, true);
    }

    private Map<String, Object> requireRow(String userId, String attemptId, boolean lock) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, user_id, package_id, status, revision, current_question_id,
                       clarification_dimensions, clarification_skipped, base_attempt_id,
                       started_at, updated_at, submitted_at
                  FROM assessment_attempt WHERE id = ? AND user_id = ?
                """ + (lock ? " FOR UPDATE" : ""), attemptId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份测评");
        }
        return rows.get(0);
    }

    /**
     * 读取一份 attempt 的全部答案。
     *
     * <p>答案表本身是**量表无关**的（`assessment_answer` 只存 question_id / kind / rating），
     * 所以这个方法对两种量表都成立，公开给平台层复用；把它复制成两份实现只会让
     * "两边哪天对 kind 的大小写处理不一致"变成现实。
     */
    public List<JungDtos.AnswerView> readAnswers(String attemptId) {
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

    /** 题号 → 答案（量表无关：答案表只存题号/类型/分值）。 */
    public Map<String, JungAnswer> answerMap(List<JungDtos.AnswerView> answers) {
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

    List<JungDtos.CoverageView> coverageViews(JungPackage pkg, JungScorer.CoverageReport report) {
        int min = pkg.scoringPolicy().minBaseRatingsPerDimension();
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

    /**
     * 读这份测评已经生成的报告 id（没提交过时返回 null）。
     *
     * <p>公开给平台层：报告表与 attempt 表对两种量表都是同一张，
     * "哪份 attempt 有报告"这个查询不需要按量表分叉。
     */
    public String findReportId(String attemptId) {
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

    /**
     * 把 `clarification_dimensions` 列的 CSV 拆成维度名列表。
     *
     * <p>公开给平台层：这一列对两种量表都存在（大五恒为空串），
     * 平台层回显草稿时不该自己写一遍 CSV 解析。
     */
    public static List<String> splitDimensions(String csv) {
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

    /**
     * 把 JDBC 读回来的 0/1（MySQL TINYINT 可能是 Integer、H2 可能是 Boolean）统一成布尔。
     *
     * <p>公开给平台层：同一个列在两个引擎上的 Java 类型不同，这段转换只能有一份实现。
     */
    public static boolean toBoolean(Object value) {
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
