package com.typeme.security;

import com.typeme.account.service.TypemeProperties;
import com.typeme.common.ApiErrorCodes;
import com.typeme.common.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * 固定窗口限流（契约 §5.4）。
 *
 * <p>bucket_key = {@code <operation>:<scope>:<value>:<windowStart>}，主键唯一，
 * 计数靠"原子 upsert 后读回"完成。窗口起点参与 key，所以窗口滚动天然实现，
 * 不需要清理任务（旧 key 不会被再次命中；容量治理另有一条清理 SQL 的余地）。
 *
 * <p><b>为什么用"先 UPDATE 再 INSERT"而不是 {@code ON DUPLICATE KEY UPDATE}：</b>
 * 后者是 MySQL 方言。H2 在 MODE=MySQL 下**确实**支持它（本项目用 h2-2.2.224 实测过），
 * 但"能不能跑"依赖的是 H2 的模式实现细节；而这段代码的价值恰恰在于"同一条路径在
 * MySQL 与 H2 上行为一致"。改用标准 SQL 后：
 * <ul>
 *   <li>第一次请求：UPDATE 影响 0 行 → INSERT 插入 counter=1；</li>
 *   <li>后续请求：UPDATE 影响 1 行，counter+1；</li>
 *   <li>并发首次：一方 INSERT 撞主键抛 {@link DuplicateKeyException}（H2 与 MySQL 都映射成
 *       同一个 Spring 异常），捕获后重试一次 UPDATE 即可 —— 这比依赖方言更可预期。</li>
 * </ul>
 *
 * <p><b>事务</b>：计数写在 {@code REQUIRES_NEW} 事务里独立提交。原因是调用方的业务事务
 * 可能因为参数校验失败而回滚，但"这次尝试发生了"这一事实**不能**跟着回滚，否则暴力破解
 * 只要每次都被业务校验拒绝就能无限重试。
 */
@Service
public class RateLimitService {

    private static final Logger log = LoggerFactory.getLogger(RateLimitService.class);

    /** 契约 §6.1 的 operation 命名风格：小写下划线。 */
    public static final String OP_REGISTER = "register";
    public static final String OP_LOGIN = "login";
    public static final String OP_RECOVER = "recover";
    public static final String OP_AI_CREATE = "ai_create";

    /** 窗口起点用 UTC 分钟精度字符串，保证 key 可读、可比较、长度稳定。 */
    private static final DateTimeFormatter WINDOW_FORMAT =
            DateTimeFormatter.ofPattern("yyyyMMddHHmm").withZone(ZoneOffset.UTC);

    private final JdbcTemplate jdbc;
    private final TypemeProperties properties;

    public RateLimitService(JdbcTemplate jdbc, TypemeProperties properties) {
        this.jdbc = jdbc;
        this.properties = properties;
    }

    /** 登录/AI：按来源 IP 计数。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkLoginIp(String clientIp) {
        TypemeProperties.Login cfg = properties.ratelimit().login();
        count(OP_LOGIN, "ip", clientIp, cfg.window(), cfg.ipLimit(), "登录尝试过于频繁，请稍后再试。");
    }

    /**
     * 登录：按用户名计数（契约要求 ip 与 user 双 key 各自限流）。
     *
     * <p>用**用户名**而不是 userId：失败登录时我们可能根本不知道账号是否存在，
     * 而按用户名计数恰好也能防"拿不存在用户名扫"。调用方对已存在账号才可能换成 userId，
     * 这里统一用规范化用户名，保证两条分支都计数。
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkLoginUsername(String normalizedUsername) {
        TypemeProperties.Login cfg = properties.ratelimit().login();
        count(OP_LOGIN, "user", normalizedUsername, cfg.window(), cfg.userLimit(),
                "该账号的登录尝试过于频繁，请稍后再试。");
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkRegisterIp(String clientIp) {
        TypemeProperties.Window cfg = properties.ratelimit().register();
        count(OP_REGISTER, "ip", clientIp, cfg.window(), cfg.ipLimit(), "注册过于频繁，请稍后再试。");
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkRecoverIp(String clientIp) {
        TypemeProperties.Window cfg = properties.ratelimit().recover();
        count(OP_RECOVER, "ip", clientIp, cfg.window(), cfg.ipLimit(), "恢复尝试过于频繁，请稍后再试。");
    }

    /** AI 创建：ip + user 双 key（AI 模块调用；本模块只提供能力）。 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkAiCreate(String clientIp, String userId) {
        if (!properties.ratelimit().enabled()) {
            return;
        }
        TypemeProperties.Login cfg = properties.ratelimit().ai();
        count(OP_AI_CREATE, "ip", clientIp, cfg.window(), cfg.ipLimit(), "操作过于频繁，请稍后再试。");
        count(OP_AI_CREATE, "user", userId, cfg.window(), cfg.userLimit(), "操作过于频繁，请稍后再试。");
    }

    /** 供测试与运维查看某个 key 的当前计数（不影响计数）。 */
    public int currentCount(String operation, String scope, String value, Duration window) {
        Integer count = jdbc.queryForObject(
                "SELECT counter FROM rate_limit_bucket WHERE bucket_key = ?", Integer.class,
                bucketKey(operation, scope, value, Instant.now(), window));
        return count == null ? 0 : count;
    }

