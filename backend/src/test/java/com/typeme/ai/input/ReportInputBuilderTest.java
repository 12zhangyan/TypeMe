package com.typeme.ai.input;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ai.port.ReportSnapshotReader;
import com.typeme.ai.port.ReportSnapshotReader.AiReportSnapshot;
import com.typeme.ai.port.ReportSnapshotReader.AiReportSnapshot.Answer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link ReportInputBuilder} 的纯单元测试（不起 Spring）。
 *
 * <p>盯住三件事：
 * <ol>
 *   <li><b>过程层投影的形状</b>：只带用得上的那几项（两个省力过程与两个尚未偏好过程的 reading、
 *       最吃力的两步、两条 opposites 的 need/supply、换边说明与"这是推导"的限定），
 *       原始 {@code what}/{@code rule}/发展任务/沟通规则一个都不许进去；</li>
 *   <li><b>没有这一层时必须整个键都不放</b>，而且两种"没有"要分开：{@code dynamics} 为 null / 缺失
 *       （TIED、旧快照）是合法缺席、不许刷日志；{@code dynamics} 在却投影不出过程（键名漂移）
 *       必须留下带 reportId / reportHash 的 WARN —— 这是"绿着坏"的唯一报警器；</li>
 *   <li><b>request_hash 的稳定性与分叉</b>：同输入必然同 hash（含 note 归一化），
 *       换 prompt/model/topic/note 必然不同 hash；并固定住"为什么必须提升 SCOPE_VERSION"这个事实——
 *       过程层的有无**不会**改变 report_hash 与 request_hash，所以范围版本号是唯一的分叉点。</li>
 * </ol>
 */
class ReportInputBuilderTest {

    private static final String USER_ID = "11111111-1111-1111-1111-111111111111";
    private static final String REPORT_ID = "r1111111-1111-1111-1111-111111111111";
    private static final String REPORT_HASH = "b".repeat(64);
    private static final String PROMPT_V2 = "typeme-ai-prompt-v2";
    private static final String MODEL = "deepseek-flash";

    private final ObjectMapper mapper = new ObjectMapper();

    /* ── 1. 负载形状 ───────────────────────────────────────────────────── */

    @Test
    @DisplayName("过程层按紧凑形状进负载：只带 reading / hardestSteps / opposites / boundaryNotes 与限定语")
    void processLayerIsProjectedCompactly() throws Exception {
        AiReportInput input = build(reportJson(true), "最近在准备转岗。", PROMPT_V2, AiTopic.OVERALL);

        JsonNode layer = payload(input).path("report").path("processLayer");
        assertFalse(layer.isMissingNode(), "报告带 dynamics/processPlan 时，负载必须有 report.processLayer");
        assertEquals("derived-from-letters", layer.path("source").asText(),
                "必须显式标出这是从四字母推导的，不是测量结果");
        assertEquals("typeme-jung48-dynamics-v1", layer.path("processVersion").asText());

        JsonNode preferred = layer.path("preferred");
        assertEquals(2, preferred.size(), "相对省力的是主导 + 辅助两个");
        assertEquals("dominant", preferred.get(0).path("slot").asText());
        assertEquals("auxiliary", preferred.get(1).path("slot").asText());
        for (JsonNode row : preferred) {
            assertTrue(row.path("process").asText().length() == 2, "process 形如 Ne");
            assertFalse(row.path("nameCn").asText().isBlank());
            assertFalse(row.path("roleTitle").asText().isBlank());
            assertFalse(row.path("reading").asText().isBlank());
        }

        JsonNode unpreferred = layer.path("unpreferred");
        assertEquals(2, unpreferred.size(), "第三位与第四位并列，没有先后");
        assertEquals("tertiary", unpreferred.get(0).path("slot").asText());
        assertEquals("inferior", unpreferred.get(1).path("slot").asText());

        assertEquals(2, layer.path("hardestSteps").size());
        assertEquals("再用直觉列可能性", layer.path("hardestSteps").get(0).asText());

        JsonNode opposites = layer.path("opposites");
        assertEquals(2, opposites.size());
        for (JsonNode opposite : opposites) {
            assertFalse(opposite.path("need").asText().isBlank());
            assertFalse(opposite.path("supply").asText().isBlank());
            assertFalse(opposite.path("axis").asText().isBlank());
        }

        assertEquals(1, layer.path("boundaryNotes").size(), "EI 边界维度必须带换边说明");
        assertEquals("EI", layer.path("boundaryNotes").get(0).path("dimension").asText());
        assertTrue(layer.path("basis").asText().contains("推导"));
        assertTrue(layer.path("frameworkCaveat").asText().contains("争议"));

        // 这一层只发"读法"，不发报告端的正文；否则负载会被复述材料撑大。
        String serialized = mapper.writeValueAsString(input.payload());
        assertFalse(serialized.contains("\"what\""), "不发每个过程的 what 正文");
        assertFalse(serialized.contains("\"rule\""), "不发推导规则原文");
        assertFalse(serialized.contains("developmentOrder"), "不发三段发展任务");
        assertFalse(serialized.contains("communicationRules"), "不发四条沟通规则");
        assertFalse(serialized.contains("decisionSteps"), "不发四步决策法的完整正文");

        // 紧凑投影必须明显小于报告里这一层的原文（原文含 rule/what/发展任务/沟通规则等等）。
        int projected = mapper.writeValueAsString(layer).length();
        assertTrue(projected < PROCESS_LAYER_JSON.length(),
                "紧凑投影必须小于过程层原文：投影 " + projected + " vs 原文 " + PROCESS_LAYER_JSON.length());
        for (JsonNode row : preferred) {
            assertTrue(row.path("reading").asText().length() <= 121,
                    "单条 reading 必须有上限，实际 " + row.path("reading").asText().length());
        }
    }

