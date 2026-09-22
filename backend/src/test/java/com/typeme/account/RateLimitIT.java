package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 限流（任务书测试清单 7 / 契约 §5.4）。
 *
 * <p>本类用**严格**的限流配置独立起一份上下文（登录 IP 上限 3）：限流要能被测到，
 * 就必须有一个足够小的阈值，否则用例要么跑上千次请求、要么永远测不到 429。
 * 阈值通过 {@code @SpringBootTest(properties=...)} 覆盖，与功能测试的宽松配置互不影响。
 *
 * <p>同时这条用例真正验证了"限流计数落库"：{@code rate_limit_bucket} 的 upsert 路径
 * 在 H2（MODE=MySQL）上必须能跑通 —— 这正是任务书要求用 H2 单测钉住的兼容性点。
 *
 * <p>独立库由基类上的 {@code @AccountTestDatabase} 自动提供：限流计数是**累加型**状态，
 * 与其它账号测试共用库时，别的用例已经消耗掉的份额会让本类的阈值断言失真。
 */
class RateLimitIT extends AccountIntegrationTestBase {

    @DynamicPropertySource
    static void strictRateLimit(DynamicPropertyRegistry registry) {
        registry.add("typeme.ratelimit.login.ip-limit", () -> "3");
        registry.add("typeme.ratelimit.login.user-limit", () -> "3");
        registry.add("typeme.ratelimit.login.window", () -> "5m");
        registry.add("typeme.ratelimit.register.ip-limit", () -> "100");
        registry.add("typeme.ratelimit.recover.ip-limit", () -> "100");
        // 匿名目录也压到很小：这样下面那条用例才不用发几百个请求就能测到 429。
        // 其余用例根本不读匿名目录，改小不影响它们。
        registry.add("typeme.ratelimit.catalog.ip-limit", () -> "2");
        registry.add("typeme.ratelimit.catalog.window", () -> "5m");
    }

    @Test
    @DisplayName("连续失败登录超过上限 → 429 RATE_LIMITED，且 details.retryAfterSeconds 存在")
    void repeatedFailedLoginsAreRateLimited() throws Exception {
        String username = uniqueUsername("ratelimit");
        register(username, "TestPassw0rd!");

        // 每次用同一个来源 IP：限流要按 ip 维度命中
        String ip = "10.77.77.1";

        // 阈值 3：前三次是 401（凭据错误），第四次起是 429
        for (int attempt = 1; attempt <= 3; attempt++) {
            MockHttpSession session = new MockHttpSession();
            CsrfContext csrf = csrf(session);
            MvcResult result = login(csrf, session, username, "WrongPassw0rd!", ip);
            assertThat(result.getResponse().getStatus())
                    .as("第 %d 次失败登录应为 401", attempt)
                    .isEqualTo(401);
        }

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult limited = login(csrf, session, username, "WrongPassw0rd!", ip);

        assertThat(limited.getResponse().getStatus()).isEqualTo(429);
        JsonNode body = body(limited);
        assertThat(body.path("code").asText()).isEqualTo("RATE_LIMITED");
        // 前端要靠这个字段显示"请 N 秒后再试"，缺失就等于让用户盲试
        assertThat(body.path("details").path("retryAfterSeconds").asInt()).isGreaterThan(0);
        assertThat(limited.getResponse().getHeader("Retry-After")).isNull();
    }

    @Test
    @DisplayName("正常密码在限流窗口内也会被拦：限流按尝试次数而不是按失败次数")
    void rateLimitCountsAllAttemptsWithinWindow() throws Exception {
        String username = uniqueUsername("ratelimit2");
        String password = "TestPassw0rd!";
        register(username, password);

        String ip = "10.77.77.2";
        // 前三次：错密码 → 401，把窗口耗尽
        for (int attempt = 0; attempt < 3; attempt++) {
            MockHttpSession session = new MockHttpSession();
            CsrfContext csrf = csrf(session);
            login(csrf, session, username, "WrongPassw0rd!", ip);
        }
        // 第四次即使用对密码也被拦：这恰恰是限流应有的行为（否则爆破者只要"偶尔猜对"就能绕过）
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = login(csrf, session, username, password, ip);
        assertThat(result.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(result).path("code").asText()).isEqualTo("RATE_LIMITED");
    }

