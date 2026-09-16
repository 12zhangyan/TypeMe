package com.typeme.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.typeme.model.AssessmentPackage;
import com.typeme.model.MethodContent;
import com.typeme.model.Questionnaire;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * v2 内容包校验测试（字段规格 §2–§9）。
 *
 * <p>与 {@code ContentValidationTest} 同风格：**内存夹具**（Map → record）验证校验逻辑本身有效，
 * 包括「故意把帮助删一条、把状态写成 reviewed、把符号改反」这类必须在启动期炸掉的内容错误。
 *
 * <p>⚠️ 本类**不读也不写** {@code src/main/resources/assessment-packages/} 下的 YAML：
 * 那些文件由另一个工作流拥有，可能在我写代码时还没落盘。
 * 「真实包能不能被加载」由 {@link AssessmentPackageLoadingTest} 单独处理。
 *
 * <p>{@code public} + {@link #validFixture()} 是给
 * {@code com.typeme.controller.AssessmentPackageControllerTest} 复用的（跨包使用）。
 */
public class AssessmentPackageValidationTest {
    private static final String PACKAGE_ID = "oejts32-zh1-report2";

    /** 四种证据状态，顺序与 {@link ContentService#CONTENT_STATUSES} 一致（由测试独立复述）。 */
    private static final List<String> STATUSES = List.of("draft", "reviewed", "field_checked");

    private static final ObjectMapper YAML = new YAMLMapper();

    // ------------------------------------------------------------------ 夹具构造

    /**
     * 最小合法内容包夹具。
     *
     * <p>符号 / 常量 / midpoint **独立复述规格 §3 的表**（与 {@link ContentService#OFFICIAL_SIGNS}
     * 分开写），两处不一致时夹具本身就会先被 {@code validateQuestionnaire} 拦下。
     *
     * <p>{@code public} 是为了让控制器测试也能拿到一份合法包（跨包使用）。
     */
    public static Map<String, Object> validFixture() {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", 2);
        root.put("packageId", PACKAGE_ID);
        root.put("locale", "zh-CN");
        root.put("localeRevision", "zh1-2026-09-01");
        root.put("helpRevision", "help-zh1-r1");
        root.put("copyRevision", "report2-r1");
        root.put("contentStatus", "draft");
        root.put("instrument", instrument("oejts32", "1.2", "oejts-1.2"));
        root.put("interpretation", interpretation("typeme-conservative-v2", 8, 5, 9));
        root.put("title", "快速版（现行题面）");
        root.put("estimatedMinutes", 5);
        root.put("questionnaire", questionnaire());
        root.put("itemHelp", itemHelp("draft"));
        root.put("dimensionCopy", dimensionCopy());
        root.put("reportCopy", reportCopy());
        root.put("nextSteps", new ArrayList<>(List.of("建议一", "建议二", "建议三")));
        root.put("attribution", attribution());
        return root;
    }

    private static Map<String, Object> instrument(String id, String revision, String scoringVersion) {
        Map<String, Object> instrument = new LinkedHashMap<>();
        instrument.put("id", id);
        instrument.put("revision", revision);
        instrument.put("scoringVersion", scoringVersion);
        return instrument;
    }

    private static Map<String, Object> interpretation(String version, int minRatings, int typeMin,
                                                      int marked) {
        Map<String, Object> interpretation = new LinkedHashMap<>();
        interpretation.put("version", version);
        interpretation.put("minRatingsPerDimension", minRatings);
        interpretation.put("typeMinDistance", typeMin);
        interpretation.put("markedDistance", marked);
        return interpretation;
    }

    /**
     * 规格 §3 的官方符号表（测试内独立复述）。
     *
     * <pre>
     * EI 30：+15 +23 +27 / −3 −7 −11 −19 −31
     * SN 12：+4 +8 +12 +16 +20 +32 / −24 −28
     * TF 30：+6 +10 +22 / −2 −14 −18 −26 −30
     * JP 18：+1 +5 +13 +21 +29 / −9 −17 −25
     * </pre>
     */
    private static final Map<String, Map<Integer, Integer>> OFFICIAL_SIGNS = Map.of(
            "EI", Map.of(3, -1, 7, -1, 11, -1, 15, 1, 19, -1, 23, 1, 27, 1, 31, -1),
            "SN", Map.of(4, 1, 8, 1, 12, 1, 16, 1, 20, 1, 24, -1, 28, -1, 32, 1),
            "TF", Map.of(2, -1, 6, 1, 10, 1, 14, -1, 18, -1, 22, 1, 26, -1, 30, -1),
            "JP", Map.of(1, 1, 5, 1, 9, -1, 13, 1, 17, -1, 21, 1, 25, -1, 29, 1));

    private static Map<String, Object> questionnaire() {
        Map<Integer, String> dimensionOfId = new HashMap<>();
        Map<Integer, Integer> signOfId = new HashMap<>();
        OFFICIAL_SIGNS.forEach((dimension, signs) -> signs.forEach((id, sign) -> {
            dimensionOfId.put(id, dimension);
            signOfId.put(id, sign);
        }));

        List<Map<String, Object>> questions = new ArrayList<>();
        for (int id = 1; id <= ContentService.QUICK_QUESTION_COUNT; id++) {
            questions.add(question(id, dimensionOfId.get(id), signOfId.get(id)));
        }

        Map<String, Object> questionnaire = new LinkedHashMap<>();
        questionnaire.put("version", "quick");
        questionnaire.put("title", "快速版");
        questionnaire.put("questionCount", ContentService.QUICK_QUESTION_COUNT);
        questionnaire.put("estimatedMinutes", 5);
        questionnaire.put("scoring", scoring(24, new LinkedHashMap<>(Map.of(
                "EI", 30, "SN", 12, "TF", 30, "JP", 18))));
        questionnaire.put("questions", questions);
        return questionnaire;
    }

    private static Map<String, Object> question(int id, String dimension, int direction) {
        Map<String, Object> question = new LinkedHashMap<>();
        question.put("id", id);
        question.put("textLeft", "夹具左端" + id);
        question.put("textRight", "夹具右端" + id);
        question.put("dimension", dimension);
        question.put("direction", direction);
        return question;
    }

    private static Map<String, Object> scoring(int midpoint, Map<String, Integer> constants) {
        Map<String, Object> scoring = new LinkedHashMap<>();
        scoring.put("midpoint", midpoint);
        scoring.put("constants", constants);
        return scoring;
    }

    private static Map<String, Object> itemHelp(String reviewStatus) {
        Map<String, Object> itemHelp = new LinkedHashMap<>();
        for (int id = 1; id <= ContentService.QUICK_QUESTION_COUNT; id++) {
            itemHelp.put(String.valueOf(id), itemHelpEntry(reviewStatus, List.of()));
        }
        return itemHelp;
    }

    private static Map<String, Object> itemHelpEntry(String reviewStatus, List<String> riskCodes) {
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("explanation", "这一题比较的是两端在同一个情境下的差别，可以直接按平时最常出现的做法来选。");
        entry.put("reviewStatus", reviewStatus);
        entry.put("riskCodes", new ArrayList<>(riskCodes));
        return entry;
    }

    private static Map<String, Object> dimensionCopy() {
        Map<String, Object> dimensionCopy = new LinkedHashMap<>();
        dimensionCopy.put("EI", dimension("精力方向", "内向", "外向"));
        dimensionCopy.put("SN", dimension("信息获取", "实感", "直觉"));
        dimensionCopy.put("TF", dimension("决策依据", "情感", "思考"));
        dimensionCopy.put("JP", dimension("生活节奏", "判断", "知觉"));
        return dimensionCopy;
    }

    private static Map<String, Object> dimension(String name, String negativeLabel, String positiveLabel) {
        Map<String, Object> dimension = new LinkedHashMap<>();
        dimension.put("name", name);
        dimension.put("negative", pole(negativeLabel));
        dimension.put("positive", pole(positiveLabel));
        Map<String, Object> balanced = new LinkedHashMap<>();
        balanced.put("summary", "本次这一维的回答合计接近两侧均衡，先保留未定。");
        balanced.put("observation", "可以回看具体题目，再观察不同情境下的偏好。");
        dimension.put("balanced", balanced);
        Map<String, Object> insufficient = new LinkedHashMap<>();
        insufficient.put("summary", "这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。");
        insufficient.put("nextStep", "可以回看帮助，也可以保留当前报告。");
        dimension.put("insufficient", insufficient);
        return dimension;
    }

    private static Map<String, Object> pole(String label) {
        Map<String, Object> pole = new LinkedHashMap<>();
        pole.put("label", label);
        pole.put("description", "这一侧描述的是本维度的偏好，不代表能力高低。");
        pole.put("observation", "回想一次具体情境，看看哪种做法更省力。");
        pole.put("action", "下次遇到类似情境时，留意自己实际的选择。");
        return pole;
    }

    /** 规格 §6 的全部 12 个字段（少一个就少一处界面文案）。 */
    private static Map<String, Object> reportCopy() {
        Map<String, Object> reportCopy = new LinkedHashMap<>();
        reportCopy.put("typedTitle", "本次问卷参考组合");
        reportCopy.put("typedSubtitle", "四个维度都达到本产品的展示条件。");
        reportCopy.put("partialTitle", "我的偏好，还有待观察的部分");
        reportCopy.put("partialSubtitle", "部分维度可以给出方向，其余维度本次不足以判型。");
        reportCopy.put("undeterminedTitle", "本次回答没有显示明确方向");
        reportCopy.put("undeterminedSubtitle", "四个维度都落在接近中点的范围，本次不生成完整类型。");
        reportCopy.put("insufficientTitle", "这次先保留未定");
        reportCopy.put("insufficientSubtitle", "有维度缺少足够的有效作答，本次不计算这些维度的分数。");
        reportCopy.put("typeReadingLead", "类型参考介绍：按本版题目组合起来的通用阅读材料。");
        reportCopy.put("scoreMethodNote", "得分 = 该维度常量 + Σ(方向符号 × 你的选择)。");
        reportCopy.put("dimensionReviewLead", "下面是这一维相关的题目与你的选择。它只帮助回顾。");
        reportCopy.put("selfReflectionLead", "这段记录只用于你自己的观察，不计入量表分数。");
        return reportCopy;
    }

    static Map<String, Object> attribution() {
        Map<String, Object> attribution = new LinkedHashMap<>();
        attribution.put("source", ContentService.OFFICIAL_ATTRIBUTION.source());
        attribution.put("author", ContentService.OFFICIAL_ATTRIBUTION.author());
        attribution.put("url", ContentService.OFFICIAL_ATTRIBUTION.url());
        attribution.put("license", ContentService.OFFICIAL_ATTRIBUTION.license());
        attribution.put("licenseUrl", ContentService.OFFICIAL_ATTRIBUTION.licenseUrl());
        return attribution;
    }

    // ------------------------------------------------------------------ 夹具操作

    static AssessmentPackage parse(Map<String, Object> fixture) {
        return YAML.convertValue(fixture, AssessmentPackage.class);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> itemHelpOf(Map<String, Object> root) {
        return (Map<String, Object>) root.get("itemHelp");
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> itemHelpEntry(Map<String, Object> root, int id) {
        return (Map<String, Object>) itemHelpOf(root).get(String.valueOf(id));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> dimensionCopyOf(Map<String, Object> root) {
        return (Map<String, Object>) root.get("dimensionCopy");
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> dimensionOf(Map<String, Object> root, String dimension) {
        return (Map<String, Object>) dimensionCopyOf(root).get(dimension);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> reportCopyOf(Map<String, Object> root) {
        return (Map<String, Object>) root.get("reportCopy");
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> questions(Map<String, Object> root) {
        return (List<Map<String, Object>>) ((Map<String, Object>) root.get("questionnaire")).get("questions");
    }

    static void assertRejected(Map<String, Object> fixture, String expectedFragment) {
        assertRejected(fixture, PACKAGE_ID, expectedFragment);
    }

    static void assertRejected(Map<String, Object> fixture, String origin, String expectedFragment) {
        AssessmentPackage pkg = parse(fixture);
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateAssessmentPackage(pkg, origin),
                "坏内容包必须让校验失败，否则校验就是摆设");
        assertTrue(error.getMessage().contains(expectedFragment),
                "错误信息应包含「" + expectedFragment + "」，实际：" + error.getMessage());
    }

    // ------------------------------------------------------------------ 正例

    @Test
    @DisplayName("完整最小合法包（内存夹具）→ 校验通过；等价于两个真实包必须满足的形态")
    void acceptsValidFixture() {
        assertDoesNotThrow(() -> ContentService.validateAssessmentPackage(parse(validFixture()), PACKAGE_ID));
    }

    @Test
    @DisplayName("第二个包 ID（preview 修订号）同样合法——白名单里两个包用同一套断言")
    void acceptsSecondWhitelistedPackageId() {
        Map<String, Object> fixture = validFixture();
        fixture.put("packageId", "oejts32-zh2-preview-r1");
        assertDoesNotThrow(() -> ContentService.validateAssessmentPackage(
                parse(fixture), "oejts32-zh2-preview-r1"));
    }

    @Test
    @DisplayName("逐题帮助为 reviewed 且包状态为 reviewed → 通过（状态与证据一致时不得误报）")
    void acceptsReviewedPackageWithReviewedHelp() {
        Map<String, Object> fixture = validFixture();
        fixture.put("itemHelp", itemHelp("reviewed"));
        fixture.put("contentStatus", "reviewed");
        assertDoesNotThrow(() -> ContentService.validateAssessmentPackage(parse(fixture), PACKAGE_ID));
    }

    // ------------------------------------------------------------------ 顶层与身份

    @Test
    @DisplayName("schemaVersion 不是 2 → 校验必须失败")
    void rejectsWrongSchemaVersion() {
        Map<String, Object> fixture = validFixture();
        fixture.put("schemaVersion", 1);
        assertRejected(fixture, "schemaVersion 必须是 2");
    }

    @Test
    @DisplayName("packageId 与文件名（origin）不一致 → 校验必须失败")
    void rejectsPackageIdNotMatchingOrigin() {
        Map<String, Object> fixture = validFixture();
        fixture.put("packageId", "oejts32-zh2-preview-r1");
        assertRejected(fixture, PACKAGE_ID, "文件名必须等于 packageId");
    }

    @Test
    @DisplayName("locale 不是 zh-CN / instrument 版本被改 / 解释政策常量被改 → 校验必须失败")
    void rejectsWrongLocaleInstrumentAndPolicy() {
        Map<String, Object> locale = validFixture();
        locale.put("locale", "en-US");
        assertRejected(locale, "locale 必须是 zh-CN");

        Map<String, Object> instrument = validFixture();
        instrument.put("instrument", instrument("oejts32", "1.3", "oejts-1.2"));
        assertRejected(instrument, "instrument.revision 必须是 1.2");

        Map<String, Object> scoringVersion = validFixture();
        scoringVersion.put("instrument", instrument("oejts32", "1.2", "oejts-1.3"));
        assertRejected(scoringVersion, "instrument.scoringVersion 必须是 oejts-1.2");

        Map<String, Object> minRatings = validFixture();
        minRatings.put("interpretation", interpretation("typeme-conservative-v2", 7, 5, 9));
        assertRejected(minRatings, "interpretation.minRatingsPerDimension 必须是 8");

        Map<String, Object> typeMin = validFixture();
        typeMin.put("interpretation", interpretation("typeme-conservative-v2", 8, 4, 9));
        assertRejected(typeMin, "interpretation.typeMinDistance 必须是 5");

        Map<String, Object> marked = validFixture();
        marked.put("interpretation", interpretation("typeme-conservative-v2", 8, 5, 8));
        assertRejected(marked, "interpretation.markedDistance 必须是 9");
    }

    @Test
    @DisplayName("localeRevision / helpRevision / copyRevision 留空 → 字段级校验必须失败")
    void rejectsBlankRevisions() {
        for (String field : new String[]{"localeRevision", "helpRevision", "copyRevision"}) {
            Map<String, Object> fixture = validFixture();
            fixture.put(field, "   ");
            assertRejected(fixture, "字段级校验失败");
        }
    }

    @Test
    @DisplayName("title 留空 / estimatedMinutes 越界 → 校验必须失败")
    void rejectsTitleAndEstimatedMinutes() {
        Map<String, Object> title = validFixture();
        title.put("title", "  ");
        assertRejected(title, "字段级校验失败");

        Map<String, Object> tooLong = validFixture();
        tooLong.put("estimatedMinutes", 61);
        assertRejected(tooLong, "estimatedMinutes 必须在 1–" + ContentService.MAX_ESTIMATED_MINUTES);

        Map<String, Object> zero = validFixture();
        zero.put("estimatedMinutes", 0);
        assertRejected(zero, "estimatedMinutes 必须在 1–" + ContentService.MAX_ESTIMATED_MINUTES);
    }

    // ------------------------------------------------------------------ contentStatus

    @Test
    @DisplayName("帮助里有 draft 但包写 reviewed → 校验必须失败（状态不得高于证据）")
    void rejectsContentStatusHigherThanEvidence() {
        Map<String, Object> fixture = validFixture();
        fixture.put("contentStatus", "reviewed");
        assertRejected(fixture, "高于包内最低证据状态 draft");

        Map<String, Object> fieldChecked = validFixture();
        fieldChecked.put("contentStatus", "field_checked");
        assertRejected(fieldChecked, "高于包内最低证据状态 draft");
    }

    @Test
    @DisplayName("只有 Q17 帮助是 draft，其余是 reviewed，包写 reviewed → 仍必须失败（最低证据才算数）")
    void rejectsContentStatusWhenSingleItemIsDraft() {
        Map<String, Object> fixture = validFixture();
        fixture.put("itemHelp", itemHelp("reviewed"));
        itemHelpOf(fixture).put("17", itemHelpEntry("draft", List.of()));
        fixture.put("contentStatus", "reviewed");
        assertRejected(fixture, "contentStatus=reviewed 高于包内最低证据状态 draft");
    }

    @Test
    @DisplayName("contentStatus 非法值（approved）→ 校验必须失败")
    void rejectsUnknownContentStatus() {
        Map<String, Object> fixture = validFixture();
        fixture.put("contentStatus", "approved");
        assertRejected(fixture, "contentStatus 必须是");
    }

    @Test
    @DisplayName("帮助 reviewStatus 非法值（checked）→ 校验必须失败，并指到具体题号")
    void rejectsUnknownReviewStatus() {
        Map<String, Object> fixture = validFixture();
        itemHelpOf(fixture).put("6", itemHelpEntry("checked", List.of()));
        assertRejected(fixture, "Q6 的 itemHelp.reviewStatus");
    }

    // ------------------------------------------------------------------ itemHelp

    @Test
    @DisplayName("逐题帮助缺一项（Q32）→ 校验必须失败，并列出缺失题号")
    void rejectsMissingHelpEntry() {
        Map<String, Object> fixture = validFixture();
        itemHelpOf(fixture).remove("32");
        assertRejected(fixture, "itemHelp 缺少题号的帮助: [32]");
    }

    @Test
    @DisplayName("帮助键不是 \"1\"..\"32\"（多出 \"33\"、混入 \"extra\"）→ 校验必须失败")
    void rejectsIllegalHelpKeys() {
        Map<String, Object> extra = validFixture();
        itemHelpOf(extra).put("33", itemHelpEntry("draft", List.of()));
        assertRejected(extra, "itemHelp 出现了非法键");

        // ⚠️ "01" 这类键在 Map<String, ...> 上会被 Jackson 的键反序列化归一成 "1"（实测），
        //    因此这里用一个不会被归一的字符串键来覆盖「非数字键」这条路径。
        Map<String, Object> textKey = validFixture();
        itemHelpOf(textKey).put("extra", itemHelpEntry("draft", List.of()));
        assertRejected(textKey, "itemHelp 出现了非法键");
    }

    @Test
    @DisplayName("某题 explanation 为空 → 校验必须失败，并指到具体题号")
    void rejectsBlankExplanation() {
        Map<String, Object> fixture = validFixture();
        itemHelpEntry(fixture, 12).put("explanation", "   ");
        // 字段级校验先拦下（@NotBlank 在 itemHelp[*].explanation 上）
        assertRejected(fixture, "字段级校验失败");

        Map<String, Object> absent = validFixture();
        itemHelpEntry(absent, 12).remove("explanation");
        assertRejected(absent, "字段级校验失败");
    }

    @Test
    @DisplayName("riskCodes 含非法值（X）→ 校验必须失败，并指到具体题号")
    void rejectsIllegalRiskCode() {
        Map<String, Object> fixture = validFixture();
        itemHelpEntry(fixture, 9).put("riskCodes", new ArrayList<>(List.of("L", "X")));
        assertRejected(fixture, "Q9 的 itemHelp.riskCodes 含非法值 [X]");
    }

    @Test
    @DisplayName("riskCodes 为空数组或 L/B/C 子集 → 合法（不得误报）")
    void acceptsLegalRiskCodes() {
        Map<String, Object> fixture = validFixture();
        itemHelpEntry(fixture, 6).put("riskCodes", new ArrayList<>(List.of("L", "B")));
        itemHelpEntry(fixture, 9).put("riskCodes", new ArrayList<>(List.of("C")));
        assertDoesNotThrow(() -> ContentService.validateAssessmentPackage(parse(fixture), PACKAGE_ID));
    }

    @Test
    @DisplayName("帮助文本含开发者批注「该解释的场景范围须与最终题面一致」→ 校验必须失败")
    void rejectsDeveloperAnnotationInHelp() {
        Map<String, Object> fixture = validFixture();
        itemHelpEntry(fixture, 4).put("explanation",
                "这一题比较的是两端做法。该解释的场景范围须与最终题面一致。");
        assertRejected(fixture, "Q4 的帮助文本含面向开发者的内部批注");
    }

    @Test
    @DisplayName("帮助文本含开发者批注「若采用」→ 校验必须失败")
    void rejectsConditionalEditorialNoteInHelp() {
        Map<String, Object> fixture = validFixture();
        itemHelpEntry(fixture, 8).put("explanation", "若采用「先」字版本需核对两端是否对称。");
        assertRejected(fixture, "Q8 的帮助文本含面向开发者的内部批注");
    }

    // ------------------------------------------------------------------ 内嵌题库（复用 v1 断言）

    @Test
    @DisplayName("符号被改反（Q1 的 direction）→ 校验必须失败")
    void rejectsFlippedDirection() {
        Map<String, Object> fixture = validFixture();
        questions(fixture).get(0).put("direction", -1);
        assertRejected(fixture, "JP 维度的题号/符号与官方 oejts32 1.2 公式不一致");
    }

    @Test
    @DisplayName("少一题（Q32 被删）→ 校验必须失败")
    void rejectsMissingQuestion() {
        Map<String, Object> fixture = validFixture();
        questions(fixture).remove(ContentService.QUICK_QUESTION_COUNT - 1);
        assertRejected(fixture, "与 questions 实际条数 31 不一致");
    }

    @Test
    @DisplayName("常量被改（EI 写成 28）→ 校验必须失败")
    void rejectsWrongConstant() {
        Map<String, Object> fixture = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Integer> constants = (Map<String, Integer>)
                ((Map<String, Object>) ((Map<String, Object>) fixture.get("questionnaire")).get("scoring"))
                        .get("constants");
        constants.put("EI", 28);
        assertRejected(fixture, "scoring.constants");
    }

    @Test
    @DisplayName("midpoint 不是 24 → 校验必须失败")
    void rejectsWrongMidpoint() {
        Map<String, Object> fixture = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> scoring = (Map<String, Object>) 
                ((Map<String, Object>) fixture.get("questionnaire")).get("scoring");
        scoring.put("midpoint", 25);
        assertRejected(fixture, "scoring.midpoint 必须是 24");
    }

    @Test
    @DisplayName("内嵌 questionnaire.version 不是 quick → 校验必须失败（前端 v1 会话/旧记录按它识别量表）")
    void rejectsNonQuickQuestionnaireVersion() {
        // v1 入口（两参数重载）现在**无条件**用 OEJTS 官方档案核对逐题符号：
        // 仪器档案是显式传入的，不再靠 version 决定是否核对，所以改 version 绕不过符号断言。
        Map<String, Object> differentVersion = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> inner = (Map<String, Object>) differentVersion.get("questionnaire");
        inner.put("version", "standard");
        questions(differentVersion).forEach(question -> question.put("direction", 1));
        Questionnaire notQuick = YAML.convertValue(inner, Questionnaire.class);
        assertThrows(ContentValidationException.class,
                () -> ContentService.validateQuestionnaire(notQuick, "not-quick.yml"),
                "符号被整体改成 +1 时，v1 入口必须用官方档案拦下（与 version 无关）");

        // 同样的包走内容包校验：version 断言与符号断言都在
        assertRejected(differentVersion, "内嵌 questionnaire.version 必须是 \"quick\"");
    }

    // ------------------------------------------------------------------ dimensionCopy

    @Test
    @DisplayName("dimensionCopy 少一个维度（缺 TF）→ 校验必须失败")
    void rejectsMissingDimension() {
        Map<String, Object> fixture = validFixture();
        dimensionCopyOf(fixture).remove("TF");
        assertRejected(fixture, "dimensionCopy 的键必须恰好是");
    }

    @Test
    @DisplayName("dimensionCopy 多一个非法维度键（XX）→ 校验必须失败")
    void rejectsUnknownDimensionKey() {
        Map<String, Object> fixture = validFixture();
        dimensionCopyOf(fixture).put("XX", dimension("非法维度", "低", "高"));
        assertRejected(fixture, "dimensionCopy 的键必须恰好是");
    }

    @Test
    @DisplayName("某维缺 balanced.nextStep（insufficient.nextStep）或 pole.action → 校验必须失败")
    void rejectsIncompleteDimensionFields() {
        Map<String, Object> balanced = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> balancedCopy = (Map<String, Object>)
                dimensionOf(balanced, "EI").get("balanced");
        balancedCopy.put("observation", "  ");
        assertRejected(balanced, "字段级校验失败");

        Map<String, Object> insufficient = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> insufficientCopy = (Map<String, Object>)
                dimensionOf(insufficient, "SN").get("insufficient");
        insufficientCopy.remove("nextStep");
        assertRejected(insufficient, "字段级校验失败");

        Map<String, Object> pole = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> poleCopy = (Map<String, Object>)
                dimensionOf(pole, "JP").get("positive");
        poleCopy.remove("action");
        assertRejected(pole, "字段级校验失败");
    }

    @Test
    @DisplayName("某维 name 留空 → 校验必须失败")
    void rejectsBlankDimensionName() {
        Map<String, Object> fixture = validFixture();
        dimensionOf(fixture, "TF").put("name", " ");
        assertRejected(fixture, "字段级校验失败");
    }

    // ------------------------------------------------------------------ reportCopy

    @Test
    @DisplayName("reportCopy 少一个字段 → 校验必须失败（每个字段都对应一处界面文案）")
    void rejectsMissingReportCopyField() {
        for (String field : new String[]{
                "typedTitle", "typedSubtitle", "partialTitle", "partialSubtitle",
                "undeterminedTitle", "undeterminedSubtitle", "insufficientTitle", "insufficientSubtitle",
                "typeReadingLead", "scoreMethodNote", "dimensionReviewLead", "selfReflectionLead"}) {
            Map<String, Object> fixture = validFixture();
            reportCopyOf(fixture).remove(field);
            assertRejected(fixture, "字段级校验失败");
        }
    }

    @Test
    @DisplayName("reportCopy 字段留空 → 校验必须失败")
    void rejectsBlankReportCopyField() {
        Map<String, Object> fixture = validFixture();
        reportCopyOf(fixture).put("scoreMethodNote", "   ");
        assertRejected(fixture, "字段级校验失败");
    }

    @Test
    @DisplayName("reportCopy 的 12 个字段必须在 record 上全部存在（防止少写字段）")
    void reportCopyExposesAllTwelveFields() {
        Map<String, Object> copy = reportCopy();
        assertEquals(12, copy.size(), "字段规格 §6 列出 12 个字段");
        assertEquals(12, com.typeme.model.ReportCopy.class.getRecordComponents().length,
                "ReportCopy 必须声明规格 §6 的全部 12 个字段");
    }

    // ------------------------------------------------------------------ nextSteps

    @Test
    @DisplayName("nextSteps 少于 3 条 / 含空条目 → 校验必须失败")
    void rejectsTooFewNextSteps() {
        Map<String, Object> two = validFixture();
        two.put("nextSteps", new ArrayList<>(List.of("建议一", "建议二")));
        assertRejected(two, "nextSteps 至少 3 条");

        Map<String, Object> blank = validFixture();
        blank.put("nextSteps", new ArrayList<>(List.of("建议一", "建议二", " ")));
        assertRejected(blank, "nextSteps 存在空条目");
    }

    // ------------------------------------------------------------------ attribution

    @Test
    @DisplayName("attribution 与 method.yml 不逐字相等 → 校验必须失败，并指出字段")
    void rejectsMismatchedAttribution() {
        Map<String, Object> author = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> attribution = (Map<String, Object>) author.get("attribution");
        attribution.put("author", "Eric Jorgenson / Open-Source Psychometrics Project");
        assertRejected(author, "attribution 必须与 method.yml 的 attribution 逐字相等");
        assertRejected(author, "author");

        Map<String, Object> licenseUrl = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> url = (Map<String, Object>) licenseUrl.get("attribution");
        url.put("licenseUrl", "https://creativecommons.org/licenses/by-nc-sa/4.0");
        assertRejected(licenseUrl, "licenseUrl");
    }

    @Test
    @DisplayName("attribution 缺字段 / 留空 → 校验必须失败")
    void rejectsIncompleteAttribution() {
        Map<String, Object> missing = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> attribution = (Map<String, Object>) missing.get("attribution");
        attribution.remove("license");
        assertRejected(missing, "字段级校验失败");

        Map<String, Object> blank = validFixture();
        @SuppressWarnings("unchecked")
        Map<String, Object> blanked = (Map<String, Object>) blank.get("attribution");
        blanked.put("source", " ");
        assertRejected(blank, "字段级校验失败");
    }

    @Test
    @DisplayName("包内 attribution 必须与真实 method.yml 逐字相等（CC BY-NC-SA 署名义务）")
    void officialAttributionMatchesRealMethodFile() throws IOException {
        ClassPathResource resource = new ClassPathResource("content/method.yml");
        assertTrue(resource.exists(), "真实方法说明 content/method.yml 必须存在");
        MethodContent method;
        try (InputStream in = resource.getInputStream()) {
            method = YAML.readValue(in, MethodContent.class);
        }

        MethodContent.Attribution expected = ContentService.OFFICIAL_ATTRIBUTION;
        assertNotNull(expected);
        assertEquals(method.attribution(), expected,
                "ContentService.OFFICIAL_ATTRIBUTION 必须与 method.yml 的 attribution 逐字相等");

        // 逐字段再断言一次，读失败信息时不必去解 record 的 toString
        assertEquals(method.attribution().source(), expected.source());
        assertEquals(method.attribution().author(), expected.author());
        assertEquals(method.attribution().url(), expected.url());
        assertEquals(method.attribution().license(), expected.license());
        assertEquals(method.attribution().licenseUrl(), expected.licenseUrl());
    }

    // ------------------------------------------------------------------ 旁证：严格 mapper 仍生效

    @Test
    @DisplayName("内容包侧字段名拼错（helpRevision 写成 helpRev）→ 严格模式必须报错，而不是静默丢字段")
    void rejectsUnknownPropertiesOnPackage() {
        String yaml = """
                schemaVersion: 2
                packageId: "oejts32-zh1-report2"
                helpRev: "help-zh1-r1"
                """;
        org.springframework.core.io.ByteArrayResource resource =
                new org.springframework.core.io.ByteArrayResource(
                        yaml.getBytes(java.nio.charset.StandardCharsets.UTF_8)) {
                    @Override
                    public String getDescription() {
                        return "strict-package-fixture.yml";
                    }
                };
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.read(resource, AssessmentPackage.class),
                "内容包未知字段必须解析失败，严格模式被削弱了");
        assertTrue(error.getMessage().contains("内容解析失败"), error.getMessage());
    }

    @Test
    @DisplayName("内容包依赖 record 参数名反序列化：夹具的 reportCopy 12 个键都能落到 ReportCopy 组件上")
    void reportCopyRecordComponentsMatchYamlKeys() {
        Map<String, Object> copy = reportCopy();
        assertEquals(12, com.typeme.model.ReportCopy.class.getRecordComponents().length,
                "ReportCopy 必须声明字段规格 §6 的全部 12 个字段");
        for (var component : com.typeme.model.ReportCopy.class.getRecordComponents()) {
            assertTrue(copy.containsKey(component.getName()),
                    "ReportCopy 的组件 " + component.getName() + " 在夹具（=YAML 键）里没有对应项");
        }

        // 真解析一次：record 组件名与 YAML 键对不上时，严格 mapper 要么报未知字段、
        // 要么把字段留空，两者都会在这里暴露（这正是「不依赖运气」的检查）。
        var parsed = YAML.convertValue(copy, com.typeme.model.ReportCopy.class);
        assertEquals(copy.get("typedTitle"), parsed.typedTitle());
        assertEquals(copy.get("typedSubtitle"), parsed.typedSubtitle());
        assertEquals(copy.get("partialTitle"), parsed.partialTitle());
        assertEquals(copy.get("partialSubtitle"), parsed.partialSubtitle());
        assertEquals(copy.get("undeterminedTitle"), parsed.undeterminedTitle());
        assertEquals(copy.get("undeterminedSubtitle"), parsed.undeterminedSubtitle());
        assertEquals(copy.get("insufficientTitle"), parsed.insufficientTitle());
        assertEquals(copy.get("insufficientSubtitle"), parsed.insufficientSubtitle());
        assertEquals(copy.get("typeReadingLead"), parsed.typeReadingLead());
        assertEquals(copy.get("scoreMethodNote"), parsed.scoreMethodNote());
        assertEquals(copy.get("dimensionReviewLead"), parsed.dimensionReviewLead());
        assertEquals(copy.get("selfReflectionLead"), parsed.selfReflectionLead());
    }
}
