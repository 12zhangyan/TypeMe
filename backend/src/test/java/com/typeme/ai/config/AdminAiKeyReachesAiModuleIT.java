package com.typeme.ai.config;

import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.account.dto.AdminAiSettingsUpdateRequest;
import com.typeme.account.service.AiSettingsService;
import com.typeme.ai.port.SecretCipher;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 跨模块不变量：**管理员在后台保存的 apiKey，AI 模块必须真的能用**。
 *
 * <p>## 为什么必须有一条这样的测试
 *
 * <p>这两个模块从来不是"一条链路"，而是**两个各自完整的半边**：
 * <ul>
 *   <li>账号模块 {@code AiSettingsService}：用 {@code TextEncryptor}（{@code Encryptors.delux}，
 *       密钥来自 {@code typeme.security.settings-secret}）加密后写 {@code typeme_ai_setting}；</li>
 *   <li>AI 模块 {@code AiRuntimeSettingsProvider}：读同一张表，但解密要靠注入的
 *       {@link SecretCipher} —— 一个**只有接口、没有实现**的 port。</li>
 * </ul>
 *
 * <p>两边单独看都自洽、各有测试，所以"接口没有被实现"这件事在各自的测试里都看不出来。
 * 真实后果是：管理员在后台填了 key、页面显示"已保存"、指纹也变了，
 * 但 AI 调度器读出来的是空 key → 创建分析返回 503 {@code AI_NOT_CONFIGURED}，
 * 或悄悄回退到环境变量。**用户按提示做完了一切，系统却说他没配。**
 *
 * <p>具体表现就是本类第一个用例（{@link #adminSavedKeyMustBeUsableByAiModule()}）：
 * 修复前它会在 {@code apiKeySource} 上失败（是 {@code none} 而不是 {@code db}）。
 *
 * <p>## 断言的口径
 *
 * <p>不断言"某个 bean 存在"（那是实现细节），而是断言**用户可见的结果**：
 * 后台保存后，AI 模块说得出"我能用这个 key"，且来源是 db。这样将来换成别的加密实现，
 * 只要行为对，测试仍然有效。
 */
class AdminAiKeyReachesAiModuleIT extends AccountIntegrationTestBase {

    /** 与 {@code AccountIntegrationTestBase} 的 settings-secret 对应；测试用的合成值。 */
    private static final String SYNTHETIC_KEY = "sk-verify-only-0123456789abcdef";

    @Autowired
    private AiSettingsService aiSettingsService;

    @Autowired
    private AiRuntimeSettingsProvider runtimeSettings;

    /** 修复前这个 bean 不存在（{@code SecretCipher} 没有实现），拿到的是 null。 */
    @Autowired
    private ObjectProvider<SecretCipher> secretCipher;

    @Test
    @DisplayName("后台保存的 apiKey 必须能被 AI 模块解密使用（apiKeySource=db）")
    void adminSavedKeyMustBeUsableByAiModule() {
        // 1) 走后台真实的写入路径（加密由 TextEncryptor 完成）
        aiSettingsService.update(
                new AdminAiSettingsUpdateRequest(
                        true, null, null, null, null, null, null, null, null,
                        null, null, null, false, SYNTHETIC_KEY),
                "admin-user-id");

        // 2) 走 AI 模块真实的读取路径
        AiRuntimeSettings effective = runtimeSettings.settings();

        assertThat(effective.hasApiKey())
                .as("后台保存密钥后，AI 模块必须能取到可用的 apiKey（否则后台页显示已保存、分析却报未配置）")
                .isTrue();
        assertThat(effective.apiKeySource())
                .as("密钥来源必须是 db —— 回退到 env/none 说明后台保存的那一份没被读到")
                .isEqualTo(AiRuntimeSettings.AiKeySource.DB);
        assertThat(effective.apiKey())
                .as("解出来的明文必须与写入的一致")
                .isEqualTo(SYNTHETIC_KEY);
    }

    @Test
    @DisplayName("account 模块确实提供了 SecretCipher 实现（AI 模块的解密入口）")
    void secretCipherImplementationIsProvided() {
        SecretCipher cipher = secretCipher.getIfAvailable();
        assertThat(cipher)
                .as("AI 模块的 SecretCipher port 必须由账号/安全模块提供实现；"
                        + "缺失时后台保存的密钥永远解不开，而报错只以 WARN 形式出现")
                .isNotNull();
        // providerName 不含秘密，可以安全断言存在。
        assertThat(cipher.providerName()).isNotBlank();
    }

    @Test
    @DisplayName("后台保存后 AI 模块立即读到新值（不需要等缓存过期、更不需要重启）")
    void adminSaveTakesEffectImmediately() {
        aiSettingsService.update(
                new AdminAiSettingsUpdateRequest(
                        true, null, null, null, null, null, null, null, null,
                        null, null, null, true, null),
                "admin-user-id");
        // 先读一次把"演示模式=true"灌进 10 秒缓存 —— 不做这一步，本用例在"缓存恰好已过期"时
        // 也会通过，等于没验证到失效通知。这是刻意的受控反例设置。
        assertThat(runtimeSettings.settings().mockMode()).isTrue();

        aiSettingsService.update(
                new AdminAiSettingsUpdateRequest(
                        true, null, null, null, null, null, null, null, null,
                        null, null, null, false, null),
                "admin-user-id");

        // 中间不 sleep：保存后立刻读必须就是新值。
        assertThat(runtimeSettings.settings().mockMode())
                .as("保存后立即读到的必须是新值；若为 true 说明写入方没有通知读取侧失效缓存")
                .isFalse();
    }

    @Test
    @DisplayName("未配置密钥时如实报 none，不能把「没 key」说成「有 key」")
    void noKeyReportedAsNone() {
        aiSettingsService.update(
                new AdminAiSettingsUpdateRequest(
                        true, null, null, null, null, null, null, null, null,
                        null, null, null, false, ""),
                "admin-user-id");

        AiRuntimeSettings effective = runtimeSettings.settings();
        // 测试环境没有 DEEPSEEK_API_KEY，所以清空后应当既没有 key、来源为 none。
        assertThat(effective.hasApiKey()).isFalse();
        assertThat(effective.apiKeySource()).isEqualTo(AiRuntimeSettings.AiKeySource.NONE);
    }
}
