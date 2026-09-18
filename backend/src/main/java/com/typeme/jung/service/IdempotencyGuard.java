package com.typeme.jung.service;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

/**
 * `api_idempotency` 的唯一读写点（契约 02 §6.1）。
 *
 * <p><b>为什么必须有它</b>：2026-09-18 复核发现这张表从 V5 迁移建好之后
 * <b>只被 DELETE 过</b>（账号注销清理），从来没有写入 —— 于是契约里那句
 * "`POST /attempts` 支持可选 `Idempotency-Key`" 从来没兑现过：
 * 建测评的请求超时后，用户点一次重试就多一份草稿，而草稿又没有列表入口，
 * 那份额外的草稿对用户是**不可见的垃圾**（A35 / A51）。
 *
 * <p><b>语义</b>（严格照契约，不自行发明）：
 * <ul>
 *   <li>同 key + 同 `request_hash` + `COMPLETED` → 返回 `response_ref`（= 上次那个资源）；</li>
 *   <li>同 key + 不同 `request_hash` → 409 {@code IDEMPOTENCY_KEY_REUSED}；</li>
 *   <li>同 key 还在处理中 → 409 {@code IDEMPOTENCY_IN_PROGRESS}（不猜、不重复创建）。</li>
 * </ul>
 *
 * <p><b>关于"处理中"会不会永远卡住</b>：一次请求崩在中间会留下 `IN_PROGRESS` 行。
 * 所以超过 {@link #STALE_AFTER} 的 `IN_PROGRESS` 视为**上一次已经死掉**，
 * 允许重新占用（先删后插）。没有这条，"服务重启导致这次点击永远失败"会变成一个
 * 只有换客户端才能绕开的死结。
 *
 * <p>刻意不用 `@Transactional` 包住整个流程：占用、创建资源、标记完成是**三个独立事务**。
 * 理由见 {@code AttemptService#create} 的注释 —— 把它们揉进一个事务，
 * 要么拿不到"并发同 key 时谁赢"的原子性，要么让资源创建的回滚牵动幂等记录。
 */
@Service
public class IdempotencyGuard {

    /** 幂等记录的存活时间。超过它之后同 key 会被当成一次全新的请求。 */
    private static final Duration TTL = Duration.ofHours(24);

    /**
     * `IN_PROGRESS` 超过这个时长就认为"上一次那次请求已经死了"。
     *
     * <p>取值理由：真实的建测评请求是毫秒级，给它 2 分钟已经非常宽松；
     * 太短会在慢请求下误判成"死掉了"从而允许两份草稿，太长会让崩溃后的重试
     * 一直撞 `IDEMPOTENCY_IN_PROGRESS`。
     */
    private static final Duration STALE_AFTER = Duration.ofMinutes(2);

    /** 契约里 `idempotency_key` 是 VARCHAR(80)。超长直接拒，不要落库后截断。 */
    private static final int MAX_KEY_LENGTH = 80;

    private final JdbcTemplate jdbc;
    private final TimeSource time;

    public IdempotencyGuard(JdbcTemplate jdbc, TimeSource time) {
        this.jdbc = jdbc;
        this.time = time;
    }

