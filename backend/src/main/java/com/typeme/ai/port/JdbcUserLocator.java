package com.typeme.ai.port;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;

/**
 * {@link UserLocator} 的生产实现：直查 {@code app_user.status}（契约 02 §2.1）。
 *
 * <p>三类返回值区分得很清楚，因为它们的**处置完全不同**：
 * <ul>
 *   <li>{@link UserState#ACTIVE}：继续处理；</li>
 *   <li>{@link UserState#INACTIVE}/{@link UserState#ABSENT}：账号不可用 → 丢掉结果、任务 {@code CANCELLED}
 *       （与"报告已删除"同一种处置：不重建已注销账号的数据）；</li>
 *   <li>{@link UserState#UNKNOWN}：**基础设施问题**，不能据此拒绝 —— 让任务按原逻辑继续或退避，
 *       否则数据库抖一下就会把用户在跑的任务全部判失败。</li>
 * </ul>
 */
@Component
public class JdbcUserLocator implements UserLocator {

    private final JdbcTemplate jdbcTemplate;

    public JdbcUserLocator(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public UserState locate(String userId) {
        if (userId == null || userId.isBlank()) {
            return UserState.ABSENT;
        }
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT status FROM app_user WHERE id = ?", userId);
            if (rows.isEmpty()) {
                return UserState.ABSENT;
            }
            Object status = rows.get(0).get("status");
            if (status == null) {
                return UserState.UNKNOWN;
            }
            return "ACTIVE".equalsIgnoreCase(String.valueOf(status).trim())
                    ? UserState.ACTIVE : UserState.INACTIVE;
        } catch (DataAccessException ex) {
            // 表结构不符/数据库不可用：无法判断，交给调用方按"不要拒绝"处理。
            return UserState.UNKNOWN;
        }
    }
}
