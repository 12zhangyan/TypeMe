package com.typeme.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import java.io.IOException;
import java.util.Arrays;

/**
 * SPA 路由回退（ADR-5）：前端路由如 {@code /quiz}、{@code /result} 要能落到 {@code index.html}，
 * 但**不能影响 {@code /api/**}**（更不能把不存在的 API 路径也返回一个 HTML 200）。
 *
 * <p>规则（确定性优先，因此关掉了 Boot 默认的静态资源映射，见 application.yml）：
 * <ol>
 *   <li><b>WebConfig 只认两件事</b>：
 *       <ul>
 *         <li>{@code api/} 前缀一律交给 {@code @RestController} 处理：命中的返回 JSON（或
 *             controller 自己给的 404），没命中的**照常走 Spring 的 404 流程**——响应体的形态
 *             （JSON 还是 Whitelabel 错误页）由 error 处理链按 {@code Accept} 决定，不归本类管。
 *             本类返回 {@code null} 只保证一件事：**不把 {@code index.html} 当 API 响应回给调用方**。</li>
 *         <li>其余路径：带扩展名的按静态资源处理（存在就返回，不存在就 404）；
 *             无扩展名的视为前端路由，回退到同一资源目录下的 {@code index.html}。</li>
 *       </ul></li>
 *   <li>{@code actuator/} 前缀也在这里被排除，但**排除只等于「不被 SPA 回退吃掉」**：
 *       Actuator 只映射它自己注册过的路径，实测行为（{@code SpaRoutingTest} 逐条钉住）是
 *       {@code /actuator} → 200（端点发现文档）、{@code /actuator/health} → 200，
 *       而 {@code /actuator/}、{@code /actuator/nope}、未暴露的 {@code /actuator/env} → **404**。
 *       早先的注释写成「api/ 与 actuator/ 前缀一律交给各自的处理器，绝不回退」，
 *       读起来像「一定有人接」，与 {@code /actuator/} 实际 404 的事实不符——
 *       这正是 MI-11 记录的文档与行为不一致；此处按实测行为改写。</li>
 * </ol>
 *
 * <p>⚠️ {@code /} 不经过本类：Spring Boot 的 {@code WelcomePageHandlerMapping} 在
 * {@code index.html} 存在时先一步把 {@code /} 以 forward 方式接走（见 {@code SpaRoutingTest}）。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    /**
     * 静态资源根目录。与 {@code spring.web.resources.static-locations} 同义、同默认值，
     * 只是这里**我们自己**用它注册唯一的 {@code /**} 处理器（Boot 默认映射已在
     * application.yml 里关掉，见类注释）。
     *
     * <p>做成可配置项是为了让测试能显式指向夹具目录（IM-3）：`SpaRoutingTest` 把静态根目录
     * 指到 {@code classpath:/spa-fixture/}，从而在**不依赖前端产物**的前提下验证回退规则；
     * `RealArtifactSpaRoutingTest` 不覆盖它，验证的就是真实产物。
     */
    private static final String[] DEFAULT_STATIC_LOCATIONS = {
            "classpath:/META-INF/resources/",
            "classpath:/resources/",
            "classpath:/static/",
            "classpath:/public/"
    };

    private final String[] staticLocations;

    public WebConfig(
            @Value("${spring.web.resources.static-locations:}")
            String configuredLocations) {
        this.staticLocations = configuredLocations.isBlank()
                ? DEFAULT_STATIC_LOCATIONS
                : Arrays.stream(configuredLocations.split(","))
                        .map(String::trim)
                        .filter(location -> !location.isEmpty())
                        .toArray(String[]::new);
    }

    private static final String INDEX_HTML = "index.html";

    /** 供测试断言「静态根目录到底落在哪」，避免配置被静默忽略。 */
    String[] staticLocations() {
        return staticLocations.clone();
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations(staticLocations)
                .resourceChain(true)
                .addResolver(new SpaPathResourceResolver());
    }

    /** 静态文件优先，无扩展名路径回退 index.html，api/actuator 永不回退。 */
    static final class SpaPathResourceResolver extends PathResourceResolver {

        @Override
        protected Resource getResource(String resourcePath, Resource location) throws IOException {
            if (isBackendPath(resourcePath)) {
                return null;
            }
            if (looksLikeStaticFile(resourcePath)) {
                Resource candidate = location.createRelative(resourcePath);
                return candidate.exists() && candidate.isReadable() ? candidate : null;
            }
            Resource index = location.createRelative(INDEX_HTML);
            return index.exists() && index.isReadable() ? index : null;
        }

        /** 后端自己的路径（API 与健康检查）不参与 SPA 回退。 */
        private static boolean isBackendPath(String resourcePath) {
            return resourcePath.startsWith("api/")
                    || resourcePath.equals("api")
                    || resourcePath.startsWith("actuator/")
                    || resourcePath.equals("actuator");
        }

        /** 末段含「.」才当静态资源，这样无扩展名的目录请求也能走 SPA 回退。 */
        private static boolean looksLikeStaticFile(String resourcePath) {
            int lastSlash = resourcePath.lastIndexOf('/');
            String lastSegment = lastSlash < 0 ? resourcePath : resourcePath.substring(lastSlash + 1);
            return lastSegment.indexOf('.') >= 0;
        }
    }
}
