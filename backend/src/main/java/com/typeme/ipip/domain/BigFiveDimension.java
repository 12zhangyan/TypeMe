package com.typeme.ipip.domain;

import java.util.List;

/**
 * 大五的五个维度。
 *
 * <p>这里的名字是**内容与计分里的稳定标识**，不是界面文案：界面上显示什么由内容包的
 * {@code dimensions[].name} 决定（同一份编码在不同中文版本里可以有不同措辞）。
 *
 * <p>刻意**不**复用 {@code JungDimension}：大五的 ES（情绪稳定性）与 Jung 的 TF 之类
 * 没有任何对应关系，复用会导致"把大五数据塞进四字母结构"这类错误在类型层面变得可表达。
 * 平台层需要通用表示时用字符串 code（见 {@code AssessmentRelease.dimensionCodes()}）。
 */
public enum BigFiveDimension {
    /** 外向性。高分 = 更活跃。 */
    E("E"),
    /** 宜人性。高分 = 更体贴。 */
    A("A"),
    /** 尽责性。高分 = 更有条理。 */
    C("C"),
    /** 情绪稳定性。高分 = 更平稳。 */
    ES("ES"),
    /** 开放性。高分 = 更好奇。 */
    O("O");

    private final String code;

    BigFiveDimension(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static BigFiveDimension of(String code) {
        for (BigFiveDimension dimension : values()) {
            if (dimension.code.equalsIgnoreCase(code) || dimension.name().equalsIgnoreCase(code)) {
                return dimension;
            }
        }
        throw new IllegalArgumentException("未知的大五维度：" + code);
    }

    /** 展示顺序固定为 E, A, C, ES, O（与内容包的 {@code dimensionOrder} 一致）。 */
    public static List<BigFiveDimension> ordered() {
        return List.of(E, A, C, ES, O);
    }
}
