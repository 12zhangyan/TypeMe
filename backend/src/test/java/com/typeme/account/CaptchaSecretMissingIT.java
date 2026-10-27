package com.typeme.account;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * A-6：部署时忘了注入验证码密钥 → 失败关闭（503），既不放行注册，也不回退到默认密钥。
 */
class CaptchaSecretMissingIT extends AccountIntegrationTestBase {

    @DynamicPropertySource
    static void noSecret(DynamicPropertyRegistry registry) {
        registry.add("typeme.security.captcha-secret", () -> "");
    }

    @Test
    @DisplayName("未配置密钥：签发与注册都是 503 NOT_CONFIGURED，且不建号")
    void everythingFailsClosed() throws Exception {
        MvcResult issued = mockMvc.perform(get("/api/v3/auth/captcha")).andReturn();
        assertThat(issued.getResponse().getStatus()).isEqualTo(503);
        assertThat(body(issued).path("code").asText()).isEqualTo("NOT_CONFIGURED");

        // 即使攻击者猜中了测试里的合成密钥并签出"合法"令牌，也不能注册：服务端根本没有密钥可验。
        String username = uniqueUsername("nosecret");
        Map<String, Object> body = TestCaptcha.body("username", username, "password", "TestPassw0rd!",
                "disclaimerAccepted", true);
        MvcResult registered = registerRaw(body, uniqueIp());
        assertThat(registered.getResponse().getStatus()).isEqualTo(503);
        assertThat(body(registered).path("code").asText()).isEqualTo("NOT_CONFIGURED");
        assertThat(userRepository.findByNormalizedUsername(
                com.typeme.account.repository.UserRepository.normalize(username))).isEmpty();
    }
}
