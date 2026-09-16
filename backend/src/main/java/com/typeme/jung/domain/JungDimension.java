package com.typeme.jung.domain;

import java.util.List;
import java.util.Locale;

/**
 * 新测（typeme-jung48）的四个维度。
 *
 * <p>枚举声明顺序就是**权威输出顺序**：任何返回给前端或写进报告的维度数组都必须按
 * {@code EI, SN, TF, JP} 排列。不要用 {@code Arrays.sort} 或字典序改写它 —— 字典序会变成
 * {@code EI, JP, SN, TF}，页面上的维度次序会随实现细节漂移。
 */
public enum JungDimension {

    EI("精力方向", 'I', 'E'),
    SN("信息关注", 'S', 'N'),
    TF("决策依据", 'T', 'F'),
    JP("生活节奏", 'J', 'P');

    private final String name;
    private final char negativeLetter;
    private final char positiveLetter;

    JungDimension(String name, char negativeLetter, char positiveLetter) {
        this.name = name;
        this.negativeLetter = negativeLetter;
        this.positiveLetter = positiveLetter;
    }

    public String displayName() {
        return name;
    }

    /**
     * 负极字母（I/S/T/J）。
     *
     * <p>注意：这是**本新测自己的**约定，与旧 OEJTS 引擎的数值侧约定**不同**
     * （OEJTS 的数值高侧是 T/P）。禁止把旧符号常量搬过来复用。
     */
    public JungPole negativePole() {
        return JungPole.of(negativeLetter);
    }

    /** 正极字母（E/N/F/P）。 */
    public JungPole positivePole() {
        return JungPole.of(positiveLetter);
    }

    /** 两个极点，按 {@code [negative, positive]} 顺序。 */
    public List<JungPole> poles() {
        return List.of(negativePole(), positivePole());
    }

    public static JungDimension of(String token) {
        if (token == null) {
            throw new IllegalArgumentException("维度不能为空");
        }
        String normalized = token.trim().toUpperCase(Locale.ROOT);
        for (JungDimension dimension : values()) {
            if (dimension.name().equals(normalized)) {
                return dimension;
            }
        }
        throw new IllegalArgumentException("未知维度：" + token);
    }

    public static JungDimension ofStrict(String token) {
        try {
            return of(token);
        } catch (IllegalArgumentException ex) {
            throw ex;
        }
    }
}
