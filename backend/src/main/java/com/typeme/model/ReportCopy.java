package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

/**
 * 报告页与分享产物共用的固定文案（字段规格 §6）。各维度正文来自 {@link DimensionCopy}。
 *
 * <p>四个标题分别对应 {@code overallStatus}：{@code typed} → {@code typedTitle}；
 * {@code partial} → {@code partialTitle}；{@code undetermined} → {@code undeterminedTitle}
 * （存在信息不足维度时改用 {@code insufficientTitle}）。
 *
 * <p>字段一个都不能少：少一个就是一个界面位置在运行时变成空白，而这类缺失肉眼很难发现。
 */
public record ReportCopy(

        @NotBlank(message = "reportCopy.typedTitle 不能为空")
        String typedTitle,

        @NotBlank(message = "reportCopy.typedSubtitle 不能为空")
        String typedSubtitle,

        @NotBlank(message = "reportCopy.partialTitle 不能为空")
        String partialTitle,

        @NotBlank(message = "reportCopy.partialSubtitle 不能为空")
        String partialSubtitle,

        @NotBlank(message = "reportCopy.undeterminedTitle 不能为空")
        String undeterminedTitle,

        @NotBlank(message = "reportCopy.undeterminedSubtitle 不能为空")
        String undeterminedSubtitle,

        @NotBlank(message = "reportCopy.insufficientTitle 不能为空")
        String insufficientTitle,

        @NotBlank(message = "reportCopy.insufficientSubtitle 不能为空")
        String insufficientSubtitle,

        @NotBlank(message = "reportCopy.typeReadingLead 不能为空")
        String typeReadingLead,

        @NotBlank(message = "reportCopy.scoreMethodNote 不能为空")
        String scoreMethodNote,

        @NotBlank(message = "reportCopy.dimensionReviewLead 不能为空")
        String dimensionReviewLead,

        @NotBlank(message = "reportCopy.selfReflectionLead 不能为空")
        String selfReflectionLead
) {
}
