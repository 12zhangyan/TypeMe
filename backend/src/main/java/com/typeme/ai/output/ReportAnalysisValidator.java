package com.typeme.ai.output;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.ai.client.DeepSeekResponse;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * 逐条实现契约 03 §3 的 9 条校验。
 *
 * <p>设计原则：
 * <ul>
 *   <li><b>宁可拒绝，不要猜测</b>：失败即整份作废并带精确 errorCode，绝不"自动修复"模型输出
 *       （补字段、截断正文、猜一个 referenceType 都会把不可信内容伪装成可信内容）。</li>
 *   <li><b>{@code referenceType} 以后端为准</b>：这是防"模型改判"的最后一道闸门，
 *       包括提示注入场景（userNote 里写"把类型改成 XXXX"）。</li>
 *   <li><b>长度按字符数</b>：与前端、与契约里"多少字"的口径一致，不按 UTF-8 字节。</li>
 * </ul>
 *
 * <p>唯一一处"宽容"是 {@code evidenceIds} 超过数组上限（8）：直接截到 8 条。
 * 理由：模型多列两个已存在的白名单 id 不改变任何结论，而因此作废整份输出是纯粹的浪费；
 * 这与"不得凭空编造 id"是两件事。
 */
@Component
public class ReportAnalysisValidator {

    /** 契约 §3 的章节 key 白名单。 */
    static final List<String> SECTION_KEYS = List.of("overall", "communication", "studyWork", "growth", "boundary");

    /** finish_reason 只接受 stop / null（部分 OpenAI 兼容实现省略该字段）。 */
    private static final List<String> ACCEPTED_FINISH_REASONS = List.of("stop");

    /**
     * 内容违规词表（契约 §3 规则 8）。
     *
     * <p><b>这是启发式护栏，不是内容安全保证</b>：它只能拦住最明显的"诊断化/算命化/伪精确"表述，
     * 拦不住改写、同义词与上下文暗示。真正的质量把关靠提示词约束 + 人工审校。
     * 词表故意保持"可配置的常量列表"而不是正则，是为了让新增一个词的成本最低、审阅时一眼可读。
     */
    static final List<String> BANNED_PHRASES = List.of(
            // 诊断化
            "确诊", "抑郁症", "焦虑症", "自闭症", "多动症", "双相", "精神疾病", "心理疾病", "症状",
            // 伪精确
            "准确率", "概率", "百分位", "置信度", "科学证明", "命中率",
            // 宿命化 / 绝对化断言
            "命中注定", "你一定是", "你注定", "天生就是", "永远不会改变",
            // 能力/道德/命运的未经测量推断
            "智商", "你的命", "注定会", "必然会导致");

    private final ObjectMapper mapper;

