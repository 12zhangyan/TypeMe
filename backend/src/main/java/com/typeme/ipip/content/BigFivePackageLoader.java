package com.typeme.ipip.content;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.ipip.domain.BigFiveScoringPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * 大五内容包加载器：启动期读取 {@code classpath:content/bigfive50-zh-*.json} 并硬校验。
 *
 * <p>与 {@code JungPackageLoader} 一样，哈希由加载器自己从**冻结的规范形**重算，
 * 不信任文件里写的 {@code sha256}：手改 JSON 一定会被发现。
 *
 * <p>校验失败直接启动失败。这不是过度严格：反向键写错一格，结果是"看起来能跑、
 * 五个维度里有一个方向全反"，而用户看到的是一份语气笃定的错误报告。
 */
@Service
public class BigFivePackageLoader {

    private static final Logger log = LoggerFactory.getLogger(BigFivePackageLoader.class);

    /** 新建大五测评时默认绑定的版本。 */
    public static final String CURRENT_PACKAGE_ID = "typeme-bigfive50-zh-v1";

    private static final String CONTENT_PATTERN = "classpath:content/bigfive50-zh-*.json";

    /** IPIP-50 官方题数。 */
    private static final int EXPECTED_ITEMS = 50;
    private static final int EXPECTED_PER_DIMENSION = 10;

    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, BigFivePackage> packages;
    private final BigFivePackage current;
    private final Map<String, String> declaredSha256 = new LinkedHashMap<>();
    private final Map<String, String> recomputedSha256 = new LinkedHashMap<>();

    public BigFivePackageLoader(ResourceLoader resourceLoader) {
        this.packages = loadPackages(resourceLoader);
        this.current = packages.get(CURRENT_PACKAGE_ID);
        if (this.current == null) {
            throw new BigFiveContentException("默认大五内容包 " + CURRENT_PACKAGE_ID + " 未加载："
                    + "classpath:content/ 下必须有这个 packageId 的文件。已加载："
                    + String.join(", ", packages.keySet()));
        }
        for (BigFivePackage pkg : packages.values()) {
            log.info("大五内容包已加载：{}", pkg.summary());
            if (!"field_checked".equals(pkg.contentStatus())) {
                log.warn("大五题目与解释的审校状态是「{}」：中文题面未做真人试读与试测，"
                        + "没有信度/效度证据，也不代表已与常模比对。（packageId={}）",
                        pkg.contentStatus(), pkg.packageId());
            }
        }
    }

    /** 新建大五测评默认使用的包。 */
    public BigFivePackage current() {
        return current;
    }

    public List<BigFivePackage> packages() {
        return List.copyOf(packages.values());
    }

    /** 按 packageId 取内容包；没有这个版本时返回 {@code null}。 */
    public BigFivePackage find(String packageId) {
        return packageId == null ? null : packages.get(packageId);
    }

    public String declaredSha256Of(String packageId) {
        return declaredSha256.getOrDefault(packageId, "");
    }

    public String recomputedSha256Of(String packageId) {
        return recomputedSha256.getOrDefault(packageId, "");
    }

    /* ── 加载 ───────────────────────────────────────────────────────────── */

    private Map<String, BigFivePackage> loadPackages(ResourceLoader resourceLoader) {
        List<Resource> resources;
        try {
            Resource[] found = new PathMatchingResourcePatternResolver(resourceLoader)
                    .getResources(CONTENT_PATTERN);
            if (found.length == 0) {
                throw new BigFiveContentException("classpath 下没有大五内容包：" + CONTENT_PATTERN);
            }
            resources = new ArrayList<>(List.of(found));
            resources.sort(Comparator.comparing(resource -> String.valueOf(resource.getFilename())));
        } catch (IOException ex) {
            throw new BigFiveContentException("无法枚举大五内容包（" + CONTENT_PATTERN + "）", ex);
        }

        Map<String, BigFivePackage> loaded = new LinkedHashMap<>();
        for (Resource resource : resources) {
            BigFivePackage pkg = loadPackage(resource);
            if (loaded.put(pkg.packageId(), pkg) != null) {
                throw new BigFiveContentException("两个文件声明了同一个 packageId：" + pkg.packageId());
            }
        }
        return java.util.Collections.unmodifiableMap(loaded);
    }

