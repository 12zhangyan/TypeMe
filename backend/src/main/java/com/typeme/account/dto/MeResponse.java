package com.typeme.account.dto;

import java.time.Instant;

/**
 * 账号公开资料（{@code GET /api/v3/me}、{@code PATCH /api/v3/me} 的响应）。
 *
 * <p>字段与契约 §7.2 一致：{@code userId, username, nickname, createdAt, passwordChangedAt}。
 * **没有** passwordHash、status、role —— 前者是凭据材料，后两者是内部状态；
 * 即便客户端"想知道自己是不是管理员"，也应该由后台接口的 403/200 回答，而不是靠 /me 回显。
 */
public record MeResponse(
        String userId,
        String username,
        String nickname,
        Instant createdAt,
        Instant passwordChangedAt
) {
}
