package com.typeme.jung.scoring;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.springframework.core.io.DefaultResourceLoader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

/** Frozen inputs and fixed legacy expectations, independent of regenerated v3 fixtures. */
class JungLegacyCloseoutTest {
    @TestFactory
    List<DynamicTest> legacyPackagesKeepTheirResults() throws Exception {
        var resources = new DefaultResourceLoader();
        var loader = new JungPackageLoader(resources);
        JsonNode cases;
        try (var input = resources.getResource("classpath:fixtures/legacy-score-closeout.json").getInputStream()) {
            cases = new ObjectMapper().readTree(input).path("cases");
        }
        var tests = new ArrayList<DynamicTest>();
        for (String version : List.of("v1", "v2")) {
            var pkg = loader.find("typeme-jung48-zh-" + version);
            for (JsonNode entry : cases) tests.add(DynamicTest.dynamicTest(version + " " + entry.path("id").asText(), () -> {
                assertEquals("typeme-jung48-score-" + version, pkg.scoringVersion());
                assertEquals(pkg.scoringVersion(), pkg.scoringPolicy().version());
                assertEquals("typeme-type-report-zh-" + version, pkg.reportContentVersion());
                assertNotNull(loader.findTypeReports(pkg.reportContentVersion()));
                var answers = new LinkedHashMap<String, JungAnswer>();
                entry.path("answers").fields().forEachRemaining(e -> answers.put(e.getKey(),
                        "rating".equals(e.getValue().path("kind").asText())
                                ? JungAnswer.rating(e.getKey(), e.getValue().path("rating").asInt())
                                : JungAnswer.unknown(e.getKey())));
                var result = JungScorer.score(pkg, answers, entry.path("skipped").asBoolean());
                assertEquals(strings(entry.path("scheduled")), JungScorer.reviewClarification(pkg, answers).stream().map(Enum::name).toList());
                assertEquals(entry.path("status").asText(), result.status().name());
                assertEquals(!"NEEDS_REVIEW".equals(entry.path("status").asText()), result.coverageOk());
                assertEquals(entry.path("typeCode").isNull() ? null : entry.path("typeCode").asText(),
                        result.computedTypeCode() == null ? null : result.computedTypeCode().value());
                assertEquals(strings(entry.path("candidates")), result.candidates().stream().map(c -> c.typeCode().value()).toList());
                assertEquals(strings(entry.path("costs")), result.candidates().stream().map(c -> String.valueOf(c.cost())).toList());
                var ei = result.dimension(JungDimension.EI);
                assertEquals(entry.path("finalN").asInt(), ei.finalN());
                assertEquals(entry.path("finalS").asInt(), ei.finalS());
                assertEquals(entry.path("boundary").asBoolean(), ei.boundary());
                assertEquals(entry.path("applied").asBoolean(), ei.effective());
            }));
        }
        return tests;
    }

    private static List<String> strings(JsonNode array) {
        var result = new ArrayList<String>();
        array.forEach(value -> result.add(value.asText()));
        return result;
    }
}
