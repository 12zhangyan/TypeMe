package com.typeme.model;

/**
 * v2 只读内容包接口的**错误响应体**（字段规格 §9，开发方案 §5.3）。
 *
 * <p>只有两个字段，因为错误响应不得回传文件路径、堆栈或异常消息：
 * {@code GET /api/v2/assessment-packages/{id}} 的调用方（浏览器）对失败原因能做的只有
 * 「用同一个 packageId 的内置副本」或「显示不可用」，多给的信息只会变成信息泄露面。
 *
 * <p>record 的字段顺序就是 Jackson 的序列化顺序，所以响应体逐字为
 * {@code {"code":"...","message":"..."}}。
 */
public record ContentErrorBody(String code, String message) {
}
