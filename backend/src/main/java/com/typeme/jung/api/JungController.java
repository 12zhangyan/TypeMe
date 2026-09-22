package com.typeme.jung.api;

import com.typeme.jung.service.AttemptService;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.ReportService;
import com.typeme.jung.content.JungPackageLoader;
import com.typeme.platform.catalog.AssessmentCatalog;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.catalog.InstrumentKind;
import com.typeme.security.ClientIpResolver;
import com.typeme.security.RateLimitService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * `/api/v3`：新测内容、草稿、提交、报告、自我理解、导出。
 *
 * <p>三个刻意的设计：
 * <ol>
 *   <li><b>userId 一律来自认证主体</b>（{@link CurrentUser}），请求体里没有 owner 字段，
 *       也没有任何"以某个用户身份执行"的入口 —— 越权在结构上就无从表达。</li>
 *   <li><b>没有分数/类型的入参</b>：提交接口的 DTO 里根本没有这些字段，客户端结果不可信这条
 *       不是靠校验维持的，而是结构上做不到。</li>
 *   <li><b>报告与认证响应 no-store</b>：报告页不允许被公共缓存或中间层缓存，
 *       共享设备上退出后不应还能从浏览器缓存里翻出别人的报告。</li>
 *   <li><b>匿名可读的只有"产品定义"</b>：`GET /catalog/current` 与
 *       `GET /catalog/current/package` 在 `SecurityConfig` 里单独 `permitAll`
 *       （理由与限流见 {@link #catalogReadAllowed}），其余路径仍要认证。</li>
 * </ol>
 */
@RestController
@RequestMapping("/api/v3")
public class JungController {

    private final JungPackageLoader loader;
    private final AttemptService attempts;
    private final ReportService reports;
    private final AssessmentCatalog catalog;
    private final ClientIpResolver clientIpResolver;
    private final RateLimitService rateLimit;

    public JungController(JungPackageLoader loader, AttemptService attempts, ReportService reports,
                          AssessmentCatalog catalog, ClientIpResolver clientIpResolver,
                          RateLimitService rateLimit) {
        this.loader = loader;
        this.attempts = attempts;
        this.reports = reports;
        this.catalog = catalog;
        this.clientIpResolver = clientIpResolver;
        this.rateLimit = rateLimit;
    }

    /* ── 内容 ───────────────────────────────────────────────────────────── */

    @GetMapping("/catalog/current")
    public ResponseEntity<JungDtos.CatalogResponse> catalog(HttpServletRequest request) {
        catalogReadAllowed(request);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(JungDtos.catalog(loader));
    }

    @GetMapping("/catalog/current/package")
    public ResponseEntity<JungDtos.PackageResponse> currentPackage(HttpServletRequest request) {
        catalogReadAllowed(request);
        return ResponseEntity.ok()
                .eTag(loader.current().sha256())
                .cacheControl(CacheControl.noCache())
                .body(JungDtos.packageView(loader));
    }

    /**
     * 匿名目录的限流（2026-09-21）。
     *
     * <p>为什么放开访问后必须补这一层：这两条是从 `/api/v3/**` 里**切出来**的公开路径，
     * 而 `/catalog/current/package` 会返回整份题库。没有限流时，任何人用一个循环就能
     * 把整份内容反复拉走并占用序列化/数据库开销。
     *
     * <p>为什么已登录用户不计入：① 他们另有按账号维度的限流；② 公共壳每页都要读一次
     * 目录，匿名桶若把已登录用户也算进去，正常浏览很快会自己把自己挡掉。
     * 判定由**认证主体**决定（{@code SecurityContext}），不由请求头决定。
     */
    private void catalogReadAllowed(HttpServletRequest request) {
        rateLimit.checkCatalogRead(clientIpResolver.resolve(request), CurrentUser.isAuthenticated());
    }

    /* ── attempt ────────────────────────────────────────────────────────── */

    /**
     * 新建一次测评。`Idempotency-Key` 可选（契约 02 §6.1）：带上它时，
     * 同一个键 + 同一份请求内容只会产生**一份**草稿 —— 请求超时后用户点重试
     * 不该多出一份他自己看不见的草稿（A35）。
     *
     * <p>{@code instrument} 可选：不传时按 **jung48**（保持既有前端的调用方式不变）。
     * 传了别的 slug 就走那一项测评的默认内容版本 —— 也就是说"新建哪种测评"由请求决定，
     * 而"这份草稿用哪一版题目"由草稿自己锁定。
     */
    @PostMapping("/attempts")
    public ResponseEntity<JungDtos.AttemptSummary> createAttempt(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) JungDtos.CreateAttemptRequest request) {
        String userId = requireUser();
        String slug = request == null || request.instrument() == null || request.instrument().isBlank()
                ? "jung48"
                : request.instrument().trim();
        AssessmentRelease release;
        try {
            release = catalog.defaultRelease(slug);
        } catch (IllegalArgumentException ex) {
            throw JungApiException.notFound("要开始的测评：" + slug);
        }
        if (release.kind() != InstrumentKind.JUNG) {
            // 走 JungController 的新建入口却点名了另一族的量表，说明前端把两套路径接错了。
            // 明确指路而不是"照建一份但后续全部不认识"。
            throw JungApiException.invalid(
                    "这项测评不能用这个入口开始：" + slug + "。请使用 /api/v3/platform/attempts。");
        }
        JungDtos.AttemptSummary summary = attempts.create(
                userId, request == null ? null : request.baseReportId(), idempotencyKey, release);
        return ResponseEntity.status(HttpStatus.CREATED).body(summary);
    }

    @GetMapping("/attempts")
    public ResponseEntity<JungDtos.AttemptListResponse> listAttempts(
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        return ResponseEntity.ok(attempts.list(requireUser(), status, page, size));
    }

    @GetMapping("/attempts/{id}")
    public ResponseEntity<JungDtos.AttemptDetail> attemptDetail(@PathVariable("id") String attemptId) {
        return ResponseEntity.ok(attempts.detail(requireUser(), attemptId));
    }

    @PatchMapping("/attempts/{id}/answers")
    public ResponseEntity<JungDtos.PatchAnswersResponse> patchAnswers(
            @PathVariable("id") String attemptId,
            @RequestBody JungDtos.PatchAnswersRequest request) {
        return ResponseEntity.ok(attempts.patchAnswers(requireUser(), attemptId, request));
    }

    @PostMapping("/attempts/{id}/review")
    public ResponseEntity<JungDtos.ReviewResponse> review(@PathVariable("id") String attemptId) {
        return ResponseEntity.ok(attempts.review(requireUser(), attemptId));
    }

    @PostMapping("/attempts/{id}/submit")
    public ResponseEntity<JungDtos.SubmitResponse> submit(
            @PathVariable("id") String attemptId,
            @RequestBody(required = false) JungDtos.SubmitRequest request) {
        JungDtos.SubmitResponse response = reports.submit(requireUser(), attemptId, request);
        /*
         * 契约 02 §7.2 给这一行的状态码是 **201 Created**（这次请求创建了报告资源），
         * 只有"覆盖不足"才是 200 + NEEDS_REVIEW（那不是错误，是让用户回看几道题）。
         * 之前两种情况都返回 200：客户端不看状态码也能跑，但契约与实现不一致会误导
         * 下一个消费者（他们有权按 201 判断"报告真的建出来了"）。
         */
        return response.reportId() == null
                ? ResponseEntity.ok(response)
                : ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    @DeleteMapping("/attempts/{id}")
    public ResponseEntity<Void> deleteAttempt(@PathVariable("id") String attemptId) {
        attempts.deleteDraft(requireUser(), attemptId);
        return ResponseEntity.noContent().build();
    }

    /* ── 报告 ───────────────────────────────────────────────────────────── */

    @GetMapping("/reports")
    public ResponseEntity<JungDtos.ReportListResponse> listReports(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(reports.list(requireUser(), page, size));
    }

    @GetMapping("/reports/{id}")
    public ResponseEntity<JungDtos.ReportDetail> reportDetail(@PathVariable("id") String reportId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.VARY, "Cookie")
                .body(reports.detail(requireUser(), reportId));
    }

    @GetMapping("/attempts/{id}/report")
    public ResponseEntity<JungDtos.ReportDetail> reportByAttempt(@PathVariable("id") String attemptId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(reports.detailByAttempt(requireUser(), attemptId));
    }

    @PutMapping("/reports/{id}/self-reflection")
    public ResponseEntity<JungDtos.SelfReflectionView> saveSelfReflection(
            @PathVariable("id") String reportId,
            @RequestBody(required = false) JungDtos.SelfReflectionRequest request) {
        return ResponseEntity.ok(reports.saveSelfReflection(requireUser(), reportId, request));
    }

    @GetMapping("/reports/compare")
    public ResponseEntity<JungDtos.CompareResponse> compare(
            @RequestParam("ids") List<String> ids) {
        return ResponseEntity.ok(reports.compare(requireUser(), ids));
    }

    @DeleteMapping("/reports/{id}")
    public ResponseEntity<Void> deleteReport(@PathVariable("id") String reportId) {
        reports.delete(requireUser(), reportId);
        return ResponseEntity.noContent().build();
    }

    /*
     * 注意：`GET /api/v3/me/export` **不在这里**。
     *
     * 导出属于"账号与数据"的职责，由账号模块（`com.typeme.account.service.DataExportService`）
     * 实现，一处入口一处口径。报告模块**不再保留**第二份导出副本：曾经存在的
     * `ReportService#exportData` 无调用方，且会把缺表/查询失败静默吞成空数组，与账号模块的
     * `degradedSections` 语义不一致 —— 两份实现最危险的分叉是"其中一份忘了剔除凭据材料"。
     */

    /* ── 内部 ───────────────────────────────────────────────────────────── */

    /**
     * 取当前用户；取不到即 401。
     *
     * <p>这一层不是主要的鉴权手段（Spring Security 已经在过滤器链上挡过一次），
     * 而是防御性的：如果将来安全配置被改松，这里仍然会拒绝，而不是拿 null 当 userId
     * 去查出一堆别人的数据。
     */
    private String requireUser() {
        String userId = CurrentUser.requireUserId();
        if (userId == null || userId.isBlank()) {
            throw new JungApiException("UNAUTHENTICATED", 401, "请先登录。");
        }
        return userId;
    }
}
