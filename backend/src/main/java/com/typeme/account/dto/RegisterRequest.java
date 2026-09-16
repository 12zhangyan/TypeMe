package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /api/v3/auth/register} 请求体。
 *
 * <p>{@code nickname} 可选。校验用的是"非空白"正则而不是 {@code @NotBlank}：
 * {@code @NotBlank} 会把"不传昵称"（null）也判为失败，而契约里昵称是可选的。
 * 首尾空白在服务层 trim 后再按 1–32 字符复核（注解只能看到原始串）。
 */
public record RegisterRequest(
        @NotBlank(message = "用户名不能为空")
        @Pattern(regexp = AccountFieldRules.USERNAME_PATTERN,
                message = "用户名需为 4–32 位字母、数字或下划线")
        String username,

        @NotBlank(message = "密码不能为空")
        @Size(min = AccountFieldRules.PASSWORD_MIN, max = AccountFieldRules.PASSWORD_MAX,
                message = "密码长度需为 8–72 字符")
        @Pattern(regexp = AccountFieldRules.PASSWORD_PATTERN, message = "密码包含不允许的字符")
        String password,

        @Size(max = AccountFieldRules.NICKNAME_MAX, message = "昵称最多 32 个字符")
        @Pattern(regexp = AccountFieldRules.NICKNAME_NON_BLANK_PATTERN,
                message = "昵称需为 1–32 个字符且不能只含空白")
        String nickname
) {
}
