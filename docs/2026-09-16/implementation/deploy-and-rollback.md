# 新测（`typeme-jung48`）部署与回滚手册

- 适用版本：本轮登录版十六型人格测评站
- 编写日期：2026-09-16
- **本文档中的生产步骤从未在真实生产环境执行过**（见文末 §6 诚实性说明）。

---

## 1. 运行前必须配置的东西

应用**默认配置就能在本机跑起来**（指向本机 MySQL 的 `typeme_dev`），
但生产环境必须覆盖以下项。**没有默认值的项没配就会启动失败或功能不可用**，
这比"配错一个默认值连到错误的库"要安全。

### 1.1 必填（生产）

| 环境变量 | 说明 | 不配的后果 |
|---|---|---|
| `TYPEME_DB_URL` | JDBC URL，**必须显式带库名** | 会连到开发库 |
| `TYPEME_DB_USER` | 数据库账号 | 回退到 `root` |
| `TYPEME_DB_PASSWORD` | 数据库密码 | 回退到开发默认口令 |
| `TYPEME_SETTINGS_SECRET` | 加密后台配置用的密钥（如 AI apiKey），**至少 16 位** | 默认空 → 后台保存 apiKey 返回 503（这是刻意的：宁可不给用，也不用弱密钥加密） |

> 变量名以 `application*.yml` 里的 `${...}` 占位符为准，本文档与配置一一对应。
> 注意是 `TYPEME_DB_USER`（不是 `USERNAME`）、`TYPEME_SETTINGS_SECRET`
> （对应配置键 `typeme.security.settings-secret`，环境变量名里没有 `SECURITY`）。

### 1.1.1 生产建议配置

| 环境变量 | 说明 |
|---|---|
| `TYPEME_TRUSTED_PROXIES` | 逗号分隔的**可信反向代理**地址。**只在确实有反代时填**：不填时代码忽略 `X-Forwarded-For` 并直接取直连对端；乱填会让客户端能伪造 IP 绕过按 IP 的限流 |
| `TYPEME_PBKDF2_ITERATIONS` | PBKDF2 迭代次数，默认 `210000`。调低会被启动期校验拒绝（有下限） |
| `TYPEME_DB_DRIVER` | 默认 `com.mysql.cj.jdbc.Driver`，一般不用改 |

`application-prod.yml` 已经把 `server.servlet.session.cookie.secure` 与
`typeme.auth.cookie-secure` 都置为 `true`（两处是同义冗余，YAML 无法跨前缀引用，
**改一处必须改两处**）。生产必须走 https，否则浏览器不会回传会话 Cookie。

生产 profile 把 `typeme.admin.bootstrap-username` 置为空字符串：
**管理员由已有 ADMIN 在后台维护，不做自动提权**。开发 profile 的默认引导账号
是 `typeme_admin`，生产不会继承它。

### 1.2 AI 分析相关（默认关闭，要用才配）

| 环境变量 | 说明 |
|---|---|
| `TYPEME_AI_ENABLED` | `true` 才启用 AI 分析能力，默认 `false` |
| `TYPEME_AI_BASE_URL` | 默认 `https://api.deepseek.com`；**生产 profile 默认留空，必须显式注入** |
| `TYPEME_AI_API_KEY` | 上游 key。也可以不注入，改由管理员在后台配置（存库加密） |
| `TYPEME_AI_MODEL` | 默认 `deepseek-flash`（开发与生产一致） |
| `TYPEME_AI_MOCK_MODE` | `true` 时用确定性 mock、结果带 `mock=true` 标记。**生产必须为 false** |
| `TYPEME_AI_REQUEST_DEADLINE` | 默认 `90s`。**反代/网关的超时必须大于它**，否则上游还没返回就被网关掐断 |
| `TYPEME_AI_DAILY_LIMIT` / `TYPEME_AI_RETRY_LIMIT` | 每用户每日新建次数（默认 2）/ 失败后每小时主动重试次数（默认 3） |
| `TYPEME_AI_GLOBAL_TOKEN_BUDGET` / `TYPEME_AI_GLOBAL_CALL_BUDGET` | 全局每日预算，默认 `200000` token / `200` 次调用 |
| `TYPEME_AI_USAGE_PRICES` | 可选的单价 JSON。**不配就不估算费用**，只记 token 与调用数，绝不编造金额 |

