package com.typeme.ai.input;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** 去重键用到的 sha256（与契约 02 §5.1 的 {@code request_hash CHAR(64)} 一致）。 */
public final class AiHashes {

    private AiHashes() {
    }

    public static String sha256(String value) {
        return sha256((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256(byte[] bytes) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(bytes));
        } catch (NoSuchAlgorithmException ex) {
            // JDK 必然带 SHA-256；真缺了就该直接失败，而不是静默降级成弱 hash。
            throw new IllegalStateException("JDK 缺少 SHA-256 实现", ex);
        }
    }
}
