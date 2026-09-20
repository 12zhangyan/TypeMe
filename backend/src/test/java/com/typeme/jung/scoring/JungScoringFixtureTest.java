package com.typeme.jung.scoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungCandidate;
import com.typeme.jung.domain.JungCoverage;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionScore;
import com.typeme.jung.domain.JungPole;
import com.typeme.jung.domain.JungScoringResult;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * 用共享夹具驱动 Java 权威计分（契约 §10、§8）。
 *
 * <p>夹具由 {@code scripts/gen-jung-fixtures.mjs} 生成，**同一份字节**同时供
 * Java 与 TypeScript 使用。这里的价值不在于"Java 抄了一遍生成器的算法"，
 * 而在于两套独立实现（Node 参考实现 vs Java 权威实现）对同一批输入必须得出同一结论：
 * 任何一侧的偏差点，都会在 CI 里变成一条具体用例的失败。
 *
 * <p>夹具里的期望值**不是权威**：它与 Java 不一致时，先判断是契约问题还是实现问题，
 * 再决定改哪一边 —— 不允许"改夹具迁就实现"。
 */
class JungScoringFixtureTest {

    private static JungPackage pkg;
    private static JsonNode fixture;

    @BeforeAll
    static void loadContentAndFixture() throws IOException {
        // 内容包由 scripts/convert-jung-content.mjs 生成，走 classpath:content/
        pkg = new JungPackageLoader(new DefaultResourceLoader()).current();
        assertNotNull(pkg, "内容包必须能加载");

        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:fixtures/score-cases.json").getInputStream()) {
            fixture = new ObjectMapper().readTree(in);
        }
        assertNotNull(fixture, "共享夹具必须存在");
    }

    @Test
    @DisplayName("夹具里的 scoringVersion / packageId 必须与已加载内容包一致")
    void fixtureMatchesLoadedPackage() {
        assertEquals(pkg.scoringVersion(), fixture.path("scoringVersion").asText(),
                "夹具的 scoringVersion 与内容包不一致：夹具是旧版生成的，结论不可信");
        assertEquals(pkg.packageId(), fixture.path("packageId").asText(),
                "夹具的 packageId 与内容包不一致，请重新运行 scripts/gen-jung-fixtures.mjs");
    }

    @Test
    @DisplayName("内容包声明的 sha256 必须与加载期重算值一致（跨 Java / Node 的规范化算法一致）")
    void declaredPackageHashMatchesRecomputed() {
        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        String declared = loader.declaredPackageSha256();
        String recomputed = loader.recomputedPackageSha256();

        assertTrue(declared != null && declared.length() == 64,
                "内容包必须声明 64 位十六进制 sha256，实际：" + declared);
        assertTrue(recomputed != null && recomputed.length() == 64,
                "加载期必须算出 64 位十六进制 sha256，实际：" + recomputed);
        assertEquals(declared, recomputed,
                "生成脚本（Node）算出的 sha256 与 Java 规范化算法算出的不一致："
                        + "两边的字段集合与顺序必须严格相同。"
                        + "定位方法：让 CanonicalFormTool 导出 Java 规范形，与 "
                        + "scripts/convert-jung-content.mjs 的 canonicalSource 逐字节 diff。"
                        + "注意内容包**不校验也不使用** license/attribution 字段，"
                        + "它们不属于计分内容。");
    }

    @Test
    @DisplayName("16 型报告内容声明的 sha256 必须与加载期重算值一致")
    void declaredTypeReportHashMatchesRecomputed() throws IOException {
        String declared;
        // 读的是**默认包声明的那一版**报告文案（v3 沿用的是 v1 的报告内容，不是 v2 的易读版），
        // 而不是那个历史默认常量：写死常量会在"默认包换文案版本"时继续对着旧文件通过。
        String reportVersion = pkg.reportContentVersion();
        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:content/" + reportVersion + ".json").getInputStream()) {
            declared = new ObjectMapper().readTree(in).path("sha256").asText();
        }
        assertNotNull(declared, "报告文案 " + reportVersion + " 必须能读到");
        assertTrue(declared.length() == 64,
                "类型报告必须声明 64 位十六进制 sha256，实际：" + declared);
        // 加载器在加载时已经比对过，这里再确认"确实做过比对"而不是静默跳过
        assertNotNull(new JungPackageLoader(new DefaultResourceLoader()).currentTypeReports());
    }

    @Test
    @DisplayName("共享夹具用例全部与 Java 权威计分一致")
    void allFixtureCases() {
        JsonNode cases = fixture.path("cases");
        assertTrue(cases.isArray() && cases.size() >= 18,
                "夹具用例数应 >= 18，实际 " + cases.size());

        List<String> failures = new ArrayList<>();
        for (JsonNode testCase : cases) {
            try {
                assertCase(testCase);
            } catch (AssertionError error) {
                failures.add(testCase.path("id").asText() + "：" + error.getMessage());
            }
        }
        if (!failures.isEmpty()) {
            fail("有 " + failures.size() + " 个夹具用例与 Java 计分不一致：\n - "
                    + String.join("\n - ", failures));
        }
    }

    /* ── 单个用例 ──────────────────────────────────────────────────────── */

    private void assertCase(JsonNode testCase) {
        String caseId = testCase.path("id").asText();
        boolean skipped = testCase.path("clarification").path("skipped").asBoolean();
        JsonNode expect = testCase.path("expect");

        Map<String, JungAnswer> answers = toAnswers(testCase.path("answers"));

        // 1. 澄清安排（提交前由服务端决定）
        List<String> scheduled = JungScorer.reviewClarification(pkg, answers).stream()
                .map(Enum::name).toList();
        assertEquals(textList(expect.path("reviewScheduled")), scheduled,
                caseId + " 的澄清安排列表不一致（服务端决定，客户端不能自己挑）");

        // 2. 权威计分
        JungScoringResult result = JungScorer.score(pkg, answers, skipped);

        assertEquals(expect.path("status").asText(), result.status().name(),
                caseId + " 的状态不一致");
        assertEquals(expect.path("coverageOk").asBoolean(), result.coverageOk(),
                caseId + " 的覆盖结论不一致");

        JsonNode expectedCode = expect.path("computedTypeCode");
        if (expectedCode.isNull()) {
            assertNull(result.computedTypeCode(), caseId + " 不应有四字母");
        } else {
            assertNotNull(result.computedTypeCode(), caseId + " 必须有四字母");
            assertEquals(expectedCode.asText(), result.computedTypeCode().value(),
                    caseId + " 的四字母不一致");
        }

        assertEquals(textList(expect.path("dimensionOrder")),
                result.dimensions().stream().map(score -> score.dimension().name()).toList(),
                caseId + " 的维度顺序必须是权威序 EI,SN,TF,JP");

        // 3. 每维的完整分项
        for (JungDimension dimension : JungDimension.values()) {
            assertDimension(caseId, dimension, expect.path("dimensions").path(dimension.name()),
                    result.dimension(dimension));
        }

        // 4. 每维覆盖计数
        for (JungDimension dimension : JungDimension.values()) {
            JsonNode expected = expect.path("coverage").path(dimension.name());
            JungCoverage coverage = result.coverage().get(dimension.ordinal());
            assertEquals(expected.path("rating").asInt(), coverage.baseRatingCount(),
                    caseId + " " + dimension + " baseRatingCount");
            assertEquals(expected.path("unknown").asInt(), coverage.baseUnknownCount(),
                    caseId + " " + dimension + " baseUnknownCount");
            assertEquals(expected.path("unprocessed").asInt(), coverage.baseUnprocessedCount(),
                    caseId + " " + dimension + " baseUnprocessedCount");
        }

        // 5. 平分维
        assertEquals(textList(expect.path("tiedDimensions")),
                result.tiedDimensions().stream().map(Enum::name).toList(),
                caseId + " 的平分维列表不一致");

        // 6. 候选：类型码、cost、偏离维三者一起对
        assertEquals(textList(expect.path("candidateCodes")),
                result.candidates().stream().map(candidate -> candidate.typeCode().value()).toList(),
                caseId + " 的候选类型码序列不一致（含稳定排序）");
        assertEquals(intList(expect.path("candidateCosts")),
                result.candidates().stream().map(JungCandidate::cost).toList(),
                caseId + " 的候选 cost 序列不一致");

        JsonNode expectedDiffers = expect.path("candidateDiffersOn");
        List<List<String>> actualDiffers = result.candidates().stream()
                .map(candidate -> candidate.differsOn().stream().map(Enum::name).toList())
                .toList();
        assertEquals(textListList(expectedDiffers), actualDiffers,
                caseId + " 的候选偏离维不一致（这份数据决定了报告里「为什么还给了另一个候选」的文案）");

        // 7. 平局提示的存在性与候选并列性必须同向
        assertEquals(result.candidatesAreAmbiguous(), result.tieNotice() != null,
                caseId + " 的 tieNotice 与候选并列性不一致：要么该提示却没提示，要么没并列却提示了");
    }

    private void assertDimension(String caseId, JungDimension dimension, JsonNode expected,
                                 JungDimensionScore actual) {
        String label = caseId + " " + dimension;
        assertEquals(expected.path("SBase").asInt(), actual.baseS(), label + " SBase");
        assertEquals(expected.path("nBase").asInt(), actual.baseN(), label + " nBase");
        assertDouble(expected.path("mBase"), actual.baseM(), label + " mBase");
        assertEquals(expected.path("SClar").asInt(), actual.clarS(), label + " SClar");
        assertEquals(expected.path("nClar").asInt(), actual.clarN(), label + " nClar");
        assertDouble(expected.path("mClar"), actual.clarM(), label + " mClar");
        assertEquals(expected.path("SFinal").asInt(), actual.finalS(), label + " SFinal");
        assertEquals(expected.path("nFinal").asInt(), actual.finalN(), label + " nFinal");
        assertDouble(expected.path("mFinal"), actual.finalM(), label + " mFinal");
        assertDouble(expected.path("position"), actual.position(), label + " position");

        JsonNode pole = expected.path("computedPole");
        if (pole.isNull()) {
            assertNull(actual.computedPole(), label + " 应为平分");
        } else {
            assertNotNull(actual.computedPole(), label + " 必须有方向");
            assertEquals(JungPole.of(pole.asText()), actual.computedPole(), label + " computedPole");
        }

        assertEquals(expected.path("boundary").asBoolean(), actual.boundary(), label + " boundary");
        assertEquals(expected.path("clarificationScheduled").asBoolean(), actual.clarScheduled(),
                label + " clarificationScheduled");
        assertEquals(expected.path("clarificationApplied").asBoolean(), actual.effective(),
                label + " clarificationApplied");
        assertEquals(expected.path("clarificationRatingCount").asInt(), actual.clarN(),
                label + " clarificationRatingCount");
    }

    /* ── fixture → 领域对象 ────────────────────────────────────────────── */

    private static Map<String, JungAnswer> toAnswers(JsonNode node) {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        Iterator<String> fields = node.fieldNames();
        while (fields.hasNext()) {
            String questionId = fields.next();
            JsonNode answer = node.get(questionId);
            if (!pkg.hasItem(questionId)) {
                throw new IllegalStateException("夹具里出现内容包没有的题号：" + questionId);
            }
            answers.put(questionId, "rating".equals(answer.path("kind").asText())
                    ? JungAnswer.rating(questionId, answer.path("rating").asInt())
                    : JungAnswer.unknown(questionId));
        }
        return answers;
    }

    private static void assertDouble(JsonNode expected, Double actual, String label) {
        if (expected.isNull() || expected.isMissingNode()) {
            assertNull(actual, label + " 应为 null（n=0 时没有归一化值，不能填 0 冒充）");
            return;
        }
        assertNotNull(actual, label + " 不应为 null");
        assertEquals(expected.asDouble(), actual, 1e-9, label);
    }

    private static List<String> textList(JsonNode node) {
        List<String> values = new ArrayList<>();
        node.forEach(entry -> values.add(entry.asText()));
        return values;
    }

    private static List<Integer> intList(JsonNode node) {
        List<Integer> values = new ArrayList<>();
        node.forEach(entry -> values.add(entry.asInt()));
        return values;
    }

    private static List<List<String>> textListList(JsonNode node) {
        List<List<String>> values = new ArrayList<>();
        node.forEach(inner -> values.add(textList(inner)));
        return values;
    }
}
