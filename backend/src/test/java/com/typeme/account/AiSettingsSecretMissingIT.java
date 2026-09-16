package com.typeme.account;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 未配置 apiKey 加密密钥时的行为（安全降级路径）。
 *
 * <p>这是"宁可不可用，也不要用硬编码密钥加密"这条决策的可测证据：
 * 读取设置照常（后台页面能用），但写入 apiKey 必须 503 {@code NOT_CONFIGURED}，
 * 并且数据库里不能留下任何 key 材料。
 *
 * <p>用独立库（由基类上的 {@code @AccountTestDatabase} 自动提供）：
 * {@code ai_setting} 是**单例行**（{@code CHECK (id = 'default')}），
 * 与其它账号测试共用库时，别的用例写下的 {@code api_key_source='db'} 会留在这里，
 * 于是"写入被拒后 source 仍是 none"这条断言失败。
 */
class AiSettingsSecretMissingIT extends AccountIntegrationTestBase {

    @DynamicPropertySource
    static void noSecret(DynamicPropertyRegistry registry) {
        // 显式清空：模拟"部署时忘了注入 TYPEME_SETTINGS_SECRET"
        registry.add("typeme.security.settings-secret", () -> "");
    }

    @Test
    @DisplayName("无加密密钥：GET 可用，PUT apiKey → 503 NOT_CONFIGURED 且库里没有 key 材料")
    void writingApiKeyWithoutSecretIsRefused() throws Exception {
        String adminUsername = uniqueUsername("nosecretadmin");
        RegisteredAccount admin = register(adminUsername, "TestPassw0rd!");
        new TestAccounts(mockMvc, objectMapper, userRepository).promoteToAdmin(adminUsername);

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        assertThat(login(csrf, session, adminUsername, "TestPassw0rd!", uniqueIp())
                .getResponse().getStatus()).isEqualTo(200);

        // 读取：可用（后台页面不该因为少一个密钥就整个打不开）
        mockMvc.perform(get("/api/v3/admin/ai-settings").session(session))
                .andExpect(status().isOk());

        // 写入 apiKey：必须 503，且不回显 key
        String key = "sk-should-never-be-stored";
        MvcResult refused = mockMvc.perform(withCsrf(put("/api/v3/admin/ai-settings")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("apiKey", key))), csrf))
                .andReturn();
        assertThat(refused.getResponse().getStatus()).isEqualTo(503);
        assertThat(body(refused).path("code").asText()).isEqualTo("NOT_CONFIGURED");
        assertThat(refused.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain(key);

        // 库里没有 key（连行都不该建出来）
        MvcResult settings = mockMvc.perform(get("/api/v3/admin/ai-settings").session(session))
                .andReturn();
        assertThat(body(settings).path("apiKeyConfigured").asBoolean()).isFalse();
        assertThat(body(settings).path("apiKeySource").asText()).isNotEqualTo("db");
    }
}
