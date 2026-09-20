package com.typeme.jung.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 跨模块**接缝**的回归防线：真实注册 → 真实会话 → 建测评。
 *
 * <p>这个类之所以存在，是因为 2026-09-16 的端到端实测发现了两个"单测全绿也漏掉"的缺陷，
 * 而它们**都只在"账号模块 + 新测模块"的接缝上出现**：
 *
 * <ol>
 *   <li><b>认证主体没有 {@code getUserId()}</b>：账号模块建立会话时主体是
 *       用户名字符串，而新测模块按约定反射取 {@code getUserId()}，取不到就退回
 *       {@code Authentication#getName()}（= username）。{@code app_user.id} 是 UUID，
 *       于是建测评撞外键 {@code fk_attempt_user}。
 *       测试没抓到的原因是集成测试普遍用 {@code @WithMockUser} 或自建假主体，
 *       <b>测试替生产代码履了约</b>。</li>
 *   <li><b>内容包从未播种</b>：{@code assessment_attempt.package_id} 外键指向
 *       {@code assessment_package}，而 {@code src/main} 里原先没有任何代码插入过该行，
 *       于是建测评撞外键 {@code fk_attempt_package}。
 *       测试没抓到的原因是<b>测试辅助代码自己会插这一行</b>。</li>
 * </ol>
 *
 * <p>所以本类刻意**不 mock 任何东西**：走真实的
 * {@code POST /api/v3/auth/register}（带真实 CSRF 与真实 SecurityFilterChain）建立会话，
 * 再用**同一个会话**去建测评。这样上面两条约定只要有一条断了，这里就会红。
 *
 * <p>注意本类**不**断言密码哈希长度之类的安全属性 ——
 * 测试档位把 {@code pbkdf2-iterations} 降到 1000（见基类说明），
 * 那类断言必须由 {@code PasswordEncoderParametersTest} 用生产默认值来做。
 */
class AssessmentCreationThroughRealSessionIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("注册后立刻能建测评（覆盖 getUserId 约定 + 内容包播种两条接缝）")
    void registeredUserCanCreateAttempt() throws Exception {
        String username = uniqueUsername("seam_probe");
        RegisteredAccount account = register(username, "Seam-Probe!2026");
        assertThat(account.status()).as("注册应成功").isEqualTo(201);
        assertThat(account.body().path("userId").asText())
                .as("注册响应必须带 userId")
                .isNotBlank();
        String userId = account.body().path("userId").asText();

        // 用注册时那个会话（已登录）建测评。CSRF 上下文要从同一会话取。
        CsrfContext csrf = csrf(account.session());
        var result = mockMvc.perform(withCsrf(post("/api/v3/attempts")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"), csrf))
                .andReturn();

        int status = result.getResponse().getStatus();
        String responseBody = result.getResponse().getContentAsString();

        // 明确区分三种失败，便于一眼看出是哪条约定断了。
        if (status == 500) {
            assertThat(responseBody)
                    .as("建测评 500。若是外键违例，看是 fk_attempt_user"
                            + "（主体没带 getUserId，把 username 当主键）"
                            + "还是 fk_attempt_package（内容包没播种）")
                    .doesNotContain("foreign key constraint fails");
        }
        assertThat(status)
                .as("建测评应返回 201，实际 %d，响应体：%s", status, responseBody)
                .isEqualTo(201);

        JsonNode created = body(result);
        assertThat(created.path("attemptId").asText()).isNotBlank();
        assertThat(created.path("packageId").asText())
                .as("内容包必须已播种，否则这里拿不到 packageId；新测评绑定的是当前默认包")
                .isEqualTo("typeme-jung48-zh-v3");

        // 关键一步：建出来的测评必须真的挂在**这个用户**名下。
        // 若主体没带 getUserId()，要么插入失败（撞外键），要么（在宽松的库里）
        // 挂到 username 这个不存在的 owner 上 —— 后者会让列表查不到自己的测评。
        var list = mockMvc.perform(get("/api/v3/attempts").session(account.session())).andReturn();
        assertThat(list.getResponse().getStatus()).isEqualTo(200);
        JsonNode listed = body(list);
        JsonNode items = listed.isArray() ? listed : listed.path("items");
        assertThat(items.isArray()).as("测评列表应为数组或含 items 数组").isTrue();
        assertThat(items.size())
                .as("刚建的测评必须出现在自己的列表里 —— 挂错 owner 时会查不到")
                .isEqualTo(1);
        assertThat(items.get(0).path("attemptId").asText())
                .isEqualTo(created.path("attemptId").asText());

        // 2026-09-17 新增的第三条接缝：**答题页真正要用的那个请求**。
        // 建测评成功不等于能答题 —— 前端首页按钮跳进 /assess 之后发的是
        // GET /attempts/{id}，它走 requireRow()（JdbcTemplate.queryForList →
        // ColumnMapRowMapper），时间列在 H2 上是 java.sql.Timestamp。
        // 当时那句直接强转在 MySQL 上通过、在 H2 上 500，而本类此前只建了测评就结束，
        // 所以"注册成功 → 一进答题页就报「这份测评没能载入」"漏到了真实浏览器里。
        var detail = mockMvc.perform(get("/api/v3/attempts/" + created.path("attemptId").asText())
                        .session(account.session()))
                .andReturn();
        assertThat(detail.getResponse().getStatus())
                .as("答题页必需的详情请求应返回 200，实际 %d，响应体：%s",
                        detail.getResponse().getStatus(), detail.getResponse().getContentAsString())
                .isEqualTo(200);
        JsonNode detailBody = body(detail);
        assertThat(detailBody.path("attemptId").asText()).isEqualTo(created.path("attemptId").asText());
        assertThat(detailBody.path("startedAt").asText())
                .as("时间字段必须是可序列化的 ISO-8601 字符串 —— 取回 Timestamp 时这里会变成空")
                .startsWith("20");
        assertThat(detailBody.path("updatedAt").asText()).startsWith("20");
        assertThat(detailBody.path("packageContent").path("questions").isArray())
                .as("详情必须带上题目快照（packageContent.questions），否则答题页无题可答")
                .isTrue();
        assertThat(detailBody.path("packageContent").path("questions").size())
                .as("主测 48 题 + 最多 16 道补充题都应随详情下发")
                .isGreaterThanOrEqualTo(48);

        // 换个用户不该看到别人的测评（owner 过滤真的按 id 生效）。
        RegisteredAccount other = register(uniqueUsername("seam_other"), "Seam-Other!2026");
        assertThat(other.status()).isEqualTo(201);
        assertThat(other.body().path("userId").asText())
                .as("两个账号的 userId 不应相同")
                .isNotEqualTo(userId);

        var otherList = mockMvc.perform(get("/api/v3/attempts").session(other.session())).andReturn();
        assertThat(otherList.getResponse().getStatus()).isEqualTo(200);
        JsonNode otherBody = body(otherList);
        JsonNode otherItems = otherBody.isArray() ? otherBody : otherBody.path("items");
        assertThat(otherItems.size())
                .as("另一个账号不该看到别人的测评")
                .isZero();
    }
}
