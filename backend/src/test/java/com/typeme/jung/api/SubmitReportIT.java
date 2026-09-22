package com.typeme.jung.api;

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
 * `POST /api/v3/attempts/{id}/submit` 的**状态码与幂等**（契约 02 §7.2、A53④）。
 *
 * <p>为什么单开这个类：在这个类之前，整套后端测试里**没有任何一条**走过"答满 48 题 →
 * 交卷 → 拿到报告"这条 HTTP 路径（`ConcurrencyMySqlIT` 走的是服务对象），
 * 于是契约写 `201 Created`、实现返回 `200` 这件事一直没有测试能发现。
 *
 * <p>状态码不是装饰：契约把"成功建出报告 = 201"与"覆盖不足 = 200 + NEEDS_REVIEW"
 * 分成两行，正是因为这两种结果的**下一步动作完全不同**（一个去看报告，一个回去补题）。
 * 客户端只看 body 也能跑，但下一个消费者有权按状态码判断"报告真的建出来了"。
 */
class SubmitReportIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("答满主测后交卷：201 + reportId；重复交卷仍是同一份报告")
    void submitCreatesReportWith201AndIsIdempotent() throws Exception {
        RegisteredAccount account = register(uniqueUsername("submit_ok"), "Submit-Ok!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf);
        long revision = answerAllBase(account, csrf, attempt);

        // 交卷要带**最新** revision：作答已经把 revision 推到 1，拿创建时的 0 交卷会撞乐观锁
        MvcResult submitted = submit(account, csrf, attempt.attemptId(), revision, true);        assertThat(submitted.getResponse().getStatus())
                .as("成功建出报告必须是 201 Created（契约 §7.2）。实际 %d，响应体：%s",
                        submitted.getResponse().getStatus(), submitted.getResponse().getContentAsString())
                .isEqualTo(201);
        JsonNode first = body(submitted);
        assertThat(first.path("reportId").asText()).isNotBlank();
        assertThat(first.path("status").asText())
                .as("答满且跳过补充题时不该是 NEEDS_REVIEW")
                .isNotIn("NEEDS_REVIEW", "");

        // 重复交卷：同一份 attempt 只能有一份报告，返回的还是它
        MvcResult again = submit(account, csrf, attempt.attemptId(), attempt.revision(), true);
        assertThat(again.getResponse().getStatus()).isEqualTo(201);
        assertThat(body(again).path("reportId").asText())
                .as("重复交卷必须返回同一份报告，而不是新建一份")
                .isEqualTo(first.path("reportId").asText());
    }

    @Test
    @DisplayName("覆盖不足时交卷：200 + NEEDS_REVIEW，且不建报告")
    void submitWithInsufficientCoverageStays200NeedsReview() throws Exception {
        RegisteredAccount account = register(uniqueUsername("submit_short"), "Submit-Short!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf);
        // 只答一题：覆盖率必然不足
        String firstQuestionId = baseQuestionIds(account).get(0);
        long revision = patchAnswers(account, csrf, attempt, List.of(rating(firstQuestionId)));

        MvcResult submitted = submit(account, csrf, attempt.attemptId(), revision, true);
        assertThat(submitted.getResponse().getStatus())
                .as("覆盖不足不是错误：必须是 200 + NEEDS_REVIEW，而不是 4xx/5xx")
                .isEqualTo(200);
        JsonNode body = body(submitted);
        assertThat(body.path("status").asText()).isEqualTo("NEEDS_REVIEW");
        assertThat(body.path("reportId").isNull() || body.path("reportId").asText().isEmpty())
                .as("覆盖不足时绝不能建出报告")
                .isTrue();
        assertThat(body.path("coverage")).as("必须告诉用户缺哪几维").isNotEmpty();
    }

    /**
     * A34：覆盖不足的那次交卷点了「跳过补充题」，草稿不能被永久标记为已跳过。
     *
     * <p>旧实现把 clarification_skipped = 1 写在**覆盖检查之前**，于是任何一次
     * 没产生报告的提交（这里就是覆盖不足 → 200 + NEEDS_REVIEW）都会把草稿标记成
     * 「已跳过」。用户补完主测题、再老实答完补充题交卷时，服务端读到的仍是 1，
     * 于是走进「已选择跳过补充题，就不应该再有补充题答案」那一支 → 400；
     * 而那次提交根本没有报告，他也无法靠派生新测评绕开，草稿就此锁死。
     *
     * <p>这条测试特意走到「补答 → 重新求澄清 → 答完补充题 → 再交卷」的完整路径，
     * 而不是只断言那一列的取值：锁死的是用户的下一步动作，不是数据库里的一个字段。
     */
    @Test
    @DisplayName("覆盖不足时点过「跳过补充题」：草稿不被永久标记，补答后仍能正常交卷（A34）")
    void skipChoiceIsNotPersistedWhenTheSubmitProducesNoReport() throws Exception {
        RegisteredAccount account = register(uniqueUsername("submit_a34"), "Submit-A34!2026");
        CsrfContext csrf = csrf(account.session());

        CreatedAttempt attempt = createAttempt(account, csrf);
        Map<String, List<String>> base = questionIdsByDimension(account, "base");
        Map<String, List<String>> clarification = questionIdsByDimension(account, "clarification");

        // ① EI 只答 8 题（低于每维最低题数），其余三维答满 → 覆盖必然不足
        List<Map<String, Object>> responses = new ArrayList<>();
        base.get("EI").subList(0, 8).forEach(questionId -> responses.add(rating(questionId)));
        for (String dimension : List.of("SN", "TF", "JP")) {
            base.get(dimension).forEach(questionId -> responses.add(rating(questionId)));
        }
        long revision = putAnswers(account, csrf, attempt.attemptId(), attempt.revision(), responses);

        // ② 带着「跳过补充题」交卷：这次没有报告，只有 NEEDS_REVIEW
        MvcResult shortSubmit = submit(account, csrf, attempt.attemptId(), revision, true);
        assertThat(shortSubmit.getResponse().getStatus())
                .as("覆盖不足仍是 200，不是错误状态码；响应体：%s", shortSubmit.getResponse().getContentAsString())
                .isEqualTo(200);
        assertThat(body(shortSubmit).path("status").asText()).isEqualTo("NEEDS_REVIEW");

        // ③ 没有报告，就不该留下「已跳过补充题」的标记 —— 旧实现在这里必红
        assertThat(persistedClarificationSkipped(attempt.attemptId()))
                .as("覆盖不足的提交没有产生报告，草稿必须保持「还没决定跳过」的样子")
                .isFalse();

        // ④ 补完 EI 剩下的题，覆盖达标
        List<Map<String, Object>> remaining = new ArrayList<>();
        base.get("EI").subList(8, base.get("EI").size())
                .forEach(questionId -> remaining.add(rating(questionId)));
        revision = putAnswers(account, csrf, attempt.attemptId(), revision, remaining);

        // ⑤ 重新求澄清安排，并把安排的补充题全部答完（第 ⑥ 步不再选「跳过」）
        MvcResult review = mockMvc.perform(withCsrf(post("/api/v3/attempts/{id}/review", attempt.attemptId())
                .session(account.session()), csrf)).andReturn();
        assertThat(review.getResponse().getStatus()).isEqualTo(200);
        List<String> scheduled = new ArrayList<>();
        body(review).path("clarificationDimensions").forEach(node -> scheduled.add(node.asText()));
        assertThat(scheduled)
                .as("这组答案（全选同一档）应当需要澄清；若不需要，这条测试就走不到补充题分支")
                .isNotEmpty();

        List<Map<String, Object>> clarificationAnswers = new ArrayList<>();
        for (String dimension : scheduled) {
            clarification.get(dimension).forEach(questionId -> clarificationAnswers.add(rating(questionId)));
        }
        revision = putAnswers(account, csrf, attempt.attemptId(), revision, clarificationAnswers);

        // ⑥ 这次没有选跳过：必须能交卷（旧实现会被第 ③ 步留下的标记顶成 400）
        MvcResult submitted = submit(account, csrf, attempt.attemptId(), revision, false);
        assertThat(submitted.getResponse().getStatus())
                .as("补答补充题后交卷必须是 201；响应体：%s", submitted.getResponse().getContentAsString())
                .isEqualTo(201);
        assertThat(body(submitted).path("reportId").asText()).isNotBlank();
    }

    /* ── 小工具 ─────────────────────────────────────────────────────────── */

    private record CreatedAttempt(String attemptId, long revision) {
    }

    private CreatedAttempt createAttempt(RegisteredAccount account, CsrfContext csrf) throws Exception {
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        JsonNode node = body(result);
        return new CreatedAttempt(node.path("attemptId").asText(), node.path("revision").asLong());
    }

    private long patchAnswers(RegisteredAccount account, CsrfContext csrf, CreatedAttempt attempt,
                              List<Map<String, Object>> responses) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", attempt.revision());
        payload.put("responses", responses);
        MvcResult result = mockMvc.perform(withCsrf(patch("/api/v3/attempts/{id}/answers", attempt.attemptId())
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("批量作答应返回 200，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(200);
        return body(result).path("revision").asLong();
    }

    private long answerAllBase(RegisteredAccount account, CsrfContext csrf, CreatedAttempt attempt) throws Exception {
        List<Map<String, Object>> responses = new ArrayList<>();
        for (String questionId : baseQuestionIds(account)) {
            responses.add(rating(questionId));
        }
        assertThat(responses).as("主测题数必须与契约一致").hasSize(48);
        return patchAnswers(account, csrf, attempt, responses);
    }

    /**
     * 直接读草稿上的「已跳过补充题」标记。
     *
     * <p>断言看的是**库里的真实状态**，不是响应体：这个标记的影响发生在下一次提交，
     * 只看本次响应看不出问题。
     */
    private boolean persistedClarificationSkipped(String attemptId) {
        Integer value = invitationJdbc.queryForObject(
                "SELECT clarification_skipped FROM assessment_attempt WHERE id = ?", Integer.class, attemptId);
        return value != null && value == 1;
    }

    /** 按维度取题号（stage = base / clarification），不写死题号，内容包换版时不会跟着烂掉。 */
    private Map<String, List<String>> questionIdsByDimension(RegisteredAccount account, String stage)
            throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/catalog/current/package")
                .session(account.session())).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        Map<String, List<String>> grouped = new LinkedHashMap<>();
        for (JsonNode question : body(result).path("questions")) {
            if (stage.equals(question.path("stage").asText())) {
                grouped.computeIfAbsent(question.path("dimension").asText(), key -> new ArrayList<>())
                        .add(question.path("id").asText());
            }
        }
        return grouped;
    }

    private long putAnswers(RegisteredAccount account, CsrfContext csrf, String attemptId,
                            long expectedRevision, List<Map<String, Object>> responses) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", expectedRevision);
        payload.put("responses", responses);
        MvcResult result = mockMvc.perform(withCsrf(patch("/api/v3/attempts/{id}/answers", attemptId)
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("批量作答应返回 200，实际 %d，响应体：%s",
                        result.getResponse().getStatus(), result.getResponse().getContentAsString())
                .isEqualTo(200);
        return body(result).path("revision").asLong();
    }

    private MvcResult submit(RegisteredAccount account, CsrfContext csrf, String attemptId,
                             long expectedRevision, boolean skipped) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("expectedRevision", expectedRevision);
        payload.put("clarificationSkipped", skipped);
        return mockMvc.perform(withCsrf(post("/api/v3/attempts/{id}/submit", attemptId)
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(payload)), csrf)).andReturn();
    }

    private static Map<String, Object> rating(String questionId) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("questionId", questionId);
        response.put("kind", "RATING");
        response.put("rating", 4);
        return response;
    }

    /**
     * 从内容包里取主测题号 —— 不写死题号，内容包换版时这条测试不会跟着烂掉。
     *
     * <p>2026-09-21 起 `/api/v3/catalog/*` 是公开的（`SecurityConfig` 单独 `permitAll`，
     * 见 `SecurityBoundaryIT#anonymousCanReadCatalog`），本条带会话只是为了复用已注册账号，
     * 不再是为了绕过 401。
     */
    private List<String> baseQuestionIds(RegisteredAccount account) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/catalog/current/package")
                .session(account.session())).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        List<String> ids = new ArrayList<>();
        JsonNode questions = body(result).path("questions");
        for (JsonNode question : questions) {
            if ("base".equals(question.path("stage").asText())) {
                ids.add(question.path("id").asText());
            }
        }
        return ids;
    }
}