    @Test
    @DisplayName("dynamics/processPlan 缺失或为 null（TIED）→ 负载里整个 processLayer 键都不放")
    void processLayerIsOmittedWhenAbsent() throws Exception {
        for (String report : new String[] {reportJson(false), tiedReportJson()}) {
            AiReportInput input = build(report, "", PROMPT_V2, AiTopic.OVERALL);
            JsonNode reportNode = payload(input).path("report");
            assertFalse(reportNode.has("processLayer"),
                    "没有这一层时不得放空壳（模型会读成'结构为空'）");
            // 其余材料照常发送：省略这一层不能让整份分析降级。
            assertEquals(4, reportNode.path("dimensions").size());
            assertTrue(payload(input).has("evidence"));
        }
    }

    @Test
    @DisplayName("dynamics 是空壳（processes 为空、没有 plan）→ 省略，且留下 WARN（有 dynamics 就不许静默）")
    void emptyShellIsOmitted() throws Exception {
        String report = reportJson(false).replace("\"tieNotice\":null",
                "\"dynamics\":{\"version\":\"typeme-jung48-dynamics-v1\",\"processes\":[],"
                        + "\"boundaryNotes\":[]},\"processPlan\":null,\"tieNotice\":null");
        ListAppender<ILoggingEvent> appender = attachAppender();
        try {
            AiReportInput input = build(report, "", PROMPT_V2, AiTopic.OVERALL);
            assertFalse(payload(input).path("report").has("processLayer"));
        } finally {
            detachAppender(appender);
        }
        assertEquals(1, warnings(appender).size(), "有 dynamics 却投影不出内容 = 必须报警");
    }

    /* ── 2. 静默退化必须出声音（"绿着坏"是本仓库最忌讳的失败形态） ─────────── */

