package com.typeme.account;

import com.typeme.account.service.TypemeProperties;
import com.typeme.security.RateLimitService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 在**真实 MySQL 8.4** 上验证账号与限流那几条"此前只在 H2 上跑过"的 SQL 路径。
 *
 * <p>为什么单开这个测试：账号模块的集成测试跑在 H2 的 {@code MODE=MySQL} 上
 * （那是为了证明迁移脚本在两种引擎下都能执行）。但 H2 的兼容模式是**模拟**，
 * 有三条路径的真实行为值得单独确认，因为它们出错的形态都是"静默算错"而不是报错：
 *
 * <ol>
 *   <li><b>恢复码的原子消费</b>：靠 {@code UPDATE ... WHERE used_at IS NULL}
 *       的**受影响行数**判断"这次有没有抢到"。若 MySQL 在这条语句上返回的行数
 *       与预期不同，要么同一个恢复码能被用两次（安全问题），
 *       要么合法恢复永远失败。H2 上的行为不足以说明 MySQL 上的行为。</li>
 *   <li><b>限流的"先 UPDATE 再 INSERT"</b>：并发首次插入时靠捕获主键冲突重试。
 *       两个引擎的冲突都映射成 Spring 的 {@code DuplicateKeyException}，
 *       但映射是否真的成立、并发下会不会丢计数，要实测。</li>
 *   <li><b>枚举列 CHECK 的大小写敏感性</b>：迁移脚本给若干净枚举列钉了
 *       {@code COLLATE utf8mb4_0900_as_cs}，否则库默认的大小写不敏感排序规则
 *       会让 {@code status='active'} 这类非法值溜进去。这条在 H2 上永远成立
 *       （H2 默认就区分大小写），所以**只有真实 MySQL 能验证它**。</li>
 * </ol>
 *
 * <p><b>安全边界</b>：只在 {@code 127.0.0.1:3306} 上创建形如
 * {@code typeme_accountdialect_<随机>} 的**临时库**，跑完在 finally 里 DROP。
 * 不碰任何既有库；不执行 {@code USE}（连接串里直接带库名）。
 * 本机没有可连的 MySQL 时整类跳过并说明原因。
 */
class AccountSqlDialectMySqlIT {

    private static final String HOST = System.getProperty("typeme.test.mysql.host", "127.0.0.1");
    private static final String PORT = System.getProperty("typeme.test.mysql.port", "3306");
    private static final String USER = System.getProperty("typeme.test.mysql.user", "root");
    private static final String PASSWORD = System.getProperty("typeme.test.mysql.password", "123456");

    /**
     * 连服务器但**不带库名**：这样才能 CREATE/DROP 临时库。
     *
     * <p>必须用 {@code 127.0.0.1} 而不是 {@code localhost}：本机的 {@code localhost}
     * 会解析到局域网的 {@code 172.17.178.x}，而 MySQL 里只建了 {@code root@localhost}，
     * 于是会报 {@code Access denied for user 'root'@'172.17.178.146'}。
     */
    private static final String SERVER_URL =
            "jdbc:mysql://" + HOST + ":" + PORT + "/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC";

    private static final String USER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String ATTEMPT_ID = "55555555-5555-5555-5555-555555555555";
    private static final Instant NOW = Instant.parse("2026-09-16T10:00:00Z");

    /** 恢复码消费语句：与 {@code RecoveryCodeRepository.consume} 逐字同形。 */
    private static final String CONSUME_SQL = "UPDATE account_recovery_code SET used_at = ? "
            + "WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL";

    /** role 作为最后一个占位符，方便测试传入不同大小写来验证 COLLATE。 */
    private static final String INSERT_USER_SQL = "INSERT INTO app_user "
            + "(id, username_normalized, username_display, password_hash, nickname, status, created_at,"
            + " password_changed_at, recovery_code_version, role) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, ?)";

    private static final String INSERT_CODE_SQL = "INSERT INTO account_recovery_code "
            + "(id, user_id, code_hash, code_index, used_at, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL, ?, NULL)";

