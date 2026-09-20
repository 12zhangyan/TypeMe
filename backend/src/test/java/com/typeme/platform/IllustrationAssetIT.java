package com.typeme.platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.account.TestAccounts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 公开插画地址（`illustration_asset` 表）的契约测试（H2 内存库 + 交付件 SQL 的种子数据）。
 *
 * <p><b>表从哪来</b>：`docs/2026-09-20/illustration-asset.sql` —— 那是**手工交付件**，
 * 生产上由人在服务器执行；这里在 H2 上执行同一份文件，所以 DDL/DML 只有一处事实来源，
 * 不会出现"SQL 改了、测试没跟上"。它**不是** Flyway 迁移（刻意不放在 db/migration 下），
 * 因此本类的 {@link BeforeEach} 要自己建表、自己播种。
 *
 * <p>钉住五件事：
 * <ol>
 *   <li><b>匿名可读</b>：首页是匿名页，首屏出图不能要求先登录；响应里只有公开插画地址；</li>
 *   <li><b>写入要 ADMIN</b>：未登录 401、非管理员 403、管理员 200 —— 三条边界分别断言；</li>
 *   <li><b>整批校验</b>：任何一条不合法就整批拒绝，绝不做"部分成功"（半成功会让页面一半新图一半旧图）；</li>
 *   <li><b>名字是安全边界</b>：只允许公开插画（5 个场景名 + 合法四字母类型码），
 *       报告/答卷/账号相关的名字必须被拒；</li>
 *   <li><b>没有 CSP 响应头</b>：`default-src 'self'` 会把发往对象存储的图片全部拦掉 ——
 *       页面看上去正常（回退本地素材），迁移却等于没做。见 {@link #noContentSecurityPolicyHeader()}。</li>
 * </ol>
 */
class IllustrationAssetIT extends AccountIntegrationTestBase {

    private static final String PATH = "/api/v3/platform/illustrations";
    private static final String HOST = "yan-public-1407914221.cos.ap-beijing.myqcloud.com";
    private static final String RELEASE = "2026-09-20";

    /** 交付件 SQL：服务器上手工执行的就是这一份；测试在 H2 上执行同一份。 */
    private static Path deliverySql() {
        Path fromModuleDir = Path.of("..", "docs", "2026-09-20", "illustration-asset.sql");
        return Files.exists(fromModuleDir)
                ? fromModuleDir
                : Path.of("docs", "2026-09-20", "illustration-asset.sql");
    }

    /**
     * 每个用例都从"交付件 SQL 刚执行完"的状态开始。
     *
     * <p>删行再执行是为了幂等：同一个类的多个用例共用一个 H2 库，
     * 而交付件里的 21 条 INSERT 是普通 INSERT（重复执行会主键冲突）。
     */
    @BeforeEach
    void seedFromDeliverySql() throws Exception {
        Path sql = deliverySql();
        assertThat(sql).as("缺少交付件 SQL：%s", sql.toAbsolutePath().normalize()).exists();
        if (tableExists()) {
            invitationJdbc.update("DELETE FROM illustration_asset");
        }
        try (var connection = invitationJdbc.getDataSource().getConnection()) {
            ScriptUtils.executeSqlScript(connection, new FileSystemResource(sql));
        }
    }

    private boolean tableExists() {
        Integer count = invitationJdbc.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE UPPER(TABLE_NAME) = 'ILLUSTRATION_ASSET'",
                Integer.class);
        return count != null && count > 0;
    }

    private TestAccounts testAccounts() {
        return new TestAccounts(mockMvc, objectMapper, userRepository, invitationJdbc);
    }

    /* ── 响应头：不能有 CSP ─────────────────────────────────────────────── */

    @Test
    @DisplayName("响应头里没有 Content-Security-Policy（它会把对象存储的图片全部拦掉）")
    void noContentSecurityPolicyHeader() throws Exception {
        // 这条断言是 2026-09-20 一次真实事故的回归测试：SecurityConfig 里写
        // `.contentSecurityPolicy(csp -> {})` 本意是"不加这条头"，Spring Security 6 却因此
        // 装上默认 writer 并发出 `default-src 'self'`，把发往 COS 的 20 条图片请求全部拦掉
        // （页面看着正常，因为回退到了本地素材）。
        mockMvc.perform(get(PATH))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist("Content-Security-Policy"))
                // 同时证明 headers 配置整体仍然生效 —— 否则"删掉整段 headers(...)"也能让上面那条通过。
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Referrer-Policy", "same-origin"))
                .andExpect(header().string("X-Frame-Options", "DENY"));
    }

    /* ── 读：公开 ───────────────────────────────────────────────────────── */

    @Test
    @DisplayName("匿名 GET /api/v3/platform/illustrations → 200，返回交付件 SQL 里种下的全部公开插画")
    void anonymousCanReadSeededIllustrations() throws Exception {
        MvcResult result = mockMvc.perform(get(PATH)).andExpect(status().isOk()).andReturn();
        JsonNode node = body(result);

        JsonNode assets = node.path("assets");
        assertThat(assets.isArray()).isTrue();
        // 发布版本 2026-09-20 的公开插画是 5 张场景图 + 16 张人物图。
        // 这个数字是"这批素材有多少张"的事实；加图时应当有意识地改它。
        assertThat(assets.size()).isEqualTo(21);
        assertThat(node.path("release").asText()).isEqualTo(RELEASE);
        assertThat(node.path("version").asText()).isNotBlank();

        List<String> names = new ArrayList<>();
        assets.forEach(asset -> names.add(asset.path("name").asText()));
        assertThat(names).contains("home-hero", "welcome", "type-intj", "type-enfp");
        assertThat(names).isSorted();

        for (JsonNode asset : assets) {
            assertThat(asset.path("name").asText()).matches("^[a-z0-9][a-z0-9-]*$");
            assertThat(asset.path("url").asText()).startsWith("https://" + HOST + "/illustrations/" + RELEASE + "/");
            assertThat(asset.path("sha256").asText()).matches("^[0-9a-f]{64}$");
            // 只回这三样：多一个字段就意味着将来可能带上不该公开的东西。
            List<String> fields = new ArrayList<>();
            asset.fieldNames().forEachRemaining(fields::add);
            assertThat(fields).containsExactlyInAnyOrder("name", "url", "sha256");
        }
    }

    /* ── 写：401 / 403 / 200 三条边界 ───────────────────────────────────── */

    @Test
    @DisplayName("未登录 PUT → 401；已登录普通用户 PUT → 403，两者都不改动任何一行")
    void writeRequiresAdmin() throws Exception {
        String before = firstUrl();

        MockHttpSession anonymous = new MockHttpSession();
        mockMvc.perform(withCsrf(put(PATH).session(anonymous)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("assets", List.of(item("home-hero", "https://" + HOST + "/x.webp"))))),
                csrf(anonymous)))
                .andExpect(status().isUnauthorized());

        String username = uniqueUsername("plain");
        register(username, "TestPassw0rd!");
        MockHttpSession userSession = new MockHttpSession();
        var userCsrf = csrf(userSession);
        login(userCsrf, userSession, username, "TestPassw0rd!", uniqueIp());

        MvcResult forbidden = mockMvc.perform(withCsrf(put(PATH).session(userSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("assets", List.of(item("home-hero", "https://" + HOST + "/x.webp"))))),
                userCsrf)).andReturn();
        assertThat(forbidden.getResponse().getStatus()).isEqualTo(403);
        assertThat(firstUrl()).isEqualTo(before);
    }

    @Test
    @DisplayName("ADMIN PUT → 200，改完立刻在读接口生效（不需要发版）")
    void adminCanChangeAddressAndItTakesEffectImmediately() throws Exception {
        String admin = uniqueUsername("admin");
        register(admin, "TestPassw0rd!");
        testAccounts().promoteToAdmin(admin);

        // 用新会话登录，让 ROLE_ADMIN 进入认证主体（注册时的主体是 ROLE_USER）。
        MockHttpSession session = new MockHttpSession();
        var csrf = csrf(session);
        login(csrf, session, admin, "TestPassw0rd!", uniqueIp());

        String newUrl = "https://" + HOST + "/illustrations/" + RELEASE + "/home-hero.aaaaaaaaaaaa.webp";
        String newHash = "a".repeat(64);
        MvcResult written = mockMvc.perform(withCsrf(put(PATH).session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("assets",
                                List.of(item("home-hero", newUrl, newHash, "V11-test"))))),
                csrf)).andExpect(status().isOk()).andReturn();

        assertThat(asset(written, "home-hero").path("url").asText()).isEqualTo(newUrl);

        // 另一个会话（匿名）读到的也是新地址：改的是库，不是某次响应。
        assertThat(firstUrl()).isEqualTo(newUrl);
        assertThat(asset(mockMvc.perform(get(PATH)).andReturn(), "home-hero").path("sha256").asText())
                .isEqualTo(newHash);
    }

    /* ── 校验：整批拒绝 ─────────────────────────────────────────────────── */

    @Test
    @DisplayName("非法输入一律 400 VALIDATION_FAILED，且**整批拒绝**（库里一行都没变）")
    void validationRejectsWholeBatch() throws Exception {
        MockHttpSession session = adminSession();
        String before = firstUrl();

        Map<String, Object> httpUrl = item("home-hero", "http://" + HOST + "/x.webp");
        Map<String, Object> foreignHost = item("home-hero", "https://example.com/x.webp");
        Map<String, Object> privateName = item("report-1a2b3c", "https://" + HOST + "/x.webp");
        Map<String, Object> badTypeCode = item("type-zzzz", "https://" + HOST + "/x.webp");
        Map<String, Object> badHash = item("home-hero", "https://" + HOST + "/x.webp", "not-a-hash", RELEASE);
        Map<String, Object> badRelease = item("home-hero", "https://" + HOST + "/x.webp", "a".repeat(64), "有中文");
        Map<String, Object> withUserInfo = item("home-hero", "https://u:p@" + HOST + "/x.webp");

        List<Map<String, Object>> batches = List.of(
                Map.of("assets", List.of(httpUrl)),
                Map.of("assets", List.of(foreignHost)),
                Map.of("assets", List.of(privateName)),
                Map.of("assets", List.of(badTypeCode)),
                Map.of("assets", List.of(badHash)),
                Map.of("assets", List.of(badRelease)),
                Map.of("assets", List.of(withUserInfo)),
                Map.of("assets", List.of()),
                Map.of("assets", List.of(item("home-hero", "https://" + HOST + "/x.webp"),
                        item("home-hero", "https://" + HOST + "/y.webp"))),
                Map.of("assets", List.of(item("home-hero", "https://" + HOST + "/x.webp"),
                        item("report-1a2b3c", "https://" + HOST + "/y.webp"))));

        for (Map<String, Object> request : batches) {
            MvcResult result = mockMvc.perform(withCsrf(put(PATH).session(session)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(request)), csrf(session))).andReturn();
            assertThat(result.getResponse().getStatus())
                    .as("请求体：%s", request)
                    .isEqualTo(400);
            JsonNode node = body(result);
            assertThat(node.path("code").asText()).isEqualTo("VALIDATION_FAILED");
            // 说明"哪一项、哪个字段"错了：否则调用方只能靠猜。
            assertThat(node.path("details").path("fields").isObject()).isTrue();
            assertThat(node.path("details").path("fields").size()).isGreaterThan(0);
        }

        // 最后一条尤其重要：整批里有一条非法 → 合法的那条也不能生效。
        assertThat(firstUrl()).isEqualTo(before);
    }

    /* ── 工具 ───────────────────────────────────────────────────────────── */

    /** 注册并提升一个 ADMIN，返回**已登录**的会话（角色在登录时才进主体）。 */
    private MockHttpSession adminSession() throws Exception {
        String admin = uniqueUsername("admin");
        register(admin, "TestPassw0rd!");
        testAccounts().promoteToAdmin(admin);
        MockHttpSession session = new MockHttpSession();
        var csrf = csrf(session);
        login(csrf, session, admin, "TestPassw0rd!", uniqueIp());
        return session;
    }

    private static Map<String, Object> item(String name, String url) {
        return item(name, url, "b".repeat(64), RELEASE);
    }

    private static Map<String, Object> item(String name, String url, String sha256, String release) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", name);
        item.put("url", url);
        item.put("sha256", sha256);
        item.put("release", release);
        return item;
    }

    private String firstUrl() throws Exception {
        return asset(mockMvc.perform(get(PATH)).andReturn(), "home-hero").path("url").asText();
    }

    private static JsonNode asset(MvcResult result, String name) throws Exception {
        JsonNode assets = new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8))
                .path("assets");
        for (JsonNode asset : assets) {
            if (name.equals(asset.path("name").asText())) {
                return asset;
            }
        }
        throw new AssertionError("响应里没有这张插画：" + name);
    }
}