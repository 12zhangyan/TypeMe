package com.typeme.ai.input;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.ai.port.ReportSnapshotReader;
import com.typeme.ai.port.ReportSnapshotReader.AiReportSnapshot;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 构造发送给 DeepSeek 的输入（契约 03 §4）。
 *
 * <p>三条硬约束：
 * <ol>
 *   <li><b>只发必要材料</b>：四维摘要、状态与候选、过程层摘要（{@code report.processLayer}，
 *       主导/辅助与两个尚未偏好过程的读法、最吃力的决策步骤、两条互补的 need/supply）、
 *       最多 8 条证据片段、主题、用户自写的近况。
 *       **不发**用户名/昵称/邮箱/联系方式/IP、完整历史报告、原始完整答卷、
 *       {@code reportId}/{@code attemptId}/{@code userId}，也不发题库正文。</li>
 *   <li><b>逐题贡献必须自己算</b>：{@code report_json} 只有维度级汇总（S/n/m），没有逐题明细，
 *       所以这里回到 {@code assessment_answer} + 内容包题目极点，按契约 01 §4 的公式
 *       {@code c = direction × (r − 3)} 自行计算。少了这一步，证据片段就无从挑选。</li>
 *   <li><b>证据选择规则固定</b>：每个边界/平分维度各取 1 条同向（优先 |c|=2）+ 1 条反向（|c| 最大），
 *       剩余名额按 |c| 降序、order 升序、四维轮转补足，总数 ≤ 8 —— 且**必须包含反向证据**，
 *       否则模型只会看到"支持结论"的材料。</li>
 * </ol>
 * 关于中文长度：契约所有"多少字"的限制都按**字符数**理解（前端与服务端口径一致），
 * 不按 UTF-8 字节数，避免同一个字符串在两边得到不同判定。
 */
@Component
public class ReportInputBuilder {

    private static final Logger log = LoggerFactory.getLogger(ReportInputBuilder.class);

    /** 契约 §4：最多 8 条证据片段。 */
    static final int MAX_EVIDENCE = 8;

    /** 证据片段里场景标签的截断上限：宁可截断标签，也不发完整题干。 */
    private static final int SCENARIO_LIMIT = 40;

    /**
     * 契约 §0：发送范围版本，进 {@code request_hash}。
     *
     * <p><b>为什么必须从 v1 提升到 v2</b>：本次在 payload 里新增了过程层
     * （{@code report_json} 的 {@code dynamics} / {@code processPlan} 的紧凑投影，见
     * {@link #processLayer(JsonNode)}）。对**同一份已入库的报告**来说，{@code report_hash} 是
     * {@code report_json} 内容的哈希，它本身就已经包含过程层，因此升级前后这个值不变；
     * 若管理员把 {@code prompt-version} 钉在 v1、model/topic/note 也没变，
     * 升级前后算出的 {@code request_hash} 会**完全相同**，而实际外发内容已经不同
     * （升级前不带 {@code report.processLayer}）。后果是去重分支会把一份从未见过过程层的历史分析
     * 原样复用给用户：用户确认页描述的范围与实际外发内容对不上，也事后无法区分"这次分析依据的是哪一版范围"。
     * 提升版本号让新旧范围在哈希上必然分叉；{@code ai_consent.scope} 落的就是这个值，
     * 因此库里也能一眼区分新旧两种发送范围。
     */
    public static final String SCOPE_VERSION = "typeme-ai-scope-v2";

    private static final List<String> DIMENSIONS = List.of("EI", "SN", "TF", "JP");

    /** 过程层的 slot 归属：前两个是相对省力的（主导 / 辅助），后两个是尚未偏好的。 */
    private static final List<String> PREFERRED_SLOTS = List.of("dominant", "auxiliary");

    /**
     * 过程层各项的字符上限。
     *
     * <p>这些文本本来就不长（一句话读法 40–70 字、换边说明 60–100 字），设上限**不是为了压缩正常内容**，
     * 而是防止内容层出脏数据（比如整段粘贴正文）时把请求负载撑大。截断处补省略号，
     * 让模型知道这里被截过、不要补全。
     */
    private static final int PROCESS_READING_LIMIT = 120;

    private static final int PROCESS_BOUNDARY_LIMIT = 160;

    private static final int PROCESS_OPPOSITE_LIMIT = 120;

    private static final int PROCESS_NOTE_LIMIT = 200;

    /** payload 里标出过程层的来源：让"这是推导"这件事在数据里就有据可依，而不只靠提示词。 */
    private static final String PROCESS_SOURCE = "derived-from-letters";

