package com.typeme.account.service;

import com.typeme.account.repository.AiSettingRepository;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;


/** First administrator is created only from explicitly supplied deployment credentials. */
@Component
public class AdminBootstrapService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrapService.class);

    private final UserRepository users;
    private final TypemeProperties properties;
    private final AiSettingRepository aiSettings;
    private final org.springframework.jdbc.core.JdbcTemplate jdbc;
    private final org.springframework.security.crypto.password.PasswordEncoder encoder;
    private final org.springframework.transaction.support.TransactionTemplate transaction;

    public AdminBootstrapService(UserRepository users, TypemeProperties properties,
                                 AiSettingRepository aiSettings, org.springframework.jdbc.core.JdbcTemplate jdbc,
                                 org.springframework.security.crypto.password.PasswordEncoder encoder,
                                 org.springframework.transaction.PlatformTransactionManager manager) {
        this.users = users;
        this.properties = properties;
        this.aiSettings = aiSettings;
        this.jdbc = jdbc;
        this.encoder = encoder;
        this.transaction = new org.springframework.transaction.support.TransactionTemplate(manager);
    }

    @Override
    public void run(ApplicationArguments args) {
        promoteBootstrapUserIfNeeded();
        warnIfSettingsSecretMissing();
    }

    /**
     * 创建初始管理员；已有管理员时不会重设其密码或创建第二个。
     */
    public boolean promoteBootstrapUserIfNeeded() {
        String username = properties.admin().bootstrapUsername();
        String password = properties.admin().bootstrapPassword();
        if (username.isBlank() || password.isBlank()) return false;
        return Boolean.TRUE.equals(transaction.execute(status -> {
            jdbc.queryForObject("SELECT id FROM admin_bootstrap_lock WHERE id = 1 FOR UPDATE", Integer.class);
            if (users.existsAdmin()) return false;
            if (!username.matches("[A-Za-z0-9_]{4,32}") || !password.matches("[\\x20-\\x7E]{12,72}")) {
                throw new IllegalStateException("管理员初始化配置无效：用户名需 4–32 位字母数字下划线，初始密码需 12–72 位可打印 ASCII 字符。");
            }
            // Never elevate an account someone may have registered earlier.
            if (users.findByNormalizedUsername(UserRepository.normalize(username)).isPresent()) {
                throw new IllegalStateException("管理员初始化名称已被占用；请配置一个未使用的管理员名称。");
            }
            users.insert(UserRepository.newId(), UserRepository.normalize(username), username,
                    encoder.encode(password), "管理员", UserRecord.ROLE_ADMIN, java.time.Instant.now());
            log.info("initial administrator created");
            return true;
        }));
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
