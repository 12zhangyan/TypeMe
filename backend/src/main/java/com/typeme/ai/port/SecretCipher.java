package com.typeme.ai.port;

/**
 * 后台设置里 apiKey 的解密入口（**只定义接口，不实现算法**）。
 *
 * <p>账号模块用 {@code typeme.security.settings-secret} 加密存储 key，并会提供一个实现本签名的
 * Spring bean。AI 模块用 {@code @Autowired(required = false)} 注入：**拿不到实现不算致命**，
 * 此时视为"只有 env key 可用"，绝不因为缺 bean 就让应用启动失败。
 *
 * <p>刻意不依赖 {@code com.typeme.security} 的具体类型：并行开发时那一边还没落地，
 * 这边的编译不能因此被卡住。
 */
public interface SecretCipher {

    /**
     * 解密后台设置的密文。
     *
     * @param cipherText 数据库里的密文
     * @return 明文；无法解密时返回 null（调用方按"没有 db key"处理）
     */
    String decrypt(String cipherText);

    /** 给自己/日志用的实现标识（例如 "spring-text-encryptor"），不含任何秘密。 */
    default String providerName() {
        return getClass().getSimpleName();
    }
}