    /** 建临时库 → 跑迁移 → 交给测试体 → 无论成败都 DROP。 */
    private void withTempDatabase(Consumer<JdbcTemplate> body) throws Exception {
        assumeTrue(canConnect(), "本机 3306 没有可连的 MySQL，跳过真实方言验证");
        String database = "typeme_accountdialect_" + Long.toHexString(System.nanoTime());
        try {
            createDatabase(database);
            DataSource dataSource = new DriverManagerDataSource(
                    // characterEncoding 是 **Java 字符集名**：写 utf8mb4 会让 Connector/J 直接抛
                    // UnsupportedEncodingException（application.yml 踩过同样的坑）。
                    "jdbc:mysql://" + HOST + ":" + PORT + "/" + database
                            + "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8",
                    USER, PASSWORD);
            Flyway.configure()
                    .dataSource(dataSource)
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();
            body.accept(new JdbcTemplate(dataSource));
        } finally {
            dropDatabaseQuietly(database);
        }
    }

    private static void seedUser(JdbcTemplate jdbc) {
        jdbc.update(INSERT_USER_SQL,
                USER_ID, "it_user", "it_user", "x", "ACTIVE",
                Timestamp.from(NOW), Timestamp.from(NOW), "USER");
    }

    /** 最小内容包种子：assessment_attempt.package_id 有外键，必须先有这个包。 */
    private static void insertPackage(JdbcTemplate jdbc) {
        jdbc.update("INSERT INTO assessment_package (package_id, instrument_id, scoring_version,"
                        + " report_content_version, content_status, content_json, sha256, published_at)"
                        + " VALUES (?, ?, ?, ?, ?, '{\"questions\":[]}', REPEAT('a', 64), ?)",
                "typeme-jung48-zh-v1", "typeme-jung48", "typeme-jung48-score-v1",
                "typeme-type-report-zh-v1", "draft_review_pending", Timestamp.from(NOW));
    }

    /** 最小 attempt 种子，供作答/报告相关的约束验证使用。 */
    private static void insertAttempt(JdbcTemplate jdbc) {
        jdbc.update("INSERT INTO assessment_attempt (id, user_id, package_id, status, revision,"
                        + " current_question_id, clarification_dimensions, clarification_skipped, base_attempt_id,"
                        + " started_at, updated_at, submitted_at)"
                        + " VALUES (?, ?, ?, 'DRAFT', 1, NULL, '', 0, NULL, ?, ?, NULL)",
                ATTEMPT_ID, USER_ID, "typeme-jung48-zh-v1", Timestamp.from(NOW), Timestamp.from(NOW));
    }

    /** 只改登录限流上限，其余用默认值（record 的紧凑构造器会补默认）。 */
    private static RateLimitService rateLimitWithLoginIpLimit(JdbcTemplate jdbc, int ipLimit) {
        // 全传 null → TypemeProperties 的紧凑构造器把五个子配置都补成安全默认值。
        // 这样测试只表达"我改了什么"，不会因为将来新增一个默认值而跟着过期。
        TypemeProperties.RateLimit original = new TypemeProperties(null, null, null, null, null).ratelimit();
        TypemeProperties.RateLimit tuned = new TypemeProperties.RateLimit(
                original.enabled(),
                original.register(),
                new TypemeProperties.Login(Duration.ofMinutes(15), ipLimit, 10),
                original.recover(),
                original.ai(),
                original.catalog());
        return new RateLimitService(jdbc, new TypemeProperties(null, tuned, null, null, null));
    }

    @Test
    @DisplayName("真实 MySQL：恢复码原子消费靠受影响行数，并发下只有一个请求能抢到")
    void recoveryCodeConsumeIsAtomicOnRealMySql() throws Exception {
        withTempDatabase(jdbc -> {
            seedUser(jdbc);
            String codeId = "aaaaaaaa-0000-0000-0000-000000000001";
            jdbc.update(INSERT_CODE_SQL, codeId, USER_ID, "$2a$placeholder", 0, Timestamp.from(NOW));

            int first = jdbc.update(CONSUME_SQL, Timestamp.from(NOW), codeId);
            assertEquals(1, first,
                    "首次消费必须返回 1。若 MySQL 返回 0（例如把「写入了相同值」也当作未变更），"
                            + "合法的密码找回会永远失败");

            int second = jdbc.update(CONSUME_SQL, Timestamp.from(NOW.plusSeconds(1)), codeId);
            assertEquals(0, second,
                    "同一个恢复码第二次消费必须返回 0。若返回 1，说明一个码能被用两次 —— 这是安全问题");

            Timestamp usedAt = jdbc.queryForObject(
                    "SELECT used_at FROM account_recovery_code WHERE id = ?", Timestamp.class, codeId);
            assertThat(usedAt).as("used_at 必须被真正写入").isNotNull();

            // 并发抢码：重置后让 8 个线程同时消费同一个码，必须恰好 1 个成功
            jdbc.update("UPDATE account_recovery_code SET used_at = NULL WHERE id = ?", codeId);
            int succeeded = runConcurrentlyAndSum(8, () -> jdbc.update(CONSUME_SQL, Timestamp.from(NOW), codeId));

            assertEquals(1, succeeded,
                    "8 个并发请求抢同一个恢复码必须**恰好** 1 个拿到，实际 " + succeeded
                            + " 个。大于 1 说明存在竞态，恢复码可被重复使用");
        });
    }

