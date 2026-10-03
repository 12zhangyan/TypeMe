package com.typeme.platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 「这份草稿属于哪种量表」这条分流路径的契约测试（H2 内存库）。
 *
 * <p><b>为什么要有这一组</b>：`/assess/:attemptId` 的分流页先请求**大五**端点
 * `GET /api/v3/platform/attempts/{id}`，靠它的失败码判断"该走另一条路"。这条规则
 * 此前**没有任何测试**覆盖，结果线上表现成：十六型草稿进答题页时弹出
 * 「这份测评不是大五倾向测评，请从对应的入口继续」——一个正常的分流信号被当成了致命错误。
 *
 * <p>这一组钉住三件**同时**成立、缺一不可的事：
 *
 * <ol>
 *   <li>本人十六型草稿走大五端点 → <b>409 {@code INSTRUMENT_MISMATCH}</b>（可安全当"不是大五"用）；</li>
 *   <li>别人的草稿 / 不存在的 id → <b>404</b>，与不存在同形（不可当"不是大五"用：既不泄露存在性，
 *       也不能把"没有这份测评"显示成另一份草稿）；</li>
 *   <li>反过来，大五草稿走**十六型**端点 → <b>409 {@code PACKAGE_UNAVAILABLE}</b>，
 *       即十六型那一侧也会按草稿绑定的包再校验一次，不信任前端传来的量表。</li>
 * </ol>
 *
 * <p>它同时把上述真实响应体导出成夹具（`backend/target/attempt-router-fixtures/`），
 * 供前端单测与浏览器验收使用 —— 前端的替身必须是**服务端真发过的形状**，
 * 而不是为了让测试通过手写的"通用草稿"。
 *
 * <p>这一组**不能**证明：真实 MySQL 行为、真实浏览器渲染、真实 AI。
 */
class PlatformAttemptDispatchIT extends AccountIntegrationTestBase {

    private static final Path FIXTURE_DIR = Path.of("target", "attempt-router-fixtures");

    @Test
    @DisplayName("分流信号：本人十六型草稿走大五端点得 409 INSTRUMENT_MISMATCH，别人的/不存在的都是 404")
    void jungDraftOnBigFiveEndpointSignalsMismatch() throws Exception {
        RegisteredAccount account = register(uniqueUsername("dispatch_owner"), "Dispatch-Owner!2026");
        CsrfContext csrf = csrf(account.session());

        String jungAttemptId = createJungAttempt(account, csrf);

        MvcResult mismatch = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", jungAttemptId).session(account.session())).andReturn();
        assertThat(mismatch.getResponse().getStatus())
                .as("本人十六型草稿走大五端点：必须是 409，实际 %d，响应体：%s",
                        mismatch.getResponse().getStatus(), mismatch.getResponse().getContentAsString())
                .isEqualTo(409);
        JsonNode mismatchBody = body(mismatch);
        assertThat(mismatchBody.path("code").asText())
                .as("前端分流判据就是它；改码等于悄悄改行为")
                .isEqualTo("INSTRUMENT_MISMATCH");
        assertThat(mismatchBody.path("message").asText()).isNotBlank();
        writeFixture("jung-draft-platform-mismatch.json", mismatchBody);

        // 别人的草稿：必须与不存在同形（404），不能因为"这不是大五"而先抛出 409 ——
        // 那会变成一个可枚举他人草稿存在性的探针。
        RegisteredAccount other = register(uniqueUsername("dispatch_other"), "Dispatch-Other!2026");
        MvcResult foreign = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", jungAttemptId).session(other.session())).andReturn();
        assertThat(foreign.getResponse().getStatus())
                .as("别人的草稿必须 404，实际 %d，响应体：%s",
                        foreign.getResponse().getStatus(), foreign.getResponse().getContentAsString())
                .isEqualTo(404);

        MvcResult missing = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", "no-such-attempt").session(account.session())).andReturn();
        assertThat(missing.getResponse().getStatus()).isEqualTo(404);
        assertThat(body(missing).path("code").asText())
                .as("不存在的 id 与别人的草稿同码，前端才能用同一句话")
                .isEqualTo(body(foreign).path("code").asText());
        writeFixture("attempt-not-found.json", body(missing));

        // 未登录：401，也不能被当成"这份草稿是十六型的"
        MvcResult anonymous = mockMvc.perform(get("/api/v3/platform/attempts/{id}", jungAttemptId)).andReturn();
        assertThat(anonymous.getResponse().getStatus())
                .as("未登录必须 401，实际 %d", anonymous.getResponse().getStatus())
                .isEqualTo(401);
        writeFixture("attempt-unauthenticated.json", body(anonymous));
    }

