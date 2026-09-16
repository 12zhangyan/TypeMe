package com.typeme.jung.content;

import com.typeme.testsupport.ExcludeCrossModuleTestConfigs;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 内容包**落库**的回归防线。
 *
 * <p><b>为什么需要这个测试</b>：{@code assessment_attempt.package_id} 有指向
 * {@code assessment_package} 的外键，所以"内容包是否被写进那张表"是
 * **能不能建测评**的硬前提。此前 {@code src/main} 里没有任何代码写过那张表，
 * 只有测试辅助代码会插入它 —— 于是所有测试都绿，但真实部署上第一次点"开始测评"
 * 就是外键违例（500）。这类"测试自给自足、生产缺一环"的缺陷，
 * 只能靠一条**断言真实启动路径确实落了库**的测试来钉住。
 *
 * <p>同时钉住 {@code content_json} 与 {@code sha256} 的自洽：{@code sha256} 列必须等于
 * 对 {@code content_json} 列重新计算规范形的结果，否则"内容指纹"就只是装饰，
 * 将来没人能验证库里那份内容有没有被改过。
 */
@SpringBootTest
@ActiveProfiles("test")
@ExcludeCrossModuleTestConfigs
class JungPackageRegistrarTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private JungPackageLoader loader;

    @Autowired
    private JungPackageRegistrar registrar;

    @Test
    @DisplayName("启动后 assessment_package 里必须有当前内容包那一行")
    void packageRowExistsAfterStartup() {
        Integer rows = jdbc.queryForObject(
                "SELECT COUNT(*) FROM assessment_package WHERE package_id = ?",
                Integer.class, JungPackageLoader.CURRENT_PACKAGE_ID);

        assertThat(rows)
                .as("assessment_package 里 %s 的行数（为 0 表示建测评必然外键失败）",
                        JungPackageLoader.CURRENT_PACKAGE_ID)
                .isEqualTo(1);
    }

    @Test
    @DisplayName("落库的 sha256 等于对落库的 content_json 重新计算的结果")
    void storedSha256MatchesStoredContent() {
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT content_json, sha256 FROM assessment_package WHERE package_id = ?",
                JungPackageLoader.CURRENT_PACKAGE_ID);

        String contentJson = String.valueOf(row.get("content_json"));
        String storedSha256 = String.valueOf(row.get("sha256"));

        assertThat(storedSha256)
                .as("落库内容的指纹必须自洽（否则 sha256 列没有验证价值）")
                .isEqualTo(loader.sha256OfCanonicalJson(contentJson));
    }

    @Test
    @DisplayName("落库行的元数据与内容包一致（版本、审校状态、非空内容）")
    void storedMetadataMatchesPackage() {
        JungPackage pkg = loader.current();
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT instrument_id, scoring_version, report_content_version, content_status, content_json "
                        + "FROM assessment_package WHERE package_id = ?",
                pkg.packageId());

        assertThat(row.get("instrument_id")).isEqualTo(pkg.instrumentId());
        assertThat(row.get("scoring_version")).isEqualTo(pkg.scoringVersion());
        assertThat(row.get("report_content_version")).isEqualTo(pkg.reportContentVersion());
        assertThat(row.get("content_status")).isEqualTo(pkg.contentStatus().token());
        assertThat(String.valueOf(row.get("content_json")))
                .as("内容包 JSON 不能为空或半截")
                .hasSize(loader.canonicalJson(pkg).length());
    }

    @Test
    @DisplayName("重复登记是幂等的，不会产生第二行（也不会把 published_at 弄丢）")
    void registeringTwiceIsIdempotent() {
        registrar.registerCurrentPackage();
        registrar.registerCurrentPackage();

        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT package_id, published_at FROM assessment_package WHERE package_id = ?",
                JungPackageLoader.CURRENT_PACKAGE_ID);

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).get("published_at")).isNotNull();
    }
}