    private static final Map<String, String> POLE_LETTERS = Map.of(
            "EI", "I/E", "SN", "S/N", "TF", "T/F", "JP", "J/P");

    private final ReportSnapshotReader snapshotReader;
    private final ObjectMapper mapper;

    public ReportInputBuilder(ReportSnapshotReader snapshotReader, ObjectMapper mapper) {
        this.snapshotReader = snapshotReader;
        this.mapper = mapper;
    }

    /** 构造失败即"报告不存在/不可用"，由调用方转成 404（与不存在的形状一致）。 */
    public AiReportInput build(String reportId, String userId, AiTopic topic, String note,
                               String promptVersion, String model) {
        AiReportSnapshot snapshot = snapshotReader.find(reportId)
                .orElseThrow(() -> com.typeme.ai.config.AiException.notFound("这份报告"));

        // 阶段 2：越权过滤。不写"这是别人的报告"，与"不存在"同形。
        if (userId == null || !userId.equals(snapshot.userId())) {
            throw com.typeme.ai.config.AiException.notFound("这份报告");
        }
        if (snapshot.reportJson() == null || snapshot.reportJson().isBlank()) {
            throw new IllegalStateException("报告快照为空，无法构造 AI 输入：" + reportId);
        }

        JsonNode report = readJson(snapshot.reportJson());
        String computedTypeCode = blankToNull(snapshot.computedTypeCode(), text(report.path("computedTypeCode")));
        String status = blankToNull(snapshot.status(), text(report.path("status")));

        List<DimensionInput> dimensions = dimensions(report);
        List<Map<String, Object>> candidates = candidates(report);
        List<AiReportInput.Evidence> evidence = selectEvidence(report, snapshot, dimensions);

        String normalizedNote = normalizeNote(note);
        String requestHash = AiHashes.sha256(String.join("|",
                userId,
                snapshot.reportHash() == null ? "" : snapshot.reportHash(),
                promptVersion,
                model,
                topic.wire(),
                AiHashes.sha256(normalizedNote),
                SCOPE_VERSION));

        Map<String, Object> payload = buildPayload(topic, computedTypeCode, status, dimensions,
                candidates, tieNotice(report), processLayer(report, snapshot.reportId(), snapshot.reportHash()),
                evidence, normalizedNote);
        List<String> evidenceIds = evidence.stream().map(AiReportInput.Evidence::id).toList();

        return new AiReportInput(userId, reportId, snapshot.reportHash(), computedTypeCode, status, topic,
                promptVersion, model, SCOPE_VERSION, normalizedNote,
                List.copyOf(evidence), Map.copyOf(payload), requestHash, evidenceIds);
    }

    /* ── 四维摘要与候选（取自 report_json 的维度级汇总） ─────────────────── */

    /** @param mFinal 保留两位小数；{@code null} 表示该维没有 rating（m 为 null） */
    public record DimensionInput(String dimension, String computedPole, Double mFinal, boolean boundary,
                                 int nFinal) {
    }

    private List<DimensionInput> dimensions(JsonNode report) {
        List<DimensionInput> rows = new ArrayList<>(4);
        JsonNode array = report.path("dimensions");
        for (String dimension : DIMENSIONS) {
            JsonNode row = findDimension(array, dimension);
            if (row == null) {
                // 报告缺维度：不猜默认值（契约 01 §7 明确"字段缺失算契约破坏"），直接报服务端数据异常。
                throw new IllegalStateException("report_json 缺少维度 " + dimension + "，无法构造 AI 输入。");
            }
            rows.add(new DimensionInput(
                    dimension,
                    blankToNull(text(row.path("computedPole"))),
                    round2(row.path("mFinal")),
                    row.path("boundary").asBoolean(false),
                    row.path("nFinal").asInt(0)));
        }
        return rows;
    }

    private static JsonNode findDimension(JsonNode array, String dimension) {
        if (!array.isArray()) {
            return null;
        }
        for (JsonNode row : array) {
            if (dimension.equals(text(row.path("dimension")))) {
                return row;
            }
        }
        return null;
    }

    private List<Map<String, Object>> candidates(JsonNode report) {
        List<Map<String, Object>> rows = new ArrayList<>();
        JsonNode array = report.path("candidates");
        if (!array.isArray()) {
            return rows;
        }
        for (JsonNode row : array) {
            String typeCode = text(row.path("typeCode"));
            if (typeCode == null) {
                continue;
            }
            Map<String, Object> candidate = new LinkedHashMap<>();
            candidate.put("typeCode", typeCode);
            candidate.put("cost", row.path("cost").asInt(0));
            rows.add(candidate);
        }
        return rows;
    }

