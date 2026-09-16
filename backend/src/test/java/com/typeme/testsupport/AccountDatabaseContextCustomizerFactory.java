package com.typeme.testsupport;

import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 把 {@link AccountTestDatabase} 指定的 H2 库真正装进测试上下文。
 *
 * <p>实现方式是往 {@link MergedContextConfiguration#getPropertySourceProperties()} 里追加
 * 数据源属性 —— 这是 Spring 官方支持的"按测试类定制上下文"的扩展点，
 * 比在继承链上博弈 {@code @DynamicPropertySource} 的覆盖顺序可靠得多
 * （为什么需要绕开它，见 {@link AccountTestDatabase} 的注释）。
 *
 * <p>{@link #equals}/{@link #hashCode} 必须实现：Spring 把 {@code ContextCustomizer}
 * 作为上下文缓存键的一部分，两个类若被判定为"相同定制"就会共用同一个上下文 ——
 * 而共用上下文正是我们要避免的（那就是共用库）。
 */
public final class AccountDatabaseContextCustomizerFactory implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(
            Class<?> testClass, List<ContextConfigurationAttributes> configAttributes) {
        AccountTestDatabase annotation = testClass.getAnnotation(AccountTestDatabase.class);
        if (annotation == null) {
            return null;
        }
        // 库名一律由**测试类自己**派生，不看注解里写了什么、也不管注解是"自己声明的"
        // 还是"从基类 @Inherited 继承来的"。
        //
        // 为什么不支持在注解里指定名字：基类上写着同一个名字时，所有子类会继承到同一个值，
        // 于是又回到"共用库"这个要解决的问题上。用类名派生则天然每类一格，
        // 且不可能因为复制粘贴注解而让两个类撞库。
        return new AccountDatabaseCustomizer(logicalNameOf(testClass));
    }

    /**
     * 由测试类名派生的 H2 逻辑库名。
     *
     * <p>用完整类名（含包名）的小写缩写形式：类名在同一个测试源码树里唯一，
     * 因此库名也唯一。同时过滤成 H2 标识符允许的字符集。
     */
    static String logicalNameOf(Class<?> testClass) {
        String simple = testClass.getSimpleName().toLowerCase(java.util.Locale.ROOT);
        // 例：AdminBootstrapIT -> typeme_adminbootstrapit
        return "typeme_" + simple.replaceAll("[^a-z0-9_]", "_");
    }

    /** 只承载"逻辑库名"，相等性按它判定。 */
    private static final class AccountDatabaseCustomizer implements ContextCustomizer {

        private final String logicalName;
        private final String url;

        private AccountDatabaseCustomizer(String logicalName) {
            this.logicalName = logicalName;
            // 在这里就把库名定下来：同一个测试类里被多次创建（重复解析/重试）也必须得到
            // 同一个库名，否则同一个类里的上下文会指向不同的库。
            this.url = H2TestDatabases.url(logicalName) + ";CASE_INSENSITIVE_IDENTIFIERS=TRUE";
        }

        @Override
        public void customizeContext(ConfigurableApplicationContext context,
                                     MergedContextConfiguration mergedConfig) {
            // addFirst：本测试类的库必须压过 application*.properties 里的默认值。
            //
            // 注意与 @DynamicPropertySource 的关系：那个也走 addFirst，所以带
            // @AccountTestDatabase 的测试类**不要**再写自己的数据源 @DynamicPropertySource，
            // 否则两者会抢同一个位置，谁赢取决于 customizer 执行顺序。
            MutablePropertySources sources = context.getEnvironment().getPropertySources();
            sources.addFirst(new MapPropertySource("typemeAccountTestDatabase",
                    H2TestDatabases.datasourceProperties(url)));
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof AccountDatabaseCustomizer that
                    && Objects.equals(logicalName, that.logicalName);
        }

        @Override
        public int hashCode() {
            return Objects.hash(logicalName);
        }

        @Override
        public String toString() {
            return "AccountDatabaseCustomizer[" + logicalName + "]";
        }
    }
}
