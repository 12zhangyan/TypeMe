package com.typeme.model;

import java.util.List;

/**
 * {@code GET /api/v1/meta} 的响应体。
 *
 * <p>{@code attribution} 与 {@code GET /api/v1/method} 用的是同一份内容，
 * 保证署名信息只有一个来源。
 */
public record MetaResponse(

        String appVersion,

        String contentVersion,

        List<String> questionnaireVersions,

        MethodContent.Attribution attribution
) {
}
