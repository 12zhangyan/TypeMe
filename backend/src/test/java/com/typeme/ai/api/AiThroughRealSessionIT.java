package com.typeme.ai.api;

import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;

import java.sql.Timestamp;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * AI 接口在**真实 Security 过滤器链 + 真实会话**下的边界回归。
 *
 * <p><b>这个类为什么必须存在。</b>{@code AnalysisFlowTest} 等 63 条 AI 测试用的是
 * {@code MockMvcBuilders.standaloneSetup(controller)}，它**只挂控制器**：
 * 过滤器链（认证、CSRF）整个不在请求路径上，测试用 {@code SecurityContextHolder}
 * 手工塞一个主体进去。于是"AI 接口在真实链下会怎样"以及"生产主体能否被
 * {@code AiCurrentUser} 正确识别"这两件事，一条都没有被验证过 —— 同类盲区在
 * 2026-09-16 已经造成过一次真实缺陷（{@code AssessmentCreationThroughRealSessionIT} 的类注释记录了经过）。
 *
 * <p>所以本类刻意**不 mock 鉴权**：走真实的
 * {@code POST /api/v3/auth/register} 建立会话（真实 CSRF、真实 SecurityFilterChain），
 * 再用同一个会话去打 AI 接口。
 *
 * <h2>本类能证明什么、不能证明什么</h2>
 * <ul>
 *   <li><b>能</b>：未认证/缺 CSRF 的请求在链上被拒且错误码正确；报告归属在链下仍是 404 同形
 *       （不泄露存在性）；{@code AiCurrentUser} 能从生产主体取到 userId（本人列表 200）；
 *       AI 关闭时创建接口对"自己的报告"与"不存在的报告"返回同一个 503（不泄露存在性）；
 *       状态接口不返回 key。</li>
 *   <li><b>不能</b>：真实上游行为。本上下文里 {@code typeme.ai.enabled=false}（基类刻意如此），
 *       所以**不会**有任何 job 被创建、也不会发生任何模型调用。任务级归属
 *       （{@code GET /analyses/{jobId}}、{@code POST /analyses/{jobId}/retry} 的 404 同形）
 *       仍只由 standalone 的那批测试覆盖。</li>
 * </ul>
 */
class AiThroughRealSessionIT extends AccountIntegrationTestBase {

    private static final String PACKAGE_ID = "typeme-jung48-zh-v1";

