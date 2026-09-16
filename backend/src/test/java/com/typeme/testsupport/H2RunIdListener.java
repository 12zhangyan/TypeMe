package com.typeme.testsupport;

import org.springframework.test.context.TestContext;
import org.springframework.test.context.TestExecutionListener;

/**
 * 在任何 Spring 测试上下文启动**之前**，把"本次 JVM 的 H2 库名后缀"写进系统属性。
 *
 * <p>为什么需要这个监听器，而不是让每个测试类自己引用 {@link H2TestDatabases}：
 * 有些测试类用 {@code @ActiveProfiles("test")} 从 properties 文件里取
 * {@code spring.datasource.url}，而那个 URL 里的 {@code ${typeme.test.h2.run-id}}
 * 必须在**配置被解析之前**就有值。依赖"某个测试类恰好调用了帮助类的方法"
 * 是隐式且脆弱的：一旦那个调用被重构掉，占位符就静默回落到固定库名，
 * 于是"同一次会话里跑第二遍 mvn test 就变红"重新出现，而没人会想到问题在这里。
 *
 * <p>通过 {@code META-INF/spring.factories} 注册后，这个监听器对所有测试类生效，
 * 顺序上与具体测试类怎么写无关。{@code beforeTestClass} 一定早于该类的上下文创建。
 */
public final class H2RunIdListener implements TestExecutionListener {

    @Override
    public void beforeTestClass(TestContext testContext) {
        // 触发 H2TestDatabases 的静态初始化块（幂等：同一个 JVM 里只会有一个 RUN_ID）
        H2TestDatabases.ensureInitialized();
    }
}
