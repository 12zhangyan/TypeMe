package com.typeme.account.service;

/**
 * 后台设置写入后，通知读取侧丢弃缓存。
 *
 * <p>## 为什么需要这个 port
 *
 * <p>{@code AiRuntimeSettingsProvider}（AI 模块）把生效设置缓存 10 秒，避免每次调用都打库；
 * 而设置是由 {@code AiSettingsService}（账号模块）写进 {@code typeme_ai_setting} 的。
 * 两者互相不知道对方存在时，会出现这样一个真实场景：
 *
 * <pre>
 *   管理员把开关从「演示模式」改成真实模型并保存 → 立刻点「生成分析」
 *   → 分析仍然按缓存的旧设置跑（mock 结果）
 * </pre>
 *
 * <p>它不会报错，只会给出一个"看起来正常但用的是上一版配置"的结果 —— 这正是最难被发现的一类问题。
 * 所以写入方必须在保存成功后**立刻**通知读取侧失效。
 *
 * <p>## 为什么接口定义在 account 包
 *
 * <p>让写入方拥有它调用的抽象，依赖方向就不会反过来：AI 模块实现这个接口，
 * 但不需要 import {@code com.typeme.account.service} 之外的任何东西，
 * 账号模块也不 import AI 模块（通过 {@code ObjectProvider} 可选注入）。
 * 若在 account 模块里直接注入 {@code AiRuntimeSettingsProvider}，就会形成
 * account → ai → account 的环。
 *
 * <p>实现方只需要清掉自己的缓存，**不得**顺便写数据库 —— 这是纯通知，幂等、可重复调用。
 */
public interface AiSettingsCacheInvalidator {

    /** 让下一次读取重新取配置。允许在没有任何缓存时调用。 */
    void invalidate();
}
