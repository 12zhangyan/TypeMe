package com.typeme.controller;

import com.typeme.model.AssessmentPackage;
import com.typeme.model.ContentErrorBody;
import com.typeme.service.ContentService;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v2/assessment-packages/{packageId}} —— 下发一整个不可变内容包
 * （字段规格 §9、开发方案 §5）。
 *
 * <p>只读、无鉴权、无写接口、不接收任何答案：题干、逐题帮助、维度解释、报告文案与解释政策
 * 必须**整体锁定在同一个包**里，否则版本会悄悄错配（这正是本端点存在的理由）。
 *
 * <p>身份与错误（逐字契约）：
 * <ul>
 *   <li>命中 → {@code 200} + {@code application/json} + 包对象；</li>
 *   <li>未知 / 未注册 → {@code 404} + {@code {"code":"ASSESSMENT_PACKAGE_NOT_FOUND","message":"该版本暂不可用"}}；</li>
 *   <li>服务异常 → {@code 500} + {@code {"code":"CONTENT_UNAVAILABLE","message":"内容暂时不可用"}}，
 *       <b>绝不</b>回传文件路径、堆栈或异常消息。</li>
 * </ul>
 *
 * <p>{@code packageId} 只在 {@link ContentService} 已加载的注册表里查（白名单解析），
 * 不会被拼进任何 classpath 路径，因此 {@code ../} 之类的输入只会得到 404。
 */
@RestController
@RequestMapping("/api/v2/assessment-packages")
public class AssessmentPackageController {

    /** 未知 / 未注册包的错误码，前端按它决定「用同 packageId 的内置副本」还是「显示不可用」。 */
    public static final String CODE_NOT_FOUND = "ASSESSMENT_PACKAGE_NOT_FOUND";

    /** 未知 / 未注册包的固定文案。 */
    public static final String MESSAGE_NOT_FOUND = "该版本暂不可用";

    /** 服务端异常的固定错误码。 */
    public static final String CODE_UNAVAILABLE = "CONTENT_UNAVAILABLE";

    /** 服务端异常的固定文案。 */
    public static final String MESSAGE_UNAVAILABLE = "内容暂时不可用";

    private final ContentService contentService;

    public AssessmentPackageController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping(value = "/{packageId}", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> assessmentPackage(@PathVariable String packageId) {
        try {
            return contentService.findAssessmentPackage(packageId)
                    .<ResponseEntity<?>>map(ResponseEntity::ok)
                    .orElseGet(AssessmentPackageController::notFound);
        } catch (RuntimeException e) {
            // 刻意不回传 e.getMessage()：它可能包含 classpath 路径或解析细节。
            // 详情只进服务端日志，客户端只拿固定错误码与固定文案。
            return failure();
        }
    }

    /** 未知 / 未注册包：404 + 固定 JSON 体（不得退化成 HTML 错误页）。 */
    private static ResponseEntity<ContentErrorBody> notFound() {
        return ResponseEntity.status(404)
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ContentErrorBody(CODE_NOT_FOUND, MESSAGE_NOT_FOUND));
    }

    /** 服务异常：500 + 固定 JSON 体。 */
    private static ResponseEntity<ContentErrorBody> failure() {
        return ResponseEntity.status(500)
                .contentType(MediaType.APPLICATION_JSON)
                .body(new ContentErrorBody(CODE_UNAVAILABLE, MESSAGE_UNAVAILABLE));
    }
}
