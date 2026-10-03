package com.typeme.jung.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * 计分政策（版本化）。
 *
 * <p>{@code boundaryNumerator}/{@code boundaryDenominator} 定义归一化尺度
 * {@code T(n) = floor(numerator * n / denominator)}，含义是"平均倾向" {@code |m| = |S|/(2n)}
 * 的上界；整数比较而不是浮点阈值（{@code |m| <= 0.10} / {@code <= 0.20}），避免
 * {@code 0.1} 这类二进制小数在边界上产生"同一份答卷换台机器结论不同"的漂移。
 * 具体取哪个比值由**内容包声明**（不同 {@code scoringVersion} 可以不同），本类只负责按
 * 声明值算出整数阈值。
 *
 * <h2>两个量、两处用途</h2>
 * <ul>
 *   <li>{@link #triggerThreshold(int)}：要不要**追加补充题**（在主测题集上判），
 *       {@code JungScorer.checkCoverage}。</li>
 *   <li>{@link #boundaryThreshold(int)}：最终要不要说这一维**倾向较轻**
 *       （在合并后的题集上判一次），{@code JungScorer.score}。</li>
 * </ul>
 *
 * <h2>哪个版本用哪套边界口径（显式登记，未知版本直接拒绝）</h2>
 * <ul>
 *   <li>{@code typeme-jung48-score-v1} / {@code -v2}（历史）：边界 {@code B(n) = max(0, T(n) − 1)}，
 *       尺度为 {@code floor(2n/10)}。**行为冻结**：旧包、旧草稿、旧报告继续按这一套，
 *       改动它们等于改历史结论。</li>
 *   <li>{@code typeme-jung48-score-v3}（2026-09-18 批准的政策调整）：边界与触发**同一条尺度**
 *       {@code B(n) = T(n) = floor(2n/10)}，并且要求 {@code n > 0}。触发条件未变，
 *       所以没有任何人多答题；变化的只是"补答完/跳过之后，这一维还算不算轻"。</li>
 *   <li>{@code typeme-jung48-score-v4}（2026-09-21 批准的政策调整）：口径与 v3 相同
 *       （边界与触发同尺度、要求 {@code n > 0}），只把尺度从 {@code floor(2n/10)}
 *       放宽到 {@code floor(2n/5)}（约 {@code |m| <= 0.20}）。**这一版会扩大触发集合**：
 *       更多维会被安排补充题，且"倾向较轻"的区间整体变宽。</li>
 * </ul>
 *
 * <p><b>两个数都不是"更准"的改动。</b>归一化界限取 0.10 或 0.20 本身都没有本次可核验的
 * 信度/效度依据，选用哪一条属于产品取舍；v4 的带宽翻倍也不等于"澄清题数量翻倍"
 * （幅面取决于真实答卷的分布）。这两个版本只说明"实现符合当前记录的规则"。
 *
 * @param version                    计分版本；决定边界用哪套口径（见类注释）
 * @param minBaseRatingsPerDimension 主测每维最少数字回答数（首版 9）
 * @param boundaryNumerator          归一化尺度的分子（首版 2）
 * @param boundaryDenominator        归一化尺度的分母（首版 10）
 * @param ratingMin                  量表下端（1）
 * @param ratingMax                  量表上端（5）
 * @param ratingNeutral              中立档（3）：**是有效回答**，计入 n，贡献为 0
 */
public record JungScoringPolicy(
        String version,
        int minBaseRatingsPerDimension,
        int boundaryNumerator,
        int boundaryDenominator,
        int ratingMin,
        int ratingMax,
        int ratingNeutral) {

    /** 边界与触发同尺度（不再减一）的计分版本。 */
    private static final Set<String> UNIFIED_SCALE_VERSIONS =
            Set.of("typeme-jung48-score-v3", "typeme-jung48-score-v4");

    /** 边界 {@code = 触发 − 1} 的历史计分版本（行为冻结）。 */
    private static final Set<String> SEPARATE_BOUNDARY_VERSIONS =
            Set.of("typeme-jung48-score-v1", "typeme-jung48-score-v2");

    public JungScoringPolicy {
        /*
         * 未知版本必须在这里失败，而不是"落到默认那一套"。理由：
         * 内容包声明了 scoringVersion，若代码悄悄按某一套规则算，事后只能靠比对报告数字
         * 才知道用的是哪套 —— 那时结论已经发出去了。新增版本时在这里登记它的口径。
         *
         * `version == null` 单独判：`Set.of(...)` 的 `contains(null)` 会抛 NPE，
         * 那样报错就变成"某个空指针"，而不是"这个包没声明计分版本"。
         */
        if (version == null
                || (!UNIFIED_SCALE_VERSIONS.contains(version)
                        && !SEPARATE_BOUNDARY_VERSIONS.contains(version))) {
            throw new IllegalArgumentException("未知计分版本：" + version
                    + "（已知：" + String.join("、", knownVersions())
                    + "）。新增计分版本必须在 JungScoringPolicy 里显式登记它用哪套边界口径。");
        }
    }

    /** 已知计分版本（稳定排序，用于报错信息与自检）。 */
    public static List<String> knownVersions() {
        Set<String> all = new TreeSet<>(SEPARATE_BOUNDARY_VERSIONS);
        all.addAll(UNIFIED_SCALE_VERSIONS);
        return new ArrayList<>(all);
    }

    /** 本版本是否使用"边界 = 触发"的统一尺度。 */
    public boolean unifiedBoundaryScale() {
        return UNIFIED_SCALE_VERSIONS.contains(version);
    }

    /** 触发澄清的阈值 {@code T(n)}。 */
    public int triggerThreshold(int n) {
        if (n <= 0) {
            return 0;
        }
        return Math.floorDiv(boundaryNumerator * n, boundaryDenominator);
    }

    /** 判定"倾向较轻"的边界阈值 {@code B(n)}（口径取决于 {@link #version}）。 */
    public int boundaryThreshold(int n) {
        int trigger = triggerThreshold(n);
        if (unifiedBoundaryScale()) {
            // v3/v4：与触发同尺度。于是 n=9（覆盖下限）也存在非零的"较轻"区间，
            // 且"跳过补充题"的非平分结果不会因为跳过而变成"明确"。
            return Math.max(0, trigger);
        }
        return Math.max(0, trigger - 1);
    }

    /**
     * 是否需要在最终题集上把该维标记为"倾向较轻"。
     *
     * <p>统一尺度版本额外要求 {@code nFinal > 0}：没有任何有效数字回答时不存在"较轻的倾向"，
     * 那种情况本来就该走覆盖不足（{@code NEEDS_REVIEW}）。历史版本保持原样（行为冻结）。
     */
    public boolean isBoundary(int sFinal, int nFinal) {
        if (unifiedBoundaryScale() && nFinal <= 0) {
            return false;
        }
        return Math.abs(sFinal) <= boundaryThreshold(nFinal);
    }
}
