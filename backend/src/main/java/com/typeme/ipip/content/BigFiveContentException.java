package com.typeme.ipip.content;

/** 大五内容包的结构或内容不合法（启动期即失败）。 */
public class BigFiveContentException extends RuntimeException {

    public BigFiveContentException(String message) {
        super(message);
    }

    public BigFiveContentException(String message, Throwable cause) {
        super(message, cause);
    }
}
