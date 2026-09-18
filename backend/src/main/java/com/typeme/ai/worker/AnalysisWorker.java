package com.typeme.ai.worker;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.ai.client.DeepSeekClient;
import com.typeme.ai.client.DeepSeekException;
import com.typeme.ai.client.DeepSeekRequest;
import com.typeme.ai.client.DeepSeekResponse;
import com.typeme.ai.config.AiClock;
import com.typeme.ai.config.AiRuntimeSettings;
import com.typeme.ai.config.AiRuntimeSettingsProvider;
import com.typeme.ai.input.AiReportInput;
import com.typeme.ai.input.AiTopic;
import com.typeme.ai.input.ReportInputBuilder;
import com.typeme.ai.output.AnalysisValidationException;
import com.typeme.ai.output.ReportAnalysisValidator;
import com.typeme.ai.port.ReportSnapshotReader;
import com.typeme.ai.port.UserLocator;
import com.typeme.ai.service.AiBudgetRepository;
import com.typeme.ai.service.AiCostEstimator;
import com.typeme.ai.service.AnalysisJobRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * AI 分析 worker（契约 03 §6）。
 *
 * <p>执行顺序是这个类的骨架，**不允许重排**：
 * <pre>
 *   恢复过期 lease（事务） → 认领 claim（事务） → 写 requested_at（事务）
 *   → 调用上游（**无事务**） → 写回结果（事务，条件 status='RUNNING'）
 * </pre>
 * 为什么外部 HTTP 必须在事务之外：一次调用最长 90s。如果把它包在事务里，数据库连接会被占住
 * 90 秒（连接池很快耗尽），而事务本身什么也没保护 —— 上游调用不是可以回滚的资源。
 *
 * <p>另一条不能妥协的语义：lease 过期时若 {@code requested_at} 非空，说明请求**已经发出去过**，
 * 我们无法知道上游是否已经执行并计费 → 只能置 {@code UNKNOWN}，**绝不自动重发**。
 * 自动重发就是替用户重复付费；把决定权交给用户（POST /retry）才是正确的代价。
 */
@Component
public class AnalysisWorker {

    private static final Logger log = LoggerFactory.getLogger(AnalysisWorker.class);

    /** 429 自动重试后重新入队时写的标记：下一次失败时据此判断"已经自动重试过一次"。 */
    private static final String AUTO_RETRY_MARKER = DeepSeekException.Codes.UPSTREAM_429;

    /** 429 没有 Retry-After 时的默认退避。 */
    private static final Duration DEFAULT_RETRY_AFTER = Duration.ofSeconds(5);

    private final AnalysisJobRepository jobs;
    private final AiBudgetRepository budgets;
    private final AiRuntimeSettingsProvider settingsProvider;
    private final ReportInputBuilder inputBuilder;
    private final DeepSeekClient client;
    private final ReportAnalysisValidator validator;
    private final AiCostEstimator costEstimator;
    private final ReportSnapshotReader snapshots;
    private final UserLocator userLocator;
    private final AiClock clock;
    private final ObjectMapper mapper;
    /** 本进程的 lease 标识；claim 时写入，多实例部署时靠它区分"谁在跑"。 */
    private final String leaseOwnerId;

    public AnalysisWorker(AnalysisJobRepository jobs,
                          AiBudgetRepository budgets,
                          AiRuntimeSettingsProvider settingsProvider,
                          ReportInputBuilder inputBuilder,
                          DeepSeekClient client,
                          ReportAnalysisValidator validator,
                          AiCostEstimator costEstimator,
                          ReportSnapshotReader snapshots,
                          UserLocator userLocator,
                          AiClock clock,
                          ObjectMapper mapper) {
        this.jobs = jobs;
        this.budgets = budgets;
        this.settingsProvider = settingsProvider;
        this.inputBuilder = inputBuilder;
        this.client = client;
        this.validator = validator;
        this.costEstimator = costEstimator;
        this.snapshots = snapshots;
        this.userLocator = userLocator;
        this.clock = clock;
        this.mapper = mapper;
        this.leaseOwnerId = newLeaseOwner();
    }

