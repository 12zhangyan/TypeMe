package com.typeme.security;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.typeme.account.AccountIntegrationTestBase;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 日志纪律（开发方案 §5 的硬要求，任务书要求"写一个单测或至少注释钉住"）。
 *
 * <p>用真实的失败登录 / 注册 / 改密 / 恢复流程驱动一遍，然后断言**日志里不含**：
 * 密码、恢复码、Authorization、Cookie、请求体原文。
 *
 * <p>为什么值得专门写一条测试：日志是最容易在"顺手 debug 一下"时泄漏凭据的地方，
 * 而且泄漏一旦发生就写进了文件/采集系统，撤不回来。注释拦不住人，测试可以。
 */
class SecurityLoggingDisciplineIT extends AccountIntegrationTestBase {

    private static final String PASSWORD = "TestPassw0rd!";
    private static final String NEW_PASSWORD = "BrandNewPassw0rd!";

    @Test
    @DisplayName("注册/登录/改密/恢复全过程：日志里不出现密码与恢复码")
    void credentialsNeverReachLogs() throws Exception {
        ListAppender<ILoggingEvent> appender = attachAppender();

        String username = uniqueUsername("logdiscipline");
        RegisteredAccount account = register(username, PASSWORD);
        List<String> recoveryCodes = account.recoveryCodes();
        assertThat(recoveryCodes).hasSize(8);

        // 失败登录（错误密码）、成功登录、改密、恢复都跑一遍
        MockHttpSession failedSession = new MockHttpSession();
        CsrfContext failedCsrf = csrf(failedSession);
        login(failedCsrf, failedSession, username, "WrongPasswordShouldNeverBeLogged!", uniqueIp());

        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        login(csrf, session, username, PASSWORD, uniqueIp());

        mockMvc.perform(withCsrf(post("/api/v3/me/password")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", PASSWORD, "newPassword", NEW_PASSWORD))), csrf))
                .andReturn();

        MockHttpSession recoverSession = new MockHttpSession();
        CsrfContext recoverCsrf = csrf(recoverSession);
        mockMvc.perform(withCsrf(post("/api/v3/auth/recover")
                        .session(recoverSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", username, "recoveryCode", recoveryCodes.get(0),
                                "newPassword", "RecoveredPassw0rd!"))), recoverCsrf))
                .andReturn();

        MockHttpSession deleteSession = new MockHttpSession();
        CsrfContext deleteCsrf = csrf(deleteSession);
        login(deleteCsrf, deleteSession, username, "RecoveredPassw0rd!", uniqueIp());
        MvcResult deleteResult = mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(deleteSession)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", "RecoveredPassw0rd!", "confirm", "DELETE"))), deleteCsrf))
                .andReturn();
        assertThat(deleteResult.getResponse().getStatus()).isEqualTo(202);

        // 断言：所有日志行拼起来都不含任何凭据
        String allLogs = allMessages(appender);
        assertThat(allLogs)
                .as("日志不得包含注册密码")
                .doesNotContain(PASSWORD)
                .as("日志不得包含新密码")
                .doesNotContain(NEW_PASSWORD)
                .doesNotContain("RecoveredPassw0rd!")
                .doesNotContain("WrongPasswordShouldNeverBeLogged!")
                .as("日志不得包含恢复码")
                .doesNotContain(recoveryCodes.get(0))
                .doesNotContain(RecoveryCodeGenerator.normalize(recoveryCodes.get(0)))
                .as("日志不得包含 Cookie/Authorization 字样")
                .doesNotContain("JSESSIONID")
                .doesNotContain("XSRF-TOKEN")
                .doesNotContain("Authorization");
        detachAppender(appender);
    }

    @Test
    @DisplayName("错误响应体不回显用户输入（校验失败只给字段名与规则）")
    void validationErrorsDoNotEchoInput() throws Exception {
        String secretLookingUsername = "secretvalue";
        assertThat(secretLookingUsername).isNotBlank();
        MockHttpSession session = new MockHttpSession();
        CsrfContext csrf = csrf(session);
        String password = "ShouldNotAppearInBody!";
        MvcResult result = mockMvc.perform(withCsrf(post("/api/v3/auth/register")
                        .session(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("username", "bad name", "password", password))), csrf))
                .andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        String body = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        assertThat(body).doesNotContain("bad name").doesNotContain(password);
    }

    // ------------------------------------------------------------------ Logback 工具

    private static ListAppender<ILoggingEvent> attachAppender() {
        Logger root = (Logger) LoggerFactory.getLogger("com.typeme");
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        root.addAppender(appender);
        return appender;
    }

    private static void detachAppender(ListAppender<ILoggingEvent> appender) {
        Logger root = (Logger) LoggerFactory.getLogger("com.typeme");
        root.detachAppender(appender);
        appender.stop();
    }

    private static String allMessages(ListAppender<ILoggingEvent> appender) {
        StringBuilder builder = new StringBuilder();
        for (ILoggingEvent event : appender.list) {
            builder.append(event.getFormattedMessage()).append('\n');
            if (event.getThrowableProxy() != null) {
                builder.append(event.getThrowableProxy().getMessage()).append('\n');
            }
            for (Map.Entry<String, String> mdc : event.getMDCPropertyMap().entrySet()) {
                builder.append(mdc.getKey()).append('=').append(mdc.getValue()).append('\n');
            }
        }
        return builder.toString();
    }
}
