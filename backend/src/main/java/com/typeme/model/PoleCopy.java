package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

/**
 * 某一维**一侧**的解释片段（字段规格 §5、开发方案 §4.1）。
 *
 * <p>{@code negative} / {@code positive} 只是数值低侧 / 高侧（I / S / F / J 与 E / N / T / P），
 * **不含好坏含义**；界面不得出现「负面人格」。{@code description} 只谈这一维，
 * 不做跨维推断（不从 SN 推智力、从 TF 推道德、从 JP 推勤奋、从 EI 推社交能力）。
 */
public record PoleCopy(

        @NotBlank(message = "poleCopy.label 不能为空")
        String label,

        @NotBlank(message = "poleCopy.description 不能为空")
        String description,

        @NotBlank(message = "poleCopy.observation 不能为空")
        String observation,

        @NotBlank(message = "poleCopy.action 不能为空")
        String action
) {
}
