# 新测数据模型与 /api/v3 契约 v1

状态：**实现冻结稿**。Flyway 迁移、Java 持久化、前端 API 客户端三处都必须与本文一致。
配套：[`01-新测契约-v1.md`](01-新测契约-v1.md)（计分与报告）、[`03-AI与前端契约-v1.md`](03-AI与前端契约-v1.md)。

通用约束：

- 所有 ID 为 `CHAR(36)` UUID 文本（`BINARY(16)` 亦可，但迁移与 Java 必须一致；本契约取 `CHAR(36)` 便于排错）。
- 所有时间为 `DATETIME(6)`，**以 UTC 存储**；展示按用户时区。
- 表名、列名一律小写下划线；字符集 `utf8mb4`，排序规则 `utf8mb4_0900_ai_ci`（MySQL 8.4）。
- 数据库名由部署配置给出（示例 `typeme_dev`），**迁移脚本里不写 `USE`/`CREATE DATABASE`**。
- 迁移文件：`backend/src/main/resources/db/migration/`，命名 `V<序号>__<描述>.sql`，序号连续、只增不改。
  已交付的迁移文件不得原地修改（新增修正用新的序号）。
- `spring.jpa.hibernate.ddl-auto` 禁用；本项目用 `spring-boot-starter-jdbc`（不引入 JPA）。

---

## 1. Flyway 迁移切分

| 文件 | 内容 |
|---|---|
| `V1__account_and_session.sql` | `app_user`、`account_recovery_code`、Spring Session JDBC 表 |
| `V2__assessment_content_and_attempt.sql` | `assessment_package`、`assessment_attempt`、`assessment_answer` |
| `V3__report_and_self_reflection.sql` | `assessment_report`、`report_self_reflection` |
| `V4__ai_analysis.sql` | `ai_analysis_job`、`ai_consent`、`ai_usage_budget` |
| `V5__idempotency_and_deletion.sql` | `api_idempotency`、`account_deletion_job`、`rate_limit_bucket` |

---

## 2. 账号与会话

### 2.1 `app_user`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `username_normalized` | `VARCHAR(64)` | NOT NULL, UNIQUE（小写后的用户名） |
| `username_display` | `VARCHAR(64)` | NOT NULL（用户输入的原样显示值） |
| `password_hash` | `VARCHAR(255)` | NOT NULL（PasswordEncoder 输出，含算法与参数） |
| `nickname` | `VARCHAR(64)` | NULL |
| `status` | `VARCHAR(16)` | NOT NULL default `ACTIVE`（`ACTIVE` / `DISABLED` / `DELETED`） |
| `created_at` | `DATETIME(6)` | NOT NULL |
| `password_changed_at` | `DATETIME(6)` | NOT NULL |
| `recovery_code_version` | `INT` | NOT NULL default 0（每次重发恢复码 +1，用于一次性判定） |
| `deletion_requested_at` | `DATETIME(6)` | NULL |

索引：`uk_app_user_username (username_normalized)`。

用户名规则：`^[A-Za-z0-9_]{4,32}$`（规范化 = `toLowerCase(Locale.ROOT)`）。
昵称：1–32 字符，允许中文，禁止首尾空白，禁止控制字符。

### 2.2 `account_recovery_code`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL, FK → `app_user(id)` ON DELETE CASCADE |
| `code_hash` | `VARCHAR(255)` | NOT NULL（**只存 hash**，永不存明文/密文） |
| `code_index` | `INT` | NOT NULL（一组内第几个，便于审计） |
| `used_at` | `DATETIME(6)` | NULL |
| `created_at` | `DATETIME(6)` | NOT NULL |
| `revoked_at` | `DATETIME(6)` | NULL |

索引：`idx_recovery_user (user_id, used_at)`。
原子消费：`UPDATE ... SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL`，
受影响行数必须为 1；随后在同一事务内改密码、`UPDATE app_user SET recovery_code_version = recovery_code_version + 1`、
把该用户**其余**未使用恢复码全部 `revoked_at`。

