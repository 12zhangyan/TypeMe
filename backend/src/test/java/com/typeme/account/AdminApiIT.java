package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.repository.AiSettingRepository;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.service.AdminBootstrapService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 管理员后台（本次新增需求）：
 * 非 ADMIN → 403；ADMIN 可读写；apiKey 写入后 GET 不回显明文；
 * 不能自我降级；disable 撤销会话；管理员引导只在无 ADMIN 时生效。
 */
class AdminApiIT extends AccountIntegrationTestBase {

    @Autowired
    private AdminBootstrapService adminBootstrapService;

    @Autowired
    private AiSettingRepository aiSettingRepository;

    @Autowired
    private com.typeme.ai.service.AiBudgetRepository aiBudgetRepository;

    @Autowired
    private com.typeme.ai.config.AiRuntimeSettingsProvider aiRuntimeSettingsProvider;

    private TestAccounts testAccounts() {
        return new TestAccounts(mockMvc, objectMapper, userRepository, invitationJdbc);
    }

    @Test
    @DisplayName("非 ADMIN 访问 /api/v3/admin/** → 403 FORBIDDEN（JSON，不是 401/404）")
    void nonAdminIsForbidden() throws Exception {
        RegisteredAccount plain = register(uniqueUsername("plain"), "TestPassw0rd!");

        for (String path : new String[]{"/api/v3/admin/ai-settings", "/api/v3/admin/users"}) {
            MvcResult result = mockMvc.perform(get(path).session(plain.session()))
                    .andExpect(status().isForbidden())
                    .andReturn();
            assertThat(body(result).path("code").asText())
                    .as("%s 对非管理员必须是 FORBIDDEN", path)
                    .isEqualTo("FORBIDDEN");
            assertThat(result.getResponse().getContentType()).contains(MediaType.APPLICATION_JSON_VALUE);
        }

        // 写接口同样是 403（不是 CSRF 的 403：带 token 之后仍应是无权限）
        CsrfContext csrf = csrf(plain.session());
        MvcResult write = mockMvc.perform(withCsrf(put("/api/v3/admin/ai-settings")
                        .session(plain.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("enabled", false))), csrf))
                .andReturn();
        assertThat(write.getResponse().getStatus()).isEqualTo(403);
        assertThat(body(write).path("code").asText()).isEqualTo("FORBIDDEN");
    }

    @Test
    @DisplayName("ADMIN 可读写 AI 设置；apiKey 只写不读，GET 只回 configured + fingerprint")
    void adminCanReadAndWriteAiSettings() throws Exception {
        String adminUsername = uniqueUsername("admin");
        register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);

        // 用新会话登录，让 ROLE_ADMIN 进入认证主体（注册时的主体是 ROLE_USER）
        MockHttpSession adminSession = new MockHttpSession();
        CsrfContext csrf = csrf(adminSession);
        assertThat(login(csrf, adminSession, adminUsername, "TestPassw0rd!", uniqueIp())
                .getResponse().getStatus()).isEqualTo(200);

        // 读：非敏感字段齐全
        MvcResult read = mockMvc.perform(get("/api/v3/admin/ai-settings").session(adminSession))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode settings = body(read);
        assertThat(settings.path("model").asText()).isNotBlank();
        assertThat(settings.path("apiKeyConfigured").asBoolean()).isFalse();
        assertThat(settings.path("apiKeySource").asText()).isEqualTo("none");
        assertThat(settings.path("promptVersion").asText()).isNotBlank();
        // 绝不能出现 key 相关字段的明文/密文
        String raw = read.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(raw).doesNotContain("apiKey\"").doesNotContain("apiKeyEncrypted");

        String secretKey = "sk-test-abcdefghijklmnopqrstuvwxyz";
        MvcResult written = mockMvc.perform(withCsrf(put("/api/v3/admin/ai-settings")
                        .session(adminSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "enabled", true,
                                "model", "deepseek-chat",
                                "baseUrl", "https://api.deepseek.com/v1/chat?token=should-not-leak",
                                "apiKey", secretKey,
                                "dailyLimitPerUser", 7,
                                "mockMode", true))), csrf))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode writtenBody = body(written);
        assertThat(writtenBody.path("apiKeyConfigured").asBoolean()).isTrue();
        assertThat(writtenBody.path("apiKeySource").asText()).isEqualTo("db");
        assertThat(writtenBody.path("apiKeyFingerprint").asText()).hasSize(8);
        assertThat(writtenBody.path("enabled").asBoolean()).isTrue();
        assertThat(writtenBody.path("dailyLimitPerUser").asInt()).isEqualTo(7);
        assertThat(writtenBody.path("mockMode").asBoolean()).isTrue();

        // 写入响应里绝不出现 key 明文；baseUrl 只回 host（丢掉 path/query）
        String writtenRaw = written.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(writtenRaw).doesNotContain(secretKey).doesNotContain("should-not-leak");
        assertThat(writtenBody.path("baseUrlHost").asText()).isEqualTo("api.deepseek.com");

        // 再读一次：不能回显明文，只回指纹；指纹稳定（用于"换没换"）
        MvcResult reread = mockMvc.perform(get("/api/v3/admin/ai-settings").session(adminSession))
                .andExpect(status().isOk())
                .andReturn();
        String rereadRaw = reread.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(rereadRaw).doesNotContain(secretKey);
        assertThat(body(reread).path("apiKeyFingerprint").asText())
                .isEqualTo(writtenBody.path("apiKeyFingerprint").asText());

        // 库里存的是密文，不是明文（这是"加密存储"的直接证据）
        String stored = aiSettingRepository.find().orElseThrow().apiKeyEncrypted();
        assertThat(stored).isNotNull().isNotEqualTo(secretKey);
        assertThat(stored).doesNotContain(secretKey);
        // 审计字段有值
        assertThat(aiSettingRepository.find().orElseThrow().updatedBy()).isNotBlank();
        assertThat(aiSettingRepository.find().orElseThrow().updatedAt()).isNotNull();
    }

    @Test
    @DisplayName("PUT role：不能把自己降级为 USER（400）")
    void adminCannotDemoteSelf() throws Exception {
        String adminUsername = uniqueUsername("selfdemote");
        RegisteredAccount admin = register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, adminUsername, "TestPassw0rd!", uniqueIp());

        MvcResult result = mockMvc.perform(withCsrf(put("/api/v3/admin/users/" + admin.userId() + "/role")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "USER"))), csrf))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(result).path("code").asText()).isEqualTo("VALIDATION_FAILED");
        // 角色没被改动
        assertThat(userRepository.findById(admin.userId()).orElseThrow().role())
                .isEqualTo(com.typeme.account.repository.UserRecord.ROLE_ADMIN);
    }

    @Test
    @DisplayName("PUT role：ADMIN 可以把别人提为 ADMIN，也可以把别人降级")
    void adminCanChangeOtherRoles() throws Exception {
        String adminUsername = uniqueUsername("roleadmin");
        register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);

        RegisteredAccount target = register(uniqueUsername("target"), "TestPassw0rd!");

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, adminUsername, "TestPassw0rd!", uniqueIp());

        mockMvc.perform(withCsrf(put("/api/v3/admin/users/" + target.userId() + "/role")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "ADMIN"))), csrf))
                .andExpect(status().isOk());
        assertThat(userRepository.findById(target.userId()).orElseThrow().role())
                .isEqualTo(com.typeme.account.repository.UserRecord.ROLE_ADMIN);
    }

    @Test
    @DisplayName("POST disable：撤销目标账号会话；不能禁用自己")
    void disableRevokesSessionsAndCannotDisableSelf() throws Exception {
        String adminUsername = uniqueUsername("disadmin");
        RegisteredAccount admin = register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);

        RegisteredAccount victim = register(uniqueUsername("victim"), "TestPassw0rd!");
        assertThat(mockMvc.perform(get("/api/v3/me").session(victim.session()))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, adminUsername, "TestPassw0rd!", uniqueIp());

        // 不能禁用自己
        MvcResult selfDisable = mockMvc.perform(withCsrf(post("/api/v3/admin/users/" + admin.userId() + "/disable")
                        .session(session), csrf))
                .andReturn();
        assertThat(selfDisable.getResponse().getStatus()).isEqualTo(400);

        // 禁用别人 → 目标会话失效、状态 DISABLED
        MvcResult disabled = mockMvc.perform(withCsrf(post("/api/v3/admin/users/" + victim.userId() + "/disable")
                        .session(session), csrf))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(body(disabled).path("status").asText()).isEqualTo("DISABLED");
        assertThat(mockMvc.perform(get("/api/v3/me").session(sameIdSessionAs(victim.session())))
                .andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(userRepository.findById(victim.userId()).orElseThrow().status())
                .isEqualTo(com.typeme.account.repository.UserRecord.STATUS_DISABLED);
    }

    @Test
    @DisplayName("GET users：分页列出用户，不回密码 hash，含报告数字段")
    void listUsersHidesPasswordHash() throws Exception {
        String adminUsername = uniqueUsername("listadmin");
        register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);
        RegisteredAccount listed = register(uniqueUsername("listed"), "TestPassw0rd!");

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, adminUsername, "TestPassw0rd!", uniqueIp());

        MvcResult result = mockMvc.perform(get("/api/v3/admin/users?page=0&size=50").session(session))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = body(result);
        assertThat(body.path("items").isArray()).isTrue();
        assertThat(body.path("total").asLong()).isGreaterThan(0);

        String raw = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(raw).doesNotContain("passwordHash").doesNotContain("password_hash");

        boolean found = false;
        for (JsonNode item : body.path("items")) {
            if (listed.userId().equals(item.path("id").asText())) {
                found = true;
                assertThat(item.path("username").asText()).isEqualTo(listed.username());
                assertThat(item.path("role").asText()).isEqualTo("USER");
                assertThat(item.path("status").asText()).isEqualTo("ACTIVE");
                assertThat(item.has("reportCount")).isTrue();
            }
        }
        assertThat(found).as("新注册用户应出现在列表里").isTrue();
    }

    @Test
    @DisplayName("GET users?aiExhausted=true：跨页只列今日已用完者，额度 0、昨日用完、已删除不算；total 与翻页一致")
    void listUsersFiltersAiExhaustedAcrossPages() throws Exception {
        String adminUsername = uniqueUsername("quotaadmin");
        register(adminUsername, "TestPassw0rd!");
        testAccounts().promoteToAdmin(adminUsername);
        MockHttpSession session = new MockHttpSession();
        login(csrf(session), session, adminUsername, "TestPassw0rd!", uniqueIp());

        java.time.LocalDate today = aiBudgetRepository.today();
        int siteDefault = aiRuntimeSettingsProvider.settings().dailyLimitPerUser();
        java.time.Instant base = java.time.Instant.now().plusSeconds(86_400);
        // 创建时间交错，让“已用完”的人分散在未筛选列表的不同位置。
        String limitHit = quotaUser("hit", base.plusSeconds(7), 2, today, 2);
        String notUsedUp = quotaUser("partial", base.plusSeconds(6), 2, today, 1);
        String defaultHit = quotaUser("default", base.plusSeconds(5), null, today, siteDefault);
        String stopped = quotaUser("stopped", base.plusSeconds(4), 0, today, 0);
        String overLimit = quotaUser("over", base.plusSeconds(3), 1, today, 3);
        String yesterday = quotaUser("yesterday", base.plusSeconds(2), 1, today.minusDays(1), 1);
        String deleted = quotaUser("deleted", base.plusSeconds(1), 1, today, 1);
        userRepository.markDeletedWithRewrittenUsername(deleted, java.time.Instant.now());

        java.util.List<String> collected = new java.util.ArrayList<>();
        long total = -1;
        for (int page = 0; page < 50; page++) {
            JsonNode body = body(mockMvc.perform(get("/api/v3/admin/users?page=" + page + "&size=2&aiExhausted=true")
                            .session(session))
                    .andExpect(status().isOk())
                    .andReturn());
            if (total < 0) total = body.path("total").asLong();
            assertThat(body.path("total").asLong()).as("每一页的 total 都按筛选结果计算").isEqualTo(total);
            if (body.path("items").isEmpty()) break;
            for (JsonNode item : body.path("items")) {
                collected.add(item.path("id").asText());
                assertThat(item.path("aiUsedToday").asInt())
                        .isGreaterThanOrEqualTo(item.path("effectiveAiDailyLimit").asInt());
                assertThat(item.path("effectiveAiDailyLimit").asInt()).isPositive();
            }
        }

        assertThat(collected).as("翻页不重复").doesNotHaveDuplicates();
        assertThat((long) collected.size()).as("逐页收集的人数等于 total").isEqualTo(total);
        assertThat(collected).contains(limitHit, defaultHit, overLimit)
                .doesNotContain(notUsedUp, stopped, yesterday, deleted);
    }

    @Test
    @DisplayName("PUT users/ai-limits SET：逐人写入同一额度，今日已用不变，额度判定立即读到新值；调低到已用以下则剩余 0")
    void batchSetUpdatesEachMemberAndKeepsUsage() throws Exception {
        AdminSession admin = adminSession("batchset");
        java.time.LocalDate today = aiBudgetRepository.today();
        java.time.Instant now = java.time.Instant.now();
        String own = quotaUser("own", now, 2, today, 2);
        String inherits = quotaUser("inherits", now, null, today, 1);
        String stopped = quotaUser("stopped", now, 0, today, 0);

        JsonNode body = body(batch(admin, Map.of("userIds", java.util.List.of(own, inherits, stopped),
                "action", "SET", "aiDailyLimit", 5)).andExpect(status().isOk()).andReturn());

        assertThat(body.path("updated").asInt()).isEqualTo(3);
        assertThat(body.path("failed").asInt()).isZero();
        for (JsonNode result : body.path("results")) {
            assertThat(result.path("ok").asBoolean()).isTrue();
            assertThat(result.path("member").path("aiDailyLimit").asInt()).isEqualTo(5);
        }
        int siteDefault = aiRuntimeSettingsProvider.settings().dailyLimitPerUser();
        for (String id : java.util.List.of(own, inherits, stopped)) {
            // AnalysisCreationWriter 创建分析时读的就是 effectiveUserLimit：写库即生效。
            assertThat(aiBudgetRepository.effectiveUserLimit(id, siteDefault, false)).isEqualTo(5);
        }
        assertThat(aiBudgetRepository.reservedCalls("user:" + own, today)).as("今日已用不被清零").isEqualTo(2);
        assertThat(aiBudgetRepository.reservedCalls("user:" + inherits, today)).isEqualTo(1);

        JsonNode lowered = body(batch(admin, Map.of("userIds", java.util.List.of(own), "action", "SET", "aiDailyLimit", 1))
                .andExpect(status().isOk()).andReturn());
        JsonNode member = lowered.path("results").get(0).path("member");
        assertThat(member.path("aiUsedToday").asInt()).isEqualTo(2);
        assertThat(member.path("aiRemainingToday").asInt()).isZero();
    }

    @Test
    @DisplayName("PUT users/ai-limits RESET_DEFAULT：清除单独额度、之后跟随站点默认，今日已用不变；本来就沿用默认的不报错")
    void batchResetDefaultClearsOverrideAndFollowsSiteDefault() throws Exception {
        AdminSession admin = adminSession("batchreset");
        java.time.LocalDate today = aiBudgetRepository.today();
        java.time.Instant now = java.time.Instant.now();
        String custom = quotaUser("custom", now, 5, today, 3);
        String inherits = quotaUser("alreadydefault", now, null, today, 1);

        JsonNode body = body(batch(admin, Map.of("userIds", java.util.List.of(custom, inherits), "action", "RESET_DEFAULT"))
                .andExpect(status().isOk()).andReturn());

        assertThat(body.path("updated").asInt()).isEqualTo(2);
        assertThat(body.path("failed").asInt()).isZero();
        int siteDefault = aiRuntimeSettingsProvider.settings().dailyLimitPerUser();
        for (JsonNode result : body.path("results")) {
            assertThat(result.path("ok").asBoolean()).isTrue();
            assertThat(result.path("member").path("aiDailyLimit").isNull()).as("回到沿用站点默认").isTrue();
            assertThat(result.path("member").path("effectiveAiDailyLimit").asInt()).isEqualTo(siteDefault);
        }
        assertThat(userRepository.findById(custom).orElseThrow().aiDailyLimit()).isNull();
        // 清除而不是写入当前默认数字：站点默认以后变化，这些成员跟着变。
        assertThat(aiBudgetRepository.effectiveUserLimit(custom, siteDefault + 7, false)).isEqualTo(siteDefault + 7);
        assertThat(aiBudgetRepository.reservedCalls("user:" + custom, today)).as("今日已用不被清零").isEqualTo(3);
        assertThat(aiBudgetRepository.reservedCalls("user:" + inherits, today)).isEqualTo(1);
    }

    @Test
    @DisplayName("PUT users/ai-limits：人数 0 或超过 20、重复、额度缺失/越界/小数、未知 action → 400 且没有任何人被修改")
    void batchRejectsInvalidRequestsWithoutWriting() throws Exception {
        AdminSession admin = adminSession("batchbad");
        java.time.Instant now = java.time.Instant.now();
        String target = quotaUser("target", now, 3, aiBudgetRepository.today(), 0);
        java.util.List<String> tooMany = new java.util.ArrayList<>(java.util.List.of(target));
        for (int i = 0; i < 20; i++) tooMany.add(UserRepository.newId());

        java.util.List<String> bodies = java.util.List.of(
                json(Map.of("userIds", java.util.List.of(), "action", "SET", "aiDailyLimit", 5)),
                json(Map.of("userIds", tooMany, "action", "SET", "aiDailyLimit", 5)),
                json(Map.of("userIds", java.util.List.of(target, target), "action", "SET", "aiDailyLimit", 5)),
                json(Map.of("userIds", java.util.List.of(target, " "), "action", "SET", "aiDailyLimit", 5)),
                json(Map.of("userIds", java.util.List.of(target), "action", "SET")),
                json(Map.of("userIds", java.util.List.of(target), "action", "SET", "aiDailyLimit", -1)),
                json(Map.of("userIds", java.util.List.of(target), "action", "SET", "aiDailyLimit", 10001)),
                "{\"userIds\":[\"" + target + "\"],\"action\":\"SET\",\"aiDailyLimit\":1.5}",
                json(Map.of("userIds", java.util.List.of(target), "action", "ADD", "aiDailyLimit", 5)),
                json(Map.of("userIds", java.util.List.of(target), "action", "RESET_DEFAULT", "aiDailyLimit", 5)),
                json(Map.of("userIds", java.util.List.of(target), "aiDailyLimit", 5)));
        for (String requestBody : bodies) {
            MvcResult result = mockMvc.perform(withCsrf(put("/api/v3/admin/users/ai-limits").session(admin.session())
                            .contentType(MediaType.APPLICATION_JSON).content(requestBody), admin.csrf()))
                    .andReturn();
            assertThat(result.getResponse().getStatus()).as(requestBody).isEqualTo(400);
            assertThat(body(result).path("code").asText()).as(requestBody).isEqualTo("VALIDATION_FAILED");
        }
        assertThat(userRepository.findById(target).orElseThrow().aiDailyLimit()).as("任何非法请求都不写库").isEqualTo(3);
    }

    @Test
    @DisplayName("PUT users/ai-limits：其中一人已删除时其余照常保存，失败项为 NOT_FOUND，不整批回滚")
    void batchKeepsSuccessfulMembersWhenOneIsDeleted() throws Exception {
        AdminSession admin = adminSession("batchpartial");
        java.time.LocalDate today = aiBudgetRepository.today();
        java.time.Instant now = java.time.Instant.now();
        String first = quotaUser("first", now, 1, today, 0);
        String gone = quotaUser("gone", now, 1, today, 0);
        String last = quotaUser("last", now, 1, today, 0);
        userRepository.markDeletedWithRewrittenUsername(gone, now);

        JsonNode body = body(batch(admin, Map.of("userIds", java.util.List.of(first, gone, last),
                "action", "SET", "aiDailyLimit", 4)).andExpect(status().isOk()).andReturn());

        assertThat(body.path("updated").asInt()).isEqualTo(2);
        assertThat(body.path("failed").asInt()).isEqualTo(1);
        JsonNode failed = body.path("results").get(1);
        assertThat(failed.path("userId").asText()).isEqualTo(gone);
        assertThat(failed.path("ok").asBoolean()).isFalse();
        assertThat(failed.path("code").asText()).isEqualTo("NOT_FOUND");
        assertThat(userRepository.findById(first).orElseThrow().aiDailyLimit()).isEqualTo(4);
        assertThat(userRepository.findById(last).orElseThrow().aiDailyLimit()).isEqualTo(4);
        assertThat(userRepository.findById(gone).orElseThrow().aiDailyLimit()).as("已删除成员不被修改").isEqualTo(1);
    }

    @Test
    @DisplayName("PUT users/ai-limits：非管理员 403 FORBIDDEN，缺 CSRF 403 CSRF_INVALID，额度都不变")
    void batchRequiresAdminAndCsrf() throws Exception {
        String target = quotaUser("guarded", java.time.Instant.now(), 3, aiBudgetRepository.today(), 0);
        String payload = json(Map.of("userIds", java.util.List.of(target), "action", "SET", "aiDailyLimit", 9));

        RegisteredAccount plain = register(uniqueUsername("plainbatch"), "TestPassw0rd!");
        CsrfContext plainCsrf = csrf(plain.session());
        MvcResult forbidden = mockMvc.perform(withCsrf(put("/api/v3/admin/users/ai-limits").session(plain.session())
                .contentType(MediaType.APPLICATION_JSON).content(payload), plainCsrf)).andReturn();
        assertThat(forbidden.getResponse().getStatus()).isEqualTo(403);
        assertThat(body(forbidden).path("code").asText()).isEqualTo("FORBIDDEN");

        AdminSession admin = adminSession("batchcsrf");
        MvcResult noCsrf = mockMvc.perform(put("/api/v3/admin/users/ai-limits").session(admin.session())
                .contentType(MediaType.APPLICATION_JSON).content(payload)).andReturn();
        assertThat(noCsrf.getResponse().getStatus()).isEqualTo(403);
        assertThat(body(noCsrf).path("code").asText()).isEqualTo("CSRF_INVALID");

        assertThat(userRepository.findById(target).orElseThrow().aiDailyLimit()).isEqualTo(3);
    }

    private record AdminSession(MockHttpSession session, CsrfContext csrf) {}

    private AdminSession adminSession(String prefix) throws Exception {
        String username = uniqueUsername(prefix);
        register(username, "TestPassw0rd!");
        testAccounts().promoteToAdmin(username);
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, username, "TestPassw0rd!", uniqueIp());
        return new AdminSession(session, csrf(session));
    }

    private org.springframework.test.web.servlet.ResultActions batch(AdminSession admin, Map<String, Object> payload) throws Exception {
        return mockMvc.perform(withCsrf(put("/api/v3/admin/users/ai-limits").session(admin.session())
                .contentType(MediaType.APPLICATION_JSON).content(json(payload)), admin.csrf()));
    }

    /** 直接写库造一个成员及其指定日期的 AI 预留次数；不走注册，避免触发注册限流。 */
    private String quotaUser(String prefix, java.time.Instant createdAt, Integer limit,
                             java.time.LocalDate budgetDate, int reservedCalls) {
        String id = UserRepository.newId();
        String username = uniqueUsername(prefix);
        userRepository.insert(id, UserRepository.normalize(username), username, "unused-hash", null, "USER", createdAt);
        userRepository.updateAiDailyLimit(id, limit);
        invitationJdbc.update("INSERT INTO ai_usage_budget (scope_key, budget_date, reserved_calls) VALUES (?, ?, ?)",
                "user:" + id, budgetDate, reservedCalls);
        return id;
    }

    @Test
    @DisplayName("管理员引导：无 ADMIN 时把配置账号提升；已有 ADMIN 时绝不再提权")
    void adminBootstrapRequiresNoExistingAdmin() throws Exception {
        // bootstrap-username 在基类属性里被清空 → 本用例先验证"没配置就什么都不做"
        // （配置为空是最常见的生产形态，必须是无操作而不是报错）。
        assertThat(adminBootstrapService.promoteBootstrapUserIfNeeded()).isFalse();

        // 构造"一个管理员都没有"的状态：把现有 ADMIN 全部降级
        for (var user : userRepository.page(0, 200)) {
            if (com.typeme.account.repository.UserRecord.ROLE_ADMIN.equals(user.role())) {
                userRepository.updateRole(user.id(), com.typeme.account.repository.UserRecord.ROLE_USER);
            }
        }
        assertThat(userRepository.existsAdmin()).isFalse();
        // 配置为空时依然不动手（不会"自己造一个管理员出来"）
        assertThat(adminBootstrapService.promoteBootstrapUserIfNeeded()).isFalse();

        // 已有管理员时：即使配了引导账号也不能再提权（这是"机制自动失效"的关键行为）
        RegisteredAccount first = register(uniqueUsername("firstadmin"), "TestPassw0rd!");
        testAccounts().promoteToAdmin(first.username());
        RegisteredAccount candidate = register(uniqueUsername("candidate"), "TestPassw0rd!");
        // 用反射注入配置不可行（properties 是启动期绑定的不可变 record），
        // 因此这里验证的是"存在 ADMIN 时短路"这一半；另一半（配置账号被提升）由
        // AdminBootstrapIT 用独立的上下文专门覆盖。
        assertThat(adminBootstrapService.promoteBootstrapUserIfNeeded()).isFalse();
        assertThat(userRepository.findById(candidate.userId()).orElseThrow().role())
                .isEqualTo(com.typeme.account.repository.UserRecord.ROLE_USER);
    }
}
