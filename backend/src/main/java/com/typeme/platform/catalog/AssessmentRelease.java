package com.typeme.platform.catalog;

import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungStage;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 一份**已发布的具体内容包**，以量表无关的方式暴露平台层需要的一切。
 *
 * <p>它不替换 {@link JungPackage} / {@link BigFivePackage}，而是给它们套一层中性视图：
 * 平台层（目录、attempt 生命周期、数据管理、AI 输入投影）只依赖这个视图，
 * 于是"接入大五不需要改 JungScorer、也不需要让大五假装有 EI/SN/TF/JP"。
 *
 * <p>三种构造方式（{@link #ofJung} / {@link #ofBigFive}）做的都是同一件事：
 * 把量表自己的字段映射成 {@link Item}。**任何**量表专属的判断都不应该出现在
 * 这个类以外的平台代码里。
 */
public final class AssessmentRelease {

    private final InstrumentKind kind;
    private final String packageId;
    private final String instrumentId;
    private final String revision;
    private final String scoringVersion;
    private final String reportContentVersion;
    private final String title;
    private final String contentStatus;
    private final int baseItemCount;
    private final int clarificationItemCount;
    private final int maxClarificationItems;
    private final List<String> dimensionCodes;
    private final List<Item> items;
    private final String sha256;
    private final JungPackage jungPackage;
    private final BigFivePackage bigFivePackage;

    private AssessmentRelease(
            InstrumentKind kind,
            String packageId,
            String instrumentId,
            String revision,
            String scoringVersion,
            String reportContentVersion,
            String title,
            String contentStatus,
            int baseItemCount,
            int clarificationItemCount,
            int maxClarificationItems,
            List<String> dimensionCodes,
            List<Item> items,
            String sha256,
            JungPackage jungPackage,
            BigFivePackage bigFivePackage) {
        this.kind = kind;
        this.packageId = packageId;
        this.instrumentId = instrumentId;
        this.revision = revision;
        this.scoringVersion = scoringVersion;
        this.reportContentVersion = reportContentVersion;
        this.title = title;
        this.contentStatus = contentStatus;
        this.baseItemCount = baseItemCount;
        this.clarificationItemCount = clarificationItemCount;
        this.maxClarificationItems = maxClarificationItems;
        this.dimensionCodes = List.copyOf(dimensionCodes);
        this.items = List.copyOf(items);
        this.sha256 = sha256;
        this.jungPackage = jungPackage;
        this.bigFivePackage = bigFivePackage;
    }

    public static AssessmentRelease ofJung(JungPackage pkg) {
        List<Item> items = new ArrayList<>(pkg.questions().size());
        int base = 0;
        int clarification = 0;
        for (JungItem item : pkg.questions()) {
            boolean isBase = item.stage() == JungStage.BASE;
            if (isBase) {
                base++;
            } else {
                clarification++;
            }
            items.add(new Item(
                    item.id(),
                    isBase ? "base" : "clarification",
                    item.dimension().name(),
                    item.order(),
                    item.order() <= pkg.baseItems().size(),
                    item.scenario(),
                    item.textLeft(),
                    item.textRight(),
                    String.valueOf(item.leftPole().letter()),
                    String.valueOf(item.rightPole().letter()),
                    null,
                    null,
                    item.help()));
        }
        return new AssessmentRelease(
                InstrumentKind.JUNG,
                pkg.packageId(),
                pkg.instrumentId(),
                pkg.revision(),
                pkg.scoringVersion(),
                pkg.reportContentVersion(),
                pkg.title(),
                pkg.contentStatus().token(),
                base,
                clarification,
                pkg.questions().size() - base,
                List.of(JungDimension.EI.name(), JungDimension.SN.name(),
                        JungDimension.TF.name(), JungDimension.JP.name()),
                items,
                pkg.sha256(),
                pkg,
                null);
    }

    public static AssessmentRelease ofBigFive(BigFivePackage pkg) {
        List<Item> items = new ArrayList<>(pkg.questions().size());
        for (BigFiveItem item : pkg.questions()) {
            items.add(new Item(
                    item.id(),
                    "base",
                    item.dimension().code(),
                    item.order(),
                    true,
                    null,
                    null,
                    null,
                    null,
                    null,
                    item.text(),
                    item.direction(),
                    item.help()));
        }
        List<String> dimensionCodes = new ArrayList<>();
        for (BigFiveDimension dimension : BigFiveDimension.ordered()) {
            dimensionCodes.add(dimension.code());
        }
        return new AssessmentRelease(
                InstrumentKind.BIG_FIVE,
                pkg.packageId(),
                pkg.instrumentId(),
                pkg.revision(),
                pkg.scoringVersion(),
                pkg.reportContentVersion(),
                pkg.title(),
                pkg.contentStatus(),
                pkg.questions().size(),
                0,
                0,
                dimensionCodes,
                items,
                pkg.sha256(),
                null,
                pkg);
    }

    public InstrumentKind kind() {
        return kind;
    }

    public String packageId() {
        return packageId;
    }

    public String instrumentId() {
        return instrumentId;
    }

    public String revision() {
        return revision;
    }

    public String scoringVersion() {
        return scoringVersion;
    }

    public String reportContentVersion() {
        return reportContentVersion;
    }

    public String title() {
        return title;
    }

    public String contentStatus() {
        return contentStatus;
    }

    /** 主测题数（用户实际要答的那一轮）。 */
    public int baseItemCount() {
        return baseItemCount;
    }

    /** 补充题总题数（大五为 0）。 */
    public int clarificationItemCount() {
        return clarificationItemCount;
    }

    /** 补充题上限（大五为 0）。 */
    public int maxClarificationItems() {
        return maxClarificationItems;
    }

    public List<String> dimensionCodes() {
        return dimensionCodes;
    }

    public List<Item> items() {
        return items;
    }

    public String sha256() {
        return sha256;
    }

    /** 底层的十六型包；不是十六型时为 {@code null}。 */
    public JungPackage jung() {
        return jungPackage;
    }

    /** 底层的大五包；不是大五时为 {@code null}。 */
    public BigFivePackage bigFive() {
        return bigFivePackage;
    }

    public boolean hasTypeCode() {
        return kind.hasTypeCode();
    }

    /**
     * 一份题目在平台层的统一视图。
     *
     * @param id             题号（落库到 {@code assessment_answer.question_id}）
     * @param stage          {@code base} / {@code clarification}
     * @param dimension      量表自己的维度 code（十六型是 EI/SN/TF/JP，大五是 E/A/C/ES/O）
     * @param order          展示顺序
     * @param inBaseRound    是否属于主测那一轮
     * @param scenario       双极题的场景提示；大五为 null
     * @param textLeft       双极题左端；大五为 null
     * @param textRight      双极题右端；大五为 null
     * @param leftPole       双极题左端记号；大五为 null
     * @param rightPole      双极题右端记号；大五为 null
     * @param statement      单句题的题面；双极题为 null
     * @param direction      单句题的计分方向（+1 / -1）；双极题为 null
     * @param help           逐题解释
     */
    public record Item(
            String id,
            String stage,
            String dimension,
            int order,
            boolean inBaseRound,
            String scenario,
            String textLeft,
            String textRight,
            String leftPole,
            String rightPole,
            String statement,
            Integer direction,
            String help) {

        public boolean isClarification() {
            return "clarification".equals(stage);
        }
    }

    /** 供日志与接口回显的结构摘要（不含题面）。 */
    public Map<String, Object> summary() {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("packageId", packageId);
        summary.put("instrumentId", instrumentId);
        summary.put("kind", kind.code());
        summary.put("scoringVersion", scoringVersion);
        summary.put("reportContentVersion", reportContentVersion);
        summary.put("contentStatus", contentStatus);
        summary.put("sha256", sha256);
        summary.put("baseItems", baseItemCount);
        summary.put("clarificationItems", clarificationItemCount);
        summary.put("dimensions", dimensionCodes);
        return summary;
    }
}
