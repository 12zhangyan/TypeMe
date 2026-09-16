package com.typeme.jung.domain;

/** 内容审校状态。首版全部内容都是 {@code DRAFT_REVIEW_PENDING}：未经真人试测。 */
public enum JungContentStatus {

    DRAFT_REVIEW_PENDING("draft_review_pending"),
    REVIEWED("reviewed"),
    FIELD_TESTED("field_tested");

    private final String token;

    JungContentStatus(String token) {
        this.token = token;
    }

    public String token() {
        return token;
    }

    public static JungContentStatus of(String token) {
        if (token != null) {
            for (JungContentStatus status : values()) {
                if (status.token.equalsIgnoreCase(token.trim())) {
                    return status;
                }
            }
        }
        throw new IllegalArgumentException("未知内容状态：" + token);
    }
}
