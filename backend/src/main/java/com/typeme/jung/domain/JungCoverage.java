package com.typeme.jung.domain;

/**
 * 某一维在主测阶段的覆盖情况。
 *
 * @param baseRatingCount      主测数字回答数（决定 9/12 覆盖条件）
 * @param baseUnknownCount     主测明确"无法判断"的数量
 * @param baseUnprocessedCount 主测**未处理**的数量（与 unknown 严格分开）
 * @param needsClarification   {@code baseRatingCount >= 9 && |SBase| <= T(nBase)}
 */
public record JungCoverage(
        JungDimension dimension,
        int baseRatingCount,
        int baseUnknownCount,
        int baseUnprocessedCount,
        boolean needsClarification) {

    public int baseTotal() {
        return baseRatingCount + baseUnknownCount + baseUnprocessedCount;
    }

    public boolean coverageOk(int minBaseRatingsPerDimension) {
        return baseRatingCount >= minBaseRatingsPerDimension && baseUnprocessedCount == 0;
    }
}
