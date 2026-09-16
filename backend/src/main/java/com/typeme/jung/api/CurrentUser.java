package com.typeme.jung.api;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * 从认证主体取当前用户 id。
 *
 * <p>反射调用的原因：账号模块（并行开发）负责定义 `UserDetails` 实现，
 * 新测模块不该为了一次取值就把编译依赖绑到它的类名上。约定是"主体上有 `getUserId()`"，
 * 退路是 `Authentication#getName()`（账号模块把 username 作为 name）。
 *
 * <p>无论取到什么都**只用于服务端自己的 SQL 过滤**：客户端请求体里没有任何 owner 字段，
 * 所以不存在"客户端指定 owner"的入口。
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    public static String requireUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        Object principal = authentication.getPrincipal();
        if (principal != null) {
            try {
                Object value = principal.getClass().getMethod("getUserId").invoke(principal);
                if (value != null && !String.valueOf(value).isBlank()) {
                    return String.valueOf(value);
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // 主体没有 getUserId()：按约定退回 name
            }
        }
        String name = authentication.getName();
        return name == null || name.isBlank() ? null : name;
    }
}
