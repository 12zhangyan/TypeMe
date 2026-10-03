package com.typeme.ipip.content;

import com.typeme.ipip.domain.BigFiveDimension;

import java.util.List;

/**
 * 一个维度的对外解释文案（内容包里的 {@code dimensions[]}）。
 *
 * <p>四项内容对应"报告要回答的四件事"：
 * <ol>
 *   <li>{@code name} / {@code question}：这一维在问什么（不出现术语）；</li>
 *   <li>{@code low} / {@code high}：两个方向的日常含义（不是好坏的判断）；</li>
 *   <li>{@code caution}：**不能据此判断什么**（防止把取向读成能力、疾病或职业成败）；</li>
 *   <li>{@code observation}：一个可以自己观察的具体场景。</li>
 * </ol>
 */
public record BigFiveDimensionCopy(
        BigFiveDimension dimension,
        String name,
        String question,
        BigFivePoleCopy low,
        BigFivePoleCopy high,
        String caution,
        String observation) {

    /** 两极的日常解释。 */
    public record BigFivePoleCopy(String label, String description, List<String> dailySigns) {
    }
}
