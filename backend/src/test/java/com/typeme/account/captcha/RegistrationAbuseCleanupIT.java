package com.typeme.account.captcha;

import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/** A-9：过期的验证码账本行和早已过去的限流桶被清掉，未过期的保留。 */
class RegistrationAbuseCleanupIT extends AccountIntegrationTestBase {

    @Autowired
    RegistrationAbuseCleanupJob job;

    @Test
    @DisplayName("清理只删过期数据")
    void removesOnlyExpiredRows() {
        Instant now = Instant.now();
        String expired = "a".repeat(32);
        String live = "b".repeat(32);
        invitationJdbc.update("INSERT INTO registration_captcha_used (nonce, used_at, expires_at) VALUES (?, ?, ?)",
                expired, Timestamp.from(now.minus(Duration.ofHours(2))), Timestamp.from(now.minus(Duration.ofHours(1))));
        invitationJdbc.update("INSERT INTO registration_captcha_used (nonce, used_at, expires_at) VALUES (?, ?, ?)",
                live, Timestamp.from(now), Timestamp.from(now.plus(Duration.ofMinutes(3))));
        invitationJdbc.update(
                "INSERT INTO rate_limit_bucket (bucket_key, window_start, counter, revision) VALUES (?, ?, 1, 0)",
                "cleanup_old:ip:1.1.1.1:old", Timestamp.from(now.minus(Duration.ofHours(30))));
        invitationJdbc.update(
                "INSERT INTO rate_limit_bucket (bucket_key, window_start, counter, revision) VALUES (?, ?, 1, 0)",
                "cleanup_new:ip:1.1.1.1:new", Timestamp.from(now.minus(Duration.ofMinutes(10))));

        job.runOnce(now);

        assertThat(count("SELECT COUNT(*) FROM registration_captcha_used WHERE nonce = ?", expired)).isZero();
        assertThat(count("SELECT COUNT(*) FROM registration_captcha_used WHERE nonce = ?", live)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM rate_limit_bucket WHERE bucket_key = ?",
                "cleanup_old:ip:1.1.1.1:old")).isZero();
        assertThat(count("SELECT COUNT(*) FROM rate_limit_bucket WHERE bucket_key = ?",
                "cleanup_new:ip:1.1.1.1:new")).isEqualTo(1);
    }

    private int count(String sql, String arg) {
        Integer value = invitationJdbc.queryForObject(sql, Integer.class, arg);
        return value == null ? 0 : value;
    }
}
