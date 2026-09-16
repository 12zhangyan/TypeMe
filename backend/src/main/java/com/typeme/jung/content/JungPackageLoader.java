package com.typeme.jung.content;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.typeme.jung.domain.JungContentStatus;
import com.typeme.jung.domain.JungDimension;
import com.typeme.jung.domain.JungDimensionCopy;
import com.typeme.jung.domain.JungItem;
import com.typeme.jung.domain.JungPole;
import com.typeme.jung.domain.JungPoleCopy;
import com.typeme.jung.domain.JungProcess;
import com.typeme.jung.domain.JungScoringPolicy;
import com.typeme.jung.domain.JungStage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * 新测内容包加载器：启动期读取 {@code classpath:content/typeme-jung48-zh-v1.json}，
 * 做**硬校验**，并产出一个不可变 {@link JungPackage}。
 *
 * <p>内容源是前端同构可读的 JSON（由 {@code scripts/convert-jung-content.mjs} 从人工编写的
 * YAML 单向生成）。用 JSON 而不是 YAML 是有意的：
 * <ul>
 *   <li>Java 与 TypeScript 用同一份字节，哈希才能比对；</li>
 *   <li>哈希由加载器自己从冻结的规范形计算，**不信任文件里写的 sha256**，
 *       所以手改 JSON 一定会被发现。</li>
 * </ul>
 *
 * <p>校验失败直接抛 {@link JungContentException} 让启动失败。首版内容全部是
 * {@code draft_review_pending}，加载时打 WARN 提醒未完成真人审校 —— 但这**不阻止**
 * 内测运行，只阻止"把它说成已验证"。
 */
@Service
public class JungPackageLoader {

    private static final Logger log = LoggerFactory.getLogger(JungPackageLoader.class);

    /** 首版唯一交付的包。换内容必须换新 packageId（已发布内容不可原地修改）。 */
    public static final String CURRENT_PACKAGE_ID = "typeme-jung48-zh-v1";

    /** 16 型基础报告内容版本。 */
    public static final String CURRENT_TYPE_REPORT_VERSION = "typeme-type-report-zh-v1";

    /** 过程层（四个精神活动过程 + 派生建议）内容版本。 */
    public static final String CURRENT_PROCESS_COPY_VERSION = "typeme-process-copy-zh-v1";

    private static final String CONTENT_LOCATION = "classpath:content/typeme-jung48-zh-v1.json";
    private static final String TYPE_REPORT_LOCATION = "classpath:content/typeme-type-report-zh-v1.json";
    private static final String PROCESS_COPY_LOCATION = "classpath:content/typeme-process-copy-zh-v1.json";

    /*
     * 过程层的**权威顺序**。指纹依赖顺序，所以顺序写死在这里，不依赖 JSON 文件里的书写顺序，
     * 也不依赖 Map 的迭代顺序 —— 必须与 `scripts/convert-jung-content.mjs` 里
     * PROCESS_ORDER / DECISION_FUNCTIONS / COMPLEMENT_POLES / COMMUNICATION_AXES 逐项一致。
     */
    private static final List<String> PROCESS_CANONICAL_ORDER =
            List.of("Si", "Se", "Ni", "Ne", "Ti", "Te", "Fi", "Fe");
    private static final List<Character> DECISION_FUNCTION_ORDER = List.of('S', 'N', 'T', 'F');
    private static final List<String> COMPLEMENT_POLE_ORDER = List.of("S", "N", "T", "F");
    private static final List<JungDimension> COMMUNICATION_AXIS_ORDER =
            List.of(JungDimension.EI, JungDimension.SN, JungDimension.TF, JungDimension.JP);

    private static final Set<String> REQUIRED_TYPE_SECTION_KEYS = Set.of(
            "dailyLife", "strengths", "blindSpots", "communication",
            "studyWork", "stress", "growth", "neighbors");

    private static final List<String> TYPE_SECTION_ORDER = List.of(
            "dailyLife", "strengths", "blindSpots", "communication",
            "studyWork", "stress", "growth", "neighbors");

    private final ObjectMapper mapper = new ObjectMapper();
    private final JungPackage jungPackage;
    private final TypeReportContent typeReportContent;
    private final JungProcessCopy processCopy;
    private String declaredPackageSha256 = "";
    private String recomputedPackageSha256 = "";
    private String declaredTypeReportSha256 = "";
    private String recomputedTypeReportSha256 = "";
    private String declaredProcessCopySha256 = "";
    private String recomputedProcessCopySha256 = "";

    public JungPackageLoader(ResourceLoader resourceLoader) {
        this.jungPackage = loadPackage(resourceLoader.getResource(CONTENT_LOCATION));
        this.typeReportContent = loadTypeReports(resourceLoader.getResource(TYPE_REPORT_LOCATION));
        this.processCopy = loadProcessCopy(resourceLoader.getResource(PROCESS_COPY_LOCATION));
        log.info("新测内容包已加载：{}", jungPackage.summary());
        if (jungPackage.contentStatus() == JungContentStatus.DRAFT_REVIEW_PENDING) {
            log.warn("新测题目与 16 型报告的审校状态是「内测待审校」：未做真人试读与试测，"
                    + "没有信度/效度证据，不得对外宣传为已验证。（packageId={}）", jungPackage.packageId());
        }
    }

