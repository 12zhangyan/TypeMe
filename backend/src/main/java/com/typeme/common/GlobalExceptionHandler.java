package com.typeme.common;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * {@code /api/v3} 的统一错误出口（契约 02 §7.1）。
 *
 * <p><b>作用域</b>：{@code basePackages = "com.typeme.account"} 是刻意的。旧的 v1/v2 契约
 * （内容与类型接口）有**逐字冻结**的固定错误体（{@code AssessmentPackageController} 自己
 * catch 后返回固定 JSON）；并行模块（attempt/report/AI）也各有自己的错误语义。全局 advice
 * 会把这些形状悄悄改掉，属于"顺手破坏别人的契约"。因此本类只对账号模块的控制器生效，
 * 其它模块需要时自己注册 advice。
 *
 * <p><b>日志纪律</b>（开发方案 §5，本项目硬要求）：这里只记录 requestId、错误码、HTTP 状态与
 * 异常类型。**绝不**记录请求体、查询串、Cookie/Authorization 头、密码、恢复码、原始答卷或
 * 自由文本。原因：错误路径是最容易被整体打进日志的地方，一旦把请求体带上，密码与恢复码就会
 * 以明文形式长期留在日志文件里，而这恰恰是本项目对用户承诺过不做的事。
 * 因此下面所有日志语句都只有码/状态/类名三类信息，没有一处使用参数化的请求内容。
 */
@RestControllerAdvice(basePackages = "com.typeme.account")
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 业务异常：错误码与 HTTP 状态由抛出点决定。 */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorBody> handleApiException(ApiException ex, HttpServletRequest request) {
        log.warn("api-error code={} status={} requestId={}", ex.code(), ex.httpStatus().value(), requestId());
        return ResponseEntity.status(ex.httpStatus())
                .body(new ApiErrorBody(ex.code(), ex.getMessage(), requestId(), ex.details()));
    }

    /** {@code @Valid} 校验失败：只回字段名与规则，**不回显用户输入的值**（那是敏感数据）。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorBody> handleValidation(MethodArgumentNotValidException ex,
                                                         HttpServletRequest request) {
        Map<String, Object> fields = new LinkedHashMap<>();
        for (FieldError error : ex.getBindingResult().getFieldErrors()) {
            // putIfAbsent：同一字段多条规则时只留第一条，避免把内部约束细节铺开给客户端。
            fields.putIfAbsent(error.getField(), error.getDefaultMessage());
        }
        log.warn("api-error code={} status=400 requestId={} fields={}",
                ApiErrorCodes.VALIDATION_FAILED, requestId(), fields.keySet());
        return ResponseEntity.badRequest().body(new ApiErrorBody(
                ApiErrorCodes.VALIDATION_FAILED, "请求参数校验失败。", requestId(), fields));
    }

    /** 请求体无法解析（不是 JSON、枚举值非法、类型不匹配）：消息不回传，避免泄漏类名/字段路径。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiErrorBody> handleUnreadable(HttpMessageNotReadableException ex) {
        log.warn("api-error code={} status=400 requestId={}", ApiErrorCodes.INVALID_REQUEST, requestId());
        return ResponseEntity.badRequest().body(new ApiErrorBody(
                ApiErrorCodes.INVALID_REQUEST, "请求体无法解析。", requestId(), Map.of()));
    }

    /** 缺少必填查询参数（例如后台用户列表的分页参数缺失）。 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiErrorBody> handleMissingParameter(MissingServletRequestParameterException ex) {
        log.warn("api-error code={} status=400 requestId={} parameter={}",
                ApiErrorCodes.VALIDATION_FAILED, requestId(), ex.getParameterName());
        return ResponseEntity.badRequest().body(new ApiErrorBody(
                ApiErrorCodes.VALIDATION_FAILED, "缺少必填参数。", requestId(),
                Map.of("fields", Map.of(ex.getParameterName(), "必填"))));
    }

    /** 方法不支持 / 媒体类型不支持：仍然给契约形状的 JSON，不退化成 HTML 错误页。 */
    @ExceptionHandler({HttpRequestMethodNotSupportedException.class, HttpMediaTypeNotSupportedException.class})
    public ResponseEntity<ApiErrorBody> handleMethodOrMedia(Exception ex) {
        log.warn("api-error code={} status=405 requestId={}", ApiErrorCodes.INVALID_REQUEST, requestId());
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(new ApiErrorBody(
                ApiErrorCodes.INVALID_REQUEST, "该接口不支持这个请求方法或媒体类型。", requestId(), Map.of()));
    }

    /** 上传超限：契约规定普通接口请求体上限 8KB，导出无限制。 */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiErrorBody> handleUploadTooLarge(MaxUploadSizeExceededException ex) {
        log.warn("api-error code={} status=413 requestId={}", ApiErrorCodes.INVALID_REQUEST, requestId());
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(new ApiErrorBody(
                ApiErrorCodes.INVALID_REQUEST, "请求体过大。", requestId(), Map.of()));
    }

    /**
     * 方法级授权失败（{@code @PreAuthorize} 拒绝）。
     *
     * <p><b>为什么必须有这一条</b>：Spring Security 的方法级授权是在**控制器方法调用内层**
     * 抛 {@code AuthorizationDeniedException} 的，而 {@code @RestControllerAdvice} 也在
     * 那一层。没有这条 handler 时，它会被下面的兜底 {@code Exception} 接住并变成
     * <b>500</b> —— 于是"非管理员访问后台"对外表现成"服务器故障"，
     * 既误导前端（无法区分"没权限"和"服务挂了"），也把一次正常的拒绝写成了 error 级日志。
     * 过滤器链上的越权走 {@code AccessDeniedHandler}，方法级越权走这里，两条路必须给同一个 403。
     */
    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<ApiErrorBody> handleAccessDenied(
            org.springframework.security.access.AccessDeniedException ex) {
        log.warn("api-error code={} status=403 requestId={}", ApiErrorCodes.FORBIDDEN, requestId());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new ApiErrorBody(
                ApiErrorCodes.FORBIDDEN, "没有访问该资源的权限。", requestId(), Map.of()));
    }

    /**
     * 兜底：任何未预料异常都映射为 500 + 固定文案。
     * 用 {@code log.error} 记异常类型与 requestId 便于排障，但**不把异常消息放进响应体**：
     * 消息里可能带 SQL、路径、连接串等内部细节。
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorBody> handleUnexpected(Exception ex) {
        log.error("api-error code={} status=500 requestId={} exception={}",
                ApiErrorCodes.INTERNAL, requestId(), ex.getClass().getName(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new ApiErrorBody(
                ApiErrorCodes.INTERNAL, "服务暂时不可用，请稍后再试。", requestId(), Map.of()));
    }

    private static String requestId() {
        return MDC.get(RequestIdFilter.MDC_KEY);
    }
}
