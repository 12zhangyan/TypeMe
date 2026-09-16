package com.typeme.account.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 账号相关字段的校验规则集中处（契约 §2.1 / §7.2）。
 *
 * <p>把正则与长度上限做成**共享常量**而不是在每个 DTO 上重抄一遍：注册、登录、恢复三条路径
 * 都必须用同一套用户名规则，一旦其中一处写宽了（例如登录允许任意长度），
 * 就会出现"能注册不能登录"或更糟的"用超长用户名做哈希碰撞探测"。
 *
 * <p>这些注解是**第一道**校验。服务层仍会再校验一次（例如昵称的字符数按 Unicode 码点算，
 * 而这里按 UTF-16 长度算）——双重校验在这里不是冗余，因为 DTO 只保护控制器路径。
 */
public final class AccountFieldRules {

    /** 用户名：4–32 位 ASCII 字母、数字、下划线。 */
    public static final String USERNAME_PATTERN = "^[A-Za-z0-9_]{4,32}$";

    /** 密码：8–72 字符。上限 72 是 bcrypt 的历史限制，PBKDF2 无此限制，但保留它避免"换编码器后行为变化"。 */
    public static final int PASSWORD_MIN = 8;
    public static final int PASSWORD_MAX = 72;

    /**
     * 密码允许的字符：可见 ASCII + 空格。
     *
     * <p>刻意**不**做"必须含大小写/数字/符号"的复杂度强制（开发方案 §5 明确不强制无意义组合），
     * 但必须挡住控制字符：{@code \u0000} 之类会被某些驱动截断，造成"密码看起来一样、
     * 实际存的不一样"的诡异故障，也可能污染日志。
     */
    public static final String PASSWORD_PATTERN = "^[\\x20-\\x7E]+$";

    /** 昵称：1–32 字符，允许中文，禁止控制字符（首尾空白在服务层 trim 后校验）。 */
    public static final int NICKNAME_MAX = 32;

    /**
     * 可选字段的昵称规则：null 放行（{@code @Pattern} 天然跳过 null），
     * 但纯空白串要挡住 —— {@code "   "} 作为昵称在界面上等于"没填"，却会占掉一个展示位。
     * 用负向先行断言而不是 {@code @NotBlank}：后者会把"不传昵称"也判失败。
     */
    public static final String NICKNAME_NON_BLANK_PATTERN = "^(?!\\s*$)[^\\p{Cntrl}]+$";

    /** 注销确认词：必须逐字相等，避免"点错按钮就删号"。 */
    public static final String DELETE_CONFIRMATION = "DELETE";

    private AccountFieldRules() {
    }
}
