package com.typeme.controller;

import com.typeme.model.Questionnaire;
import com.typeme.service.ContentService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code GET /api/v1/questionnaires/{version}} —— 下发题库。
 *
 * <p>返回体里的 {@code scoring} 与 {@code questions} 必须原样驱动前端计分，
 * 前端不得硬编码题号、符号或常量（任务拆解 1.4）。
 */
@RestController
@RequestMapping("/api/v1/questionnaires")
public class QuestionnaireController {

    private final ContentService contentService;

    public QuestionnaireController(ContentService contentService) {
        this.contentService = contentService;
    }

    @GetMapping("/{version}")
    public ResponseEntity<Questionnaire> questionnaire(@PathVariable String version) {
        return contentService.findQuestionnaire(version)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
