-- V4：AI 分析任务的表结构（契约 02 §1、§5）。
--
-- 兼容性约束（必须同时在 MySQL 8.4 与 H2 2.2 的 MySQL 兼容模式下执行）：
--   * 不用 ENGINE= / DEFAULT CHARSET= / COMMENT= / ON UPDATE CURRENT_TIMESTAMP；
--   * 不写 CREATE DATABASE / USE / DROP DATABASE，也不引用其它库；
--   * 类型只用 VARCHAR / CHAR / TINYINT / INT / BIGINT / DATETIME(6) / MEDIUMTEXT / DATE。
--
-- 说明：本文件由 AI 模块负责，账号/会话模块的导出与注销清理按表名直接读/删这些表。

CREATE TABLE ai_analysis_job (
    id                CHAR(36)    NOT NULL,
    user_id           CHAR(36)    NOT NULL,
    report_id         CHAR(36)    NOT NULL,
    idempotency_key   VARCHAR(80) NOT NULL,
    -- request_hash = sha256(userId | reportHash | promptVersion | model | topic | sha256(note) | scopeVersion)
    request_hash      CHAR(64)    NOT NULL,
    prompt_version    VARCHAR(32) NOT NULL,
    topic             VARCHAR(32) NOT NULL,
    model_requested   VARCHAR(64) NOT NULL,
    model_returned    VARCHAR(64) NULL,
    -- QUEUED / RUNNING / SUCCEEDED / FAILED / UNKNOWN / CANCELLED（契约 03 §6 状态机）
    status            VARCHAR(16) NOT NULL,
    attempt_count     INT         NOT NULL DEFAULT 0,
    -- lease：worker 认领后写入，过期即视为进程崩溃，由恢复扫描按 requested_at 分流
    lease_until       DATETIME(6) NULL,
    lease_owner       VARCHAR(64) NULL,
    next_run_at       DATETIME(6) NULL,
    -- 发出上游请求**之前**写入：区分"从未发出"（可安全重排）与"已发出结果未知"（绝不自动重发）
    requested_at      DATETIME(6) NULL,
    response_json     MEDIUMTEXT  NULL,
    usage_json        VARCHAR(500) NULL,
    error_code        VARCHAR(32) NULL,
    created_at        DATETIME(6) NOT NULL,
    finished_at       DATETIME(6) NULL,
    CONSTRAINT pk_ai_analysis_job PRIMARY KEY (id),
    -- 重复点击只产生一个任务
    CONSTRAINT uk_ai_job_idem UNIQUE (user_id, idempotency_key),
    -- 同一用户同一输入只生成一份（重试作用于同一行，不新建）
    CONSTRAINT uk_ai_job_request UNIQUE (user_id, request_hash),
    CONSTRAINT fk_ai_job_user FOREIGN KEY (user_id) REFERENCES app_user (id),
    -- ON DELETE CASCADE：删报告即带走其 AI 任务（契约 02 §7.2 DELETE /reports/{id}）
    CONSTRAINT fk_ai_job_report FOREIGN KEY (report_id) REFERENCES assessment_report (id) ON DELETE CASCADE
);

-- worker 扫描待办：契约写 (status, next_run_at)。
CREATE INDEX idx_ai_job_pending ON ai_analysis_job (status, next_run_at);

CREATE TABLE ai_consent (
    id             CHAR(36)     NOT NULL,
    user_id        CHAR(36)     NOT NULL,
    job_id         CHAR(36)     NOT NULL,
    policy_version VARCHAR(32)  NOT NULL,
    scope          VARCHAR(500) NOT NULL,
    evidence_ids   VARCHAR(500) NOT NULL,
    confirmed_at   DATETIME(6)  NOT NULL,
    CONSTRAINT pk_ai_consent PRIMARY KEY (id),
    CONSTRAINT fk_ai_consent_job FOREIGN KEY (job_id) REFERENCES ai_analysis_job (id) ON DELETE CASCADE
);

CREATE INDEX idx_ai_consent_job ON ai_consent (job_id);

-- 额度：全局额度用 scope_key='global'，不用 nullable user_id（契约 §5.3）。
-- 原子预留靠 INSERT ... ON DUPLICATE KEY UPDATE / MERGE（见 AiBudgetRepository，按方言选择）。
CREATE TABLE ai_usage_budget (
    scope_key             VARCHAR(64) NOT NULL,
    budget_date           DATE        NOT NULL,
    reserved_calls        INT         NOT NULL DEFAULT 0,
    actual_calls          INT         NOT NULL DEFAULT 0,
    actual_tokens         BIGINT      NOT NULL DEFAULT 0,
    estimated_cost_micros BIGINT      NOT NULL DEFAULT 0,
    revision              BIGINT      NOT NULL DEFAULT 0,
    CONSTRAINT pk_ai_usage_budget PRIMARY KEY (scope_key, budget_date)
);
