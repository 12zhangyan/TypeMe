package com.typeme.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper;
import com.typeme.model.AssessmentInstrument;
import com.typeme.model.AssessmentPackage;
import com.typeme.model.BalancedCopy;
import com.typeme.model.DimensionCopy;
import com.typeme.model.InsufficientCopy;
import com.typeme.model.InterpretationPolicy;
import com.typeme.model.ItemHelp;
import com.typeme.model.MethodContent;
import com.typeme.model.PoleCopy;
import com.typeme.model.Question;
import com.typeme.model.Questionnaire;
import com.typeme.model.ReportCopy;
import com.typeme.model.TypeProfile;
import com.typeme.model.TypesFile;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * 内容服务：启动期从 classpath 加载 YAML 内容，并做**硬断言**校验。
 *
 * <p>校验失败的处置是**抛异常导致启动失败**，这是刻意的：题库里手改错一个方向符号，
 * 结果是「看起来能跑、结果全错」，靠肉眼几乎发现不了（ADR-3、任务拆解 §三 陷阱 1）。
 *
 * <p>后端只提供数据与校验，不实现计分（ADR-1）。
 */
@Service
public class ContentService {

    private static final Logger log = LoggerFactory.getLogger(ContentService.class);

    /** 本次唯一交付的版本。 */
    public static final String QUICK_VERSION = "quick";

    private static final String QUESTIONNAIRE_LOCATION = "classpath*:content/questionnaire-*.yml";
    private static final String METHOD_LOCATION = "classpath:content/method.yml";
    private static final String TYPES_LOCATION = "classpath:content/types.yml";

    /**
     * v2 内容包目录。**刻意不在** {@code content/questionnaire-*.yml} 的扫描范围内：
     * 否则 v1 的 {@code /api/v1/questionnaires/{version}} 会多出一个「版本」，破坏 v1 语义
     * （字段规格 §1、开发方案 §5.4）。
     */
    public static final String ASSESSMENT_PACKAGE_LOCATION =
            "classpath*:assessment-packages/*.yml";

    /**
     * 本轮注册为可用的内容包 ID（字段规格 §1）。
     *
     * <p>白名单是**唯一**的解析入口：请求里的 {@code packageId} 只用来查已加载的 map，
     * 绝不拼进 {@link ResourceLoader} 路径（字段规格 §9）——那会同时变成路径穿越漏洞。
     */
    public static final List<String> ASSESSMENT_PACKAGE_IDS = List.of(
            // 顺序即「默认包」：第一项是站点默认量表（大五 IPIP-50，公版可商用）。
            // OEJTS 32 题保留为可选旧版本，不再是默认入口。
            "ipip50-zh1",
            "oejts32-zh1-report2",
            "oejts32-zh2-preview-r1");

    /** 本轮唯一允许的 {@code instrument.id}。 */
    public static final String OFFICIAL_INSTRUMENT_ID = "oejts32";

    /** 本轮唯一允许的 OEJTS 原始量表版本（本轮不改量表）。 */
    public static final String OFFICIAL_INSTRUMENT_REVISION = "1.2";

    /** 本轮唯一允许的计分版本。 */
    public static final String OFFICIAL_SCORING_VERSION = "oejts-1.2";

    /** 内容包只承载简体中文内容。 */
    public static final String OFFICIAL_LOCALE = "zh-CN";

    /** 内容包结构版本，固定 2。 */
    public static final int ASSESSMENT_PACKAGE_SCHEMA_VERSION = 2;

    /** 每维最少可计分题数（必须来自包本身，前端不得硬编码）。 */
    public static final int OFFICIAL_MIN_RATINGS_PER_DIMENSION = 8;

    /** 暂定的保守展示门槛（版本化在 {@code interpretation.version}，不是统计置信阈值）。 */
    public static final int OFFICIAL_TYPE_MIN_DISTANCE = 5;

    /** 明确标记档的距离阈值。 */
    public static final int OFFICIAL_MARKED_DISTANCE = 9;

    /**
     * 仪器档案：**每份量表的官方事实**，用于独立核对内容包。
     *
     * <p>与前端 {@code INSTRUMENT_PROFILES}、Node 生成器里的同名档案必须一致。
     * 没有档案的 {@code instrument.id} 一律拒绝装载 —— 不允许"无法被独立核对的量表"上线，
     * 否则符号被改反、题目被对调都会静默通过。
     *
     * @param id                        仪器标识
     * @param questionnaireVersion      官方核心结构里的 {@code questionnaire.version}
     * @param format                    {@code bipolar} 或 {@code agreement}
     * @param hasTypeCode               是否产出类型码（大五为 false）
     * @param questionCount             官方题数
     * @param dimensionOrder            维度展示顺序
     * @param perDimension              每维题数（必须等于 {@code interpretation.minRatingsPerDimension}）
     * @param midpoint                  量表中点
     * @param constants                 各维常量
     * @param signs                     题号 → 符号（独立抄录，用于逐题核对）
     * @param typeMinDistance           该量表上的"略偏/待观察"门槛
     * @param markedDistance            该量表上的"明确"门槛
     * @param attributionMustMatchMethod 是否要求 attribution 与 {@code method.yml} 逐字相等
     */
    public record InstrumentProfile(
            String id,
            String questionnaireVersion,
            String revision,
            String scoringVersion,
            String format,
            boolean hasTypeCode,
            int questionCount,
            List<String> dimensionOrder,
            int perDimension,
            int midpoint,
            Map<String, Integer> constants,
            Map<String, Map<Integer, Integer>> signs,
            int typeMinDistance,
            int markedDistance,
            boolean attributionMustMatchMethod) {
    }

    /** 本地仪器档案注册表见下方（在所有官方常量声明之后，避免非法的前向引用）。 */

    /** 证据状态，按弱到强排序：包的 {@code contentStatus} 不得高于包内内容的最低状态。 */
    public static final List<String> CONTENT_STATUSES = List.of("draft", "reviewed", "field_checked");

    /** 允许出现在逐题帮助里的风险码：语言可理解性 / 两端不对称 / 情境与社会评价影响。 */
    public static final Set<String> RISK_CODES = Set.of("L", "B", "C");

    /**
     * OEJTS 1.2 的官方署名（CC BY-NC-SA 的署名义务），必须与
     * {@code content/method.yml} 的 {@code attribution} **逐字相等**。
     *
     * <p>值抄自 {@code method.yml}（由 {@link #validateAssessmentPackage} 与启动期
     * {@link #assertAttributionMatchesMethodFile()} 双重钉住），
     * 因此内容包不可能悄悄换一份署名。
     */
    public static final MethodContent.Attribution OFFICIAL_ATTRIBUTION = new MethodContent.Attribution(
            "Open Extended Jungian Type Scales (OEJTS) 1.2",
            "Eric Jorgenson",
            "https://openpsychometrics.org/tests/OEJTS/",
            "CC BY-NC-SA 4.0",
            "https://creativecommons.org/licenses/by-nc-sa/4.0/");

    /** 用户可见帮助里**绝对不允许**出现的第一条编辑批注原文（审校表用语）。 */
    public static final String PROHIBITED_HELP_SUBSTRING = "该解释的场景范围须与最终题面一致";

    /** 用户可见帮助里**绝对不允许**出现的第二条编辑批注用语。 */
    public static final String PROHIBITED_HELP_PHRASE = "若采用";

