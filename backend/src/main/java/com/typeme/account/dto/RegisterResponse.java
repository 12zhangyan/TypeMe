package com.typeme.account.dto;

import java.util.List;

/**
 * {@code POST /api/v3/auth/register} 的 201 响应。
 *
 * <p>{@code recoveryCodes} 里的明文**只在这里出现一次**（契约 §7.2）。这也是为什么
 * 本记录不允许被缓存、也不允许被日志打印：它是整个系统里唯一持有恢复码明文的时刻。
 */
public record RegisterResponse(
        String userId,
        String username,
        String nickname,
        List<String> recoveryCodes,
        String recoveryCodePolicyVersion
) {
}
