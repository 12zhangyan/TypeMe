package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** {@code PATCH /api/v3/me} 请求体：只允许改昵称（owner 与 role 不在 DTO 里，客户端无从指定）。 */
public record UpdateNicknameRequest(
        @NotBlank(message = "昵称不能为空")
        @Size(max = AccountFieldRules.NICKNAME_MAX, message = "昵称最多 32 个字符")
        @Pattern(regexp = AccountFieldRules.NICKNAME_NON_BLANK_PATTERN,
                message = "昵称需为 1–32 个字符且不能只含空白")
        String nickname
) {
}
