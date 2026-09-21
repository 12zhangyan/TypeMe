package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.time.Instant;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class AnalysisExecutionFenceTest {
    @Test
    void everyLateMutationIsRejectedAfterRetryIsClaimed() {
        var jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:h2:mem:fence_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", ""));
        jdbc.execute("CREATE TABLE ai_analysis_job(id VARCHAR PRIMARY KEY,status VARCHAR,lease_owner VARCHAR,lease_until TIMESTAMP,attempt_count INT,next_run_at TIMESTAMP,error_code VARCHAR,finished_at TIMESTAMP,requested_at TIMESTAMP,response_json VARCHAR,usage_json VARCHAR,model_returned VARCHAR)");
        jdbc.update("INSERT INTO ai_analysis_job(id,status,attempt_count) VALUES('job','QUEUED',0)");
        var jobs = new AnalysisJobRepository(jdbc, new AiClock());
        Instant now = Instant.now();
        assertThat(jobs.claim("job", "execution-A", now.plusSeconds(1))).isTrue();
        assertThat(jobs.markRequested("job", "execution-A", now)).isTrue();
        assertThat(jobs.markExpiredAsUnknown(now.plusSeconds(2))).isEqualTo(1);
        assertThat(jobs.requeueForRetry("job", now.plusSeconds(3))).isTrue();
        assertThat(jobs.claim("job", "execution-B", now.plusSeconds(120))).isTrue();
        assertThat(jdbc.queryForObject("SELECT requested_at FROM ai_analysis_job WHERE id='job'", java.sql.Timestamp.class)).isNull();
        assertThat(jobs.markRequested("job", "execution-A", now.plusSeconds(4))).isFalse();
        assertThat(jobs.markFailed("job", "execution-A", "FAIL", "synthetic", now)).isFalse();
        assertThat(jobs.markUnknown("job", "execution-A", "UNKNOWN", "synthetic", now)).isFalse();
        assertThat(jobs.markCancelled("job", "execution-A", "CANCELLED", now)).isFalse();
        assertThat(jobs.requeueRunningAfterBackoff("job", "execution-A", "UPSTREAM_429", now)).isFalse();
        assertThat(jobs.markSucceeded("job", "execution-A", "old", "{}", "mock", now)).isFalse();
        assertThat(jobs.markRequested("job", "execution-B", now.plusSeconds(4))).isTrue();
        assertThat(jobs.markSucceeded("job", "execution-B", "new", "{}", "mock", now.plusSeconds(5))).isTrue();
        assertThat(jdbc.queryForObject("SELECT response_json FROM ai_analysis_job WHERE id='job'", String.class)).isEqualTo("new");
    }
}