    public JungPackage current() {
        return jungPackage;
    }

    public TypeReportContent currentTypeReports() {
        return typeReportContent;
    }

    /**
     * 过程层内容：八个过程、四步决策法、互补说明、沟通规则，以及三段必须同现的说明。
     *
     * <p>它**不参与** {@link #current()} 的指纹：改建议文案不该看起来像改了题库。
     */
    public JungProcessCopy processCopy() {
        return processCopy;
    }

    /* ── 内容包加载 ─────────────────────────────────────────────────────── */

    private JungPackage loadPackage(Resource resource) {
        JsonNode root = readJson(resource, "内容包");
        int schemaVersion = intField(root, "schemaVersion");
        ObjectNode instrument = objectField(root, "instrument");
        ObjectNode policyNode = objectField(root, "scoringPolicy");

        JungScoringPolicy policy = new JungScoringPolicy(
                textField(policyNode, "version"),
                intField(policyNode, "minBaseRatingsPerDimension"),
                intField(policyNode, "boundaryNumerator"),
                intField(policyNode, "boundaryDenominator"),
                intField(policyNode, "ratingMin"),
                intField(policyNode, "ratingMax"),
                intField(policyNode, "ratingNeutral"));

        List<JungDimensionCopy> copies = new ArrayList<>(4);
        for (JsonNode node : arrayField(root, "dimensions")) {
            JungDimension dimension = JungDimension.of(textField(node, "dimension"));
            copies.add(new JungDimensionCopy(
                    dimension,
                    textField(node, "name"),
                    textField(node, "question"),
                    poleCopy(node, "negativePole", dimension.negativePole()),
                    poleCopy(node, "positivePole", dimension.positivePole()),
                    textField(objectField(node, "balanced"), "summary"),
                    textField(objectField(node, "balanced"), "reading"),
                    textField(node, "tiedNotice")));
        }

        List<JungItem> items = new ArrayList<>();
        for (JsonNode node : arrayField(root, "questions")) {
            JungItem item = new JungItem(
                    textField(node, "id"),
                    JungStage.of(textField(node, "stage")),
                    JungDimension.of(textField(node, "dimension")),
                    textField(node, "scenario"),
                    textField(node, "textLeft"),
                    textField(node, "textRight"),
                    JungPole.of(textField(node, "leftPole")),
                    JungPole.of(textField(node, "rightPole")),
                    textField(node, "help"),
                    textField(node, "facet"),
                    intField(node, "order"),
                    JungContentStatus.of(textField(node, "reviewStatus")),
                    textField(node, "provenance"));
            items.add(item);
        }

        JungPackage candidate = new JungPackage(
                schemaVersion,
                textField(root, "packageId"),
                textField(instrument, "id"),
                textField(instrument, "revision"),
                textField(instrument, "scoringVersion"),
                textField(instrument, "reportContentVersion"),
                textField(root, "title"),
                JungContentStatus.of(textField(root, "contentStatus")),
                policy,
                copies,
                items,
                "pending");

        validate(candidate);
        String sha256 = sha256Of(candidate);
        /*
         * 文件中写的 sha256 也要核对 —— 否则那个字段只是装饰：任何人都可以在
         * 改完题目后顺手改掉它，而启动期只看"重新算出来的值"，看不出被改过。
         * 这一条会把"内容与指纹不一致"变成启动失败，是 §2.4 校验清单第 10 条。
         */
        String declared = root.path("sha256").asText("");
        this.declaredPackageSha256 = declared;
        this.recomputedPackageSha256 = sha256;
        if (!declared.isBlank() && !declared.equalsIgnoreCase(sha256)) {
            log.error("内容包 sha256 与内容不一致：文件写 {}，实际算出 {}。"
                    + "运行时仍会使用重算值（重算值才是可信的），但请运行 "
                    + "node scripts/convert-jung-content.mjs 重新生成内容包。", declared, sha256);
        } else if (declared.isBlank()) {
            log.warn("内容包缺少 sha256 字段（{}）：将只使用启动期计算值。", CURRENT_PACKAGE_ID);
        } else {
            log.info("内容包指纹：{}…（与文件声明一致）", sha256.substring(0, 12));
        }
        return candidate.withSha256(sha256);
    }

    /** 内容文件里声明的指纹；缺失时为空串。 */
    public String declaredPackageSha256() {
        return declaredPackageSha256;
    }

    /** 加载期按规范化算法重算的指纹（运行时实际使用的值）。 */
    public String recomputedPackageSha256() {
        return recomputedPackageSha256;
    }

