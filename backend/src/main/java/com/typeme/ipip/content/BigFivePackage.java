package com.typeme.ipip.content;

import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.ipip.domain.BigFiveScoringPolicy;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 大五（IPIP-50）内容包（不可变快照）。
 *
 * <p>与 {@code com.typeme.jung.content.JungPackage} 是**并列关系**，不是继承关系：
 * 两份量表的题目形状（双极 vs 单句贴切度）、判定规则（四维取符号 vs 五维分档）、
 * 报告结构（四字母 + 过程层 vs 五维 + 无类型码）都不同。硬塞进一个共同父类，
 * 结果一定是"大五假装有 EI/SN/TF/JP"或者"公共层到处出现 if (isJung)"。
 *
 * <p>共同的是**平台层**要的东西：packageId / instrumentId / 版本 / 题目列表 /
 * 完成规则 / 缺答语义。这些由 {@code com.typeme.platform.release.AssessmentRelease}
 * 以中性视图暴露。
 *
 * <p>校验在 {@link BigFivePackageLoader}（跨题比较必须等全部读完），失败即启动失败 ——
 * 题库里错一个反向键，结果是"看起来能跑、五个维度全反"，靠肉眼几乎发现不了。
 */
public final class BigFivePackage {

    private final int schemaVersion;
    private final String packageId;
    private final String instrumentId;
    private final String revision;
    private final String scoringVersion;
    private final String reportContentVersion;
    private final String title;
    private final String contentStatus;
    private final BigFiveScoringPolicy scoringPolicy;
    private final List<String> answerAnchors;
    private final Map<String, String> attribution;
    private final Map<BigFiveDimension, BigFiveDimensionCopy> dimensionCopy;
    private final List<BigFiveItem> questions;
    private final Map<String, BigFiveItem> byId;
    private final Map<BigFiveDimension, List<BigFiveItem>> byDimension;
    private final String sha256;

    public BigFivePackage(
            int schemaVersion,
            String packageId,
            String instrumentId,
            String revision,
            String scoringVersion,
            String reportContentVersion,
            String title,
            String contentStatus,
            BigFiveScoringPolicy scoringPolicy,
            List<String> answerAnchors,
            Map<String, String> attribution,
            List<BigFiveDimensionCopy> dimensionCopy,
            List<BigFiveItem> questions,
            String sha256) {
        this.schemaVersion = schemaVersion;
        this.packageId = requireText(packageId, "packageId");
        this.instrumentId = requireText(instrumentId, "instrumentId");
        this.revision = requireText(revision, "revision");
        this.scoringVersion = requireText(scoringVersion, "scoringVersion");
        this.reportContentVersion = requireText(reportContentVersion, "reportContentVersion");
        this.title = requireText(title, "title");
        this.contentStatus = requireText(contentStatus, "contentStatus");
        this.scoringPolicy = java.util.Objects.requireNonNull(scoringPolicy, "scoringPolicy");
        this.answerAnchors = List.copyOf(answerAnchors);
        this.attribution = Collections.unmodifiableMap(new LinkedHashMap<>(attribution));
        this.sha256 = requireText(sha256, "sha256");

        Map<BigFiveDimension, BigFiveDimensionCopy> copies = new EnumMap<>(BigFiveDimension.class);
        for (BigFiveDimensionCopy copy : dimensionCopy) {
            copies.put(copy.dimension(), copy);
        }
        this.dimensionCopy = Collections.unmodifiableMap(copies);

        List<BigFiveItem> sorted = new ArrayList<>(questions);
        sorted.sort(Comparator.comparingInt(BigFiveItem::order));
        this.questions = List.copyOf(sorted);

        Map<String, BigFiveItem> index = new LinkedHashMap<>();
        Map<BigFiveDimension, List<BigFiveItem>> grouped = new EnumMap<>(BigFiveDimension.class);
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            grouped.put(dimension, new ArrayList<>());
        }
        for (BigFiveItem item : this.questions) {
            if (index.put(item.id(), item) != null) {
                throw new BigFiveContentException("题目 ID 重复：" + item.id());
            }
            grouped.get(item.dimension()).add(item);
        }
        this.byId = Collections.unmodifiableMap(index);
        Map<BigFiveDimension, List<BigFiveItem>> frozen = new EnumMap<>(BigFiveDimension.class);
        grouped.forEach((dimension, items) -> frozen.put(dimension, List.copyOf(items)));
        this.byDimension = Collections.unmodifiableMap(frozen);
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new BigFiveContentException("内容包字段不能为空：" + field);
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

    public String contentStatus() {
        return contentStatus;
    }

    public BigFiveScoringPolicy scoringPolicy() {
        return scoringPolicy;
    }

    public List<String> answerAnchors() {
        return answerAnchors;
    }

    public Map<String, String> attribution() {
        return attribution;
    }

    public BigFiveDimensionCopy copyOf(BigFiveDimension dimension) {
        BigFiveDimensionCopy copy = dimensionCopy.get(dimension);
        if (copy == null) {
            throw new BigFiveContentException("缺少维度解释文案：" + dimension);
        }
        return copy;
    }

    public List<BigFiveItem> questions() {
        return questions;
    }

    public List<BigFiveItem> items(BigFiveDimension dimension) {
        return byDimension.get(dimension);
    }

    public BigFiveItem item(String questionId) {
        return byId.get(questionId);
    }

    public boolean hasItem(String questionId) {
        return byId.containsKey(questionId);
    }

    public String sha256() {
        return sha256;
    }

    public BigFivePackage withSha256(String newSha256) {
        return new BigFivePackage(schemaVersion, packageId, instrumentId, revision, scoringVersion,
                reportContentVersion, title, contentStatus, scoringPolicy, answerAnchors, attribution,
                List.copyOf(dimensionCopy.values()), questions, newSha256);
    }

    /** 供日志与接口回显的结构摘要（不含题面正文）。 */
    public Map<String, Object> summary() {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("packageId", packageId);
        summary.put("instrumentId", instrumentId);
        summary.put("scoringVersion", scoringVersion);
        summary.put("reportContentVersion", reportContentVersion);
        summary.put("contentStatus", contentStatus);
        summary.put("sha256", sha256);
        summary.put("itemCount", questions.size());
        Map<String, Integer> perDimension = new LinkedHashMap<>();
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            perDimension.put(dimension.name(), byDimension.get(dimension).size());
        }
        summary.put("itemsPerDimension", perDimension);
        return summary;
    }
}
