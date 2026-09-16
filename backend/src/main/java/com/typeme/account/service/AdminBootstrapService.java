package com.typeme.account.service;

import com.typeme.account.repository.AiSettingRepository;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * 管理员引导：**只在系统里一个 ADMIN 都没有时**，把配置里指定的已存在账号提升为 ADMIN。
 *
 * <p>选的方案是任务书里的 (a)（配置项 + 启动期一次性提升），理由：
 * <ul>
 *   <li>不需要开发者手工改数据库 —— 手工 {@code UPDATE} 这种"口头流程"在真实项目里
 *       要么没人做、要么被做成脚本长期留存，两者都比配置项危险；</li>
 *   <li>它是<b>幂等且自动失效</b>的：一旦系统中有了任何 ADMIN，本组件就什么都不做。
 *       因此不需要"用完记得删配置"这种纪律；</li>
 *   <li>它不创建账号、不设默认密码：只提升一个**已经用它自己的密码注册过**的账号。
 *       这避免了"部署时自动种一个 admin/admin"这个最经典的后门。</li>
 * </ul>
 *
 * <p>顺序是"先注册账号、再重启（或本组件在下次启动时提升）"。为了让本地开发不必重启，
 * 它还提供了 {@link #promoteBootstrapUserIfNeeded()} 供管理员引导接口/测试显式调用。
 *
 * <p>日志纪律：只记"已提升"，不记密码，也不记被提升账号的其它凭据材料。
 */
@Component
public class AdminBootstrapService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapService.class);

    private final UserRepository users;
    private final TypemeProperties properties;
    private final AiSettingRepository aiSettings;

    public AdminBootstrapService(UserRepository users, TypemeProperties properties,
                                 AiSettingRepository aiSettings) {
        this.users = users;
        this.properties = properties;
        this.aiSettings = aiSettings;
    }

    @Override
    public void run(ApplicationArguments args) {
        promoteBootstrapUserIfNeeded();
        warnIfSettingsSecretMissing();
    }

    /**
     * 提升引导管理员。返回是否发生了提升（便于测试断言，也便于日志区分两种情形）。
     */
    public boolean promoteBootstrapUserIfNeeded() {
        String configured = properties.admin().bootstrapUsername();
        if (configured.isBlank()) {
            return false;
        }
        // 已有管理员：立刻放弃。这是"本机制自动失效"的实现，也是它安全的关键。
        if (users.existsAdmin()) {
            return false;
        }
        Optional<UserRecord> candidate = users.findByNormalizedUsername(UserRepository.normalize(configured));
        if (candidate.isEmpty()) {
            // 账号还不存在（例如刚部署、还没注册）：不报错、不创建，等下次启动或显式调用。
            log.info("admin bootstrap configured user not found yet");
            return false;
        }
        UserRecord user = candidate.get();
        if (!user.active()) {
            log.warn("admin bootstrap skipped: account not active");
            return false;
        }
        users.updateRole(user.id(), UserRecord.ROLE_ADMIN);
        log.info("admin bootstrap promoted configured account to ADMIN");
        return true;
    }

    /**
     * 启动期提醒：后台 AI 设置的密钥没配时，后台能读不能写。
     *
     * <p>只 WARN 不失败：开发环境确实可能先不配；而"写入 apiKey"这条路径会自己返回 503，
     * 不会静默降级成弱加密。
     */
    private void warnIfSettingsSecretMissing() {
        if (properties.security().settingsSecretConfigured()) {
            return;
        }
        if (aiSettings.tableAvailable()) {
            log.warn("typeme.security.settings-secret 未配置：后台可查看 AI 设置，但无法保存 apiKey（将返回 503）");
        }
    }
}
