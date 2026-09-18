package com.typeme.platform.service;

import com.typeme.ipip.content.BigFiveContentException;
import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.jung.api.JungDtos;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.service.AttemptService;
import com.typeme.jung.service.IdempotencyGuard;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.TimeSource;
import com.typeme.platform.api.PlatformDtos;
import com.typeme.platform.catalog.AssessmentCatalog;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.catalog.InstrumentKind;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 大五倾向测评的草稿与答题流程。
 *
 * <p><b>为什么不复用 {@code AttemptService}</b>：两者的完成规则与轮次结构不同 ——
 * 十六型有"主测 + 按维度触发的补充题"两轮，大五一次答完、没有补充题。
 * 把它们塞进一个类，结果是每条写入路径上都要问一次"这是哪种量表"，
 * 而那正是这次改造要消除的东西。
 *
 * <p>共同的部分（答案表读写、幂等键、owner 校验、乐观锁语义）通过
 * {@link AttemptService} 复用，不复制一份。
 *
 * <p>三条与十六型一致的硬约束：
 * <ol>
 *   <li>所有查询都带 {@code user_id}，找不到返回 404 而不是 403；</li>
 *   <li>答案写入整体校验，任一条非法就整批拒绝（不静默丢弃）；</li>
 *   <li>并发用 {@code revision} 乐观锁，冲突返回 409 + {@code currentRevision}。</li>
 * </ol>
 */
@Service
public class BigFiveAttemptService {

    private final JdbcTemplate jdbc;
    private final AttemptService attempts;
    private final TimeSource time;
    private final IdempotencyGuard idempotency;
    private final AssessmentCatalog catalog;

    public BigFiveAttemptService(
            JdbcTemplate jdbc,
            AttemptService attempts,
            TimeSource time,
            IdempotencyGuard idempotency,
            AssessmentCatalog catalog) {
        this.jdbc = jdbc;
        this.attempts = attempts;
        this.time = time;
        this.idempotency = idempotency;
        this.catalog = catalog;
    }

    /** 幂等表里的操作名。与十六型的 {@code create_attempt} 分开：两者请求内容不同。 */
    private static final String OP_CREATE_ATTEMPT = "create_attempt_bigfive";

    /* ── 创建 ───────────────────────────────────────────────────────────── */

    /**
     * 新建大五草稿（幂等）。
     *
     * @param release 目录解析出来的默认发布版本（**由调用方解析**，这样"用哪一版"
     *                只有一个决定点，方法内部不去猜"当前包"）
     */
    public PlatformDtos.AttemptView create(
            String userId, String baseReportId, String idempotencyKey, AssessmentRelease release) {
        if (release.kind() != InstrumentKind.BIG_FIVE) {
            throw JungApiException.invalid("这个入口只能开始大五倾向测评，实际收到：" + release.kind());
        }
        String key = IdempotencyGuard.normalizeKey(idempotencyKey);
        if (key == null) {
            return createOnce(userId, baseReportId, release);
        }
        IdempotencyGuard.requireUsableKey(key);
        String hash = IdempotencyGuard.fingerprint(OP_CREATE_ATTEMPT, release.packageId(), baseReportId);

        String replayId = idempotency.completedRef(userId, OP_CREATE_ATTEMPT, key, hash);
        if (replayId != null) {
            PlatformDtos.AttemptView replay = findView(userId, replayId);
            if (replay != null) {
                return replay;
            }
            idempotency.forgetDangling(userId, OP_CREATE_ATTEMPT, key, replayId);
        }

        if (!idempotency.claim(userId, OP_CREATE_ATTEMPT, key, hash)) {
            String racedId = idempotency.completedRef(userId, OP_CREATE_ATTEMPT, key, hash);
            if (racedId != null) {
                PlatformDtos.AttemptView raced = findView(userId, racedId);
                if (raced != null) {
                    return raced;
                }
            }
            throw JungApiException.idempotencyInProgress();
        }

        PlatformDtos.AttemptView created;
        try {
            created = createOnce(userId, baseReportId, release);
        } catch (RuntimeException ex) {
            idempotency.release(userId, OP_CREATE_ATTEMPT, key);
            throw ex;
        }
        try {
            idempotency.complete(userId, OP_CREATE_ATTEMPT, key, created.attemptId());
        } catch (RuntimeException ex) {
            // 资源已经建好：标记失败只意味着"下次重放可能再建一份"，不影响这次响应。
            // 与十六型同一个取舍（见 AttemptService.create 的注释）。
            org.slf4j.LoggerFactory.getLogger(BigFiveAttemptService.class)
                    .warn("幂等标记失败（资源已创建，attemptId={}）：{}", created.attemptId(), ex.toString());
        }
        return created;
    }

