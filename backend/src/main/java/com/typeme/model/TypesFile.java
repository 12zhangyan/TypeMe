package com.typeme.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * {@code content/types.yml} 的顶层结构包装（只是为了让 Jackson 能反序列化 {@code types:} 根节点）。
 *
 * <p>未知字段不放行（MI-3）：把根键写成 {@code type:} 之类的笔误会当场失败，而不是留下一个
 * 空的 {@code types} 让后面的校验去猜。
 */
public record TypesFile(

        @NotEmpty(message = "types 不能为空")
        @Valid
        List<TypeProfile> types
) {
}
