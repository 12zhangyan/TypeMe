package com.typeme.jung.domain;

/** 题目的阶段。澄清题只在 review 判定该维需要追加时才允许作答。 */
public enum JungStage {

    BASE("base"),
    CLARIFICATION("clarification");

    private final String token;

    JungStage(String token) {
        this.token = token;
    }

    public String token() {
        return token;
    }

    public static JungStage of(String token) {
        if (token != null) {
            for (JungStage stage : values()) {
                if (stage.token.equalsIgnoreCase(token.trim())) {
                    return stage;
                }
            }
        }
        throw new IllegalArgumentException("未知阶段：" + token);
    }
}