    @Transactional
    public PlatformDtos.AttemptView createOnce(
            String userId, String baseReportId, AssessmentRelease release) {
        Integer packageRows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?",
                Integer.class, release.packageId());
        if (packageRows == null || packageRows == 0) {
            // 与十六型一致的语义：内容没落库是部署问题（503），不是服务故障（500）。
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
        String firstQuestionId = release.items().isEmpty() ? null : release.items().get(0).id();

        jdbc.update("""
                INSERT INTO assessment_attempt
                  (id, user_id, package_id, status, revision, current_question_id,
                   clarification_dimensions, clarification_skipped, base_attempt_id,
                   started_at, updated_at, submitted_at)
                VALUES (?, ?, ?, 'BASE_IN_PROGRESS', 0, ?, '', 0, ?, ?, ?, NULL)
                """,
                attemptId, userId, release.packageId(), firstQuestionId, baseAttemptId, now, now);

        return detail(userId, attemptId);
    }

    private PlatformDtos.AttemptView findView(String userId, String attemptId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id FROM assessment_attempt WHERE id = ? AND user_id = ?", attemptId, userId);
        return rows.isEmpty() ? null : detail(userId, attemptId);
    }

    /* ── 读取 ───────────────────────────────────────────────────────────── */

    /** 草稿详情：题目 + 已答 + 进度。答题页只靠这一次请求。 */
    public PlatformDtos.AttemptView detail(String userId, String attemptId) {
        Map<String, Object> row = attempts.requireRow(userId, attemptId);
        AssessmentRelease release = requireBigFiveRelease(row);
        List<PlatformDtos.AnswerView> answers = readAnswers(attemptId);
        Set<String> answered = new LinkedHashSet<>();
        for (PlatformDtos.AnswerView answer : answers) {
            answered.add(answer.questionId());
        }
        List<String> requiredIds = release.items().stream().map(AssessmentRelease.Item::id).toList();
        int answeredCount = 0;
        for (String id : requiredIds) {
            if (answered.contains(id)) {
                answeredCount++;
            }
        }
        return new PlatformDtos.AttemptView(
                attemptId,
                com.typeme.platform.report.ReportEnvelope.slugOf(release),
                release.kind().code(),
                release.title(),
                release.packageId(),
                com.typeme.platform.report.ReportEnvelope.reportKindOf(release),
                (String) row.get("status"),
                ((Number) row.get("revision")).longValue(),
                (String) row.get("current_question_id"),
                AttemptService.splitDimensions((String) row.get("clarification_dimensions")),
                AttemptService.toBoolean(row.get("clarification_skipped")),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("started_at"))),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("updated_at"))),
                TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("submitted_at"))),
                (String) row.get("base_attempt_id"),
                attempts.findReportId(attemptId),
                answers,
                release.items().stream().map(BigFiveAttemptService::itemView).toList(),
                answeredCount,
                requiredIds.size(),
                answeredCount == requiredIds.size());
    }

    /** 大五的题目视图：只有单句题，双极字段全部为 null。 */
    static PlatformDtos.ItemView itemView(AssessmentRelease.Item item) {
        return new PlatformDtos.ItemView(
                item.id(),
                "agreement_statement",
                item.stage(),
                item.dimension(),
                item.order(),
                null,
                null,
                null,
                item.statement(),
                null,
                null,
                item.direction(),
                item.help());
    }

    /* ── 保存答案 ───────────────────────────────────────────────────────── */

    /**
     * 批量保存答案（PATCH 语义）。
     *
     * <p>与十六型的三点差别：
     * <ul>
     *   <li>不存在"哪一题被安排"这回事 —— 50 题任何时候都可以答；</li>
     *   <li>改答案不会退回任何轮次（只有一轮）；</li>
     *   <li>返回的是**进度**（已答/总数），因为大五的完成规则就是"50 题全处理完"。</li>
     * </ul>
     */
    @Transactional
    public PlatformDtos.PatchAnswersResponse patchAnswers(
            String userId, String attemptId, PlatformDtos.PatchAnswersRequest request) {
        Map<String, Object> row = attempts.requireRow(userId, attemptId);
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

        AssessmentRelease release = requireBigFiveRelease(row);
        BigFivePackage pkg = release.bigFive();
        List<PlatformDtos.ResponseInput> inputs =
                request.responses() == null ? List.of() : request.responses();
        List<JungAnswer> toWrite = new ArrayList<>(inputs.size());
        Set<String> seen = new LinkedHashSet<>();

        for (PlatformDtos.ResponseInput input : inputs) {
            if (input == null || input.questionId() == null) {
                throw JungApiException.invalid("每条回答都必须有 questionId。");
            }
            if (!seen.add(input.questionId())) {
                throw JungApiException.invalid("同一次请求里重复出现题号：" + input.questionId());
            }
            BigFiveItem item = pkg.item(input.questionId());
            if (item == null) {
                // 这里必须用**这份草稿锁定的包**校验：拿当前默认包校验会让旧草稿
                // 出现"题号合法但内容对不上"的静默误差。
                throw JungApiException.invalid("未知题号：" + input.questionId());
            }
            String kind = input.kind() == null ? null : input.kind().trim().toUpperCase(java.util.Locale.ROOT);
            if ("RATING".equals(kind)) {
                if (input.rating() == null || input.rating() < 1 || input.rating() > 5) {
                    throw JungApiException.invalid("分值必须是 1..5：" + input.questionId());
                }
                toWrite.add(JungAnswer.rating(input.questionId(), input.rating()));
            } else if ("UNKNOWN".equals(kind)) {
                if (input.rating() != null) {
                    throw JungApiException.invalid("「说不上符合或不符合」不能同时带分值：" + input.questionId());
                }
                toWrite.add(JungAnswer.unknown(input.questionId()));
            } else {
                throw JungApiException.invalid("kind 只能是 RATING 或 UNKNOWN：" + input.questionId());
            }
        }

        if (request.currentQuestionId() != null && !pkg.hasItem(request.currentQuestionId())) {
            throw JungApiException.invalid("currentQuestionId 不是本内容包的题目：" + request.currentQuestionId());
        }

        for (JungAnswer answer : toWrite) {
            jdbc.update("""
                    INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE kind = VALUES(kind), rating = VALUES(rating), updated_at = VALUES(updated_at)
                    """,
                    attemptId, answer.questionId(), answer.kind().name(), answer.rating(), time.nowUtc());
        }

        long newRevision = currentRevision + 1;
        jdbc.update("""
                UPDATE assessment_attempt
                   SET revision = ?, current_question_id = COALESCE(?, current_question_id), updated_at = ?
                 WHERE id = ? AND user_id = ? AND revision = ?
                """,
                newRevision,
                request.currentQuestionId(),
                time.nowUtc(),
                attemptId,
                userId,
                currentRevision);

        Integer affected = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_attempt WHERE id = ? AND revision = ?",
                Integer.class, attemptId, newRevision);
        if (affected == null || affected == 0) {
            throw JungApiException.conflict("另一台设备已经更新了这份草稿，请先读取最新版本再合并。",
                    Map.of("currentRevision", currentRevision));
        }

        List<PlatformDtos.AnswerView> answers = readAnswers(attemptId);
        Set<String> answered = new LinkedHashSet<>();
        for (PlatformDtos.AnswerView answer : answers) {
            answered.add(answer.questionId());
        }
        int answeredCount = 0;
        for (AssessmentRelease.Item item : release.items()) {
            if (answered.contains(item.id())) {
                answeredCount++;
            }
        }
        return new PlatformDtos.PatchAnswersResponse(
                newRevision,
                (String) row.get("status"),
                answeredCount,
                release.items().size(),
                answeredCount == release.items().size(),
                request.currentQuestionId() == null
                        ? (String) row.get("current_question_id")
                        : request.currentQuestionId());
    }

    /* ── 辅助 ───────────────────────────────────────────────────────────── */

    /**
     * 解析这份草稿锁定的大五内容包。
     *
     * <p>三种"不能用"的情况分开报：
     * <ul>
     *   <li>草稿锁定的版本已经下线 → 409 PACKAGE_UNAVAILABLE；</li>
     *   <li>锁定的版本是别的量表 → 409 INSTRUMENT_MISMATCH（前端接错了入口）；</li>
     *   <li>草稿不存在或不属于本人 → 由 {@link #requireBigFiveRow} 给出 404。</li>
     * </ul>
     */
    public AssessmentRelease requireBigFiveRelease(Map<String, Object> attemptRow) {
        String packageId = (String) attemptRow.get("package_id");
        AssessmentRelease release = catalog.releaseOf(packageId);
        if (release == null) {
            throw new JungApiException("PACKAGE_UNAVAILABLE", 409,
                    "这份测评锁定的题目版本当前不可用，不能继续作答。");
        }
        if (release.kind() != InstrumentKind.BIG_FIVE) {
            throw new JungApiException("INSTRUMENT_MISMATCH", 409,
                    "这份测评不是大五倾向测评，请从对应的入口继续。");
        }
        return release;
    }

    /** 读数：把答案表行转成平台视图（与十六型共用同一张表）。 */
    public List<PlatformDtos.AnswerView> readAnswers(String attemptId) {
        List<PlatformDtos.AnswerView> views = new ArrayList<>();
        for (JungDtos.AnswerView answer : attempts.readAnswers(attemptId)) {
            views.add(new PlatformDtos.AnswerView(answer.questionId(), answer.kind(), answer.rating()));
        }
        return List.copyOf(views);
    }

    /** 供计分与报告使用：题号 → 答案。 */
    public Map<String, JungAnswer> answerMap(String attemptId) {
        return attempts.answerMap(attempts.readAnswers(attemptId));
    }

    /**
     * 读这份测评已经生成的报告 id（没提交过时返回 null）。
     *
     * <p>转发给 {@link AttemptService}：报告表对两种量表是同一张，
     * 转发而不是各自查一遍，避免两处 SQL 慢慢漂移。
     */
    public String findReportId(String attemptId) {
        return attempts.findReportId(attemptId);
    }

    /**
     * 按 owner 读 attempt 行并把"这不是大五草稿"提前拦掉。
     *
     * <p>提交路径用它而不是 {@code attempts.requireRow}：前者只保证"这是本人的草稿"，
     * 而报告服务写的是**大五**的 report_json，错把十六型草稿提交进来会写出一份
     * 结构对不上的报告。
     */
    public Map<String, Object> requireBigFiveRow(String userId, String attemptId) {
        Map<String, Object> row = attempts.requireRow(userId, attemptId);
        requireBigFiveRelease(row);
        return row;
    }

    /** 便于测试与错误提示：这份草稿锁定的包。 */
    public BigFivePackage packageOf(String userId, String attemptId) {
        AssessmentRelease release = requireBigFiveRelease(attempts.requireRow(userId, attemptId));
        BigFivePackage pkg = release.bigFive();
        if (pkg == null) {
            throw new BigFiveContentException("大五发布版本缺少底层内容包：" + release.packageId());
        }
        return pkg;
    }
}
