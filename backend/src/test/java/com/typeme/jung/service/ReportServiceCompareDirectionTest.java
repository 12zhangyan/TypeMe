package com.typeme.jung.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 比较接口的「方向是否不同」判定。
 *
 * <p>2026-10-18 审查（IM-1）：旧写法是 {@code samePackage && !Objects.equals(fromPole, toPole)}，
 * 某一维在一份报告里是平分（{@code computedPole == null}）、另一份里有方向时，
 * 会被判成 {@code changed=true}，比较页于是显示「方向不同」——可实际上这一维
 * 根本没有两个方向可比较。这里把判定收成「两侧都有方向且不同」。
 */
class ReportServiceCompareDirectionTest {

    @Test
    @DisplayName("两侧都有方向且不同，才算方向不同")
    void onlyTwoRealOppositeDirectionsCountAsChanged() {
        assertThat(ReportService.directionChanged(true, "E", "I")).isTrue();
    }

    @Test
    @DisplayName("同一方向、任一侧缺方向、或版本不同，都不标记变化")
    void unchangedOrUndeterminedSidesAreNotMarkedAsChanged() {
        assertThat(ReportService.directionChanged(true, "E", "E")).isFalse();
        assertThat(ReportService.directionChanged(true, "E", null)).isFalse();
        assertThat(ReportService.directionChanged(true, null, "I")).isFalse();
        assertThat(ReportService.directionChanged(true, null, null)).isFalse();
        assertThat(ReportService.directionChanged(false, "E", "I")).isFalse();
    }
}
