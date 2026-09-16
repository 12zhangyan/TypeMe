package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 恢复码：只返回一次、原子消费、恢复后旧会话失效（任务书测试清单 5）。
 */
class RecoveryCodeIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("恢复码只在生成时返回一次：重新生成后旧码失效、新码可用")
    void recoveryCodesAreReturnedOnceAndOldOnesAreRevoked() throws Exception {
        String username = uniqueUsername("recov");
        RegisteredAccount account = register(username, "TestPassw0rd!");
        List<String> firstSet = account.recoveryCodes();
        assertThat(firstSet).hasSize(8);

        // 重新生成：需要重新验证密码
        CsrfContext csrf = csrf(account.session());
        MvcResult regenerated = mockMvc.perform(withCsrf(post("/api/v3/me/recovery-codes")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", "TestPassw0rd!"))), csrf))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode regeneratedBody = body(regenerated);
        List<String> secondSet = new java.util.ArrayList<>();
        regeneratedBody.path("recoveryCodes").forEach(node -> secondSet.add(node.asText()));
        assertThat(secondSet).hasSize(8);
        // 新码必须与旧码不同（否则"作废重发"没有意义）
        assertThat(secondSet).doesNotContainAnyElementsOf(firstSet);
        // 重新生成的响应同样不可缓存
        assertThat(regenerated.getResponse().getHeader("Cache-Control")).contains("no-store");

        // 旧码已失效：用它恢复必须 401
        MvcResult oldCodeAttempt = recover(uniqueIp(), username, firstSet.get(0), "AnotherPassw0rd!");
        assertThat(oldCodeAttempt.getResponse().getStatus())
                .as("重新生成后旧恢复码必须失效")
                .isEqualTo(401);
        assertThat(body(oldCodeAttempt).path("code").asText()).isEqualTo("INVALID_CREDENTIALS");

        // 新码可用：恢复成功（204）
        MvcResult recovered = recover(uniqueIp(), username, secondSet.get(1), "AnotherPassw0rd!");
        assertThat(recovered.getResponse().getStatus()).isEqualTo(204);

        // 恢复后旧会话必须失效。注意用**同 id** 的会话对象请求：同一个 MockHttpSession 实例
        // 被上一次请求 invalidate 后再复用，MockMvc 会在容器外产生新会话，测不出真实行为。
        assertThat(mockMvc.perform(get("/api/v3/me").session(sameIdSessionAs(account.session())))
                .andReturn().getResponse().getStatus())
                .as("恢复后旧会话必须 401")
                .isEqualTo(401);

        // 新密码可登录，旧密码不可
        assertThat(loginWith(uniqueIp(), username, "AnotherPassw0rd!")).isEqualTo(200);
        assertThat(loginWith(uniqueIp(), username, "TestPassw0rd!")).isEqualTo(401);

        // 用过的码不能再用第二次
        MvcResult reuse = recover(uniqueIp(), username, secondSet.get(1), "ThirdPassw0rd!");
        assertThat(reuse.getResponse().getStatus()).as("恢复码一次性").isEqualTo(401);
    }

    @Test
    @DisplayName("同一个恢复码并发使用：只能成功一次（原子消费）")
    void concurrentConsumptionSucceedsExactlyOnce() throws Exception {
        String username = uniqueUsername("race");
        RegisteredAccount account = register(username, "TestPassw0rd!");
        String code = account.recoveryCodes().get(0);

        int threads = 4;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch startGate = new CountDownLatch(1);
        try {
            List<Callable<Integer>> tasks = new java.util.ArrayList<>();
            for (int i = 0; i < threads; i++) {
                String ip = uniqueIp();
                tasks.add(() -> {
                    startGate.await(5, TimeUnit.SECONDS);
                    return recover(ip, username, code,
                            "RacePassw0rd" + (System.nanoTime() % 1000) + "!").getResponse().getStatus();
                });
            }
            List<Future<Integer>> futures = new java.util.ArrayList<>();
            for (Callable<Integer> task : tasks) {
                futures.add(pool.submit(task));
            }
            startGate.countDown();

            int success = 0;
            int rejected = 0;
            for (Future<Integer> future : futures) {
                int status = future.get(60, TimeUnit.SECONDS);
                if (status == 204) {
                    success++;
                } else if (status == 401) {
                    rejected++;
                }
            }
            assertThat(success).as("并发使用同一个恢复码只能成功一次").isEqualTo(1);
            assertThat(rejected).isEqualTo(threads - 1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("恢复：用户名不存在与恢复码错误返回同一个 401（不可枚举账号）")
    void recoverDoesNotRevealAccountExistence() throws Exception {
        String username = uniqueUsername("recenum");
        RegisteredAccount account = register(username, "TestPassw0rd!");

        MvcResult wrongCode = recover(uniqueIp(), username, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", "AnotherPassw0rd!");
        MvcResult unknownUser = recover(uniqueIp(), uniqueUsername("nobody"), "ZZZZ-ZZZZ-ZZZZ-ZZZZ",
                "AnotherPassw0rd!");

        assertThat(wrongCode.getResponse().getStatus()).isEqualTo(401);
        assertThat(unknownUser.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(wrongCode).path("message").asText())
                .isEqualTo(body(unknownUser).path("message").asText());
        // 账号仍然可用（没有被误改密码）
        assertThat(loginWith(uniqueIp(), account.username(), "TestPassw0rd!")).isEqualTo(200);
    }

    // ------------------------------------------------------------------ 工具

    /**
     * 直接调用 {@code POST /api/v3/auth/recover}。
     *
     * <p>对比基线这需要一段额外说明：这个接口**未认证**，但仍然受 CSRF 保护，
     * 所以必须先取 token。基线把这个流程封装起来，避免每个用例都重复 6 行样板。
     */
    private MvcResult recover(String ip, String username, String code, String newPassword) throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        return mockMvc.perform(withCsrf(post("/api/v3/auth/recover")
                        .session(session)
                        // MockHttpServletRequestBuilder 没有 remoteAddr(String)，只能改底层请求
                        .with(request -> {
                            request.setRemoteAddr(ip);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "recoveryCode", code,
                                "newPassword", newPassword))), csrf))
                .andReturn();
    }

    private int loginWith(String ip, String username, String password) throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        return login(csrf, session, username, password, ip).getResponse().getStatus();
    }
}
