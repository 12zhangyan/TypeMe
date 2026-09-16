package com.typeme.account.service;

import com.typeme.account.dto.DeleteAccountResponse;
import com.typeme.account.repository.DeletionJobRecord;
import com.typeme.account.repository.DeletionJobRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

/**
 * 注销：申请入口 + 后台清理 worker（契约 §6.2 / 开发方案 §5）。
 *
 * <p>为什么注销是"异步任务"而不是"同步删完再返回"：
 * 清理跨 8 张表、还要处理并行模块的表可能尚未就绪的情况。同步做的话，
 * 任何一步失败都会让用户卡在一个"密码已验证但删不掉"的界面，重试还会被限流。
 * 拆成任务后：申请阶段只做**立即止血**（禁止登录 + 撤会话 + 取消 AI 任务），
 * 清理由 worker 重试到收敛。
 */
@Service
public class AccountDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDeletionService.class);

    /** 每轮最多处理多少个任务：避免一次调度把连接池占满。 */
    private static final int BATCH_SIZE = 5;

    private final AccountService accountService;
    private final AccountDataDeletionService dataDeletion;
    private final DeletionJobRepository jobs;

    public AccountDeletionService(AccountService accountService,
                                  AccountDataDeletionService dataDeletion,
                                  DeletionJobRepository jobs) {
        this.accountService = accountService;
        this.dataDeletion = dataDeletion;
        this.jobs = jobs;
    }

    /**
     * 注销申请（{@code DELETE /api/v3/me} 的 202）。
     *
     * <p>四件事在同一事务里：禁用账号、撤销会话、取消 AI 任务、建删除任务。
     * 事务边界放在这里而不是 {@code AccountService} 内部，是为了让"用户看到 202"与
     * "任务确实已入队"是同一个原子事实 —— 否则刷新页面可能看到一个既登录不了、
     * 又查不到删除任务的中间态。
     */
    @Transactional
    public DeleteAccountResponse requestDeletion(String userId, String currentPassword,
                                                 HttpServletRequest request) {
        accountService.disableForDeletion(userId, currentPassword);
        int cancelled = dataDeletion.cancelActiveAiJobs(userId);
        String jobId = DeletionJobRepository.newId();
        jobs.insertPending(jobId, userId, Instant.now());
        log.info("account deletion requested cancelledAiJobs={}", cancelled);
        return new DeleteAccountResponse(jobId);
    }

    /**
     * 清理 worker 触发器。
     *
     * <p>{@code fixedDelay} 而不是 {@code fixedRate}：清理耗时不可预测，
     * fixedRate 会在上一轮还没结束时叠加调度，指数量级的连接占用就是这样来的。
     *
     * <p>{@code initialDelay} 给足启动时间：应用刚起来时数据库/迁移可能还在就绪过程中。
     *
     * <p><b>取值必须写成 ISO-8601（PT60S）或纯毫秒数字</b>：{@code @Scheduled} 的
     * {@code String} 形式只认这两种，{@code "60s"} 会直接抛
     * {@code NumberFormatException} 导致容器启动失败 —— 也就是说这个参数写错
     * 不是"定时器不跑"，而是**整个应用起不来**。{@code Duration} 形式的配置项
     * （{@code TypemeProperties}）没有这个限制，两者不要互相抄。
     */
    @Scheduled(fixedDelayString = "${typeme.deletion.worker-interval:PT60S}",
            initialDelayString = "${typeme.deletion.worker-initial-delay:PT30S}")
    public void runPendingDeletions() {
        List<DeletionJobRecord> pending = jobs.findPending(BATCH_SIZE);
        for (DeletionJobRecord job : pending) {
            processOne(job);
        }
    }

    /**
     * 处理单个任务。**每个任务各自 try/catch**：一个账号的清理失败不能拖住队列里其它账号。
     */
    void processOne(DeletionJobRecord job) {
        try {
            jobs.markRunning(job.id());
            dataDeletion.cleanup(job.userId());
            jobs.markDone(job.id(), Instant.now());
            log.info("account deletion job done attempts={}", job.attemptCount() + 1);
        } catch (RuntimeException ex) {
            // 只记异常类型与任务 id：清理过程中经手的是个人数据，异常消息可能带上这些内容。
            log.error("account deletion job failed jobId={} exception={}", job.id(), ex.getClass().getName());
            try {
                jobs.markFailed(job.id(), "CLEANUP_FAILED");
            } catch (RuntimeException markFailedFailure) {
                log.error("account deletion job failed to record failure jobId={}", job.id());
            }
        }
    }

    /** 供测试同步驱动一轮清理（不依赖调度器的时间）。 */
    public void processPendingNow() {
        runPendingDeletions();
    }
}
