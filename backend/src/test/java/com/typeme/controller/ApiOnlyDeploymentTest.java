package com.typeme.controller;

import com.typeme.testsupport.ExcludeCrossModuleTestConfigs;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 前后端分开部署（{@code mvn -P api-only package}）：jar 里没有任何前端页面。
 *
 * <p>这里用「静态目录指向一个不存在的位置」模拟 api-only 的 jar。要钉住的是两件事：
 * ① 接口完全不受影响（注册链路要用到的 csrf / captcha 照常工作）；
 * ② 页面路径是干净的 404，而不是 500 或把别的东西当页面返回——页面由 Nginx 提供，
 *    后端不该假装拥有它。
 */
@ActiveProfiles("test")
@ExcludeCrossModuleTestConfigs
@SpringBootTest
@AutoConfigureMockMvc
class ApiOnlyDeploymentTest {

    @DynamicPropertySource
    static void noFrontendBundled(DynamicPropertyRegistry registry) {
        registry.add("spring.web.resources.static-locations", () -> "classpath:/api-only-no-frontend/");
    }

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("没有前端产物时，页面路径与静态资源都是 404")
    void pagesAreNotFound() throws Exception {
        // 不测 "/"：它由 Boot 的欢迎页映射以 forward 处理，MockMvc 的 ServletContext 会在类路径根上
        // 额外找 index.html，结果和真实 jar 不同；"jar 里没有 static/index.html" 由打包后检查 jar 内容来证明。
        for (String path : new String[]{"/index.html", "/register", "/assets/app.js"}) {
            var response = mockMvc.perform(get(path)).andReturn().getResponse();
            org.junit.jupiter.api.Assertions.assertEquals(404, response.getStatus(),
                    path + " 应为 404，forwardedUrl=" + response.getForwardedUrl());
        }
    }

    @Test
    @DisplayName("没有前端产物时，注册链路用到的接口照常工作")
    void apiStillWorks() throws Exception {
        mockMvc.perform(get("/api/v3/auth/csrf")).andExpect(status().isOk());
        mockMvc.perform(get("/api/v3/auth/captcha"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.image").value(org.hamcrest.Matchers.startsWith("data:image/png;base64,")));
    }
}
