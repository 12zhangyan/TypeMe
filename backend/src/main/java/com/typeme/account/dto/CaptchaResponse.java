package com.typeme.account.dto;

/**
 * {@code GET /api/v3/auth/captcha} 的 200 响应。
 *
 * <p>{@code image} 是 {@code data:image/png;base64,…}，前端直接放进 {@code <img src>}；
 * 答案不在响应里（令牌只带签名）。
 */
public record CaptchaResponse(String token, String image, long expiresInSeconds) {
}
