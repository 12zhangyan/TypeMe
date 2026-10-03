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
 *
 * <p>{@code disclaimerAccepted}（2026-09-17 新增）：注册页上「我已阅读并理解这份测评的
 * 定位与数据处理说明」的显式同意。为什么放在**注册**这一步而不是报告页：
 * 报告页的说明解决的是"看到结论时别误解"，而这里解决的是"账号一建立就开始把作答内容
 * 存到服务器上"这件事必须先被告知并同意。两者互补，不是同一件事。
 *
 * <p>它**没有**用 bean validation 注解，而是由 {@code AccountService.register} 复核：
 * 一是要能被 {@code typeme.auth.disclaimer-required=false} 关掉（见 application.yml
 * 的说明），注解做不到条件校验；二是同意状态要进服务端日志与错误体字段名，
 * 放在服务层才能写全。多传 {@code true} 在这里是"同意"，缺省或 {@code false}
 * 一律按未同意处理 —— 前端不勾选就提交会得到 {@code VALIDATION_FAILED} +
 * {@code disclaimerAccepted} 字段。
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
        String nickname,

        Boolean disclaimerAccepted,

        @Size(max = 128, message = "邀请码格式不正确")
        String invitationCode
) {
    @Override public String toString() { return "RegisterRequest[REDACTED]"; }
}
