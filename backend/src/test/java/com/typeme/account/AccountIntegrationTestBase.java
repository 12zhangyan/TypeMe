package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.TypeMeApplication;
import com.typeme.account.repository.UserRepository;
import com.typeme.testsupport.AccountTestDatabase;
import com.typeme.testsupport.ExcludeCrossModuleTestConfigs;
import com.typeme.testsupport.H2TestDatabases;
import jakarta.servlet.http.Cookie;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 账号模块集成测试的公共基类。
 *
 * <p><b>测试库是 H2 的 MySQL 兼容模式</b>（任务硬要求）。目的不是"随便跑跑"，
 * 而是让**同一份 Flyway 迁移脚本**在 H2 上真实执行一遍：迁移一旦用了 MySQL 专有语法
 * （{@code ENGINE=}、{@code COMMENT=}、{@code ON UPDATE CURRENT_TIMESTAMP}、{@code REGEXP}……），
 * 这里会立刻红。因此测试属性里显式指定了 {@code MODE=MySQL;DATABASE_TO_LOWER=TRUE}，
 * 与任务书给的一模一样。
 *
 * <p><b>为什么测试库不能写在 test 的 application.yml 里</b>：那会随类路径影响所有
 * {@code @SpringBootTest}（包括并行同事的），而这里只想给自己的测试换库。
 * 现在换库的唯一入口是类上的 {@link com.typeme.testsupport.AccountTestDatabase}，
 * 显式写出的库名也让"测的到底是哪个库"一眼可见。
 *
 * <p><b>PBKDF2 迭代次数</b>：测试里降到 1000。这不是"放宽安全"，而是让测试有意义的必要取舍：
 * 一次登录要 encode+matches 各一遍，210000 次迭代下单个用例就要几百毫秒，
 * 几十个用例会把 CI 拖到不可接受。生产默认值仍由 application.yml 的 210000 决定，
 * 并且 {@code PasswordEncoderConfig} 会对"过小"值做启动期检查。
 *
 * <p><b>跨模块测试配置的剔除</b>：见 {@link com.typeme.testsupport.ExcludeCrossModuleTestConfigs}。
 * 简述：AI 模块的 {@code AiTestApplication} 是测试专用 {@code @Configuration}，
 * 却位于本应用组件扫描的 {@code com.typeme.**} 之内，它声明的 {@code aiClock} 与生产组件
 * {@code com.typeme.ai.config.AiClock} 撞名，会让**所有** {@code @SpringBootTest} 一起红。
 * 这里用共享的 {@code @ExcludeCrossModuleTestConfigs} 把它挡掉（而不是打开
 * {@code allow-bean-definition-overriding} —— 那是把确定性错误换成依赖注册顺序的不确定错误）。
 */
@ExcludeCrossModuleTestConfigs
@SpringBootTest(classes = TypeMeApplication.class,
        properties = {
        "typeme.auth.pbkdf2-iterations=1000",
        "typeme.admin.bootstrap-username=",
        "typeme.security.settings-secret=test-settings-secret-0123456789",
        // 限流在功能测试里放宽：这些用例关心的是"认证/CSRF/隔离"的正确性，
        // 而不是限流本身（限流有专门的一条用例，用严格配置独立起一份上下文）。
        // 不放开的话，共用同一个 remoteAddr 的数十次注册/登录会互相把对方限流掉，
        // 表现为一堆与主题无关的 429 —— 那是测试设计问题，不是实现问题。
        "typeme.ratelimit.register.ip-limit=10000",
        "typeme.ratelimit.register.window=60s",
        "typeme.ratelimit.login.ip-limit=10000",
        "typeme.ratelimit.login.user-limit=10000",
        "typeme.ratelimit.login.window=60s",
        "typeme.ratelimit.recover.ip-limit=10000",
        "typeme.ratelimit.recover.window=60s",
        // 注销 worker 的调度在测试里不需要自己跑：用例显式调用 processPendingNow()，
        // 这样断言不依赖调度时机（否则就是一条随机红的测试）。
        // 值必须写 ISO-8601：@Scheduled 的 String 形式不认 "1h" 这种写法，
        // 写错的表现是整个 Spring 上下文起不来（不是"定时器不跑"）。
        "typeme.deletion.worker-initial-delay=PT1H",
        "typeme.deletion.worker-interval=PT1H"
})
@AutoConfigureMockMvc
// 每个子类自动获得一份独立的 H2 库（库名由类名派生）。没有它，AdminApiIT 提升出来的
// ADMIN 会留在共享库里，让 AdminBootstrapIT 的"系统里还没有 ADMIN"前提失败 ——
// 单独跑都绿、一起跑才红。为什么不能靠 @DynamicPropertySource 做这件事，见注解说明。
@AccountTestDatabase
public abstract class AccountIntegrationTestBase {

