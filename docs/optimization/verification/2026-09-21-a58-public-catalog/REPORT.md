# A58 闭环：把 `GET /catalog/*` 按契约放开为公开（2026-09-21）

> 本轮按用户"按你的建议来"执行，建议原文：**放开 GET + 配限流；否则改前端走已公开路径**。
> 选定的是前者（放开 + 限流），并且没有用"改前端"这条退路。
>
> 结论只写实测结果。未跑真实浏览器、未跑真实 MySQL IT、未提交、未部署，均在文末明确写出。

---

## 1. 决策依据（为什么是"放开"而不是"改前端"）

| 事实 | 证据 |
|---|---|
| 契约一直把这两条写成公开 | `docs/2026-09-16/implementation/_contracts/02-数据模型与API-v1.md` §7"除 `GET /auth/csrf`、`POST /auth/register|login|recover`、**公开内容 GET** 外都需要登录会话"；§7.2 两张表给 `GET /catalog/current` 与 `GET /catalog/current/package` 的"请求"列都是 `—` |
| 实现与契约不符（未登录 401），已登记为 A58 | `docs/optimization/backlog.md` A58；`SubmitReportIT` 当时必须带会话才取得到题号 |
| **同类东西已经一半公开** | `SecurityConfig` 早就对 `GET /api/v3/platform/instruments`、`/instruments/*`、`/illustrations` 做了 `permitAll`，理由写在 `PlatformController#instruments` 的注释里 |
| 响应里没有用户数据 | `JungDtos.catalog(...)` 只读内容包（packageId/scoringVersion/维度摘要）；`packageView(...)` 是题面与两极描述 |
| 前端已按"可能拿不到"写好了降级 | `frontend/src/stores/instrumentV3.ts` 内置口径 + `fromCatalog` 标记 |

**取舍**：放到"改前端走 platform 路径"这条路零安全代价，但会把"目录"这件事变成两套入口两套口径，
而 platform 那套是量表中性结构（不含十六型的维度摘要），前端还得再拼一次。
放开这两条只读路径 + 限流，代价可度量（见 §3），并且顺手消掉了口径不一致。

---

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `backend/src/main/java/com/typeme/security/SecurityConfig.java` | `permitAll` 列表新增 `GET /api/v3/catalog/current`、`GET /api/v3/catalog/current/package`，并写清放开范围与代价应对 |
| `backend/src/main/java/com/typeme/jung/api/JungController.java` | 两个 GET 方法加 `HttpServletRequest` 参数并调用新增的 `catalogReadAllowed(request)`（匿名限流入口）；补类注释 |
| `backend/src/main/java/com/typeme/security/RateLimitService.java` | 新增 `OP_CATALOG` 与 `checkCatalogRead(clientIp, authenticated)`：**仅匿名计数**，已登录用户不计入 |
| `backend/src/main/java/com/typeme/account/service/TypemeProperties.java` | `RateLimit` 新增 `catalog` 子配置（缺项兜底 `5m/120`） |
| `backend/src/main/resources/application.yml` | `typeme.ratelimit.catalog: {window: 5m, ip-limit: 120}` |
| `frontend/src/stores/instrumentV3.ts` | 注释纠正（"401"→"公开；读不到=离线/失败/被限流"）；`refresh()` 的旧注释（写的是“首页读过一次 401”这个已不成立的路径）一并改掉 |
| `frontend/src/stores/instrumentsV3.ts` | 注释纠正（`/platform/instruments` 早已 `permitAll`，"需要登录"是过时描述） |
| 测试 | `SecurityBoundaryIT` +2 条；`RateLimitIT` +2 条；`AccountSqlDialectMySqlIT` 适配 record 新字段；`SubmitReportIT` 注释更新 |

### 2.1 本实现里被"新测试"撞出来的两个真问题（都不是 A58 本身，但不清掉 A58 就不成立）

**A74 —— 新测/平台/AI 三个 advice 都拦不住限流异常，429 会变成 500 或裸 ServletException。**

- 证据（第一次跑新用例）：`anonymousCatalogReadsAreRateLimited` 报
  `jakarta.servlet.ServletException: Request processing failed: com.typeme.common.ApiException: 访问过于频繁，请稍后再试。`
  —— 既不是 429，也没有契约 §7.1 的错误体。
- 原因：`RateLimitService` 在 `com.typeme.security`，抛的是账号模块的
  `com.typeme.common.ApiException`；而 `GlobalExceptionHandler` 的 `basePackages` 只到
  `com.typeme.account`，`JungExceptionHandler`/`AnalysisExceptionHandler` 只认各自的异常类型。
  **A58 之前，没有任何 jung/platform/ai 控制器会抛这个异常**，所以这个缺口一直没被触发。
