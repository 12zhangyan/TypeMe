package com.typeme.jung.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 乐观锁的**真正语义**：同一个 {@code expectedRevision} 只允许一个写入者成功。
 *
 * <p>这个类盯的是一个很隐蔽的缺陷（2026-09-17 第 15 轮发现）：
 * {@code AttemptService.patchAnswers} 丢弃了 UPDATE 的受影响行数，改用
 * "再查一次 {@code COUNT(*) WHERE revision = currentRevision + 1}" 来判断自己有没有成功。
 * 但那个 COUNT 只能证明**有人**把 revision 推到了该值 —— 而这个人完全可能是**另一个**
 * 并发/连发的请求。于是两个请求可以都拿到 200。
 *
 * <p><b>为什么这条用例是决定性的</b>：它**不需要真并发**。第二次调用读到的
 * {@code currentRevision} 已经是被上一次提交推高后的值，于是
 * {@code newRevision = 上一轮 + 1} 恰好等于库里的现值，COUNT 必然 &gt; 0，
 * "自己没改成功"这件事就被掩盖成成功。所以它稳定复现，而不是一条看运气的 flaky 用例。
 *
 * <p>只有 409 才能让客户端知道"我这次没写上去"，前端也正是靠它来避免把
 * 未落库的作答显示成「已保存」。
 */
class AnswerRevisionConflictIT extends AccountIntegrationTestBase {

