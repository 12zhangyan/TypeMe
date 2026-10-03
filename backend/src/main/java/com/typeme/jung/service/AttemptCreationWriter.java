package com.typeme.jung.service;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.function.Function;
import java.util.function.Supplier;

/** One short transaction for claiming a creation key, inserting its attempt and completing the key. */
@Component
public class AttemptCreationWriter {

    private final IdempotencyGuard idempotency;

    public AttemptCreationWriter(IdempotencyGuard idempotency) {
        this.idempotency = idempotency;
    }

    @Transactional
    public <T> T create(String userId, String operation, String key, String hash,
                        Supplier<T> insert, Function<T, String> reference) {
        // An existing legacy IN_PROGRESS row is never discarded just because it is old.
        idempotency.claimFresh(userId, operation, key, hash);
        T created = insert.get();
        if (idempotency.completeClaim(userId, operation, key, hash, reference.apply(created)) != 1) {
            throw new IllegalStateException("Attempt creation could not complete its idempotency record");
        }
        return created;
    }

    @Transactional
    public <T> T createWithoutKey(Supplier<T> insert) {
        return insert.get();
    }
}