    @Test
    @DisplayName("dynamics 在但键名被改坏（processes→procs）→ 不放 processLayer，且必须留下 WARN")
    void brokenDynamicsKeyNamesAreLoudNotSilent() throws Exception {
        // 模拟 JungReportBuilder 改了键名：服务端明明有这一层，投影却一个过程也认不出来。
        // 没有这条日志，AI 分析会悄悄少一整层依据，而报告照出、测试照绿。
        String broken = reportJson(true).replace("\"processes\"", "\"procs\"");

        ListAppender<ILoggingEvent> appender = attachAppender();
        try {
            AiReportInput input = build(broken, "", PROMPT_V2, AiTopic.OVERALL);
            assertFalse(payload(input).path("report").has("processLayer"),
                    "认不出过程时不得发出残缺的一层");
        } finally {
            detachAppender(appender);
        }

        List<String> warnings = warnings(appender);
        assertEquals(1, warnings.size(), "必须且只报一条 WARN，实际：" + warnings);
        String warning = warnings.get(0);
        assertTrue(warning.contains("报告含过程层，但负载投影为空"), warning);
        assertTrue(warning.contains("JungReportBuilder 的键名可能已变"), warning);
        assertTrue(warning.contains("ReportInputBuilder.processLayer"), warning);
        assertTrue(warning.contains(REPORT_HASH), "诊断必须带得动定位信息：" + warning);
        assertTrue(warning.contains(REPORT_ID), "诊断必须带得动定位信息：" + warning);
    }

    @Test
    @DisplayName("部分键名漂移（slot 被改坏）→ 仍然报警，但可用的那一支照常发送")
    void partiallyBrokenKeysStillWarn() throws Exception {
        // 只弄坏 tieriary/inferior 两行的 slot：preferred 仍能认出，unpreferred 认不出。
        // 这种"少了一半"同样是漂移，不能悄悄过去；但已有的材料不该被一起丢掉。
        String broken = reportJson(true)
                .replace("\"slot\":\"tertiary\"", "\"kind\":\"tertiary\"")
                .replace("\"slot\":\"inferior\"", "\"kind\":\"inferior\"");

        ListAppender<ILoggingEvent> appender = attachAppender();
        AiReportInput input;
        try {
            input = build(broken, "", PROMPT_V2, AiTopic.OVERALL);
        } finally {
            detachAppender(appender);
        }

        JsonNode layer = payload(input).path("report").path("processLayer");
        assertEquals(2, layer.path("preferred").size(), "认得出的那两支必须照常发");
        assertFalse(layer.has("unpreferred"), "认不出的那一支不要发空数组");
        List<String> warnings = warnings(appender);
        assertEquals(1, warnings.size(), "少一个过程也必须报警，实际：" + warnings);
        assertTrue(warnings.get(0).contains("只投影出 2/4 个过程"), warnings.get(0));
    }

    @Test
    @DisplayName("dynamics 本来就是 null（TIED / 旧快照）→ 安静省略，一条 WARN 都不许有")
    void nullDynamicsStaysSilent() throws Exception {
        // TIED 报告按契约不推导过程结构，这是合法缺席：刷日志只会淹没上面那条真问题。
        for (String report : new String[] {tiedReportJson(), reportJson(false)}) {
            ListAppender<ILoggingEvent> appender = attachAppender();
            try {
                AiReportInput input = build(report, "", PROMPT_V2, AiTopic.OVERALL);
                assertFalse(payload(input).path("report").has("processLayer"));
            } finally {
                detachAppender(appender);
            }
            assertTrue(warnings(appender).isEmpty(),
                    "合法缺席不得刷日志，实际：" + warnings(appender));
        }
    }

    /* ── 2. request_hash ──────────────────────────────────────────────── */

