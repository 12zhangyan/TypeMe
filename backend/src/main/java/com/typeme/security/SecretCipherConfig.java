package com.typeme.security;

import com.typeme.ai.port.SecretCipher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.encrypt.TextEncryptor;

/**
 * 把账号模块的 {@link TextEncryptor} 接成 AI 模块需要的 {@link SecretCipher}。
 *
 * <p>## 这个 bean 为什么必须存在（否则后台填 key 是白填）
 *
 * <p>{@code AiSettingsService}（后台设置页）用 {@code Encryptors.delux} 把 apiKey 加密后写
 * {@code typeme_ai_setting.api_key_encrypted}；而 {@code AiRuntimeSettingsProvider}
 * （AI 调度器真正读配置的地方）要解密只能靠注入 {@link SecretCipher}。
 * 这个 port 原本**只有接口没有实现**，于是：
 *
 * <pre>
 *   后台页保存 key → 页面显示"已保存"、指纹变了
 *   创建 AI 分析   → 读出来是空 key → 503 AI_NOT_CONFIGURED（或悄悄回退环境变量）
 * </pre>
 *
 * <p>用户按提示做完了每一件事，系统却告诉他"你没配置"。这条断点在两个模块各自的测试里
 * **都看不出来**（各自那一半都是自洽的），所以 {@code AdminAiKeyReachesAiModuleIT}
 * 是按"跨模块不变量"写的：走真实写入路径 + 真实读取路径，断言 AI 模块说得出
 * "我能用这个 key，来源是 db"。
 *
 * <p>## 为什么放在 {@code security} 包而不是 {@code ai} 包
 *
 * <p>加密算法与密钥来自 {@code typeme.security.settings-secret}，实现只有安全模块知道；
 * AI 模块刻意只依赖 port，不依赖 {@code com.typeme.security} 的具体类型
 * （见 {@code SecretCipher} 的注释）。把实现留在提供密钥的这一侧，依赖方向不会反过来。
 *
 * <p>## 解不开时的行为
 *
 * <p>返回 {@code null}，由调用方按"没有 db key"处理并回退环境变量 —— 这是
 * {@code SecretCipher#decrypt} 契约写明的语义。**不抛异常**：密钥轮换后旧密文解不开
 * 是预期情形，让它把整个 AI 模块打成 500 才是真正的故障。
 */
@Configuration
public class SecretCipherConfig {

    private static final Logger log = LoggerFactory.getLogger(SecretCipherConfig.class);

    /** 日志里只用这个固定标识，不含任何秘密，也不含密文。 */
    static final String PROVIDER_NAME = "spring-text-encryptor";

    @Bean
    public SecretCipher secretCipher(TextEncryptor settingsTextEncryptor) {
        return new TextEncryptorSecretCipher(settingsTextEncryptor);
    }

    /**
     * {@code TextEncryptor} 的适配器。
     *
     * <p>未配置 {@code settings-secret} 时注入进来的是
     * {@code PasswordEncoderConfig.UnavailableTextEncryptor}（调用即抛 {@code IllegalStateException}），
     * 这里捕获后同样返回 null —— 表现与"没有 db key"一致：不会静默产出可用结果，
     * 也不会把应用打成不可用。
     */
    static final class TextEncryptorSecretCipher implements SecretCipher {

        private final TextEncryptor delegate;

        TextEncryptorSecretCipher(TextEncryptor delegate) {
            this.delegate = delegate;
        }

        @Override
        public String decrypt(String cipherText) {
            if (cipherText == null || cipherText.isBlank()) {
                return null;
            }
            try {
                return delegate.decrypt(cipherText);
            } catch (RuntimeException ex) {
                // 密钥不匹配 / 未配置密钥 / 历史脏数据：都属于"这一份用不了"，回退环境变量。
                // 只记异常类型与一句话，绝不记密文或明文。
                log.warn("后台 apiKey 解密失败（provider={}，原因：{}）。将回退到环境变量 DEEPSEEK_API_KEY。",
                        PROVIDER_NAME, ex.getClass().getSimpleName());
                return null;
            }
        }

        @Override
        public String providerName() {
            return PROVIDER_NAME;
        }
    }
}
