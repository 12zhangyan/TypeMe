package com.typeme.model;

import jakarta.validation.constraints.NotNull;

import java.util.Map;

/**
 * 计分配置（官方四条公式的常数项与判定阈值）。
 *
 * <p>判定规则是 {@code score > midpoint} 才翻到正极（E / N / T / P），
 * 即中点 {@code 24} 归到负极一侧（I / S / F / J）。前端不得硬编码这些值。
 */
public record ScoringConfig(

        @NotNull(message = "midpoint 不能为空")
        Integer midpoint,

        @NotNull(message = "constants 不能为空")
        Map<String, Integer> constants
) {
}
