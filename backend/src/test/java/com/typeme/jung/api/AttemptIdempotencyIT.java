package com.typeme.jung.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.jung.service.IdempotencyGuard;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * `POST /api/v3/attempts` 的幂等语义（契约 02 §6.1、A35）。
 *
 * <p><b>为什么单开这个类</b>：`api_idempotency` 这张表在 2026-09-18 复核时被发现
 * <b>从建表起只被 DELETE 过、从未写入</b> —— 契约里"`POST /attempts` 支持可选
 * `Idempotency-Key`"这句话在实现里是空的。表现是：建测评的请求一旦超时/断网，
 * 用户点一次"重试"就多一份草稿，而草稿**在当时的界面里没有任何入口**
 * （`GET /attempts?status=draft` 存在但没有前端消费者），于是那份额外的草稿
 * 对用户是完全不可见的垃圾数据。
 *
 * <p>这个类刻意分两类用例，因为它们防的是不同的错：
 * <ol>
 *   <li><b>重放</b>：同 key 同内容必须拿到**同一个** attemptId（不是"也建成功了"）；</li>
 *   <li><b>拒绝</b>：同 key 不同内容必须 409，绝不能把上一次的结果当成这一次的
 *       —— 那会让用户"选了 A 却拿到 B"。</li>
 * </ol>
 * 另外还有一条**对照**用例（不带 key 时每次调用都建新草稿）：没有它，
 * 上面两条即使因为"实现根本没读 key"而通过，也看不出来。
 */
class AttemptIdempotencyIT extends AccountIntegrationTestBase {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private IdempotencyGuard guard;

    @Test
    @DisplayName("同 key 同内容：重放返回同一个 attemptId，且草稿只有一份")
    void sameKeyReplaysTheSameAttempt() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_replay"), "Idem-Replay!2026");
        assertThat(account.status()).isEqualTo(201);
        CsrfContext csrf = csrf(account.session());

        JsonNode first = createAttempt(account, csrf, "key-replay-1", "{}");
        JsonNode second = createAttempt(account, csrf, "key-replay-1", "{}");

        assertThat(second.path("attemptId").asText())
                .as("同一个幂等键必须重放同一个测评，而不是再建一份")
                .isEqualTo(first.path("attemptId").asText());
        assertThat(draftCount(account))
                .as("草稿必须只有一份 —— 多出来的那一份用户在界面上看不见")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("同 key 不同内容：409 IDEMPOTENCY_KEY_REUSED，且不产生新草稿")
    void sameKeyWithDifferentBodyIsRejected() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_reused"), "Idem-Reused!2026");
        CsrfContext csrf = csrf(account.session());

        createAttempt(account, csrf, "key-reused-1", "{}");