    @Test
    @DisplayName("未认证的读请求在过滤器链上被拒（401 UNAUTHENTICATED），不是控制器里的兜底")
    void unauthenticatedReadIsRejectedByFilterChain() throws Exception {
        RegisteredAccount owner = register(uniqueUsername("ai_anon"), "Ai-Anon!2026");
        String reportId = seedReportFor(owner.body().path("userId").asText());

        var result = mockMvc.perform(get("/api/v3/reports/" + reportId + "/analyses")).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("未登录读报告任务列表应由链返回 401，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(401);
        assertThat(body(result).path("code").asText()).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    @DisplayName("缺 CSRF 的写请求由链拒绝（403 CSRF_INVALID）；补上 CSRF 但未登录才是 401")
    void csrfIsEnforcedOnAiWrites() throws Exception {
        String body = """
                {"consent":{"policyVersion":"typeme-ai-consent-v1","scopeVersion":"typeme-ai-scope-v2"},
                 "topic":"overall","note":null}
                """;
        String anyReport = java.util.UUID.randomUUID().toString();

        // 1) 不带任何 CSRF 令牌：CsrfFilter 在授权之前，因此是 403 而不是 401。
        var withoutCsrf = mockMvc.perform(post("/api/v3/reports/" + anyReport + "/analyses")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
        assertThat(withoutCsrf.getResponse().getStatus())
                .as("写方法缺 CSRF 应由链返回 403，实际 %d，响应体：%s",
                        withoutCsrf.getResponse().getStatus(),
                        withoutCsrf.getResponse().getContentAsString())
                .isEqualTo(403);
        assertThat(body(withoutCsrf).path("code").asText()).isEqualTo("CSRF_INVALID");

        // 2) 带上合法 CSRF 令牌但仍是匿名会话：这时才轮到认证判定 → 401。
        MockHttpSession anonymous = new MockHttpSession();
        CsrfContext csrf = csrf(anonymous);
        var csrfButAnonymous = mockMvc.perform(withCsrf(post("/api/v3/reports/" + anyReport + "/analyses")
                        .session(anonymous)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body), csrf))
                .andReturn();
        assertThat(csrfButAnonymous.getResponse().getStatus())
                .as("有 CSRF 但未登录应由链返回 401，实际 %d，响应体：%s",
                        csrfButAnonymous.getResponse().getStatus(),
                        csrfButAnonymous.getResponse().getContentAsString())
                .isEqualTo(401);
        assertThat(body(csrfButAnonymous).path("code").asText()).isEqualTo("UNAUTHENTICATED");
    }

    @Test
    @DisplayName("报告归属在真实链下仍成立：本人 200（证明 AiCurrentUser 认得出生产主体），他人 404 同形")
    void reportOwnershipSurvivesRealChain() throws Exception {
        RegisteredAccount alice = register(uniqueUsername("ai_owner"), "Ai-Owner!2026");
        assertThat(alice.status()).isEqualTo(201);
        RegisteredAccount bob = register(uniqueUsername("ai_other"), "Ai-Other!2026");
        assertThat(bob.status()).isEqualTo(201);

        String aliceUserId = alice.body().path("userId").asText();
        String reportId = seedReportFor(aliceUserId);

        // 本人：200。这一条同时是"生产主体带 userId"的接缝断言 ——
        // 若主体取不到 getUserId()，这里要么 500 要么查到别人的数据。
        var own = mockMvc.perform(get("/api/v3/reports/" + reportId + "/analyses")
                        .session(alice.session()))
                .andReturn();
        assertThat(own.getResponse().getStatus())
                .as("本人读自己的报告任务列表应 200，实际 %d，响应体：%s",
                        own.getResponse().getStatus(), own.getResponse().getContentAsString())
                .isEqualTo(200);
        assertThat(body(own).path("items").isArray()).isTrue();
        assertThat(body(own).path("items").size())
                .as("新播种的报告还没有任何 AI 任务")
                .isZero();

        // 他人：404，且与"报告不存在"同形（不能因为存在而给 403）。
        var foreign = mockMvc.perform(get("/api/v3/reports/" + reportId + "/analyses")
                        .session(bob.session()))
                .andReturn();
        var missing = mockMvc.perform(get("/api/v3/reports/" + java.util.UUID.randomUUID() + "/analyses")
                        .session(bob.session()))
                .andReturn();

        assertThat(foreign.getResponse().getStatus())
                .as("读别人的报告应 404 同形，实际 %d，响应体：%s",
                        foreign.getResponse().getStatus(), foreign.getResponse().getContentAsString())
                .isEqualTo(404);
        assertThat(missing.getResponse().getStatus()).isEqualTo(404);
        assertThat(body(foreign).path("code").asText())
                .as("「不属于我」与「不存在」必须给出同一个错误码")
                .isEqualTo(body(missing).path("code").asText());
    }

    @Test
    @DisplayName("AI 未启用时创建接口对「自己的报告」与「不存在的报告」返回同一个 503，不泄露报告是否存在")
    void disabledAiDoesNotRevealReportExistence() throws Exception {
        RegisteredAccount alice = register(uniqueUsername("ai_disabled"), "Ai-Disabled!2026");
        String aliceUserId = alice.body().path("userId").asText();
        String reportId = seedReportFor(aliceUserId);
        CsrfContext csrf = csrf(alice.session());

        String payload = """
                {"consent":{"policyVersion":"typeme-ai-consent-v1","scopeVersion":"typeme-ai-scope-v2"},
                 "topic":"overall","note":null}
                """;

        var ownReport = mockMvc.perform(withCsrf(post("/api/v3/reports/" + reportId + "/analyses")
                        .session(alice.session())
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload), csrf))
                .andReturn();
        var noSuchReport = mockMvc.perform(withCsrf(post("/api/v3/reports/"
                        + java.util.UUID.randomUUID() + "/analyses")
                        .session(alice.session())
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload), csrf))
                .andReturn();

        assertThat(ownReport.getResponse().getStatus())
                .as("本上下文 AI 关闭（基类设 enabled=false），应 503，实际 %d，响应体：%s",
                        ownReport.getResponse().getStatus(), ownReport.getResponse().getContentAsString())
                .isEqualTo(503);
        assertThat(body(ownReport).path("code").asText()).isEqualTo("AI_NOT_CONFIGURED");

        // "能力没开"这一判断先于归属检查（AnalysisService.create 的顺序）。
        // 这样无论报告是否存在都得到同一个响应，因此不构成存在性枚举通道 —— 把它钉住，
        // 免得以后有人把顺序调成"先查归属"再顺手改成 404/403 混用。
        assertThat(noSuchReport.getResponse().getStatus()).isEqualTo(503);
        assertThat(body(noSuchReport).path("code").asText()).isEqualTo("AI_NOT_CONFIGURED");
        // 逐字比较要排除 requestId（每次请求都不同，它不是信息泄露面）。
        assertThat(body(noSuchReport).path("message").asText())
                .as("「报告存在」与「报告不存在」必须给出同一句提示，否则就是存在性泄露")
                .isEqualTo(body(ownReport).path("message").asText());
        assertThat(body(noSuchReport).path("details").size()).isZero();
        assertThat(body(ownReport).path("details").size()).isZero();
    }

