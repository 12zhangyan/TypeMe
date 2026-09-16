package com.typeme.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 接口契约（任务拆解 1.4）与 SPA 路由回退（ADR-5）的集成测试。
 *
 * <p>用 MockMvc 起真实上下文：ContentService 会真的去读 classpath 上的内容并做硬断言，
 * 所以这个测试同时也验证了「真实内容能启动」。
 *
 * <p>⚠️ 本类用**测试夹具** {@code classpath:/spa-fixture/index.html} 作为 SPA 回退目标
 * （IM-3）：静态目录被显式指到夹具目录，所以本类验证的是**回退规则**本身，与前端产物是否
 * 构建过无关。真实产物的可用性由 {@link RealArtifactSpaRoutingTest} 单独断言——
 * 早先夹具放在 {@code src/test/resources/static/} 时会盖住 {@code target/classes/static}，
 * 让「后端产物里没有前端页面」这个真实缺陷完全不可见。
 */
@SpringBootTest
@AutoConfigureMockMvc
class SpaRoutingTest {

    /**
     * 把静态资源根目录显式指到夹具目录（IM-3）。
     *
     * <p>夹具放在 {@code classpath:/spa-fixture/} 而不是 {@code classpath:/static/}，
     * 这样它不会盖住 {@code target/classes/static} 里的真实产物；本类只验证**回退规则**，
     * 真实产物的可用性由 {@link RealArtifactSpaRoutingTest} 单独断言。
     */
    @DynamicPropertySource
    static void staticLocations(DynamicPropertyRegistry registry) {
        registry.add("spring.web.resources.static-locations",
                () -> "classpath:/spa-fixture/,classpath:/META-INF/resources/,classpath:/resources/,"
                        + "classpath:/static/,classpath:/public/");
    }

    private static final String SPA_FIXTURE_MARKER = "TypeMe-SPA-Fixture";

    @Autowired
    private MockMvc mockMvc;

    private String body(MvcResult result) {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private static String head(String json) {
        return json.length() <= 400 ? json : json.substring(0, 400);
    }

    // ------------------------------------------------------------------ 1.4 的端点

    @Test
    @DisplayName("GET /api/v1/meta：版本、题库版本列表与署名信息齐全")
    void metaEndpoint() throws Exception {
        mockMvc.perform(get("/api/v1/meta"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.appVersion").value("1.0.0"))
                .andExpect(jsonPath("$.contentVersion").value("2026-09-01"))
                .andExpect(jsonPath("$.questionnaireVersions[0]").value("quick"))
                .andExpect(jsonPath("$.attribution.source")
                        .value("Open Extended Jungian Type Scales (OEJTS) 1.2"))
                .andExpect(jsonPath("$.attribution.author").value("Eric Jorgenson"))
                .andExpect(jsonPath("$.attribution.url")
                        .value("https://openpsychometrics.org/tests/OEJTS/"))
                .andExpect(jsonPath("$.attribution.license").value("CC BY-NC-SA 4.0"))
                .andExpect(jsonPath("$.attribution.licenseUrl")
                        .value("https://creativecommons.org/licenses/by-nc-sa/4.0/"));
    }

    @Test
    @DisplayName("GET /api/v1/questionnaires/quick：返回体能原样驱动计分（32 题、常量、符号）")
    void questionnaireEndpoint() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/questionnaires/quick"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("quick"))
                .andExpect(jsonPath("$.questionCount").value(32))
                .andExpect(jsonPath("$.estimatedMinutes").value(5))
                .andExpect(jsonPath("$.scoring.midpoint").value(24))
                .andExpect(jsonPath("$.scoring.constants.EI").value(30))
                .andExpect(jsonPath("$.scoring.constants.SN").value(12))
                .andExpect(jsonPath("$.scoring.constants.TF").value(30))
                .andExpect(jsonPath("$.scoring.constants.JP").value(18))
                .andExpect(jsonPath("$.questions.length()").value(32))
                .andExpect(jsonPath("$.questions[0].id").value(1))
                .andExpect(jsonPath("$.questions[0].dimension").value("JP"))
                .andExpect(jsonPath("$.questions[0].direction").value(1))
                .andReturn();

        // 中文一律用原始字节比对，避免依赖 MockHttpServletResponse 的默认字符集
        String json = body(result);
        assertTrue(json.contains("\"title\":\"快速版\""), head(json));
        assertTrue(json.contains("\"textLeft\":\"喜欢列清单\""), head(json));
        assertTrue(json.contains("\"textRight\":\"凭记忆\""), head(json));
    }

    @Test
    @DisplayName("GET /api/v1/method：署名与五个小节（任务拆解 1.3 的 4 节 + BK-3 的致谢与参考文献）")
    void methodEndpoint() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/method"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.attribution.license").value("CC BY-NC-SA 4.0"))
                .andExpect(jsonPath("$.sections.length()").value(5))
                .andReturn();

