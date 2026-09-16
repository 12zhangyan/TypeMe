package com.typeme.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.typeme.model.AssessmentPackage;
import com.typeme.service.ContentService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@code GET /api/v2/assessment-packages/{packageId}} 的控制器契约测试。
 *
 * <p>用 **standalone MockMvc** + 桩 {@link ContentService}：
 * 这样「命中 200」「未知包 404」「服务异常 500」三条路径都能确定性地跑，
 * 不受磁盘上是否已有内容包 YAML 影响（那些文件由另一个工作流拥有）。
 *
 * <p>与 {@link AssessmentPackageLoadingTest} 的分工：那边用真实 Spring 上下文验证
 * 启动期加载与白名单解析，这边只验证控制器自己的响应写法与固定错误体。
 */
class AssessmentPackageControllerTest {

    private static final String PACKAGE_ID = "oejts32-zh1-report2";

    /** 规格 §9 逐字规定的两个错误体。 */
    private static final String NOT_FOUND_BODY =
            "{\"code\":\"ASSESSMENT_PACKAGE_NOT_FOUND\",\"message\":\"该版本暂不可用\"}";
    private static final String UNAVAILABLE_BODY =
            "{\"code\":\"CONTENT_UNAVAILABLE\",\"message\":\"内容暂时不可用\"}";

    private static final ObjectMapper YAML = new YAMLMapper();

    /**
     * 桩 ContentService：只覆写本测试需要的两个只读方法。
     *
     * <p>直接继承 {@link ContentService}（而不是用 Mockito 生成子类）是刻意的：
     * {@code ContentService} 的构造器是纯函数式的（不做校验），传一个空 ResourceLoader
     * 就够用，而且不引入任何测试库魔法。
     */
    private static final class StubContentService extends ContentService {

        private final AssessmentPackage pkg;

        StubContentService(AssessmentPackage pkg) {
            super(new org.springframework.core.io.DefaultResourceLoader());
            this.pkg = pkg;
        }

        @Override
        public java.util.Optional<AssessmentPackage> findAssessmentPackage(String packageId) {
            if (packageId != null && packageId.equals("boom")) {
                throw new IllegalStateException(
                        "无法扫描内容包资源 classpath*:assessment-packages/*.yml —— 内部路径必须不外泄");
            }
            return pkg != null && pkg.packageId().equals(packageId)
                    ? java.util.Optional.of(pkg)
                    : java.util.Optional.empty();
        }
    }

    private static AssessmentPackage fixturePackage() {
        return YAML.convertValue(
                com.typeme.service.AssessmentPackageValidationTest.validFixture(),
                AssessmentPackage.class);
    }

    private static MockMvc mockMvcFor(AssessmentPackage pkg) {
        return MockMvcBuilders
                .standaloneSetup(new AssessmentPackageController(new StubContentService(pkg)))
                .build();
    }

    private static String body(MvcResult result) throws Exception {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------ 200

    @Test
    @DisplayName("命中：200 + application/json + 完整包对象（题面、帮助、维度解释、报告文案、解释政策）")
    void returnsPackageWithJsonContentType() throws Exception {
        AssessmentPackage pkg = fixturePackage();
        MockMvc mockMvc = mockMvcFor(pkg);

        MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + PACKAGE_ID))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.schemaVersion").value(2))
                .andExpect(jsonPath("$.packageId").value(PACKAGE_ID))
                .andExpect(jsonPath("$.locale").value("zh-CN"))
                .andExpect(jsonPath("$.contentStatus").value("draft"))
                .andExpect(jsonPath("$.instrument.id").value("oejts32"))
                .andExpect(jsonPath("$.instrument.revision").value("1.2"))
                .andExpect(jsonPath("$.instrument.scoringVersion").value("oejts-1.2"))
                .andExpect(jsonPath("$.interpretation.version").value("typeme-conservative-v2"))
                .andExpect(jsonPath("$.interpretation.minRatingsPerDimension").value(8))
                .andExpect(jsonPath("$.interpretation.typeMinDistance").value(5))
                .andExpect(jsonPath("$.interpretation.markedDistance").value(9))
                .andExpect(jsonPath("$.estimatedMinutes").value(5))
                .andExpect(jsonPath("$.questionnaire.questionCount").value(32))
                .andExpect(jsonPath("$.questionnaire.questions.length()").value(32))
                .andExpect(jsonPath("$.itemHelp.length()").value(32))
                .andExpect(jsonPath("$.itemHelp['1'].explanation").isNotEmpty())
                .andExpect(jsonPath("$.itemHelp['1'].reviewStatus").value("draft"))
                .andExpect(jsonPath("$.dimensionCopy.EI.name").value("精力方向"))
                .andExpect(jsonPath("$.dimensionCopy.SN.negative.label").value("实感"))
                .andExpect(jsonPath("$.dimensionCopy.TF.positive.label").value("思考"))
                .andExpect(jsonPath("$.dimensionCopy.JP.balanced.summary").isNotEmpty())
                .andExpect(jsonPath("$.dimensionCopy.JP.insufficient.nextStep").isNotEmpty())
                .andExpect(jsonPath("$.reportCopy.typedTitle").value("本次问卷参考组合"))
                .andExpect(jsonPath("$.reportCopy.selfReflectionLead").isNotEmpty())
                .andExpect(jsonPath("$.nextSteps.length()").value(3))
                .andExpect(jsonPath("$.attribution.license").value("CC BY-NC-SA 4.0"))
                .andReturn();

