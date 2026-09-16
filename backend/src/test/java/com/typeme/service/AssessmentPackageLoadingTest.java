package com.typeme.service;

import com.typeme.model.AssessmentPackage;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import com.typeme.testsupport.ExcludeCrossModuleTestConfigs;
import org.springframework.test.context.ActiveProfiles;

/**
 * v2 内容包的**启动期行为**（字段规格 §1、§9；开发方案 §5.4）。
 *
 * <p>两个分支都要有断言，而且都由磁盘的真实状态决定：
 * <ul>
 *   <li><b>目录为空</b>：只打一条 {@code log.warn}，v1 照常启动，{@code /api/v2/...} 全部 404。
 *       这是刻意的——内容包 YAML 由另一个工作流撰写，在它落盘之前后端不能整个起不来。</li>
 *   <li><b>目录里有包</b>：每个已落盘的包都必须能被 {@link ContentService#findAssessmentPackage}
 *       取到，且 {@code packageId} 与请求一致。</li>
 * </ul>
 *
 * <p>⚠️ 本类**只读** {@code src/main/resources/assessment-packages/}：不写入、不改写、不删除，
 * 也不为了让断言通过而造占位文件。缺分支时用 {@link Assumptions} 明确跳过并打印实际状态。
 */
@ActiveProfiles("test")
@ExcludeCrossModuleTestConfigs
@SpringBootTest
@AutoConfigureMockMvc
class AssessmentPackageLoadingTest {

    /** 目录相对 {@code backend/}（`mvn test` 的工作目录）。 */
    private static final Path PACKAGE_DIR = Path.of("src", "main", "resources", "assessment-packages");

    /** 规格 §9 逐字规定的 404 响应体。 */
    private static final String NOT_FOUND_BODY =
            "{\"code\":\"ASSESSMENT_PACKAGE_NOT_FOUND\",\"message\":\"该版本暂不可用\"}";

    @Autowired
    private ContentService contentService;

    @Autowired
    private MockMvc mockMvc;

    private static List<Path> packageFiles() {
        if (!Files.isDirectory(PACKAGE_DIR)) {
            return List.of();
        }
        try (var stream = Files.list(PACKAGE_DIR)) {
            return stream.filter(path -> path.getFileName().toString().endsWith(".yml"))
                    .sorted()
                    .toList();
        } catch (Exception e) {
            throw new IllegalStateException("无法列出 " + PACKAGE_DIR.toAbsolutePath(), e);
        }
    }

    private static String originOf(Path path) {
        String name = path.getFileName().toString();
        return name.substring(0, name.length() - ".yml".length());
    }

