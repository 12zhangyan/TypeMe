package com.typeme.account;

import com.typeme.security.RecoveryCodeGenerator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 凭据探测的两条防线：
 * <ul>
 *   <li>恢复接口：账号不存在与恢复码不对必须做同样多的 PBKDF2 比对，否则耗时差就是账号枚举器；</li>
 *   <li>已登录后的「再输一次当前密码」类操作：按用户限流，会话持有者不能无限猜密码。</li>
 * </ul>
 * 耗时本身不稳定，所以这里断言的是<b>比对次数</b>（耗时的决定因素），而不是毫秒数。
 */
class CredentialProbeResistanceIT extends AccountIntegrationTestBase {

    @SpyBean
    private PasswordEncoder passwordEncoder;

    @Test
    @DisplayName("恢复：用户不存在、恢复码不对两种失败，PBKDF2 比对次数一致且响应相同")
    void recoverFailureDoesSameWorkForUnknownAndKnownUser() throws Exception {
        RegisteredAccount account = register(uniqueUsername("probe"), "TestPassw0rd!");
        MockHttpSession anonymous = new MockHttpSession();
        CsrfContext csrf = csrf(anonymous);

        clearInvocations(passwordEncoder);
        MvcResult unknown = recover(anonymous, csrf, uniqueUsername("ghost"), "AAAA-BBBB-CCCC-DDDD");
        verify(passwordEncoder, times(RecoveryCodeGenerator.CODES_PER_SET)).matches(anyString(), anyString());

        clearInvocations(passwordEncoder);
        MvcResult wrongCode = recover(anonymous, csrf, account.username(), "AAAA-BBBB-CCCC-DDDD");
        verify(passwordEncoder, times(RecoveryCodeGenerator.CODES_PER_SET)).matches(anyString(), anyString());

        assertThat(unknown.getResponse().getStatus()).isEqualTo(401);
        assertThat(wrongCode.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(unknown).path("code").asText()).isEqualTo(body(wrongCode).path("code").asText());
        assertThat(body(unknown).path("message").asText()).isEqualTo(body(wrongCode).path("message").asText());
    }

    @Test
    @DisplayName("恢复：用掉几个恢复码后失败路径的比对次数不随剩余码数下降")
    void recoverFailureWorkDoesNotShrinkWithFewerUsableCodes() throws Exception {
        RegisteredAccount account = register(uniqueUsername("probe"), "TestPassw0rd!");
        MockHttpSession anonymous = new MockHttpSession();
        CsrfContext csrf = csrf(anonymous);

        // 用掉一个码（成功恢复），随后其余码被作废：此时可用码为 0，失败路径仍要做满一整套比对。
        String used = account.recoveryCodes().get(0);
        MvcResult ok = recover(anonymous, csrf, account.username(), used);
        assertThat(ok.getResponse().getStatus()).isEqualTo(204);

        clearInvocations(passwordEncoder);
        MvcResult wrong = recover(anonymous, csrf, account.username(), "AAAA-BBBB-CCCC-DDDD");
        assertThat(wrong.getResponse().getStatus()).isEqualTo(401);
        verify(passwordEncoder, times(RecoveryCodeGenerator.CODES_PER_SET)).matches(anyString(), anyString());
    }

    @Test
    @DisplayName("再次验证当前密码：同一用户连续猜错超过上限后被 429 挡住，正确密码也不放行；别的用户不受影响")
    void passwordConfirmIsRateLimitedPerUser() throws Exception {
        RegisteredAccount victim = register(uniqueUsername("victim"), "TestPassw0rd!");
        RegisteredAccount other = register(uniqueUsername("other"), "TestPassw0rd!");
        CsrfContext csrf = csrf(victim.session());

        for (int attempt = 0; attempt < 10; attempt++) {
            assertThat(changePassword(victim.session(), csrf, "Wrong-Passw0rd!").getResponse().getStatus())
                    .as("第 %d 次猜错仍是 401", attempt + 1).isEqualTo(401);
        }
        MvcResult blockedWrong = changePassword(victim.session(), csrf, "Wrong-Passw0rd!");
        assertThat(blockedWrong.getResponse().getStatus()).isEqualTo(429);
        assertThat(body(blockedWrong).path("code").asText()).isEqualTo("RATE_LIMITED");

        // 限流必须在比对密码之前生效：被挡住后即使给对密码也不能改成功，猜测才没有意义。
        assertThat(changePassword(victim.session(), csrf, "TestPassw0rd!").getResponse().getStatus())
                .isEqualTo(429);

        // 另一个用户的同类操作不受影响（按 userId 计数，不是全局桶）。
        CsrfContext otherCsrf = csrf(other.session());
        assertThat(changePassword(other.session(), otherCsrf, "TestPassw0rd!").getResponse().getStatus())
                .isEqualTo(204);
    }

    private MvcResult recover(MockHttpSession session, CsrfContext csrf, String username, String code)
            throws Exception {
        return mockMvc.perform(withCsrf(post("/api/v3/auth/recover")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "recoveryCode", code,
                                "newPassword", "Recovered-Passw0rd!"))), csrf))
                .andReturn();
    }

    private MvcResult changePassword(MockHttpSession session, CsrfContext csrf, String currentPassword)
            throws Exception {
        return mockMvc.perform(withCsrf(post("/api/v3/me/password")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", currentPassword,
                                "newPassword", "NewPassw0rd!2"))), csrf))
                .andReturn();
    }
}
