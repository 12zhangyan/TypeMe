package com.typeme.jung.domain;

/**
 * 某一维的最终计分（主测与澄清分项都保留，便于报告"结果依据"回看）。
 *
 * <p>方向只看整数 {@code S}：{@code S > 0} 取正极、{@code S < 0} 取负极、{@code S == 0} 平分。
 * 不允许先对 {@code m} 或图示位置 {@code p} 做四舍五入再判方向 ——
 * 那会让 {@code S=+1, n=12}（m=0.042）被画到中线右侧却报"平分"。
 *
 * @param clarScheduled 该维是否被安排了澄清题
 * @param clarSkipped   用户是否明确跳过澄清
 * @param effective     该维最终分是否**实际**把澄清题并了进去
 */
public record JungDimensionScore(
        JungDimension dimension,
        int baseS,
        int baseN,
        Double baseM,
        int clarS,
        int clarN,
        Double clarM,
        int finalS,
        int finalN,
        Double finalM,
        Double position,
        JungPole computedPole,
        boolean boundary,
        boolean clarScheduled,
        boolean clarSkipped,
        boolean effective) {

    public boolean tied() {
        return computedPole == null;
    }

    /** 该维计算出的字母；平分时为 null。 */
    public String computedLetter() {
        return computedPole == null ? null : String.valueOf(computedPole.letter());
    }
}
