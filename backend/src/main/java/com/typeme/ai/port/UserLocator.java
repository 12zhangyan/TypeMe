package com.typeme.ai.port;

/**
 * "这个 userId 是不是一个存在的、可用的账号"的只读端口。
 *
 * <p>为什么 AI 模块需要它：worker 在发出上游请求前后都要确认"报告的归属账号还在"，
 * 注销流程会让 {@code app_user.status} 变成 {@code DISABLED}/{@code DELETED} 并最终删数据；
 * 对已注销账号继续调用上游既浪费预算，也违背"注销后不再外发"的承诺。
 *
 * <p>实现（{@link JdbcUserLocator}）直查 {@code app_user}，不依赖账号模块的 Java 类型。
 */
public interface UserLocator {

    enum UserState {
        /** ACTIVE：可以继续处理。 */
        ACTIVE,
        /** 存在但不可用（DISABLED / DELETED）。 */
        INACTIVE,
        /** 账号行不存在。 */
        ABSENT,
        /**
         * 无法判断（表/列与预期不符、数据库暂时不可用）。
         *
         * <p>调用方必须把它当作"不要据此拒绝"：宁可继续处理，也不要在基础设施抖动时
         * 让用户的任务全部失败。
         */
        UNKNOWN
    }

    UserState locate(String userId);
}
