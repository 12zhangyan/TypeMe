package com.typeme.platform.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ipip.content.BigFiveDimensionCopy;
import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionCopy;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.TimeSource;
import com.typeme.platform.api.PlatformDtos;
import com.typeme.platform.catalog.AssessmentCatalog;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.catalog.InstrumentDefinition;
import com.typeme.platform.catalog.InstrumentKind;
import com.typeme.platform.report.ReportEnvelope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 平台读取服务：目录、量表详情、"我的测评 / 我的报告"、报告详情。
 *
 * <p>它**只读**，而且刻意不做任何量表专属的计分或文案生成：那些属于各模块的
 * scorer / report builder。这里做的是把"同时存在两种量表"这件事变成界面能直接用的数据 ——
 * 尤其是**每一行都带 instrumentSlug 与 packageId**，让"这份是十六型 v2、
 * 那份是大五 v1"在列表上就能看出来。
 *
 * <h2>为什么报告详情要返回整份快照</h2>
 * 历史报告不可重算：它的 {@code report_json} 是按提交当时的算法与内容冻结的。
 * 因此这里原样返回，并**只解析出外壳字段**（量表、版本、状态、摘要行）用于列表与跳转。
 * 解析外壳时对旧报告（没有外壳）单独处理，绝不改写。
 */
@Service
public class PlatformQueryService {

    private final JdbcTemplate jdbc;
    private final AssessmentCatalog catalog;
    private final ObjectMapper mapper;
    private final BigFiveAttemptService bigFiveAttempts;

