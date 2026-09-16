package com.typeme.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 一个版本的题库（对应 {@code content/questionnaire-<version>.yml}）。
 *
 * <p>本对象会原样序列化给前端：{@code scoring} 与 {@code questions} 必须足以驱动计分，
 * 前端不得硬编码题号、符号或常量。
 */
public record Questionnaire(

        @NotBlank(message = "version 不能为空")
        String version,

        @NotBlank(message = "title 不能为空")
        String title,

        @NotNull(message = "questionCount 不能为空")
        @Min(value = 1, message = "questionCount 必须 >= 1")
        Integer questionCount,

        @NotNull(message = "estimatedMinutes 不能为空")
        @Min(value = 1, message = "estimatedMinutes 必须 >= 1")
        Integer estimatedMinutes,

        @NotNull(message = "scoring 不能为空")
        @Valid
        ScoringConfig scoring,

        @NotEmpty(message = "questions 不能为空")
        @Valid
        List<Question> questions,

        /** {@code bipolar}（缺省，OEJTS）或 {@code agreement}（IPIP 单句贴切度）。 */
        String format,

        /** 五档作答文案；长度必须为 5。缺省时用 OEJTS 的默认文案。 */
        List<String> responseAnchors,

        /** 维度展示顺序；缺省时取仪器档案。 */
        List<String> dimensionOrder
) {
}
