package com.typeme.jung.scoring;

import com.typeme.jung.content.JungPackage;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungCandidate;
import com.typeme.jung.domain.JungCoverage;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionScore;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungPole;
import com.typeme.jung.domain.JungResultStatus;
import com.typeme.jung.domain.JungScoringPolicy;
import com.typeme.jung.domain.JungScoringResult;
import com.typeme.jung.domain.JungTypeCode;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 新测权威计分（计分口径由内容包声明的 {@link JungScoringPolicy} 分派，见该类的版本表）。
 *
 * <p>纯函数：不读文件、不读数据库、不取当前时间、不做日志。所有输入来自
 * {@link JungPackage} 与答案 map，所有输出是值对象。这样同一份 fixtures 才能被
 * Java 与 TypeScript 两套实现交叉验证。
 *
 * <p>规则要点（详见 {@code docs/2026-09-16/implementation/_contracts/01-新测契约-v1.md}）：
 * <ul>
 *   <li>{@code c = direction × (rating − 3)}，{@code S = Σc}，{@code m = S / (2n)}。</li>
 *   <li>{@code unknown} 不计入 n；中立 3 计入 n；**未处理与 unknown 不是一回事**。</li>
 *   <li>方向只看整数 {@code S} 的符号，不看舍入后的 {@code m} 或图示位置。</li>
 *   <li>触发阈值 {@code T(n) = floor(numerator × n / denominator)}，边界标记 {@code B(n)}
 *       由 {@link JungScoringPolicy} 按该维的 {@code scoringVersion} 决定
 *       （历史版本 {@code B = T − 1}；{@code score-v3/v4} 为 {@code B = T}）。
 *       **不要在这里写死常数**：同一个数字在 v3 与 v4 下含义不同。</li>
 *   <li>方向轻微不再隐藏整份结果：{@code TENTATIVE} 照样给四字母。</li>
 * </ul>
 */
public final class JungScorer {

    private JungScorer() {
    }

    /** 单题贡献：{@code direction × (rating − 3)}。 */
    public static int contributionOf(JungItem item, int rating) {
        return item.contribution(rating);
    }

    /**
     * 主测覆盖检查（不涉及澄清）。
     *
     * <p>{@code coverageOk} 要求：48 道主测题**全部被处理**（rating 或 unknown），
     * 且每维主测数字回答 {@code >= minBaseRatingsPerDimension}。
     * 未处理题不得被当成 unknown。
     */
    public static CoverageReport checkCoverage(JungPackage pkg, Map<String, JungAnswer> answers) {
        Map<JungDimension, int[]> counters = new EnumMap<>(JungDimension.class);
        for (JungDimension dimension : JungDimension.values()) {
            counters.put(dimension, new int[3]);
        }
        for (JungItem item : pkg.baseItems()) {
            JungAnswer answer = answers.get(item.id());
            int[] slot = counters.get(item.dimension());
            if (answer == null) {
                slot[2]++;
            } else if (answer.isRating()) {
                slot[0]++;
            } else {
                slot[1]++;
            }
        }

        List<JungCoverage> coverages = new ArrayList<>(4);
        boolean ok = true;
        for (JungDimension dimension : JungDimension.values()) {
            int[] slot = counters.get(dimension);
            Sum base = sumOf(pkg.baseItems(dimension), answers);
            boolean needs = slot[0] >= pkg.scoringPolicy().minBaseRatingsPerDimension()
                    && Math.abs(base.total()) <= pkg.scoringPolicy().triggerThreshold(base.count());
            JungCoverage coverage = new JungCoverage(dimension, slot[0], slot[1], slot[2], needs);
            coverages.add(coverage);
            if (!coverage.coverageOk(pkg.scoringPolicy().minBaseRatingsPerDimension())) {
                ok = false;
            }
        }
        return new CoverageReport(List.copyOf(coverages), ok);
    }

    /** 需要追加澄清题的维度（按 {@code EI,SN,TF,JP} 序）。覆盖不足时返回空列表。 */
    public static List<JungDimension> reviewClarification(JungPackage pkg, Map<String, JungAnswer> answers) {
        CoverageReport report = checkCoverage(pkg, answers);
        if (!report.coverageOk()) {
            // 覆盖不足时不安排澄清：先让用户补完主测，避免"补充题"掩盖主测缺答
            return List.of();
        }
        List<JungDimension> dimensions = new ArrayList<>(4);
        for (JungCoverage coverage : report.coverages()) {
            if (coverage.needsClarification()) {
                dimensions.add(coverage.dimension());
            }
        }
        return List.copyOf(dimensions);
    }

