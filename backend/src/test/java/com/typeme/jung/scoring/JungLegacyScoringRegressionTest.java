package com.typeme.jung.scoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungCandidate;
import com.typeme.jung.domain.JungDimension;
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
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * v1 / v2 的**独立固定期望**计分回归（2026-09-18 阈值调整后新增）。
 *
 * <p>为什么单独一个类：共享夹具 `score-cases.json` 现在由 v3 包生成，它的 `expect`
 * 只描述 v3；而 `JungScoringPolicyTest` 只验证"阈值函数逐点对不对"，不验证整条计分链
 * （澄清安排 → 合并题集 → 状态优先级 → 候选）。所以"旧版还对不对"这两处都答不了，
 * 需要一份**对着冻结规则手算、写死字面量**的回归。
 *
 * <p>输入（题目作答）复用共享夹具的同一批用例，这是安全的：每维的 `S` 与 `n`
 * 只由作答决定，**与边界规则无关**，同一批输入对两套口径都成立。
 * 期望值则完全不读夹具的 `expect`，按冻结规则手算后写进断言与注释：
 * `T(n) = floor(2n/10)`（触发，v1/v2/v3 相同）、`B(n) = max(0, T(n) − 1)`（v1/v2 冻结），
 * 状态优先级 `NEEDS_REVIEW → TIED → TENTATIVE → REFERENCE`，候选来自边界维与平分维。
 *
 * <p>**改这些字面量前先回答：是契约变了，还是实现错了？** 不允许把断言改成
 * "实现现在的输出"来变绿。
 */
class JungLegacyScoringRegressionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static JungPackage v1;
    private static JungPackage v2;
    private static JungPackage v3;
    private static JsonNode fixture;

    @BeforeAll
    static void loadContentAndFixture() throws IOException {
        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        v1 = loader.find("typeme-jung48-zh-v1");
        v2 = loader.find("typeme-jung48-zh-v2");
        v3 = loader.find("typeme-jung48-zh-v3");
        assertNotNull(v1, "v1 内容包必须仍然可加载：历史草稿与历史报告要按它解释");
        assertNotNull(v2, "v2 内容包必须仍然可加载");
        assertNotNull(v3, "v3 内容包必须可加载");
        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:fixtures/score-cases.json").getInputStream()) {
            fixture = MAPPER.readTree(in);
        }
    }

    /* ── 旧版边界 ────────────────────────────────────────────────────────── */

    @Test
    @DisplayName("旧版边界等号：|S| = B(n) 判 TENTATIVE（v1/v2 冻结行为）")
    void legacyBoundaryEqualityStaysTentative() {
        for (JungPackage pkg : List.of(v1, v2)) {
            // CASE-02：EI n=12、S=1 → T(12)=2 → B(12)=max(0,2−1)=1 → |1| ≤ 1 成立。
            // 其余维 SN=10/12、TF=12/12、JP=10/12 都不在边界内 → TENTATIVE。
            JungScoringResult result = score(pkg, "CASE-02");
            String label = pkg.packageId() + " CASE-02";

            assertEquals("TENTATIVE", result.status().name(), label + " 状态");
            assertTrue(result.coverageOk(), label + " 覆盖");
            assertEquals("ENFP", result.computedTypeCode().value(), label + " 四字母");
            assertTrue(result.dimension(JungDimension.EI).boundary(), label + " EI 应在边界内");
            // 候选 = 边界维 EI 的两端；cost 是"换一个字母要偏离多少证据"= |S_EI|。
            assertCandidates(result, List.of("ENFP", "INFP"), List.of(0, 1), label);
        }
    }

    @Test
    @DisplayName("旧版边界外一格：|S| = B(n)+1 判 REFERENCE（v3 会改判成 TENTATIVE 的那一格）")
    void legacyJustOutsideBoundaryStaysReference() {
        // CASE-09：EI n=12、S=2 → B(12)=1 → |2| > 1 → 不边界；其余维同样不边界、也没有平分维
        // → REFERENCE。跳过补充题不改变 S 与 n（n 仍是 12），所以判据只看这个合并题集。
        JungScoringResult legacy = score(v1, "CASE-09");
        assertEquals("REFERENCE", legacy.status().name(), "v1 下 CASE-09 必须仍是 REFERENCE");
        assertEquals("ENFP", legacy.computedTypeCode().value());
        assertEquals(2, legacy.dimension(JungDimension.EI).finalS());
        assertEquals(12, legacy.dimension(JungDimension.EI).finalN());
        assertFalse(legacy.dimension(JungDimension.EI).boundary(), "|2| ≤ B(12)=1 不成立");
        assertTrue(legacy.candidates().isEmpty(), "REFERENCE 不列候选");

        // 同一批作答在 v3 下是 TENTATIVE + 2 个候选：这是已批准的产品政策差异，
        // 不是回归 —— 写在这里是为了让"两版不一致"这件事本身有断言，而不是靠人记得。
        JungScoringResult unified = score(v3, "CASE-09");
        assertEquals("TENTATIVE", unified.status().name(), "v3 下 CASE-09 是 TENTATIVE");
        assertCandidates(unified, List.of("ENFP", "INFP"), List.of(0, 2), "v3 CASE-09");

        // CASE-12：EI n=12、S=3 → 两套口径都不在边界内 → 两版都必须是 REFERENCE。
        assertEquals("REFERENCE", score(v1, "CASE-12").status().name(), "v1 CASE-12");
        assertEquals("REFERENCE", score(v2, "CASE-12").status().name(), "v2 CASE-12");
        assertEquals("REFERENCE", score(v3, "CASE-12").status().name(), "v3 CASE-12");
    }

    @Test
    @DisplayName("旧版最低覆盖线 n=9：B(9)=0，非零倾向一律 REFERENCE（v3 会改判）")
    void legacyMinimumCoverageRequiresExactTieToBeBoundary() {
        // CASE-13：EI n=9、S=1 → T(9)=floor(18/10)=1 → B(9)=max(0,1−1)=0 → |1| > 0 → 不边界。
        // 这正是"最低覆盖线上只有完全平分才算边界"的旧语义。
        for (JungPackage pkg : List.of(v1, v2)) {
            JungScoringResult result = score(pkg, "CASE-13");
            String label = pkg.packageId() + " CASE-13";
            assertEquals("REFERENCE", result.status().name(), label + " 状态");
            assertEquals("ENFP", result.computedTypeCode().value(), label + " 四字母");
            assertEquals(1, result.dimension(JungDimension.EI).finalS(), label + " S_EI");
            assertEquals(9, result.dimension(JungDimension.EI).finalN(), label + " n_EI");
            assertFalse(result.dimension(JungDimension.EI).boundary(), label + " |1| ≤ B(9)=0 不成立");
            assertTrue(result.candidates().isEmpty(), label + " 不列候选");
        }
        // v3 的对照：B(9)=1 → 同一格变 TENTATIVE。
        assertEquals("TENTATIVE", score(v3, "CASE-13").status().name(), "v3 CASE-13 是 TENTATIVE");
    }

    /* ── 旧版补充题 ──────────────────────────────────────────────────────── */

    @Test
    @DisplayName("旧版补充题：跳过不改 S/n，完成补充题后按合并题集判一次")
    void legacyClarificationSkippedAndApplied() {
        // 跳过（CASE-09）：EI 仍是 n=12、S=2 → 不边界 → REFERENCE；该维标记"安排了但没做"。
        JungScoringResult skipped = score(v1, "CASE-09");
        assertEquals("REFERENCE", skipped.status().name());
        assertTrue(skipped.dimension(JungDimension.EI).clarScheduled(), "EI 应该安排过补充题");
        assertFalse(skipped.dimension(JungDimension.EI).effective(), "跳过时补充题不生效");
        assertEquals(12, skipped.dimension(JungDimension.EI).finalN());

        // 完成（CASE-21）：EI 合并后 n=16、S=2 → T(16)=3 → B(16)=max(0,3−1)=2 → |2| ≤ 2 成立
        // → TENTATIVE + 2 个候选；cost 是 |S_EI| = 2。
        JungScoringResult applied = score(v1, "CASE-21");
        assertEquals("TENTATIVE", applied.status().name(), "v1 CASE-21 状态");
        assertTrue(applied.dimension(JungDimension.EI).effective(), "补充题应生效");
        assertEquals(16, applied.dimension(JungDimension.EI).finalN());
        assertEquals(2, applied.dimension(JungDimension.EI).finalS());
        assertTrue(applied.dimension(JungDimension.EI).boundary());
        assertCandidates(applied, List.of("ENFP", "INFP"), List.of(0, 2), "v1 CASE-21");

        // 完成补充题但差距没缩小（CASE-14）：EI n=16、S=5 → 5 > B(16)=2 → REFERENCE。
        JungScoringResult decisive = score(v1, "CASE-14");
        assertEquals("REFERENCE", decisive.status().name(), "v1 CASE-14 状态");
        assertEquals(16, decisive.dimension(JungDimension.EI).finalN());
        assertEquals(5, decisive.dimension(JungDimension.EI).finalS());
        assertFalse(decisive.dimension(JungDimension.EI).boundary());
        assertTrue(decisive.candidates().isEmpty());
    }

    @Test
    @DisplayName("追问安排与版本无关：三版对同一作答安排同样的补充题（没有人多答题）")
    void clarificationSchedulingIsVersionIndependent() {
        for (String caseId : List.of("CASE-02", "CASE-09", "CASE-12", "CASE-13", "CASE-14", "CASE-19", "CASE-21")) {
            JsonNode testCase = caseOf(caseId);
            Map<String, JungAnswer> answers = answersOf(testCase);
            List<String> expected = scheduledDimensions(v1, answers);
            assertEquals(expected, scheduledDimensions(v2, answers), caseId + " v2 的追问安排与 v1 不同");
            assertEquals(expected, scheduledDimensions(v3, answers), caseId + " v3 的追问安排与 v1 不同");
        }
    }

    /* ── 旧版平分与覆盖不足 ──────────────────────────────────────────────── */

    @Test
    @DisplayName("旧版平分：TIED 不给四字母；候选并列、cost 只由 |S| 决定")
    void legacyTiedKeepsAmbiguity() {
        // CASE-10：EI S=0（平分）、JP S=1（n=12，两套口径都在边界内）→ TIED 优先于 TENTATIVE。
        // 候选 = EI 两端 × JP 两端 = 4；cost = 各候选与计算极不同的那几维 |S| 之和，
        // 平分维 |S|=0 所以换极不花成本 → [0,0,1,1]。
        for (JungPackage pkg : List.of(v1, v2)) {
            JungScoringResult result = score(pkg, "CASE-10");
            String label = pkg.packageId() + " CASE-10";
            assertEquals("TIED", result.status().name(), label + " 状态");
            assertNull(result.computedTypeCode(), label + " 平分时不许给四字母");
            assertEquals(List.of(JungDimension.EI), result.tiedDimensions(), label + " 平分维");
            assertTrue(result.dimension(JungDimension.EI).boundary(), label + " 平分维同时落在边界内");
            assertCandidates(result, List.of("INFP", "ENFP", "INFJ", "ENFJ"), List.of(0, 0, 1, 1), label);
            assertTrue(result.candidatesAreAmbiguous(), label + " 并列候选必须被标成不确定");
            assertNotNull(result.tieNotice(), label + " 并列时有提示");
        }
    }

    @Test
    @DisplayName("旧版覆盖不足：NEEDS_REVIEW 优先，且保留 n=0 维 boundary=true 的旧定义")
    void legacyNeedsReviewPrecedenceAndZeroRatedDimension() {
        // CASE-19：EI 12 题全部"说不好" → EI 的 rating 数 0 < 9 → NEEDS_REVIEW（优先于边界）。
        // 旧口径下 B(0)=0 且 |S|=0，所以 EI 会带 boundary=true —— 这是本次 v3 显式关掉的
        // "n=0 也算边界"定义漏洞，旧版必须原样保留（它不是缺陷修复，是版本差异）。
        for (JungPackage pkg : List.of(v1, v2)) {
            JungScoringResult result = score(pkg, "CASE-19");
            String label = pkg.packageId() + " CASE-19";
            assertEquals("NEEDS_REVIEW", result.status().name(), label + " 状态");
            assertFalse(result.coverageOk(), label + " 覆盖不足");
            assertNull(result.computedTypeCode(), label + " 不生成四字母");
            assertTrue(result.candidates().isEmpty(), label + " 不列候选");
            assertEquals(0, result.dimension(JungDimension.EI).finalN(), label + " EI 无有效数字回答");
            assertTrue(result.dimension(JungDimension.EI).boundary(),
                    label + " 旧口径下 n=0 仍带 boundary=true（v3 才要求 n>0）");
        }
        // v3 的对照：状态仍是 NEEDS_REVIEW，但那个维度不再带 boundary。
        JungScoringResult unified = score(v3, "CASE-19");
        assertEquals("NEEDS_REVIEW", unified.status().name(), "v3 CASE-19 仍是 NEEDS_REVIEW");
        assertFalse(unified.dimension(JungDimension.EI).boundary(), "v3 下 n=0 不算边界");
    }

    /* ── 旧版版本绑定 ────────────────────────────────────────────────────── */

    @Test
    @DisplayName("旧版版本绑定：包声明的计分版本/报告文案版本/策略参数互相一致且仍是旧口径")
    void legacyVersionBindingIsReadableAndConsistent() {
        assertEquals("typeme-jung48-score-v1", v1.scoringVersion());
        assertEquals("typeme-jung48-score-v1", v1.scoringPolicy().version());
        assertEquals("typeme-type-report-zh-v1", v1.reportContentVersion(),
                "v1 包怎么写的报告文案版本，就必须原样继续是它");

        assertEquals("typeme-jung48-score-v2", v2.scoringVersion());
        assertEquals("typeme-jung48-score-v2", v2.scoringPolicy().version());
        assertEquals("typeme-type-report-zh-v2", v2.reportContentVersion());

        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        for (JungPackage pkg : List.of(v1, v2)) {
            assertNotNull(loader.findTypeReports(pkg.reportContentVersion()),
                    pkg.packageId() + " 声明的报告文案必须能取到");
            // 覆盖下限与分子分母都没动过
            assertEquals(9, pkg.scoringPolicy().minBaseRatingsPerDimension(), pkg.packageId() + " 覆盖下限");
            assertEquals(2, pkg.scoringPolicy().boundaryNumerator(), pkg.packageId() + " 分子");
            assertEquals(10, pkg.scoringPolicy().boundaryDenominator(), pkg.packageId() + " 分母");
            // 逐点钉住旧口径：T(n) 与 v3 相同，B(n) = max(0, T(n) − 1)
            for (int n = 0; n <= 40; n++) {
                int trigger = Math.floorDiv(2 * n, 10);
                assertEquals(trigger, pkg.scoringPolicy().triggerThreshold(n), pkg.packageId() + " T(" + n + ")");
                assertEquals(Math.max(0, trigger - 1), pkg.scoringPolicy().boundaryThreshold(n),
                        pkg.packageId() + " B(" + n + ")");
            }
        }
        // v3 只改 B：T 逐点相同，B 在 T≥1 时比旧版大 1（n<5 时两者都是 0）
        for (int n = 0; n <= 40; n++) {
            assertEquals(v1.scoringPolicy().triggerThreshold(n), v3.scoringPolicy().triggerThreshold(n),
                    "T(" + n + ") 不该因为换版而变（否则答题量会变）");
            int trigger = Math.floorDiv(2 * n, 10);
            assertEquals(trigger, v3.scoringPolicy().boundaryThreshold(n), "v3 B(" + n + ")");
        }
    }

    /* ── 工具 ────────────────────────────────────────────────────────────── */

    private static JungScoringResult score(JungPackage pkg, String caseId) {
        JsonNode testCase = caseOf(caseId);
        return JungScorer.score(pkg, answersOf(testCase),
                testCase.path("clarification").path("skipped").asBoolean());
    }

    private static List<String> scheduledDimensions(JungPackage pkg, Map<String, JungAnswer> answers) {
        return JungScorer.reviewClarification(pkg, answers).stream().map(Enum::name).toList();
    }

    private static void assertCandidates(JungScoringResult result, List<String> codes,
                                         List<Integer> costs, String label) {
        assertEquals(codes, result.candidates().stream().map(candidate -> candidate.typeCode().value()).toList(),
                label + " 候选类型码序列");
        assertEquals(costs, result.candidates().stream().map(JungCandidate::cost).toList(),
                label + " 候选 cost 序列");
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
        List<String> missing = new ArrayList<>();
        while (fields.hasNext()) {
            String questionId = fields.next();
            JsonNode answer = nodes.get(questionId);
            if (answers.isEmpty()) {
                // 题号必须存在于包内，否则说明夹具与内容包错位（下面每道题都会走同一校验）
                assertTrue(answer.has("kind"), "夹具作答缺少 kind：" + questionId);
            }
            if (!v1.hasItem(questionId)) {
                missing.add(questionId);
            }
            answers.put(questionId, "rating".equals(answer.path("kind").asText())
                    ? JungAnswer.rating(questionId, answer.path("rating").asInt())
                    : JungAnswer.unknown(questionId));
        }
        assertTrue(missing.isEmpty(), "夹具里的题号在 v1 包里不存在，输入不可复用：" + missing);
        return answers;
    }
}