- 修法：在 `JungExceptionHandler` 与 `AnalysisExceptionHandler` 各加一条
  `@ExceptionHandler(com.typeme.common.ApiException.class)` 的显式映射（**只加这一个类型**，
  不扩 `basePackages`，避免两个 advice 争 `Exception.class` 的注册顺序问题）。
- 分支敏感性：`RateLimitService.checkAiCreate` 目前没有任何调用方（`grep` 全仓只有定义），
  所以 AI 那条映射是"同一类缺口的对称补齐"，本轮**没有**可触发它的路径，不能声称它被端到端验证过。

**A75 —— `CurrentUser.requireUserId()` 会把匿名访客当成已登录用户（`"anonymousUser"`）。**

- 证据（第二次跑新用例，`first-run-a75-evidence.txt`）：`anonymousCatalogReadsAreRateLimited` 得到 **200**（不是 429），
  即匿名限流一次都没发生 —— 报文是 `expected: 429 but was: 200`。
- 原因：Spring Security 的 `AnonymousAuthenticationFilter` 给匿名请求装
  `AnonymousAuthenticationToken`，其 `isAuthenticated()` 为 **true**，`getName()` 返回 `"anonymousUser"`。
  `CurrentUser.requireUserId()` 只判 `isAuthenticated()` → 返回非空字符串 → `JungController` 认为"已登录" → 跳过限流。
- 修法：`com.typeme.jung.api.CurrentUser` 新增 `isAuthenticated()`（排除匿名主体），
  `requireUserId()` 同样排除；`com.typeme.ai.controller.AiCurrentUser.requireUserId()`
  做同样的排除（它自己写了 fail-closed 判定，同样会被匿名主体骗过）。
- 判别力：单独把 `CurrentUser` 的两处匿名单例判定撤掉 →
  `anonymousCatalogReadsAreRateLimited` **仅这一条**精确红（`200 != 429`），其余 14 条绿。

> **这两个问题都必须写进 backlog**：A74 是"新类型的跨模块异常第一次进入非账号控制器时缺 advice"，
> A75 是"看 `isAuthenticated()` 就断定已登录"这类判断在别处可能还有。
> **A75 的全仓扫描已做**：`grep -rn "isAuthenticated()" backend/src/main backend/src/test` 只剩 4 处，
> 其中 `account/controller/CurrentUser` 与 `security/SessionAbsoluteTtlFilter` **本来就排除了匿名单例**，
> 只有 `jung/api/CurrentUser` 与 `ai/controller/AiCurrentUser` 有缺陷（已修）—— 所以 A75 是全仓闭环，
> 不是"顺手改两处"。

---

## 3. 限流口径（放开访问边界的代价）

| 项 | 值 | 理由 |
|---|---|---|
| 计数维度 | `ip`（`request.getRemoteAddr()`，仅在显式配置 `trusted-proxies` 时才解析 XFF） | 沿用契约 §5.4 的既有规则，不新增信任面 |
| 窗口 / 上限 | `5m` / `120` | 匿名访客读目录是"进站读一次"；120 次/5 分钟能容纳共享出口（NAT）下的正常浏览，同时把"循环拉整份题库"压到 ≤24 次/分钟 |
| 已登录用户 | **不计数** | ① 他们另有按账号维度的限流；② 公共壳每页都读一次目录，计入会让正常浏览把自己挡在 429 上 |
| operation 名 | `catalog`（与 `register`/`login` 分开） | 桶键是 `<operation>:<scope>:<value>:<windowStart>`；复用会让"浏览目录"消耗"注册"额度 |

**没有加**：`Retry-After` HTTP 头（与既有登录限流一致，只在 `details.retryAfterSeconds` 给值；
`RateLimitIT#repeatedFailedLoginsAreRateLimited` 明确断言该头为 null —— 这是既有口径，本轮不改）。

---

## 4. 验证

### 4.1 定向（含新用例）

命令：`mvn.cmd test "-Dtest=RateLimitIT,SecurityBoundaryIT,SubmitReportIT,BigFivePlatformIT,InvitationAdminIT"`

