package com.typeme.ai.service;

import com.typeme.ai.config.AiClock;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * **真实 MySQL 8.4 的方言证据**（契约 02 通用约束、开发方案 §10.1：H2 不能代替最终 MySQL 证据）。
 *
 * <p>这类测试只在"本机 3306 有可连的 MySQL"时才跑（{@link Assumptions}）：
 * 无 MySQL 的 CI 上会跳过而不是失败，避免把"环境缺失"伪装成"代码坏了"。
 *
 * <p>安全边界（用户机器上有 13 个业务库，必须绝对不碰）：
 * <ul>
 *   <li>只连 {@code jdbc:mysql://127.0.0.1:3306/}（**不带库名**）；</li>
 *   <li>只创建/删除形如 {@code typeme_sqldialect_<随机>} 的临时库；</li>
 *   <li>只在这个临时库里跑迁移与语句，跑完在 finally 里 DROP；</li>
 *   <li>绝不指定其它库名、绝不对其它库执行任何语句。</li>
 * </ul>
 */
class AiSqlDialectMySqlIT {

    private static final String HOST = System.getProperty("typeme.test.mysql.host", "127.0.0.1");
    private static final String PORT = System.getProperty("typeme.test.mysql.port", "3306");
    private static final String USER = System.getProperty("typeme.test.mysql.user", "root");
    private static final String PASSWORD = System.getProperty("typeme.test.mysql.password", "123456");

    private static final String SERVER_URL =
            "jdbc:mysql://" + HOST + ":" + PORT + "/?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC";

    private static final String USER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String REPORT_ID = "33333333-3333-3333-3333-333333333333";
    private static final Instant NOW = Instant.parse("2026-09-16T10:00:00Z");

    @Test
    @DisplayName("MySQL 8.4：V1–V4 迁移、额度 upsert、原子认领/写回/lease 恢复都能执行")
    void migrationsAndAtomicStatementsRunOnRealMySql() throws Exception {
        Assumptions.assumeTrue(canConnect(), "本机没有可连的 MySQL，跳过真实方言验证");
        String database = "typeme_sqldialect_" + Long.toHexString(System.nanoTime());
        try {
            createDatabase(database);
            DataSource dataSource = new DriverManagerDataSource(
                    // characterEncoding 必须是 **Java 字符集名**（UTF-8），不是 MySQL 的 utf8mb4：
                    // Connector/J 会把 UTF-8 映射到 utf8mb4，而写 utf8mb4 会直接抛
                    // "Unsupported character encoding 'utf8mb4'"（application.yml 里同样的写法需要注意）。
                    "jdbc:mysql://" + HOST + ":" + PORT + "/" + database
                            + "?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8",
                    USER, PASSWORD);

            // 1) 同一批迁移脚本在真实 MySQL 上必须能跑完（含 V4 的 DEFAULT / 外键 / 唯一键）。
            Flyway.configure()
                    .dataSource(dataSource)
                    .locations("classpath:db/migration")
                    .load()
                    .migrate();

            JdbcTemplate jdbc = new JdbcTemplate(dataSource);
            seed(jdbc);
            AiClock clock = AiClock.fixedAt(NOW);

            // 2) 额度原子 upsert：两次预留后必须是 2（MySQL 走 ON DUPLICATE KEY，H2 走 MERGE）。
            AiBudgetRepository budgets = new AiBudgetRepository(jdbc, clock);
            budgets.reserve("user:" + USER_ID, clock.now());
            budgets.reserve("user:" + USER_ID, clock.now());
            Integer reserved = jdbc.queryForObject(
                    "SELECT reserved_calls FROM ai_usage_budget WHERE scope_key = ?",
                    Integer.class, "user:" + USER_ID);
            assertEquals(2, reserved, "真实 MySQL 上两次预留必须累加到 2");

            // 3) 插入 + 原子认领 + 写 requested_at + 写回成功。
            AnalysisJobRepository jobs = new AnalysisJobRepository(jdbc, clock);
            jobs.insert(newJob("22222222-2222-2222-2222-222222222222", "it-key", "a"));
            assertTrue(jobs.claim("22222222-2222-2222-2222-222222222222", "it-worker",
                    clock.now().plusSeconds(120)), "首次认领必须成功");
            assertTrue(jobs.markRequested("22222222-2222-2222-2222-222222222222", "it-worker", clock.now()),
                    "写 requested_at 必须成功");
            assertTrue(jobs.markSucceeded("22222222-2222-2222-2222-222222222222",
                    "it-worker",
                    "{\"schemaVersion\":\"1\"}", "{\"promptTokens\":1}", "deepseek-flash", clock.now()),
                    "写回结果必须成功");
            assertEquals("SUCCEEDED", jobs.findById("22222222-2222-2222-2222-222222222222")
                    .orElseThrow().status());

            // 4) lease 恢复：requested_at 非空 → UNKNOWN（绝不自动重发）。
            jobs.insert(newJob("44444444-4444-4444-4444-444444444444", "it-key-2", "b"));
            assertTrue(jobs.claim("44444444-4444-4444-4444-444444444444", "it-worker",
                    clock.now().minusSeconds(600)));
            assertTrue(jobs.markRequested("44444444-4444-4444-4444-444444444444", "it-worker", clock.now().minusSeconds(610)));
            assertEquals(1, jobs.markExpiredAsUnknown(clock.now()), "过期且已发出的 lease 必须转 UNKNOWN");
            assertEquals("UNKNOWN", jobs.findById("44444444-4444-4444-4444-444444444444")
                    .orElseThrow().status());

            // 5) 删报告 → 任务被外键级联带走（ON DELETE CASCADE 在真实 MySQL 上生效）。
            jdbc.update("DELETE FROM assessment_report WHERE id = ?", REPORT_ID);
            Integer remaining = jdbc.queryForObject("SELECT COUNT(*) FROM ai_analysis_job", Integer.class);
            assertEquals(0, remaining, "删报告必须级联删除其 AI 任务");
        } finally {
            dropDatabaseQuietly(database);
        }
    }

    private static AnalysisJobRepository.JobRow newJob(String id, String key, String hashSeed) {
        return new AnalysisJobRepository.JobRow(
                id, USER_ID, REPORT_ID, key, hashSeed.repeat(64), "typeme-ai-prompt-v1", "overall",
                "deepseek-flash", null, "QUEUED", 0, null, null, null,
                null, null, null, null, AiClock.toUtc(NOW), null);
    }

    /** 最小种子数据：一个用户、一个内容包、一个 attempt、一份报告。逐条执行（不依赖 allowMultiQueries）。 */
    private static void seed(JdbcTemplate jdbc) {
        jdbc.execute("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, created_at, password_changed_at, recovery_code_version)
                VALUES ('11111111-1111-1111-1111-111111111111', 'it_user', 'it_user', 'x', NULL,
                        'ACTIVE', '2026-09-16 10:00:00.000000', '2026-09-16 10:00:00.000000', 0)
                """);
        jdbc.execute("""
                INSERT INTO assessment_package (package_id, instrument_id, scoring_version, report_content_version,
                                                content_status, content_json, sha256, published_at)
                VALUES ('typeme-jung48-zh-v1', 'typeme-jung48', 'typeme-jung48-score-v1',
                        'typeme-type-report-zh-v1', 'draft_review_pending', '{"questions":[]}', REPEAT('a', 64),
                        '2026-09-16 10:00:00.000000')
                """);
        jdbc.execute("""
                INSERT INTO assessment_attempt (id, user_id, package_id, status, revision, current_question_id,
                                                clarification_dimensions, clarification_skipped, base_attempt_id,
                                                started_at, updated_at, submitted_at)
                VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111',
                        'typeme-jung48-zh-v1', 'SUBMITTED', 5, NULL, '', 0, NULL,
                        '2026-09-16 10:00:00.000000', '2026-09-16 10:00:00.000000',
                        '2026-09-16 10:00:00.000000')
                """);
        jdbc.execute("""
                INSERT INTO assessment_report (id, attempt_id, user_id, status, computed_type_code, score_json,
                                               report_json, report_hash, created_at)
                VALUES ('33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555',
                        '11111111-1111-1111-1111-111111111111', 'REFERENCE', 'ENFP', '{}', '{}',
                        REPEAT('b', 64), '2026-09-16 10:00:00.000000')
                """);
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
        try (Connection connection = DriverManager.getConnection(SERVER_URL, USER, PASSWORD);
             Statement statement = connection.createStatement()) {
            statement.execute("DROP DATABASE IF EXISTS " + database);
        } catch (Exception ignored) {
            // 清理失败不应让测试变红；临时库名前缀固定，人工可识别后手删。
        }
    }
}
