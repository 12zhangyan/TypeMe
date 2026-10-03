package com.typeme.ipip.domain;

/**
 * 大五的一道题。
 *
 * @param id           题号，形如 {@code Q01}（内容包里的稳定标识，落库到
 *                     {@code assessment_answer.question_id}）
 * @param sourceItemId 对应的 IPIP-50 官方条目编号（1..50），用于与原始量表对照；
 *                     **不参与计分**，但缺了就无法核对"这一题是不是原来那一题"
 * @param dimension    所属维度
 * @param direction    计分方向：{@code +1} 表示"越符合这一句，该维分数越高"，
 *                     {@code -1} 表示反向题
 * @param order        展示顺序（1..50，连续）
 * @param text         中文题面（单句自我描述）
 * @param help         逐题解释：这一题在问什么、例子、以及"不说明什么"
 * @param reviewStatus 审校状态；大五包首版全部是 {@code draft_review_pending}
 * @param provenance   来源与改写说明
 */
public record BigFiveItem(
        String id,
        String sourceItemId,
        BigFiveDimension dimension,
        int direction,
        int order,
        String text,
        String help,
        String reviewStatus,
        String provenance) {

    public boolean isReverse() {
        return direction < 0;
    }
}
