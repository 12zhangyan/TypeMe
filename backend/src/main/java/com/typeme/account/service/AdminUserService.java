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

    /** 批量改额度一次最多的人数：与成员页每页条数一致，只作用于当前页（需求 Q-1）；服务端强制，不只靠前端。 */
    public static final int MAX_BATCH_SIZE = 20;

    private final UserRepository users;
    private final JdbcTemplate jdbc;
    private final AccountService accountService;
    private final com.typeme.ai.config.AiRuntimeSettingsProvider aiSettings;
    private final com.typeme.ai.service.AiBudgetRepository budgets;

    public AdminUserService(UserRepository users, JdbcTemplate jdbc, AccountService accountService, com.typeme.ai.config.AiRuntimeSettingsProvider aiSettings, com.typeme.ai.service.AiBudgetRepository budgets) {
        this.users = users;
        this.jdbc = jdbc;
        this.accountService = accountService;
        this.aiSettings = aiSettings;
        this.budgets = budgets;
    }

    /**
     * 分页列出用户。{@code page} 从 0 开始（与内部 offset 语义一致，避免 off-by-one 反复出错）。
     * {@code aiExhausted} 为 true 时只列今日（UTC 日）AI 次数已用完的用户，{@code total} 为筛选后的人数。
     */
    public Map<String, Object> list(int page, int size, boolean aiExhausted) {
        int safeSize = Math.min(Math.max(size, 1), MAX_PAGE_SIZE);
        int safePage = Math.min(Math.max(page, 0), 100000);
        List<UserRecord> rows;
        long total;
        if (aiExhausted) {
            var quotaDate = budgets.today();
            int siteDefault = aiSettings.settings().dailyLimitPerUser();
            rows = users.pageAiExhausted(quotaDate, siteDefault, safePage * safeSize, safeSize);
            total = users.countAiExhausted(quotaDate, siteDefault);
        } else {
            rows = users.page(safePage * safeSize, safeSize);
            total = users.count();
        }
        List<Map<String, Object>> items = new ArrayList<>(rows.size());
        for (UserRecord user : rows) {
            items.add(view(user));
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("items", items);
        response.put("page", safePage);
        response.put("size", safeSize);
        response.put("total", total);
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

    public Map<String, Object> updateAiDailyLimit(String targetUserId, Integer limit) {
        if (limit == null || limit < 0 || limit > 10000) throw ApiException.validation("每日 AI 次数需为 0–10000。", Map.of("aiDailyLimit", "范围无效"));
        UserRecord target = users.findById(targetUserId).filter(u -> !"DELETED".equals(u.status())).orElseThrow(ApiException::notFound);
        users.updateAiDailyLimit(target.id(), limit);
        return view(users.findById(target.id()).orElse(target));
    }

    /**
     * 批量修改每日 AI 额度。{@code SET} 统一设为同一数值；{@code RESET_DEFAULT} 清除单独额度（置 NULL），
     * 之后跟随站点默认——用显式 action 而不是"传 null"，避免漏传字段时静默清掉一批人的额度。
     * 先整体校验，任一项不合法就 400 且一个人都不改；通过后逐人更新：每人独立生效，
     * 已删除或不存在的记为失败，成功的保留，不整批回滚。只改额度本身，不动今日已用次数。
     */
    public Map<String, Object> batchUpdateAiDailyLimit(List<String> userIds, String action, Integer limit) {
        if (userIds == null || userIds.isEmpty() || userIds.size() > MAX_BATCH_SIZE) {
            throw ApiException.validation("一次需选择 1–" + MAX_BATCH_SIZE + " 位成员。", Map.of("userIds", "数量无效"));
        }
        if (new java.util.HashSet<>(userIds).size() != userIds.size()) {
            throw ApiException.validation("同一位成员不能重复选择。", Map.of("userIds", "有重复"));
        }
        boolean resetToDefault = "RESET_DEFAULT".equals(action);
        if (!resetToDefault && !"SET".equals(action)) {
            throw ApiException.validation("action 只能是 SET 或 RESET_DEFAULT。", Map.of("action", "取值非法"));
        }
        if (resetToDefault && limit != null) {
            throw ApiException.validation("恢复默认时不能同时指定额度。", Map.of("aiDailyLimit", "不应提供"));
        }
        if (!resetToDefault && (limit == null || limit < 0 || limit > 10000)) {
            throw ApiException.validation("每日 AI 次数需为 0–10000。", Map.of("aiDailyLimit", "范围无效"));
        }
        Integer newLimit = resetToDefault ? null : limit;
        List<Map<String, Object>> results = new ArrayList<>(userIds.size());
        int updated = 0;
        for (String userId : userIds) {
            var target = users.findById(userId).filter(u -> !UserRecord.STATUS_DELETED.equals(u.status()));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("userId", userId);
            if (target.isEmpty()) {
                result.put("ok", false);
                result.put("code", ApiErrorCodes.NOT_FOUND);
                result.put("message", "成员不存在或已删除。");
            } else {
                users.updateAiDailyLimit(userId, newLimit);
                result.put("ok", true);
                result.put("member", view(users.findById(userId).orElse(target.get())));
                updated++;
            }
            results.add(result);
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("updated", updated);
        response.put("failed", userIds.size() - updated);
        response.put("results", results);
        return response;
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
        item.put("aiDailyLimit", user.aiDailyLimit());
        int limit = user.aiDailyLimit() == null ? aiSettings.settings().dailyLimitPerUser() : user.aiDailyLimit();
        item.put("effectiveAiDailyLimit", limit);
        var quotaDate = budgets.today();
        int used = budgets.reservedCalls("user:" + user.id(), quotaDate);
        item.put("aiUsedToday", used);
        item.put("aiRemainingToday", Math.max(0, limit - used));
        item.put("quotaDate", quotaDate.toString());
        item.put("attemptCount", jdbc.queryForObject("SELECT COUNT(*) FROM assessment_attempt WHERE user_id = ?", Long.class, user.id()));
        var lastSeen = jdbc.queryForObject("SELECT MAX(last_seen_at) FROM app_user_session WHERE user_id = ?", java.sql.Timestamp.class, user.id());
        item.put("lastSeenAt", lastSeen == null ? null : lastSeen.toInstant().toString());
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
