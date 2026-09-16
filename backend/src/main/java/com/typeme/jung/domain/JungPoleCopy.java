package com.typeme.jung.domain;

/** 一端的展示文案。两端等值：结构上没有任何字段可以表达"哪端更好"。 */
public record JungPoleCopy(
        JungPole pole,
        String label,
        String description,
        java.util.List<String> dailySigns) {
}
