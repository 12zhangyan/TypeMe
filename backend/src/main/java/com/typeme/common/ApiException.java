package com.typeme.common;

import org.springframework.http.HttpStatus;

import java.util.Map;

/**
 * 带错误码与 HTTP 状态的业务异常（契约 02 §7.1）。
 *
 * <p>为什么用异常而不是返回 {@code ResponseEntity<ErrorBody>}：控制器里"校验失败""资源不属于我"
 * "限流"这些分支有十几处，逐个手写响应体一定会漂移；抛异常让 {@link GlobalExceptionHandler}
 * 成为**唯一**的错误形状出口。
 *
 * <p>{@code details} 只允许放安全信息（冲突的 revision、限流等待秒数、校验失败的字段名等）。
 * 绝不把用户输入原样塞回去，也绝不放异常消息——错误体是会被日志与前端一起复制的。
 */
public class ApiException extends RuntimeException {

    private final String code;
    private final HttpStatus httpStatus;
    private final Map<String, Object> details;

    public ApiException(String code, HttpStatus httpStatus, String message) {
        this(code, httpStatus, message, Map.of(), null);
    }

    public ApiException(String code, HttpStatus httpStatus, String message, Map<String, Object> details) {
        this(code, httpStatus, message, details, null);
    }

    public ApiException(String code, HttpStatus httpStatus, String message,
                        Map<String, Object> details, Throwable cause) {
        // 异常消息只用于服务端日志与排错；它永远不会出现在响应体里（见 GlobalExceptionHandler）。
        super(message, cause);
        this.code = code;
        this.httpStatus = httpStatus;
        this.details = details == null ? Map.of() : Map.copyOf(details);
    }

    public String code() {
        return code;
    }

    public HttpStatus httpStatus() {
        return httpStatus;
    }

    public Map<String, Object> details() {
        return details;
    }

    // ------------------------------------------------------------------ 常用构造

    public static ApiException validation(String message, Map<String, Object> fields) {
        return new ApiException(ApiErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, message, fields);
    }

    public static ApiException invalidRequest(String message) {
        return new ApiException(ApiErrorCodes.INVALID_REQUEST, HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException unauthenticated() {
        return new ApiException(ApiErrorCodes.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, "请先登录。");
    }

    public static ApiException invalidCredentials() {
        // 文案刻意与"用户名不存在"完全一致：登录失败的响应体必须逐字相同，否则能被用来枚举账号。
        return new ApiException(ApiErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED,
                "用户名或密码不正确。");
    }

    public static ApiException forbidden(String message) {
        return new ApiException(ApiErrorCodes.FORBIDDEN, HttpStatus.FORBIDDEN, message);
    }

    public static ApiException notFound() {
        return new ApiException(ApiErrorCodes.NOT_FOUND, HttpStatus.NOT_FOUND, "资源不存在。");
    }

    public static ApiException conflict(String message) {
        return new ApiException(ApiErrorCodes.CONFLICT, HttpStatus.CONFLICT, message);
    }

    public static ApiException notConfigured(String message) {
        return new ApiException(ApiErrorCodes.NOT_CONFIGURED, HttpStatus.SERVICE_UNAVAILABLE, message);
    }
}