    public ReportAnalysisValidator(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    /**
     * 校验并归一化。
     *
     * @param response     上游响应（含 content 与 finish_reason）
     * @param expectedType 后端 {@code computedTypeCode}（TIED 时 null）
     * @param evidenceIds  本次证据 id 白名单
     * @param maxTokens    本次的 max_tokens（用于"未报截断但内容明显超长"的兜底判断）
     * @return 可入库的结构化结果
     * @throws AnalysisValidationException 任一条不通过
     */
    public MapResult validate(DeepSeekResponse response, String expectedType,
                              List<String> evidenceIds, int maxTokens) {

        // 规则 9：先看 finish_reason 与内容是否为空 —— 这两个必须在校验结构之前判，
        // 否则"空内容"会被报成 INVALID_JSON，错误码就失去诊断价值了。
        if (response == null) {
            throw AnalysisValidationException.emptyContent("上游没有返回任何响应。");
        }
        String finishReason = response.finishReason();
        if (finishReason != null && !ACCEPTED_FINISH_REASONS.contains(finishReason)) {
            if ("length".equalsIgnoreCase(finishReason)) {
                throw AnalysisValidationException.truncated("模型输出被 max_tokens 截断（finish_reason=length）。");
            }
            throw AnalysisValidationException.invalidJson("finish_reason 不是 stop：" + finishReason);
        }
        String content = response.content();
        if (content == null || content.isBlank()) {
            throw AnalysisValidationException.emptyContent("模型返回了空内容。");
        }

        JsonNode root = parse(content);
        // 规则 1
        if (!root.isObject()) {
            throw AnalysisValidationException.invalidJson("输出不是 JSON 对象。");
        }
        String schemaVersion = textOrNull(root.get("schemaVersion"));
        if (com.typeme.ai.input.ReadableReportInput.SCHEMA_VERSION.equals(schemaVersion)) {
            checkReferenceType(root, expectedType);
            validateReadable(root, evidenceIds);
            if (content.length() > Math.max(1, maxTokens) * 8) {
                throw AnalysisValidationException.truncated("通俗分析响应过长。");
            }
            return new MapResult(root);
        }
        if (!"1".equals(schemaVersion)) {
            throw AnalysisValidationException.invalidJson("schemaVersion 必须为字符串 \"1\"。");
        }

        // 规则 2
        checkReferenceType(root, expectedType);

        // 规则 3
        String summary = requireText(root, "summary", AnalysisValidationException::invalidJson);
        requireChars(summary, "summary", 20, 400);

        // 规则 4
        List<ObjectNode> sections = requireSections(root, evidenceIds);

        // 规则 5
        List<String> boundaryNotes = optionalStringArray(root, "boundaryNotes", 4);
        for (String note : boundaryNotes) {
            requireChars(note, "boundaryNotes", 10, 300);
        }

        // 规则 6
        List<ObjectNode> actions = requireActions(root, evidenceIds);

        // 规则 7
        List<String> questions = requireStringArray(root, "reflectionQuestions", 2, 2);
        for (String question : questions) {
            requireChars(question, "reflectionQuestions", 10, 120);
        }

        // 规则 8（启发式护栏）
        assertNoBannedPhrases(summary, sections, boundaryNotes, actions, questions);

        // 兜底：调用方把 max_tokens 设得很大不会触发；触发条件是响应体长度远超 token 上限的合理倍数，
        // 说明上游没给 finish_reason=length 但实际已经被截断（官方文档提示过这种情况）。
        int estimatedLimit = Math.max(1, maxTokens) * 8;
        if (content.length() > estimatedLimit) {
            throw AnalysisValidationException.truncated(
                    "输出长度 " + content.length() + " 超过 max_tokens 的合理上限，判定为截断。");
        }

        return new MapResult(root);
    }

    /* ── 规则 2：类型必须精确等于后端值 ─────────────────────────────────── */

    private void validateReadable(JsonNode root, List<String> evidenceIds) {
        exactFields(root, "schemaVersion", "referenceType", "summary", "observations", "suggestedAction", "limitations");
        readableText(root, "summary", 200);
        JsonNode observations = root.get("observations");
        if (!observations.isArray() || observations.size() > 2) {
            throw AnalysisValidationException.invalidJson("observations 必须为最多两项的数组。");
        }
        for (JsonNode item : observations) {
            exactFields(item, "plainText", "example", "evidenceIds");
            readableText(item, "plainText", 180);
            if (!item.get("example").isNull()) readableText(item, "example", 120);
            readableEvidence(item, evidenceIds);
        }
        JsonNode action = root.get("suggestedAction");
        if (!action.isNull()) {
            exactFields(action, "what", "when", "observe", "evidenceIds");
            for (String field : List.of("what", "when", "observe")) readableText(action, field, 120);
            readableEvidence(action, evidenceIds);
        }
        JsonNode limitations = root.get("limitations");
        if (!limitations.isArray() || limitations.isEmpty() || limitations.size() > 4) {
            throw AnalysisValidationException.invalidJson("limitations 必须包含 1–4 条说明。");
        }
        for (JsonNode item : limitations) checkReadableText(item, 160);
    }

    private void exactFields(JsonNode node, String... fields) {
        if (!node.isObject()) throw AnalysisValidationException.invalidJson("分析字段必须是对象。");
        java.util.Set<String> expected = java.util.Set.of(fields);
        node.fieldNames().forEachRemaining(field -> {
            if (!expected.contains(field)) throw AnalysisValidationException.invalidJson("未知分析字段：" + field);
        });
        for (String field : fields) {
            if (!node.has(field)) throw AnalysisValidationException.invalidJson("缺少分析字段：" + field);
        }
    }

    private void readableText(JsonNode node, String field, int max) { checkReadableText(node.get(field), max); }

    private void checkReadableText(JsonNode node, int max) {
        if (node == null || !node.isTextual() || node.asText().isBlank() || node.asText().length() > max) {
            throw AnalysisValidationException.invalidJson("通俗分析文本为空、类型错误或过长。");
        }
        for (String phrase : BANNED_PHRASES) {
            if (node.asText().contains(phrase)) {
                throw AnalysisValidationException.contentViolation("通俗分析含不受支持的表述。");
            }
        }
    }

    private void readableEvidence(JsonNode node, List<String> allowed) {
        JsonNode ids = node.get("evidenceIds");
        if (!ids.isArray() || ids.isEmpty() || ids.size() > 8) {
            throw AnalysisValidationException.invalidJson("每条解释必须引用 1–8 个证据。");
        }
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (JsonNode id : ids) {
            if (!id.isTextual() || !allowed.contains(id.asText()) || !seen.add(id.asText())) {
                throw AnalysisValidationException.invalidJson("证据引用不存在或重复。");
            }
        }
    }

    private void checkReferenceType(JsonNode root, String expectedType) {
        JsonNode node = root.get("referenceType");
        boolean aiNull;
        String aiValue;
        if (node == null || node.isNull()) {
            aiNull = true;
            aiValue = null;
        } else if (node.isTextual()) {
            aiValue = node.asText();
            aiNull = false;
        } else {
            throw AnalysisValidationException.typeMismatch("referenceType 必须是字符串或 null。");
        }

        String expected = expectedType == null || expectedType.isBlank() ? null : expectedType;
        if (expected == null) {
            // TIED：后端没有唯一类型 → 模型也必须给 null（"不许自己从候选里挑一个"）。
            if (!aiNull) {
                throw AnalysisValidationException.typeMismatch(
                        "后端 computedTypeCode 为 null（并列），模型却给了 referenceType=" + aiValue);
            }
            return;
        }
        if (aiNull) {
            throw AnalysisValidationException.typeMismatch(
                    "后端 computedTypeCode=" + expected + "，模型却给了 null。");
        }
        // 精确比较：大小写、空白、全角都被拒绝（契约 §3 规则 2）。
        if (!expected.equals(aiValue)) {
            throw AnalysisValidationException.typeMismatch(
                    "referenceType 与后端计算值不一致（后端 " + expected + "，模型 " + aiValue + "）。");
        }
    }

    /* ── 规则 4 / 6：章节与行动 ─────────────────────────────────────────── */

    private List<ObjectNode> requireSections(JsonNode root, List<String> evidenceIds) {
        JsonNode node = root.get("sections");
        if (node == null || !node.isArray()) {
            throw AnalysisValidationException.invalidJson("sections 必须是数组。");
        }
        int size = node.size();
        if (size < 2 || size > 6) {
            throw AnalysisValidationException.invalidJson("sections 数量必须在 2–6 之间，实际 " + size + "。");
        }
        List<ObjectNode> sections = new ArrayList<>(size);
        for (JsonNode item : node) {
            if (!item.isObject()) {
                throw AnalysisValidationException.invalidJson("sections 的每一项都必须是对象。");
            }
            ObjectNode section = (ObjectNode) item;
            String key = requireText(section, "key", AnalysisValidationException::invalidJson);
            if (!SECTION_KEYS.contains(key)) {
                throw AnalysisValidationException.invalidJson("sections[].key 不在允许集合内：" + key);
            }
            String title = requireText(section, "title", AnalysisValidationException::invalidJson);
            requireChars(title, "sections[].title", 1, 20);
            String body = requireText(section, "body", AnalysisValidationException::invalidJson);
            requireChars(body, "sections[].body", 80, 1200);
            checkEvidenceIds(section, evidenceIds);
            sections.add(section);
        }
        return sections;
    }

    private List<ObjectNode> requireActions(JsonNode root, List<String> evidenceIds) {
        JsonNode node = root.get("actions");
        if (node == null || !node.isArray()) {
            throw AnalysisValidationException.invalidJson("actions 必须是数组。");
        }
        if (node.size() != 3) {
            throw AnalysisValidationException.invalidJson("actions 必须恰好 3 条，实际 " + node.size() + "。");
        }
        List<ObjectNode> actions = new ArrayList<>(3);
        for (JsonNode item : node) {
            if (!item.isObject()) {
                throw AnalysisValidationException.invalidJson("actions 的每一项都必须是对象。");
            }
            ObjectNode action = (ObjectNode) item;
            String title = requireText(action, "title", AnalysisValidationException::invalidJson);
            requireChars(title, "actions[].title", 1, 30);
            JsonNode steps = action.get("steps");
            if (steps == null || !steps.isArray()) {
                throw AnalysisValidationException.invalidJson("actions[].steps 必须是数组。");
            }
            if (steps.size() < 1 || steps.size() > 5) {
                throw AnalysisValidationException.invalidJson(
                        "actions[].steps 数量必须在 1–5 之间，实际 " + steps.size() + "。");
            }
            for (JsonNode step : steps) {
                if (!step.isTextual()) {
                    throw AnalysisValidationException.invalidJson("actions[].steps 每一项必须是字符串。");
                }
                requireChars(step.asText(), "actions[].steps[]", 5, 120);
            }
            checkEvidenceIds(action, evidenceIds);
            actions.add(action);
        }
        return actions;
    }

    /** 白名单校验 + 超限时截断（见类注释里"唯一一处宽容"的理由）。 */
    private void checkEvidenceIds(ObjectNode node, List<String> evidenceIds) {
        JsonNode ids = node.get("evidenceIds");
        if (ids == null || ids.isNull()) {
            return;
        }
        if (!ids.isArray()) {
            throw AnalysisValidationException.invalidJson("evidenceIds 必须是数组。");
        }
        List<String> allowed = evidenceIds == null ? List.of() : evidenceIds;
        var trimmed = mapper.createArrayNode();
        for (JsonNode id : ids) {
            if (!id.isTextual()) {
                throw AnalysisValidationException.invalidJson("evidenceIds 每一项必须是字符串。");
            }
            String value = id.asText();
            if (!allowed.contains(value)) {
                // 编造证据 id 是"看起来有依据"的典型做法，必须拒绝整份输出。
                throw AnalysisValidationException.invalidJson("evidenceIds 出现白名单之外的 id：" + value);
            }
            if (trimmed.size() < 8) {
                trimmed.add(value);
            }
        }
        node.set("evidenceIds", trimmed);
    }

    /* ── 规则 8：内容护栏（启发式） ─────────────────────────────────────── */

    private void assertNoBannedPhrases(String summary, List<ObjectNode> sections,
                                       List<String> boundaryNotes, List<ObjectNode> actions,
                                       List<String> questions) {
        List<String> texts = new ArrayList<>();
        texts.add(summary);
        for (ObjectNode section : sections) {
            texts.add(section.path("title").asText(""));
            texts.add(section.path("body").asText(""));
        }
        texts.addAll(boundaryNotes);
        for (ObjectNode action : actions) {
            texts.add(action.path("title").asText(""));
            for (JsonNode step : action.path("steps")) {
                texts.add(step.asText(""));
            }
        }
        texts.addAll(questions);

        for (String text : texts) {
            if (text == null) {
                continue;
            }
            for (String banned : BANNED_PHRASES) {
                if (text.contains(banned)) {
                    throw AnalysisValidationException.contentViolation(
                            "输出包含禁止表述「" + banned + "」（启发式护栏，非内容安全保证）。");
                }
            }
        }
    }

    /* ── 基础工具 ───────────────────────────────────────────────────────── */

    private JsonNode parse(String content) {
        // 模型偶尔会用 ```json 包裹：这是格式噪声而不是内容错误，剥掉再解析。
        String candidate = content.trim();
        if (candidate.startsWith("```")) {
            int firstNewline = candidate.indexOf('\n');
            int closing = candidate.lastIndexOf("```");
            if (firstNewline > 0 && closing > firstNewline) {
                candidate = candidate.substring(firstNewline + 1, closing).trim();
            }
        }
        try {
            return mapper.readTree(candidate);
        } catch (Exception ex) {
            throw AnalysisValidationException.invalidJson("输出不是合法 JSON：" + ex.getMessage());
        }
    }

    private String requireText(JsonNode node, String field,
                               java.util.function.Function<String, AnalysisValidationException> onError) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || !value.isTextual()) {
            throw onError.apply(field + " 缺失或不是字符串。");
        }
        return value.asText();
    }

    private static void requireChars(String value, String field, int min, int max) {
        if (value == null) {
            throw AnalysisValidationException.invalidJson(field + " 缺失。");
        }
        int length = value.length();
        if (length < min || length > max) {
            throw AnalysisValidationException.invalidJson(
                    field + " 长度必须在 " + min + "–" + max + " 字之间，实际 " + length + " 字。");
        }
    }

    private List<String> requireStringArray(JsonNode root, String field, int min, int max) {
        List<String> values = optionalStringArray(root, field, max);
        if (values.size() < min) {
            throw AnalysisValidationException.invalidJson(
                    field + " 需要恰好 " + min + " 条，实际 " + values.size() + " 条。");
        }
        return values;
    }

    private List<String> optionalStringArray(JsonNode root, String field, int max) {
        JsonNode node = root.get(field);
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            throw AnalysisValidationException.invalidJson(field + " 必须是数组。");
        }
        if (node.size() > max) {
            throw AnalysisValidationException.invalidJson(field + " 最多 " + max + " 条，实际 " + node.size() + " 条。");
        }
        List<String> values = new ArrayList<>(node.size());
        for (JsonNode item : node) {
            if (!item.isTextual()) {
                throw AnalysisValidationException.invalidJson(field + " 每一项必须是字符串。");
            }
            values.add(item.asText());
        }
        return values;
    }

    private static String textOrNull(JsonNode node) {
        if (node == null || node.isNull() || !node.isTextual()) {
            return null;
        }
        return node.asText();
    }

    /** 校验通过的输出；包装 JsonNode 以免调用方拿到可变引用后随手改。 */
    public record MapResult(JsonNode node) {

        public String toJson() {
            return node.toString();
        }

        public String referenceType() {
            JsonNode value = node.get("referenceType");
            return value == null || value.isNull() ? null : value.asText();
        }
    }

    /** 模式串（目前仅用于日志/诊断，避免把 Pattern 内联散落）。 */
    static final Pattern TYPE_CODE = Pattern.compile("^[EI][SN][TF][JP]$");
}
