package com.typeme.account.dto;

/**
 * {@code GET /api/v3/auth/csrf} 的 200 响应（契约 §7.2）。
 *
 * <p>字段名 {@code headerName}/{@code parameterName} 由服务端给出，前端不写死：
 * 这样将来改 cookie 名或 header 名只需要动服务端一处，前端不至于静默失效。
 */
public record CsrfTokenResponse(String token, String headerName, String parameterName) {
}