    private static String tieNotice(JsonNode report) {
        return blankToNull(text(report.path("tieNotice")));
    }

    /* ── 过程层（dynamics / processPlan）的紧凑投影 ─────────────────────── */

    /**
     * 把报告的过程层压成一份**够用且小**的摘要。
     *
     * <p>只发解释这一段时真正用得上的少数几项：相对省力的两个过程（主导/辅助）与两个尚未偏好过程
     * （第三位/第四位）的 {@code reading}、四步决策法里对本人最吃力的那两步、两条互补象限的
     * need/supply，外加"换边会怎么变"的 boundaryNotes 与"这是推导不是测量"的 basis / frameworkCaveat。
     * 原始 {@code what}、{@code rule}、三整段发展任务、四条沟通规则都不发：那些是报告端已经讲过的正文，
     * 发过去只会把负载撑大，并诱发模型逐句复述。
     *
     * <p><b>两种"没有这一层"必须区分开</b>：
     * <ul>
     *   <li>{@code dynamics} 缺失或为 {@code null}（TIED 报告按契约不推导过程结构，或过程层上线前的旧快照）：
     *       这是**合法缺席**，安静地返回 {@code null}，调用方整个键都不放。绝不能刷日志 ——
     *       TIED 报告会把日志刷满，反而淹没真正的问题。</li>
     *   <li>{@code dynamics} 明明在，却一个过程也投影不出来（键名对不上 / 形状不认识）：
     *       这是**静默退化**，也就是"报告照出、测试照绿、AI 却悄悄少了一整层依据"的失败形态。
     *       必须留下一条 WARN（带 reportId / reportHash），并整层省略，让键名漂移当场可见。</li>
     * </ul>
     *
     * <p>返回 {@code null} 表示"这次不放这一层"，提示词另有一支专门说明这种省略该怎么处理。
     */
    private static Map<String, Object> processLayer(JsonNode report, String reportId, String reportHash) {
        JsonNode dynamics = report.path("dynamics");
        if (dynamics.isMissingNode() || dynamics.isNull()) {
            // 合法缺席：TIED（没有四字母就不推导）或过程层上线前的旧报告快照。安静省略。
            return null;
        }
        if (!dynamics.isObject()) {
            log.warn("报告含过程层，但 dynamics 形状不认识（不是对象），负载将省略该层："
                            + "JungReportBuilder 的键名可能已变，请同步 ReportInputBuilder.processLayer"
                            + "（reportId={}, reportHash={}）",
                    reportId, reportHash);
            return null;
        }

        List<Map<String, Object>> preferred = new ArrayList<>(2);
        List<Map<String, Object>> unpreferred = new ArrayList<>(2);
        JsonNode processes = dynamics.path("processes");
        if (processes.isArray()) {
            for (JsonNode process : processes) {
                String slot = text(process.path("slot"));
                if (slot == null) {
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                putIfPresent(row, "slot", slot);
                putIfPresent(row, "process", text(process.path("process")));
                putIfPresent(row, "nameCn", text(process.path("nameCn")));
                putIfPresent(row, "roleTitle", text(process.path("roleTitle")));
                putIfPresent(row, "reading",
                        shorten(text(process.path("reading")), PROCESS_READING_LIMIT));
                // preferred 缺失时按 slot 兜底：契约里前两个 slot 就是相对省力的那两个。
                boolean isPreferred = process.path("preferred")
                        .asBoolean(PREFERRED_SLOTS.contains(slot));
                if (isPreferred) {
                    preferred.add(row);
                } else {
                    unpreferred.add(row);
                }
            }
        }

        // 四个过程是这一层的骨架：一个都认不出来时必须出声音，并且整层省略
        // （只发一份缺了过程的 opposites / hardestSteps 残骸，会让模型按残缺结构解释当事人）。
        int recognized = preferred.size() + unpreferred.size();
        if (recognized == 0) {
            log.warn("报告含过程层，但负载投影为空：JungReportBuilder 的键名可能已变，"
                            + "请同步 ReportInputBuilder.processLayer（reportId={}, reportHash={}）",
                    reportId, reportHash);
            return null;
        }
        if (recognized < 4) {
            // 少一个过程同样是键名漂移：那一支的 slot / 字段没被认出来。
            log.warn("报告含过程层，但只投影出 {}/4 个过程：JungReportBuilder 的键名可能已变，"
                            + "请同步 ReportInputBuilder.processLayer（reportId={}, reportHash={}）",
                    recognized, reportId, reportHash);
        }

        List<Map<String, Object>> boundaryNotes = new ArrayList<>();
        JsonNode notes = dynamics.path("boundaryNotes");
        if (notes.isArray()) {
            for (JsonNode note : notes) {
                String content = shorten(text(note.path("note")), PROCESS_BOUNDARY_LIMIT);
                if (content == null) {
                    continue;
                }
                Map<String, Object> row = new LinkedHashMap<>();
                putIfPresent(row, "dimension", text(note.path("dimension")));
                putIfPresent(row, "pole", text(note.path("pole")));
                row.put("note", content);
                boundaryNotes.add(row);
            }
        }

        List<String> hardestSteps = new ArrayList<>(2);
        List<Map<String, Object>> opposites = new ArrayList<>(2);
        JsonNode plan = report.path("processPlan");
        if (plan.isObject()) {
            for (JsonNode step : plan.path("hardestSteps")) {
                String title = text(step);
                if (title != null) {
                    hardestSteps.add(title);
                }
            }
            for (JsonNode opposite : plan.path("opposites")) {
                Map<String, Object> row = new LinkedHashMap<>();
                putIfPresent(row, "axis", text(opposite.path("axis")));
                putIfPresent(row, "yourPole", text(opposite.path("yourPole")));
                putIfPresent(row, "needPole", text(opposite.path("needPole")));
                putIfPresent(row, "need", shorten(text(opposite.path("need")), PROCESS_OPPOSITE_LIMIT));
                putIfPresent(row, "supply", shorten(text(opposite.path("supply")), PROCESS_OPPOSITE_LIMIT));
                if (!row.isEmpty()) {
                    opposites.add(row);
                }
            }
        }

        if (preferred.isEmpty() && unpreferred.isEmpty() && hardestSteps.isEmpty()
                && opposites.isEmpty() && boundaryNotes.isEmpty()) {
            // 理论上到不了（recognized==0 已经返回）：留作兜底，避免将来有人挪动上面的判断顺序后
            // 漏掉"全空"这条路径而发出一个空壳。
            return null;
        }

        JsonNode dynamicsNotes = dynamics.path("notes");
        Map<String, Object> layer = new LinkedHashMap<>();
        layer.put("source", PROCESS_SOURCE);
        putIfPresent(layer, "processVersion", text(dynamics.path("version")));
        // 空的分组也省略：这是上面"不发空壳"原则在字段级的同一件事——
        // 留着 "unpreferred":[] 会让模型读成"当事人没有尚未偏好的过程"。
        putIfNotEmpty(layer, "preferred", preferred);
        putIfNotEmpty(layer, "unpreferred", unpreferred);
        putIfNotEmpty(layer, "hardestSteps", hardestSteps);
        putIfNotEmpty(layer, "opposites", opposites);
        putIfNotEmpty(layer, "boundaryNotes", boundaryNotes);
        putIfPresent(layer, "basis", shorten(text(dynamics.path("basis")), PROCESS_NOTE_LIMIT));
        putIfPresent(layer, "frameworkCaveat",
                shorten(text(dynamicsNotes.path("frameworkCaveat")), PROCESS_NOTE_LIMIT));
        return layer;
    }

    /** 文本截断：空/null 归一成 {@code null}（调用方据此省略该字段），超长补省略号。 */
    private static String shorten(String value, int limit) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.length() <= limit ? trimmed : trimmed.substring(0, limit) + "…";
    }

