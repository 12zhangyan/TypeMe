package com.typeme.account;

import com.typeme.account.captcha.CaptchaService;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 测试用验证码：用与生产同一份签名代码，以测试密钥造出合法令牌和已知答案。
 * 生产代码里没有"关闭验证码"的开关，测试也不绕过它。
 */
public final class TestCaptcha {

    /** 测试专用的合成密钥（>=32 字符），不是任何真实环境的值。 */
    public static final String SECRET = "test-captcha-secret-0123456789-abcdef";

    private TestCaptcha() {
    }

    public static CaptchaService.Challenge challenge() {
        return CaptchaService.newChallenge(SECRET, Instant.now(), Duration.ofMinutes(3));
    }

    /** 注册请求体：给定字段 + 一道全新的、答对的验证码。 */
    public static Map<String, Object> body(Object... keyValues) {
        Map<String, Object> body = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            body.put((String) keyValues[i], keyValues[i + 1]);
        }
        CaptchaService.Challenge challenge = challenge();
        body.put("captchaToken", challenge.token());
        body.put("captchaAnswer", challenge.answer());
        return body;
    }
}