    /**
     * 账号模块集成测试**默认**的 H2 库（没有 {@code @AccountTestDatabase} 的类用它）。
     *
     * <p>库名带"本次 JVM"后缀（见 {@link H2TestDatabases}）：固定库名 + {@code DB_CLOSE_DELAY=-1}
     * 会让同一次 Maven 会话里的**第二遍** {@code mvn test} 看到第一遍留下的数据，
     * 表现为"第一次跑绿、紧接着再跑就红"。账号模块的状态（谁被提升成了 ADMIN、
     * 哪些用户名已注册）尤其经不起这种残留。
     *
     * <p><b>要换独立库的子类请加 {@code @AccountTestDatabase("自己的逻辑名")}，
     * 不要写 {@code @DynamicPropertySource}。</b>为什么：
     * {@code @DynamicPropertySource} 必须是**静态**方法，而 Java 的静态方法不能被覆盖；
     * 而"子类另写一个不同名的方法"实测也无效 —— 最终生效的仍是这里基类的值。
     * 于是本该隔离的两个测试类会连到同一个库上，后果是 {@code AdminApiIT} 提升出来的
     * ADMIN 让 {@code AdminBootstrapIT} 的"系统里还没有 ADMIN"前提失效而报错，
     * 且**单独跑都绿、一起跑才红**，报错完全指不到真正的原因。
     * 详见 {@link com.typeme.testsupport.AccountTestDatabase}。
     */
    protected static final String H2_URL = H2TestDatabases.url("typeme_account_test")
            + ";CASE_INSENSITIVE_IDENTIFIERS=TRUE";

    /**
     * 数据源属性。
     *
     * <p><b>这里刻意没有 {@code @DynamicPropertySource}。</b>早期版本用它给测试换库，
     * 结果是**不可靠**的：{@code @DynamicPropertySource} 的值会被 Spring 装进
     * {@code DynamicValuesPropertySource} 并用 {@code addFirst} 插入，而注解
     * {@link com.typeme.testsupport.AccountTestDatabase} 走的 {@code ContextCustomizer}
     * 也是 {@code addFirst} —— 两者抢同一个位置，"谁后加谁赢"，取决于框架内部
     * customizer 的执行顺序。两个都注册就等于把"连哪个库"交给未定义行为。
     *
     * <p>现在换库**只有一个入口**：类上打 {@link com.typeme.testsupport.AccountTestDatabase}，
     * 由 {@link com.typeme.testsupport.AccountDatabaseContextCustomizerFactory} 统一注入。
     * 基类也打了这个注解（{@code @Inherited} 让所有子类自动获得），库名按类名派生，
     * 因此每个测试类天然连到自己的库 —— 这正是 {@code AdminApiIT} 提升出的 ADMIN
     * 不再污染 {@code AdminBootstrapIT} 的原因。
     */
    static Map<String, Object> h2DatasourceProperties(String url) {
        return H2TestDatabases.datasourceProperties(url);
    }

    /** 同一次测试运行内唯一，避免共享的 H2 库上用例之间互相撞用户名。 */
    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    @Autowired
    protected UserRepository userRepository;

    protected static String uniqueUsername(String prefix) {
        return prefix + "_" + System.nanoTime() % 1_000_000 + "_" + SEQUENCE.incrementAndGet();
    }

    protected static String uniqueIp() {
        return "10." + (SEQUENCE.incrementAndGet() % 250 + 1) + "."
                + (System.nanoTime() % 250 + 1) + "." + (System.nanoTime() % 250 + 1);
    }