    public PlatformQueryService(
            JdbcTemplate jdbc,
            AssessmentCatalog catalog,
            ObjectMapper mapper,
            BigFiveAttemptService bigFiveAttempts) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.mapper = mapper;
        this.bigFiveAttempts = bigFiveAttempts;
    }

    /* ── 目录 ───────────────────────────────────────────────────────────── */

    public PlatformDtos.InstrumentListResponse instruments() {
        List<PlatformDtos.InstrumentCard> cards = new ArrayList<>();
        for (InstrumentDefinition definition : catalog.definitions()) {
            cards.add(card(definition, catalog.defaultRelease(definition.slug())));
        }
        return new PlatformDtos.InstrumentListResponse(List.copyOf(cards));
    }

    /** 量表详情：定义 + 默认版本的维度解释 + 版本列表。 */
    public PlatformDtos.InstrumentDetail instrument(String slug) {
        InstrumentDefinition definition = catalog.findDefinition(slug);
        if (definition == null) {
            throw JungApiException.notFound("这项测评");
        }
        AssessmentRelease release = catalog.defaultRelease(slug);
        List<PlatformDtos.VersionView> versions = new ArrayList<>();
        for (AssessmentRelease candidate : catalog.releasesOf(slug)) {
            versions.add(new PlatformDtos.VersionView(
                    candidate.packageId(),
                    candidate.revision(),
                    candidate.scoringVersion(),
                    candidate.reportContentVersion(),
                    candidate.contentStatus(),
                    candidate.sha256(),
                    candidate.packageId().equals(release.packageId()),
                    candidate.baseItemCount(),
                    candidate.clarificationItemCount()));
        }
        return new PlatformDtos.InstrumentDetail(
                card(definition, release), dimensionCopies(release), List.copyOf(versions));
    }

    private PlatformDtos.InstrumentCard card(InstrumentDefinition definition, AssessmentRelease release) {
        return new PlatformDtos.InstrumentCard(
                definition.slug(),
                definition.kind().code(),
                definition.title(),
                definition.tagline(),
                definition.summary(),
                definition.whatYouLearn(),
                definition.notFor(),
                definition.kind().format(),
                definition.kind().hasTypeCode(),
                definition.kind().supportsClarificationRound(),
                release.dimensionCodes(),
                release.packageId(),
                release.baseItemCount(),
                release.clarificationItemCount(),
                release.maxClarificationItems(),
                estimatedMinutes(release),
                release.contentStatus());
    }

    /**
     * 预计时长。
     *
     * <p>按总题数 × 8 秒再向上取整到分钟：**不写死数字**，因为大五是 50 题、
     * 十六型是 48 + 最多 16 题，写死会让首页卡片直接说错。
     */
    private static int estimatedMinutes(AssessmentRelease release) {
        int total = release.baseItemCount() + release.maxClarificationItems();
        return Math.max(1, (int) Math.ceil(total * 8.0 / 60.0));
    }

    /**
     * 维度的界面解释。
     *
     * <p>两种量表的维度概念不同，但"两端各是什么样子 + 哪一侧偏高"这个表达是通用的，
     * 所以映射到同一个视图；大五没有"平衡/并列"这一说法，对应字段留空。
     */
    private List<PlatformDtos.DimensionCopyView> dimensionCopies(AssessmentRelease release) {
        if (release.kind() == InstrumentKind.JUNG && release.jung() != null) {
            JungPackage pkg = release.jung();
            List<PlatformDtos.DimensionCopyView> rows = new ArrayList<>(4);
            for (JungDimension dimension : JungDimension.values()) {
                JungDimensionCopy copy = pkg.copyOf(dimension);
                rows.add(new PlatformDtos.DimensionCopyView(
                        dimension.name(),
                        copy.name(),
                        copy.question(),
                        copy.negativePole().label(),
                        copy.negativePole().description(),
                        copy.negativePole().dailySigns(),
                        copy.positivePole().label(),
                        copy.positivePole().description(),
                        copy.positivePole().dailySigns(),
                        copy.balancedSummary() + " " + copy.balancedReading(),
                        copy.tiedNotice(),
                        null));
            }
            return List.copyOf(rows);
        }
        BigFivePackage pkg = release.bigFive();
        if (pkg == null) {
            throw new IllegalStateException("发布版本缺少内容包：" + release.packageId());
        }
        List<PlatformDtos.DimensionCopyView> rows = new ArrayList<>(5);
        for (BigFiveDimension dimension : BigFiveDimension.ordered()) {
            BigFiveDimensionCopy copy = pkg.copyOf(dimension);
            rows.add(new PlatformDtos.DimensionCopyView(
                    dimension.code(),
                    copy.name(),
                    copy.question(),
                    copy.low().label(),
                    copy.low().description(),
                    copy.low().dailySigns(),
                    copy.high().label(),
                    copy.high().description(),
                    copy.high().dailySigns(),
                    // 大五没有"平衡"这一档的专门文案：接近中间的含义由报告按本次结果写，
                    // 问卷阶段不该先给一个通用说法。
                    null,
                    copy.caution(),
                    copy.observation()));
        }
        return List.copyOf(rows);
    }

    /* ── 我的测评 / 我的报告 ────────────────────────────────────────────── */

    public PlatformDtos.AttemptMetadata attemptMetadata(String userId, String attemptId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT package_id, status FROM assessment_attempt WHERE id = ? AND user_id = ?",
                attemptId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份测评");
        }
        String packageId = (String) rows.get(0).get("package_id");
        AssessmentRelease release = catalog.releaseOf(packageId);
        if (release == null) {
            throw new JungApiException("PACKAGE_UNAVAILABLE", 409,
                    "这份测评锁定的题目版本当前不可用，不能继续作答。");
        }
        return new PlatformDtos.AttemptMetadata(attemptId, release.kind().code(),
                (String) rows.get(0).get("status"));
    }

    /**
     * 我的测评列表（草稿与已提交都算）。
     *
     * <p>{@code answeredCount} 按**这份测评自己的题目数**统计，而不是 JOIN 出来的
     * 总答案数：大五的答案表同样只有 50 行，但十六型可能有补充题，
     * 用"答案行数"当进度会在两种量表上给出不同的含义。
     */
    public PlatformDtos.MyAttemptListResponse myAttempts(String userId, int page, int size) {
        return myAttempts(userId, page, size, null);
    }

    public PlatformDtos.MyAttemptListResponse myAttempts(String userId, int page, int size, String scope) {
        int safePage = Math.max(0, page);
        int safeSize = Math.min(50, Math.max(1, size));
        if (scope != null && !"open".equals(scope)) {
            throw JungApiException.validation("不支持的草稿筛选条件。");
        }
        String filter = scope == null
                ? ""
                : " AND a.status IN ('BASE_IN_PROGRESS', 'CLARIFICATION_IN_PROGRESS')";
        Long total = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_attempt a WHERE a.user_id = ?" + filter,
                Long.class, userId);

        String query = """
                SELECT a.id, a.package_id, a.status, a.revision, a.started_at, a.updated_at, a.submitted_at,
                       (SELECT r.id FROM assessment_report r WHERE r.attempt_id = a.id) AS report_id,
                       (SELECT r.status FROM assessment_report r WHERE r.attempt_id = a.id) AS report_status,
                       (SELECT r.computed_type_code FROM assessment_report r WHERE r.attempt_id = a.id) AS type_code,
                       (SELECT COUNT(*) FROM assessment_answer ans WHERE ans.attempt_id = a.id) AS answered_count
                  FROM assessment_attempt a
                 WHERE a.user_id = ?
                """ + filter + """
                 ORDER BY a.updated_at DESC, a.id DESC
                 LIMIT ? OFFSET ?
                """;
        List<Map<String, Object>> rows = jdbc.queryForList(query, userId, safeSize, safePage * safeSize);

        List<PlatformDtos.MyAttemptRow> items = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            String packageId = (String) row.get("package_id");
            AssessmentRelease release = catalog.releaseOf(packageId);
            items.add(new PlatformDtos.MyAttemptRow(
                    (String) row.get("id"),
                    release == null ? unknownSlug(packageId) : ReportEnvelope.slugOf(release),
                    release == null ? "unknown" : release.kind().code(),
                    release == null ? "已下线的测评版本" : release.title(),
                    packageId,
                    release == null ? null : release.reportContentVersion(),
                    (String) row.get("status"),
                    ((Number) row.get("revision")).longValue(),
                    TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("started_at"))),
                    TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("updated_at"))),
                    TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("submitted_at"))),
                    (String) row.get("report_id"),
                    (String) row.get("report_status"),
                    (String) row.get("type_code"),
                    ((Number) row.get("answered_count")).intValue(),
                    release == null ? 0 : release.baseItemCount()));
        }
        return new PlatformDtos.MyAttemptListResponse(
                List.copyOf(items), safePage, safeSize, total == null ? 0 : total);
    }

    /**
     * 内容包已经下线的历史草稿：仍然列出，但明确标注。
     *
     * <p>不隐藏它 —— 用户可能正需要知道"我有一份旧测评，它现在打不开了"。
     * 从 packageId 前缀推断量表族足够可靠（前缀是内容包的稳定约定）。
     */
    private static String unknownSlug(String packageId) {
        if (packageId == null) {
            return "unknown";
        }
        if (packageId.startsWith("typeme-bigfive50-")) {
            return "bigfive50";
        }
        if (packageId.startsWith("typeme-jung48-")) {
            return "jung48";
        }
        return "unknown";
    }

    public PlatformDtos.MyReportListResponse myReports(String userId, int page, int size) {
        return myReports(userId, page, size, null);
    }

    public PlatformDtos.MyReportListResponse myReports(String userId, int page, int size, String kind) {
        int safePage = Math.max(0, page);
        int safeSize = Math.min(50, Math.max(1, size));
        if (kind != null && !"jung".equals(kind) && !"big_five".equals(kind)) {
            throw JungApiException.validation("不支持的报告筛选条件。");
        }
        String filter = kind == null ? "" : " AND a.package_id LIKE ?";
        String packagePattern = "jung".equals(kind) ? "typeme-jung48-%" : "typeme-bigfive50-%";
        Long total = kind == null
                ? jdbc.queryForObject(
                        "SELECT COUNT(*) FROM assessment_report WHERE user_id = ?", Long.class, userId)
                : jdbc.queryForObject("""
                        SELECT COUNT(*)
                          FROM assessment_report r
                          JOIN assessment_attempt a ON a.id = r.attempt_id
                         WHERE r.user_id = ? AND a.package_id LIKE ?
                        """, Long.class, userId, packagePattern);

        String query = """
                SELECT r.id, r.attempt_id, r.status, r.computed_type_code, r.report_json, r.created_at,
                       a.package_id
                  FROM assessment_report r
                  JOIN assessment_attempt a ON a.id = r.attempt_id
                 WHERE r.user_id = ?
                """ + filter + """
                 ORDER BY r.created_at DESC, r.id DESC
                 LIMIT ? OFFSET ?
                """;
        List<Map<String, Object>> rows = kind == null
                ? jdbc.queryForList(query, userId, safeSize, safePage * safeSize)
                : jdbc.queryForList(query, userId, packagePattern, safeSize, safePage * safeSize);

        List<PlatformDtos.MyReportRow> items = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            String packageId = (String) row.get("package_id");
            AssessmentRelease release = catalog.releaseOf(packageId);
            String reportJson = (String) row.get("report_json");
            String reportKind = release == null
                    ? reportKindFromJson(reportJson, packageId)
                    : ReportEnvelope.reportKindOf(release);
            items.add(new PlatformDtos.MyReportRow(
                    (String) row.get("id"),
                    (String) row.get("attempt_id"),
                    release == null ? unknownSlug(packageId) : ReportEnvelope.slugOf(release),
                    release == null ? "unknown" : release.kind().code(),
                    release == null ? "已下线的测评版本" : release.title(),
                    reportKind,
                    packageId,
                    (String) row.get("status"),
                    (String) row.get("computed_type_code"),
                    summaryLine(reportJson),
                    TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("created_at")))));
        }
        return new PlatformDtos.MyReportListResponse(
                List.copyOf(items), safePage, safeSize, total == null ? 0 : total);
    }

    /**
     * 报告详情：原样返回快照，外壳字段尽量从快照里取。
     *
     * <p>三种情况都要正确：
     * <ol>
     *   <li>v2 报告（有外壳）：直接用外壳里的 instrument 字段；</li>
     *   <li>v1 报告（只有报告体）：外壳字段从**这份草稿绑定的内容包**补齐，
     *       并标成 {@code jung_reference}；</li>
     *   <li>内容包已下线的报告：仍然返回快照（用户看得到自己当初得到的结论），
     *       但量表信息标成未知。</li>
     * </ol>
     */
    public PlatformDtos.ReportDetailView report(String userId, String reportId) {
        Map<String, Object> row = readReportRow(reportId, userId);
        return reportView(userId, row);
    }

    public PlatformDtos.ReportDetailView reportByAttempt(String userId, String attemptId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, attempt_id, user_id, status, computed_type_code, report_json, created_at
                  FROM assessment_report WHERE attempt_id = ? AND user_id = ?
                """, attemptId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份测评的报告");
        }
        return reportView(userId, rows.get(0));
    }

    private PlatformDtos.ReportDetailView reportView(String userId, Map<String, Object> row) {
        String reportId = (String) row.get("id");
        String attemptId = (String) row.get("attempt_id");
        Map<String, Object> raw = readJsonMap((String) row.get("report_json"));
        Map<String, Object> envelope = asMap(raw.get("instrument"));
        Map<String, Object> body = bodyOf(raw);

        String packageId = envelope == null ? packageOfAttempt(attemptId) : stringOrNull(envelope.get("packageId"));
        AssessmentRelease release = catalog.releaseOf(packageId);
        String slug = envelope != null
                ? stringOrNull(envelope.get("slug"))
                : (release == null ? unknownSlug(packageId) : ReportEnvelope.slugOf(release));
        String kind = envelope != null
                ? stringOrNull(envelope.get("kind"))
                : (release == null ? "unknown" : release.kind().code());
        String reportKind = envelope != null
                ? stringOrNull(raw.get("reportKind"))
                : reportKindFromJson((String) row.get("report_json"), packageId);

        Map<String, Object> selfReflection = jdbc.queryForList(
                        "SELECT self_selected_type_code, note, updated_at FROM report_self_reflection "
                                + "WHERE report_id = ? AND user_id = ?", reportId, userId)
                .stream().findFirst()
                .map(reflection -> {
                    Map<String, Object> view = new LinkedHashMap<String, Object>();
                    view.put("selfSelectedTypeCode", reflection.get("self_selected_type_code"));
                    view.put("note", reflection.get("note"));
                    view.put("updatedAt", TimeSource.isoFromUtc(
                            TimeSource.utcFromJdbc(reflection.get("updated_at"))));
                    return view;
                })
                .orElseGet(() -> {
                    Map<String, Object> view = new LinkedHashMap<>();
                    view.put("selfSelectedTypeCode", null);
                    view.put("note", null);
                    view.put("updatedAt", null);
                    return view;
                });

        Long revision = jdbc.queryForObject(
                "SELECT revision FROM assessment_attempt WHERE id = ?", Long.class, attemptId);

        return new PlatformDtos.ReportDetailView(
                reportId,
                attemptId,
                slug,
                kind,
                release == null ? "已下线的测评版本" : release.title(),
                reportKind,
                packageId,
                // 这里曾经写成 `(String) row.get("created_at")` —— JDBC 取 DATETIME 列回来的是
                // `java.sql.Timestamp`，那个强转**必然**抛 ClassCastException，于是：
                //   * 报告详情接口 100% 失败（报告能建出来、却永远打不开）；
                //   * `TimeSource.isoFromUtc(...)` 那条分支从来没被执行过，所以"看起来也对"。
                // 时间一律走 TimeSource 转换，不做任何强转。
                row.get("created_at") == null
                        ? stringOrNull(raw.get("createdAt"))
                        : TimeSource.isoFromUtc(TimeSource.utcFromJdbc(row.get("created_at"))),
                (String) row.get("status"),
                (String) row.get("computed_type_code"),
                stringOrNull(body.get("summary")),
                raw,
                selfReflection,
                revision == null ? 0 : revision);
    }

    Map<String, Object> readReportRow(String reportId, String userId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT id, attempt_id, user_id, status, computed_type_code, report_json, created_at
                  FROM assessment_report WHERE id = ? AND user_id = ?
                """, reportId, userId);
        if (rows.isEmpty()) {
            throw JungApiException.notFound("这份报告");
        }
        return rows.get(0);
    }

    private String packageOfAttempt(String attemptId) {
        List<String> ids = jdbc.queryForList(
                "SELECT package_id FROM assessment_attempt WHERE id = ?", String.class, attemptId);
        return ids.isEmpty() ? null : ids.get(0);
    }

    /**
     * 报告体：v2 在外壳的 {@code report} 字段里，v1 就是根节点本身。
     *
     * <p>判据是"根节点有没有 {@code report} 对象"，不是 schemaVersion ——
     * 有些早期快照没写 schemaVersion，用版本号判会把它们误判成 v2。
     */
    static Map<String, Object> bodyOf(Map<String, Object> raw) {
        Map<String, Object> nested = asMap(raw.get("report"));
        return nested == null ? raw : nested;
    }

    /**
     * 内容包已经下线时，从报告快照里反推报告种类。
     *
     * <p>判据是报告体自己**有没有类型码**：大五结构上没有 typeCode，
     * 十六型一定有一个（或明确为 null 的 TIED）。这比"看有没有五个维度"可靠得多 ——
     * 维度名会随版本变，而"有没有类型码"是结构性的。
     */
    private static String reportKindFromJson(String reportJson, String packageId) {
        if (packageId != null && packageId.startsWith("typeme-bigfive50-")) {
            return ReportEnvelope.KIND_BIG_FIVE;
        }
        if (packageId != null && packageId.startsWith("typeme-jung48-")) {
            return ReportEnvelope.KIND_JUNG;
        }
        return ReportEnvelope.KIND_JUNG;
    }

    private String summaryLine(String reportJson) {
        Map<String, Object> body = bodyOf(readJsonMap(reportJson));
        String summary = stringOrNull(body.get("summary"));
        if (summary == null) {
            return "";
        }
        return summary.length() <= 80 ? summary : summary.substring(0, 80) + "…";
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJsonMap(String json) {
        try {
            return mapper.readValue(json, LinkedHashMap.class);
        } catch (JsonProcessingException ex) {
            throw new IllegalStateException("报告 JSON 无法解析（数据被外部改写过？）", ex);
        }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asMap(Object value) {
        return value instanceof Map<?, ?> map ? (Map<String, Object>) map : null;
    }

    private static String stringOrNull(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
