package com.typeme.jung.domain;

/**
 * 本次结果的状态。
 *
 * <p>与旧引擎最大的差别：**方向轻微不再把整个类型隐藏**。
 * 旧的"四维都越过某个展示门槛才给四字母"政策在本新测里被 {@link #TENTATIVE} 取代：
 * 只要有非零方向就给出四字母，只是标注哪几维倾向较轻。
 */
public enum JungResultStatus {

    /** 覆盖不足（主测未处理题或某维数字回答不足 9）。不生成报告。 */
    NEEDS_REVIEW,

    /** 至少一维真正平分（S=0）。不产出唯一类型，给候选与四维解释。 */
    TIED,

    /** 四维方向都非零，但至少一维在边界范围内 → "本次更接近 ……"。 */
    TENTATIVE,

    /** 四维方向都非零且都不在边界范围内 → "本次参考类型"。 */
    REFERENCE;

    public boolean hasTypeCode() {
        return this == TENTATIVE || this == REFERENCE;
    }
}
