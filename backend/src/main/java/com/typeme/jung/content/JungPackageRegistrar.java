package com.typeme.jung.content;

import com.typeme.jung.service.TimeSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;

/**
 * 把启动期加载的内容包**落库**到 {@code assessment_package}。
 *
 * <p><b>为什么必须有这一步</b>（这是个真实漏掉的环节，2026-09-16 端到端实测才发现）：
 * {@code assessment_attempt.package_id} 上有指向 {@code assessment_package} 的外键。
 * 而此前 {@code src/main} 里**没有任何代码写过这张表** —— 只有测试辅助代码会插入它
 * （{@code AccountSqlDialectMySqlIT}、{@code AiSqlDialectMySqlIT} 等），
 * 所以单元测试与集成测试全绿。真实部署（尤其生产）上第一次点"开始测评"就会：
 * <pre>
 *   Cannot add or update a child row: a foreign key constraint fails
 *   (`assessment_attempt`, CONSTRAINT `fk_...` FOREIGN KEY (`package_id`)
 *    REFERENCES `assessment_package` (`package_id`))
 * </pre>
 * 也就是**注册能成功、但一个测评都建不出来**。
 *
 * <p>顺带接上的第二条链路：{@code ai.port.JdbcReportSnapshotReader} 要读
 * {@code assessment_package.content_json} 才能给 AI 分析提供"当时那份内容"的快照。
 * 表是空的时候，AI 分析永远拿不到内容。
 *
 * <p>做法：{@code ApplicationRunner} 在上下文就绪后执行一次，按 packageId upsert。
 * 用 upsert 而不是 "insert if absent"：内容包重新生成后 sha256 会变，
 * 而 {@code published_at} 的语义是"这一版内容何时生效"，需要跟着更新。
 * 不做部分更新也是同一理由 —— 否则会出现"sha256 是新的、content_json 是旧的"这种对不上账的状态。
 *
 * <p>存的 {@code content_json} 用的是 {@link JungPackageLoader#canonicalJson(JungPackage)}，
 * 也就是**计算 sha256 的那一份规范形**。这样 {@code assessment_package} 里的
 * {@code sha256} 列与 {@code content_json} 列必然自洽，将来任何人重算校验都会得到同一个值。
 */
@Component
public class JungPackageRegistrar implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(JungPackageRegistrar.class);

    /**
     * {@code package_id} 是主键，这里用 MySQL 与 H2(MODE=MySQL) 都支持的
     * {@code ON DUPLICATE KEY UPDATE}（迁移脚本同样受这两个引擎约束，见 V2 注释）。
     */
    private static final String UPSERT = """
            INSERT INTO assessment_package
              (package_id, instrument_id, scoring_version, report_content_version,
               content_status, content_json, sha256, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              instrument_id          = VALUES(instrument_id),
              scoring_version        = VALUES(scoring_version),
              report_content_version = VALUES(report_content_version),
              content_status         = VALUES(content_status),
              content_json           = VALUES(content_json),
              sha256                 = VALUES(sha256),
              published_at           = VALUES(published_at)
            """;

    private final JdbcTemplate jdbc;
    private final JungPackageLoader loader;
    private final com.typeme.ipip.content.BigFivePackageLoader bigFiveLoader;
    private final TimeSource time;

    /**
     * 只留**一个**构造器。
     *
     * <p>为什么不额外提供一个"少一个参数"的重载：那样 Spring 会因为存在多个候选构造器
     * 而报 {@code No default constructor found}（实测），得再加 {@code @Autowired} 才认 ——
     * 那是把框架的歧义消解规则写进业务类。时间依赖直接用模块内既有的
     * {@link TimeSource}（它本身就是为了"测试能塞固定时刻"而存在的），
     * 于是这里既没有第二个构造器，测试也照样能控时。
     */
    public JungPackageRegistrar(
            JdbcTemplate jdbc,
            JungPackageLoader loader,
            com.typeme.ipip.content.BigFivePackageLoader bigFiveLoader,
            TimeSource time) {
        this.jdbc = jdbc;
        this.loader = loader;
        this.bigFiveLoader = bigFiveLoader;
        this.time = time;
    }

    @Override
    public void run(ApplicationArguments args) {
        registerAll();
    }

    /**
     * 落库全部已加载的内容包（十六型的每一版 + 大五的每一版）。
     *
     * <p><b>为什么是"全部"而不是"当前版"</b>：{@code assessment_attempt.package_id} 有外键。
     * 只登记当前版时，一份绑定旧版的草稿在重启后会变成不可继续（外键不成立、
     * 或按 package_id 解析不到内容），而"按草稿自己的版本继续作答"正是这次改造的核心。
     * 多版本共存的代价只是表里多几行，收益是历史草稿与历史报告都能解释自己。
     *
     * @return 写入/更新的 packageId 列表
     */
    public java.util.List<String> registerAll() {
        java.util.List<String> registered = new java.util.ArrayList<>();
        for (JungPackage pkg : loader.packages()) {
            registered.add(register(pkg, loader.canonicalJson(pkg)));
        }
        for (com.typeme.ipip.content.BigFivePackage pkg : bigFiveLoader.packages()) {
            registered.add(register(
                    pkg.packageId(),
                    pkg.instrumentId(),
                    pkg.scoringVersion(),
                    pkg.reportContentVersion(),
                    pkg.contentStatus(),
                    pkg.sha256(),
                    bigFiveLoader.canonicalJson(pkg)));
        }
        return java.util.List.copyOf(registered);
    }

    /** 兼容既有调用点与测试：落库默认十六型内容包。 */
    public String registerCurrentPackage() {
        JungPackage pkg = loader.current();
        return register(pkg, loader.canonicalJson(pkg));
    }

    private String register(JungPackage pkg, String contentJson) {
        return register(pkg.packageId(), pkg.instrumentId(), pkg.scoringVersion(),
                pkg.reportContentVersion(), pkg.contentStatus().token(), pkg.sha256(), contentJson);
    }

    private String register(
            String packageId,
            String instrumentId,
            String scoringVersion,
            String reportContentVersion,
            String contentStatus,
            String sha256,
            String contentJson) {
        LocalDateTime publishedAt = TimeSource.toUtc(time.now());
        jdbc.update(UPSERT,
                packageId, instrumentId, scoringVersion, reportContentVersion,
                contentStatus, contentJson, sha256, publishedAt);
        log.info("内容包已落库：packageId={} sha256={}… 审校状态={} 内容字节数={}",
                packageId, abbrev(sha256), contentStatus, contentJson.length());
        return packageId;
    }

    private static String abbrev(String sha256) {
        return sha256 == null || sha256.length() < 12 ? String.valueOf(sha256) : sha256.substring(0, 12);
    }
}
