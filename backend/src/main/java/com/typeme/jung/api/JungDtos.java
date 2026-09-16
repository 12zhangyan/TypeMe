package com.typeme.jung.api;

import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * `/api/v3` 的响应体。全部是 record，**只含可以安全外发**的字段。
 *
 * <p>刻意没有"客户端传入分数字段"的 DTO：提交接口里根本没有 typeCode / score 这类入参，
 * 所以"客户端结果不可信"不是靠校验保证的，而是**结构上做不到**。
 */
public final class JungDtos {

    private JungDtos() {
    }

    /* ── 目录与内容包 ───────────────────────────────────────────────────── */

    public record CatalogResponse(
            String packageId,
            String instrumentId,
            String scoringVersion,
            String reportContentVersion,
            String contentStatus,
            String title,
            int questionCount,
            int basePerDimension,
            int clarificationPerDimension,
            int maxClarificationItems,
            String sha256,
            List<DimensionSummary> dimensions) {
    }

    public record DimensionSummary(
            String dimension,
            String name,
            String question,
            String negativePole,
            String negativeLabel,
            String positivePole,
            String positiveLabel) {
    }

    public record PackageResponse(
            int schemaVersion,
            String packageId,
            InstrumentView instrument,
            String title,
            String contentStatus,
            ScoringPolicyView scoringPolicy,
            List<DimensionView> dimensions,
            List<QuestionView> questions,
            String sha256) {
    }

    public record InstrumentView(
            String id,
            String revision,
            String scoringVersion,
            String reportContentVersion,
            String format,
            boolean hasTypeCode,
            int baseItemsPerDimension,
            int clarificationItemsPerDimension,
            int maxClarificationItems) {
    }

    public record ScoringPolicyView(
            String version,
            int minBaseRatingsPerDimension,
            int boundaryNumerator,
            int boundaryDenominator,
            int ratingMin,
            int ratingMax,
            int ratingNeutral) {
    }

    public record DimensionView(
            String dimension,
            String name,
            String question,
            PoleView negativePole,
            PoleView positivePole,
            BalancedView balanced,
            String tiedNotice) {
    }

    public record PoleView(String pole, String label, String description, List<String> dailySigns) {
    }

    public record BalancedView(String summary, String reading) {
    }

    /**
     * 题目视图。
     *
     * <p>带上 {@code leftPole} / {@code rightPole} 是刻意的：前端预览要复现同一套方向规则，
     * 靠"数组顺序"或"高侧是哪个字母"的隐式约定迟早出错。但**不带**任何分数权重字段 ——
     * 计分权重完全由维度正负极推出，不给内容作者写错的机会。
     */
    public record QuestionView(
            String id,
            String stage,
            String dimension,
            String scenario,
            String textLeft,
            String textRight,
            String leftPole,
            String rightPole,
            String help,
            String facet,
            int order,
            String reviewStatus) {
    }

    /* ── 测评 attempt ───────────────────────────────────────────────────── */

    public record CreateAttemptRequest(String baseReportId) {
    }

    public record AttemptSummary(
            String attemptId,
            String packageId,
            String status,
            long revision,
            String currentQuestionId,
            List<String> clarificationDimensions,
            boolean clarificationSkipped,
            String startedAt,
            String updatedAt,
            String submittedAt,
            String reportId) {
    }

    public record AttemptListResponse(List<AttemptSummary> items, int page, int size, long total) {
    }

    public record AttemptDetail(
            String attemptId,
            String packageId,
            String status,
            long revision,
            String currentQuestionId,
            List<String> clarificationDimensions,
            boolean clarificationSkipped,
            String startedAt,
            String updatedAt,
            String submittedAt,
            String baseAttemptId,
            String reportId,
            List<AnswerView> answers,
            List<CoverageView> coverage,
            PackageResponse packageContent) {
    }

    public record AnswerView(String questionId, String kind, Integer rating) {
    }

    public record CoverageView(
            String dimension,
            int baseRatingCount,
            int baseUnknownCount,
            int baseUnprocessedCount,
            boolean needsClarification,
            boolean coverageOk) {
    }

    /** PATCH 答案：rating 与 unknown 互斥由服务端校验，非法整批拒绝。 */
    public record PatchAnswersRequest(
            Long expectedRevision,
            String currentQuestionId,
            List<ResponseInput> responses) {
    }

    public record ResponseInput(String questionId, String kind, Integer rating) {
    }

    public record PatchAnswersResponse(
            long revision,
            String status,
            List<String> clarificationDimensions,
            boolean clarificationReset,
            String currentQuestionId) {
    }

    public record ReviewResponse(
            String status,
            boolean needsReview,
            List<String> clarificationDimensions,
            List<CoverageView> coverage,
            List<String> insufficientDimensions) {
    }

    public record SubmitRequest(Long expectedRevision, Boolean clarificationSkipped) {
    }

    public record SubmitResponse(
            String reportId,
            String attemptId,
            String status,
            String computedTypeCode,
            List<String> candidateCodes,
            List<CoverageView> coverage,
            boolean coverageOk) {
    }