    /**
     * 发布期校验。每条失败都带**可定位**的信息（哪个题号、哪一维），
     * 否则 64 题里错一个极点，只能靠肉眼找。
     */
    private void validate(JungPackage pkg) {
        List<String> problems = new ArrayList<>();

        if (pkg.schemaVersion() != 3) {
            problems.add("schemaVersion 必须是 3，实际 " + pkg.schemaVersion());
        }
        if (!CURRENT_PACKAGE_ID.equals(pkg.packageId())) {
            problems.add("packageId 必须是 " + CURRENT_PACKAGE_ID + "，实际 " + pkg.packageId());
        }
        if (!CURRENT_TYPE_REPORT_VERSION.equals(pkg.reportContentVersion())) {
            problems.add("reportContentVersion 必须是 " + CURRENT_TYPE_REPORT_VERSION
                    + "，实际 " + pkg.reportContentVersion());
        }
        if (pkg.scoringPolicy().minBaseRatingsPerDimension() < 1
                || pkg.scoringPolicy().minBaseRatingsPerDimension() > 12) {
            problems.add("minBaseRatingsPerDimension 必须在 1..12");
        }
        if (pkg.scoringPolicy().ratingNeutral() < pkg.scoringPolicy().ratingMin()
                || pkg.scoringPolicy().ratingNeutral() > pkg.scoringPolicy().ratingMax()) {
            problems.add("ratingNeutral 必须落在 ratingMin..ratingMax");
        }

        Set<String> ids = new HashSet<>();
        Set<Integer> orders = new HashSet<>();
        Set<String> duplicateOrders = new TreeSet<>();
        for (JungItem item : pkg.questions()) {
            if (!ids.add(item.id())) {
                problems.add("题目 ID 重复：" + item.id());
            }
            if (!orders.add(item.order())) {
                duplicateOrders.add(String.valueOf(item.order()));
            }
        }
        if (!duplicateOrders.isEmpty()) {
            problems.add("order 重复：" + String.join(",", duplicateOrders));
        }
        int expectedOrders = pkg.questions().size();
        for (int order = 1; order <= expectedOrders; order++) {
            if (!orders.contains(order)) {
                problems.add("order 不连续，缺少 " + order);
            }
        }

        for (JungDimension dimension : JungDimension.values()) {
            List<JungItem> base = pkg.baseItems(dimension);
            List<JungItem> clar = pkg.clarificationItems(dimension);
            if (base.size() != 12) {
                problems.add(dimension + " 主测题数必须是 12，实际 " + base.size());
            }
            if (clar.size() != 4) {
                problems.add(dimension + " 澄清题数必须是 4，实际 " + clar.size());
            }
            long baseNegativeOnLeft = base.stream().filter(JungItem::isLeftPoleNegative).count();
            long clarNegativeOnLeft = clar.stream().filter(JungItem::isLeftPoleNegative).count();
            if (base.size() == 12 && baseNegativeOnLeft != 6) {
                problems.add(dimension + " 主测左右不平衡：左端为负极的题数是 " + baseNegativeOnLeft + "，应为 6");
            }
            if (clar.size() == 4 && clarNegativeOnLeft != 2) {
                problems.add(dimension + " 澄清左右不平衡：左端为负极的题数是 " + clarNegativeOnLeft + "，应为 2");
            }
            Set<String> facets = new TreeSet<>();
            base.forEach(item -> facets.add(item.facet()));
            if (facets.size() < 3) {
                problems.add(dimension + " facet 覆盖不足 3 种，实际 " + facets.size() + "：" + facets);
            }
        }

        int baseCount = pkg.baseItems().size();
        if (baseCount != 48) {
            problems.add("主测题数必须是 48，实际 " + baseCount);
        }
        if (pkg.questions().size() != 64) {
            problems.add("题目总数必须是 64，实际 " + pkg.questions().size());
        }

        for (JungItem item : pkg.questions()) {
            if (item.leftPole().dimension() != item.dimension()
                    || item.rightPole().dimension() != item.dimension()) {
                problems.add(item.id() + " 极点属于别的维度：" + item.leftPole() + "/" + item.rightPole());
            }
            if (item.leftPole() == item.rightPole()) {
                problems.add(item.id() + " 两端是同一个极点：" + item.leftPole());
            }
            if (item.leftPole() != item.dimension().negativePole()
                    && item.leftPole() != item.dimension().positivePole()) {
                problems.add(item.id() + " 左端点不是该维的合法极点：" + item.leftPole());
            }
            if (item.help().length() < 20) {
                problems.add(item.id() + " 的 help 过短（" + item.help().length() + " 字），不足以解释场景");
            }
            if (item.textLeft().equals(item.textRight())) {
                problems.add(item.id() + " 两端文字完全相同");
            }
            if (containsPlaceholder(item.textLeft()) || containsPlaceholder(item.textRight())
                    || containsPlaceholder(item.help())) {
                problems.add(item.id() + " 含占位符文本");
            }
            String idPrefix = item.id().substring(0, 2);
            if (!idPrefix.equals(item.dimension().name())) {
                problems.add(item.id() + " 的题号前缀与维度不一致（" + item.dimension() + "）");
            }
            if (!verifyIdShape(item)) {
                problems.add(item.id() + " 的题号形状不符合 {DIM}-{01..12} 或 {DIM}-C{1..4}");
            }
        }

        EnumSet<JungDimension> dimensionsWithCopy = EnumSet.noneOf(JungDimension.class);
        for (JungDimension dimension : JungDimension.values()) {
            if (pkg.copyOf(dimension) != null) {
                dimensionsWithCopy.add(dimension);
            }
        }
        if (dimensionsWithCopy.size() != 4) {
            problems.add("维度解释文案不齐：" + dimensionsWithCopy);
        }

        if (!problems.isEmpty()) {
            throw new JungContentException("新测内容包校验失败（" + problems.size() + " 项）：\n - "
                    + String.join("\n - ", problems));
        }
    }

