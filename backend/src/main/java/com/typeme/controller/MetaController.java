package com.typeme.controller;

import com.typeme.model.MetaResponse;
import com.typeme.model.MethodContent;
import com.typeme.service.ContentService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v1/meta} 与 {@code GET /api/v1/method}。
 *
 * <p>两者都归在站点级元信息里：{@code /meta} 给版本与署名（署名是 CC BY 的硬性义务，
 * 必须由接口下发并在前端展示），{@code /method} 给方法说明页正文。
 */
@RestController
@RequestMapping("/api/v1")
public class MetaController {

    private final ContentService contentService;
    private final String appVersion;
    private final String contentVersion;

    public MetaController(ContentService contentService,
                          @Value("${typeme.app-version:dev}") String appVersion,
                          @Value("${typeme.content-version:unknown}") String contentVersion) {
        this.contentService = contentService;
        this.appVersion = appVersion;
        this.contentVersion = contentVersion;
    }

    @GetMapping("/meta")
    public MetaResponse meta() {
        return new MetaResponse(
                appVersion,
                contentVersion,
                contentService.questionnaireVersions(),
                contentService.method().attribution());
    }

    @GetMapping("/method")
    public MethodContent method() {
        return contentService.method();
    }
}
