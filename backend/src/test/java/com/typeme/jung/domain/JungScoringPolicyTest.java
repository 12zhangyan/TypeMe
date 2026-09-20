package com.typeme.jung.domain;

import com.typeme.jung.content.JungPackage;
import com.typeme.jung.content.JungPackageLoader;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 阈值政策的**独立**边界回归：把 {@code T(n)} 与 {@code B(n)} 当成两个函数逐点钉住，
 * 并且同时钉住**两套口径**。
 *
 * <p>为什么要在共享夹具之外再写一份：夹具只能覆盖"某一维恰好被造成 n 与 S"的那几种组合，
 * 而阈值是一个**对每个 n 都有定义**的函数 —— 等号在闭区间哪一侧、{@code n=0} 怎么退化、
 * 阈值在哪一步跳档、旧版本会不会被顺手改掉，这些都可能在夹具覆盖不到的 n 上出错。
 *
 * <h2>两套口径（2026-09-18 起并存）</h2>
 * <ul>
 *   <li>{@code typeme-jung48-score-v3}（当前，已批准的政策调整）：
 *       {@code T(n) = B(n) = floor(2n/10)}，边界另要求 {@code n > 0}。</li>
 *   <li>{@code typeme-jung48-score-v1} / {@code -v2}（历史，行为冻结）：
 *       {@code T(n) = floor(2n/10)}、{@code B(n) = max(0, T(n) − 1)}。</li>
 * </ul>
 * 两者只差 {@code |S| = T(n)} 这一格（外加 v3 在 {@code n = 0} 上的收紧）；
 * 触发条件完全相同，所以这次调整不会让任何人多答一道补充题。
 *
 * <p><b>这不是"更准"的改动。</b>归一化界限取 0.10 本身没有本次可核验的信度/效度依据，
 * 保留它只是为了减少规则变动与答题负担；选哪一条界限是产品取舍。本类通过只说明
 * "实现符合当前记录的规则"，不说明阈值选得对、更不说明测量有效。
 *
 * <p>边界范围（"两套规格差在哪一格"）在 2026-09-18 另有一次勘误：开发方案的
 * {@code 5|S| <= 2n}（{@code |S| <= floor(0.4n)}）与现行 {@code |S| <= B(n)} 相差的是
 * **一整段区间** {@code B(n) < |S| <= floor(0.4n)}，不是单个值。见
 * {@code docs/2026-09-16/implementation/_contracts/01-新测契约-v1.md} §4.1；
 * 本类最后两条用例把这两件事变成机械断言，避免它们再被口头简化。
 */
class JungScoringPolicyTest {

    /** 当前政策：v3，边界与触发同一条尺度。 */
    private static final JungScoringPolicy POLICY =
            new JungScoringPolicy("typeme-jung48-score-v3", 9, 2, 10, 1, 5, 3);

    /** 历史政策 v2（与当前包同分子/分母，只有边界口径不同）。 */
    private static final JungScoringPolicy LEGACY_V2 =
            new JungScoringPolicy("typeme-jung48-score-v2", 9, 2, 10, 1, 5, 3);

    /** 历史政策 v1。 */
    private static final JungScoringPolicy LEGACY_V1 =
            new JungScoringPolicy("typeme-jung48-score-v1", 9, 2, 10, 1, 5, 3);

    @Test
    @DisplayName("v3：T(n)=B(n)=floor(2n/10) 的逐点表（n=0..40）")
    void unifiedScalePerPoint() {
        for (int n = 0; n <= 40; n++) {
            int expected = n <= 0 ? 0 : Math.floorDiv(2 * n, 10);
            assertEquals(expected, POLICY.triggerThreshold(n), "T(" + n + ") 触发阈值");
            assertEquals(expected, POLICY.boundaryThreshold(n), "B(" + n + ")=T(" + n + ") 边界阈值");
        }

        // 几处"跳档点"单独写出来：改分母/分子时这几行最先红，比看循环更直观。
        assertEquals(1, POLICY.triggerThreshold(9), "T(9)=1：9 题是覆盖下限，这一档也存在「较轻」区间");
        assertEquals(1, POLICY.boundaryThreshold(9), "B(9)=1（旧规则下这里是 0）");
        assertEquals(2, POLICY.triggerThreshold(10), "T(10)=2：n=9→10 跳一档");
        assertEquals(2, POLICY.boundaryThreshold(10), "B(10)=2");
        assertEquals(2, POLICY.triggerThreshold(14), "T(14)=2");
        assertEquals(3, POLICY.triggerThreshold(15), "T(15)=3：第二次跳档");
        assertEquals(3, POLICY.boundaryThreshold(15), "B(15)=3");
    }