> **`DEEPSEEK_API_KEY` 优先于 `TYPEME_AI_API_KEY`**：配置里写的是
> `${DEEPSEEK_API_KEY:${TYPEME_AI_API_KEY:}}`，即沿用了上游官方约定的变量名，
> `TYPEME_AI_API_KEY` 是兼容别名。两个都注入时**前者生效**。
>
> **apiKey 的两种来源**：环境变量（`apiKeySource=env`）与数据库（`apiKeySource=db`）。
> 数据库优先。管理员在后台配置后**无需重启**，≤10 秒生效。
> key **从不会被回显**给前端或写入日志。
>
> `mock-mode` 打开时结果里带 `mock=true`，**界面必须显示这是演示数据** ——
> 绝不能让用户以为看到的是真实分析结果。

### 1.3 JDBC URL 的两个坑（都踩过）

```
jdbc:mysql://<host>:3306/typeme_prod?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8
```

1. **`characterEncoding` 必须写 `UTF-8`，不能写 `utf8mb4`。**
   这是 JDBC 参数，值要 Java 字符集名。写 `utf8mb4` 会直接抛
   `UnsupportedEncodingException: Unsupported character encoding 'utf8mb4'`，**应用起不来**。
   连上之后驱动与服务器协商出的仍然是 utf8mb4 排序规则。
2. **`serverTimezone=UTC` 必须显式写。** 报告里的 `createdAt` / `submittedAt`
   都是 UTC 的 ISO 串，时区错了会让历史报告的时间整体偏移。

### 1.4 管理后台账号

开发 profile 的引导管理员用户名默认是 `typeme_admin`（`TYPEME_ADMIN_BOOTSTRAP_USERNAME`）。
**生产 profile 已把它置为空字符串**，即不做自动提权 —— 管理员由已有 ADMIN 在后台维护。

如果你在自己的环境里启用了引导账号，请在初始化完成后把它置空：
留着引导账号等于留了一个已知用户名的入口。

> 注：配置里**没有**引导密码项（不会被 `TYPEME_ADMIN_BOOTSTRAP_PASSWORD` 之类的变量影响），
> 所以不存在"生产忘了改引导密码"这种问题。

---

## 2. 构建与部署

单 jar 形态：前端 `dist` 由 Maven 打进 jar，页面与接口同源同端口。

```powershell
# 1. 构建前端（含 vue-tsc 类型检查；不要用 build:only 跳过类型检查）
cd frontend
npm.cmd ci
npm.cmd run build

# 2. 构建后端（会把 frontend/dist 复制进 jar）
$env:JAVA_HOME='D:\develop\jdk-21'
cd ..\backend
mvn.cmd -o clean package -DskipTests

# 3. 产物
#    backend/target/typeme-backend-1.0.0.jar
```

启动：

```powershell
java -jar typeme-backend-1.0.0.jar `
  --spring.profiles.active=prod
