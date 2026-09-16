package com.typeme.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 一个维度的全部解释文案（字段规格 §5、开发方案 §4.1）。
 *
 * <p>维度键由内容包声明（OEJTS {@code EI/SN/TF/JP}，IPIP {@code E/A/C/ES/O}），
 * 并与题库里出现的维度集合一致；{@code negative} 是数值低侧、{@code positive} 是数值高侧，
 * 两侧都要写明「它不等于什么」，避免把偏好读成能力或缺陷。
 * 不得生成认知功能排序、荣格八维、A/T、职业匹配率、恋爱配对或类型稀有度。
 */
public record DimensionCopy(

        @NotBlank(message = "dimensionCopy.name 不能为空")
        String name,

        /** 两端展示记号；可省略，省略时取仪器档案（OEJTS I/E…，IPIP 低/高）。 */
        String lowPole,

        String highPole,

        @NotNull(message = "dimensionCopy.negative 不能为空")
        @Valid
        PoleCopy negative,

        @NotNull(message = "dimensionCopy.positive 不能为空")
        @Valid
        PoleCopy positive,

        @NotNull(message = "dimensionCopy.balanced 不能为空")
        @Valid
        BalancedCopy balanced,

        @NotNull(message = "dimensionCopy.insufficient 不能为空")
        @Valid
        InsufficientCopy insufficient
) {
}