    /**
     * 直接改库用：本类要制造"对手抢先提交"的效果，而服务层接口无法从外部制造它。
     * 只用于测试夹具，不参与生产代码。
     */
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("同一个 expectedRevision 的第二次写入必须被拒（乐观锁不能被 COUNT 冒充）")
    void staleRevisionIsRejectedEvenWhenAnotherRequestAlreadyBumpedIt() throws Exception {
        RegisteredAccount account = register(uniqueUsername("rev_probe"), "Rev-Probe!2026");
        assertThat(account.status()).as("注册应成功").isEqualTo(201);
        CsrfContext csrf = csrf(account.session());

        // 建测评
        var created = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        assertThat(created.getResponse().getStatus())
                .as("建测评应 201，实际 %s", created.getResponse().getContentAsString())
                .isEqualTo(201);
        String attemptId = body(created).path("attemptId").asText();

        // 取两道主测题（题目快照随详情下发）
        var detail = mockMvc.perform(get("/api/v3/attempts/" + attemptId).session(account.session()))
                .andReturn();
        assertThat(detail.getResponse().getStatus()).isEqualTo(200);
        JsonNode questions = body(detail).path("packageContent").path("questions");
        assertThat(questions.isArray()).isTrue();
        List<String> baseIds = new java.util.ArrayList<>();
        for (JsonNode question : questions) {
            if ("BASE".equalsIgnoreCase(question.path("stage").asText())) {
                baseIds.add(question.path("id").asText());
            }
        }
        assertThat(baseIds.size()).as("应至少有 2 道主测题").isGreaterThanOrEqualTo(2);

        long startRevision = body(detail).path("revision").asLong(0);

        // 第一次写入：用 startRevision，必须成功
        var first = mockMvc.perform(withCsrf(patch("/api/v3/attempts/" + attemptId + "/answers")
                .session(account.session())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of(
                        "expectedRevision", startRevision,
                        "currentQuestionId", baseIds.get(0),
                        "responses", List.of(Map.of(
                                "questionId", baseIds.get(0), "kind", "RATING", "rating", 5))))), csrf))
                .andReturn();
        assertThat(first.getResponse().getStatus())
                .as("第一次写入应成功，实际 %s", first.getResponse().getContentAsString())
                .isEqualTo(200);
        long revisionAfterFirst = body(first).path("revision").asLong();

        // 第二次写入：**仍然用 startRevision**（模拟连发/另一台设备），必须被拒。
        //
        // 这里就是那条缺陷：实现会把它判成成功，因为库里 revision 已经等于
        // startRevision + 1，而它无法分辨那是**上一次**提交推上去的。
        var second = mockMvc.perform(withCsrf(patch("/api/v3/attempts/" + attemptId + "/answers")
                .session(account.session())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of(
                        "expectedRevision", startRevision,
                        "currentQuestionId", baseIds.get(1),
                        "responses", List.of(Map.of(
                                "questionId", baseIds.get(1), "kind", "RATING", "rating", 1))))), csrf))
                .andReturn();

        int secondStatus = second.getResponse().getStatus();
        assertThat(secondStatus)
                .as("过期的 expectedRevision 必须被拒（409），否则前端会把未落库的作答显示成「已保存」。"
                        + "实际 %d，响应体：%s", secondStatus, second.getResponse().getContentAsString())
                .isEqualTo(409);
        assertThat(body(second).path("code").asText())
                .as("必须是 revision 冲突这个码，前端靠它分支")
                .isEqualTo("CONFLICT_REVISION");

        // 被拒的这次不能把 revision 再推高，否则每次重试都比上一次更错
        var after = mockMvc.perform(get("/api/v3/attempts/" + attemptId).session(account.session()))
                .andReturn();
        assertThat(body(after).path("revision").asLong())
                .as("被拒的写入不应改变 revision")
                .isEqualTo(revisionAfterFirst);
    }

    @Test
    @DisplayName("带对 revision 的写入仍然成功（别把乐观锁修成一律拒绝）")
    void freshRevisionStillSucceeds() throws Exception {
        RegisteredAccount account = register(uniqueUsername("rev_ok"), "Rev-Ok!2026");
        assertThat(account.status()).isEqualTo(201);
        CsrfContext csrf = csrf(account.session());

        var created = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        String attemptId = body(created).path("attemptId").asText();
        var detail = mockMvc.perform(get("/api/v3/attempts/" + attemptId).session(account.session()))
                .andReturn();
        JsonNode questions = body(detail).path("packageContent").path("questions");
        String questionId = questions.get(0).path("id").asText();
        long revision = body(detail).path("revision").asLong(0);

        // 连续两次写入，每次都带**刚拿到的** revision：都应成功
        for (int round = 0; round < 2; round++) {
            var patched = mockMvc.perform(withCsrf(patch("/api/v3/attempts/" + attemptId + "/answers")
                    .session(account.session())
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of(
                            "expectedRevision", revision,
                            "currentQuestionId", questionId,
                            "responses", List.of(Map.of(
                                    "questionId", questionId, "kind", "RATING", "rating", 3))))), csrf))
                    .andReturn();
            assertThat(patched.getResponse().getStatus())
                    .as("第 %d 次带当前 revision 的写入应成功，实际 %s",
                            round + 1, patched.getResponse().getContentAsString())
                    .isEqualTo(200);
            revision = body(patched).path("revision").asLong();
        }
    }

    /**
     * 确定性复现那条"劣质冲突检测"。
     *
     * <p>真并发在 H2 + MockMvc 下不好稳定触发，但这个缺陷**不需要真并发**：
     * 并发对手抢先提交的效果，等价于"在本请求 UPDATE 生效之前，revision 已经被别人
     * 推到了本请求将要写的那个值"。用 MockMvc 的 {@code RequestPostProcessor}
     * 可以精确制造这一点 —— 它在请求进入控制器**之前**执行，也就是正好卡在
     * 服务层读 {@code currentRevision} 之前。
     *
     * <p>于是服务端读到 {@code currentRevision = N}，算出 {@code newRevision = N+1}，
     * 但库里的 revision **已经是** N+1（对手写的），UPDATE 影响 0 行。
     * 旧实现随后 {@code COUNT(*) WHERE revision = N+1} 会数到对手那一行，
     * 误判自己写成功并返回 200；正确实现必须看自己 UPDATE 的受影响行数，返回 409。
     */
    @Test
    @DisplayName("别人抢先提交到同一版号时本请求必须 409（受影响行数不能被 COUNT 冒充）")
    void concurrentWriterAtSameRevisionIsDetected() throws Exception {
        RegisteredAccount account = register(uniqueUsername("rev_race"), "Rev-Race!2026");
        assertThat(account.status()).isEqualTo(201);
        CsrfContext csrf = csrf(account.session());

        var created = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf)).andReturn();
        String attemptId = body(created).path("attemptId").asText();

        var detail = mockMvc.perform(get("/api/v3/attempts/" + attemptId).session(account.session()))
                .andReturn();
        JsonNode questions = body(detail).path("packageContent").path("questions");
        String questionId = questions.get(0).path("id").asText();
        long startRevision = body(detail).path("revision").asLong(0);

        // 请求进入控制器之前，让"对手"把 revision 抢先推到 startRevision + 1。
        var patched = mockMvc.perform(withCsrf(patch("/api/v3/attempts/" + attemptId + "/answers")
                .session(account.session())
                .contentType(MediaType.APPLICATION_JSON)
                .with(request -> {
                    jdbc.update("UPDATE assessment_attempt SET revision = ? WHERE id = ?",
                            startRevision + 1, attemptId);
                    return request;
                })
                .content(json(Map.of(
                        "expectedRevision", startRevision,
                        "currentQuestionId", questionId,
                        "responses", List.of(Map.of(
                                "questionId", questionId, "kind", "RATING", "rating", 4))))), csrf))
                .andReturn();

        assertThat(patched.getResponse().getStatus())
                .as("revision 已被别人占先，本请求一行都没改到，必须 409。"
                        + "旧实现会 COUNT 到别人的写入而返回 200。实际 %d，响应体：%s",
                        patched.getResponse().getStatus(), patched.getResponse().getContentAsString())
                .isEqualTo(409);
        assertThat(body(patched).path("code").asText())
                .as("必须是 revision 冲突这个码")
                .isEqualTo("CONFLICT_REVISION");

        // 关键：这一次被拒的请求不能把答案写进去。
        var after = mockMvc.perform(get("/api/v3/attempts/" + attemptId).session(account.session()))
                .andReturn();
        JsonNode answers = body(after).path("answers");
        assertThat(answers.isArray() ? answers.size() : -1)
                .as("被拒的写入不得留下任何答案，实际 %s", answers)
                .isZero();
    }
}
