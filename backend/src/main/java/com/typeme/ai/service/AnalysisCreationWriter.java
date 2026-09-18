package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import com.typeme.ai.config.AiException;
import com.typeme.ai.config.AiRuntimeSettings;
import com.typeme.ai.config.AiRuntimeSettingsProvider;
import com.typeme.ai.input.AiReportInput;
import com.typeme.ai.input.AiTopic;
import com.typeme.ai.input.ReportInputBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;

/**
 * 创建任务的**短事务边界**。
 *
 * <p>单独成一个组件（而不是在 {@code AnalysisService} 里加 {@code @Transactional}）的原因：
 * 声明式事务靠代理生效，同类内部调用会绕过代理 —— 那正是"看起来有事务、实际没有"的经典陷阱。
 * 把事务方法放在被注入的另一个 bean 上，边界是显式的，也方便单测直接验证回滚行为。
 *
 * <p>事务里做三件事，一件都不能少：
 * <ol>
 *   <li><b>预留额度</b>（两个 scope 原子累加）并在超限时**补偿回退**；</li>
 *   <li>写 {@code ai_consent}（每次创建都写一行）；</li>
 *   <li>插 {@code ai_analysis_job}（QUEUED）。</li>
 * </ol>
 * 第 3 步撞唯一键（并发双击）时整个事务回滚 —— 于是第 1 步的预留也一起消失，
 * "点了两次只扣一次额度"由事务保证，而不是靠代码里小心翼翼的判断。
 */
@Component
public class AnalysisCreationWriter {

    private final JdbcTemplate jdbcTemplate;
    private final AiRuntimeSettingsProvider settingsProvider;
    private final AnalysisJobRepository jobs;
    private final AiBudgetRepository budgets;
    private final AiClock clock;
    private final ReportInputBuilder inputBuilder;

    public AnalysisCreationWriter(JdbcTemplate jdbcTemplate,
                                  AiRuntimeSettingsProvider settingsProvider,
                                  AnalysisJobRepository jobs,
                                  AiBudgetRepository budgets,
                                  AiClock clock,
                                  ReportInputBuilder inputBuilder) {
        this.jdbcTemplate = jdbcTemplate;
        this.settingsProvider = settingsProvider;
        this.jobs = jobs;
        this.budgets = budgets;
        this.clock = clock;
        this.inputBuilder = inputBuilder;
    }

    /** 预留额度（两个 scope）+ 写 consent + 插 job；任一步失败全部回滚。 */
    @Transactional
    public String create(String userId, String reportId, AiTopic topic, String idempotencyKey,
                         AiReportInput input, String policyVersion, Instant now) {

        AiRuntimeSettings settings = settingsProvider.settings();
        String userScope = "user:" + userId;
        int userLimit = budgets.effectiveUserLimit(userId, settings.dailyLimitPerUser(), true);

        // 1) 原子预留：先 +1，再看是否越过上限；越过就补偿回退（绝不留泄漏的预留）。
        int userReserved = budgets.reserve(userScope, now);
        if (userReserved > userLimit) {
            budgets.releaseReservation(userScope, budgets.today());
            throw AiException.budgetExceeded("user", Map.of(
                    "limit", userLimit, "used", userReserved - 1));
        }
        int globalReserved;
        try {
            globalReserved = budgets.reserve(AiBudgetRepository.GLOBAL_SCOPE, now);
        } catch (RuntimeException ex) {
            budgets.releaseReservation(userScope, budgets.today());
            throw ex;
        }
        if (globalReserved > settings.globalDailyCallBudget()) {
            budgets.releaseReservation(userScope, budgets.today());
            budgets.releaseReservation(AiBudgetRepository.GLOBAL_SCOPE, budgets.today());
            throw AiException.budgetExceeded("global", Map.of(
                    "limit", settings.globalDailyCallBudget(), "used", globalReserved - 1));
        }

        String jobId = UUID.randomUUID().toString();

        // 2) 任务行：QUEUED + requested_at 为空（= 从未发出，lease 过期后可以安全重排）。
        //    必须先插 job：ai_consent.job_id 是指向 ai_analysis_job 的外键，
        //    反过来插会直接撞 fk_ai_consent_job（这个顺序不是风格问题，是约束问题）。
        jobs.insert(new AnalysisJobRepository.JobRow(
                jobId, userId, reportId, idempotencyKey, input.requestHash(), input.promptVersion(),
                topic.wire(), input.model(), null, "QUEUED", 0, null, null, null,
                null, null, null, null, AiClock.toUtc(now), null));

        // 3) 用户近况（V7 列）：worker 是异步/可能跨进程执行的，不落库就发不出去。
        jobs.saveUserNote(jobId, input.normalizedNote());

        // 4) 同意记录：无条件写一行。未确认不允许创建 job，因此不存在"无 consent 的 job"。
        //    与 job 同一个事务，所以"有 job 必有 consent"由事务保证，不靠调用顺序。
        jdbcTemplate.update("""
                INSERT INTO ai_consent (id, user_id, job_id, policy_version, scope, evidence_ids, confirmed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                UUID.randomUUID().toString(), userId, jobId, policyVersion,
                inputBuilder.scopeSummary(input), inputBuilder.evidenceIdsCsv(input),
                AiClock.toUtc(now));
        return jobId;
    }

    /**
     * 重试：重新预留额度（重新调用上游 = 重新付费）+ 原子 requeue。
     *
     * <p>UNKNOWN 的上一轮预留**故意保留**：那次很可能已经被上游计费，退回去会让预算失真。
     */
    @Transactional
    public boolean retry(AnalysisJobRepository.JobRow row, String userId, Instant now) {
        AiRuntimeSettings settings = settingsProvider.settings();
        String userScope = "user:" + userId;
        int userLimit = budgets.effectiveUserLimit(userId, settings.dailyLimitPerUser(), true);
        LocalDate date = budgets.today();

        int userReserved = budgets.reserve(userScope, now);
        if (userReserved > userLimit) {
            budgets.releaseReservation(userScope, date);
            throw AiException.budgetExceeded("user", Map.of(
                    "limit", userLimit, "used", userReserved - 1));
        }
        int globalReserved = budgets.reserve(AiBudgetRepository.GLOBAL_SCOPE, now);
        if (globalReserved > settings.globalDailyCallBudget()) {
            budgets.releaseReservation(userScope, date);
            budgets.releaseReservation(AiBudgetRepository.GLOBAL_SCOPE, date);
            throw AiException.budgetExceeded("global", Map.of(
                    "limit", settings.globalDailyCallBudget(), "used", globalReserved - 1));
        }

        // 原子去重：并发点两次重试只有一个 UPDATE 命中（条件里 status IN ('FAILED','UNKNOWN')）。
        if (!jobs.requeueForRetry(row.id(), now)) {
            // 没抢到 → 这次预留没有换来任何执行，必须还回去。
            budgets.releaseReservation(userScope, date);
            budgets.releaseReservation(AiBudgetRepository.GLOBAL_SCOPE, date);
            return false;
        }
        return true;
    }

    /** 供测试与上层读取"今天"的 UTC 日期。 */
    LocalDate today() {
        return budgets.today();
    }

    AiClock clock() {
        return clock;
    }
}
