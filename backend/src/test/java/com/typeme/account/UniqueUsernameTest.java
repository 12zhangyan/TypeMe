package com.typeme.account;

import com.typeme.account.dto.AccountFieldRules;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * {@link AccountIntegrationTestBase#uniqueUsername(String)} 的回归测试。
 *
 * <p>为什么单独钉住一个测试辅助方法：它是**所有**账号/测评集成测试的用户名来源。
 * 它生成的名字一旦越过注册规则（4–32 位字母/数字/下划线），注册请求会得到
 * 400，紧接着"建草稿"就是 401 —— 整套测试随机红，而失败现场看起来像认证坏了。
 * 2026-10-18 的完整后端套件里出现过一次（{@code bigfive_unknown_rating_111900_136}，34 位），
 * 单独跑那个测试类却是绿的。
 */
class UniqueUsernameTest {

    private static final Pattern RULE = Pattern.compile(AccountFieldRules.USERNAME_PATTERN);

    private static void assertValid(String username) {
        assertThat(RULE.matcher(username).matches())
                .as("生成的用户名必须能通过注册校验：%s（长度 %d）", username, username.length())
                .isTrue();
    }

    @Test
    @DisplayName("长前缀加满长序列号/时间种子，仍落在 4–32 位规则内")
    void longPrefixStillSatisfiesTheRegistrationRule() {
        int[] sequences = {1, 9, 99, 136, 9999, 123456};
        long[] seeds = {0, 1, 999_999, -987_654_321L, Long.MAX_VALUE};
        for (int sequence : sequences) {
            for (long seed : seeds) {
                assertValid(AccountIntegrationTestBase.uniqueUsername("bigfive_unknown_rating", sequence, seed));
            }
        }
    }

    @Test
    @DisplayName("前缀被截断时，序列号仍让两条用例拿到不同名字")
    void truncationDoesNotCollapseNamesToTheSameValue() {
        String first = AccountIntegrationTestBase.uniqueUsername("bigfive_unknown_rating", 1, 123_456);
        String second = AccountIntegrationTestBase.uniqueUsername("bigfive_unknown_rating", 2, 123_456);
        assertThat(first).isNotEqualTo(second);
        assertThat(first.substring(0, 6)).isEqualTo("bigfiv");
    }

    @Test
    @DisplayName("短前缀不被截断，且时间种子的负值不会漏出非法字符")
    void shortPrefixIsPreservedAndNegativeSeedStaysValid() {
        String username = AccountIntegrationTestBase.uniqueUsername("race", 3, -987_654_321L);
        assertThat(username.startsWith("race_")).isTrue();
        assertValid(username);
    }
}
