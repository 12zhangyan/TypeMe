package com.typeme.account.service;

import com.typeme.common.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.Duration;
import java.util.*;

@Service
public class InvitationService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcTemplate jdbc;
    public InvitationService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public static String hash(String code) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(code.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    @Transactional
    public Map<String,Object> create(String adminId, Instant expiresAt) {
        Instant now = Instant.now();
        if (expiresAt == null || !expiresAt.isAfter(now) || expiresAt.isAfter(now.plus(Duration.ofDays(365)))) {
            throw ApiException.validation("有效期必须晚于当前时间，且不超过一年。", Map.of("expiresAt", "请选择有效期限"));
        }
        byte[] bytes = new byte[24]; RANDOM.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String id = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO registration_invitation (id, code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
                id, hash(code), adminId, Timestamp.from(now), Timestamp.from(expiresAt));
        // Plaintext is returned once, never logged or persisted.
        return Map.of("id", id, "code", code, "expiresAt", expiresAt.toString());
    }

    /** Must run in the registration transaction; conditional UPDATE prevents double redemption. */
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void consume(String rawCode, String userId) {
        Instant now = Instant.now();
        String code = rawCode == null ? "" : rawCode.trim();
        if (code.length() != 32 || jdbc.update("""
                UPDATE registration_invitation SET used_by = ?, used_at = ?
                WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
                """, userId, Timestamp.from(now), hash(code), Timestamp.from(now)) != 1) {
            throw ApiException.validation("邀请码无效、已使用、已撤销或已过期，请联系管理员。", Map.of("invitationCode", "请使用有效且未使用的邀请码"));
        }
    }

    public Map<String,Object> list(int page, int size) {
        int p = Math.max(0, Math.min(page, 100000)), s = Math.max(1, Math.min(size, 100));
        Instant now = Instant.now();
        var items = jdbc.query("""
                SELECT i.id, i.created_at, i.expires_at, i.revoked_at, i.used_at, u.username_display
                FROM registration_invitation i LEFT JOIN app_user u ON u.id = i.used_by
                ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?
                """, (rs, n) -> {
            Map<String,Object> item = new LinkedHashMap<>();
            Instant expires = rs.getTimestamp("expires_at").toInstant();
            item.put("id", rs.getString("id"));
            item.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
            item.put("expiresAt", expires.toString());
            item.put("usedByUsername", rs.getString("username_display"));
            item.put("status", rs.getTimestamp("used_at") != null ? "USED" : rs.getTimestamp("revoked_at") != null ? "REVOKED" : !expires.isAfter(now) ? "EXPIRED" : "AVAILABLE");
            return item;
        }, s, p*s);
        return Map.of("items", items, "page", p, "size", s, "total", jdbc.queryForObject("SELECT COUNT(*) FROM registration_invitation", Long.class));
    }

    @Transactional
    public void revoke(String id) {
        int affected = jdbc.update("UPDATE registration_invitation SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL", Timestamp.from(Instant.now()), id);
        if (affected == 0) {
            var rows = jdbc.queryForList("SELECT used_at FROM registration_invitation WHERE id = ?", id);
            if (rows.isEmpty()) throw ApiException.notFound();
            if (rows.getFirst().get("used_at") != null) throw ApiException.conflict("邀请码已经使用，不能撤销注册。请刷新列表查看使用状态。");
        }
    }
}
