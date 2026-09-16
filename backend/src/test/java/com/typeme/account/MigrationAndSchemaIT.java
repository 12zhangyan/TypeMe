package com.typeme.account;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Flyway 迁移与数据库兼容性（任务书测试清单的"迁移必须两种引擎都能跑"）。
 *
 * <p>本类跑在 H2 的 MySQL 兼容模式下，而迁移脚本本身是为 MySQL 8.4 写的。
 * 它能过，说明脚本没有用 H2 不支持的 MySQL 专有语法（{@code ENGINE=}、{@code COMMENT=}、
 * {@code ON UPDATE CURRENT_TIMESTAMP}、{@code REGEXP} 等）。
 *
 * <p>同时这里钉住两件容易悄悄坏掉的事：
 * <ol>
 *   <li>迁移里**没有** {@code CREATE DATABASE}/{@code USE}/{@code DROP DATABASE}：
 *       用户的 3306 实例上还有十几个业务库，一条跨库语句就可能造成不可逆的破坏。
 *       这条用"读迁移文件内容"来断言，因为运行时看不出"没写"。</li>
 *   <li>限流表用的 upsert 写法在两种引擎下都要成立（这里做一次真实 upsert 验证）。</li>
 * </ol>
 */
class MigrationAndSchemaIT extends AccountIntegrationTestBase {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("V1–V6 建出的表都在：账号/会话/恢复码/内容包/attempt/报告/AI/幂等/限流/后台设置")
    void allExpectedTablesExist() {
        List<String> tables = jdbc.queryForList(
                "SELECT LOWER(TABLE_NAME) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'PUBLIC' OR TABLE_SCHEMA = 'public'",
                String.class);
        // 大小写与 schema 名在不同引擎下不同，这里退化成"逐个表名探测"更稳。
        for (String table : new String[]{
                "app_user", "account_recovery_code", "app_user_session",
                "assessment_package", "assessment_attempt", "assessment_answer",
                "assessment_report", "report_self_reflection",
                "ai_analysis_job", "ai_consent", "ai_usage_budget",
                "api_idempotency", "account_deletion_job", "rate_limit_bucket",
                "typeme_ai_setting"}) {
            assertThat(tableExists(table)).as("迁移应建出表 %s", table).isTrue();
        }
        assertThat(tables).isNotNull();
    }