    @Test
    @DisplayName("不同来源 IP 各自计数，不互相误伤")
    void differentIpsHaveIndependentBuckets() throws Exception {
        // 每次换用户名：本用例要证明的是"IP 维度互不影响"，
        // 若复用同一个用户名，最后一次会撞上**用户名维度**的额度（同一账号累计 4 次 > 阈值 3），
        // 那样失败信息会把"用户名限流"误读成"IP 限流串了"。
        for (int attempt = 0; attempt < 3; attempt++) {
            String username = uniqueUsername("ratelimit3");
            register(username, "TestPassw0rd!");
            MockHttpSession session = new MockHttpSession();
            CsrfContext csrf = csrf(session);
            login(csrf, session, username, "WrongPassw0rd!", "10.77.77.3");
        }

        // 换一个 IP + 换一个用户名：应当只是 401（未被上一个 IP 的计数影响）
        String freshUsername = uniqueUsername("ratelimit3b");
        register(freshUsername, "TestPassw0rd!");
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = login(csrf, session, freshUsername, "WrongPassw0rd!", "10.77.77.4");
        assertThat(result.getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    @DisplayName("限流响应同样是契约 §7.1 的形状（含 requestId）")
    void rateLimitedResponseShape() throws Exception {
        String username = uniqueUsername("ratelimit4");
        register(username, "TestPassw0rd!");
        String ip = "10.77.77.5";
        for (int attempt = 0; attempt < 3; attempt++) {
            MockHttpSession session = new MockHttpSession();
            CsrfContext csrf = csrf(session);
            login(csrf, session, username, "WrongPassw0rd!", ip);
        }
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = login(csrf, session, username, "WrongPassw0rd!", ip);
        JsonNode body = body(result);
        assertThat(body.path("requestId").asText()).isNotBlank();
        assertThat(body.path("message").asText()).isNotBlank();
        assertThat(result.getResponse().getContentType()).contains(MediaType.APPLICATION_JSON_VALUE);
    }

    /* ── 匿名目录：放开访问边界后的配套限流（A58，2026-09-21） ─────────────── */

    /**
     * 同一个 IP 发起的匿名目录请求超过上限 → 429。
     *
     * <p>这是"把 `/api/v3/**` 里切出公开路径"这件事的代价测试：只放开访问而不管限流，
     * 等于把整份题库（`/catalog/current/package`）变成可无限拉取的资源。
     */
    @Test
    @DisplayName("匿名目录 GET 超过 IP 上限 → 429 RATE_LIMITED（放开访问边界的配套代价）")
    void anonymousCatalogReadsAreRateLimited() throws Exception {
        String ip = "10.88.88.1";
        for (int i = 0; i < 2; i++) {
            MvcResult ok = mockMvc.perform(get("/api/v3/catalog/current")
                            .with(request -> {
                                request.setRemoteAddr(ip);
                                return request;
                            }))
                    .andReturn();
            assertThat(ok.getResponse().getStatus())
                    .as("第 %d 次匿名读目录应在阈值内（200）", i + 1)
                    .isEqualTo(200);
        }

        MvcResult limited = mockMvc.perform(get("/api/v3/catalog/current")
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        }))
                .andReturn();
        assertThat(limited.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(limited).path("code").asText()).isEqualTo("RATE_LIMITED");
        // 前端靠这个字段显示"请 N 秒后再试"；限流响应没有它等于让用户盲试。
        assertThat(body(limited).path("details").path("retryAfterSeconds").asInt()).isGreaterThan(0);
    }

    /**
     * 已登录用户读目录**不计入匿名桶**。
     *
     * <p>为什么要有这条：公共壳每次整页加载都会读一次目录。如果已登录用户也算，
     * 正常浏览（比如在报告页之间来回走）会把自己挡在 429 上，而这是普遍操作，不是滥用。
     * 反过来，若把这条限流写成"所有请求都计数"，本用例会红 —— 这就是它的分辨力。
     */
    @Test
    @DisplayName("已登录用户连续读目录不会被匿名限流误伤")
    void authenticatedCatalogReadsAreNotInAnonymousBucket() throws Exception {
        RegisteredAccount account = register(uniqueUsername("catalogauth"), "TestPassw0rd!");

        for (int i = 0; i < 4; i++) {
            MvcResult result = mockMvc.perform(get("/api/v3/catalog/current").session(account.session()))
                    .andReturn();
            assertThat(result.getResponse().getStatus())
                    .as("第 %d 次已登录读目录应为 200（阈值 2 已远超）", i + 1)
                    .isEqualTo(200);
        }
    }
}
