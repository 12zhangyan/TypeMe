package com.typeme.ai.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ai.client.DeepSeekClient;
import com.typeme.ai.client.HttpDeepSeekClient;
import com.typeme.ai.client.MockDeepSeekClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;

/**
 * AI 模块的装配。
 *
 * <p>{@link DeepSeekClientRouter} 是在 {@code mock-mode} 与真实 HTTP 之间切换的**唯一入口**：
 * 让切换点显式、可观测（每次调用记一次 DEBUG 级别的来源标记），比在运行时偷偷替换 bean 要好排查。
 * mock 结果必须带 {@code mock:true} 标记一路透传到 API 与 UI。
 */
@Configuration
@EnableConfigurationProperties(AiProperties.class)
public class AiConfiguration {

    @Bean
    public HttpDeepSeekClient httpDeepSeekClient(AiRuntimeSettingsProvider settingsProvider, ObjectMapper mapper) {
        return new HttpDeepSeekClient(settingsProvider, mapper);
    }

    @Bean
    public MockDeepSeekClient mockDeepSeekClient(ObjectMapper mapper, AiProperties properties) {
        return new MockDeepSeekClient(mapper, System.getProperty(
                MockDeepSeekClient.FAILURE_MODE_SYSTEM_PROPERTY, ""));
    }

    /**
     * 对外暴露的 {@link DeepSeekClient}：router 是**唯一**可被注入的那一个。
     *
     * <p>{@code @Primary} 不是装饰：容器里同时存在 http/mock 两个具体实现，
     * 没有它就会在注入点报 "expected single matching bean but found 3"。
     * 这样"用哪个实现"永远由 router 按最新设置决定，注入方不需要（也不应该）知道细节。
     */
    @Bean
    @Primary
    public DeepSeekClient deepSeekClient(AiRuntimeSettingsProvider settingsProvider,
                                         HttpDeepSeekClient http,
                                         MockDeepSeekClient mock) {
        return new DeepSeekClientRouter(settingsProvider, http, mock);
    }
}