    @Test
    @DisplayName("真实 MySQL：限流计数累加正确，并发首次插入不丢计数，超限被拒")
    void rateLimitCountingIsCorrectOnRealMySql() throws Exception {
        withTempDatabase(jdbc -> {
            seedUser(jdbc);

            // ── 限额内累加 ────────────────────────────────────────────
            String ip = "203.0.113.9";
            RateLimitService limited = rateLimitWithLoginIpLimit(jdbc, 4);
            for (int i = 0; i < 4; i += 1) {
                limited.checkLoginIp(ip);
            }
            Integer counter = jdbc.queryForObject(
                    "SELECT counter FROM rate_limit_bucket WHERE bucket_key LIKE ?",
                    Integer.class, "%:ip:" + ip + ":%");
            assertEquals(4, counter, "4 次请求后计数必须是 4");

            // ── 超限被拒 ────────────────────────────────────────────
            boolean rejected = false;
            try {
                limited.checkLoginIp(ip);
            } catch (RuntimeException ex) {
                rejected = true;
            }
            assertTrue(rejected, "超过限额的第 5 次必须被拒。若未拒绝，限流没有生效");

            // ── 并发首次插入不丢计数 ──────────────────────────────────
            // 这条最关键：并发首次插入时两个请求都 UPDATE 到 0 行、都去 INSERT、
            // 一方撞主键。若冲突没有按预期被捕获重试，计数就会小于实际请求数 ——
            // 而"少记几次"正好是限流被绕过的方式。
            String freshIp = "203.0.113.77";
            int threads = 8;
            RateLimitService generous = rateLimitWithLoginIpLimit(jdbc, 10_000);
            runConcurrentlyAndSum(threads, () -> {
                generous.checkLoginIp(freshIp);
                return 1;
            });

            Integer concurrentCounter = jdbc.queryForObject(
                    "SELECT counter FROM rate_limit_bucket WHERE bucket_key LIKE ?",
                    Integer.class, "%:ip:" + freshIp + ":%");
            assertEquals(threads, concurrentCounter,
                    "8 个并发请求后计数必须是 8，实际 " + concurrentCounter
                            + "。小于 8 说明并发首次插入时发生了丢失更新，限流会被轻易绕过");
        });
    }

