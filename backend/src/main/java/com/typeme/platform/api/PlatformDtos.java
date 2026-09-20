package com.typeme.platform.api;

import java.util.List;
import java.util.Map;

/**
 * `/api/v3/platform` 的响应体：**量表无关**的测评流程。
 *
 * <p>与 {@link com.typeme.jung.api.JungDtos} 的分工：
 * <ul>
 *   <li>这里的 DTO 只说"有哪些测评、这份草稿锁定了什么、有哪些题、答案是什么、
 *       报告外壳长什么样"；</li>
 *   <li>报告的**内容**不是一个固定 schema（{@code ReportDetailView.report} 是
 *       原样返回的快照），按 {@code reportKind} 交给对应渲染器。</li>
 * </ul>
 *
 * <p>题目视图为什么把两种题型放进同一个 record（而不是两个子类型）：JSON 里多一层
 * 判别式会让前端每次读题都要先做一次类型收窄，而这里字段很少、语义清楚 ——
 * {@code kind} 决定看哪几个字段。字段为 null 就表示"这个题型没有这个概念"，
 * 例如大五题的 {@code left} / {@code right} 永远是 null。
 */
public final class PlatformDtos {

    private PlatformDtos() {
    }

    /* ── 目录 ───────────────────────────────────────────────────────────── */

    /** 一份量表的产品定义 + 它当前的默认版本。 */
    public record InstrumentCard(
            String slug,
            String kind,
            String title,
            String tagline,
            String summary,
            List<String> whatYouLearn,
            List<String> notFor,
            String format,
            boolean hasTypeCode,
            boolean supportsClarification,
            List<String> dimensions,
            String defaultPackageId,
            int baseItemCount,
            int clarificationItemCount,
            int maxClarificationItems,
            int estimatedMinutes,
            String contentStatus) {
    }

    public record InstrumentListResponse(List<InstrumentCard> items) {
    }

    /** 量表详情：定义 + 默认版本的维度解释 + 近期版本列表。 */
    public record InstrumentDetail(
            InstrumentCard instrument,
            List<DimensionCopyView> dimensions,
            List<VersionView> versions) {
    }

    /**
     * 一个维度在界面上的解释。
     *
     * <p>两侧都有：即使这项量表"没有类型"，界面也要能说清两端各是什么样子。
     *
     * @param lowLabel/lowDescription/lowSigns    靠低的一侧（十六型是"负极"）
     * @param highLabel/highDescription/highSigns 靠高的一侧
     */
    public record DimensionCopyView(
            String dimension,
            String name,
            String question,
            String lowLabel,
            String lowDescription,
            List<String> lowSigns,
            String highLabel,
            String highDescription,
            List<String> highSigns,
            String balancedSummary,
            String caution,
            String observation) {
    }

    public record VersionView(
            String packageId,
            String revision,
            String scoringVersion,
            String reportContentVersion,
            String contentStatus,
            String sha256,
            boolean isDefault,
            int baseItemCount,
            int clarificationItemCount) {
    }

    /* ── 草稿与答题 ─────────────────────────────────────────────────────── */

    /**
     * 一次测评。
     *
     * <p>{@code status} 复用十六型的取值集合（{@code BASE_IN_PROGRESS} /
     * {@code CLARIFICATION_IN_PROGRESS} / {@code SUBMITTED}）：它落在同一列上，
     * 而"大五永远不会有 CLARIFICATION_IN_PROGRESS"这一点由
     * {@code InstrumentKind.supportsClarificationRound()} 表达，不是靠多一个枚举值。
     */
    public record AttemptView(
            String attemptId,
            String instrumentSlug,
            String instrumentKind,
            String instrumentTitle,
            String packageId,
            String reportKind,
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
            List<ItemView> items,
            int answeredCount,
            int requiredCount,
            boolean answerComplete) {
    }

    /**
     * 题目视图。
     *
     * @param kind      {@code bipolar_pair} / {@code agreement_statement}
     * @param stage     {@code base} / {@code clarification}（大五恒为 base）
     * @param left      双极题左端题面；单句题为 null
     * @param right     双极题右端题面；单句题为 null
     * @param statement 单句题题面；双极题为 null
     * @param direction 单句题计分方向（+1 / -1）；双极题为 null。
     *                  前端**不**用它计分，只用它在题面上标注"这一句是正向描述"。
     */
    public record ItemView(
            String id,
            String kind,
            String stage,
            String dimension,
            int order,
            String scenario,
            String left,
            String right,
            String statement,
            String leftPole,
            String rightPole,
            Integer direction,
            String help) {
    }

    public record AnswerView(String questionId, String kind, Integer rating) {
    }

