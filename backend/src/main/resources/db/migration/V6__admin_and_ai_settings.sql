-- V6：管理员与后台 AI 设置。
--
-- 序号说明：V1（账号/会话）、V2（内容包/attempt）、V3（报告/自我理解）、V4（AI 任务）、
-- V5（幂等/注销/限流）之后取 V6，为**并行模块**的迁移留出空位；本文件属于账号模块。
-- 同样必须 H2(MODE=MySQL) 可跑：不用 TINYINT(1)、不用 COMMENT、不用 ON UPDATE。
--
-- 单行配置表：id 固定为 'default'，所以主键本身就是"只允许一行"的约束，
-- 不需要额外的 CHECK 或应用层加锁来维持唯一性。

CREATE TABLE typeme_ai_setting (
    -- 钉 as_cs 的理由同 V1 的 app_user.role：默认 utf8mb4_0900_ai_ci 大小写不敏感时，
    -- ck_ai_setting_singleton 会把 'DEFAULT' 当成 'default'（实测被主键 1062 挡下，是"碰巧"守住），
    -- api_key_source 的白名单也会放行大写 'ENV'（实测 UPDATE 成功）。钉死后两者都是 ERROR 3819。
    -- COLLATE 只能写在列定义最末尾（两个引擎的语法交集，详见 V1 的注释）。
    id                        VARCHAR(16)  NOT NULL COLLATE utf8mb4_0900_as_cs,
    enabled                   TINYINT      NOT NULL,
    base_url                  VARCHAR(255) NULL,
    -- Spring Security TextEncryptor 的输出（含盐与 IV 的十六进制/Base64 文本），
    -- 因此比明文长：明文 key 一般 <100 字符，这里留 1024 足够且不会静默截断。
    api_key_encrypted         VARCHAR(1024) NULL,
    api_key_fingerprint       CHAR(8)      NULL,
    -- 同 typeme_ai_setting.id：不钉 collation 时白名单会放行大写 'ENV'（实测 UPDATE 成功），
    -- 而应用层用 'db' / 'env' / 'none' 判来源。
    api_key_source            VARCHAR(8)   NOT NULL COLLATE utf8mb4_0900_as_cs,
    model                     VARCHAR(64)  NOT NULL,
    prompt_version            VARCHAR(32)  NOT NULL,
    daily_limit_per_user      INT          NOT NULL,
    retry_limit_per_hour      INT          NOT NULL,
    global_daily_call_budget  INT          NOT NULL,
    global_daily_token_budget BIGINT       NOT NULL,
    worker_concurrency        INT          NOT NULL,
    connect_timeout_ms        INT          NOT NULL,
    request_deadline_ms       INT          NOT NULL,
    max_tokens                INT          NOT NULL,
    mock_mode                 TINYINT      NOT NULL,
    updated_at                DATETIME(6)  NOT NULL,
    updated_by                CHAR(36)     NULL,
    CONSTRAINT pk_typeme_ai_setting PRIMARY KEY (id),
    CONSTRAINT ck_ai_setting_singleton CHECK (id = 'default'),
    CONSTRAINT ck_ai_setting_source CHECK (api_key_source IN ('db', 'env', 'none')),
    CONSTRAINT ck_ai_setting_enabled CHECK (enabled IN (0, 1)),
    CONSTRAINT ck_ai_setting_mock CHECK (mock_mode IN (0, 1))
);
