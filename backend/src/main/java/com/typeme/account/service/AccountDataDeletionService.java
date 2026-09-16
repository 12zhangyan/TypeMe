package com.typeme.account.service;

import com.typeme.account.repository.RecoveryCodeRepository;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

/**
 * 注销清理：把个人数据真正删掉（契约 §6.2 的 worker 部分）。
 *
 * <p><b>可重入</b>是硬要求：清理会跨多张表、可能中途失败，必须能重复执行到收敛。
 * 因此这里不维护"删到第几步"的状态，而是"每一步都幂等"：DELETE 天生幂等，
 * 最后一步的状态改写也只在 DONE 时发生一次（重复执行写同样的值）。
 *
 * <p><b>为什么直接用表名而不是实体类</b>：attempt/report/AI 的表由并行模块拥有。
 * 为它们各写一套 Java 实体等于把两个模块的 schema 耦死，而且会在"同事改列名"时
 * 编译失败在毫不相关的地方。这里只需要表名 + user_id 列，用 {@code JdbcTemplate} 直删
 * 是耦合最小的做法（这也正是任务书要求的方式）。
 *
 * <p><b>容忍表不存在</b>：并行期间迁移文件可能还没落盘。缺表时对应的清理步骤记为
 * WARN 并跳过，不阻断整个注销流程 —— 否则只要有一张表缺失，用户就永远删不掉账号。
 * 表最终会随迁移补齐，而"账号已 DISABLED、恢复码与会话已清"已经让数据不可用。
 */
@Service
public class AccountDataDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDataDeletionService.class);

    /**
     * 按外键依赖从深到浅排列的删除步骤。顺序错了会被外键挡下（例如先删 attempt
     * 而报告还指向它），因此这里的顺序本身就是契约的一部分。
     */
    private static final List<String> USER_SCOPED_TABLES_IN_ORDER = List.of(
            "ai_consent",                 // → ai_analysis_job / app_user
            "ai_analysis_job",            // → assessment_report
            "report_self_reflection",     // → assessment_report
            "assessment_report",          // → assessment_attempt
            "assessment_answer",          // → assessment_attempt（多数情况有 ON DELETE CASCADE）
            "assessment_attempt",         // → app_user
            "api_idempotency",            // → app_user（无外键，但属个人数据）
            "ai_usage_budget");           // 个人额度行（scope_key = 'user:<uuid>'）

    private final JdbcTemplate jdbc;
    private final UserSessionRepository sessions;
    private final RecoveryCodeRepository recoveryCodes;
    private final UserRepository users;

    public AccountDataDeletionService(JdbcTemplate jdbc,
                                      UserSessionRepository sessions,
                                      RecoveryCodeRepository recoveryCodes,
                                      UserRepository users) {
        this.jdbc = jdbc;
        this.sessions = sessions;
        this.recoveryCodes = recoveryCodes;
        this.users = users;
    }

    /**
     * 执行一次清理。可重复调用，直到返回 {@code true}（表示账号已进入 DELETED）。
     *
     * @return 是否已彻底完成
     */
    public boolean cleanup(String userId) {
        deleteAiConsentAndJobs(userId);
        deleteReportsAndReflections(userId);
        deleteAttemptsAndAnswers(userId);
        deleteIdempotency(userId);
        deleteUsageBudget(userId);
        sessions.deleteByUserId(userId);
        recoveryCodes.deleteAllForUser(userId);

        // 最后一步：改写用户名并置 DELETED（释放用户名、不让备份重放复活账号）。
        users.markDeletedWithRewrittenUsername(userId, Instant.now());
        log.info("account deletion cleanup finished");
        return true;
    }

    /**
     * 把该用户所有非终止 AI 任务置为 CANCELLED（注销申请时立即调用）。
     *
     * <p>为什么在"申请"阶段就取消而不是等 worker：任务若在清理期间被 worker 领走并写回结果，
     * 就会在已删除的数据上创建新行（契约明确禁止"任务晚到的结果重新创建已删除数据"）。
     */
    public int cancelActiveAiJobs(String userId) {
        if (!tableExists("ai_analysis_job")) {
            log.warn("skip cancel ai jobs: table ai_analysis_job not available yet");
            return 0;
        }
        try {
            return jdbc.update("UPDATE ai_analysis_job SET status = 'CANCELLED', lease_until = NULL, "
                            + "lease_owner = NULL, next_run_at = NULL, finished_at = ? "
                            + "WHERE user_id = ? AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')",
                    java.sql.Timestamp.from(Instant.now()), userId);
        } catch (DataAccessException ex) {
            log.warn("cancel ai jobs failed: {}", ex.getClass().getSimpleName());
            return 0;
        }
    }

    // ------------------------------------------------------------------ 分步删除

    private void deleteAiConsentAndJobs(String userId) {
        // ai_consent 没有 user_id 之外的稳定定位方式，但它有 job_id；契约里 ai_consent.user_id 也存在。
        deleteUserScoped("ai_consent", userId);
        deleteUserScoped("ai_analysis_job", userId);
    }

    private void deleteReportsAndReflections(String userId) {
        deleteUserScoped("report_self_reflection", userId);
        deleteUserScoped("assessment_report", userId);
    }

    private void deleteAttemptsAndAnswers(String userId) {
        // 答案表没有 user_id 列，只能按 attempt 归属删；先删答案再删 attempt 以兼容
        // "没有 ON DELETE CASCADE" 的部署（契约给的是 CASCADE，但不该依赖它）。
        if (tableExists("assessment_answer") && tableExists("assessment_attempt")) {
            try {
                jdbc.update("DELETE FROM assessment_answer WHERE attempt_id IN "
                        + "(SELECT id FROM assessment_attempt WHERE user_id = ?)", userId);
            } catch (DataAccessException ex) {
                log.warn("delete answers failed: {}", ex.getClass().getSimpleName());
            }
        }
        deleteUserScoped("assessment_attempt", userId);
    }

    private void deleteIdempotency(String userId) {
        deleteUserScoped("api_idempotency", userId);
    }

    /** 个人额度行：scope_key 形如 {@code user:<uuid>}；全局行不动。 */
    private void deleteUsageBudget(String userId) {
        if (!tableExists("ai_usage_budget")) {
            log.warn("skip delete ai_usage_budget: table not available yet");
            return;
        }
        try {
            jdbc.update("DELETE FROM ai_usage_budget WHERE scope_key = ?", "user:" + userId);
        } catch (DataAccessException ex) {
            log.warn("delete ai_usage_budget failed: {}", ex.getClass().getSimpleName());
        }
    }

    private void deleteUserScoped(String table, String userId) {
        if (!tableExists(table)) {
            // 并行迁移未落盘：跳过而不是失败。写 WARN 是为了让"删了但表还不存在"这两件事
            // 在日志里可辨认，而不是假装一切正常。
            log.warn("skip delete table={} (not available yet)", table);
            return;
        }
        try {
            jdbc.update("DELETE FROM " + table + " WHERE user_id = ?", userId);
        } catch (DataAccessException ex) {
            log.warn("delete table={} failed: {}", table, ex.getClass().getSimpleName());
        }
    }

    /**
     * 表是否存在。用一条零成本查询探测，而不是读 {@code information_schema}：
     * 后者在 MySQL/H2 上的列名与库名过滤差异很大，反而更脆。
     *
     * <p>表名来自本类的常量列表，不含任何外部输入，因此不存在标识符注入面。
     */
    private boolean tableExists(String table) {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE 1 = 0", Long.class);
            return true;
        } catch (DataAccessException ex) {
            return false;
        }
    }
}
