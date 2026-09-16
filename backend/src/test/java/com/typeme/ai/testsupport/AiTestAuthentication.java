package com.typeme.ai.testsupport;

import org.springframework.security.authentication.AbstractAuthenticationToken;

import java.util.List;
import java.util.Map;

/**
 * 测试用的认证主体：模拟"账号模块把 userId 放在 principal 的 {@code getUserId()} 上"这一约定。
 *
 * <p>刻意用反射可见的普通类（而不是 record）：AI 的控制器通过
 * {@code principal.getClass().getMethod("getUserId")} 取用户 id，这正是生产代码要走的路径 ——
 * 测试必须覆盖它，否则"账号模块换了主体类型"这类问题会漏到线上。
 */
public class AiTestAuthentication extends AbstractAuthenticationToken {

    private final String userId;

    public AiTestAuthentication(String userId) {
        super(List.of());
        this.userId = userId;
        setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return "n/a";
    }

    /** 生产代码约定读取的方法名。 */
    @Override
    public Object getPrincipal() {
        return new Principal(userId);
    }

    @Override
    public String getName() {
        return userId;
    }

    /** 主体：带 {@code getUserId()}。 */
    public static final class Principal {

        private final String userId;

        public Principal(String userId) {
            this.userId = userId;
        }

        public String getUserId() {
            return userId;
        }

        /** 便于调试输出，不含任何敏感信息。 */
        public Map<String, String> debug() {
            return Map.of("userId", userId);
        }
    }
}
