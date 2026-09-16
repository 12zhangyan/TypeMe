package com.typeme.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;
import java.util.Map;

/**
 * 一个**不可变**内容包（字段规格 §2，等价于开发方案 §5.2 的 {@code AssessmentPackage}）。
 *
 * <p>它承载「题目 + 逐题帮助 + 维度解释 + 报告文案 + 解释政策」这一整套锁定内容，
 * 由 {@code GET /api/v2/assessment-packages/{packageId}} 只读下发（ADR-1：后端不实现计分）。
 *
 * <p>⚠️ 未知字段不放行（严格 mapper，MI-3）：内容文件是唯一真相，键名写错必须当场失败，
 * 否则会静默丢字段——例如把 {@code localeRevision} 拼成 {@code localeRev}，包照样加载，
 * 只是版本标识永远查不到。
 *
 * <p>字段名与 YAML 键一一对应（record 参数名 + 编译器 {@code -parameters}，已在
 * {@code pom.xml} 由 Spring Boot 父 POM 开启并由测试断言），因此不额外写 {@code @JsonProperty}。
 *
 * <p>{@code itemHelp} 的键严格为字符串 {@code "1"}…{@code "32"} 且全覆盖（字段规格 §4）：
 * 帮助按题号附加，因此核心 {@link Question} 不需要为了帮助新增字段。
 */
public record AssessmentPackage(

        @NotNull(message = "schemaVersion 不能为空")
        Integer schemaVersion,

        @NotBlank(message = "packageId 不能为空")
        String packageId,

        @NotBlank(message = "locale 不能为空")
        String locale,

        @NotBlank(message = "localeRevision 不能为空")
        String localeRevision,

        @NotBlank(message = "helpRevision 不能为空")
        String helpRevision,

        @NotBlank(message = "copyRevision 不能为空")
        String copyRevision,

        @NotBlank(message = "contentStatus 不能为空")
        String contentStatus,

        @NotNull(message = "instrument 不能为空")
        @Valid
        AssessmentInstrument instrument,

        @NotNull(message = "interpretation 不能为空")
        @Valid
        InterpretationPolicy interpretation,

        @NotBlank(message = "title 不能为空")
        String title,

        @NotNull(message = "estimatedMinutes 不能为空")
        Integer estimatedMinutes,

        /** 维度展示顺序；可省略，省略时取仪器档案。 */
        List<String> dimensionOrder,

        @NotNull(message = "questionnaire 不能为空")
        @Valid
        Questionnaire questionnaire,

        @NotNull(message = "itemHelp 不能为空")
        @Valid
        Map<String, ItemHelp> itemHelp,

        @NotNull(message = "dimensionCopy 不能为空")
        @Valid
        Map<String, DimensionCopy> dimensionCopy,

        @NotNull(message = "reportCopy 不能为空")
        @Valid
        ReportCopy reportCopy,

        @NotEmpty(message = "nextSteps 不能为空")
        @Valid
        List<String> nextSteps,

        @NotNull(message = "attribution 不能为空")
        @Valid
        MethodContent.Attribution attribution
) {
}
