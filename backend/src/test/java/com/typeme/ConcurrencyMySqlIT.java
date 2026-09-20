package com.typeme;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.account.repository.DeletionJobRepository;
import com.typeme.jung.api.JungDtos;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.service.AttemptService;
import com.typeme.jung.service.IdempotencyGuard;
import com.typeme.jung.service.ReportService;
import com.typeme.jung.service.TimeSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * **真实 MySQL 8.4 上的并发语义证据**：同一份测评的并发提交、同一个账号的并发注销。
 *
 * <p>为什么单开这个测试：这两条路径在 H2 上**永远不会红**。H2 的默认隔离级别是
 * READ_COMMITTED，而 MySQL 是 REPEATABLE READ —— 前者的普通一致性读总能看到对方
 * 刚提交的行，后者只能看到**本事务第一条 SELECT 时的快照**。差别正好落在
 * "唯一约束拦住重复插入之后，还要把那一行读回来"这条实现上：
 *
 * <pre>
 * 并发提交 A、B（同一 attempt）：
 *   A: 读 attempt（建立快照）
 *   B: 读 attempt（建立快照）
 *   A: INSERT report → COMMIT
 *   B: INSERT report → 撞 uk_report_attempt
 *   B: SELECT report WHERE id=?  → 快照里没有这一行 → 旧代码抛 404「这份报告」
 * </pre>
 *
 * 用户看到的是"提交成功了却被告知报告不存在"。修复是让这条分支改用当前读
 * （{@code SELECT ... FOR UPDATE}）。{@link #duplicateReportInsertIsInvisibleToPlainRead()}
 * 把这段时序**确定性地**摆出来（两个真实连接、按顺序执行，不靠碰运气），
 * {@link #concurrentSubmitAlwaysReturnsSameReport()} 再从服务对象入口验一遍结果。
 *
 * <p>注销那条同形：{@code account_deletion_job} 的 {@code uk_deletion_job_user}
 * 会让第二个并发申请撞唯一约束，而 {@code DuplicateKeyException} 一路上抛就是 500
 * —— 用户的注销申请其实已经被受理了。见 {@link #repeatedDeletionRequestReturnsExistingJob()}。
 *
 * <p><b>安全边界</b>（与另外两个 MySQL IT 完全一致）：只在 {@code 127.0.0.1:3306} 上创建
 * 形如 {@code typeme_concurrency_<随机>} 的**临时库**，跑完在 JVM 退出钩子里 DROP；
 * 不 {@code USE} 任何既有库、不对其它库执行任何语句；本机没有可连 MySQL 时整类跳过。
 *
 * <p><b>服务对象是手工装配的</b>：这里不起 Spring 上下文（那需要一个指向临时库的
 * {@code @DynamicPropertySource}，而临时库名在上下文启动前才生成）。事务边界由
 * {@link TransactionTemplate} 提供，与生产上 {@code @Transactional(REQUIRED)} 等价：
 * 整个 {@code submit} 跑在一个事务里，快照时机与生产一致。这一点是本测试成立的前提，
 * 写成自动提交就复现不出上面那段时序。
 */
class ConcurrencyMySqlIT {

    private static final String HOST = System.getProperty("typeme.test.mysql.host", "127.0.0.1");
    private static final String PORT = System.getProperty("typeme.test.mysql.port", "3306");
    private static final String USER = System.getProperty("typeme.test.mysql.user", "root");
    private static final String PASSWORD = System.getProperty("typeme.test.mysql.password", "123456");

    private static final String SERVER_URL =
            "jdbc:mysql://" + HOST + ":" + PORT + "/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC";

    private static final String DATABASE = "typeme_concurrency_" + Long.toHexString(System.nanoTime());

    /** 每个用例都跑几轮：并发窗口不需要靠运气，但多轮能让"真的撞上了"这件事更明显。 */
    private static final int ROUNDS = 6;

    private static DataSource dataSource;
    private static boolean mysqlAvailable;

    static {
        try {
            if (canConnect()) {
                createDatabase();
                DriverManagerDataSource ds = new DriverManagerDataSource(
                        "jdbc:mysql://" + HOST + ":" + PORT + "/" + DATABASE
                                + "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC"
                                + "&characterEncoding=UTF-8",
                        USER, PASSWORD);
                Flyway.configure()
                        .dataSource(ds)
                        .locations("classpath:db/migration")
                        .load()
                        .migrate();
                dataSource = ds;
                mysqlAvailable = true;
                Runtime.getRuntime().addShutdownHook(new Thread(ConcurrencyMySqlIT::dropDatabaseQuietly));
            }
        } catch (Exception ex) {
            // 环境缺失（没装 MySQL / 端口不通）不是"代码坏了"：整类跳过而不是红。
            mysqlAvailable = false;
            System.out.println("[ConcurrencyMySqlIT] 跳过真实 MySQL 并发验证：" + ex);
        }
    }

    @BeforeEach
    void requireMySql() {
        assumeTrue(mysqlAvailable, "本机 3306 没有可连的 MySQL，跳过真实并发验证");
    }

    /* ── ① 并发提交：报告行对普通一致性读不可见 ─────────────────────────────── */

    @Test
    @DisplayName("真实 MySQL：并发提交的第二路看不到对方刚提交的报告行（普通读 0 行 / 锁定读 1 行）")
    void duplicateReportInsertIsInvisibleToPlainRead() throws Exception {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        String userId = seedUser(jdbc);
        String attemptId = seedAttempt(jdbc, userId);
        String reportId = derivedReportId(attemptId);

        try (Connection first = dataSource.getConnection(); Connection second = dataSource.getConnection()) {
            first.setAutoCommit(false);
            first.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);

            // 1) 第一路建立快照：与 ReportService.submit 的第一条 SELECT（requireRow）同形
            assertEquals(1, countReport(first, "SELECT COUNT(*) FROM assessment_attempt WHERE id = ?", attemptId),
                    "确认事务已经建立起 REPEATABLE READ 快照");

            // 2) 第二路抢先插入报告并提交（与生产 INSERT 逐字段同形）
            second.setAutoCommit(false);
            insertReport(second, reportId, attemptId, userId);
            second.commit();

            // 3) 第一路插入 → 唯一约束；事务本身仍然可用（被回滚的只是这条语句）
            SQLException duplicate = null;
            try {
                insertReport(first, reportId, attemptId, userId);
            } catch (SQLException ex) {
                duplicate = ex;
            }
            assertNotNull(duplicate, "uk_report_attempt 必须真实存在（否则这条测试证明不了任何事）");
            assertThat(duplicate.getSQLState())
                    .as("重复键的 SQLState 应是 23xxx（完整性约束冲突）")
                    .startsWith("23");

            // 4) 旧代码走的就是这一步：普通一致性读 —— 看不到第二路刚提交的那一行
            assertEquals(0, countReport(first,
                            "SELECT COUNT(*) FROM assessment_report WHERE id = ? AND user_id = ?", reportId, userId),
                    "REPEATABLE READ 下普通读看不到并发事务刚提交的行 —— 这就是旧代码抛 404「这份报告」的原因。"
                            + "若这里返回 1，说明隔离级别不是 REPEATABLE READ，本测试失去意义");

            // 5) 修复后的分支：当前读看得到（也会等对方事务结束）
            assertEquals(1, countReport(first,
                            "SELECT COUNT(*) FROM assessment_report WHERE id = ? AND user_id = ? FOR UPDATE",
                            reportId, userId),
                    "锁定读必须能看到最新已提交版本，否则重复提交永远拿不到既有报告");

            first.rollback();
        }
    }

    @Test
    @DisplayName("真实 MySQL：同一个 attempt 的并发提交都拿到同一份报告，不出现 404/第二份报告")
    void concurrentSubmitAlwaysReturnsSameReport() throws Exception {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        String userId = seedUser(jdbc);
        ReportService reports = reports(jdbc);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        try {
            for (int round = 0; round < ROUNDS; round++) {
                String attemptId = seedAttempt(jdbc, userId);
                answerAllBase(jdbc, attemptId);

                CountDownLatch start = new CountDownLatch(1);
                List<Future<Object>> futures = new ArrayList<>();
                for (int i = 0; i < 2; i++) {
                    futures.add(pool.submit(submitTask(reports, userId, attemptId, start)));
                }
                start.countDown();

                List<Object> results = new ArrayList<>();
                for (Future<Object> future : futures) {
                    results.add(future.get(60, TimeUnit.SECONDS));
                }

                for (Object result : results) {
                    if (result instanceof Throwable failure) {
                        throw new AssertionError("并发提交出现异常（旧实现在这里抛 404「这份报告」）：" + failure, failure);
                    }
                }
                JungDtos.SubmitResponse first = assertInstanceOf(JungDtos.SubmitResponse.class, results.get(0));
                JungDtos.SubmitResponse second = assertInstanceOf(JungDtos.SubmitResponse.class, results.get(1));
                assertThat(first.reportId()).as("第 %d 轮：两次提交必须得到同一个 reportId", round).isNotNull();
                assertThat(second.reportId()).isEqualTo(first.reportId());

                assertEquals(1, jdbc.queryForObject(
                                "SELECT COUNT(*) FROM assessment_report WHERE attempt_id = ?", Integer.class, attemptId),
                        "第 " + round + " 轮：同一个 attempt 只能有一份报告");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    /* ── ⑤ 并发注销：第二个申请拿到同一份任务 ─────────────────────────────── */

    @Test
    @DisplayName("真实 MySQL：重复（含并发）注销申请只要一份任务，第二个拿到同一份而不是 500")
    void repeatedDeletionRequestReturnsExistingJob() throws Exception {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        DeletionJobRepository jobs = new DeletionJobRepository(jdbc);
        Instant now = Instant.now();

        // 1) 唯一约束确实存在：绕开仓储层直接插第二行必须失败
        String probeUser = UUID.randomUUID().toString();
        jobs.insertPendingOrGetExisting(DeletionJobRepository.newId(), probeUser, now);
        SQLException duplicate = null;
        try (Connection connection = dataSource.getConnection();
             PreparedStatement statement = connection.prepareStatement(
                     "INSERT INTO account_deletion_job (id, user_id, status, requested_at, attempt_count)"
                             + " VALUES (?, ?, 'PENDING', ?, 0)")) {
            statement.setString(1, DeletionJobRepository.newId());
            statement.setString(2, probeUser);
            statement.setTimestamp(3, Timestamp.from(now));
            statement.executeUpdate();
        } catch (SQLException ex) {
            duplicate = ex;
        }
        assertNotNull(duplicate, "uk_deletion_job_user 必须真实存在");
        assertThat(duplicate.getSQLState()).startsWith("23");

        // 2) 串行重复申请：同一份任务
        String userId = UUID.randomUUID().toString();
        String firstJob = jobs.insertPendingOrGetExisting(DeletionJobRepository.newId(), userId, now);
        String secondJob = jobs.insertPendingOrGetExisting(DeletionJobRepository.newId(), userId, now);
        assertThat(secondJob).as("串行重复申请必须返回同一份任务").isEqualTo(firstJob);
        assertEquals(1, jobCount(jdbc, userId));

        // 3) 并发申请：两个事务同时插入，同一份任务、一行记录
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < ROUNDS; round++) {
                String concurrentUser = UUID.randomUUID().toString();
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Object>> futures = new ArrayList<>();
                for (int i = 0; i < 2; i++) {
                    futures.add(pool.submit(() -> {
                        start.await();
                        try {
                            TransactionTemplate tx = new TransactionTemplate(
                                    new DataSourceTransactionManager(dataSource));
                            return tx.execute(status ->
                                    jobs.insertPendingOrGetExisting(
                                            DeletionJobRepository.newId(), concurrentUser, Instant.now()));
                        } catch (Exception ex) {
                            return ex;
                        }
                    }));
                }
                start.countDown();

                List<Object> results = new ArrayList<>();
                for (Future<Object> future : futures) {
                    results.add(future.get(60, TimeUnit.SECONDS));
                }
                for (Object result : results) {
                    if (result instanceof Throwable failure) {
                        throw new AssertionError(
                                "并发注销申请出现异常（旧实现会在这里抛 DuplicateKeyException → 500）："
                                        + failure, failure);
                    }
                }
                assertThat(results.get(1))
                        .as("第 %d 轮：两个并发申请必须得到同一份任务", round)
                        .isEqualTo(results.get(0));
                assertEquals(1, jobCount(jdbc, concurrentUser),
                        "第 " + round + " 轮：一个账号只能有一份注销任务");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    /* ── 装配与服务调用 ───────────────────────────────────────────────────── */

    private static Callable<Object> submitTask(
            ReportService reports, String userId, String attemptId, CountDownLatch start) {
        return () -> {
            start.await();
            try {
                TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
                return tx.execute(status -> reports.submit(
                        userId, attemptId, new JungDtos.SubmitRequest(null, true)));
            } catch (Exception ex) {
                return ex;
            }
        };
    }

    private static ReportService reports(JdbcTemplate jdbc) {
        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        TimeSource time = new TimeSource(jdbc);
        IdempotencyGuard guard = new IdempotencyGuard(jdbc, time);
        AttemptService attempts = new AttemptService(jdbc, loader, time, guard);
        return new ReportService(jdbc, loader, attempts, time, new ObjectMapper());
    }

    /* ── 种子数据 ─────────────────────────────────────────────────────────── */

    private static String seedUser(JdbcTemplate jdbc) {
        String userId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,"
                        + " status, created_at, password_changed_at, recovery_code_version, role)"
                        + " VALUES (?, ?, ?, 'x', NULL, 'ACTIVE', ?, ?, 0, 'USER')",
                userId, "concurrency_" + userId.substring(0, 8), "concurrency",
                Timestamp.from(now), Timestamp.from(now));
        return userId;
    }

    private static void seedPackage(JdbcTemplate jdbc) {
        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?", Integer.class,
                JungPackageLoader.CURRENT_PACKAGE_ID);
        if (existing != null && existing > 0) {
            return;
        }
        // 占位行的版本字段取自**加载器里的同一个包**，不写死旧版本号：
        // 默认包换代后写死会造出"package_id 是新的、scoring_version 是旧的"这种自相矛盾的行。
        JungPackage pkg = currentJungPackage();
        jdbc.update("INSERT INTO assessment_package (package_id, instrument_id, scoring_version,"
                        + " report_content_version, content_status, content_json, sha256, published_at)"
                        + " VALUES (?, ?, ?, ?, ?, '{\"questions\":[]}', REPEAT('a', 64), ?)",
                JungPackageLoader.CURRENT_PACKAGE_ID, "typeme-jung48",
                pkg.scoringVersion(), pkg.reportContentVersion(), "draft_review_pending",
                Timestamp.from(Instant.now()));
    }

    /** 当前默认内容包（每次现取，避免静态缓存到另一个版本的字段）。 */
    private static JungPackage currentJungPackage() {
        return new JungPackageLoader(new DefaultResourceLoader()).current();
    }

    private static String seedAttempt(JdbcTemplate jdbc, String userId) {
        seedPackage(jdbc);
        String attemptId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO assessment_attempt (id, user_id, package_id, status, revision,"
                        + " current_question_id, clarification_dimensions, clarification_skipped, base_attempt_id,"
                        + " started_at, updated_at, submitted_at)"
                        + " VALUES (?, ?, ?, 'BASE_IN_PROGRESS', 1, NULL, '', 0, NULL, ?, ?, NULL)",
                attemptId, userId, JungPackageLoader.CURRENT_PACKAGE_ID, Timestamp.from(now), Timestamp.from(now));
        return attemptId;
    }

    /** 把 48 道主测题全部答上（同一档），让覆盖率满足提交条件，报告才会真的落库。 */
    private static void answerAllBase(JdbcTemplate jdbc, String attemptId) {
        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        Instant now = Instant.now();
        int seeded = 0;
        for (JungItem item : loader.current().baseItems()) {
            jdbc.update("INSERT INTO assessment_answer (attempt_id, question_id, kind, rating, updated_at)"
                            + " VALUES (?, ?, 'RATING', 4, ?)",
                    attemptId, item.id(), Timestamp.from(now));
            seeded += 1;
        }
        assertThat(seeded).as("主测题数必须与契约一致（48）").isEqualTo(48);
    }

    /** 与生产同形的报告 id 派生方式（同一 attempt 天然得到同一个 id）。 */
    private static String derivedReportId(String attemptId) {
        try {
            byte[] digest = java.security.MessageDigest.getInstance("MD5")
                    .digest(("typeme-report:" + attemptId)
                            .getBytes(java.nio.charset.StandardCharsets.UTF_8));
            java.nio.ByteBuffer buffer = java.nio.ByteBuffer.wrap(digest);
            return new UUID(buffer.getLong(), buffer.getLong()).toString();
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    /* ── 裸 JDBC 语句（与生产 SQL 逐字段同形） ────────────────────────────── */

    private static void insertReport(Connection connection, String reportId, String attemptId, String userId)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code,"
                        + " score_json, report_json, report_hash, created_at)"
                        + " VALUES (?, ?, ?, 'REFERENCE', 'INTJ', '{}', '{}', REPEAT('a', 64), ?)")) {
            statement.setString(1, reportId);
            statement.setString(2, attemptId);
            statement.setString(3, userId);
            statement.setTimestamp(4, Timestamp.from(Instant.now()));
            statement.executeUpdate();
        }
    }

    private static int countReport(Connection connection, String sql, String... args) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < args.length; i++) {
                statement.setString(i + 1, args[i]);
            }
            try (ResultSet rs = statement.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private static int jobCount(JdbcTemplate jdbc, String userId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM account_deletion_job WHERE user_id = ?", Integer.class, userId);
        return count == null ? 0 : count;
    }

    /* ── 临时库（只碰自己建的这一个） ─────────────────────────────────────── */

    private static boolean canConnect() {
        try (Connection ignored = DriverManager.getConnection(SERVER_URL, USER, PASSWORD)) {
            return true;
        } catch (SQLException ex) {
            return false;
        }
    }

    private static void createDatabase() throws SQLException {
        try (Connection connection = DriverManager.getConnection(SERVER_URL, USER, PASSWORD);
             Statement statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE `" + DATABASE + "` CHARACTER SET utf8mb4");
        }
    }

    private static void dropDatabaseQuietly() {
        try (Connection connection = DriverManager.getConnection(SERVER_URL, USER, PASSWORD);
             Statement statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS `" + DATABASE + "`");
        } catch (SQLException ignored) {
            // 退出钩子里不再抛：清理失败不影响测试结论，库名带随机后缀也不会撞别人
        }
    }
}