    /** 只写有值的字段：负载越小越好，也避免 null 字段被模型读成"这一项是空的"。 */
    private static void putIfPresent(Map<String, Object> row, String key, String value) {
        if (value != null && !value.isBlank()) {
            row.put(key, value);
        }
    }

    /** 同上，但针对列表：空列表直接不放，否则会被读成"这一组没有内容"。 */
    private static void putIfNotEmpty(Map<String, Object> row, String key, List<?> value) {
        if (value != null && !value.isEmpty()) {
            row.put(key, value);
        }
    }

    /* ── 证据选择（契约 §4 的固定规则） ─────────────────────────────────── */

    /**
     * 逐题贡献与候选证据池。
     *
     * @param c 该题对该维方向的贡献 {@code c = direction × (r − 3)}，只有 rating 才有值
     */
    private record QuestionContribution(String questionId, String dimension, String scenario,
                                        String leftPole, String rightPole, int order, int c) {
    }

    private List<AiReportInput.Evidence> selectEvidence(JsonNode report, AiReportSnapshot snapshot,
                                                        List<DimensionInput> dimensions) {

        List<QuestionContribution> pool = contributions(snapshot);
        Map<String, List<QuestionContribution>> byDimension = new LinkedHashMap<>();
        for (QuestionContribution item : pool) {
            byDimension.computeIfAbsent(item.dimension(), key -> new ArrayList<>()).add(item);
        }

        Set<String> used = new LinkedHashSet<>();
        List<AiReportInput.Evidence> selected = new ArrayList<>();

        // 1) + 2)：每个边界/平分维度各取一条同向、一条反向。
        List<String> orderedBoundaryDimensions = new ArrayList<>(dimensions.size());
        for (DimensionInput dimension : dimensions) {
            if (!dimension.boundary() && dimension.computedPole() != null) {
                continue;
            }
            List<QuestionContribution> items = byDimension.getOrDefault(dimension.dimension(), List.of());
            QuestionContribution same = bestSameDirection(items, dimension.computedPole());
            if (same != null) {
                add(selected, used, same, dimension.dimension());
            }
            QuestionContribution opposite = strongestOpposite(items, dimension.computedPole());
            if (opposite != null) {
                add(selected, used, opposite, dimension.dimension());
            }
            orderedBoundaryDimensions.add(dimension.dimension());
        }

        // 2b) 边界维度再补一条"用户自己选了中间档"的作答。
        //
        // 为什么必须有：提示词第 3 条要求"倾向较轻的维度要给出『另一侧也值得一起看』的**具体**读法"，
        // 而当事人自己选"两边差不多"的那一题，正是这句话最硬的依据。
        // 从前这条路走不通：同向取的是 |c| 最大、反向显式跳过 c == 0，
        // 于是中间档**永远进不了证据**（describe() 早就能正确写出"选了中间（两边差不多）"，
        // 只是没人选得中它）。边界维度最需要的恰恰是这条材料。
        //
        // 只对边界/平分维度补，不设边界的维度不补：那会挤掉真正有信息量的同向/反向证据。
        // 名额不够时后面的维度自然取不到 —— 优先保住"每题一条"的对称，而不是让某一维吃掉全部名额。
        for (String dimension : orderedBoundaryDimensions) {
            List<QuestionContribution> items = byDimension.getOrDefault(dimension, List.of());
            QuestionContribution neutral = items.stream()
                    .filter(item -> item.c() == 0)
                    .findFirst()
                    .orElse(null);
            if (neutral != null) {
                add(selected, used, neutral, dimension);
            }
        }

        // 3) 剩余名额：|c| 降序、order 升序，四维轮转，避免被单一维度占满。
        List<QuestionContribution> remaining = new ArrayList<>(pool);
        remaining.sort(Comparator.comparingInt((QuestionContribution item) -> -Math.abs(item.c()))
                .thenComparingInt(QuestionContribution::order));
        int cursor = 0;
        while (selected.size() < MAX_EVIDENCE) {
            QuestionContribution picked = null;
            for (int probe = 0; probe < DIMENSIONS.size() && picked == null; probe++) {
                String dimension = DIMENSIONS.get((cursor + probe) % DIMENSIONS.size());
                for (QuestionContribution item : remaining) {
                    if (item.dimension().equals(dimension) && !used.contains(item.questionId())) {
                        picked = item;
                        break;
                    }
                }
            }
            if (picked == null) {
                break;
            }
            cursor = (DIMENSIONS.indexOf(picked.dimension()) + 1) % DIMENSIONS.size();
            add(selected, used, picked, picked.dimension());
        }

        return selected;
    }

