package com.typeme.ai.input;

import com.typeme.ai.config.AiException;

import java.util.Locale;

/** 用户可选的分析主题（契约 03 §2）。服务端再校验一次，非法值 400。 */
public enum AiTopic {

    OVERALL("overall", "全面认识自己"),
    COMMUNICATION("communication", "沟通相处"),
    STUDY_WORK("studyWork", "学习工作方式"),
    GROWTH("growth", "成长建议");

    private final String wire;
    private final String label;

    AiTopic(String wire, String label) {
        this.wire = wire;
        this.label = label;
    }

    public String wire() {
        return wire;
    }

    public String label() {
        return label;
    }

    /** 严格解析：只接受四个约定的字面值（大小写不敏感，两端空白忽略），不做"猜一个"。 */
    public static AiTopic parse(String token) {
        if (token == null || token.isBlank()) {
            throw AiException.validation("请选择要分析的主题。");
        }
        String normalized = token.trim().toLowerCase(Locale.ROOT);
        for (AiTopic topic : values()) {
            if (topic.wire.toLowerCase(Locale.ROOT).equals(normalized)) {
                return topic;
            }
        }
        throw AiException.validation("主题只能是 overall / communication / studyWork / growth。");
    }
}
