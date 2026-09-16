package com.typeme.account.repository;

import java.time.Instant;

/** {@code account_deletion_job} 的一行。 */
public record DeletionJobRecord(
        String id,
        String userId,
        String status,
        Instant requestedAt,
        Instant completedAt,
        int attemptCount,
        String lastErrorCode
) {
}
