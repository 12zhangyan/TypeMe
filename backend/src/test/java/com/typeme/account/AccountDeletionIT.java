package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.repository.DeletionJobRepository;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserSessionRepository;
import com.typeme.account.service.AccountDeletionService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 注销（任务书测试清单 8 / 契约 §6.2）。
 */
class AccountDeletionIT extends AccountIntegrationTestBase {

    @Autowired
    private DeletionJobRepository deletionJobs;

    @Autowired
    private UserSessionRepository sessionRepository;

    @Autowired
    private AccountDeletionService deletionService;

    @Test
    @DisplayName("DELETE /me：202 + 会话立即 401 + 无法再登录 + 建删除任务 + 用户名可被重新注册")
    void deleteAccount() throws Exception {
        String username = uniqueUsername("bye");
        String password = "TestPassw0rd!";
        RegisteredAccount account = register(username, password);

        // confirm 不是逐字 DELETE → 400（防误删的第一道闸）
        CsrfContext csrf = csrf(account.session());
        MvcResult badConfirm = mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", password, "confirm", "delete"))), csrf))
                .andReturn();
        assertThat(badConfirm.getResponse().getStatus()).isEqualTo(400);
        assertThat(body(badConfirm).path("code").asText()).isEqualTo("VALIDATION_FAILED");

        // 密码错误 → 401（防"会话被劫持后被删号"）
        MvcResult badPassword = mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", "WrongPassw0rd!", "confirm", "DELETE"))), csrf))
                .andReturn();
        assertThat(badPassword.getResponse().getStatus()).isEqualTo(401);

        // 正确注销 → 202 + deletionJobId
        MvcResult deleted = mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", password, "confirm", "DELETE"))), csrf))
                .andExpect(status().isAccepted())
                .andReturn();
        JsonNode body = body(deleted);
        String deletionJobId = body.path("deletionJobId").asText();
        assertThat(deletionJobId).isNotBlank();

        // 原会话立刻失效
        assertThat(sessionRepository.findSessionIdsForUser(account.userId())).isEmpty();
        assertThat(mockMvc.perform(get("/api/v3/me").session(sameIdSessionAs(account.session())))
                .andReturn().getResponse().getStatus()).isEqualTo(401);

        // 删除任务已入队（PENDING）
        assertThat(deletionJobs.findByUserId(account.userId())).isPresent();
        assertThat(deletionJobs.findByUserId(account.userId()).orElseThrow().status()).isEqualTo("PENDING");
        assertThat(deletionJobs.findById(deletionJobId)).isPresent();

        // 不能再用原密码登录（账号已 DISABLED，且对外仍是 INVALID_CREDENTIALS）
        org.springframework.mock.web.MockHttpSession reloginSession =
                new org.springframework.mock.web.MockHttpSession();
        CsrfContext reloginCsrf = csrf(reloginSession);
        MvcResult relogin = login(reloginCsrf, reloginSession, username, password, uniqueIp());
        assertThat(relogin.getResponse().getStatus()).isEqualTo(401);
        assertThat(body(relogin).path("code").asText()).isEqualTo("INVALID_CREDENTIALS");

        // 清理 worker 跑一轮：账号进入 DELETED、用户名改写、用户名被释放
        deletionService.processPendingNow();
        assertThat(deletionJobs.findByUserId(account.userId()).orElseThrow().status()).isEqualTo("DONE");

        UserRecord afterCleanup = userRepository.findById(account.userId()).orElseThrow();
        assertThat(afterCleanup.status()).isEqualTo(UserRecord.STATUS_DELETED);
        assertThat(afterCleanup.usernameNormalized()).isEqualTo("deleted:" + account.userId());

        // 用户名可以被新账号注册（这是"释放用户名"的可观测证据）
        RegisteredAccount reused = register(username, "AnotherPassw0rd!");
        assertThat(reused.status()).isEqualTo(201);
        assertThat(reused.userId()).isNotEqualTo(account.userId());
    }

    @Test
    @DisplayName("注销清理可重入：连续跑两轮不报错，且不会复活账号")
    void cleanupIsIdempotent() throws Exception {
        String username = uniqueUsername("redo");
        RegisteredAccount account = register(username, "TestPassw0rd!");
        CsrfContext csrf = csrf(account.session());
        mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", "TestPassw0rd!", "confirm", "DELETE"))), csrf))
                .andExpect(status().isAccepted());

        deletionService.processPendingNow();
        // 第二轮：任务已 DONE，worker 不会再挑它；直接再调一次清理也必须无害
        deletionService.processPendingNow();

        UserRecord user = userRepository.findById(account.userId()).orElseThrow();
        assertThat(user.status()).isEqualTo(UserRecord.STATUS_DELETED);
        assertThat(user.usernameNormalized()).startsWith("deleted:");
    }