    private static String body(MvcResult result) {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    /**
     * 本轮真实状态：包目录为空时，{@code ContentService} 不得因此启动失败，
     * v1 接口必须照常可用（这是「目录为空不阻止 v1 启动」的强断言）。
     */
    @Test
    @DisplayName("包目录为空 → v1 接口照常可用，v2 全部 404（启动不得被 v2 缺失拖死）")
    void emptyDirectoryDoesNotBlockV1Startup() throws Exception {
        Assumptions.assumeTrue(packageFiles().isEmpty(),
                () -> "包目录里已有 " + packageFiles().size() + " 个 YAML（并行任务已落盘），"
                        + "改由「已落盘包可被取到」那条断言覆盖");

        assertTrue(contentService.assessmentPackageIds().isEmpty(),
                "目录为空时不得凭空报出任何包 ID，实际 " + contentService.assessmentPackageIds());
        assertTrue(contentService.findAssessmentPackage("oejts32-zh1-report2").isEmpty(),
                "目录为空时按 ID 查必须为空");
        assertTrue(contentService.findAssessmentPackage(null).isEmpty(),
                "null 请求 ID 必须返回空，不得抛异常");

        // v1 完全不受影响
        mockMvc.perform(get("/api/v1/questionnaires/quick")).andExpect(status().isOk());

        for (String id : ContentService.ASSESSMENT_PACKAGE_IDS) {
            MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + id)).andReturn();
            assertEquals(404, result.getResponse().getStatus(),
                    id + " 在目录为空时必须 404，实际 " + result.getResponse().getStatus());
        }
    }

    /**
     * 并行任务已经把 YAML 落盘时的断言：每个文件都必须能被按 ID 取到，
     * 且响应体里的 {@code packageId} 与请求一致（字段规格 §9）。
     */
    @Test
    @DisplayName("已落盘的每个内容包都能被 findAssessmentPackage 取到，且 packageId 与请求一致")
    void everyPackageOnDiskIsResolvableById() throws Exception {
        List<Path> files = packageFiles();
        Assumptions.assumeTrue(!files.isEmpty(),
                "包目录为空（内容包 YAML 尚未落盘），本断言不成立，改由「目录为空不阻止 v1 启动」覆盖");

        List<String> registered = contentService.assessmentPackageIds();
        assertNotNull(registered);

        for (Path file : files) {
            String id = originOf(file);
            AssessmentPackage pkg = contentService.findAssessmentPackage(id).orElseThrow(() ->
                    new AssertionError("磁盘上有 " + file.getFileName() + "，但按 ID「" + id
                            + "」取不到：已注册的是 " + registered));
            assertEquals(id, pkg.packageId(), "响应里的 packageId 必须等于请求 ID");
            assertTrue(registered.contains(id),
                    "已加载的包必须出现在 assessmentPackageIds() 里，实际 " + registered);

            MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + id)).andReturn();
            assertEquals(200, result.getResponse().getStatus(),
                    id + " 已注册却拿不到 200，实际 " + result.getResponse().getStatus()
                            + " body=" + body(result));
            assertTrue(body(result).contains("\"packageId\":\"" + id + "\""),
                    "响应体必须带同一个 packageId，实际 " + body(result));
        }
    }

    @Test
    @DisplayName("已注册包全部来自白名单（白名单解析的前提）")
    void registeredPackagesAreWhitelisted() {
        for (String id : contentService.assessmentPackageIds()) {
            assertTrue(ContentService.ASSESSMENT_PACKAGE_IDS.contains(id),
                    "注册表里出现了白名单外的 ID: " + id);
        }
    }

    @ParameterizedTest(name = "未知/未注册的 packageId「{0}」→ 404 + 固定 JSON 体")
    @ValueSource(strings = {
            "nope",
            "oejts32-zh1-report3",
            "oejts32-zh2-preview",
            "oejts32-zh1-report2.yml",
            "OEJTS32-ZH1-REPORT2"})
    @DisplayName("未知 / 未注册的 packageId → 404，响应体逐字为规格 §9 的固定 JSON")
    void unknownPackageIs404WithFixedBody(String packageId) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v2/assessment-packages/" + packageId)).andReturn();

        assertEquals(404, result.getResponse().getStatus(),
                packageId + " 必须 404，实际 " + result.getResponse().getStatus() + " body=" + body(result));
        assertEquals(NOT_FOUND_BODY, body(result),
                "404 响应体必须逐字等于规格 §9 的固定 JSON");
        assertTrue(result.getResponse().getContentType() != null
                        && result.getResponse().getContentType().startsWith("application/json"),
                "404 也必须是 application/json，实际 " + result.getResponse().getContentType());
    }

    @Test
    @DisplayName("v2 接口是只读的：不存在写接口，URL 里也不含答案/分数概念")
    void packageApiIsReadOnly() throws Exception {
        // 任何非 GET 方法都不得被映射（405 / 404 皆可，但绝不接受写入）
        String path = "/api/v2/assessment-packages/oejts32-zh1-report2";
        java.util.Map<String, org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder> writes =
                new java.util.LinkedHashMap<>();
        writes.put("POST", post(path));
        writes.put("PUT", put(path));
        writes.put("DELETE", delete(path));
        for (var write : writes.entrySet()) {
            int status = mockMvc.perform(write.getValue()).andReturn().getResponse().getStatus();
            assertTrue(status == 405 || status == 404,
                    "v2 内容包接口不得有写方法，实际 " + write.getKey() + " → " + status);
        }

        // 未知 /api/v2 子路径不得被 SPA 回退成 HTML
        MvcResult result = mockMvc.perform(get("/api/v2/nope")).andReturn();
        assertEquals(404, result.getResponse().getStatus(), "未知 /api/v2 路径必须 404");
        assertTrue(!body(result).contains("<div id=\"app\">"), "未知 API 路径不得回退成前端页面");
    }
}
