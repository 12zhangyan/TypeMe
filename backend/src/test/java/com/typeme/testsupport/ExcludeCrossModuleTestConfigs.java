package com.typeme.testsupport;

import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.autoconfigure.filter.TypeExcludeFilters;
import org.springframework.test.context.junit.jupiter.SpringExtension;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 给 {@code @SpringBootTest} 加上"剔除别的模块测试专用配置类"的过滤器。
 *
 * <p>用法：与 {@code @SpringBootTest} 并列写在测试类上。
 *
 * <p>为什么需要单独一个注解：{@code @SpringBootTest} **没有** {@code excludeFilters} 属性
 * （那是 {@code @ComponentScan} / {@code @SpringBootApplication} 的），写了直接编译不过；
 * 而正确的机制 {@code @TypeExcludeFilters} 又长又容易漏（漏了的表现是
 * "一堆与本模块无关的测试一起红，报错指向别人的类"）。包一层注解让每个测试类只写一行，
 * 也把"为什么会有这个过滤器"的解释集中到一处。
 *
 * @see CrossModuleTestExclusions
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@ExtendWith(SpringExtension.class)
@TypeExcludeFilters(CrossModuleTestExclusions.class)
public @interface ExcludeCrossModuleTestConfigs {
}
