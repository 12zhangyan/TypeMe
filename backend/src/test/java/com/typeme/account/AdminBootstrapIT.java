package com.typeme.account;

import com.typeme.account.service.AdminBootstrapService;
import com.typeme.account.service.TypemeProperties;
import com.typeme.account.repository.AiSettingRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import static org.assertj.core.api.Assertions.*;

@org.springframework.test.context.TestPropertySource(properties = "typeme.admin.bootstrap-username=typeme_admin")
class AdminBootstrapIT extends AccountIntegrationTestBase {
    @Autowired PasswordEncoder encoder;
    @Autowired PlatformTransactionManager transactions;
    @Autowired AiSettingRepository settings;

    private AdminBootstrapService bootstrap(String name, String password) {
        var properties = new TypemeProperties(null, null, null, new TypemeProperties.Admin(name, password), null);
        return new AdminBootstrapService(userRepository, properties, settings, invitationJdbc, encoder, transactions);
    }
    @Test
    void createsOnlyFromConfiguredSecretAndNeverElevatesExistingAccount() throws Exception {
        String name = uniqueUsername("bootstrap");
        String password = java.util.UUID.randomUUID().toString();
        assertThat(bootstrap(name, "").promoteBootstrapUserIfNeeded()).isFalse();
        assertThat(userRepository.findByNormalizedUsername(name)).isEmpty();
        var ordinary = register(uniqueUsername("occupied"), password);
        String occupied = bodyName(ordinary.userId());
        assertThatThrownBy(() -> bootstrap(occupied, password).promoteBootstrapUserIfNeeded()).isInstanceOf(IllegalStateException.class);
        assertThat(userRepository.findById(ordinary.userId()).orElseThrow().role()).isEqualTo("USER");
        assertThat(bootstrap(name, password).promoteBootstrapUserIfNeeded()).isTrue();
        var admin = userRepository.findByNormalizedUsername(name).orElseThrow();
        assertThat(admin.role()).isEqualTo("ADMIN");
        assertThat(encoder.matches(password, admin.passwordHash())).isTrue();
        assertThat(bootstrap(name, java.util.UUID.randomUUID().toString()).promoteBootstrapUserIfNeeded()).isFalse();
        assertThat(userRepository.findById(admin.id()).orElseThrow().passwordHash()).isEqualTo(admin.passwordHash());
        var session = new org.springframework.mock.web.MockHttpSession();
        assertThat(login(csrf(session), session, name, password, uniqueIp()).getResponse().getStatus()).isEqualTo(200);
        assertThat(mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v3/admin/users").session(session)).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(new TypemeProperties.Admin(name, password).toString()).doesNotContain(password);
    }
    @Test void reservedBootstrapNameCannotBeSelfRegistered() throws Exception {
        var registered = register("typeme_admin", java.util.UUID.randomUUID().toString());
        assertThat(registered.status()).isEqualTo(400);
        assertThat(userRepository.findByNormalizedUsername("typeme_admin")).isEmpty();
    }
    private String bodyName(String id) { return userRepository.findById(id).orElseThrow().usernameDisplay(); }
}
