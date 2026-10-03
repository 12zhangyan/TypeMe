package com.typeme.account.service;

import com.typeme.account.repository.RecoveryCodeRepository;
import com.typeme.account.repository.UserRepository;
import com.typeme.account.repository.UserSessionRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
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
 * <p><b>表不存在可以跳过，删失败不可以</b>（2026-09-18 第 17 轮修正）：
 * 并行期间迁移文件可能还没落盘，缺表时对应步骤记 WARN 并跳过 —— 否则只要有一张表缺失，
 * 用户就永远删不掉账号。
 *
 * <p><b>但"表不存在"必须与"删的时候出错"分开</b>。修之前 {@link #tableExists} 把**任何**
 * {@code DataAccessException} 都当成"表还不存在"，而 {@link #deleteUserScoped} 又把删除时的
 * {@code DataAccessException} 吞掉，于是 {@link #cleanup} 无条件 {@code return true} ——
 * 后果是一次瞬时数据库故障（连接池耗尽、主从切换）就能让**每一张表**都被判成"还不存在"、
 * 全部跳过，紧接着用户名被改写、账号变 DELETED、任务直接 DONE（`PENDING/FAILED` 之外不再被扫，
 * 所以永远不会重试）。用户看到的是"数据正在被删除"，而一条都没删，且没有任何接口能查删除状态。
 * 现在：只有"表确实不存在"才跳过，其余失败逐段记下来并抛
 * {@link AccountCleanupIncompleteException}，让任务落 FAILED 并在下一轮重试。
 */
@Service
public class AccountDataDeletionService {

    private static final Logger log = LoggerFactory.getLogger(AccountDataDeletionService.class);

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
     * 执行一次清理。可重复调用；**只有真正删干净**才返回 {@code true}。
     *
     * <p>删除顺序就是契约的一部分（按外键依赖从深到浅）：ai_consent / ai_analysis_job →
     * report_self_reflection / assessment_report → assessment_answer / assessment_attempt →
     * api_idempotency / ai_usage_budget。顺序错了会被外键挡下（例如先删 attempt 而报告还指向它）。
     * 这里的顺序**就是**唯一生效的那一份 —— 不要再单独维护一个"表顺序常量"，
     * 那种常量改起来像是生效了，实际不会（历史上有过一份）。
     *
     * @return 是否已彻底完成
     * @throws AccountCleanupIncompleteException 有任何一段没删成功
     */
    public boolean cleanup(String userId) {
        List<String> failed = new ArrayList<>();
        runStep(failed, "ai", () -> {
            deleteUserScoped("ai_consent", userId);
            deleteUserScoped("ai_analysis_job", userId);
        });
        runStep(failed, "reports", () -> {
            deleteUserScoped("report_self_reflection", userId);
            deleteUserScoped("assessment_report", userId);
        });
        runStep(failed, "attempts", () -> deleteAttemptsAndAnswers(userId));
        runStep(failed, "idempotency", () -> deleteUserScoped("api_idempotency", userId));
        runStep(failed, "budget", () -> deleteUsageBudget(userId));
        runStep(failed, "invitations", () -> {
            jdbc.update("UPDATE registration_invitation SET used_by = NULL WHERE used_by = ?", userId);
            jdbc.update("UPDATE registration_invitation SET created_by = NULL, revoked_at = COALESCE(revoked_at, ?) WHERE created_by = ?", java.sql.Timestamp.from(Instant.now()), userId);
            jdbc.update("UPDATE app_user SET ai_daily_limit = NULL WHERE id = ?", userId);
        });
        runStep(failed, "sessions", () -> sessions.deleteByUserId(userId));
        runStep(failed, "recoveryCodes", () -> recoveryCodes.deleteAllForUser(userId));

        if (!failed.isEmpty()) {
            // 段名是我们自己的常量（不是表名拼接、不含用户数据），可以如实进日志。
            log.error("account deletion cleanup incomplete failedSections={}", failed);
            throw new AccountCleanupIncompleteException(failed);
        }

        // 最后一步：改写用户名并置 DELETED（释放用户名、不让备份重放复活账号）。
        // 它**不在** runStep 里：失败必须抛出去（否则会出现"数据删了但账号还叫原名字"），
        // 而抛出去以后任务落 FAILED 会在下一轮重来 —— 这一步是幂等的，重来安全。
        users.markDeletedWithRewrittenUsername(userId, Instant.now());
        log.info("account deletion cleanup finished");
        return true;
    }

    /**
     * 跑一段清理；失败只记录不中断，让一次清理把所有段落都试一遍。
     *
     * <p>为什么要试完而不是第一段失败就退出：失败后任务的下一轮会从头再来（各步幂等），
     * 一次跑完能把"到底几段有问题"一次性暴露在日志里，而不是挤牙膏式地一次发现一段。
     */
    private void runStep(List<String> failed, String section, Runnable action) {
        try {
            action.run();
        } catch (DataAccessException ex) {
            // 只记段名与异常类型：异常消息可能带上被删除的数据内容。
            log.warn("account deletion step failed section={} exception={}", section, ex.getClass().getSimpleName());
            failed.add(section);
        }
    }

    /**
     * 把该用户所有非终止 AI 任务置为 CANCELLED（注销申请时立即调用）。
     *
     * <p>为什么在"申请"阶段就取消而不是等 worker：任务若在清理期间被 worker 领走并写回结果，
     * 就会在已删除的数据上创建新行（契约明确禁止"任务晚到的结果重新创建已删除数据"）。
     *
     * <p>这里**不再吞异常**：它跑在 `requestDeletion` 的事务里，抛出去会让整个注销申请回滚，
     * 用户看到失败并可以重试。反过来吞掉的话，会出现"账号已禁用、会话已撤销，但 AI 任务还在跑"
     * 这种没人能收拾的中间态。
     */
    public int cancelActiveAiJobs(String userId) {
        if (!tableExists("ai_analysis_job")) {
            log.warn("skip cancel ai jobs: table ai_analysis_job not available yet");
            return 0;
        }
        return jdbc.update("UPDATE ai_analysis_job SET status = 'CANCELLED', lease_until = NULL, "
                        + "lease_owner = NULL, next_run_at = NULL, finished_at = ? "
                        + "WHERE user_id = ? AND status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN')",
                java.sql.Timestamp.from(Instant.now()), userId);
    }

    // ------------------------------------------------------------------ 分步删除

    private void deleteAttemptsAndAnswers(String userId) {
        // 答案表没有 user_id 列，只能按 attempt 归属删；先删答案再删 attempt 以兼容
        // "没有 ON DELETE CASCADE" 的部署（契约给的是 CASCADE，但不该依赖它）。
        if (tableExists("assessment_answer") && tableExists("assessment_attempt")) {
            jdbc.update("DELETE FROM assessment_answer WHERE attempt_id IN "
                    + "(SELECT id FROM assessment_attempt WHERE user_id = ?)", userId);
        }
        deleteUserScoped("assessment_attempt", userId);
    }

    /** 个人额度行：scope_key 形如 {@code user:<uuid>}；全局行不动。 */
    private void deleteUsageBudget(String userId) {
        if (!tableExists("ai_usage_budget")) {
            log.warn("skip delete ai_usage_budget: table not available yet");
            return;
        }
        jdbc.update("DELETE FROM ai_usage_budget WHERE scope_key = ?", "user:" + userId);
    }

    /**
     * 按 user_id 删一张表。
     *
     * <p>表不存在（迁移没落盘）→ 跳过并 WARN；**删的时候出错一律上抛**，
     * 由 {@link #runStep} 收集成"这一段没成功"，绝不能把失败说成"删过了"。
     */
    private void deleteUserScoped(String table, String userId) {
        if (!tableExists(table)) {
            // 并行迁移未落盘：跳过而不是失败。写 WARN 是为了让"删了但表还不存在"这两件事
            // 在日志里可辨认，而不是假装一切正常。
            log.warn("skip delete table={} (not available yet)", table);
            return;
        }
        jdbc.update("DELETE FROM " + table + " WHERE user_id = ?", userId);
    }

    /**
     * 表是否存在。用一条零成本查询探测，而不是读 {@code information_schema}：
     * 后者在 MySQL/H2 上的列名与库名过滤差异很大，反而更脆。
     *
     * <p><b>只有 SQL 语法/对象不存在这一类才返回 false</b>：连不上库、锁超时、权限问题
     * 都会抛别的 {@code DataAccessException}，那些必须上抛 —— 把它们当成"表不存在"
     * 正是历史上"整轮删除被静默跳过"的成因。
     *
     * <p>表名来自本类的常量列表，不含任何外部输入，因此不存在标识符注入面。
     */
    private boolean tableExists(String table) {
        try {
            jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE 1 = 0", Long.class);
            return true;
        } catch (BadSqlGrammarException ex) {
            return false;
        }
    }
}
