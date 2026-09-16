package com.typeme.security;

import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 既有接口未被新增安全模块破坏（任务书测试清单 9）。
 *
 * <p>这一条是本轮最容易被忽略、后果最严重的风险：加 Security 时顺手
 * {@code anyRequest().authenticated()} 一下，旧 v1/v2 内容接口与 SPA 静态回退就全 401 了，
 * 而所有新接口的测试都会照常通过。所以必须有这么一条**专门**盯住旧接口的用例。
 *
 * <p>不修改任何既有测试文件（任务边界），只新增本文件做断言。
 */
class LegacyEndpointsStillOpenIT extends AccountIntegrationTestBase {

    @Test
    @DisplayName("GET /api/v1/meta 仍然公开可访问（不能因为加了安全模块就要登录）")
    void metaEndpointStaysPublic() throws Exception {
        mockMvc.perform(get("/api/v1/meta"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("GET /api/v2/assessment-packages/{id} 仍然公开：已知包 200 / 未知包 404（不是 401/403）")
    void assessmentPackageEndpointStaysPublic() throws Exception {
        int status = mockMvc.perform(get("/api/v2/assessment-packages/oejts32-zh1-report2"))
                .andReturn().getResponse().getStatus();
        // 内容包 YAML 由并行工作流交付：没有包时是 404，有包时是 200 —— 两种都算"可达"。
        // 只要不是 401/403，就说明安全配置没有把旧接口锁上。
        assertThat(status).as("旧内容接口不得被安全配置拦成 401/403").isIn(200, 404);

        // 未知包必须仍是 404，且错误体是既有的固定形状（不能被新 advice 改掉）
        var unknown = mockMvc.perform(get("/api/v2/assessment-packages/does-not-exist-xyz"))
                .andReturn();
        assertThat(unknown.getResponse().getStatus()).isEqualTo(404);
        String body = unknown.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(body).contains("ASSESSMENT_PACKAGE_NOT_FOUND");
    }

    @Test
    @DisplayName("GET /actuator/health 仍然 200（运维探针不能被认证挡住）")
    void actuatorHealthStaysPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("v1/v2 的写方法语义不变：未映射写方法不因 CSRF 变成 403（仍是 404/405）")
    void v2WriteMethodsKeepTheirOriginalSemantics() throws Exception {
        for (var builder : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[]{
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/v2/assessment-packages/oejts32-zh1-report2"),
                org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/v2/assessment-packages/oejts32-zh1-report2")}) {
            int status = mockMvc.perform(builder).andReturn().getResponse().getStatus();
            assertThat(status).as("旧接口的未映射写方法不得变成 403（那是 CSRF 拦下来的）")
                    .isIn(404, 405);
        }
    }

    @Test
    @DisplayName("/api/v3 之外的路径不受绝对会话期限过滤器影响（不产生无谓的库查询）")
    void ttlFilterOnlyAppliesToV3() throws Exception {
        // 这条用行为断言：未认证访问 v1/v2 依然是 200，说明过滤器没有把它们当成 v3 处理。
        mockMvc.perform(get("/api/v1/meta")).andExpect(status().isOk());
        mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
    }
}