    private static String newLeaseOwner() {
        String host;
        try {
            host = InetAddress.getLocalHost().getHostName();
        } catch (Exception ex) {
            host = "unknown-host";
        }
        // 实例名 + 随机后缀：同一台机器上跑两个进程时 lease 也必须能区分开。
        return (host + "-" + UUID.randomUUID().toString().substring(0, 8));
    }

    /* ── 调度入口 ───────────────────────────────────────────────────────── */

    /**
     * 固定间隔扫描。
     *
     * <p>配置键是 {@code typeme.ai.worker-poll-interval-ms}（毫秒整数），**不是**契约里那个
     * {@code worker-poll-interval: 2s} 的人类可读写法：{@code @Scheduled} 的
     * {@code fixedDelayString} 只接受长整数（"2s" 会抛 NumberFormatException），
     * 所以这里用 -ms 后缀明确单位。契约里的 {@code worker-poll-interval} 仍然被
     * {@link AiRuntimeSettingsProvider} 读取（用于文档与设置页展示），只是不直接喂给注解。
     *
     * <p>单实例内用"同一把锁"防止上一轮还没跑完就叠加下一轮；跨实例的互斥由数据库 lease 负责。
     */
    @Scheduled(fixedDelayString = "${typeme.ai.worker-poll-interval-ms:2000}")
    public void scheduledPoll() {
        poll();
    }

    /** 供测试直接驱动一轮（不依赖调度线程）。 */
    public void poll() {
        Instant now = clock.now();
        try {
            recoverExpiredLeases(now);
            AiRuntimeSettings settings = settingsProvider.settings();
            if (!settings.enabled() || !settings.hasApiKey()) {
                // 未配置时不做任何事：任务会留在 QUEUED，配置好之后自动继续。
                return;
            }
            int capacity = settings.workerConcurrency() - jobs.countInFlight(now);
            if (capacity <= 0) {
                return;
            }
            List<AnalysisJobRepository.JobRow> queued = jobs.findQueued(now, capacity);
            for (AnalysisJobRepository.JobRow candidate : queued) {
                if (jobs.countInFlight(clock.now()) >= settings.workerConcurrency()) {
                    break;
                }
                execute(candidate);
            }
        } catch (RuntimeException ex) {
            // 单轮扫描失败不能杀掉调度线程：记录后等下一轮（最坏情况是延迟，而不是 worker 停了）。
            log.warn("AI worker 单轮扫描失败，将在下一轮重试：{}", ex.toString());
        }
    }

    /**
     * lease 过期恢复（契约 §6）。
     *
     * <p>只处理 {@code RUNNING} 且 lease 已过期的行：
     * <ul>
     *   <li>{@code requested_at IS NULL}（从未发出）→ 回 {@code QUEUED}，可以安全重跑；</li>
     *   <li>{@code requested_at IS NOT NULL}（已发出，结果未知）→ {@code UNKNOWN}，绝不自动重发。</li>
     * </ul>
     *
     * @return 处理的条数（供测试断言）
     */
    public int recoverExpiredLeases(Instant now) {
        int requeued = jobs.requeueExpiredNeverSent(now);
        int unknown = jobs.markExpiredAsUnknown(now);
        if (requeued > 0 || unknown > 0) {
            log.warn("lease 恢复：重新排队 {} 条（从未发出），标记 UNKNOWN {} 条（已发出但结果未知）。",
                    requeued, unknown);
        }
        return requeued + unknown;
    }

    /* ── 单个任务 ───────────────────────────────────────────────────────── */

