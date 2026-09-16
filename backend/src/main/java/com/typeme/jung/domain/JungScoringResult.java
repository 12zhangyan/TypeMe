package com.typeme.jung.domain;

import java.util.List;

/**
 * 计分结果（不可变）。
 *
 * <p>{@code dimensions} 恒按 {@code EI, SN, TF, JP} 排列，长度恒为 4；
 * {@code NEEDS_REVIEW} 时 {@code computedTypeCode} 为 null 且 {@code candidates} 为空
 * （覆盖不足时讨论候选没有意义）。
 *
 * @param tiedDimensions   {@code finalS == 0} 的维度（按权威序）
 * @param tieNotice        候选之间没有规则差别时的说明；没有并列时为 null
 */
public record JungScoringResult(
        JungResultStatus status,
        JungTypeCode computedTypeCode,
        List<JungCoverage> coverage,
        List<JungDimensionScore> dimensions,
        List<JungDimension> tiedDimensions,
        List<JungCandidate> candidates,
        List<JungDimension> clarificationDimensions,
        boolean clarificationSkipped,
        boolean coverageOk,
        String tieNotice) {

    public JungDimensionScore dimension(JungDimension dimension) {
        return dimensions.get(dimension.ordinal());
    }

    /**
     * 候选是否并列到"不能挑第一"的程度：有多个候选且最小 cost 出现多次，
     * 或存在两个以上的平分维度。
     */
    public boolean candidatesAreAmbiguous() {
        if (candidates.size() < 2) {
            return false;
        }
        if (tiedDimensions.size() >= 2) {
            return true;
        }
        int best = candidates.get(0).cost();
        long tiedAtBest = candidates.stream().filter(candidate -> candidate.cost() == best).count();
        return tiedAtBest > 1;
    }
}
