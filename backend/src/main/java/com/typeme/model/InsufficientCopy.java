package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

/**
 * 「这一维缺少可计分选择」时使用的文案（字段规格 §5、§8）。
 *
 * <p>信息不足与均衡是两种状态：前者没有分数（不补 3、不按比例补分、不缩短分母），
 * 因此界面不得显示 0%、24 分或任何数值点。
 */
public record InsufficientCopy(

        @NotBlank(message = "insufficient.summary 不能为空")
        String summary,

        @NotBlank(message = "insufficient.nextStep 不能为空")
        String nextStep
) {
}
