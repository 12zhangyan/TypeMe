package com.typeme.jung.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.content.JungProcessCopy;
import com.typeme.jung.domain.JungCandidate;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionScore;
import com.typeme.jung.domain.JungPole;
import com.typeme.jung.domain.JungProcess;
import com.typeme.jung.domain.JungResultStatus;
import com.typeme.jung.domain.JungScoringResult;
import com.typeme.jung.domain.JungTypeCode;
import com.typeme.jung.domain.JungTypeDynamics;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 由计分结果 + 类型内容拼出不可变报告快照（`report_json`）。
 *
 * <p>硬约束（有测试钉住）：
 * <ul>
 *   <li>{@code TIED} 时 {@code computedTypeCode} 为 null，且分享标题**不出现任何四字母**；</li>
 *   <li>{@code TENTATIVE} 时分享标题必须含"本次更接近"，并列出倾向较轻的维度；</li>
 *   <li>首屏摘要由**本次真实方向与边界**拼成，通用类型介绍另存为 {@code typeSections}；</li>
 *   <li>不出现准确率、概率、百分位、置信度这类词。</li>
 * </ul>
 *
 * <h2>过程层（{@code dynamics} / {@code processPlan}）</h2>
 * 除四字母外，报告还给出由字母**推导**出的四个精神活动过程，以及由该结构派生的建议：
 * 发展的三段任务（主导 → 辅助 → 两个尚未偏好的过程）、四步决策法按"哪一步对你最生"
 * 的裁剪、对立面的互补清单、以及按你自己那一侧给的沟通规则。
 *
 * <p>三条纪律：
 * <ol>
 *   <li>**TIED 时两块都是 {@code null}** —— 字母都没定，再推一个过程结构就是在制造确定性；</li>
 *   <li>推导结果必须与 {@code notes.frameworkCaveat} **同时出现**，
 *       否则"按规则推的"会被读成"测出来的"；</li>
 *   <li>过程之间没有高下：主导过程只是"用起来最省力"，两个尚未偏好的过程不是缺陷。</li>
 * </ol>
 */
public final class JungReportBuilder {

    /** 过程层推导算法的版本。规则本身变了要换这个号，旧报告才能说明自己是按哪一版算的。 */
    public static final String DYNAMICS_VERSION = "typeme-jung48-dynamics-v1";

    /** 四个过程的槽位，按权威顺序。 */
    private static final List<String> PROCESS_SLOTS =
            List.of("dominant", "auxiliary", "tertiary", "inferior");

    private static final List<String> PROCESS_SLOT_TITLES =
            List.of("主导过程", "辅助过程", "第三位", "第四位");

    /** 沟通规则的小标题：结构标签，与 {@link #SECTION_TITLES} 同一性质。 */
    private static final Map<String, String> COMMUNICATION_TITLES = Map.of(
            "EI", "关于精力的给与取",
            "SN", "和偏好另一侧的人说事",
            "TF", "要说不同意见的时候",
            "JP", "把时间安排说清楚");

    /** 内容包与报告都要能跨前后端读出同样的章节次序。 */
    private static final List<String> SECTION_ORDER = List.of(
            "dailyLife", "strengths", "blindSpots", "communication",
            "studyWork", "stress", "growth", "neighbors");

    private static final Map<String, String> SECTION_TITLES = Map.of(
            "dailyLife", "日常表现",
            "strengths", "可能用得顺手的地方",
            "blindSpots", "容易卡住的地方",
            "communication", "沟通与关系",
            "studyWork", "学习与工作方式",
            "stress", "压力下的观察",
            "growth", "成长行动",
            "neighbors", "相邻类型区别");

    private static final Set<String> BANNED_WORDS = Set.of(
            "准确率", "概率", "百分位", "置信", "确诊", "命中注定", "科学证明",
            // 过程层最容易被读成"你就适合干这个"：把推导变成判决的说法，这一层一个都不许出现。
            // 生成器侧同样的五个词在 scripts/convert-jung-content.mjs 的 PROCESS_EXTRA_BANNED，
            // 这里再拦一道是为了不依赖"文案一定是从 YAML 来的"这个前提。
            "匹配率", "适配度", "适合度", "职业匹配", "恋爱配对");

    private JungReportBuilder() {
    }

