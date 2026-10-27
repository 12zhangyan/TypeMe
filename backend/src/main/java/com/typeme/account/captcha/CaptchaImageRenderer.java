package com.typeme.account.captcha;

import javax.imageio.ImageIO;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.security.SecureRandom;
import java.util.Map;

/**
 * 把验证码文字画成 PNG。
 *
 * <p><b>为什么不用系统字体</b>：Linux 精简镜像常缺字体/fontconfig，{@code Font} 在运行时才会抛异常，
 * 而且只在部署环境出现。这里用内置的 5×7 点阵字形，自己画每一个点，只依赖 JDK 的 2D 绘图，
 * 部署环境无需任何字体。代价是字形规整、易被模板匹配，所以叠加了随机旋转/缩放/错切、
 * 干扰线、噪点和整体波纹扭曲；它只用来挡低成本脚本，并不假装能挡住打码平台
 * （见方案 E-11），真正限制规模的是 IP 预算与全站总量熔断。
 */
final class CaptchaImageRenderer {

    static final int WIDTH = 170;
    static final int HEIGHT = 60;
    private static final int CELL = 5;
    private static final int GLYPH_COLS = 5;
    private static final int GLYPH_ROWS = 7;
    private static final Color BACKGROUND = new Color(244, 241, 234);

    /** 去掉易混淆的 0/O/1/I；共 32 个，与 {@link #GLYPHS} 一一对应。 */
    static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

    static final Map<Character, String[]> GLYPHS = Map.ofEntries(
            glyph('2', "01110", "10001", "00001", "00010", "00100", "01000", "11111"),
            glyph('3', "11110", "00001", "00001", "01110", "00001", "00001", "11110"),
            glyph('4', "00010", "00110", "01010", "10010", "11111", "00010", "00010"),
            glyph('5', "11111", "10000", "11110", "00001", "00001", "10001", "01110"),
            glyph('6', "00110", "01000", "10000", "11110", "10001", "10001", "01110"),
            glyph('7', "11111", "00001", "00010", "00100", "01000", "01000", "01000"),
            glyph('8', "01110", "10001", "10001", "01110", "10001", "10001", "01110"),
            glyph('9', "01110", "10001", "10001", "01111", "00001", "00010", "01100"),
            glyph('A', "01110", "10001", "10001", "11111", "10001", "10001", "10001"),
            glyph('B', "11110", "10001", "10001", "11110", "10001", "10001", "11110"),
            glyph('C', "01110", "10001", "10000", "10000", "10000", "10001", "01110"),
            glyph('D', "11110", "10001", "10001", "10001", "10001", "10001", "11110"),
            glyph('E', "11111", "10000", "10000", "11110", "10000", "10000", "11111"),
            glyph('F', "11111", "10000", "10000", "11110", "10000", "10000", "10000"),
            glyph('G', "01110", "10001", "10000", "10111", "10001", "10001", "01111"),
            glyph('H', "10001", "10001", "10001", "11111", "10001", "10001", "10001"),
            glyph('J', "00111", "00010", "00010", "00010", "00010", "10010", "01100"),
            glyph('K', "10001", "10010", "10100", "11000", "10100", "10010", "10001"),
            glyph('L', "10000", "10000", "10000", "10000", "10000", "10000", "11111"),
            glyph('M', "10001", "11011", "10101", "10101", "10001", "10001", "10001"),
            glyph('N', "10001", "11001", "10101", "10011", "10001", "10001", "10001"),
            glyph('P', "11110", "10001", "10001", "11110", "10000", "10000", "10000"),
            glyph('Q', "01110", "10001", "10001", "10001", "10101", "10010", "01101"),
            glyph('R', "11110", "10001", "10001", "11110", "10100", "10010", "10001"),
            glyph('S', "01111", "10000", "10000", "01110", "00001", "00001", "11110"),
            glyph('T', "11111", "00100", "00100", "00100", "00100", "00100", "00100"),
            glyph('U', "10001", "10001", "10001", "10001", "10001", "10001", "01110"),
            glyph('V', "10001", "10001", "10001", "10001", "10001", "01010", "00100"),
            glyph('W', "10001", "10001", "10001", "10101", "10101", "11011", "10001"),
            glyph('X', "10001", "10001", "01010", "00100", "01010", "10001", "10001"),
            glyph('Y', "10001", "10001", "01010", "00100", "00100", "00100", "00100"),
            glyph('Z', "11111", "00001", "00010", "00100", "01000", "10000", "11111"));

