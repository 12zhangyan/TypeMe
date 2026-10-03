package com.typeme.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.report.BigFiveReportBuilder;
import com.typeme.ipip.scoring.BigFiveResult;
import com.typeme.ipip.scoring.BigFiveScorer;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.TimeSource;
import com.typeme.platform.api.PlatformDtos;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.report.ReportEnvelope;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 大五提交与不可变报告。
 *
 * <p>与十六型提交共享的不变量（{@code ReportService} 里那三条）在这里同样成立：
 * 服务端重算、报告只 INSERT、同一 attempt 只产生一份报告。
 *
 * <h2>两处刻意的不同</h2>
 * <ol>
 *   <li><b>没有澄清题</b>：某维证据不足不会阻止提交，只是那一维没有结论。
 *       只有"还有题完全没处理过（既没评分也没标说不上）"才拒绝提交，
 *       并把缺的题号返回给前端 —— 这不是错误，是"还没答完"。</li>
 *   <li><b>{@code computed_type_code} 恒为 NULL</b>。数据库那一列有 CHECK 约束，
 *       只允许 16 个四字母或 NULL；大五**没有类型码**，所以必须是 NULL。
 *       任何"给大五编一个四位码"的做法都会同时破坏约束与语义。</li>
 * </ol>
 */
@Service
public class BigFiveReportService {

    private static final Logger log = LoggerFactory.getLogger(BigFiveReportService.class);

    private final JdbcTemplate jdbc;
    private final BigFiveAttemptService attempts;
    private final TimeSource time;
    private final ObjectMapper mapper;

    public BigFiveReportService(
            JdbcTemplate jdbc,
            BigFiveAttemptService attempts,
            TimeSource time,
            ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.attempts = attempts;
        this.time = time;
        this.mapper = mapper;
    }

    @Transactional
    public PlatformDtos.SubmitResponse submit(
            String userId, String attemptId, PlatformDtos.SubmitRequest request) {

        Map<String, Object> row = attempts.requireBigFiveRow(userId, attemptId);
        AssessmentRelease release = attempts.requireBigFiveRelease(row);
        BigFivePackage pkg = release.bigFive();
        String status = (String) row.get("status");
        long revision = ((Number) row.get("revision")).longValue();

        if ("SUBMITTED".equals(status)) {
            // 幂等：已提交就返回既有报告，不重新计分、不覆盖快照。
            String reportId = attempts.findReportId(attemptId);
            if (reportId == null) {
                throw new IllegalStateException("attempt 标记为已提交但没有报告，数据不一致：" + attemptId);
            }
            Map<String, Object> existing = readReportRow(reportId, userId);
            return new PlatformDtos.SubmitResponse(
                    reportId,
                    attemptId,
                    (String) existing.get("status"),
                    ReportEnvelope.KIND_BIG_FIVE,
                    List.of(),
                    countKind(attemptId, "UNKNOWN"),
                    countKind(attemptId, null));
        }

        if (request != null && request.expectedRevision() != null && request.expectedRevision() != revision) {
            throw JungApiException.conflict("另一台设备已经更新了这份草稿，请先读取最新版本再提交。",
                    Map.of("currentRevision", revision));
        }

        Map<String, JungAnswer> answers = attempts.answerMap(attemptId);
        List<String> unprocessed = new ArrayList<>();
        for (AssessmentRelease.Item item : release.items()) {
            if (!answers.containsKey(item.id())) {
                unprocessed.add(item.id());
            }
        }
        if (!unprocessed.isEmpty()) {
            // "还没答完"不是错误：返回缺题号让前端回到答题页把它们标出来。
            return new PlatformDtos.SubmitResponse(
                    null,
                    attemptId,
                    "INCOMPLETE",
                    ReportEnvelope.KIND_BIG_FIVE,
                    List.copyOf(unprocessed),
                    countKind(answers, "UNKNOWN"),
                    unprocessed.size());
        }

        BigFiveResult result = BigFiveScorer.score(pkg, answers);

        String reportId = UUID.nameUUIDFromBytes(("typeme-report:" + attemptId).getBytes(StandardCharsets.UTF_8))
                .toString();
        LocalDateTime now = time.nowUtc();
        Map<String, Object> body = BigFiveReportBuilder.build(pkg, result, reportId, attemptId, now);
        Map<String, Object> report = ReportEnvelope.wrap(
                release, reportId, attemptId, TimeSource.isoFromUtc(now), body);
        String reportJson = finalizeWithHash(report);
        String reportHash = (String) report.get("reportHash");

        try {
            jdbc.update("""
                    INSERT INTO assessment_report
                      (id, attempt_id, user_id, status, computed_type_code, score_json, report_json, report_hash, created_at)
                    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
                    """,
                    reportId, attemptId, userId, BigFiveReportBuilder.STATUS_PROFILE,
                    writeJson(scoreJson(pkg, result, reportHash)), reportJson, reportHash, now);
        } catch (DuplicateKeyException ex) {
            log.info("重复提交被唯一约束拦截，返回既有报告 attemptId={}", attemptId);
            Map<String, Object> existing = readReportRow(reportId, userId);
            return new PlatformDtos.SubmitResponse(
                    reportId,
                    attemptId,
                    (String) existing.get("status"),
                    ReportEnvelope.KIND_BIG_FIVE,
                    List.of(),
                    result.unknownCount(),
                    result.unprocessedCount());
        }

        jdbc.update("""
                UPDATE assessment_attempt
                   SET status = 'SUBMITTED', submitted_at = ?, updated_at = ?
                 WHERE id = ? AND user_id = ?
                """, now, now, attemptId, userId);

        return new PlatformDtos.SubmitResponse(
                reportId,
                attemptId,
                BigFiveReportBuilder.STATUS_PROFILE,
                ReportEnvelope.KIND_BIG_FIVE,
                List.of(),
                result.unknownCount(),
                result.unprocessedCount());
    }