    /**
     * 从答案 + 内容包极点还原逐题贡献（契约 01 §4）。
     *
     * <p>只对"已处理的 rating"计算；{@code unknown} 与未处理都不计入（未处理 ≠ unknown）。
     */
    private List<QuestionContribution> contributions(AiReportSnapshot snapshot) {
        List<QuestionContribution> pool = new ArrayList<>();
        JsonNode packageQuestions = packageQuestions(snapshot.contentJson());
        if (packageQuestions.isEmpty()) {
            log.warn("报告 {} 的内容包题目极点不可用，本次不做逐题证据（仍发送四维摘要与候选）。",
                    snapshot.reportId());
            return pool;
        }
        for (String dimension : DIMENSIONS) {
            JsonNode array = packageQuestions.path(dimension);
            for (JsonNode question : array) {
                String questionId = text(question.path("id"));
                if (questionId == null) {
                    continue;
                }
                AiReportSnapshot.Answer answer = snapshot.answers().get(questionId);
                if (answer == null || !answer.rated()) {
                    continue;
                }
                int c = contribution(dimension, question.path("rightPole").asText(null), answer.rating());
                pool.add(new QuestionContribution(questionId, dimension,
                        text(question.path("scenario")),
                        text(question.path("leftPole")), text(question.path("rightPole")),
                        question.path("order").asInt(0), c));
            }
        }
        return pool;
    }

