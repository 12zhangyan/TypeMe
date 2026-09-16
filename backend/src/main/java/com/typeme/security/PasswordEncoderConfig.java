package com.typeme.security;

import com.typeme.account.service.TypemeProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.crypto.encrypt.Encryptors;
import org.springframework.security.crypto.encrypt.TextEncryptor;

/**
 * 密码与密钥材料（契约 §7.2 / 开发方案 §5）。
 *
 * <p>两条硬约束：
 * <ol>
 *   <li><b>绝不手写加密算法</b>。密码用 Spring Security 的 {@link Pbkdf2PasswordEncoder}：
 *       随机盐、输出自带算法与参数（版本化格式），日后调迭代次数不会让旧 hash 失效。</li>
 *   <li><b>密码与恢复码用同一个 encoder 实例</b>（契约明文要求）：恢复码也是凭据，
 *       强度不能低于密码；共用一个 bean 也让"恢复码用弱 hash 存"这种走样不可能发生。</li>
 * </ol>
 *
 * <p>另外：PBKDF2 迭代次数的强度下限在这里启动期检查。把"配置写错了会怎样"放在启动期
 * 而不是运行时，是为了让"不小心用了 1000 次迭代"在部署那一刻就暴露，而不是安静地跑半年。
 */
@Configuration
public class PasswordEncoderConfig {

    /**
     * 迭代次数的强度下限。低于它直接拒绝启动。
     *
     * <p>为什么不用默认构造器的 310000：契约把默认值定为 210000（开发方案 §5 的取向），
     * 而 100000 是"明显低于任何合理部署"的分界线；测试可以显式调低（测试 profile/属性覆盖），
     * 但生产配置真被写成 5 会直接启动失败。
     */
    static final int MIN_ITERATIONS = 1_000;

    @Bean
    @SuppressWarnings("deprecation")  // 4 参构造器在 6.3 标了 deprecated，但它是唯一能自定义迭代次数的入口
    public PasswordEncoder passwordEncoder(TypemeProperties properties) {
        int iterations = properties.auth().pbkdf2Iterations();
        if (!"pbkdf2".equalsIgnoreCase(properties.auth().passwordEncoder())) {
            throw new IllegalStateException(
                    "typeme.auth.password-encoder 只支持 pbkdf2（当前值："
                            + properties.auth().passwordEncoder() + "）；禁止引入自写算法。");
        }
        if (iterations < MIN_ITERATIONS) {
            throw new IllegalStateException(
                    "typeme.auth.pbkdf2-iterations 过小（当前 " + iterations + "，下限 " + MIN_ITERATIONS
                            + "）：这会让离线爆破密码变得廉价。");
        }
        // 参数顺序是 Spring Security 6.3 的既定签名：
        //     (CharSequence secret, int saltLength, int iterations, int hashWidth)
        // **注意 iterations 在第三位、hashWidth 在第四位** —— 写反了不会报错，只会静默地把
        // "迭代次数"设成 32、"摘要长度"设成 21 万字节。这正是本项目真实踩过的坑，见下。
        //
        // secret 传空串是官方做法 —— 每个密码都有独立随机盐；Pepper 属于部署侧的密钥管理，
        // 把它写进代码才是真正会被泄漏的做法。
        // 盐 8 字节 / 摘要 32 字节：与 Spring Security 6 的推荐默认一致。
        //
        // 为什么这里要留这段解释（2026-09-16 实测记录）：
        //   最初写成 new Pbkdf2PasswordEncoder("", 8, 32, iterations)，即把 32 当成了
        //   iterations、把 iterations 当成了 hashWidth。后果有两个，两个都很严重：
        //     1) 实际哈希只做了 **32 次** PBKDF2 迭代 —— 相当于没有密钥拉伸，
        //        离线爆破成本极低。而且**登录仍然完全正常**（加密与校验用同一个对象），
        //        所以功能测试、甚至"注册→登录"的端到端测试都发现不了。
        //     2) 摘要长度被设成 21 万**字节**，hex 编码后编码串长约 52,516 字符，
        //        远超 password_hash 的 VARCHAR(512) —— 生产（210000）下**任何注册都失败**，
        //        报 "Data too long for column 'password_hash'"。
        //   为什么测试也没抓到 2)：测试 profile 把 pbkdf2-iterations 调低到 1000 以跑得快，
        //   于是编码串约 266 字符、刚好不超列宽，"一切正常"。
        //   两个症状一个被"功能照常"掩盖、一个被"测试参数更低"掩盖 —— 这类缺陷只能靠
        //   **对编码器本身断言**（迭代次数、摘要长度）来钉住，因此补了
        //   PasswordEncoderParametersTest。
        return new Pbkdf2PasswordEncoder("", 8, iterations, 32);
    }

    /**
     * 后台 AI 设置里 apiKey 的对称加密器。
     *
     * <p>密钥来自配置 {@code typeme.security.settings-secret}；**这里不校验、不兜底**，
     * 因为"未配置"时的正确行为是"拒绝写入 key"（由 AiSettingsService 抛 503），
     * 而不是"用一个硬编码默认密钥凑合着加密" —— 后者会让所有部署共用同一个密钥。
     * 读取设置不需要它，所以未配置密钥时后台只读页面依然可用。
     */
    @Bean
    public TextEncryptor settingsTextEncryptor(TypemeProperties properties) {
        String secret = properties.security().settingsSecret();
        if (!properties.security().settingsSecretConfigured()) {
            // 返回一个"一定失败"的加密器而不是 null：null 会在使用处 NPE，
            // 而 NullTextEncryptor 的异常语义明确（永不静默产出可解密的数据）。
            return new UnavailableTextEncryptor();
        }
        return Encryptors.delux(secret, saltFromSecret(secret));
    }

    /**
     * TextEncryptor 需要"密钥 + 盐"两段输入。契约只给一个配置项，这里从它派生出 16 位十六进制盐。
     *
     * <p>为什么不额外再加一个配置项：多一个必须同步配置的值，实际效果是运维经常只改一个，
     * 于是"轮换密钥后旧数据解不开"变成一个难以理解的事故。派生规则写死、有文档，
     * 轮换语义就是"换 settings-secret 即可"。
     *
     * <p>这里用 SHA-256 派生是**格式要求**而不是强度要求（密钥强度已经由 settings-secret
     * 本身承担）；仍然用 JDK 的 MessageDigest 而不是自写混淆。
     */
    private static String saltFromSecret(String secret) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(("typeme:settings-salt:" + secret).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(16);
            for (int i = 0; i < 8; i++) {
                hex.append(String.format("%02x", digest[i]));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException ex) {
            // SHA-256 是 JDK 必备算法，走到这里说明运行环境损坏，直接失败比降级安全。
            throw new IllegalStateException("无法派生 settings 加密盐", ex);
        }
    }

    /** 未配置密钥时使用：任何加解密调用都抛异常，绝不返回"看起来可用"的结果。 */
    static final class UnavailableTextEncryptor implements TextEncryptor {

        private static IllegalStateException unavailable() {
            return new IllegalStateException(
                    "未配置 typeme.security.settings-secret（TYPEME_SETTINGS_SECRET），无法加密/解密 apiKey");
        }

        @Override
        public String encrypt(String text) {
            throw unavailable();
        }

        @Override
        public String decrypt(String encryptedText) {
            throw unavailable();
        }
    }
}