    /* ── 报告 ───────────────────────────────────────────────────────────── */

    public record ReportSummary(
            String reportId,
            String attemptId,
            String createdAt,
            String status,
            String computedTypeCode,
            String selfSelectedTypeCode,
            String summaryLine,
            String packageId,
            String scoringVersion) {
    }

    public record ReportListResponse(List<ReportSummary> items, int page, int size, long total) {
    }

    /**
     * 报告详情。
     *
     * <p>{@code report} 是服务端提交时冻结的 `report_json` 原样返回 —— 历史报告**不重算**。
     * {@code selfReflection} 单独返回，因为它是可变的个人理解，不属于不可变报告快照。
     */
    public record ReportDetail(
            Map<String, Object> report,
            SelfReflectionView selfReflection,
            String attemptId,
            long attemptRevision) {
    }

    public record SelfReflectionView(String selfSelectedTypeCode, String note, String updatedAt) {
    }

    public record SelfReflectionRequest(String selfSelectedTypeCode, String note) {
    }

    public record CompareResponse(
            List<ReportSummary> reports,
            List<DimensionDifference> differences,
            boolean samePackage,
            List<String> notes) {
    }

    public record DimensionDifference(
            String dimension,
            String fromPole,
            String toPole,
            Double fromMFinal,
            Double toMFinal,
            boolean changed) {
    }

    /* ── 映射 ───────────────────────────────────────────────────────────── */

    public static CatalogResponse catalog(JungPackageLoader loader) {
        var pkg = loader.current();
        List<DimensionSummary> dimensions = new ArrayList<>(4);
        for (JungDimension dimension : JungDimension.values()) {
            var copy = pkg.copyOf(dimension);
            dimensions.add(new DimensionSummary(
                    dimension.name(),
                    copy.name(),
                    copy.question(),
                    String.valueOf(copy.negativePole().pole().letter()),
                    copy.negativePole().label(),
                    String.valueOf(copy.positivePole().pole().letter()),
                    copy.positivePole().label()));
        }
        int basePerDimension = pkg.baseItems(JungDimension.EI).size();
        int clarPerDimension = pkg.clarificationItems(JungDimension.EI).size();
        return new CatalogResponse(
                pkg.packageId(),
                pkg.instrumentId(),
                pkg.scoringVersion(),
                pkg.reportContentVersion(),
                pkg.contentStatus().token(),
                pkg.title(),
                pkg.questions().size(),
                basePerDimension,
                clarPerDimension,
                clarPerDimension * JungDimension.values().length,
                pkg.sha256(),
                List.copyOf(dimensions));
    }

    public static PackageResponse packageView(JungPackageLoader loader) {
        var pkg = loader.current();
        List<DimensionView> dimensions = new ArrayList<>(4);
        for (JungDimension dimension : JungDimension.values()) {
            var copy = pkg.copyOf(dimension);
            dimensions.add(new DimensionView(
                    dimension.name(),
                    copy.name(),
                    copy.question(),
                    new PoleView(
                            String.valueOf(copy.negativePole().pole().letter()),
                            copy.negativePole().label(),
                            copy.negativePole().description(),
                            copy.negativePole().dailySigns()),
                    new PoleView(
                            String.valueOf(copy.positivePole().pole().letter()),
                            copy.positivePole().label(),
                            copy.positivePole().description(),
                            copy.positivePole().dailySigns()),
                    new BalancedView(copy.balancedSummary(), copy.balancedReading()),
                    copy.tiedNotice()));
        }
        List<QuestionView> questions = new ArrayList<>(pkg.questions().size());
        for (JungItem item : pkg.questions()) {
            questions.add(new QuestionView(
                    item.id(),
                    item.stage().token(),
                    item.dimension().name(),
                    item.scenario(),
                    item.textLeft(),
                    item.textRight(),
                    String.valueOf(item.leftPole().letter()),
                    String.valueOf(item.rightPole().letter()),
                    item.help(),
                    item.facet(),
                    item.order(),
                    item.reviewStatus().token()));
        }
        return new PackageResponse(
                3,
                pkg.packageId(),
                new InstrumentView(
                        pkg.instrumentId(),
                        pkg.revision(),
                        pkg.scoringVersion(),
                        pkg.reportContentVersion(),
                        "bipolar",
                        true,
                        12,
                        4,
                        16),
                pkg.title(),
                pkg.contentStatus().token(),
                new ScoringPolicyView(
                        pkg.scoringPolicy().version(),
                        pkg.scoringPolicy().minBaseRatingsPerDimension(),
                        pkg.scoringPolicy().boundaryNumerator(),
                        pkg.scoringPolicy().boundaryDenominator(),
                        pkg.scoringPolicy().ratingMin(),
                        pkg.scoringPolicy().ratingMax(),
                        pkg.scoringPolicy().ratingNeutral()),
                List.copyOf(dimensions),
                List.copyOf(questions),
                pkg.sha256());
    }

    public static Map<String, Object> emptySelfReflection() {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("selfSelectedTypeCode", null);
        map.put("note", null);
        map.put("updatedAt", null);
        return map;
    }
}
