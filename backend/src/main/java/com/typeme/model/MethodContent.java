package com.typeme.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 方法说明页内容（对应 {@code content/method.yml}，由 {@code GET /api/v1/method} 下发）。
 *
 * <p>{@link Attribution} 是 CC BY-NC-SA 的硬性署名义务，会同时出现在 {@code GET /api/v1/meta} 中。
 *
 * <p>⚠️ 未知字段不放行（MI-3）：这是**许可声明本身**，一个拼错的键（{@code licenseURL}）
 * 会让署名义务静默丢失，而校验完全看不见。
 */
public record MethodContent(

        @NotNull(message = "attribution 不能为空")
        @Valid
        Attribution attribution,

        @NotEmpty(message = "sections 不能为空")
        @Valid
        List<MethodSection> sections
) {

    /** 题库归属信息（CC BY 的署名义务）。 */
    public record Attribution(

            @NotBlank(message = "source 不能为空")
            String source,

            @NotBlank(message = "author 不能为空")
            String author,

            @NotBlank(message = "url 不能为空")
            String url,

            @NotBlank(message = "license 不能为空")
            String license,

            @NotBlank(message = "licenseUrl 不能为空")
            String licenseUrl
    ) {
    }

    /** 方法说明页的一节。{@code body} 是单段纯文本，前端按普通段落渲染。 */
    public record MethodSection(

            @NotBlank(message = "title 不能为空")
            String title,

            @NotBlank(message = "body 不能为空")
            String body
    ) {
    }
}
