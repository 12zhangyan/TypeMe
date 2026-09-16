package com.typeme;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * TypeMe 后端入口。
 *
 * <p>后端只做两件事：把 YAML 内容（题库 / 类型文案 / 方法说明）以只读 REST 接口下发，
 * 以及在这些内容不满足官方 OEJTS 1.2 的硬约束时让启动失败（快速失败，ADR-3）。
 * 后端不参与计分、不做持久化（ADR-1 / ADR-2）。
 */
@SpringBootApplication
public class TypeMeApplication {

    public static void main(String[] args) {
        SpringApplication.run(TypeMeApplication.class, args);
    }
}