    /**
     * 权威计分。
     *
     * @param answers               questionId → 答案（未处理题不要放进 map）
     * @param clarificationSkipped  用户是否明确跳过澄清
     */
    public static JungScoringResult score(
            JungPackage pkg,
            Map<String, JungAnswer> answers,
            boolean clarificationSkipped) {

        CoverageReport coverageReport = checkCoverage(pkg, answers);
        Map<JungDimension, JungDimensionScore> scores = new EnumMap<>(JungDimension.class);
        List<JungDimension> scheduled = new ArrayList<>(4);

        for (JungDimension dimension : JungDimension.values()) {
            JungCoverage coverage = coverageReport.of(dimension);
            Sum base = sumOf(pkg.baseItems(dimension), answers);
            boolean scheduledThis = coverage.needsClarification();
            if (scheduledThis) {
                scheduled.add(dimension);
            }
            Sum clar = sumOf(pkg.clarificationItems(dimension), answers);
            boolean effective = scheduledThis && !clarificationSkipped && clar.count() > 0;
            Sum finals = effective ? combine(base, clar) : base;

            JungPole pole = finals.total() > 0
                    ? dimension.positivePole()
                    : finals.total() < 0 ? dimension.negativePole() : null;
            boolean boundary = pkg.scoringPolicy().isBoundary(finals.total(), finals.count());

            scores.put(dimension, new JungDimensionScore(
                    dimension,
                    base.total(),
                    base.count(),
                    base.normalized(),
                    clar.total(),
                    clar.count(),
                    clar.normalized(),
                    finals.total(),
                    finals.count(),
                    finals.normalized(),
                    finals.position(),
                    pole,
                    boundary,
                    scheduledThis,
                    scheduledThis && clarificationSkipped,
                    effective));
        }

        List<JungDimensionScore> ordered = new ArrayList<>(4);
        for (JungDimension dimension : JungDimension.values()) {
            ordered.add(scores.get(dimension));
        }

        if (!coverageReport.coverageOk()) {
            return new JungScoringResult(
                    JungResultStatus.NEEDS_REVIEW,
                    null,
                    coverageReport.coverages(),
                    List.copyOf(ordered),
                    List.of(),
                    List.of(),
                    List.copyOf(scheduled),
                    clarificationSkipped,
                    false,
                    null);
        }

        List<JungDimension> tied = new ArrayList<>(4);
        boolean anyBoundary = false;
        for (JungDimensionScore score : ordered) {
            if (score.tied()) {
                tied.add(score.dimension());
            }
            if (score.boundary()) {
                anyBoundary = true;
            }
        }

        JungResultStatus status;
        if (!tied.isEmpty()) {
            status = JungResultStatus.TIED;
        } else if (anyBoundary) {
            status = JungResultStatus.TENTATIVE;
        } else {
            status = JungResultStatus.REFERENCE;
        }

        JungTypeCode typeCode = null;
        if (status.hasTypeCode()) {
            typeCode = JungTypeCode.ofPoles(
                    ordered.get(0).computedPole(),
                    ordered.get(1).computedPole(),
                    ordered.get(2).computedPole(),
                    ordered.get(3).computedPole());
        }

        List<JungCandidate> candidates = buildCandidates(ordered, status);
        String tieNotice = null;
        if (!candidates.isEmpty()) {
            boolean ambiguous = tied.size() >= 2;
            if (!ambiguous) {
                int best = candidates.get(0).cost();
                ambiguous = candidates.stream().filter(candidate -> candidate.cost() == best).count() > 1;
            }
            if (ambiguous) {
                tieNotice = "这些候选在本次回答里没有规则上的区别，任何排序都不代表更可能；"
                        + "请结合四维说明与自己的经历核对。";
            }
        }

        return new JungScoringResult(
                status,
                typeCode,
                coverageReport.coverages(),
                List.copyOf(ordered),
                List.copyOf(tied),
                candidates,
                List.copyOf(scheduled),
                clarificationSkipped,
                true,
                tieNotice);
    }

    /* ── 内部 ───────────────────────────────────────────────────────────── */

    /** 某一维的候选极点集合。 */
    private static List<JungPole> choicesFor(JungDimensionScore score) {
        if (score.tied()) {
            return List.of(score.dimension().negativePole(), score.dimension().positivePole());
        }
        if (score.boundary()) {
            return List.of(score.computedPole(), score.computedPole().opposite());
        }
        return List.of(score.computedPole());
    }

