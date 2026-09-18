package com.typeme.ipip.scoring;

import com.typeme.ipip.content.BigFivePackage;
import com.typeme.ipip.domain.BigFiveDimension;
import com.typeme.ipip.domain.BigFiveItem;
import com.typeme.ipip.domain.BigFiveScoringPolicy;
import com.typeme.jung.domain.JungAnswer;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 大五权威计分（scoringVersion = {@code ipip-bfm50-1.0}，与内容包声明一致）。
 *
 * <p>纯函数：不读文件、不读数据库、不取时间、不打日志。这条纪律与 {@link com.typeme.jung.scoring.JungScorer}
 * 相同，目的是让"同一份答卷在 Java 与 TypeScript 两套实现里得到同一个结果"可以被交叉验证。
 *
 * <p>规则（逐字来自内容包的 {@code scoringPolicy}，不在这里写死任何数字）：
 *
 * <pre>
 *   score(dim) = constant(dim) + Σ direction_i × rating_i
 *   n(dim)     = 有效数字回答数（rating = 3 计入；unknown 与未作答都不计入）
 *   distance   = score − midpoint
 * </pre>
 *
 * <p><b>三种"没答"必须分开处理</b>（这是最容易做错的地方）：
 * <ul>
 *   <li>未作答 = 答案集合里没有这一题 → 该维 {@code unprocessedCount++}，**不补中点**；</li>
 *   <li>「说不好」= 显式 unknown → 该维 {@code unknownCount++}，**也不补中点**；</li>
 *   <li>中立档 = rating 3 → 是**有效回答**，贡献 0 分，但计入 n。</li>
 * </ul>
 * 把前两者当成 3 会让"没答完"看起来像"答完了而且都在中间"，这正是要避免的。
 *
 * <p>大五**没有澄清题**：某维有效作答不足就是证据不足，报告只给该维的"还看不出方向"，
 * 不用补充题把分数凑出来。
 */
public final class BigFiveScorer {

    private BigFiveScorer() {
    }

    /** 单题贡献：{@code direction × (rating − neutral)}；与常量无关，供测试与前端预览对齐。 */
    public static int centeredContribution(BigFiveItem item, int rating) {
        return item.direction() * (rating - 3);
    }

    /**
     * 计分。
     *
     * @param pkg     内容包（提供常量、中点与分档阈值）
     * @param answers 题号 → 答案；缺失即"未作答"
     */
    public static BigFiveResult score(BigFivePackage pkg, Map<String, JungAnswer> answers) {
        BigFiveScoringPolicy policy = pkg.scoringPolicy();
        List<BigFiveResult.DimensionResult> dimensions = new ArrayList<>(BigFiveDimension.ordered().size());
        List<BigFiveDimension> incomplete = new ArrayList<>();
        int unknownTotal = 0;
        int unprocessedTotal = 0;
        boolean completed = true;

        for (BigFiveDimension dimension : BigFiveDimension.ordered()) {
            List<BigFiveItem> items = pkg.items(dimension);
            int valid = 0;
            int unknown = 0;
            int unprocessed = 0;
            int sum = 0;
            for (BigFiveItem item : items) {
                JungAnswer answer = answers.get(item.id());
                if (answer == null) {
                    // 未作答：**不计入 n，也不当成中点**。它只说明这一份答卷还不完整。
                    unprocessed++;
                    continue;
                }
                if (!answer.isRating()) {
                    // 「说不好」：与未作答同样是"没有证据"，但它是用户**明确**表达的，
                    // 所以分开计数，让报告可以说清"你标了 3 题说不好"而不是"有 3 题没答"。
                    unknown++;
                    continue;
                }
                valid++;
                sum += item.direction() * answer.rating();
            }

            unknownTotal += unknown;
            unprocessedTotal += unprocessed;
            if (unprocessed > 0) {
                completed = false;
            }

            // constant 是反向题的补偿项，不是中点；逐题取端点才是可达量程。
            int low = policy.constantOf(dimension);
            int high = policy.constantOf(dimension);
            for (BigFiveItem item : items) {
                low += item.direction() * (item.direction() > 0 ? 1 : 5);
                high += item.direction() * (item.direction() > 0 ? 5 : 1);
            }
            boolean enough = valid >= policy.minBaseRatingsPerDimension();
            if (!enough) {
                incomplete.add(dimension);
                dimensions.add(new BigFiveResult.DimensionResult(
                        dimension, null, valid, unknown, unprocessed, low, high, null, null));
                continue;
            }

            int raw = policy.constantOf(dimension) + sum;
            int distance = raw - policy.midpoint();
            dimensions.add(new BigFiveResult.DimensionResult(
                    dimension, raw, valid, unknown, unprocessed, low, high, distance,
                    levelOf(policy, distance)));
        }

        return new BigFiveResult(
                policy.version(),
                List.copyOf(dimensions),
                completed,
                incomplete.isEmpty(),
                List.copyOf(incomplete),
                unknownTotal,
                unprocessedTotal);
    }

    /**
     * 分档：只看离中点的距离与两个展示阈值。
     *
     * <p>阈值的含义是"这一维的倾向有多明显"，不是"你比多少人高"。
     * 阈值相等时取更保守的一档（{@code <} 而不是 {@code <=}）。
     */
    public static BigFiveResult.Level levelOf(BigFiveScoringPolicy policy, int distance) {
        int magnitude = Math.abs(distance);
        if (magnitude < policy.markedDistance()) {
            return BigFiveResult.Level.NEAR_MIDDLE;
        }
        if (magnitude < policy.strongDistance()) {
            return distance > 0 ? BigFiveResult.Level.ABOVE : BigFiveResult.Level.BELOW;
        }
        return distance > 0 ? BigFiveResult.Level.WELL_ABOVE : BigFiveResult.Level.WELL_BELOW;
    }

    /** 某维每个数字档位的贡献表（供页面解释"为什么是这个分数"，不用于计分本身）。 */
    public static Map<BigFiveDimension, int[]> contributionTable(BigFivePackage pkg) {
        Map<BigFiveDimension, int[]> table = new EnumMap<>(BigFiveDimension.class);
        for (BigFiveDimension dimension : BigFiveDimension.ordered()) {
            int[] row = new int[5];
            for (int rating = 1; rating <= 5; rating++) {
                int sum = 0;
                for (BigFiveItem item : pkg.items(dimension)) {
                    sum += item.direction() * rating;
                }
                row[rating - 1] = pkg.scoringPolicy().constantOf(dimension) + sum;
            }
            table.put(dimension, row);
        }
        return table;
    }
}
