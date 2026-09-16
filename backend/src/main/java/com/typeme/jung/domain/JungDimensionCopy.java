package com.typeme.jung.domain;

/** 一个维度的解释文案（两端 + 相近时的说明）。 */
public record JungDimensionCopy(
        JungDimension dimension,
        String name,
        String question,
        JungPoleCopy negativePole,
        JungPoleCopy positivePole,
        String balancedSummary,
        String balancedReading,
        String tiedNotice) {

    public JungPoleCopy copyOf(JungPole pole) {
        return pole == negativePole.pole() ? negativePole : positivePole;
    }
}
