package com.typeme.testsupport;

import org.springframework.boot.context.TypeExcludeFilter;
import org.springframework.core.type.classreading.MetadataReader;
import org.springframework.core.type.classreading.MetadataReaderFactory;

import java.io.IOException;
import java.util.Set;

/**
 * 从组件扫描里剔除**别的模块的测试专用配置类**。
 *
 * <p>背景：{@code com.typeme.ai.testsupport.AiTestApplication} 是一个不带条件注解的
 * {@code @Configuration}（它声明了 {@code aiClock} 等 bean）。生产启动类的组件扫描覆盖
 * {@code com.typeme.**}，于是这个**测试专用**类会被一起扫进来，与生产组件
 * {@code com.typeme.ai.config.AiClock} 撞名，注册第二份 bean 时抛
 * {@code BeanDefinitionOverrideException} —— 所有用 {@code @SpringBootTest} 的测试一起红，
 * 而且报错信息指向的是 AI 模块的类，与出问题的测试毫无字面关联，非常难查。
 *
 * <p><b>为什么用白名单而不是按包排除</b>：按 {@code com.typeme.ai.testsupport} 整包排除会
 * 顺手把该包里真正的测试辅助类也挡掉；更要紧的是，"排除一个包"是猜的，
 * "排除这一个已知撞名的类"是可核对的。新增条目时必须写清它撞的是哪个生产组件。
 *
 * <p><b>为什么不用 {@code allow-bean-definition-overriding=true}</b>：那是把撞名放行，
 * 两个 {@code aiClock} 谁生效取决于注册顺序 —— 等于把一个确定性错误换成一个不确定性错误。
 *
 * <p>用类名字符串（而不是直接引用 {@code AiTestApplication.class}）判断：
 * 本类在 {@code security}/{@code controller}/{@code service} 等模块的测试里都会被用到，
 * 不应该让那些模块在编译期依赖 AI 模块的测试类。
 */
public class CrossModuleTestExclusions extends TypeExcludeFilter {

    /** 已知会与生产组件撞名的测试专用配置类。新增时请补上"撞的是哪个生产组件"。 */
    private static final Set<String> EXCLUDED = Set.of(
            // com.typeme.ai.testsupport.AiTestApplication 声明 aiClock @Bean
            // → 与生产 com.typeme.ai.config.AiClock 撞名
            "com.typeme.ai.testsupport.AiTestApplication");

    @Override
    public boolean match(MetadataReader metadataReader, MetadataReaderFactory metadataReaderFactory)
            throws IOException {
        return EXCLUDED.contains(metadataReader.getClassMetadata().getClassName());
    }

    /*
     * Spring Boot 要求 TypeExcludeFilter 实现 equals/hashCode：它作为 ApplicationContext
     * 缓存键的一部分参与比较，缺了会直接抛
     * IllegalStateException("... has not implemented hashCode")，所有测试当场红。
     * 本过滤器行为由上面的常量集合完全决定，因此所有实例互相等价。
     */
    @Override
    public boolean equals(Object other) {
        return other instanceof CrossModuleTestExclusions;
    }

    @Override
    public int hashCode() {
        return CrossModuleTestExclusions.class.hashCode();
    }
}
