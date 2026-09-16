package com.typeme.account.dto;

/** {@code DELETE /api/v3/me} 的 202 响应：只回删除任务 id，不回任何账号数据。 */
public record DeleteAccountResponse(String deletionJobId) {
}
