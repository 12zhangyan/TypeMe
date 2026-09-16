package com.typeme.ai.client;

/**
 * DeepSeek 客户端抽象。
 *
 * <p>两个实现：{@code HttpDeepSeekClient}（真实 HTTP，{@code java.net.http.HttpClient}，不引入任何 AI SDK）
 * 与 {@code MockDeepSeekClient}（{@code mock-mode=true}，确定性结果 + 可参数化故障）。
 */
public interface DeepSeekClient {

    /**
     * 单次非流式补全。
     *
     * @throws DeepSeekException 上游失败；调用方必须检查 {@link DeepSeekException#billableUnknown()}
     */
    DeepSeekResponse complete(DeepSeekRequest request);

    /** true 表示这是 mock 适配器：结果必须带 {@code mock:true} 标记透传到 API 与 UI。 */
    boolean mock();
}