    /** 官方 PDF 第 3 页：判定阈值为 24，且判定用「严格大于」。 */
    public static final int OFFICIAL_MIDPOINT = 24;

    public static final int QUICK_QUESTION_COUNT = 32;
    public static final int QUESTIONS_PER_DIMENSION = 8;

    /**
     * 官方四条公式的常数项。与 {@code questionnaire-quick.yml} 的 {@code scoring.constants} 必须逐字相等。
     */
    public static final Map<String, Integer> OFFICIAL_CONSTANTS =
            Map.of("EI", 30, "SN", 12, "TF", 30, "JP", 18);

    /**
     * 官方 PDF 第 3 页四条计分公式展开后的**唯一权威表**：维度 → (题号 → 符号)。
     *
     * <pre>
     * IE = 30 - Q3 - Q7 - Q11 + Q15 - Q19 + Q23 + Q27 - Q31
     * SN = 12 + Q4 + Q8 + Q12 + Q16 + Q20 - Q24 - Q28 + Q32
     * FT = 30 - Q2 + Q6 + Q10 - Q14 - Q18 + Q22 - Q26 - Q30
     * JP = 18 + Q1 + Q5 - Q9 + Q13 - Q17 + Q21 - Q25 + Q29
     * </pre>
     *
     * 任何一题的维度归属或符号与之不符，都视为内容损坏。
     */
    public static final Map<String, Map<Integer, Integer>> OFFICIAL_SIGNS = Map.of(
            "EI", Map.of(3, -1, 7, -1, 11, -1, 15, 1, 19, -1, 23, 1, 27, 1, 31, -1),
            "SN", Map.of(4, 1, 8, 1, 12, 1, 16, 1, 20, 1, 24, -1, 28, -1, 32, 1),
            "TF", Map.of(2, -1, 6, 1, 10, 1, 14, -1, 18, -1, 22, 1, 26, -1, 30, -1),
            "JP", Map.of(1, 1, 5, 1, 9, -1, 13, 1, 17, -1, 21, 1, 25, -1, 29, 1)
    );

    /** 本地仪器档案注册表（新增量表时必须在这里登记，否则装载被拒）。 */
    public static final Map<String, InstrumentProfile> INSTRUMENT_PROFILES = Map.of(
            OFFICIAL_INSTRUMENT_ID,
            new InstrumentProfile(
                    OFFICIAL_INSTRUMENT_ID,
                    QUICK_VERSION,
                    OFFICIAL_INSTRUMENT_REVISION,
                    OFFICIAL_SCORING_VERSION,
                    "bipolar",
                    true,
                    QUICK_QUESTION_COUNT,
                    List.of("EI", "SN", "TF", "JP"),
                    QUESTIONS_PER_DIMENSION,
                    OFFICIAL_MIDPOINT,
                    OFFICIAL_CONSTANTS,
                    OFFICIAL_SIGNS,
                    OFFICIAL_TYPE_MIN_DISTANCE,
                    OFFICIAL_MARKED_DISTANCE,
                    true),
            "ipip50",
            new InstrumentProfile(
                    "ipip50",
                    "ipip50",
                    "goldberg-bfm-50",
                    "ipip-bfm50-1.0",
                    "agreement",
                    false,
                    50,
                    List.of("E", "A", "C", "ES", "O"),
                    10,
                    30,
                    Map.of("E", 30, "A", 24, "C", 24, "ES", 48, "O", 18),
                    // Goldberg 的 Big-Five Factor Markers 官方计分键逐题抄录：
                    // E 5正5反 / A 6正4反 / C 6正4反 / ES 2正8反 / O 7正3反
                    Map.of(
                            "E", Map.of(1, 1, 6, -1, 11, 1, 16, -1, 21, 1, 26, -1, 31, 1, 36, -1, 41, 1, 46, -1),
                            "A", Map.of(2, -1, 7, 1, 12, -1, 17, 1, 22, -1, 27, 1, 32, -1, 37, 1, 42, 1, 47, 1),
                            "C", Map.of(3, 1, 8, -1, 13, 1, 18, -1, 23, 1, 28, -1, 33, 1, 38, -1, 43, 1, 48, 1),
                            "ES", Map.of(4, -1, 9, 1, 14, -1, 19, 1, 24, -1, 29, -1, 34, -1, 39, -1, 44, -1, 49, -1),
                            "O", Map.of(5, 1, 10, -1, 15, 1, 20, -1, 25, 1, 30, -1, 35, 1, 40, 1, 45, 1, 50, 1)),
                    // 门槛按"相同比例的最大偏移"换算：OEJTS ±16 用 5/9（31%/56%），
                    // IPIP-50 ±20 对应 6/11。仍是展示策略，不是心理测量阈值。
                    6,
                    11,
                    false));

    /** 16 个类型码必须齐全（{@code types.yml} 由 T-C 撰写，后端只校验不生成）。 */
    public static final Set<String> REQUIRED_TYPE_CODES = Set.of(
            "INTJ", "INTP", "ENTJ", "ENTP", "INFJ", "INFP", "ENFJ", "ENFP",
            "ISTJ", "ISFJ", "ESTJ", "ESFJ", "ISTP", "ISFP", "ESTP", "ESFP");

    /** 方法说明页必须包含的小节（顺序不限）。 */
    public static final List<String> REQUIRED_METHOD_SECTIONS = List.of(
            "题库来源与许可", "计分方法", "为什么 S–N 维度测不准", "免责声明", "致谢与参考文献");

    /** 类型码在四种维度上的键必须齐全。 */
    private static final Set<String> DIMENSIONS = Set.of("EI", "SN", "TF", "JP");

    /**
     * 预计用时的合理上限（分钟）。
     *
     * <p>快速版是 32 题、官方实测约 5 分钟。落地页会把 {@code estimatedMinutes} 原样显示成
     * 「约 N 分钟」，一个手滑写成的 999 看起来只是文案错，但那是没有任何机械检查能拦住的
     * 用户可见错误，所以这里给一个宽松但有意义的上界。
     */
    public static final int MAX_ESTIMATED_MINUTES = 60;

    /**
     * 反序列化**严格模式**。
     *
     * <ul>
     *   <li>{@code FAIL_ON_UNKNOWN_PROPERTIES}：未知字段直接失败（配合各 model 去掉
     *       {@code @JsonIgnoreProperties}）。内容文件是唯一真相，字段名写错必须当场发现，
     *       否则会静默丢字段——例如把 {@code tagline} 拼成 {@code tagLines}，页面只是少一段文案。</li>
     *   <li>{@code CoercionInputShape.String → Integer} 失败：{@code questionCount: "32"}
     *       这类字符串强转不再被接受。</li>
     *   <li>{@code ACCEPT_FLOAT_AS_INT} 关闭（默认即关）：{@code direction: 1.9} 不再被截断成 1，
     *       否则「符号错了」和「符号是 1.9」在校验里长得一模一样。</li>
     * </ul>
     */
    private static final ObjectMapper YAML = strictYamlMapper();

