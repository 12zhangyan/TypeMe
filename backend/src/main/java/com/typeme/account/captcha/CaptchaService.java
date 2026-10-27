package com.typeme.account.captcha;

import com.typeme.account.service.TypemeProperties;
import com.typeme.common.ApiException;
import com.typeme.security.RateLimitService;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 注册用图形验证码：无状态签名挑战 + 一次性使用。
 *
 * <p><b>令牌</b> = {@code nonce.到期秒.HMAC}，HMAC 覆盖 {@code nonce|到期秒|答案}。
 * 签发时不写库（匿名接口不该是写库放大器）；校验时用提交的答案重算 HMAC，
 * 服务端从不保存答案，攻击者拿着令牌也无法离线验证答案——必须逐次在线尝试。
 *
 * <p><b>防爆破与重放</b>只在"有人提交答案"时落库：
 * 答错按 nonce 计数，达到上限令牌作废；答对则把 nonce 写进 {@code registration_captcha_used}
 * （独立事务，主键唯一），写失败即视为重放。
 *
 * <p><b>对外只有一种失败语义</b>：过期、答错、被篡改、已使用、已作废的文案和字段完全相同，
 * 不给脚本分类信号。唯一的例外是密钥未配置：返回 503，而不是放行或回退到默认密钥。
 */
@Service
public class CaptchaService {

    public static final int LENGTH = 5;
    public static final String ANSWER_FIELD = "captchaAnswer";

    private static final String INVALID_MESSAGE = "验证码不对或已过期，请换一张再试。";
    private static final Pattern NONCE = Pattern.compile("[0-9a-f]{32}");
    private static final SecureRandom RANDOM = new SecureRandom();

    /** 一道完整的题：令牌、答案与图片。答案只存在于服务端内存和这个对象里，绝不进响应。 */
    public record Challenge(String token, String answer, byte[] png) {
    }

    /** 返回给前端的部分。 */
    public record Issued(String token, String image, long expiresInSeconds) {
    }

    private final TypemeProperties properties;
    private final RateLimitService rateLimit;
    private final CaptchaNonceStore nonces;

    public CaptchaService(TypemeProperties properties, RateLimitService rateLimit, CaptchaNonceStore nonces) {
        this.properties = properties;
        this.rateLimit = rateLimit;
        this.nonces = nonces;
    }

    public Issued issue() {
        Duration ttl = properties.ratelimit().registration().captchaTtl();
        Challenge challenge = newChallenge(properties.security().requireCaptchaSecret(), Instant.now(), ttl);
        return new Issued(challenge.token(),
                "data:image/png;base64," + Base64.getEncoder().encodeToString(challenge.png()),
                ttl.getSeconds());
    }

    /**
     * 生成一道题。静态且带密钥参数，是为了让测试用与生产**同一份**签名代码造出合法令牌，
     * 而不是在生产代码里留一个"关闭验证码"的开关（开关误配到生产就是裸奔）。
     */
    public static Challenge newChallenge(String secret, Instant now, Duration ttl) {
        byte[] nonceBytes = new byte[16];
        RANDOM.nextBytes(nonceBytes);
        String nonce = HexFormat.of().formatHex(nonceBytes);
        StringBuilder answer = new StringBuilder(LENGTH);
        for (int i = 0; i < LENGTH; i++) {
            answer.append(CaptchaImageRenderer.ALPHABET.charAt(
                    RANDOM.nextInt(CaptchaImageRenderer.ALPHABET.length())));
        }
        long expiry = now.plus(ttl).getEpochSecond();
        String token = nonce + "." + expiry + "." + sign(secret, nonce, expiry, answer.toString());
        return new Challenge(token, answer.toString(), CaptchaImageRenderer.render(answer.toString(), RANDOM));
    }

    /**
     * 校验并消耗验证码。必须在任何 PBKDF2 / 建号之前调用。
     *
     * @throws ApiException 400（统一失败语义）或 503（密钥未配置）
     */
    public void verifyAndConsume(String token, String answer) {
        String secret = properties.security().requireCaptchaSecret();
        TypemeProperties.Registration cfg = properties.ratelimit().registration();

        Parsed parsed = Parsed.parse(token);
        if (parsed == null || Instant.now().getEpochSecond() > parsed.expiry()) {
            throw invalid();
        }
        if (rateLimit.captchaWrongCount(parsed.nonce(), cfg.captchaTtl()) >= cfg.captchaMaxWrong()) {
            throw invalid();
        }
        String expected = sign(secret, parsed.nonce(), parsed.expiry(), normalize(answer));
        // 常量时间比较，避免按字节的时间差泄露签名。
        if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                parsed.signature().getBytes(StandardCharsets.UTF_8))) {
            rateLimit.recordCaptchaWrong(parsed.nonce(), cfg.captchaTtl());
            throw invalid();
        }
        if (!nonces.tryBurn(parsed.nonce(), Instant.ofEpochSecond(parsed.expiry()))) {
            throw invalid();
        }
    }

    static String normalize(String answer) {
        return answer == null ? "" : answer.replaceAll("\\s+", "").toUpperCase(Locale.ROOT);
    }

    private static ApiException invalid() {
        return ApiException.validation(INVALID_MESSAGE, Map.of(ANSWER_FIELD, "验证码不对或已过期"));
    }

    private static String sign(String secret, String nonce, long expiry, String answer) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal((nonce + "|" + expiry + "|" + answer).getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private record Parsed(String nonce, long expiry, String signature) {
        static Parsed parse(String token) {
            if (token == null || token.length() > 200) {
                return null;
            }
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3 || !NONCE.matcher(parts[0]).matches() || parts[2].isEmpty()) {
                return null;
            }
            try {
                return new Parsed(parts[0], Long.parseLong(parts[1]), parts[2]);
            } catch (NumberFormatException e) {
                return null;
            }
        }
    }
}
