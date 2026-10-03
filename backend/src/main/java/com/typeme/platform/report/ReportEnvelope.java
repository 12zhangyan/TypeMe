package com.typeme.platform.report;

import com.typeme.platform.catalog.AssessmentRelease;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 报告的中性外壳：每份报告都能说清"它是什么量表、哪一版内容、什么时候算的"。
 *
 * <p><b>为什么需要这一层。</b>改造前的报告 JSON 只有一份 schema，
 * 前端解析器（{@code reportV3.ts}）从根节点直接读 {@code computedTypeCode}、{@code dimensions}
 * （四个维度）、{@code dynamics}，也就是说"报告"在类型层面就等于"十六型报告"。
 * 再加一种量表，要么让大五在 JSON 里伪造四个维度与类型码，要么在每个消费端加分支 ——
 * 两者都不该做。
 *
 * <p>所以报告 JSON 分成两个明确的层次：
 *
 * <pre>
 * {
 *   "schemaVersion": 2,
 *   "instrument": { "slug": "...", "kind": "big_five", "packageId": "...", ... },
 *   "reportKind": "big_five",
 *   "report": { ...量表自己的报告体... }
 * }
 * </pre>
 *
 * <p>三条约束：
 * <ol>
 *   <li>{@code reportKind} 决定用哪个渲染器，前端**不看** {@code instrument.kind} 做判断
 *       （kind 是给"这件事属于哪一族"用的，reportKind 是"这份 JSON 的 body 是什么形状"）；</li>
 *   <li>旧报告（{@code schemaVersion = 1}，没有这一层）**必须继续可读** ——
 *       它们的 {@code report} 体就是根节点本身，因此解析器先看 {@code schemaVersion}
 *       再决定是否下钻，绝不去改写历史报告；</li>
 *   <li>外壳里不出现任何"结论"字段（没有分数、没有类型码），它只描述"这份报告是谁的、
 *       按哪一版算的"。结论一律在 {@code report} 体里，由量表自己的构造器负责。</li>
 * </ol>
 */
public final class ReportEnvelope {

    /** 当前报告外壳版本。加这一层时从 1 升到 2。 */
    public static final int SCHEMA_VERSION = 2;

    /** 外壳里的 {@code reportKind}：十六型参考测评。 */
    public static final String KIND_JUNG = "jung_reference";

    /** 外壳里的 {@code reportKind}：大五倾向测评。 */
    public static final String KIND_BIG_FIVE = "big_five_profile";

    private ReportEnvelope() {
    }

    /**
     * 组装外壳。
     *
     * @param release  报告所依据的内容版本
     * @param reportId 报告 id
     * @param attemptId 测评 attempt id
     * @param createdAtUtc 创建时间（ISO-8601 UTC）
     * @param body     量表自己的报告体
     */
    public static Map<String, Object> wrap(
            AssessmentRelease release,
            String reportId,
            String attemptId,
            String createdAtUtc,
            Map<String, Object> body) {

        Map<String, Object> instrument = new LinkedHashMap<>();
        instrument.put("slug", slugOf(release));
        instrument.put("id", release.instrumentId());
        instrument.put("kind", release.kind().code());
        instrument.put("title", release.title());
        instrument.put("packageId", release.packageId());
        instrument.put("revision", release.revision());
        instrument.put("scoringVersion", release.scoringVersion());
        instrument.put("reportContentVersion", release.reportContentVersion());
        instrument.put("contentStatus", release.contentStatus());
        instrument.put("contentSha256", release.sha256());
        instrument.put("hasTypeCode", release.hasTypeCode());

        Map<String, Object> envelope = new LinkedHashMap<>();
        envelope.put("schemaVersion", SCHEMA_VERSION);
        envelope.put("instrument", instrument);
        envelope.put("reportKind", reportKindOf(release));
        envelope.put("reportId", reportId);
        envelope.put("attemptId", attemptId);
        envelope.put("createdAt", createdAtUtc);
        envelope.put("report", body);
        return envelope;
    }

    /**
     * release → 对外 slug。
     *
     * <p>按 packageId 前缀判断而不是 {@code kind}，这样"同一族里有两个版本"
     * 也不会因为 kind 相同就把 slug 串到另一项测评上；将来同一族里出现两项测评
     * （例如两个不同的大五中文版本）时，这里必须改成查目录，改动点是唯一的。
     */
    public static String slugOf(AssessmentRelease release) {
        String packageId = release.packageId();
        if (packageId.startsWith("typeme-bigfive50-")) {
            return "bigfive50";
        }
        if (packageId.startsWith("typeme-jung48-")) {
            return "jung48";
        }
        throw new IllegalArgumentException("内容包不属于任何已登记的测评：" + packageId);
    }

    public static String reportKindOf(AssessmentRelease release) {
        return switch (release.kind()) {
            case JUNG -> KIND_JUNG;
            case BIG_FIVE -> KIND_BIG_FIVE;
        };
    }
}