    @Test
    @DisplayName("同输入同 hash（含 note 空白归一化），换 prompt/model/topic/note 必然分叉")
    void requestHashIsStableAndSensitive() throws Exception {
        String report = reportJson(true);
        AiReportInput first = build(report, "最近在准备转岗，有点累。", PROMPT_V2, AiTopic.OVERALL);
        AiReportInput same = build(report, "  最近在准备转岗，有点累。\n", PROMPT_V2, AiTopic.OVERALL);
        assertEquals(first.requestHash(), same.requestHash(),
                "note 只做空白归一化，同一段话必须稳定命中同一次分析");

        // 与手工公式一致：userId | reportHash | promptVersion | model | topic | sha256(note) | SCOPE_VERSION
        assertEquals(AiHashes.sha256(String.join("|",
                        USER_ID, REPORT_HASH, PROMPT_V2, MODEL, "overall",
                        AiHashes.sha256(ReportInputBuilder.normalizeNote("最近在准备转岗，有点累。")),
                        ReportInputBuilder.SCOPE_VERSION)),
                first.requestHash());

        assertNotEquals(first.requestHash(), build(report, "最近在准备转岗，有点累。", "typeme-ai-prompt-v1",
                AiTopic.OVERALL).requestHash(), "提示词版本必须进去重键");
        assertNotEquals(first.requestHash(), build(report, "最近在准备转岗，有点累。", PROMPT_V2,
                AiTopic.GROWTH).requestHash(), "主题必须进去重键");
        assertNotEquals(first.requestHash(), build(report, "另一段近况。", PROMPT_V2,
                AiTopic.OVERALL).requestHash(), "用户文字必须进去重键");
    }

    @Test
    @DisplayName("请求哈希的分叉点只能是 SCOPE_VERSION：过程层的有无不改变 report_hash/request_hash")
    void scopeVersionIsTheOnlyForkWhenReportContentIsIdentical() throws Exception {
        // 这就是"为什么必须提升 SCOPE_VERSION"的可执行证据：
        // 同一份已入库报告的 report_hash 不变，加上过程层后 request_hash 仍然一模一样。
        AiReportInput withLayer = build(reportJson(true), "", PROMPT_V2, AiTopic.OVERALL);
        AiReportInput withoutLayer = build(reportJson(false), "", PROMPT_V2, AiTopic.OVERALL);
        assertEquals(withoutLayer.requestHash(), withLayer.requestHash());

        // 范围版本号本身进 hash：不提升它，升级前后的去重键就分不开（会复用从未见过过程层的旧分析）。
        assertNotEquals(AiHashes.sha256(String.join("|",
                        USER_ID, REPORT_HASH, PROMPT_V2, MODEL, "overall",
                        AiHashes.sha256(""), "typeme-ai-scope-v1")),
                withLayer.requestHash(),
                "SCOPE_VERSION 必须真的参与哈希，提升它才算把新旧发送范围分开");
        assertEquals("typeme-ai-scope-v2", withLayer.scopeVersion());
        assertEquals("typeme-ai-scope-v2", ReportInputBuilder.SCOPE_VERSION);
    }

    @Test
    @DisplayName("过程层文本超长会被截断（脏数据不得把负载撑大）")
    void oversizedProcessTextIsTruncated() throws Exception {
        String longReading = "读".repeat(400);
        String report = reportJson(true).replace("你会在外部世界里看见多种可能。", longReading);
        AiReportInput input = build(report, "", PROMPT_V2, AiTopic.OVERALL);
        String reading = payload(input).path("report").path("processLayer")
                .path("preferred").get(0).path("reading").asText();
        assertTrue(reading.length() <= 121, "reading 必须截断，实际 " + reading.length());
        assertTrue(reading.endsWith("…"), "截断处要留省略号，避免模型补全");
    }

    /* ── 3. scope 摘要与证据白名单 ─────────────────────────────────────── */

    @Test
    @DisplayName("scope 摘要带上本次范围/提示词版本，证据 id 白名单与 evidence 一致")
    void scopeSummaryCarriesVersions() {
        AiReportInput input = build(reportJson(true), "有点累。", PROMPT_V2, AiTopic.OVERALL);
        String summary = builder(reportJson(true)).scopeSummary(input);
        assertTrue(summary.contains("scopeVersion=typeme-ai-scope-v2"), summary);
        assertTrue(summary.contains("promptVersion=typeme-ai-prompt-v2"), summary);
        assertTrue(summary.length() <= 500, "ai_consent.scope 是 VARCHAR(500)");

        assertNotNull(input.evidenceIds());
        assertEquals(input.evidence().size(), input.evidenceIds().size());
        assertFalse(input.evidenceIds().isEmpty(), "夹具里至少有一条可选的逐题证据");
    }

