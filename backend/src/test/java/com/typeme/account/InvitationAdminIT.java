package com.typeme.account;

import com.fasterxml.jackson.databind.JsonNode;
import com.typeme.account.service.AccountService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class InvitationAdminIT extends AccountIntegrationTestBase {
    @Autowired AccountService accounts;
    @Autowired com.typeme.account.service.AccountDataDeletionService deletion;
    private RegisteredAccount admin() throws Exception {
        String name = uniqueUsername("admin"), password = UUID.randomUUID().toString();
        var a = register(name, password);
        userRepository.updateRole(a.userId(), "ADMIN");
        assertThat(login(csrf(a.session()), a.session(), name, password, uniqueIp()).getResponse().getStatus()).isEqualTo(200);
        return a;
    }
    private JsonNode invite(RegisteredAccount a) throws Exception {
        var response = mockMvc.perform(withCsrf(post("/api/v3/admin/invitations").session(a.session())
                .contentType(MediaType.APPLICATION_JSON).content(json(Map.of("expiresAt", Instant.now().plusSeconds(3600).toString()))), csrf(a.session())))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store")).andReturn();
        return body(response);
    }
    private MvcResult redeem(String username, String code) throws Exception {
        var session = new MockHttpSession();
        return mockMvc.perform(withCsrf(post("/api/v3/auth/register").session(session).contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("username", username, "password", UUID.randomUUID().toString(), "disclaimerAccepted", true, "invitationCode", code))), csrf(session))).andReturn();
    }
    @Test void singleUseAndOnlyHashIsStoredOrListed() throws Exception {
        var a = admin(); var i = invite(a); String code = i.path("code").asText();
        assertThat(code).hasSize(32);
        assertThat(invitationJdbc.queryForObject("SELECT code_hash FROM registration_invitation WHERE id=?", String.class, i.path("id").asText())).hasSize(64).isNotEqualTo(code);
        String username = uniqueUsername("invited");
        assertThat(redeem(username, code).getResponse().getStatus()).isEqualTo(201);
        mockMvc.perform(withCsrf(post("/api/v3/admin/invitations/{id}/revoke", i.path("id").asText()).session(a.session()), csrf(a.session()))).andExpect(status().isConflict());
        String rejected = uniqueUsername("reused");
        assertThat(redeem(rejected, code).getResponse().getStatus()).isEqualTo(400);
        assertThat(userRepository.findByNormalizedUsername(rejected)).isEmpty();
        var listed = mockMvc.perform(get("/api/v3/admin/invitations").session(a.session())).andExpect(status().isOk()).andReturn();
        assertThat(listed.getResponse().getContentAsString()).doesNotContain(code, "code_hash");
        assertThat(body(listed).path("items").toString()).contains(username, "USED");
    }
    @Test void missingExpiredRevokedAndMalformedCodesCannotCreateAccount() throws Exception {
        var a = admin();
        for (String mode : List.of("missing", "expired", "revoked", "malformed")) {
            var i = invite(a); String id = i.path("id").asText();
            if (mode.equals("expired")) invitationJdbc.update("UPDATE registration_invitation SET expires_at=? WHERE id=?", java.sql.Timestamp.from(Instant.now().minusSeconds(1)), id);
            if (mode.equals("revoked")) mockMvc.perform(withCsrf(post("/api/v3/admin/invitations/{id}/revoke", id).session(a.session()), csrf(a.session()))).andExpect(status().isOk());
            String code = mode.equals("missing") ? "" : mode.equals("malformed") ? "not-a-code" : i.path("code").asText();
            String username = uniqueUsername("badinvite");
            assertThat(redeem(username, code).getResponse().getStatus()).isEqualTo(400);
            assertThat(userRepository.findByNormalizedUsername(username)).isEmpty();
        }
    }
    @Test void duplicateUsernameDoesNotBurnAnInvite() throws Exception {
        var a = admin(); var i = invite(a); var username = uniqueUsername("existing");
        register(username, UUID.randomUUID().toString());
        assertThat(redeem(username, i.path("code").asText()).getResponse().getStatus()).isEqualTo(409);
        assertThat(redeem(uniqueUsername("valid"), i.path("code").asText()).getResponse().getStatus()).isEqualTo(201);
    }
    @Test void deletionRemovesInvitationIdentityButNeverReactivatesUsedCode() throws Exception {
        var a = admin(); var i = invite(a); String code = i.path("code").asText();
        var created = redeem(uniqueUsername("cleanup"), code);
        assertThat(created.getResponse().getStatus()).isEqualTo(201);
        String id = body(created).path("userId").asText();
        assertThat(deletion.cleanup(id)).isTrue();
        var row = invitationJdbc.queryForMap("SELECT used_by, used_at FROM registration_invitation WHERE id=?", i.path("id").asText());
        assertThat(row.get("used_by")).isNull(); assertThat(row.get("used_at")).isNotNull();
        assertThat(redeem(uniqueUsername("reuse_deleted"), code).getResponse().getStatus()).isEqualTo(400);
        var unused = invite(a);
        assertThat(deletion.cleanup(a.userId())).isTrue();
        var creator = invitationJdbc.queryForMap("SELECT created_by, revoked_at FROM registration_invitation WHERE id=?", unused.path("id").asText());
        assertThat(creator.get("created_by")).isNull(); assertThat(creator.get("revoked_at")).isNotNull();
        assertThat(redeem(uniqueUsername("gonecreator"), unused.path("code").asText()).getResponse().getStatus()).isEqualTo(400);
    }
    @Test void simultaneousRedemptionCreatesExactlyOneAccount() throws Exception {
        var i = invite(admin()); String code = i.path("code").asText();
        String one = uniqueUsername("raceone"), two = uniqueUsername("racetwo");
        var ready = new CountDownLatch(2); var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var futures = new ArrayList<Future<Boolean>>();
            for (String name : List.of(one, two)) futures.add(pool.submit(() -> {
                ready.countDown(); start.await(10, TimeUnit.SECONDS);
                try { accounts.register(name, UUID.randomUUID().toString(), null, true, code); return true; }
                catch (com.typeme.common.ApiException e) { assertThat(e.getMessage()).contains("邀请码"); return false; }
            }));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(futures.get(0).get(20, TimeUnit.SECONDS), futures.get(1).get(20, TimeUnit.SECONDS))).containsExactlyInAnyOrder(true, false);
        }
        assertThat(invitationJdbc.queryForObject("SELECT COUNT(*) FROM app_user WHERE username_normalized IN (?,?)", Integer.class, one, two)).isEqualTo(1);
    }
    @Test void adminRoutesRequireAdminAndCsrfAndValidateExpiry() throws Exception {
        var ordinary = register(uniqueUsername("plain"), UUID.randomUUID().toString());
        for (String path : List.of("/invitations", "/users/" + ordinary.userId() + "/reports", "/users/" + ordinary.userId() + "/attempts", "/users/" + ordinary.userId() + "/reports/missing")) {
            mockMvc.perform(get("/api/v3/admin" + path).session(ordinary.session())).andExpect(status().isForbidden());
        }
        mockMvc.perform(withCsrf(post("/api/v3/admin/invitations").session(ordinary.session()).contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("expiresAt", Instant.now().plusSeconds(60).toString()))), csrf(ordinary.session()))).andExpect(status().isForbidden());
        mockMvc.perform(withCsrf(put("/api/v3/admin/users/{id}/ai-limit", ordinary.userId()).session(ordinary.session()).contentType(MediaType.APPLICATION_JSON).content("{\"aiDailyLimit\":99}"), csrf(ordinary.session()))).andExpect(status().isForbidden());
        var a = admin();
        mockMvc.perform(post("/api/v3/admin/invitations").session(a.session()).contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isForbidden());
        for (Instant expires : List.of(Instant.now().minusSeconds(60), Instant.now().plusSeconds(366L * 86400))) {
            mockMvc.perform(withCsrf(post("/api/v3/admin/invitations").session(a.session()).contentType(MediaType.APPLICATION_JSON).content(json(Map.of("expiresAt", expires.toString()))), csrf(a.session()))).andExpect(status().isBadRequest());
        }
        mockMvc.perform(get("/api/v3/admin/users/{id}/reports", ordinary.userId()).session(a.session())).andExpect(status().isOk());
        mockMvc.perform(get("/api/v3/admin/users/missing/reports").session(a.session())).andExpect(status().isNotFound());
    }
    @Test void adminReadsOwnerBoundReportWithoutOpeningOrdinaryUserEndpoints() throws Exception {
        var owner = register(uniqueUsername("reportowner"), UUID.randomUUID().toString());
        var other = register(uniqueUsername("reportother"), UUID.randomUUID().toString());
        var a = admin(); var token = csrf(owner.session());
        var created = body(mockMvc.perform(withCsrf(post("/api/v3/attempts").session(owner.session()).contentType(MediaType.APPLICATION_JSON).content("{}"), token)).andExpect(status().isCreated()).andReturn());
        String attemptId = created.path("attemptId").asText();
        var pack = body(mockMvc.perform(get("/api/v3/catalog/current/package").session(owner.session())).andExpect(status().isOk()).andReturn());
        var answers = new ArrayList<Map<String,Object>>();
        for (JsonNode q : pack.path("questions")) if (q.path("stage").asText().equals("base")) answers.add(Map.of("questionId", q.path("id").asText(), "kind", "RATING", "rating", 4));
        assertThat(answers).hasSize(48);
        var patched = body(mockMvc.perform(withCsrf(patch("/api/v3/attempts/{id}/answers", attemptId).session(owner.session()).contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("expectedRevision", created.path("revision").asLong(), "responses", answers))), token)).andExpect(status().isOk()).andReturn());
        var submitted = body(mockMvc.perform(withCsrf(post("/api/v3/attempts/{id}/submit", attemptId).session(owner.session()).contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("expectedRevision", patched.path("revision").asLong(), "clarificationSkipped", true))), token)).andExpect(status().isCreated()).andReturn());
        String id = submitted.path("reportId").asText();
        mockMvc.perform(get("/api/v3/admin/users/{id}/attempts", owner.userId()).session(a.session())).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].answeredCount").value(48));
        mockMvc.perform(get("/api/v3/admin/users/{id}/reports", owner.userId()).session(a.session())).andExpect(status().isOk()).andExpect(jsonPath("$.items[0].reportId").value(id));
        var viewed = mockMvc.perform(get("/api/v3/admin/users/{u}/reports/{r}", owner.userId(), id).session(a.session())).andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store")).andReturn();
        var personal = mockMvc.perform(get("/api/v3/platform/reports/{id}", id).session(owner.session())).andExpect(status().isOk()).andReturn();
        assertThat(body(viewed).path("report")).isEqualTo(body(personal).path("report"));
        mockMvc.perform(get("/api/v3/admin/users/{u}/reports/{r}", other.userId(), id).session(a.session())).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v3/platform/reports/{id}", id).session(other.session())).andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v3/platform/reports/{id}", id).session(a.session())).andExpect(status().isNotFound());
    }

    @Test void quotaIsAssignedToTargetAndRejectsInvalidNumbers() throws Exception {
        var a = admin(); var user = register(uniqueUsername("quota"), UUID.randomUUID().toString());
        for (int limit : List.of(5, 0)) {
            mockMvc.perform(withCsrf(put("/api/v3/admin/users/{id}/ai-limit", user.userId()).session(a.session()).contentType(MediaType.APPLICATION_JSON).content(json(Map.of("aiDailyLimit", limit))), csrf(a.session())))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.effectiveAiDailyLimit").value(limit)).andExpect(jsonPath("$.aiRemainingToday").value(limit));
            assertThat(userRepository.findById(user.userId()).orElseThrow().aiDailyLimit()).isEqualTo(limit);
        }
        for (String invalid : List.of("-1", "10001", "null", "2.5")) mockMvc.perform(withCsrf(put("/api/v3/admin/users/{id}/ai-limit", user.userId()).session(a.session()).contentType(MediaType.APPLICATION_JSON).content("{\"aiDailyLimit\":" + invalid + "}"), csrf(a.session()))).andExpect(status().isBadRequest());
        assertThat(userRepository.findById(a.userId()).orElseThrow().aiDailyLimit()).isNull();
    }
}