    protected String json(Object value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    protected JsonNode body(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------ 请求构造

    /** 取 CSRF token（响应会同时种下 XSRF-TOKEN cookie；同一会话后续请求会复用它）。 */
    protected CsrfContext csrf(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/auth/csrf").session(session)).andReturn();
        JsonNode node = body(result);
        // 把响应里的 XSRF-TOKEN cookie 一并带回：**MockMvc 不会在请求之间保存 cookie**，
        // 而 CookieCsrfTokenRepository 判定 token 时读的是 cookie 而不是 JSON 里的 token。
        // 只发 header 不发 cookie 的话，Spring Security 会另生成一个空 token 去做比较，
        // 结果是带有"正确 token"的写请求也一律 403 —— 表现为一堆与本意无关的失败。
        Cookie tokenCookie = result.getResponse().getCookie("XSRF-TOKEN");
        return new CsrfContext(node.path("token").asText(), node.path("headerName").asText(),
                tokenCookie == null ? null : new Cookie("XSRF-TOKEN", tokenCookie.getValue()));
    }

    /** 带完整 CSRF 上下文（header + cookie）的请求；写请求一律用这个。 */
    protected MockHttpServletRequestBuilder withCsrf(MockHttpServletRequestBuilder builder, CsrfContext csrf) {
        MockHttpServletRequestBuilder withHeader = builder.header(csrf.headerName(), csrf.token());
        return csrf.cookie() == null ? withHeader : withHeader.cookie(csrf.cookie());
    }

    /** 注册并返回新账号（注册成功即已登录，会话在 {@code result} 的请求里）。 */
    protected RegisteredAccount register(String username, String password) throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password,
                                // 2026-09-17 起注册必须带免责声明同意（AccountService 复核）。
                                // 帮助方法默认替用例同意，就像真实前端默认会带上勾选状态一样；
                                // 不带的用例必须显式构造请求体，见 RegistrationAndLoginIT 的那条。
                                "disclaimerAccepted", true))), csrf)).andReturn();
        JsonNode node = body(result);
        return new RegisteredAccount(result.getResponse().getStatus(), node, session);
    }

    /** 登录并返回同一会话上的结果。 */
    protected MvcResult login(CsrfContext csrf, MockHttpSession session, String username, String password,
                              String remoteAddr) throws Exception {
        return mockMvc.perform(withCsrf(post("/api/v3/auth/login")
                        .session(session)
                        /*
                         * `MockHttpServletRequestBuilder` **没有** `remoteAddr(String)` 方法
                         * （那是 `MockHttpServletRequest` 的 setter）。要设置来源地址只能
                         * 用 `with(RequestPostProcessor)` 去改底层请求。
                         * 这里必须能设：限流按来源地址分桶，测试若不换地址，
                         * 几十次注册/登录会互相把对方限流掉，失败信息看起来像功能坏了。
                         */
                        .with(request -> {
                            request.setRemoteAddr(remoteAddr);
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "password", password))), csrf)).andReturn();
    }

    protected String sessionCookie(MvcResult result) {
        Cookie cookie = result.getResponse().getCookie("JSESSIONID");
        return cookie == null ? null : cookie.getValue();
    }

    /** CSRF token + header 名（服务端给的名字，前端不写死，测试同样不写死）+ 配对 cookie。 */
    protected record CsrfContext(String token, String headerName, Cookie cookie) {
    }

    /** 注册结果：状态码 + 响应体 + 该账号所在的 Mock 会话。 */
    protected record RegisteredAccount(int status, JsonNode body, MockHttpSession session) {

        public String userId() {
            return body.path("userId").asText();
        }

        public String username() {
            return body.path("username").asText();
        }

        public java.util.List<String> recoveryCodes() {
            java.util.List<String> codes = new java.util.ArrayList<>();
            body.path("recoveryCodes").forEach(node -> codes.add(node.asText()));
            return codes;
        }
    }

    protected static String normalize(String username) {
        return username.toLowerCase(Locale.ROOT);
    }

    /**
     * 造一个"旧会话"对象：与给定会话**同 id** 的新 {@link MockHttpSession}。
     *
     * <p>为什么需要这么个东西：Spring Security 的 {@code MockHttpServletRequest.getSession()}
     * 在自己的会话表里按 id 找回会话对象，所以直接 {@code new MockHttpSession()} 会得到一个
     * 全新会话 —— 那样"旧会话已失效"这条断言就变成恒真（永远 401），测不出任何东西。
     * 只有同 id 的会话才能真实命中 {@code SessionRegistryService} 里那个被 invalidate 的对象。
     *
     * <p>用反射设置 id 是无奈之举（{@code MockHttpSession} 没有公开的 setter），
     * 但这段代码只在测试里，且失败会立刻表现为 NoSuchFieldException 而不是静默通过。
     */
    protected static MockHttpSession sameIdSessionAs(MockHttpSession source) {
        try {
            MockHttpSession copy = new MockHttpSession();
            java.lang.reflect.Field idField = MockHttpSession.class.getDeclaredField("id");
            idField.setAccessible(true);
            idField.set(copy, source.getId());
            return copy;
        } catch (ReflectiveOperationException ex) {
            throw new IllegalStateException("无法构造同 id 的 MockHttpSession（Spring 版本变了？）", ex);
        }
    }

    // 跨模块测试配置的剔除改用共享实现 com.typeme.testsupport.CrossModuleTestExclusions
    // （原因与取舍见该类注释）：本基类原先自带一份等价的过滤器，重复实现会让
    // "哪些测试类需要剔除、剔除了什么"散落成两处，新增条目时必然漏掉一处。
}
