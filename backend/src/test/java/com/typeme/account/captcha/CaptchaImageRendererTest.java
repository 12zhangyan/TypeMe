package com.typeme.account.captcha;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class CaptchaImageRendererTest {

    @Test
    @DisplayName("字母表 32 个字符与点阵字形一一对应，且不含易混淆字符")
    void alphabetAndGlyphsMatch() {
        String alphabet = CaptchaImageRenderer.ALPHABET;
        assertThat(alphabet).hasSize(32).doesNotContain("0", "O", "1", "I");
        assertThat(CaptchaImageRenderer.GLYPHS).hasSize(32);
        for (char c : alphabet.toCharArray()) {
            String[] rows = CaptchaImageRenderer.GLYPHS.get(c);
            assertThat(rows).as("字形 %s", c).hasSize(7);
            for (String row : rows) {
                assertThat(row).as("字形 %s 的一行", c).matches("[01]{5}");
            }
        }
    }

    @Test
    @DisplayName("每个字符的字形互不相同（防止抄错行导致两个字符画得一样）")
    void glyphsAreDistinct() {
        long distinct = CaptchaImageRenderer.GLYPHS.values().stream()
                .map(rows -> String.join("/", rows)).distinct().count();
        assertThat(distinct).isEqualTo(32);
    }

    @Test
    @DisplayName("渲染出可解码的 PNG，尺寸固定，且不是纯色图")
    void rendersDecodablePng() throws Exception {
        byte[] png = CaptchaImageRenderer.render("A2B3C", new SecureRandom());
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));
        assertThat(image.getWidth()).isEqualTo(CaptchaImageRenderer.WIDTH);
        assertThat(image.getHeight()).isEqualTo(CaptchaImageRenderer.HEIGHT);
        Set<Integer> colors = new HashSet<>();
        for (int x = 0; x < image.getWidth(); x += 3) {
            for (int y = 0; y < image.getHeight(); y += 3) {
                colors.add(image.getRGB(x, y));
            }
        }
        assertThat(colors.size()).isGreaterThan(5);
    }
}
