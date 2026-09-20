package com.typeme.jung.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.scoring.JungScorer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 报告文案基线与"新包没有顺带换文案"的证据（2026-09-18 阈值调整沿用 v1 报告文案）。
 *
 * <p>为什么需要它：默认包从 `typeme-jung48-zh-v1` 换到 `typeme-jung48-zh-v3` 时，
 * 报告文案版本也是**由包声明的**。如果新包声明了 `typeme-type-report-zh-v2`，
 * 报告构造器会改用 v2 的 `readableSummary` / `readableFirstSteps`，
 * 把"八段 + 3 条成长行动"换成"一句话摘要 + 1 个可观察动作" ——
 * 那是另一条在途的易读性改造，不该由"换计分口径"顺带推上线。
 *
 * <p>这里证明三件事：
 * <ol>
 *   <li><b>基线是什么</b>：改动前新草稿用的默认包（v1）声明的是 `typeme-type-report-zh-v1`；
 *       当前默认包（v3）声明的也是它 —— 解析路径按包声明走，因此报告文案与改动前逐字相同。</li>
 *   <li><b>解析结果确实是 v1 形态</b>：加载器解析出来的 TypeReport 没有 readable 字段、
 *       `nextActions` 是 3 条；同时用 v2 报告内容做反证（它有 readable 字段），
 *       避免"断言恒真"。</li>
 *   <li><b>报告字节没变</b>：同一批作答、同一状态（CASE-12，两版都 REFERENCE）下，
 *       v1 包与 v3 包生成的 report_json 除了 5 个版本/哈希字段外**完全相同**。</li>
 * </ol>
 *
 * <p>另外，本类顺带把无数据库的浏览器验收要用的合成报告写到
 * `target/score-v3-browser-fixtures/`（与 `ReadableReportFixturesTest` 同一套做法）。
 */
class JungReportCopyBaselineTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final LocalDateTime now = LocalDateTime.of(2026, 9, 18, 0, 0);

    /** 报告 JSON 里"跟着版本走"的字段：比对文案是否相同时要把它们排除。 */
    private static final List<String> VERSION_BEARING_FIELDS = List.of(
            "scoringVersion", "packageId", "reportContentVersion", "contentSha256", "policyVersion");

    private static JungPackageLoader loader;
    private static JsonNode fixture;

    @BeforeAll
    static void load() throws IOException {
        loader = new JungPackageLoader(new DefaultResourceLoader());
        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:fixtures/score-cases.json").getInputStream()) {
            fixture = MAPPER.readTree(in);
        }
    }

    /* ── 1. 基线 ─────────────────────────────────────────────────────────── */

    @Test
    @DisplayName("基线：改动前新草稿用的默认包（v1）声明的报告文案，就是当前默认包（v3）声明的那一版")
    void newDraftsKeepTheSameReportCopyAsBeforeTheChange() {
        JungPackage current = loader.current();
        JungPackage legacyDefault = loader.find("typeme-jung48-zh-v1");

        assertEquals("typeme-jung48-zh-v3", current.packageId(), "当前新草稿默认包");
        assertNotNull(legacyDefault, "改动前的默认包必须仍可加载（历史草稿/报告按它解释）");

        // 改动前（HEAD）：CURRENT_PACKAGE_ID = typeme-jung48-zh-v1，而 v1 包声明的是
        // reportContentVersion = typeme-type-report-zh-v1（内容文件本身未改动，可直接核对）。
        assertEquals("typeme-type-report-zh-v1", legacyDefault.reportContentVersion(),
                "改动前的默认包声明的报告文案版本");
        // 换包后声明的是同一版 → 运行期按包声明解析 → 新草稿报告文案与改动前逐字相同。
        assertEquals(legacyDefault.reportContentVersion(), current.reportContentVersion(),
                "默认包换代不得改变报告文案版本（改了就是顺带推另一条改造上线）");
        assertEquals("typeme-type-report-zh-v1", current.reportContentVersion());
    }

    /* ── 2. 解析结果 ─────────────────────────────────────────────────────── */

    @Test
    @DisplayName("解析结果：默认包解析到的是 v1 形态文案（八段 + 3 条行动），不是 v2 的易读形态")
    void resolvedTypeReportCopyIsTheNonReadableShape() {
        String version = loader.current().reportContentVersion();
        JungPackageLoader.TypeReportContent content = loader.findTypeReports(version);
        assertNotNull(content, "默认包声明的报告文案必须已加载");
        assertEquals(version, content.reportContentVersion(), "取回来的必须就是包声明的版本");

        for (String typeCode : List.of("ENFP", "ISTJ")) {
            JungPackageLoader.TypeReport report = content.of(typeCode);
            assertNotNull(report, typeCode + " 的文案必须存在");
            assertNull(report.readableSummary(),
                    typeCode + " 出现 readableSummary 说明解析到的是 v2 文案（用户会看到另一种报告结构）");
            assertTrue(report.readableFirstSteps().isEmpty(),
                    typeCode + " 出现 readableFirstSteps 说明解析到的是 v2 文案");
            assertEquals(3, report.nextActions().size(), typeCode + " 应是 v1 的 3 条成长行动");
            assertEquals(8, report.sections().size(), typeCode + " 应是八段解读");
        }

        // 反证：v2 报告内容确实带 readable 字段，所以上面的断言不是"恒真"。
        JungPackageLoader.TypeReportContent v2Copy = loader.findTypeReports("typeme-type-report-zh-v2");
        assertNotNull(v2Copy, "v2 报告文案必须仍可加载（v2 草稿与已生成报告要用）");
        assertNotNull(v2Copy.of("ENFP").readableSummary(),
                "v2 文案本该有 readableSummary；若它也没了，本测试的反证就失效了");
        assertFalse(v2Copy.of("ENFP").readableFirstSteps().isEmpty(), "v2 文案本该有 readableFirstSteps");
    }

    /* ── 3. 报告字节 ─────────────────────────────────────────────────────── */

    @Test
    @DisplayName("报告字节：同作答同状态下，v1 包与 v3 包的报告只差版本/哈希字段")
    void sameAnswersAndStatusProduceIdenticalReportBodies() throws Exception {
        // CASE-12：EI S=3、n=12，两套口径都不在边界内 → 两版都是 REFERENCE（无边界、无候选），
        // 所以两份报告应当只有版本字段不同。reportId / attemptId 用同一个值：
        // 它们不是版本字段，若两边不同，说明我在比较时把"标识"混进了"文案"。
        JsonNode legacyReport = buildReport(loader.find("typeme-jung48-zh-v1"), "CASE-12",
                "baseline-report", "synthetic-attempt");
        JsonNode currentReport = buildReport(loader.current(), "CASE-12",
                "baseline-report", "synthetic-attempt");

        assertEquals("REFERENCE", legacyReport.path("status").asText());
        assertEquals("REFERENCE", currentReport.path("status").asText());
        assertEquals(legacyReport.path("computedTypeCode").asText(), currentReport.path("computedTypeCode").asText());

        assertSameExceptVersionFields(legacyReport, currentReport);

        // 并且差异确实只在那些字段上：改动后 reportContentVersion 仍是 v1。
        assertEquals("typeme-type-report-zh-v1",
                currentReport.path("methodology").path("reportContentVersion").asText());
        assertEquals("typeme-jung48-score-v3",
                currentReport.path("methodology").path("scoringVersion").asText());
        assertEquals("typeme-jung48-score-v1",
                legacyReport.path("methodology").path("scoringVersion").asText());
        assertEquals("typeme-type-report-zh-v1",
                legacyReport.path("methodology").path("reportContentVersion").asText());
    }

    /* ── 浏览器验收用的合成报告 ──────────────────────────────────────────── */

    @Test
    @DisplayName("生成浏览器验收夹具：v3 新边界 / 旧版同答卷 / TIED（无数据库，无真实 AI）")
    void writeBrowserFixtures() throws Exception {
        // v3 新边界：CASE-09（EI n=12、S=2 跳过补充题）→ TENTATIVE + 2 个候选。
        JsonNode v3Boundary = buildReport(loader.current(), "CASE-09", "v3-boundary", "synthetic-attempt");
        assertEquals("TENTATIVE", v3Boundary.path("status").asText());
        assertEquals(2, v3Boundary.path("candidates").size());
        save("v3-boundary", v3Boundary);

        // 旧版同答卷：同一批作答走 v1 包（历史快照口径）→ REFERENCE、不给候选。
        JsonNode legacySame = buildReport(loader.find("typeme-jung48-zh-v1"), "CASE-09",
                "v1-same-answers", "synthetic-attempt");
        assertEquals("REFERENCE", legacySame.path("status").asText());
        assertEquals(0, legacySame.path("candidates").size());
        save("v1-same-answers", legacySame);

        // TIED：CASE-10（EI 平分）→ 不给四字母。
        JsonNode tied = buildReport(loader.current(), "CASE-10", "v3-tied", "synthetic-attempt");
        assertEquals("TIED", tied.path("status").asText());
        assertTrue(tied.path("computedTypeCode").isNull(), "TIED 不该有四字母");
        save("v3-tied", tied);
    }

    /* ── 工具 ────────────────────────────────────────────────────────────── */

    private JsonNode buildReport(JungPackage pkg, String caseId, String reportId, String attemptId)
            throws Exception {
        JsonNode testCase = caseOf(caseId);
        boolean skipped = testCase.path("clarification").path("skipped").asBoolean();
        var result = JungScorer.score(pkg, answersOf(testCase), skipped);
        var content = loader.findTypeReports(pkg.reportContentVersion());
        var body = JungReportBuilder.build(pkg, content, loader.processCopy(), loader, result,
                reportId, attemptId, now, now);
        return MAPPER.readTree(JungReportBuilder.finalizeWithHash(MAPPER, body));
    }

    /**
     * 断言两份报告在排除"跟着版本走的字段"后逐字段相同。
     *
     * <p>失败信息只列出**不同的那几项**：整份报告 diff 有几千行，全打出来等于没有信息。
     */
    private static void assertSameExceptVersionFields(JsonNode left, JsonNode right) {
        List<String> leftFields = normalize(left);
        List<String> rightFields = normalize(right);
        List<String> differences = new ArrayList<>();
        int limit = Math.min(leftFields.size(), rightFields.size());
        for (int index = 0; index < limit; index++) {
            if (!leftFields.get(index).equals(rightFields.get(index))) {
                differences.add("字段 " + fieldName(leftFields.get(index)) + "：\n"
                        + "  v1 包 = " + abbreviate(leftFields.get(index)) + "\n"
                        + "  v3 包 = " + abbreviate(rightFields.get(index)));
            }
        }
        assertEquals(leftFields.size(), rightFields.size(), "报告的字段数量不同（结构变了）");
        assertTrue(differences.isEmpty(),
                "除 " + VERSION_BEARING_FIELDS + " 与 reportHash 外，报告正文必须逐字段相同，实测差异 "
                        + differences.size() + " 处：\n" + String.join("\n", differences));
    }

    private static String fieldName(String flattened) {
        int equals = flattened.indexOf('=');
        return equals < 0 ? flattened : flattened.substring(0, equals);
    }

    private static String abbreviate(String value) {
        return value.length() <= 160 ? value : value.substring(0, 160) + "…(" + value.length() + " 字符)";
    }

    private void save(String name, JsonNode report) throws Exception {
        Path directory = Path.of("target", "score-v3-browser-fixtures");
        Files.createDirectories(directory);
        MAPPER.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(name + ".json").toFile(), report);
    }

    /** 报告正文（排除版本/哈希字段）的逐字段字符串序列，用于"除了版本完全一致"的断言。 */
    private static List<String> normalize(JsonNode report) {
        ObjectNode copy = report.deepCopy();
        copy.remove("reportHash");
        JsonNode methodology = copy.path("methodology");
        assertTrue(methodology.isObject(), "报告必须有 methodology");
        for (String field : VERSION_BEARING_FIELDS) {
            ((ObjectNode) methodology).remove(field);
        }
        List<String> flattened = new ArrayList<>();
        flatten("", copy, flattened);
        return flattened;
    }

    private static void flatten(String prefix, JsonNode node, List<String> out) {
        if (node.isObject()) {
            Iterator<String> names = node.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                flatten(prefix.isEmpty() ? name : prefix + "." + name, node.get(name), out);
            }
            return;
        }
        if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                flatten(prefix + "[" + index + "]", node.get(index), out);
            }
            return;
        }
        out.add(prefix + "=" + node);
    }

    private static JsonNode caseOf(String caseId) {
        for (JsonNode testCase : fixture.path("cases")) {
            if (caseId.equals(testCase.path("id").asText())) {
                return testCase;
            }
        }
        throw new IllegalStateException("共享夹具缺少用例 " + caseId);
    }

    private static Map<String, JungAnswer> answersOf(JsonNode testCase) {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        JsonNode nodes = testCase.path("answers");
        Iterator<String> fields = nodes.fieldNames();
        while (fields.hasNext()) {
            String questionId = fields.next();
            JsonNode answer = nodes.get(questionId);
            answers.put(questionId, "rating".equals(answer.path("kind").asText())
                    ? JungAnswer.rating(questionId, answer.path("rating").asInt())
                    : JungAnswer.unknown(questionId));
        }
        return answers;
    }
}
