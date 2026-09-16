package com.typeme.account.dto;

/**
 * {@code POST /api/v3/auth/login} 的 200 响应。
 *
 * <p>刻意不返回 role：前端的"是否显示后台入口"应该来自后台接口自身的探测结果，
 * 而不是登录响应里的角色字段（后者会让"绕过前端隐藏"变成一个可被忽略的问题）。
 */
public record LoginResponse(String userId, String username, String nickname) {
}
