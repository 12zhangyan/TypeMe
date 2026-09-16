package com.typeme.testsupport;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 测试用 H2 内存库的连接串工厂。
 *
 * <p><b>为什么需要它</b>：测试用的 H2 连接串都带 {@code DB_CLOSE_DELAY=-1}，
 * 这让内存库在最后一个连接关闭后**继续存活到 JVM 结束**。好处是一个测试类里
 * 多个 Spring 上下文/连接能共享同一个库；代价是**同一个 JVM 里重复跑同一个库名
 * 就会看到上一次的残留数据**。
 *
 * <p>这个坑真实发生过，而且有两种表现：
 * <ul>
 *   <li><b>不同的测试类之间</b>：如果两个类共用库名，一个类建了 ADMIN、
 *       另一个类的"系统里还没有 ADMIN"断言就会失败。所以每个类要有自己的名字。</li>
 *   <li><b>同一次会话里跑第二遍 {@code mvn test}</b>：Maven 默认让所有测试跑在
 *       同一个 JVM 里，库名固定时第二遍会看到第一遍的数据 ——
 *       表现为"第一次跑绿、紧接着再跑就红"。</li>
 * </ul>
 *
 * <p>解决办法是给库名加一个**每次 JVM 启动都不同**的后缀。
 * 这里用 {@link UUID} 而不是时间戳：时间戳在同一毫秒内可能相同，
 * 而并行/重复初始化时恰好会撞上。
 *
 * <p><b>不要**为了"稳定"而把前缀写死回去。库名不需要跨进程稳定 ——
 * 每个 JVM 都是从头跑一遍迁移，一个干净的库正是测试想要的初始状态。
 */
public final class H2TestDatabases {

    /**
     * 本次 JVM 的库名后缀。用静态常量而不是每个类各算一次：
     * 同一个测试类里的多个上下文（如被 {@code @DirtiesContext} 拆开的）
     * 仍然共享同一个库，语义与原来一致。
     */
    private static final String RUN_ID = UUID.randomUUID().toString().replace("-", "").substring(0, 12);

    /**
     * 供**属性文件**引用：{@code application-ai-test.properties} 里没法调用 Java 方法，
     * 只能用 {@code ${...}} 占位符。静态初始化块在类被加载时（即第一个测试类引用它时）
     * 就把值放进系统属性，早于任何 Spring 上下文读取配置。
     *
     * <p>不这么做的话，那些 properties 文件里的库名是固定的，第二遍 {@code mvn test}
     * 会看到第一遍的残留 —— 与其它几个测试类是同一类问题。
     */
    static {
        System.setProperty("typeme.test.h2.run-id", RUN_ID);
    }

    private H2TestDatabases() {
    }

    /**
     * 生成一个本次 JVM 内唯一、且可重复取到的 H2 内存库连接串。
     *
     * @param logicalName 逻辑名（便于人看日志时分辨是谁的库），只允许字母/数字/下划线
     */
    public static String url(String logicalName) {
        String safe = logicalName.replaceAll("[^A-Za-z0-9_]", "_");
        return "jdbc:h2:mem:" + safe + "_" + RUN_ID
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1";
    }

    /** 供需要拼自定义参数（如 {@code CASE_INSENSITIVE_IDENTIFIERS=TRUE}）的调用方使用。 */
    public static String nameWithRunId(String logicalName) {
        return logicalName.replaceAll("[^A-Za-z0-9_]", "_") + "_" + RUN_ID;
    }

    /**
     * 一组 H2 数据源属性。
     *
     * <p>放在这里而不是放在某个测试基类里：数据源属性有两个使用点 ——
     * 测试基类的 {@code @DynamicPropertySource}，以及
     * {@link AccountDatabaseContextCustomizerFactory}。让它们共用这一份，
     * 免得 username/password/driver 三个键在两处各写一遍（换驱动时改漏一处是迟早的）。
     */
    public static Map<String, Object> datasourceProperties(String url) {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("spring.datasource.url", url);
        properties.put("spring.datasource.username", "sa");
        properties.put("spring.datasource.password", "");
        properties.put("spring.datasource.driver-class-name", "org.h2.Driver");
        return properties;
    }

    /**
     * 空标记类，只为**保证本类的静态初始化块被执行**。
     *
     * <p>用 {@code @ActiveProfiles("test")} 的测试类依赖属性文件里的
     * {@code ${typeme.test.h2.run-id:...}} 占位符，而那个系统属性由本类的静态块写入。
     * 但"某个测试类恰好调用了本类的方法"是很容易被后人重构掉的隐式依赖 ——
     * 一旦那个引用被删掉，占位符就静默回落到固定库名，重复跑又开始红，而没人会想到是这里。
     *
     * <p>所以让那些测试类显式写 {@code @Import(H2TestDatabases.Loader.class)}：
     * 注解里的类引用是编译期可检查的，删掉方法调用不会破坏它。
     */
    public static final class Loader {
        private Loader() {
        }
    }

    /**
     * 触发静态初始化（写入 {@code typeme.test.h2.run-id} 系统属性）并返回本次 JVM 的后缀。
     *
     * <p>由 {@link H2RunIdListener} 在所有测试类启动前调用，保证属性文件里的
     * {@code ${typeme.test.h2.run-id}} 占位符一定能解析到本次 JVM 的唯一值。
     */
    public static String ensureInitialized() {
        return RUN_ID;
    }
}
