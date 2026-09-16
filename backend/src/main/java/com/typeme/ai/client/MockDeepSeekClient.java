package com.typeme.ai.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Mock 适配器（{@code typeme.ai.mock-mode=true} 时启用）。
 *
 * <p>三条纪律：
 * <ol>
 *   <li><b>确定性</b>：同样的请求永远得到同样的输出（内容由请求里的 report/evidence 推导）。</li>
 *   <li><b>不伪装成功</b>：真实调用没有发生，这一点由调用链上的 {@code mock=true} 标记透传到 API 与 UI，
 *       由前端显示"演示数据（未调用真实 DeepSeek）"。</li>
 *   <li><b>可注入故障</b>：ok / 401 / 402 / 429 / 5xx / 超时 / 空内容 / 非法 JSON / 截断 / 类型不符 /
 *       内容违规 / 提示注入 全部可复现 —— 这些分支在真实上游按需触发几乎不可能。</li>
 * </ol>
 *
 * <p>故障模式来源优先级：{@link #setFailureMode}（测试直接设置） &gt; 系统属性
 * {@code typeme.ai.mock-failure-mode} &gt; {@code typeme.ai.mock.failure-mode} 配置。
 */
public class MockDeepSeekClient implements DeepSeekClient {

    private static final Logger log = LoggerFactory.getLogger(MockDeepSeekClient.class);

    public static final String FAILURE_MODE_SYSTEM_PROPERTY = "typeme.ai.mock-failure-mode";

    private final ObjectMapper mapper;

    /** 上游调用计数：测试用它断言"未同意/幂等命中时上游零调用"。 */
    private final AtomicInteger calls = new AtomicInteger();

    private volatile MockFailureMode failureMode;

    /** 模拟"响应很慢"：配合把 request-deadline 调到极小，可确定性地触发 TIMEOUT。 */
    private volatile long responseDelayMillis;

    private volatile Duration retryAfter = Duration.ofSeconds(2);

    /** 让响应体超过 max_tokens 的粗估上限，用来复现"被截断但 finish_reason 缺失"的情形。 */
    private volatile boolean oversizedResponse;

    /** 最近一次请求（供测试检查"到底发了什么"，尤其是**不该发**的账号信息）。 */
    private volatile DeepSeekRequest lastRequest;

    public MockDeepSeekClient(ObjectMapper mapper, String configuredFailureMode) {
        this.mapper = mapper;
        String source = System.getProperty(FAILURE_MODE_SYSTEM_PROPERTY, configuredFailureMode);
        this.failureMode = MockFailureMode.parse(source);
        if (source != null && !source.isBlank() && MockFailureMode.parse(source) == MockFailureMode.OK
                && !"OK".equalsIgnoreCase(source.trim())) {
            log.warn("无法识别的 mock 故障模式「{}」，已按 OK 处理。", source);
        }
    }

    /* ── 测试钩子 ───────────────────────────────────────────────────────── */

    public void setFailureMode(MockFailureMode mode) {
        this.failureMode = mode == null ? MockFailureMode.OK : mode;
    }

    public MockFailureMode failureMode() {
        return failureMode;
    }

    public void setResponseDelayMillis(long millis) {
        this.responseDelayMillis = millis;
    }

    public void setRetryAfter(Duration retryAfter) {
        this.retryAfter = retryAfter == null ? Duration.ofSeconds(2) : retryAfter;
    }

    public void setOversizedResponse(boolean oversized) {
        this.oversizedResponse = oversized;
    }

    public int calls() {
        return calls.get();
    }

    /** 最近一次请求；未被调用过时为 null。 */
    public DeepSeekRequest lastRequest() {
        return lastRequest;
    }

    public void resetCalls() {
        calls.set(0);
        lastRequest = null;
    }

    @Override
    public boolean mock() {
        return true;
    }

    @Override
    public DeepSeekResponse complete(DeepSeekRequest request) {
        calls.incrementAndGet();
        lastRequest = request;
        MockFailureMode mode = failureMode;

        if (responseDelayMillis > 0) {
            try {
                Thread.sleep(responseDelayMillis);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                throw DeepSeekException.timeout("mock 调用被中断。", ex);
            }
        }

        return switch (mode) {
            case OK -> respond(request, false, false);
            case UNAUTHORIZED -> throw DeepSeekException.unauthorized("(mock 401)");
            case PAYMENT -> throw DeepSeekException.paymentRequired("(mock 402)");
            case RATE_LIMITED -> throw DeepSeekException.rateLimited(retryAfter, "(mock 429)");
            case SERVER_ERROR -> throw DeepSeekException.serverError(503, "(mock 5xx)");
            case TIMEOUT -> throw DeepSeekException.timeout("(mock 超时)", null);
            case EMPTY_CONTENT -> new DeepSeekResponse("", "stop", request.model(),
                    new DeepSeekResponse.TokenUsage(1200, 0, 0, 1200));
            case INVALID_JSON -> new DeepSeekResponse("{\"schemaVersion\": \"1\", \"summary\": ", "stop",
                    request.model(), new DeepSeekResponse.TokenUsage(1200, 12, 0, 1200));
            case TRUNCATED -> respond(request, true, false);
            case TYPE_MISMATCH -> respond(request, false, true);
            case CONTENT_VIOLATION -> contentViolation(request);
            // 提示注入场景与"类型不符"是同一类必拒结果：模型被用户文字说服后改了判。
            case PROMPT_INJECTION -> respond(request, false, true);
        };
    }

    private DeepSeekResponse respond(DeepSeekRequest request, boolean truncated, boolean typeMismatch) {
        ObjectNode body = MockAnalysisBodies.build(mapper, request.userPrompt());
        if (typeMismatch) {
            // 模拟"模型被 userNote 说服改判 / 自己挑了一个候选"：referenceType 与后端值不符，
            // 服务端必须拒绝（TYPE_MISMATCH），不得采信模型的改判。
            body.put("referenceType", "XXXX");
        }
        String content = body.toString();
        if (oversizedResponse && !truncated) {
            // 极端情形：内容超长（超 max_tokens 粗估上限），模拟"上游没给 length 但明显被截断"。
            content = content + "…".repeat(Math.max(1, request.maxTokens() * 8));
        }
        String finishReason = truncated ? "length" : "stop";
        if (truncated) {
            // 真正截断的样子：JSON 不完整 + finish_reason=length
            content = content.substring(0, Math.max(10, content.length() * 9 / 10));
        }
        return new DeepSeekResponse(content, finishReason, request.model(),
                new DeepSeekResponse.TokenUsage(1500, 800, 1000, 500));
    }

    private DeepSeekResponse contentViolation(DeepSeekRequest request) {
        ObjectNode body = MockAnalysisBodies.build(mapper, request.userPrompt());
        // 命中服务端内容护栏的典型表述（"确诊/准确率/你一定是"）。
        body.put("summary", "这份结果可以当作确诊依据，你的类型准确率很高，你一定是这个样子。");
        return new DeepSeekResponse(body.toString(), "stop", request.model(),
                new DeepSeekResponse.TokenUsage(1500, 500, 0, 1500));
    }
}