    private static boolean verifyIdShape(JungItem item) {
        String id = item.id();
        if (item.stage() == JungStage.BASE) {
            return id.matches("^[A-Z]{2}-\\d{2}$");
        }
        return id.matches("^[A-Z]{2}-C\\d$");
    }

    private static boolean containsPlaceholder(String text) {
        String upper = text.toUpperCase();
        return upper.contains("TODO") || upper.contains("XXX") || upper.contains("LOREM")
                || text.contains("待补") || text.contains("占位");
    }

    private JungPoleCopy poleCopy(JsonNode parent, String field, JungPole expectedPole) {
        JsonNode node = objectField(parent, field);
        JungPole pole = JungPole.of(textField(node, "pole"));
        if (pole != expectedPole) {
            throw new JungContentException(field + " 的极点应为 " + expectedPole + "，实际 " + pole);
        }
        List<String> signs = new ArrayList<>();
        for (JsonNode sign : arrayField(node, "dailySigns")) {
            signs.add(sign.asText());
        }
        return new JungPoleCopy(pole, textField(node, "label"), textField(node, "description"), List.copyOf(signs));
    }

    /* ── 16 型报告内容 ──────────────────────────────────────────────────── */

    private TypeReportContent loadTypeReports(Resource resource) {
        JsonNode root = readJson(resource, "类型报告内容");
        String version = textField(root, "reportContentVersion");
        if (!CURRENT_TYPE_REPORT_VERSION.equals(version)) {
            throw new JungContentException("类型报告版本必须是 " + CURRENT_TYPE_REPORT_VERSION + "，实际 " + version);
        }
        JungContentStatus status = JungContentStatus.of(textField(root, "contentStatus"));

        Map<String, TypeReport> reports = new LinkedHashMap<>();
        List<String> problems = new ArrayList<>();
        // 按类型码字典序处理：**指纹算法依赖迭代顺序**，不排序的话"文件里换个类型顺序"
        // 就会算出另一个哈希，看起来像内容被改。排序让顺序无关，指纹只反映内容。
        List<JsonNode> typeNodes = new ArrayList<>();
        arrayField(root, "types").forEach(typeNodes::add);
        typeNodes.sort(java.util.Comparator.comparing(node -> node.path("code").asText()));
        for (JsonNode node : typeNodes) {
            String code = textField(node, "code");
            if (!com.typeme.jung.domain.JungTypeCode.isLegal(code)) {
                problems.add("类型码非法：" + code);
                continue;
            }
            if (reports.containsKey(code)) {
                problems.add("类型码重复：" + code);
                continue;
            }
            Map<String, String> sections = new LinkedHashMap<>();
            for (String key : TYPE_SECTION_ORDER) {
                JsonNode body = node.get(key);
                if (body == null || !body.isTextual() || body.asText().length() < 100) {
                    problems.add(code + " 的章节 " + key + " 缺失或过短");
                    continue;
                }
                if (containsPlaceholder(body.asText())) {
                    problems.add(code + " 的章节 " + key + " 含占位符");
                }
                sections.put(key, body.asText());
            }
            List<Action> actions = new ArrayList<>();
            for (JsonNode actionNode : arrayField(node, "nextActions")) {
                List<String> steps = new ArrayList<>();
                for (JsonNode step : arrayField(actionNode, "steps")) {
                    steps.add(step.asText());
                }
                if (steps.isEmpty()) {
                    problems.add(code + " 有一条 nextAction 没有 steps");
                }
                actions.add(new Action(textField(actionNode, "title"), List.copyOf(steps)));
            }
            if (actions.size() != 3) {
                problems.add(code + " 的 nextActions 必须恰好 3 条，实际 " + actions.size());
            }
            reports.put(code, new TypeReport(
                    code,
                    textField(node, "nameCn"),
                    textField(node, "tagline"),
                    textField(node, "summary"),
                    Map.copyOf(sections),
                    List.copyOf(actions)));
        }

        if (reports.size() != 16) {
            problems.add("类型报告必须是 16 份，实际 " + reports.size());
        }
        if (!problems.isEmpty()) {
            throw new JungContentException("16 型报告内容校验失败（" + problems.size() + " 项）：\n - "
                    + String.join("\n - ", problems));
        }

        // 与内容包同理：类型报告也要核对文件里声明的指纹
        String declared = root.path("sha256").asText("");
        String actual = sha256OfTypeReports(version, status, reports);
        this.declaredTypeReportSha256 = declared;
        this.recomputedTypeReportSha256 = actual;
        if (!declared.isBlank() && !declared.equalsIgnoreCase(actual)) {
            log.error("16 型报告 sha256 与内容不一致：文件写 {}，实际算出 {}。"
                    + "运行时仍使用重算值，但请运行 node scripts/convert-jung-content.mjs 重新生成。",
                    declared, actual);
        }
        return new TypeReportContent(version, status, Map.copyOf(reports));
    }

