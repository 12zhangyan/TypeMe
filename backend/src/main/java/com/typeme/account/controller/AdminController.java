package com.typeme.account.controller;

import com.typeme.account.dto.AdminAiSettingsUpdateRequest;
import com.typeme.account.dto.AdminUpdateRoleRequest;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.service.AiSettingsService;
import com.typeme.account.service.AdminUserService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * {@code /api/v3/admin/**} 管理后台（本次新增需求）。
 *
 * <p><b>授权模型</b>：整类加 {@code @PreAuthorize("hasRole('ADMIN')")}，
 * 而不是只在方法上零散加注解 —— 类级注解意味着"新增一个方法默认就是 ADMIN-only"，
 * 忘记加注解的失败方向是"更严格"而不是"更宽松"。这是安全默认值该有的方向。
 *
 * <p>非 ADMIN 已登录用户得到的响应由 {@code AccessDeniedHandler} 给出：
 * {@code 403 FORBIDDEN} 的契约 JSON（不是 HTML、不是重定向、也不是 404）。
 */
@RestController
@RequestMapping("/api/v3/admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminController {

    private final AdminUserService adminUserService;
    private final AiSettingsService aiSettingsService;
    private final CurrentUser currentUser;

    public AdminController(AdminUserService adminUserService, AiSettingsService aiSettingsService,
                           CurrentUser currentUser) {
        this.adminUserService = adminUserService;
        this.aiSettingsService = aiSettingsService;
        this.currentUser = currentUser;
    }

    // ------------------------------------------------------------------ AI 设置

    /** 读取 AI 设置：只回非敏感字段 + key 的存在性与指纹，绝不回明文/密文。 */
    @GetMapping("/ai-settings")
    public ResponseEntity<Map<String, Object>> aiSettings() {
        currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(aiSettingsService.adminView());
    }

    /** 更新 AI 设置；{@code apiKey} 只写不读（null=不改、空串=清除）。 */
    @PutMapping("/ai-settings")
    public ResponseEntity<Map<String, Object>> updateAiSettings(
            @Valid @RequestBody AdminAiSettingsUpdateRequest request) {
        UserRecord admin = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(aiSettingsService.update(request, admin.id()));
    }

    // ------------------------------------------------------------------ 用户管理

    /** 分页列出用户（不回密码 hash）。 */
    @GetMapping("/users")
    public ResponseEntity<Map<String, Object>> users(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminUserService.list(page, size));
    }

    /** 改角色。不能把自己降级（否则可能无人可管后台）。 */
    @PutMapping("/users/{id}/role")
    public ResponseEntity<Map<String, Object>> updateRole(@PathVariable("id") String userId,
                                                          @Valid @RequestBody AdminUpdateRoleRequest request) {
        UserRecord admin = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminUserService.updateRole(admin.id(), userId, request.role()));
    }

    public record AiLimitRequest(@jakarta.validation.constraints.NotNull
            @jakarta.validation.constraints.Min(0) @jakarta.validation.constraints.Max(10000)
            @jakarta.validation.constraints.Digits(integer = 5, fraction = 0) java.math.BigDecimal aiDailyLimit) {}

    @PutMapping("/users/{id}/ai-limit")
    public ResponseEntity<Map<String, Object>> updateAiLimit(@PathVariable("id") String userId, @Valid @RequestBody AiLimitRequest request) {
        currentUser.require();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(adminUserService.updateAiDailyLimit(userId, request.aiDailyLimit().intValueExact()));
    }

    /** 禁用账号并撤销其全部会话。不能禁用自己。 */
    @PostMapping("/users/{id}/disable")
    public ResponseEntity<Map<String, Object>> disable(@PathVariable("id") String userId) {
        UserRecord admin = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(adminUserService.disable(admin.id(), userId));
    }
}
