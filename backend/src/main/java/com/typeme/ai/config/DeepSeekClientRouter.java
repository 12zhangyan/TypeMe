package com.typeme.ai.config;

import com.typeme.ai.client.DeepSeekClient;
import com.typeme.ai.client.DeepSeekRequest;
import com.typeme.ai.client.DeepSeekResponse;
import com.typeme.ai.client.HttpDeepSeekClient;
import com.typeme.ai.client.MockDeepSeekClient;

/**
 * 在 mock 与真实客户端之间路由（{@code typeme.ai.mock-mode} 每次调用读取，支持不重启切换）。
 *
 * <p>为什么以 router 而不是"启动时二选一注入"：mock-mode 现在来自管理员后台设置，
 * 管理员打开/关闭 mock 之后**不该需要重启**。router 每次按最新设置决定，
 * 同时把"这次到底有没有真的调用上游"变成一个可以在日志里回答的问题。
 */
public class DeepSeekClientRouter implements DeepSeekClient {

    private final AiRuntimeSettingsProvider settingsProvider;
    private final HttpDeepSeekClient http;
    private final MockDeepSeekClient mock;

    public DeepSeekClientRouter(AiRuntimeSettingsProvider settingsProvider,
                                HttpDeepSeekClient http,
                                MockDeepSeekClient mock) {
        this.settingsProvider = settingsProvider;
        this.http = http;
        this.mock = mock;
    }

    @Override
    public boolean mock() {
        return settingsProvider.settings().mockMode();
    }

    @Override
    public DeepSeekResponse complete(DeepSeekRequest request) {
        return mock() ? mock.complete(request) : http.complete(request);
    }

    /** 测试用：直接拿到 mock 实例设置故障模式、读调用计数。 */
    public MockDeepSeekClient mockClient() {
        return mock;
    }

    public HttpDeepSeekClient httpClient() {
        return http;
    }
}