    @Test
    @DisplayName("注销后报告/答案/恢复码/会话行都被清理（表存在时）")
    void cleanupRemovesPersonalRows() throws Exception {
        String username = uniqueUsername("wipe");
        RegisteredAccount account = register(username, "TestPassw0rd!");
        assertThat(sessionRepository.countForUser(account.userId())).isGreaterThan(0);

        CsrfContext csrf = csrf(account.session());
        mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", "TestPassw0rd!", "confirm", "DELETE"))), csrf))
                .andExpect(status().isAccepted());
        deletionService.processPendingNow();

        assertThat(sessionRepository.countForUser(account.userId())).isZero();
        // 恢复码行已被删除（注销后连凭据材料都不该留下）
        Integer recoveryRows = jdbcCount(
                "SELECT COUNT(*) FROM account_recovery_code WHERE user_id = ?", account.userId());
        assertThat(recoveryRows).isZero();
        // 幂等记录与报告表（并行迁移已落盘时）同样应清空
        assertThat(jdbcCount("SELECT COUNT(*) FROM api_idempotency WHERE user_id = ?", account.userId()))
                .isZero();
        assertThat(jdbcCount("SELECT COUNT(*) FROM assessment_report WHERE user_id = ?", account.userId()))
                .isZero();
        assertThat(jdbcCount("SELECT COUNT(*) FROM assessment_attempt WHERE user_id = ?", account.userId()))
                .isZero();
    }

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

    private Integer jdbcCount(String sql, Object... args) {
        return jdbcTemplate.queryForObject(sql, Integer.class, args);
    }

    @Test
    @DisplayName("重复建注销任务返回同一份：不能把并发注销变成 500")
    void repeatedDeletionRequestInsertIsIdempotent() {
        String userId = java.util.UUID.randomUUID().toString();
        java.time.Instant now = java.time.Instant.now();

        String first = deletionJobs.insertPendingOrGetExisting(DeletionJobRepository.newId(), userId, now);
        String second = deletionJobs.insertPendingOrGetExisting(DeletionJobRepository.newId(), userId, now);

        assertThat(second)
                .as("重复申请必须得到同一份任务；抛异常会变成 500，而用户的申请其实已经被受理")
                .isEqualTo(first);
        assertThat(deletionJobs.findByUserId(userId).orElseThrow().id()).isEqualTo(first);
        assertThat(jdbcCount("SELECT COUNT(*) FROM account_deletion_job WHERE user_id = ?", userId)).isEqualTo(1);

        // 判别力：绕开这层保护直接 INSERT 必须撞唯一约束 ——
        // 否则上面那两条断言即使实现完全不处理冲突也会通过。
        assertThatThrownBy(() -> jdbcTemplate.update(
                "INSERT INTO account_deletion_job (id, user_id, status, requested_at, attempt_count)"
                        + " VALUES (?, ?, 'PENDING', ?, 0)",
                DeletionJobRepository.newId(), userId,
                java.sql.Timestamp.from(java.time.Instant.now())))
                .as("uk_deletion_job_user 必须真实存在，否则这条测试证明不了任何东西")
                .isInstanceOf(org.springframework.dao.DuplicateKeyException.class);

        // 共享库保持干净：这条测试造的用户没有对应的 app_user 行
        jdbcTemplate.update("DELETE FROM account_deletion_job WHERE user_id = ?", userId);
    }

    @Test
    @DisplayName("注销后再访问需要认证的接口仍是 401（会话与状态双保险）")
    void deletedAccountCannotAccessAnything() throws Exception {
        RegisteredAccount account = register(uniqueUsername("gone"), "TestPassw0rd!");
        CsrfContext csrf = csrf(account.session());
        mockMvc.perform(withCsrf(delete("/api/v3/me")
                        .session(account.session())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("password", "TestPassw0rd!", "confirm", "DELETE"))), csrf))
                .andExpect(status().isAccepted());

        for (String path : new String[]{"/api/v3/me", "/api/v3/me/export", "/api/v3/admin/users"}) {
            assertThat(mockMvc.perform(get(path).session(sameIdSessionAs(account.session())))
                    .andReturn().getResponse().getStatus())
                    .as("注销后 %s 必须 401", path)
                    .isEqualTo(401);
        }
    }
}
