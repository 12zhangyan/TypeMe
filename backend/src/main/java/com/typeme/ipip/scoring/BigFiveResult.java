package com.typeme.ipip.scoring;

import com.typeme.ipip.domain.BigFiveDimension;

import java.util.List;
import java.util.Map;

/**
 * 大五计分结果（纯数据）。
 *
 * <p>与十六型的结果有**结构性的不同**，这也是"大五不能被强行转成四维或四字母"的落点：
 * <ul>
 *   <li>没有 typeCode，没有候选列表，没有 cost；</li>
 *   <li>五个维度各自一个连续分 + 一个分档，不是一个整体标签；</li>
 *   <li>没有澄清题，所以"排定的补充题"恒为空。</li>
 * </ul>
 *
 * @param scoringVersion 计分版本（写进报告，用于将来解释"这份结论是按哪版算法算的"）
 * @param dimensions     五个维度，顺序固定为 E, A, C, ES, O
 * @param completed      是否全部 50 题都处理过（含"说不好"）
 * @param coverageOk     每维有效数字回答是否达到政策下限
 * @param incompleteDimensions 未达到下限的维度（顺序同上）
 * @param unknownCount   整份答卷里"说不好"的题数
 * @param unprocessedCount 整份答卷里没有作答的题数
 */
public record BigFiveResult(
        String scoringVersion,
        List<DimensionResult> dimensions,
        boolean completed,
        boolean coverageOk,
        List<BigFiveDimension> incompleteDimensions,
        int unknownCount,
        int unprocessedCount) {

    /**
     * 单维结果。
     *
     * @param dimension       维度
     * @param rawScore        原始分（{@code constant + Σ direction×rating}）；不足下限时为 null
     * @param validCount      有效数字回答数（中立档计入）
     * @param unknownCount    该维"说不好"的题数
     * @param unprocessedCount 该维未作答的题数
     * @param rangeLow        该维理论下界（由常量与题数推出，不是写死的 10）
     * @param rangeHigh       该维理论上界
     * @param distance        离中点的距离；不足下限时为 null
     * @param level           分档；不足下限时为 {@code null}
     */
    public record DimensionResult(
            BigFiveDimension dimension,
            Integer rawScore,
            int validCount,
            int unknownCount,
            int unprocessedCount,
            int rangeLow,
            int rangeHigh,
            Integer distance,
            Level level) {

        /** 该维是否有结论。 */
        public boolean hasResult() {
            return level != null;
        }
    }

    /**
     * 分档。
     *
     * <p>**这不是心理测量学意义上的分界线**：它只是"离中点有多远"的展示分档，
     * 阈值来自本产品的保守展示策略（内容包 {@code markedDistance} / {@code strongDistance}），
     * 不是常模、不是百分位、也不是置信区间。界面文案必须与之一致：
     * 说"比较明显"，不说"高于 80% 的人"。
     */
    public enum Level {
        WELL_BELOW("明显偏低"),
        BELOW("比较偏低"),
        NEAR_MIDDLE("接近中间"),
        ABOVE("比较偏高"),
        WELL_ABOVE("明显偏高");

        private final String label;

        Level(String label) {
            this.label = label;
        }

        public String label() {
            return label;
        }

        /** 是否只是"接近中间"（报告要显式说明这一维不必急着下结论）。 */
        public boolean isNearMiddle() {
            return this == NEAR_MIDDLE;
        }
    }

    /** 维度 → 结果，便于调用方按维度取值。 */
    public Map<BigFiveDimension, DimensionResult> byDimension() {
        Map<BigFiveDimension, DimensionResult> result = new java.util.EnumMap<>(BigFiveDimension.class);
        for (DimensionResult dimension : dimensions) {
            result.put(dimension.dimension(), dimension);
        }
        return result;
    }

    /** 有结论的维度数。 */
    public long resolvedCount() {
        return dimensions.stream().filter(DimensionResult::hasResult).count();
    }
}