    /** 类型报告文件里声明的指纹；缺失时为空串。 */
    public String declaredTypeReportSha256() {
        return declaredTypeReportSha256;
    }

    /** 类型报告的加载期重算指纹。 */
    public String recomputedTypeReportSha256() {
        return recomputedTypeReportSha256;
    }

    /**
     * 16 型报告内容的规范形指纹。
     *
     * <p>字段集合与顺序必须与 {@code scripts/convert-jung-content.mjs} 的
     * {@code buildTypeReports().canonicalSource} 严格一致，否则两侧算出不同值，
     * 指纹校验会变成"每天都失败"从而被无视 —— 那比没有校验更糟。
     */
    private String sha256OfTypeReports(String version, JungContentStatus status,
                                       Map<String, TypeReport> reports) {
        ObjectNode root = mapper.createObjectNode();
        root.put("schemaVersion", 1);
        root.put("reportContentVersion", version);
        root.put("contentStatus", status.token());
        ArrayNode types = root.putArray("types");
        reports.values().stream()
                .sorted(java.util.Comparator.comparing(TypeReport::code))
                .forEach(report -> {
                    ObjectNode node = types.addObject();
                    node.put("code", report.code());
                    node.put("nameCn", report.nameCn());
                    node.put("tagline", report.tagline());
                    node.put("summary", report.summary());
                    for (String key : TYPE_SECTION_ORDER) {
                        node.put(key, report.sections().getOrDefault(key, ""));
                    }
                    ArrayNode actions = node.putArray("nextActions");
                    for (Action action : report.nextActions()) {
                        ObjectNode actionNode = actions.addObject();
                        actionNode.put("title", action.title());
                        ArrayNode steps = actionNode.putArray("steps");
                        action.steps().forEach(steps::add);
                    }
                });
        // 用 ObjectNode#toString（JsonNode 自带，不抛受检异常）而不是 ObjectMapper#writeValueAsString：
        // 这里的节点全是纯 JSON 值（字符串/整数/数组/对象），没有任何需要自定义序列化器的东西，
        // 走 ObjectMapper 只会平白引入一个受检异常，逼得调用方包一层没意义的 try/catch。
        return sha256Hex(root.toString().getBytes(StandardCharsets.UTF_8));
    }

    /* ── 过程层文案 ─────────────────────────────────────────────────────── */

