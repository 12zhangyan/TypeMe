package com.typeme.ai.client;

import java.time.Duration;

/**
 * DeepSeek 调用失败。
 *
 * <p>两个关键字段：
 * <ul>
 *   <li>{@link #errorCode()}：直接落库到 {@code ai_analysis_job.error_code}，取值范围见契约 02 §5.1。</li>
 *   <li>{@link #billableUnknown()}：区分"**确认未计费**"（连接失败、被拒的 429/4xx —— 可以回退
 *       {@code reserved_calls}）与"**执行状态未知**"（超时、断流、5xx —— 上游可能已经算过一次，
 *       保守起见保留预留、状态记 {@code UNKNOWN} 并且**绝不自动重发**）。</li>
 * </ul>
 */
public class DeepSeekException extends RuntimeException {

    /** 契约 02 §5.1 的 error_code 取值。 */
    public static final class Codes {
        public static final String UPSTREAM_401 = "UPSTREAM_401";
        public static final String UPSTREAM_402 = "UPSTREAM_402";
        public static final String UPSTREAM_429 = "UPSTREAM_429";
        public static final String UPSTREAM_5XX = "UPSTREAM_5XX";
        /** 连接阶段就失败（DNS/拒绝连接）——确认请求没到上游，可安全重排。 */
        public static final String UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE";
        /** 其它未列举的 4xx（例如 400 请求体不合法）：不自动重试，且确认未计费。 */
        public static final String UPSTREAM_ERROR = "UPSTREAM_ERROR";
        public static final String TIMEOUT = "TIMEOUT";
        public static final String EMPTY_CONTENT = "EMPTY_CONTENT";
        public static final String INVALID_JSON = "INVALID_JSON";
        public static final String TRUNCATED = "TRUNCATED";
        public static final String TYPE_MISMATCH = "TYPE_MISMATCH";
        public static final String CONTENT_VIOLATION = "CONTENT_VIOLATION";
        public static final String NOT_CONFIGURED = "NOT_CONFIGURED";
        public static final String BUDGET_EXCEEDED = "BUDGET_EXCEEDED";
        public static final String RATE_LIMITED = "RATE_LIMITED";

        private Codes() {
        }
    }

    private final String errorCode;
    private final boolean billableUnknown;
    private final Integer httpStatus;
    private final Duration retryAfter;

    public DeepSeekException(String errorCode, String message, boolean billableUnknown,
                             Integer httpStatus, Duration retryAfter) {
        super(message);
        this.errorCode = errorCode;
        this.billableUnknown = billableUnknown;
        this.httpStatus = httpStatus;
        this.retryAfter = retryAfter;
    }

    public String errorCode() {
        return errorCode;
    }

    /**
     * true = 上游是否已经执行/计费**未知**。
     *
     * <p>调用方据此决定：保留 {@code reserved_calls}（保守预算）；把任务置成 {@code UNKNOWN}
     * 而不是 {@code FAILED}；且**不自动重发**。
     */
    public boolean billableUnknown() {
        return billableUnknown;
    }

    public Integer httpStatus() {
        return httpStatus;
    }

    /** 仅 429 可能带 Retry-After；缺失时为 null。 */
    public Duration retryAfter() {
        return retryAfter;
    }

    /* ── 工厂：把"哪一类失败"固定在一处，避免各处随手 new 出不一致的语义 ── */

    public static DeepSeekException unauthorized(String bodySummary) {
        return new DeepSeekException(Codes.UPSTREAM_401, "上游拒绝鉴权（401）。" + bodySummary, false, 401, null);
    }

    public static DeepSeekException paymentRequired(String bodySummary) {
        return new DeepSeekException(Codes.UPSTREAM_402, "上游余额/付费问题（402）。" + bodySummary, false, 402, null);
    }

    public static DeepSeekException rateLimited(Duration retryAfter, String bodySummary) {
        // 429 是"请求被拒"，上游没有跑这次推理 → 可判定未计费（这也是允许自动重试一次的前提）。
        return new DeepSeekException(Codes.UPSTREAM_429, "上游限流（429）。" + bodySummary, false, 429, retryAfter);
    }

    public static DeepSeekException serverError(int status, String bodySummary) {
        // 5xx：上游可能已经受理并计费，只是回执丢了 → 执行状态未知。
        return new DeepSeekException(Codes.UPSTREAM_5XX, "上游服务错误（" + status + "）。" + bodySummary,
                true, status, null);
    }

    public static DeepSeekException clientError(int status, String bodySummary) {
        return new DeepSeekException(Codes.UPSTREAM_ERROR, "上游拒绝了请求（" + status + "）。" + bodySummary,
                false, status, null);
    }

    public static DeepSeekException unavailable(String message, Throwable cause) {
        // 连接阶段失败：请求没有发出去，因此确认未计费、可安全重排。
        DeepSeekException ex = new DeepSeekException(Codes.UPSTREAM_UNAVAILABLE, message, false, null, null);
        ex.initCause(cause);
        return ex;
    }

    public static DeepSeekException timeout(String message, Throwable cause) {
        // 超时：无法确认上游是否已经跑完并计费 → 保留预留、任务记 UNKNOWN、绝不自动重发。
        DeepSeekException ex = new DeepSeekException(Codes.TIMEOUT, message, true, null, null);
        ex.initCause(cause);
        return ex;
    }

    /** 读响应体/断流中途失败：请求已发出，结果未知。 */
    public static DeepSeekException interrupted(String message, Throwable cause) {
        DeepSeekException ex = new DeepSeekException(Codes.UPSTREAM_5XX, message, true, null, null);
        ex.initCause(cause);
        return ex;
    }
}
