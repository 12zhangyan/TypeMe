package com.typeme.account;

import org.springframework.jdbc.core.JdbcTemplate;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;

/** Test-only fixtures for isolated test databases; never a registration bypass. */
public final class TestInvitations {
    private TestInvitations() {}
    public static String create(JdbcTemplate jdbc) {
        String code = UUID.randomUUID().toString().replace("-", "");
        try {
            String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(code.getBytes(StandardCharsets.UTF_8)));
            jdbc.update("INSERT INTO registration_invitation(id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)",
                    UUID.randomUUID().toString(), hash, Timestamp.from(Instant.now()), Timestamp.from(Instant.now().plusSeconds(3600)));
            return code;
        } catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
