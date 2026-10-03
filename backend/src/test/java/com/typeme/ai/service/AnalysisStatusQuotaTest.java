package com.typeme.ai.service;

import com.typeme.ai.config.AiRuntimeSettings;
import com.typeme.ai.config.AiRuntimeSettingsProvider;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

import java.time.Duration;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * `GET /api/v3/ai/status` 的额度语义（A53②）。
 *
 * <p>这条缺陷在界面上表现为"理直气壮地写一个我们并不知道的数字"：读额度失败时原来按
 * `used = 0` 算，于是 `remaining = 每日上限` —— 用户看到"今天还可以生成 20 次"，
 * 而这一刻服务端根本读不到额度。他据此决定"那我慢慢来"，第一次生成就可能撞 429。
 *
 * <p>契约里 `-1` 就是"算不清"（前端把它映射成"不显示次数"），所以正确的收场是
 * **能力可用但次数未知**，而不是"次数很多"。
 *
 * <p>为什么用纯单元测试而不是走 HTTP：要走 HTTP 就得让 `reserved_calls` 在集成环境里
 * 真的读失败（拆表/坏连接），那会污染同一个 Spring 上下文里的其它用例；
 * 而 `status()` 只依赖 `settingsProvider` 与 `budgets` 两个协作者，直接装配更精确，
 * 也不会把"数据库坏了"这种状态留在共享的 H2 里。
 */
class AnalysisStatusQuotaTest {

    private static AiRuntimeSettings settings(int dailyLimitPerUser) {
        return new AiRuntimeSettings(
                true,
                "https://api.deepseek.com",
                "deepseek-flash",
                "sk-test-not-a-real-key",
                AiRuntimeSettings.AiKeySource.ENV,
                "prompt-v1",
                false,
                dailyLimitPerUser,
                20,
                500L,
                200_000L,
                2,
                Duration.ofSeconds(5),
                Duration.ofSeconds(60),
                1024,
                0.2d,
                Duration.ofMinutes(2));
    }

    /** 只覆盖 `settings()`，其余（缓存、失效通知）在这条用例里用不到。 */
    private static AiRuntimeSettingsProvider provider(int dailyLimitPerUser) {
        return new AiRuntimeSettingsProvider(null, null, null) {
            @Override
            public AiRuntimeSettings settings() {
                return AnalysisStatusQuotaTest.settings(dailyLimitPerUser);
            }
        };
    }

    private static AnalysisService service(AiRuntimeSettingsProvider provider, AiBudgetRepository budgets) {
        // status() 只碰 provider 与 budgets，其余协作者传 null 是**这条用例的断言前提**：
        // 一旦将来 status() 用到别的协作者，这里会立刻 NPE 而不是悄悄给出一个别的结论。
        return new AnalysisService(provider, null, null, budgets, null, null, null);
    }

    @Test
    @DisplayName("额度读得到：remaining = 上限 - 已用")
    void remainingIsLimitMinusUsed() {
        AiBudgetRepository budgets = new AiBudgetRepository(null, null) {
            @Override public int effectiveUserLimit(String user, int fallback, boolean lock) { return fallback; }
            @Override
            public LocalDate today() {
                return LocalDate.of(2026, 9, 18);
            }

            @Override
            public int reservedCalls(String scopeKey, LocalDate date) {
                assertThat(scopeKey).as("额度是按账号算的，作用域必须带用户").isEqualTo("user:user-1");
                return 3;
            }
        };

        AnalysisService.StatusView view = service(provider(20), budgets).status("user-1");

        assertThat(view.remainingToday()).isEqualTo(17);
    }

    @Test
    @DisplayName("额度读不到：remaining 是 -1（次数未知），绝不按 used=0 编一个满额度")
    void quotaReadFailureMeansUnknownNotFullQuota() {
        AiBudgetRepository budgets = new AiBudgetRepository(null, null) {
            @Override public int effectiveUserLimit(String user, int fallback, boolean lock) { return fallback; }
            @Override
            public LocalDate today() {
                throw new DataAccessResourceFailureException("数据库读不到今天");
            }

            @Override
            public int reservedCalls(String scopeKey, LocalDate date) {
                throw new DataAccessResourceFailureException("读额度失败");
            }
        };

        AnalysisService.StatusView view = service(provider(20), budgets).status("user-1");

        assertThat(view.remainingToday())
                .as("读不到额度时不能报一个满额度（那是编的）：契约里 -1 表示算不清")
                .isEqualTo(-1);
        assertThat(view.enabled())
                .as("额度读不到不影响「这台服务器开没开 AI」这个判断")
                .isTrue();
        assertThat(view.dailyLimitPerUser()).as("上限本身仍可以照实给出（它来自配置）").isEqualTo(20);
    }

    @Test
    @DisplayName("没有登录：不读额度，次数按未知处理（不是「零次」也不是满额度）")
    void anonymousCallerDoesNotReportAQuota() {
        AiBudgetRepository budgets = new AiBudgetRepository(null, null) {
            @Override public int effectiveUserLimit(String user, int fallback, boolean lock) { return fallback; }
            @Override
            public LocalDate today() {
                throw new AssertionError("匿名请求不该去读某个账号的额度");
            }

            @Override
            public int reservedCalls(String scopeKey, LocalDate date) {
                throw new AssertionError("匿名请求不该去读某个账号的额度");
            }
        };

        AnalysisService.StatusView view = service(provider(20), budgets).status(null);

        assertThat(view.remainingToday())
                .as("未登录时返回 -1（前端据此不显示「今天还能生成几次」）")
                .isEqualTo(-1);
    }
}
