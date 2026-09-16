package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import com.typeme.ai.config.AiException;
import com.typeme.ai.config.AiRuntimeSettings;
import com.typeme.ai.config.AiRuntimeSettingsProvider;
import com.typeme.ai.input.AiReportInput;
import com.typeme.ai.input.AiTopic;
import com.typeme.ai.input.ReportInputBuilder;
import com.typeme.ai.port.UserLocator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * AI 分析任务的创建 / 查询 / 重试（契约 03 §2）。
 *
 * <p><b>创建路径绝不在请求线程里调用上游</b>：这里只做校验与短事务落库，返回 202，
 * 真正的 HTTP 由 {@code AnalysisWorker} 在后台做。原因很直接：DeepSeek 单次 deadline 90s，
 * 绑在浏览器请求上会让用户看到"点了没反应"，也让超时重试变成一个前端问题。
 *
 * <p>幂等的三层（顺序不能变）：
 * <ol>
 *   <li><b>输入去重</b>（request_hash 命中 {@code uk_ai_job_request}）：同一用户同一输入只可能有一行，
 *       直接回原 job 且**不重复预留额度**；</li>
 *   <li><b>Idempotency-Key</b>（{@code uk_ai_job_idem}）：同 key 不同 request_hash → 409；
 *       同 key 同 hash → 回原 job；</li>
 *   <li>两者都没命中时，用 INSERT 的**唯一键冲突**做最终裁决（并发双击只有一个能插入成功），
 *       而不是"先查后插"——那样两个并发请求会双双插入。</li>
 * </ol>
 *
 * <p>关于 {@code api_idempotency} 表（契约 02 §6.1）：本模块的幂等语义完全由
 * {@code ai_analysis_job} 的两个唯一键覆盖（同 key 同 hash 直接回原 job，比"响应引用表"更直接），
 * 因此**不引入对 api_idempotency 的读写依赖**：少一张跨模块表，就少一处"迁移没跑导致 AI 全挂"的故障面。
 */
