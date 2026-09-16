package com.typeme.jung.domain;

/**
 * 题目定义（不可变）。
 *
 * <p>字段刻意使用**显式极点**（{@code leftPole} / {@code rightPole}）而不是沿用旧引擎的
 * "数组顺序 / direction 约定"：旧约定要求每个调用方都记住"高侧是哪个字母"，
 * 一旦 TF、JP 的数值侧与新测相反，错误会静默产出反向类型码。
 *
 * <p>计分方向由 {@link #pointsToPositivePole()} 推出：右侧是正极则 +1，否则 −1。
 * 不允许在题目里再单独写一个 direction 字段 —— 两个真相来源迟早会不一致。
 */
public record JungItem(
        String id,
        JungStage stage,
        JungDimension dimension,
        String scenario,
        String textLeft,
        String textRight,
        JungPole leftPole,
        JungPole rightPole,
        String help,
        String facet,
        int order,
        JungContentStatus reviewStatus,
        String provenance) {

    /** 右侧是正极时返回 +1，否则 −1。 */
    public int pointsToPositivePole() {
        return rightPole == dimension.positivePole() ? 1 : -1;
    }

    /**
     * 单题贡献：{@code c = direction × (rating − 3)} ∈ {−2,−1,0,1,2}。
     *
     * @throws IllegalArgumentException rating 不在 1..5
     */
    public int contribution(int rating) {
        if (rating < 1 || rating > 5) {
            throw new IllegalArgumentException("分值必须在 1..5，收到：" + rating);
        }
        return pointsToPositivePole() * (rating - 3);
    }

    /** 左侧极点在本次选择里的位置（1 最靠左，5 最靠右）。 */
    public boolean isLeftPoleNegative() {
        return leftPole == dimension.negativePole();
    }
}
