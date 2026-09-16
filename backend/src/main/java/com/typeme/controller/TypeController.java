package com.typeme.controller;

import com.typeme.model.TypeProfile;
import com.typeme.service.ContentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v1/types/{code}} —— 下发单个类型的文案。
 *
 * <p>类型码大小写不敏感；未知类型码返回 404。
 */
@RestController
@RequestMapping("/api/v1/types")
public class TypeController {

    private final ContentService contentService;

    public TypeController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping("/{code}")
    public ResponseEntity<TypeProfile> type(@PathVariable String code) {
        return contentService.findType(code)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
