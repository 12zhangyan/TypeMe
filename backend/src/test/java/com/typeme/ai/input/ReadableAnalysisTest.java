package com.typeme.ai.input;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.ai.client.DeepSeekResponse;
import com.typeme.ai.output.AnalysisValidationException;
import com.typeme.ai.output.ReportAnalysisValidator;
import com.typeme.ai.port.ReportSnapshotReader.AiReportSnapshot;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/** 无数据库和模型调用：验证两种报告的发送边界与不可信输出的校验。 */
class ReadableAnalysisTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ReportAnalysisValidator validator = new ReportAnalysisValidator(mapper);

    private AiReportInput input(boolean bigFive, boolean envelope, String owner) {
        ObjectNode report = mapper.createObjectNode();
        report.put("status", bigFive ? "PROFILE" : "TIED");
        report.put("processLayer", "MUST_NOT_SEND");
        report.put("reportId", "PRIVATE_REPORT");
        var dimensions = report.putArray("dimensions");
        for (String code : bigFive ? List.of("E", "A", "C", "ES", "O") : List.of("EI", "SN", "TF", "JP")) {
            var row = dimensions.addObject().put("dimension", code);
            if (bigFive) {
                row.put("rawScore", 30).put("midpoint", 30).put("hasResult", true)
                        .put("validCount", 10).put("unknownCount", 0).put("level", "middle");
            } else {
                row.putNull("computedPole");
                row.put("mFinal", 0).put("boundary", true).put("nFinal", 12);
            }
            row.put("privateField", "MUST_NOT_SEND");
        }
        ObjectNode root = report;
        if (envelope) {
            root = mapper.createObjectNode();
            root.put("reportKind", bigFive ? "big_five_profile" : "jung_type");
            root.set("report", report);
        }
        var snapshot = new AiReportSnapshot("PRIVATE_REPORT", "PRIVATE_OWNER", bigFive ? "PROFILE" : "TIED",
                null, "hash", "PRIVATE_ATTEMPT", null, "package", "SECRET_QUESTION_TEXT",
                Map.of("q1", new AiReportSnapshot.Answer("q1", "RATING", 5)), root.toString());
        return new ReportInputBuilder(id -> Optional.of(snapshot), mapper)
                .build("PRIVATE_REPORT", owner, AiTopic.OVERALL, "", ReadableReportInput.PROMPT_VERSION, "mock");
    }

    @Test void bothInstrumentsAndHistoricalEnvelopesHaveOnlyDimensionEvidence() throws Exception {
        for (boolean bigFive : List.of(false, true)) for (boolean envelope : List.of(false, true)) {
            var input = input(bigFive, envelope, "PRIVATE_OWNER");
            String json = mapper.writeValueAsString(input.payload());
            for (String privateText : List.of("PRIVATE_", "SECRET_", "MUST_NOT_SEND", "processLayer", "answers", "candidates")) {
                assertFalse(json.contains(privateText), privateText);
            }
            assertNull(input.computedTypeCode());
            assertEquals(bigFive ? 5 : 4, input.evidenceIds().size());
            assertTrue(input.evidenceIds().stream().allMatch(id -> id.endsWith(":summary")));
            assertEquals("typeme-ai-scope-v3", input.scopeVersion());
        }
    }

    @Test void ownershipIsStillCheckedBeforeProjection() {
        assertThrows(com.typeme.ai.config.AiException.class, () -> input(true, true, "ANOTHER_OWNER"));
    }

    private ObjectNode output() throws Exception {
        return (ObjectNode) mapper.readTree("""
            {"schemaVersion":"analysis-readable-v2","referenceType":null,
             "summary":"这次回答中，两边差别不大，可以先保留判断。",
             "observations":[{"plainText":"先看实际场景是否符合。","example":null,"evidenceIds":["EI:summary"]}],
             "suggestedAction":{"what":"记一次交流。","when":"下次聊天后。","observe":"看是否想独处。","evidenceIds":["EI:summary"]},
             "limitations":["一次问卷不能概括所有场景。"]}
            """);
    }

    private void validate(ObjectNode output, String type) {
        validator.validate(new DeepSeekResponse(output.toString(), "stop", "mock", DeepSeekResponse.TokenUsage.EMPTY),
                type, List.of("EI:summary"), 2600);
    }

    @Test void conciseOutputAndInsufficientEvidenceDoNotRequirePadding() throws Exception {
        var output = output();
        assertDoesNotThrow(() -> validate(output, null));
        output.putArray("observations");
        output.putNull("suggestedAction");
        assertDoesNotThrow(() -> validate(output, null));
    }

    @Test void rejectsInventedEvidenceTypeChangesExtraFieldsAndIncompleteActions() throws Exception {
        var unknown = output();
        ((ObjectNode) unknown.path("observations").get(0)).putArray("evidenceIds").add("made-up");
        assertThrows(AnalysisValidationException.class, () -> validate(unknown, null));
        var typeChanged = output().put("referenceType", "ENFP");
        assertThrows(AnalysisValidationException.class, () -> validate(typeChanged, null));
        var extra = output().put("diagnosis", "not allowed");
        assertThrows(AnalysisValidationException.class, () -> validate(extra, null));
        var incomplete = output();
        ((ObjectNode) incomplete.path("suggestedAction")).remove("observe");
        assertThrows(AnalysisValidationException.class, () -> validate(incomplete, null));
    }
}
