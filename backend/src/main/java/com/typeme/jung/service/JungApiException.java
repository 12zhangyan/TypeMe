package com.typeme.jung.service;

/**
 * 新测业务异常。
 *
 * <p>带上契约里的错误码与 HTTP 状态，让 `JungExceptionHandler`（控制器级）能直接映射成
 * `{code,message,requestId,details}`。刻意不依赖 `com.typeme.common`：
 * 那个包由账号模块负责，跨模块直接继承会让并行开发互相卡编译。
 */
public class JungApiException extends RuntimeException {

    private final String code;
    private final int httpStatus;
    private final java.util.Map<String, Object> details;

    public JungApiException(String code, int httpStatus, String message) {
        this(code, httpStatus, message, java.util.Map.of());
    }

    public JungApiException(String code, int httpStatus, String message, java.util.Map<String, Object> details) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
        this.details = details == null ? java.util.Map.of() : java.util.Map.copyOf(details);
    }

    public String code() {
        return code;
    }

    public int httpStatus() {
        return httpStatus;
    }

    public java.util.Map<String, Object> details() {
        return details;
    }

    public static JungApiException notFound(String what) {
        // 「不存在」与「不属于当前用户」返回同形，避免用错误码枚举别人的资源 id
        return new JungApiException("NOT_FOUND", 404, what + "不存在。");
    }

    public static JungApiException invalid(String message) {
        return new JungApiException("INVALID_REQUEST", 400, message);
    }

    public static JungApiException validation(String message) {
        return new JungApiException("VALIDATION_FAILED", 400, message);
    }

    public static JungApiException conflict(String message, java.util.Map<String, Object> details) {
        return new JungApiException("CONFLICT_REVISION", 409, message, details);
    }

    /**
     * 内容包还没落库，因此建不了测评。
     *
     * <p>为什么要有这个专门的错误码，而不是让外键违例冒成 500：
     * {@code assessment_attempt.package_id} 有指向 {@code assessment_package} 的外键。
     * 如果内容包没有被写进那张表，插入测评会得到一个
     * {@code DataIntegrityViolationException} —— 对外表现成"服务故障"（500 + 通用文案），
     * 运维看到 500 会去查应用日志，而真正的原因（"内容没落库"）在日志里只是一条
     * 外键约束消息，很容易被当成数据库问题排查半天。用 503 + 明确的错误码，
     * 把"这是部署时内容未就绪"这件事直接说出来。
     */
    public static JungApiException packageNotSeeded(String packageId) {
        return new JungApiException("PACKAGE_NOT_SEEDED", 503,
                "本次测评的内容尚未就绪（内容包 " + packageId + " 未登记），请稍后再试或联系管理员。");
    }

    /**
     * 同一个 `Idempotency-Key` 被用在**不同的请求**上（契约 02 §6.1）。
     *
     * <p>这不是"重试"，而是客户端把同一个键配上了另一份请求内容。**绝不能**当成重试
     * 返回上一次的结果：那会让用户以为"选了 A 却得到了 B 的结果"，而且是静默的。
     * 唯一安全的处置是明确拒绝。
     */
    public static JungApiException idempotencyKeyReused() {
        return new JungApiException("IDEMPOTENCY_KEY_REUSED", 409,
                "这次请求与之前用同一个幂等键发出的请求内容不同，为避免拿到不属于它的结果，这次没有执行。请重新发起。");
    }

    /**
     * 同一个幂等键的**上一次请求正在处理中**（同一个键的并发请求）。
     *
     * <p>刻意不在这里"猜结果"：不返回上一次的资源（可能还没创建出来），也不重复创建
     * （那正是幂等要防的事）。让客户端稍后重试，那时会命中已完成的那一次并拿到同一个资源。
     */
    public static JungApiException idempotencyInProgress() {
        return new JungApiException("IDEMPOTENCY_IN_PROGRESS", 409,
                "上一次同样的请求还在处理中，稍等一下再试即可（不会因此多出一份草稿）。");
    }

    public static JungApiException idempotencyRecoveryRequired() {
        return new JungApiException("IDEMPOTENCY_RECOVERY_REQUIRED", 409,
                "上一次创建记录未完成，无法安全确认结果；请从草稿列表核对或联系管理员，不要换键重复创建。");
    }
}
