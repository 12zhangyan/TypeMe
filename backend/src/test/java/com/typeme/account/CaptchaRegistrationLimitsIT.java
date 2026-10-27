package com.typeme.account;

import com.typeme.account.captcha.CaptchaService;
import com.typeme.account.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MvcResult;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 注册防刷的分层预算（方案 A-7、A-8）。用很小的阈值独立起一份上下文，限流计数是累加型状态，
 * 与其它账号测试共库会让阈值断言失真（库由 {@code @AccountTestDatabase} 隔离）。
 * 用例之间共享计数，所以各自使用不同的来源 IP；全站总量的用例要在最后消耗完额度，
 * 因此取一个排序靠后的方法名并只在自己的断言里依赖“触顶”。
 */
class CaptchaRegistrationLimitsIT extends AccountIntegrationTestBase {

    @DynamicPropertySource
    static void strictLimits(DynamicPropertyRegistry registry) {
        registry.add("typeme.ratelimit.registration.captcha-issue.ip-limit", () -> "2");
        registry.add("typeme.ratelimit.registration.attempt.ip-limit", () -> "6");
        registry.add("typeme.ratelimit.register.ip-limit", () -> "2");
        registry.add("typeme.ratelimit.registration.global.limit", () -> "6");
        registry.add("typeme.ratelimit.registration.global.window", () -> "1h");
        registry.add("typeme.ratelimit.register.window", () -> "1h");
        registry.add("typeme.ratelimit.registration.attempt.window", () -> "1h");
    }

    private Map<String, Object> form(String username, String token, String answer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("password", "TestPassw0rd!");
        body.put("disclaimerAccepted", true);
        body.put("captchaToken", token);
        body.put("captchaAnswer", answer);
        return body;
    }

    private int status(String username, CaptchaService.Challenge challenge, String answer, String ip) throws Exception {
        return registerRaw(form(username, challenge.token(), answer), ip).getResponse().getStatus();
    }

    private static String wrongAnswerFor(CaptchaService.Challenge challenge) {
        return challenge.answer().equals("ZZZZZ") ? "YYYYY" : "ZZZZZ";
    }

    @Test
    @DisplayName("A-7 同一 IP 反复取验证码 → 429 且带 retryAfterSeconds")
    void issuingCaptchasIsRateLimitedPerIp() throws Exception {
        String ip = "10.60.0.1";
        for (int i = 0; i < 2; i++) {
            assertThat(mockMvc.perform(get("/api/v3/auth/captcha").with(request -> {
                request.setRemoteAddr(ip);
                return request;
            })).andReturn().getResponse().getStatus()).isEqualTo(200);
        }
        MvcResult limited = mockMvc.perform(get("/api/v3/auth/captcha").with(request -> {
            request.setRemoteAddr(ip);
            return request;
        })).andReturn();
        assertThat(limited.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(limited).path("code").asText()).isEqualTo("RATE_LIMITED");
        assertThat(body(limited).path("details").path("retryAfterSeconds").asLong()).isPositive();
    }

    @Test
    @DisplayName("A-7 答错验证码只消耗宽松的尝试预算，不占用通过验证码后的严格预算；超出宽松预算后连答对也被拒")
    void wrongAnswersDoNotSpendTheStrictRegisterBudget() throws Exception {
        String ip = "10.60.0.2";
        // 严格预算是 2；答错 5 次若也算严格预算，后面必然 429。
        for (int i = 0; i < 5; i++) {
            CaptchaService.Challenge other = TestCaptcha.challenge();
            assertThat(status(uniqueUsername("wr" + i), other, wrongAnswerFor(other), ip)).isEqualTo(400);
        }
        // 第 6 次尝试（宽松预算 6）用了正确答案 → 能成功。
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        assertThat(status(uniqueUsername("wrok"), challenge, challenge.answer(), ip)).isEqualTo(201);
        // 第 7 次尝试超出宽松预算 → 429，且发生在验证码校验之前。
        CaptchaService.Challenge late = TestCaptcha.challenge();
        assertThat(status(uniqueUsername("wrlate"), late, late.answer(), ip)).isEqualTo(429);
    }

    @Test
    @DisplayName("A-7 通过验证码后的严格预算：同 IP 第 3 次 → 429，且不建号")
    void strictBudgetAfterCaptchaIsPerIp() throws Exception {
        String ip = "10.60.0.3";
        for (int i = 0; i < 2; i++) {
            CaptchaService.Challenge c = TestCaptcha.challenge();
            assertThat(status(uniqueUsername("st" + i), c, c.answer(), ip)).isEqualTo(201);
        }
        CaptchaService.Challenge c = TestCaptcha.challenge();
        String name = uniqueUsername("stover");
        MvcResult limited = registerRaw(form(name, c.token(), c.answer()), ip);
        assertThat(limited.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(limited).path("code").asText()).isEqualTo("RATE_LIMITED");
        assertThat(userRepository.findByNormalizedUsername(UserRepository.normalize(name))).isEmpty();
    }

    @Test
    @DisplayName("A-8 全站总量达到上限后，换 IP 也被 429；登录不受影响")
    void globalCeilingStopsRegistrationsFromAnyIp() throws Exception {
        // 全站额度 6，与本类其它用例共用同一个上下文（它们也在消耗）：循环直到触顶，
        // 每次用全新的 IP，所以触顶的原因只可能是全站维度，而不是 IP 维度。
        String loginUser = uniqueUsername("glogin");
        CaptchaService.Challenge first = TestCaptcha.challenge();
        int firstStatus = status(loginUser, first, first.answer(), "10.61.0.1");
        boolean limitedAlready = firstStatus == 429;
        if (!limitedAlready) {
            assertThat(firstStatus).isEqualTo(201);
        }
        int guard = 0;
        boolean hitCeiling = limitedAlready;
        while (!hitCeiling && guard++ < 12) {
            CaptchaService.Challenge c = TestCaptcha.challenge();
            int status = status(uniqueUsername("glob" + guard), c, c.answer(), "10.61." + (guard + 1) + ".1");
            if (status == 429) {
                hitCeiling = true;
            } else {
                assertThat(status).isEqualTo(201);
            }
        }
        assertThat(hitCeiling).as("全站总量 6 应在 12 次内触顶").isTrue();

        CaptchaService.Challenge fresh = TestCaptcha.challenge();
        assertThat(status(uniqueUsername("gnew"), fresh, fresh.answer(), "10.99.99.99")).isEqualTo(429);

        // 登录走自己的限流，不受注册总量影响。
        if (!limitedAlready) {
            MockHttpSession session = new MockHttpSession();
            MvcResult login = login(csrf(session), session, loginUser, "TestPassw0rd!", uniqueIp());
            assertThat(login.getResponse().getStatus()).isEqualTo(200);
        }
    }
}