@Service
public class AnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    /** 服务端也必须校验用户文字长度（客户端校验只是体验，不是边界）。 */
    static final int MAX_NOTE_CHARS = 300;

    private final AiRuntimeSettingsProvider settingsProvider;
    private final ReportInputBuilder inputBuilder;
    private final AnalysisJobRepository jobs;
    private final AiBudgetRepository budgets;
    private final AnalysisCreationWriter writer;
    private final AiClock clock;
    private final UserLocator userLocator;

    public AnalysisService(AiRuntimeSettingsProvider settingsProvider,
                           ReportInputBuilder inputBuilder,
                           AnalysisJobRepository jobs,
                           AiBudgetRepository budgets,
                           AnalysisCreationWriter writer,
                           AiClock clock,
                           UserLocator userLocator) {
        this.settingsProvider = settingsProvider;
        this.inputBuilder = inputBuilder;
        this.jobs = jobs;
        this.budgets = budgets;
        this.writer = writer;
        this.clock = clock;
        this.userLocator = userLocator;
    }

    /* ── 创建 ───────────────────────────────────────────────────────────── */

    /**
     * @param idempotencyKey 必填（HTTP 头 Idempotency-Key）
     * @return 202 的响应体内容；{@code cached=true} 表示命中幂等/去重（没有新建也没再扣额度）
     */
    public CreateResult create(String userId, String reportId, AiTopic topic, String note,
                               String consentPolicyVersion, String scopeVersion, String idempotencyKey) {

        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw AiException.validation("缺少 Idempotency-Key 请求头。");
        }
        if (idempotencyKey.length() > 80) {
            // 列宽 VARCHAR(80)：超长直接拒绝，别让数据库抛一个用户看不懂的异常。
            throw AiException.validation("Idempotency-Key 过长（最多 80 字符）。");
        }
        if (note != null && note.length() > MAX_NOTE_CHARS) {
            throw AiException.validation("备注最多 " + MAX_NOTE_CHARS + " 字。");
        }

        AiRuntimeSettings settings = settingsProvider.settings();
        // 未配置判定放在最前：不生成半成品任务，也不用先读报告。
        if (!settings.enabled() || !settings.hasApiKey()) {
            throw AiException.notConfigured();
        }

        String policyVersion = consentPolicyVersion == null || consentPolicyVersion.isBlank()
                ? settingsProvider.loadConsentPolicyVersion() : consentPolicyVersion;
        String scope = scopeVersion == null || scopeVersion.isBlank()
                ? ReportInputBuilder.SCOPE_VERSION : scopeVersion;

        // 报告归属校验也在这一步（不属于本人 → 404，与不存在同形）。
        AiReportInput input = inputBuilder.build(reportId, userId, topic, note,
                settings.promptVersion(), settings.model());

        AnalysisJobRepository.JobRow existing = resolveExisting(userId, idempotencyKey, input.requestHash());
        if (existing != null) {
            return new CreateResult(existing.id(), existing.status(), true);
        }

        Instant now = clock.now();
        try {
            String jobId = writer.create(userId, reportId, topic, idempotencyKey, input, policyVersion, now);
            return new CreateResult(jobId, "QUEUED", false);
        } catch (DuplicateKeyException ex) {
            // 并发双击：另一个事务先插进去了。本事务的额度预留已随回滚消失，这里**不再预留**，
            // 直接读回那一行返回，语义与"命中幂等"完全一致。
            log.debug("创建分析任务命中唯一键（并发双击/重复提交），回读既有任务。");
            AnalysisJobRepository.JobRow winner = resolveExisting(userId, idempotencyKey, input.requestHash());
            if (winner == null) {
                throw AiException.conflict("同一次请求已被处理，请刷新后查看任务列表。");
            }
            return new CreateResult(winner.id(), winner.status(), true);
        }
    }

    /** 命中幂等/去重时的既有任务；没有命中返回 null。 */
    private AnalysisJobRepository.JobRow resolveExisting(String userId, String idempotencyKey,
                                                         String requestHash) {
        var byKey = jobs.findByIdempotencyKey(userId, idempotencyKey);
        if (byKey.isPresent()) {
            AnalysisJobRepository.JobRow job = byKey.get();
            if (!job.requestHash().equals(requestHash)) {
                // 同 key 不同请求体：客户端 bug，必须 409 而不是"悄悄执行另一个请求"。
                throw AiException.idempotencyReused();
            }
            return job;
        }
        // 同用户同输入（不同 key）→ 复用同一份分析（不重复扣额度）。
        return jobs.findByRequestHash(userId, requestHash).orElse(null);
    }

    /* ── 查询 ───────────────────────────────────────────────────────────── */

    /** 本人的任务详情。不属于本人 → 404（与不存在同形，避免枚举别人的 jobId）。 */
    public JobView get(String userId, String jobId) {
        AnalysisJobRepository.JobRow row = jobs.findById(jobId)
                .filter(job -> job.userId().equals(userId))
                .orElseThrow(() -> AiException.notFound("这条分析任务"));
        return JobView.of(row);
    }

    /** 某份报告的全部任务（本人），按创建时间倒序。报告不属于本人 → 404。 */
    public List<JobView> listByReport(String userId, String reportId) {
        inputBuilder.snapshot(reportId)
                .filter(snapshot -> userId.equals(snapshot.userId()))
                .orElseThrow(() -> AiException.notFound("这份报告"));
        List<JobView> views = new ArrayList<>();
        for (AnalysisJobRepository.JobRow row : jobs.listByReport(userId, reportId)) {
            views.add(JobView.of(row));
        }
        return views;
    }

    /* ── 重试 ───────────────────────────────────────────────────────────── */

    /**
     * 用户主动重试：只允许 {@code FAILED}/{@code UNKNOWN}，复用同一行（不新建），
     * 受每小时重试上限与预算约束。
     */
    public RetryResult retry(String userId, String jobId) {
        AnalysisJobRepository.JobRow row = jobs.findById(jobId)
                .filter(job -> job.userId().equals(userId))
                .orElseThrow(() -> AiException.notFound("这条分析任务"));

        if (!"FAILED".equals(row.status()) && !"UNKNOWN".equals(row.status())) {
            throw AiException.conflict("只有失败或状态未知的任务才能重试（当前 " + row.status() + "）。");
        }
        AiRuntimeSettings settings = settingsProvider.settings();
        if (!settings.enabled() || !settings.hasApiKey()) {
            throw AiException.notConfigured();
        }
        Instant now = clock.now();
        int retriesWithinHour = jobs.retryAttemptsWithinLastHour(row, now);
        if (retriesWithinHour >= settings.retryLimitPerHour()) {
            throw AiException.rateLimited(3600);
        }
        if (!writer.retry(row, userId, now)) {
            throw AiException.conflict("这个任务已经在重试队列里了。");
        }
        return new RetryResult(jobId, "QUEUED", row.attemptCount() + 1);
    }

    /* ── 状态 ───────────────────────────────────────────────────────────── */

    /** {@code GET /api/v3/ai/status}：绝不含 key 与 baseUrl 内部细节（只给 host）。 */
    public StatusView status(String userId) {
        AiRuntimeSettings settings = settingsProvider.settings();
        int used = 0;
        if (userId != null && !userId.isBlank()) {
            try {
                used = budgets.reservedCalls("user:" + userId, budgets.today());
            } catch (RuntimeException ex) {
                // 读额度失败不应该让状态接口 500：状态接口是前端决定"要不要显示 AI 入口"的依据。
                log.debug("读取用户 AI 额度失败，按 0 处理：{}", ex.getMessage());
            }
        }
        int remaining = Math.max(0, settings.dailyLimitPerUser() - used);
        return new StatusView(
                settings.enabled() && settings.hasApiKey(),
                settings.mockMode(),
                settings.model(),
                settings.dailyLimitPerUser(),
                remaining,
                settings.apiKeySource().wire(),
                hostOf(settings.baseUrl()),
                settings.promptVersion());
    }

    /** 只暴露 host（不含路径/查询串/凭据），满足契约"可给 host"的要求。 */
    static String hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return null;
        }
        try {
            return URI.create(baseUrl.trim()).getHost();
        } catch (RuntimeException ex) {
            return null;
        }
    }

    /** 供 worker 记录：用户是否还可用（注销后继续外发既浪费预算也违背承诺）。 */
    UserLocator.UserState locateUser(String userId) {
        return userLocator.locate(userId);
    }

    /* ── 视图 ───────────────────────────────────────────────────────────── */

    /** {@code POST /reports/{id}/analyses} 的响应。 */
    public record CreateResult(String jobId, String status, boolean cached) {
    }

    /** {@code POST /analyses/{id}/retry} 的响应。 */
    public record RetryResult(String jobId, String status, int attemptCount) {
    }

    /** usage_json 里额外的标记字段：塞进 usage_json 是为了不为一个布尔值再加一列。 */
    static final String MOCK_MARKER = "\"mock\":true";

    /**
     * {@code GET /analyses/{id}} 的响应（契约 03 §2）。
     *
     * @param result 校验通过的结构化输出；未成功时为 null
     * @param mock   true 表示结果是 mock 适配器产出的演示数据，UI 必须标明"未调用真实 DeepSeek"
     */
    public record JobView(
            String jobId,
            String reportId,
            String status,
            String topic,
            String promptVersion,
            String modelRequested,
            String modelReturned,
            String errorCode,
            int attemptCount,
            String createdAt,
            String finishedAt,
            Map<String, Object> result,
            boolean mock) {

        static JobView of(AnalysisJobRepository.JobRow row) {
            return new JobView(
                    row.id(),
                    row.reportId(),
                    row.status(),
                    row.topic(),
                    row.promptVersion(),
                    row.modelRequested(),
                    row.modelReturned(),
                    row.errorCode(),
                    row.attemptCount(),
                    iso(row.createdAt()),
                    iso(row.finishedAt()),
                    parseResult(row.responseJson()),
                    isMockMarker(row.usageJson()));
        }

        private static String iso(java.time.LocalDateTime utc) {
            return utc == null ? null : AiClock.toInstant(utc).toString();
        }

        @SuppressWarnings("unchecked")
        private static Map<String, Object> parseResult(String responseJson) {
            if (responseJson == null || responseJson.isBlank()) {
                return null;
            }
            try {
                return new com.fasterxml.jackson.databind.ObjectMapper().readValue(responseJson, Map.class);
            } catch (Exception ex) {
                return null;
            }
        }

        private static boolean isMockMarker(String usageJson) {
            return usageJson != null && usageJson.contains(MOCK_MARKER);
        }
    }

    /** {@code GET /ai/status} 的响应。 */
    public record StatusView(
            boolean enabled,
            boolean mockMode,
            String model,
            int dailyLimitPerUser,
            int remainingToday,
            String apiKeySource,
            String baseUrlHost,
            String promptVersion) {
    }
}
