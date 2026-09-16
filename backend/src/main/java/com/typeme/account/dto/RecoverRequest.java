package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /api/v3/auth/recover} 请求体：用户名 + 恢复码 + 新密码。
 *
 * <p>恢复码的格式不做正则限定（只限长度）：用户可能抄错、多打连字符、写成小写，
 * 这些都该被规范化后正常比对，而不是在格式校验阶段就被拒 —— 报"格式不对"会告诉攻击者
 * 恢复码的字母表与长度，而真正该给的信息是统一的"凭据不正确"。
 */
public record RecoverRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 64, message = "用户名过长")
        String username,

        @NotBlank(message = "恢复码不能为空")
        @Size(max = 64, message = "恢复码过长")
        String recoveryCode,

        @NotBlank(message = "新密码不能为空")
        @Size(min = AccountFieldRules.PASSWORD_MIN, max = AccountFieldRules.PASSWORD_MAX,
                message = "密码长度需为 8–72 字符")
        @Pattern(regexp = AccountFieldRules.PASSWORD_PATTERN, message = "密码包含不允许的字符")
        String newPassword
) {

    @Override
    public String toString() {
        // 恢复码与密码都是凭据，绝不出现在日志/异常消息里。
        return "RecoverRequest[username=" + username + ", recoveryCode=***, newPassword=***]";
    }
}