    /** 内容包题目按维度分组：[{questionId, dimension, scenario, leftPole, rightPole, order}]。 */
    private JsonNode packageQuestions(String contentJson) {
        ObjectNode grouped = mapper.createObjectNode();
        for (String dimension : DIMENSIONS) {
            grouped.putArray(dimension);
        }
        if (contentJson == null || contentJson.isBlank()) {
            return grouped;
        }
        JsonNode root = readJson(contentJson);
        JsonNode questions = root.path("questions");
        if (!questions.isArray()) {
            return grouped;
        }
        for (JsonNode question : questions) {
            String dimension = text(question.path("dimension"));
            if (dimension == null || !grouped.has(dimension)) {
                continue;
            }
            // 只带最小必要字段；不带题干正文。
            ObjectNode row = mapper.createObjectNode();
            row.put("id", text(question.path("id")));
            row.put("scenario", text(question.path("scenario")));
            row.put("leftPole", text(question.path("leftPole")));
            row.put("rightPole", text(question.path("rightPole")));
            row.put("order", question.path("order").asInt(0));
            ((ArrayNode) grouped.get(dimension)).add(row);
        }
        return grouped;
    }

    /**
     * {@code c = direction × (r − 3)}，其中 {@code direction = +1} 当右侧是正极，否则 −1。
     *
     * <p>这里刻意**从极点重新推导方向**，而不是复用报告里的 S：S 是求和结果，
     * 无法还原单题贡献。极点取错会让整条证据链反向，所以结果用 `Math.clamp` 钉在 [−2, 2]。
     *
     * <p><b>维度必须由调用方传入</b>：本方法原先从题目节点上读 {@code dimension}，而
     * {@link #packageQuestions} 重建节点时**刻意不带**该字段（每维度已经分组过），
     * 于是它永远读到 null 并静默返回 0 —— 后果是每道题的位置都被算成"中间档"，
     * 最硬的同向/反向证据根本挑不出来，证据退化成按 order 的前几条。
     * 这类"缺字段即静默算 0"的写法不允许再出现：宁可让调用方显式给出，也不要猜。
     */
    static int contribution(String dimension, String rightPole, int rating) {
        if (rightPole == null || rightPole.isBlank() || dimension == null || dimension.isBlank()
                || rating < 1 || rating > 5) {
            return 0;
        }
        boolean rightIsPositive = isPositivePole(dimension, rightPole);
        int direction = rightIsPositive ? 1 : -1;
        return Math.clamp((long) direction * (rating - 3), -2, 2);
    }

    private static boolean isPositivePole(String dimension, String pole) {
        if (pole == null || pole.isBlank()) {
            return false;
        }
        char letter = Character.toUpperCase(pole.trim().charAt(0));
        return switch (dimension.toUpperCase(Locale.ROOT)) {
            case "EI" -> letter == 'E';
            case "SN" -> letter == 'N';
            case "TF" -> letter == 'F';
            case "JP" -> letter == 'P';
            default -> false;
        };
    }

    /** 同向：方向与 computedPole 一致；优先 |c| = 2，没有就退到 |c| = 1。 */
    private static QuestionContribution bestSameDirection(List<QuestionContribution> items, String computedPole) {
        if (computedPole == null || computedPole.isBlank()) {
            // 平分维度（computedPole=null）：没有"同向"概念，按契约取 |c| 最大的一条作为该维代表。
            return items.stream()
                    .filter(item -> item.c() != 0)
                    .max(Comparator.comparingInt(item -> Math.abs(item.c())))
                    .orElse(null);
        }
        char pole = computedPole.trim().charAt(0);
        QuestionContribution magnitudeTwo = null;
        QuestionContribution fallback = null;
        for (QuestionContribution item : items) {
            if (!sameDirection(item, pole)) {
                continue;
            }
            if (Math.abs(item.c()) == 2) {
                magnitudeTwo = item;
                break;
            }
            if (fallback == null) {
                fallback = item;
            }
        }
        return magnitudeTwo != null ? magnitudeTwo : fallback;
    }

    /** 反向：方向与该维 computedPole 相反，取 |c| 最大；平分维度取反向符号里 |c| 最大的。 */
    private static QuestionContribution strongestOpposite(List<QuestionContribution> items, String computedPole) {
        QuestionContribution best = null;
        for (QuestionContribution item : items) {
            boolean opposite;
            if (computedPole == null || computedPole.isBlank()) {
                opposite = item.c() != 0;
            } else {
                opposite = !sameDirection(item, computedPole.trim().charAt(0));
            }
            if (!opposite || item.c() == 0) {
                continue;
            }
            if (best == null || Math.abs(item.c()) > Math.abs(best.c())) {
                best = item;
            }
        }
        return best;
    }

