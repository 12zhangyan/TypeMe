package com.typeme.security;

import com.typeme.account.service.TypemeProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.lang.reflect.Field;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 口令编码器的**参数**回归防线。
 *
 * <p><b>为什么需要这个测试</b>：{@code Pbkdf2PasswordEncoder} 的 4 参构造器签名是
 * {@code (secret, saltLength, iterations, hashWidth)} —— {@code iterations} 在**第三位**。
 * 本项目曾经把第三、四两个 int 写反，写成
 * {@code new Pbkdf2PasswordEncoder("", 8, 32, iterations)}。这个错误**不会抛异常**，
 * 只会静默产生两个后果：
 *
 * <ol>
 *   <li><b>实际只做 32 次 PBKDF2 迭代</b>（本该 210000）—— 等于没有密钥拉伸，
 *       离线爆破口令的成本被拉低好几个数量级。而**登录依旧完全正常**，
 *       因为加密与校验用的是同一个对象，所以任何"注册 → 登录"的功能测试都是绿的。</li>
 *   <li><b>摘要长度被设成 21 万字节</b>，hex 编码后编码串长约 5.2 万字符，
 *       远超 {@code password_hash VARCHAR(512)} —— 生产配置下**任何注册都失败**
 *       （{@code Data too long for column 'password_hash'}）。</li>
 * </ol>
 *
 * <p>为什么原有测试两个都没抓到：功能测试不检查编码器参数；而测试 profile 把
 * {@code pbkdf2-iterations} 调低到 1000 以跑得快，编码串恰好约 266 字符、
 * 不超列宽，于是"一切正常"。两个症状一个被"功能照常"掩盖、一个被"测试参数更低"掩盖。
 *
 * <p>所以本类直接对编码器**本身**断言：迭代次数、摘要长度、以及编码串长度能进列宽。
 * 把参数改回去，前三条就会红。
 */
class PasswordEncoderParametersTest {

    /** 复刻生产默认值：契约把 pbkdf2 迭代次数定为 210000。 */
    private static final int PRODUCTION_ITERATIONS = 210_000;

    /** {@code password_hash} 的列宽（V8 迁移加宽后是 512）。 */
    private static final int COLUMN_WIDTH = 512;

    private static final String PASSWORD = "E2e-Passw0rd!2026";

    private static PasswordEncoder encoderWithIterations(int iterations) {
        TypemeProperties properties = new TypemeProperties(
                new TypemeProperties.Auth(
                        Duration.ofDays(7), Duration.ofSeconds(60), false, "Lax", "pbkdf2", iterations),
                null, null, null, null);
        return new PasswordEncoderConfig().passwordEncoder(properties);
    }

    /** 反射读回编码器内部的真实参数 —— 这是"配置到底有没有生效"的唯一可信来源。 */
    private static int intField(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.getInt(target);
    }

    @Test
    @DisplayName("编码器真实使用的迭代次数等于配置值")
    void encoderUsesConfiguredIterationCount() throws Exception {
        PasswordEncoder encoder = encoderWithIterations(PRODUCTION_ITERATIONS);

        // 这是本测试的核心断言：曾经这里会是 32。
        assertThat(intField(encoder, "iterations"))
                .as("PBKDF2 迭代次数")
                .isEqualTo(PRODUCTION_ITERATIONS);
    }

    @Test
    @DisplayName("摘要长度是 32 字节，不是被写反后的 21 万")
    void hashWidthIsReasonable() throws Exception {
        PasswordEncoder encoder = encoderWithIterations(PRODUCTION_ITERATIONS);

        assertThat(intField(encoder, "hashWidth"))
                .as("摘要长度（字节）")
                .isEqualTo(32);
    }

    @Test
    @DisplayName("生产迭代次数下，编码串长度能进 password_hash VARCHAR(512)")
    void encodedHashFitsColumnAtProductionIterations() {
        String encoded = encoderWithIterations(PRODUCTION_ITERATIONS).encode(PASSWORD);

        // 曾经这里约 52516 —— 远超列宽，生产上任何注册都会失败。
        assertThat(encoded.length())
                .as("PBKDF2 编码串长度（实测字符串=%s…）", encoded.substring(0, Math.min(32, encoded.length())))
                .isLessThanOrEqualTo(COLUMN_WIDTH);
    }

    @Test
    @DisplayName("迭代次数涨 210 倍，编码串长度只多几个字符（说明摘要长度没被写反）")
    void encodedLengthDoesNotScaleWithIterations() {
        int lowLen = encoderWithIterations(1_000).encode(PASSWORD).length();
        int highLen = encoderWithIterations(PRODUCTION_ITERATIONS).encode(PASSWORD).length();

        // 迭代次数从 1000 涨到 210000，编码串只多了迭代次数那几位数字。
        // 若参数写反，这里会是成百上千倍的差距（实测：266 -> 52516）。
        assertThat(highLen)
                .as("迭代涨 210 倍后编码串长度（低=%d 高=%d）", lowLen, highLen)
                .isLessThan(lowLen + 32);
    }

    @Test
    @DisplayName("同一个编码器能校验自己产出的编码串（避免只改一边）")
    void encoderMatchesItsOwnOutput() {
        PasswordEncoder encoder = encoderWithIterations(PRODUCTION_ITERATIONS);
        String encoded = encoder.encode(PASSWORD);

        assertThat(encoder.matches(PASSWORD, encoded)).isTrue();
        assertThat(encoder.matches("wrong-password", encoded)).isFalse();
    }

    @Test
    @DisplayName("迭代次数低于下限时拒绝启动，而不是静默降级")
    void refusesIterationsBelowFloor() {
        assertThat(catchThrowable(() -> encoderWithIterations(500)))
                .hasMessageContaining("pbkdf2-iterations");
    }

    private static Throwable catchThrowable(Runnable action) {
        try {
            action.run();
            return null;
        } catch (Throwable err) {
            return err;
        }
    }
}
