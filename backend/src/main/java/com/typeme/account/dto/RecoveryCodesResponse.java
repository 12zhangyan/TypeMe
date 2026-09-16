package com.typeme.account.dto;

import java.util.List;

/** {@code POST /api/v3/me/recovery-codes} 的 201 响应：新码只返回一次。 */
public record RecoveryCodesResponse(List<String> recoveryCodes) {
}