    @Test
    @DisplayName("历史版本 v1/v2 行为冻结：T(n)=floor(2n/10)，B(n)=max(0,T(n)−1)")
    void legacyVersionsKeepSeparateBoundary() {
        for (JungScoringPolicy legacy : new JungScoringPolicy[] {LEGACY_V1, LEGACY_V2}) {
            assertFalse(legacy.unifiedBoundaryScale(), legacy.version() + " 必须仍用「触发 − 1」的口径");
            for (int n = 0; n <= 40; n++) {
                int trigger = n <= 0 ? 0 : Math.floorDiv(2 * n, 10);
                assertEquals(trigger, legacy.triggerThreshold(n), legacy.version() + " T(" + n + ")");
                assertEquals(Math.max(0, trigger - 1), legacy.boundaryThreshold(n),
                        legacy.version() + " B(" + n + ")：旧包/旧草稿/旧报告继续按这一套");
            }
        }
        // 冻结的具体表现：n=12、|S|=2 在旧规则下是"明确"，在 v3 下是"较轻"。
        assertFalse(LEGACY_V2.isBoundary(2, 12), "旧规则 B(12)=1，|S|=2 越出带");
        assertTrue(POLICY.isBoundary(2, 12), "v3 B(12)=2，|S|=2 落在带上（闭区间）");
    }

    @Test
    @DisplayName("边界是闭区间、与 S 正负无关；v3 要求 n>0，历史版本在 n=0 上保持原样")
    void boundaryClosedAndNonZeroRequirement() {
        for (int n : new int[] {1, 5, 9, 10, 12, 16, 20, 24}) {
            int boundary = POLICY.boundaryThreshold(n);
            assertTrue(POLICY.isBoundary(boundary, n),
                    "|S| 恰好等于 B(" + n + ")=" + boundary + " 必须算边界（闭区间）");
            assertTrue(POLICY.isBoundary(-boundary, n), "边界判定必须与 S 的正负无关");
            assertFalse(POLICY.isBoundary(boundary + 1, n),
                    "|S|=B(" + n + ")+1 已经越出边界带");
        }

        // n=0：v3 明确不算边界（没有有效数字回答就没有"较轻的倾向"）。
        assertEquals(0, POLICY.triggerThreshold(0));
        assertEquals(0, POLICY.boundaryThreshold(0));
        assertFalse(POLICY.isBoundary(0, 0), "v3 在 n=0 时不得标记边界");
        assertFalse(POLICY.isBoundary(1, 0), "n=0 时任何非零 S 都不算边界");
        // 历史版本保持原来的退化行为（行为冻结，不是"顺手修好"）。
        assertTrue(LEGACY_V1.isBoundary(0, 0), "v1 在 n=0 上维持原样");
        assertTrue(LEGACY_V2.isBoundary(0, 0), "v2 在 n=0 上维持原样");

        // 负数 n 不属于合法输入，但函数必须稳定（不能抛异常、不能变成正阈值）。
        assertEquals(0, POLICY.triggerThreshold(-1));
        assertEquals(0, POLICY.boundaryThreshold(-1));
        assertFalse(POLICY.isBoundary(0, -1));
    }