    @Test
    @DisplayName("app_user 有 role 列且默认 USER；CHECK 约束挡住非法角色")
    void appUserHasRoleColumnWithCheck() {
        List<Map<String, Object>> columns = jdbc.queryForList(
                "SELECT COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS "
                        + "WHERE LOWER(TABLE_NAME) = 'app_user' AND LOWER(COLUMN_NAME) = 'role'");
        assertThat(columns).hasSize(1);
        assertThat(String.valueOf(columns.get(0).get("COLUMN_DEFAULT"))).containsIgnoringCase("USER");

        String id = com.typeme.account.repository.UserRepository.newId();
        assertThatCode(() -> jdbc.update("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, role, created_at, password_changed_at, recovery_code_version)
                VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, ?, 0)
                """, id, "rolecheck_" + id, "rolecheck", "x", "USER",
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now())))
                .doesNotThrowAnyException();

        // 非法角色必须被数据库拒绝（应用层算错也写不进去）
        String otherId = com.typeme.account.repository.UserRepository.newId();
        assertThatCode(() -> jdbc.update("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, role, created_at, password_changed_at, recovery_code_version)
                VALUES (?, ?, ?, ?, NULL, 'ACTIVE', ?, ?, ?, 0)
                """, otherId, "rolecheck2_" + otherId, "rolecheck2", "x", "SUPERUSER",
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now())))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("限流桶的地址：先 UPDATE 后 INSERT 的自增路径在 H2(MODE=MySQL) 上语义正确")
    void rateLimitUpsertWorksOnH2() {
        String key = "test:upsert:" + System.nanoTime();
        // 模拟 RateLimitService.incrementAndRead 的两条路径
        int updated = jdbc.update("UPDATE rate_limit_bucket SET counter = counter + 1, revision = revision + 1 "
                + "WHERE bucket_key = ?", key);
        assertThat(updated).isZero();
        jdbc.update("INSERT INTO rate_limit_bucket (bucket_key, window_start, counter, revision) VALUES (?, ?, 1, 0)",
                key, Timestamp.from(Instant.now()));
        jdbc.update("UPDATE rate_limit_bucket SET counter = counter + 1, revision = revision + 1 WHERE bucket_key = ?",
                key);
        Integer counter = jdbc.queryForObject(
                "SELECT counter FROM rate_limit_bucket WHERE bucket_key = ?", Integer.class, key);
        assertThat(counter).isEqualTo(2);

        // 重复插入同一 key 必须抛 DuplicateKeyException（RateLimitService 靠它做并发重试）
        assertThatCode(() -> jdbc.update(
                "INSERT INTO rate_limit_bucket (bucket_key, window_start, counter, revision) VALUES (?, ?, 1, 0)",
                key, Timestamp.from(Instant.now())))
                .isInstanceOf(DuplicateKeyException.class);
    }

    @Test
    @DisplayName("会话账本保存绝对期限；恢复码消费是原子的（受影响行数 0 或 1）")
    void sessionAndRecoveryCodeSemantics() {
        String userId = com.typeme.account.repository.UserRepository.newId();
        jdbc.update("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, role, created_at, password_changed_at, recovery_code_version)
                VALUES (?, ?, ?, ?, NULL, 'ACTIVE', 'USER', ?, ?, 0)
                """, userId, "sess_" + userId, "sess", "hash",
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now()));

        String sessionId = "sess-" + System.nanoTime();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO app_user_session (session_id, user_id, created_at, last_seen_at, "
                        + "absolute_expires_at) VALUES (?, ?, ?, ?, ?)",
                sessionId, userId, Timestamp.from(now), Timestamp.from(now), Timestamp.from(now.plusSeconds(3600)));
        assertThat(jdbc.queryForList("SELECT absolute_expires_at FROM app_user_session WHERE session_id = ?",
                Timestamp.class, sessionId)).hasSize(1);

        String codeId = com.typeme.account.repository.UserRepository.newId();
        jdbc.update("INSERT INTO account_recovery_code (id, user_id, code_hash, code_index, used_at, created_at, "
                        + "revoked_at) VALUES (?, ?, ?, 1, NULL, ?, NULL)",
                codeId, userId, "hash", Timestamp.from(now));
        int first = jdbc.update("UPDATE account_recovery_code SET used_at = ? WHERE id = ? AND used_at IS NULL "
                + "AND revoked_at IS NULL", Timestamp.from(now), codeId);
        int second = jdbc.update("UPDATE account_recovery_code SET used_at = ? WHERE id = ? AND used_at IS NULL "
                + "AND revoked_at IS NULL", Timestamp.from(now.plusSeconds(1)), codeId);
        assertThat(first).isEqualTo(1);
        assertThat(second).as("同一个恢复码只能被消费一次").isZero();
    }

    @Test
    @DisplayName("迁移脚本里不得出现 CREATE DATABASE / USE / DROP DATABASE（同实例还有其它业务库）")
    void migrationsNeverTouchOtherDatabases() throws Exception {
        java.nio.file.Path migrationDir = java.nio.file.Path.of("src", "main", "resources", "db", "migration");
        assertThat(java.nio.file.Files.isDirectory(migrationDir)).isTrue();
        try (var stream = java.nio.file.Files.list(migrationDir)) {
            List<java.nio.file.Path> files = stream.filter(p -> p.getFileName().toString().endsWith(".sql"))
                    .sorted().toList();
            assertThat(files).isNotEmpty();
            for (java.nio.file.Path file : files) {
                String raw = java.nio.file.Files.readString(file);
                // 必须先去掉注释再看：脚本头部**应该**写清"不写 CREATE DATABASE / USE"，
                // 直接对整文件做子串匹配会把这条说明当成违规（这条断言最初就是这么误报的）。
                String sql = stripComments(raw).toUpperCase(java.util.Locale.ROOT);
                assertThat(sql).as("%s 不得含 CREATE DATABASE", file.getFileName()).doesNotContain("CREATE DATABASE");
                assertThat(sql).as("%s 不得含 DROP DATABASE", file.getFileName()).doesNotContain("DROP DATABASE");
                assertThat(sql).as("%s 不得含 USE 语句", file.getFileName())
                        .doesNotContainPattern("(?m)^\\s*USE\\s");
                // MySQL 专有语法会让 H2 跑不动，这里显式钉住
                assertThat(sql).as("%s 不得含 ENGINE=", file.getFileName()).doesNotContain("ENGINE=");
                assertThat(sql).as("%s 不得含 ON UPDATE CURRENT_TIMESTAMP", file.getFileName())
                        .doesNotContain("ON UPDATE CURRENT_TIMESTAMP");
                assertThat(sql).as("%s 不得含 COMMENT=（H2 语法不接受）", file.getFileName())
                        .doesNotContain("COMMENT=");
            }
        }
    }

    /** 去掉 {@code --} 行注释与 {@code /* *}{@code /} 块注释（避免把说明文字当成语句）。 */
    private static String stripComments(String sql) {
        String withoutBlock = sql.replaceAll("(?s)/\\*.*?\\*/", " ");
        StringBuilder builder = new StringBuilder();
        for (String line : withoutBlock.split("\\R", -1)) {
            int marker = line.indexOf("--");
            builder.append(marker >= 0 ? line.substring(0, marker) : line).append('\n');
        }
        return builder.toString();
    }

    @Test
    @DisplayName("凭据哈希列宽必须装得下 PasswordEncoder 的实际输出（V8 的回归防线）")
    void credentialHashColumnsFitEncoderOutput() {
        org.springframework.security.crypto.password.PasswordEncoder encoder =
                passwordEncoder;
        String encoded = encoder.encode("TestPassw0rd!");
        // 实测 PBKDF2 输出形如 {pbkdf2}310000$<salt>$<hash>，长度 266。
        // 这条断言的意义：换算法/换迭代次数导致编码变长时，这里先红，
        // 而不是等到线上"用户注册失败"才发现（VARCHAR(255) 那次就是这么炸的）。
        assertThat(encoded.length())
                .as("编码后长度 %d 必须小于列宽上限", encoded.length())
                .isLessThanOrEqualTo(MAX_CREDENTIAL_HASH_LENGTH);

        // 直接往真实列里插一次，确认数据库层也接受（不只是我们算出来的长度对）
        String userId = com.typeme.account.repository.UserRepository.newId();
        jdbc.update("""
                INSERT INTO app_user (id, username_normalized, username_display, password_hash, nickname,
                                      status, role, created_at, password_changed_at, recovery_code_version)
                VALUES (?, ?, ?, ?, NULL, 'ACTIVE', 'USER', ?, ?, 0)
                """, userId, "hashfit_" + userId, "hashfit", encoded,
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now()));
        assertThat(jdbc.queryForObject("SELECT password_hash FROM app_user WHERE id = ?", String.class, userId))
                .isEqualTo(encoded);

        String codeId = com.typeme.account.repository.UserRepository.newId();
        jdbc.update("INSERT INTO account_recovery_code (id, user_id, code_hash, code_index, used_at, created_at, "
                        + "revoked_at) VALUES (?, ?, ?, 1, NULL, ?, NULL)",
                codeId, userId, encoded, Timestamp.from(Instant.now()));
        assertThat(jdbc.queryForObject("SELECT code_hash FROM account_recovery_code WHERE id = ?", String.class, codeId))
                .isEqualTo(encoded);
    }

    /** 与最长迁移里声明的列宽保持一致；改迁移时必须一起改这里，否则这条断言失去意义。 */
    private static final int MAX_CREDENTIAL_HASH_LENGTH = 512;

    @Autowired
    private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    private boolean tableExists(String table) {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE 1 = 0", Long.class);
            return true;
        } catch (org.springframework.dao.DataAccessException ex) {
            return false;
        }
    }
}