    /**
     * 构造报告快照。
     *
     * @param result       服务端计分结果（唯一权威）
     * @param typeCodeBasis {@code result.computedTypeCode}；TIED 时为 null
     */
    public static Map<String, Object> build(
            JungPackageLoader loader,
            JungScoringResult result,
            String reportId,
            String attemptId,
            LocalDateTime createdAtUtc,
            LocalDateTime submittedAtUtc) {

        if (result.status() == JungResultStatus.NEEDS_REVIEW) {
            throw new IllegalStateException("覆盖不足不应生成报告：调用方必须先检查 status");
        }
        JungPackage pkg = loader.current();
        var typeContent = loader.currentTypeReports();
        String typeCode = result.computedTypeCode() == null ? null : result.computedTypeCode().value();

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("schemaVersion", 1);
        report.put("reportId", reportId);
        report.put("attemptId", attemptId);
        report.put("createdAt", TimeSource.isoFromUtc(createdAtUtc));
        report.put("status", result.status().name());
        report.put("computedTypeCode", typeCode);
        report.put("typeSource", typeCode == null ? "none" : "computed");
        report.put("selfSelectedTypeCode", null);

        JungPackageLoader.TypeReport typeReport = typeCode == null ? null : typeContent.of(typeCode);
        report.put("typeTitle", typeReport == null ? null : typeReport.nameCn());
        report.put("typeNameCn", typeReport == null ? null : typeReport.nameCn());
        report.put("typeTagline", typeReport == null ? null : typeReport.tagline());
        report.put("summary", summarize(pkg, result, typeReport));
        report.put("boundaries", boundaries(pkg, result));
        report.put("tiedDimensions", result.tiedDimensions().stream().map(JungDimension::name).toList());
        report.put("dimensions", dimensions(pkg, result));
        report.put("candidates", candidates(result));
        report.put("tieNotice", result.tieNotice());
        report.put("clarificationDimensions",
                result.clarificationDimensions().stream().map(JungDimension::name).toList());
        report.put("clarificationSkipped", result.clarificationSkipped());
        report.put("typeSections", typeSections(typeReport));
        report.put("nextActions", nextActions(typeReport));
        report.put("dynamics", dynamics(loader.processCopy(), result));
        report.put("processPlan", processPlan(loader.processCopy(), result));
        report.put("share", share(result, typeCode, typeReport));
        report.put("methodology", methodology(loader, pkg, submittedAtUtc));
        return report;
    }

    /**
     * 追加 `reportHash`，并返回最终要落库的 JSON 文本。
     *
     * <p>为什么把这一步收进 Builder：`reportHash` 是"对**除自己以外**的全部内容"算的，
     * 所以必须先序列化一次、算哈希、把哈希塞进去、再序列化一次。这段两步舞
     * 之前散在 {@link ReportService} 里，谁都能在两次序列化之间插一个字段，
     * 插进去的字段就**不会**被哈希覆盖 —— 而报告"不可篡改"这个承诺恰好依赖
     * 哈希覆盖每个字段。收成一个方法后，这个不变量由一处代码负责。
     *
     * <p>契约 §7 把 `reportHash` 列为 `report_json` 的最后一个字段：追加在末尾
     * 保证了"去掉 reportHash 的规范化 JSON"与"builder 的输出"是同一串字节。
     */
    public static String finalizeWithHash(ObjectMapper mapper, Map<String, Object> report) {
        String withoutHash = serialize(mapper, report);
        String hash = sha256Hex(withoutHash);
        report.put("reportHash", hash);
        return serialize(mapper, report);
    }