        var reused = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .header("Idempotency-Key", "key-reused-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        // 同一个键、另一份请求内容（派生自某份报告）
                        .content("{\"baseReportId\":\"11111111-2222-3333-4444-555555555555\"}"), csrf))
                .andReturn();

        assertThat(reused.getResponse().getStatus())
                .as("同一个键用在两件不同的事上必须被拒绝，实际响应体：%s",
                        reused.getResponse().getContentAsString())
                .isEqualTo(409);
        assertThat(body(reused).path("code").asText()).isEqualTo("IDEMPOTENCY_KEY_REUSED");
        assertThat(draftCount(account)).as("被拒绝的请求不该留下草稿").isEqualTo(1);
    }

    @Test
    @DisplayName("对照：不带 key 时每次调用都是一份新草稿（证明行为差异来自 key，不是别的）")
    void withoutKeyEveryCallCreatesANewDraft() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_nokey"), "Idem-NoKey!2026");
        CsrfContext csrf = csrf(account.session());

        JsonNode first = createAttempt(account, csrf, null, "{}");
        JsonNode second = createAttempt(account, csrf, null, "{}");

        assertThat(second.path("attemptId").asText())
                .as("不带幂等键就没有幂等语义，这是契约允许的（键是可选的）")
                .isNotEqualTo(first.path("attemptId").asText());
        assertThat(draftCount(account)).isEqualTo(2);
    }

    @Test
    @DisplayName("空白 key 与缺失等价；不同 key 各自建一份")
    void blankKeyIsTreatedAsAbsentAndDifferentKeysDoNotCollide() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_blank"), "Idem-Blank!2026");
        CsrfContext csrf = csrf(account.session());

        JsonNode blankFirst = createAttempt(account, csrf, "   ", "{}");
        JsonNode blankSecond = createAttempt(account, csrf, "   ", "{}");
        assertThat(blankSecond.path("attemptId").asText())
                .as("空白键不是键：把它当键会让所有「没传键」的请求互相命中")
                .isNotEqualTo(blankFirst.path("attemptId").asText());

        JsonNode keyA = createAttempt(account, csrf, "key-distinct-a", "{}");
        JsonNode keyB = createAttempt(account, csrf, "key-distinct-b", "{}");
        assertThat(keyB.path("attemptId").asText())
                .as("不同的键（两次独立点击）本来就该各建一份")
                .isNotEqualTo(keyA.path("attemptId").asText());

        assertThat(draftCount(account)).isEqualTo(4);
    }

    @Test
    @DisplayName("超长 key 400 且不建草稿（列宽 80，截断会让两个键变成同一个）")
    void tooLongKeyIsRejectedWithoutCreatingAnything() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_long"), "Idem-Long!2026");
        CsrfContext csrf = csrf(account.session());

        var result = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .header("Idempotency-Key", "k".repeat(81))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(result).path("code").asText()).isEqualTo("VALIDATION_FAILED");
        assertThat(draftCount(account)).as("校验失败不该留下草稿").isZero();
    }

    @Test
    @DisplayName("记录指向的草稿已被删除：同一个键能重新建（不留悬空记录）")
    void replayAfterTheRecordedDraftWasDeletedCreatesAFreshOne() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_del"), "Idem-Del!2026");
        CsrfContext csrf = csrf(account.session());

        JsonNode created = createAttempt(account, csrf, "key-after-delete", "{}");
        String attemptId = created.path("attemptId").asText();

        var deleted = mockMvc.perform(withCsrf(delete("/api/v3/attempts/" + attemptId)
                .session(account.session()), csrf)).andReturn();
        assertThat(deleted.getResponse().getStatus()).isEqualTo(204);

        JsonNode again = createAttempt(account, csrf, "key-after-delete", "{}");
        assertThat(again.path("attemptId").asText())
                .as("用户删掉那份草稿后再点一次，必须真的拿到一份新草稿"
                        + "（返回已删除的那份 id 会让前端 404）")
                .isNotEqualTo(attemptId);
        assertThat(draftCount(account)).isEqualTo(1);
    }

    @Test
    @DisplayName("幂等键按用户隔离：两个账号用同一个键互不影响")
    void keysAreScopedToTheUser() throws Exception {
        RegisteredAccount first = register(uniqueUsername("idem_owner_a"), "Idem-OwnerA!2026");
        RegisteredAccount second = register(uniqueUsername("idem_owner_b"), "Idem-OwnerB!2026");

        String sharedKey = "key-shared-across-users";
        JsonNode a = createAttempt(first, csrf(first.session()), sharedKey, "{}");
        JsonNode b = createAttempt(second, csrf(second.session()), sharedKey, "{}");

        assertThat(b.path("attemptId").asText())
                .as("另一个账号用同一个键，必须拿到属于它自己的那份草稿")
                .isNotEqualTo(a.path("attemptId").asText());
        assertThat(a.path("attemptId").asText()).isNotBlank();
    }

    /**
     * `IN_PROGRESS` 的两个分支：**新近的**必须挡住重复创建，**过期的**必须放行。
     *
     * <p>这条在 HTTP 层做不出来（要真并发），所以直接对守卫做 —— 但它防的是真实故障：
     * 挡不住新近的 → 双击出两份草稿；不放行过期的 → 一次服务重启会让这个键在 2 分钟内
     * 一直报"上一次还在处理中"，而那次请求其实早就死了。
     */
    @Test
    @DisplayName("守卫：新近的 IN_PROGRESS 挡住重复占用，超期的占用可被重新抢到")
    void inProgressClaimBlocksThenExpires() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_guard"), "Idem-Guard!2026");
        String userId = account.userId();
        String hash = IdempotencyGuard.fingerprint("create_attempt", null);

        assertThat(guard.claim(userId, "create_attempt", "key-guard-live", hash))
                .as("第一次占用应该成功").isTrue();
        assertThat(guard.claim(userId, "create_attempt", "key-guard-live", hash))
                .as("同一个键的第二个并发请求不该也占到（否则仍会建两份草稿）").isFalse();

        // 把这次占用"变老"：模拟上一次请求已经崩了、再也不会回来标记完成。
        int backdated = jdbc.update("""
                UPDATE api_idempotency SET created_at = ?
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                """, LocalDateTime.now(ZoneOffset.UTC).minusMinutes(5), userId, "create_attempt", "key-guard-live");
        assertThat(backdated).as("必须真的改到那行，否则下面的放行断言是假通过").isEqualTo(1);

        assertThat(guard.claim(userId, "create_attempt", "key-guard-live", hash))
                .as("过期占用必须能被重新抢到，否则一次崩溃会把这个键永久锁死").isTrue();

        // 完成之后再占用同一个键也不行（记录仍在有效期内 → completedRef 走重放分支）
        guard.complete(userId, "create_attempt", "key-guard-live", "some-attempt-id");
        assertThat(guard.completedRef(userId, "create_attempt", "key-guard-live", hash))
                .as("完成后的键必须能读出上次的资源 id").isEqualTo("some-attempt-id");
    }

    /**
     * 过期清理（容量治理，A57）。
     *
     * <p>这张表每来一次"建测评/交卷/建分析"就多一行，TTL 24 小时，而在此之前
     * **只有账号注销**会删它（按用户删全部）。不注销的用户会让这些行无限堆积，
     * `idx_idempotency_expires` 建了却没有消费者。
     *
     * <p>这条用例真正要保的是**边界**，不是"能删"：活着的记录不能被删掉，
     * 否则正在重试的用户会突然又建出一份新草稿（幂等语义被清理任务破坏）。
     */
    @Test
    @DisplayName("过期清理：只删过期的，活着的记录与别的账号都不受影响")
    void deleteExpiredOnlyRemovesExpiredRows() throws Exception {
        RegisteredAccount account = register(uniqueUsername("idem_cleanup"), "Idem-Cleanup!2026");
        RegisteredAccount other = register(uniqueUsername("idem_cleanup_other"), "Idem-Cleanup!2026");
        String hash = IdempotencyGuard.fingerprint("create_attempt", null);

        guard.claim(account.userId(), "create_attempt", "key-expired", hash);
        guard.complete(account.userId(), "create_attempt", "key-expired", "synthetic-reference");
        guard.claim(account.userId(), "create_attempt", "key-live", hash);
        guard.claim(account.userId(), "create_attempt", "key-legacy-incomplete", hash);
        guard.claim(other.userId(), "create_attempt", "key-expired", hash);

        // 只把其中一条"变老"：真实场景里它是 24 小时前建的
        int backdated = jdbc.update("""
                UPDATE api_idempotency SET expires_at = ?
                 WHERE user_id = ? AND operation = 'create_attempt' AND idempotency_key = ?
                """, LocalDateTime.now(ZoneOffset.UTC).minusMinutes(1), account.userId(), "key-expired");
        assertThat(backdated).as("必须真的改到那行，否则下面的断言是假通过").isEqualTo(1);
        jdbc.update("""
                UPDATE api_idempotency SET expires_at = ?
                 WHERE user_id = ? AND operation = 'create_attempt' AND idempotency_key = ?
                """, LocalDateTime.now(ZoneOffset.UTC).minusMinutes(1), account.userId(),
                "key-legacy-incomplete");

        int deleted = guard.deleteExpired(LocalDateTime.now(ZoneOffset.UTC), 500);

        assertThat(deleted).as("只应该删掉那一条过期的").isEqualTo(1);
        assertThat(rowCount(account.userId(), "key-expired"))
                .as("过期的必须被删掉，否则这张表会一直涨").isZero();
        assertThat(rowCount(account.userId(), "key-live"))
                .as("有效期内的记录**绝不能**被清理任务删掉：删了用户的「重试」就会再建一份草稿")
                .isEqualTo(1);
        assertThat(rowCount(account.userId(), "key-legacy-incomplete"))
                .as("历史未完成占用不能被清理后用同一键盲目再建一份草稿").isEqualTo(1);
        assertThat(rowCount(other.userId(), "key-expired"))
                .as("清理按过期时间过滤，不按用户 —— 但也不该顺手动别人的活记录").isEqualTo(1);
    }

    /* ── 小工具 ─────────────────────────────────────────────────────────── */

    private int rowCount(String userId, String key) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM api_idempotency WHERE user_id = ? AND idempotency_key = ?",
                Integer.class, userId, key);
        return count == null ? 0 : count;
    }

    private JsonNode createAttempt(RegisteredAccount account, CsrfContext csrf, String key, String bodyJson)
            throws Exception {
        var builder = post("/api/v3/attempts")
                .session(account.session())
                .contentType(MediaType.APPLICATION_JSON)
                .content(bodyJson);
        if (key != null) {
            builder = builder.header("Idempotency-Key", key);
        }
        var result = mockMvc.perform(withCsrf(builder, csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("建测评应返回 201，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(201);
        return body(result);
    }

    /** 草稿列表里的条数 —— 用它来断言"到底建了几份"，而不是只信接口的返回。 */
    private int draftCount(RegisteredAccount account) throws Exception {
        var result = mockMvc.perform(get("/api/v3/attempts?status=draft&size=50")
                .session(account.session())).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode listed = body(result);
        JsonNode items = listed.isArray() ? listed : listed.path("items");
        return items.size();
    }
}