    /** 认领并执行一个任务；抢不到（已被别人认领/已取消）就直接返回。 */
    public void execute(AnalysisJobRepository.JobRow candidate) {
        AiRuntimeSettings settings = settingsProvider.settings();
        Instant now = clock.now();
        if (!jobs.claim(candidate.id(), leaseOwnerId, now.plus(settings.leaseDuration()))) {
            return;
        }
        String jobId = candidate.id();
        try {
            runClaimed(jobId, candidate.topic(), settings, now);
        } catch (DeepSeekException ex) {
            handleUpstreamFailure(jobId, candidate, ex);
        } catch (AnalysisValidationException ex) {
            // 明确失败：内容不合法/被截断/类型不符……不自动重试（重试大概率又付一次钱拿到同样的坏输出）。
            finishFailed(jobId, ex.errorCode(), ex.getMessage());
        } catch (RuntimeException ex) {
            // 未预期异常：不确定成本，但确定没拿到结果。保守起见不释放预留，状态记 UNKNOWN 等用户决定。
            log.error("AI 任务 {} 执行时出现未预期异常", jobId, ex);
            finishUnknown(jobId, DeepSeekException.Codes.UPSTREAM_5XX, ex.toString());
        }
    }

    private void runClaimed(String jobId, String topicToken, AiRuntimeSettings settings, Instant startedAt) {

        AnalysisJobRepository.JobRow row = jobs.findById(jobId)
                .orElseThrow(() -> new IllegalStateException("任务刚认领就消失了：" + jobId));

        AiTopic topic;
        try {
            topic = AiTopic.parse(topicToken);
        } catch (RuntimeException ex) {
            throw AnalysisValidationException.invalidJson("任务的主题值不合法：" + topicToken);
        }

        // 先做"报告/账号是否还在"的检查，再构造输入：构造输入本身要读报告，
        // 报告已删时它会抛异常，从而把"报告被删"误记成 UNKNOWN（未预期异常）而不是"丢弃"。
        if (snapshots.find(row.reportId()).isEmpty()) {
            discardLateResult(jobId, row.userId(), "报告已删除，丢弃结果", false);
            return;
        }
        UserLocator.UserState userState = userLocator.locate(row.userId());
        if (userState == UserLocator.UserState.INACTIVE || userState == UserLocator.UserState.ABSENT) {
            discardLateResult(jobId, row.userId(), "账号已注销/停用，丢弃结果", false);
            return;
        }

        AiReportInput input = inputBuilder.build(row.reportId(), row.userId(), topic,
                jobs.findUserNote(jobId), row.promptVersion(), row.modelRequested());

        // 写 requested_at（事务 2）：**紧接着真正的外发动作**。
        // 放在这里而不是认领之后，是为了让它的含义精确等于"请求已经可能到达上游"：
        // 若在上面任何一步退出，requested_at 仍为 NULL，lease 过期后可以安全重排而不是判 UNKNOWN。
        jobs.markRequested(jobId, clock.now());

        // 外部 HTTP 调用：**无事务**。
        DeepSeekResponse response = client.complete(DeepSeekRequest.of(
                row.modelRequested(),
                SystemPrompt.of(row.promptVersion()),
                inputBuilder.userMessage(input),
                settings.maxTokens(),
                settings.temperature()));

        // 用官方 usage 回填实际调用数与 token（成功拿到响应就说明上游确实执行了一次）。
        var usage = response.usage() == null ? DeepSeekResponse.TokenUsage.EMPTY : response.usage();
        backfillBudget(row.userId(), usage);

        // 校验并写回（写回必须在事务 3 里带 status='RUNNING' 条件）。
        ReportAnalysisValidator.MapResult result = validator.validate(
                response, input.computedTypeCode(), input.evidenceIds(), settings.maxTokens());
        String expectedSchema = com.typeme.ai.input.ReadableReportInput.PROMPT_VERSION.equals(row.promptVersion())
                ? com.typeme.ai.input.ReadableReportInput.SCHEMA_VERSION : "1";
        if (!expectedSchema.equals(result.node().path("schemaVersion").asText())) {
            throw AnalysisValidationException.invalidJson("分析输出版本与本次任务不一致。");
        }

        // 又一道"晚到结果"的闸门：写回前确认 job 没被取消、报告还在。
        AnalysisJobRepository.JobRow latest = jobs.findById(jobId).orElse(null);
        if (latest == null || !"RUNNING".equals(latest.status())) {
            log.warn("AI 任务 {} 在写回前状态已变为 {}，丢弃本次结果（不重建已删数据）。",
                    jobId, latest == null ? "缺失" : latest.status());
            return;
        }
        if (snapshots.find(row.reportId()).isEmpty()) {
            discardLateResult(jobId, row.userId(), "报告已删除，丢弃结果", true);
            return;
        }

        String usageJson = usageJson(usage, client.mock());
        if (!jobs.markSucceeded(jobId, result.toJson(), usageJson,
                response.modelReturned() == null ? row.modelRequested() : response.modelReturned(), clock.now())) {
            log.warn("AI 任务 {} 写回结果时状态已被改动，结果被丢弃。", jobId);
        } else {
            log.info("AI 任务 {} 完成：model={}, tokens={}, elapsedMs={}",
                    jobId, response.modelReturned(), usage.totalTokens(),
                    Duration.between(startedAt, clock.now()).toMillis());
        }
    }

