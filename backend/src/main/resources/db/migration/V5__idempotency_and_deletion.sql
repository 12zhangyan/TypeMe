-- V5：幂等记录、注销任务与限流桶（契约 02 §1、§5.4、§6）。

-- 幂等：同 key 不同 request_hash → 409；同 key 同 hash 且 COMPLETED → 返回 response_ref。
CREATE TABLE api_idempotency (
    user_id         CHAR(36)    NOT NULL,
    operation       VARCHAR(48) NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL,
    request_hash    CHAR(64)    NOT NULL,
    response_ref    VARCHAR(64) NULL,
    -- 钉 as_cs 的理由同 V1 的 app_user.role：默认 utf8mb4_0900_ai_ci 大小写不敏感，
    -- 会让 ck_idempotency_status 放行小写 'in_progress'（2026-09-16 实测 MySQL 插入成功），
    -- 而应用层用大写的 'IN_PROGRESS' / 'COMPLETED' 做 equals 比较。
    -- COLLATE 只能写在列定义最末尾（两个引擎的语法交集，详见 V1 的注释）。
    status          VARCHAR(16) NOT NULL COLLATE utf8mb4_0900_as_cs,
    created_at      DATETIME(6) NOT NULL,
    expires_at      DATETIME(6) NOT NULL,
    CONSTRAINT pk_api_idempotency PRIMARY KEY (user_id, operation, idempotency_key),
    CONSTRAINT ck_idempotency_status CHECK (status IN ('IN_PROGRESS', 'COMPLETED'))
);

-- worker 清理过期幂等记录用（契约未要求，但 expires_at 若无索引，清理会全表扫）。
CREATE INDEX idx_idempotency_expires ON api_idempotency (expires_at);

-- 注销任务：一个账号一行（UNIQUE 保证重复提交不会排两个任务）。
CREATE TABLE account_deletion_job (
    id              CHAR(36)    NOT NULL,
    user_id         CHAR(36)    NOT NULL,
    -- 同 api_idempotency.status：不钉 collation 时 ck_deletion_job_status 会放行小写 'pending'/'done'，
    -- 而 worker 用大写枚举值判状态机。COLLATE 位置同 V1 的说明。
    status          VARCHAR(16) NOT NULL COLLATE utf8mb4_0900_as_cs,
    requested_at    DATETIME(6) NOT NULL,
    completed_at    DATETIME(6) NULL,
    attempt_count   INT         NOT NULL,
    last_error_code VARCHAR(32) NULL,
    CONSTRAINT pk_account_deletion_job PRIMARY KEY (id),
    CONSTRAINT uk_deletion_job_user UNIQUE (user_id),
    CONSTRAINT ck_deletion_job_status CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED'))
);

-- worker 扫描待办任务
CREATE INDEX idx_deletion_job_pending ON account_deletion_job (status, requested_at);

-- 限流桶：bucket_key = <operation>:<scope>:<value>:<windowStart>，
-- 固定窗口计数靠 PRIMARY KEY + 原子 upsert 完成，不需要额外锁。
CREATE TABLE rate_limit_bucket (
    bucket_key   VARCHAR(160) NOT NULL,
    window_start DATETIME(6)  NOT NULL,
    counter      INT          NOT NULL,
    revision     BIGINT       NOT NULL,
    CONSTRAINT pk_rate_limit_bucket PRIMARY KEY (bucket_key)
);

-- 过期桶的清理（容量治理）；契约未要求，但没有它这张表会无限增长。
CREATE INDEX idx_rate_limit_window ON rate_limit_bucket (window_start);