    @Test
    @DisplayName("十六型端点也会按绑定包校验：大五草稿走十六型端点得 409 PACKAGE_UNAVAILABLE")
    void bigFiveDraftOnJungEndpointIsRejectedByBoundPackage() throws Exception {
        RegisteredAccount account = register(uniqueUsername("dispatch_reverse"), "Dispatch-Reverse!2026");
        CsrfContext csrf = csrf(account.session());

        MvcResult created = mockMvc.perform(withCsrf(post("/api/v3/platform/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("instrument", "bigfive50"))), csrf)).andReturn();
        assertThat(created.getResponse().getStatus()).isEqualTo(201);
        String bigFiveAttemptId = body(created).path("attemptId").asText();

        MvcResult result = mockMvc.perform(
                get("/api/v3/attempts/{id}", bigFiveAttemptId).session(account.session())).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("十六型端点读大五草稿必须拒绝，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(409);
        JsonNode body = body(result);
        assertThat(body.path("code").asText())
                .as("按草稿绑定的包判不出来 → PACKAGE_UNAVAILABLE；这条证明分流不能靠前端传 kind")
                .isEqualTo("PACKAGE_UNAVAILABLE");
        writeFixture("bigfive-draft-jung-endpoint.json", body);
    }

    @Test
    @DisplayName("两份真实视图：大五草稿的大五详情、十六型草稿的十六型详情（供前端装配替身）")
    void dumpsRealAttemptDetailsForFrontEndFixtures() throws Exception {
        RegisteredAccount account = register(uniqueUsername("dispatch_dump"), "Dispatch-Dump!2026");
        CsrfContext csrf = csrf(account.session());

        String jungAttemptId = createJungAttempt(account, csrf);
        MvcResult jungDetail = mockMvc.perform(
                get("/api/v3/attempts/{id}", jungAttemptId).session(account.session())).andReturn();
        assertThat(jungDetail.getResponse().getStatus())
                .as("十六型草稿走十六型端点必须 200，实际 %d，响应体：%s",
                        jungDetail.getResponse().getStatus(), jungDetail.getResponse().getContentAsString())
                .isEqualTo(200);
        writeFixture("jung-attempt-detail.json", body(jungDetail));

        MvcResult created = mockMvc.perform(withCsrf(post("/api/v3/platform/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("instrument", "bigfive50"))), csrf)).andReturn();
        String bigFiveAttemptId = body(created).path("attemptId").asText();
        MvcResult bigFiveDetail = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", bigFiveAttemptId).session(account.session())).andReturn();
        assertThat(bigFiveDetail.getResponse().getStatus())
                .as("大五草稿走大五端点必须 200，实际 %d，响应体：%s",
                        bigFiveDetail.getResponse().getStatus(), bigFiveDetail.getResponse().getContentAsString())
                .isEqualTo(200);

        JsonNode detail = body(bigFiveDetail);
        assertThat(detail.path("instrumentKind").asText())
                .as("分流页就靠这个字段选页面")
                .isEqualTo("big_five");
        assertThat(detail.path("reportKind").asText()).isEqualTo("big_five_profile");
        assertThat(detail.path("items").isArray()).isTrue();
        assertThat(detail.path("items").size()).isEqualTo(50);
        assertThat(detail.path("items").get(0).path("kind").asText())
                .as("大五题是单句陈述，十六型是双极对；前端解析按 kind 分叉")
                .isEqualTo("agreement_statement");
        assertThat(detail.has("answers")).isTrue();
        assertThat(detail.has("clarificationDimensions")).isTrue();
        writeFixture("bigfive-attempt-detail.json", detail);
    }

    /* ── 辅助 ───────────────────────────────────────────────────────────── */

    /** 十六型草稿走的是老入口，请求体是 `{}`。 */
    private String createJungAttempt(RegisteredAccount account, CsrfContext csrf) throws Exception {
        MvcResult created = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        assertThat(created.getResponse().getStatus())
                .as("建十六型草稿必须 201，实际 %d，响应体：%s",
                        created.getResponse().getStatus(), created.getResponse().getContentAsString())
                .isEqualTo(201);
        return body(created).path("attemptId").asText();
    }

    /**
     * 写夹具。
     *
     * <p>把每次运行都不同的值（草稿 id、时间）替换成固定占位符，让夹具可读、可对比；
     * **字段名与结构一律不动** —— 前端替身的价值就在"和真响应同形"。
     */
    private void writeFixture(String name, JsonNode payload) throws Exception {
        Files.createDirectories(FIXTURE_DIR);
        ObjectNode copy = payload.deepCopy();
        for (String field : new String[]{"attemptId", "startedAt", "updatedAt", "submittedAt", "reportId"}) {
            if (copy.hasNonNull(field)) {
                copy.put(field, "<" + field + ">");
            }
        }
        ObjectMapper mapper = new ObjectMapper();
        Path target = FIXTURE_DIR.resolve(name);
        Files.writeString(target, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(copy) + "\n");
        assertThat(Files.size(target)).as("夹具 %s 不该是空的", name).isPositive();
    }

    /** 保留给未来的字段级断言：把响应体转成有序 Map（便于打印差异）。 */
    @SuppressWarnings("unused")
    private static Map<String, Object> flatten(JsonNode node) {
        Map<String, Object> flat = new LinkedHashMap<>();
        node.fields().forEachRemaining(entry -> flat.put(entry.getKey(), entry.getValue().asText()));
        return flat;
    }
}
