package com.typeme.account.captcha;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

/**
 * 已使用验证码令牌的账本（{@code registration_captcha_used}）。
 *
 * <p>单独成 bean 是为了让事务注解生效：{@link #tryBurn} 必须在**独立事务**里提交——
 * 注册后续失败（用户名冲突、字段校验失败）会回滚业务事务，但"这个验证码已经被用过"
 * 不能跟着回滚，否则同一个码可以反复提交来探测用户名。同一原则见 {@code RateLimitService}。
 */
@Component
public class CaptchaNonceStore {

    private final JdbcTemplate jdbc;

    public CaptchaNonceStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 主键唯一做仲裁：并发提交同一令牌时只有一个能插入成功。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean tryBurn(String nonce, Instant expiresAt) {
        try {
            jdbc.update("INSERT INTO registration_captcha_used (nonce, used_at, expires_at) VALUES (?, ?, ?)",
                    nonce, Timestamp.from(Instant.now()), Timestamp.from(expiresAt));
            return true;
        } catch (DuplicateKeyException replay) {
            return false;
        }
    }

    /**
     * 删除已过期的行。令牌过期后签名校验本身就会拒绝，所以这些行已经没有防重放的作用。
     * 先查键再按键删，避免 {@code DELETE ... LIMIT} 的方言差异（与幂等清理同一做法）。
     */
    @Transactional
    public int deleteExpired(Instant now, int limit) {
        if (limit <= 0) {
            return 0;
        }
        List<String> nonces = jdbc.queryForList(
                "SELECT nonce FROM registration_captcha_used WHERE expires_at < ? ORDER BY expires_at LIMIT ?",
                String.class, Timestamp.from(now), limit);
        int deleted = 0;
        for (String nonce : nonces) {
            deleted += jdbc.update("DELETE FROM registration_captcha_used WHERE nonce = ? AND expires_at < ?",
                    nonce, Timestamp.from(now));
        }
        return deleted;
    }
}
