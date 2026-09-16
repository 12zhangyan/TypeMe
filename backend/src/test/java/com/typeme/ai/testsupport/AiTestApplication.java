package com.typeme.ai.testsupport;

import com.typeme.ai.config.AiClock;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration;
import org.springframework.boot.autoconfigure.transaction.TransactionAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.FilterType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;

import javax.sql.DataSource;
import java.time.Instant;

/**
 * AI 模块的**测试专用** Spring 配置。
 *
 * <p>为什么不用 {@code @SpringBootTest} 扫全站：
 * <ol>
 *   <li>并行开发中，别的模块（{@code com.typeme.jung}/{@code com.typeme.security}/{@code com.typeme.account}）
 *       随时可能处于编译不过或配置半成品状态；AI 的测试不应该因此变红或变绿；</li>
 *   <li>AI 只需要 DataSource + Flyway + JdbcTemplate + 事务 + MVC + 自己的组件，
 *       依赖面越小，"测试通过"这句话的含金量越高。</li>
 * </ol>
 *
 * <p>测试用的 {@link AiClock} 是**固定时钟**：lease 过期、Retry-After 退避、每小时重试窗口
 * 这些判定都必须能被确定性地驱动，否则只能靠 sleep 猜时序。
 */
@Configuration
@EnableAutoConfiguration
@ComponentScan(basePackages = "com.typeme.ai",
        excludeFilters = {
                @ComponentScan.Filter(
                        type = FilterType.REGEX,
                        pattern = "com\\.typeme\\.ai\\.testsupport\\..*"),
                // AiClock 由本配置显式提供（可推进的测试时钟），不参与组件扫描，避免两个候选。
                @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = AiClock.class)
        })
public class AiTestApplication {

    /**
     * 可推进的测试时钟：所有与 lease 过期、Retry-After 退避、每小时重试窗口相关的断言都依赖它。
     *
     * <p>把它显式声明（而不是让 {@code AiClock} 自己 {@code Instant.now()}）是测试确定性的前提：
     * 否则这些判定只能用 {@code Thread.sleep} 去"猜"时序，既慢又 flaky。
     */
    @Bean
    public MutableAiClock aiClock() {
        return new MutableAiClock(Instant.parse("2026-09-16T10:00:00Z"));
    }

    /**
     * 显式声明事务管理器。
     *
     * <p>不依赖自动配置的原因是：本配置刻意排除了若干自动配置类，
     * 而 {@code AnalysisCreationWriter}/{@code AnalysisService} 的短事务是正确性的一部分
     * （重复点击只扣一次额度就靠它回滚）。宁可显式写上。
     */
    @Bean
    public PlatformTransactionManager transactionManager(DataSource dataSource) {
        return new DataSourceTransactionManager(dataSource);
    }

    /**
     * 测试专用的"前置迁移补齐"。
     *
     * <p>背景：{@code V3__report_and_self_reflection.sql} 已经落地，但 {@code V5}
     * （{@code api_idempotency} 等）由账号模块并行开发。AI 模块**刻意不依赖 api_idempotency**
     * （幂等语义完全由 {@code ai_analysis_job} 的两个唯一键覆盖），所以这里只需要确保
     * AI 表依赖的 {@code assessment_report} 存在即可。
     *
     * <p>用 {@code CREATE TABLE IF NOT EXISTS}：V3 已经存在时是幂等空操作；
     * 万一它被临时移除，测试也能自己补齐，而不是让"AI 的测试"因为别人的迁移缺失而无法运行。
     * <b>这段 DDL 只在测试 classpath 里，绝不进生产迁移。</b>
     */
    @Bean
    @ConditionalOnProperty(name = "typeme.ai.test.ensure-report-table", havingValue = "true", matchIfMissing = true)
    public ApplicationRunner aiTestEnsurePrerequisites(JdbcTemplate jdbcTemplate) {
        return args -> jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS assessment_report (
                    id                 CHAR(36)    NOT NULL,
                    attempt_id         CHAR(36)    NOT NULL,
                    user_id            CHAR(36)    NOT NULL,
                    status             VARCHAR(16) NOT NULL,
                    computed_type_code CHAR(4)     NULL,
                    score_json         MEDIUMTEXT  NOT NULL,
                    report_json        MEDIUMTEXT  NOT NULL,
                    report_hash        CHAR(64)    NOT NULL,
                    created_at         DATETIME(6) NOT NULL,
                    CONSTRAINT pk_assessment_report PRIMARY KEY (id),
                    CONSTRAINT uk_report_attempt UNIQUE (attempt_id),
                    CONSTRAINT fk_report_attempt FOREIGN KEY (attempt_id) REFERENCES assessment_attempt (id),
                    CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES app_user (id)
                )
                """);
    }

    /** 让 IDE 更容易发现这两个自动配置类的存在（显式引用，避免被误删）。 */
    static final Class<?>[] AI_TEST_AUTOCONFIG = {
            DataSourceAutoConfiguration.class, JdbcTemplateAutoConfiguration.class,
            FlywayAutoConfiguration.class, TransactionAutoConfiguration.class, WebMvcAutoConfiguration.class};
}
