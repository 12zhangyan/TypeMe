package com.typeme.common;

import java.util.Map;

/**
 * 契约 02 §7.1 的统一错误体：{@code {code, message, requestId, details}}。
 *
 * <p>固定四个字段（{@code details} 无内容时给空对象而不是 null）：前端只需要写一次解析，
 * 不用为每个端点猜字段是否存在。
 */
public record ApiErrorBody(String code, String message, String requestId, Map<String, Object> details) {

    public ApiErrorBody {
        details = details == null ? Map.of() : details;
    }
}
