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
 *
 * <p><b>匿名请求必须返回 null / false（2026-09-21 实测踩到）：</b>
 * Spring Security 的 {@code AnonymousAuthenticationFilter} 会给匿名请求装一个
 * {@code AnonymousAuthenticationToken}，它的 {@code isAuthenticated()} 是 **true**，
 * 而 `getName()` 会返回字符串 `"anonymousUser"`。只看
 * {@code isAuthenticated() + getName()} 就会把**匿名访客当成已登录用户**。
 * 这不是理论问题：公开目录接口曾因此把每条匿名请求都判成"已登录"，
 * 于是匿名限流一次都没发生过（测试 `RateLimitIT#anonymousCatalogReadsAreRateLimited` 抓到）。
 * 所以两个方法都必须显式排除匿名单例。
 */
public final class CurrentUser {

    private CurrentUser() {
    }

    /**
     * 当前请求是否带着**真实**用户身份（匿名 与 未认证 都是 false）。
     *
     * <p>给"公开接口但已登录用户免限流/换口径"这类分支用：这类判断若写错，
     * 失败方向是"把匿名访客当已登录"，即悄悄放开一道本应存在的限制。
     */
    public static boolean isAuthenticated() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return false;
        }
        return !(authentication instanceof org.springframework.security.authentication.AnonymousAuthenticationToken);
    }

    public static String requireUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof org.springframework.security.authentication.AnonymousAuthenticationToken) {
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