    @Test
    @DisplayName("状态接口在真实链下：未登录被链拦成 401（登录页拿不到），登录后 200，响应体里没有任何 key 字段")
    void statusNeverLeaksKeyUnderRealChain() throws Exception {
        // 这一条与服务端注释曾经的说法相反：控制器里写着"未登录也给出基础信息，
        // 前端登录页需要判断是否显示 AI 入口"，但 SecurityConfig 把 /api/v3/** 整体
        // 设为 authenticated() 且未放行本路径 —— 匿名请求在链上就被拦掉，
        // 控制器里那个兜底分支在生产链下取不到值。这里把**真实**行为钉住。
        var anonymous = mockMvc.perform(get("/api/v3/ai/status")).andReturn();
        assertThat(anonymous.getResponse().getStatus())
                .as("匿名访问 /ai/status 当前由过滤器链返回 401，实际 %d，响应体：%s",
                        anonymous.getResponse().getStatus(),
                        anonymous.getResponse().getContentAsString())
                .isEqualTo(401);
        assertThat(body(anonymous).path("code").asText()).isEqualTo("UNAUTHENTICATED");

        RegisteredAccount alice = register(uniqueUsername("ai_status"), "Ai-Status!2026");
        var signedIn = mockMvc.perform(get("/api/v3/ai/status").session(alice.session())).andReturn();
        assertThat(signedIn.getResponse().getStatus()).isEqualTo(200);
        String raw = signedIn.getResponse().getContentAsString();
        assertThat(raw)
                .as("响应体里不得出现 apiKey 字段（apiKeySource 是允许的说明字段）")
                .doesNotContain("\"apiKey\"");
        assertThat(body(signedIn).path("baseUrlHost").asText()).doesNotContain("/");
        assertThat(body(signedIn).path("enabled").asBoolean()).isFalse();
    }

    /** 播种一份属于该用户的已提交报告；AI 关闭时这些行不会被解析，只为归属判定存在。 */
    private String seedReportFor(String userId) {
        assertThat(userId).as("播种报告前必须先有真实注册用户").isNotBlank();
        Integer packages = invitationJdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?", Integer.class, PACKAGE_ID);
        assertThat(packages).as("内容包 %s 必须已登记（否则外键会失败）", PACKAGE_ID).isEqualTo(1);

        String attemptId = java.util.UUID.randomUUID().toString();
        String reportId = java.util.UUID.randomUUID().toString();
        Timestamp now = Timestamp.from(Instant.parse("2026-09-18T10:00:00Z"));

        invitationJdbc.update("""
                INSERT INTO assessment_attempt (id, user_id, package_id, status, revision,
                        current_question_id, clarification_dimensions, clarification_skipped,
                        base_attempt_id, started_at, updated_at, submitted_at)
                VALUES (?, ?, ?, 'SUBMITTED', 1, NULL, '', 0, NULL, ?, ?, ?)
                """, attemptId, userId, PACKAGE_ID, now, now, now);

        invitationJdbc.update("""
                INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code,
                        score_json, report_json, report_hash, created_at)
                VALUES (?, ?, ?, 'REFERENCE', 'ISTJ', '{}', '{"schemaVersion":1}', ?, ?)
                """, reportId, attemptId, userId,
                "e".repeat(64), now);
        return reportId;
    }
}