    private static String serialize(ObjectMapper mapper, Map<String, Object> report) {
        try {
            return mapper.writeValueAsString(report);
        } catch (JsonProcessingException ex) {
            // 报告内容全是 String/Integer/Double/Boolean/List/Map，正常序列化不可能失败；
            // 真失败说明有人往报告里放了不可序列化的对象，必须当场炸掉而不是写半份报告。
            throw new IllegalStateException("报告无法序列化为 JSON（报告里混入了不可序列化的值？）", ex);
        }
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("JDK 必须提供 SHA-256", ex);
        }
    }

    /* ── 各段 ───────────────────────────────────────────────────────────── */

    private static String summarize(
            JungPackage pkg, JungScoringResult result, JungPackageLoader.TypeReport typeReport) {

        List<String> leaned = new ArrayList<>();
        List<String> boundaryLetters = new ArrayList<>();
        List<String> tiedLetters = new ArrayList<>();
        for (JungDimensionScore score : result.dimensions()) {
            JungDimension dimension = score.dimension();
            if (score.tied()) {
                tiedLetters.add(dimension.negativePole().letter() + "/" + dimension.positivePole().letter());
                continue;
            }
            JungPole pole = score.computedPole();
            leaned.add(pole.letter() + "（" + pkg.copyOf(dimension).copyOf(pole).label() + "）");
            if (score.boundary()) {
                boundaryLetters.add(String.valueOf(pole.letter()));
            }
        }

        StringBuilder summary = new StringBuilder();
        switch (result.status()) {
            case REFERENCE -> summary.append("本次参考类型是 ").append(result.computedTypeCode().value())
                    .append("。四个维度的方向都比较清楚：")
                    .append(String.join("、", leaned)).append("。");
            case TENTATIVE -> summary.append("本次更接近 ").append(result.computedTypeCode().value())
                    .append("。你已经能看出方向：").append(String.join("、", leaned)).append("；")
                    .append("其中 ").append(String.join("、", boundaryLetters))
                    .append(" 这一侧只是略偏，两边都值得一起读。");
            case TIED -> summary.append("这次有 ").append(tiedLetters.size())
                    .append(" 个方面两边几乎一样（").append(String.join("、", tiedLetters))
                    .append("），所以没有唯一的一个类型。下面按维度说明本次回答，并列出相邻候选。");
            default -> summary.append("本次尚未形成可解读的结果。");
        }
        if (typeReport != null && typeReport.tagline() != null && result.status() != JungResultStatus.TIED) {
            summary.append("类型参考：").append(typeReport.tagline()).append("。");
        }
        if (result.clarificationSkipped()) {
            summary.append("（本次跳过了补充题，结果只依据主测回答。）");
        }
        String text = summary.toString();
        assertNoBannedWords(text);
        return text;
    }

    private static List<Map<String, Object>> boundaries(JungPackage pkg, JungScoringResult result) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (JungDimensionScore score : result.dimensions()) {
            if (!score.boundary() || score.computedPole() == null) {
                continue;
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("dimension", score.dimension().name());
            row.put("pole", String.valueOf(score.computedPole().letter()));
            row.put("label", pkg.copyOf(score.dimension()).copyOf(score.computedPole()).label());
            row.put("mFinal", round(score.finalM()));
            row.put("note", "本次略偏 " + score.computedPole().letter() + "（倾向较轻），另一侧也值得一起读。");
            list.add(row);
        }
        return list;
    }

    private static List<Map<String, Object>> dimensions(JungPackage pkg, JungScoringResult result) {
        List<Map<String, Object>> rows = new ArrayList<>(4);
        for (JungDimensionScore score : result.dimensions()) {
            JungDimension dimension = score.dimension();
            var copy = pkg.copyOf(dimension);
            var coverage = result.coverage().get(dimension.ordinal());

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("dimension", dimension.name());
            row.put("name", copy.name());
            row.put("question", copy.question());
            row.put("negativePole", String.valueOf(dimension.negativePole().letter()));
            row.put("negativeLabel", copy.negativePole().label());
            row.put("positivePole", String.valueOf(dimension.positivePole().letter()));
            row.put("positiveLabel", copy.positivePole().label());
            row.put("computedPole", score.computedPole() == null ? null : String.valueOf(score.computedPole().letter()));
            row.put("tiedSide", score.computedPole() == null
                    ? "tied"
                    : (score.computedPole().isPositive() ? "positive" : "negative"));
            row.put("SBase", score.baseS());
            row.put("nBase", score.baseN());
            row.put("mBase", round(score.baseM()));
            row.put("SClar", score.clarS());
            row.put("nClar", score.clarN());
            row.put("mClar", round(score.clarM()));
            row.put("SFinal", score.finalS());
            row.put("nFinal", score.finalN());
            row.put("mFinal", round(score.finalM()));
            row.put("position", round(score.position()));
            row.put("boundary", score.boundary());
            row.put("baseRatingCount", coverage.baseRatingCount());
            row.put("baseUnknownCount", coverage.baseUnknownCount());
            row.put("baseUnprocessedCount", coverage.baseUnprocessedCount());
            row.put("clarificationScheduled", score.clarScheduled());
            row.put("clarificationSkipped", score.clarSkipped());
            row.put("clarificationApplied", score.effective());
            row.put("clarificationRatingCount", score.clarN());
            row.put("coverageOk", coverage.coverageOk(pkg.scoringPolicy().minBaseRatingsPerDimension()));

            // 该维的中文解释：方向明确时给该侧描述、弱侧提示；平分时给两端与"相近"说明
            List<String> details = new ArrayList<>();
            if (score.computedPole() == null) {
                details.add(copy.balancedSummary());
                details.add(copy.tiedNotice());
                details.add(copy.negativePole().label() + " " + dimension.negativePole().letter()
                        + "：" + copy.negativePole().description());
                details.add(copy.positivePole().label() + " " + dimension.positivePole().letter()
                        + "：" + copy.positivePole().description());
            } else {
                var poleCopy = copy.copyOf(score.computedPole());
                details.add(poleCopy.description());
                if (score.boundary()) {
                    var other = copy.copyOf(score.computedPole().opposite());
                    details.add("本次这一侧只是略偏。另一侧「" + other.label() + " "
                            + score.computedPole().opposite().letter() + "」同样值得一起读：" + other.description());
                }
            }
            details.forEach(JungReportBuilder::assertNoBannedWords);
            row.put("details", details);
            row.put("dailySigns", score.computedPole() == null
                    ? List.of()
                    : copy.copyOf(score.computedPole()).dailySigns());
            rows.add(row);
        }
        return rows;
    }

    private static List<Map<String, Object>> candidates(JungScoringResult result) {
        List<Map<String, Object>> rows = new ArrayList<>(result.candidates().size());
        for (JungCandidate candidate : result.candidates()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("typeCode", candidate.typeCode().value());
            row.put("cost", candidate.cost());
            row.put("differsOn", candidate.differsOn().stream().map(JungDimension::name).toList());
            rows.add(row);
        }
        return rows;
    }

    private static List<Map<String, Object>> typeSections(JungPackageLoader.TypeReport typeReport) {
        if (typeReport == null) {
            return List.of();
        }
        List<Map<String, Object>> sections = new ArrayList<>(SECTION_ORDER.size());
        for (String key : SECTION_ORDER) {
            String body = typeReport.section(key);
            if (body == null) {
                continue;
            }
            assertNoBannedWords(body);
            Map<String, Object> section = new LinkedHashMap<>();
            section.put("key", key);
            section.put("title", SECTION_TITLES.getOrDefault(key, key));
            section.put("body", body);
            sections.add(section);
        }
        return sections;
    }

    private static List<Map<String, Object>> nextActions(JungPackageLoader.TypeReport typeReport) {
        if (typeReport == null) {
            return List.of();
        }
        List<Map<String, Object>> actions = new ArrayList<>(typeReport.nextActions().size());
        for (JungPackageLoader.Action action : typeReport.nextActions()) {
            assertNoBannedWords(action.title());
            action.steps().forEach(JungReportBuilder::assertNoBannedWords);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("title", action.title());
            row.put("steps", action.steps());
            actions.add(row);
        }
        return actions;
    }

    /**
     * 分享模型：页面、复制文字、图片、alt 的唯一来源。
     *
     * <p>平分时 {@code headline} **不含任何四字母** —— 这是"不伪造主类型"的硬约束，
     * 由前端单测与 Java 测试双向钉住。
     */
    private static Map<String, Object> share(
            JungScoringResult result, String typeCode, JungPackageLoader.TypeReport typeReport) {

        String headline;
        String imageTitle;
        String boundaryLine = null;
        switch (result.status()) {
            case REFERENCE -> {
                headline = "本次参考类型 " + typeCode + (typeReport == null ? "" : " " + typeReport.nameCn());
                imageTitle = "本次参考类型";
            }
            case TENTATIVE -> {
                headline = "本次更接近 " + typeCode + (typeReport == null ? "" : " " + typeReport.nameCn());
                imageTitle = "本次更接近";
                boundaryLine = boundaryLine(result);
            }
            default -> {
                headline = "几个类型都值得一起看";
                imageTitle = "本次没有唯一类型";
            }
        }

        String copyText = buildCopyText(result, typeCode, typeReport, headline);
        assertNoBannedWords(copyText);

        Map<String, Object> share = new LinkedHashMap<>();
        share.put("kind", result.status().name());
        share.put("imageTitle", imageTitle);
        share.put("headline", headline);
        share.put("boundaryLine", boundaryLine);
        share.put("filename", filename(result, typeCode));
        share.put("text", copyText);
        share.put("alt", alt(result, typeCode, typeReport));
        return share;
    }

    private static String boundaryLine(JungScoringResult result) {
        List<String> letters = new ArrayList<>();
        for (JungDimensionScore score : result.dimensions()) {
            if (score.boundary() && score.computedPole() != null) {
                letters.add(String.valueOf(score.computedPole().letter()));
            }
        }
        if (letters.isEmpty()) {
            return null;
        }
        return "倾向较轻：" + String.join("、", letters) + "（另一侧也值得一起读）";
    }

    private static String filename(JungScoringResult result, String typeCode) {
        return switch (result.status()) {
            case REFERENCE -> "typeme-" + typeCode + "-reference.png";
            case TENTATIVE -> "typeme-" + typeCode + "-tentative.png";
            default -> "typeme-tied.png";
        };
    }

    private static String alt(
            JungScoringResult result, String typeCode, JungPackageLoader.TypeReport typeReport) {
        return switch (result.status()) {
            case REFERENCE -> "TypeMe 本次参考类型 " + typeCode + " 的四维倾向分享图";
            case TENTATIVE -> "TypeMe 本次更接近 " + typeCode + " 的四维倾向分享图（含倾向较轻说明）";
            default -> "TypeMe 本次四维倾向分享图：没有唯一类型，几个候选并列";
        };
    }

    private static String buildCopyText(
            JungScoringResult result, String typeCode, JungPackageLoader.TypeReport typeReport, String headline) {

        StringBuilder text = new StringBuilder();
        text.append("TypeMe 十六型人格参考测评\n");
        text.append(headline).append('\n');
        for (JungDimensionScore score : result.dimensions()) {
            JungDimension dimension = score.dimension();
            String pole;
            if (score.computedPole() == null) {
                pole = "两边接近";
            } else if (score.boundary()) {
                pole = "略偏 " + score.computedPole().letter() + "（倾向较轻）";
            } else {
                pole = "偏向 " + score.computedPole().letter();
            }
            text.append(dimension.displayName()).append("（").append(dimension.name()).append("）：")
                    .append(pole).append('\n');
        }
        if (result.status() == JungResultStatus.TIED && !result.candidates().isEmpty()) {
            List<String> codes = new ArrayList<>();
            result.candidates().forEach(candidate -> codes.add(candidate.typeCode().value()));
            text.append("候选：").append(String.join(" / ", codes)).append("（并列，无先后）\n");
        }
        if (typeReport != null && typeReport.tagline() != null && result.status() != JungResultStatus.TIED) {
            text.append(typeReport.tagline()).append('\n');
        }
        text.append("结果仅供自我了解，不是心理诊断，与官方 MBTI 无关联。");
        return text.toString();
    }

    /* ── 过程层：主导 / 辅助 / 两个尚未偏好的过程，及其派生建议 ─────────────── */

    /**
     * 过程层结构。TIED 时返回 {@code null}：**没有四字母就不推导**。
     *
     * <p>这不是省事，而是"不制造并不存在的确定性"这条纪律的延伸：
     * 平分说明该维两边证据对等，此时换任何一个字母都会换掉一整套过程结构。
     */
    private static Map<String, Object> dynamics(JungProcessCopy copy, JungScoringResult result) {
        if (result.computedTypeCode() == null) {
            return null;
        }
        JungTypeDynamics dynamics = JungTypeDynamics.of(result.computedTypeCode());

        Map<String, Object> block = new LinkedHashMap<>();
        String rule = dynamicsRule(dynamics);
        String basis = "这一层不是本次测出来的另一个结果，而是按四个字母、依据该框架的规则推导出来的结构。"
                + "这里说的「内倾 / 外倾」指的是这个过程主要朝里用还是朝外使用，不是性格内向或外向。";
        block.put("version", DYNAMICS_VERSION);
        block.put("typeCode", dynamics.typeCode().value());
        block.put("rule", rule);
        block.put("basis", basis);

        List<Map<String, Object>> processes = new ArrayList<>(4);
        for (int slot = 0; slot < 4; slot++) {
            JungProcess process = dynamics.processes().get(slot);
            JungProcessCopy.ProcessEntry entry = copy.process(process);
            boolean preferred = slot <= 1;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("slot", PROCESS_SLOTS.get(slot));
            row.put("order", slot + 1);
            row.put("process", process.token());
            row.put("function", String.valueOf(process.function()));
            row.put("attitude", String.valueOf(process.attitude()));
            row.put("nameCn", process.nameCn());
            row.put("roleTitle", PROCESS_SLOT_TITLES.get(slot));
            row.put("what", entry.what());
            row.put("reading", preferred ? entry.asDominant() : entry.whenUnpreferred());
            row.put("preferred", preferred);
            processes.add(row);
        }
        block.put("processes", processes);

        List<Map<String, Object>> boundaryNotes = new ArrayList<>();
        for (JungDimensionScore score : result.dimensions()) {
            if (!score.boundary() || score.computedPole() == null) {
                continue;
            }
            Map<String, Object> note = new LinkedHashMap<>();
            note.put("dimension", score.dimension().name());
            note.put("pole", String.valueOf(score.computedPole().letter()));
            note.put("note", flipNote(dynamics, score.dimension()));
            boundaryNotes.add(note);
        }
        block.put("boundaryNotes", boundaryNotes);

        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("frameworkCaveat", copy.notes().frameworkCaveat());
        block.put("notes", notes);

        assertNoBannedWords(rule);
        assertNoBannedWords(basis);
        boundaryNotes.forEach(note -> assertNoBannedWords((String) note.get("note")));
        return block;
    }

    /**
     * 把"为什么是这个过程"讲成人话。
     *
     * <p>这正是《天资差异》第 2 章那条最实用的规则：J/P 描述的是**对外部世界**使用哪一种过程，
     * 因此外倾者的主导过程就是对外使用的那个，而内倾者对外露出的其实是他的**辅助**过程。
     */
    private static String dynamicsRule(JungTypeDynamics dynamics) {
        char ei = dynamics.typeCode().value().charAt(0);
        char jp = dynamics.typeCode().value().charAt(3);
        boolean extraverted = ei == 'E';
        String outer = jp == 'J' ? "判断过程（思考或情感）" : "感知过程（感觉或直觉）";

        StringBuilder text = new StringBuilder();
        text.append("你以 ").append(ei).append(" 为主、以 ").append(jp).append(" 结尾。");
        text.append("按这套框架的规则，J/P 说的是「对外部世界使用哪一种过程」：")
                .append("以 ").append(jp).append(" 结尾，对外使用的是").append(outer).append("。");
        if (extraverted) {
            text.append("外倾者的主导过程朝外，所以对外使用的那个就是主导过程：")
                    .append(dynamics.dominant().nameCn()).append("（").append(dynamics.dominant().token()).append("）。");
        } else {
            text.append("内倾者的主导过程朝里，对外露出的其实是**辅助**过程：")
                    .append(dynamics.auxiliary().nameCn()).append("（").append(dynamics.auxiliary().token()).append("）；")
                    .append("主导过程因而是剩下的那一族、且朝里，也就是")
                    .append(dynamics.dominant().nameCn()).append("（").append(dynamics.dominant().token()).append("）。");
        }
        text.append("辅助过程与主导过程必然一个判断一个感知、一个朝外一个朝里，它负责在两件事之间取得平衡。");
        return text.toString().replace("**", "");
    }

    /**
     * 某一维"如果换到另一侧"对结构的真实后果。
     *
     * <p>比"另一侧也值得一起读"具体得多，而且这才是用户真正需要知道的。
     * 四种后果互不相同，本文案**逐条点名换边后的实际过程**（而不是只说一句抽象的方向对调），
     * 这样用户拿自己的类型一对就能自己核对 —— 抽象措辞正是上一次把 J/P 与 E/I 说反、
     * 却没有任何人察觉的原因。
     */
    private static String flipNote(JungTypeDynamics dynamics, JungDimension dimension) {
        JungTypeDynamics.JungDimensionFlip flip = dynamics.flipEffect(dimension);
        // 变的是**字母**，不是结构：换掉这一维的极点后必须由 of() 重新推导。
        // 直接手工拼一个结构正是构造期不变量要拦的事（也正是一次真实错误的来源）。
        JungPole own = dynamics.typeCode().poleOf(dimension);
        JungTypeCode flippedCode = dynamics.typeCode().withPole(dimension, own.opposite());
        JungTypeDynamics flipped = JungTypeDynamics.of(flippedCode);
        String prefix = "如果 " + dimension.name() + " 落到另一侧（" + flippedCode.value() + "）：";

        return switch (flip.consequence()) {
            // E/I：还是那四个过程，主导与辅助互换（第三位与第四位也互换）。
            case DOMINANT_AUXILIARY_SWAP -> prefix + "过程还是这四个，但主导与辅助会互换、"
                    + "第三位与第四位也会互换 —— 原来对外使用的那个转为对内，原来是" + dynamics.dominant().nameCn()
                    + "主导，换过去就是" + flipped.dominant().nameCn() + "主导。";
            // J/P：判断类与感知类互换所占位置，每个位置都换成另一类，方向不变。
            case CATEGORIES_SWAP_SLOTS -> prefix + "四个位置朝里 / 朝外的方向都不变，"
                    + "但每个位置上的过程都会换成另一类（判断与感知互换：J/P 决定的正是哪一类对外使用）"
                    + " —— 主导仍是" + (dynamics.dominant().isIntroverted() ? "朝里" : "朝外") + "用的，"
                    + "只是从" + dynamics.dominant().nameCn() + "变成" + flipped.dominant().nameCn() + "。";
            // S/N 或 T/F：同类的那两个功能互换，方向不变。
            case FUNCTIONS_SWAP -> {
                JungProcess before = dynamics.processes().get(flip.firstSlot());
                JungProcess after = flipped.processes().get(flip.firstSlot());
                JungProcess beforeOther = dynamics.processes().get(flip.secondSlot());
                JungProcess afterOther = flipped.processes().get(flip.secondSlot());
                yield prefix + "只有这一类的两个过程会换功能、方向不变："
                        + JungTypeDynamics.JungDimensionFlip.slotName(flip.firstSlot())
                        + "从" + before.nameCn() + "变成" + after.nameCn() + "，"
                        + JungTypeDynamics.JungDimensionFlip.slotName(flip.secondSlot())
                        + "从" + beforeOther.nameCn() + "变成" + afterOther.nameCn() + "。";
            }
        };
    }

    /**
     * 由过程结构派生的建议。
     *
     * <p>三段之间是**有依据的**，不是排版顺序：
     * <ul>
     *   <li>发展任务按原书 19.2 的三层要求：熟练使用主导过程 → 熟练使用辅助过程 →
     *       学会使用两个尚未偏好的过程。<b>第三层里的两个过程并列，不分先后</b>——
     *       原书明确撤回了"发展必须按时间表完成"的说法，这里不替它排出年龄表。</li>
     *   <li>四步决策法用原书 19.3 的固定顺序（感觉 → 直觉 → 思考 → 情感），
     *       逐步标出"这一步用不用得上你偏好的功能"，因为要跳过的往往正是与自己不同的那两步。</li>
     *   <li>对立面的互补只取 SN / TF 两轴：原书图表 32 的清单也只覆盖这两轴。</li>
     * </ul>
     */
    private static Map<String, Object> processPlan(JungProcessCopy copy, JungScoringResult result) {
        if (result.computedTypeCode() == null) {
            return null;
        }
        JungTypeDynamics dynamics = JungTypeDynamics.of(result.computedTypeCode());
        Map<String, Object> plan = new LinkedHashMap<>();
        plan.put("version", DYNAMICS_VERSION);

        // ── 1. 发展的三段任务（原书 19.2）
        List<Map<String, Object>> order = new ArrayList<>(3);
        order.add(developmentStage(1, "先把主导过程用熟",
                "主导过程是这套结构里最先形成、也最能塑造你的那一个：报告前面那些「看得出来」的描述，多数是它在起作用。",
                copy, List.of(dynamics.dominant())));
        order.add(developmentStage(2, "让辅助过程承担对外的事",
                "辅助过程与主导过程一个判断一个感知、一个朝外一个朝里。内倾型尤其依赖它对外办事——"
                        + "外倾型反过来依赖它给自己留出内里的余地。",
                copy, List.of(dynamics.auxiliary())));
        order.add(developmentStage(3, "把两个尚未偏好的过程当家里的成员接纳",
                "这一层要的是「需要的时候用得上」，不是「变成另一型」。这两个过程并列，没有先后；"
                        + "一直不听它们的意见，它们只会在你不设防的时候自己冒出来。",
                copy, List.of(dynamics.tertiary(), dynamics.inferior())));
        plan.put("developmentOrder", order);

        // ── 2. 四步决策法（原书 19.3，顺序固定）
        List<Map<String, Object>> steps = new ArrayList<>(4);
        List<String> unpreferredTitles = new ArrayList<>(2);
        for (char function : List.of('S', 'N', 'T', 'F')) {
            JungProcessCopy.DecisionStep step = copy.decisionStep(function);
            int slot = dynamics.slotOfFunction(function);
            JungProcess process = dynamics.processes().get(slot);
            boolean preferred = slot <= 1;
            if (!preferred) {
                unpreferredTitles.add(step.title());
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("order", steps.size() + 1);
            row.put("function", String.valueOf(function));
            row.put("title", step.title());
            row.put("prompt", step.prompt());
            row.put("slot", PROCESS_SLOTS.get(slot));
            row.put("slotTitle", PROCESS_SLOT_TITLES.get(slot));
            row.put("process", process.token());
            row.put("preferred", preferred);
            row.put("how", preferred
                    ? "这一步对应你的" + PROCESS_SLOT_TITLES.get(slot) + "（" + process.token() + "），用起来最省力。"
                    : step.whenUnpreferred());
            steps.add(row);
        }
        plan.put("decisionIntro", copy.decisionIntro());
        plan.put("decisionSteps", steps);
        plan.put("decisionNote", copy.decisionNote());
        plan.put("hardestSteps", unpreferredTitles);
        plan.put("hardestStepsNote", "这四步里，「" + String.join("」「", unpreferredTitles)
                + "」用不上你偏好的功能，忙起来最容易整段跳过。"
                + "其中第四位（" + dynamics.inferior().token() + "）是发展得最不充分的那一个"
                + "（原书在讲内倾思考型时，就直接点名第四位的外倾情感是它发展得最不充分的过程），"
                + "可以把它当成最后要补的一环——但这是过程之间的次序，不是年龄表："
                + "原书明确撤回了「发展必须按时间表完成」的假设，任何年龄都可以补。");

        // ── 3. 对立面的互补（原书图表 32，只覆盖 SN / TF）
        List<Map<String, Object>> opposites = new ArrayList<>(2);
        for (JungDimension axis : List.of(JungDimension.SN, JungDimension.TF)) {
            JungPole own = dynamics.typeCode().poleOf(axis);
            JungPole other = own.opposite();
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("axis", axis.name());
            row.put("axisName", axis.displayName());
            row.put("yourPole", String.valueOf(own.letter()));
            row.put("needPole", String.valueOf(other.letter()));
            row.put("need", "你需要偏" + JungProcess.functionNameCnOf(other.letter()) + "的一侧提供："
                    + copy.complementOfferOf(other));
            row.put("supply", "你能提供给偏" + JungProcess.functionNameCnOf(other.letter()) + "的一侧："
                    + copy.complementOfferOf(own));
            opposites.add(row);
        }
        plan.put("opposites", opposites);

        // ── 4. 按自己那一侧给的沟通规则（原书第 10 章与 19.5–19.6）
        List<Map<String, Object>> rules = new ArrayList<>(4);
        for (JungDimension dimension : JungDimension.values()) {
            JungPole own = dynamics.typeCode().poleOf(dimension);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("axis", dimension.name());
            row.put("axisName", dimension.displayName());
            row.put("title", COMMUNICATION_TITLES.getOrDefault(dimension.name(), dimension.displayName()));
            row.put("yourPole", String.valueOf(own.letter()));
            row.put("body", copy.communicationRule(dimension).forPole(own));
            rules.add(row);
        }
        plan.put("communicationRules", rules);

        Map<String, Object> notes = new LinkedHashMap<>();
        notes.put("developmentNote", copy.notes().developmentNote());
        notes.put("greyAreaNote", copy.notes().greyAreaNote());
        plan.put("notes", notes);

        plan.values().forEach(value -> {
            if (value instanceof String text) {
                assertNoBannedWords(text);
            }
        });
        return plan;
    }

    private static Map<String, Object> developmentStage(
            int order, String title, String body, JungProcessCopy copy, List<JungProcess> processes) {

        assertNoBannedWords(body);
        Map<String, Object> stage = new LinkedHashMap<>();
        stage.put("order", order);
        stage.put("title", title);
        stage.put("body", body);
        List<Map<String, Object>> items = new ArrayList<>(processes.size());
        for (JungProcess process : processes) {
            JungProcessCopy.ProcessEntry entry = copy.process(process);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("process", process.token());
            item.put("nameCn", process.nameCn());
            item.put("body", order <= 2 ? entry.asDominant() : entry.whenUnpreferred());
            items.add(item);
        }
        stage.put("processes", items);
        return stage;
    }

    private static Map<String, Object> methodology(
            JungPackageLoader loader, JungPackage pkg, LocalDateTime submittedAtUtc) {
        Map<String, Object> methodology = new LinkedHashMap<>();
        methodology.put("scoringVersion", pkg.scoringVersion());
        methodology.put("packageId", pkg.packageId());
        methodology.put("reportContentVersion", pkg.reportContentVersion());
        methodology.put("contentStatus", pkg.contentStatus().token());
        methodology.put("contentSha256", pkg.sha256());
        methodology.put("processCopyVersion", loader.processCopy().version());
        methodology.put("processCopySha256", loader.recomputedProcessCopySha256());
        methodology.put("dynamicsVersion", DYNAMICS_VERSION);
        methodology.put("policyVersion", pkg.scoringPolicy().version());
        methodology.put("minBaseRatingsPerDimension", pkg.scoringPolicy().minBaseRatingsPerDimension());
        methodology.put("boundaryNumerator", pkg.scoringPolicy().boundaryNumerator());
        methodology.put("boundaryDenominator", pkg.scoringPolicy().boundaryDenominator());
        methodology.put("submittedAt", TimeSource.isoFromUtc(submittedAtUtc));
        return methodology;
    }

    private static Double round(Double value) {
        if (value == null) {
            return null;
        }
        return Math.round(value * 10000.0) / 10000.0;
    }

    /**
     * 禁止措辞护栏。
     *
     * <p>这是**启发式护栏**，不是内容安全保证：它只能拦住明显不该出现在自我了解报告里的说法
     * （准确率、概率、诊断）。真正的内容质量靠人工审校。
     */
    static void assertNoBannedWords(String text) {
        if (text == null) {
            return;
        }
        for (String banned : BANNED_WORDS) {
            if (text.contains(banned)) {
                throw new IllegalStateException("报告文案出现禁止措辞「" + banned + "」，已拒绝生成：" + text);
            }
        }
    }
}