    // ------------------------------------------------------------------ 内部实现

    private void count(String operation, String scope, String value, Duration window, int limit, String message) {
        if (!properties.ratelimit().enabled()) {
            return;
        }
        if (value == null || value.isBlank()) {
            // 没有可计数的维度就不拦（否则一个 null IP 会把所有人算作同一个桶而互相误伤）；
            // 空白 key 会退化成全局共享桶，是比"不拦"更糟的失败模式。
            return;
        }
        Instant now = Instant.now();
        String key = bucketKey(operation, scope, value, now, window);
        Instant windowStart = windowStart(now, window);
        int counter = incrementAndRead(key, windowStart);

        if (counter > limit) {
            long retryAfterSeconds = Math.max(1, Duration.between(now, windowStart.plus(window)).getSeconds() + 1);
            log.warn("rate-limited operation={} scope={} limit={} retryAfterSeconds={}",
                    operation, scope, limit, retryAfterSeconds);
            throw new ApiException(ApiErrorCodes.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, message,
                    Map.of("retryAfterSeconds", retryAfterSeconds));
        }
    }

    /**
     * 原子自增并读回。用 {@code SELECT} 读回而不是信任 UPDATE 的表达式：
     * 并发下"读到的值"必须是我这次自增之后的值，否则限流形同虚设。
     */
    private int incrementAndRead(String key, Instant windowStart) {
        int updated = jdbc.update(
                "UPDATE rate_limit_bucket SET counter = counter + 1, revision = revision + 1 WHERE bucket_key = ?",
                key);
        if (updated == 0) {
            try {
                jdbc.update("INSERT INTO rate_limit_bucket (bucket_key, window_start, counter, revision) "
                        + "VALUES (?, ?, 1, 0)", key, java.sql.Timestamp.from(windowStart));
            } catch (DuplicateKeyException race) {
                // 另一个请求刚刚插入了同一窗口的桶：它已经算过 1 次，我这次补上自增。
                jdbc.update("UPDATE rate_limit_bucket SET counter = counter + 1, revision = revision + 1 "
                        + "WHERE bucket_key = ?", key);
            }
        }
        Integer counter = jdbc.queryForObject(
                "SELECT counter FROM rate_limit_bucket WHERE bucket_key = ?", Integer.class, key);
        return counter == null ? 0 : counter;
    }

    private static String bucketKey(String operation, String scope, String value, Instant now, Duration window) {
        return operation + ":" + scope + ":" + value + ":" + WINDOW_FORMAT.format(windowStart(now, window));
    }

    /** 窗口起点：把 now 向下取整到窗口长度。 */
    private static Instant windowStart(Instant now, Duration window) {
        long windowSeconds = Math.max(1, window.getSeconds());
        long epochSeconds = now.getEpochSecond();
        return Instant.ofEpochSecond(epochSeconds - Math.floorMod(epochSeconds, windowSeconds));
    }
}