    private static boolean sameDirection(QuestionContribution item, char computedPole) {
        // c 的符号就是方向：>0 偏正极，<0 偏负极。用**该维**的正极定义判断 c 指向哪一侧。
        boolean computedIsPositive = isPositivePole(item.dimension(), String.valueOf(computedPole));
        return computedIsPositive ? item.c() > 0 : item.c() < 0;
    }

    private void add(List<AiReportInput.Evidence> selected, Set<String> used,
                     QuestionContribution item, String dimension) {
        if (used.contains(item.questionId()) || selected.size() >= MAX_EVIDENCE) {
            return;
        }
        used.add(item.questionId());
        selected.add(new AiReportInput.Evidence(
                dimension + ":item:" + item.questionId(),
                describe(item),
                dimension,
                item.questionId(),
                item.c(),
                item.order()));
    }

    /**
     * 片段文本：**只有**题号、该维两端字母、用户选的位置、一句话场景标签。
     *
     * <p>不含完整题干、不含量表名称以外的账号信息（契约 §4）。
     */
    private static String describe(QuestionContribution item) {
        String poles = POLE_LETTERS.getOrDefault(item.dimension(), "?/?");
        String scenario = item.scenario() == null ? "" : truncate(item.scenario(), SCENARIO_LIMIT);
        String position = position(item.c(), item.leftPole(), item.rightPole(), poles);
        return "题 " + item.questionId() + "（" + poles + "，场景：" + scenario + "）：用户" + position + "。";
    }

    /** 把 c 还原成"左/右第几档"的可读位置：中间值就是两边差不多。 */
    private static String position(int c, String leftPole, String rightPole, String poles) {
        int magnitude = Math.abs(c);
        if (magnitude == 0) {
            return "选了中间（两边差不多）";
        }
        // c 的符号指向"正极"，而正极可能是右也可能是左，需要用题目自身的左右极点还原。
        String positivePole = poles.contains("/") ? poles.substring(poles.indexOf('/') + 1) : "";
        boolean pointsRight = rightPole != null && rightPole.equalsIgnoreCase(positivePole);
        String side = (c > 0) == pointsRight ? "右侧" : "左侧";
        String strength = magnitude == 2 ? "很靠" : "比较靠";
        return "选了" + strength + side + "第 " + magnitude + " 档";
    }

