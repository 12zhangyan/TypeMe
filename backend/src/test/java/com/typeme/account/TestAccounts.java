package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import jakarta.servlet.http.Cookie;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 账号隔离测试的复用工具（任务书要求留一个可复用的工具类）。
 *
 * <p>并行同事的 attempt/report 路由也要验证"A 读不到 B 的数据"，
 * 而每个这样的测试都需要"两个已登录账号 + 各自的 CSRF token"这段繁琐的前置。
 * 把它固化在这里，路由测试只需要关心自己的断言。
 *
 * <p>用法：
 * <pre>{@code
 * TestAccounts accounts = new TestAccounts(mockMvc, objectMapper, userRepository);
 * TestAccounts.Session a = accounts.registerAndLogin("alice");
 * TestAccounts.Session b = accounts.registerAndLogin("bob");
 * // 之后用 a.with(get("/api/v3/attempts")) 构造带会话与 CSRF 的请求
 * }</pre>
 */
public class TestAccounts {

    private final MockMvc mockMvc;
    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;
    private final UserRepository userRepository;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;

    public TestAccounts(MockMvc mockMvc, com.fasterxml.jackson.databind.ObjectMapper objectMapper,
                        UserRepository userRepository, org.springframework.jdbc.core.JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        this.mockMvc = mockMvc;
        this.objectMapper = objectMapper;
        this.userRepository = userRepository;
    }

    /** 注册 + 登录一个全新账号（用户名加后缀保证唯一），返回可直接发请求的会话句柄。 */
    public Session registerAndLogin(String prefix) throws Exception {
        String username = prefix + "_" + Long.toHexString(System.nanoTime());
        String password = "TestPassw0rd!";
        MockHttpSession session = new MockHttpSession();

        Csrf csrf = csrf(session);
        MvcResult registered = mockMvc.perform(csrf.apply(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(
                                Map.of("username", username, "password", password,
                                        // 注册必带免责声明同意（2026-09-17 起，见 AccountService）。
                                        "disclaimerAccepted", true, "invitationCode", TestInvitations.create(jdbc))))))
                .andReturn();
        JsonNode body = objectMapper.readTree(
                registered.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
        if (registered.getResponse().getStatus() != 201) {
            throw new IllegalStateException("注册失败 status=" + registered.getResponse().getStatus()
                    + " body=" + body);
        }
        // 注册即已登录。登录/注册都会轮换 sessionId，但请求里用的就是同一个 session 对象，
        // 所以下面返回的会话句柄仍然有效。
        return new Session(username, password, body.path("userId").asText(), session, csrf);
    }

    /**
     * 取 CSRF token。
     *
     * <p>同时把响应里的 {@code XSRF-TOKEN} cookie 带上：{@code MockMvc} 不会在请求之间保存
     * cookie，而服务端的 {@code CookieCsrfTokenRepository} 判定 token 时读的是 cookie。
     * 少带这一个 cookie，写请求会一律 403，且看起来像"接口坏了"。
     */
    public Csrf csrf(MockHttpSession session) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v3/auth/csrf").session(session)).andReturn();
        JsonNode node = objectMapper.readTree(
                result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8));
        Cookie tokenCookie = result.getResponse().getCookie("XSRF-TOKEN");
        return new Csrf(node.path("token").asText(), node.path("headerName").asText(),
                tokenCookie == null ? null : new Cookie("XSRF-TOKEN", tokenCookie.getValue()));
    }

    /** 把账号提升为 ADMIN（后台接口测试的前置）。 */
    public void promoteToAdmin(String username) {
        String normalized = UserRepository.normalize(username);
        UserRecord user = userRepository.findByNormalizedUsername(normalized)
                .orElseThrow(() -> new IllegalStateException("账号不存在: " + username));
        userRepository.updateRole(user.id(), UserRecord.ROLE_ADMIN);
    }

    /** 一个已登录账号：会话 + CSRF token，可直接构造请求。 */
    public record Session(String username, String password, String userId, MockHttpSession httpSession,
                          Csrf csrf) {

        /** 给请求加上会话与 CSRF header/cookie（写方法必须带）。 */
        public MockHttpServletRequestBuilder with(MockHttpServletRequestBuilder builder) {
            return csrf.apply(builder.session(httpSession));
        }
    }

    /** CSRF token + header 名 + 配对 cookie；{@link #apply} 一次把该带的都带上。 */
    public record Csrf(String token, String headerName, Cookie cookie) {

        public MockHttpServletRequestBuilder apply(MockHttpServletRequestBuilder builder) {
            MockHttpServletRequestBuilder withHeader = builder.header(headerName, token);
            return cookie == null ? withHeader : withHeader.cookie(cookie);
        }
    }
}
