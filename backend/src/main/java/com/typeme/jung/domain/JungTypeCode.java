package com.typeme.jung.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 四字母类型码。**唯一合法的形状是 {@code ^[EI][SN][TF][JP]$}**。
 *
 * <p>这里刻意不提供"纠正"能力：{@code IMFJ} 不会被猜成某个类型，{@code enfp} 不会被
 * 自动大写后接受（用户输入的错误必须被显式拒绝并提示，见产品方案 §1）。
 * 服务端自己产生的类型码一律通过 {@link #ofPoles} 构造，恒为规范形。
 */
public record JungTypeCode(String value) {

    private static final Pattern LEGAL = Pattern.compile("^[EI][SN][TF][JP]$");

    public JungTypeCode {
        if (value == null || !LEGAL.matcher(value).matches()) {
            throw new IllegalArgumentException("类型码必须匹配 ^[EI][SN][TF][JP]$，收到：" + value);
        }
    }

    /** 严格校验：不 trim、不大写，只接受规范形。用于校验外部输入。 */
    public static boolean isLegal(String candidate) {
        return candidate != null && LEGAL.matcher(candidate).matches();
    }

    /** 严格解析：非法即抛。用于服务端自己构造或校验客户端输入。 */
    public static JungTypeCode parse(String candidate) {
        return new JungTypeCode(candidate);
    }

    /**
     * 由四维极点构造。传 null（某一维平分）会抛 —— 平分时不产出类型码，
     * 调用方必须先判 {@code status.hasTypeCode()}。这样"忘了判平分就给默认类型"
     * 这类缺陷会立刻炸掉，而不是静默回退成某个类型。
     */
    public static JungTypeCode ofPoles(JungPole ei, JungPole sn, JungPole tf, JungPole jp) {
        requireDimension(ei, JungDimension.EI);
        requireDimension(sn, JungDimension.SN);
        requireDimension(tf, JungDimension.TF);
        requireDimension(jp, JungDimension.JP);
        return new JungTypeCode(new String(new char[] { ei.letter(), sn.letter(), tf.letter(), jp.letter() }));
    }

    /** 按 {@code EI, SN, TF, JP} 顺序取该类型码在这四维上的极点。 */
    public List<JungPole> poles() {
        List<JungPole> result = new ArrayList<>(4);
        for (int index = 0; index < value.length(); index++) {
            result.add(JungPole.of(value.charAt(index)));
        }
        return List.copyOf(result);
    }

    public JungPole poleOf(JungDimension dimension) {
        return poles().get(dimension.ordinal());
    }

    /** 只在某个维度换成另一极。 */
    public JungTypeCode withPole(JungDimension dimension, JungPole pole) {
        if (pole.dimension() != dimension) {
            throw new IllegalArgumentException("极点 " + pole + " 不属于维度 " + dimension);
        }
        List<JungPole> poles = new ArrayList<>(poles());
        poles.set(dimension.ordinal(), pole);
        return ofPoles(poles.get(0), poles.get(1), poles.get(2), poles.get(3));
    }

    private static void requireDimension(JungPole pole, JungDimension dimension) {
        if (pole == null || pole.dimension() != dimension) {
            throw new IllegalArgumentException("极点 " + pole + " 不属于维度 " + dimension);
        }
    }

    /** 便于日志与调试；不改变规范形。 */
    public String display() {
        return value.toUpperCase(Locale.ROOT);
    }

    @Override
    public String toString() {
        return value;
    }
}
