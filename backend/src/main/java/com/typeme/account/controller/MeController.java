package com.typeme.account.controller;

import com.typeme.account.dto.ChangePasswordRequest;
import com.typeme.account.dto.DeleteAccountRequest;
import com.typeme.account.dto.DeleteAccountResponse;
import com.typeme.account.dto.MeResponse;
import com.typeme.account.dto.RecoveryCodesResponse;
import com.typeme.account.dto.RegenerateRecoveryCodesRequest;
import com.typeme.account.dto.UpdateNicknameRequest;
import com.typeme.account.repository.UserRecord;
import com.typeme.account.service.AccountDeletionService;
import com.typeme.account.service.AccountService;
import com.typeme.account.service.DataExportService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * {@code /api/v3/me/**}（契约 §7.2 账号）。
 *
 * <p>所有方法都通过 {@link CurrentUser} 拿 userId —— 没有任何一个方法从请求体里读 owner/id。
 * 这是账号隔离的实现基础：接口层面就做不到"操作别人的数据"。
 */
@RestController
@RequestMapping("/api/v3/me")
public class MeController {

    private final CurrentUser currentUser;
    private final AccountService accountService;
    private final AccountDeletionService deletionService;
    private final DataExportService exportService;

    public MeController(CurrentUser currentUser, AccountService accountService,
                        AccountDeletionService deletionService, DataExportService exportService) {
        this.currentUser = currentUser;
        this.accountService = accountService;
        this.deletionService = deletionService;
        this.exportService = exportService;
    }

    /** 当前账号基本资料。 */
    @GetMapping
    public ResponseEntity<MeResponse> me() {
        UserRecord user = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(accountService.currentUser(user.id()));
    }

    /** 改昵称。只能改昵称：owner/role 不在请求 DTO 里，客户端无从指定。 */
    @PatchMapping
    public ResponseEntity<MeResponse> updateMe(@Valid @RequestBody UpdateNicknameRequest request) {
        UserRecord user = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(accountService.updateNickname(user.id(), request.nickname()));
    }

    /**
     * 改密：校验旧密码，改完撤销**除当前会话外**的全部会话。
     *
     * <p>当前会话 id 从请求里取（而不是从 body）：客户端无法用参数影响"保留哪个会话"。
     */
    @PostMapping("/password")
    public ResponseEntity<Void> changePassword(@Valid @RequestBody ChangePasswordRequest request,
                                               HttpServletRequest httpRequest) {
        UserRecord user = currentUser.require();
        accountService.changePassword(user.id(), CurrentUser.currentSessionId(httpRequest),
                request.currentPassword(), request.newPassword());
        return ResponseEntity.noContent().build();
    }

    /** 重新生成恢复码：需重新验证密码，旧码全部作废，新码只返回一次。 */
    @PostMapping("/recovery-codes")
    public ResponseEntity<RecoveryCodesResponse> regenerateRecoveryCodes(
            @Valid @RequestBody RegenerateRecoveryCodesRequest request) {
        UserRecord user = currentUser.require();
        RecoveryCodesResponse response = accountService.regenerateRecoveryCodes(
                user.id(), request.currentPassword());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    /**
     * 导出个人数据（JSON 附件）。
     *
     * <p>用 {@code Content-Disposition: attachment} + {@code no-store}：导出文件含个人答卷，
     * 不该被浏览器内联渲染，也不该进任何共享缓存。
     */
    @GetMapping("/export")
    public ResponseEntity<Map<String, Object>> export() {
        UserRecord user = currentUser.require();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header("Content-Disposition", "attachment; filename=\"typeme-export.json\"")
                .body(exportService.export(user));
    }

    /**
     * 注销：需要密码 + 逐字 {@code DELETE}；返回 202 与删除任务 id。
     *
     * <p>返回 202（而不是 204）是刻意的：清理是异步的，客户端据此知道"请求已受理，
     * 数据后续会被删除"，而不是"已经删完了"。
     */
    @DeleteMapping
    public ResponseEntity<DeleteAccountResponse> deleteAccount(@Valid @RequestBody DeleteAccountRequest request,
                                                               HttpServletRequest httpRequest) {
        UserRecord user = currentUser.require();
        DeleteAccountResponse response = deletionService.requestDeletion(
                user.id(), request.password(), httpRequest);
        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .cacheControl(CacheControl.noStore())
                .body(response);
    }
}
