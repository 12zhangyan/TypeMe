package com.typeme.model;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 题库中的一道题。支持两种作答格式（字段规格 §0）：
 *
 * <ul>
 *   <li><b>双极</b>（{@code bipolar}，OEJTS）：{@code textLeft} 对应官方「圈 1」的一端，
 *       {@code textRight} 对应「圈 5」的一端。左右写反会让 {@code direction} 的整体方向反转，
 *       属于「跑得通但全错」的缺陷，因此按官方公式硬断言整套题号与符号。</li>
 *   <li><b>单句贴切度</b>（{@code agreement}，IPIP）：{@code text} 是一句自我描述，
 *       用户回答它有多贴切（1 非常不贴切 … 5 非常贴切）。</li>
 * </ul>
 *
 * <p>两种格式的"哪些字段必填"由 {@code ContentService.validateQuestionnaire} 按
 * {@code questionnaire.format} 分别断言（记录本身不再用注解锁死字段组合，
 * 否则第二份量表的单句题会被直接拒收）。
 *
 * <p>{@code dimension} 的取值由内容包声明（OEJTS {@code EI|SN|TF|JP}，IPIP {@code E|A|C|ES|O}），
 * 并与仪器档案核对；{@code direction} 只能是 {@code +1 / -1}。
 */
public record Question(

        @NotNull(message = "id 不能为空")
        @Min(value = 1, message = "id 必须 >= 1")
        Integer id,

        String textLeft,

        String textRight,

        String text,

        @NotBlank(message = "dimension 不能为空")
        String dimension,

        @NotNull(message = "direction 不能为空")
        Integer direction
) {
}
