package com.typeme.ai.output;

import com.typeme.ai.client.DeepSeekException;

/**
 * 结构化输出校验失败。
 *
 * <p>{@code errorCode} 直接落 {@code ai_analysis_job.error_code}，取值限定在契约 03 §3 规定的那几个：
 * {@code INVALID_JSON} / {@code TYPE_MISMATCH} / {@code TRUNCATED} / {@code EMPTY_CONTENT} /
 * {@code CONTENT_VIOLATION}。这些都属于"明确失败"：**不自动重试**（重试大概率又付一次钱拿到同样的坏输出）。
 */
public class AnalysisValidationException extends RuntimeException {

    private final String errorCode;

    public AnalysisValidationException(String errorCode, String message) {
        super(message);
        this.errorCode = errorCode;
    }

    public String errorCode() {
        return errorCode;
    }

    public static AnalysisValidationException invalidJson(String message) {
        return new AnalysisValidationException(DeepSeekException.Codes.INVALID_JSON, message);
    }

    public static AnalysisValidationException typeMismatch(String message) {
        return new AnalysisValidationException(DeepSeekException.Codes.TYPE_MISMATCH, message);
    }

    public static AnalysisValidationException truncated(String message) {
        return new AnalysisValidationException(DeepSeekException.Codes.TRUNCATED, message);
    }

    public static AnalysisValidationException emptyContent(String message) {
        return new AnalysisValidationException(DeepSeekException.Codes.EMPTY_CONTENT, message);
    }

    public static AnalysisValidationException contentViolation(String message) {
        return new AnalysisValidationException(DeepSeekException.Codes.CONTENT_VIOLATION, message);
    }
}
