package com.typeme.ai.controller;

import com.typeme.ai.config.AiException;
import com.typeme.ai.input.AiTopic;
import com.typeme.ai.service.AnalysisService;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * {@code /api/v3} 的 AI 分析接口（契约 03 §2）。
 *
 * <p>五个端点：
 * <ul>
 *   <li>{@code POST /reports/{id}/analyses} —— 创建（必带 Idempotency-Key，返回 202）；</li>
 *   <li>{@code GET /analyses/{id}} —— 查询；</li>
 *   <li>{@code POST /analyses/{id}/retry} —— 重试（仅 FAILED/UNKNOWN）；</li>
 *   <li>{@code GET /reports/{id}/analyses} —— 该报告的全部任务；</li>
 *   <li>{@code GET /ai/status} —— 能力状态（**绝不回显 key**）。</li>
 * </ul>
 *
 * <p>userId 一律来自认证主体；创建接口的请求体里没有 owner/userId 字段，
 * 所以"以别人的身份创建分析"在结构上无从表达。响应一律 {@code Cache-Control: no-store}。
 */
@RestController
@RequestMapping("/api/v3")
public class AnalysisController {

    private final AnalysisService analyses;

    public AnalysisController(AnalysisService analyses) {
        this.analyses = analyses;
    }

    /* ── 创建 ───────────────────────────────────────────────────────────── */

    @PostMapping("/reports/{id}/analyses")
    public ResponseEntity<Map<String, Object>> create(
            @PathVariable("id") String reportId,
            @RequestHeader(name = "Idempotency-Key", required = false) String idempotencyKey,
            @RequestBody(required = false) AnalysisDtos.CreateAnalysisRequest request) {

        if (request == null) {
            throw AiException.invalidRequest("请求体不能为空：需要 consent 与 topic。");
        }
        // 同意字段缺失即 400 CONSENT_REQUIRED：没有确认就不能把任何内容发出去。
        if (request.consent() == null || isBlank(request.consent().policyVersion())) {
            throw AiException.consentRequired("请先确认要发送的分析范围（缺少同意版本）。");
        }
        AiTopic topic = AiTopic.parse(request.topic());

        AnalysisService.CreateResult result = analyses.create(
                AiCurrentUser.requireUserId(), reportId, topic, request.note(),
                request.consent().policyVersion(),
                request.consent().scopeVersion(),
                idempotencyKey);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", result.jobId());
        body.put("status", result.status());
        body.put("cached", result.cached());
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    /* ── 查询 ───────────────────────────────────────────────────────────── */

    @GetMapping("/analyses/{id}")
    public ResponseEntity<AnalysisService.JobView> get(@PathVariable("id") String jobId) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.VARY, "Cookie")
                .body(analyses.get(AiCurrentUser.requireUserId(), jobId));
    }

    @GetMapping("/reports/{id}/analyses")
    public ResponseEntity<Map<String, Object>> listByReport(@PathVariable("id") String reportId) {
        List<AnalysisService.JobView> items = analyses.listByReport(AiCurrentUser.requireUserId(), reportId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.VARY, "Cookie")
                .body(body);
    }

    /* ── 重试 ───────────────────────────────────────────────────────────── */

    @PostMapping("/analyses/{id}/retry")
    public ResponseEntity<Map<String, Object>> retry(@PathVariable("id") String jobId) {
        AnalysisService.RetryResult result = analyses.retry(AiCurrentUser.requireUserId(), jobId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("jobId", result.jobId());
        body.put("status", result.status());
        body.put("attemptCount", result.attemptCount());
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    /* ── 状态 ───────────────────────────────────────────────────────────── */

    /**
     * AI 能力状态。用于前端决定是否显示 AI 入口与剩余次数。
     *
     * <p>刻意只给 host（不给完整 baseUrl、不给路径、**绝不给 key**），
     * 并显式给出 {@code apiKeySource}：管理员后台配置（db）/环境变量（env）/未配置（none）。
     */
    @GetMapping("/ai/status")
    public ResponseEntity<Map<String, Object>> status() {
        AnalysisService.StatusView view;
        try {
            view = analyses.status(AiCurrentUser.requireUserId());
        } catch (AiException ex) {
            // 未登录时也给出"能不能用"的基础信息（前端登录页需要判断是否显示 AI 入口）。
            if (!"UNAUTHENTICATED".equals(ex.code())) {
                throw ex;
            }
            view = analyses.status(null);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("enabled", view.enabled());
        body.put("mock", view.mockMode());
        body.put("mockMode", view.mockMode());
        body.put("model", view.model());
        body.put("dailyLimitPerUser", view.dailyLimitPerUser());
        body.put("remainingToday", view.remainingToday());
        body.put("apiKeySource", view.apiKeySource());
        body.put("baseUrlHost", view.baseUrlHost());
        body.put("promptVersion", view.promptVersion());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .header(HttpHeaders.VARY, "Cookie")
                .body(body);
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
