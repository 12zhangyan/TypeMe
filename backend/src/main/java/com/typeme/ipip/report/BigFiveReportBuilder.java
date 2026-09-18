package com.typeme.ipip.report;

import com.typeme.ipip.content.BigFiveDimensionCopy;
import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.scoring.BigFiveResult;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 大五固定报告构造器。
 *
 * <p>与 {@link com.typeme.jung.service.JungReportBuilder} 一样，这里是**结构化文本**，
 * 不调用 AI：报告必须在 AI 关闭、超时、失败的情况下依然完整可读。
 *
 * <h2>三个刻意的取舍</h2>
 * <ol>
 *   <li><b>先说结论与不确定，再说理论。</b>{@code summary} 只讲"这次回答看起来怎样"，
 *       五个维度的解释分开放进 {@code dimensions[].reading}，理论放在最下面；</li>
 *   <li><b>接近中间的维度必须显式说出来。</b>五个维度各自独立，"三条清楚、两条接近中间"
 *       比"你是一个 X 型的人"信息量大得多；把中间档悄悄按方向描述，等于把噪声当结论；</li>
 *   <li><b>不给百分位、不给常模、不给职业建议。</b>本产品没有本地常模，
 *       {@code distance} 只是"离中点有多远"，不是"高于多少人"。</li>
 * </ol>
 */
public final class BigFiveReportBuilder {

    /** 大五报告体的 schema 版本（外壳版本见 {@code com.typeme.platform.report.ReportEnvelope}）。 */
    // v2 修复量程元数据（原始分与中点规则不变）；旧持久化快照仍原样读取。
    public static final int BODY_SCHEMA_VERSION = 2;

    /** 报告状态：大五不给"类型"，所以不是 REFERENCE/TENTATIVE/TIED 里的任何一个。 */
    public static final String STATUS_PROFILE = "PROFILE";

    /**
     * 禁止措辞。与十六型共用同一份清单，另加大五特有的几个：
     * "人格障碍""抑郁""焦虑"这类词一旦出现，读者会把倾向描述读成临床判断。
     *
     * <p><b>为什么这里没有「高于」「低于」</b>：这两个词本身不可避免 ——
     * 「比中间高了 4 分」是最直接的说法，而报告必须能说清分数落在哪一侧。
     * 要拦的是**与外部参照比较**（常模、百分位、其他人的分数），那由
     * 「常模」「百分位」「全国」这些词拦住。把它们放进清单的后果是
     * **任何一份答完的报告都无法生成**（{@link #readingOf} 一定会用到），
     * 而这类"护栏把正常内容也拦下"的错误只会在端到端路径上暴露 ——
     * 实现级测试直接构造文本，根本走不到这里。
     */
    private static final Set<String> BANNED_WORDS = Set.of(
            "准确率", "概率", "百分位", "置信", "确诊", "命中注定", "科学证明",
            "人格障碍", "抑郁症", "焦虑症", "心理疾病", "低于全国", "常模");

    private BigFiveReportBuilder() {
    }

    /**
     * 构造报告体。
     *
     * @param pkg      这份草稿绑定的内容包
     * @param result   服务端计分结果（唯一权威）
     * @param reportId 报告 id
     * @param attemptId 测评 attempt id
     * @param submittedAtUtc 提交时间
     */
    public static Map<String, Object> build(
            BigFivePackage pkg,
            BigFiveResult result,
            String reportId,
            String attemptId,
            LocalDateTime submittedAtUtc) {

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("schemaVersion", BODY_SCHEMA_VERSION);
        report.put("reportId", reportId);
        report.put("attemptId", attemptId);
        report.put("createdAt", com.typeme.jung.service.TimeSource.isoFromUtc(submittedAtUtc));
        report.put("status", STATUS_PROFILE);
        report.put("profileTitle", pkg.title());
        report.put("hasTypeCode", false);
        report.put("summary", summarize(pkg, result));
        report.put("dimensions", dimensions(pkg, result));
        report.put("coverage", coverage(result));
        report.put("readingOrder", readingOrder(pkg));
        report.put("limitations", limitations(pkg));
        report.put("methodology", methodology(pkg, result, submittedAtUtc));
        return report;
    }

