package com.typeme.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * IM-3：**不带夹具**地验证后端产物里真的有前端页面。
 *
 * <p>背景：早先 {@code src/test/resources/static/index.html} 这个夹具会盖住
 * {@code target/classes/static}，于是「Maven 构建根本没把 {@code frontend/dist} 搬进产物」
 * 这个缺陷在测试里完全不可见 —— 用不含 test-classes 的 classpath 起真实上下文时，
 * {@code /}、{@code /quiz}、{@code /result}、{@code /about}、{@code /assets/*.js} 全 404。
 *
 * <p>本类**不做任何 static-locations 覆盖**，走的就是生产配置（{@code classpath:/static/}），
 * 因此它读到的必须是 {@code maven-resources-plugin} 从 {@code frontend/dist} 复制过来的真实产物。
 * 夹具已被移到 {@code classpath:/spa-fixture/}，不再参与本类的解析。
 *
 * <p>若这条测试红了，先看 {@code frontend/dist} 是否存在；
 * 正常的构建顺序是：前端 {@code npm run build} → 后端 {@code mvn test}。
 */
@SpringBootTest
@AutoConfigureMockMvc
class RealArtifactSpaRoutingTest {

    /** 测试夹具的标记串：真实产物里绝不能出现它（出现就说明又被夹具盖住了）。 */
    private static final String SPA_FIXTURE_MARKER = "TypeMe-SPA-Fixture";

    /** 真实产物里脚本/样式的引用（Vite 默认把 hash 写进文件名，所以只比前缀）。 */
    private static final Pattern ASSET_HREF = Pattern.compile("(?:src|href)=\"\\.?/?(assets/[^\"]+)\"");

    @Autowired
    private MockMvc mockMvc;

    private static String body(MvcResult result) throws Exception {
        return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
    }

    private static String head(String text) {
        return text.length() <= 300 ? text : text.substring(0, 300);
    }

    @Test
    @DisplayName("IM-3：GET / 返回**真实**前端 index.html（不是夹具、不是 404）")
    void rootServesRealFrontendIndexHtml() throws Exception {
        MvcResult result = mockMvc.perform(get("/"))
                .andExpect(status().isOk())
                .andReturn();

        // 「/」由 WelcomePageHandlerMapping 以 forward 处理，MockMvc 不跟随 forward，
        // 所以先看转发目标；真实产物应当被 forward 到 static/index.html。
        String forwarded = result.getResponse().getForwardedUrl();
        String body = body(result);
        String observed = forwarded != null ? forwarded : "（无 forward，直接返回正文）" + head(body);

        assertTrue(forwarded != null && forwarded.contains("index.html"),
                "/ 必须被 forward 到真实 index.html，实际 forwardedUrl=" + observed);

        // 再独立取一次正文，确认内容确实是前端产物而不是夹具
        MvcResult direct = mockMvc.perform(get("/index.html")).andExpect(status().isOk()).andReturn();
        String html = body(direct);
        assertTrue(!html.contains(SPA_FIXTURE_MARKER),
                "读到的还是测试夹具！夹具必须放在 classpath:/spa-fixture/，不能盖住真实产物。实际内容："
                        + head(html));
        assertTrue(html.contains("<div id=\"app\">"),
                "真实前端产物应有 Vue 挂载点 <div id=\"app\">，实际：" + head(html));
        assertTrue(html.contains("assets/"),
                "真实前端产物应引用 assets/ 下的构建产物，实际：" + head(html));
    }

    @Test
    @DisplayName("IM-3：前端路由 /quiz、/result、/about 都回退到真实 index.html")
    void spaRoutesFallBackToRealIndexHtml() throws Exception {
        for (String route : new String[]{"/quiz", "/result", "/about"}) {
            MvcResult result = mockMvc.perform(get(route))
                    .andExpect(status().isOk())
                    .andReturn();
            String html = body(result);
            assertTrue(!html.contains(SPA_FIXTURE_MARKER), route + " 读到了夹具而不是真实产物");
            assertTrue(html.contains("<div id=\"app\">"),
                    route + " 应回退到真实 index.html，实际：" + head(html));
        }
    }

    @Test
    @DisplayName("IM-3：index.html 引用的 /assets/*.js、*.css 能真的取到（否则页面是白屏）")
    void referencedAssetsAreServed() throws Exception {
        String html = body(mockMvc.perform(get("/index.html")).andExpect(status().isOk()).andReturn());

        Matcher matcher = ASSET_HREF.matcher(html);
        int checked = 0;
        while (matcher.find()) {
            String assetPath = "/" + matcher.group(1);
            MvcResult result = mockMvc.perform(get(assetPath)).andReturn();
            assertEquals(200, result.getResponse().getStatus(),
                    assetPath + " 取不到：index.html 引用了它，构建产物不完整");
            assertTrue(result.getResponse().getContentAsByteArray().length > 0,
                    assetPath + " 返回了空内容");
            checked++;
        }
        assertTrue(checked > 0,
                "index.html 里没有解析出任何 assets/ 引用，产物形态与预期不符：" + head(html));
    }

    @Test
    @DisplayName("IM-3：真实形态下 API 与前端路由并存（/api/v1/meta 仍走 JSON）")
    void apiStillWorksAlongsideFrontend() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/meta"))
                .andExpect(status().isOk())
                .andReturn();
        String json = body(result);
        assertNotNull(json);
        assertTrue(json.contains("\"license\":\"CC BY-NC-SA 4.0\""), head(json));
        assertTrue(!json.contains("<div id=\"app\">"), "API 响应不得变成前端页面");
    }
}
