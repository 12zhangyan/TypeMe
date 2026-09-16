package com.typeme.ai.port;

import java.util.Optional;

/**
 * 读取"某一份报告在发送时的那一个快照"的只读端口。
 *
 * <p>为什么要这层端口而不是直接依赖 {@code com.typeme.jung} 的服务类：
 * <ul>
 *   <li>新测模块在并行开发，AI 模块不能在编译期绑到它的类名上；</li>
 *   <li>这条链路上真正需要的只有"报告快照 + 归属 + 答案集"，接口越小越不容易被人改坏。</li>
 * </ul>
 *
 * <p>生产实现 {@link com.typeme.ai.port.JdbcReportSnapshotReader} 用 {@code JdbcTemplate}
 * 直查 {@code assessment_report} / {@code assessment_attempt} / {@code assessment_answer} /
 * {@code assessment_package}（表名列名见契约 02 §3、§4）。
 */
public interface ReportSnapshotReader {

    /**
     * 读取报告快照。
     *
     * <p>实现必须返回 {@link Optional#empty()} 表示"不存在"，而**不是**抛异常：
     * worker 写回结果前要用它重新确认报告是否已被删除（晚到结果必须被丢弃）。
     */
    Optional<AiReportSnapshot> find(String reportId);

    /**
     * 报告及其输入材料的一次快照。
     *
     * @param reportId        报告 id
     * @param userId          报告归属用户（用于"属于该 userId 才可见"的过滤）
     * @param status          {@code REFERENCE}/{@code TENTATIVE}/{@code TIED}
     * @param computedTypeCode 后端算出的类型码；TIED 时为 null
     * @param reportHash      报告内容 hash（进 request_hash）
     * @param attemptId       当前 attempt id
     * @param baseAttemptId   派生源 attempt id（复测时非空），答案需要合并
     * @param packageId       锁定的内容包 id
     * @param contentJson     内容包 JSON（题目极点来源）
     * @param answers         合并后的答案（questionId → 答案）
     * @param reportJson      §7 的报告快照 JSON（作为发送材料的权威来源）
     */
    record AiReportSnapshot(
            String reportId,
            String userId,
            String status,
            String computedTypeCode,
            String reportHash,
            String attemptId,
            String baseAttemptId,
            String packageId,
            String contentJson,
            java.util.Map<String, Answer> answers,
            String reportJson) {

        /** 单题答案。{@code kind} 只有 {@code RATING} / {@code UNKNOWN} 两种（契约 01 §3）。 */
        public record Answer(String questionId, String kind, Integer rating) {

            public boolean rated() {
                return "RATING".equals(kind) && rating != null;
            }

            public boolean unknown() {
                return "UNKNOWN".equals(kind);
            }
        }
    }
}
