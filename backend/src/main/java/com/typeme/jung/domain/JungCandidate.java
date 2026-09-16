package com.typeme.jung.domain;

import java.util.List;

/**
 * 候选类型。
 *
 * <p>{@code cost} 是**与本次答案的规则距离**，不是概率、不是准确率、不是"最可能是"。
 * 它只把"换一个字母需要偏离多少证据"加起来，用于稳定展示顺序。
 *
 * @param differsOn 与本次计算方向不同的维度（按 {@code EI,SN,TF,JP} 序）
 */
public record JungCandidate(
        JungTypeCode typeCode,
        int cost,
        List<JungDimension> differsOn) {
}
