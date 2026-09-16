package com.typeme.jung.domain;

/**
 * 四个精神活动过程在两种内外方向上的八种形态（{@code Si Se Ni Ne Ti Te Fi Fe}）。
 *
 * <p>这一层的地位必须说清楚，否则它会变成"贴标签"：
 * <ul>
 *   <li>它**不是**本次测出来的第九个结果，而是由四个字母按框架规则**推导**出来的结构；</li>
 *   <li>主导与辅助过程在框架里是"偏好"的延伸：主导是用起来最省力的那个，
 *       两个尚未偏好的过程只是还没有练过，<b>不是缺陷，也不是缺少的能力</b>；</li>
 *   <li>因此禁用词里额外拦掉了"匹配率/适配度"这类把推导读成判决的说法。
 *       这五个词同时进了**全局表**（`scripts/convert-jung-content.mjs` 的
 *       {@code BANNED_WORDS}），运行期由 {@code JungReportBuilder.BANNED_WORDS} 用同一张表拦；
 *       过程层另有一份 {@code PROCESS_EXTRA_BANNED}，只为让"这一层最怕什么"在代码里显式可读 ——
 *       真正兜底的是全局表，两份不对称会变成"构建通过、运行期炸掉"。</li>
 * </ul>
 *
 * <p>{@code i/e} 在这里说的是"这个过程主要朝里用还是朝外使用"，
 * <b>不是</b>性格内向或外向 —— 用户文案里必须同时给出这句说明。
 */
public enum JungProcess {

    Si('S', 'i'),
    Se('S', 'e'),
    Ni('N', 'i'),
    Ne('N', 'e'),
    Ti('T', 'i'),
    Te('T', 'e'),
    Fi('F', 'i'),
    Fe('F', 'e');

    private final char function;
    private final char attitude;

    JungProcess(char function, char attitude) {
        this.function = function;
        this.attitude = attitude;
    }

    /** 感知或判断的哪一种：{@code S}/{@code N}/{@code T}/{@code F}。 */
    public char function() {
        return function;
    }

    /** {@code i} 或 {@code e}：主要朝里用还是朝外使用。 */
    public char attitude() {
        return attitude;
    }

    /** 规范代号，例如 {@code Si}。 */
    public String token() {
        return name();
    }

    public boolean isPerceiving() {
        return function == 'S' || function == 'N';
    }

    public boolean isJudging() {
        return function == 'T' || function == 'F';
    }

    public boolean isIntroverted() {
        return attitude == 'i';
    }

    /** 功能的中文名（感觉 / 直觉 / 思考 / 情感）。 */
    public String functionNameCn() {
        return functionNameCnOf(function);
    }

    /** 单个功能族字母的中文名。用于把 {@code S}/{@code N}/{@code T}/{@code F} 讲成人话。 */
    public static String functionNameCnOf(char function) {
        return switch (Character.toUpperCase(function)) {
            case 'S' -> "感觉";
            case 'N' -> "直觉";
            case 'T' -> "思考";
            case 'F' -> "情感";
            default -> throw new IllegalArgumentException("未知的功能族字母：" + function);
        };
    }

    /** 方向的中文名。这里的"内倾/外倾"说的是这个过程朝哪边用，不是性格。 */
    public String attitudeNameCn() {
        return isIntroverted() ? "内倾" : "外倾";
    }

    /** 例如"内倾感觉"。 */
    public String nameCn() {
        return attitudeNameCn() + functionNameCn();
    }

    /**
     * 同一族里的**另一个**功能，方向不变：{@code Si -> Ni}、{@code Te -> Fe}。
     *
     * <p>第三位与第四位都要靠它：结构与主导同族、或与辅助同族的那个"另一个功能"。
     */
    public JungProcess otherInFamily() {
        char other = isPerceiving() ? (function == 'S' ? 'N' : 'S') : (function == 'T' ? 'F' : 'T');
        return of(other, attitude);
    }

    /**
     * 同一族里的另一个功能、方向取反：{@code Si -> Ne}、{@code Te -> Fi}。
     *
     * <p>这就是"第三位/第四位"的生成式。注意它**不是** {@link #oppositeAttitude()}：
     * ISTJ 的辅助是 {@code Te}，第三位是 {@code Fi}（换成同族的另一个功能），
     * 而不是 {@code Ti}（只翻方向）—— 后者会让第三位与辅助同功能，
     * 于是四个过程只覆盖 S/T 两族，第四位也跟着错。
     */
    public JungProcess otherInFamilyOppositeAttitude() {
        return otherInFamily().oppositeAttitude();
    }

    /** 与另一个过程是否同属感知族或判断族。 */
    public boolean sameFamily(JungProcess other) {
        return other != null && isPerceiving() == other.isPerceiving();
    }

    /** 同一功能的另一个方向：{@code Si <-> Se}。 */
    public JungProcess oppositeAttitude() {
        return of(function, isIntroverted() ? 'e' : 'i');
    }

    public static JungProcess of(char function, char attitude) {
        char fn = Character.toUpperCase(function);
        char at = Character.toLowerCase(attitude);
        for (JungProcess process : values()) {
            if (process.function == fn && process.attitude == at) {
                return process;
            }
        }
        throw new IllegalArgumentException("未知的过程：" + function + attitude);
    }

    /** 严格解析：只接受规范形 {@code Si}（首字母大写、方向小写）。 */
    public static JungProcess parse(String token) {
        if (token == null || token.length() != 2) {
            throw new IllegalArgumentException("过程代号必须是两个字符，收到：" + token);
        }
        return of(token.charAt(0), token.charAt(1));
    }

    /** 单个字母的感知/判断族。 */
    public static boolean isPerceivingFunction(char function) {
        char fn = Character.toUpperCase(function);
        return fn == 'S' || fn == 'N';
    }

    @Override
    public String toString() {
        return name();
    }
}
