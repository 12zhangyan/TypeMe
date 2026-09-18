package com.typeme.account.service;

import com.typeme.account.repository.UserRecord;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatchers;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 导出**不得把失败伪装成"这部分你没有数据"**。
 *
 * <p>背景（2026-09-17 第 15 轮）：{@code safeQuery} 原先吞掉一切 {@code DataAccessException}
 * 并返回空数组，响应里没有任何标记；而页面告诉用户
 * "账号资料、测评记录、答案、报告与 AI 分析记录都在里面"，
 * 账号页同时写着"注销会删除你的全部测评记录与报告……导出是唯一能把它们带走的办法"。
 * 于是报告查询一旦失败（缺列、连接抖动），用户会拿到一份**看似完整**的备份、
 * 按页面指引去注销，没导出到的那部分永久丢失且事后无从发现。
 *
 * <p>所以本类断言的不是"异常被捕获后不 500"（那是原本就有的行为），
 * 而是"**降级这件事必须出现在响应里**"——页面只有据此才能如实警告用户。
 */
class DataExportDegradationTest {

    private static UserRecord user() {
        return new UserRecord("user-1", "probe", "probe", "hash", "昵称", "ACTIVE", "USER",
                null, null, 1, null, null);
    }

    private static JdbcTemplate jdbcWhereReportsFail() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        // 所有表都存在
        when(jdbc.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);
        when(jdbc.queryForList(anyString(), ArgumentMatchers.<Object[]>any()))
                .thenAnswer(invocation -> {
                    String sql = invocation.getArgument(0);
                    if (sql.contains("FROM assessment_report")) {
                        throw new DataAccessResourceFailureException("column not found: report_hash");
                    }
                    return List.of();
                });
        return jdbc;
    }

    @Test
    @DisplayName("某个段落查询失败时，导出必须声明降级段落（而不是静默给空数组）")
    void failedSectionIsDeclaredInPayload() {
        DataExportService service = new DataExportService(jdbcWhereReportsFail());

        Map<String, Object> exported = service.export(user());

        assertThat(exported.get("degradedSections"))
                .as("响应必须带 degradedSections，页面据此才知道这不是完整备份")
                .isInstanceOf(List.class);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> degraded = (List<Map<String, Object>>) exported.get("degradedSections");
        assertThat(degraded)
                .as("报告查询失败必须被列出来，否则页面会继续说『报告都在里面』")
                .anySatisfy(item -> assertThat(item.get("section")).isEqualTo("reports"));

        // 降级段落的名字要能让人对上页面文案，原因要能区分"查询失败"与"表还没建"
        Map<String, Object> reports = degraded.stream()
                .filter(item -> "reports".equals(item.get("section")))
                .findFirst()
                .orElseThrow();
        assertThat(String.valueOf(reports.get("reason")))
                .as("原因要写明是查询失败，便于区分部署未就绪")
                .contains("查询失败");

        // 而没失败的那几段不该被误报成降级
        assertThat(degraded)
                .as("只有失败的那一段该被列出来")
                .noneSatisfy(item -> assertThat(item.get("section")).isEqualTo("attempts"));
    }

    @Test
    @DisplayName("一切正常时 degradedSections 为空（页面才敢说『都在里面』）")
    void healthyExportDeclaresNoDegradation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);
        when(jdbc.queryForList(anyString(), ArgumentMatchers.<Object[]>any())).thenReturn(List.of());

        Map<String, Object> exported = new DataExportService(jdbc).export(user());

        assertThat((List<?>) exported.get("degradedSections"))
                .as("没有失败段落时必须为空数组 —— 这是页面承诺『都在里面』的前提")
                .isEmpty();
        assertThat(exported.get("attempts")).isInstanceOf(List.class);
        assertThat(exported.get("reports")).isInstanceOf(List.class);
    }

    @Test
    @DisplayName("缺表与查询失败被区分开（部署未就绪 vs 数据取不到）")
    void missingTableIsDistinguishedFromQueryFailure() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        // assessment_report 这张表不存在，其余存在
        when(jdbc.queryForObject(contains("assessment_report"), eq(Long.class)))
                .thenThrow(new DataAccessResourceFailureException("table not found"));
        when(jdbc.queryForObject(ArgumentMatchers.<String>argThat(sql -> !sql.contains("assessment_report")),
                eq(Long.class))).thenReturn(0L);
        when(jdbc.queryForList(anyString(), ArgumentMatchers.<Object[]>any())).thenReturn(List.of());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> degraded = (List<Map<String, Object>>) new DataExportService(jdbc)
                .export(user()).get("degradedSections");

        // 缺表也必须用**段名**声明，这样前端一张映射表就能覆盖两种情况，
        // 用户看到的也是同一个"报告"而不是内部表名。
        Map<String, Object> reports = degraded.stream()
                .filter(item -> "reports".equals(item.get("section")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("缺表也必须被声明为 reports 段，实际：" + degraded));
        assertThat(String.valueOf(reports.get("reason")))
                .as("缺表是部署问题，不该混成『查询失败』")
                .contains("尚未就绪");
    }
}
