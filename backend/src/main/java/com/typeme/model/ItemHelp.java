package com.typeme.model;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 一道题的逐题帮助（字段规格 §4）。{@code itemHelp} 的键严格为字符串 {@code "1"}…{@code "32"}。
 *
 * <p>{@code explanation} 是**用户可见文字**：必须说明两端在比什么、不引导向社会认可的一侧、
 * 不出现「你天生 / 你一定」这类断言，也不得残留审校表里的编辑批注
 * （例如「若采用…需核对」「该解释的场景范围须与最终题面一致」）——那些由
 * {@code ContentService.validateAssessmentPackage} 硬断言拦下。
 *
 * <p>展开帮助只影响界面，不改变回答、计数或分数。
 */
public record ItemHelp(

        @NotBlank(message = "itemHelp.explanation 不能为空")
        String explanation,

        @NotBlank(message = "itemHelp.reviewStatus 不能为空")
        String reviewStatus,

        @NotNull(message = "itemHelp.riskCodes 不能为空（没有风险码时写 []）")
        List<String> riskCodes
) {
}
