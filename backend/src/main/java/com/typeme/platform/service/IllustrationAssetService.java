package com.typeme.platform.service;

import com.typeme.jung.domain.JungTypeCode;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.TimeSource;
import com.typeme.platform.api.PlatformDtos;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 公开插画的远端地址：**运行期从数据库读**，改地址不必重新构建前端。
 *
 * <h2>为什么地址要进库</h2>
 * 原来的做法是把"域名 + 对象键"在构建期打进前端包（`VITE_IMAGE_BASE_URL` + 发布清单）。
 * 那让"换一张图"变成一次前端发版，而且少设一个环境变量就会静默退回本地素材。
 * 现在库里那张表是事实来源，前端启动读一次（`GET /api/v3/platform/illustrations`）。
 *
 * <h2>这张表里只放公开插画</h2>
 * 名字必须命中白名单（5 张场景图 + 16 个类型码对应的人物图）。报告、答卷、账号信息等
 * 私人文件**不进这张表**，也不允许通过本类的 {@link #update} 写进来 —— 这里的白名单
 * 是安全边界，不是格式校验：它挡的是"把别人的私人图片挂到公开页面上"。
 *
 * <h2>读接口为什么是公开的</h2>
 * 首页是匿名可访问的，而首页首屏恰好是这次迁移要省流量的那部分流量。把读接口锁在登录后，
 * 等于对最重要的访客继续从源站出图。响应里只有公开插画的地址，没有任何用户数据。
 */
@Service
public class IllustrationAssetService {

    /**
     * 场景插画白名单：与 `scripts/gen-image-publish.mjs` 的 `SCENE_ILLUSTRATIONS`
     * 以及 `frontend/src/assets/illustrations/README.md` 的「场景文件」一节一致。
     *
     * <p>三处各有一份名单是**有意的重复**：生成器管上传、这里管"谁可以写进库"、
     * 文档管人怎么加图。它们不一致时，症状是"加了图但库不让写"或"库里有张没人用的图"，
     * 都是加图时立刻能发现的，不会静默出事。
     */
    private static final List<String> SCENE_NAMES = List.of(
            "assessment-bigfive", "assessment-jung", "home-hero", "reflection", "welcome");

    /** 人物图的名字形状：`type-` + 四个小写字母（真正合法性交给 {@link JungTypeCode}）。 */
    private static final Pattern TYPE_NAME = Pattern.compile("^type-([a-z]{4})$");

    private static final Pattern SHA256_HEX = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern RELEASE_LABEL = Pattern.compile("^[A-Za-z0-9._-]{1,32}$");

    private static final int MAX_ASSETS_PER_REQUEST = 100;
    private static final int MAX_URL_LENGTH = 512;
    private static final int MAX_NAME_LENGTH = 64;

    private final JdbcTemplate jdbc;
    private final TimeSource time;
    private final Set<String> allowedHosts;

    public IllustrationAssetService(
            JdbcTemplate jdbc,
            TimeSource time,
            @Value("${typeme.illustration.allowed-hosts:}") String allowedHosts) {
        this.jdbc = jdbc;
        this.time = time;
        this.allowedHosts = parseAllowedHosts(allowedHosts);
        if (this.allowedHosts.isEmpty()) {
            // 配置为空时**不**退化成"任何域名都行"：那会让管理员接口变成"把任意第三方
            // 图片挂到本站"的入口。宁可让写入全部失败（读接口不受影响）。
            throw new IllegalStateException(
                    "typeme.illustration.allowed-hosts 不能为空：它决定哪些域名允许写进 illustration_asset。");
        }
    }

    private static Set<String> parseAllowedHosts(String raw) {
        Set<String> hosts = new LinkedHashSet<>();
        if (raw == null) {
            return hosts;
        }
        for (String piece : Arrays.asList(raw.split(","))) {
            String host = piece.trim().toLowerCase(Locale.ROOT);
            if (!host.isEmpty()) {
                hosts.add(host);
            }
        }
        return Set.copyOf(hosts);
    }

    /* ── 读 ─────────────────────────────────────────────────────────────── */

    /** 全部公开插画；库里为空时返回空列表（前端据此继续用本地素材，不是错误）。 */
    public PlatformDtos.IllustrationListResponse list() {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT asset_name, url, sha256, release_tag, updated_at
                  FROM illustration_asset
                 ORDER BY asset_name
                """);

        List<PlatformDtos.IllustrationAssetView> assets = new ArrayList<>(rows.size());
        LocalDateTime newest = null;
        String release = null;
        for (Map<String, Object> row : rows) {
            assets.add(new PlatformDtos.IllustrationAssetView(
                    text(row.get("asset_name")),
                    text(row.get("url")),
                    text(row.get("sha256"))));
            LocalDateTime updatedAt = TimeSource.utcFromJdbc(row.get("updated_at"));
            if (updatedAt != null && (newest == null || updatedAt.isAfter(newest))) {
                newest = updatedAt;
            }
            if (release == null) {
                release = text(row.get("release_tag"));
            }
        }
        // 版本号 = 行数 + 最新更新时间：改一行、加一行、删一行都会让它变。
        String version = rows.size() + ":" + (newest == null ? "-" : TimeSource.isoFromUtc(newest));
        return new PlatformDtos.IllustrationListResponse(release, version, List.copyOf(assets));
    }

    /* ── 写（仅管理员，见 PlatformController 的 @PreAuthorize） ──────────── */

    /**
     * 批量写入地址。逐条校验，**任何一条不合法就整批拒绝**（不做"部分成功"）：
     * 半成功会让调用方以为改完了，而页面上一半是新图一半是旧图。
     */
    @Transactional
    public PlatformDtos.IllustrationListResponse update(PlatformDtos.IllustrationUpdateRequest request) {
        List<PlatformDtos.IllustrationUpdateItem> items =
                request == null || request.assets() == null ? List.of() : request.assets();
        Map<String, String> fields = validate(items);
        if (!fields.isEmpty()) {
            throw new JungApiException("VALIDATION_FAILED", 400, "插画地址不合法，本次没有任何改动。",
                    Map.of("fields", fields));
        }

        LocalDateTime now = time.nowUtc();
        for (PlatformDtos.IllustrationUpdateItem item : items) {
            int updated = jdbc.update("""
                    UPDATE illustration_asset
                       SET url = ?, sha256 = ?, release_tag = ?, updated_at = ?
                     WHERE asset_name = ?
                    """, item.url().trim(), item.sha256().trim(), item.release().trim(), now, item.name().trim());
            if (updated == 0) {
                // 先 UPDATE、影响 0 行再 INSERT：与 AiSettingRepository 同一理由 ——
                // ON DUPLICATE KEY UPDATE 不是两个引擎的语法交集（H2 的 MERGE 语义也不同）。
                jdbc.update("""
                        INSERT INTO illustration_asset (asset_name, url, sha256, release_tag, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        """, item.name().trim(), item.url().trim(), item.sha256().trim(), item.release().trim(), now);
            }
        }
        return list();
    }

    /** 校验；返回 字段 → 原因 的空 map 表示全部合法。 */
    private Map<String, String> validate(List<PlatformDtos.IllustrationUpdateItem> items) {
        Map<String, String> fields = new LinkedHashMap<>();
        if (items.isEmpty()) {
            fields.put("assets", "至少要提供一项。");
            return fields;
        }
        if (items.size() > MAX_ASSETS_PER_REQUEST) {
            fields.put("assets", "一次最多 " + MAX_ASSETS_PER_REQUEST + " 项。");
            return fields;
        }
        Set<String> seen = new LinkedHashSet<>();
        for (int index = 0; index < items.size(); index++) {
            PlatformDtos.IllustrationUpdateItem item = items.get(index);
            String where = "assets[" + index + "]";
            if (item == null) {
                fields.put(where, "不能为 null。");
                continue;
            }
            validateName(item.name(), where, fields, seen);
            validateUrl(item.url(), where, fields);
            validateSha256(item.sha256(), where, fields);
            validateRelease(item.release(), where, fields);
        }
        return fields;
    }

    private void validateName(String name, String where, Map<String, String> fields, Set<String> seen) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) {
            fields.put(where + ".name", "不能为空。");
            return;
        }
        if (value.length() > MAX_NAME_LENGTH) {
            fields.put(where + ".name", "长度不能超过 " + MAX_NAME_LENGTH + "。");
            return;
        }
        if (!isAllowedName(value)) {
            fields.put(where + ".name",
                    "只允许公开插画：" + String.join("、", SCENE_NAMES) + "，或 type-<四字母类型码>（如 type-intj）。"
                            + "报告、答卷、账号相关的图片不得写入本表。");
            return;
        }
        if (!seen.add(value)) {
            fields.put(where + ".name", "同一次请求里重复出现：" + value + "。");
        }
    }

    private boolean isAllowedName(String name) {
        if (SCENE_NAMES.contains(name)) {
            return true;
        }
        var matcher = TYPE_NAME.matcher(name);
        if (!matcher.matches()) {
            return false;
        }
        // 类型码的合法性交给领域类型，不在这里另写一份 ^[EI][SN][TF][JP]$：
        // 两份实现迟早会分叉（例如以后加了新维度）。
        return JungTypeCode.isLegal(matcher.group(1).toUpperCase(Locale.ROOT));
    }

    private void validateUrl(String url, String where, Map<String, String> fields) {
        String value = url == null ? "" : url.trim();
        if (value.isEmpty()) {
            fields.put(where + ".url", "不能为空。");
            return;
        }
        if (value.length() > MAX_URL_LENGTH) {
            fields.put(where + ".url", "长度不能超过 " + MAX_URL_LENGTH + "。");
            return;
        }
        URI parsed;
        try {
            parsed = new URI(value);
        } catch (URISyntaxException ex) {
            fields.put(where + ".url", "不是合法 URL。");
            return;
        }
        if (!"https".equalsIgnoreCase(parsed.getScheme())) {
            fields.put(where + ".url", "必须是 https 地址（HTTP 页面上的 HTTP 图片会被浏览器按混合内容拦掉）。");
            return;
        }
        if (parsed.getUserInfo() != null) {
            fields.put(where + ".url", "不允许带用户名/密码。");
            return;
        }
        if (parsed.getFragment() != null) {
            fields.put(where + ".url", "不允许带 # 片段。");
            return;
        }
        String host = parsed.getHost() == null ? "" : parsed.getHost().toLowerCase(Locale.ROOT);
        if (!allowedHosts.contains(host)) {
            fields.put(where + ".url",
                    "域名不在允许清单内（当前允许：" + String.join("、", allowedHosts) + "）。"
                            + "换域名要同时改 typeme.illustration.allowed-hosts 与 CSP 的 img-src。");
        }
    }

    private void validateSha256(String sha256, String where, Map<String, String> fields) {
        String value = sha256 == null ? "" : sha256.trim();
        if (!SHA256_HEX.matcher(value).matches()) {
            fields.put(where + ".sha256", "必须是 64 位小写十六进制（用 sha256sum/Get-FileHash 算素材文件）。");
        }
    }

    private void validateRelease(String release, String where, Map<String, String> fields) {
        String value = release == null ? "" : release.trim();
        if (!RELEASE_LABEL.matcher(value).matches()) {
            fields.put(where + ".release", "发布标签只能是 1–32 位字母、数字、点、下划线或连字符。");
        }
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }
}