    private static String truncate(String value, int limit) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.length() <= limit) {
            return trimmed;
        }
        return trimmed.substring(0, limit) + "…";
    }

    /* ── user message 与 scope 摘要 ─────────────────────────────────────── */

    private Map<String, Object> buildPayload(AiTopic topic, String computedTypeCode, String status,
                                             List<DimensionInput> dimensions, List<Map<String, Object>> candidates,
                                             String tieNotice, Map<String, Object> processLayer,
                                             List<AiReportInput.Evidence> evidence,
                                             String normalizedNote) {

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("status", status);
        report.put("referenceType", computedTypeCode);
        List<Map<String, Object>> dimensionRows = new ArrayList<>(dimensions.size());
        for (DimensionInput dimension : dimensions) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("dimension", dimension.dimension());
            row.put("computedPole", dimension.computedPole());
            row.put("mFinal", dimension.mFinal());
            row.put("boundary", dimension.boundary());
            row.put("nFinal", dimension.nFinal());
            dimensionRows.add(row);
        }
        report.put("dimensions", dimensionRows);
        report.put("candidates", candidates);
        report.put("tieNotice", tieNotice);
        // 过程层为 null（TIED / 旧报告）时**整个键都不放**：模型据此走提示词里的"没有这一层"分支，
        // 而不是收到一个空壳后以为"结构为空、当事人没有过程"。
        if (processLayer != null) {
            report.put("processLayer", processLayer);
        }

        List<Map<String, Object>> evidenceRows = new ArrayList<>(evidence.size());
        for (AiReportInput.Evidence item : evidence) {
            evidenceRows.add(item.asPayload());
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("task", "explain_report");
        payload.put("topic", topic.wire());
        payload.put("report", report);
        payload.put("evidence", evidenceRows);
        payload.put("userNote", normalizedNote);
        payload.put("outputSchema", outputSchema());
        return payload;
    }

    /** 与契约 03 §3 一致的字段说明 + 示例（json 字样与结构示例是官方 JSON Output 的硬要求）。 */
    private Map<String, Object> outputSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("format", "json_object");
        schema.put("instructions", "只输出一个 json 对象；字段与长度限制如下，超出即整份作废。");
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("schemaVersion", "固定字符串 \"1\"");
        fields.put("referenceType", "必须原样回填 report.referenceType（可为 null）");
        fields.put("summary", "20–400 字");
        fields.put("sections", "2–6 个；key ∈ overall/communication/studyWork/growth/boundary；"
                + "title 1–20 字；body 80–1200 字；evidenceIds 必须在本次白名单内");
        fields.put("boundaryNotes", "0–4 条，每条 10–300 字");
        fields.put("actions", "恰好 3 条；title 1–30 字；steps 1–5 条、每条 5–120 字；evidenceIds 在白名单内");
        fields.put("reflectionQuestions", "恰好 2 条，每条 10–120 字");
        schema.put("fields", fields);
        Map<String, Object> example = new LinkedHashMap<>();
        example.put("schemaVersion", "1");
        example.put("referenceType", "ENFP");
        example.put("summary", "……（80–160 字）");
        example.put("sections", List.of(Map.of(
                "key", "communication",
                "title", "沟通方式",
                "body", "……（150–350 字）",
                "evidenceIds", List.of("EI:item:EI-03"))));
        example.put("boundaryNotes", List.of("……（可选，0–4 条）"));
        example.put("actions", List.of(Map.of(
                "title", "安排一次慢下来的沟通",
                "steps", List.of("……", "……"),
                "evidenceIds", List.of("EI:summary"))));
        example.put("reflectionQuestions", List.of("……", "……"));
        schema.put("example", example);
        return schema;
    }

    /** 发给上游的 user message：**单个 JSON 字符串**（禁用多轮、禁用工具调用）。 */
    public String userMessage(AiReportInput input) {
        try {
            return mapper.writeValueAsString(input.payload());
        } catch (Exception ex) {
            throw new IllegalStateException("无法序列化 AI 输入 payload", ex);
        }
    }

    /** 落 {@code ai_consent.scope} 的结构化摘要：字段名列表 + 片段数 + 是否含用户文字。 */
    public String scopeSummary(AiReportInput input) {
        List<String> fields = new ArrayList<>(List.of(
                "topic", "report.status", "report.referenceType", "report.dimensions", "report.candidates"));
        if (input.evidence() != null && !input.evidence().isEmpty()) {
            fields.add("evidence");
        }
        if (input.normalizedNote() != null && !input.normalizedNote().isEmpty()) {
            fields.add("userNote");
        }
        String summary = String.join(",", fields)
                + ";evidenceCount=" + (input.evidence() == null ? 0 : input.evidence().size())
                + ";includesUserText=" + (input.normalizedNote() != null && !input.normalizedNote().isEmpty())
                + ";scopeVersion=" + input.scopeVersion()
                + ";promptVersion=" + input.promptVersion();
        // ai_consent.scope 是 VARCHAR(500)：超长时截断（前面是字段清单，截掉的是版本后缀）。
        return summary.length() <= 500 ? summary : summary.substring(0, 500);
    }

    /** 证据 id 白名单落 consent：逗号分隔，最多 8 项。 */
    public String evidenceIdsCsv(AiReportInput input) {
        return String.join(",", input.evidenceIds());
    }

    /* ── 小工具 ─────────────────────────────────────────────────────────── */

    private JsonNode readJson(String json) {
        try {
            return mapper.readTree(json);
        } catch (Exception ex) {
            throw new IllegalStateException("报告/内容包 JSON 无法解析，已拒绝构造 AI 输入。", ex);
        }
    }

    private static String text(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return null;
        }
        String value = node.asText();
        return value == null || value.isBlank() ? null : value;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private static String blankToNull(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second == null || second.isBlank() ? null : second;
    }

    private static Double round2(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull() || !node.isNumber()) {
            return null;
        }
        return Math.round(node.asDouble() * 100.0) / 100.0;
    }

    /**
     * 规范化用户文字：统一换行、压缩空白、去掉首尾空白。
     *
     * <p>目的只有一个：让"同一段话"稳定地得到同一个 hash，否则用户重发同样的内容会被
     * 当成新请求、重复扣额度。空/未填归一成空串（而不是 null），避免 hash 输入形态漂移。
     */
    public static String normalizeNote(String note) {
        if (note == null) {
            return "";
        }
        return note.replaceAll("\\s+", " ").trim();
    }

    /** 供上层判断"报告快照是否可读"（例如 worker 写回前重新确认）。 */
    public Optional<AiReportSnapshot> snapshot(String reportId) {
        return snapshotReader.find(reportId);
    }
}
