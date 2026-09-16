package com.typeme.account.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Pattern;

/** {@code PUT /api/v3/admin/users/{id}/role} 请求体。 */
public record AdminUpdateRoleRequest(
        @JsonProperty("role")
        @Pattern(regexp = "USER|ADMIN", message = "role 只能是 USER 或 ADMIN")
        String role
) {
}