    @Test
    @DisplayName("真实 MySQL：非法枚举值被 CHECK 拦下，且大小写敏感 COLLATE 确实生效")
    void enumCheckConstraintsAreCaseSensitiveOnRealMySql() throws Exception {
        withTempDatabase(jdbc -> {
            seedUser(jdbc);

            // 库默认排序规则 utf8mb4_0900_ai_ci 是**大小写不敏感**的。
            // 白名单 CHECK（如 role IN ('USER','ADMIN')）在那种排序规则下会放行 'user'。
            // 迁移脚本给这些列钉了 COLLATE utf8mb4_0900_as_cs 来恢复大小写敏感。
            //
            // 这条测试**只在真实 MySQL 上有意义**：H2 默认就区分大小写，
            // 所以在 H2 上"被拒"完全推不出"MySQL 上也被拒" ——
            // 本轮正是在真实 MySQL 上才发现修复前这些值全部能插进去。

            // （1）role：写小写 'user' 必须被拒
            assertRejected(jdbc,
                    () -> jdbc.update(INSERT_USER_SQL, "22222222-2222-2222-2222-222222222222",
                            "it2", "it2", "x", "ACTIVE", Timestamp.from(NOW), Timestamp.from(NOW),
                            "user"),
                    "app_user.role 写成小写 'user' 必须被拒。若被接受，说明该列的"
                            + " COLLATE utf8mb4_0900_as_cs 丢了，白名单 CHECK 被放大成大小写不敏感");
            // 同样这份数据写大写必须成功（对照组：证明被拒的是大小写，不是别的约束）
            jdbc.update(INSERT_USER_SQL, "22222222-2222-2222-2222-222222222223",
                    "it2", "it2", "x", "ACTIVE", Timestamp.from(NOW), Timestamp.from(NOW), "USER");

            // （2）assessment_answer.kind：小写 'rating' 必须被拒
            insertPackage(jdbc);
            insertAttempt(jdbc);
            assertRejected(jdbc,
                    () -> jdbc.update("INSERT INTO assessment_answer (attempt_id, question_id, kind, rating,"
                                    + " updated_at) VALUES (?, ?, ?, 4, ?)",
                            ATTEMPT_ID, "EI-01", "rating", Timestamp.from(NOW)),
                    "assessment_answer.kind 写成小写 'rating' 必须被拒");
            jdbc.update("INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)"
                            + " VALUES (?, ?, 'RATING', 4, ?)",
                    ATTEMPT_ID, "EI-01", Timestamp.from(NOW));

            // （3）ck_answer_rating：kind='RATING' 但 rating IS NULL 必须被拒。
            //     这条靠 CHECK 里的 `rating IS NOT NULL`。若少了它，MySQL 会因为
            //     "CHECK 结果为 NULL/UNKNOWN 时视为通过"而放行这种自相矛盾的行。
            assertRejected(jdbc,
                    () -> jdbc.update("INSERT INTO assessment_answer (attempt_id, question_id, kind, rating,"
                                    + " updated_at) VALUES (?, ?, 'RATING', NULL, ?)",
                            ATTEMPT_ID, "EI-02", Timestamp.from(NOW)),
                    "kind='RATING' 且 rating IS NULL 必须被拒。若被接受，说明"
                            + " ck_answer_rating 里缺了 rating IS NOT NULL（MySQL 对 UNKNOWN 的 CHECK 放行）");

            // （4）ck_answer_rating：kind='UNKNOWN' 且 rating 有值也必须被拒（反方向）
            assertRejected(jdbc,
                    () -> jdbc.update("INSERT INTO assessment_answer (attempt_id, question_id, kind, rating,"
                                    + " updated_at) VALUES (?, ?, 'UNKNOWN', 3, ?)",
                            ATTEMPT_ID, "EI-03", Timestamp.from(NOW)),
                    "kind='UNKNOWN' 且 rating 有值必须被拒：这两种状态不能同时有值");

            // （5）报告类型码：小写 'enfp' 必须被拒（正则白名单 + as_cs）
            assertRejected(jdbc,
                    () -> jdbc.update("INSERT INTO assessment_report (id, attempt_id, user_id, status,"
                                    + " computed_type_code, score_json, report_json, report_hash, created_at)"
                                    + " VALUES (?, ?, ?, 'REFERENCE', 'enfp', '{}', '{}', ?, ?)",
                            "33333333-3333-3333-3333-333333333333", ATTEMPT_ID, USER_ID,
                            "b".repeat(64), Timestamp.from(NOW)),
                    "computed_type_code 写成小写 'enfp' 必须被拒（类型码白名单区分大小写）");
            // 合法大写必须成功
            jdbc.update("INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code,"
                            + " score_json, report_json, report_hash, created_at)"
                            + " VALUES (?, ?, ?, 'REFERENCE', 'ENFP', '{}', '{}', ?, ?)",
                    "33333333-3333-3333-3333-333333333334", ATTEMPT_ID, USER_ID,
                    "b".repeat(64), Timestamp.from(NOW));
        });
    }

