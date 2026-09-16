package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * {@code POST /api/v3/auth/login} 请求体。
 *
 * <p>这里**不**用注册那套用户名/密码强度规则：登录只做长度上限防护（挡住超长输入造成的
 * 资源消耗），不做格式限定。理由是失败语义必须单一 —— 所有失败都归一到
 * {@code 401 INVALID_CREDENTIALS}，任何"格式不对 → 400"的分支都会多给攻击者一条信息通道。
 */
public record LoginRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 64, message = "用户名过长")
        String username,

        @NotBlank(message = "密码不能为空")
        @Size(max = 200, message = "密码过长")
        String password
) {

    /** 供服务层做规范化（登录按 username_normalized 查）。 */
    public String normalizedUsername() {
        return username == null ? "" : username.trim();
    }

    @Override
    public String toString() {
        // 防止任何日志/异常消息把密码带出去：toString 是最容易被顺手打的一条路径。
        return "LoginRequest[username=" + username + ", password=***]";
    }
}
