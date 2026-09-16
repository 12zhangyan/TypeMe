package com.typeme.jung.domain;

/**
 * 一条作答记录。
 *
 * <p>{@code UNKNOWN}（"暂不适用 / 无法判断"）与"未处理"是**两件事**：
 * 这个类型只能表达前两者的区别，未处理 = map 里根本没有这个 questionId。
 * 服务端任何时候都不得把未处理题自动当成 unknown，也不得补 3 分。
 *
 * @param rating {@code RATING} 时是 1..5；{@code UNKNOWN} 时必须为 null
 */
public record JungAnswer(String questionId, Kind kind, Integer rating) {

    public enum Kind {
        RATING,
        UNKNOWN
    }

    public static JungAnswer rating(String questionId, int rating) {
        if (rating < 1 || rating > 5) {
            throw new IllegalArgumentException("分值必须在 1..5，收到：" + rating);
        }
        return new JungAnswer(questionId, Kind.RATING, rating);
    }

    public static JungAnswer unknown(String questionId) {
        return new JungAnswer(questionId, Kind.UNKNOWN, null);
    }

    public boolean isRating() {
        return kind == Kind.RATING && rating != null;
    }
}
