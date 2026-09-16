package com.typeme.security;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 恢复码生成（契约 §7.2）。
 *
 * <p>格式：{@code XXXX-XXXX}，一组 8 个。
 *
 * <p><b>与契约的一处口径差异（明示）</b>：契约写"8 组，每组 {@code XXXX-XXXX}……共 128 位随机"。
 * 一组 8 个字符、字母表 31 个符号，字面上只有 ≈39.6 位；要把"共 128 位"读成"整组码合计 128 位"，
 * 则每码 16 位。两种读法的安全含义差别很大，因此本实现取**更强**的一侧：
 * 按字符数（16 个字符）生成，每码 16×log2(31) ≈ 79 位熵，一组 8 个码合计 ≈ 634 位。
 * 这满足并远超"合计 128 位"的要求，代价只是恢复码字符串略长。
 *
 * <p>字母表去掉易混字符 {@code 0O1IL}（契约要求），保留
 * {@code 23456789ABCDEFGHJKMNPQRSTUVWXYZ} 共 31 个符号。为此**必须**用拒绝采样：
 * 31 不整除 256，直接 {@code nextInt() % 31} 会让前几个符号出现概率偏高，从而削弱熵。
 */
@Component
public class RecoveryCodeGenerator {

    /** 一组恢复码的个数（契约：8 个）。 */
    public static final int CODES_PER_SET = 8;

    /** 每个码的字符数（不含连字符）。 */
    static final int CODE_LENGTH = 16;

    /** 显示时的分段长度：{@code XXXX-XXXX-XXXX-XXXX}。 */
    private static final int SEGMENT_LENGTH = 4;

    /** 去掉易混字符 0 O 1 I L 后的字母表。 */
    static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    private final SecureRandom random = new SecureRandom();

    /** 生成一组（8 个）恢复码的明文。明文只在注册/重发的响应里出现一次。 */
    public List<String> generateSet() {
        List<String> codes = new ArrayList<>(CODES_PER_SET);
        for (int i = 0; i < CODES_PER_SET; i++) {
            codes.add(generateOne());
        }
        return codes;
    }

    public String generateOne() {
        StringBuilder raw = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            raw.append(ALPHABET.charAt(uniformIndex()));
        }
        StringBuilder formatted = new StringBuilder(CODE_LENGTH + CODE_LENGTH / SEGMENT_LENGTH);
        for (int i = 0; i < raw.length(); i += SEGMENT_LENGTH) {
            if (i > 0) {
                formatted.append('-');
            }
            formatted.append(raw, i, i + SEGMENT_LENGTH);
        }
        return formatted.toString();
    }

    /**
     * 把用户输入规范化成"用于比对与 hash 的规范形"：
     * 去掉所有分隔符与空白、转大写。
     *
     * <p>为什么规范化之后再 hash（而不是保留用户原样）：用户会带空格、写小写、
     * 多打一个连字符。若原样 hash，这些都会被判为"恢复码错误"，而用户手里拿的明明是正确的那张纸。
     * 规范化只影响比对，明文本身从不落库。
     */
    public static String normalize(String rawCode) {
        if (rawCode == null) {
            return "";
        }
        return rawCode.replace("-", "")
                .replace(" ", "")
                .replace("\t", "")
                .toUpperCase(Locale.ROOT)
                .trim();
    }

    /** 拒绝采样：只接受落在 {@code [0, 31*8)} 区间内的字节，避免取模偏差。 */
    private int uniformIndex() {
        int bound = ALPHABET.length();
        int limit = 256 - (256 % bound);
        int value;
        do {
            value = random.nextInt(256);
        } while (value >= limit);
        return value % bound;
    }
}
