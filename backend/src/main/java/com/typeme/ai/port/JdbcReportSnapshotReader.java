package com.typeme.ai.port;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * {@link ReportSnapshotReader} 的生产实现：直接按契约 02 §3/§4 的表名与列名查询。
 *
 * <p>刻意不依赖 {@code com.typeme.jung} 的 Java 类型（并行开发中）：AI 模块只需要
 * "报告快照 + 归属 + 答案集 + 内容包题目极点"这几样只读材料。
 *
 * <p>两条业务规则写在这里，而不是散在 service 里：
 * <ol>
 *   <li><b>复测（base_attempt_id 非空）时合并两轮答案</b>：报告的方向由服务端算好写在
 *       {@code report_json} 里，但"哪道题贡献了多少"必须回到答案上算，漏掉主测那一轮会让证据
 *       凭空少一半。合并以当前 attempt 为准（同一题号后者覆盖前者）。</li>
 *   <li>内容包缺失（{@code content_json} 为空）**不返回空 Optional**：报告还在，
 *       只是题目极点取不到，由上层降级（不做逐题证据）而不是把整个任务判成"报告不存在"。</li>
 * </ol>
 */
@Component
public class JdbcReportSnapshotReader implements ReportSnapshotReader {

    private static final Logger log = LoggerFactory.getLogger(JdbcReportSnapshotReader.class);

    private static final String SELECT_ATTEMPT = """
            SELECT a.id AS attempt_id, a.base_attempt_id, a.package_id
            FROM assessment_attempt a
            JOIN assessment_report r ON r.attempt_id = a.id
            WHERE r.id = ?
            """;

    private static final String SELECT_REPORT = """
            SELECT id, user_id, status, computed_type_code, report_hash, report_json
            FROM assessment_report WHERE id = ?
            """;

    private static final String SELECT_ANSWERS = """
            SELECT question_id, kind, rating FROM assessment_answer WHERE attempt_id = ?
            """;

    private static final String SELECT_CONTENT = """
            SELECT content_json FROM assessment_package WHERE package_id = ?
            """;

    private final JdbcTemplate jdbcTemplate;

    public JdbcReportSnapshotReader(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Optional<AiReportSnapshot> find(String reportId) {
        if (reportId == null || reportId.isBlank()) {
            return Optional.empty();
        }
        Map<String, Object> report = first(jdbcTemplate.queryForList(SELECT_REPORT, reportId));
        if (report == null) {
            return Optional.empty();
        }
        Map<String, Object> attempt = first(jdbcTemplate.queryForList(SELECT_ATTEMPT, reportId));
        String attemptId = attempt == null ? null : text(attempt.get("attempt_id"));
        String baseAttemptId = attempt == null ? null : text(attempt.get("base_attempt_id"));
        String packageId = attempt == null ? null : text(attempt.get("package_id"));

        // 内容包极点：当前 attempt 的包；实际取不到时退回派生源的包（两轮必须是同一个仪器版本）。
        String basePackageId = baseAttemptId == null ? null : packageIdOfAttempt(baseAttemptId);
        String contentJson = packageId == null ? null : contentJson(packageId);
        if (contentJson == null && basePackageId != null) {
            contentJson = contentJson(basePackageId);
        }

        Map<String, AiReportSnapshot.Answer> answers = new LinkedHashMap<>();
        if (baseAttemptId != null) {
            answers.putAll(readAnswers(baseAttemptId));
        }
        if (attemptId != null) {
            answers.putAll(readAnswers(attemptId));
        }

        return Optional.of(new AiReportSnapshot(
                text(report.get("id")),
                text(report.get("user_id")),
                text(report.get("status")),
                text(report.get("computed_type_code")),
                text(report.get("report_hash")),
                attemptId,
                baseAttemptId,
                packageId,
                contentJson,
                Map.copyOf(answers),
                text(report.get("report_json"))));
    }

    private Map<String, AiReportSnapshot.Answer> readAnswers(String attemptId) {
        Map<String, AiReportSnapshot.Answer> answers = new HashMap<>();
        for (Map<String, Object> row : jdbcTemplate.queryForList(SELECT_ANSWERS, attemptId)) {
            String questionId = text(row.get("question_id"));
            if (questionId == null) {
                continue;
            }
            String kind = text(row.get("kind"));
            Integer rating = intOrNull(row.get("rating"));
            answers.put(questionId, new AiReportSnapshot.Answer(questionId, kind, rating));
        }
        return answers;
    }

    private String packageIdOfAttempt(String attemptId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT package_id FROM assessment_attempt WHERE id = ?", attemptId);
        Map<String, Object> row = first(rows);
        return row == null ? null : text(row.get("package_id"));
    }

    private String contentJson(String packageId) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(SELECT_CONTENT, packageId);
        Map<String, Object> row = first(rows);
        if (row == null) {
            log.warn("内容包 {} 不存在，本次不做逐题证据（报告本身仍然可分析）。", packageId);
            return null;
        }
        return text(row.get("content_json"));
    }

    private static Map<String, Object> first(List<Map<String, Object>> rows) {
        return rows == null || rows.isEmpty() ? null : rows.get(0);
    }

    private static String text(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof byte[] bytes) {
            return new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
        }
        String text = String.valueOf(value);
        return text.isBlank() ? null : text;
    }

    private static Integer intOrNull(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.valueOf(String.valueOf(value).trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