    /* ── 夹具与工具 ───────────────────────────────────────────────────── */

    private AiReportInput build(String reportJson, String note, String promptVersion, AiTopic topic) {
        return builder(reportJson).build(REPORT_ID, USER_ID, topic, note, promptVersion, MODEL);
    }

    private ReportInputBuilder builder(String reportJson) {
        AiReportSnapshot snapshot = new AiReportSnapshot(
                REPORT_ID, USER_ID, null, null, REPORT_HASH,
                "a1111111-1111-1111-1111-111111111111", null, "typeme-jung48-zh-v1",
                contentJson(), answers(), reportJson);
        ReportSnapshotReader reader = reportId -> REPORT_ID.equals(reportId)
                ? Optional.of(snapshot) : Optional.empty();
        return new ReportInputBuilder(reader, mapper);
    }

    private JsonNode payload(AiReportInput input) {
        return mapper.valueToTree(input.payload());
    }

    private static String contentJson() {
        return """
                {"schemaVersion":3,"packageId":"typeme-jung48-zh-v1","questions":[
                  {"id":"EI-01","dimension":"EI","scenario":"工作节奏","leftPole":"I","rightPole":"E","order":1},
                  {"id":"SN-01","dimension":"SN","scenario":"看说明书","leftPole":"S","rightPole":"N","order":2}
                ]}
                """;
    }

    private static Map<String, Answer> answers() {
        Map<String, Answer> answers = new LinkedHashMap<>();
        answers.put("EI-01", new Answer("EI-01", "RATING", 4));
        answers.put("SN-01", new Answer("SN-01", "RATING", 2));
        return answers;
    }

    /** 四维摘要 + 候选 + （可选）过程层；ENFP / TENTATIVE / EI 边界。 */
    private static String reportJson(boolean withProcessLayer) {
        return """
                {"schemaVersion":1,"status":"TENTATIVE","computedTypeCode":"ENFP",
                 "dimensions":[
                   {"dimension":"EI","computedPole":"E","mFinal":0.08,"boundary":true,"nFinal":16},
                   {"dimension":"SN","computedPole":"N","mFinal":0.58,"boundary":false,"nFinal":12},
                   {"dimension":"TF","computedPole":"F","mFinal":0.42,"boundary":false,"nFinal":12},
                   {"dimension":"JP","computedPole":"P","mFinal":0.33,"boundary":false,"nFinal":12}],
                 "candidates":[{"typeCode":"ENFP","cost":0},{"typeCode":"INFP","cost":2}],
                 "tieNotice":null,
                 %s
                 "reportHash":"%s"
                 }
                """.formatted(withProcessLayer ? PROCESS_LAYER_JSON : "", REPORT_HASH);
    }

    /** TIED：契约明确"没有四字母就不推导"，两个键都是 null。 */
    private static String tiedReportJson() {
        return """
                {"schemaVersion":1,"status":"TIED","computedTypeCode":null,
                 "dimensions":[
                   {"dimension":"EI","computedPole":null,"mFinal":0.0,"boundary":false,"nFinal":12},
                   {"dimension":"SN","computedPole":"N","mFinal":0.25,"boundary":false,"nFinal":12},
                   {"dimension":"TF","computedPole":"F","mFinal":0.17,"boundary":false,"nFinal":12},
                   {"dimension":"JP","computedPole":"J","mFinal":-0.17,"boundary":false,"nFinal":12}],
                 "candidates":[{"typeCode":"ENFJ","cost":0},{"typeCode":"INFJ","cost":0}],
                 "tieNotice":"这些候选在本次数据里没有区别。",
                 "dynamics":null,"processPlan":null}
                """;
    }