    public record CreateAttemptRequest(String instrument, String baseReportId) {
    }

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
            int answeredCount,
            int requiredCount,
            boolean answerComplete,
            String currentQuestionId) {
    }

    public record SubmitRequest(Long expectedRevision) {
    }

    /**
     * 提交结果。
     *
     * <p>{@code incompleteQuestionIds} 非空表示"还差这些题"，此时**没有**报告，
     * 前端应回到答题页并把这些题标出来。它不是错误响应：用户没有做错任何事，
     * 只是还没答完。
     */
    public record SubmitResponse(
            String reportId,
            String attemptId,
            String status,
            String reportKind,
            List<String> incompleteQuestionIds,
            int unknownCount,
            int unprocessedCount) {
    }

    /* ── 报告 ───────────────────────────────────────────────────────────── */

    /**
     * 报告详情。
     *
     * <p>{@code report} 是提交时冻结的 {@code report_json} 原样返回 ——
     * 历史报告**不重算、不改写**。它可能是有外壳的 v2，也可能是只有报告体的 v1，
     * 由消费方按结构判断（见 {@code frontend/src/domain/reportV3.ts} 的兼容分支）。
     */
    public record ReportDetailView(
            String reportId,
            String attemptId,
            String instrumentSlug,
            String instrumentKind,
            /**
             * 量表名。历史报告在读不到内容包时（该版本已下线）用明确的占位文字，
             * 而不是空字符串 —— 报告页顶上那行必须始终说得通。
             */
            String instrumentTitle,
            String reportKind,
            String packageId,
            String createdAt,
            String status,
            String computedTypeCode,
            String summaryLine,
            Map<String, Object> report,
            Map<String, Object> selfReflection,
            long attemptRevision) {
    }

    /**
     * 我的测评列表里的一行。
     *
     * <p>列表必须能**一眼看出这一行是哪项测评的哪一版**：只显示时间与状态的话，
     * 同时存在十六型与大五时用户无法区分，看到旧版本也无法解释。
     */
    public record MyAttemptRow(
            String attemptId,
            String instrumentSlug,
            String instrumentKind,
            String instrumentTitle,
            String packageId,
            String reportContentVersion,
            String status,
            long revision,
            String startedAt,
            String updatedAt,
            String submittedAt,
            String reportId,
            String reportStatus,
            String computedTypeCode,
            int answeredCount,
            int requiredCount) {
    }

    public record MyAttemptListResponse(List<MyAttemptRow> items, int page, int size, long total) {
    }

    /**
     * 我的报告列表里的一行。
     *
     * <p>{@code reportKind} 决定前端跳转到哪个报告页；{@code summaryLine} 来自报告快照本身
     * （旧报告也一样能取到，因为它读的就是当初写进去的那份 JSON）。
     */
    public record MyReportRow(
            String reportId,
            String attemptId,
            String instrumentSlug,
            String instrumentKind,
            String instrumentTitle,
            String reportKind,
            String packageId,
            String status,
            String computedTypeCode,
            String summaryLine,
            String createdAt) {
    }

    public record MyReportListResponse(List<MyReportRow> items, int page, int size, long total) {
    }

    /* ── 公开插画地址（运行期从库里取） ─────────────────────────────────── */

    /**
     * 一张公开插画的远端地址。
     *
     * @param name   逻辑名，等于素材文件名（`home-hero`、`type-intj`……），前端按它取值
     * @param url    绝对地址；路径里带内容哈希，所以"换图 = 换地址"，不需要刷缓存
     * @param sha256 该地址应有的字节哈希，供核对脚本做"库 ↔ 本地素材 ↔ 远端对象"三方核对
     */
    public record IllustrationAssetView(String name, String url, String sha256) {
    }

    /**
     * 全部公开插画 + 一个内容版本号。
     *
     * <p>{@code version} 由"行数 + 最新 updated_at"拼成，是不透明字符串：前端只拿它判断
     * 本地缓存是否还有效，**不要**解析它的内部结构。任何一行被改、被加、被删，它都会变。
     *
     * <p>为什么把 {@code release} 和 {@code version} 都带上：前者是"这批素材属于哪次发布"
     * （人看的、可整体回退的标签），后者是"这份数据变没变"（机器判等用的）。
     */
    public record IllustrationListResponse(String release, String version, List<IllustrationAssetView> assets) {
    }

    /**
     * 改一批插画地址的请求。**只允许公开插画的名字**，且地址必须是 https + 允许清单内的域名
     * （校验在服务层，见 {@code IllustrationAssetService}）。
     */
    public record IllustrationUpdateRequest(List<IllustrationUpdateItem> assets) {
    }

    public record IllustrationUpdateItem(String name, String url, String sha256, String release) {
    }
}
