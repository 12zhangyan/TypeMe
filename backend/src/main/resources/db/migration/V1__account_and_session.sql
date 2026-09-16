-- V1：账号与会话（契约 02 §1、§2）。
--
-- 兼容性约束（必须同时在 MySQL 8.4 与 H2 2.2 的 MySQL 兼容模式下执行）：
--   * 不用 ENGINE= / DEFAULT CHARSET= / COMMENT= / ON UPDATE CURRENT_TIMESTAMP；
--   * 类型只用 VARCHAR / CHAR / TINYINT / INT / BIGINT / DATETIME(6)；
--   * 不写 CREATE DATABASE / USE。
--
-- 唯一的"例外"是 app_user.role 上的列级 COLLATE：不加它，CHECK 白名单在 MySQL 上会被
-- 库默认的 utf8mb4_0900_ai_ci 放宽成大小写不敏感（'user' 也能写进去），详见下面的列注释。
-- 全部 7 个脚本里这样的列一共 8 个（role / kind / 两个类型码 / 两个 status / id / api_key_source）。
--
-- 为什么没有契约 §2.3 的 SPRING_SESSION 表：
--   本轮会话走容器内存 HttpSession（闲置 2h 由容器管），绝对 7 天上限与"按用户批量撤销"
--   由下面的 app_user_session 表 + SessionAbsoluteTtlFilter / SessionRegistryService 落实。
--   不引入 Spring Session JDBC（任务明确排除），因此也没有它的 schema。

CREATE TABLE app_user (
    id                     CHAR(36)    NOT NULL,
    username_normalized    VARCHAR(64) NOT NULL,
    username_display       VARCHAR(64) NOT NULL,
    password_hash          VARCHAR(255) NOT NULL,
    nickname               VARCHAR(64) NULL,
    status                 VARCHAR(16) NOT NULL,
    -- 角色：USER / ADMIN。权限名由 TypemeUserDetailsService 映射为 ROLE_<role>。
    -- DEFAULT 'USER' 让手工插入与新建列都不缺值，应用层仍然永远显式写值。
    --
    -- 为什么这一列显式钉 COLLATE（2026-09-16 在真实 MySQL 8.4 上实测后补的）：
    --   库默认排序规则是 utf8mb4_0900_ai_ci（大小写与重音都不敏感），于是下面
    --   ck_app_user_role 的 IN 白名单在 MySQL 上会**放行 'user'**（实测 INSERT 成功、无报错），
    --   而 H2(MODE=MySQL) 默认大小写敏感、直接拒绝 —— 同一份脚本在两个引擎上语义不同，
    --   "白名单钉在数据库里"的意图落空。钉成 as_cs（大小写敏感）后，
    --   两个引擎都只接受大写枚举值（实测 'user' → ERROR 3819）。
    --
    -- 写法为什么是"列定义最末尾的裸 COLLATE"（两个引擎的语法交集只有这一种，都实测过）：
    --   * MySQL 8.4 只接受紧跟类型之后的 `CHARACTER SET x COLLATE y`，不认 `NOT NULL DEFAULT ... CHARACTER SET ...`；
    --   * H2 2.2.224 反过来：`COLLATE ... NOT NULL DEFAULT ...` 直接语法错误，只认放在 DEFAULT/NOT NULL 之后；
    --   * `... NOT NULL DEFAULT 'USER' COLLATE utf8mb4_0900_as_cs` 两边都通过（MySQL 会把它规范化成
    --     `varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'USER'`）。
    --   附带前提：库的字符集必须是 utf8mb4，否则 MySQL 会报"该 collation 与列字符集不匹配"。
    --   另外 H2 能解析这个 COLLATE 但不会真正应用它 —— H2 本来就大小写敏感，所以结果一致。
    role                   VARCHAR(16) NOT NULL DEFAULT 'USER' COLLATE utf8mb4_0900_as_cs,
    created_at             DATETIME(6) NOT NULL,
    password_changed_at    DATETIME(6) NOT NULL,
    recovery_code_version  INT         NOT NULL,
    deletion_requested_at  DATETIME(6) NULL,
    CONSTRAINT pk_app_user PRIMARY KEY (id),
    CONSTRAINT uk_app_user_username UNIQUE (username_normalized),
    -- 白名单钉在数据库里：越权面比"多一个枚举值"贵得多，应用层算错角色也写不进非法值。
    CONSTRAINT ck_app_user_role CHECK (role IN ('USER', 'ADMIN'))
);

-- 恢复码：只存 PasswordEncoder 的 hash，永不存明文/密文（契约 §2.2）。
CREATE TABLE account_recovery_code (
    id          CHAR(36)    NOT NULL,
    user_id     CHAR(36)    NOT NULL,
    code_hash   VARCHAR(255) NOT NULL,
    code_index  INT         NOT NULL,
    used_at     DATETIME(6) NULL,
    created_at  DATETIME(6) NOT NULL,
    revoked_at  DATETIME(6) NULL,
    CONSTRAINT pk_account_recovery_code PRIMARY KEY (id),
    -- ON DELETE CASCADE：注销 worker 删除 app_user 行时会带走残余恢复码，
    -- 不让"已删除账号"留下任何凭据材料。
    CONSTRAINT fk_recovery_user FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
);

CREATE INDEX idx_recovery_user ON account_recovery_code (user_id, used_at);

-- 会话账本（契约 §2.3 的替代实现）：一行 = 一个有效的服务端会话。
-- 绝对期限在此表，闲置期限在容器；撤销 = 删行 + 让进程内 HttpSession 立即失效。
--
-- 为什么这里**不加** app_user 外键：会话行是短生命周期的高频写入记录，
-- 而注销流程会先把账号置为 DISABLED 再逐步清理；加外键会让"先删账号行、后清会话"
-- 这类顺序在 worker 里变成硬约束。契约 §2.3 也未要求这里的外键。
CREATE TABLE app_user_session (
    session_id          VARCHAR(64) NOT NULL,
    user_id             CHAR(36)    NOT NULL,
    created_at          DATETIME(6) NOT NULL,
    last_seen_at        DATETIME(6) NOT NULL,
    absolute_expires_at DATETIME(6) NOT NULL,
    CONSTRAINT pk_app_user_session PRIMARY KEY (session_id)
);

CREATE INDEX idx_session_user ON app_user_session (user_id);
