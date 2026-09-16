package com.typeme.security;

import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpSessionEvent;
import jakarta.servlet.http.HttpSessionListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 进程内的"用户 → 活跃 HttpSession"映射，用来**真正**踢掉旧会话。
 *
 * <p>为什么不能只删 {@code app_user_session} 表行：表只是绝对期限与审计账本，
 * 容器里的会话对象才是请求能否通过认证的依据。只删行的话，被撤销的 Cookie 在
 * 闲置超时（2h）之前仍然完全可用 —— 那等于"改密码没踢掉任何设备"。
 *
 * <p>为什么不用 Spring Security 的 {@code SessionRegistryImpl} 直接失效：它的 API
 * （{@code getAllPrincipals}/{@code getAllSessions}）暴露的是 {@code SessionInformation}
 * （含 sessionId 与过期标记），**不提供按 sessionId 取回 {@code HttpSession} 并使其失效**的能力。
 * 要拿到可失效的会话对象，只能自己持有引用。这里用 {@link HttpSessionListener} 维护映射：
 * 会话被容器回收时同步清理，不会无限增长。
 *
 * <p>本类是**单实例内存**语义：多实例部署时各自只能踢掉自己进程里的会话，需要靠
 * {@code app_user_session} 表 + 每请求校验来跨实例收敛（{@link SessionAbsoluteTtlFilter}
 * 已在扩展点上：它每次都会读表的绝对期限，会话行被删后同样拿不到期限而失效）。
 */
@Component
public class SessionRegistryService implements HttpSessionListener {

    private static final Logger log = LoggerFactory.getLogger(SessionRegistryService.class);

    /** user_id → (sessionId → HttpSession)。 */
    private final Map<String, Map<String, HttpSession>> sessionsByUser = new ConcurrentHashMap<>();

    /** sessionId → userId，用于销毁时反向清理。 */
    private final Map<String, String> userBySession = new ConcurrentHashMap<>();

    /** 登记一个会话（登录/注册成功后调用）。 */
    public void register(String sessionId, String userId, HttpSession session) {
        if (sessionId == null || userId == null) {
            return;
        }
        sessionsByUser.computeIfAbsent(userId, key -> new ConcurrentHashMap<>()).put(sessionId, session);
        userBySession.put(sessionId, userId);
    }

    /**
     * 令该用户的全部进程内会话失效（可选保留一个）。
     *
     * @return 实际失效的会话数
     */
    public int invalidateAllForUser(String userId, String exceptSessionId) {
        Map<String, HttpSession> sessions = sessionsByUser.get(userId);
        if (sessions == null || sessions.isEmpty()) {
            return 0;
        }
        int invalidated = 0;
        for (Map.Entry<String, HttpSession> entry : sessions.entrySet()) {
            if (exceptSessionId != null && exceptSessionId.equals(entry.getKey())) {
                continue;
            }
            try {
                entry.getValue().invalidate();
                invalidated++;
            } catch (IllegalStateException alreadyInvalid) {
                // 会话已被容器回收：目标状态已达成，不算错误。
                log.debug("session already invalid sessionId={}", entry.getKey());
            }
            userBySession.remove(entry.getKey());
        }
        sessions.keySet().removeIf(sessionId -> exceptSessionId == null || !exceptSessionId.equals(sessionId));
        return invalidated;
    }

    /** 当前进程内该用户的会话 id 列表（排障与测试用）。 */
    public List<String> activeSessionIdsForUser(String userId) {
        Map<String, HttpSession> sessions = sessionsByUser.get(userId);
        return sessions == null ? List.of() : List.copyOf(sessions.keySet());
    }

    public int activeSessionCount() {
        return userBySession.size();
    }

    // ------------------------------------------------------------------ 容器回调

    @Override
    public void sessionCreated(HttpSessionEvent se) {
        // 会话创建时还不知道属于谁（登录成功才 register），这里刻意不做任何事。
    }

    @Override
    public void sessionDestroyed(HttpSessionEvent se) {
        HttpSession session = se.getSession();
        String sessionId = session.getId();
        String userId = userBySession.remove(sessionId);
        if (userId == null) {
            return;
        }
        Map<String, HttpSession> sessions = sessionsByUser.get(userId);
        if (sessions != null) {
            sessions.remove(sessionId);
            if (sessions.isEmpty()) {
                // remove(key, value) 形式：避免把"清理期间新登记的会话"一起删掉。
                sessionsByUser.remove(userId, sessions);
            }
        }
    }

    /** 仅供测试断言"映射没有泄漏"。 */
    Set<String> trackedSessionIds() {
        return Set.copyOf(userBySession.keySet());
    }
}
