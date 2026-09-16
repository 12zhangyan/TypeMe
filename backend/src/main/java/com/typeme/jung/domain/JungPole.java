package com.typeme.jung.domain;

import java.util.List;
import java.util.Locale;

/**
 * 八个极点字母。
 *
 * <p>极点配对是固定的四对，且每维的**第一个字母是负极、第二个是正极**：
 * {@code I/E}、{@code S/N}、{@code T/F}、{@code J/P}。
 * 这个约定必须处处一致，否则 "TF/JP 正负极串用" 这类错误会静默产出相反的类型码。
 */
public enum JungPole {

    I(JungDimension.EI), E(JungDimension.EI),
    S(JungDimension.SN), N(JungDimension.SN),
    T(JungDimension.TF), F(JungDimension.TF),
    J(JungDimension.JP), P(JungDimension.JP);

    private final JungDimension dimension;

    JungPole(JungDimension dimension) {
        this.dimension = dimension;
    }

    public JungDimension dimension() {
        return dimension;
    }

    /** 该极点是所属维度的正极吗。 */
    public boolean isPositive() {
        return this == dimension.positivePole();
    }

    public boolean isNegative() {
        return this == dimension.negativePole();
    }

    /** 同维的另一个极点。 */
    public JungPole opposite() {
        return isPositive() ? dimension.negativePole() : dimension.positivePole();
    }

    /** 字母形态。 */
    public char letter() {
        return name().charAt(0);
    }

    /** 全大写匹配；只接受单个字母，避免 "Ei" / "E " 之类被静默接受。 */
    public static JungPole of(String token) {
        if (token == null) {
            throw new IllegalArgumentException("极点不能为空");
        }
        String normalized = token.trim().toUpperCase(Locale.ROOT);
        if (normalized.length() != 1) {
            throw new IllegalArgumentException("极点必须是单个字母，收到：" + token);
        }
        char letter = normalized.charAt(0);
        return of(letter);
    }

    public static JungPole of(char letter) {
        return switch (Character.toUpperCase(letter)) {
            case 'I' -> I;
            case 'E' -> E;
            case 'S' -> S;
            case 'N' -> N;
            case 'T' -> T;
            case 'F' -> F;
            case 'J' -> J;
            case 'P' -> P;
            default -> throw new IllegalArgumentException("未知极点字母：" + letter);
        };
    }

    /** 某一维的合法极点配对（只有一对）。 */
    public static List<List<JungPole>> legalPairs() {
        return List.of(
                List.of(I, E),
                List.of(S, N),
                List.of(T, F),
                List.of(J, P));
    }
}
