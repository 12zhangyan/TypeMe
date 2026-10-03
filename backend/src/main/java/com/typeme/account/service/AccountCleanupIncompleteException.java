package com.typeme.account.service;

import java.util.List;

/**
 * 注销清理**没有**做干净。
 *
 * <p>为什么要有一个专门的异常类型，而不是直接抛 {@code DataAccessException}：
 * {@link AccountDeletionService#processOne} 的 catch 只记异常类名（那是刻意的——
 * 清理过程经手的是个人数据，异常消息可能把数据带进日志）。而这一条消息里只有
 * **段名**（"reports" / "attempts" …），是我们自己的常量，不含任何用户数据，
 * 所以它应当被如实记下来：运维需要一眼看出是哪一段没删掉。
 *
 * <p>它继承 {@code RuntimeException}：清理 worker 不该被检查异常逼着到处声明 throws，
 * 而"没删干净"必须让这一轮任务落 FAILED（`account_deletion_job.status`），
 * 由 worker 的下一轮重试到收敛——这正是不再吞异常的全部意义。
 */
public class AccountCleanupIncompleteException extends RuntimeException {

    private final List<String> failedSections;

    public AccountCleanupIncompleteException(List<String> failedSections) {
        super("注销清理未完成，失败段落：" + String.join(",", failedSections));
        this.failedSections = List.copyOf(failedSections);
    }

    /** 失败的段落名（固定枚举值，不是表名拼接，也不含用户数据）。 */
    public List<String> failedSections() {
        return failedSections;
    }
}
