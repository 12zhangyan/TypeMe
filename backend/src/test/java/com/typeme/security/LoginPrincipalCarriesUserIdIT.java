package com.typeme.security;

import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserRecord;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * "认证主体上必须有 {@code getUserId()}"这条**跨模块约定**的回归防线。
 *
 * <p><b>为什么需要这个测试</b>（2026-09-16 端到端实测发现的真实缺陷）：
 * 新测模块（{@code jung.api.CurrentUser}）与 AI 模块（{@code ai.controller.AiCurrentUser}）
 * 刻意不依赖账号模块的类名，而是用反射调 {@code principal.getUserId()} 拿用户主键，
 * 取不到才退回 {@code Authentication#getName()}（也就是 username）。
 *
 * <p>但账号模块此前建立会话时用的是
 * {@code new UsernamePasswordAuthenticationToken(username, null, authorities)} ——
 * 主体就是用户名字符串，没有 {@code getUserId()}。于是那两个模块**每次都走退路**，
 * 把 username 当成 userId。真实后果：
 * <pre>
 *   Cannot add or update a child row: a foreign key constraint fails
 *   (`assessment_attempt`, CONSTRAINT `fk_attempt_user`
 *    FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))
 * </pre>
 * 登录、注册全都正常，但**一个测评都建不出来**。
 *
 * <p>为什么原有测试没抓到：集成测试大量使用 {@code @WithMockUser} 或自建假主体，
 * 而 AI 的测试辅助 {@code AiTestAuthentication} 自己实现了 {@code getUserId()} ——
 * 于是"约定"在测试里被满足了、在生产代码里没有。所以本类刻意**不** mock 认证，
 * 而是走真实的注册接口 + 真实的 {@link TypemeUserDetailsService}。
 */
class LoginPrincipalCarriesUserIdIT extends AccountIntegrationTestBase {

    @Autowired
    private TypemeUserDetailsService userDetailsService;

    @Autowired
    private UserRepository users;

    @Test
    @DisplayName("UserDetailsService 返回的主体带 getUserId()，且等于 app_user.id 而非 username")
    void userDetailsCarriesUserId() throws Exception {
        String username = uniqueUsername("principal_probe");
        RegisteredAccount registration = register(username, "Principal-Probe!2026");
        assertThat(registration.status()).as("注册应成功").isEqualTo(201);

        UserDetails details = userDetailsService.loadUserByUsername(username);

        assertThat(hasGetUserId(details))
                .as("主体 %s 必须实现 getUserId() —— 否则新测/AI 模块会静默把 username 当 userId，"
                        + "然后在 assessment_attempt.user_id / ai_analysis_job.user_id 的外键上失败",
                        details.getClass().getName())
                .isTrue();

        UserRecord user = findUser(username);
        assertThat(reflectUserId(details))
                .as("主体上的 userId 必须是 app_user.id（%s），不能是 username（%s）",
                        user.id(), user.usernameNormalized())
                .isEqualTo(user.id())
                .isNotEqualTo(user.usernameNormalized());
    }

    @Test
    @DisplayName("注册流程真的建立了会话，/api/v3/me 可用（顺带覆盖『登录后立刻 401』那条老缺陷）")
    void registrationEstablishesUsableSession() throws Exception {
        String username = uniqueUsername("principal_probe");
        RegisteredAccount registration = register(username, "Principal-Probe!2026");
        assertThat(registration.status()).as("注册应成功").isEqualTo(201);

        mockMvc.perform(get("/api/v3/me").session(registration.session()))
                .andExpect(status().isOk());
    }

    private UserRecord findUser(String username) {
        Optional<UserRecord> found = users.findByNormalizedUsername(UserRepository.normalize(username));
        assertThat(found).as("刚注册的账号应能在库里查到：" + username).isPresent();
        return found.get();
    }

    private static boolean hasGetUserId(Object principal) {
        try {
            principal.getClass().getMethod("getUserId");
            return true;
        } catch (NoSuchMethodException ex) {
            return false;
        }
    }

    private static String reflectUserId(Object principal) {
        try {
            Object value = principal.getClass().getMethod("getUserId").invoke(principal);
            return value == null ? null : String.valueOf(value);
        } catch (ReflectiveOperationException ex) {
            throw new AssertionError("反射取 getUserId() 失败", ex);
        }
    }
}