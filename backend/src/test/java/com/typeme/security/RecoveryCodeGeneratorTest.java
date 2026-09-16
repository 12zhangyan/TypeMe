package com.typeme.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 恢复码生成器（纯单元测试，不起 Spring 上下文）。
 */
class RecoveryCodeGeneratorTest {

    private final RecoveryCodeGenerator generator = new RecoveryCodeGenerator();

    @Test
    @DisplayName("一组 8 个码，格式 XXXX-XXXX-XXXX-XXXX，只含去混淆字母表")
    void generatesEightWellFormedCodes() {
        List<String> codes = generator.generateSet();
        assertThat(codes).hasSize(RecoveryCodeGenerator.CODES_PER_SET);
        String pattern = "^[" + RecoveryCodeGenerator.ALPHABET + "]{4}(-[" + RecoveryCodeGenerator.ALPHABET
                + "]{4}){3}$";
        for (String code : codes) {
            assertThat(code).matches(pattern);
            // 易混字符绝不能出现（0 O 1 I L 都可能是用户抄错的那一类）
            assertThat(code).doesNotContain("0").doesNotContain("O").doesNotContain("1")
                    .doesNotContain("I").doesNotContain("L");
        }
        assertThat(new HashSet<>(codes)).as("一组内不应重复").hasSize(codes.size());
    }

    @Test
    @DisplayName("随机性：字母表每个符号都可能出现（拒绝采样不是只取前几个）")
    void usesWholeAlphabet() {
        Set<Character> seen = new HashSet<>();
        for (int round = 0; round < 200; round++) {
            for (char c : generator.generateOne().toCharArray()) {
                if (c != '-') {
                    seen.add(c);
                }
            }
        }
        // 200 个码 × 16 字符 = 3200 个采样，31 个符号全部出现是极大概率事件
        assertThat(seen).containsExactlyInAnyOrderElementsOf(
                RecoveryCodeGenerator.ALPHABET.chars().mapToObj(c -> (char) c).toList());
    }

    @Test
    @DisplayName("规范化：小写、空格、连字符都能被接受（用户抄写容错）")
    void normalizationAcceptsCommonTippngMistakes() {
        assertThat(RecoveryCodeGenerator.normalize("abcd-2345")).isEqualTo("ABCD2345");
        assertThat(RecoveryCodeGenerator.normalize(" ABCD 2345 ")).isEqualTo("ABCD2345");
        assertThat(RecoveryCodeGenerator.normalize("abcd\t2345")).isEqualTo("ABCD2345");
        assertThat(RecoveryCodeGenerator.normalize(null)).isEmpty();
        assertThat(RecoveryCodeGenerator.normalize("")).isEmpty();
    }

    @Test
    @DisplayName("规范化后长度足够：每码 16 个有效字符（熵约 79 位，一组合计远超 128 位）")
    void codeLengthIsLongEnough() {
        String code = generator.generateOne();
        assertThat(RecoveryCodeGenerator.normalize(code)).hasSize(RecoveryCodeGenerator.CODE_LENGTH);
    }
}
