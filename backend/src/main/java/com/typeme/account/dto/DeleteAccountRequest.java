package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * {@code DELETE /api/v3/me} 请求体：注销是**独立确认操作**（开发方案 §5），
 * 所以要求再次输入密码，并且 {@code confirm} 必须逐字等于 {@code DELETE}。
 *
 * <p>为什么两个都要：密码防"别人拿了你的登录态就能删号"，确认词防"自己手滑点错"。
 * 只留密码会让误删更容易发生，只留确认词则挡不住被劫持的会话。
 */
public record DeleteAccountRequest(
        @NotBlank(message = "密码不能为空")
        @Size(max = 200, message = "密码过长")
        String password,

        @NotBlank(message = "确认词不能为空")
        @Pattern(regexp = AccountFieldRules.DELETE_CONFIRMATION,
                message = "确认词必须逐字为 DELETE")
        String confirm
) {

    @Override
    public String toString() {
        return "DeleteAccountRequest[password=***, confirm=" + confirm + "]";
    }
}