```
Tests run: 8,  Failures: 0, Errors: 0, Skipped: 0 -- InvitationAdminIT
Tests run: 6,  Failures: 0, Errors: 0, Skipped: 0 -- RateLimitIT        (+2)
Tests run: 9,  Failures: 0, Errors: 0, Skipped: 0 -- SecurityBoundaryIT (+2)
Tests run: 2,  Failures: 0, Errors: 0, Skipped: 0 -- SubmitReportIT
Tests run: 10, Failures: 0, Errors: 0, Skipped: 0 -- BigFivePlatformIT
Tests run: 35, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

原始输出：`after-fix-targeted.txt`。

### 4.2 新增用例的内容（断言的是业务不变量，不是实现细节）

`SecurityBoundaryIT`：

- `anonymousCanReadCatalog`：不带会话 GET 两条目录路径 → 200；摘要**不含** `questions`；
  完整包 `ETag`（去引号后）等于摘要里的 `sha256`；`Cache-Control` 含 `no-cache`。
- `anonymousCatalogRelaxationDoesNotOpenUserData`：不带会话 GET
  `/me`、`/me/export`、`/attempts`、`/reports`、`/admin/users`、`/platform/attempts`、`/platform/reports`
  → **全部 401 + `UNAUTHENTICATED`**。

`RateLimitIT`：

- `anonymousCatalogReadsAreRateLimited`：同一 IP 前 2 次 200，第 3 次 429 + `RATE_LIMITED`
  + `details.retryAfterSeconds > 0`。
- `authenticatedCatalogReadsAreNotInAnonymousBucket`：已登录（阈值被压到 2）连读 4 次全部 200。

### 4.3 判别力（逐条"改回去 → 看它精确红"）

| 撤回的改动 | 期望红 | 实际 |
|---|---|---|
| `CurrentUser` 的两处匿名主体判定 | 仅匿名限流那条 | ✅ `RateLimitIT.anonymousCatalogReadsAreRateLimited` 红 1 条（`200 != 429`），`SecurityBoundaryIT` 9/9 绿 |
| `SecurityConfig` 里新增的两条 `permitAll` | 仅匿名可读那条 | ✅ `SecurityBoundaryIT.anonymousCanReadCatalog` 红（`Status expected:<200> but was:<401>`，第 61 行） |
| 把 `2) /api/v3/**` 从 `authenticated()` 放宽成 `permitAll()` | 用户数据护栏那条 | ✅ `SecurityBoundaryIT.anonymousCatalogRelaxationDoesNotOpenUserData` 红 1 条 |
| （未撤回但对偶检查）`JungController` 不调 advice 的那条 | — | ✅ 第一次跑就是 429 变 `ServletException`（见 §2.1 A74），修 advice 后转绿 |

原始输出：`discriminator-anonymous.txt`、`discriminator-permitall.txt`、`discriminator-userdata.txt`、`first-run-red.txt`。

### 4.4 回归

- 后端全量（**排除** 3 个真实 MySQL IT）：
  `mvn.cmd test "-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT"`
  → **Tests run: 404, Failures: 0, Errors: 0, Skipped: 1，BUILD SUCCESS**（`after-fix-backend-full.txt`）。
  相较第 28 轮的 400 条，+4 条正是本轮新增（RateLimitIT +2、SecurityBoundaryIT +2）。
- 前端：`npm run typecheck` + `vitest run` → **50 文件 / 1038 条通过**（`after-fix-frontend.txt`）。
  本轮前端只改注释，无行为变化；这个数字与第 27 轮一致，说明没有回归。
- 内容一致性：`node scripts/convert-jung-content.mjs --check` 输出"内容包与 YAML 一致。"（exit 0）。本轮未动内容源。

---

## 5. 边界与未覆盖（诚实交代）

1. **没有跑真实浏览器**。本轮按 AGENTS.md 属于"访问边界 + 错误映射"的后端行为改动，
   但前端确实消费了这条路径（`instrumentV3.load()` 从"必然 401 走内置口径"变成"真能读到服务端口径"）。
   **"未登录首页现在真的显示服务端口径"这件事没有被真实浏览器验证过**，只有 H2 + MockMvc。
   验证方式很轻（`npm run dev -- --host 127.0.0.1` + 一个未登录窗口看首屏题数/维度名），
   本轮未做，留给用户决定是否补。
2. **没有跑 3 个真实 MySQL IT**（用户授权范围之外；本轮无 DDL/DML 变化，与它们无关）。
3. **A74 的 AI 分支没有可触发路径**（`checkAiCreate` 无调用方），只做了对称补齐，不能算端到端验证。
4. **限流值 `5m/120` 是判断值，不是实测调优结果**。没有真实流量数据支撑；
   共享出口下的正常浏览是否会被误伤未经验证。
5. **没有提交、没有部署**。`frontend/dist` 未重新构建，jar 未重新打包。
6. **`typeme_dev` 等现有库未做任何写入**；本轮无迁移。
7. 契约文档（`02-数据模型与API-v1.md` §7.2）在实现侧已对齐，**文档本身未改**
   （它本来就写的是公开，属于实现向契约看齐，不存在"文档要改"的问题）。
8. **限流桶没有清理/GC 语义验证**：`catalog` 复用既有 `rate_limit_bucket` 机制，
   其过期行清理状况本轮未检查（它属 A22/A57 那一类"表增长"问题域）。