    private static List<JungCandidate> buildCandidates(List<JungDimensionScore> ordered, JungResultStatus status) {
        if (status == JungResultStatus.REFERENCE || status == JungResultStatus.NEEDS_REVIEW) {
            // REFERENCE 只有一个候选（就是计算出的类型），列出它没有信息量
            return List.of();
        }
        List<List<JungPole>> choices = new ArrayList<>(4);
        int total = 1;
        for (JungDimensionScore score : ordered) {
            List<JungPole> poles = choicesFor(score);
            choices.add(poles);
            total *= poles.size();
        }
        if (total > 16) {
            throw new IllegalStateException("候选数量不可能超过 16，实际 " + total);
        }

        List<JungCandidate> candidates = new ArrayList<>(total);
        for (int index = 0; index < total; index++) {
            int remainder = index;
            JungPole[] poles = new JungPole[4];
            for (int dimensionIndex = 3; dimensionIndex >= 0; dimensionIndex--) {
                List<JungPole> polesOfDimension = choices.get(dimensionIndex);
                poles[dimensionIndex] = polesOfDimension.get(remainder % polesOfDimension.size());
                remainder /= polesOfDimension.size();
            }

            int cost = 0;
            List<JungDimension> differsOn = new ArrayList<>(4);
            for (int dimensionIndex = 0; dimensionIndex < 4; dimensionIndex++) {
                JungDimensionScore score = ordered.get(dimensionIndex);
                if (poles[dimensionIndex] != score.computedPole()) {
                    // 平分维的 |S| 是 0，所以这一项自然为 0：两极成本相同
                    cost += Math.abs(score.finalS());
                    differsOn.add(score.dimension());
                }
            }
            candidates.add(new JungCandidate(
                    JungTypeCode.ofPoles(poles[0], poles[1], poles[2], poles[3]),
                    cost,
                    List.copyOf(differsOn)));
        }

        // cost 升序；cost 相同时按维度序取"计算极优先，平分维取负极" → **稳定展示顺序**。
        // 这个顺序只是确定性，不是可能性排序。
        candidates.sort(Comparator
                .comparingInt(JungCandidate::cost)
                .thenComparing(candidate -> orderKey(candidate, ordered)));
        return List.copyOf(candidates);
    }

    /** 稳定次序键：每一位 0 = 该维首选极，1 = 另一极；拼成 4 位十进制数。 */
    private static int orderKey(JungCandidate candidate, List<JungDimensionScore> ordered) {
        int key = 0;
        for (int index = 0; index < 4; index++) {
            JungDimensionScore score = ordered.get(index);
            JungPole preferred = score.computedPole() != null
                    ? score.computedPole()
                    : score.dimension().negativePole();
            key = key * 10 + (candidate.typeCode().poleOf(score.dimension()) == preferred ? 0 : 1);
        }
        return key;
    }

    private static Sum sumOf(List<JungItem> items, Map<String, JungAnswer> answers) {
        int count = 0;
        int total = 0;
        for (JungItem item : items) {
            JungAnswer answer = answers.get(item.id());
            if (answer != null && answer.isRating()) {
                count++;
                total += item.contribution(answer.rating());
            }
        }
        return new Sum(total, count);
    }

    private static Sum combine(Sum base, Sum clar) {
        return new Sum(base.total() + clar.total(), base.count() + clar.count());
    }

    /** S 与 n，附带归一化偏移与图示位置。 */
    private record Sum(int total, int count) {

        Double normalized() {
            return count == 0 ? null : (double) total / (2.0 * count);
        }

        Double position() {
            Double m = normalized();
            return m == null ? null : (m + 1) / 2;
        }
    }

    /** 覆盖检查结果。 */
    public record CoverageReport(List<JungCoverage> coverages, boolean coverageOk) {

        public JungCoverage of(JungDimension dimension) {
            return coverages.get(dimension.ordinal());
        }

        /** 覆盖不足时给前端用于引导回看的维度列表。 */
        public List<JungDimension> insufficientDimensions(int minBaseRatings) {
            List<JungDimension> result = new ArrayList<>(4);
            for (JungCoverage coverage : coverages) {
                if (!coverage.coverageOk(minBaseRatings)) {
                    result.add(coverage.dimension());
                }
            }
            return List.copyOf(result);
        }

        /** 供调试与接口回显：每维计数。 */
        public Map<String, Object> asMap() {
            Map<String, Object> result = new LinkedHashMap<>();
            for (JungCoverage coverage : coverages) {
                Map<String, Object> row = new LinkedHashMap<>();
                row.put("baseRatingCount", coverage.baseRatingCount());
                row.put("baseUnknownCount", coverage.baseUnknownCount());
                row.put("baseUnprocessedCount", coverage.baseUnprocessedCount());
                row.put("needsClarification", coverage.needsClarification());
                result.put(coverage.dimension().name(), row);
            }
            return result;
        }
    }

    /** 便于调用方在不知道政策对象的情况下取阈值。 */
    public static int triggerThreshold(JungScoringPolicy policy, int n) {
        return policy.triggerThreshold(n);
    }
}