    private static ObjectMapper strictYamlMapper() {
        YAMLMapper mapper = new YAMLMapper();
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, true);
        mapper.configure(DeserializationFeature.ACCEPT_FLOAT_AS_INT, false);
        mapper.configure(DeserializationFeature.ACCEPT_EMPTY_STRING_AS_NULL_OBJECT, false);
        for (LogicalType logicalType : List.of(LogicalType.Integer, LogicalType.Float)) {
            mapper.coercionConfigFor(logicalType)
                    .setCoercion(CoercionInputShape.String, CoercionAction.Fail);
        }
        return mapper;
    }

    private static final Validator VALIDATOR =
            Validation.buildDefaultValidatorFactory().getValidator();

    private final ResourcePatternResolver resourceResolver;
    private final Map<String, Questionnaire> questionnaires;
    private final MethodContent method;
    private final Map<String, TypeProfile> types;
    private final Map<String, AssessmentPackage> assessmentPackages;

    public ContentService(ResourceLoader resourceLoader) {
        this.resourceResolver = new PathMatchingResourcePatternResolver(resourceLoader);
        this.questionnaires = loadQuestionnaires();
        this.method = loadMethod();
        this.types = loadTypes();
        this.assessmentPackages = loadAssessmentPackages();

        questionnaires.values().forEach(questionnaire -> log.info(
                "题库加载并校验通过: version={} questions={} sha256={}",
                questionnaire.version(),
                questionnaire.questions().size(),
                questionSetHash(questionnaire)));
        log.info("方法说明页加载并校验通过: sections={} license={}",
                method.sections().size(), method.attribution().license());

        // 内容包里的 attribution 是 CC BY-NC-SA 的署名义务：包加载后立刻与真实 method.yml
        // 交叉核对（OFFICIAL_ATTRIBUTION 必须与它逐字相等），不一致就启动失败。
        assertAttributionMatchesMethodFile();

        log.info("类型文案加载并校验通过: types={}", types.size());
    }

    // ------------------------------------------------------------------ 对外只读访问

    public List<String> questionnaireVersions() {
        return List.copyOf(questionnaires.keySet());
    }

    public Optional<Questionnaire> findQuestionnaire(String version) {
        return version == null ? Optional.empty() : Optional.ofNullable(questionnaires.get(version));
    }

    public MethodContent method() {
        return method;
    }

    public Optional<TypeProfile> findType(String code) {
        if (code == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(types.get(code.trim().toUpperCase(Locale.ROOT)));
    }

    /**
     * 已注册（且已校验通过）的 v2 内容包 ID。目录为空时返回空列表——这不是错误，
     * 见 {@link #loadAssessmentPackages()}。
     */
    public List<String> assessmentPackageIds() {
        return List.copyOf(assessmentPackages.keySet());
    }

    /**
     * 按 {@code packageId} 查内容包。
     *
     * <p><b>白名单解析</b>：只在已加载的 map 里查，不把请求参数拼进任何资源路径；
     * 未注册的 ID 一律 {@link Optional#empty()}（控制器转成 404）。
     */
    public Optional<AssessmentPackage> findAssessmentPackage(String packageId) {
        if (packageId == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(assessmentPackages.get(packageId));
    }

    // ------------------------------------------------------------------ 加载

    private Map<String, Questionnaire> loadQuestionnaires() {
        Resource[] resources;
        try {
            resources = resourceResolver.getResources(QUESTIONNAIRE_LOCATION);
        } catch (IOException e) {
            throw new ContentValidationException("无法扫描题库资源 " + QUESTIONNAIRE_LOCATION, e);
        }
        if (resources.length == 0) {
            throw new ContentValidationException(
                    "classpath 下没有找到任何 " + QUESTIONNAIRE_LOCATION + "，题库缺失");
        }
        // 稳定排序，让 questionnaireVersions 的顺序可预期
        Arrays.sort(resources, Comparator.comparing(r -> Objects.toString(r.getFilename(), "")));

        Map<String, Questionnaire> loaded = new LinkedHashMap<>();
        for (Resource resource : resources) {
            String origin = Objects.toString(resource.getFilename(), resource.getDescription());
            Questionnaire questionnaire = read(resource, Questionnaire.class);
            validateQuestionnaire(questionnaire, origin);
            Questionnaire previous = loaded.put(questionnaire.version(), questionnaire);
            if (previous != null) {
                throw new ContentValidationException("题库 version 重复: " + questionnaire.version());
            }
        }
        if (!loaded.containsKey(QUICK_VERSION)) {
            throw new ContentValidationException(
                    "缺少快速版题库 content/questionnaire-" + QUICK_VERSION + ".yml");
        }
        return java.util.Collections.unmodifiableMap(loaded);
    }

    private MethodContent loadMethod() {
        Resource resource = resourceResolver.getResource(METHOD_LOCATION);
        if (!resource.exists()) {
            throw new ContentValidationException("缺少方法说明内容 " + METHOD_LOCATION);
        }
        MethodContent content = read(resource, MethodContent.class);
        validateMethodContent(content, resource.getFilename());
        return content;
    }

    private Map<String, TypeProfile> loadTypes() {
        Resource resource = resourceResolver.getResource(TYPES_LOCATION);
        if (!resource.exists()) {
            // MI-4：types.yml 是**硬依赖**，不是可选项。
            // 它缺失时 /types/* 会全部 404，而前端只能靠内置副本兜底 —— 但内置副本现在也由
            // 这份 YAML 生成（scripts/gen-fallback-content.mjs），缺失意味着内容链路整体断了。
            // 早期「只 WARN、health 仍 UP」的处理会让这种状态在监控上完全不可见。
            throw new ContentValidationException(
                    "缺少类型文案内容 " + TYPES_LOCATION + "（16 型文案是交付内容的一部分，不是可选项）");
        }
        TypesFile file = read(resource, TypesFile.class);
        validateTypes(file, resource.getFilename());
        Map<String, TypeProfile> loaded = new LinkedHashMap<>();
        for (TypeProfile profile : file.types()) {
            loaded.put(profile.code().trim().toUpperCase(Locale.ROOT), profile);
        }
        return java.util.Collections.unmodifiableMap(loaded);
    }

    /**
     * 严格反序列化。未知字段、字符串强转数字、浮点截断都在这里变成启动失败（MI-3）。
     *
     * <p>包私有是为了让测试能复现「坏 YAML 解析时的报错」，不必绕道起整个上下文。
     */
    static <T> T read(Resource resource, Class<T> type) {
        try (InputStream in = resource.getInputStream()) {
            return YAML.readValue(in, type);
        } catch (IOException e) {
            throw new ContentValidationException(
                    "内容解析失败: " + resource.getDescription() + " —— " + e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------------ 加载：v2 内容包

    /**
     * 加载并校验 v2 内容包（字段规格 §1、§9；开发方案 §5.4）。
     *
     * <p><b>目录为空不阻止启动</b>：一个包文件都没有时只打一条 {@code log.warn}，
     * v1（{@code /api/v1/**}）照常服务，{@code /api/v2/...} 全部 404。
     * 这是刻意的——内容包 YAML 由另一个工作流撰写，在它落盘之前，后端不能因为
     * 「v2 目录还没东西」而整个起不来。
     *
     * <p><b>只要有包文件，解析或校验失败就抛 {@link ContentValidationException}</b>：
     * 不允许「只丢一段帮助」继续启动（字段规格 §9）。未注册的包 ID 也在这里被拦下——
     * 否则文件躺在磁盘上、接口却永远 404，这种静默状态没人能发现。
     */
    private Map<String, AssessmentPackage> loadAssessmentPackages() {
        Resource[] resources;
        try {
            resources = resourceResolver.getResources(ASSESSMENT_PACKAGE_LOCATION);
        } catch (IOException e) {
            throw new ContentValidationException("无法扫描内容包资源 " + ASSESSMENT_PACKAGE_LOCATION, e);
        }

        // 稳定排序，让 assessmentPackageIds 的顺序与日志可预期
        Arrays.sort(resources, Comparator.comparing(r -> Objects.toString(r.getFilename(), "")));

        if (resources.length == 0) {
            log.warn("未发现任何 v2 内容包（{}）：/api/v2/assessment-packages/** 将全部 404，"
                            + "v1 接口不受影响，启动继续",
                    ASSESSMENT_PACKAGE_LOCATION);
            return Map.of();
        }

        Map<String, AssessmentPackage> loaded = new LinkedHashMap<>();
        for (Resource resource : resources) {
            String filename = Objects.toString(resource.getFilename(), "");
            String origin = packageOriginOf(filename, resource.getDescription());

            AssessmentPackage pkg = read(resource, AssessmentPackage.class);
            // origin 断言放在最前：文件与包 ID 不一致时，后面所有错误信息都会指错文件
            validateAssessmentPackage(pkg, origin);
            require(ASSESSMENT_PACKAGE_IDS.contains(pkg.packageId()),
                    "[" + origin + "] 未注册的内容包 ID: " + pkg.packageId()
                            + "，本轮白名单为 " + ASSESSMENT_PACKAGE_IDS
                            + "（新增包必须先登记白名单，否则磁盘上的文件永远不会被下发）");

            AssessmentPackage previous = loaded.put(pkg.packageId(), pkg);
            require(previous == null, "[" + origin + "] 内容包 ID 重复: " + pkg.packageId());

            log.info("内容包加载并校验通过: packageId={} questions={} status={}",
                    pkg.packageId(), pkg.questionnaire().questions().size(), pkg.contentStatus());
        }
        return java.util.Collections.unmodifiableMap(loaded);
    }

    /**
     * 从文件名取出 {@code origin}（去掉 {@code .yml}），供「文件名必须等于 packageId」的断言使用。
     *
     * <p>取不到文件名时退回 {@code packageId 无法比对} 这个哨兵值——它与任何合法 ID 都不相等，
     * 于是那条断言必然失败，而不是悄悄跳过。
     */
    private static String packageOriginOf(String filename, String description) {
        String name = isNotBlank(filename) ? filename : description;
        return name != null && name.endsWith(".yml")
                ? name.substring(0, name.length() - ".yml".length())
                : "（取自文件名）" + name;
    }

    /**
     * 内容包硬断言（字段规格 §2–§7、§9）。校验失败抛 {@link ContentValidationException} ⇒ 启动失败。
     *
     * @param origin 文件名去掉 {@code .yml}，必须等于 {@code packageId}
     */
    public static void validateAssessmentPackage(AssessmentPackage pkg, String origin) {
        String where = "[" + origin + "] ";
        require(pkg != null, where + "内容包为空");

        List<String> violations = fieldViolations(pkg);
        require(violations.isEmpty(), where + "字段级校验失败: " + violations);

        require(pkg.schemaVersion() == ASSESSMENT_PACKAGE_SCHEMA_VERSION,
                where + "schemaVersion 必须是 " + ASSESSMENT_PACKAGE_SCHEMA_VERSION
                        + "，实际 " + pkg.schemaVersion());
        require(pkg.packageId().equals(origin),
                where + "文件名必须等于 packageId（一个文件一个不可变包），实际 packageId="
                        + pkg.packageId());
        require(OFFICIAL_LOCALE.equals(pkg.locale()),
                where + "locale 必须是 " + OFFICIAL_LOCALE + "，实际 " + pkg.locale());

        // localeRevision / helpRevision / copyRevision 的「非空」已由字段级校验覆盖；
        // 这里只把三者的存在性写清楚，避免读代码的人以为漏了。
        require(isNotBlank(pkg.localeRevision()) && isNotBlank(pkg.helpRevision())
                        && isNotBlank(pkg.copyRevision()),
                where + "localeRevision / helpRevision / copyRevision 都不能为空");

        assertContentStatusNotHigherThanEvidence(pkg, where);

        AssessmentInstrument instrument = pkg.instrument();
        InstrumentProfile profile = assertInstrument(instrument, where);

        Integer estimatedMinutes = pkg.estimatedMinutes();
        require(estimatedMinutes != null
                        && estimatedMinutes >= 1
                        && estimatedMinutes <= MAX_ESTIMATED_MINUTES,
                where + "estimatedMinutes 必须在 1–" + MAX_ESTIMATED_MINUTES + " 分钟之间，实际 "
                        + estimatedMinutes + "（界面会原样显示成「约 N 分钟」）");

        Questionnaire questionnaire = pkg.questionnaire();
        // 内嵌题库必须与仪器档案同形：题数、维度、常量、中点、逐题符号都在档案里核对。
        // version 也要钉住：它是前端 v1 会话与旧记录兼容的判定键，随包漂移会让旧会话
        // 被静默当成另一份量表解读（符号核对本身已由 profile 保证，与此无关）。
        require(profile.questionnaireVersion().equals(questionnaire.version()),
                where + "内嵌 questionnaire.version 必须是 \"" + profile.questionnaireVersion()
                        + "\"，实际 " + questionnaire.version());
        validateQuestionnaire(questionnaire, origin, profile);
        require(questionnaire.questions().size() == profile.questionCount(),
                where + "内容包内嵌题库必须恰好 " + profile.questionCount() + " 题，实际 "
                        + questionnaire.questions().size());

        List<String> dimensionKeys = dimensionKeysOf(questionnaire);
        List<String> dimensionOrder = pkg.dimensionOrder() == null
                ? profile.dimensionOrder()
                : pkg.dimensionOrder();
        require(new LinkedHashSet<>(dimensionOrder).equals(new LinkedHashSet<>(dimensionKeys))
                        && dimensionOrder.size() == dimensionKeys.size(),
                where + "dimensionOrder（" + dimensionOrder + "）必须与题库里出现的维度集合一致（"
                        + dimensionKeys + "）");

        assertInterpretation(pkg.interpretation(), profile, where);
        assertItemHelp(pkg.itemHelp(), dimensionKeys, questionnaire, where);
        assertDimensionCopy(pkg.dimensionCopy(), dimensionKeys, profile, where);
        assertReportCopy(pkg.reportCopy(), where);

        List<String> nextSteps = pkg.nextSteps();
        require(nextSteps != null && nextSteps.size() >= 3,
                where + "nextSteps 至少 3 条通用观察建议，实际 "
                        + (nextSteps == null ? "null" : nextSteps.size()));
        require(nextSteps.stream().allMatch(ContentService::isNotBlank),
                where + "nextSteps 存在空条目");

        assertAttribution(pkg.attribution(), profile, where);
    }

    /**
     * {@code contentStatus} 不得高于包内实际证据的最低状态（字段规格 §2、开发方案 §5.4）。
     *
     * <p>本轮两个包都含 draft 帮助，因此都必须是 {@code draft}；
     * 「为了让校验通过而把状态改成 reviewed」正是这条断言要拦的事。
     */
    private static void assertContentStatusNotHigherThanEvidence(AssessmentPackage pkg, String where) {
        String declared = pkg.contentStatus();
        require(CONTENT_STATUSES.contains(declared),
                where + "contentStatus 必须是 " + CONTENT_STATUSES + " 之一，实际 " + declared);

        // 证据状态按 CONTENT_STATUSES 从弱到强分档：包声明的状态不得高于包内最低证据状态。
        // 例：任何一条帮助是 draft ⇒ 包必须是 draft；任何一条是 reviewed ⇒ 包不得是 field_checked。
        String lowest = lowestEvidenceStatus(pkg.itemHelp());
        require(CONTENT_STATUSES.indexOf(declared) <= CONTENT_STATUSES.indexOf(lowest),
                where + "contentStatus=" + declared + " 高于包内最低证据状态 " + lowest
                        + "：逐题帮助里仍有 " + lowest + " 内容，整包就不能高于该状态"
                        + "（不得为了解除校验把状态改成 reviewed）");
    }

    /** 包内逐题帮助的最低证据状态；没有任何一项时退到最强状态（不额外限制）。 */
    private static String lowestEvidenceStatus(Map<String, ItemHelp> itemHelp) {
        if (itemHelp == null) {
            return CONTENT_STATUSES.get(CONTENT_STATUSES.size() - 1);
        }
        int lowestRank = CONTENT_STATUSES.size() - 1;
        for (ItemHelp help : itemHelp.values()) {
            if (help == null || !CONTENT_STATUSES.contains(help.reviewStatus())) {
                continue;
            }
            lowestRank = Math.min(lowestRank, CONTENT_STATUSES.indexOf(help.reviewStatus()));
        }
        return CONTENT_STATUSES.get(lowestRank);
    }

    /**
     * 仪器身份硬断言：id 必须有本地档案；声明的 format / hasTypeCode 必须与档案一致
     * （未声明时由档案补齐，这样已锁定的 OEJTS 包不需要改一个字节）。
     *
     * @return 命中的仪器档案
     */
    private static InstrumentProfile assertInstrument(AssessmentInstrument instrument, String where) {
        require(instrument != null, where + "instrument 不能为空");
        InstrumentProfile profile = INSTRUMENT_PROFILES.get(instrument.id());
        require(profile != null,
                where + "instrument.id=" + instrument.id() + " 没有本地仪器档案，"
                        + "符号/常量/维度无法被独立核对，拒绝装载（可用的档案：" 
                        + new TreeSet<>(INSTRUMENT_PROFILES.keySet()) + "）");

        String declaredFormat = instrument.format() == null ? profile.format() : instrument.format();
        require(profile.format().equals(declaredFormat),
                where + "instrument.format 与档案不一致：" + profile.id() + " 应为 " + profile.format()
                        + "，实际 " + declaredFormat);
        require(profile.revision().equals(instrument.revision()),
                where + "instrument.revision 必须是 " + profile.revision()
                        + "（该仪器的原始量表版本），实际 " + instrument.revision());
        require(profile.scoringVersion().equals(instrument.scoringVersion()),
                where + "instrument.scoringVersion 必须是 " + profile.scoringVersion()
                        + "，实际 " + instrument.scoringVersion());
        if (instrument.hasTypeCode() != null) {
            require(instrument.hasTypeCode() == profile.hasTypeCode(),
                    where + "instrument.hasTypeCode 与档案不一致：" + profile.id() + " 应为 "
                            + profile.hasTypeCode() + "，实际 " + instrument.hasTypeCode());
        }
        return profile;
    }

    private static void assertInterpretation(
            InterpretationPolicy policy, InstrumentProfile profile, String where) {
        require(policy != null, where + "interpretation 不能为空");
        require(isNotBlank(policy.version()), where + "interpretation.version 不能为空");
        require(policy.minRatingsPerDimension() == profile.perDimension(),
                where + "interpretation.minRatingsPerDimension 必须是 " + profile.perDimension()
                        + "（" + profile.id() + " 每维题数），实际 " + policy.minRatingsPerDimension());
        require(policy.typeMinDistance() == profile.typeMinDistance(),
                where + "interpretation.typeMinDistance 必须是 " + profile.typeMinDistance()
                        + "（本产品暂定的保守展示策略，按该仪器量程换算），实际 " + policy.typeMinDistance());
        require(policy.markedDistance() == profile.markedDistance(),
                where + "interpretation.markedDistance 必须是 " + profile.markedDistance()
                        + "，实际 " + policy.markedDistance());
    }

    /** 题库里出现的维度（按题目首次出现顺序）。 */
    private static List<String> dimensionKeysOf(Questionnaire questionnaire) {
        List<String> keys = new ArrayList<>();
        for (Question question : questionnaire.questions()) {
            if (!keys.contains(question.dimension())) {
                keys.add(question.dimension());
            }
        }
        return keys;
    }

    /**
     * 逐题帮助硬断言（字段规格 §4）：键必须恰好覆盖题库的全部题号，
     * 解释非空、状态合法、风险码只含 L/B/C，且不得残留开发者的编辑批注。
     */
    private static void assertItemHelp(
            Map<String, ItemHelp> itemHelp,
            List<String> dimensionKeys,
            Questionnaire questionnaire,
            String where) {
        require(itemHelp != null, where + "itemHelp 不能为空");

        Set<String> expected = new LinkedHashSet<>();
        for (Question question : questionnaire.questions()) {
            expected.add(String.valueOf(question.id()));
        }
        Set<String> actual = itemHelp.keySet();
        Set<String> missing = new TreeSet<>(expected);
        missing.removeAll(actual);
        Set<String> unknown = new TreeSet<>(actual);
        unknown.removeAll(expected);
        require(missing.isEmpty(), where + "itemHelp 缺少题号的帮助: " + missing);
        require(unknown.isEmpty(),
                where + "itemHelp 出现了非法键（必须严格为题库里出现过的题号字符串）: " + unknown);

        for (String key : new TreeSet<>(expected)) {
            ItemHelp help = itemHelp.get(key);
            require(help != null, where + "itemHelp[\"" + key + "\"] 为空");

            String explanation = help.explanation();
            require(isNotBlank(explanation),
                    where + "Q" + key + " 的 itemHelp.explanation 不能为空");
            require(CONTENT_STATUSES.contains(help.reviewStatus()),
                    where + "Q" + key + " 的 itemHelp.reviewStatus 必须是 " + CONTENT_STATUSES
                            + " 之一，实际 " + help.reviewStatus());
            require(help.riskCodes() != null, where + "Q" + key + " 的 itemHelp.riskCodes 不能为空（没有风险码时写 []）");
            Set<String> illegalRiskCodes = new TreeSet<>(help.riskCodes());
            illegalRiskCodes.removeAll(RISK_CODES);
            require(illegalRiskCodes.isEmpty(),
                    where + "Q" + key + " 的 itemHelp.riskCodes 含非法值 " + illegalRiskCodes
                            + "，只允许 " + new TreeSet<>(RISK_CODES) + "（L/B/C）");

            require(!explanation.contains(PROHIBITED_HELP_SUBSTRING),
                    where + "Q" + key + " 的帮助文本含面向开发者的内部批注「"
                            + PROHIBITED_HELP_SUBSTRING + "」，必须删除或改写成用户可见的说法");
            require(!explanation.contains(PROHIBITED_HELP_PHRASE),
                    where + "Q" + key + " 的帮助文本含面向开发者的内部批注「"
                            + PROHIBITED_HELP_PHRASE + "」，必须删除或改写成用户可见的说法");
        }
        require(!dimensionKeys.isEmpty(), where + "题库没有任何维度");
    }

    /** 维度解释硬断言（字段规格 §5）：维度键与题库一致，每段文案都非空。 */
    private static void assertDimensionCopy(
            Map<String, DimensionCopy> dimensionCopy,
            List<String> dimensionKeys,
            InstrumentProfile profile,
            String where) {
        require(dimensionCopy != null, where + "dimensionCopy 不能为空");
        require(dimensionCopy.keySet().equals(new LinkedHashSet<>(dimensionKeys)),
                where + "dimensionCopy 的键必须恰好是 " + new TreeSet<>(dimensionKeys)
                        + "，实际 " + new TreeSet<>(dimensionCopy.keySet()));

        for (String dimension : dimensionKeys) {
            DimensionCopy copy = dimensionCopy.get(dimension);
            assertNotBlank(copy.name(), where + dimension + ".name");
            // 两端记号：包可覆盖档案（覆盖后也必须非空），不覆盖时由档案提供
            if (copy.lowPole() != null) {
                assertNotBlank(copy.lowPole(), where + dimension + ".lowPole");
            }
            if (copy.highPole() != null) {
                assertNotBlank(copy.highPole(), where + dimension + ".highPole");
            }
            assertPoleCopy(copy.negative(), where + dimension + ".negative");
            assertPoleCopy(copy.positive(), where + dimension + ".positive");

            BalancedCopy balanced = copy.balanced();
            assertNotBlank(balanced.summary(), where + dimension + ".balanced.summary");
            assertNotBlank(balanced.observation(), where + dimension + ".balanced.observation");

            InsufficientCopy insufficient = copy.insufficient();
            assertNotBlank(insufficient.summary(), where + dimension + ".insufficient.summary");
            assertNotBlank(insufficient.nextStep(), where + dimension + ".insufficient.nextStep");
        }
    }

    private static void assertPoleCopy(PoleCopy pole, String where) {
        assertNotBlank(pole.label(), where + ".label");
        assertNotBlank(pole.description(), where + ".description");
        assertNotBlank(pole.observation(), where + ".observation");
        assertNotBlank(pole.action(), where + ".action");
    }

    /** 报告文案硬断言（字段规格 §6）：§6 列出的字段一个都不能少、都不能空。 */
    private static void assertReportCopy(ReportCopy copy, String where) {
        assertNotBlank(copy.typedTitle(), where + "reportCopy.typedTitle");
        assertNotBlank(copy.typedSubtitle(), where + "reportCopy.typedSubtitle");
        assertNotBlank(copy.partialTitle(), where + "reportCopy.partialTitle");
        assertNotBlank(copy.partialSubtitle(), where + "reportCopy.partialSubtitle");
        assertNotBlank(copy.undeterminedTitle(), where + "reportCopy.undeterminedTitle");
        assertNotBlank(copy.undeterminedSubtitle(), where + "reportCopy.undeterminedSubtitle");
        assertNotBlank(copy.insufficientTitle(), where + "reportCopy.insufficientTitle");
        assertNotBlank(copy.insufficientSubtitle(), where + "reportCopy.insufficientSubtitle");
        assertNotBlank(copy.typeReadingLead(), where + "reportCopy.typeReadingLead");
        assertNotBlank(copy.scoreMethodNote(), where + "reportCopy.scoreMethodNote");
        assertNotBlank(copy.dimensionReviewLead(), where + "reportCopy.dimensionReviewLead");
        assertNotBlank(copy.selfReflectionLead(), where + "reportCopy.selfReflectionLead");
    }

    /**
     * 署名硬断言（字段规格 §7）。
     *
     * <p>对 {@code attributionMustMatchMethod} 的仪器（OEJTS，CC BY-NC-SA 的署名义务），
     * 五个字段必须与 {@link #OFFICIAL_ATTRIBUTION} **逐字相等**，不做大小写或去空格的宽容比较；
     * 其它仪器（如公有领域的 IPIP）只要求五项齐全非空——它们的署名另有来源。
     */
    private static void assertAttribution(
            MethodContent.Attribution attribution, InstrumentProfile profile, String where) {
        require(attribution != null, where + "attribution 不能为空");
        require(isNotBlank(attribution.source()) && isNotBlank(attribution.author())
                        && isNotBlank(attribution.url()) && isNotBlank(attribution.license())
                        && isNotBlank(attribution.licenseUrl()),
                where + "attribution 的 source/author/url/license/licenseUrl 都不能为空");
        if (!profile.attributionMustMatchMethod()) {
            return;
        }
        MethodContent.Attribution official = OFFICIAL_ATTRIBUTION;
        List<String> mismatches = new ArrayList<>();
        compareField(mismatches, "source", attribution.source(), official.source());
        compareField(mismatches, "author", attribution.author(), official.author());
        compareField(mismatches, "url", attribution.url(), official.url());
        compareField(mismatches, "license", attribution.license(), official.license());
        compareField(mismatches, "licenseUrl", attribution.licenseUrl(), official.licenseUrl());
        require(mismatches.isEmpty(),
                where + "attribution 必须与 method.yml 的 attribution 逐字相等，不一致字段: " + mismatches);
    }

    private static void compareField(List<String> mismatches, String field, String actual, String expected) {
        if (!Objects.equals(actual, expected)) {
            mismatches.add(field + " 期望「" + expected + "」实际「" + actual + "」");
        }
    }

    /** 校验通过后，内容包里的署名必须与真实 {@code method.yml} 逐字一致（启动期交叉核对）。 */
    private void assertAttributionMatchesMethodFile() {
        // method.yml 承载 OEJTS 的署名；用 OEJTS 的档案（要求逐字相等的那一份）核对它自己。
        assertAttribution(method.attribution(), INSTRUMENT_PROFILES.get(OFFICIAL_INSTRUMENT_ID), METHOD_LOCATION);
    }

    private static void assertNotBlank(String value, String what) {
        require(isNotBlank(value), what + " 不能为空");
    }

    // ------------------------------------------------------------------ 校验：题库

    /**
     * 题库硬断言（v1 入口）。校验失败抛 {@link ContentValidationException} ⇒ 启动失败。
     *
     * @param origin 用于错误信息的来源标识（文件名）
     */
    public static void validateQuestionnaire(Questionnaire questionnaire, String origin) {
        validateQuestionnaire(questionnaire, origin, INSTRUMENT_PROFILES.get(OFFICIAL_INSTRUMENT_ID));
    }

    /**
     * 题库硬断言（带仪器档案）。校验失败抛 {@link ContentValidationException} ⇒ 启动失败。
     *
     * <p>分两层：
     * <ol>
     *   <li><b>与量表无关的结构校验</b>：题数一致、题号唯一升序、方向 ±1、
     *       按 {@code format} 断言各自的文本字段、常量配平（每题选 3 = 中点）；</li>
     *   <li><b>仪器档案核对</b>（给了 profile 时）：题数、维度集合与顺序、常量、中点、逐题符号。</li>
     * </ol>
     *
     * @param origin  用于错误信息的来源标识（文件名）
     * @param profile 仪器档案；{@code null} 表示只做第 1 层
     */
    public static void validateQuestionnaire(
            Questionnaire questionnaire, String origin, InstrumentProfile profile) {
        String where = "[" + origin + "] ";
        require(questionnaire != null, where + "题库内容为空");

        List<String> violations = fieldViolations(questionnaire);
        require(violations.isEmpty(), where + "字段级校验失败: " + violations);

        // 字段级校验只保证「非空 / >= 1」，量级合理性要单独断言：
        // title 是落地页直接展示的文案，estimatedMinutes 会显示成「约 N 分钟」。
        require(isNotBlank(questionnaire.version()), where + "version 不能为空");
        require(isNotBlank(questionnaire.title()), where + "title 不能为空");
        Integer estimatedMinutes = questionnaire.estimatedMinutes();
        require(estimatedMinutes != null
                        && estimatedMinutes >= 1
                        && estimatedMinutes <= MAX_ESTIMATED_MINUTES,
                where + "estimatedMinutes 必须在 1–" + MAX_ESTIMATED_MINUTES + " 分钟之间，实际 "
                        + estimatedMinutes + "（落地页会原样显示成「约 N 分钟」）");

        // 作答格式：bipolar（缺省）或 agreement
        String format = questionnaire.format() == null ? "bipolar" : questionnaire.format();
        require("bipolar".equals(format) || "agreement".equals(format),
                where + "format 只能是 bipolar 或 agreement，实际 " + format);
        if (profile != null) {
            require(profile.format().equals(format),
                    where + "format 必须是 " + profile.format() + "（" + profile.id() + "），实际 " + format);
        }

        // 五档文案：可缺省；声明了就必须恰好 5 条非空
        List<String> anchors = questionnaire.responseAnchors();
        if (anchors != null) {
            require(anchors.size() == 5,
                    where + "responseAnchors 必须是 5 条，实际 " + anchors.size());
            require(anchors.stream().allMatch(ContentService::isNotBlank),
                    where + "responseAnchors 存在空条目");
        }

        List<Question> questions = questionnaire.questions();
        require(Objects.equals(questionnaire.questionCount(), questions.size()),
                where + "questionCount=" + questionnaire.questionCount()
                        + " 与 questions 实际条数 " + questions.size() + " 不一致");

        Set<Integer> ids = new TreeSet<>();
        int previousId = 0;
        for (Question question : questions) {
            require(ids.add(question.id()), where + "题号重复: " + question.id());
            // 顺序也要管：题号乱序时，题库数组的顺序与前端展示顺序、哈希都不再对应
            // （MI-2：Q1 与 Q2 换位曾能通过校验且哈希不变）
            require(question.id() > previousId,
                    where + "questions 必须按 id 升序排列，Q" + question.id()
                            + " 出现在 Q" + previousId + " 之后");
            previousId = question.id();
            require(question.direction() == 1 || question.direction() == -1,
                    where + "题 Q" + question.id() + " 的 direction 只能是 +1 / -1，实际 "
                            + question.direction());
            require(isNotBlank(question.dimension()),
                    where + "题 Q" + question.id() + " 缺少 dimension");

            if ("agreement".equals(format)) {
                // 单句贴切度：一句自我描述；两端字段不适用
                require(isNotBlank(question.text()),
                        where + "题 Q" + question.id() + " 是 agreement 格式，必须有 text（一句自我描述）");
            } else {
                require(isNotBlank(question.textLeft()) && isNotBlank(question.textRight()),
                        where + "题 Q" + question.id() + " 是 bipolar 格式，textLeft/textRight 都不能为空");
                require(!question.textLeft().equals(question.textRight()),
                        where + "题 Q" + question.id() + " 的左右两端文本完全相同，疑似笔误");
            }
        }

        assertScoringConfig(questionnaire, profile, where);

        if (profile != null) {
            require(questions.size() == profile.questionCount(),
                    where + profile.id() + " 必须恰好 " + profile.questionCount() + " 题，实际 "
                            + questions.size());
            Set<Integer> expectedIds = new TreeSet<>();
            for (int id = 1; id <= profile.questionCount(); id++) {
                expectedIds.add(id);
            }
            require(ids.equals(expectedIds),
                    where + profile.id() + " 题号必须是 1.." + profile.questionCount()
                            + " 连续，实际 " + ids);

            // 题号合法之后再钉维度集合：未知维度必须先在这里被判掉。
            // 否则一个写成 XX 的 dimension 只会表现为「SN 少了一题」，看不出真正的原因。
            for (Question question : questions) {
                require(profile.signs().containsKey(question.dimension()),
                        where + "题 Q" + question.id() + " 的 dimension 非法："
                                + profile.id() + " 的官方维度是 " + profile.dimensionOrder()
                                + "，实际 \"" + question.dimension() + "\"");
            }

            for (Map.Entry<String, Map<Integer, Integer>> entry : profile.signs().entrySet()) {
                String dimension = entry.getKey();
                Map<Integer, Integer> expected = new TreeMap<>(entry.getValue());
                Map<Integer, Integer> actual = new TreeMap<>();
                for (Question question : questions) {
                    if (dimension.equals(question.dimension())) {
                        actual.put(question.id(), question.direction());
                    }
                }
                require(actual.size() == profile.perDimension(),
                        where + dimension + " 维度必须恰好 " + profile.perDimension()
                                + " 题，实际 " + actual.size() + "：" + actual);
                require(actual.equals(expected),
                        where + dimension + " 维度的题号/符号与官方 " + profile.id() + " "
                                + profile.revision() + " 公式不一致。期望 " + expected
                                + "，实际 " + actual);
            }

            // 符号核对通过后，再用与量表无关的配平不变量复核一次
            assertNeutralScoreBalance(questionnaire, where);
        } else {
            assertNeutralScoreBalance(questionnaire, where);
        }
    }

    /**
     * 计分配置硬断言。
     *
     * <p>有仪器档案时先做**官方核对**（诊断更精确：错的是常量还是中点一目了然），
     * 之后在 {@link #validateQuestionnaire} 末尾再用**与量表无关的配平不变量**复核一次。
     */
    private static void assertScoringConfig(
            Questionnaire questionnaire, InstrumentProfile profile, String where) {
        require(questionnaire.scoring() != null, where + "缺少 scoring");
        Map<String, Integer> constants = questionnaire.scoring().constants();
        require(constants != null && !constants.isEmpty(), where + "scoring.constants 不能为空");
        require(questionnaire.scoring().midpoint() != null, where + "scoring.midpoint 不能为空");

        if (profile != null) {
            require(constants.keySet().equals(new LinkedHashSet<>(profile.dimensionOrder())),
                    where + "scoring.constants 的键必须恰好是 " + profile.dimensionOrder()
                            + "，实际 " + constants.keySet());
            require(profile.constants().equals(constants),
                    where + "scoring.constants 必须与官方一致 " + profile.constants()
                            + "，实际 " + constants);
            require(questionnaire.scoring().midpoint() == profile.midpoint(),
                    where + "scoring.midpoint 必须是 " + profile.midpoint() + "，实际 "
                            + questionnaire.scoring().midpoint());
        }
    }

    /**
     * 与量表无关的**配平不变量**：对每个维度 {@code constant + 3 × Σdirection == midpoint}，
     * 即"每题都选 3（中立 / 谈不上贴切）"时该维原始分正好落在中点；由此自动得到
     * {@code min = midpoint − 2×题数}、{@code max = midpoint + 2×题数}。
     *
     * <p>放在符号核对**之后**运行：符号被改反时，官方符号断言给出的诊断比这条更精确。
     */
    private static void assertNeutralScoreBalance(Questionnaire questionnaire, String where) {
        Map<String, Integer> constants = questionnaire.scoring().constants();
        Map<String, Integer> sumDirection = new LinkedHashMap<>();
        for (Question question : questionnaire.questions()) {
            sumDirection.merge(question.dimension(), question.direction(), Integer::sum);
        }
        for (Map.Entry<String, Integer> entry : sumDirection.entrySet()) {
            String dimension = entry.getKey();
            Integer constant = constants.get(dimension);
            require(constant != null,
                    where + "scoring.constants 缺少维度 " + dimension + " 的常量，实际 " + constants.keySet());
            int neutralScore = constant + 3 * entry.getValue();
            require(neutralScore == questionnaire.scoring().midpoint(),
                    where + dimension + " 的常量没有配平：每题都选 3 时得到 " + neutralScore
                            + "，不等于中点 " + questionnaire.scoring().midpoint());
        }
    }

    // ------------------------------------------------------------------ 校验：类型文案

    /** 类型文案硬断言：16 个 code 必须齐全，且 resonance 必须是 3–5 条。 */
    public static void validateTypes(TypesFile file, String origin) {
        String where = "[" + origin + "] ";
        require(file != null, where + "类型文案内容为空");
        List<String> violations = fieldViolations(file);
        require(violations.isEmpty(), where + "字段级校验失败: " + violations);

        Map<String, TypeProfile> byCode = new LinkedHashMap<>();
        for (TypeProfile profile : file.types()) {
            String code = profile.code().trim().toUpperCase(Locale.ROOT);
            require(byCode.put(code, profile) == null, where + "类型码重复: " + code);

            Map<String, String> dimensions = profile.dimensions();
            require(dimensions != null && dimensions.keySet().equals(DIMENSIONS),
                    where + code + " 的 dimensions 必须恰好覆盖 " + DIMENSIONS);
            for (String dimension : DIMENSIONS) {
                require(isNotBlank(dimensions.get(dimension)),
                        where + code + " 缺少 " + dimension + " 维度文案");
            }
            require(isNotBlank(profile.tagline()), where + code + " 缺少 tagline");
            require(isNotBlank(profile.nameCn()), where + code + " 缺少 nameCn");

            List<String> resonance = profile.resonance();
            require(resonance != null && resonance.size() >= 3 && resonance.size() <= 5,
                    where + code + " 的 resonance 必须是 3–5 条（具体要求见任务拆解 1.2），实际 "
                            + (resonance == null ? "null" : resonance.size()));
            require(resonance.stream().allMatch(ContentService::isNotBlank),
                    where + code + " 的 resonance 存在空条目");
            require(profile.strengths() != null && !profile.strengths().isEmpty(),
                    where + code + " 缺少 strengths");
            require(profile.blindSpots() != null && !profile.blindSpots().isEmpty(),
                    where + code + " 缺少 blindSpots");
            require(profile.growth() != null && !profile.growth().isEmpty(),
                    where + code + " 缺少 growth");
        }

        Set<String> missing = new TreeSet<>(REQUIRED_TYPE_CODES);
        missing.removeAll(byCode.keySet());
        require(missing.isEmpty(), where + "缺少类型文案: " + missing);
        Set<String> unknown = new TreeSet<>(byCode.keySet());
        unknown.removeAll(REQUIRED_TYPE_CODES);
        require(unknown.isEmpty(), where + "出现非法类型码: " + unknown);
    }

    // ------------------------------------------------------------------ 校验：方法说明页

    /** 方法说明页硬断言：署名信息必须齐全，四个小节必须都在。 */
    public static void validateMethodContent(MethodContent content, String origin) {
        String where = "[" + origin + "] ";
        require(content != null, where + "方法说明内容为空");
        List<String> violations = fieldViolations(content);
        require(violations.isEmpty(), where + "字段级校验失败: " + violations);

        MethodContent.Attribution attribution = content.attribution();
        require(attribution.license().contains("BY-NC-SA"),
                where + "attribution.license 必须标明 CC BY-NC-SA（CC BY 的署名义务），实际 "
                        + attribution.license());
        require(attribution.licenseUrl().startsWith("http"),
                where + "attribution.licenseUrl 必须是可点击链接，实际 " + attribution.licenseUrl());

        Set<String> titles = new LinkedHashSet<>();
        content.sections().forEach(section -> titles.add(section.title()));
        for (String required : REQUIRED_METHOD_SECTIONS) {
            require(titles.contains(required), where + "缺少小节「" + required + "」，实际 " + titles);
        }
    }

    // ------------------------------------------------------------------ 工具

    /**
     * 内容哈希：对「题号 | 维度 | 符号 | 左端 | 右端」的行序列取 SHA-256。
     *
     * <p>用途是防「左右端被交换」这类无法自动判定的失误（任务拆解 §三 陷阱 1）：
     * 自动校验只能验题号与符号，验不了中文译文对应的是官方哪一端。
     * 所以这里把整套题面钉成一个哈希，在启动日志里打印，并在
     * {@code ContentValidationTest} 里断言它等于一条人工复核后写死的锚点值 ——
     * 任何一次题面改动都会让测试变红，强制走一遍人工对照官方 PDF 的复核。
     *
     * <p>⚠️ 拼接前按 {@code id} 排序（MI-2）：哈希要覆盖的是**题面集合**，不是数组顺序。
     * 早先直接按数组顺序拼接时，Q1 与 Q2 换位既不触发校验、也不改变哈希，
     * 于是「题库被重排」这件事连测试都拦不住。数组顺序本身另由
     * {@link #validateQuestionnaire} 的「按 id 升序」断言负责。
     */
    public static String questionSetHash(Questionnaire questionnaire) {
        List<Question> ordered = new ArrayList<>(questionnaire.questions());
        ordered.sort(Comparator.comparingInt(Question::id));

        StringBuilder canonical = new StringBuilder();
        for (Question question : ordered) {
            canonical.append(question.id()).append('|')
                    .append(question.dimension()).append('|')
                    .append(question.direction()).append('|')
                    .append(question.textLeft()).append('|')
                    .append(question.textRight()).append('\n');
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("JVM 不支持 SHA-256", e);
        }
    }

    private static List<String> fieldViolations(Object target) {
        Set<ConstraintViolation<Object>> violations = VALIDATOR.validate(target);
        List<String> messages = new ArrayList<>();
        for (ConstraintViolation<Object> violation : violations) {
            messages.add(violation.getPropertyPath() + ": " + violation.getMessage());
        }
        messages.sort(Comparator.naturalOrder());
        return messages;
    }

    private static boolean isNotBlank(String value) {
        return value != null && !value.isBlank();
    }

    private static void require(boolean condition, String message) {
        if (!condition) {
            throw new ContentValidationException(message);
        }
    }
}
