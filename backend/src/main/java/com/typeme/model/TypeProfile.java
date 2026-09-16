package com.typeme.model;

import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

/**
 * 单个类型的文案（对应 {@code content/types.yml} 的 {@code types[]} 元素）。
 *
 * <p>⚠️ 未知字段**不放行**（MI-3）：内容文件是唯一真相，字段名写错（例如 {@code nameCN}、
 * {@code blindspot}）必须当场失败，否则会静默丢字段 —— 接口返回的 JSON 少一段文案，
 * 而前端结构校验只看「类型对不对」，不会发现。
 * 新增展示字段时请同步改这个 record，不要靠忽略未知字段蒙混过去。
 */
public record TypeProfile(

        @NotBlank(message = "code 不能为空")
        String code,

        @NotBlank(message = "nameCn 不能为空")
        String nameCn,

        String tagline,

        Map<String, String> dimensions,

        List<String> strengths,

        List<String> blindSpots,

        List<String> resonance,

        List<String> growth
) {
}
