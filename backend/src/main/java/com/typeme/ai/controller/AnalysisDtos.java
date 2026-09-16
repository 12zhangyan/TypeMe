package com.typeme.ai.controller;

/**
 * AI 接口的请求体。
 *
 * <p>注意这里**没有** {@code userId}/{@code owner} 字段：归属一律取认证主体，
 * 请求体里根本无从表达"以别人的身份创建分析"。
 */
public final class AnalysisDtos {

    private AnalysisDtos() {
    }

    /**
     * {@code POST /reports/{id}/analyses}。
     *
     * @param consent 同意的政策版本与发送范围版本（缺失即 400 CONSENT_REQUIRED）
     * @param topic   overall / communication / studyWork / growth
     * @param note    可选近况（≤300 字，独立数据段，作为**数据**而非指令发送）
     */
    public record CreateAnalysisRequest(ConsentRequest consent, String topic, String note) {
    }

    /**
     * @param policyVersion 用户确认的政策版本（落 {@code ai_consent.policy_version}）
     * @param scopeVersion  发送范围版本（客户端留空时用服务端默认 {@code typeme-ai-scope-v2}，进 request_hash）
     */
    public record ConsentRequest(String policyVersion, String scopeVersion) {
    }
}
