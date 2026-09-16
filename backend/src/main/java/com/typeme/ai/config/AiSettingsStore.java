package com.typeme.ai.config;

import java.time.Duration;

/**
 * 「平台 AI 能力参数」的最小抽象。
 *
 * <p>刻意只暴露"能力参数"，**不暴露存储**：平台可能既用 {@code ai_consent}（用户同意）
 * 又用 {@code ai_consent_policy}（管理员维护的政策版本），这些表由账号模块的 V6 迁移建，
 * 具体表名与列名不进 AI 模块的接口。测试用内存实现即可。
 */
public interface AiSettingsStore {

    /** 用户同意政策的版本（落 {@code ai_consent.policy_version}）。取不到时返回 null。 */
    String loadConsentPolicyVersion();

    /** lease 时长；必须 > requestDeadline，否则上游还没返回 lease 就过期了。 */
    Duration loadLeaseDuration();

    /** worker 单轮最多认领几个任务。 */
    int loadWorkerBatchSize();
}