    @Test
    @DisplayName("真实 MySQL：报告哈希唯一约束生效，同一 attempt 不会落两份报告")
    void reportUniquenessHoldsOnRealMySql() throws Exception {
        withTempDatabase(jdbc -> {
            seedUser(jdbc);
            jdbc.update("INSERT INTO assessment_package (package_id, instrument_id, scoring_version,"
                            + " report_content_version, content_status, content_json, sha256, published_at)"
                            + " VALUES (?, ?, ?, ?, ?, ?, REPEAT('a', 64), ?)",
                    "typeme-jung48-zh-v1", "typeme-jung48", "typeme-jung48-score-v1",
                    "typeme-type-report-zh-v1", "draft_review_pending", "{\"questions\":[]}",
                    Timestamp.from(NOW));
            jdbc.update("INSERT INTO assessment_attempt (id, user_id, package_id, status, revision,"
                            + " current_question_id, clarification_dimensions, clarification_skipped, base_attempt_id,"
                            + " started_at, updated_at, submitted_at)"
                            + " VALUES (?, ?, ?, 'SUBMITTED', 5, NULL, '', 0, NULL, ?, ?, ?)",
                    "55555555-5555-5555-5555-555555555555", USER_ID, "typeme-jung48-zh-v1",
                    Timestamp.from(NOW), Timestamp.from(NOW), Timestamp.from(NOW));

            String insertReport = "INSERT INTO assessment_report (id, attempt_id, user_id, status,"
                    + " computed_type_code, score_json, report_json, report_hash, created_at)"
                    + " VALUES (?, ?, ?, 'REFERENCE', 'ENFP', '{}', '{}', ?, ?)";
            jdbc.update(insertReport, "33333333-3333-3333-3333-333333333333",
                    "55555555-5555-5555-5555-555555555555", USER_ID, "b".repeat(64), Timestamp.from(NOW));

            // 同一 attempt 再插一份必须被唯一约束拦下 —— 这是"重复提交返回既有报告"的兜底依据。
            assertRejected(jdbc,
                    () -> jdbc.update(insertReport, "44444444-4444-4444-4444-444444444444",
                            "55555555-5555-5555-5555-555555555555", USER_ID, "c".repeat(64), Timestamp.from(NOW)),
                    "同一 attempt 插入第二份报告必须被唯一约束拒绝。若被接受，"
                            + "重复提交会产生两份报告，而前端只显示一份 —— 用户会看到结果前后不一致");
        });
    }

    /* ── 辅助 ─────────────────────────────────────────────────────── */

    /**
     * 并发跑 {@code threads} 次同一个任务并把返回值求和。
     *
     * <p>内部把受检异常包成 {@code RuntimeException} 再抛出：这几处调用点都在
     * {@link #withTempDatabase} 的 {@code Consumer} 里，而 {@code Consumer} 不能抛受检异常。
     * 包成非受检是为了让"并发逻辑本身的失败"照样把测试打红，而不是被静默吞掉。
     */
    private static int runConcurrentlyAndSum(int threads, Callable<Integer> task) {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<Integer>> futures = new ArrayList<>();
            for (int i = 0; i < threads; i += 1) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            int total = 0;
            for (Future<Integer> future : futures) {
                total += future.get(60, TimeUnit.SECONDS);
            }
            return total;
        } catch (Exception ex) {
            throw new IllegalStateException("并发执行失败", ex);
        } finally {
            pool.shutdownNow();
        }
    }

    /** 断言这个操作会被数据库拒绝（约束违反）。若它成功了，测试失败并带上原因。 */
    private static void assertRejected(JdbcTemplate jdbc, Runnable action, String message) {
        try {
            action.run();
            fail(message + "，但数据库接受了它");
        } catch (DataAccessException expected) {
            // 期望中的拒绝
        }
    }

    private static boolean canConnect() {
        try (Connection ignored = DriverManager.getConnection(SERVER_URL, USER, PASSWORD)) {
            return true;
        } catch (Exception ex) {
            return false;
        }
    }

    private static void createDatabase(String database) throws Exception {
        try (Connection connection = DriverManager.getConnection(SERVER_URL, USER, PASSWORD);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + database
                    + " CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci");
        }
    }

    private static void dropDatabaseQuietly(String database) {
        if (Boolean.getBoolean("typeme.test.mysql.retainDatabase")) {
            System.out.println("[AccountSqlDialectMySqlIT] retained isolated database: " + database);
            return;
        }
        try (Connection connection = DriverManager.getConnection(SERVER_URL, USER, PASSWORD);
             Statement statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + database);
        } catch (Exception ignored) {
            // 清理失败不应让测试变红；临时库名前缀固定，人工可识别后手删。
        }
    }
}