    /* ── 失败分类 ───────────────────────────────────────────────────────── */

    private void handleUpstreamFailure(String jobId, AnalysisJobRepository.JobRow candidate, DeepSeekException ex) {
        String code = ex.errorCode();
        if (ex.billableUnknown()) {
            // 超时/断流/5xx：上游可能已经执行并计费 → 保留预留，状态 UNKNOWN，绝不自动重发。
            finishUnknown(jobId, code, ex.getMessage());
            return;
        }
        if (DeepSeekException.Codes.UPSTREAM_429.equals(code) && !alreadyAutoRetried(jobId)) {
            // 429：最多自动重试一次，退避时间尊重 Retry-After。
            Duration delay = ex.retryAfter() == null ? DEFAULT_RETRY_AFTER : ex.retryAfter();
            releaseReservation(candidate.userId());
            requeueAfter(jobId, delay);
            log.info("AI 任务 {} 命中 429，{} 秒后自动重试一次。", jobId, delay.toSeconds());
            return;
        }
        // 其余明确失败（401/402/其它 4xx/再次 429）：不自动重试，用户可主动重试。
        releaseReservation(candidate.userId());
        finishFailed(jobId, code, ex.getMessage());
    }

    private boolean alreadyAutoRetried(String jobId) {
        return jobs.findById(jobId)
                .map(row -> AUTO_RETRY_MARKER.equals(row.errorCode()))
                .orElse(false);
    }

    /**
     * 429 后的自动重试：**不新建行**，把同一行放回 QUEUED 并把 {@code next_run_at} 推到退避时刻。
     *
     * <p>用 {@code error_code} 留一个"已自动重试过"的标记，让下一次失败不再自动重试 ——
     * 这样"最多自动重试一次"不需要额外加列（V4 已外发，加列要新迁移）。
     *
     * <p>注意起点是 **RUNNING**（429 是在执行中收到的），不是 FAILED：
     * 用只认 FAILED/UNKNOWN 的 requeue 必然 0 行命中，自动重试会静默失效。
     */
    private void requeueAfter(String jobId, Duration delay) {
        Instant runAt = clock.now().plus(delay);
        if (!jobs.requeueRunningAfterBackoff(jobId, AUTO_RETRY_MARKER, runAt)) {
            log.warn("AI 任务 {} 不在 RUNNING，429 自动重试未生效（可能已被取消或恢复逻辑处理）。", jobId);
        }
    }

    private void finishFailed(String jobId, String errorCode, String message) {
        if (!jobs.markFailed(jobId, errorCode, message, clock.now())) {
            log.debug("AI 任务 {} 已是终态，失败回写被忽略（code={}）。", jobId, errorCode);
        }
    }

    private void finishUnknown(String jobId, String errorCode, String message) {
        if (!jobs.markUnknown(jobId, errorCode, message, clock.now())) {
            log.debug("AI 任务 {} 已是终态，UNKNOWN 回写被忽略（code={}）。", jobId, errorCode);
        }
    }