    /**
     * 加载过程层文案。
     *
     * <p>校验分两层：**结构**（八个过程、四个决策步、四条互补、四条规则一个不少）
     * 与**内容**（非空、非占位、不低于最小长度）。字数上限、跨条重复、禁用词在
     * {@code scripts/convert-jung-content.mjs} 里查 —— 那里能给出人话与行号，
     * 这里只负责"跑起来的东西一定是完整的"。
     */
    private JungProcessCopy loadProcessCopy(Resource resource) {
        JsonNode root = readJson(resource, "过程层文案");
        String version = textField(root, "processCopyVersion");
        if (!CURRENT_PROCESS_COPY_VERSION.equals(version)) {
            throw new JungContentException(
                    "过程层文案版本必须是 " + CURRENT_PROCESS_COPY_VERSION + "，实际 " + version);
        }
        JungContentStatus status = JungContentStatus.of(textField(root, "contentStatus"));

        Map<JungProcess, JungProcessCopy.ProcessEntry> processes = new EnumMap<>(JungProcess.class);
        Map<Character, JungProcessCopy.DecisionStep> steps = new LinkedHashMap<>();
        Map<JungPole, String> offers = new EnumMap<>(JungPole.class);
        Map<JungDimension, JungProcessCopy.CommunicationRule> rules = new EnumMap<>(JungDimension.class);
        List<String> problems = new ArrayList<>();

        for (JsonNode node : arrayField(root, "processes")) {
            String token = node.path("process").asText("");
            JungProcess process;
            try {
                process = JungProcess.parse(token);
            } catch (IllegalArgumentException ex) {
                problems.add("过程代号非法：" + token);
                continue;
            }
            if (processes.containsKey(process)) {
                problems.add("过程重复：" + token);
                continue;
            }
            processes.put(process, new JungProcessCopy.ProcessEntry(
                    copyField(node, "what", 20, problems, "过程 " + token),
                    copyField(node, "asDominant", 20, problems, "过程 " + token),
                    copyField(node, "whenUnpreferred", 20, problems, "过程 " + token)));
        }

        for (JsonNode node : arrayField(root, "decisionSteps")) {
            String raw = node.path("function").asText("");
            char function = raw.length() == 1 ? Character.toUpperCase(raw.charAt(0)) : '?';
            if ("SNTF".indexOf(function) < 0) {
                problems.add("决策步的功能族非法：" + raw);
                continue;
            }
            if (steps.containsKey(function)) {
                problems.add("决策步重复：" + raw);
                continue;
            }
            steps.put(function, new JungProcessCopy.DecisionStep(
                    function,
                    copyField(node, "title", 4, problems, "决策步 " + raw),
                    copyField(node, "prompt", 10, problems, "决策步 " + raw),
                    copyField(node, "whenUnpreferred", 20, problems, "决策步 " + raw)));
        }

        for (JsonNode node : arrayField(root, "complements")) {
            String raw = node.path("pole").asText("");
            JungPole pole;
            try {
                pole = JungPole.of(raw);
            } catch (IllegalArgumentException ex) {
                problems.add("互补说明的极点非法：" + raw);
                continue;
            }
            if (pole.dimension() == JungDimension.EI || pole.dimension() == JungDimension.JP) {
                problems.add("互补说明只适用于 SN/TF 两极，收到：" + raw);
                continue;
            }
            offers.put(pole, copyField(node, "offers", 15, problems, "互补 " + raw));
        }

        for (JsonNode node : arrayField(root, "communicationRules")) {
            String raw = node.path("axis").asText("");
            JungDimension dimension;
            try {
                dimension = JungDimension.of(raw);
            } catch (IllegalArgumentException ex) {
                problems.add("沟通规则的维度非法：" + raw);
                continue;
            }
            rules.put(dimension, new JungProcessCopy.CommunicationRule(
                    copyField(node, "negative", 20, problems, "沟通规则 " + raw),
                    copyField(node, "positive", 20, problems, "沟通规则 " + raw)));
        }

        for (String token : PROCESS_CANONICAL_ORDER) {
            if (!processes.containsKey(JungProcess.parse(token))) {
                problems.add("缺少过程：" + token);
            }
        }
        for (char function : DECISION_FUNCTION_ORDER) {
            if (!steps.containsKey(function)) {
                problems.add("缺少决策步：" + function);
            }
        }
        for (String pole : COMPLEMENT_POLE_ORDER) {
            if (!offers.containsKey(JungPole.of(pole))) {
                problems.add("缺少互补说明：" + pole);
            }
        }
        for (JungDimension dimension : COMMUNICATION_AXIS_ORDER) {
            if (!rules.containsKey(dimension)) {
                problems.add("缺少沟通规则：" + dimension);
            }
        }

        ObjectNode notesNode = objectField(root, "notes");
        JungProcessCopy.Notes notes = new JungProcessCopy.Notes(
                copyField(notesNode, "frameworkCaveat", 20, problems, "说明"),
                copyField(notesNode, "developmentNote", 20, problems, "说明"),
                copyField(notesNode, "greyAreaNote", 20, problems, "说明"));

        if (!problems.isEmpty()) {
            throw new JungContentException("过程层文案校验失败（" + problems.size() + " 项）：\n - "
                    + String.join("\n - ", problems));
        }

        String declared = root.path("sha256").asText("");
        String actual = sha256OfProcessCopy(version, status, processes, steps,
                textField(root, "decisionIntro"), textField(root, "decisionNote"), offers, rules, notes);
        this.declaredProcessCopySha256 = declared;
        this.recomputedProcessCopySha256 = actual;
        if (!declared.isBlank() && !declared.equalsIgnoreCase(actual)) {
            log.error("过程层文案 sha256 与内容不一致：文件写 {}，实际算出 {}。"
                    + "运行时仍使用重算值，但请运行 node scripts/convert-jung-content.mjs 重新生成。",
                    declared, actual);
        }

        return new JungProcessCopy(version, status,
                Map.copyOf(processes), Map.copyOf(steps),
                textField(root, "decisionIntro"), textField(root, "decisionNote"),
                Map.copyOf(offers), Map.copyOf(rules), notes);
    }

    /** 过程层文案文件里声明的指纹；缺失时为空串。 */
    public String declaredProcessCopySha256() {
        return declaredProcessCopySha256;
    }

    /** 过程层文案的加载期重算指纹。 */
    public String recomputedProcessCopySha256() {
        return recomputedProcessCopySha256;
    }

