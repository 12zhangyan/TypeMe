package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.captcha.CaptchaService;
import com.typeme.account.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

/**
 * 注册验证码（方案 A-1…A-5）：合法流程，以及缺失/答错/篡改/过期/重放/爆破都被同一种方式拒绝，
 * 且被拒时不建号、不做密码加密（PBKDF2 是被刷时的主要成本）。
 */
class CaptchaRegistrationIT extends AccountIntegrationTestBase {

    @SpyBean
    PasswordEncoder passwordEncoder;

    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    private Map<String, Object> form(String username, String token, String answer) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("password", "TestPassw0rd!");
        body.put("disclaimerAccepted", true);
        if (token != null) {
            body.put("captchaToken", token);
        }
        if (answer != null) {
            body.put("captchaAnswer", answer);
        }
        return body;
    }

    private void assertRejectedAsInvalidCaptcha(MvcResult result, String username) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        JsonNode body = body(result);
        assertThat(body.path("code").asText()).isEqualTo("VALIDATION_FAILED");
        assertThat(body.path("message").asText()).isEqualTo("验证码不对或已过期，请换一张再试。");
        assertThat(body.path("details").has("captchaAnswer")).isTrue();
        assertThat(userRepository.findByNormalizedUsername(UserRepository.normalize(username))).isEmpty();
    }

    @Test
    @DisplayName("A-1 取到验证码后带正确答案注册 → 201 + 8 个恢复码，响应 no-store 且不含答案")
    void validCaptchaRegisters() throws Exception {
        MvcResult issued = mockMvc.perform(get("/api/v3/auth/captcha")).andReturn();
        assertThat(issued.getResponse().getStatus()).isEqualTo(200);
        assertThat(issued.getResponse().getHeader("Cache-Control")).contains("no-store");
        JsonNode issuedBody = body(issued);
        List<String> fields = new ArrayList<>();
        issuedBody.fieldNames().forEachRemaining(fields::add);
        assertThat(fields).containsExactlyInAnyOrder("token", "image", "expiresInSeconds");
        assertThat(issuedBody.path("expiresInSeconds").asLong()).isEqualTo(180);
        String image = issuedBody.path("image").asText();
        assertThat(image).startsWith("data:image/png;base64,");
        byte[] png = Base64.getDecoder().decode(image.substring(image.indexOf(',') + 1));
        assertThat(png[1]).isEqualTo((byte) 'P');
        assertThat(png[2]).isEqualTo((byte) 'N');
        assertThat(png[3]).isEqualTo((byte) 'G');

        // 答案只在服务端：用同一份签名代码造一道已知答案的题来走完注册。
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        String username = uniqueUsername("capok");
        MvcResult result = registerRaw(form(username, challenge.token(), challenge.answer()), uniqueIp());
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        assertThat(body(result).path("recoveryCodes")).hasSize(8);
        assertThat(result.getResponse().getHeader("Cache-Control")).contains("no-store");
    }

    @Test
    @DisplayName("A-1 答案不区分大小写、忽略空白")
    void answerIsCaseAndWhitespaceInsensitive() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        String sloppy = " " + challenge.answer().toLowerCase() + " ";
        MvcResult result = registerRaw(form(uniqueUsername("capcase"), challenge.token(), sloppy), uniqueIp());
        assertThat(result.getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    @DisplayName("A-2 缺令牌 / 缺答案 / 答错 / 篡改 / 过期 / 他人密钥签发：同一种 400，不建号，不做密码加密")
    void badCaptchasAreRejectedIdenticallyAndCheaply() throws Exception {
        CaptchaService.Challenge good = TestCaptcha.challenge();
        String wrong = good.answer().equals("ZZZZZ") ? "YYYYY" : "ZZZZZ";
        CaptchaService.Challenge expired = CaptchaService.newChallenge(
                TestCaptcha.SECRET, Instant.now().minus(Duration.ofMinutes(10)), Duration.ofMinutes(3));
        String tampered = good.token().substring(0, good.token().length() - 2)
                + (good.token().endsWith("AA") ? "BB" : "AA");
        String foreign = CaptchaService.newChallenge(
                "another-secret-another-secret-12345", Instant.now(), Duration.ofMinutes(3)).token();

        List<String> names = new ArrayList<>();
        List<Map<String, Object>> cases = new ArrayList<>();
        String[][] variants = {
                {null, null}, {good.token(), null}, {good.token(), wrong},
                {tampered, good.answer()}, {expired.token(), expired.answer()}, {foreign, "ABCDE"}};
        for (int i = 0; i < variants.length; i++) {
            String name = uniqueUsername("capbad" + i);
            names.add(name);
            cases.add(form(name, variants[i][0], variants[i][1]));
        }

        clearInvocations(passwordEncoder);
        for (int i = 0; i < cases.size(); i++) {
            assertRejectedAsInvalidCaptcha(registerRaw(cases.get(i), uniqueIp()), names.get(i));
        }
        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    @DisplayName("A-3 同一验证码成功后再提交 → 被拒（重放）")
    void replayAfterSuccessIsRejected() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        assertThat(registerRaw(form(uniqueUsername("rep1"), challenge.token(), challenge.answer()), uniqueIp())
                .getResponse().getStatus()).isEqualTo(201);
        String second = uniqueUsername("rep2");
        assertRejectedAsInvalidCaptcha(
                registerRaw(form(second, challenge.token(), challenge.answer()), uniqueIp()), second);
    }

    @Test
    @DisplayName("A-3 并发提交同一验证码：最多一个成功")
    void concurrentSubmissionsOfSameCaptchaSucceedOnce() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        try {
            List<Future<Integer>> futures = new ArrayList<>();
            for (int i = 0; i < 4; i++) {
                String username = uniqueUsername("race" + i);
                Callable<Integer> task = () -> registerRaw(
                        form(username, challenge.token(), challenge.answer()), uniqueIp()).getResponse().getStatus();
                futures.add(pool.submit(task));
            }
            int created = 0;
            for (Future<Integer> future : futures) {
                if (future.get() == 201) {
                    created++;
                }
            }
            assertThat(created).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("A-4 验证码通过但注册失败（用户名冲突）后，同一验证码不能再用来探测用户名")
    void captchaStaysBurnedWhenRegistrationFailsAfterIt() throws Exception {
        String taken = uniqueUsername("taken");
        assertThat(register(taken, "TestPassw0rd!").status()).isEqualTo(201);

        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        assertThat(registerRaw(form(taken, challenge.token(), challenge.answer()), uniqueIp())
                .getResponse().getStatus()).isEqualTo(409);

        String probe = uniqueUsername("probe");
        assertRejectedAsInvalidCaptcha(
                registerRaw(form(probe, challenge.token(), challenge.answer()), uniqueIp()), probe);
    }

    @Test
    @DisplayName("A-5 同一令牌答错 3 次后令牌作废，第 4 次即使答对也被拒")
    void tokenIsRevokedAfterThreeWrongAnswers() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        String wrong = challenge.answer().equals("ZZZZZ") ? "YYYYY" : "ZZZZZ";
        for (int i = 0; i < 3; i++) {
            String name = uniqueUsername("brute" + i);
            assertRejectedAsInvalidCaptcha(registerRaw(form(name, challenge.token(), wrong), uniqueIp()), name);
        }
        String last = uniqueUsername("bruteok");
        assertRejectedAsInvalidCaptcha(
                registerRaw(form(last, challenge.token(), challenge.answer()), uniqueIp()), last);
    }

    @Test
    @DisplayName("字段格式不合法（@Valid 失败）不消耗验证码")
    void formatErrorsDoNotBurnCaptcha() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        assertThat(registerRaw(form("ab", challenge.token(), challenge.answer()), uniqueIp())
                .getResponse().getStatus()).isEqualTo(400);
        assertThat(registerRaw(form(uniqueUsername("fmtok"), challenge.token(), challenge.answer()), uniqueIp())
                .getResponse().getStatus()).isEqualTo(201);
    }

    @Test
    @DisplayName("已用令牌账本只存 nonce，不存答案")
    void usedLedgerStoresOnlyNonce() throws Exception {
        CaptchaService.Challenge challenge = TestCaptcha.challenge();
        registerRaw(form(uniqueUsername("ledger"), challenge.token(), challenge.answer()), uniqueIp());
        String nonce = challenge.token().substring(0, challenge.token().indexOf('.'));
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM registration_captcha_used WHERE nonce = ?", Integer.class, nonce);
        assertThat(rows).isEqualTo(1);
        List<String> columns = jdbc.queryForList(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'registration_captcha_used'",
                String.class);
        assertThat(columns).extracting(String::toLowerCase)
                .containsExactlyInAnyOrder("nonce", "used_at", "expires_at");
    }
}
