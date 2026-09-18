package com.typeme.jung.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ipip.content.BigFivePackageLoader;
import com.typeme.ipip.report.BigFiveReportBuilder;
import com.typeme.ipip.scoring.BigFiveScorer;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungStage;
import com.typeme.jung.scoring.JungScorer;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.*;

/** 合成作答经过生产计分器/报告构造器；输出给无数据库的浏览器验收复用。 */
class ReadableReportFixturesTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final LocalDateTime now = LocalDateTime.of(2026, 9, 18, 0, 0);

    private void save(String name, JsonNode report) throws Exception {
        Path directory = Path.of("target", "readable-browser-fixtures");
        Files.createDirectories(directory);
        mapper.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(name + ".json").toFile(), report);
    }

    @Test void readableJungKeepsBoundaryAndTiedResultsAndHistoricalContent() throws Exception {
        var loader = new JungPackageLoader(new DefaultResourceLoader());
        for (String version : new String[]{"v1", "v2"}) {
            var pkg = loader.find("typeme-jung48-zh-" + version);
            var answers = new LinkedHashMap<String, JungAnswer>();
            boolean oneEi = false;
            for (var item : pkg.questions()) if (item.stage() == JungStage.BASE) {
                int rating = item.pointsToPositivePole() > 0 ? 5 : 1;
                if (item.dimension() == JungDimension.EI) {
                    rating = oneEi ? 3 : (item.pointsToPositivePole() > 0 ? 4 : 2);
                    oneEi = true;
                }
                answers.put(item.id(), JungAnswer.rating(item.id(), rating));
            }
            var result = JungScorer.score(pkg, answers, false);
            var content = loader.findTypeReports(pkg.reportContentVersion());
            var body = JungReportBuilder.build(pkg, content, loader.processCopy(), loader, result,
                    "jung-" + version, "synthetic-attempt", now, now);
            JsonNode report = mapper.readTree(JungReportBuilder.finalizeWithHash(mapper, body));
            assertEquals("TENTATIVE", report.path("status").asText());
            if (version.equals("v2")) {
                assertTrue(report.path("summary").asText().contains("两边差距较小"));
                assertEquals("选一件事试一次", report.path("nextActions").get(0).path("title").asText());
            } else {
                assertFalse(report.path("summary").asText().contains("这次回答里，四个方面"));
            }
            save("jung-" + version, report);
            answers.replaceAll((id, answer) -> JungAnswer.rating(id, 3));
            var tied = JungScorer.score(pkg, answers, false);
            var tiedBody = JungReportBuilder.build(pkg, content, loader.processCopy(), loader, tied,
                    "jung-tied", "synthetic-attempt", now, now);
            var tiedReport = mapper.readTree(JungReportBuilder.finalizeWithHash(mapper, tiedBody));
            assertTrue(tiedReport.path("computedTypeCode").isNull());
            assertTrue(tiedReport.path("dynamics").isNull());
            assertFalse(tiedReport.path("summary").asText().contains("更接近"));
            if (version.equals("v2")) save("jung-tied", tiedReport);
        }
    }

    @Test void bigFiveUsesCorrectRangeAndSaysHigherOrLowerExplicitly() throws Exception {
        var pkg = new BigFivePackageLoader(new DefaultResourceLoader()).current();
        var answers = new LinkedHashMap<String, JungAnswer>();
        for (var item : pkg.questions()) {
            answers.put(item.id(), JungAnswer.rating(item.id(), item.direction() > 0 ? 4 : 2));
        }
        var result = BigFiveScorer.score(pkg, answers);
        JsonNode report = mapper.valueToTree(BigFiveReportBuilder.build(pkg, result, "bigfive", "synthetic-attempt", now));
        assertEquals(2, report.path("schemaVersion").asInt());
        for (var row : report.path("dimensions")) {
            assertEquals(40, row.path("rawScore").asInt());
            assertEquals(10, row.path("rangeLow").asInt());
            assertEquals(50, row.path("rangeHigh").asInt());
            assertTrue(row.path("reading").asText().contains("比中间高了"));
            assertFalse(row.path("reading").asText().contains("高/低"));
        }
        save("bigfive", report);
    }
}