        String json = body(result);
        assertTrue(json.contains("\"title\":\"题库来源与许可\""), head(json));
        assertTrue(json.contains("\"title\":\"计分方法\""), head(json));
        assertTrue(json.contains("\"title\":\"为什么 S–N 维度测不准\""), head(json));
        assertTrue(json.contains("\"title\":\"免责声明\""), head(json));
        assertTrue(json.contains("\"title\":\"致谢与参考文献\""), head(json));
    }

    @Test
    @DisplayName("GET /actuator/health 可用，且只暴露 health")
    void healthEndpoint() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    @DisplayName("MI-11：实测并锁定未暴露 actuator 路径的行为（与 WebConfig javadoc 一致）")
    void unexposedActuatorPathsBehaveAsDocumented() throws Exception {
        for (String path : new String[]{"/actuator", "/actuator/", "/actuator/nope", "/actuator/env", "/actuator/health"}) {
            int status = mockMvc.perform(get(path)).andReturn().getResponse().getStatus();
            System.out.println("[MT-ACTUATOR] " + path + " -> " + status);
        }
        // 只有显式暴露的端点能被访问
        mockMvc.perform(get("/actuator/health")).andExpect(status().isOk());
        // 未暴露的端点即使存在也不能访问
        mockMvc.perform(get("/actuator/env")).andExpect(status().isNotFound());
        // 与 API 一样，未知 actuator 子路径不得被 SPA 回退成 index.html
        MvcResult unknown = mockMvc.perform(get("/actuator/nope")).andReturn();
        assertEquals(404, unknown.getResponse().getStatus(),
                "/actuator/nope 必须 404，不能回退成前端页面");
        assertTrue(!body(unknown).contains(SPA_FIXTURE_MARKER),
                "/actuator/nope 不得返回前端 index.html");
    }

    @Test
    @DisplayName("MI-4：types.yml 是硬依赖——16 个类型码必须全部可用")
    void typesAreHardDependencyAndAllSixteenResolve() throws Exception {
        for (String code : new String[]{
                "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
                "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP"}) {
            mockMvc.perform(get("/api/v1/types/" + code))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(code));
        }
    }

    // ------------------------------------------------------------------ 404 边界

    @Test
    @DisplayName("未知题库版本 / 未交付的 standard → 404，绝不能返回 HTML")
    void unknownQuestionnaireIs404() throws Exception {
        mockMvc.perform(get("/api/v1/questionnaires/standard")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/questionnaires/nope")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("未知类型码 → 404")
    void unknownTypeIs404() throws Exception {
        mockMvc.perform(get("/api/v1/types/ZZZZ")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("类型接口与 types.yml 的存在保持一致——现在文件是硬依赖，必须全部可用")
    void typesEndpointMatchesTypesFilePresence() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/types/INFP")).andReturn();
        // types.yml 缺失时 ContentService 会直接让启动失败，所以测试能跑到这里就说明文件在。
        assertEquals(200, result.getResponse().getStatus(), "types.yml 存在时类型接口必须可用");
        assertTrue(body(result).contains("INFP"), body(result));
    }

    // ------------------------------------------------------------------ SPA 回退

    @Test
    @DisplayName("前端路由回退到 index.html（/quiz、/result、/about）")
    void spaRoutesFallBackToIndexHtml() throws Exception {
        for (String route : new String[]{"/quiz", "/result", "/about"}) {
            MvcResult result = mockMvc.perform(get(route))
                    .andExpect(status().isOk())
                    .andReturn();
            assertTrue(body(result).contains(SPA_FIXTURE_MARKER),
                    route + " 应回退到 index.html，实际返回：" + head(body(result)));
        }
    }

    @Test
    @DisplayName("根路径 / 也能拿到 index.html")
    void rootServesIndexHtml() throws Exception {
        MvcResult result = mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andReturn();
        // 「/」由 Spring Boot 的 WelcomePageHandlerMapping 以 forward 处理，
        // MockMvc 不跟随 forward，所以这里校验转发目标；其余前端路由走 WebConfig 的回退。
        String forwarded = result.getResponse().getForwardedUrl();
        String body = body(result);
        assertTrue((forwarded != null && forwarded.contains("index.html")) || body.contains(SPA_FIXTURE_MARKER),
                "/ 应落到 index.html，forwardedUrl=" + forwarded + " body=" + head(body));
    }

    @Test
    @DisplayName("SPA 回退不得吃掉 API：未知 /api/** 仍是 404")
    void spaFallbackDoesNotSwallowApi() throws Exception {
        mockMvc.perform(get("/api/v1/nope")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api")).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("缺失的静态资源返回 404，而不是把 index.html 当 JS 回给浏览器")
    void missingStaticAssetIs404() throws Exception {
        mockMvc.perform(get("/assets/missing.js")).andExpect(status().isNotFound());
        mockMvc.perform(get("/favicon.ico")).andExpect(status().isNotFound());
    }
}
