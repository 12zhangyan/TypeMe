package com.typeme.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.typeme.model.MethodContent;
import com.typeme.model.Questionnaire;
import com.typeme.model.TypeProfile;
import com.typeme.model.TypesFile;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.IntStream;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 内容校验测试。
 *
 * <p>分两类：
 * <ul>
 *   <li><b>测试夹具</b>：完全在内存里用 Map 构造题库，验证校验逻辑本身有效
 *       （包括「故意把 direction 改错，校验必须失败」）。<b>不依赖 types.yml 这个真实文件是否存在。</b></li>
 *   <li><b>真实内容</b>：直接读 classpath 上的 {@code questionnaire-quick.yml} 与 {@code method.yml}，
 *       交叉核对官方 OEJTS 1.2 的题号 / 符号 / 常量，并钉住题面哈希。</li>
 * </ul>
 *
 * <p>下表是官方公式的**独立重述**（与 {@link ContentService#OFFICIAL_SIGNS} 分开写），
 * 两处若不一致，测试就会红。
 */
class ContentValidationTest {

    // ------------------------------------------------------------------ 官方表（独立重述）

    private static final Map<Integer, Integer> EI_SIGNS =
            Map.of(3, -1, 7, -1, 11, -1, 15, 1, 19, -1, 23, 1, 27, 1, 31, -1);
    private static final Map<Integer, Integer> SN_SIGNS =
            Map.of(4, 1, 8, 1, 12, 1, 16, 1, 20, 1, 24, -1, 28, -1, 32, 1);
    private static final Map<Integer, Integer> TF_SIGNS =
            Map.of(2, -1, 6, 1, 10, 1, 14, -1, 18, -1, 22, 1, 26, -1, 30, -1);
    private static final Map<Integer, Integer> JP_SIGNS =
            Map.of(1, 1, 5, 1, 9, -1, 13, 1, 17, -1, 21, 1, 25, -1, 29, 1);

    private static final Map<String, Map<Integer, Integer>> OFFICIAL_SIGNS =
            Map.of("EI", EI_SIGNS, "SN", SN_SIGNS, "TF", TF_SIGNS, "JP", JP_SIGNS);

    private static final Map<String, Integer> OFFICIAL_CONSTANTS =
            Map.of("EI", 30, "SN", 12, "TF", 30, "JP", 18);

    private static final int OFFICIAL_MIDPOINT = 24;

    /**
     * 人工复核锚点：整套题面（题号|维度|符号|左端|右端 的 SHA-256）。
     *
     * <p>哈希按题号排序后拼接（MI-2），因此它随题面变化、但**不随数组顺序变化**；
     * 顺序由 {@code validateQuestionnaire} 的「按 id 升序」断言单独拦截。
     *
     * <p>本值于 BK-2（Q9 两端改为「随性，有点乱 / 有条理，按规矩放」，方向与符号未动）
     * 与 MI-2（改为按 id 排序后拼接）落地后重新生成。任何一次改动题面或左右顺序都会让本测试
     * 变红，强制重新逐题对照官方 PDF。
     *
     * <p><b>复核记录</b>：刷新本值时已逐题独立核对 32 题的
     * （a）{@code dimension}/{@code direction} 与官方四条公式完全一致；
     * （b）{@code textLeft}/{@code textRight} 的极向与 OEJTS 1.2 第 2 页英文原句语义一致
     * （含 BK-2 改写的 Q9：左端仍为 chaotic、右端仍为 organized，符号仍为 −1）。
     * 核对依据为 {@code research/_sources/OEJTS1.2.txt} 与官方 PDF（二者已做逐字连续匹配验证）。
     */
    private static final String REVIEWED_QUESTION_SET_SHA256 =
            "83c112bdfb43fa62e942402adf963c90cc0d18e6b3a21aaf7033161b6f5cf754";

    private static final ObjectMapper YAML = new YAMLMapper();

    // ------------------------------------------------------------------ 夹具构造

    private static Map<String, Object> validFixture() {
        Map<Integer, String> dimensionOfId = new HashMap<>();
        Map<Integer, Integer> signOfId = new HashMap<>();
        OFFICIAL_SIGNS.forEach((dimension, signs) -> signs.forEach((id, sign) -> {
            dimensionOfId.put(id, dimension);
            signOfId.put(id, sign);
        }));

        List<Map<String, Object>> questions = new ArrayList<>();
        for (int id = 1; id <= 32; id++) {
            questions.add(question(id, dimensionOfId.get(id), signOfId.get(id)));
        }

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("version", "quick");
        root.put("title", "快速版");
        root.put("questionCount", 32);
        root.put("estimatedMinutes", 5);
        root.put("scoring", scoring(OFFICIAL_MIDPOINT, new LinkedHashMap<>(OFFICIAL_CONSTANTS)));
        root.put("questions", questions);
        return root;
    }

    private static Map<String, Object> question(int id, String dimension, int direction) {
        Map<String, Object> question = new LinkedHashMap<>();
        question.put("id", id);
        question.put("textLeft", "夹具左端" + id);
        question.put("textRight", "夹具右端" + id);
        question.put("dimension", dimension);
        question.put("direction", direction);
        return question;
    }

    private static Map<String, Object> scoring(int midpoint, Map<String, Integer> constants) {
        Map<String, Object> scoring = new LinkedHashMap<>();
        scoring.put("midpoint", midpoint);
        scoring.put("constants", constants);
        return scoring;
    }

    private static Questionnaire parse(Map<String, Object> fixture) {
        return YAML.convertValue(fixture, Questionnaire.class);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> questions(Map<String, Object> root) {
        // 夹具常态是「按 id 升序」——校验现在会断言数组顺序（MI-2），
        // 所以先在这里排好，让「故意换位」这类用例必须显式去动数组。
        List<Map<String, Object>> list = (List<Map<String, Object>>) root.get("questions");
        list.sort(java.util.Comparator.comparingInt(question -> (Integer) question.get("id")));
        return list;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> questionById(Map<String, Object> root, int id) {
        return questions(root).stream()
                .filter(question -> Integer.valueOf(id).equals(question.get("id")))
                .findFirst()
                .orElseThrow(() -> new AssertionError("夹具里没有 Q" + id));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> constants(Map<String, Object> root) {
        return (Map<String, Object>) ((Map<String, Object>) root.get("scoring")).get("constants");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> scoringOf(Map<String, Object> root) {
        return (Map<String, Object>) root.get("scoring");
    }

    private static void assertRejected(Map<String, Object> fixture, String expectedFragment) {
        Questionnaire questionnaire = parse(fixture);
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateQuestionnaire(questionnaire, "test-fixture.yml"),
                "坏内容必须让校验失败，否则校验就是摆设");
        assertTrue(error.getMessage().contains(expectedFragment),
                "错误信息应包含「" + expectedFragment + "」，实际：" + error.getMessage());
    }

    // ------------------------------------------------------------------ 夹具：正例

    @Test
    @DisplayName("夹具（内存 map 构造）本身合法时校验通过，且不依赖任何真实 YAML 文件")
    void acceptsValidFixture() {
        assertDoesNotThrow(() -> ContentService.validateQuestionnaire(parse(validFixture()), "test-fixture.yml"));
    }

    // ------------------------------------------------------------------ 夹具：坏内容

    @Test
    @DisplayName("故意把 Q1 的 direction 改成 -1（JP 符号整体反转的起点）→ 校验必须失败")
    void rejectsFlippedDirectionOnSingleQuestion() {
        Map<String, Object> fixture = validFixture();
        questionById(fixture, 1).put("direction", -1);
        assertRejected(fixture, "JP 维度的题号/符号与官方 oejts32 1.2 公式不一致");
    }

    @Test
    @DisplayName("把整个 JP 维度的符号全体反转（题数与维度都合法）→ 校验必须失败")
    void rejectsFlippedWholeDimension() {
        Map<String, Object> fixture = validFixture();
        JP_SIGNS.keySet().forEach(id -> {
            Map<String, Object> question = questionById(fixture, id);
            question.put("direction", -(Integer) question.get("direction"));
        });
        assertRejected(fixture, "JP 维度的题号/符号与官方 oejts32 1.2 公式不一致");
    }

    @Test
    @DisplayName("维度之间互换两道题（每维仍是 8 题）→ 校验必须失败")
    void rejectsSwappedQuestionIdsKeepingCounts() {
        Map<String, Object> fixture = validFixture();
        Map<String, Object> q20 = questionById(fixture, 20); // 官方 SN
        Map<String, Object> q29 = questionById(fixture, 29); // 官方 JP
        q20.put("dimension", "JP");
        q29.put("dimension", "SN");
        assertRejected(fixture, "维度的题号/符号与官方 oejts32 1.2 公式不一致");
    }

    @Test
    @DisplayName("scoring.constants 被改（EI 写成 28）→ 校验必须失败")
    void rejectsWrongConstant() {
        Map<String, Object> fixture = validFixture();
        constants(fixture).put("EI", 28);
        assertRejected(fixture, "scoring.constants");
    }

    @Test
    @DisplayName("scoring.midpoint 被改成 25 → 校验必须失败")
    void rejectsWrongMidpoint() {
        Map<String, Object> fixture = validFixture();
        scoringOf(fixture).put("midpoint", 25);
        assertRejected(fixture, "scoring.midpoint 必须是 24");
    }

    @Test
    @DisplayName("题号重复 → 校验必须失败")
    void rejectsDuplicateId() {
        Map<String, Object> fixture = validFixture();
        questions(fixture).get(1).put("id", 1); // Q2 改成 Q1
        assertRejected(fixture, "题号重复");
    }

    @Test
    @DisplayName("题号越界 / 不连续（Q32 改成 Q33）→ 校验必须失败")
    void rejectsIdOutOfRange() {
        Map<String, Object> fixture = validFixture();
        questionById(fixture, 32).put("id", 33);
        assertRejected(fixture, "题号必须是 1..32 连续");
    }

    @Test
    @DisplayName("dimension 非法（XX）→ 校验必须失败")
    void rejectsUnknownDimension() {
        Map<String, Object> fixture = validFixture();
        questionById(fixture, 4).put("dimension", "XX");
        // 记录级 @Pattern 已移除（维度不再是四个固定字面量），改由仪器档案的维度集合断言接管：
        // 诊断必须点名是哪一题的哪个非法维度，不能只报「SN 少了一题」。
        assertRejected(fixture, "题 Q4 的 dimension 非法：oejts32 的官方维度是 [EI, SN, TF, JP]，实际 \"XX\"");
    }

    @Test
    @DisplayName("direction 只能是 +1 / -1（0 与 2 都要拒）→ 校验必须失败")
    void rejectsIllegalDirectionValue() {
        Map<String, Object> zero = validFixture();
        questionById(zero, 4).put("direction", 0);
        assertRejected(zero, "direction 只能是 +1 / -1");

        Map<String, Object> two = validFixture();
        questionById(two, 4).put("direction", 2);
        assertRejected(two, "direction 只能是 +1 / -1");
    }

    @Test
    @DisplayName("questionCount 与实际题数不符 → 校验必须失败")
    void rejectsQuestionCountMismatch() {
        Map<String, Object> fixture = validFixture();
        questions(fixture).remove(questions(fixture).size() - 1);
        assertRejected(fixture, "与 questions 实际条数 31 不一致");
    }

    @Test
    @DisplayName("题干留空 → 校验必须失败（bipolar 格式的左右两端都要非空）")
    void rejectsBlankQuestionText() {
        Map<String, Object> fixture = validFixture();
        questionById(fixture, 4).put("textLeft", "   ");
        // 记录级 @NotBlank 已移除（agreement 格式不使用 textLeft/textRight），
        // 改为按 format 分别断言：这里必须给出「Q4 是 bipolar 格式」这一级的诊断。
        assertRejected(fixture, "题 Q4 是 bipolar 格式，textLeft/textRight 都不能为空");
    }

    @Test
    @DisplayName("左右两端文本相同 → 校验必须失败（典型的复制粘贴失误）")
    void rejectsIdenticalPoles() {
        Map<String, Object> fixture = validFixture();
        questionById(fixture, 4).put("textRight", "夹具左端4");
        assertRejected(fixture, "左右两端文本完全相同");
    }

    // ------------------------------------------------------------------ MI-1 / MI-2：字段与顺序

    @Test
    @DisplayName("MI-1：title 留空 → 校验必须失败（落地页会直接显示这个字段）")
    void rejectsBlankTitle() {
        Map<String, Object> fixture = validFixture();
        fixture.put("title", "   ");
        assertRejected(fixture, "title 不能为空");
    }

    @Test
    @DisplayName("MI-1：estimatedMinutes 改成 999 → 校验必须失败（否则落地页写「约 999 分钟」）")
    void rejectsAbsurdEstimatedMinutes() {
        Map<String, Object> fixture = validFixture();
        fixture.put("estimatedMinutes", 999);
        assertRejected(fixture, "estimatedMinutes 必须在 1–" + ContentService.MAX_ESTIMATED_MINUTES);

        Map<String, Object> zero = validFixture();
        zero.put("estimatedMinutes", 0);
        assertRejected(zero, "字段级校验失败");
    }

    @Test
    @DisplayName("MI-2：Q1 与 Q2 换位 → 校验必须失败（数组顺序必须按 id 升序）")
    void rejectsOutOfOrderQuestions() {
        Map<String, Object> fixture = validFixture();
        List<Map<String, Object>> list = questions(fixture);
        Map<String, Object> first = list.remove(0); // Q1
        list.add(1, first);                          // 放回 Q2 之后 → Q2, Q1, Q3...
        assertRejected(fixture, "必须按 id 升序排列");
    }

    @Test
    @DisplayName("MI-2：哈希与数组顺序无关——换位不改变题面哈希，但必然被顺序校验拦住")
    void questionSetHashIsOrderInsensitive() {
        Questionnaire original = parse(validFixture());

        Map<String, Object> shuffled = validFixture();
        List<Map<String, Object>> list = questions(shuffled);
        Map<String, Object> first = list.remove(0);
        list.add(1, first);
        Questionnaire reordered = parse(shuffled);

        // 未排序的旧实现会在这里得出不同哈希（顺序改了哈希却不变 = 顺序完全没人管）；
        // 现在哈希按 id 排序后拼接，顺序变化由「升序」断言负责拦截。
        assertEquals(ContentService.questionSetHash(original), ContentService.questionSetHash(reordered),
                "哈希描述的是题面集合，不该随数组顺序变化");
        assertThrows(ContentValidationException.class,
                () -> ContentService.validateQuestionnaire(reordered, "test-fixture.yml"),
                "顺序本身必须另有断言拦截，否则重排题库会静默生效");
    }

    // ------------------------------------------------------------------ MI-3：严格反序列化

    @Test
    @DisplayName("MI-3：direction: 1.9（浮点）必须报错，而不是被静默截断成 1")
    void rejectsFloatDirectionInsteadOfTruncating() {
        assertStrictParseFails("""
                version: "quick"
                questions:
                  - id: 1
                    textLeft: "左"
                    textRight: "右"
                    dimension: "JP"
                    direction: 1.9
                """, Questionnaire.class, "浮点符号");
    }

    @Test
    @DisplayName("MI-3：questionCount: \"32\"（字符串）必须报错，而不是被强转成 32")
    void rejectsStringQuestionCount() {
        assertStrictParseFails("""
                version: "quick"
                questionCount: "32"
                """, Questionnaire.class, "字符串数字");
    }

    @Test
    @DisplayName("MI-3：types 侧字段名拼错（tagLines）必须报错，而不是静默丢弃")
    void rejectsUnknownPropertiesOnTypes() {
        assertStrictParseFails("""
                types:
                  - code: "INFP"
                    nameCn: "调停者"
                    tagLines: "字段名拼错了"
                """, TypesFile.class, "未知字段");
    }

    @Test
    @DisplayName("MI-3：method 侧字段名拼错（licenseURL）必须报错")
    void rejectsUnknownPropertiesOnMethod() {
        assertStrictParseFails("""
                attribution:
                  source: "src"
                  author: "author"
                  url: "https://example.org"
                  license: "CC BY-NC-SA 4.0"
                  licenseURL: "https://example.org/l"
                sections:
                  - title: "题库来源与许可"
                    body: "正文"
                """, MethodContent.class, "未知字段");
    }

    /** 走 {@link ContentService#read} 的严格 mapper 解析一段 YAML，断言它必须失败。 */
    private static void assertStrictParseFails(String yaml, Class<?> type, String what) {
        ByteArrayResource resource = new ByteArrayResource(
                yaml.getBytes(StandardCharsets.UTF_8)) {
            @Override
            public String getDescription() {
                return "strict-fixture.yml";
            }
        };
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.read(resource, type),
                what + "必须解析失败，严格模式被削弱了");
        assertTrue(error.getMessage().contains("内容解析失败"), error.getMessage());
    }

    // ------------------------------------------------------------------ 类型文案校验（内存夹具，不读真实 types.yml）

    private static TypeProfile typeProfile(String code, int resonanceCount) {
        return new TypeProfile(
                code,
                "名称" + code,
                "一句话描述",
                Map.of("EI", "EI 文案", "SN", "SN 文案", "TF", "TF 文案", "JP", "JP 文案"),
                List.of("强项一", "强项二", "强项三"),
                List.of("盲点一", "盲点二", "盲点三"),
                IntStream.rangeClosed(1, resonanceCount).mapToObj(i -> "共鸣" + i).toList(),
                List.of("成长一", "成长二"));
    }

    private static List<TypeProfile> allSixteenTypes() {
        return ContentService.REQUIRED_TYPE_CODES.stream().sorted().map(code -> typeProfile(code, 4)).toList();
    }

    @Test
    @DisplayName("16 个类型码齐全（内存夹具）时校验通过")
    void acceptsCompleteTypeFixture() {
        assertDoesNotThrow(() -> ContentService.validateTypes(new TypesFile(allSixteenTypes()), "types-fixture.yml"));
    }

    @Test
    @DisplayName("类型码缺一个 → 校验必须失败")
    void rejectsMissingTypeCode() {
        List<TypeProfile> incomplete = new ArrayList<>(allSixteenTypes());
        incomplete.remove(0);
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateTypes(new TypesFile(incomplete), "types-fixture.yml"));
        assertTrue(error.getMessage().contains("缺少类型文案"), error.getMessage());
    }

    @Test
    @DisplayName("resonance 少于 3 条 → 校验必须失败（反巴纳姆的硬要求）")
    void rejectsShortResonance() {
        List<TypeProfile> types = new ArrayList<>(allSixteenTypes());
        types.set(0, typeProfile(types.get(0).code(), 2));
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateTypes(new TypesFile(types), "types-fixture.yml"));
        assertTrue(error.getMessage().contains("resonance"), error.getMessage());
    }

    @Test
    @DisplayName("dimensions 缺维度 → 校验必须失败")
    void rejectsIncompleteDimensions() {
        TypeProfile broken = new TypeProfile("INFP", "调停者", "tagline",
                Map.of("EI", "只写了一维"), List.of("a"), List.of("b"), List.of("c", "d", "e"), List.of("f"));
        List<TypeProfile> types = new ArrayList<>(allSixteenTypes());
        types.set(0, broken);
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateTypes(new TypesFile(types), "types-fixture.yml"));
        assertTrue(error.getMessage().contains("dimensions"), error.getMessage());
    }

    // ------------------------------------------------------------------ 方法说明页校验（内存夹具）

    @Test
    @DisplayName("署名缺 license → 校验必须失败（CC BY 的署名义务）")
    void rejectsBlankLicense() {
        MethodContent broken = new MethodContent(
                new MethodContent.Attribution("src", "author", "https://example.org", "   ", "https://example.org/l"),
                validSections());
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateMethodContent(broken, "method-fixture.yml"));
        assertTrue(error.getMessage().contains("字段级校验失败"), error.getMessage());
    }

    @Test
    @DisplayName("方法说明页缺少「为什么 S–N 维度测不准」小节 → 校验必须失败")
    void rejectsMissingSnSection() {
        List<MethodContent.MethodSection> sections = new ArrayList<>(validSections());
        sections.removeIf(section -> section.title().contains("S–N"));
        MethodContent broken = new MethodContent(
                new MethodContent.Attribution("src", "author", "https://example.org",
                        "CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/"),
                sections);
        ContentValidationException error = assertThrows(ContentValidationException.class,
                () -> ContentService.validateMethodContent(broken, "method-fixture.yml"));
        assertTrue(error.getMessage().contains("为什么 S–N 维度测不准"), error.getMessage());
    }

    private static List<MethodContent.MethodSection> validSections() {
        return ContentService.REQUIRED_METHOD_SECTIONS.stream()
                .map(title -> new MethodContent.MethodSection(title, "正文"))
                .toList();
    }

    // ------------------------------------------------------------------ 真实内容

    private static Questionnaire realQuickQuestionnaire() throws IOException {
        ClassPathResource resource = new ClassPathResource("content/questionnaire-quick.yml");
        assertTrue(resource.exists(), "真实题库 content/questionnaire-quick.yml 必须存在");
        try (InputStream in = resource.getInputStream()) {
            return YAML.readValue(in, Questionnaire.class);
        }
    }

    @Test
    @DisplayName("真实题库：32 题、每维 8 题，题号/符号/常量/中点与官方 OEJTS 1.2 完全一致")
    void realQuestionnaireMatchesOfficialTables() throws IOException {
        Questionnaire questionnaire = realQuickQuestionnaire();
        assertDoesNotThrow(() -> ContentService.validateQuestionnaire(questionnaire, "questionnaire-quick.yml"));

        assertEquals("quick", questionnaire.version());
        assertEquals(32, questionnaire.questions().size());
        assertEquals(32, questionnaire.questionCount());
        assertEquals("快速版", questionnaire.title());

        Set<Integer> ids = new TreeSet<>();
        questionnaire.questions().forEach(question -> ids.add(question.id()));
        assertEquals(IntStream.rangeClosed(1, 32).boxed().collect(java.util.stream.Collectors.toSet()), ids);

        for (Map.Entry<String, Map<Integer, Integer>> entry : OFFICIAL_SIGNS.entrySet()) {
            Map<Integer, Integer> actual = new TreeMap<>();
            questionnaire.questions().stream()
                    .filter(question -> entry.getKey().equals(question.dimension()))
                    .forEach(question -> actual.put(question.id(), question.direction()));
            assertEquals(entry.getValue(), actual, entry.getKey() + " 维度的题号/符号必须与官方公式一致");
            assertEquals(8, actual.size(), entry.getKey() + " 维度必须恰好 8 题");
        }

        assertEquals(OFFICIAL_CONSTANTS, questionnaire.scoring().constants());
        assertEquals(OFFICIAL_MIDPOINT, questionnaire.scoring().midpoint());

        // 两端必须真的不同，且没有两题共用同一对文字（防复制粘贴）
        Set<String> pairs = new HashSet<>();
        for (var question : questionnaire.questions()) {
            assertNotNull(question.textLeft());
            assertTrue(!question.textLeft().isBlank() && !question.textRight().isBlank(),
                    "Q" + question.id() + " 的题干不能为空");
            assertTrue(!question.textLeft().equals(question.textRight()),
                    "Q" + question.id() + " 的左右两端不能相同");
            assertTrue(pairs.add(question.textLeft() + "||" + question.textRight()),
                    "Q" + question.id() + " 与前面某题的左右两端文字完全重复");
        }
    }

    @Test
    @DisplayName("真实题库：题面哈希等于人工复核后的锚点（改动题面必然变红）")
    void realQuestionnaireQuestionSetHashIsPinned() throws IOException {
        Questionnaire questionnaire = realQuickQuestionnaire();
        String hash = ContentService.questionSetHash(questionnaire);
        System.out.println("[MT-QUESTION-SET-HASH] " + hash);
        assertEquals(REVIEWED_QUESTION_SET_SHA256, hash,
                "题面哈希变了：请重新逐题对照 research/_sources/OEJTS1.2.txt 与 research/01-题库来源.md §A1，"
                        + "确认左右端顺序无误后更新 REVIEWED_QUESTION_SET_SHA256。当前哈希=" + hash);
    }

    @Test
    @DisplayName("真实题库：中文译文里不能残留官方英文原文（防漏译）")
    void realQuestionnaireIsFullyTranslated() throws IOException {        Questionnaire questionnaire = realQuickQuestionnaire();
        for (var question : questionnaire.questions()) {
            assertTrue(question.textLeft().codePoints().anyMatch(cp -> cp > 0x2E7F),
                    "Q" + question.id() + " 左端疑似未翻译：" + question.textLeft());
            assertTrue(question.textRight().codePoints().anyMatch(cp -> cp > 0x2E7F),
                    "Q" + question.id() + " 右端疑似未翻译：" + question.textRight());
        }
    }

    private static MethodContent realMethod() throws IOException {
        ClassPathResource resource = new ClassPathResource("content/method.yml");
        assertTrue(resource.exists(), "真实方法说明 content/method.yml 必须存在");
        try (InputStream in = resource.getInputStream()) {
            return YAML.readValue(in, MethodContent.class);
        }
    }

    @Test
    @DisplayName("真实方法说明页：署名齐全、五个小节都在，且 S–N 小节引用了信效度证据")
    void realMethodContentIsCompleteAndCitesEvidence() throws IOException {
        MethodContent method = realMethod();
        assertDoesNotThrow(() -> ContentService.validateMethodContent(method, "method.yml"));

        assertEquals("Open Extended Jungian Type Scales (OEJTS) 1.2", method.attribution().source());
        assertEquals("Eric Jorgenson", method.attribution().author());
        assertEquals("CC BY-NC-SA 4.0", method.attribution().license());
        assertEquals("https://creativecommons.org/licenses/by-nc-sa/4.0/", method.attribution().licenseUrl());
        // 4 节（任务拆解 1.3）+ BK-3 新增的「致谢与参考文献」= 5 节
        assertEquals(5, method.sections().size(), "任务拆解 1.3 的 4 节 + BK-3 的致谢与参考文献");

        String sn = method.sections().stream()
                .filter(section -> section.title().equals("为什么 S–N 维度测不准"))
                .map(MethodContent.MethodSection::body)
                .findFirst()
                .orElseThrow();
        // OEJTS 各维度区分效度（S–N 最低）
        assertTrue(sn.contains("2.06"), "S–N 小节应引用 I–E 区分效度 2.06");
        assertTrue(sn.contains("1.63"), "S–N 小节应引用 F–T 区分效度 1.63");
        assertTrue(sn.contains("1.30"), "S–N 小节应引用 J–P 区分效度 1.30");
        assertTrue(sn.contains("0.93"), "S–N 小节应引用 S–N 区分效度 0.93");
        // 中文样本信度 α / 重测 r
        assertTrue(sn.contains(".87") && sn.contains(".78"), "S–N 小节应引用 E–I 的 α .87 / 重测 .78");
        assertTrue(sn.contains(".70") && sn.contains(".64"), "S–N 小节应引用 S–N 的 α .70 / 重测 .64");
        assertTrue(sn.contains(".79"), "S–N 小节应引用 T–F 的 α .79");
        assertTrue(sn.contains(".84"), "S–N 小节应引用 J–P 的 α .84");

        String all = method.sections().stream()
                .map(MethodContent.MethodSection::body)
                .reduce("", (a, b) -> a + "\n" + b);
        assertTrue(all.contains("CC BY-NC-SA 4.0"), "正文应写明许可协议");
        assertTrue(all.contains("MBTI"), "正文应包含与 MBTI 无关联的声明");
        // 免责声明小节必须存在（标题由 validateMethodContent 断言），正文要真的在免责
        assertTrue(all.contains("保证"), "免责声明正文应写明不做任何保证");
        assertTrue(all.contains("咨询师") || all.contains("医生"),
                "免责声明正文应给出寻求专业帮助的指引");
        assertTrue(all.contains("不收集") || all.contains("不保存") || all.contains("不会离开"),
                "免责声明正文应说明不收集作答数据");
    }

    // ------------------------------------------------------------------ IM-5：许可声明必须与事实一致

    @Test
    @DisplayName("IM-5：许可小节必须承认「中文本地化改写」，且不得再出现「没有改写」这类不实陈述")
    void licenseSectionAdmitsLocalisationInsteadOfDenyingIt() throws IOException {
        String license = realMethod().sections().stream()
                .filter(section -> section.title().equals("题库来源与许可"))
                .map(MethodContent.MethodSection::body)
                .findFirst()
                .orElseThrow();

        assertTrue(license.contains("中文本地化改写"),
                "许可声明必须承认对英文题项做了中文本地化改写（事实就是 30/32 题措辞已重写）");
        assertTrue(license.contains("左右两端的极向与计分符号未改动"),
                "必须写清「极向与计分符号未改动」——这后半句才是真的");
        // 旧的不实陈述：一旦有人改回去，这里必须红
        assertTrue(!license.contains("没有改写"),
                "不得再声称「没有改写」——这与同页另一段和事实都矛盾");
    }

    // ------------------------------------------------------------------ BK-2：Q9 措辞与原量表的差异

    @Test
    @DisplayName("BK-2：Q9 两端是中性对照，左=chaotic 端、右=organized 端，符号仍为 -1")
    void questionNineKeepsPolarityWhileChangingWording() throws IOException {
        Questionnaire questionnaire = realQuickQuestionnaire();
        var q9 = questionnaire.questions().stream()
                .filter(question -> question.id() == 9)
                .findFirst()
                .orElseThrow();

        assertEquals("随性，有点乱", q9.textLeft(), "BK-2 裁决的左端措辞");
        assertEquals("有条理，按规矩放", q9.textRight(), "BK-2 裁决的右端措辞");
        assertEquals("JP", q9.dimension());
        assertEquals(-1, q9.direction(),
                "⚠️ BK-2 只改措辞：Q9 的 direction 必须仍是 -1，写反会让 J/P 符号整体反转");
        // 左右必须仍是「随性/乱」在左、「有条理」在右：换位等于符号反转
        assertTrue(q9.textLeft().contains("乱"), "左端必须仍是 chaotic 一侧");
        assertTrue(q9.textRight().contains("条理"), "右端必须仍是 organized 一侧");

        // 方法页要说明这题与原量表的措辞差异（BK-2 的附带要求）
        String all = realMethod().sections().stream()
                .map(MethodContent.MethodSection::body)
                .reduce("", (a, b) -> a + "\n" + b);
        assertTrue(all.contains("第 9 题") || all.contains("Q9"),
                "方法页必须说明第 9 题的措辞与原量表有差异");
        assertTrue(all.contains("chaotic") && all.contains("organized"),
                "方法页应点明原英文量表该题两端是 chaotic / organized");
    }

    // ------------------------------------------------------------------ MI-12：跨类型自我重复

    /**
     * 16 型正文之间**不允许出现 6 字以上的连续重合**。
     *
     * <p>背景（MI-12）：ENTJ 与 ESTJ 的 {@code dimensions.TF} 曾有一整句 20 字逐字相同，
     * ENFP 与 ESFP 的 {@code growth} 有 10 字连续相同，6 字以上跨类型复用共 58 处。
     * 这直接伤到「换一个类型读起来还像不像自己」这个验收点，而肉眼极难发现，
     * 所以把它变成一条机械断言。
     *
     * <p>阈值取 6 字：中文里 2–5 字的通用搭配（「计划被」「人多的场合」）无法避免，
     * 6 字连续重合已经是一个可辨识的短语，属于该消除的模板复用。
     */
    private static final int CROSS_TYPE_MAX_SHARED_RUN = 6;

    @Test
    @DisplayName("MI-12：16 型文案之间不得有 >= 6 字的连续重合（跨类型区分度）")
    void typesHaveNoCrossTypeDuplication() throws IOException {
        ClassPathResource resource = new ClassPathResource("content/types.yml");
        assertTrue(resource.exists(), "真实类型文案 content/types.yml 必须存在");
        TypesFile file;
        try (InputStream in = resource.getInputStream()) {
            file = YAML.readValue(in, TypesFile.class);
        }

        List<Map<String, String>> unitsPerType = new ArrayList<>();
        List<String> codes = new ArrayList<>();
        for (TypeProfile profile : file.types()) {
            Map<String, String> units = new LinkedHashMap<>();
            units.put("tagline", profile.tagline());
            profile.dimensions().forEach((dimension, body) -> units.put("dimensions." + dimension, body));
            addUnits(units, "strengths", profile.strengths());
            addUnits(units, "blindSpots", profile.blindSpots());
            addUnits(units, "resonance", profile.resonance());
            addUnits(units, "growth", profile.growth());
            unitsPerType.add(units);
            codes.add(profile.code());
        }

        List<String> findings = new ArrayList<>();
        for (int i = 0; i < unitsPerType.size(); i++) {
            for (int j = i + 1; j < unitsPerType.size(); j++) {
                for (Map.Entry<String, String> left : unitsPerType.get(i).entrySet()) {
                    for (Map.Entry<String, String> right : unitsPerType.get(j).entrySet()) {
                        String shared = longestCommonSubstring(left.getValue(), right.getValue());
                        if (shared.length() >= CROSS_TYPE_MAX_SHARED_RUN) {
                            findings.add(codes.get(i) + "." + left.getKey() + " <-> "
                                    + codes.get(j) + "." + right.getKey() + " 共 " + shared.length()
                                    + " 字：「" + shared + "」");
                        }
                    }
                }
            }
        }

        assertTrue(findings.isEmpty(),
                "跨类型文案出现 " + findings.size() + " 处 >= " + CROSS_TYPE_MAX_SHARED_RUN
                        + " 字的连续重合，请改写其中一处（同一件事换个说法，别只换连接词）：\n  - "
                        + String.join("\n  - ", findings));
    }

    private static void addUnits(Map<String, String> units, String field, List<String> values) {
        if (values == null) {
            return;
        }
        for (int index = 0; index < values.size(); index++) {
            units.put(field + "[" + index + "]", values.get(index));
        }
    }

    /** 最长公共子串（两行 DP，够用：16 型 × 约 14 个文本单元）。 */
    private static String longestCommonSubstring(String a, String b) {
        int[] previous = new int[b.length() + 1];
        int bestLength = 0;
        int bestEnd = 0;
        for (int i = 1; i <= a.length(); i++) {
            int diagonal = 0;
            for (int j = 1; j <= b.length(); j++) {
                int saved = previous[j];
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    previous[j] = diagonal + 1;
                    if (previous[j] > bestLength) {
                        bestLength = previous[j];
                        bestEnd = i;
                    }
                } else {
                    previous[j] = 0;
                }
                diagonal = saved;
            }
        }
        return a.substring(bestEnd - bestLength, bestEnd);
    }
}

