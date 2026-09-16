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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 安全边界：未认证 401 JSON、CSRF、会话固定防护、改密踢旧会话、账号隔离
 * （任务书测试清单 2、3、4、6）。
 */
class SecurityBoundaryIT extends AccountIntegrationTestBase {

    // ------------------------------------------------------------------ 2. 未登录

    @Test
    @DisplayName("未登录 GET /api/v3/me → 401 JSON（不是 HTML、不是重定向）")
    void unauthenticatedMeIsJson401() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.requestId").isNotEmpty())
                .andReturn();
        String raw = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(raw).doesNotContain("<html").doesNotContain("<!DOCTYPE");
        assertThat(result.getResponse().getRedirectedUrl()).isNull();
        // Content-Type 必须是 JSON：前端靠它决定解析方式
        assertThat(result.getResponse().getContentType()).contains("application/json");
    }

    @Test
    @DisplayName("未登录访问 admin → 401（未认证与无权限要能区分）")
    void unauthenticatedAdminIs401() throws Exception {
        mockMvc.perform(get("/api/v3/admin/users"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // ------------------------------------------------------------------ 3. CSRF

    @Test
    @DisplayName("CSRF：带 cookie 但不带 header 的写请求 → 403 CSRF_INVALID；带上则通过")
    void csrfIsEnforcedOnWrites() throws Exception {
        RegisteredAccount account = register(uniqueUsername("csrf"), "TestPassw0rd!");

        // 不带 X-XSRF-TOKEN：必须 403 CSRF_INVALID
        MvcResult noToken = mockMvc.perform(post("/api/v3/me/password")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", "TestPassw0rd!", "newPassword", "NewPassw0rd!"))))
                .andReturn();
        assertThat(noToken.getResponse().getStatus()).isEqualTo(403);
        assertThat(body(noToken).path("code").asText()).isEqualTo("CSRF_INVALID");

        // 带上 header：通过（204）
        CsrfContext csrf = csrf(account.session());
        mockMvc.perform(withCsrf(post("/api/v3/me/password")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", "TestPassw0rd!", "newPassword", "NewPassw0rd!"))), csrf))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("CSRF：GET /auth/csrf 返回 token/headerName/parameterName 且 no-store")
    void csrfEndpointShape() throws Exception {
        CsrfContext csrf = csrf(new MockHttpSession());
        assertThat(csrf.token()).isNotBlank();
        assertThat(csrf.headerName()).isEqualTo("X-XSRF-TOKEN");
        mockMvc.perform(get("/api/v3/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getHeader("Cache-Control"))
                        .contains("no-store"))
                .andExpect(jsonPath("$.parameterName").value("_csrf"));
    }

    // ------------------------------------------------------------------ 4. 会话固定

    @Test
    @DisplayName("会话固定防护：登录前后 JSESSIONID 必须不同；改密后旧会话失效")
    void sessionFixationAndPasswordChangeRevokesOtherSessions() throws Exception {
        String username = uniqueUsername("fix");
        String password = "TestPassw0rd!";
        RegisteredAccount registered = register(username, password);
        String registrationSessionId = registered.session().getId();

        // 另一台设备登录：登录前先建出会话，拿到"登录前 id"
        MockHttpSession loginSession = new MockHttpSession();
        CsrfContext csrf = csrf(loginSession);
        String beforeLoginId = loginSession.getId();

        MvcResult loginResult = login(csrf, loginSession, username, password, uniqueIp());
        assertThat(loginResult.getResponse().getStatus()).isEqualTo(200);
        String afterLoginId = loginSession.getId();
        assertThat(afterLoginId).as("登录必须轮换 sessionId（会话固定防护）").isNotEqualTo(beforeLoginId);
        // 与"注册时那个会话"也不同
        assertThat(afterLoginId).isNotEqualTo(registrationSessionId);

        // 改密：撤销除当前会话外的全部会话
        CsrfContext loginCsrf = csrf(loginSession);
        mockMvc.perform(withCsrf(post("/api/v3/me/password")
                        .session(loginSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", password, "newPassword", "NewPassw0rd!"))), loginCsrf))
                .andExpect(status().isNoContent());

        // 当前会话仍然可用
        mockMvc.perform(get("/api/v3/me").session(loginSession)).andExpect(status().isOk());

        // 注册时那个旧会话必须失效：用**同 id** 的会话对象请求（否则断言恒真）
        MockHttpSession oldSession = sameIdSessionAs(registered.session());
        MvcResult oldSessionResult = mockMvc.perform(get("/api/v3/me").session(oldSession)).andReturn();
        assertThat(oldSessionResult.getResponse().getStatus())
                .as("改密后旧会话必须 401（只删表行不算失效）")
                .isEqualTo(401);
    }

    // ------------------------------------------------------------------ 6. 账号隔离

    @Test
    @DisplayName("账号隔离：A 与 B 各自只看到自己的 /me 与导出内容")
    void accountsAreIsolated() throws Exception {
        String password = "TestPassw0rd!";
        RegisteredAccount alice = register(uniqueUsername("alice_a"), password);
        RegisteredAccount bob = register(uniqueUsername("bob_b"), password);

        // A 的 /me 是 A
        MvcResult aliceMe = mockMvc.perform(get("/api/v3/me").session(alice.session()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(aliceMe).path("userId").asText()).isEqualTo(alice.userId());

        // B 的 /me 是 B，且绝不是 A
        MvcResult bobMe = mockMvc.perform(get("/api/v3/me").session(bob.session()))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(bobMe).path("userId").asText()).isEqualTo(bob.userId());
        assertThat(body(bobMe).path("userId").asText()).isNotEqualTo(alice.userId());

        // 导出：只含自己的 userId 与 username，不含对方的
        JsonNode aliceExport = body(mockMvc.perform(get("/api/v3/me/export").session(alice.session()))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getHeader("Content-Disposition"))
                        .contains("attachment"))
                .andReturn());
        assertThat(aliceExport.path("profile").path("userId").asText()).isEqualTo(alice.userId());
        assertThat(aliceExport.path("profile").path("username").asText()).isEqualTo(alice.username());
        String aliceExportRaw = aliceExport.toString();
        assertThat(aliceExportRaw).doesNotContain(bob.userId()).doesNotContain(bob.username());
        // 导出不含凭据材料（这是"导出"最容易出错的地方：把 hash 当数据一起给了用户）。
        //
        // 注意断言的是 profile **有哪些键**，而不是"正文里没有 passwordHash 这个词"：
        // payload 的 excluded 数组本来就该列出"哪些字段被排除了"（那是给用户的透明性说明），
        // 按字面断言会误伤这个正确设计。
        assertThat(aliceExport.path("profile").has("passwordHash")).isFalse();
        assertThat(aliceExport.path("profile").has("password_hash")).isFalse();
        assertThat(aliceExport.path("profile").has("recoveryCodeHash")).isFalse();
        assertThat(aliceExport.path("excluded").isArray()).isTrue();
        assertThat(aliceExport.path("attempts").isArray()).isTrue();
        assertThat(aliceExport.path("reports").isArray()).isTrue();
        assertThat(aliceExport.path("aiJobs").isArray()).isTrue();
    }

    @Test
    @DisplayName("请求体里的 userId/owner 一律被忽略：改昵称只作用于认证主体")
    void requestBodyCannotOverrideOwner() throws Exception {
        String password = "TestPassw0rd!";
        RegisteredAccount alice = register(uniqueUsername("owner_a"), password);
        RegisteredAccount bob = register(uniqueUsername("owner_b"), password);

        CsrfContext csrf = csrf(alice.session());
        // 恶意塞入 userId：DTO 里没有这个字段，必须被忽略（不报错也不生效）
        mockMvc.perform(withCsrf(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v3/me")
                        .session(alice.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("nickname", "试图改名", "userId", bob.userId()))), csrf))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(alice.userId()));

        // B 的资料没被改动
        MvcResult bobMe = mockMvc.perform(get("/api/v3/me").session(bob.session())).andExpect(status().isOk())
                .andReturn();
        assertThat(body(bobMe).path("nickname").isNull()).isTrue();
    }
}