    private BigFivePackage loadPackage(Resource resource) {
        JsonNode root = readJson(resource, "大五内容包");
        int schemaVersion = intField(root, "schemaVersion");
        if (schemaVersion != 1) {
            throw new BigFiveContentException("大五内容包 schemaVersion 必须是 1，实际 " + schemaVersion);
        }
        String packageId = textField(root, "packageId");
        if (!packageId.matches("typeme-bigfive50-zh-v\\d+")) {
            throw new BigFiveContentException("packageId 必须形如 typeme-bigfive50-zh-v<N>，实际 " + packageId);
        }
        JsonNode instrument = objectField(root, "instrument");
        JsonNode policyNode = objectField(root, "scoringPolicy");
        JsonNode constantsNode = objectField(policyNode, "constants");

        Map<BigFiveDimension, Integer> constants = new EnumMap<>(BigFiveDimension.class);
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            constants.put(dimension, intField(constantsNode, dimension.code()));
        }

        BigFiveScoringPolicy policy = new BigFiveScoringPolicy(
                textField(policyNode, "version"),
                intField(policyNode, "minBaseRatingsPerDimension"),
                intField(policyNode, "ratingMin"),
                intField(policyNode, "ratingMax"),
                intField(policyNode, "ratingNeutral"),
                intField(policyNode, "midpoint"),
                Map.copyOf(constants),
                intField(policyNode, "markedDistance"),
                intField(policyNode, "strongDistance"));

        List<String> anchors = new ArrayList<>();
        for (JsonNode anchor : arrayField(root, "answerAnchors")) {
            anchors.add(anchor.asText());
        }

        Map<String, String> attribution = new LinkedHashMap<>();
        JsonNode attributionNode = objectField(root, "attribution");
        for (String field : List.of("source", "author", "url", "license", "licenseUrl")) {
            attribution.put(field, textField(attributionNode, field));
        }

        List<BigFiveDimensionCopy> copies = new ArrayList<>();
        for (JsonNode node : arrayField(root, "dimensions")) {
            BigFiveDimension dimension = BigFiveDimension.of(textField(node, "dimension"));
            copies.add(new BigFiveDimensionCopy(
                    dimension,
                    textField(node, "name"),
                    textField(node, "question"),
                    poleCopy(objectField(node, "low")),
                    poleCopy(objectField(node, "high")),
                    textField(node, "caution"),
                    textField(node, "observation")));
        }

        List<BigFiveItem> items = new ArrayList<>();
        for (JsonNode node : arrayField(root, "questions")) {
            items.add(new BigFiveItem(
                    textField(node, "id"),
                    textField(node, "sourceItemId"),
                    BigFiveDimension.of(textField(node, "dimension")),
                    intField(node, "direction"),
                    intField(node, "order"),
                    textField(node, "text"),
                    textField(node, "help"),
                    textField(node, "reviewStatus"),
                    textField(node, "provenance")));
        }

        BigFivePackage candidate = new BigFivePackage(
                schemaVersion,
                packageId,
                textField(instrument, "id"),
                textField(instrument, "revision"),
                textField(instrument, "scoringVersion"),
                textField(instrument, "reportContentVersion"),
                textField(root, "title"),
                textField(root, "contentStatus"),
                policy,
                anchors,
                attribution,
                copies,
                items,
                "pending");