    /**
     * 请求内容的指纹：同 key 必须配同 hash，否则是"同一个键用在两件不同的事上"。
     *
     * <p>用 64 位十六进制（SHA-256）而不是把内容本身存进表里：契约列宽就是 CHAR(64)，
     * 而且请求内容里可能有用户的输入，没有理由把它复制到一张审计性质的表里。
     */
    public static String fingerprint(String... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            StringBuilder joined = new StringBuilder();
            for (String part : parts) {
                // 用 NUL 分隔，避免 ("ab","c") 与 ("a","bc") 指纹相同
                joined.append(part == null ? "" : part).append('\u0000');
            }
            byte[] hash = digest.digest(joined.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                out.append(Character.forDigit((b >> 4) & 0xF, 16));
                out.append(Character.forDigit(b & 0xF, 16));
            }
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 是 JDK 必须提供的算法，走到这里说明运行环境坏了
            throw new IllegalStateException("运行环境缺少 SHA-256", e);
        }
    }

    /**
     * 已经完成过的同 key 请求 → 返回上次创建的资源 id；否则 `null`。
     *
     * <p>同 key 但指纹不同会**直接抛 409**：调用方不需要自己比对指纹，
     * 这样任何调用点都不可能"忘了比对"。
     */
    public String completedRef(String userId, String operation, String key, String requestHash) {
        Map<String, Object> row = find(userId, operation, key);
        if (row == null) {
            return null;
        }
        String recordedHash = (String) row.get("request_hash");
        if (!requestHash.equals(recordedHash)) {
            throw JungApiException.idempotencyKeyReused();
        }
        Object ref = row.get("response_ref");
        boolean completed = "COMPLETED".equals(row.get("status"));
        return completed && ref != null ? (String) ref : null;
    }

    /**
     * 占用这个键。返回 `false` 表示**别的请求正拿着它**（并发同 key）。
     *
     * <p>先删掉已经死掉的 `IN_PROGRESS` 行再插入：主键就是锁，
     * 并发时两个请求只有一个插入成功（另一个拿 `DuplicateKeyException`）。
     */
    public boolean claim(String userId, String operation, String key, String requestHash) {
        LocalDateTime now = time.nowUtc();
        // 死掉的那次请求不该把用户永远挡在门外
        jdbc.update("""
                DELETE FROM api_idempotency
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                   AND status = 'IN_PROGRESS' AND created_at < ?
                """, userId, operation, key, now.minus(STALE_AFTER));
        try {
            jdbc.update("""
                    INSERT INTO api_idempotency
                      (user_id, operation, idempotency_key, request_hash, response_ref, status, created_at, expires_at)
                    VALUES (?, ?, ?, ?, NULL, 'IN_PROGRESS', ?, ?)
                    """, userId, operation, key, requestHash, now, now.plus(TTL));
            return true;
        } catch (DuplicateKeyException e) {
            return false;
        }
    }

    /** 标记完成，并记下这次创建出来的资源 id。 */
    public void complete(String userId, String operation, String key, String responseRef) {
        jdbc.update("""
                UPDATE api_idempotency
                   SET status = 'COMPLETED', response_ref = ?
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                """, responseRef, userId, operation, key);
    }

    /**
     * 放弃占用（资源创建失败时调用）。
     *
     * <p>必须调用：否则一次失败会让这个键在 {@link #STALE_AFTER} 之内都拿不到，
     * 用户看到的是"上一次请求还在处理中" —— 而实际上它早就失败了。
     * 只删 `IN_PROGRESS` 行，绝不碰 `COMPLETED`。
     */
    public void release(String userId, String operation, String key) {
        jdbc.update("""
                DELETE FROM api_idempotency
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ? AND status = 'IN_PROGRESS'
                """, userId, operation, key);
    }

    /**
     * 忘掉一条**悬空**的完成记录：它指向的资源已经不在了（用户删了草稿、或账号注销清理过）。
     *
     * <p>为什么必须删：留存它会让这个键"永久命中一个不存在的资源"，
     * 于是用户删掉草稿后再点一次会拿到一份 404 的 id（而不是一份新草稿）。
     * 条件里带 `response_ref = ?`：万一并发中有另一次请求刚刚把同一行标成
     * 指向别的资源，那次更新不会被我们误删。
     */
    public void forgetDangling(String userId, String operation, String key, String responseRef) {
        jdbc.update("""
                DELETE FROM api_idempotency
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ? AND response_ref = ?
                """, userId, operation, key, responseRef);
    }

    /**
     * 清理已经过期的记录（容量治理）。返回这次删掉几行。
     *
     * <p>为什么需要它：这张表每来一次"建测评/交卷/建分析"就多一行，TTL 24 小时，
     * 但**只有注销清理**会删（那是按用户删）。用户不注销，这些行就永远留着 ——
     * 索引 `idx_idempotency_expires` 建好了却没有消费者。
     *
     * <p>为什么分两步（先查主键、再按主键删）而不是一句
     * {@code DELETE ... WHERE expires_at < ? LIMIT ?}：`DELETE ... LIMIT` 是 MySQL
     * 专有语法，H2 直接报语法错，而两种引擎都要能跑同一份代码。先 `SELECT` 主键
     * 再逐条删是两者的语法交集（批次上限由调用方给，语句数是常数级）。
     *
     * <p>条件里再带一次 `expires_at < ?`：从"查到"到"删掉"之间那一行可能被同 key
     * 的并发请求重新占用（那时它带着新的 `expires_at`），不能把活的删掉。
     */
    public int deleteExpired(LocalDateTime now, int limit) {
        if (limit <= 0) {
            return 0;
        }
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT user_id, operation, idempotency_key
                  FROM api_idempotency
                 WHERE expires_at < ?
                 ORDER BY expires_at
                 LIMIT ?
                """, now, limit);
        int deleted = 0;
        for (Map<String, Object> row : rows) {
            deleted += jdbc.update("""
                    DELETE FROM api_idempotency
                     WHERE user_id = ? AND operation = ? AND idempotency_key = ? AND expires_at < ?
                    """, row.get("user_id"), row.get("operation"), row.get("idempotency_key"), now);
        }
        return deleted;
    }

    /** 键的长度校验（超长会撞列宽；截断会让两个不同的键变成同一个）。 */
    public static void requireUsableKey(String key) {
        if (key == null) {
            return;
        }
        String trimmed = key.trim();
        if (trimmed.isEmpty()) {
            throw JungApiException.validation("Idempotency-Key 不能是空白字符串。");
        }
        if (trimmed.length() > MAX_KEY_LENGTH) {
            throw JungApiException.validation("Idempotency-Key 太长了（最多 " + MAX_KEY_LENGTH + " 个字符）。");
        }
    }

    /** 规范化：空白键按"没提供"处理（不要把它当成一个真实的键，否则所有空键会互相命中）。 */
    public static String normalizeKey(String key) {
        if (key == null) {
            return null;
        }
        String trimmed = key.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private Map<String, Object> find(String userId, String operation, String key) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT request_hash, response_ref, status, created_at, expires_at
                  FROM api_idempotency
                 WHERE user_id = ? AND operation = ? AND idempotency_key = ?
                """, userId, operation, key);
        return rows.isEmpty() ? null : rows.get(0);
    }
}
