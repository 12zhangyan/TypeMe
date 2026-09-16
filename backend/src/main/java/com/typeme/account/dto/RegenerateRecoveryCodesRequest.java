package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** {@code POST /api/v3/me/recovery-codes} 请求体：重发恢复码前必须重新验证密码。 */
public record RegenerateRecoveryCodesRequest(
        @NotBlank(message = "当前密码不能为空")
        @Size(max = 200, message = "当前密码过长")
        String currentPassword
) {

    @Override
    public String toString() {
        return "RegenerateRecoveryCodesRequest[currentPassword=***]";
    }
}
