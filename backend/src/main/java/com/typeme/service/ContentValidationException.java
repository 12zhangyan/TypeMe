package com.typeme.service;

/**
 * 内容校验失败。抛出即意味着 Spring 上下文启动失败（快速失败，ADR-3），
 * 而不是把坏内容带到线上。
 */
public class ContentValidationException extends IllegalStateException {

    private static final long serialVersionUID = 1L;

    public ContentValidationException(String message) {
        super(message);
    }

    public ContentValidationException(String message, Throwable cause) {
        super(message, cause);
    }
}