        String json = body(result);
        assertTrue(json.contains("\"textLeft\":\"夹具左端1\""), json.substring(0, Math.min(400, json.length())));
    }

    // ------------------------------------------------------------------ 404

    @Test
    @DisplayName("未知 / 未注册包：404 + 逐字等于规格 §9 的 JSON 体 + application/json")
    void unknownPackageReturnsFixed404Body() throws Exception {
        MockMvc mockMvc = mockMvcFor(fixturePackage());

        for (String unknown : new String[]{"nope", "oejts32-zh2-preview", "oejts32-zh1-report2.yml"}) {
            MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + unknown))
                    .andExpect(status().isNotFound())
                    .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                    .andReturn();
            assertEquals(NOT_FOUND_BODY, body(result),
                    unknown + " 的响应体必须逐字等于规格 §9 的固定 JSON");
        }
    }

    @Test
    @DisplayName("目录为空（桩服务没有任何包）：所有请求都是 404，绝不 500 或 HTML")
    void emptyRegistryReturns404ForEverything() throws Exception {
        MockMvc mockMvc = mockMvcFor(null);

        for (String id : ContentService.ASSESSMENT_PACKAGE_IDS) {
            MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + id))
                    .andExpect(status().isNotFound())
                    .andReturn();
            assertEquals(NOT_FOUND_BODY, body(result),
                    "没有内容包时 " + id + " 必须是固定 404 体，不能 500");
        }
    }

    // ------------------------------------------------------------------ 500

    @Test
    @DisplayName("服务异常：500 + 逐字等于规格 §9 的 JSON 体，且不回传路径/堆栈/异常消息")
    void serviceFailureReturnsFixed500BodyWithoutLeakingDetails() throws Exception {
        MockMvc mockMvc = mockMvcFor(fixturePackage());

        MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/boom"))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn();

        String json = body(result);
        assertEquals(UNAVAILABLE_BODY, json, "500 响应体必须逐字等于规格 §9 的固定 JSON");
        assertTrue(!json.contains("classpath"), "500 响应不得回传 classpath 路径：" + json);
        assertTrue(!json.contains("assessment-packages"), "500 响应不得回传资源路径：" + json);
        assertTrue(!json.contains("IllegalStateException"), "500 响应不得回传异常类型：" + json);
        assertTrue(!json.contains("无法扫描"), "500 响应不得回传异常消息：" + json);
    }

    // ------------------------------------------------------------------ 只读与外观

    @Test
    @DisplayName("只读：响应只声明 GET，且没有任何写方法映射")
    void onlyGetIsMapped() throws Exception {
        MockMvc mockMvc = mockMvcFor(fixturePackage());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .post("/api/v2/assessment-packages/" + PACKAGE_ID))
                .andExpect(status().isMethodNotAllowed());
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .put("/api/v2/assessment-packages/" + PACKAGE_ID))
                .andExpect(status().isMethodNotAllowed());
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/v2/assessment-packages/" + PACKAGE_ID))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    @DisplayName("返回的包不携带任何答案/分数概念：包对象里只有内容与政策")
    void packageCarriesNoAnswersOrScores() throws Exception {
        MockMvc mockMvc = mockMvcFor(fixturePackage());

        MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + PACKAGE_ID))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type",
                        org.hamcrest.Matchers.startsWith(MediaType.APPLICATION_JSON_VALUE)))
                .andReturn();

        String json = body(result);
        for (String forbidden : new String[]{"\"answers\"", "\"responses\"", "\"score\":", "\"scores\"",
                "\"ratings\"", "\"sessionId\"", "\"typeCode\""}) {
            assertTrue(!json.contains(forbidden),
                    "内容包响应不得包含 " + forbidden + "（本接口不接收也不回传任何答案/分数/类型断言）");
        }
        assertNotNull(json);
    }
}