    /** 一份够用的过程层夹具：字段名与 JungReportBuilder 的输出一致。 */
    private static final String PROCESS_LAYER_JSON = """
            "dynamics":{"version":"typeme-jung48-dynamics-v1","typeCode":"ENFP",
              "rule":"……","basis":"这一层不是本次测出来的另一个结果，而是按四个字母、依据该框架的规则推导出来的结构。",
              "processes":[
                {"slot":"dominant","order":1,"process":"Ne","function":"N","attitude":"e","nameCn":"外倾直觉",
                 "roleTitle":"主导过程","what":"看外部世界里的多种可能。",
                 "reading":"你会在外部世界里看见多种可能。","preferred":true},
                {"slot":"auxiliary","order":2,"process":"Fi","function":"F","attitude":"i","nameCn":"内倾情感",
                 "roleTitle":"辅助过程","what":"在心里判断什么对自己重要。",
                 "reading":"你会先确认事情对不对得上。","preferred":true},
                {"slot":"tertiary","order":3,"process":"Te","function":"T","attitude":"e","nameCn":"外倾思考",
                 "roleTitle":"第三位","what":"把逻辑用到外部去组织事情。",
                 "reading":"这一环还没练过的时候，可能不习惯把目标拆成步骤。","preferred":false},
                {"slot":"inferior","order":4,"process":"Si","function":"S","attitude":"i","nameCn":"内倾感觉",
                 "roleTitle":"第四位","what":"跟以前比，哪里一样、哪里变了。",
                 "reading":"这一环还没练过的时候，可能容易跳过细节核对。","preferred":false}],
              "boundaryNotes":[{"dimension":"EI","pole":"E",
                "note":"如果 EI 落到另一侧（INFP）：过程还是这四个，但主导与辅助会互换 —— 原来是外倾直觉主导，换过去就是内倾情感主导。"}],
              "notes":{"frameworkCaveat":"这套框架关于二分假设在学界一直有争议，重测时字母也可能变化。"}},
            "processPlan":{"version":"typeme-jung48-dynamics-v1",
              "developmentOrder":[{"order":1,"title":"先把主导过程用熟"}],
              "decisionSteps":[{"order":1,"function":"S","title":"先用感觉处理事实","preferred":false}],
              "hardestSteps":["再用直觉列可能性","用情感称一称分量"],
              "hardestStepsNote":"……",
              "opposites":[{"axis":"SN","yourPole":"S","needPole":"N",
                "need":"你需要偏直觉的一侧提供：新的可能性。","supply":"你能提供给偏直觉的一侧：事实与细节把关。"},
                {"axis":"TF","yourPole":"T","needPole":"F",
                "need":"你需要偏情感的一侧提供：人与人之间的调和。","supply":"你能提供给偏情感的一侧：把问题分析清楚。"}],
              "communicationRules":[{"axis":"EI","title":"关于精力的给与取"}],
              "notes":{"developmentNote":"……","greyAreaNote":"……"}},
            """;

    @Test
    @DisplayName("夹具自身可选：确认没有误用形状（防止上面的断言被夹具蒙混过关）")
    void fixtureIsSelfConsistent() throws Exception {
        assertNotNull(mapper.readTree(reportJson(true)).path("dynamics").path("processes").get(0));
        assertTrue(mapper.readTree(tiedReportJson()).path("dynamics").isNull());
        assertTrue(mapper.readTree(reportJson(false)).path("dynamics").isMissingNode());
    }

    /* ── 日志断言（沿用 SecurityLoggingDisciplineIT 的 ListAppender 约定，只挂本类 logger） ── */

    private static ListAppender<ILoggingEvent> attachAppender() {
        Logger logger = (Logger) LoggerFactory.getLogger(ReportInputBuilder.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        return appender;
    }

    private static void detachAppender(ListAppender<ILoggingEvent> appender) {
        Logger logger = (Logger) LoggerFactory.getLogger(ReportInputBuilder.class);
        logger.detachAppender(appender);
        appender.stop();
    }

    /** 本次捕获到的 WARN 文本；INFO/DEBUG 不参与断言（合法缺席不禁止其它信息日志）。 */
    private static List<String> warnings(ListAppender<ILoggingEvent> appender) {
        return appender.list.stream()
                .filter(event -> event.getLevel() == Level.WARN)
                .map(ILoggingEvent::getFormattedMessage)
                .toList();
    }
}
