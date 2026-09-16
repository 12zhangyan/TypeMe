package com.typeme.jung.api;

import com.typeme.jung.service.AttemptService;
import com.typeme.jung.service.JungApiException;
import com.typeme.jung.service.ReportService;
import com.typeme.jung.content.JungPackageLoader;
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
 * </ol>
 */
@RestController
@RequestMapping("/api/v3")
public class JungController {

    private final JungPackageLoader loader;
    private final AttemptService attempts;
    private final ReportService reports;

    public JungController(JungPackageLoader loader, AttemptService attempts, ReportService reports) {
        this.loader = loader;
        this.attempts = attempts;
        this.reports = reports;
    }

    /* ── 内容 ───────────────────────────────────────────────────────────── */

    @GetMapping("/catalog/current")
    public ResponseEntity<JungDtos.CatalogResponse> catalog() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(JungDtos.catalog(loader));
    }

    @GetMapping("/catalog/current/package")
    public ResponseEntity<JungDtos.PackageResponse> currentPackage() {
        return ResponseEntity.ok()
                .eTag(loader.current().sha256())
                .cacheControl(CacheControl.noCache())
                .body(JungDtos.packageView(loader));
    }

    /* ── attempt ────────────────────────────────────────────────────────── */

    @PostMapping("/attempts")
    public ResponseEntity<JungDtos.AttemptSummary> createAttempt(
            @RequestBody(required = false) JungDtos.CreateAttemptRequest request) {
        String userId = requireUser();
        JungDtos.AttemptSummary summary = attempts.create(userId, request == null ? null : request.baseReportId());
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
        // 覆盖不足时返回 200 + NEEDS_REVIEW：这不是错误，是需要用户回看几道题
        return ResponseEntity.ok(response);
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
     * 导出属于"账号与数据"的职责，由账号模块（`com.typeme.account`）实现，一处入口一处口径。
     * 本服务提供 `ReportService#exportData(userId)` 供其复用，避免两份导出逻辑慢慢分叉
     * —— 两份导出最危险的分叉是"其中一份忘了剔除密码 hash / 恢复码 hash"。
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
