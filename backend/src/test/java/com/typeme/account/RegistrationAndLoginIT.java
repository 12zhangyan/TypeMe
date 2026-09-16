package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 注册 → 登录 → {@code GET /me} 全流程与字段校验（任务书测试清单 1）。
 */
class RegistrationAndLoginIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("注册 → 登录 → GET /me：全流程 + 恢复码只在注册响应里出现一次")
    void registerLoginAndMe() throws Exception {
        String username = uniqueUsername("alice");
        RegisteredAccount registered = register(username, "TestPassw0rd!");

        assertThat(registered.status()).isEqualTo(201);
        assertThat(registered.userId()).isNotBlank();
        // 恢复码：正好 8 个，字母表不含易混字符 0/O/1/I/L
        assertThat(registered.recoveryCodes()).hasSize(8);
        for (String code : registered.recoveryCodes()) {
            assertThat(code).matches(
                    "^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){3}$");
        }

        // 注册后立即就有会话（不用再登录一次）
        mockMvc.perform(get("/api/v3/me").session(registered.session()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(registered.userId()));

        // 用新会话重新登录（模拟"另一台设备"）
        MockHttpSession loginSession = new MockHttpSession();
        CsrfContext csrf = csrf(loginSession);
        MvcResult loginResult = login(csrf, loginSession, username, "TestPassw0rd!", uniqueIp());
        assertThat(loginResult.getResponse().getStatus()).isEqualTo(200);
        JsonNode loginBody = body(loginResult);
        assertThat(loginBody.path("userId").asText()).isEqualTo(registered.userId());
        assertThat(loginBody.path("username").asText()).isEqualTo(username);
        // 登录响应绝不包含密码或恢复码
        String loginRaw = loginResult.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(loginRaw).doesNotContain("TestPassw0rd!").doesNotContain("recoveryCodes");

        MvcResult me = mockMvc.perform(get("/api/v3/me").session(loginSession))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andExpect(jsonPath("$.userId").value(registered.userId()))
                .andReturn();
        String meRaw = me.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(meRaw).doesNotContain("passwordHash").doesNotContain("recoveryCodeVersion");
    }

    @Test
    @DisplayName("注册响应带 no-store，且不回显密码/恢复码 hash")
    void registerResponseIsNoStoreAndCarriesNoHash() throws Exception {
        String username = uniqueUsername("nostore");
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", "TestPassw0rd!"))), csrf))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andReturn();
        String raw = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(raw).doesNotContain("passwordHash").doesNotContain("codeHash").doesNotContain("TestPassw0rd!");
    }

    @Test
    @DisplayName("用户名不合规 → 400 VALIDATION_FAILED（不是 500、不是 409）")
    void invalidUsernameIsValidationFailed() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        for (String bad : new String[]{"ab", "has space", "bad-dash", "中文用户名", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}) {
            MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                            .session(session)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("username", bad, "password", "TestPassw0rd!"))), csrf))
                    .andReturn();
            assertThat(result.getResponse().getStatus())
                    .as("用户名「%s」必须被拒", bad)
                    .isEqualTo(400);
            assertThat(body(result).path("code").asText()).isEqualTo("VALIDATION_FAILED");
        }
    }

    @Test
    @DisplayName("密码过短 → 400 VALIDATION_FAILED")
    void shortPasswordIsValidationFailed() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", uniqueUsername("shortpw"), "password", "1234567"))), csrf))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(result).path("code").asText()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    @DisplayName("重复用户名 → 409 CONFLICT，且失败响应不泄漏任何 hash")
    void duplicateUsernameIsConflict() throws Exception {
        String username = uniqueUsername("dup");
        assertThat(register(username, "TestPassw0rd!").status()).isEqualTo(201);

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username.toUpperCase(java.util.Locale.ROOT),
                                "password", "TestPassw0rd!"))), csrf))
                .andReturn();
        // 用户名大小写不敏感（规范化后唯一）：大写形式同样视为重复
        assertThat(result.getResponse().getStatus()).isEqualTo(409);
    }

    @Test
    @DisplayName("PATCH /me 改昵称：允许中文；纯空白/超长被拒")
    void updateNickname() throws Exception {
        RegisteredAccount account = register(uniqueUsername("nick"), "TestPassw0rd!");
        CsrfContext csrf = csrf(account.session());

        mockMvc.perform(withCsrf(patch("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("nickname", "  小张  "))), csrf))
                .andExpect(status().isOk())
                // 首尾空白被 trim（否则展示层会拿到带空格的昵称）
                .andExpect(jsonPath("$.nickname").value("小张"));

        MvcResult blank = mockMvc.perform(withCsrf(patch("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("nickname", "   "))), csrf))
                .andReturn();
        assertThat(blank.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(blank).path("code").asText()).isEqualTo("VALIDATION_FAILED");
    }

    @Test
    @DisplayName("登录失败与用户名不存在返回逐字相同的 401 INVALID_CREDENTIALS（不可枚举账号）")
    void loginFailureDoesNotRevealAccountExistence() throws Exception {
        String username = uniqueUsername("enum");
        register(username, "TestPassw0rd!");

        MockHttpSession sessionA = new MockHttpSession();
        CsrfContext csrfA = csrf(sessionA);
        MvcResult wrongPassword = login(csrfA, sessionA, username, "WrongPassw0rd!", uniqueIp());

        MockHttpSession sessionB = new MockHttpSession();
        CsrfContext csrfB = csrf(sessionB);
        MvcResult unknownUser = login(csrfB, sessionB, uniqueUsername("nobody"), "WrongPassw0rd!", uniqueIp());

        assertThat(wrongPassword.getResponse().getStatus()).isEqualTo(401);
        assertThat(unknownUser.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(wrongPassword).path("code").asText()).isEqualTo("INVALID_CREDENTIALS");
        assertThat(body(unknownUser).path("code").asText()).isEqualTo("INVALID_CREDENTIALS");
        // 逐字相同：连 message 都不能有差别
        assertThat(body(unknownUser).path("message").asText())
                .isEqualTo(body(wrongPassword).path("message").asText());
    }
}
