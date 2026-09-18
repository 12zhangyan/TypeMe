package com.typeme.account.repository;

import java.time.Instant;

/**
 * {@code app_user} 的一行（不含密码 hash 之外的任何凭据材料）。
 *
 * <p>为什么把 hash 放在这里而不是单独一个"凭据"类：它只应被认证与改密两处读取，
 * 而这两处本来就拿着完整的用户行；拆成两类反而让"顺手把 hash 塞进响应 DTO"更容易发生。
 * 真正的防线是：任何返回给客户端的 DTO 都**没有** passwordHash 字段。
 */
public record UserRecord(
        String id,
        String usernameNormalized,
        String usernameDisplay,
        String passwordHash,
        String nickname,
        String status,
        String role,
        Instant createdAt,
        Instant passwordChangedAt,
        int recoveryCodeVersion,
        Instant deletionRequestedAt,
        Integer aiDailyLimit
) {

    /** 账号状态字面量（与契约 §2.1 的取值一致）。 */
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_DISABLED = "DISABLED";
    public static final String STATUS_DELETED = "DELETED";

    /** 角色字面量。 */
    public static final String ROLE_USER = "USER";
    public static final String ROLE_ADMIN = "ADMIN";

    public boolean active() {
        return STATUS_ACTIVE.equals(status);
    }

    public boolean admin() {
        return ROLE_ADMIN.equals(role);
    }
}