    private static Map.Entry<Character, String[]> glyph(char c, String... rows) {
        return Map.entry(c, rows);
    }

    private CaptchaImageRenderer() {
    }

    static byte[] render(String text, SecureRandom random) {
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(BACKGROUND);
            g.fillRect(0, 0, WIDTH, HEIGHT);
            noiseLines(g, random, 4);
            int slot = (WIDTH - 20) / text.length();
            for (int i = 0; i < text.length(); i++) {
                drawGlyph(g, text.charAt(i), 10 + i * slot + slot / 2, HEIGHT / 2, random);
            }
            noiseLines(g, random, 3);
            noiseDots(g, random, 90);
        } finally {
            g.dispose();
        }
        return encode(wave(image, random));
    }

    private static void drawGlyph(Graphics2D g, char c, int centerX, int centerY, SecureRandom random) {
        String[] rows = GLYPHS.get(c);
        double scale = 0.72 + random.nextDouble() * 0.2;
        double angle = Math.toRadians(random.nextInt(41) - 20);
        double shear = (random.nextDouble() - 0.5) * 0.35;
        AffineTransform saved = g.getTransform();
        g.translate(centerX + random.nextInt(5) - 2, centerY + random.nextInt(7) - 3);
        g.rotate(angle);
        g.shear(shear, 0);
        g.scale(scale, scale);
        g.setColor(new Color(20 + random.nextInt(70), 20 + random.nextInt(70), 40 + random.nextInt(90)));
        double originX = -GLYPH_COLS * CELL / 2.0;
        double originY = -GLYPH_ROWS * CELL / 2.0;
        for (int row = 0; row < GLYPH_ROWS; row++) {
            for (int col = 0; col < GLYPH_COLS; col++) {
                if (rows[row].charAt(col) == '1') {
                    double jitter = random.nextDouble() * 0.8 - 0.4;
                    g.fill(new RoundRectangle2D.Double(originX + col * CELL + jitter, originY + row * CELL + jitter,
                            CELL, CELL, 3, 3));
                }
            }
        }
        g.setTransform(saved);
    }

    private static void noiseLines(Graphics2D g, SecureRandom random, int count) {
        for (int i = 0; i < count; i++) {
            g.setColor(new Color(60 + random.nextInt(140), 60 + random.nextInt(140), 60 + random.nextInt(140)));
            g.setStroke(new BasicStroke(1f + random.nextFloat() * 1.2f));
            g.drawLine(random.nextInt(WIDTH), random.nextInt(HEIGHT), random.nextInt(WIDTH), random.nextInt(HEIGHT));
        }
    }

    private static void noiseDots(Graphics2D g, SecureRandom random, int count) {
        for (int i = 0; i < count; i++) {
            g.setColor(new Color(40 + random.nextInt(160), 40 + random.nextInt(160), 40 + random.nextInt(160)));
            g.fillRect(random.nextInt(WIDTH), random.nextInt(HEIGHT), 2, 2);
        }
    }

    /** 整图的正弦波纹扭曲：逐列纵向平移，破坏点阵字形的规整边缘。 */
    private static BufferedImage wave(BufferedImage source, SecureRandom random) {
        BufferedImage out = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_INT_RGB);
        double amplitude = 2.0 + random.nextDouble() * 1.5;
        double period = 38 + random.nextDouble() * 18;
        double phase = random.nextDouble() * Math.PI * 2;
        int background = BACKGROUND.getRGB();
        for (int x = 0; x < WIDTH; x++) {
            int shift = (int) Math.round(amplitude * Math.sin(2 * Math.PI * x / period + phase));
            for (int y = 0; y < HEIGHT; y++) {
                int sourceY = y - shift;
                out.setRGB(x, y, sourceY >= 0 && sourceY < HEIGHT ? source.getRGB(x, sourceY) : background);
            }
        }
        return out;
    }

    private static byte[] encode(BufferedImage image) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