```

环境变量按 §1 注入。**不要把密钥写在命令行参数里**（会进进程列表与 shell 历史）。

### 2.1 数据库迁移是自动的

启动时 Flyway 自动执行 `db/migration` 下未应用的脚本。

- 脚本里**不含** `CREATE DATABASE` / `USE` / `DROP DATABASE`：
  部署前**必须由 DBA 预先建好库并授权**，应用不会、也不该去建库。
- 迁移是**只进不退**的。Flyway 社区版没有 `undo`，
  所以每个脚本上线前都必须在**真实 MySQL 与 H2 上双向验证过**（见 §4）。
- 生产库升级前**先备份**。本轮改动里 `V8` 会加宽 `app_user` 的凭据哈希列，
  `V7` 给 `ai_analysis_job` 加列 —— 都是加列/改列宽，不改语义、不删数据。
- **不要给生产库开 `baseline-on-migrate`**。本项目刻意设为 `false`：
  开启后 Flyway 会把一个结构不明的库当成"已在基线版本"，从而**跳过全部校验**，
  而 `assessment_attempt`、`app_user` 这些表的外键恰恰依赖迁移真的跑过。
  代价是：**结构不是由本迁移体系建出来的库，应用会拒绝启动** —— 这是有意的，
  比"静默按错误结构运行"安全。

### 2.2 内容包在启动期自动播种（必需）

除 Flyway 之外，应用启动时还有一个 `ApplicationRunner`：

`JungPackageRegistrar` 把随 jar 打包的内容包（`typeme-jung48-zh-v1`）
upsert 进 `assessment_package` 表，用**内容包的 sha256** 作为版本标识。

- **这一行不加，测评就建不出来**：`assessment_attempt.package_id` 外键指向
  `assessment_package`，缺行时建测评直接撞外键。
  （该缺陷在 2026-09-16 的端到端实测中被抓到 —— 单测全绿也照样漏，
  因为测试辅助代码自己会插这一行。）
- 播种**不修改数据**：同一份内容包重复启动是幂等的（有测试钉住）。
- 换了内容包（改 YAML 后重新生成 JSON）会得到新的 sha256，
  于是产生新的 `package_id` 版本行；**旧报告仍指向旧版本**，历史报告不会被改写。
- 若内容包资源缺失或哈希对不上，应用会**启动失败**而不是带着坏内容对外服务。
- 启动后自检：`GET /api/v3/catalog/current` 应返回
  `packageId=typeme-jung48-zh-v1`、`questionCount=64`。
  若建测评返回 `503 PACKAGE_NOT_SEEDED`，说明播种没成功 —— 去看启动日志。

---

## 3. 上线后自检

```powershell
# 健康与版本
curl.exe -s http://127.0.0.1:8080/actuator/health
curl.exe -s http://127.0.0.1:8080/api/v3/catalog/current

# 页面（应与接口同源同端口）
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:8080/
```

关键确认项：

1. `GET /api/v3/catalog/current` 返回的 `packageId` 是 `typeme-jung48-zh-v1`，
   `contentStatus` 是 `draft_review_pending`（**如实反映内容仍在审校**）。
2. 启动日志里**没有**内容包哈希不匹配的 `ERROR`。
   若有，说明 jar 里的内容 JSON 与它声明的 sha256 对不上 ——
   这通常意味着内容被手改过而没有重新生成，**必须停下来查**，不要继续。
3. CSRF cookie 是 `XSRF-TOKEN` 且不是 `HttpOnly`（前端需要读它）；
   会话 cookie 必须是 `HttpOnly`。
4. 未登录访问 `/api/v3/attempts` 返回 `401 UNAUTHENTICATED`。
5. **建测评真的要能建成**（这是最容易被"其他接口都正常"掩盖的一步）：
   注册一个账号，`POST /api/v3/attempts` 应返回 `201`。
   - 返回 `503 PACKAGE_NOT_SEEDED` → 内容包没播种（见 §2.2）。
   - 返回 `500` 且日志是 `fk_attempt_user` 外键违例
     → 认证主体没带 `getUserId()`，即"把用户名当主键用"。
     该缺陷在 2026-09-16 被端到端实测抓到过；一旦出现，
     说明有人把 `TypemeUserPrincipal` 换回了 Spring 的 `User`
     （`getUserId` 这个方法名是跨模块约定，改名或换类型都不会编译失败，
     只会在**这里**炸掉）。

---

## 4. 上线前的强制验证

这三步是**必须**的，不是"建议"：

```powershell
# 后端全量测试（含迁移在 H2 MODE=MySQL 上的执行与约束验证）
$env:JAVA_HOME='D:\develop\jdk-21'
cd backend
mvn.cmd -o test

