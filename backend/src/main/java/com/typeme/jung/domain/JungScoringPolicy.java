package com.typeme.jung.domain;

/**
 * 计分政策（版本化）。
 *
 * <p>{@code boundaryNumerator}/{@code boundaryDenominator} 定义触发阈值
 * {@code T(n) = floor(numerator * n / denominator)}；边界标记是 {@code B(n) = T(n) - 1}。
 * 用整数比较而不是浮点阈值（{@code |m| <= 0.20}），避免 {@code 0.2} 这类二进制小数
 * 在边界上产生"同一份答卷换台机器结论不同"的漂移。
 *
 * @param minBaseRatingsPerDimension 主测每维最少数字回答数（首版 9）
 * @param boundaryNumerator          触发阈值分子（首版 2）
 * @param boundaryDenominator        触发阈值分母（首版 10）
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

    /** 触发澄清的阈值 {@code T(n)}。 */
    public int triggerThreshold(int n) {
        if (n <= 0) {
            return 0;
        }
        return Math.floorDiv(boundaryNumerator * n, boundaryDenominator);
    }

    /** 判定"倾向较轻"的边界标记 {@code B(n)}。 */
    public int boundaryThreshold(int n) {
        return Math.max(0, triggerThreshold(n) - 1);
    }

    /** 是否需要在最终题集上标记该维为边界。 */
    public boolean isBoundary(int sFinal, int nFinal) {
        return Math.abs(sFinal) <= boundaryThreshold(nFinal);
    }
}
