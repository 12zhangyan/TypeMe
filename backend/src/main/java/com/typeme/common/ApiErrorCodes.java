package com.typeme.common;

/**
 * {@code /api/v3} 的错误码白名单（契约 02 §7.1）。
 *
 * <p>做成常量而不是散落的字符串字面量：错误码是前端分支的依据，拼错一个字母就会让前端
 * 掉进"未知错误"兜底分支，而这种错在代码评审里几乎看不出来。
 *
 * <p>这里只列出**账号模块真正会用到**的那些；attempt/report/AI 相关的码由对应模块自行补充
 * （它们属于各自的服务层，硬塞进本类只会制造一个谁都不敢删的垃圾抽屉）。
 */
public final class ApiErrorCodes {

    /** 字段校验失败；{@code details.fields} 给安全信息（字段名 + 规则，绝不回显输入值）。 */
    public static final String VALIDATION_FAILED = "VALIDATION_FAILED";

    /** 请求本身不合法（解析失败、未知枚举值、非法类型码等）。 */
    public static final String INVALID_REQUEST = "INVALID_REQUEST";

    /** 登录失败。**刻意不区分用户名是否存在**，避免账号枚举。 */
    public static final String INVALID_CREDENTIALS = "INVALID_CREDENTIALS";

    /** 未登录或会话已失效。 */
    public static final String UNAUTHENTICATED = "UNAUTHENTICATED";

    /** CSRF 校验失败。 */
    public static final String CSRF_INVALID = "CSRF_INVALID";

    /** 已登录但无权访问（例如非 ADMIN 访问后台接口）。 */
    public static final String FORBIDDEN = "FORBIDDEN";

    /** 资源不存在**或不属于当前用户**：两者同形，避免通过 404/403 差异枚举他人资源。 */
    public static final String NOT_FOUND = "NOT_FOUND";

    /** 唯一键冲突（用户名已存在、删除任务重复提交等）。 */
    public static final String CONFLICT = "CONFLICT";

    /** 限流；{@code details.retryAfterSeconds} 告诉前端还能等多久。 */
    public static final String RATE_LIMITED = "RATE_LIMITED";

    /** 服务端未配置（例如后台 AI 设置缺少加密密钥）。 */
    public static final String NOT_CONFIGURED = "NOT_CONFIGURED";

    /** 服务内部错误；对外只有固定文案，绝不回传堆栈。 */
    public static final String INTERNAL = "INTERNAL";

    private ApiErrorCodes() {
    }
}
