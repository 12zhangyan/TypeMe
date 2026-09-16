package com.typeme.account;

import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.service.AdminBootstrapService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 管理员引导的**生效**分支（任务书要求二选一，本实现选 (a)：配置项 + 启动期一次性提升）。
 *
 * <p>必须用独立上下文（{@code typeme.admin.bootstrap-username} 非空 + **独立 H2 库**）：
 * 配置是启动期绑定的不可变 record，测试里改不了；而"提升"这个动作一旦发生就写进了数据库，
 * 与其它用例共享库会互相影响 —— {@code AdminApiIT} 会把账号提升成 ADMIN，
 * 那时本类"系统里还没有 ADMIN"的前提就不成立了。
 *
 * <p>独立库由基类上的 {@code @AccountTestDatabase}（{@code @Inherited}）自动提供，
 * 库名按本类类名派生，无需在此声明。
 */
class AdminBootstrapIT extends AccountIntegrationTestBase {

    private static final String BOOTSTRAP_USERNAME = "typeme_bootstrap_probe";

    @DynamicPropertySource
    static void bootstrapConfig(DynamicPropertyRegistry registry) {
        registry.add("typeme.admin.bootstrap-username", () -> BOOTSTRAP_USERNAME);
    }

    @Autowired
    private AdminBootstrapService adminBootstrapService;

    @Autowired
    private UserRepository users;

    @Test
    @DisplayName("配置账号存在且系统中没有 ADMIN → 被提升为 ADMIN；之后不再重复提权")
    void promotesConfiguredAccountWhenNoAdminExists() throws Exception {
        // 应用启动时该账号还不存在（干净的 H2 库），所以启动期那一次是"找不到账号、不动作"
        assertThat(users.existsAdmin()).isFalse();

        RegisteredAccount probe = register(BOOTSTRAP_USERNAME, "TestPassw0rd!");
        assertThat(users.findById(probe.userId()).orElseThrow().role())
                .as("注册出来的账号默认是 USER")
                .isEqualTo(UserRecord.ROLE_USER);

        // 显式触发（生产里由 ApplicationRunner 在启动时调用；这里为了可测性直接调）
        assertThat(adminBootstrapService.promoteBootstrapUserIfNeeded()).isTrue();
        assertThat(users.findById(probe.userId()).orElseThrow().role()).isEqualTo(UserRecord.ROLE_ADMIN);
        assertThat(users.existsAdmin()).isTrue();

        // 已有 ADMIN → 短路，不再提权（幂等、自动失效）
        assertThat(adminBootstrapService.promoteBootstrapUserIfNeeded()).isFalse();

        // 被提升后确实能访问后台（角色真的进了认证主体）
        var session = new org.springframework.mock.web.MockHttpSession();
        CsrfContext csrf = csrf(session);
        assertThat(login(csrf, session, BOOTSTRAP_USERNAME, "TestPassw0rd!", uniqueIp())
                .getResponse().getStatus()).isEqualTo(200);
        assertThat(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .get("/api/v3/admin/ai-settings").session(session))
                .andReturn().getResponse().getStatus())
                .as("提升后的账号必须能访问后台")
                .isEqualTo(200);
    }
}
