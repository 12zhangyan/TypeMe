package com.typeme.jung.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.jung.domain.JungAnswer;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungResultStatus;
import com.typeme.jung.domain.JungStage;
import com.typeme.jung.scoring.JungScorer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 把契约 §7 的 `report_json` 骨架**钉成可执行的断言**。
 *
 * <p>为什么需要这个测试：契约 §7 曾经与实现双向不一致 —— 文档多写了
 * `candidates[].tied`，少写了 `selfSelectedTypeCode`、`typeTagline`、
 * `clarificationApplied`、`details`、`dailySigns`，以及 `share` 的大部分字段。
 * 这类不一致单靠"写文档时仔细一点"是防不住的：字段是分几次加的，
 * 而读文档的人（前端）只会照着文档写，然后在运行时才发现字段不存在。
 *
 * <p>因此这里断言的是**字段名集合与顺序**，而不是"能不能解析"：
 * 字段名拼错、少一个、多一个都会失败。顺序也断言，因为
 * `LinkedHashMap` 的插入顺序决定了 `report_json` 的字节形态，
 * 而 `reportHash` 是对它算的 —— 顺序变了，所有历史报告的哈希都对不上。
 */
class JungReportSchemaTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 契约 §7 顶层字段，顺序即实现里的插入顺序。 */
    private static final List<String> TOP_LEVEL_KEYS = List.of(
            "schemaVersion", "reportId", "attemptId", "createdAt", "status",
            "computedTypeCode", "typeSource", "selfSelectedTypeCode", "typeTitle",
            "typeNameCn", "typeTagline", "summary", "boundaries", "tiedDimensions",
            "dimensions", "candidates", "tieNotice", "clarificationDimensions",
            "clarificationSkipped", "typeSections", "nextActions", "dynamics",
            "processPlan", "share", "methodology", "reportHash");

    private static final List<String> DIMENSION_KEYS = List.of(
            "dimension", "name", "question",
            "negativePole", "negativeLabel", "positivePole", "positiveLabel",
            "computedPole", "tiedSide",
            "SBase", "nBase", "mBase", "SClar", "nClar", "mClar",
            "SFinal", "nFinal", "mFinal", "position", "boundary",
            "baseRatingCount", "baseUnknownCount", "baseUnprocessedCount",
            "clarificationScheduled", "clarificationSkipped", "clarificationApplied",
            "clarificationRatingCount", "coverageOk", "details", "dailySigns");

    private static final List<String> CANDIDATE_KEYS = List.of("typeCode", "cost", "differsOn");

    private static final List<String> SHARE_KEYS = List.of(
            "kind", "imageTitle", "headline", "boundaryLine", "filename", "text", "alt");

    private static final List<String> BOUNDARY_KEYS = List.of("dimension", "pole", "label", "mFinal", "note");

    private static final List<String> METHODOLOGY_KEYS = List.of(
            "scoringVersion", "packageId", "reportContentVersion", "contentStatus", "contentSha256",
            "processCopyVersion", "processCopySha256", "dynamicsVersion",
            "policyVersion", "minBaseRatingsPerDimension", "boundaryNumerator", "boundaryDenominator",
            "submittedAt");

    /** 过程层的两个块（契约 §7.1）。 */
    private static final List<String> DYNAMICS_KEYS = List.of(
            "version", "typeCode", "rule", "basis", "processes", "boundaryNotes", "notes");

    private static final List<String> DYNAMICS_PROCESS_KEYS = List.of(
            "slot", "order", "process", "function", "attitude", "nameCn",
            "roleTitle", "what", "reading", "preferred");

    private static final List<String> PROCESS_PLAN_KEYS = List.of(
            "version", "developmentOrder", "decisionIntro", "decisionSteps", "decisionNote",
            "hardestSteps", "hardestStepsNote", "opposites", "communicationRules", "notes");

    /** 契约 §7 表格里的八段顺序。 */
    private static final List<String> SECTION_ORDER = List.of(
            "dailyLife", "strengths", "blindSpots", "communication",
            "studyWork", "stress", "growth", "neighbors");

    private static final List<String> SECTION_TITLES = List.of(
            "日常表现", "可能用得顺手的地方", "容易卡住的地方", "沟通与关系",
            "学习与工作方式", "压力下的观察", "成长行动", "相邻类型区别");

    private static JungPackageLoader loader() {
        return new JungPackageLoader(new DefaultResourceLoader());
    }

    private static List<String> keysOf(JsonNode node) {
        List<String> keys = new ArrayList<>();
        for (Iterator<String> it = node.fieldNames(); it.hasNext(); ) {
            keys.add(it.next());
        }
        return keys;
    }

    /** 四维全答中性：每题都落在 ratingNeutral，于是每维 S=0，四维同时平分。 */
    private static Map<String, JungAnswer> answerAllNeutral(JungPackage pkg) {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        int neutral = pkg.scoringPolicy().ratingNeutral();
        for (JungItem item : pkg.questions()) {
            if (item.stage() == JungStage.BASE) {
                answers.put(item.id(), JungAnswer.rating(item.id(), neutral));
            }
        }
        return answers;
    }

    /**
     * 造一份"某一维边界、其余维度明确偏向正极"的作答。
     *
     * <p>关键点：题目是**镜像排布**的 —— 同一维里有的题 `leftPole` 是负极、有的是正极
     * （这是为了抵消"总点左边"的作答习惯）。所以"全答 5 分"并不等于"全维偏正极"，
     * 而是正负相消得出 S=0、四维全面平局。要造出想要的偏离方向，
     * 必须**按每题自身的极点**决定打高分还是低分。
     *
     * @param boundaryDimension 要做成"倾向较轻"的那一维
     */
    private static Map<String, JungAnswer> answerWithBoundaryOn(
            JungPackage pkg, JungDimension boundaryDimension) {
        Map<String, JungAnswer> answers = new LinkedHashMap<>();
        boolean boundaryItemUsed = false;
        for (JungItem item : pkg.questions()) {
            if (item.stage() != JungStage.BASE) {
                continue;
            }
            // 该题打 5 分会让 S 往哪边走：用题目自己的计分方向，不在这里重推一遍
            boolean rightIsPositive = item.pointsToPositivePole() == 1;
            int towardPositive = rightIsPositive ? 5 : 1;

            if (item.dimension() != boundaryDimension) {
                answers.put(item.id(), JungAnswer.rating(item.id(), towardPositive));
                continue;
            }
            if (!boundaryItemUsed) {
                // 只让第一题朝正极偏一档：+1，其余保持中性 3 → S=1、n=12
                answers.put(item.id(), JungAnswer.rating(item.id(), rightIsPositive ? 4 : 2));
                boundaryItemUsed = true;
            } else {
                answers.put(item.id(), JungAnswer.rating(item.id(), 3));
            }
        }
        return answers;
    }

    /**
     * 序列化成**落库形态**：与 {@code ReportService} 走同一条 `finalizeWithHash` 路径，
     * 因此这里断言的字段集合就是用户实际拿到的 `report_json`。
     *
     * <p>不要改成直接序列化 {@code build(...)} 的返回值：那样测的是"哈希追加之前"的中间态，
     * 而 `reportHash` 正是契约 §7 的最后一个字段 —— 测中间态会让这条测试
     * 对"哈希到底有没有被写进去"完全失明。
     */
    private static JsonNode toPersistedJson(Map<String, Object> report) throws Exception {
        String json = JungReportBuilder.finalizeWithHash(MAPPER, report);
        JsonNode node = MAPPER.readTree(json);
        assertTrue(node.hasNonNull("reportHash"), "落库形态必须带 reportHash");
        assertEquals(64, node.path("reportHash").asText().length(), "reportHash 必须是 64 位十六进制");
        return node;
    }

    private static JsonNode serialize(Map<String, Object> report) throws Exception {
        return toPersistedJson(report);
    }

    /**
     * 验证 `reportHash` 真的覆盖了除自己以外的全部内容。
     *
     * <p>这不是"顺手多测一条"：报告"提交后不可变"这个承诺，靠的就是
     * 任何人都能重算哈希并发现自己手里的报告被改过。如果哈希漏算了某个字段，
     * 改那个字段就不会被发现，而表面上一切正常 —— 这种缺陷除非专门去测，
     * 否则永远不会暴露。
     */
    @Test
    @DisplayName("reportHash 覆盖除自己以外的每个字段（改任一字段都会让哈希对不上）")
    void reportHashCoversEveryFieldExceptItself() throws Exception {
        JungPackageLoader loader = loader();
        JungPackage pkg = loader.current();
        var result = JungScorer.score(pkg, answerWithBoundaryOn(pkg, JungDimension.EI), false);
        Map<String, Object> report = JungReportBuilder.build(loader, result, "report-3", "attempt-3",
                LocalDateTime.parse("2026-09-16T10:20:30"), LocalDateTime.parse("2026-09-16T10:20:00"));

        String persisted = JungReportBuilder.finalizeWithHash(MAPPER, report);
        String hash = MAPPER.readTree(persisted).path("reportHash").asText();

        // 摘掉 reportHash 后重新序列化，应当正好得到"算哈希时的那串字节"
        ObjectNode withoutHash = (ObjectNode) MAPPER.readTree(persisted);
        withoutHash.remove("reportHash");
        assertEquals(hash, sha256Hex(withoutHash.toString()),
                "reportHash 与「去掉 reportHash 后的内容」对不上："
                        + "说明算哈希时用的字节串与落库的字节串不是同一份");

        // 改一个"看起来无关紧要"的字段，哈希必须失配
        ObjectNode tampered = (ObjectNode) MAPPER.readTree(persisted);
        tampered.put("summary", "被改过的摘要");
        tampered.remove("reportHash");
        assertFalse(hash.equals(sha256Hex(tampered.toString())),
                "改掉 summary 之后哈希竟然还对得上：说明这个字段逃出了哈希覆盖");

        // 顶层每个字段都试一遍：只要有一个字段改了哈希不变，就说明它没进哈希。
        //
        // 关键：篡改必须**真的改变内容**。早期版本对标量字段统一 put("tampered-<name>")，
        // 对数组统一 removeAll() —— 而 tiedDimensions 在本样本里本来就是空数组，
        // removeAll() 是空操作，于是测试报出"这个字段没被哈希覆盖"这种假故障。
        // 现在统一替换成一个与该字段原值必定不同的值，并在替换后断言内容确实变了。
        for (String field : TOP_LEVEL_KEYS) {
            if (field.equals("reportHash")) {
                continue;
            }
            ObjectNode mutated = (ObjectNode) MAPPER.readTree(persisted);
            String originalJson = mutated.get(field).toString();
            mutated.set(field, MAPPER.readTree("[\"__tampered__\"]"));
            String mutatedJson = mutated.get(field).toString();
            assertNotEquals(originalJson, mutatedJson,
                    "篡改 " + field + " 没有真正改变内容，这条断言会变成假阳性");

            mutated.remove("reportHash");
            assertFalse(hash.equals(sha256Hex(mutated.toString())),
                    "字段 " + field + " 改掉之后哈希仍然一致：该字段没有被 reportHash 覆盖");
        }
    }

    private static String sha256Hex(String value) throws Exception {
        byte[] bytes = java.security.MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    /**
     * 造一份"EI 略偏正极、其余三维明确偏正极"的作答，得到 TENTATIVE 报告。
     *
     * <p>刻意要 TENTATIVE 而不是 REFERENCE：只有 TENTATIVE 才同时有
     * `boundaries`、`candidates` 和 `share.boundaryLine`，一次就能覆盖最多字段；
     * REFERENCE 会把这些留空，测不到。
     */
    private JsonNode tentativeReport() throws Exception {
        JungPackageLoader loader = loader();
        JungPackage pkg = loader.current();
        var result = JungScorer.score(pkg, answerWithBoundaryOn(pkg, JungDimension.EI), false);
        assertEquals(JungResultStatus.TENTATIVE, result.status(),
                "本样本应当落在 TENTATIVE（EI 倾向较轻、其余三维明确），否则测试前提不成立");
        assertEquals("ENFP", result.computedTypeCode().value(), "本样本的计算类型应当是 ENFP");
        return serialize(JungReportBuilder.build(loader, result, "report-1", "attempt-1",
                LocalDateTime.parse("2026-09-16T10:20:30"), LocalDateTime.parse("2026-09-16T10:20:00")));
    }

    @Test
    @DisplayName("§7 顶层字段名与顺序完全一致（reportHash 依赖顺序，多一个少一个都算破坏）")
    void topLevelKeysMatchContract() throws Exception {
        assertEquals(TOP_LEVEL_KEYS, keysOf(tentativeReport()),
                "report_json 顶层字段与契约 §7 不一致。若是有意改动，"
                        + "请同步改契约文档与前端 ReportViewModel —— "
                        + "并注意 reportHash 是对含顺序的 JSON 算的。");
    }

    @Test
    @DisplayName("§7 dimensions[] 四行字段与顺序一致，且顺序为权威序")
    void dimensionRowKeysMatchContract() throws Exception {
        JsonNode dimensions = tentativeReport().path("dimensions");
        assertEquals(4, dimensions.size(), "dimensions[] 必须固定 4 项");
        List<String> actualOrder = new ArrayList<>();
        for (JsonNode row : dimensions) {
            actualOrder.add(row.path("dimension").asText());
        }
        assertEquals(List.of("EI", "SN", "TF", "JP"), actualOrder,
                "dimensions[] 顺序必须是权威序 EI,SN,TF,JP");
        for (JsonNode row : dimensions) {
            assertEquals(DIMENSION_KEYS, keysOf(row), "dimensions[] 行内字段与契约不一致");
        }
    }

    @Test
    @DisplayName("§7 candidates[] 行内字段一致，且不含契约曾误写的 tied 字段")
    void candidateRowKeysMatchContract() throws Exception {
        JsonNode candidates = tentativeReport().path("candidates");
        assertTrue(candidates.size() > 0, "边界样本应当产出候选，否则本测试没覆盖到 candidates");
        for (JsonNode row : candidates) {
            assertEquals(CANDIDATE_KEYS, keysOf(row));
            // 「这一候选是否由平分而来」由顶层 tiedDimensions 表达；
            // 候选行里再写一遍迟早会与顶层不一致。
            assertFalse(row.has("tied"),
                    "candidates[] 不应有 tied 字段：谁平分由顶层 tiedDimensions 表达");
        }
    }

    @Test
    @DisplayName("§7 share 字段一致，kind 与 status 相同，TENTATIVE 必须有 boundaryLine")
    void shareKeysMatchContract() throws Exception {
        JsonNode report = tentativeReport();
        JsonNode share = report.path("share");
        assertEquals(SHARE_KEYS, keysOf(share), "share 字段与契约不一致");
        assertEquals(report.path("status").asText(), share.path("kind").asText(),
                "share.kind 必须与 status 一致");
        assertFalse(share.path("boundaryLine").isNull(),
                "TENTATIVE 必须给出 boundaryLine：要告诉用户「这一侧只是略偏」");
    }

    @Test
    @DisplayName("§7 boundaries[] 字段一致，边界样本必须非空")
    void boundaryKeysMatchContract() throws Exception {
        JsonNode boundaries = tentativeReport().path("boundaries");
        assertTrue(boundaries.size() > 0, "边界样本的 boundaries[] 不应为空");
        for (JsonNode row : boundaries) {
            assertEquals(BOUNDARY_KEYS, keysOf(row));
        }
    }

    @Test
    @DisplayName("§7 typeSections 的 key、标题、顺序固定为契约表格的八段")
    void typeSectionsMatchContract() throws Exception {
        JsonNode sections = tentativeReport().path("typeSections");
        assertEquals(SECTION_ORDER.size(), sections.size(), "16 型报告应给出全部八段");
        for (int i = 0; i < SECTION_ORDER.size(); i += 1) {
            assertEquals(List.of("key", "title", "body"), keysOf(sections.get(i)));
            assertEquals(SECTION_ORDER.get(i), sections.get(i).path("key").asText());
            assertEquals(SECTION_TITLES.get(i), sections.get(i).path("title").asText());
            assertFalse(sections.get(i).path("body").asText().isBlank(),
                    "第 " + i + " 段正文为空：空段落不该出现在报告里");
        }
    }

    @Test
    @DisplayName("§7 nextActions 恰好 3 条，每条含 title 与 steps")
    void nextActionsMatchContract() throws Exception {
        JsonNode actions = tentativeReport().path("nextActions");
        assertEquals(3, actions.size(), "成长行动必须恰好 3 条");
        for (JsonNode action : actions) {
            assertEquals(List.of("title", "steps"), keysOf(action));
            assertTrue(action.path("steps").size() > 0, "每条行动至少要有一步");
        }
    }

    @Test
    @DisplayName("§7 methodology 字段一致，且版本字段来自**这一份报告自己的内容包**")
    void methodologyKeysMatchContract() throws Exception {
        JsonNode methodology = tentativeReport().path("methodology");
        assertEquals(METHODOLOGY_KEYS, keysOf(methodology));

        // 版本绑定：报告元数据必须记下**这一份报告实际用的**包与文案版本，
        // 历史报告全靠这些字段才能被正确解释（不能记"当前默认值"，也不能记另一版文案）。
        JungPackage pkg = loader().current();
        assertEquals(pkg.packageId(), methodology.path("packageId").asText());
        assertEquals(pkg.scoringVersion(), methodology.path("scoringVersion").asText());
        assertEquals(pkg.scoringPolicy().version(), methodology.path("policyVersion").asText());
        assertEquals(pkg.reportContentVersion(), methodology.path("reportContentVersion").asText());
        // 默认包换成 v4 之后这两条必须跟着走；写死在这里是为了让"换包但没换元数据"当场红。
        assertEquals("typeme-jung48-score-v4", methodology.path("scoringVersion").asText(),
                "默认包已声明 score-v4，报告元数据必须一致");
        assertEquals("typeme-type-report-zh-v1", methodology.path("reportContentVersion").asText(),
                "v4 复用的报告文案版本仍是 v1；改成 v2 会同时改变用户看到的报告结构（八段+3 条行动 → 一句话+1 个动作）");
    }

    @Test
    @DisplayName("TIED：不给四字母、不套用任何类型报告、主标题里不出现四字母")
    void tiedReportOmitsTypeCodeAndTypeCopy() throws Exception {
        JungPackageLoader loader = loader();
        JungPackage pkg = loader.current();

        // 四维全答中性（ratingNeutral）→ 每维 SFinal=0 → 四维同时平分
        Map<String, JungAnswer> answers = answerAllNeutral(pkg);
        var result = JungScorer.score(pkg, answers, false);
        assertEquals(JungResultStatus.TIED, result.status(),
                "全中性作答应当平分四维，否则本测试前提不成立");

        JsonNode report = serialize(JungReportBuilder.build(loader, result, "report-2", "attempt-2",
                LocalDateTime.parse("2026-09-16T10:20:30"), LocalDateTime.parse("2026-09-16T10:20:00")));

        assertTrue(report.path("computedTypeCode").isNull(), "TIED 不得给出四字母");
        assertEquals("none", report.path("typeSource").asText());
        assertTrue(report.path("typeSections").isEmpty(),
                "TIED 没有唯一类型，因此不该套用任何一份类型报告");
        assertEquals(4, report.path("tiedDimensions").size(), "四维都平分");

        String headline = report.path("share").path("headline").asText();
        assertFalse(headline.matches(".*[EI][SN][TF][JP].*"),
                "TIED 的主标题不得出现四字母，实际：" + headline);

        assertEquals(Set.of("EI", "SN", "TF", "JP"),
                Set.copyOf(readStrings(report.path("tiedDimensions"))));

        for (JsonNode candidate : report.path("candidates")) {
            assertTrue(candidate.path("typeCode").asText().matches("[EI][SN][TF][JP]"),
                    "候选本身仍必须是合法四字母");
        }

        // 过程层同样不能出现：平分时连字母都没有，推导一个过程结构就是在制造确定性。
        assertTrue(report.path("dynamics").isNull(),
                "TIED 不得给出过程层：字母未定就不该推导主导/辅助过程");
        assertTrue(report.path("processPlan").isNull(),
                "TIED 不得给出由过程结构派生的建议");
    }

    /* ── 过程层（契约 §7.1） ─────────────────────────────────────────────── */

    @Test
    @DisplayName("§7.1 dynamics 字段与顺序一致，四个过程按主导→辅助→第三→第四排")
    void dynamicsKeysMatchContract() throws Exception {
        JsonNode dynamics = tentativeReport().path("dynamics");
        assertEquals(DYNAMICS_KEYS, keysOf(dynamics), "dynamics 字段与契约不一致");
        assertEquals(JungReportBuilder.DYNAMICS_VERSION, dynamics.path("version").asText(),
                "dynamics.version 必须与实现里的常量一致：规则改了要换号，旧报告才能自证按哪一版算的");

        JsonNode processes = dynamics.path("processes");
        assertEquals(4, processes.size(), "过程结构必须恰好四项");
        List<String> slots = new ArrayList<>();
        for (int i = 0; i < 4; i += 1) {
            JsonNode row = processes.get(i);
            assertEquals(DYNAMICS_PROCESS_KEYS, keysOf(row), "第 " + (i + 1) + " 个过程的字段与契约不一致");
            assertEquals(i + 1, row.path("order").asInt(), "order 必须与数组位置一致");
            slots.add(row.path("slot").asText());
            assertFalse(row.path("what").asText().isBlank(), "每个过程都要有职责说明");
            assertFalse(row.path("reading").asText().isBlank(), "每个过程都要有读法");
        }
        assertEquals(List.of("dominant", "auxiliary", "tertiary", "inferior"), slots,
                "过程顺序必须是权威序：主导→辅助→第三位→第四位");
    }

    @Test
    @DisplayName("§7.1 前两位标为偏好过程、后两位不是；且必须带「这是推导不是测量」的说明")
    void dynamicsMarksPreferredAndCarriesCaveat() throws Exception {
        JsonNode dynamics = tentativeReport().path("dynamics");
        JsonNode processes = dynamics.path("processes");
        assertTrue(processes.get(0).path("preferred").asBoolean(), "第一位是主导过程");
        assertTrue(processes.get(1).path("preferred").asBoolean(), "第二位是辅助过程");
        assertFalse(processes.get(2).path("preferred").asBoolean(), "第三位不是偏好过程");
        assertFalse(processes.get(3).path("preferred").asBoolean(), "第四位不是偏好过程");

        // 没有这段说明，"按规则推的"会被读成"测出来的"
        String caveat = dynamics.path("notes").path("frameworkCaveat").asText();
        assertFalse(caveat.isBlank(), "过程层必须带框架免责说明");
        String basis = dynamics.path("basis").asText();
        assertTrue(basis.contains("推导"),
                "basis 必须写明这一层是推导出来的，而不是本次测出来的另一个结果");
    }

    @Test
    @DisplayName("§7.1 倾向较轻的维度要给出「换到另一侧结构会怎么变」，而不是只说另一侧也值得看")
    void dynamicsExplainsFlipConsequences() throws Exception {
        // 本样本 EI 只是略偏 → 说明必须讲 E/I 的真正后果：四个过程不变，主导与辅助互换。
        JsonNode dynamics = tentativeReport().path("dynamics");
        JsonNode boundaryNotes = dynamics.path("boundaryNotes");
        assertTrue(boundaryNotes.size() > 0, "TENTATIVE 的过程层必须解释换边后果");
        JsonNode ei = null;
        for (JsonNode node : boundaryNotes) {
            if ("EI".equals(node.path("dimension").asText())) {
                ei = node;
            }
        }
        assertTrue(ei != null, "本样本 EI 是边界，必须有一条 EI 的换边说明");
        assertEquals("E", ei.path("pole").asText());
        // 注意这里**不**断言"功能族不变"那类抽象措辞：抽象措辞正是上一次把 E/I 与 J/P
        // 说反却没人发现的原因。改为断言它点名了换边后的真实结构，并且点对了。
        // 本样本是 ENFP → E/I 换边得到 INFP（Ne/Fi/Te/Si → Fi/Ne/Si/Te）。
        String note = ei.path("note").asText();
        assertTrue(note.contains("主导与辅助会互换"),
                "E/I 换边的真实后果是主导与辅助互换，实际：" + note);
        assertTrue(note.contains("INFP"),
                "说明里要点出换过去的类型码，这样用户能自己核对，实际：" + note);
        assertTrue(note.contains("外倾直觉") && note.contains("内倾情感"),
                "说明里要点名换边前后的主导过程（外倾直觉 → 内倾情感），实际：" + note);
    }

    @Test
    @DisplayName("§7.1 processPlan 字段一致，三段发展序、四步决策法、两条互补、四条沟通规则")
    void processPlanKeysMatchContract() throws Exception {
        JsonNode plan = tentativeReport().path("processPlan");
        assertEquals(PROCESS_PLAN_KEYS, keysOf(plan), "processPlan 字段与契约不一致");

        JsonNode development = plan.path("developmentOrder");
        assertEquals(3, development.size(),
                "发展序按原书 19.2 是三层：主导 → 辅助 → 两个尚未偏好的过程（第三层不分先后）");
        assertEquals(List.of(1, 2, 3), readInts(development, "order"));
        assertEquals(1, development.get(0).path("processes").size(), "第一层只讲主导过程");
        assertEquals(1, development.get(1).path("processes").size(), "第二层只讲辅助过程");
        assertEquals(2, development.get(2).path("processes").size(),
                "第三层并列讲两个尚未偏好的过程 —— 原书撤回过「发展按时间表完成」，这里不许替它排序");

        JsonNode steps = plan.path("decisionSteps");
        assertEquals(4, steps.size(), "四步决策法必须恰好四步");
        List<String> functions = new ArrayList<>();
        for (JsonNode step : steps) {
            functions.add(step.path("function").asText());
        }
        assertEquals(List.of("S", "N", "T", "F"), functions, "四步顺序固定为 感觉→直觉→思考→情感");
        // 四个功能族恰好两个属于偏好过程、两个不是
        int preferred = 0;
        for (JsonNode step : steps) {
            if (step.path("preferred").asBoolean()) {
                preferred += 1;
            }
        }
        assertEquals(2, preferred, "四步里恰好两步用得上偏好的功能族");
        assertEquals(2, plan.path("hardestSteps").size(), "最难的两步就是把上面那两步的补集");

        assertEquals(2, plan.path("opposites").size(), "互补只覆盖 SN / TF 两轴（原书图表 32 的口径）");
        assertEquals(4, plan.path("communicationRules").size(), "四个维度各一条沟通规则");

        assertFalse(plan.path("notes").path("developmentNote").asText().isBlank(),
                "过程层必须说明「四个过程没有高下」");
        assertFalse(plan.path("notes").path("greyAreaNote").asText().isBlank(),
                "过程层必须说明尚未发展的过程在压力下的表现");
    }

    @Test
    @DisplayName("§7.1 报告里不许残留任何 markdown 记号（页面与分享图都只渲染纯文本）")
    void noMarkdownLeaksIntoCopy() throws Exception {
        // 这条不是洁癖：拼文案的代码里写过 `**互换**` 想强调，而 `dynamicsRule` 末尾会剥掉星号、
        // `flipNote` 不会 —— 结果是 JSON 里躺着两个星号，页面照原样显示出来。
        assertNoMarkdown(tentativeReport(), "report_json");
    }

    private static void assertNoMarkdown(JsonNode node, String where) {
        if (node.isTextual()) {
            String text = node.asText();
            assertFalse(text.contains("**"),
                    where + " 里残留了 markdown 粗体记号：" + text);
            assertFalse(text.contains("`"),
                    where + " 里残留了 markdown 反引号：" + text);
            return;
        }
        if (node.isObject()) {
            node.fields().forEachRemaining(entry ->
                    assertNoMarkdown(entry.getValue(), where + "." + entry.getKey()));
            return;
        }
        if (node.isArray()) {
            for (int i = 0; i < node.size(); i += 1) {
                assertNoMarkdown(node.get(i), where + "[" + i + "]");
            }
        }
    }

    private static List<Integer> readInts(JsonNode array, String field) {
        List<Integer> values = new ArrayList<>();
        array.forEach(node -> values.add(node.path(field).asInt()));
        return values;
    }

    private static List<String> readStrings(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(node -> values.add(node.asText()));
        return values;
    }
}