        validate(candidate);
        String sha256 = sha256Of(candidate);
        String declared = root.path("sha256").asText("");
        declaredSha256.put(packageId, declared);
        recomputedSha256.put(packageId, sha256);
        if (!declared.isBlank() && !declared.equalsIgnoreCase(sha256)) {
            log.error("大五内容包 sha256 与内容不一致：packageId={} 文件写 {}，实际算出 {}。"
                    + "运行时使用重算值，但请运行 node scripts/gen-platform-content.mjs 重新生成。",
                    packageId, declared, sha256);
        } else if (declared.isBlank()) {
            log.warn("大五内容包缺少 sha256 字段（{}）：只使用启动期计算值。", packageId);
        } else {
            log.info("大五内容包指纹：{}…（{}，与文件声明一致）", sha256.substring(0, 12), packageId);
        }
        return candidate.withSha256(sha256);
    }

    private static BigFiveDimensionCopy.BigFivePoleCopy poleCopy(JsonNode node) {
        List<String> signs = new ArrayList<>();
        for (JsonNode sign : arrayField(node, "dailySigns")) {
            signs.add(sign.asText());
        }
        return new BigFiveDimensionCopy.BigFivePoleCopy(
                textField(node, "label"), textField(node, "description"), List.copyOf(signs));
    }

    /* ── 校验 ───────────────────────────────────────────────────────────── */

    private void validate(BigFivePackage pkg) {
        List<String> problems = new ArrayList<>();

        if (pkg.questions().size() != EXPECTED_ITEMS) {
            problems.add("题目总数必须是 " + EXPECTED_ITEMS + "，实际 " + pkg.questions().size());
        }
        if (pkg.scoringPolicy().minBaseRatingsPerDimension() != EXPECTED_PER_DIMENSION) {
            problems.add("minBaseRatingsPerDimension 必须是 " + EXPECTED_PER_DIMENSION
                    + "（大五不补中点：未完成的维度不给结论），实际 "
                    + pkg.scoringPolicy().minBaseRatingsPerDimension());
        }
        if (pkg.scoringPolicy().ratingNeutral() < pkg.scoringPolicy().ratingMin()
                || pkg.scoringPolicy().ratingNeutral() > pkg.scoringPolicy().ratingMax()) {
            problems.add("ratingNeutral 必须落在 ratingMin..ratingMax");
        }
        if (pkg.answerAnchors().size() != 5) {
            problems.add("answerAnchors 必须有 5 档，实际 " + pkg.answerAnchors().size());
        }

        Set<String> ids = new LinkedHashSet<>();
        Set<String> sourceIds = new LinkedHashSet<>();
        Set<Integer> orders = new TreeSet<>();
        for (BigFiveItem item : pkg.questions()) {
            if (!ids.add(item.id())) {
                problems.add("题目 ID 重复：" + item.id());
            }
            if (!sourceIds.add(item.sourceItemId())) {
                problems.add("sourceItemId 重复：" + item.sourceItemId());
            }
            orders.add(item.order());
            if (item.direction() != 1 && item.direction() != -1) {
                problems.add(item.id() + " 的 direction 必须是 ±1，实际 " + item.direction());
            }
            if (!item.id().matches("Q\\d{2}")) {
                problems.add(item.id() + " 的题号必须形如 Q01（落库列宽 16，且要能一眼看出序号）");
            }
            if (item.text().length() < 4) {
                problems.add(item.id() + " 的题面过短");
            }
            if (item.help().length() < 20) {
                problems.add(item.id() + " 的逐题解释过短（用户看不懂时没有可展开的内容）");
            }
        }
        for (int order = 1; order <= EXPECTED_ITEMS; order++) {
            if (!orders.contains(order)) {
                problems.add("order 不连续，缺少 " + order);
            }
        }

        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            List<BigFiveItem> items = pkg.items(dimension);
            if (items.size() != EXPECTED_PER_DIMENSION) {
                problems.add(dimension.code() + " 应有 " + EXPECTED_PER_DIMENSION
                        + " 题，实际 " + items.size());
            }
            int reverse = (int) items.stream().filter(BigFiveItem::isReverse).count();
            if (reverse == 0 || reverse == items.size()) {
                problems.add(dimension.code() + " 全是同向题（反向 " + reverse + "/" + items.size()
                        + "）：会让「一直点同一侧」直接变成该维的极端分数");
            }
            // 常量必须与"每题都选中立档 = 中点"一致。
            int sumDirection = items.stream().mapToInt(BigFiveItem::direction).sum();
            int expectedConstant = pkg.scoringPolicy().midpoint()
                    - pkg.scoringPolicy().ratingNeutral() * sumDirection;
            if (pkg.scoringPolicy().constantOf(dimension) != expectedConstant) {
                problems.add(dimension.code() + " 的常量与中点不配平：应为 " + expectedConstant
                        + "，实际 " + pkg.scoringPolicy().constantOf(dimension));
            }
            BigFiveDimensionCopy copy = pkg.copyOf(dimension);
            if (copy.low().dailySigns().size() < 3 || copy.high().dailySigns().size() < 3) {
                problems.add(dimension.code() + " 的日常表现每侧至少 3 条");
            }
            if (copy.caution().length() < 30) {
                problems.add(dimension.code() + " 缺少「不能据此判断什么」的说明（caution 过短）");
            }
        }

        if (!problems.isEmpty()) {
            throw new BigFiveContentException("大五内容包校验失败（" + problems.size() + " 项）：\n - "
                    + String.join("\n - ", problems));
        }
    }

    /**
     * 规范形指纹。
     *
     * <p>字段集合与顺序必须与 {@code scripts/gen-platform-content.mjs} 的
     * {@code ipipCanonicalSource} 严格一致：两侧算不出同一个值，指纹校验就会变成
     * "每天失败"从而被无视。
     */
    private String sha256Of(BigFivePackage pkg) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonicalJson(pkg).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new BigFiveContentException("大五内容包指纹计算失败", ex);
        }
    }

    /**
     * 内容包的**规范形 JSON 文本**：计算 sha256 的那一份字节。
     *
     * <p>把它公开出来是为了让"落库的内容"与"算出的指纹"出自同一份字节：
     * {@code assessment_package.content_json} 存的就是这个字符串，
     * 于是任何人拿库里的行重算 sha256 都会得到同一个值。
     * 如果落库时用另一份序列化（例如把原始文件原样存进去），
     * 库里就会出现"sha256 与 content_json 对不上"的行，而且只有在对账时才会发现。
     */
    public String canonicalJson(BigFivePackage pkg) {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schemaVersion", pkg.schemaVersion());
        root.put("packageId", pkg.packageId());
        Map<String, Object> instrument = new LinkedHashMap<>();
        instrument.put("id", pkg.instrumentId());
        instrument.put("revision", pkg.revision());
        instrument.put("scoringVersion", pkg.scoringVersion());
        instrument.put("reportContentVersion", pkg.reportContentVersion());
        instrument.put("format", "agreement");
        instrument.put("hasTypeCode", false);
        instrument.put("baseItemsPerDimension", EXPECTED_PER_DIMENSION);
        instrument.put("clarificationItemsPerDimension", 0);
        instrument.put("maxClarificationItems", 0);
        root.put("instrument", instrument);
        root.put("title", pkg.title());
        root.put("contentStatus", pkg.contentStatus());

        Map<String, Object> policy = new LinkedHashMap<>();
        policy.put("version", pkg.scoringPolicy().version());
        policy.put("minBaseRatingsPerDimension", pkg.scoringPolicy().minBaseRatingsPerDimension());
        policy.put("ratingMin", pkg.scoringPolicy().ratingMin());
        policy.put("ratingMax", pkg.scoringPolicy().ratingMax());
        policy.put("ratingNeutral", pkg.scoringPolicy().ratingNeutral());
        policy.put("midpoint", pkg.scoringPolicy().midpoint());
        Map<String, Object> constants = new LinkedHashMap<>();
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            constants.put(dimension.code(), pkg.scoringPolicy().constantOf(dimension));
        }
        policy.put("constants", constants);
        policy.put("markedDistance", pkg.scoringPolicy().markedDistance());
        policy.put("strongDistance", pkg.scoringPolicy().strongDistance());
        root.put("scoringPolicy", policy);

        List<Object> dimensions = new ArrayList<>();
        for (BigFiveDimension dimension : BigFiveDimension.values()) {
            BigFiveDimensionCopy copy = pkg.copyOf(dimension);
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("dimension", dimension.code());
            node.put("name", copy.name());
            node.put("question", copy.question());
            node.put("low", poleNode(copy.low()));
            node.put("high", poleNode(copy.high()));
            node.put("caution", copy.caution());
            node.put("observation", copy.observation());
            dimensions.add(node);
        }
        root.put("dimensions", dimensions);

        List<Object> questions = new ArrayList<>();
        for (BigFiveItem item : pkg.questions()) {
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("id", item.id());
            node.put("sourceItemId", item.sourceItemId());
            node.put("dimension", item.dimension().code());
            node.put("direction", item.direction());
            node.put("order", item.order());
            node.put("text", item.text());
            node.put("help", item.help());
            node.put("reviewStatus", item.reviewStatus());
            node.put("provenance", item.provenance());
            questions.add(node);
        }
        root.put("questions", questions);

        try {
            return mapper.writeValueAsString(root);
        } catch (com.fasterxml.jackson.core.JsonProcessingException ex) {
            throw new BigFiveContentException("大五内容包规范形序列化失败", ex);
        }
    }

    private static Map<String, Object> poleNode(BigFiveDimensionCopy.BigFivePoleCopy pole) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("label", pole.label());
        node.put("description", pole.description());
        node.put("dailySigns", pole.dailySigns());
        return node;
    }

    /* ── JSON 工具 ──────────────────────────────────────────────────────── */

    private JsonNode readJson(Resource resource, String label) {
        try (InputStream in = resource.getInputStream()) {
            return mapper.readTree(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException ex) {
            throw new BigFiveContentException("无法读取" + label + "：" + resource, ex);
        }
    }

    private static JsonNode objectField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isObject()) {
            throw new BigFiveContentException("字段 " + field + " 缺失或不是对象");
        }
        return node;
    }

    private static JsonNode arrayField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isArray()) {
            throw new BigFiveContentException("字段 " + field + " 缺失或不是数组");
        }
        return node;
    }

    private static String textField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.isTextual() || node.asText().isBlank()) {
            throw new BigFiveContentException("字段 " + field + " 缺失、不是字符串或为空");
        }
        return node.asText();
    }

    private static int intField(JsonNode parent, String field) {
        JsonNode node = parent.get(field);
        if (node == null || !node.canConvertToInt()) {
            throw new BigFiveContentException("字段 " + field + " 缺失或不是整数");
        }
        return node.asInt();
    }
}
