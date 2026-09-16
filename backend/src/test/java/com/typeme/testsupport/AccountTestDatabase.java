package com.typeme.testsupport;

import java.lang.annotation.ElementType;
import java.lang.annotation.Inherited;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 标记测试类"使用自己独立的 H2 内存库"，库名由**测试类名**自动派生。
 *
 * <p>用法：打在测试基类上（{@code @Inherited} 会让所有子类自动获得），
 * 或在个别测试类上单独打。**不需要**写库名 —— 见下面"为什么不让写名字"。
 *
 * <p><b>为什么需要这个注解</b>：{@code @DynamicPropertySource} 在继承场景下不可靠。
 * 实测（2026-09-16，Spring Boot 3.3.5）中，子类无论用**同名**还是**不同名**的方法去设
 * {@code spring.datasource.url}，最终生效的都是**基类**的值 —— 日志里每个账号测试类的
 * Hikari 都打印同一个 {@code url=jdbc:h2:mem:typeme_account_test_...}。
 * 而 {@code @DynamicPropertySource} 又**必须**是静态方法，所以"子类覆盖一个静态钩子"
 * 这条路在 Java 层面就不成立（静态方法不能被覆盖）。
 *
 * <p>根因是 Spring 把 {@code @DynamicPropertySource} 的值装进
 * {@code DynamicValuesPropertySource} 后用 {@code addFirst} 插入属性源，
 * 与注解走的 {@code ContextCustomizer} 抢同一个位置；两者都注册时，
 * 谁生效取决于两个 customizer 的相对执行顺序 —— 属于框架内部细节，不该依赖。
 *
 * <p>后果很具体：{@code AdminApiIT} 把一个账号提升成 ADMIN 后，
 * {@code AdminBootstrapIT} 的"系统里还没有 ADMIN"前提被破坏而失败 ——
 * <b>单独跑两个类都绿，一起跑就红</b>，且报错完全指不到真正的原因。
 *
 * <p>所以改用 Spring 正式提供的上下文扩展点：
 * {@link AccountDatabaseContextCustomizerFactory} 读这个注解，把数据源属性
 * 直接放进该测试类的 {@code MergedContextConfiguration}。这样做有两个好处：
 * <ul>
 *   <li>每个测试类的值互相独立，不存在"谁覆盖谁"；</li>
 *   <li>不同的库名会让 {@code MergedContextConfiguration} 不同，因此 Spring
 *       **不会**把两个类的上下文缓存混用（共用上下文就等于共用库）。</li>
 * </ul>
 *
 * <p><b>为什么注解不带库名参数</b>：库名由测试类名派生（见
 * {@link AccountDatabaseContextCustomizerFactory#logicalNameOf}）。曾经写成
 * {@code @AccountTestDatabase("typeme_bootstrap_test")} 的形式，但基类上的注解会被
 * {@code @Inherited} 继承，于是所有子类拿到同一个名字，又回到共用库的老问题上。
 * 用类名派生则天然每类一格，也不会因为复制粘贴注解而让两个类撞库。
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Inherited
public @interface AccountTestDatabase {
}
