package com.typeme.ipip.domain;

import java.util.Map;

/**
 * 大五计分政策（版本化）。
 *
 * <p>与 {@code JungScoringPolicy} 的关键差别：
 * <ul>
 *   <li>大五**不做澄清题**：一维证据不足就是证据不足，不用补充题去凑（`maxClarificationItems = 0`）。</li>
 *   <li>方向不看"符号"：每一维都给出一个连续分，再按离中点的距离分档。</li>
 *   <li>没有类型码：五维各自独立，不拼字母、不排序候选。</li>
 * </ul>
 *
 * @param version                     计分版本
 * @param minBaseRatingsPerDimension  每维最少数字回答数（首版 10 = 全部题目）
 * @param ratingMin                   量表下端（1 = 非常不符合）
 * @param ratingMax                   量表上端（5 = 非常符合）
 * @param ratingNeutral               中立档（3）：**是有效回答**，计入 n
 * @param midpoint                    量表中点（每题都选中立档时该维的分数）
 * @param constants                   维度 → 常量（由中点配平推出，见生成器）
 * @param markedDistance              离中点多少算"比较明显"（展示分档，不是心理测量阈值）
 * @param strongDistance              离中点多少算"很明显"（展示分档）
 */
public record BigFiveScoringPolicy(
        String version,
        int minBaseRatingsPerDimension,
        int ratingMin,
        int ratingMax,
        int ratingNeutral,
        int midpoint,
        Map<BigFiveDimension, Integer> constants,
        int markedDistance,
        int strongDistance) {

    public int constantOf(BigFiveDimension dimension) {
        Integer value = constants.get(dimension);
        if (value == null) {
            throw new IllegalStateException("缺少维度常量：" + dimension);
        }
        return value;
    }

    /**
     * 某一维的理论量程（下界与上界）。
     *
     * <p>每维不同：反向题越多，常量越大、下界越高。界面上的位置指示必须用这个量程归一化，
     * 不能用"10–50"这种写死的区间 —— 那会让 ES 维（反向题 8 道）的指示位置系统性偏移。
     */
    public int[] rangeOf(BigFiveDimension dimension, int itemCount) {
        int constant = constantOf(dimension);
        return new int[] {constant - 2 * itemCount, constant + 2 * itemCount};
    }
}
