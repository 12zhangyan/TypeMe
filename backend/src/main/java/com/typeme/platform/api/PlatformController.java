package com.typeme.platform.api;

import com.typeme.jung.api.CurrentUser;
import com.typeme.jung.service.JungApiException;
import com.typeme.platform.catalog.AssessmentCatalog;
import com.typeme.platform.catalog.AssessmentRelease;
import com.typeme.platform.catalog.InstrumentKind;
import com.typeme.platform.service.BigFiveAttemptService;
import com.typeme.platform.service.BigFiveReportService;
import com.typeme.platform.service.PlatformQueryService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * `/api/v3/platform`：**量表无关**的测评流程入口。
 *
 * <p>为什么另开一组路径而不是改造 `/api/v3/catalog` 与 `/api/v3/attempts`：
 * 那些接口的响应体（{@code PackageResponse}、{@code AttemptDetail}）在结构上就是
 * 十六型的形状 —— 四个维度、双极题、类型码。大五塞进去只有两条路：
 * 伪造四个维度，或者让每个字段都可能为 null。两者都会让前端"看起来能跑但读错"。
 * 新路径的响应体是中性的（{@link PlatformDtos}），旧路径**保持不变**，
 * 于是已有前端不需要在同一轮里被改完。
 *
 * <p>鉴权与 CSRF 不需要在这里另写：Spring Security 只对 {@code /api/v3/**} 收紧，
 * 而这里的路径全部落在它下面，因此"要登录 + 写操作要 CSRF token"自动成立。
 * {@link #requireUser()} 是第二道防线，防止将来安全配置被改松。
 */
@RestController
@RequestMapping("/api/v3/platform")
public class PlatformController {

    private final AssessmentCatalog catalog;
    private final BigFiveAttemptService bigFiveAttempts;
    private final BigFiveReportService bigFiveReports;
    private final PlatformQueryService queries;

    public PlatformController(
            AssessmentCatalog catalog,
            BigFiveAttemptService bigFiveAttempts,
            BigFiveReportService bigFiveReports,
            PlatformQueryService queries) {
        this.catalog = catalog;
        this.bigFiveAttempts = bigFiveAttempts;
        this.bigFiveReports = bigFiveReports;
        this.queries = queries;
    }

    /* ── 目录（需登录，但不含任何个人信息） ──────────────────────────────── */

    /**
     * 站点上全部测评。
     *
     * <p><b>公开</b>（`SecurityConfig` 里对这两条只读路径单独 permitAll）：
     * 响应只含产品定义与当前版本号，没有任何用户数据；而"站上有哪些测评、每项问什么"
     * 正是用户决定要不要注册的依据。把它锁在登录后等于要求用户先交账号再了解产品。
     *
     * <p>这里**刻意不调用** {@code requireUser()}：那个辅助方法是给"必须知道是谁"的
     * 接口用的，在这里调用会让公开接口在未登录时抛 401，与上面的配置自相矛盾。
     */
    @GetMapping("/instruments")
    public ResponseEntity<PlatformDtos.InstrumentListResponse> instruments() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(queries.instruments());
    }

    /**
     * 一项测评的详情：能了解什么、不适合做什么、每个维度两侧各是什么样、有哪些版本。
     *
     * <p>公开理由同上。
     */
    @GetMapping("/instruments/{slug}")
    public ResponseEntity<PlatformDtos.InstrumentDetail> instrument(@PathVariable("slug") String slug) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(queries.instrument(slug));
    }

    /* ── 大五草稿与答题 ─────────────────────────────────────────────────── */

    /**
     * 开始一次大五测评。
     *
     * <p>绑定的内容版本由**目录的默认版本**决定（请求只能指定哪一项测评，
     * 不能指定哪一版）—— 允许客户端指定 packageId 等于允许它挑一份旧题面来答。
     */
    @PostMapping("/attempts")
    public ResponseEntity<PlatformDtos.AttemptView> createAttempt(
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) PlatformDtos.CreateAttemptRequest request) {
        String userId = requireUser();
        String slug = request == null || request.instrument() == null || request.instrument().isBlank()
                ? "bigfive50"
                : request.instrument().trim();
        AssessmentRelease release;
        try {
            release = catalog.defaultRelease(slug);
        } catch (IllegalArgumentException ex) {
            throw JungApiException.notFound("要开始的测评：" + slug);
        }
        if (release.kind() != InstrumentKind.BIG_FIVE) {
            throw JungApiException.invalid(
                    "这个入口只能开始大五倾向测评，实际是 " + slug + "（" + release.kind().code()
                            + "）。请使用 /api/v3/attempts。");
        }
        PlatformDtos.AttemptView created = bigFiveAttempts.create(
                userId, request == null ? null : request.baseReportId(), idempotencyKey, release);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /** 草稿详情（含题目）。答题页只需要这一次请求（**不含**任何计分字段）。 */
    @GetMapping("/attempts/{attemptId}")
    public ResponseEntity<PlatformDtos.AttemptView> attempt(@PathVariable("attemptId") String attemptId) {
        return ResponseEntity.ok(bigFiveAttempts.detail(requireUser(), attemptId));
    }

    /** 合并保存答案。并发冲突返回 409 与当前 revision，不静默覆盖。 */
    @PatchMapping("/attempts/{attemptId}/answers")
    public ResponseEntity<PlatformDtos.PatchAnswersResponse> patchAnswers(
            @PathVariable("attemptId") String attemptId,
            @RequestBody PlatformDtos.PatchAnswersRequest request) {
        return ResponseEntity.ok(bigFiveAttempts.patchAnswers(requireUser(), attemptId, request));
    }

    /**
     * 提交并生成报告。
     *
     * <p>还有题没处理过时返回 200 + {@code status=INCOMPLETE} 与缺题号，
     * 而不是 4xx：用户没有做错任何事，只是还没答完，前端应回到答题页。
     */
    @PostMapping("/attempts/{attemptId}/submit")
    public ResponseEntity<PlatformDtos.SubmitResponse> submit(
            @PathVariable("attemptId") String attemptId,
            @RequestBody(required = false) PlatformDtos.SubmitRequest request) {
        return ResponseEntity.ok(bigFiveReports.submit(requireUser(), attemptId, request));
    }

    /* ── 我的测评 / 我的报告 / 报告详情 ─────────────────────────────────── */

    @GetMapping("/attempts")
    public ResponseEntity<PlatformDtos.MyAttemptListResponse> myAttempts(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        return ResponseEntity.ok(queries.myAttempts(requireUser(), page, size));
    }

    @GetMapping("/reports")
    public ResponseEntity<PlatformDtos.MyReportListResponse> myReports(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        return ResponseEntity.ok(queries.myReports(requireUser(), page, size));
    }

    /** 报告详情：**原样**返回提交时冻结的快照，同时给出渲染需要的量表与种类信息。 */
    @GetMapping("/reports/{reportId}")
    public ResponseEntity<PlatformDtos.ReportDetailView> report(@PathVariable("reportId") String reportId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(queries.report(requireUser(), reportId));
    }

    @GetMapping("/attempts/{attemptId}/report")
    public ResponseEntity<PlatformDtos.ReportDetailView> reportByAttempt(
            @PathVariable("attemptId") String attemptId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .body(queries.reportByAttempt(requireUser(), attemptId));
    }

    /* ── 内部 ───────────────────────────────────────────────────────────── */

    /**
     * 取当前用户；取不到即 401。
     *
     * <p>与 {@code JungController#requireUser} 同一性质：主鉴权在 Spring Security
     * 的过滤器链上，这里是防御性的第二道，避免"安全配置被改松"时拿 null 去查数据。
     */
    private String requireUser() {
        String userId = CurrentUser.requireUserId();
        if (userId == null || userId.isBlank()) {
            throw new JungApiException("UNAUTHENTICATED", 401, "请先登录。");
        }
        return userId;
    }
}
