package com.typeme.jung.content;

import com.typeme.jung.domain.JungContentStatus;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionCopy;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungPole;
import com.typeme.jung.domain.JungScoringPolicy;
import com.typeme.jung.domain.JungStage;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 新测内容包（不可变快照）。
 *
 * <p>一个包把「题目 + 逐题帮助 + 维度解释 + 计分政策」锁在一起，并用 {@code packageId} 版本化。
 * 已发布的 {@code packageId} 内容不得原地修改（改了就必须换新 ID），否则历史报告会解释不一致。
 *
 * <p><b>校验不在构造器里，在 {@link JungPackageLoader#validate}</b>。
 * 这里只保证结构自洽（不可变、索引正确、ID 不重复）。把"内容是否合规"的校验放在加载器，
 * 是因为校验需要跨题比较（题数、左右平衡、facet 覆盖、order 连续性、指纹），
 * 而这些要等**全部题目都读完**才能判；放在构造器里只能逐题抛第一个错，
 * 一次性列出全部问题的可定位清单反而做不到。
 *
 * <p>校验失败**直接启动失败**是刻意的 —— 题库里错一个极点，结果是"看起来能跑、类型全反"，
 * 靠肉眼几乎发现不了。
 */
public final class JungPackage {

    private final int schemaVersion;
    private final String packageId;
    private final String instrumentId;
    private final String revision;
    private final String scoringVersion;
    private final String reportContentVersion;
    private final String title;
    private final JungContentStatus contentStatus;
    private final JungScoringPolicy scoringPolicy;
    private final Map<JungDimension, JungDimensionCopy> dimensionCopy;
    private final List<JungItem> questions;
    private final Map<String, JungItem> byId;
    private final List<JungItem> baseItems;
    private final Map<JungDimension, List<JungItem>> baseByDimension;
    private final Map<JungDimension, List<JungItem>> clarificationByDimension;
    private final String sha256;

    public JungPackage(
            int schemaVersion,
            String packageId,
            String instrumentId,
            String revision,
            String scoringVersion,
            String reportContentVersion,
            String title,
            JungContentStatus contentStatus,
            JungScoringPolicy scoringPolicy,
            List<JungDimensionCopy> dimensionCopy,
            List<JungItem> questions,
            String sha256) {
        this.schemaVersion = schemaVersion;
        this.packageId = requireText(packageId, "packageId");
        this.instrumentId = requireText(instrumentId, "instrumentId");
        this.revision = requireText(revision, "revision");
        this.scoringVersion = requireText(scoringVersion, "scoringVersion");
        this.reportContentVersion = requireText(reportContentVersion, "reportContentVersion");
        this.title = requireText(title, "title");
        this.contentStatus = contentStatus == null ? JungContentStatus.DRAFT_REVIEW_PENDING : contentStatus;
        this.scoringPolicy = java.util.Objects.requireNonNull(scoringPolicy, "scoringPolicy");
        this.sha256 = requireText(sha256, "sha256");

        Map<JungDimension, JungDimensionCopy> copies = new EnumMap<>(JungDimension.class);
        for (JungDimensionCopy copy : dimensionCopy) {
            copies.put(copy.dimension(), copy);
        }
        this.dimensionCopy = Collections.unmodifiableMap(copies);

        List<JungItem> sorted = new ArrayList<>(questions);
        sorted.sort(java.util.Comparator.comparingInt(JungItem::order));
        this.questions = List.copyOf(sorted);

        Map<String, JungItem> index = new LinkedHashMap<>();
        Map<JungDimension, List<JungItem>> base = new EnumMap<>(JungDimension.class);
        Map<JungDimension, List<JungItem>> clar = new EnumMap<>(JungDimension.class);
        for (JungDimension dimension : JungDimension.values()) {
            base.put(dimension, new ArrayList<>());
            clar.put(dimension, new ArrayList<>());
        }
        List<JungItem> bases = new ArrayList<>();
        for (JungItem item : this.questions) {
            if (index.put(item.id(), item) != null) {
                throw new JungContentException("题目 ID 重复：" + item.id());
            }
            if (item.stage() == JungStage.BASE) {
                bases.add(item);
                base.get(item.dimension()).add(item);
            } else {
                clar.get(item.dimension()).add(item);
            }
        }
        this.byId = Collections.unmodifiableMap(index);
        this.baseItems = List.copyOf(bases);
        this.baseByDimension = freeze(base);
        this.clarificationByDimension = freeze(clar);
    }

    private static Map<JungDimension, List<JungItem>> freeze(Map<JungDimension, List<JungItem>> source) {
        Map<JungDimension, List<JungItem>> result = new EnumMap<>(JungDimension.class);
        source.forEach((dimension, items) -> result.put(dimension, List.copyOf(items)));
        return Collections.unmodifiableMap(result);
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new JungContentException("内容包字段不能为空：" + field);
        }
        return value;
    }

    public int schemaVersion() {
        return schemaVersion;
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

    public JungContentStatus contentStatus() {
        return contentStatus;
    }

    public JungScoringPolicy scoringPolicy() {
        return scoringPolicy;
    }

    public JungDimensionCopy copyOf(JungDimension dimension) {
        JungDimensionCopy copy = dimensionCopy.get(dimension);
        if (copy == null) {
            throw new JungContentException("缺少维度解释文案：" + dimension);
        }
        return copy;
    }

    public List<JungItem> questions() {
        return questions;
    }

    /** 主测 48 题，按 {@code order} 排（四维轮转）。 */
    public List<JungItem> baseItems() {
        return baseItems;
    }

    public List<JungItem> baseItems(JungDimension dimension) {
        return baseByDimension.get(dimension);
    }

    public List<JungItem> clarificationItems(JungDimension dimension) {
        return clarificationByDimension.get(dimension);
    }

    public JungItem item(String questionId) {
        return byId.get(questionId);
    }

    public boolean hasItem(String questionId) {
        return byId.containsKey(questionId);
    }

    public String sha256() {
        return sha256;
    }

    /**
     * 返回一个只换了 sha256 的副本。
     *
     * <p>哈希由加载器从**冻结的规范形**计算，不能直接相信内容文件里写的值
     * （否则手改内容再顺手改哈希就能骗过校验）。所以先构造出内容对象，
     * 再由加载器回填哈希。
     */
    public JungPackage withSha256(String newSha256) {
        return new JungPackage(
                schemaVersion, packageId, instrumentId, revision, scoringVersion,
                reportContentVersion, title, contentStatus, scoringPolicy,
                List.copyOf(dimensionCopy.values()), questions, newSha256);
    }

    /** 供日志与快照：维度顺序与题数摘要。 */
    public Map<String, Object> summary() {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("packageId", packageId);
        summary.put("instrumentId", instrumentId);
        summary.put("scoringVersion", scoringVersion);
        summary.put("reportContentVersion", reportContentVersion);
        summary.put("contentStatus", contentStatus.token());
        summary.put("sha256", sha256);
        summary.put("baseItems", baseItems.size());
        Map<String, Integer> perDimension = new LinkedHashMap<>();
        for (JungDimension dimension : JungDimension.values()) {
            perDimension.put(dimension.name(),
                    baseByDimension.get(dimension).size() + clarificationByDimension.get(dimension).size());
        }
        summary.put("itemsPerDimension", perDimension);
        return summary;
    }

    /** 该维两极的展示记号，供未加载内容包的调用方使用。 */
    public static List<JungPole> polesOf(JungDimension dimension) {
        return dimension.poles();
    }
}