    /* ── 首屏摘要 ───────────────────────────────────────────────────────── */

    /**
     * 摘要：**只讲这一份答卷**。
     *
     * <p>三种情况分开说，因为它们的可信程度不同：
     * <ul>
     *   <li>五维都有结论：说出方向较明显的几维，并点明哪几维接近中间；</li>
     *   <li>部分维度证据不足：明确"哪几方面这次还看不出"；</li>
     *   <li>答卷不完整（有未作答的题）：先说清楚"还有题没答"，
     *       再说已经能看出的部分 —— 顺序不能反，否则用户会以为已经答完。</li>
     * </ul>
     */
    private static String summarize(BigFivePackage pkg, BigFiveResult result) {
        List<String> clear = new ArrayList<>();
        List<String> middle = new ArrayList<>();
        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            if (!row.hasResult()) {
                continue;
            }
            String name = pkg.copyOf(row.dimension()).name();
            if (row.level().isNearMiddle()) {
                middle.add(name);
            } else {
                clear.add(name + "偏" + (row.distance() > 0 ? "高" : "低"));
            }
        }

        StringBuilder text = new StringBuilder();
        if (!result.completed()) {
            text.append("这份答卷还有 ").append(result.unprocessedCount())
                    .append(" 题没有作答，下面的描述只依据你已经答过的题。");
        }
        if (clear.isEmpty() && middle.isEmpty()) {
            text.append("这次没有任何一个方面积累了足够的回答，所以得不出可读的描述。")
                    .append("把 50 题答完（或至少把每个方面答 10 题）之后再看。");
            String value = text.toString();
            assertNoBannedWords(value, "首屏摘要（无有效作答）");
            return value;
        }
        if (!clear.isEmpty()) {
            text.append("这次回答里，").append(String.join("、", clear))
                    .append("这几个方面的方向比较清楚。");
        }
        if (!middle.isEmpty()) {
            text.append(String.join("、", middle))
                    .append(middle.size() == 1 ? "这一方面" : "这几个方面")
                    .append("接近中间，两边都像，不必急着把它读成一种性格。");
        }
        if (!result.coverageOk()) {
            List<String> missing = new ArrayList<>();
            for (BigFiveDimension dimension : result.incompleteDimensions()) {
                missing.add(pkg.copyOf(dimension).name());
            }
            text.append("其中 ").append(String.join("、", missing))
                    .append(" 的回答还不够，本次不给方向。");
        }
        if (result.unknownCount() > 0) {
            text.append("你有 ").append(result.unknownCount())
                    .append(" 题选了「说不上符合或不符合」，这些题不参与计分。");
        }
        String value = text.toString();
        assertNoBannedWords(value, "首屏摘要");
        return value;
    }

    /* ── 五个维度 ───────────────────────────────────────────────────────── */

    private static List<Map<String, Object>> dimensions(BigFivePackage pkg, BigFiveResult result) {
        List<Map<String, Object>> rows = new ArrayList<>(BigFiveDimension.ordered().size());
        for (BigFiveResult.DimensionResult row : result.dimensions()) {
            BigFiveDimension dimension = row.dimension();
            BigFiveDimensionCopy copy = pkg.copyOf(dimension);

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("dimension", dimension.code());
            node.put("name", copy.name());
            node.put("question", copy.question());
            node.put("hasResult", row.hasResult());
            node.put("rawScore", row.rawScore());
            node.put("rangeLow", row.rangeLow());
            node.put("rangeHigh", row.rangeHigh());
            // 报告显式保存版本政策中的中点；反向题常量不是量程中点。
            node.put("midpoint", pkg.scoringPolicy().midpoint());
            node.put("distance", row.distance());
            node.put("level", row.level() == null ? null : row.level().name());
            node.put("levelLabel", row.level() == null ? null : row.level().label());
            // 方向只用来说明"偏高/偏低"，不产生"类型"：没有 letter、没有 code。
            node.put("direction", row.hasResult() && row.distance() != 0
                    ? (row.distance() > 0 ? "high" : "low")
                    : "middle");
            node.put("validCount", row.validCount());
            node.put("unknownCount", row.unknownCount());
            node.put("unprocessedCount", row.unprocessedCount());

            if (row.hasResult() && !row.level().isNearMiddle()) {
                BigFiveDimensionCopy.BigFivePoleCopy pole =
                        row.distance() > 0 ? copy.high() : copy.low();
                node.put("sideLabel", pole.label());
                node.put("description", pole.description());
                node.put("dailySigns", pole.dailySigns());
            } else if (row.hasResult()) {
                // 接近中间：两侧都给，并明说"都可以参考"。
                node.put("sideLabel", copy.low().label() + " / " + copy.high().label());
                node.put("description", copy.low().description() + " " + copy.high().description());
                node.put("dailySigns", mergeSigns(copy));
            } else {
                node.put("sideLabel", null);
                node.put("description", insufficientText(copy, row));
                node.put("dailySigns", List.of());
            }

            node.put("reading", readingOf(pkg, copy, row));
            node.put("observation", copy.observation());
            node.put("caution", copy.caution());
            rows.add(node);
        }
        return List.copyOf(rows);
    }

    /** 接近中间时两侧的日常表现各取两条：给太多会让人以为"这些都适用于我"。 */
    private static List<String> mergeSigns(BigFiveDimensionCopy copy) {
        List<String> signs = new ArrayList<>(4);
        copy.low().dailySigns().stream().limit(2).forEach(signs::add);
        copy.high().dailySigns().stream().limit(2).forEach(signs::add);
        return List.copyOf(signs);
    }

    private static String insufficientText(BigFiveDimensionCopy copy, BigFiveResult.DimensionResult row) {
        int missing = Math.max(0, row.unknownCount() + row.unprocessedCount());
        return "这一方面这次只有 " + row.validCount() + " 题算数（另有 " + missing
                + " 题没答或选了「说不上」），还不够形成描述。它问的是「" + copy.question() + "」。";
    }

    /**
     * 一句"怎么读这个分数"。
     *
     * <p>必须同时说出三件事：分数落在哪、离中点有多远、因此**能**得出什么、
     * **不能**得出什么。只说"你在这一维得 42 分"是没用的；只说"你偏外向"
     * 又会被读成标签。
     */
    private static String readingOf(
            BigFivePackage pkg, BigFiveDimensionCopy copy, BigFiveResult.DimensionResult row) {
        if (!row.hasResult()) {
            return "这次回答不足以说明" + copy.name() + "的方向。";
        }
        int distance = row.distance();
        String where = "本次 " + copy.name() + " 的分数是 " + row.rawScore()
                + "（本方面可能落在 " + row.rangeLow() + "–" + row.rangeHigh() + "，中间值 "
                + pkg.scoringPolicy().midpoint() + "）。";
        String how;
        int magnitude = Math.abs(distance);
        if (row.level().isNearMiddle()) {
            how = "离中间只差 " + magnitude + " 分，这次没有明显偏向某一侧。可能是不同场景下选择不同，也可能还不容易判断。";
        } else if (Math.abs(distance) < pkg.scoringPolicy().strongDistance()) {
            how = "比中间" + (distance > 0 ? "高" : "低") + "了 " + magnitude + " 分，按本站描述规则属于较明显倾向，但只是一次作答的结果。";
        } else {
            how = "比中间" + (distance > 0 ? "高" : "低") + "了 " + magnitude + " 分，这次回答偏向这一侧；不能据此推断你在人群中的位置。";
        }
        String text = where + how + "它描述的是倾向，不是能力，也不说明做得好不好。";
        assertNoBannedWords(text, "维度解读 " + row.dimension());
        return text;
    }

    /* ── 覆盖、读法与限制 ───────────────────────────────────────────────── */

    private static Map<String, Object> coverage(BigFiveResult result) {
        Map<String, Object> coverage = new LinkedHashMap<>();
        coverage.put("completed", result.completed());
        coverage.put("coverageOk", result.coverageOk());
        coverage.put("unknownCount", result.unknownCount());
        coverage.put("unprocessedCount", result.unprocessedCount());
        coverage.put("incompleteDimensions",
                result.incompleteDimensions().stream().map(BigFiveDimension::code).toList());
        return coverage;
    }

    /** 建议的阅读顺序：先看有结论的，再看接近中间的。这比按维度字母顺序更符合理解过程。 */
    private static List<Map<String, Object>> readingOrder(BigFivePackage pkg) {
        List<Map<String, Object>> order = new ArrayList<>(3);
        order.add(Map.of(
                "step", "先看方向比较明显的方面",
                "why", "这些是本次回答里比较一致的部分，读起来最像你。"));
        order.add(Map.of(
                "step", "再看接近中间的方面",
                "why", "两边都像不代表你没特点，只说明在这一方面你的做法随情境变化。"));
        order.add(Map.of(
                "step", "最后看每个方面的「可以留意的一件事」",
                "why", "那是可以自己验证的具体场景，比任何标签都可靠。"));
        return List.copyOf(order);
    }

    private static List<String> limitations(BigFivePackage pkg) {
        Map<String, String> attribution = pkg.attribution();
        List<String> notes = new ArrayList<>();
        notes.add("这份结果只来自这一次作答。心情、最近经历和作答时的状态都会影响它，"
                + "所以它是「此刻的描述」，不是关于你的固定结论。");
        notes.add("它描述倾向，不衡量能力，也不说明心理是否健康。任何一项都不足以判断"
                + "适合什么工作、适不适合某段关系。");
        // 这句话本身就在讲"我们不做什么"，所以最容易不小心把被禁的词写进来
        // （"不提供百分位"里就有"百分位"）。护栏按字面判断，这里就必须换个说法，
        // 而不是让护栏对这些句子开口子 —— 开口子之后真正的越界文案也会一起放行。
        notes.add("本产品没有本地参照群体，因此不给「你在人群中排第几」这类比较；"
                + "分数与中间值的距离只表示离中点有多远。");
        notes.add("题目来源：" + attribution.getOrDefault("source", "IPIP-50")
                + "（" + attribution.getOrDefault("license", "公有领域") + "）。"
                + "本测评不是该题目的官方版本，也不代表任何机构的结论。");
        notes.add("内容状态：内测待审校。题目与解释尚未经过真人试读与试测，"
                + "不应作为对外宣传中「已验证」的依据。");
        for (String note : notes) {
            assertNoBannedWords(note, "限制声明");
        }
        return List.copyOf(notes);
    }

    private static Map<String, Object> methodology(
            BigFivePackage pkg, BigFiveResult result, LocalDateTime submittedAtUtc) {
        Map<String, Object> methodology = new LinkedHashMap<>();
        methodology.put("scoringVersion", pkg.scoringVersion());
        methodology.put("packageId", pkg.packageId());
        methodology.put("contentStatus", pkg.contentStatus());
        methodology.put("contentSha256", pkg.sha256());
        methodology.put("policyVersion", pkg.scoringPolicy().version());
        methodology.put("minBaseRatingsPerDimension", pkg.scoringPolicy().minBaseRatingsPerDimension());
        methodology.put("midpoint", pkg.scoringPolicy().midpoint());
        methodology.put("markedDistance", pkg.scoringPolicy().markedDistance());
        methodology.put("strongDistance", pkg.scoringPolicy().strongDistance());
        methodology.put("resolvedDimensions", result.resolvedCount());
        methodology.put("submittedAt", com.typeme.jung.service.TimeSource.isoFromUtc(submittedAtUtc));
        return methodology;
    }

    /**
     * 禁止措辞护栏（启发式，不是内容安全保证）。与十六型报告同一性质：
     * 它只能拦住明显不该出现在自我了解报告里的说法。
     *
     * <p>报错信息里必须带上**是哪一段**出的问题：这段文案有好几个来源
     * （维度解读、覆盖说明、限制声明……），只说"出现了某个词"会在排查时
     * 逼着人把整份报告从头读一遍，而端到端路径上这个异常还只会呈现为 500。
     */
    static void assertNoBannedWords(String text) {
        assertNoBannedWords(text, "报告文案");
    }

    static void assertNoBannedWords(String text, String where) {
        if (text == null) {
            return;
        }
        for (String banned : BANNED_WORDS) {
            if (text.contains(banned)) {
                throw new IllegalStateException(
                        "大五报告文案出现禁止措辞「" + banned + "」（来源：" + where + "），已拒绝生成：" + text);
            }
        }
    }
}
