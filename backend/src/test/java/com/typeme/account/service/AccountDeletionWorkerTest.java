package com.typeme.account.service;

import com.typeme.account.repository.DeletionJobRecord;
import com.typeme.account.repository.DeletionJobRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 注销 worker 的状态机：**清理没成功就不许把任务标成 DONE**（2026-09-18 第 17 轮）。
 *
 * <p>为什么这条不变量值得单独钉住：`account_deletion_job` 只扫 `PENDING/FAILED`，
 * 一旦写成 DONE 就**永远不会再试**。而"数据其实没删掉"这件事没有任何接口能查出来
 * （`MeController` 只有 `/me`、密码、恢复码、导出、`DELETE /me`），账号又已经不可登录 ——
 * 用户既看不到、也修不了、也问不了。所以"DONE 必须只在真正删干净时写"是这条链路的底线。
 *
 * <p>这里用假的 `DeletionJobRepository` 与假的清理服务，断言的是状态机的行为，
 * 不依赖数据库：真库只该验证迁移与 SQL 方言（另有 IT 覆盖）。
 */
class AccountDeletionWorkerTest {

    private static final String JOB_ID = "job-1";
    private static final String USER_ID = "u-1";

    private static DeletionJobRecord job() {
        return new DeletionJobRecord(JOB_ID, USER_ID, "PENDING", Instant.now(), null, 0, null);
    }

    /** 记录"标成完成 / 标成失败"两件事，其余方法不需要真的碰库。 */
    private static final class RecordingJobs extends DeletionJobRepository {
        private String markedDone;
        private String markedFailedCode;
        private int runningCount;

        RecordingJobs() {
            super((JdbcTemplate) null);
        }

        @Override
        public java.util.Optional<DeletionJobRecord> findByIdForUpdate(String id) {
            return java.util.Optional.of(job());
        }

        @Override
        public void markRunning(String id) {
            runningCount += 1;
        }

        @Override
        public void markDone(String id, Instant now) {
            markedDone = id;
        }

        @Override
        public void markFailed(String id, String errorCode) {
            markedFailedCode = errorCode;
        }
    }

    private static AccountDeletionService service(boolean cleanupSucceeds, RecordingJobs jobs) {
        AccountDataDeletionService dataDeletion = new AccountDataDeletionService(null, null, null, null) {
            @Override
            public boolean cleanup(String userId) {
                if (!cleanupSucceeds) {
                    throw new AccountCleanupIncompleteException(List.of("reports"));
                }
                return true;
            }
        };
        // 第一个参数是 AccountService；processOne 不碰它。
        var transactions = org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class);
        org.mockito.Mockito.when(transactions.getTransaction(org.mockito.ArgumentMatchers.any()))
                .thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        return new AccountDeletionService(null, dataDeletion, jobs, transactions);
    }

    @Test
    @DisplayName("清理抛异常时任务必须落 FAILED 并记下错误码，绝不能标成 DONE")
    void cleanupFailureMarksJobFailed() {
        RecordingJobs jobs = new RecordingJobs();

        service(false, jobs).processOne(job());

        assertThat(jobs.markedDone)
                .as("DONE 之后这个任务永远不会再被扫到 —— 标错等于数据永久留在库里")
                .isNull();
        assertThat(jobs.markedFailedCode).isEqualTo("CLEANUP_FAILED");
        assertThat(jobs.runningCount).isEqualTo(1);
    }

    @Test
    @DisplayName("清理成功才标 DONE")
    void cleanupSuccessMarksJobDone() {
        RecordingJobs jobs = new RecordingJobs();

        service(true, jobs).processOne(job());

        assertThat(jobs.markedDone).isEqualTo(JOB_ID);
        assertThat(jobs.markedFailedCode).isNull();
    }
}
