package com.typeme.platform.catalog;

/**
 * 量表族：**题型、完成规则、计分与报告结构都不同**的量表种类。
 *
 * <p>它决定的东西很少（哪些是"同一套题型的另一个版本"），但每一样都关键：
 * <ul>
 *   <li>{@link #supportsClarificationRound()}：是否可能进入"补充题"第二轮。大五是 false，
 *       因此大五的 attempt 永远不会出现 clarification 状态；</li>
 *   <li>{@link #hasTypeCode()}：报告是否产出类型码。大五是 false，
 *       因此 {@code assessment_report.computed_type_code} 对大五恒为 NULL；</li>
 *   <li>{@link #itemKind()}：题目在接口上的形状（双极 vs 单句贴切度）。</li>
 * </ul>
 *
 * <p>**不要**把它当"量表之间的差异清单"随意扩张：每加一个分支，就要在
 * attempt 生命周期、报告构造、AI 输入投影里各自处理一次。真正的量表专属逻辑
 * 留在各自的 scorer / report builder 里。
 */
public enum InstrumentKind {

    /** 十六型参考测评：48 主测 + 最多 16 补充，四维取符号，产出四字母（或降级状态）。 */
    JUNG("jung", "bipolar", ItemKind.BIPOLAR_PAIR, true, true),

    /** 大五倾向测评：50 题一次答完，五维各自连续计分，**没有类型码**。 */
    BIG_FIVE("big_five", "agreement", ItemKind.AGREEMENT_STATEMENT, false, false);

    private final String code;
    private final String format;
    private final ItemKind itemKind;
    private final boolean typeCode;
    private final boolean clarificationRound;

    InstrumentKind(String code, String format, ItemKind itemKind, boolean typeCode,
                   boolean clarificationRound) {
        this.code = code;
        this.format = format;
        this.itemKind = itemKind;
        this.typeCode = typeCode;
        this.clarificationRound = clarificationRound;
    }

    /** 稳定的字符串标识（落进管理接口与日志，不要用 enum 名）。 */
    public String code() {
        return code;
    }

    /** 作答格式：{@code bipolar} / {@code agreement}。与内容包里的 {@code instrument.format} 一致。 */
    public String format() {
        return format;
    }

    public ItemKind itemKind() {
        return itemKind;
    }

    /** 报告是否产出类型码。 */
    public boolean hasTypeCode() {
        return typeCode;
    }

    /** 是否有"补充题"第二轮。 */
    public boolean supportsClarificationRound() {
        return clarificationRound;
    }

    public static InstrumentKind of(String code) {
        for (InstrumentKind kind : values()) {
            if (kind.code.equalsIgnoreCase(code) || kind.name().equalsIgnoreCase(code)) {
                return kind;
            }
        }
        throw new IllegalArgumentException("未知量表族：" + code);
    }

    /** 题目在接口上的形状。前端据此选择渲染组件，而不是靠"有没有四个维度"猜。 */
    public enum ItemKind {
        /** 一对相反的描述 + 5 档位置（左/右）。 */
        BIPOLAR_PAIR,
        /** 一句自我描述 + 5 档符合程度。 */
        AGREEMENT_STATEMENT,
    }
}
