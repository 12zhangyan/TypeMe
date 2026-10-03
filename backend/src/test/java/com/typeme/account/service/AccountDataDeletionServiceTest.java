package com.typeme.account.service;

import com.typeme.account.repository.RecoveryCodeRepository;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserSessionRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 注销清理的「没删干净就不能说删好了」（2026-09-18 第 17 轮）。
 *
 * <p>修之前：`tableExists` 把任何 `DataAccessException` 都当成「表还不存在」，
 * `deleteUserScoped` 又把删除失败吞掉，`cleanup()` 无条件 `return true`。
 * 于是一次瞬时数据库故障就能让每一张表都被跳过、账号被改成 DELETED、任务直接 DONE
 * （`PENDING/FAILED` 之外不再被扫，永不重试）—— 用户看到「正在删除」，数据一条没删，
 * 而且 `MeController` 没有任何查询删除状态的接口，用户永远发现不了。
 *
 * <p>断言的粒度是**业务不变量**，不是实现细节：
 *   1. 删某张表出错 → 清理必须失败，且**不得**走到「改写用户名 + 置 DELETED」那一步
 *      （那一步正是「已经删好了」的标志）；
 *   2. 表确实不存在（并行迁移未落盘）→ 跳过并照常完成。
 * 第 2 条是第 1 条的反面：修这个缺陷时不能把「迁移还没落盘」也变成永久失败。
 *
 * <p>这里用一个记录 SQL 的 {@link JdbcTemplate} 假件（而不是 `verify`）来断言
 * 「有没有走到改写用户名那一步」：`update(String, Object...)` 是变长参数方法，
 * Mockito 的 `verify` 对变长参数个数不同的调用匹配起来很脆，而"执行过哪些语句"
 * 本来就是这段代码更直接的可观测结果。
 */
class AccountDataDeletionServiceTest {

    private static final String USER_ID = "u-11111111-1111-1111-1111-111111111111";

    /**
     * 记录下所有执行过的 SQL，用来断言"走没走到宣告完成那一步"。
     *
     * <p>用子类而不是 Mockito 的 `verify`：`update(String, Object...)` 是变长参数方法，
     * Mockito 的变长参数匹配器在"同一个方法既有 1 个也有 3 个变长实参"时匹配不稳，
     * 而"执行过哪些语句"本来就是这段代码更直接的可观测结果。
     */
    private static final class FakeJdbc extends JdbcTemplate {

        private final List<String> statements = Collections.synchronizedList(new ArrayList<>());
        private final List<String> failingFragments = new ArrayList<>();

        @Override
        public int update(String sql, Object... args) {
            for (String fragment : failingFragments) {
                if (sql.contains(fragment)) throw new DataAccessResourceFailureException("数据库暂时不可用");
            }
            statements.add(sql);
            return 1;
        }

        @Override
        public <T> T queryForObject(String sql, Class<T> requiredType) {
            statements.add(sql);
            if (sql.contains("ai_analysis_job") && missingAiJobTable) {
                // 表/对象不存在：Spring 在 MySQL 与 H2 上都翻成 BadSqlGrammarException
                throw new BadSqlGrammarException("probe", sql, new SQLException("table not found"));
            }
            @SuppressWarnings("unchecked")
            T zero = (T) Long.valueOf(0L);
            return zero;
        }

        @Override
        public <T> T queryForObject(String sql, Class<T> requiredType, Object... args) {
            return queryForObject(sql, requiredType);
        }

        private boolean missingAiJobTable;

        void fail(String sqlFragment) {
            failingFragments.add(sqlFragment);
        }

        boolean declaredDone() {
            return statements.stream().anyMatch(sql -> sql.contains("UPDATE app_user SET status"));
        }

        boolean ran(String sqlFragment) {
            return statements.stream().anyMatch(sql -> sql.contains(sqlFragment));
        }
    }