    /* ── 辅助 ───────────────────────────────────────────────────────────── */

    /**
     * 落库的计分审计信息。
     *
     * <p>它**不是**给界面用的（界面读 {@code report_json}），而是出问题时能回答
     * "这份报告当时是怎么算出来的"：每维的有效回答数、距离与分档。
     * 与十六型的 {@code score_json} 同一性质。
     */
    private Map<String, Object> scoreJson(BigFivePackage pkg, BigFiveResult result, String reportHash) {
        Map<String, Object> score = new LinkedHashMap<>();
        score.put("scoringVersion", pkg.scoringVersion());
        score.put("packageId", pkg.packageId());
        score.put("status", BigFiveReportBuilder.STATUS_PROFILE);
        score.put("hasTypeCode", false);
        score.put("coverageOk", result.coverageOk());
        score.put("unknownCount", result.unknownCount());
        score.put("unprocessedCount", result.unprocessedCount());
        List<Map<String, Object>> dimensions = new ArrayList<>(BigFiveDimension.ordered().size());
        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("dimension", row.dimension().code());
            node.put("rawScore", row.rawScore());
            node.put("validCount", row.validCount());
            node.put("unknownCount", row.unknownCount());
            node.put("unprocessedCount", row.unprocessedCount());
            node.put("distance", row.distance());
            node.put("level", row.level() == null ? null : row.level().name());
            dimensions.add(node);
        }
        score.put("dimensions", dimensions);
        score.put("reportHash", reportHash);
        return score;
    }

    private int countKind(String attemptId, String kind) {
        Integer count = kind == null
                ? jdbc.queryForObject(
                        "SELECT COUNT(*) FROM assessment_answer WHERE attempt_id = ?", Integer.class, attemptId)
                : jdbc.queryForObject(
                        "SELECT COUNT(*) FROM assessment_answer WHERE attempt_id = ? AND kind = ?",
                        Integer.class, attemptId, kind);
        return count == null ? 0 : count;
    }

    private static int countKind(Map<String, JungAnswer> answers, String kind) {
        int count = 0;
        for (JungAnswer answer : answers.values()) {
            if (kind.equals(answer.kind().name())) {
                count++;
            }
        }
        return count;
    }

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
     * 追加 {@code reportHash} 并返回最终 JSON 文本。
     *
     * <p>规则与十六型完全一致：哈希覆盖**除自己以外**的全部字段，
     * 因此必须先序列化、算哈希、塞进去、再序列化。这里不复用
     * {@code JungReportBuilder.finalizeWithHash} 是因为那会把两个量表绑在一起 ——
     * 这段逻辑只有十行，按"谁生成报告谁负责冻结"复制一份比制造跨模块依赖更清楚。
     */
    private String finalizeWithHash(Map<String, Object> report) {
        String withoutHash = writeJson(report);
        String hash = sha256Hex(withoutHash);
        report.put("reportHash", hash);
        return writeJson(report);
    }

    private static String sha256Hex(String value) {
        try {
            java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
            return java.util.HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("JDK 必须提供 SHA-256", ex);
        }
    }

    private String writeJson(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("报告 JSON 无法序列化", ex);
        }
    }
}