### 2.3 Spring Session JDBC

用所用 Spring Session 版本自带的 `org/springframework/session/jdbc/schema-mysql.sql` 内容，
放进 `V1`，**表名保持默认**（`SPRING_SESSION`、`SPRING_SESSION_ATTRIBUTES`），
只做必要的 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` 补充。不自行发明认证 token 表。

会话策略（配置项，默认值）：闲置 `2h`（`server.servlet.session.timeout=2h`）、
绝对上限 `7d`（自定义 `typeme.auth.session-absolute-ttl=7d`，服务端在过滤链里落实）。

---

## 3. 内容包与测评

### 3.1 `assessment_package`

| 列 | 类型 | 约束 |
|---|---|---|
| `package_id` | `VARCHAR(64)` | PK |
| `instrument_id` | `VARCHAR(64)` | NOT NULL |
| `scoring_version` | `VARCHAR(64)` | NOT NULL |
| `report_content_version` | `VARCHAR(64)` | NOT NULL |
| `content_status` | `VARCHAR(32)` | NOT NULL |
| `content_json` | `MEDIUMTEXT` | NOT NULL（规范化 JSON 全量快照） |
| `sha256` | `CHAR(64)` | NOT NULL |
| `published_at` | `DATETIME(6)` | NOT NULL |

**已发布不可更新**：应用层只 INSERT，遇到同 `package_id` 存在即拒绝（不 UPDATE）。
若内容变更需换新 `package_id`。类型报告内容同样登记为一行（`package_id = 'typeme-type-report-zh-v1'`，
`instrument_id = 'typeme-type-report'`），便于报告快照引用版本。

### 3.2 `assessment_attempt`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL, FK → `app_user(id)` |
| `package_id` | `VARCHAR(64)` | NOT NULL, FK → `assessment_package(package_id)` |
| `status` | `VARCHAR(32)` | NOT NULL（`BASE_IN_PROGRESS`/`CLARIFICATION_IN_PROGRESS`/`SUBMITTED`） |
| `revision` | `BIGINT` | NOT NULL default 0（每次答案变更 +1） |
| `current_question_id` | `VARCHAR(16)` | NULL |
| `clarification_dimensions` | `VARCHAR(32)` | NOT NULL default `''`（逗号分隔，如 `EI,JP`；空串=未安排） |
| `clarification_skipped` | `TINYINT(1)` | NOT NULL default 0 |
| `base_attempt_id` | `CHAR(36)` | NULL（派生来源） |
| `started_at` | `DATETIME(6)` | NOT NULL |
| `updated_at` | `DATETIME(6)` | NOT NULL |
| `submitted_at` | `DATETIME(6)` | NULL |

索引：`idx_attempt_user (user_id, updated_at DESC)`、`idx_attempt_user_status (user_id, status)`。

`clarification_dimensions` 的**唯一合法取值**是 `''`、`EI`、`SN`、`TF`、`JP` 及其按
`EI,SN,TF,JP` 序的组合（`EI,SN`、`EI,JP`、`EI,SN,TF,JP`…）。写入前必须校验，
不能塞入任意字符串。

### 3.3 `assessment_answer`

| 列 | 类型 | 约束 |
|---|---|---|
| `attempt_id` | `CHAR(36)` | NOT NULL, FK → `assessment_attempt(id)` ON DELETE CASCADE |
| `question_id` | `VARCHAR(16)` | NOT NULL |
| `kind` | `VARCHAR(16)` | NOT NULL（`RATING` / `UNKNOWN`） |
| `rating` | `TINYINT` | NULL |
| `updated_at` | `DATETIME(6)` | NOT NULL |

约束：`PRIMARY KEY (attempt_id, question_id)`；
`CHECK (kind = 'UNKNOWN' AND rating IS NULL OR kind = 'RATING' AND rating BETWEEN 1 AND 5)`
（MySQL 8.4 支持 CHECK）；`CHECK (kind IN ('RATING','UNKNOWN'))`。

`question_id` 必须属于该 attempt 锁定包、且属于**已安排阶段**（未安排的澄清题不得写入）。
数据库不强制这一点（跨表条件），由服务层校验并测试。

---

## 4. 报告与自我理解

### 4.1 `assessment_report`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `attempt_id` | `CHAR(36)` | NOT NULL, **UNIQUE**, FK → `assessment_attempt(id)` |
| `user_id` | `CHAR(36)` | NOT NULL, FK → `app_user(id)` |
| `status` | `VARCHAR(16)` | NOT NULL（`REFERENCE`/`TENTATIVE`/`TIED`） |
| `computed_type_code` | `CHAR(4)` | NULL（`TIED` 时为 NULL；否则 `^[EI][SN][TF][JP]$`） |
| `score_json` | `MEDIUMTEXT` | NOT NULL（四维分项、候选、覆盖、版本） |
| `report_json` | `MEDIUMTEXT` | NOT NULL（§7 of 01 的完整快照） |
| `report_hash` | `CHAR(64)` | NOT NULL |
| `created_at` | `DATETIME(6)` | NOT NULL |

索引：`idx_report_user (user_id, created_at DESC)`。
**提交后不可变**：应用层不提供任何 UPDATE（除删除）；`UNIQUE(attempt_id)` 保证重复提交只产生一份报告。
`computed_type_code` 用 `CHECK` 钉住格式：`CHECK (computed_type_code IS NULL OR computed_type_code REGEXP '^[EI][SN][TF][JP]$')`。

### 4.2 `report_self_reflection`

| 列 | 类型 | 约束 |
|---|---|---|
| `report_id` | `CHAR(36)` | PK, FK → `assessment_report(id)` ON DELETE CASCADE |
| `user_id` | `CHAR(36)` | NOT NULL, FK → `app_user(id)` |
| `self_selected_type_code` | `CHAR(4)` | NULL |
| `note` | `VARCHAR(500)` | NULL |
| `updated_at` | `DATETIME(6)` | NOT NULL |

`UNIQUE (report_id, user_id)`；写入时必须同时校验 `report.user_id == 当前用户`。
**不得**触碰 `assessment_report` 的任何列。

---

## 5. AI 分析

### 5.1 `ai_analysis_job`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL, FK → `app_user(id)` |
| `report_id` | `CHAR(36)` | NOT NULL, FK → `assessment_report(id)` ON DELETE CASCADE |
| `idempotency_key` | `VARCHAR(80)` | NOT NULL |
| `request_hash` | `CHAR(64)` | NOT NULL（`userId+reportHash+promptVersion+model+topic+文本hash+scopeVersion`） |
| `prompt_version` | `VARCHAR(32)` | NOT NULL |
| `topic` | `VARCHAR(32)` | NOT NULL |
| `model_requested` | `VARCHAR(64)` | NOT NULL |
| `model_returned` | `VARCHAR(64)` | NULL |
| `status` | `VARCHAR(16)` | NOT NULL（`QUEUED`/`RUNNING`/`SUCCEEDED`/`FAILED`/`UNKNOWN`/`CANCELLED`） |
| `attempt_count` | `INT` | NOT NULL default 0 |
| `lease_until` | `DATETIME(6)` | NULL |
| `lease_owner` | `VARCHAR(64)` | NULL |
| `next_run_at` | `DATETIME(6)` | NULL |
| `requested_at` | `DATETIME(6)` | NULL（**发出上游请求前**写入的时间；用于区分"未发出"与"已发出结果未知"） |
| `response_json` | `MEDIUMTEXT` | NULL（校验通过的**结构化输出**） |
| `usage_json` | `VARCHAR(500)` | NULL（官方 usage 回填） |
| `error_code` | `VARCHAR(32)` | NULL（`UPSTREAM_401`/`UPSTREAM_402`/`UPSTREAM_429`/`UPSTREAM_5XX`/`TIMEOUT`/`EMPTY_CONTENT`/`INVALID_JSON`/`TRUNCATED`/`TYPE_MISMATCH`/`NOT_CONFIGURED`/`BUDGET_EXCEEDED`/`RATE_LIMITED`） |
| `created_at` | `DATETIME(6)` | NOT NULL |
| `finished_at` | `DATETIME(6)` | NULL |

索引：
- `uk_ai_job_idem (user_id, idempotency_key)` UNIQUE —— 重复点击只产生一个任务
- `uk_ai_job_request (user_id, request_hash)` UNIQUE —— 同一输入同一用户只生成一份
- `idx_ai_job_pending (status, next_run_at)` —— worker 扫描

**注意**：`uk_ai_job_request` 让"同一用户同输入"只能存在一份任务。用户主动重试作用于**同一行**
（`POST /analyses/{id}/retry`），不新建行。

### 5.2 `ai_consent`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL |
| `job_id` | `CHAR(36)` | NOT NULL, FK → `ai_analysis_job(id)` ON DELETE CASCADE |
| `policy_version` | `VARCHAR(32)` | NOT NULL |
| `scope` | `VARCHAR(500)` | NOT NULL（发送范围的结构化摘要：字段名列表 + 片段数 + 是否含用户文字） |
| `evidence_ids` | `VARCHAR(500)` | NOT NULL（逗号分隔，最多 8 项） |
| `confirmed_at` | `DATETIME(6)` | NOT NULL |

每次创建任务都写一行（无条件）；未确认时**不允许**创建 job，因此不存在"无 consent 的 job"。

### 5.3 `ai_usage_budget`

| 列 | 类型 | 约束 |
|---|---|---|
| `scope_key` | `VARCHAR(64)` | PK 之一（`user:<uuid>` 或 `global`） |
| `budget_date` | `DATE` | PK 之一（UTC 日期） |
| `reserved_calls` | `INT` | NOT NULL default 0 |
| `actual_calls` | `INT` | NOT NULL default 0 |
| `actual_tokens` | `BIGINT` | NOT NULL default 0 |
| `estimated_cost_micros` | `BIGINT` | NOT NULL default 0 |
| `revision` | `BIGINT` | NOT NULL default 0 |

`PRIMARY KEY (scope_key, budget_date)` —— 全局额度用 `scope_key='global'`，**不用 nullable user_id**。

原子预留（同一条 SQL，受影响行数决定成败）：

```sql
INSERT INTO ai_usage_budget (scope_key, budget_date, reserved_calls, actual_calls, actual_tokens, estimated_cost_micros, revision)
VALUES (?, ?, 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE
  reserved_calls = reserved_calls + 1,
  revision = revision + 1;
```

随后校验 `reserved_calls <= limit`；超限则 `UPDATE ... SET reserved_calls = reserved_calls - 1` 并返回
`BUDGET_EXCEEDED`（补偿在同一事务内，避免泄漏预留）。

回填：成功后 `actual_calls = actual_calls + 1, actual_tokens = actual_tokens + ?, estimated_cost_micros = estimated_cost_micros + ?`；
失败且**确认未计费**时才回退 `reserved_calls`；无法确认时保留（保守预算）。

### 5.4 `rate_limit_bucket`

| 列 | 类型 | 约束 |
|---|---|---|
| `bucket_key` | `VARCHAR(160)` | PK（`<operation>:<scope>:<value>:<windowStart>`） |
| `window_start` | `DATETIME(6)` | NOT NULL |
| `counter` | `INT` | NOT NULL default 0 |
| `revision` | `BIGINT` | NOT NULL default 0 |

固定窗口计数（注册/登录/恢复/AI 创建各用不同 `operation`），`ON DUPLICATE KEY UPDATE counter = counter + 1`。
登录限流同时按 `user:<id>` 与 `ip:<addr>` 两个 key 计数（两个 key 各自允许上限）；
`ip` 只取 `request.getRemoteAddr()`，**只有在 `typeme.security.trusted-proxies` 显式配置时**
才解析 `X-Forwarded-For`。

---

## 6. 幂等与注销

### 6.1 `api_idempotency`

| 列 | 类型 | 约束 |
|---|---|---|
| `user_id` | `CHAR(36)` | NOT NULL |
| `operation` | `VARCHAR(48)` | NOT NULL（`create_attempt` / `submit_attempt` / `create_analysis`） |
| `idempotency_key` | `VARCHAR(80)` | NOT NULL |
| `request_hash` | `CHAR(64)` | NOT NULL |
| `response_ref` | `VARCHAR(64)` | NULL（成功时指向已创建资源 id） |
| `status` | `VARCHAR(16)` | NOT NULL（`IN_PROGRESS`/`COMPLETED`） |
| `created_at` | `DATETIME(6)` | NOT NULL |
| `expires_at` | `DATETIME(6)` | NOT NULL |

`PRIMARY KEY (user_id, operation, idempotency_key)`。
同 key 不同 `request_hash` → `409 IDEMPOTENCY_KEY_REUSED`；同 key 同 hash 且 `COMPLETED` → 返回 `response_ref`。

### 6.2 `account_deletion_job`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `CHAR(36)` | PK |
| `user_id` | `CHAR(36)` | NOT NULL, UNIQUE（一个账号一个删除任务） |
| `status` | `VARCHAR(16)` | NOT NULL（`PENDING`/`RUNNING`/`DONE`/`FAILED`） |
| `requested_at` | `DATETIME(6)` | NOT NULL |
| `completed_at` | `DATETIME(6)` | NULL |
| `attempt_count` | `INT` | NOT NULL default 0 |
| `last_error_code` | `VARCHAR(32)` | NULL |

注销流程：`app_user.status='DISABLED'` 且 `deletion_requested_at=now()`（立即禁止登录）→
撤销全部会话 → `CANCELLED` 所有非终止 AI job → 建 `account_deletion_job(PENDING)` →
worker 分事务删除报告/答案/attempt/AI/恢复码/幂等记录/配额 → 最后
`app_user.status='DELETED'`、`username_normalized` 改写为 `deleted:<uuid>`（释放用户名且不复活）。

---

## 7. `/api/v3` 接口契约

所有路径以 `/api/v3` 为前缀。除 `GET /auth/csrf`、`POST /auth/register|login|recover`、
公开内容 GET 外都需要登录会话。**服务端从认证主体取 userId，任何请求体里的 owner/userId 一律忽略并拒绝。**
报告与认证相关响应加 `Cache-Control: no-store`。

### 7.1 统一错误形状

```json
{ "code": "CONFLICT_REVISION", "message": "另一台设备已更新进度，请先读取最新版本。", "requestId": "uuid", "details": { "currentRevision": 9 } }
```

`VALIDATION_FAILED` 的字段错误**平铺在 `details` 顶层**，不是 `details.fields`：

```json
{ "code": "VALIDATION_FAILED", "message": "请求参数校验失败。", "requestId": "uuid",
  "details": { "nickname": "长度必须在 1 到 24 之间" } }
```

早期契约写的是 `details.fields`，与实现不一致（`GlobalExceptionHandler.handleValidation`
与 `ApiException.validation` 都把字段表直接当 `details`）。前端当时两种形状都做了兼容，
但契约按**实现**为准 —— 平铺少一层嵌套，且 `details` 本来就只承载这一种内容。
字段错误只回字段名与规则，**不回显用户输入的值**（那是敏感数据）。

| code | HTTP | 说明 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 字段校验失败；字段错误**平铺在 `details` 顶层**（见上） |
| `INVALID_REQUEST` | 400 | 未知题号、越阶段答案、非法分值、rating/unknown 互斥破坏 |
| `INVALID_TYPE_CODE` | 400 | 类型码不符合 `^[EI][SN][TF][JP]$` |
| `INVALID_CREDENTIALS` | 401 | 登录失败（**不区分用户名是否存在**） |
| `UNAUTHENTICATED` | 401 | 未登录/会话过期 |
| `CSRF_INVALID` | 403 | CSRF 校验失败 |
| `FORBIDDEN` | 403 | 越权（不属于当前用户） |
| `NOT_FOUND` | 404 | 资源不存在**或不属于当前用户**（两者返回同形，避免枚举） |
| `CONFLICT` | 409 | 通用冲突（例：用户名已被注册）。**不告诉客户端是哪一个用户名被占用之外的信息** |
| `CONFLICT_REVISION` | 409 | `expectedRevision` 不匹配；`details.currentRevision` |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 同 key 不同请求体 |
| `ATTEMPT_SUBMITTED` | 409 | 已提交 attempt 不可改答 |
| `ATTEMPT_NOT_SUBMITTED` | 409 | 未提交 attempt 不可删除报告等 |
| `NEEDS_REVIEW` | 200（提交时）/409（其他） | 覆盖不足；提交返回 `attemptId` + 每维覆盖 |
| `RATE_LIMITED` | 429 | `details.retryAfterSeconds` |
| `BUDGET_EXCEEDED` | 429 | AI 额度 |
| `NOT_CONFIGURED` | 503 | 该功能所需配置缺失（例：后台未配置 admin 的 apiKey 时写入被拒） |
| `AI_NOT_CONFIGURED` | 503 | 未配置 key（AI 分析专用口径） |
| `INTERNAL` | 500 | 不泄露内部细节 |

### 7.2 接口清单

#### 认证

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /auth/csrf` | — | `200 {token, headerName:"X-XSRF-TOKEN", parameterName:"_csrf"}`；`no-store` |
| `POST /auth/register` | `{username, password, nickname?, disclaimerAccepted}` | `201 {userId, username, nickname, recoveryCodes:[8 个字符串], recoveryCodePolicyVersion}`；`no-store` |
| `POST /auth/login` | `{username, password}` | `200 {userId, username, nickname}`；**轮换会话 ID** |
| `POST /auth/logout` | — | `204`；撤销当前会话 |
| `POST /auth/recover` | `{username, recoveryCode, newPassword}` | `204`；消费恢复码 + 改密 + 撤销该用户全部会话 + 作废其余恢复码 |

- 注册成功后**立即建立会话**（用户不用再登录一次），同时返回恢复码。
- `disclaimerAccepted`（**2026-09-17 新增**）：注册页「我已阅读并理解」勾选框的状态。
  这是**对现有请求体的一处收紧** —— 缺省或 `false` 会返回
  `400 VALIDATION_FAILED`，错误体带字段名 `disclaimerAccepted`（前端翻成「免责声明同意」）。
  为什么放在注册这一步：账号一建立，作答内容就开始存到服务器上，这件事必须先被告知并同意；
  报告页的「这不是心理诊断」解决的是另一件事，两者不互相替代。
  需要灰度放量（让旧客户端先跑）时可配 `typeme.auth.disclaimer-required=false` 关掉校验；
  关闭时服务端只是不拦，前端仍显示勾选项，**不会**假装用户同意过。
  `disclaimerAccepted` 为 `true` 时记一条 `log.info`（只有事件名，不带用户名、IP 等任何标识），
  便于日后回答"当时的同意有没有留下痕迹"。
- 恢复码格式：**16 个字符，显示为 4 段，每段 4 位**，即 `XXXX-XXXX-XXXX-XXXX`
  （大写 base32 字母表，去掉易混字符 `0O1IL`）。一段 4 位而不是 8 位是为了让人抄写时
  每 4 位一断、报读时不容易串行。熵约 16 × log2(32) ≈ 80 位，配合服务端限流足够抗在线枚举。
  > 早期契约写的是"8 组，每组 `XXXX-XXXX`，共 128 位"，与 `RecoveryCodeGenerator` 不符
  > （实际 `CODE_LENGTH = 16`、`SEGMENT_LENGTH = 4`）。前端界面**不应假设固定长度**，
  > 按服务端返回的字符串原样展示即可。
- 服务端只存 `PBKDF2`/`bcrypt` 风格的 hash（与密码用同一 `PasswordEncoder` 实例）。
- 恢复码**只在注册与重新生成时返回一次**，不入日志。

#### 账号

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /me` | — | `200 {userId, username, nickname, createdAt, passwordChangedAt}` |
| `PATCH /me` | `{nickname}` | `200` 同 `GET /me` |
| `POST /me/password` | `{currentPassword, newPassword}` | `204`；撤销**其他**会话（保留当前），`password_changed_at` 更新 |
| `POST /me/recovery-codes` | `{currentPassword}` | `201 {recoveryCodes:[...]}`；作废旧码 |
| `GET /me/export` | — | `200` JSON 附件；含账号基本资料、attempts+answers、reports（含 `report_json`）、自我理解、AI 任务状态与输出；**不含**密码 hash、恢复码 hash、会话、内部幂等记录 |
| `DELETE /me` | `{password, confirm:"DELETE"}` | `202 {deletionJobId}`；立即禁止登录 |

#### 内容与测评

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /catalog/current` | — | `200 {packageId, instrumentId, scoringVersion, reportContentVersion, contentStatus, title, questionCount, basePerDimension, clarificationPerDimension, dimensions:[...]}`；**不带题目正文** |
| `GET /catalog/current/package` | — | `200` 完整内容包（§2 of 01）；`ETag` 为 `sha256` |
| `POST /attempts` | `{baseReportId?}` + 可选 `Idempotency-Key` | `201 {attemptId, revision, status, packageId, currentQuestionId}`（支持 `application/json`；表单/无 body 亦可） |
| `GET /attempts` | `?status=draft\|submitted&page&size` | `200 {items:[...], page, size, total}`，只含本人 |
| `GET /attempts/{id}` | — | `200 {attemptId, packageId, status, revision, currentQuestionId, clarificationDimensions, clarificationSkipped, answers:[...], package: {...}}` |
| `PATCH /attempts/{id}/answers` | `{expectedRevision, currentQuestionId?, responses:[{questionId, kind, rating?}]}` | `200 {revision, status, clarificationDimensions}`；revision 冲突 409 |
| `POST /attempts/{id}/review` | `{}` | `200 {status, clarificationDimensions, coverage:[per-dim], needsReview:boolean}`；幂等 |
| `POST /attempts/{id}/submit` | `{expectedRevision, clarificationSkipped?}` + 可选 `Idempotency-Key` | `201 {reportId, status, computedTypeCode, candidateCodes}`；覆盖不足 `200 + status=NEEDS_REVIEW` |
| `DELETE /attempts/{id}` | — | `204`；只允许本人**未提交**草稿 |

`PATCH` 语义：

1. 校验 `expectedRevision == attempt.revision`，否则 409。
2. 校验 attempt 属于当前用户、且 `status != SUBMITTED`。
3. 逐条校验：题号存在、属于锁定包、属于已安排阶段；`kind=rating` 时 `rating ∈ 1..5` 且
   不带 `rating` 的 `kind=unknown`。**任何一条非法即整体拒绝（400），不做部分裁剪。**
4. 事务内 upsert 答案，`revision = revision + 1`，更新 `current_question_id`、`updated_at`。
5. **在澄清阶段修改主测答案**：退回 `BASE_IN_PROGRESS`，清空 `clarification_dimensions` 与
   所有澄清答案（明确用户改答行为，不自动清空 48 道主测答案）。响应里带
   `clarificationReset: true` 让 UI 提示"需要重做补充部分"。

`POST /review` 语义：

1. 覆盖不足 → `200 {needsReview:true, coverage:[...]}`，**不安排澄清**。
2. 否则调用 `JungScorer.reviewClarification` 得到维度列表，写入 attempt
   （`status=CLARIFICATION_IN_PROGRESS` 当列表非空，否则 `status=BASE_IN_PROGRESS`）。
3. 幂等：重复调用返回同一列表；列表变化时（主测改答后）清除已不安排的澄清答案。

`POST /submit` 语义：

1. 校验 `expectedRevision`。
2. 服务端重新读答案 → `checkCoverage` → 不足则 `200 {status:"NEEDS_REVIEW", coverage}`，**不建报告**。
3. 服务端重新计算澄清集合，校验已安排题目全部被处理（或 `clarificationSkipped=true`）。
4. 事务内：`JungScorer.score` → `JungReportBuilder` → `INSERT assessment_report`；
   `UPDATE assessment_attempt SET status='SUBMITTED', submitted_at=now()`。
   `UNIQUE(attempt_id)` 冲突时读回既有报告并返回同一个 `reportId`（重复提交幂等）。
5. 客户端提交的分数/类型字段一律忽略（DTO 里根本没有这些字段）。

#### 报告

| 方法 路径 | 请求 | 响应 |
|---|---|---|
| `GET /reports` | `?page&size` | `200 {items:[{reportId, createdAt, status, computedTypeCode, selfSelectedTypeCode, summaryLine}], ...}` |
| `GET /reports/{id}` | — | `200 report_json` + `attemptId`、`selfReflection`；历史报告**读快照不重算** |
| `PUT /reports/{id}/self-reflection` | `{selfSelectedTypeCode?, note?}` | `200 {selfSelectedTypeCode, note, updatedAt}`；不改 `report_json` |
| `DELETE /reports/{id}` | — | `204`；删报告 + 其 attempt + 答案 + AI 任务 + 同意记录 + 自我理解 |
| `GET /reports/compare?ids=a,b` | — | `200 {reports:[...], differences:[{dimension, fromPole, toPole, fromMFinal, toMFinal, changed}], samePackage:boolean, notes:[...]}`；不同 `packageId` 只并列不计算成长 |

#### AI

见 [`03-AI与前端契约-v1.md`](03-AI与前端契约-v1.md) §2。

### 7.3 认证与安全实现要点

- Spring Security 表单关闭（不用默认登录页），自定义 JSON 认证：`POST /auth/login` 由控制器调用
  `AuthenticationManager`，成功后 `request.getSession(false)` 失效并按新会话重建（会话固定防护）；
  同时用 `SessionRegistry`/`sessionId` 记录，改密/恢复时按用户批量失效。
- CSRF：`CookieCsrfTokenRepository.withHttpOnlyFalse()`（前端需读 cookie 回填 header），
  `CsrfTokenRequestAttributeHandler` 使用默认（非 BREACH）处理；`GET /auth/csrf` 显式生成 token。
- 安全头：`HttpOnly`、`SameSite=Lax`（生产 `Secure`；本地 http 关闭 `Secure`，用配置
  `typeme.auth.cookie-secure` 控制，默认 `false`，生产 profile 置 `true`）。
- 401 与 403 都返回 §7.1 的 JSON 形状（自定义 `AuthenticationEntryPoint` / `AccessDeniedHandler`），
  不返回重定向 HTML。
- 所有写操作按用户 + 来源限流（§5.4）。
- 日志：不记录密码、Cookie、恢复码、`Authorization`、原始答卷、自由文本、AI 上下文。
  只记录脱敏 requestId、结果码、耗时、usage。请求体长度上限：
  普通接口 8KB、AI 创建 4KB、导出无限制；自由文本 `<= 300` 字（服务端再验一遍）。
