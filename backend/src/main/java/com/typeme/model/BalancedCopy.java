package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

/**
 * 「本次这一维接近两侧均衡」时使用的文案（字段规格 §5）。
 *
 * <p>均衡**不是**信息不足：它有有效分数，只是偏移为 0；界面不得为它拼出一个主导字母。
 */
public record BalancedCopy(

        @NotBlank(message = "balanced.summary 不能为空")
        String summary,

        @NotBlank(message = "balanced.observation 不能为空")
        String observation
) {
}
