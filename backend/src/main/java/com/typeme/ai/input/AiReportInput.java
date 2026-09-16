package com.typeme.ai.input;

import java.util.List;
import java.util.Map;

/**
 * 一次分析请求的**完整输入材料**（服务端构造，客户端无法提供）。
 *
 * <p>{@link #payload()} 是"实际发给上游的内容"的可序列化形式：它同时用于
 * <ol>
 *   <li>落 {@code ai_consent.scope} 的结构化摘要（用户确认页展开预览的就是它）；</li>
 *   <li>组装给 DeepSeek 的 user message。</li>
 * </ol>
 * 一份数据两处用，所以"确认页说的"和"真正发出去的"不可能不一致。
 *
 * @param userId          归属用户（**不进 payload**，只用于去重键与越权过滤）
 * @param reportId        报告 id（**不进 payload**）
 * @param reportHash      报告内容 hash（进去重键，不进 payload）
 * @param computedTypeCode 后端算出的类型码；TIED 时为 null
 * @param status          报告状态
 * @param topic           主题
 * @param promptVersion   提示词版本
 * @param model           请求的模型
 * @param scopeVersion    发送范围版本
 * @param normalizedNote  规范化后的用户文字（空串表示用户没写）
 * @param evidence        服务端挑选的证据片段（≤ 8，含支持与反向）
 * @param payload         实际外发内容（不含账号标识/原始答卷/完整历史）
 * @param requestHash     去重键
 * @param evidenceIds     本次证据 id 白名单（校验模型输出用）
 */
public record AiReportInput(
        String userId,
        String reportId,
        String reportHash,
        String computedTypeCode,
        String status,
        AiTopic topic,
        String promptVersion,
        String model,
        String scopeVersion,
        String normalizedNote,
        List<Evidence> evidence,
        Map<String, Object> payload,
        String requestHash,
        List<String> evidenceIds) {

    /**
     * 一条证据片段。
     *
     * @param id             形如 {@code EI:summary}、{@code EI:item:EI-01}
     * @param text           只含题号、两端字母、用户选的位置与一句话场景标签；**不含**完整题干
     * @param dimension      所属维度
     * @param questionId     题目 id；维度级摘要为 null
     * @param contribution   该题对该维方向的贡献 {@code c ∈ [-2,2]}；摘要为 null
     * @param order          题号次序（包内 order），用于"剩余按 |c| 降序、order 升序"补足
     */
    public record Evidence(
            String id,
            String text,
            String dimension,
            String questionId,
            Integer contribution,
            int order) {

        /** 外发给上游的形态：只有 id 与 text。 */
        public Map<String, Object> asPayload() {
            return Map.of("id", id, "text", text);
        }
    }
}