    private static AccountDataDeletionService service(JdbcTemplate jdbc) {
        return new AccountDataDeletionService(
                jdbc,
                new UserSessionRepository(jdbc),
                new RecoveryCodeRepository(jdbc),
                new UserRepository(jdbc));
    }

    @Test
    @DisplayName("删某张表真的出错：清理必须失败，且不许把账号改成 DELETED（否则数据没删却再也查不出来）")
    void deleteFailureMustNotBeReportedAsDone() {
        FakeJdbc jdbc = new FakeJdbc();
        jdbc.fail("DELETE FROM assessment_report");

        assertThatThrownBy(() -> service(jdbc).cleanup(USER_ID))
                .isInstanceOf(AccountCleanupIncompleteException.class)
                .satisfies(error -> assertThat(((AccountCleanupIncompleteException) error).failedSections())
                        .containsExactly("reports"));

        assertThat(jdbc.declaredDone())
                .as("没删干净就不许宣告完成：改写用户名正是「已经删好了」的标志")
                .isFalse();
    }

    @Test
    @DisplayName("表确实不存在（迁移未落盘）：跳过并照常完成，不能把并行部署变成永久失败")
    void missingTableIsSkippedNotFailed() {
        FakeJdbc jdbc = new FakeJdbc();
        jdbc.missingAiJobTable = true;

        assertThat(service(jdbc).cleanup(USER_ID)).isTrue();
        assertThat(jdbc.declaredDone()).isTrue();
    }

    @Test
    @DisplayName("数据库整体不可用：不能把每一张表都判成「还不存在」而整轮跳过")
    void transientDatabaseFailureMustNotLookLikeMissingTables() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        // 连接层故障（不是语法/对象不存在）：探测必须上抛，不能被当成"表不存在"
        when(jdbc.queryForObject(anyString(), eq(Long.class)))
                .thenThrow(new DataAccessResourceFailureException("连接池耗尽"));
        when(jdbc.update(anyString(), ArgumentMatchers.<Object[]>any()))
                .thenThrow(new DataAccessResourceFailureException("连接池耗尽"));

        assertThatThrownBy(() -> service(jdbc).cleanup(USER_ID))
                .isInstanceOf(AccountCleanupIncompleteException.class)
                .satisfies(error -> assertThat(((AccountCleanupIncompleteException) error).failedSections())
                        .as("全部段落都拿不到库，就该全部报失败")
                        .containsExactly("ai", "reports", "attempts", "idempotency", "budget", "invitations", "sessions",
                                "recoveryCodes"));
    }

    @Test
    @DisplayName("多段同时失败：一次清理把所有失败段落都报出来，不挤牙膏")
    void allFailingSectionsAreReported() {
        FakeJdbc jdbc = new FakeJdbc();
        jdbc.fail("DELETE FROM ai_analysis_job");
        jdbc.fail("DELETE FROM assessment_report");
        jdbc.fail("DELETE FROM app_user_session");

        assertThatThrownBy(() -> service(jdbc).cleanup(USER_ID))
                .isInstanceOf(AccountCleanupIncompleteException.class)
                .satisfies(error -> assertThat(((AccountCleanupIncompleteException) error).failedSections())
                        .containsExactly("ai", "reports", "sessions"));

        assertThat(jdbc.declaredDone()).isFalse();

        // 失败不中断：后面几段也要真的执行到，否则"到底几段有问题"要一轮一轮挤出来。
        assertThat(jdbc.ran("DELETE FROM api_idempotency")).isTrue();
        assertThat(jdbc.ran("DELETE FROM account_recovery_code")).isTrue();
    }

    @Test
    @DisplayName("清理全部成功：返回 true 并改写用户名")
    void healthyPathStillWorks() {
        FakeJdbc jdbc = new FakeJdbc();

        assertThat(service(jdbc).cleanup(USER_ID)).isTrue();
        assertThat(jdbc.declaredDone()).isTrue();
    }
}
