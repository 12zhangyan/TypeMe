package com.typeme.ai.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 开启 AI worker 的定时调度，并在启动完成后打印一次 AI 自检信息。
 *
 * <p>为什么单独一个配置类而不是加在 {@code TypeMeApplication}/{@code WebConfig}：
 * 那两个文件属于全站骨架（并行开发时谁都在改）。把 {@code @EnableScheduling} 收在本模块内，
 * 既避免与别人冲突，也让"只为 AI worker 开调度线程池"这件事一眼可见。
 */
@Configuration
@EnableScheduling
public class AiSchedulingConfiguration {

    private static final Logger log = LoggerFactory.getLogger(AiSchedulingConfiguration.class);

    private final AiRuntimeSettingsProvider settingsProvider;
    private final JdbcTemplate jdbcTemplate;

    public AiSchedulingConfiguration(AiRuntimeSettingsProvider settingsProvider,
                                     JdbcTemplate jdbcTemplate) {
        this.settingsProvider = settingsProvider;
        this.jdbcTemplate = jdbcTemplate;
    }

    /**
     * 启动自检：{@code enabled=true} 但 key 为空时打 WARN（契约 03 §1）。
     *
     * <p>用 ApplicationReadyEvent 而不是构造器：启动日志的顺序对运维排查很重要，
     * 让"数据源/Flyway 都就绪了"之后再报 AI 配置状态，避免 WARN 出现在真正的原因之前。
     */
    @EventListener(ApplicationReadyEvent.class)
    public void logStartupDiagnostics() {
        settingsProvider.logStartupDiagnostics();
        verifySchema();
    }

    /**
     * 结构自检：确认 V7 的 {@code user_note} 列存在。
     *
     * <p>为什么值得单独查一次：AI 的迁移版本号是共享资源（V5/V6 属账号模块），
     * 万一 V7 被改名/未应用，症状会是"创建分析任务 500"，而那行堆栈离真正原因很远。
     * 启动时用一条 {@code WHERE 1=0} 的空查询探测，把结论直接写进日志。
     */
    private void verifySchema() {
        try {
            jdbcTemplate.queryForList("SELECT user_note FROM ai_analysis_job WHERE 1 = 0");
        } catch (DataAccessException ex) {
            log.warn("AI 结构自检未通过：ai_analysis_job.user_note 列不可读（迁移 V7__ai_job_user_note.sql 未应用？）。"
                            + "在该列缺失的情况下，创建分析任务会失败。原因：{}",
                    ex.getMostSpecificCause().getMessage());
        }
    }
}
