package com.typeme.platform;

import com.typeme.account.AccountIntegrationTestBase;
import com.typeme.jung.service.IdempotencyGuard;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;

import java.util.Map;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/** Fault injection against an isolated H2 database, not an existing user database. */
class AttemptCreationTransactionIT extends AccountIntegrationTestBase {

    @SpyBean
    private IdempotencyGuard idempotency;

    @Test
    void completionFailureRollsBackBothAttemptKindsAndAllowsSameKeyRetry() throws Exception {
        RegisteredAccount account = register(uniqueUsername("creation_tx"), "Creation-Tx!2026");
        CsrfContext csrf = csrf(account.session());
        for (String kind : new String[] {"jung", "big_five"}) {
            String operation = kind.equals("jung") ? "create_attempt" : "create_attempt_bigfive";
            String path = kind.equals("jung") ? "/api/v3/attempts" : "/api/v3/platform/attempts";
            String slug = kind.equals("jung") ? "jung48" : "bigfive50";
            String key = "failure-" + kind;
            int before = countAttempts(account.userId());
            doThrow(new IllegalStateException("synthetic completion failure"))
                    .when(idempotency).completeClaim(eq(account.userId()), eq(operation), eq(key),
                            anyString(), anyString());

            var failed = mockMvc.perform(withCsrf(post(path).session(account.session())
                    .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("instrument", slug))), csrf)).andReturn();
            assertThat(failed.getResponse().getStatus()).isEqualTo(500);
            assertThat(countAttempts(account.userId())).isEqualTo(before);
            assertThat(countClaims(account.userId(), operation, key)).isZero();

            reset(idempotency);
            var created = mockMvc.perform(withCsrf(post(path).session(account.session())
                    .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("instrument", slug))), csrf)).andReturn();
            assertThat(created.getResponse().getStatus()).isEqualTo(201);
            String attemptId = body(created).path("attemptId").asText();
            assertThat(countAttempts(account.userId())).isEqualTo(before + 1);

            var replay = mockMvc.perform(withCsrf(post(path).session(account.session())
                    .header("Idempotency-Key", key).contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("instrument", slug))), csrf)).andReturn();
            assertThat(body(replay).path("attemptId").asText()).isEqualTo(attemptId);
            assertThat(countAttempts(account.userId())).isEqualTo(before + 1);
        }
    }

    @Test
    void oldIncompleteClaimRequiresRecoveryAndCannotBeCleanedIntoDuplicateCreation() throws Exception {
        RegisteredAccount account = register(uniqueUsername("legacy_claim"), "Legacy-Claim!2026");
        CsrfContext csrf = csrf(account.session());
        String key = "old-incomplete-create";
        LocalDateTime old = LocalDateTime.now(ZoneOffset.UTC).minusDays(2);
        invitationJdbc.update("""
                INSERT INTO api_idempotency
                  (user_id, operation, idempotency_key, request_hash, response_ref, status, created_at, expires_at)
                VALUES (?, 'create_attempt_bigfive', ?, ?, NULL, 'IN_PROGRESS', ?, ?)
                """, account.userId(), key,
                IdempotencyGuard.fingerprint("create_attempt_bigfive", "typeme-bigfive50-zh-v1", null),
                old, old.plusDays(1));

        var result = mockMvc.perform(withCsrf(post("/api/v3/platform/attempts")
                .session(account.session()).header("Idempotency-Key", key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("instrument", "bigfive50"))), csrf)).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(409);
        assertThat(body(result).path("code").asText()).isEqualTo("IDEMPOTENCY_RECOVERY_REQUIRED");
        assertThat(countAttempts(account.userId())).isZero();
        assertThat(idempotency.deleteExpired(LocalDateTime.now(ZoneOffset.UTC), 500)).isZero();
        assertThat(countClaims(account.userId(), "create_attempt_bigfive", key)).isEqualTo(1);
    }

    private int countAttempts(String userId) {
        return invitationJdbc.queryForObject("SELECT COUNT(*) FROM assessment_attempt WHERE user_id = ?",
                Integer.class, userId);
    }

    private int countClaims(String userId, String operation, String key) {
        return invitationJdbc.queryForObject("""
                SELECT COUNT(*) FROM api_idempotency
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                """, Integer.class, userId, operation, key);
    }
}
