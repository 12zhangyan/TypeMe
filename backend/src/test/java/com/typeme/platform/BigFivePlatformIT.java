package com.typeme.platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * `/api/v3/platform` 的端到端回归（H2 内存库）。
 *
 * <p><b>为什么必须有这一组</b>：大五的计分、报告与草稿此前只有实现级测试
 * （`BigFiveScoringTest` 直接调 scorer），没有任何一条用例走过
 * "HTTP 建草稿 → 逐题作答 → 交卷 → 读报告"这条真实路径。而这条路径上有几件事
 * 只有整体跑起来才会暴露：外键（{@code assessment_attempt.package_id} 指向
 * {@code assessment_package}）、`computed_type_code` 的 CHECK 约束（只允许 16 个类型码或 NULL）、
 * 以及 CSRF / 会话对写接口的要求。
 *
 * <p>这一组**不能**证明：量表信度效度、真实浏览器行为、MySQL 方言与并发。
 */
class BigFivePlatformIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("目录：公开可读，且同时列出十六型与大五")
    void instrumentsArePublicAndListBothKinds() throws Exception {
        // 不带任何会话：目录是公开的产品定义
        MvcResult result = mockMvc.perform(get("/api/v3/platform/instruments")).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode items = body(result).path("items");
        assertThat(items.isArray()).isTrue();

        List<String> slugs = new ArrayList<>();
        List<String> kinds = new ArrayList<>();
        for (JsonNode item : items) {
            slugs.add(item.path("slug").asText());
            kinds.add(item.path("kind").asText());
            // 时长与题数必须是真实值：写死会让首页卡片直接说错
            assertThat(item.path("baseItemCount").asInt()).isPositive();
            assertThat(item.path("estimatedMinutes").asInt()).isPositive();
            assertThat(item.path("summary").asText()).isNotBlank();
        }
        assertThat(slugs).contains("jung48", "bigfive50");
        assertThat(kinds).contains("jung", "big_five");
    }

    @Test
    @DisplayName("大五详情：五个维度各有两侧说明，且版本列表标出当前默认")
    void bigFiveDetailDescribesFiveDimensions() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/platform/instruments/bigfive50")).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        JsonNode detail = body(result);

        assertThat(detail.path("instrument").path("kind").asText()).isEqualTo("big_five");
        assertThat(detail.path("instrument").path("hasTypeCode").asBoolean())
                .as("大五结构上没有类型码")
                .isFalse();
        assertThat(detail.path("instrument").path("supportsClarification").asBoolean())
                .as("大五没有补充题轮次")
                .isFalse();

        JsonNode dimensions = detail.path("dimensions");
        assertThat(dimensions).hasSize(5);
        List<String> codes = new ArrayList<>();
        for (JsonNode dimension : dimensions) {
            codes.add(dimension.path("dimension").asText());
            assertThat(dimension.path("lowLabel").asText()).isNotBlank();
            assertThat(dimension.path("highLabel").asText()).isNotBlank();
            assertThat(dimension.path("caution").asText())
                    .as("每一维都必须带限制说明")
                    .isNotBlank();
        }
        assertThat(codes).containsExactly("E", "A", "C", "ES", "O");

        JsonNode versions = detail.path("versions");
        assertThat(versions).isNotEmpty();
        assertThat(versions.get(0).path("isDefault").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("完整流程：建草稿 → 答 50 题 → 交卷 → 报告没有类型码，但有五维与覆盖说明")
    void fullFlowProducesBigFiveReport() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_ok"), "Bigfive-Ok!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf, "bigfive50");
        assertThat(attempt.instrumentKind()).isEqualTo("big_five");
        assertThat(attempt.reportKind()).isEqualTo("big_five_profile");
        assertThat(attempt.itemCount()).isEqualTo(50);

        long revision = answerAll(account, csrf, attempt, 4);

        MvcResult submitted = submit(account, csrf, attempt.attemptId(), revision);
        assertThat(submitted.getResponse().getStatus())
                .as("交卷是可重复的读操作语义，返回 200 与报告编号。实际 %d，响应体：%s",
                        submitted.getResponse().getStatus(), submitted.getResponse().getContentAsString())
                .isEqualTo(200);
        JsonNode submitBody = body(submitted);
        assertThat(submitBody.path("status").asText()).isEqualTo("PROFILE");
        assertThat(submitBody.path("reportId").asText()).isNotBlank();

        MvcResult reportResult = mockMvc.perform(
                get("/api/v3/platform/reports/{id}", submitBody.path("reportId").asText())
                        .session(account.session())).andReturn();
        assertThat(reportResult.getResponse().getStatus()).isEqualTo(200);
        JsonNode report = body(reportResult);
        assertThat(report.path("reportKind").asText()).isEqualTo("big_five_profile");
        assertThat(report.path("computedTypeCode").isNull())
                .as("大五绝不能有类型码（数据库 CHECK 也不允许）")
                .isTrue();

        // 报告体在外壳的 report 字段里（v2）
        JsonNode body0 = report.path("report").path("report");
        assertThat(body0.isObject()).as("v2 报告的 report 字段必须是对象").isTrue();
        assertThat(body0.path("hasTypeCode").asBoolean()).isFalse();
        assertThat(body0.path("dimensions")).hasSize(5);
        assertThat(body0.path("coverage").path("coverageOk").asBoolean()).isTrue();
        assertThat(body0.path("limitations")).isNotEmpty();

        for (JsonNode dimension : body0.path("dimensions")) {
            assertThat(dimension.path("hasResult").asBoolean())
                    .as("全部作答后每一维都该有结论")
                    .isTrue();
            assertThat(dimension.path("midpoint").asInt())
                    .as("中点必须由服务端给出（量程两端不对称，不能平均推）")
                    .isEqualTo(30);
            assertThat(dimension.path("distance").asInt()).isNotNull();
            assertThat(dimension.path("validCount").asInt()).isEqualTo(10);
        }
    }

    @Test
    @DisplayName("还有题没处理时交卷：200 + INCOMPLETE，并给出缺的题号（不是错误）")
    void incompleteSubmissionListsMissingItems() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_short"), "Bigfive-Short!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf, "bigfive50");
        // 只答前 49 题：最后一题完全没处理
        List<Map<String, Object>> responses = new ArrayList<>();
        for (int index = 0; index < 49; index += 1) {
            responses.add(rating(attempt.itemIds().get(index), 3));
        }
        long revision = patchAnswers(account, csrf, attempt, responses);

        MvcResult submitted = submit(account, csrf, attempt.attemptId(), revision);
        assertThat(submitted.getResponse().getStatus())
                .as("没答完不是错误：必须是 200 + INCOMPLETE，而不是 4xx")
                .isEqualTo(200);
        JsonNode submitBody = body(submitted);
        assertThat(submitBody.path("status").asText()).isEqualTo("INCOMPLETE");
        assertThat(submitBody.path("reportId").isNull() || submitBody.path("reportId").asText().isEmpty())
                .as("没答完绝不能出报告")
                .isTrue();
        assertThat(submitBody.path("incompleteQuestionIds")).hasSize(1);
        assertThat(submitBody.path("incompleteQuestionIds").get(0).asText())
                .isEqualTo(attempt.itemIds().get(49));
    }

    @Test
    @DisplayName("重复交卷只产生一份报告；同一 Idempotency-Key 也只产生一份草稿")
    void submitAndCreateAreIdempotent() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_idem"), "Bigfive-Idem!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf, "bigfive50");
        long revision = answerAll(account, csrf, attempt, 5);

        String firstReportId = body(submit(account, csrf, attempt.attemptId(), revision)).path("reportId").asText();
        String secondReportId = body(submit(account, csrf, attempt.attemptId(), revision)).path("reportId").asText();
        assertThat(secondReportId)
                .as("同一份草稿只能有一份报告")
                .isEqualTo(firstReportId);

        // 建草稿的幂等：同一个键两次必须得到同一份草稿
        String key = "it-key-" + System.nanoTime();
        CreatedAttempt first = createAttempt(account, csrf, "bigfive50", key);
        CreatedAttempt again = createAttempt(account, csrf, "bigfive50", key);
        assertThat(again.attemptId())
                .as("同一 Idempotency-Key 不能建出第二份草稿")
                .isEqualTo(first.attemptId());
    }

    @Test
    @DisplayName("「说不好」与未作答都不算有效作答；五维都低于下限时不给方向")
    void unknownAndUnansweredAreBothExcluded() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_unknown"), "Bigfive-Unknown!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf, "bigfive50");
        // 每题都选「说不好」：全部处理过（可以交卷），但没有一条有效作答
        List<Map<String, Object>> responses = new ArrayList<>();
        for (String itemId : attempt.itemIds()) {
            responses.add(unknown(itemId));
        }
        long revision = patchAnswers(account, csrf, attempt, responses);

        JsonNode submitBody = body(submit(account, csrf, attempt.attemptId(), revision));
        assertThat(submitBody.path("status").asText())
                .as("全部「说不好」时答卷是完整的（每道题都处理过），但报告没有结论")
                .isIn("PROFILE", "NEEDS_REVIEW");

        MvcResult reportResult = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}/report", attempt.attemptId())
                        .session(account.session())).andReturn();
        assertThat(reportResult.getResponse().getStatus()).isEqualTo(200);
        JsonNode reportBody = body(reportResult).path("report").path("report");
        assertThat(reportBody.path("coverage").path("coverageOk").asBoolean()).isFalse();
        for (JsonNode dimension : reportBody.path("dimensions")) {
            assertThat(dimension.path("hasResult").asBoolean())
                    .as("没有有效作答时不能给方向（更不能补一个中间档）")
                    .isFalse();
            assertThat(dimension.path("validCount").asInt()).isZero();
            assertThat(dimension.path("unknownCount").asInt()).isEqualTo(10);
            assertThat(dimension.path("rawScore").isNull()).isTrue();
        }
    }

    @Test
    @DisplayName("账号隔离：别人的草稿读不到（与不存在同形）")
    void attemptsAreScopedToOwner() throws Exception {
        RegisteredAccount alice = register(uniqueUsername("bigfive_alice"), "Bigfive-Alice!2026");
        RegisteredAccount bob = register(uniqueUsername("bigfive_bob"), "Bigfive-Bob!2026");
        CsrfContext aliceCsrf = csrf(alice.session());

        CreatedAttempt attempt = createAttempt(alice, aliceCsrf, "bigfive50");

        MvcResult result = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", attempt.attemptId()).session(bob.session())).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("越权读取必须与不存在同形（404），不能是 200 或 403 泄露存在性")
                .isEqualTo(404);
    }

    @Test
    @DisplayName("十六型入口不接受大五：错误指向正确的路径，而不是默默建错草稿")
    void jungEndpointRejectsBigFiveSlug() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_cross"), "Bigfive-Cross!2026");
        CsrfContext csrf = csrf(account.session());

        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("instrument", "bigfive50"))), csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("拿大五 slug 调十六型入口是请求不合法（400），不是 500")
                .isEqualTo(400);
    }

    @Test
    @DisplayName("报告列表能列出两种量表的报告，并带上各自的量表名与报告种类")
    void reportListCoversBothKinds() throws Exception {
        RegisteredAccount account = register(uniqueUsername("platform_list"), "Platform-List!2026");
        CsrfContext csrf = csrf(account.session());

        // 先做一份十六型报告（走的是老的 /api/v3/attempts 入口）
        MvcResult jungCreated = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        assertThat(jungCreated.getResponse().getStatus()).isEqualTo(201);
        String jungAttemptId = body(jungCreated).path("attemptId").asText();
        List<Map<String, Object>> jungResponses = new ArrayList<>();
        for (JsonNode question : body(mockMvc.perform(get("/api/v3/catalog/current/package")
                .session(account.session())).andReturn()).path("questions")) {
            if ("base".equals(question.path("stage").asText())) {
                jungResponses.add(rating(question.path("id").asText(), 4));
            }
        }
        long jungRevision = patchJungAnswers(account, csrf, jungAttemptId, jungResponses);
        Map<String, Object> jungSubmit = new LinkedHashMap<>();
        jungSubmit.put("expectedRevision", jungRevision);
        jungSubmit.put("clarificationSkipped", true);
        MvcResult jungSubmitted = mockMvc.perform(withCsrf(
                post("/api/v3/attempts/{id}/submit", jungAttemptId)
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(jungSubmit)), csrf)).andReturn();
        assertThat(jungSubmitted.getResponse().getStatus())
                .as("十六型交卷应建出报告，实际 %d，响应体：%s",
                        jungSubmitted.getResponse().getStatus(), jungSubmitted.getResponse().getContentAsString())
                .isEqualTo(201);

        // 再做一份大五报告
        CreatedAttempt bigFive = createAttempt(account, csrf, "bigfive50");
        long bigFiveRevision = answerAll(account, csrf, bigFive, 2);
        String bigFiveReportId = body(submit(account, csrf, bigFive.attemptId(), bigFiveRevision))
                .path("reportId").asText();

        MvcResult listResult = mockMvc.perform(
                get("/api/v3/platform/reports").session(account.session())).andReturn();
        assertThat(listResult.getResponse().getStatus()).isEqualTo(200);
        JsonNode items = body(listResult).path("items");
        assertThat(items).hasSize(2);

        Map<String, JsonNode> byKind = new LinkedHashMap<>();
        for (JsonNode item : items) {
            byKind.put(item.path("reportKind").asText(), item);
            assertThat(item.path("instrumentTitle").asText())
                    .as("列表必须带上量表名，否则两种报告混在一起认不出来")
                    .isNotBlank();
            assertThat(item.path("createdAt").asText()).isNotBlank();
        }
        assertThat(byKind).containsKeys("jung_reference", "big_five_profile");

        // 大五那一行必须有报告 id 可点，且不能有类型码
        JsonNode bigFiveRow = byKind.get("big_five_profile");
        assertThat(bigFiveRow.path("reportId").asText()).isEqualTo(bigFiveReportId);
        assertThat(bigFiveRow.path("computedTypeCode").isNull()
                || bigFiveRow.path("computedTypeCode").asText().isEmpty())
                .as("大五列表项不能凭空出现类型码")
                .isTrue();
    }

    @Test
    @DisplayName("大五报告的 AI 解读请求：被明确拒绝，不是 5xx，也绝不建出任务")
    void aiAnalysisIsExplicitlyRefusedForBigFive() throws Exception {
        RegisteredAccount account = register(uniqueUsername("bigfive_ai"), "Bigfive-Ai!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf, "bigfive50");
        long revision = answerAll(account, csrf, attempt, 4);
        String reportId = body(submit(account, csrf, attempt.attemptId(), revision)).path("reportId").asText();

        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/reports/{id}/analyses", reportId)
                        .session(account.session())
                        .header("Idempotency-Key", "it-ai-" + System.nanoTime())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "topic", "OVERALL",
                                "consent", Map.of(
                                        "policyVersion", "typeme-ai-consent-v1",
                                        "scopeVersion", "typeme-ai-scope-v2")))), csrf)).andReturn();

        // 这条用例的默认上下文里 AI 是**关着**的（没有 API key），所以最先返回的是
        // "这项能力没开"（503），而不是"不支持这个量表"（400，由
        // `ReportInputBuilderTest#bigFiveReportIsRejectedAsUnsupported` 在打开了 AI 的那一层钉住）。
        // 这里要钉的是**边界**而不是具体某个码：无论哪种，都不能是 5xx 之外的服务端崩溃，
        // 也不能是一个悄悄建出来的任务 —— 后者会让用户点开一个永远不会成功的解读。
        int status = result.getResponse().getStatus();
        String code = body(result).path("code").asText();
        assertThat(status)
                .as("必须是明确的拒绝（4xx/503），不能是 5xx 崩溃。实际 %d，响应体：%s",
                        status, result.getResponse().getContentAsString())
                .isIn(400, 503);
        assertThat(code).isIn("UNSUPPORTED_INSTRUMENT", "AI_NOT_CONFIGURED");
        assertThat(body(result).path("jobId").isMissingNode() || body(result).path("jobId").isNull())
                .as("被拒绝的请求不能留下任务")
                .isTrue();
    }

    /* ── 小工具 ─────────────────────────────────────────────────────────── */

    private record CreatedAttempt(
            String attemptId,
            String instrumentKind,
            String reportKind,
            List<String> itemIds) {

        int itemCount() {
            return itemIds.size();
        }
    }

    private CreatedAttempt createAttempt(RegisteredAccount account, CsrfContext csrf, String slug)
            throws Exception {
        return createAttempt(account, csrf, slug, null);
    }

    /**
     * 建一份草稿。
     *
     * <p>题号**从服务端返回的题目里取**，不写死 Q01…Q50：内容包换版或题序变化时，
     * 写死的题号会让这条测试以"题号不存在"这种误导性的方式失败。
     */
    private CreatedAttempt createAttempt(RegisteredAccount account, CsrfContext csrf, String slug,
                                         String idempotencyKey) throws Exception {
        var builder = withCsrf(post("/api/v3/platform/attempts")
                .session(account.session())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("instrument", slug))), csrf);
        if (idempotencyKey != null) {
            builder = builder.header("Idempotency-Key", idempotencyKey);
        }
        MvcResult result = mockMvc.perform(builder).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("建草稿必须是 201，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(201);
        JsonNode node = body(result);
        List<String> itemIds = new ArrayList<>();
        for (JsonNode item : node.path("items")) {
            itemIds.add(item.path("id").asText());
        }
        return new CreatedAttempt(
                node.path("attemptId").asText(),
                node.path("instrumentKind").asText(),
                node.path("reportKind").asText(),
                List.copyOf(itemIds));
    }

    private long patchAnswers(RegisteredAccount account, CsrfContext csrf, CreatedAttempt attempt,
                              List<Map<String, Object>> responses) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", currentRevision(account, attempt));
        payload.put("responses", responses);
        MvcResult result = mockMvc.perform(withCsrf(
                patch("/api/v3/platform/attempts/{id}/answers", attempt.attemptId())
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("批量作答应返回 200，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(200);
        return body(result).path("revision").asLong();
    }

    /** 交卷要带**最新** revision：拿创建时的 0 会撞乐观锁（409）。 */
    private long currentRevision(RegisteredAccount account, CreatedAttempt attempt) throws Exception {
        MvcResult result = mockMvc.perform(
                get("/api/v3/platform/attempts/{id}", attempt.attemptId()).session(account.session())).andReturn();
        return body(result).path("revision").asLong();
    }

    private long answerAll(RegisteredAccount account, CsrfContext csrf, CreatedAttempt attempt, int rating)
            throws Exception {
        List<Map<String, Object>> responses = new ArrayList<>();
        for (String itemId : attempt.itemIds()) {
            responses.add(rating(itemId, rating));
        }
        return patchAnswers(account, csrf, attempt, responses);
    }

    private MvcResult submit(RegisteredAccount account, CsrfContext csrf, String attemptId, long revision)
            throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", revision);
        return mockMvc.perform(withCsrf(
                post("/api/v3/platform/attempts/{id}/submit", attemptId)
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
    }

    private static Map<String, Object> rating(String questionId, int value) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("questionId", questionId);
        response.put("kind", "RATING");
        response.put("rating", value);
        return response;
    }

    /** 十六型走的是老入口，请求形状与大五不同（不能共用）。 */
    private long patchJungAnswers(RegisteredAccount account, CsrfContext csrf, String attemptId,
                                  List<Map<String, Object>> responses) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", 0L);
        payload.put("responses", responses);
        MvcResult result = mockMvc.perform(withCsrf(
                patch("/api/v3/attempts/{id}/answers", attemptId)
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("十六型批量作答应返回 200，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(200);
        return body(result).path("revision").asLong();
    }

    private static Map<String, Object> unknown(String questionId) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("questionId", questionId);
        response.put("kind", "UNKNOWN");
        return response;
    }
}
