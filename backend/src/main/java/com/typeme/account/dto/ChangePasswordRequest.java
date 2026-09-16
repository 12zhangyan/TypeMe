package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** {@code POST /api/v3/me/password} 请求体。 */
public record ChangePasswordRequest(
        @NotBlank(message = "当前密码不能为空")
        @Size(max = 200, message = "当前密码过长")
        String currentPassword,

        @NotBlank(message = "新密码不能为空")
        @Size(min = AccountFieldRules.PASSWORD_MIN, max = AccountFieldRules.PASSWORD_MAX,
                message = "密码长度需为 8–72 字符")
        @Pattern(regexp = AccountFieldRules.PASSWORD_PATTERN, message = "密码包含不允许的字符")
        String newPassword
) {

    @Override
    public String toString() {
        return "ChangePasswordRequest[currentPassword=***, newPassword=***]";
    }
}
