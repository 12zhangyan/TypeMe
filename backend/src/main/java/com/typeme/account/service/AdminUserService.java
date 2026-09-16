package com.typeme.account.service;

import com.typeme.account.repository.UserRecord;
import com.typeme.account.repository.UserRepository;
import com.typeme.common.ApiErrorCodes;
import com.typeme.common.ApiException;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 管理员后台的账号管理（本次新增需求）。
 *
 * <p>三条不能忘的自我保护规则，每条都对应一个会把系统锁死的操作：
 * <ol>
 *   <li><b>不能把自己降级成 USER</b>：如果他是唯一的管理员，降级之后就再也没人能配 AI key、
 *       没人能改别人角色了 —— 只能改数据库。返回 400 而不是 403，因为这是"请求不合法"。</li>
 *   <li><b>不能禁用自己</b>：禁用会撤销自己全部会话，等于把自己踢出后台，且同样可能无人可管。</li>
 *   <li><b>密码 hash 永不出现在响应里</b>：本类的返回结构体里根本没有这个字段，
 *       而不是"记得别放"。</li>
 * </ol>
 *
 * <p>另外，报告数用 {@code LEFT JOIN} 聚合不出来时（并行迁移未落盘）回落到 {@code null}，
 * 而不是 0：0 与"未知"在后台页面上是两件事，把未知显示成 0 会误导管理员。
 */
@Service
public class AdminUserService {

    /** 单页最大条数：防止一次请求把整张用户表拉出来。 */
    private static final int MAX_PAGE_SIZE = 100;

    private final UserRepository users;
    private final JdbcTemplate jdbc;
    private final AccountService accountService;

    public AdminUserService(UserRepository users, JdbcTemplate jdbc, AccountService accountService) {
        this.users = users;
        this.jdbc = jdbc;
        this.accountService = accountService;
    }

    /** 分页列出用户。{@code page} 从 0 开始（与内部 offset 语义一致，避免 off-by-one 反复出错）。 */
    public Map<String, Object> list(int page, int size) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.max(page, 0);
        List<UserRecord> rows = users.page(safePage * safeSize, safeSize);
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (UserRecord user : rows) {
            items.add(view(user));
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("items", items);
        response.put("page", safePage);
        response.put("size", safeSize);
        response.put("total", users.count());
        return response;
    }

    /** 改角色。自己不能降级（见类注释）。 */
    @Transactional
    public Map<String, Object> updateRole(String actingAdminId, String targetUserId, String role) {
        if (!UserRecord.ROLE_ADMIN.equals(role) && !UserRecord.ROLE_USER.equals(role)) {
            throw ApiException.validation("role 只能是 USER 或 ADMIN。", Map.of("role", "取值非法"));
        }
        if (actingAdminId.equals(targetUserId) && UserRecord.ROLE_USER.equals(role)) {
            // 400：这是"你不能这么请求"，不是"你没权限"。
            throw new ApiException(ApiErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST,
                    "不能把自己降级为 USER：一旦系统中不再有管理员，后台将无人可维护。",
                    Map.of("role", "不能自我降级"));
        }
        UserRecord target = users.findById(targetUserId)
                .orElseThrow(ApiException::notFound);
        users.updateRole(target.id(), role);
        if (UserRecord.ROLE_USER.equals(role)) {
            // 被降级的人不应继续持有管理员会话带来的隐式信任：撤销其会话，强制重新登录。
            // （权限本身每个请求都重新判定，这里撤销是为了让"降级"立刻体现在界面上。）
            accountService.revokeAllSessions(target.id());
        }
        return view(users.findById(target.id()).orElse(target));
    }

    /** 禁用账号：置 DISABLED 并撤销其全部会话；不允许禁用自己。 */
    @Transactional
    public Map<String, Object> disable(String actingAdminId, String targetUserId) {
        if (actingAdminId.equals(targetUserId)) {
            throw new ApiException(ApiErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST,
                    "不能禁用自己。", Map.of("userId", "不能禁用当前登录账号"));
        }
        UserRecord target = users.findById(targetUserId)
                .orElseThrow(ApiException::notFound);
        users.markDisabled(target.id());
        accountService.revokeAllSessions(target.id());
        return view(users.findById(target.id()).orElse(target));
    }

    private Map<String, Object> view(UserRecord user) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", user.id());
        item.put("username", user.usernameDisplay());
        item.put("nickname", user.nickname());
        item.put("role", user.role());
        item.put("status", user.status());
        item.put("createdAt", user.createdAt() == null ? null : user.createdAt().toString());
        item.put("reportCount", reportCount(user.id()));
        // 刻意不含 password_hash / recovery_code_version / session 信息。
        return item;
    }

    /**
     * 报告数。表不存在或查询失败时返回 {@code null}（"未知"），不是 0。
     */
    private Long reportCount(String userId) {
        try {
            return jdbc.queryForObject(
                    "SELECT COUNT(*) FROM assessment_report WHERE user_id = ?", Long.class, userId);
        } catch (DataAccessException ex) {
            return null;
        }
    }
}