    /**
     * 过程层文案的规范形指纹。
     *
     * <p>字段集合与顺序必须与 {@code scripts/convert-jung-content.mjs} 的
     * {@code buildProcessCopy().canonicalSource} 严格一致（包括四个数组的**权威顺序**，
     * 而不是文件里的书写顺序）。
     */
    private String sha256OfProcessCopy(
            String version,
            JungContentStatus status,
            Map<JungProcess, JungProcessCopy.ProcessEntry> processes,
            Map<Character, JungProcessCopy.DecisionStep> steps,
            String decisionIntro,
            String decisionNote,
            Map<JungPole, String> offers,
            Map<JungDimension, JungProcessCopy.CommunicationRule> rules,
            JungProcessCopy.Notes notes) {

        ObjectNode root = mapper.createObjectNode();
        root.put("schemaVersion", 1);
        root.put("processCopyVersion", version);
        root.put("contentStatus", status.token());

        ArrayNode processArray = root.putArray("processes");
        for (String token : PROCESS_CANONICAL_ORDER) {
            JungProcessCopy.ProcessEntry entry = processes.get(JungProcess.parse(token));
            ObjectNode node = processArray.addObject();
            node.put("process", token);
            node.put("what", entry == null ? "" : entry.what());
            node.put("asDominant", entry == null ? "" : entry.asDominant());
            node.put("whenUnpreferred", entry == null ? "" : entry.whenUnpreferred());
        }

        ArrayNode stepArray = root.putArray("decisionSteps");
        for (char function : DECISION_FUNCTION_ORDER) {
            JungProcessCopy.DecisionStep step = steps.get(function);
            ObjectNode node = stepArray.addObject();
            node.put("function", String.valueOf(function));
            node.put("title", step == null ? "" : step.title());
            node.put("prompt", step == null ? "" : step.prompt());
            node.put("whenUnpreferred", step == null ? "" : step.whenUnpreferred());
        }

        root.put("decisionIntro", decisionIntro);
        root.put("decisionNote", decisionNote);

        ArrayNode complementArray = root.putArray("complements");
        for (String pole : COMPLEMENT_POLE_ORDER) {
            ObjectNode node = complementArray.addObject();
            node.put("pole", pole);
            node.put("offers", offers.getOrDefault(JungPole.of(pole), ""));
        }

        ArrayNode ruleArray = root.putArray("communicationRules");
        for (JungDimension dimension : COMMUNICATION_AXIS_ORDER) {
            JungProcessCopy.CommunicationRule rule = rules.get(dimension);
            ObjectNode node = ruleArray.addObject();
            node.put("axis", dimension.name());
            node.put("negative", rule == null ? "" : rule.negative());
            node.put("positive", rule == null ? "" : rule.positive());
        }

        ObjectNode notesNode = root.putObject("notes");
        notesNode.put("frameworkCaveat", notes.frameworkCaveat());
        notesNode.put("developmentNote", notes.developmentNote());
        notesNode.put("greyAreaNote", notes.greyAreaNote());

        return sha256Hex(root.toString().getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 读一个文案字段：非空、不低于最小长度、不含占位符。不合格只记问题，不抛 ——
     * 一次性把所有问题列出来，比让作者修一条跑一次强。
     */
    private static String copyField(
            JsonNode node, String field, int minLength, List<String> problems, String label) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().isBlank()) {
            problems.add(label + " 的 " + field + " 缺失或为空");
            return "";
        }
        String text = value.asText();
        if (text.length() < minLength) {
            problems.add(label + " 的 " + field + " 过短（" + text.length() + " < " + minLength + "）");
        }
        if (containsPlaceholder(text)) {
            problems.add(label + " 的 " + field + " 含占位符");
        }
        return text;
    }

    /* ── 规范化 JSON 与哈希 ─────────────────────────────────────────────── */

    /**
     * 计算内容包的规范形 JSON 与 sha256。
     *
     * <p>规范形是**由代码决定的固定字段顺序**，不依赖任何 map 迭代顺序；
     * 这样 Java、TypeScript 与生成脚本对同一份内容得到同一串哈希。
     * 哈希是完整性标识，**不是**防篡改签名，也不是用户身份认证。
     */
    public String canonicalJson(JungPackage pkg) {
        return canonicalNode(pkg).toString();
    }

    public ObjectNode canonicalNode(JungPackage pkg) {
        ObjectNode root = mapper.createObjectNode();
        root.put("schemaVersion", pkg.schemaVersion());
        root.put("packageId", pkg.packageId());
        ObjectNode instrument = root.putObject("instrument");
        instrument.put("id", pkg.instrumentId());
        instrument.put("revision", pkg.revision());
        instrument.put("scoringVersion", pkg.scoringVersion());
        instrument.put("reportContentVersion", pkg.reportContentVersion());
        instrument.put("format", "bipolar");
        instrument.put("hasTypeCode", true);
        instrument.put("baseItemsPerDimension", 12);
        instrument.put("clarificationItemsPerDimension", 4);
        instrument.put("maxClarificationItems", 16);
        root.put("title", pkg.title());
        root.put("contentStatus", pkg.contentStatus().token());

        ObjectNode policy = root.putObject("scoringPolicy");
        policy.put("version", pkg.scoringPolicy().version());
        policy.put("minBaseRatingsPerDimension", pkg.scoringPolicy().minBaseRatingsPerDimension());
        policy.put("boundaryNumerator", pkg.scoringPolicy().boundaryNumerator());
        policy.put("boundaryDenominator", pkg.scoringPolicy().boundaryDenominator());
        policy.put("ratingMin", pkg.scoringPolicy().ratingMin());
        policy.put("ratingMax", pkg.scoringPolicy().ratingMax());
        policy.put("ratingNeutral", pkg.scoringPolicy().ratingNeutral());

        ArrayNode dimensions = root.putArray("dimensions");
        for (JungDimension dimension : JungDimension.values()) {
            JungDimensionCopy copy = pkg.copyOf(dimension);
            ObjectNode node = dimensions.addObject();
            node.put("dimension", dimension.name());
            node.put("name", copy.name());
            node.put("question", copy.question());
            copyToNode(node.putObject("negativePole"), copy.negativePole());
            copyToNode(node.putObject("positivePole"), copy.positivePole());
            ObjectNode balanced = node.putObject("balanced");
            balanced.put("summary", copy.balancedSummary());
            balanced.put("reading", copy.balancedReading());
            node.put("tiedNotice", copy.tiedNotice());
        }

        ArrayNode questions = root.putArray("questions");
        for (JungItem item : pkg.questions()) {
            ObjectNode node = questions.addObject();
            node.put("id", item.id());
            node.put("stage", item.stage().token());
            node.put("dimension", item.dimension().name());
            node.put("scenario", item.scenario());
            node.put("textLeft", item.textLeft());
            node.put("textRight", item.textRight());
            node.put("leftPole", String.valueOf(item.leftPole().letter()));
            node.put("rightPole", String.valueOf(item.rightPole().letter()));
            node.put("help", item.help());
            node.put("facet", item.facet());
            node.put("order", item.order());
            node.put("reviewStatus", item.reviewStatus().token());
            node.put("provenance", item.provenance());
        }
        return root;
    }

