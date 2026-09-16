package com.typeme.account.repository;

import java.time.Instant;

/**
 * {@code account_recovery_code} 的一行。
 *
 * <p>{@code codeHash} 是 {@code PasswordEncoder} 的输出（含算法与参数）；本记录里没有、
 * 也不会有明文字段 —— 这是"恢复码只返回一次"能成立的结构前提。
 */
public record RecoveryCodeRecord(
        String id,
        String userId,
        String codeHash,
        int codeIndex,
        Instant usedAt,
        Instant createdAt,
        Instant revokedAt
) {
}
