package com.typeme.testsupport;

import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;

/**
 * 集成测试共用的启动类：与生产 {@code TypeMeApplication} 等价，只多一个排除过滤器。
 *
 * <p><b>为什么需要它</b>：测试作用域里存在 AI 模块的 {@code com.typeme.ai.testsupport.AiTestApplication}，
 * 它是一个不带任何条件注解的 {@code @Configuration}。生产启动类的组件扫描覆盖
 * {@code com.typeme.**}，于是它连同它声明的 {@code aiClock} 一起被扫进来，
 * 与生产组件 {@code com.typeme.ai.config.AiClock} 撞名，直接抛
 * {@code BeanDefinitionOverrideException} —— 账号模块**所有**集成测试一起红，
 * 而报错信息指向的是别的模块的类，非常难查。
 *
 * <p><b>为什么不用 {@code @SpringBootTest(excludeFilters = ...)}</b>：
 * {@code @SpringBootTest} **没有**这个属性（那是 {@code @ComponentScan} /
 * {@code @SpringBootApplication} 的），写了直接编译不过。排除扫描必须挂在
 * 真正带 {@code @ComponentScan} 的那个类上，也就是下面这个。
 *
 * <p><b>为什么不改生产启动类</b>：生产启动类不应该知道"测试作用域里有个同名 bean"
 * 这种事；把测试专用的排除规则写进 {@code main} 会让生产代码为一个测试便利付出认知成本。
 *
 * <p><b>为什么不用 {@code allow-bean-definition-overriding=true}</b>：那是把撞名放行，
 * 两个 {@code aiClock} 谁生效取决于注册顺序 —— 等于把一个确定性错误换成一个不确定性错误。
 */
@SpringBootApplication
@ComponentScan(basePackages = "com.typeme",
        excludeFilters = @ComponentScan.Filter(
                type = FilterType.ASSIGNABLE_TYPE,
                classes = com.typeme.ai.testsupport.AiTestApplication.class))
public class TestApplication {
}
