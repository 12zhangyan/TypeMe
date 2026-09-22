package com.typeme.ai.controller;

import com.typeme.ai.config.AiException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * 从认证主体取当前用户 id（AI 控制器用）。
 *
 * <p>与 {@code com.typeme.jung.api.CurrentUser} 同样的做法，但**不 import 它**：
 * 那个类属于并行开发的新测模块，AI 模块不该为了取一个字符串就把编译依赖绑过去。
 * 约定是"主体上有 {@code getUserId()}"，退路是 {@code Authentication#getName()}。
 *
 * <p>安全语义：取不到就 401（fail-closed）。**绝不**用请求体里的任何 userId 兜底 ——
 * 那等于把越权入口写在代码里。
 *
 * <p><b>匿名必须算"取不到"（2026-09-21）：</b>
 * Spring Security 的 {@code AnonymousAuthenticationFilter} 给匿名请求装的
 * {@code AnonymousAuthenticationToken} 满足 {@code isAuthenticated() == true}，
 * 且 {@code getName()} 返回字串 {@code "anonymousUser"}。不显式排除它，
 * 下面这条 fail-closed 判定就会返回 {@code "anonymousUser"} 当 userId，
 * 把"将来的安全配置改松"变成静默的匿名访问。
 */
final class AiCurrentUser {

    private AiCurrentUser() {
    }

    static String requireUserId() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()
                || authentication instanceof org.springframework.security.authentication.AnonymousAuthenticationToken) {
            throw AiException.unauthenticated();
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
        if (name == null || name.isBlank()) {
            throw AiException.unauthenticated();
        }
        return name;
    }
}
