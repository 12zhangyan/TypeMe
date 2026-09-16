package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

/**
 * 内容包承载的**量表身份**（开发方案 §5.1、字段规格 §0/§2）。
 *
 * <p>项目现在承载两份量表：OEJTS 32 题（四字母类型）与 IPIP 大五 50 题（连续特质）。
 * 内容包声明自己属于哪一份，官方事实（题数、维度、符号、常量、中点、两端记号）由
 * {@code ContentService.INSTRUMENT_PROFILES} 里的**独立档案**核对；
 * 没有档案的 {@code instrument.id} 会被拒绝装载，不允许"无法被独立核对的量表"上线。
 *
 * <p>{@code format} 与 {@code hasTypeCode} 可以省略：省略时由仪器档案补齐。
 * 这样已锁定的 OEJTS 包一个字节都不用改，而新仪器必须显式声明（或由档案提供）。
 */
public record AssessmentInstrument(

        @NotBlank(message = "instrument.id 不能为空")
        String id,

        @NotBlank(message = "instrument.revision 不能为空")
        String revision,

        @NotBlank(message = "instrument.scoringVersion 不能为空")
        String scoringVersion,

        /** {@code bipolar}（缺省）或 {@code agreement}。 */
        String format,

        /** 是否把各维度拼成一个类型码（OEJTS true；大五 false）。 */
        Boolean hasTypeCode
) {
}
