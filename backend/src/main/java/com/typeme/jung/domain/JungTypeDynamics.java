package com.typeme.jung.domain;

import java.util.List;

/**
 * 由四字母类型码推导出的**四个精神活动过程**结构。
 *
 * <h2>为什么要有这一层</h2>
 * 报告原先只按四个字母取文案，于是它知道"你是 ISTJ"，却说不出"你的主导过程是内倾感觉、
 * 辅助是外倾思考"，也就无法回答三个最常被问的问题：你和 INTJ 差在哪、你该先练哪个、
 * 为什么有些题你会把自己选错。这一层就是那份"为什么"。
 *
 * <h2>推导规则（只有两条，都是框架自身的规则）</h2>
 * <ol>
 *   <li><b>J/P 描述的是对外部世界使用的方式</b>：以 J 结尾，对外用的是判断过程（T 或 F）；
 *       以 P 结尾，对外用的是感知过程（S 或 N）。</li>
 *   <li><b>主导过程的方向与类型码首字母一致</b>：外倾者的主导过程朝外，内倾者的主导过程朝里
 *       —— 也正因如此，内倾者对外露出的往往是他的**辅助**过程。</li>
 * </ol>
 *
 * <p>把这两条合起来就是：外倾者的主导过程 = 对外使用的那个（J→T/F，P→S/N）；
 * 内倾者对外使用的那个是他的**辅助**过程，主导过程因而是剩下的那一族、且朝里。
 * 这与《天资差异》第 2 章"辅助过程为内倾者提供必需的外倾性"的说法一致
 * （书中用"将军与助手"作喻：外倾者的将军出头露面，内倾者的将军待在帐篷里）。
 *
 * <h2>不变量（构造时逐个校验，写错就炸）</h2>
 * <ul>
 *   <li>主导与辅助的功能族不同、方向相反（一个判断一个感知，一个朝里一个朝外）；</li>
 *   <li>第三位 = 与辅助**同一类**（判断/感知）的**另一个功能**、方向取反
 *       （ISTJ 的辅助 {@code Te} → 第三位 {@code Fi}，不是 {@code Ti}）；
 *       第四位 = 与主导同一类的另一个功能、方向取反（{@code Si} → {@code Ne}）；</li>
 *   <li>四个过程恰好覆盖 S/N/T/F 各一次 —— 这也是"每一步决策法里
 *       {@code function -> process} 只有一个答案"的依据。</li>
 * </ul>
 *
 * <p>用词约定：<b>「类」= 判断类 / 感知类</b>（{@code isJudging()} / {@code isPerceiving()}），
 * <b>「功能」= S / N / T / F</b>。早前的文档把「类」写成了「族」，
 * 结果"辅助那一族的另一个功能"被读成"T 族的另一个功能 → {@code Ti}"，
 * 而正确答案是"判断类的另一个功能 → {@code Fi}"。{@link JungProcess#sameFamily} 里的
 * "family" 指的是「类」。</p>
 *
 * <p>本类刻意是纯函数：不读时间、不读存储、不起 Spring bean，
 * 这样同一份推导可以在 Java 与前端各跑一遍，由夹具钉住两侧一致。
 */
