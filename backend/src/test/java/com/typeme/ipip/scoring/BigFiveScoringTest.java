package com.typeme.ipip.scoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.content.BigFivePackageLoader;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.jung.domain.JungAnswer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 大五内容包与计分的实现级验证。
 *
 * <p><b>这个测试能证明什么、不能证明什么</b>（写清楚是为了不把绿灯读成"量表可靠"）：
 * <ul>
 *   <li>能证明：内容包结构合法、Java 重算的指纹与文件声明一致、
 *       规范形 JSON 与生成器算出的 sha256 是同一份字节、计分公式按键表执行、
 *       未作答/「说不好」/中立档三种状态互不混淆；</li>
 *   <li><b>不能</b>证明：量表信度、效度、与常模的可比性、题面可读性。
 *       这些需要真人试读与试测，目前一条都没做（见内容状态 {@code draft_review_pending}）。</li>
 * </ul>
 */
class BigFiveScoringTest {

    private static BigFivePackage pkg;
    private static BigFivePackageLoader loader;

    @BeforeAll
    static void load() {
        loader = new BigFivePackageLoader(new DefaultResourceLoader());
        pkg = loader.current();
    }

    /* ── 内容包与指纹 ───────────────────────────────────────────────────── */

    @Test
    @DisplayName("默认大五包可加载，且 Java 重算指纹与文件声明一致")
    void packageLoadsWithMatchingFingerprint() {
        assertEquals(BigFivePackageLoader.CURRENT_PACKAGE_ID, pkg.packageId());
        assertEquals(50, pkg.questions().size());
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            assertEquals(10, pkg.items(dimension).size(), dimension + " 应有 10 题");
        }
        assertEquals(loader.declaredSha256Of(pkg.packageId()), loader.recomputedSha256Of(pkg.packageId()),
                "文件声明的 sha256 必须等于加载期重算值（不一致说明内容被手改过）");
    }

    @Test
    @DisplayName("把规范形 JSON 单独算一遍 sha256，等于包声明的指纹")
    void canonicalJsonHashesToDeclaredFingerprint() throws Exception {
        String canonical = loader.canonicalJson(pkg);
        String actual = HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
        assertEquals(pkg.sha256(), actual,
                "落库用的 content_json 与指纹必须出自同一份字节，否则库里会出现对不上账的行");
    }

    @Test
    @DisplayName("每个维度都必须有反向题（否则「一直选同一侧」直接变成极端分）")
    void everyDimensionHasReverseKeyedItems() {
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            long reverse = pkg.items(dimension).stream().filter(BigFiveItem::isReverse).count();
            assertTrue(reverse > 0 && reverse < pkg.items(dimension).size(),
                    dimension + " 的反向题数应严格介于 0 与 10 之间，实际 " + reverse);
        }
    }

    /* ── 计分按键表执行 ─────────────────────────────────────────────────── */

    @Test
    void attainableExtremesUseReverseKeyedAnswersNotTheOffset() {
        Map<String, JungAnswer> low = new LinkedHashMap<>();
        Map<String, JungAnswer> high = new LinkedHashMap<>();
        for (BigFiveItem item : pkg.questions()) {
            low.put(item.id(), JungAnswer.rating(item.id(), item.direction() > 0 ? 1 : 5));
            high.put(item.id(), JungAnswer.rating(item.id(), item.direction() > 0 ? 5 : 1));
        }
        for (var row : BigFiveScorer.score(pkg, low).dimensions()) {
            assertEquals(10, row.rawScore());
            assertEquals(10, row.rangeLow());
            assertEquals(50, row.rangeHigh());
        }
        for (var row : BigFiveScorer.score(pkg, high).dimensions()) {
            assertEquals(50, row.rawScore());
            assertEquals(row.rangeHigh(), row.rawScore());
        }
    }

    @Test
    @DisplayName("全部选「非常符合」时，分数等于按键表逐题相加的结果（不是凭直觉的方向）")
    void allHighAnswersMatchKeyTable() {
        Map<String, JungAnswer> answers = allAnswers(5);
        BigFiveResult result = BigFiveScorer.score(pkg, answers);

        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            BigFiveDimension dimension = row.dimension();
            int expected = pkg.scoringPolicy().constantOf(dimension);
            for (BigFiveItem item : pkg.items(dimension)) {
                expected += item.direction() * 5;
            }
            assertEquals(expected, row.rawScore(),
                    dimension + "：全选 5 时应等于常量 + Σ方向×5");
            assertEquals(10, row.validCount());
        }
        // E 与 O 的键表正反题数不等，因此"全选同一边"并不等于"五个维度全高"：
        // 这一条正是在钉"反向题真的在反向"。
        assertTrue(result.dimensions().stream()
                        .anyMatch(row -> Math.abs(row.distance()) < pkg.scoringPolicy().markedDistance()),
                "全选同一侧时应当至少有一个维度接近中间（反向题生效的证据）");
    }

    @Test
    @DisplayName("全部选 1 与全部选 5 的距离互为相反数")
    void mirroredAnswersProduceMirroredDistances() {
        BigFiveResult low = BigFiveScorer.score(pkg, allAnswers(1));
        BigFiveResult high = BigFiveScorer.score(pkg, allAnswers(5));
        Map<BigFiveDimension, BigFiveResult.DimensionResult> lowBy = low.byDimension();
        for (BigFiveResult.DimensionResult row : high.dimensions()) {
            BigFiveResult.DimensionResult mirror = lowBy.get(row.dimension());
            assertEquals(-row.distance(), mirror.distance(),
                    row.dimension() + "：两端应互为镜像（量程对称）");
        }
    }

    @Test
    @DisplayName("中立档（3）是有效回答：计入 n，且总分正好落在中点")
    void neutralRatingsAreValidAndLandOnMidpoint() {
        BigFiveResult result = BigFiveScorer.score(pkg, allAnswers(3));
        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            assertEquals(10, row.validCount(), row.dimension() + "：全选中立档应有 10 个有效回答");
            assertEquals(pkg.scoringPolicy().midpoint(), row.rawScore());
            assertEquals(0, row.distance());
            assertEquals(BigFiveResult.Level.NEAR_MIDDLE, row.level());
        }
        assertTrue(result.coverageOk());
        assertTrue(result.completed());
    }

    @Test
    @DisplayName("未作答与「说不好」都不计入 n、都不补中点；两者分开计数")
    void unansweredAndUnknownAreNotScored() {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        BigFiveItem first = pkg.items(BigFiveDimension.O).get(0);
        BigFiveItem second = pkg.items(BigFiveDimension.O).get(1);
        // 只答 O 维：8 题选 3，1 题「说不好」，1 题完全不答 → 有效 8 题，低于下限 10。
        // 其余四维刻意一题都不答 —— 顺带验证"完全没答的维度"与"答了一部分但不够"
        // 用的是同一条规则（都不给方向），而不是两种实现。
        for (BigFiveItem item : pkg.items(BigFiveDimension.O)) {
            answers.put(item.id(), JungAnswer.rating(item.id(), 3));
        }
        answers.remove(first.id());
        answers.put(second.id(), JungAnswer.unknown(second.id()));

        BigFiveResult result = BigFiveScorer.score(pkg, answers);
        BigFiveResult.DimensionResult row = result.byDimension().get(BigFiveDimension.O);

        assertEquals(8, row.validCount(), "中立档计入，未作答与「说不好」都不计入");
        assertEquals(1, row.unknownCount());
        assertEquals(1, row.unprocessedCount());
        assertFalse(row.hasResult(), "有效回答不足下限时不给方向");
        assertNull(row.rawScore());
        assertFalse(result.coverageOk());
        assertTrue(result.incompleteDimensions().contains(BigFiveDimension.O));
        assertFalse(result.completed(), "有题完全没处理过 → 答卷未完成");
        assertEquals(1, result.unknownCount(), "整份答卷只有一个「说不好」");
        assertEquals(41, result.unprocessedCount(), "整份答卷有 41 题完全没作答");
        assertEquals(0, result.resolvedCount(), "五个维度都没有结论");
    }

    @Test
    @DisplayName("一题都不答时五个维度全部无结论，且不会算成「都在中间」")
    void emptyAnswersProduceNoConclusions() {
        BigFiveResult result = BigFiveScorer.score(pkg, Map.of());
        assertEquals(0, result.resolvedCount());
        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            assertFalse(row.hasResult());
            assertNull(row.level());
            assertEquals(10, row.unprocessedCount());
        }
        assertFalse(result.coverageOk());
        assertFalse(result.completed());
    }

    @Test
    @DisplayName("「说不好」不改变分数：把它换成立中档会让分数变化（两种状态确实不同）")
    void unknownDoesNotActAsNeutral() {
        Map<String, JungAnswer> withUnknown = allAnswers(3);
        BigFiveItem item = pkg.items(BigFiveDimension.ES).get(0);
        withUnknown.put(item.id(), JungAnswer.unknown(item.id()));

        BigFiveResult result = BigFiveScorer.score(pkg, withUnknown);
        BigFiveResult.DimensionResult row = result.byDimension().get(BigFiveDimension.ES);

        // ES 有 10 题，去掉 1 题后只剩 9 题有效 → 低于下限，因此**没有**结论。
        // 如果实现把「说不好」当成 3，就会得到 10 题有效 + 满 30 分的"接近中间"结论 ——
        // 正是这条断言要拦住的错误。
        assertFalse(row.hasResult(), "「说不好」不能当成中立档凑够题数");
        assertEquals(9, row.validCount());
        assertEquals(1, row.unknownCount());
    }

    /* ── 分档 ───────────────────────────────────────────────────────────── */

    @Test
    @DisplayName("分档只按离中点的距离，且阈值取「严格小于」的保守一侧")
    void levelThresholdsAreConservative() {
        var policy = pkg.scoringPolicy();
        int marked = policy.markedDistance();
        int strong = policy.strongDistance();

        assertEquals(BigFiveResult.Level.NEAR_MIDDLE, BigFiveScorer.levelOf(policy, marked - 1));
        assertEquals(BigFiveResult.Level.ABOVE, BigFiveScorer.levelOf(policy, marked));
        assertEquals(BigFiveResult.Level.ABOVE, BigFiveScorer.levelOf(policy, strong - 1));
        assertEquals(BigFiveResult.Level.WELL_ABOVE, BigFiveScorer.levelOf(policy, strong));
        assertEquals(BigFiveResult.Level.BELOW, BigFiveScorer.levelOf(policy, -marked));
        assertEquals(BigFiveResult.Level.WELL_BELOW, BigFiveScorer.levelOf(policy, -strong));
    }

    /* ── 与生成器的一致性 ───────────────────────────────────────────────── */

    @Test
    @DisplayName("落库用的规范形 JSON 与磁盘上的内容包是同源内容（字段集合不漂移）")
    void canonicalJsonKeepsTheSameFieldSet() throws IOException {
        JsonNode canonical = new ObjectMapper().readTree(loader.canonicalJson(pkg));
        JsonNode stored;
        try (InputStream in = new DefaultResourceLoader()
                .getResource("classpath:content/bigfive50-zh-v1.json").getInputStream()) {
            stored = new ObjectMapper().readTree(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
        // 规范形刻意不含 answerAnchors / attribution（它们是展示与署名信息，
        // 不参与"题目与政策"的指纹）；其余字段必须一一对应。
        assertEquals(stored.path("packageId").asText(), canonical.path("packageId").asText());
        assertEquals(stored.path("contentStatus").asText(), canonical.path("contentStatus").asText());
        assertEquals(stored.path("questions").size(), canonical.path("questions").size());
        assertEquals(stored.path("dimensions").size(), canonical.path("dimensions").size());
        assertEquals(
                new java.util.TreeSet<>(iterable(stored.path("questions"), "id")),
                new java.util.TreeSet<>(iterable(canonical.path("questions"), "id")),
                "题号集合必须一致");
    }

    private static java.util.List<String> iterable(JsonNode array, String field) {
        java.util.List<String> values = new java.util.ArrayList<>();
        for (JsonNode node : array) {
            values.add(node.path(field).asText());
        }
        return values;
    }

    /* ── 辅助 ───────────────────────────────────────────────────────────── */

    private static Map<String, JungAnswer> allAnswers(int rating) {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        for (BigFiveItem item : pkg.questions()) {
            answers.put(item.id(), JungAnswer.rating(item.id(), rating));
        }
        return answers;
    }

    @Test
    @DisplayName("题目顺序连续 1..50 且题号唯一（答题页与进度显示都依赖它）")
    void questionOrderIsContinuous() {
        java.util.Set<Integer> orders = new java.util.TreeSet<>();
        java.util.Set<String> ids = new java.util.HashSet<>();
        for (BigFiveItem item : pkg.questions()) {
            assertTrue(ids.add(item.id()), "题号重复：" + item.id());
            orders.add(item.order());
        }
        assertEquals(50, orders.size());
        assertEquals(1, orders.iterator().next());
        assertNotNull(pkg.item("Q01"));
        assertNull(pkg.item("Q51"));
    }
}
