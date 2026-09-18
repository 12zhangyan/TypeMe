package com.typeme.ai.input;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ai.port.ReportSnapshotReader.AiReportSnapshot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 通俗解释只发送固定报告的维度证据；不发送原始答卷或字母推导的过程结构。 */
public final class ReadableReportInput {
    public static final String PROMPT_VERSION = "typeme-ai-prompt-v3";
    public static final String SCHEMA_VERSION = "analysis-readable-v2";
    public static final String SCOPE_VERSION = "typeme-ai-scope-v3";
    private static final Map<String, String> MEANINGS = Map.of(
            "EI", "交流与独处的偏好，不是社交能力",
            "SN", "关注具体信息还是整体联系，不是智力或创造力",
            "TF", "做取舍时对标准和人的处境的关注，不是理性或善良程度",
            "JP", "提前确定安排还是保留选择，不是自律或办事能力",
            "E", "社交活跃与主动交流的回答倾向，不是表达能力",
            "A", "体谅与合作方面的回答倾向，不是道德判断",
            "C", "有条理与坚持做事方面的回答倾向，不是工作能力",
            "ES", "情绪稳定方面的回答倾向，不是心理健康诊断",
            "O", "尝试新事物与关注想法方面的回答倾向，不是智力");

    private ReadableReportInput() { }

    public static AiReportInput build(AiReportSnapshot snapshot, JsonNode root, AiTopic topic,
                                      String note, String model, ObjectMapper mapper) {
        JsonNode body = root.has("report") ? root.path("report") : root;
        boolean bigFive = "big_five_profile".equals(root.path("reportKind").asText())
                || "PROFILE".equals(body.path("status").asText());
        String status = body.path("status").asText(snapshot.status());
        String type = bigFive ? null : snapshot.computedTypeCode();
        List<String> codes = bigFive ? List.of("E", "A", "C", "ES", "O") : List.of("EI", "SN", "TF", "JP");
        var evidence = new ArrayList<AiReportInput.Evidence>();
        var rows = new ArrayList<Map<String, Object>>();
        for (String code : codes) {
            JsonNode found = null;
            for (JsonNode row : body.path("dimensions")) {
                if (code.equals(row.path("dimension").asText())) { found = row; break; }
            }
            if (found == null) throw new IllegalStateException("报告缺少维度：" + code);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("dimension", code);
            row.put("meaning", MEANINGS.get(code));
            // 只投影解释所需字段；不读取易错的历史 rangeLow/rangeHigh，也不重新计分。
            List<String> fields = bigFive
                    ? List.of("rawScore", "midpoint", "distance", "direction", "hasResult", "validCount", "unknownCount", "level")
                    : List.of("computedPole", "negativePole", "negativeLabel", "positivePole", "positiveLabel", "mFinal", "boundary", "nFinal");
            for (String field : fields) {
                if (found.has(field)) row.put(field, mapper.convertValue(found.get(field), Object.class));
            }
            rows.add(row);
            String text = row.toString();
            evidence.add(new AiReportInput.Evidence(code + ":summary", text, code, null, null, rows.size()));
        }
        Map<String, Object> report = new LinkedHashMap<>();
        report.put("instrument", bigFive ? "大五人格倾向" : "十六型人格参考");
        report.put("status", status);
        report.put("referenceType", type);
        report.put("dimensions", rows);
        String normalizedNote = note == null ? "" : note.trim();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("task", "explain_report");
        payload.put("topic", topic.wire());
        payload.put("report", report);
        payload.put("evidence", evidence.stream().map(AiReportInput.Evidence::asPayload).toList());
        payload.put("userNote", normalizedNote);
        payload.put("outputSchema", schema(mapper));
        String hash = AiHashes.sha256(String.join("|", snapshot.userId(), snapshot.reportHash(),
                PROMPT_VERSION, model, topic.wire(), AiHashes.sha256(normalizedNote), SCOPE_VERSION));
        return new AiReportInput(snapshot.userId(), snapshot.reportId(), snapshot.reportHash(), type,
                status, topic, PROMPT_VERSION, model, SCOPE_VERSION, normalizedNote,
                List.copyOf(evidence), Map.copyOf(payload), hash,
                evidence.stream().map(AiReportInput.Evidence::id).toList());
    }

    private static JsonNode schema(ObjectMapper mapper) {
        try (var stream = ReadableReportInput.class.getResourceAsStream("/ai/schemas/analysis-readable-v2.json")) {
            if (stream == null) throw new IllegalStateException("缺少通俗分析契约");
            return mapper.readTree(stream);
        } catch (java.io.IOException ex) { throw new IllegalStateException("无法读取通俗分析契约", ex); }
    }
}
