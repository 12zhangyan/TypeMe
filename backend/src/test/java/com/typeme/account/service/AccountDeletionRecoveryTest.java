package com.typeme.account.service;

import com.typeme.account.repository.DeletionJobRepository;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountDeletionRecoveryTest {
    @Test
    void processDeathRollsBackAndNextWorkerCanComplete() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:deletion_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(ds);
        schema(jdbc);
        var jobs = new DeletionJobRepository(jdbc);
        jobs.insertPendingOrGetExisting("job", "user", Instant.now());
        // 模拟旧版本已持久化的 RUNNING，必须仍可恢复。
        jobs.markRunning("job");
        jdbc.update("INSERT INTO synthetic_data VALUES ('user')");
        var cleanup = mock(AccountDataDeletionService.class);
        when(cleanup.cleanup("user")).thenAnswer(inv -> {
            jdbc.update("DELETE FROM synthetic_data WHERE user_id='user'");
            throw new AssertionError("simulated process interruption");
        });
        var service = new AccountDeletionService(null, cleanup, jobs, new DataSourceTransactionManager(ds));
        assertThatThrownBy(service::processPendingNow).isInstanceOf(AssertionError.class);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM synthetic_data", Integer.class)).isEqualTo(1);
        assertThat(jobs.findPending(5)).hasSize(1);
        reset(cleanup);
        when(cleanup.cleanup("user")).thenAnswer(inv -> {
            jdbc.update("DELETE FROM synthetic_data WHERE user_id='user'");
            return true;
        });
        service.processPendingNow();
        assertThat(jobs.findById("job").orElseThrow().status()).isEqualTo("DONE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM synthetic_data", Integer.class)).isZero();
    }

    @Test
    void twoWorkersCannotCleanSameJobConcurrently() throws Exception {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:deletion_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var jdbc = new JdbcTemplate(ds);
        schema(jdbc);
        var jobs = new DeletionJobRepository(jdbc);
        jobs.insertPendingOrGetExisting("job", "user", Instant.now());
        var job = jobs.findById("job").orElseThrow();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var cleanup = mock(AccountDataDeletionService.class);
        when(cleanup.cleanup("user")).thenAnswer(inv -> {
            entered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return true;
        });
        var service = new AccountDeletionService(null, cleanup, jobs, new DataSourceTransactionManager(ds));
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> service.processOne(job));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            var second = executor.submit(() -> service.processOne(job));
            try {
                assertThatThrownBy(() -> second.get(200, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
            } finally { release.countDown(); }
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        }
        verify(cleanup, times(1)).cleanup("user");
        assertThat(jobs.findById("job").orElseThrow().status()).isEqualTo("DONE");
    }

    private void schema(JdbcTemplate jdbc) {
        jdbc.execute("CREATE TABLE account_deletion_job(id VARCHAR PRIMARY KEY,user_id VARCHAR UNIQUE,status VARCHAR,requested_at TIMESTAMP,completed_at TIMESTAMP,attempt_count INT,last_error_code VARCHAR)");
        jdbc.execute("CREATE TABLE synthetic_data(user_id VARCHAR)");
    }
}
