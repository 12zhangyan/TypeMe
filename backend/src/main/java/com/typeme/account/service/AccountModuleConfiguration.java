package com.typeme.account.service;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 账号模块的装配点。
 *
 * <p>{@link EnableScheduling}：注销清理 worker 靠 {@code @Scheduled} 触发。
 * 放在这里而不是主应用类上，是为了让"账号模块需要调度"这件事留在本模块内，
 * 主类保持它原有的"只做内容服务"的历史语义（本轮不允许改 ContentService 与既有控制器，
 * 主类同样尽量不动）。
 *
 * <p>{@link EnableConfigurationProperties}：绑定 {@code typeme.*} 到
 * {@link TypemeProperties}（比在每个类上写 {@code @ConfigurationProperties} 更好测，
 * 也避免同一份配置被绑定多次）。
 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties(TypemeProperties.class)
public class AccountModuleConfiguration {
}