    @Test
    @DisplayName("未知计分版本在构造期直接拒绝，不静默落回某一套规则")
    void unknownVersionIsRejected() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> new JungScoringPolicy("typeme-jung48-score-v9", 9, 2, 10, 1, 5, 3));
        assertTrue(error.getMessage().contains("typeme-jung48-score-v9"),
                "报错必须点出未知版本，实际：" + error.getMessage());
        assertTrue(error.getMessage().contains("typeme-jung48-score-v3"),
                "报错必须列出已知版本，实际：" + error.getMessage());
        assertThrows(IllegalArgumentException.class,
                () -> new JungScoringPolicy(null, 9, 2, 10, 1, 5, 3),
                "version 为 null 也必须拒绝");

        assertTrue(JungScoringPolicy.knownVersions().containsAll(
                        java.util.List.of("typeme-jung48-score-v1", "typeme-jung48-score-v2",
                                "typeme-jung48-score-v3")),
                "已知版本表必须列出全部已登记版本，实际：" + JungScoringPolicy.knownVersions());
    }

    @Test
    @DisplayName("两个版本只差 |S|=T(n) 这一格；B(n) 单调不减且不超过 T(n)")
    void versionsDifferByExactlyOneCell() {
        int previousBoundary = -1;
        for (int n = 0; n <= 60; n++) {
            int trigger = POLICY.triggerThreshold(n);
            int boundary = POLICY.boundaryThreshold(n);
            assertTrue(trigger >= 0 && boundary >= 0, "阈值不得为负，n=" + n);
            assertTrue(boundary <= trigger, "B(n) 不得超过 T(n)，n=" + n);
            assertTrue(boundary >= previousBoundary, "B(n) 必须单调不减，n=" + n);
            assertEquals(trigger, boundary, "v3 下 B(n) 与 T(n) 必须同值，n=" + n);

            int legacy = LEGACY_V2.boundaryThreshold(n);
            assertEquals(trigger >= 1 ? 1 : 0, boundary - legacy,
                    "两个版本只能差 |S|=T(n) 这一格（触发档为 0 时不差），n=" + n);
            if (trigger >= 1) {
                // 这一格正是 CASE-09：v3 判"较轻"，旧规则判"明确"。
                assertTrue(POLICY.isBoundary(trigger, n), "v3 下 |S|=T(" + n + ") 应算边界");
                assertFalse(LEGACY_V2.isBoundary(trigger, n), "旧规则下 |S|=T(" + n + ") 不算边界");
            }
            previousBoundary = boundary;
        }
    }

    @Test
    @DisplayName("当前内容包自带的 scoringPolicy 就是 v3，且与这里钉住的表一致")
    void shippedPackagePolicyMatchesPinnedTable() {
        JungPackage pkg = new JungPackageLoader(new DefaultResourceLoader()).current();
        assertNotNull(pkg, "默认内容包必须能加载");
        JungScoringPolicy shipped = pkg.scoringPolicy();

        assertEquals("typeme-jung48-score-v3", shipped.version(),
                "默认内容包必须声明 v3 —— 换默认包与换规则是同一个决定");
        assertTrue(shipped.unifiedBoundaryScale(), "默认内容包必须走统一尺度");
        assertEquals(9, shipped.minBaseRatingsPerDimension(), "每维最少主测数字回答数（未改）");
        assertEquals(1, shipped.ratingMin(), "量表下端（未改）");
        assertEquals(5, shipped.ratingMax(), "量表上端（未改）");
        assertEquals(3, shipped.ratingNeutral(), "中立档：计入 n，贡献 0（未改）");
        assertEquals(2, shipped.boundaryNumerator(), "触发阈值分子（内容包声明值，未改）");
        assertEquals(10, shipped.boundaryDenominator(), "触发阈值分母（内容包声明值，未改）");

        for (int n = 0; n <= 40; n++) {
            assertEquals(POLICY.triggerThreshold(n), shipped.triggerThreshold(n),
                    "内容包声明的政策与契约表不一致，n=" + n);
            assertEquals(POLICY.boundaryThreshold(n), shipped.boundaryThreshold(n),
                    "内容包声明的政策与契约表不一致，n=" + n);
        }
    }

    @Test
    @DisplayName("默认内容包声明的报告文案版本必须真的能被解析（不是只看默认常量对不对）")
    void currentPackageReportContentVersionResolves() {
        JungPackageLoader loader = new JungPackageLoader(new DefaultResourceLoader());
        JungPackage pkg = loader.current();

        // 运行期取报告文案用的是**包自己声明的版本**，所以这里钉住的是"声明"与"取得到"两件事，
        // 而不是那个历史默认常量。
        //
        // v3 声明的是 **v1**：本次只换计分口径，报告文案保持"今天新草稿实际在用的那一版"。
        // 更新的 v2 报告文案带 readableSummary / readableFirstSteps，会让服务端把
        // "八段 + 3 条成长行动"换成"一句话摘要 + 1 个可观察动作" —— 那是另一条在途改造，
        // 不该由换计分口径顺带推上线。要改这一行，等于同时改用户看到的报告结构。
        assertEquals("typeme-type-report-zh-v1", pkg.reportContentVersion(),
                "v3 引用的报告文案版本变了就必须同时改这里与内容包");
        JungPackageLoader.TypeReportContent resolved = loader.findTypeReports(pkg.reportContentVersion());
        assertNotNull(resolved,
                "默认包声明的报告文案版本 " + pkg.reportContentVersion() + " 必须已加载"
                        + "（取不到时加载器会在启动期抛异常，这里把同一件事钉在测试里）");
        assertEquals(pkg.reportContentVersion(), resolved.reportContentVersion(),
                "取回来的文案版本必须与包声明的版本逐字一致");

        // 其余版本同样按包声明解析；已发布过的文案不会因为换了默认包而消失。
        assertNotNull(loader.findTypeReports("typeme-type-report-zh-v2"),
                "v2 报告文案必须继续可加载：v2 草稿与已生成报告仍要按它们自己的版本解释");
    }

    @Test
    @DisplayName("「只把分子改成 4」不等于恢复开发方案的边界口径（勘误的机械版本）")
    void changingNumeratorAloneIsNotTheOriginalRule() {
        // 开发方案 §3.4 第 4 条：5×|S| <= 2n，等价于 |S| <= floor(0.4n)。
        // 现行契约（v3）：|S| <= B(n) = floor(0.2n)。
        // 只把分子改成 4 但保留历史版本的 B=T−1，得到的又是第三条规则，三者不能互相替代。
        JungScoringPolicy numeratorFourLegacyScale =
                new JungScoringPolicy("typeme-jung48-score-v1", 9, 4, 10, 1, 5, 3);

        for (int n : new int[] {9, 12, 16}) {
            int original = (int) Math.floor(0.4 * n);        // 开发方案边界（浮点仅用于小整数，等价于 floor(2n/5)）
            assertEquals(Math.floorDiv(2 * n, 5), original, "floor(0.4n) 必须等于 floor(2n/5)");
            int current = POLICY.boundaryThreshold(n);
            int numeratorFourBoundary = numeratorFourLegacyScale.boundaryThreshold(n);

            assertTrue(original > current, "开发方案边界必须比现行边界宽，n=" + n);
            assertEquals(Math.floorDiv(4 * n, 10) - 1, numeratorFourBoundary,
                    "只改分子时边界仍是 T−1，n=" + n);

            // 差异是一整段区间 B(n) < |S| <= floor(0.4n)，不是单个值。
            for (int s = current + 1; s <= original; s++) {
                assertTrue(Math.abs(s) <= original, "原方案应把 |S|=" + s + " 算作边界，n=" + n);
                assertFalse(POLICY.isBoundary(s, n), "现行规则不应把 |S|=" + s + " 算作边界，n=" + n);
            }
        }

        // 具体分歧点：n=12 时原方案到 |S|=4，现行（v3）到 2，"分子 4 + B=T−1"只到 3。
        assertEquals(2, POLICY.boundaryThreshold(12));
        assertEquals(3, numeratorFourLegacyScale.boundaryThreshold(12));
        assertEquals(4, Math.floorDiv(2 * 12, 5));
        assertFalse(numeratorFourLegacyScale.isBoundary(4, 12),
                "|S|=4 在「分子 4 + B=T−1」下仍不是边界 —— 所以那不是原方案的口径");
    }
}
