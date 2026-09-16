package com.typeme.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 解释政策（字段规格 §2、§8）。算法在客户端执行，但**参数与版本必须来自包本身**：
 * 前端不得硬编码 {@code 8 / 5 / 9}，否则改包不生效、包与页面会悄悄不同版本。
 *
 * <p>{@code typeMinDistance = 5} 是本产品暂定的保守展示策略，不是统计置信阈值，
 * 也没有证据证明它提升测量准确率；它由 {@code version} 版本化，不得表述为 OEJTS 或 MBTI 官方规则。
 */
public record InterpretationPolicy(

        @NotBlank(message = "interpretation.version 不能为空")
        String version,

        @NotNull(message = "interpretation.minRatingsPerDimension 不能为空")
        Integer minRatingsPerDimension,

        @NotNull(message = "interpretation.typeMinDistance 不能为空")
        Integer typeMinDistance,

        @NotNull(message = "interpretation.markedDistance 不能为空")
        Integer markedDistance
) {
}