# 前端类型检查 + 测试 + 构建
cd ..\frontend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# 内容一致性（改了 YAML 必须重新生成，否则启动期哈希校验会对不上）
cd ..
node scripts/convert-jung-content.mjs
node scripts/gen-jung-fixtures.mjs --check
```

**迁移脚本的改动必须在真实 MySQL 上验过**，只看 H2 通过是不够的：

- H2 与 MySQL 的 CHECK 约束大小写敏感性不同。库默认排序规则若是
  `utf8mb4_0900_ai_ci`（大小写不敏感），枚举列的 CHECK 白名单会被悄悄放宽，
  `role='user'`、`computed_type_code='istj'` 这类非法值在 MySQL 上能插进去。
  本轮已有 8 个列钉了 `COLLATE utf8mb4_0900_as_cs` 来修它 ——
  **新增枚举列时必须照做**。
- MySQL 的 CHECK 在结果为 NULL/UNKNOWN 时视为通过。
  判据里有 `IS NOT NULL` 之类的条件时要想清楚这条。
- 列级 `COLLATE` 只有写成**列定义最末尾的裸形式**才在两个引擎都通过。

---

## 5. 回滚

### 5.1 应用回滚（代码）

镜像/jar 换成上一版即可。**注意**：新版本已经执行过的 Flyway 迁移**不会**自动回退。

因为迁移遵循**只加不删**（加列、加表、放宽列宽），
旧版应用在新库结构上通常能继续运行 —— 旧版不认识的列就放着不动。
**本轮 8 个脚本都满足这个性质**：没有 `DROP TABLE` / `DROP COLUMN` / 收紧列宽 / 改列语义。

### 5.2 数据回滚

只能靠**升级前的备份**。步骤如下：

1. 停应用（避免写入）。
2. 从备份恢复库。
3. **删掉 `flyway_schema_history` 里比备份点新的记录**，
   否则 Flyway 会以为那些迁移已经执行过，从而跳过它们。
   （直接整库恢复的话这一步通常已包含在内。）
4. 启动上一版应用，确认 `/actuator/health` 正常。

### 5.3 只回滚内容（不动代码）

内容包与报告内容是**从 JSON 读的**，但 JSON 是**编进 jar 的**，
所以改内容需要重新构建。运行期没有"热换内容"的开关 ——
这是刻意的：内容换了就该走一次完整验证。

### 5.4 AI 功能的紧急关闭

把 `TYPEME_AI_ENABLED` 设为 `false` 并重启，或在后台把 apiKey 清空
（≤10 秒生效）。**基础报告与固定计分不受影响**，用户可以继续测评。

---

## 6. 从未在生产执行过的步骤（诚实性说明）

本手册的**生产部署、压测、真实流量、真实 DeepSeek 联调全部未执行**：

| 项目 | 状态 |
|---|---|
| 真实 MySQL 8.4 上执行迁移 | **已做**（`typeme_dev` / `typeme_test`） |
| H2 `MODE=MySQL` 上执行迁移 | **已做** |
| 生产环境部署 | **未做** |
| 真实 DeepSeek 接口调用 | **未做**（无 key，全部走 mock） |
| 负载 / 压测 | **未做** |
| 真人题目试测 | **未做** |

另外，Flyway 10.10.0 对 MySQL 8.4 会打印一条真实告警：
`MySQL 8.4 is newer than this version of Flyway and support has not been tested.
The latest supported version of MySQL is 8.1.`
实测迁移成功，但这是供应商未声明支持的组合 —— 升级 Flyway 或 MySQL 时应复验。
