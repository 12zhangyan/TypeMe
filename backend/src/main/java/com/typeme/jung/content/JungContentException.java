package com.typeme.jung.content;

/** 新测内容包校验失败。启动期抛出即让应用启动失败，不降级成"能跑但结果不可信"。 */
public class JungContentException extends RuntimeException {

    public JungContentException(String message) {
        super(message);
    }

    public JungContentException(String message, Throwable cause) {
        super(message, cause);
    }
}