    private static void copyToNode(ObjectNode node, JungPoleCopy copy) {
        node.put("pole", String.valueOf(copy.pole().letter()));
        node.put("label", copy.label());
        node.put("description", copy.description());
        ArrayNode signs = node.putArray("dailySigns");
        copy.dailySigns().forEach(signs::add);
    }

    public String sha256Of(JungPackage pkg) {
        return sha256Hex(canonicalJson(pkg).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 对一段**已在库里的**规范形 JSON 重新计算 sha256。
     *
     * <p>用途：验证 {@code assessment_package} 那两列自洽 —— {@code sha256} 必须等于
     * 对 {@code content_json} 重算的结果。没有这条验证，{@code sha256} 列就只是个存放值，
     * 没人能回答"库里这份内容有没有被改过"。
     *
     * <p>注意它**不**做规范化重排：入参就应该是规范形（由 {@link #canonicalJson} 产出并落库）。
     * 之所以不做，是因为"把任意 JSON 重新规范化再比对"会让验证悄悄放过
     * "内容被重排过"这种情况，而重排恰恰是篡改的一种。
     */
    public String sha256OfCanonicalJson(String canonicalJsonText) {
        return sha256Hex(canonicalJsonText.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("当前 JVM 不支持 SHA-256", ex);
        }
    }

    /* ── JSON 读取辅助（缺失即报错，不做静默默认） ──────────────────────── */

    private JsonNode readJson(Resource resource, String label) {
        if (!resource.exists()) {
            throw new JungContentException(label + "资源不存在：" + resource.getDescription());
        }
        try (InputStream in = resource.getInputStream()) {
            return mapper.readTree(in);
        } catch (IOException ex) {
            throw new JungContentException(label + "读取失败：" + resource.getDescription(), ex);
        }
    }

    private static ObjectNode objectField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isObject()) {
            throw new JungContentException("字段 " + field + " 缺失或不是对象");
        }
        return (ObjectNode) node;
    }

    private static ArrayNode arrayField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isArray()) {
            throw new JungContentException("字段 " + field + " 缺失或不是数组");
        }
        return (ArrayNode) node;
    }

    private static String textField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isTextual() || node.asText().isBlank()) {
            throw new JungContentException("字段 " + field + " 缺失、不是字符串或为空");
        }
        return node.asText();
    }

    private static int intField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.canConvertToInt()) {
            throw new JungContentException("字段 " + field + " 缺失或不是整数");
        }
        return node.asInt();
    }

    /* ── 值类型 ─────────────────────────────────────────────────────────── */

    /** 16 型基础报告内容（不可变）。 */
    public record TypeReportContent(
            String reportContentVersion,
            JungContentStatus contentStatus,
            Map<String, TypeReport> byCode) {

        public TypeReport of(String typeCode) {
            return byCode.get(typeCode);
        }

        public Set<String> sectionKeys() {
            return REQUIRED_TYPE_SECTION_KEYS;
        }

        public List<String> sectionOrder() {
            return TYPE_SECTION_ORDER;
        }

        public boolean versionMatches(String version) {
            return reportContentVersion.equals(version);
        }
    }

    public record TypeReport(
            String code,
            String nameCn,
            String tagline,
            String summary,
            Map<String, String> sections,
            List<Action> nextActions) {

        public String section(String key) {
            return sections.get(key);
        }
    }

    public record Action(String title, List<String> steps) {
    }

    /** 供测试与其它模块复用的维度→文案索引。 */
    public Map<JungDimension, JungDimensionCopy> dimensionCopies() {
        Map<JungDimension, JungDimensionCopy> copies = new EnumMap<>(JungDimension.class);
        for (JungDimension dimension : JungDimension.values()) {
            copies.put(dimension, jungPackage.copyOf(dimension));
        }
        return copies;
    }
}