    /**
     * 丢弃晚到结果：报告被删/账号注销。
     *
     * <p>{@code CANCELLED} 只表示"本站不再使用这次结果"，**不承诺上游停止计费** ——
     * 所以**已经发出**的那一次预留不回退（成本已经发生）；
     * 而**还没发出**就放弃的（{@code sent=false}）必须把预留还回去，
     * 否则用户会因为"删了一份报告"而白白少一次当日额度。
     */
    private void discardLateResult(String jobId, String userId, String reason, boolean sent) {
        jobs.markCancelled(jobId, "CANCELLED", clock.now());
        if (!sent) {
            releaseReservation(userId);
        }
        log.info("AI 任务 {} 结果被丢弃（sent={}）：{}", jobId, sent, reason);
    }

    /* ── 预算回填与补偿 ─────────────────────────────────────────────────── */

    /** 成功：两个 scope 都回填 actual_calls +1、token 与估算费用。 */
    private void backfillBudget(String userId, DeepSeekResponse.TokenUsage usage) {
        LocalDate date = budgets.today();
        long tokens = usage.totalTokens();
        long cost = costEstimator.estimateMicros(usage);
        budgets.finishSuccess("user:" + userId, date, tokens, cost);
        budgets.finishSuccess(AiBudgetRepository.GLOBAL_SCOPE, date, tokens, cost);
    }

    /** 确认未计费（429 被拒、连接失败）：回退两个 scope 的预留。 */
    private void releaseReservation(String userId) {
        LocalDate date = budgets.today();
        budgets.releaseReservation("user:" + userId, date);
        budgets.releaseReservation(AiBudgetRepository.GLOBAL_SCOPE, date);
    }

    /* ── 工具 ───────────────────────────────────────────────────────────── */

    /** usage_json：官方 usage + mock 标记（mock 结果必须能被 API/UI 识别为演示数据）。 */
    private String usageJson(DeepSeekResponse.TokenUsage usage, boolean mock) {
        ObjectNode node = mapper.createObjectNode();
        node.put("promptTokens", usage.promptTokens());
        node.put("completionTokens", usage.completionTokens());
        node.put("promptCacheHitTokens", usage.promptCacheHitTokens());
        node.put("promptCacheMissTokens", usage.promptCacheMissTokens());
        if (mock) {
            node.put("mock", true);
        }
        return node.toString();
    }

    /** 供测试断言：本次进程的 lease 标识（与静态构造工厂 {@code newLeaseOwner()} 区分开）。 */
    public String leaseOwner() {
        return leaseOwnerId;
    }

    /** 系统提示词：启动时读一次并缓存（进程内不变；promptVersion 变了会由配置重启生效）。 */
    static final class SystemPrompt {

        private static volatile String cachedVersion;
        private static volatile String cachedContent;

        private SystemPrompt() {
        }

        static String of(String promptVersion) {
            // 兜底用当前默认版本（与 AiProperties 的默认值保持一致）；v1 文件仍在仓库里，
            // 历史任务按自己入库的 promptVersion 解析，不会被这里影响。
            String version = promptVersion == null || promptVersion.isBlank()
                    ? com.typeme.ai.input.ReadableReportInput.PROMPT_VERSION : promptVersion;
            if (version.equals(cachedVersion) && cachedContent != null) {
                return cachedContent;
            }
            String content = load(version);
            cachedVersion = version;
            cachedContent = content;
            return content;
        }

        private static String load(String version) {
            String path = "ai/prompts/" + version + ".txt";
            try (var stream = SystemPrompt.class.getClassLoader().getResourceAsStream(path)) {
                if (stream == null) {
                    throw new IllegalStateException("提示词文件不存在：" + path);
                }
                String raw = new String(stream.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                // 第一行是版本名（便于人工核对文件与 promptVersion 一致），不发给模型。
                int newline = raw.indexOf('\n');
                return newline < 0 ? raw : raw.substring(newline + 1).trim();
            } catch (java.io.IOException ex) {
                throw new IllegalStateException("读取提示词文件失败：" + path, ex);
            }
        }
    }
}