public record JungTypeDynamics(
        JungTypeCode typeCode,
        JungProcess dominant,
        JungProcess auxiliary,
        JungProcess tertiary,
        JungProcess inferior) {

    public JungTypeDynamics {
        if (typeCode == null) {
            throw new IllegalArgumentException("类型码不能为空");
        }
        if (dominant == null || auxiliary == null || tertiary == null || inferior == null) {
            throw new IllegalArgumentException("四个过程都不能为空：" + typeCode);
        }
        if (dominant.function() == auxiliary.function()) {
            throw new IllegalStateException(
                    "主导与辅助的功能族必须不同：" + typeCode + " -> " + dominant + "/" + auxiliary);
        }
        if (dominant.attitude() == auxiliary.attitude()) {
            throw new IllegalStateException(
                    "主导与辅助的方向必须相反：" + typeCode + " -> " + dominant + "/" + auxiliary);
        }
        if (!tertiary.sameFamily(auxiliary) || tertiary.function() == auxiliary.function()
                || tertiary.attitude() == auxiliary.attitude()) {
            throw new IllegalStateException(
                    "第三位必须是辅助那一族的另一个功能、方向与主导一致："
                            + typeCode + " -> " + auxiliary + "/" + tertiary);
        }
        if (!inferior.sameFamily(dominant) || inferior.function() == dominant.function()
                || inferior.attitude() == dominant.attitude()) {
            throw new IllegalStateException(
                    "第四位必须是主导那一族的另一个功能、方向与辅助一致："
                            + typeCode + " -> " + dominant + "/" + inferior);
        }
        boolean[] seen = new boolean[4];
        // 注意：紧凑构造器里**不能**调 processes() —— 记录类的字段赋值发生在紧凑构造器
        // 之后，那时读到的还是 null。只能用参数。
        for (JungProcess process : List.of(dominant, auxiliary, tertiary, inferior)) {
            int index = "SNTF".indexOf(process.function());
            if (seen[index]) {
                throw new IllegalStateException("四个过程必须各占 S/N/T/F 之一：" + typeCode);
            }
            seen[index] = true;
        }
    }

    /** 按权威次序返回：主导 → 辅助 → 第三位 → 第四位。 */
    public List<JungProcess> processes() {
        return List.of(dominant, auxiliary, tertiary, inferior);
    }

    /**
     * 主导过程是否朝外。等价于"这个人是外倾者"——
     * 框架里外倾型的主导过程必然朝外，内倾型必然朝里。
     */
    public boolean dominantExtraverted() {
        return dominant.attitude() == 'e';
    }

    /**
     * 该功能族落在第几位（{@code 0..3}）。
     *
     * <p>四步决策法按 S→N→T→F 排，而用户在这四步上"省力还是吃力"取决于该功能族
     * 在他结构里的位置：{@code 3} 就是第四位，也就是他最难的那一步。
     */
    public int slotOfFunction(char function) {
        char wanted = Character.toUpperCase(function);
        for (int index = 0; index < 4; index++) {
            if (processes().get(index).function() == wanted) {
                return index;
            }
        }
        throw new IllegalArgumentException("未知的功能族：" + function);
    }

    /**
     * 某个维度的字母换到另一侧时，结构会怎么变。
     *
     * <p>这不是细节，而是"本次只是略偏"这句话真正该说清楚的东西。四种后果**互不相同**，
     * 而且极易互相说反（本类就写反过一次，见下）：
     * <ul>
     *   <li>{@code EI} 换边（ISTJ → ESTJ）：还是那四个过程，但**主导与辅助互换**、
     *       第三位与第四位也互换；</li>
     *   <li>{@code JP} 换边（ISTJ → ISTP）：四个位置的方向都不变，但**每个位置上的过程
     *       都换成另一类**（判断↔感知）—— 主导仍是内倾的，却从感觉变成思考；</li>
     *   <li>{@code SN} 换边（ISTJ → INTJ）：只有 {@code S} 与 {@code N} 那两个位置换功能，
     *       方向不变（主导↔第四位）；</li>
     *   <li>{@code TF} 换边：同上，换的是 {@code T} 与 {@code F}（辅助↔第三位）。</li>
     * </ul>
     *
     * <p><b>这里踩过一次真实的坑</b>：最初把 {@code JP} 写成"主导与辅助互换"、
     * 把 {@code EI} 写成"只是方向对调"，两条正好**对调了**。它不会抛任何异常 ——
     * 报告照常生成，只是用户在一维略偏时会读到一句关于自己结构的错话。
     * 之所以没被测出来，是因为当时的测试拿 {@code ESTJ}（那是 EI 换边的结果）去印证 JP。
     * 现在 {@link JungTypeDynamicsTest} 对 16 型 × 4 维逐一对拍真实换边结果。
     */
    public JungDimensionFlip flipEffect(JungDimension dimension) {
        return switch (dimension) {
            case EI -> new JungDimensionFlip(dimension, FlipConsequence.DOMINANT_AUXILIARY_SWAP, -1, -1);
            case JP -> new JungDimensionFlip(dimension, FlipConsequence.CATEGORIES_SWAP_SLOTS, -1, -1);
            case SN, TF -> {
                int first = slotOfFunction(dimension == JungDimension.SN ? 'S' : 'T');
                int second = slotOfFunction(dimension == JungDimension.SN ? 'N' : 'F');
                yield new JungDimensionFlip(dimension, FlipConsequence.FUNCTIONS_SWAP,
                        Math.min(first, second), Math.max(first, second));
            }
        };
    }

    /**
     * 换边后果的种类。
     *
     * <p>刻意用枚举而不是两三个 {@code boolean}：布尔组合看不出"哪两种后果是不能同时成立的"，
     * 也正是它让 {@code JP} 与 {@code EI} 的后果被写反还没人发现。
     */
    public enum FlipConsequence {
        /** E/I：还是这四个过程，但主导与辅助互换（第三位与第四位也互换）。 */
        DOMINANT_AUXILIARY_SWAP,
        /** J/P：判断类与感知类互换所占位置 —— 每个位置都换成另一类，方向不变。 */
        CATEGORIES_SWAP_SLOTS,
        /** S/N 或 T/F：同类的那两个功能互换，方向不变。 */
        FUNCTIONS_SWAP
    }

    /**
     * 某一维换边后，结构会怎么变。
     *
     * @param consequence 后果种类
     * @param firstSlot   受影响的两个位置中靠前的那个；{@code -1} 表示不适用
     * @param secondSlot  受影响的两个位置中靠后的那个；{@code -1} 表示不适用
     */
    public record JungDimensionFlip(
            JungDimension dimension,
            FlipConsequence consequence,
            int firstSlot,
            int secondSlot) {

        /** 位置的中文说法：0 主导、1 辅助、2 第三位、3 第四位。 */
        public static String slotName(int slot) {
            return switch (slot) {
                case 0 -> "主导过程";
                case 1 -> "辅助过程";
                case 2 -> "第三位";
                case 3 -> "第四位";
                default -> "";
            };
        }
    }

    /** 该类型的规范形：{@code ISTJ = Si 主导 / Te 辅助 / Fi 第三 / Ne 第四}。 */
    public String describe() {
        return typeCode.value() + " = " + dominant + " 主导 / " + auxiliary + " 辅助 / "
                + tertiary + " 第三 / " + inferior + " 第四";
    }

    /**
     * 推导入口。
     *
     * <p>刻意不接受 {@code null}：TIED（某一维平分、没有四字母）时**不应**调用它，
     * 调用方必须先判 {@code result.computedTypeCode() != null}。平分时硬推一个结构，
     * 等于把"证据对等"讲成"你就是这样"。
     *
     * <p>实现只用一条式子，因为两条规则本身就是对称的：
     * <pre>
     *   对外使用的那个过程 = (J ? 判断族(T/F) : 感知族(S/N)) + e
     *   朝里使用的那个过程 = (J ? 感知族(S/N) : 判断族(T/F)) + i
     *   外倾者：主导 = 对外的那个，辅助 = 朝里的那个
     *   内倾者：主导 = 朝里的那个，辅助 = 对外的那个
     * </pre>
     * 这里踩过一次真实的坑：内倾者那一支最初写成"同族换方向"（S→N、T→F），
     * 于是 ISTP 被算成 Ni 主导 —— <b>主导与辅助整对错位，而构造期不变量一个都不会报</b>。
     * 正确做法是**换成另一族**：内倾者对外用的是辅助，主导是剩下那一族、且朝里。
     */
    public static JungTypeDynamics of(JungTypeCode code) {
        if (code == null) {
            throw new IllegalArgumentException("没有类型码就没有过程结构：平分时不推导");
        }
        String value = code.value();
        char ei = value.charAt(0);
        char sn = value.charAt(1);
        char tf = value.charAt(2);
        char jp = value.charAt(3);

        // 对外使用的功能族：J -> 判断族(T/F)，P -> 感知族(S/N)；剩下那一族朝里。
        JungProcess outer = JungProcess.of(jp == 'J' ? tf : sn, 'e');
        JungProcess inner = JungProcess.of(jp == 'J' ? sn : tf, 'i');

        JungProcess dominant = ei == 'E' ? outer : inner;
        JungProcess auxiliary = ei == 'E' ? inner : outer;
        // 第三位/第四位**不是**主导或辅助的"同功能反向"，而是同族的另一个功能反向：
        // ISTJ 的 Te 辅助 → Fi 第三、Si 主导 → Ne 第四。
        JungProcess tertiary = auxiliary.otherInFamilyOppositeAttitude();
        JungProcess inferior = dominant.otherInFamilyOppositeAttitude();
        return new JungTypeDynamics(code, dominant, auxiliary, tertiary, inferior);
    }
}
