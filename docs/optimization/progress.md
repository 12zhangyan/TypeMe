# TypeMe 持续优化 —— 进度记录（progress）

> 每轮记录：做了什么、验证命令与结果、遗留问题、下一步与所需权限。
> 结论只写实测结果；未验证的部分明确标注。

## 第21–26轮补记与当前复核（2026-09-18）

本节为本次文档回写。轮次按交接指定顺序补记；下面的测试与浏览器数字全部**转述各轮 REPORT，未在本次重跑**，不能与旧轮数字相加，也不代表当前工作区验收。后续视觉轮次可能替代前轮设计。

| 轮次 | 工作与现有代码锚点 | 历史验证记录及边界 |
|---|---|---|
| 21 readable | 通俗 AI v3 / analysis-readable-v2；Jung 与大五投影、版本闸门；大五量程与报告阅读层次。当前已复核 `ReadableReportInput`、`ReportInputBuilder`、`AiAnalysisPanel`，大五能力已有实现，仅旧提示词保留400 | [REPORT](verification/2026-09-18-readable/REPORT.md)：前端完整898项，其后相关四文件32项；后端子集321项（320通过、1跳过），其后47项配置收尾；浏览器119项。不是一次最终全量测试，浏览器API模拟，无真实AI |
| 22 visual | 暖白/森林绿主题、共用 InstrumentCard、答题与报告布局、键盘焦点；当前组件存在，视觉后续已迭代 | [REPORT](verification/2026-09-18-visual/REPORT.md)：前端901项，构建通过，浏览器101与131项；320/390/1440，API拦截模拟 |
| 23 editorial | 编辑式首页与账号表单、报告版式；当前 PlatformIntro/InstrumentCard 保留后续演进结构 | [REPORT](verification/2026-09-18-editorial/REPORT.md)：前端901项、聚焦117项，构建通过，浏览器131与105项；合成报告、模拟API，无真实后端验收 |
| 24 admin | 邀请注册、管理员查看进度/报告、用户AI额度。当前 `AdminAccessController` 管理端点和ADMIN守卫存在；权限与事务测试结果仅转述 | [REPORT](verification/2026-09-18-admin/REPORT.md)：后端332项（331通过、1跳过，排除3类真实MySQL IT），前端902项，浏览器65项；H2/mock、模拟API，无现有库迁移 |
| 25 atelier | 本地插画框、人物图鉴和场景素材接入；当前 PlatformIntro / PersonalityGallery / IllustrationFrame 代码存在，加载失败回退 | [REPORT](verification/2026-09-18-atelier/REPORT.md)：前端905项、typecheck/build通过，浏览器105与85项；当时是SVG占位，素材状态随后由第26轮更新 |
| 26 generated-images | 21张WebP接入本地素材目录；当前 IllustrationFrame/素材映射存在，不把历史图像质量判断称为本次逐图验收 | [REPORT](verification/2026-09-18-generated-images/REPORT.md)：构建通过、聚焦5项、浏览器265与105项；API全部模拟；该轮未重跑后端或前端全量 |

当前裁决状态：阈值数值、版本决策、真人研究投入与真实AI试验仍由用户决定。大五AI“能力未做”已经过期；v3真实语言质量与成本没有本次新证据。不能从待审校字段独立推出世界范围内不存在真人反馈。

本次新增证据：只读核验源码/内容/留存日志，纯内存调用当前TS计分器与v2包的六个阈值样例，exit 0。发现旧阈值对比表混用触发T与最终边界B；n=12/S=2、n=9/S=1当前为REFERENCE。具体选项、代价、缺口与证据位置见 [开放裁决项复核与建议](../handoffs/2026-09-18/open-decisions-review.md)。本次未跑浏览器、完整业务测试、数据库或真实AI。

report-paper 是另一会话的在途工作，不计入这六轮补记，也不纳入本次验证。下方各轮“下一步”“未完成”与测试计数均按历史阅读；除本次明确核验的条目外，不批量宣布闭环。

## 第 27 轮：A53 ③⑥ 闭环 + `fetchAiStatus` 接口层守卫（2026-09-21）

### 起点事实（先看，再改）

- `git status --short` 有 31 个已修改文件与若干未跟踪文件，其中包含**前一会话**的两项在途工作，本轮未删改：
  - `docs/optimization/verification/2026-09-21-ai-prompt-v4/`：提示词 v4 接入、前后端显式登记 v3/v4、默认版本改 v4；
  - `docs/optimization/verification/2026-09-21-review-fixes/`：7 项审查修复（大五恢复/保存竞态、悲观锁取代 `COUNT` 判成功、AI 旧执行栅栏、`CLEAR` 撤销持久化、注销 `RUNNING` 恢复等）。
  这两项**没有**写入本 progress/backlog。本轮把它们当作**既有基线**复跑验证（见下），但**不把它们的成果计为本轮工作**。
- 第 20 轮之后，backlog 仍开着的可独立推进项只有 A53③⑥、A40、A58。本轮取其中不依赖用户决策、不触碰安全边界的两条（A53③⑥）。

### 本轮做了什么

| ID | 问题 | 实施 | 判别力 / 证据 |
|---|---|---|---|
| A53⑥ | 429 自动重试重新入队时退掉了额度预留，而重试不会再预留 → `reserved_calls` 比实际外发少一次（当日额度被多算出来一次） | `AnalysisWorker.handleUpstreamFailure`：`requeueAfter` 成功时**保留**预留，只记录日志；若重试始终没发出去（取消/注销）由 `discardLateResult(sent=false)` 退 | `AnalysisFlowTest#rateLimitedRetriesAtMostOnce` +2 条断言（入队后 user/global 各 1；重试再次 429 后归 0）。改回旧写法精确红 1 条（见验证表） |
| A53③ | `ReportService#exportData` 是**无调用方**的死代码，且把 `BadSqlGrammarException` 静默吞成空数组，与账号模块 `degradedSections` 的降级语义不一致；`JungController` 还留着“由报告模块复用”的过时注释 | 删除该死方法，导出只剩 `account/service/DataExportService` 一处定义；把 `JungController` 注释改成如实描述 | 全仓 grep 复核：除定义处外无调用方；后端全量子集编译并测试通过 |
| — | `fetchAiStatus` 缺字段默认值只有 store 层行为测试，接口层输入路径无测试（第 19 轮登记的缺口） | `frontend/src/api/v3Ai.spec.ts` +2 条：缺 `remainingToday` → `-1`（不是 0）；明确给 0 → 保留 0；并断言请求打到 `/api/v3/ai/status` | 前端该文件 **20 项通过**（+2） |

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| 内容一致性 6 条（`gen-fallback` / `rewrite-types` / `check-type-duplication` / `convert-jung` / `gen-jung-fixtures` / `gen-platform-content`，均 `--check`） | 全部 exit 0 |
| `frontend: npm.cmd run typecheck` | exit 0 |
| `frontend: node node_modules/vitest/vitest.mjs run` | **50 文件 / 1038 条通过**（本轮起点 1036，+2） |
| `frontend: npm.cmd run build` | exit 0（index js 649.92 kB / gzip 245.72；产物地址检查通过） |
| `backend: mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT'` | **400 通过 / 0 失败 / 0 错误 / 1 跳过**，BUILD SUCCESS（跳过项为既有 `AssessmentPackageLoadingTest` 空目录假设） |
| 判别力：把 A53⑥ 改回 `releaseReservation(...)` | `AnalysisFlowTest#rateLimitedRetriesAtMostOnce` 在新增断言处**精确红 1 条**，还原后复跑转绿 |
| `git diff --check` | 通过（仅有既存的 CRLF 提示） |

### 边界与未覆盖

- **未运行三类真实 MySQL 测试**（`AccountSqlDialectMySqlIT` / `AiSqlDialectMySqlIT` / `ConcurrencyMySqlIT`）：需要建库/删库授权，本轮不代跑。
- **未做真实浏览器验收**：本轮只改后端 quota 分支、删除死代码、补一条前端接口测试，没有可观察的页面行为变化。前一会话的两份浏览器证据（v4 50 项、review-fixes 29 项，均模拟 API）仍是对应代码的证据，但**不是**本轮新跑。
- **未做真实 AI 外发**（不消耗付费服务）；A53⑥ 的验证全部走 mock 上游。
- `frontend/dist` 已由本轮 build 重写，但**未重新打包整站 jar、未部署**。
- 本轮**未**更新第 21–26 轮补记里明确标注为“未重跑”的历史数字。
- 后端验证用 `work/run-backend-tests.cmd`（工作目录脚本，`/work/` 已在 `.gitignore` 内）以固定 `JAVA_HOME=jdk-21` 并清空 `DEEPSEEK_API_KEY`/`TYPEME_AI_API_KEY` 后运行。

### 下一步优先级（承接 backlog 未闭环项）

1. **A58**：`GET /catalog/*` 契约说公开、实现要认证 —— 改成公开是**放宽**安全边界，需单独决策。
2. **A40**：账号页/对比页提示与按钮间距节奏，等下一次动那两页时一起收口。
3. 第 19 轮登记、至今仍只有 mock 证据的：弱网/超时/429/截断的 AI 分支（`fetchAiStatus` 已在本轮补上接口层）。
4. 前一会话在途的两项（AI v4、review-fixes）尚未提交；若要发布需先决定提交与部署，且 review-fixes 的前后端需**配套发布**才能用 CLEAR 撤销持久化。

## 第 28 轮：真实 MySQL 授权后的方言复盘 —— V10 保留字（A72 / A73）（2026-09-21）

### 起点事实（先看，再改）

- 用户本轮授权“在我本地测试”，即允许跑会自动建库/删库的**三类真实 MySQL 测试**。实测本机 MySQL 为 **8.4.0**；`typeme_dev` 的 `flyway_schema_history` 停在 **V8**，且全机**没有任何 `illustration_asset` 表**。
- 此前 400 项后端全绿的子集**恰恰排除了这三类 IT**，所以第 21–26 轮与第 27 轮的全部“后端通过”都不含真实方言验证。

### 本轮发现了什么（不是假设，是运行输出）

| ID | 问题 | 证据 | 影响 | 状态 |
|---|---|---|---|---|
| A72 | **`V10__illustration_asset.sql` 在任何 MySQL 上都无法应用**：列名 `release` 是 MySQL 8 保留字（`RELEASE SAVEPOINT`），裸写进 DDL 直接语法错；而同一份迁移又用了 MySQL 8 专有的 `COLLATE utf8mb4_0900_as_cs`，5.7 也没有它 | 真实 MySQL 8.4 上 `Migration V10__illustration_asset.sql failed / Error Code 1064 ... near 'release    VARCHAR(32)  NOT NULL,'`；H2 的 MySQL 模式不把 `release` 当保留字，所以 H2 上的 400 项全绿照不出来 | 任何尚未应用 V10 的库（含当前 `typeme_dev`）下次启动时 Flyway 失败，**整个后端起不来** | 已闭环（本轮） |
| A73 | **`ConcurrencyMySqlIT` 把“迁移失败”当成“环境缺失”整类跳过**，失败时还会留下临时库 | 修复前跑真实 MySQL IT 的原文：`Tests run: 3, ..., Skipped: 3` —— V10 的 1064 被吞成“跳过”；机器上留下 `typeme_concurrency_5ecd0b6e9cbf8`、`typeme_concurrency_5ee552215ac8c` 两个库 | 正是它把 A72 藏了一整轮；另外失败退出路径不跑 shutdown hook，临时库每失败一次多一个 | 已闭环（本轮） |

### 本轮做了什么

| 文件 | 改动 |
|---|---|
| `backend/src/main/resources/db/migration/V10__illustration_asset.sql` | 列名 `release` → `release_tag`；头部补一段说明（为什么带 `_tag`、为什么这里必须**原地**修而不是追加 V11）。因为该迁移既用了 MySQL 8 专有 COLLATE、又撞 MySQL 8 保留字，**不可能在任何 MySQL 上成功过**，也就不存在“已应用 V10 的库” |
| `backend/src/main/java/com/typeme/platform/service/IllustrationAssetService.java` | `SELECT` / `UPDATE ... SET` / `INSERT` 三处列名与 `row.get("release_tag")` 同步；JSON 字段仍叫 `release`（对外契约不变） |
| `scripts/gen-image-publish.mjs` | `--emit-sql` 模板同步；**实测其输出与 V10 逐字一致**（diff 为空） |
| `docs/2026-09-20/图片URL入库方案.md` | DDL 示例与“`release` 列”表述同步 |
| `backend/src/test/java/com/typeme/platform/IllustrationAssetIT.java` | 列名断言 `release` → `release_tag` |
| `backend/src/test/java/com/typeme/ConcurrencyMySqlIT.java` | 只有 `canConnect()` 为假才算环境缺失（跳过）；**连上后建库/迁移失败改抛 `IllegalStateException` 变红**；`createDatabase()` 后立刻登记清理钩子，并在 `catch` 里再显式 `dropDatabaseQuietly()` |

### 验证（命令退出码 + 输出 + 报告）

| 项 | 命令 | 结果 |
|---|---|---|
| 真实 MySQL 三类 IT | `mvn test -Dtest=AccountSqlDialectMySqlIT,AiSqlDialectMySqlIT,ConcurrencyMySqlIT`（`JAVA_HOME=jdk-21`） | **8 通过 / 0 失败 / 0 错误 / 0 跳过**，BUILD SUCCESS（修复前：5 errors + 3 skipped） |
| 修复后重跑（确认可重复） | 同上 | 再次 8/8、0 跳过，BUILD SUCCESS |
| **判别力**（把 V10 列名改回 `release`） | `mvn test -Dtest=ConcurrencyMySqlIT` | `Tests run: 3, ..., Errors: 3, Skipped: 0` —— 从“跳过 3 条”变成**红 3 条**；错误直指 `Migration V10__illustration_asset.sql failed` + `1064`；且失败后**无残留库** |
| 生成器与迁移一致性 | `node scripts/gen-image-publish.mjs --emit-sql --out work/v10-regen.sql` + `diff` | 与 V10 **IDENTICAL** |
| 后端全量子集（排除 3 类真实 MySQL IT） | `mvn test -Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT` | **400 通过 / 0 失败 / 0 错误 / 1 跳过**，BUILD SUCCESS（含 H2 上的 `IllustrationAssetIT`，与基线数字一致、无回归） |
| 临时库清理 | 探测脚本查 `information_schema.tables` | 成功后与**失败后**均无 `typeme_concurrency_*` 残留；此前留下的两个已手工删除 |

未改动前端源码（对外 JSON 字段仍是 `release`），因此本轮不重跑前端测试。

### 边界与未覆盖

- 本轮**只在本机 MySQL 8.4.0** 上验证；未覆盖 MySQL 5.7/8.0 或任何远端/生产库。
- **未把 V10 应用到 `typeme_dev`**，也未执行任何现有库上的迁移（虽已获测试授权，但那是“跑会自动建/删临时库的 IT”的授权，不等于允许改现有库）；因此“部署时 V10 能否成功”只由**临时库上跑通同一份迁移**推出。
- 未做真实浏览器验收（无可观察的页面变化）；未做真实 AI 外发。
- 前一会话在途的两项（AI v4、review-fixes）仍未提交，本轮未动。

### 下一步优先级（承接 backlog 未闭环项）

1. **A58**：`GET /catalog/*` 契约说公开、实现要认证 —— 改成公开是**放宽**安全边界，需单独决策。
2. **A34**：`ReportService.submit` 在覆盖检查前就写 `clarification_skipped=1`；当前 UI 不可达，等出现回退覆盖能力时再修。
3. **A40**：账号页/对比页提示与按钮间距节奏，等下一次动那两页时一起收口。
4. 第 19 轮登记、至今仍只有 mock 证据的：弱网/超时/429/截断的 AI 分支。
5. ~~`backlog.md` 的 **A33 状态滞后**~~：本轮已复核代码与 `AnswerRevisionConflictIT`，把台账从“未闭环”改为“已闭环（前一会话 review-fixes 改动）”。
6. 新发现（P3 证据缺口）：`IllustrationAssetService` 的三条运行期 DML（SELECT/UPDATE/INSERT）**只有 H2 覆盖**（`IllustrationAssetIT` 跑在 H2），真实 MySQL 上没有任何 IT 跑过它们。本次改名已消除保留字风险，但这三条 SQL 的方言仍无实测证据。

## 第 29 轮：A58 —— 把 `GET /catalog/*` 按契约放开为公开（连带修掉 A74 / A75）（2026-09-21）

### 起点事实

- 契约 §7 把 `GET /catalog/current`、`GET /catalog/current/package` 归在“公开内容 GET”（§7.2 两张表“请求”列都是 `—`），而 `SecurityConfig` 只对 `auth/*` 开了口子，`/api/v3/**` 一律 `authenticated()` → 未登录拿到 **401**。
- 用户本轮说“按你的建议来”。上一轮列出的 9 项待决中，只有 **A58** 是既明确、又不需要额外授权的一项；其余（阈值语气 / 真人研究 / AI 真实试验 / 审计台账 DDL / Redis / LangChain4j / v4 默认值 / 提交部署）本轮**一项未动**，原因见文末。
- 建议原文是“放开 GET **+ 限流**；否则改前端走已公开路径”。选的是前者。

### 本轮做了什么

| 文件 | 改动 |
|---|---|
| `backend/.../security/SecurityConfig.java` | `permitAll` 新增 `GET /api/v3/catalog/current`、`/catalog/current/package`，注释写清放开范围与应对（限流） |
| `backend/.../jung/api/JungController.java` | 两个 GET 加 `HttpServletRequest` 参数 + `catalogReadAllowed(request)` 匿名限流入口 |
| `backend/.../security/RateLimitService.java` | 新增 `OP_CATALOG` 与 `checkCatalogRead(ip, authenticated)`：**仅匿名计数** |
| `backend/.../account/service/TypemeProperties.java` | `RateLimit` 新增第 6 个分量 `catalog`（缺项兜底 `5m/120`） |
| `backend/src/main/resources/application.yml` | `typeme.ratelimit.catalog: {window: 5m, ip-limit: 120}` |
| `frontend/.../stores/instrumentV3.ts` | 注释纠正（“匿名会 401”→“公开；读不到 = 离线/失败/被限流”）；`refresh()` 的旧注释也按现状改了（原来写的是“首页读过一次 401”这个已不成立的路径） |
| `frontend/.../stores/instrumentsV3.ts` | 注释纠正（`/platform/instruments` 早已 `permitAll`，“需要登录”是过时描述） |
| 测试 | `SecurityBoundaryIT` +2、`RateLimitIT` +2；`AccountSqlDialectMySqlIT` 适配 record 新字段；`SubmitReportIT` 注释更新 |

### 被新测试撞出来的两个真问题（不修则 A58 不成立）

见 `backlog.md` A74 / A75。简要说：

- **A74**：`RateLimitService` 在 `com.typeme.security`、抛的是 `com.typeme.common.ApiException`，而 jung/platform/ai 三个 advice 都只认自己的异常类型 → 匿名限流命中时变成裸 `ServletException`（不是 429，也没有 `retryAfterSeconds`）。**A58 之前没有任何非账号控制器会抛这个类型**，所以缺口一直没被触发。修法：两处各加一条显式 `@ExceptionHandler(com.typeme.common.ApiException.class)`（不扩 `basePackages`）。
- **A75**：`CurrentUser.requireUserId()` 只判 `isAuthenticated()`，而 Spring 的匿名主体 `AnonymousAuthenticationToken.isAuthenticated()` 是 **true** → 匿名访客被当成已登录，匿名限流一次都没发生（新用例拿到 200 而不是 429）。修法：`jung/api/CurrentUser` 与 `ai/controller/AiCurrentUser` 都排除匿名主体。

### 验证

| 项 | 结果 |
|---|---|
| 定向（含新用例）`-Dtest=RateLimitIT,SecurityBoundaryIT,SubmitReportIT,BigFivePlatformIT,InvitationAdminIT` | **35 通过 / 0 失败 / 0 错误 / 0 跳过**，BUILD SUCCESS |
| **判别力 1**（撤掉 `CurrentUser` 两处匿名判定） | `RateLimitIT#anonymousCatalogReadsAreRateLimited` **仅此一条**红（`200 != 429`），`SecurityBoundaryIT` 9/9 绿 |
| **判别力 2**（撤掉 `SecurityConfig` 新增的两条 `permitAll`） | `SecurityBoundaryIT#anonymousCanReadCatalog` 红（`expected:<200> but was:<401>`） |
| **判别力 3**（把 `/api/v3/**` 从 `authenticated()` 放宽为 `permitAll()`，对偶检查“放开是否真的只放开了目录”） | `SecurityBoundaryIT#anonymousCatalogRelaxationDoesNotOpenUserData` 红 1 条 |
| 后端全量（**排除** 3 个真实 MySQL IT） | **404 通过 / 0 失败 / 0 错误 / 1 跳过**，BUILD SUCCESS（＝第 28 轮 400 + 本轮新增 4） |
| 前端 `typecheck` + `vitest run` | 均 exit 0；**50 文件 / 1038 条通过**（与第 27 轮一致；本轮前端只改注释） |
| 内容一致性 `convert-jung-content.mjs --check` | “内容包与 YAML 一致。”（exit 0） |

原始输出：`verification/2026-09-21-a58-public-catalog/`。

### 限流口径（放开边界的代价）

`OP_CATALOG`：`ip` 维度、`5m/120`、**已登录用户不计数**（公共壳每页都读一次目录，计入会让正常浏览把自己挡在 429 上）；桶键 `catalog:<scope>:<value>:<windowStart>` 与 `register`/`login` 分开，避免“浏览目录”消耗“注册”额度。未加 `Retry-After` 头 —— 与既有登录限流一致，只在 `details.retryAfterSeconds` 给值。

### 边界与未覆盖（诚实交代）

1. **未跑真实浏览器**。“未登录首页现在真的显示服务端口径”目前只有 H2 + MockMvc 证据（前端确实消费该路径：`instrumentV3.load()` 从“必然 401”变成“真能读到”）。补验证很轻（dev 起前端 + 未登录窗口看首屏题数/维度名），本轮未做。
2. **未跑 3 个真实 MySQL IT**（本轮无 DDL/DML 变化，与它们无关；授权也未覆盖现有库迁移）。
3. **A74 的 AI 分支无触发路径**（`RateLimitService.checkAiCreate` 全仓无调用方），属对称补齐，不算端到端验证。
4. **`5m/120` 是判断值**，无真实流量调优证据；共享出口（NAT）下是否误伤未验证。
5. **A75 未做全仓扫描**：是否还有别处“只看 `isAuthenticated()` 就断定已登录”，本轮只改了已定位的两处。
6. **未提交、未部署**；`frontend/dist` 未重建，jar 未重打包。**`typeme_dev` 等现有库未做任何写入**。

### 本轮明确没做的事（以及为什么）

| 待决项 | 本轮为何不动 |
|---|---|
| 阈值 `0.20` vs `0.10`（dev-plan 那条最终分界） | 这是“产品语气（果断 vs 保守）”的选择，不是技术缺陷；选错方向会让不同人群拿到的类型结论优先度改变，必须用户定 |
| 真人试读 / 信度效度 | 需要先定目标（题面可读性 vs 测量质量主张），再投入；AI 无法代替 |
| AI 真实调用试验 | 是**外发真实数据 + 付费资源**，必须显式授权；也不允许为了造 429 证据去压上游 |
| 可审计的同意/设置台账 | 需要 DDL（新表/新列），而用户授权只覆盖“自动建/删临时库的 IT”，不覆盖现有库结构变更 |
| 后台“改角色 / 禁用”入口 | 需要先回答“是否补一个解禁能力”（禁用不可逆），是产品决定 |
| Redis / LangChain4j | 仓库开发提示词写成硬边界“不引入”，且已有明确结论；不推翻 |
| AI v4 是否设为默认 / review-fixes 是否发布 | 两者都在途未提交；review-fixes 的 CLEAR 取消端点要求**前后端同发**，发布节奏由用户定 |
| 提交 / 部署 | 未获授权 |

## 第 30 轮：阈值方案 B（`0.20`）—— 新计分版本 v4（2026-09-22）

> 本轮范围由用户指定：**实现阈值方案 B** —— 澄清触发与最终「倾向较轻」边界都改成归一化偏移
> `0.20`，即 `T(n) = B(n) = floor(2n/5)`。这是**产品政策变更**，不是缺陷修复，
> **不宣称提高测量准确性**。本轮：不改题面、不改 AI 提示词、不改报告文案版本。

### 起点事实（先看，再改）

- 用户此前已两次裁决这条阈值：2026-09-18 选「规则 D」（`floor(2n/10)`、`B = T`）→ `score-v3`；
  本轮改选决策文档 §3 表格里的 **B 方案**（`floor(0.4n)`）→ 新版本。
- `git status --short` 含**前一会话**两项在途工作（AI v4、review-fixes），本轮**未删改**。
- 结构上先确认 `score-v3` / `zh-v3` 已被占用，**没有 v4** → 新标识只能取 `typeme-jung48-score-v4`
  / `typeme-jung48-zh-v4`（复用旧 ID 会 UPSERT 覆盖历史内容）。
- **先跑基线**：6 条内容脚本 `--check` 全绿（`gen-jung-fixtures` 当时 `sha256=00acde79…`），
  确认起点干净后才改源。

### 机制（为什么"分母 5"而不是"分子 4"）

- `floor(2n/5)` 与 `floor(4n/10)` 在整数上等价，但契约 §4.1 原文就是 `floor(2n/5)`；
  而且 `boundaryNumerator=4` 会与「分子 4 + 但仍是 `B=T−1`」这条**第三套口径**混淆。
  所以取 `{boundaryNumerator: 2, boundaryDenominator: 5}`。
- 生成器 `buildJungV4(v3)` 里把「v4 与 v3 只允许 `version` 与 `boundaryDenominator` 不同」写成
  **生成期断言**（题目/维度/可读层逐字深比较，多改一个字节即失败），并另写一张跳档表自检
  `[9→3, 12→4, 16→6, 5→2, 4→1, 3→1, 2→0]`。这样"顺手夹带"在生成阶段就红，不用等测试。

### 改了什么

| 层 | 文件 | 改动 |
|---|---|---|
| 内容源 | `scripts/gen-platform-content.mjs`（CRLF） | 新增 `V4_PACKAGE_ID` / `V4_SCORING_VERSION` / `V4_REPORT_CONTENT_VERSION` 与 `buildJungV4(v3)`；报告文案**沿用 v1**（与 v3 同） |
| 生成产物 | `backend/src/main/resources/content/typeme-jung48-zh-v4.json`（新） | 声明 `sha256=a5208fcd387c34d2…`；64 题、维度、可读层与 v3 逐字相同 |
| 后端分发 | `jung/domain/JungScoringPolicy.java` | `UNIFIED_SCALE_VERSIONS` 加入 `…-v4`；注释写明 v4 与 v3 的差别与代价 |
| 后端默认包 | `jung/content/JungPackageLoader.java` | `CURRENT_PACKAGE_ID` → `typeme-jung48-zh-v4`（新草稿默认绑定） |
| 后端注释 | `jung/scoring/JungScorer.java` | javadoc 不再硬写版本与常量 |
| 前端版本表 | `frontend/src/domain/jung/types.ts` | `UNIFIED_BOUNDARY_SCALE_VERSIONS` 加入 v4 |
| 夹具 | `scripts/gen-jung-fixtures.mjs` + 3 份 `score-cases.json` | 绑定 v4 包；`sha256=96943e4bbc1e…`、**25 例**（新增 4 例 v4 专有：`\|S\|=B` 等号、`\|S\|=B+1` 越出、负向对称、合并题集越出） |
| 断言 | `JungScoringPolicyTest`(9)、`JungLegacyScoringRegressionTest`(9)、`JungReportCopyBaselineTest`(4)、`JungReportSchemaTest`(15)、`thresholds.spec.ts`、`scoring.fixture.spec.ts`、`snapshotThresholdCopy.spec.ts`、`readingCompanion.spec.ts`、`reportV3View.spec.ts` | v4 逐点表 + v3/v1/v2 冻结表 + 未知版本拒绝；报告"逐字段相同"比较补入 `boundaryNumerator`/`boundaryDenominator`（它们本来就该随版本不同） |
| 页面验收 | `scripts/browser-verify-score-v4.py`（新） | 自带静态服务、全部 `/api/**` 拦截、320/390/1440；**同一张报告页按快照自己声明的政策渲染不同口径** |

**为什么报告"逐字段相同"的基线用例从 CASE-12 换成 CASE-01**：CASE-12 在 v4 下从 `REFERENCE`
变成 `TENTATIVE`，状态一变换，报告正文本来就该不同；继续用它只会证明"状态也变了"，
失去"除版本字段外文案一致"这个要证明的东西。CASE-01 在 v1 与 v4 下都是 `REFERENCE`。

### 用户可见变化（两件，与 v3 不同：这次都变大）

1. **触发集合扩大**：`T(9)` 1→3、`T(12)` 2→4、`T(16)` 3→6 ⇒ **原本不安排补充题的维度可能多出 4 道题**。
2. **边界带扩大**：同一份作答可能从 `REFERENCE` 变 `TENTATIVE` 并多出候选；含 `\|S\| = B(n)` 等号格。

代表例（夹具内、逐条实测）：CASE-05 的 EI 维 `n=9, \|S\|=2` v3 不安排澄清、v4 新触发且跳过即 `TENTATIVE`；
CASE-12 的 EI `n=12, \|S\|=4` v3 是 `REFERENCE`、v4 是等号格 `TENTATIVE`；CASE-25 `n=16, \|S\|=7` 两版都是 `REFERENCE`。

### 验证

| 项 | 结果 |
|---|---|
| 内容一致性（6 条 `--check`） | 全绿：`gen-fallback-content`、`rewrite-types-content`（0 处）、`check-type-duplication`（0 处）、`convert-jung-content`、`gen-jung-fixtures`（**sha256=96943e4bbc1e**）、`gen-platform-content`（v2/v3/v4/report-v2/bigfive 五份"与源一致"） |
| 后端定向（评分/夹具/报告 5 类） | **41 / 0 / 0 / 0**，BUILD SUCCESS |
| 前端定向（5 个 spec） | **5 文件 / 243 条通过** |
| 后端全量（**排除** 3 个真实 MySQL IT） | **406 run / 0 fail / 0 error / 1 skip**，BUILD SUCCESS |
| 前端 `typecheck` + 全量 `vitest` | exit 0；**50 文件 / 1072 条通过**（第 29 轮 1038，+34） |
| 前端 `vite build` | 构建到**隔离目录** `work/v4-verify-dist`（未覆盖 `frontend/dist`），exit 0 |
| **真实浏览器** 320/390/1440 | **197 / 197 通过 / 0 未捕获异常 / 0 未登记接口**；12 张截图；`NEEDS_REVIEW` 走"报告 404 → 空态"分支 |
| 判别力 1（内容分母 5→10 并重生成） | 内容 `--check` 红；后端定向 **41 run / 9 failures / 0 errors**（`JungScoringPolicyTest` 1、`JungLegacyScoringRegressionTest` 4、`JungScoringFixtureTest` 2、`JungReportCopyBaselineTest` 2），原文含 `expected: <TENTATIVE> but was: <REFERENCE>`、`denominator expected: <5> but was: <10>`、夹具哈希不符；`gen-jung-fixtures --check` 在 `CASE-25` 直接失败 |
| 判别力 2（前端契约表 `/5`→`/10`） | 前端定向**精确 4 条红**（逐点表、等号格、与开发方案对比两条），其余 239 绿 |
| 判别力 3（夹具 `v4-boundary.json` 分母 5→10） | 浏览器验收**首条即红**（"方法节写明 v4 的口径（每 5 题）"） |
| 全部变异已还原 | 4 份内容/夹具与 `JungScoringPolicy.java` 逐字节回到基线，`--check` 全绿，后端定向 41/41、前端定向 243/243、浏览器 197/197 复跑通过 |

原始输出：`docs/optimization/verification/2026-09-22-threshold-v4/`（`REPORT.md`、`browser-results.json`、12 张 PNG）。

### 边界与未覆盖（诚实交代）

1. **没有真人数据**。`0.20` 与 `0.10` 都没有信度/效度依据；**带宽翻倍不等于补充题数量翻倍**，
   实际多出多少取决于答卷 `\|S\|` 分布，本轮**无样本**，不能由公式反推（记 A78）。
2. **未登记数据库**。`typeme-jung48-zh-v4` 需要在部署时由 `JungPackageRegistrar` UPSERT 进
   `assessment_package`。本写入属**现有库变更，需单独授权**；本轮**没有把后端启动到任何库**。
   不登记时新草稿会因外键失败，**上线前必须做**。
3. **未跑 3 个真实 MySQL IT**（与本次改动无关，且属现有库范围）。
4. **浏览器验收是"合成报告 + 全量模拟接口"**：报告 JSON 由生产计分器与报告构造器生成，
   但 API 全部被拦截 —— 不覆盖真实登录、提交/保存、数据库与 AI。
5. **截图未做人工目视**（执行模型无图像输入），以"有布局盒 / 有可见尺寸 / 横向不越界 / 无横向溢出"替代。
6. **`frontend/dist` 未重建、jar 未重打包、未提交、未部署**。旧包 v1/v2/v3 全部冻结未动。
7. **`fetchScoringPolicy` 的缺省值仍是 `2/10`**（前端防御性兜底）：只在报告缺字段时生效；
   已确认当前后端一定下发这两个字段，本轮**未改**（改了会让"字段缺失"这件事被静默掩盖）。

## 第 31 轮：真实全栈验收 —— 真 jar + 真 MySQL + 真会话（A80–A83）（2026-09-22）

### 起点事实

第 30 轮的 v4 验证有三层：计分/夹具层、报告构造层、**把 `/api/**` 全 mock 的**浏览器层。
中间缺一段：没有任何证据看过真实 `GET /api/v3/reports/{id}` 的 `methodology`。
后端一旦漏发 `boundaryNumerator`/`boundaryDenominator`，前端会退回缺省 `2/10`，
报告页显示“每 10 题…”—— 而三层测试全绿。

本轮在用户“全部授权”下把这条补掉，并把判别力从夹具层推到**部署产物层**。

### 做了什么

| 事项 | 结果 |
|---|---|
| 重建产物 | `npm run build`（`frontend/dist`）+ `mvn -o package -DskipTests`；核对 jar 里确实有 `content/typeme-jung48-zh-v4.json`、`db/migration/V10__illustration_asset.sql`、新 `static/assets/index-*.js` |
| 隔离库部署 | 新建 `typeme_r31_e2e` → Flyway **V1–V10 全部从零迁移成功** → `JungPackageRegistrar` 登记 v1/v2/v3/**v4** + 大五 |
| API 级真实全栈 | 新增 `work/r31_e2e.py`：真实注册（真邀请码/CSRF/会话）→ 建测评 → 读题 → 构造答卷 → review → 跳过补充题交卷 → 读报告。**16/16** |
| 真实浏览器 | 新增 `scripts/browser-verify-real-stack-v4.py`：真表单注册 → 选择页点开始 → 46+1 题 → 跳过补充题 → 交卷 → 报告页三档宽度。**19/19** |
| 判别力（部署层） | 内容源分母 5→10 → 重打包重启（包哈希 `4923071243f5…`）→ API 级 **12/16（4 红）**、浏览器级 **14/19（5 红）**；还原后两条各自复跑回 **16/16** 与 **19/19** |
| 清理 | `DROP DATABASE typeme_r31_e2e` / `typeme_r31_disc`；停掉 8099 上的临时 jar |

**判别力设计的要点**：造一份 **v3 与 v4 结论不同**的答卷（EI `|S|=3, n=12`）。
v3 `B(12)=2` → REFERENCE；v4 `B(12)=4` → **TENTATIVE**。
所以“后端跑的是不是 v4”由**报告状态本身**证明，而不是断言某个字段存在。
变异时这条断言精确翻成 REFERENCE —— 这是本轮最有价值的一条证据。

### 验证命令与结果

```powershell
# 1. 真实 MySQL IT（与上轮同一命令，本轮复跑确认无回归）
work\run-backend-mysql-it.cmd          → 8 run / 0 fail / 0 error / 0 skip，BUILD SUCCESS
# 2. 产物
work\run-r31-deploy.cmd                → 前端 build + mvn package，BUILD SUCCESS
# 3. 真实全栈
work\start-r31-e2e.cmd（起 8099）
C:\Python314\python.exe work\r31_e2e.py                        → 16/16
C:\Python314\python.exe scripts\browser-verify-real-stack-v4.py → 19/19
```

### 本轮新增发现（4 条）

- **A80（P1，已闭环）**：报告接口的政策字段只被 mock 覆盖；本轮补齐并做了部署层判别力。
- **A81（P3，已处置）**：注册 IP 限流（实测 `429, retryAfterSeconds=2370`）会把重复验收挡成假红；脚本改为只清隔离库里 `register:%` 一个桶。限流本身未改。
- **A82（P3，已记录）**：`/assess` 已是选择页（要在页上点 `[data-start='jung48']`），两条历史脚本仍按“进去就建草稿”写。
- **A83（P2，已记录并核对）**：**WSL→Windows 互操作不透传自定义环境变量** → 我本意指向隔离库、实际让 jar 连到了 `typeme_dev`，对其执行了 **V9/V10 迁移并登记 v3/v4**。在“全部授权”范围内，且结果与待执行的部署步骤一致；已核对 `assessment_attempt` 9→9、`assessment_report` 5→5 未变。后续一律用带 `set TYPEME_DB_URL=…` 的 `.cmd` 启动。

### 遗留问题与下一步

1. **未提交、未推送、未部署**；`frontend/dist` 与 `typeme-backend-1.0.0.jar` 已重建但未发布。
2. **A78 仍未解**：v4 到底会让多少人多答补充题，只有公式、没有真人分布。
3. **A40 / A34** 仍未处理；`IllustrationAssetService` 的 DML 仍只有 H2 覆盖。
4. 两上一会话在途轮（AI prompt v4、review-fixes）仍未提交；后者需前后端**成对发布**（CLEAR 解绑）。
5. 真实 MySQL 的三个 IT 本轮已跑，但 `typeme_dev` 的 V9/V10 是**非预期**执行的（见 A83），部署队应与环境负责人对齐现有库的实际版本。

## 第 32 轮：PR #17 的 Codex 评审闭环（A84、A85）（2026-09-22）

### 起点事实

- 第 31 轮把分支推成 PR #17 后，Codex 自动评审提了两条：① `V10__illustration_asset.sql` 原地改列名应当改为
  增量迁移；② `requeueForRetry` 把 `SUCCEEDED` 也纳入重新入队，会让「再生成失败」不再呈现上一份成功结果。
- 两条都在**已被 #16 覆盖的分支基线上**讨论，所以先读代码确认当前行为，再决定「改/不改、以及要不要补证据」。

### 做了什么（按两条建议分别处置）

**② 重新生成失败不应抹掉上一次正文（A84）—— 判定为真缺陷，已修（P1）**

- 判定依据（读代码，不靠印象）：`AnalysisJobRepository.requeueForRetry` 的条件是
  `status IN ('FAILED','UNKNOWN','SUCCEEDED')`（`:229`），而**全仓库只有 `markSucceeded` 会写 `response_json`**（`:183`）——
  重新入队与 `markFailed`/`markUnknown` 都不清这列。所以状态变成 `FAILED` 时，正文仍在库里、也在接口响应里。
- 但 `AiAnalysisPanel.vue` 把失败卡与结果卡写成同一条 `v-else-if` 链：`succeeded` 为假就不会渲染结果区 →
  用户点一次「再生成一次」失败，此前能读的分析从界面上消失。这与面板里既有文案「失败不会被算作已经给过你一份分析」自相矛盾。
- 修法（只在展示层，不动数据模型、不动状态机）：模板拆成两条独立 `v-if`；新增
  `staleResult = failed && result != null` 与 `showResult = succeeded || staleResult`；失败时继续渲染结果区，
  并加 `[data-ai-stale]` 明确写「这份是上一次成功生成的内容，本次重新生成没有成功，所以它没有被替换」。
- `result != null` 能推出「历史上成功过至少一次」是**由代码保证的**（只有 `markSucceeded` 写这列），不是猜测；
  据此反向用例也成立：从未成功过时不渲染结果区。

**① V10 是否该改成增量迁移（A85）—— 结论不变，但把推理补成证据（P3）**

- 评审的前提是「旧版脚本在仓库支持的 H2 MySQL 模式下可以成功执行」，于是担心「已应用过旧版 V10 的库」。
- 我没有直接照改，而是先把「是否存在这样的库」查清楚：
  1. 在真实 MySQL 8.4 上执行**原版** V10（`git show 6bc09ca^:…V10…sql`）→ `ERROR 1064 … near 'release VARCHAR(32) …'`，
     且该库**一条语句都没成功**（表都没建出来）；
  2. 全机三个 TypeMe 库的 `flyway_schema_history` 里 `version>=9` 只有 `typeme_dev` 的 9/10 两条，`typeme_show`/`typeme_test` 为空；
  3. 全库 `illustration_asset` 只有 `typeme_dev` 一张，列名已是 `release_tag`，没有 `release`；
  4. 两个被忽略的 H2 文件库（`output/*.mv.db`）迁移停在 V8，且 0 处 `illustration_asset` 字样；
  5. 旧版 DDL 在 H2 MySQL 模式下确实能执行成功（复现评审的前提），所以「H2 能过、MySQL 不能」成立。
- 结论：**不追加 V11**（V10 失败时 V11 永远轮不到；且不存在需要兼容的历史库），
  但把这条从「注释里的推理」升级为可复现证据，存档在 `docs/optimization/verification/2026-09-22-pr17-review/`。

### 验证与证据

| 命令 | 结果 |
| --- | --- |
| `npx vitest run src/components/aiAnalysisPanel.spec.ts`（修复态） | **15/15 通过**（新增 2 条） |
| 同一条，把 `showResult` 退回 `succeeded`（判别力） | **1 failed / 14 passed**，且失败点正是新用例（`expected false to be true`） |
| `npm run typecheck` | 退出 0 |
| `npx vitest run`（全量） | **50 文件 / 1074 条通过**（第 31 轮为 1072，+2） |
| 原版 V10 打真实 MySQL 8.4 | `ERROR 1064`，表未建出（`mysql8-original-v10-rejected.txt`） |
| 旧版 DDL 打 H2 MySQL 模式 | 退出 0（`h2-old-v10-accepted-by-h2.txt`） |
| 全库 flyway 历史 / 列名盘点 | 见 `mysql-flyway-history-and-column.txt` |

### 遗留 / 未覆盖

- **A84 的上游残留（数据模型层面，本轮未改）**：`ai_analysis_job` 上同一份发送范围只允许一行
  （`uk_ai_job_request`），也只有一份 `response_json`。所以本轮修好的是「重新生成**失败**时不再隐藏旧正文」；
  而「重新生成**成功**」会原地覆盖上一份正文，没有历史版本可回退。要保留多份结果需要新表/新列与迁移，
  属需用户决定项（见 backlog「需用户决定的事项」）。
- 未做真实浏览器回归：本轮只动了前端一个组件与两个单测（未跑真实 AI 调用，也拿不到真实 429/超时），
  浏览器级证据仍以第 31 轮的 19/19 为基础；如需页面级确认应另行授权一次真实 AI 调用。
- `V10` 的处置仍是「原地修正」，若将来有库真的应用过某个中间版本 V10，Flyway checksum 冲突会先报出来（这是期望行为）。

## 第 0 轮：环境与基线（2026-09-17）

### 做了什么

- 读 `AGENTS.md`、`docs/DSH-持续优化提示词.md`、`README.md` 顶部新测说明、
  `docs/2026-09-16/implementation/README.md`（含 §7 未完成项、§10 前端缺口）。
- `git status --short` 干净（HEAD `1dbad2a`），无未跟踪文件需要保护。
- 建立本记录目录 `docs/optimization/`。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `node scripts/gen-fallback-content.mjs --check` | exit 0「前端内置副本与后端 YAML 一致」 |
| `node scripts/rewrite-types-content.mjs --check` | exit 0 |
| `node scripts/check-type-duplication.mjs` | exit 0「跨类型 >= 6 字连续重合：0 处」 |
| `node scripts/convert-jung-content.mjs --check` | exit 0「内容包与 YAML 一致」 |
| `node scripts/gen-jung-fixtures.mjs --check` | exit 0「夹具一致（3 份，sha256=67ae28a95fd1）」 |
| `npm.cmd run typecheck`（frontend） | exit 0，零错误 |
| `npm.cmd test`（frontend，Vitest） | **17 文件 / 693 条通过，exit 0** |

### 环境事实（影响后续验证方式）

- `D:\develop\jdk-21` 存在，但 PATH 上的 `java` 是 17.0.14 → 跑后端必须显式 `JAVA_HOME`。
- 本机 **3306 未监听**，MySQL 不可用；`typeme_dev` 连不上。
  → 本轮不做任何数据库写操作；**真实浏览器验收需要先有一个可用的后端**。
- Vitest 在 workspace-write 沙箱下会因 esbuild 需要管道而 `spawn EPERM`；
  已用一次性的提权重试跑通（原命令不变）。
- `backend/target/typeme-backend-1.0.0.jar` 是**瘦 jar**（931KB，`META-INF/MANIFEST.MF` + classes，
  没有 `BOOT-INF/`、没有 `static/`），不是可运行产物。

### 遗留 / 下一步

- 下一步：实施并验证顶栏导航重复入口与导航文案写反（backlog A1 / A2）。
- 需要用户提供的环境（否则真实浏览器与端到端只能列为未覆盖）：
  一个**空库**用于让 Spring Boot 启动并跑 Flyway（本机 MySQL 当前不可用，
  也可由我改用内存 H2 启动，但需要把 H2 临时放进运行时 classpath）。

## 第 1 轮：顶栏导航重复入口 + 导航文案写反（2026-09-17）

### 问题与证据

`frontend/src/App.vue` 顶栏导航里，`assessmentRoutesReady` 为真时：
L204-210 渲染第一个 `RouterLink to="/assess"`，L218-223 又渲染第二个同样指向 `/assess` 的
「开始测评」。第一个带 `route.name === 'assess' || 'assess-attempt'` 的高亮判断，
但 `quizActive` 为真时整个 `template` 都走另一支（只渲染"暂时离开"），
所以那句高亮判断**永远为假**；同时两个相邻的重复入口对键盘与读屏用户是纯噪音。

### 做了什么

- `App.vue`：删掉重复的第二个 `<RouterLink to="/assess">`（旧版本残留下来的），
  保留带高亮判断的那一个；删掉因此变成死代码的 `showStartLink` computed；
  把写反的 `route.name === 'about' ? '方法与隐私' : '关于'` 改成固定「关于」，
  并在两处加注释说明"导航项写的是**目标**的名字，与当前停在哪一页无关"。
- 新增 `frontend/src/views/shellNav.spec.ts`（3 条）：钉住"顶栏恰好一个 `/assess` 入口"、
  "关于入口在 `/` 与 `/about` 上都叫关于"、"只有一个登录/注册入口"。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run`（frontend） | 新增 spec 通过 |
| **反向验证**：把重复入口与写反的文案注回 `App.vue` | `shellNav.spec.ts` **2/3 失败**，证明它真的守得住 |
| `scripts/browser-verify-optimization.py`（真实浏览器，320/390/1440） | A 组 7 项全 PASS |

### 遗留 / 下一步

- A1 / A2 闭环。下一步做 A3（小字对比度）。

## 第 2 轮：小字对比度与设计系统守卫（2026-09-17）

### 问题与证据

`ink-faint`（原 `#7C8892`）在 `paper` / `paper-soft` / 白底上分别是 3.35:1 / 3.05:1 / 3.62:1，
低于 WCAG AA 小字 4.5:1；而它正是 `.fineprint`(12px)、`.caption`(13px) 与约 40 处
`text-ink-faint` 用的色 —— **包括表单校验的错误提示**。`accent-500`（原 `#B85332`）
作为 13px 的 `.section-kicker` 在真实渲染里只有 **4.49:1**（差 0.01）。

### 做了什么

- `frontend/tailwind.config.js`：`ink.faint` `#7C8892 → #626D78`、
  `accent.500` `#B85332 → #B04E2E`（保持色相，只调深到最紧的 `paper-soft` 底也够 4.5:1）。
  两处都写了为什么选这个值、而不是"刚好过线"的邻近值。
- 新增 `frontend/src/design/contrast.spec.ts`（19 条）：运行时读 `tailwind.config.js`，
  按 WCAG 公式实算每一组前景/背景的对比度。把"可读"从人眼判断变成机器判据。
- `frontend/src/views/views.spec.ts`：更新色值断言（该守卫确实先变红了 —— 这正是它该做的）。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run`（frontend） | 19 文件 / 715 条，全通过（含新增 19 条对比度 + 3 条导航） |
| `npm.cmd run typecheck` | exit 0 |
| **反向验证**：把 `ink-faint` 注回 `#7C8892` | `contrast.spec.ts` **3/16 失败** |
| `scripts/browser-verify-optimization.py`（真实渲染值） | B 组全 PASS，最低一条 4.5:1（12px 页脚小字） |

### 遗留 / 下一步

- 顶栏门槛原本由这一轮的自定判据覆盖，实际量到 320 宽报告页 139px，转到第 4 轮。
- 下一步：把"答题页到底能不能答"这件事真正在浏览器里走完（第 3 轮的起因）。

## 第 3 轮：答题页 500（跨库时间类型）—— 本轮最重要的修复（2026-09-17）

### 问题与证据

用一次性内存 H2 起真实后端后，浏览器主流程走到"首页主按钮 → /assess"就断了：

```
POST /api/v3/attempts            → 201
GET  /api/v3/attempts/{id}        → 500
页面文本：这份测评没能载入：请求 /attempts/3f7a9e3e-… 失败（HTTP 500）。
```

后端日志（`output/backend-h2.log`）：

```
java.lang.ClassCastException: class java.sql.Timestamp cannot be cast to
  class java.time.LocalDateTime
    at com.typeme.jung.service.AttemptService.detail(AttemptService.java:164)
```

根因：`requireRow()` 用 `JdbcTemplate.queryForList(...)`，它走 `ColumnMapRowMapper`，
对时间列调的是 `ResultSet.getObject(name)` —— **返回类型由驱动决定**：
H2 2.x 给 `java.sql.Timestamp`，Connector/J 给 `LocalDateTime`。
而 `detail()` 里写的是 `(LocalDateTime) row.get("started_at")`，于是
**MySQL 上通过、H2 上 500**。同形的直接强转还有两处：
`ReportService:303`（`selfReflection`）、`ReportService:357`（`compare`）。

为什么旧测试全绿也漏了：`GET /attempts/{id}` 此前在 H2 集成测试里**从没被调用过** ——
`AssessmentCreationThroughRealSessionIT` 建完测评就结束，而列表接口用的是
RowMapper（`rs.getObject(name, LocalDateTime.class)`），恰好走的是安全路径。

### 做了什么

- `TimeSource.utcFromJdbc(Object)`：集中做"JDBC 时间值 → UTC `LocalDateTime`"换算，
  接受 `LocalDateTime` / `Timestamp` / `OffsetDateTime`（按同一时刻换算），
  其它类型直接抛而不是猜；注释里写清了这个缺陷的完整来龙去脉。
- `AttemptService.detail`、`ReportService.selfReflection`、`ReportService.compare`
  三处改为走它。
- 回归防线两层：
  - `TimeSourceJdbcConversionTest`（5 条）—— **真的用 `Timestamp` 断言**，
    而不是只测 LocalDateTime 那条无痛路径（后者正是缺陷漏出去的原因）；
  - `AssessmentCreationThroughRealSessionIT` 增加 `GET /attempts/{id}` 断言
    （200 + `startedAt`/`updatedAt` 是 ISO 字符串 + `packageContent.questions` ≥ 48）——
    这个类本来就跑在 H2 上，加上这条就会红。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `python work/probe-attempt.py`（直接打 API） | 修复前 `GET attempt → 500`；修复后 `→ 200` 且带 `coverage`/`packageContent` |
| `mvn.cmd test '-Dtest=TimeSourceJdbcConversionTest,AssessmentCreationThroughRealSessionIT'` | Tests run 6 / Failures 0 |
| **反向验证**：把 `(LocalDateTime)` 强转注回 `detail()` | `AssessmentCreationThroughRealSessionIT` **以同一个 ClassCastException 变红**，还原后转绿 |
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'` | **Tests run 243 / Failures 0 / Errors 0 / Skipped 1**，BUILD SUCCESS |
| `python scripts/browser-verify-jung-flow.py` | 注册 → 48 题作答 → 跳过补充题 → 报告详情/列表 → 320/390/1440 布局 → 账号页：**PASS 23 / FAIL 0** |

### 未覆盖风险（必须一起读）

- 本机 MySQL 不可用，**MySQL 方向没有实跑**。改动是"两种类型都能吃"的超集，
  不改变 MySQL 原有路径，但这属于推理不是实测。
- 一次性 H2 后端是用 `mvn exec:java -Dexec.classpathScope=test` 起的，
  测试 classpath 上同时有 `AiTestApplication`，因此加了
  `SPRING_MAIN_ALLOW_BEAN_DEFINITION_OVERRIDING=true` 才起得来。
  这只影响这个一次性的本地验收后端，**不是产品配置**。
- 该临时后端用 `TYPEME_RATELIMIT_ENABLED=false` 关掉了限流（真实限流本身已单独验证过：
  它确实按策略返回 429 + `retryAfterSeconds`）。**全程未触碰 `typeme_dev`，无任何数据库写操作落在真实库上。**

## 第 4 轮：320 宽粘性顶栏高度（2026-09-17）

### 问题与证据

新增 `scripts/browser-verify-narrow-layout.py`，在 320/360/390/768/1440 五个宽度 ×
首页/登录/注册/关于四个页面上量**粘性顶栏高度**与横向溢出。修复前：320×568 上
首页/登录/注册/关于一律 **139px = 24.5% 视口**（品牌行副标题与导航都在折行）。

### 做了什么

- `App.vue`：品牌行的量表副标题改为 `hidden min-[360px]:inline`。
  窄屏只剩"品牌 + 三个导航入口"两行；量表口径在首页正文与页脚署名里仍然完整。
- 顺手把品牌链接的 `aria-label` 从 `quizActive ? '暂时离开答题，回到首页' : 'TypeMe 首页'`
  固定为「TypeMe 首页」：读屏里它**永远**是回首页的链接，不该随页面状态改名。
- 新增脚本 `scripts/browser-verify-narrow-layout.py`（40 项判据）：
  顶栏 ≤120px 且 ≤15% 视口（<360px 宽放宽到 18%，因为导航三入口在 320 上折两行
  是当前设计的可接受代价），并逐页检查无横向滚动。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `python scripts/browser-verify-narrow-layout.py` | 修复前 PASS 36 / FAIL 4；修复后 **PASS 40 / FAIL 0**，320 宽顶栏 **88px / 15.5%**，390 宽 91px |

### 遗留 / 下一步

- 后续建议按同一套"可复核数字"方式继续：先量、再改、再把数字写进判据。

## 第 5 轮：刷新后回退到已答过的题（断点续答落点写错）（2026-09-17）

### 问题与证据

给主流程脚本补上"作答中途刷新"这一步之后，320/390 下立刻红了：

```
刷新前 'JP · 生活节奏 行程变化的适应 …'
刷新后 'TF · 决策依据 冲突处理 …'
页面进度：主测 47 / 48，第 48 题 / 共 48 题
```

用 `work/debug-resume.py` 打请求日志定位：答第 1 题 → PATCH 带答案 →
点「下一题」→ PATCH **只带 `currentQuestionId: "EI-01"`**（刚答完那一题），
页面切到 `SN-01`；再答再前进，服务端 `currentQuestionId` 一路**落后一题**
（页面在第 4 题时，服务端记的还是 `TF-01`）。刷新后 `restorePosition()` 优先信任这个
指针 → 落回已答过的题。

为什么"落后一题"不是错：`next()` 里写的是\*\*刚答完的那一题\*\*，注释说明这是刻意的安全值
（写下一题会让"跳过未答题"成为可能）。**错的是恢复落点的优先级**：`restorePosition()`
先看 remembered 指针，再退到"第一道未作答"。在 48 题的包上，指针=第 47 题，
于是刷新把用户送回第 47 题而不是第 48 题；未答完的题必须靠手动"跳到未答的题"。

### 做了什么

- `frontend/src/views/AssessView.vue` 的 `restorePosition()` 调换优先级：
  **第一道未作答的主测题 → 已安排的补充题 → 才回到 remembered 指针**（回看用）。
  写入语义（`next()` 存安全值）保持不变 —— 只改"从哪儿继续"，不改"记什么"。
- `frontend/src/views/assessView.spec.ts` 新增两条：
  - 指针停在已答过的题上时，刷新必须落到第一道未作答（原缺陷路径）；
  - 主测全部答完时，才回到 remembered 那一题。
- 主流程脚本 `scripts/browser-verify-jung-flow.py` 增加 `[3b] 作答中途` 一节
  （刷新恢复 + 回退改答），并修正脚本自身的节奏问题：**点禁用状态的「下一题」是空操作**，
  保存是服务端往返，必须先等按钮可用再点（前一版偶发"停在最后一题"就是这样来的，不是产品缺陷）。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run src/views/assessView.spec.ts` | 18 条通过 |
| **反向验证**：把 `restorePosition()` 换回"remembered 优先" | 新断言 **1 failed**，还原后转绿 |
| `python scripts/browser-verify-jung-flow.py` | **PASS 28 / FAIL 0**（修复前 26 / 2） |

### 遗留 / 下一步

- 跨设备并发（同一 attempt 两个会话同时改）的 409 冲突仍未在真实浏览器里验证过 ——
  需要两个独立会话，脚本尚未覆盖。

## 第 6 轮：注册免责声明同意项（A4，用户授权后实施）（2026-09-17）

### 问题与证据

产品要求里有「免责声明」（`docs/任务拆解.md` L105），但历史实现是**两端都缺**：
前端注册表单 `input[type=checkbox]` 数量为 0，后端 `RegisterRequest` 没有该字段、
全仓无人读 `disclaimer*` —— 历史 E2E 脚本发的那个键被静默忽略
（`docs/2026-09-16/verification/acceptance-evidence.md` §9.1 有实测与自我纠正记录）。

### 做了什么（已获用户明确授权）

- **后端**：
  - `RegisterRequest` 增加 `Boolean disclaimerAccepted`；
  - `AccountService.register` 增加 `requireDisclaimerIfConfigured`：默认**缺省即拒绝**
    （400 `VALIDATION_FAILED` + 字段名 `disclaimerAccepted`），并记一条
    `log.info("registration disclaimer accepted")`（只有事件名，不带用户名/IP）；
  - `AuthController` 传 `Boolean.TRUE.equals(...)`；
  - `TypemeProperties.Auth` 增加 `disclaimerRequired`，`application.yml` 默认 `true`，
    注释说明它只用于灰度放量，且关闭时**不会**假装用户同意过。
  - 字段名抽成 `AccountService.DISCLAIMER_FIELD` 常量并与前端对齐 —— 名字写错不会报错，
    只会让用户看到一串英文。
- **前端**：
  - 新增 `frontend/src/domain/disclaimerV3.ts`（字段名 / 文案版本 / 文案分段，页面与测试共用）；
  - `RegisterView.vue` 增加勾选框，默认**不勾**，整句包在一个 `<label>` 里
    （含两个指向 `/about` 的链接）；不勾时按钮禁用并说明原因；
  - `api/v3.ts` 的 `registerAccount` 把 `disclaimerAccepted` 设为**必填**参数
    （编译期拦住"忘记传"的新调用点），`FIELD_LABELS` 增加中文标签；
  - `stores/auth.ts` 的 `register()` 同样显式要求该参数。
- **文档**：契约 `02-数据模型与API-v1.md` §认证 更新请求体并写明这是**一处收紧**；
  `README.md` 顶部表格加「注册前置」一行。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'` | **Tests run 244 / Failures 0 / Errors 0 / Skipped 1**，BUILD SUCCESS |
| `npx.cmd vitest run src/views/registerView.spec.ts` | 3 条通过（未勾不可提交 / 勾了才带 `true` 送出 / label 整句可点且两个链接指向 `/about`） |
| `npx.cmd vue-tsc --noEmit` | exit 0 |
| `python scripts/browser-verify-jung-flow.py` | **PASS 34 / FAIL 0**（新增 3 条：有勾选框、未勾不可点、label 存在） |
| 后端新增 `RegistrationAndLoginIT.registrationWithoutDisclaimerIsRejected` | 缺省与 `false` 都 400 且带字段名；同意后同名用户能注册成功 |

### 为什么"必填"而不是"可选"

用户当时选的是"加勾选框 + 服务端可选字段与校验"。"可选"与"服务端校验"互相矛盾：
只声明不校验就等于回到"静默忽略同意"的老状态。这里按**必填 + 可关开关**实现：
新客户端必须传，灰度期可配 `disclaimer-required=false` 放旧客户端先跑。
这属于对外接口行为的一处收紧，已在契约与本文档显式标注。

### 遗留 / 下一步

- 正式上线前仍需隐私政策/用户协议**正文**（`docs/需求文档.md` §8、`docs/商业化构想-v0.1-备查.md` §8.3）。
  本轮只完成了"注册时确实取得了显式同意"这一环，文案援引 `/about` 已写实的限制说明。
- 同意记录只进服务端日志，**没有**落库（那需要新迁移，属数据库结构变更授权范围）。
  若日后需要"可审计的同意台账"，需单独授权加列/加表。
- 下一步：AI 分析前端（用户已授权，第 7 轮）。

## 第 7 轮：报告页 AI 分析前端（A9，用户授权后实施）（2026-09-17）

### 问题与证据

后端五个 AI 端点在 `ai/controller/AnalysisController.java` 已完整实现（创建/查询/重试/列表/状态），
但前端**零消费者**：`frontend/src/` 全文搜 `analyses`、`ai/status` 无命中，
`ReportV3View.vue` 也没有任何入口。也就是说这项"可选能力"从用户角度**完全不存在**。
用户 2026-09-17 决定做，范围限定"报告页生成分析 + 展示 + 失败重试"，不做管理员配置页。

### 做了什么

新增四个文件 + 报告页一处挂载：

| 文件 | 职责 |
|---|---|
| `frontend/src/api/v3Ai.ts` | 五个端点的类型化客户端 + §3 结构化输出的**宽容解析** + 错误码翻成"用户该做什么" |
| `frontend/src/stores/aiAnalysisV3.ts` | 状态/额度、创建（带幂等键）、重试、**可停止的轮询** |
| `frontend/src/components/AiAnalysisPanel.vue` | 报告页内嵌面板：范围确认 → 生成 → 等待 → 结果 / 失败重试 |
| `frontend/src/views/ReportV3View.vue` | 在「带走这份报告」之后插入 `<AiAnalysisPanel>`（`reportId` 为空时不渲染） |

三个刻意的设计决定：

1. **位置在分享之后、方法说明之前。** 放最上面会让用户以为"不生成 AI 就没有报告"。
   固定报告到此已经完整，AI 只是多一段视角。
2. **解析宽容、逐项上报，而不是像固定报告那样整份拒绝。** 固定报告是服务端同代码生成的，
   形状错了就是 bug；AI 输出是模型生成的，前端还可能遇到旧 schema。整块吞掉比少显示一段更糟
   —— 用户会以为"分析没生成"。所以逐项检查，把丢掉的部分明确列在 `data-ai-result-problems` 里。
3. **"成功但读不出来"必须能落地。** `SUCCEEDED` 但 `result` 解析失败时，
   页面要显示"读不出来 + 原因"，而不是停在转圈（这一条在单测里被抓住过一次：
   最初把 `result !== null` 也当成 `succeeded` 的条件，用例直接变红）。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run`（全量，末次） | **22 文件 / 741 条通过**（本轮新增 21 条：`aiAnalysisPanel.spec.ts` 8 条 + `v3Ai.spec.ts` 13 条） |
| `npx.cmd vue-tsc --noEmit` | exit 0 |
| `npm.cmd run build` | exit 0；`dist/assets/index-*.css 42.46 kB` / `js 437.45 kB` |
| `python scripts/browser-verify-ai-analysis.py`（**新增**） | **PASS 31 / FAIL 0 / SKIP 0** |
| `python scripts/browser-verify-jung-flow.py` | PASS 34 / FAIL 0（复跑；首跑因脚本抖动停在 16/48，见 A10） |
| `python scripts/browser-verify-jung-flow.py` × 6（A10 修复后连跑） | 6/6 PASS 34 / FAIL 0 |
| `python scripts/browser-verify-optimization.py` | PASS 12 / FAIL 0 / SKIP 0（A11 修复后；此前那条 SKIP 是探针自己的缺陷） |
| `python scripts/browser-verify-narrow-layout.py` | PASS 40 / FAIL 0 |

真实浏览器验收（`docs/optimization/verification/2026-09-17-ai/`）跑在**一次性 H2 后端 + AI mock 适配器**上
（`TYPEME_AI_ENABLED=true TYPEME_AI_MOCK_MODE=true`，key 是明显的占位串，**不联网、不用真实凭据**）。
覆盖到的用户可见行为：

- AI 开着 → 有「生成一段 AI 分析」入口与剩余次数；**没开 → 不显示注定 503 的按钮**，并说明基础报告不受影响；
- 点生成 → **先展开范围确认区**（如实列出"会发送/不会发送"，含"不发送用户名昵称""不发送完整题库与完整答卷"）；
- **未勾选确认不能提交**（不会替用户同意外发）；
- 生成 → 等待 → 结果：有整体印象、分节正文、可试做法、自省问题；**显著标注 mock 为"演示数据"**；
- 刷新页面后已有分析仍在（`GET /reports/{id}/analyses` 生效）；
- 结果区块里**不出现** `jobId` / `promptVersion` 一类内部字段；
- 320 / 1440 宽报告页无横向溢出。

### 为什么轮询要能被干净地停掉

轮询放在 store 而不是组件里，`generation` 计数器保证旧 timer 的回调不会写进新状态。
面板卸载即 `stopPolling()`（用例专门断言 `clearInterval` 被调用），
从历史报告返回时 `loadJobs()` 重新接上 —— 既不在用户离开后空转发请求，
也不会"回来时任务早好了却永远看不到"。契约 §6 原来写的"2s→3s→5s 退避"与实际实现不符，
已按实现改写（任务通常十几秒到一分钟，退避只会让结果被更晚看到）。

### 遗留 / 下一步

- **AI 管理员后台配置页不做**（用户给定范围）：后端 `typeme_ai_setting` 与读取路径都在，
  目前只能靠环境变量配置，改 model/key 要重启。已记入 backlog 待用户决定。
- 真实 DeepSeek 调用**本轮未执行**：需要真实 key 与外部发送授权，属另一类授权范围。
  mock 路径与失败/重试路径已覆盖，真实调用相关的超时、`Retry-After` 行为仍未在本机验证。
- `scripts/browser-verify-jung-flow.py` 的作答循环有脚本级抖动（A10）：修成"显式等「下一题」恢复可用"后连跑 6 次全绿，已闭环。
- `scripts/browser-verify-optimization.py` 的"后端就绪"探测**三个缺陷叠加、恒为否**（A11），
  即使后端健康也报 SKIP。已修：落到站点后再探匿名接口 `/api/v1/meta` 并解析完整响应体；
  现在后端就绪时是 PASS 并记录 `contentVersion`。**这条值得单独记一笔**：
  "总是 SKIP"看起来无害，其实让一个坏掉的后端和一排绿色 PASS 长得一样。
- 仍待办：报告对比视图（`GET /reports/compare`，前端无 `CompareView`/路由）。

## 第 8 轮：复测比较页（A12）（2026-09-17）

### 问题与证据（含一处对历史结论的纠正）

后端 `JungController.compare`（`GET /reports/compare?ids=a,b`）与
`ReportService.compare` 早已实现：同一内容包版本才算各维变化，不同版本只并列。

前端的情况**与 backlog 原有表述不符**：`frontend/src/api/v3Assessment.ts` 里
`compareReports()` 与 `CompareResult` 类型**都已经写好**，但全仓零消费者
（全文搜 `compareReports` 只命中定义处），`router/index.ts` 也没有 `/reports/compare`。
也就是说缺的不是"接口客户端"，而是**页面与路由** —— 已写好的代码成了死代码。
这条纠正本身值得记下来：把"没有页面"读成"什么都没接"，会让下一轮把已有实现再写一遍。

### 做了什么

- **新增** `frontend/src/views/CompareView.vue`：两个报告下拉 + 对照表 + 说明。
- **改** `router/index.ts`：新增 `report-compare` 路由，并**刻意排在
  `/reports/:reportId` 之前** —— vue-router 按声明顺序匹配，反过来会把 `compare`
  当成一份报告 id 去请求。服务端靠 Spring 的"字面量优先"消歧，两边机制不同，已写进注释。
- **改** `api/v3Assessment.ts`：`compareReports` 从"至少一个"收紧为**恰好两个**
  （契约只定义了两种；比较三份没有语义），并补上路由歧义的说明。
- **改** `ReportV3View.vue`：历史列表在**至少两份**报告时显示比较入口
  （只有一份时不显示 —— 常驻链接对只有一份报告的用户等于"点了才知道没用"）。

### 三条"必须少说"的口径

比较页最容易出的错不是表格渲染，而是**说了不该说的话**，所以：

1. **不出现"成长/进步/退步/准确率/匹配率/相似度"**。`changed` 只表示"这一维方向与上次不同"。
   真实浏览器用例专门断言**对照表本体**里没有这些词。
2. **不同规则版本不算变化**：`samePackage: false` 时把原因写在对照表**上面**，
   而不是让用户从"全部未标记变化"的表格里猜。
3. **强度缺失显示"未记录"**，不用 `0.00` 冒充；并明确"强度不是分数、不是概率、不是匹配度"。

选择放在 URL 查询参数（`a` / `b`）里而不是组件状态：刷新、收藏、转发都能复现同一对比较。
请求带 `generation` 代号，避免先选 A 后改选 B 时 A 的响应后到、把 B 的结果覆盖掉。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run src/views/compareView.spec.ts` | 7 条通过（少于两份 / 自动比较 / 版本不同不算变化 / 强度缺失 / 同一份禁用 / 失败不显示半张表 / 不出现判断词） |
| `python scripts/browser-verify-compare.py`（**新增**） | **PASS 28 / FAIL 0 / SKIP 0** |
| `npx.cmd vue-tsc --noEmit` / `npm.cmd run build` | exit 0 |
| `npx.cmd vitest run`（全量） | 23 文件 / 748 条通过 |
| 收尾回归：`browser-verify-jung-flow.py` / `browser-verify-narrow-layout.py` | PASS 34 / FAIL 0 与 PASS 40 / FAIL 0（加了 compare 路由与列表入口后复跑） |

真实浏览器验收（`docs/optimization/verification/2026-09-17-compare/`）的做法：
注册一个账号 → **把同一份测评走两遍**（每题分别选第 1 档 / 第 5 档，让方向刻意相反）
→ 从历史列表点比较入口 → 选两份 → 比较 → 刷新 → 320/1440 布局。覆盖到：

- 点比较入口确实进 `/reports/compare`，**没有被 `/reports/:reportId` 抢走**；
- 选择写进 URL 查询参数，刷新后仍自动比较同一对；
- 对照表恰好四行，每维都标"方向不同/方向一致"；
- 对照表**不含**判断词；页面明确写"不判断你变好了还是变差了"；
- 选同一份时按钮禁用并说明原因；
- 320 / 1440 无横向溢出，且窄屏下表格容器本身可横向滚动（内容不被裁掉）。

### 遗留 / 下一步

- 比较页目前只比"方向与强度"，没有把两份报告的正文并排（那是另一个量级的工作，未列入本轮）。
- 仍待用户决定：AI 管理员配置页；离线可答。
- 后端 AI 真实调用（非 mock）仍未在本机验证，需要真实 key 与外发授权。

## 第 9 轮：管理后台 · AI 设置页（A13 / A14）（2026-09-17）

### 问题与证据

后端 `/api/v3/admin/**` 四个端点（`GET|PUT /admin/ai-settings`、`GET /admin/users`、
`PUT /admin/users/{id}/role`、`POST /admin/users/{id}/disable`）**早已实现**，
`AdminController` 类级 `@PreAuthorize("hasRole('ADMIN')")`、`AiSettingsService` 的
加密与指纹逻辑都在；但前端**零消费者**：`router/index.ts` 无 `/admin` 路由，
没有任何文件请求 `/admin/ai-settings`。改一次 key 或 model 只能改环境变量再重启，
而且 `apiKey` 换了之后**看不到指纹**，无法确认到底换没换。

用户本轮明确要求："AI 管理员后台配置页要做"。

### 做了什么（前端接入，不动后端语义）

- **新增** `frontend/src/api/v3Admin.ts`：四个端点的类型化客户端。要点：
  - `parseAiSettings` 对 `enabled` / `mockMode` **不兜底**（读不到就报错）——
    这两个开关决定"AI 到底开不开"，猜错的后果是管理员看到一个与配置相反的状态
    并据此做决定；而数字字段有服务端保证的取值，缺一个就让整页变错误页代价更大。
  - `probeAdminAccess()` 把权限判定分成**三态**：`granted` / `denied`(403) /
    `unavailable`(其它失败)。`/me` 刻意不回 `role`，所以"我是不是管理员"
    只能由被保护的那一侧回答。
- **新增** `frontend/src/views/AdminView.vue`：AI 设置表单 + 只读账号概览。四条规矩：
  1. **apiKey 只写不读**：输入框不预填，提交成功后立刻清空；页面文本里不出现任何密钥形态。
  2. **只发改动的字段**：逐字段与服务端回写值比较，没变的不进请求体；
     页面上列出"将提交哪几项"。
  3. **baseUrl 不预填**：读接口只回主机名，改地址必须重新输入完整 URL
     （否则会把主机名写成缺协议的坏值）。
  4. **权限三态不混**：403 说"只对管理员开放，这不是加载失败"；
     网络失败说"没问到，请不要据此去改权限配置"。
- **新增** `frontend/src/composables/useAdminProbe.ts`：合并飞行中的权限探测并缓存结果，
  `AccountView` 据此**只对管理员显示**入口（探测失败不显示入口，也不说"你没权限"）。
- **改** `frontend/src/router/index.ts`：新增 `/admin`（`requiresAuth`）。
  入口刻意不进导航：服务端每个请求都重新判权限，隐藏只是为了不让普通用户
  看到一个点进去必然没用的链接。
- **改** `frontend/src/api/v3.ts`：新增 `isForbidden()`，与 `isSessionExpired()` 并列 ——
  "没登录"与"登录但没权限"必须分开处理。
- **新增** `frontend/src/views/adminView.spec.ts`（13 条）与
  `scripts/browser-verify-admin.py`（分两段跑，31 项）。

### 本轮由测试撞出来的真实缺陷（A14）

`AdminView` 第一版里 `readPositive(raw: string)` 直接 `raw.trim()`。
`type="number"` 的输入框在**真实浏览器与 jsdom 里**都会把 `v-model` 的值算成
**number**，于是"把 maxTokens 改成 2000"这条最普通的路径抛
`raw.trim is not a function`，并被 `catch` 吞成"保存失败"。
`vue-tsc` 看不出来（`form.maxTokens` 声明为 string）。
修法：`readPositive` 参数按运行时事实收 `unknown`，先 `String(raw ?? '')` 再处理。

**这一条正是"要真的验证"的价值所在**：如果只跑 typecheck + build，
这个 bug 会带着"已实现"的标签进入下一轮。

### 没做的部分（明确声明）

后端 `PUT /admin/users/{id}/role` 与 `POST /admin/users/{id}/disable` **没有接前端**。
禁用会撤销对方全部会话、把账号置为不可登录，属于**不可逆操作**，
与注册同意、AI 生成这类"可撤销/可重试"的动作不是一个量级，
因此只做了只读的账号概览，并在页面上写明"不提供这些操作、需要单独确认后再开放入口"。
这已记入 backlog「需用户决定」。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run src/views/adminView.spec.ts` | 13 条通过（权限三态 / 只读密钥 / 只发改动字段 / baseUrl 不预填 / 清除密钥为空串 / 非法值拦住 / 保存失败不假装成功 / 概览无写操作 / null 报告数不显示成 0） |
| `npx.cmd vitest run src/views/accountAdminEntry.spec.ts`（新增） | 3 条通过（200 显示入口 / 403 不显示且不弄坏整页 / 探测失败**不缓存**，重试能拿到入口） |
| `npx.cmd vitest run`（全量） | 25 文件 / 764 条通过 |
| `npx.cmd vue-tsc --noEmit` / `npm.cmd run build` | exit 0（`index-*.css` 42.75 kB、`index-*.js` 470.11 kB） |
| 收尾回归：`browser-verify-jung-flow.py` / `browser-verify-ai-analysis.py` | PASS 34 / FAIL 0 与 PASS 31 / FAIL 0（新增 `/admin` 路由与账号页入口后复跑） |
| `python scripts/browser-verify-admin.py --phase1 --reset` + `--phase2` | **PASS 31 / FAIL 0 / SKIP 0** |

真实浏览器验收（`docs/optimization/verification/2026-09-17-admin/`）的做法：
**分两段**，因为管理员是**启动期引导**出来的（`typeme.admin.bootstrap-username`
只在"系统里一个 ADMIN 都没有"时把指定账号提升）：

1. 第一段：注册一个普通账号 → 账号页**没有**管理后台入口 → 直接打开 `/admin`
   得到「只对管理员开放」且明确否认"这是加载失败"，并给出 bootstrap 配置项这条出路。
2. 重启后端（`TYPEME_ADMIN_BOOTSTRAP_USERNAME=<第一段账号>`）→ 第二段：登录后账号页
   出现入口 → 进 `/admin` → 密钥输入框为空 → 未改动时保存禁用 → 改一项数字并保存 →
   **刷新后仍是新值**（证明确实写进了服务端）→ 改回原值 → 非法值与缺协议地址被拦住 →
   账号概览只读 → 320/1440 无横向溢出。

关于验证环境的两点说明（都属于"发现的事实"，不是失败）：

- 引导机制**只提升一次**：本次尝试在同一个库里给第二个账号提升时被正确拒绝，
  脚本因此按设计报 `SKIP` 并说明原因。这不是 bug —— `existsAdmin()` 短路正是
  "一旦有管理员，本机制自动失效"的实现。最终验收是在**清空的一次性 H2 文件库**上
  从零跑通的 31 项。
- 第二段的报告合并了第一段的计数（脚本会读上一段 `result.json`）；
  同一段重跑必须带 `--reset`，否则数字虚高 —— 虚高的通过数比没有数字更糟。

### 遗留 / 下一步

- **改角色 / 禁用账号**的前端入口：待用户决定（见 backlog）。
- **真实 AI 调用**（非 mock）仍未验证，需要真实 key 与外发授权。
- 后台 AI 设置页**没有**做"测试连通性"按钮：那会真的调用上游，属于外部发送，
  需要单独授权；页面上也没有任何暗示"已经验证过 key 有效"的文案。

## 第 10 轮：打通"管理员配置的 key 真正被用出去"（A15 / A16 / A17，含首次真实调用）（2026-09-17）

### 问题与证据（起点是一个用户问题，不是一条清单）

用户问的是"真实 ai key 我该如何给你"。回答这个问题时必须先核实**项目到底从哪里取 key**，
于是读到了两个模块各自的取值链路：

| 使用方 | 取值优先级 | 代码位置 |
|---|---|---|
| 后台设置页读写 | **DB 优先** → 环境变量回退 | `AiSettingsService.effectiveSettings()` |
| AI 实际调用 | **DB 优先** → `DEEPSEEK_API_KEY` → `TYPEME_AI_API_KEY` | `AiRuntimeSettingsProvider` |

两条链路都写着"DB 优先"，看起来是通的。**实际上不通**：

- 写入侧 `AiSettingsService` 用 `TextEncryptor`（`Encryptors.delux`，密钥与盐由
  `PasswordEncoderConfig.settingsTextEncryptor()` 从 `typeme.security.settings-secret` 派生）
  加密后写 `typeme_ai_setting.api_key_encrypted`；
- 读取侧 `AiRuntimeSettingsProvider` 解密只能靠注入 `com.typeme.ai.port.SecretCipher`
  —— 而这个 port **全仓只有接口，没有任何实现类**（`grep -r SecretCipher backend/src`
  只命中接口定义与注入点），也没有任何测试覆盖它。

`SecretCipher` 自己的注释写着"账号模块……会提供一个实现本签名的 Spring bean"，
`AiRuntimeSettingsProvider` 也按"拿不到实现不算致命"处理（回退环境变量 + 一条 WARN）。
于是**缺一个 bean 不会让任何测试变红**，只会让"后台填 key"这条产品路径静默失效。

先写复现，再动代码。`AdminAiKeyReachesAiModuleIT` 走**真实写入路径 + 真实读取路径**
（`AiSettingsService.update()` → `AiRuntimeSettingsProvider.settings()`），断言的是用户可见结果
（"AI 模块说得出我能用这个 key，来源是 db"），不是"某个 bean 存在"：

| 阶段 | 结果 |
|---|---|
| 修复前 | `Tests run: 3, Failures: 2` —— `SecretCipher` 为 null；保存后 `hasApiKey()` 为 false |
| 修复后 | `Tests run: 4, Failures: 0` |

同一个 investigate 里还撞出第二个问题（A16）：`AiRuntimeSettingsProvider.invalidate()`
**存在但无人调用**，而生效设置带 `CACHE_TTL = 10s`。表现是：把「演示模式」关掉并保存、
立刻点生成分析，它仍按 mock 配置跑 —— **不报错**，只给出一份"看起来正常但依据上一版配置"的结果。

### 做了什么

1. `backend/src/main/java/com/typeme/security/SecretCipherConfig.java`（新增）：
   把 `TextEncryptor` 接成 `SecretCipher`。放在 `security` 包而不是 `ai` 包，因为算法与密钥都属于
   安全模块；AI 模块刻意只依赖 port，依赖方向不反过来。解不开时**返回 null 而不抛异常**：
   密钥轮换后旧密文解不开是预期情形，让它把整个 AI 模块打成 500 才是真故障。
   日志只记实现标识与异常类型，绝不记密文或明文。
2. `backend/src/main/java/com/typeme/account/service/AiSettingsCacheInvalidator.java`（新增 port）：
   接口定义在**写入方**这一侧，AI 模块实现它。若在 account 模块里直接注入
   `AiRuntimeSettingsProvider`，就会形成 account → ai → account 的环（AI 模块已经依赖 account）。
3. `AiSettingsService.update()` 保存成功后通知失效；`AiRuntimeSettingsProvider`
   实现该接口。缓存窗口从"最多 10 秒才生效"变成"保存即生效"。
4. `scripts/browser-verify-ai-analysis.py` 修两处（A17）：`finally` 分支写死
   `report(None, username, True, True)` 导致产物 `aiMock` 恒为 `true`（与观察记录里的
   `mock=False` 自相矛盾）；以及"必须出现「演示数据」标注"这条断言在真实模式下必然 FAIL。
   现在两者都按 `/ai/status` 的实测值分流。**该脚本因此可用于真实验收，而不是只能验 mock。**

### 为什么这两条必须一起修

A15 让 key 到不了调用侧；A16 让你**改完也看不出没生效**。只修 A15 的话，
"保存 → 立刻生成"这条最常见的操作路径仍然可能用上一版配置跑一次，
而这一轮正是要证明真实链路可用——留着这个窗口，第一次真实调用就可能打在旧的配置上，
把结论搞脏。

### 真实调用验收（用户明确授权后执行）

用户授权范围："预检 + 一次真实分析"。实际执行情况：

- **预检未完成**：`GET /models` 的诊断需要自己读库取 key，而 H2 文件库被运行中的应用独占
  （`Database may be already open`），放手让应用停止后再连又报 `Wrong user name or password`
  （我的测试进程与应用的凭证来源不一致）。这是**我方工具链的限制，不是产品缺陷**，
  所以没有继续在这上面耗时间 —— 应用自己已经证明了"密钥可解"（见下），
  而模型名是否有效用真实分析一样能证伪。
- **真实分析完成**：`scripts/browser-verify-ai-analysis.py` 以 `mock=false` 实跑，
  **PASS 30 / FAIL 0 / SKIP 0**，等待 12s 拿到真实模型输出，结构化断言（整体印象/分节/
  具体做法/可以问问自己/结尾定位说明/不显示内部字段）全部成立。

服务端日志（**修复后才会出现的取值**）：

```
AiRuntimeSettingsProvider : AI 设置已加载：enabled=true, model=deepseek-flash,
                            apiKeySource=db, mockMode=false, baseUrl=https://api.deepseek.com
```

`apiKeySource=db` 就是"AI 模块解开了管理员在后台保存的密文"的直接证据；
修复前该位置是 `env`/`none`。真实调用同时也证明了默认模型名 `deepseek-flash` 在
当前账号下有效（若无效，上游会返回错误、任务会进入 `[data-ai-failed]`）。

产物：`docs/optimization/verification/2026-09-17-ai-real/`（REPORT.md、result.json、4 张截图）。
其中 `result.json` 的 `aiMock` 字段在本次运行后被**手工更正**为 `false`
（原值 `true` 是 A17 那个脚本缺陷留下的），REPORT.md 里写明了更正原因。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `mvn.cmd test -Dtest=AdminAiKeyReachesAiModuleIT`（修复前） | **FAIL**：`Tests run: 3, Failures: 2` |
| 同上（修复后） | `Tests run: 4, Failures: 0` |
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'` | **248 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS（第 9 轮基线 244，+4 为本轮新增） |
| `python scripts/browser-verify-ai-analysis.py`（mock=false，真实调用） | **PASS 30 / FAIL 0 / SKIP 0** |

### 本轮没有做的事（明确声明）

- **没有**在后台设置页加"测试连通性"按钮：那会真的调用上游，属于外部发送，需要单独授权。
- **没有**把预检做成产品能力：它需要服务端持有明文 key 去调上游，是运维动作，不是用户功能。
- **没有**改动任何计分、报告或 AI 提示词语义：本轮改的全是"配置怎么送到调用侧"。
- 预检（`GET /models`）**未完成**，因此"该 key 还能列出哪些模型"这一信息本次没有取得。

### 遗留 / 下一步

- 真实调用的**失败分支**仍未验证：超时、`Retry-After`、输出截断、`CONTENT_VIOLATION`
  这些需要构造上游异常，当前只能靠 mock 适配器覆盖。
- 后台 AI 设置页仍无连通性自检按钮（需授权）。
- 改角色 / 禁用账号的前端入口、可审计台账、离线可答仍待用户决定（见 backlog）。

## 第 11 轮：AI 失败时对用户说的那句话（A18 / A19）（2026-09-17）

### 起点：把第 9 轮的教训横向用一次

第 10 轮发现 A15 时总结过一句："交付了后台设置页并验证了它'能存能显示'，
但**从没验证过存进去的东西有人读**"。本轮就按这个思路做横向排查，先问三个问题：

1. 还有没有"定义了但没人发/没人读"的东西？→ 查全部 `ObjectProvider` 注入点，
   全仓只有两个（`SecretCipher`、`AiSettingsCacheInvalidator`），A15/A16 已是全部。
   同时确认 `AiException.rateLimited`、`ApiErrorCodes.NOT_CONFIGURED` 等都确实被使用。
2. `application.yml` 里 `TYPEME_DB_PASSWORD:123456` 这类默认值算不算违规？→ **不算**，
   它是本地开发默认值而非真实凭据，且 `application-prod.yml` 用 `${TYPEME_DB_PASSWORD}` 强制外部注入。
   记下但不动。
3. 失败时会不会对用户说假话？→ **这里有真问题。**

### 问题与证据

后端 `DeepSeekException.Codes` 声明了 **12 个会写进 `ai_analysis_job.error_code` 的码**，
前端 `aiFailureHint()` 的 `switch` 只 `case` 了 8 个，其余落到 `default`：

```
后端有、前端只落到 default 的：UPSTREAM_401 / UPSTREAM_402 / UPSTREAM_429 /
                              UPSTREAM_5XX / UPSTREAM_UNAVAILABLE
```

（`NOT_CONFIGURED` / `BUDGET_EXCEEDED` / `RATE_LIMITED` 不走任务字段，走创建接口响应体，
前端在 `if (error)` 分支里处理，这一条已在同一次核对中确认对接正确。）

两侧**都"有测试"**，所以都不会红：

- 后端用例只断言"库里存了这个错误码"（例如 `AnalysisFlowTest` 断言超时后 `error_code=TIMEOUT`）；
- 前端 `default` 分支也会"成功地"给出一句话，未知码用例甚至专门断言"不显示原始码"。

**用户实际看到的是**：管理员把 key 写错、key 被平台禁用（401），或者账号余额耗尽（402）时，
报告页显示 **"这次生成没有成功。可以重试一次；反复失败时先放下，基础报告不受影响。"**
这句话在这里是**有害建议**：重试一万次也不会成功，用户会一直点重试，
而真正能修的人（站点管理员）永远收不到"是我的 key 出问题了"这个信号。

### 做了什么

1. `frontend/src/api/v3Ai.ts`：补齐 6 个分支。关键是把 401/402 与其余码**分开说**：

   | 错误码 | 用户看到的话 | 该做什么 |
   |---|---|---|
   | `UPSTREAM_401` | 服务器上的 AI 密钥无效或已过期……**需要站点管理员处理，你自己重试没有用** | 管理员换 key |
   | `UPSTREAM_402` | AI 服务的余额不足……**需要站点管理员处理** | 管理员充值 |
   | `UPSTREAM_429` | 模型服务那边正在限流，稍等一会儿再重试 | 等 |
   | `UPSTREAM_5XX` | 模型服务那边出了临时故障，稍后重试 | 重试 |
   | `UPSTREAM_UNAVAILABLE` | 连不上模型服务（可能是网络问题），可以稍后重试 | 重试 |
   | `UPSTREAM_ERROR` | 模型服务拒绝了这次请求，稍后重试 | 重试 |

2. `backend/src/test/java/com/typeme/contract/AiErrorCodeContractTest.java`（新增）：
   直接读 `frontend/src/api/v3Ai.ts`，正则抽出所有 `case 'X':`，断言后端 12 个任务失败码
   **每一个都在其中**。Java 与 TypeScript 没有共享常量的地方，另外两条路都不如它：
   在 Java 里抄一份前端清单（抄完就没人记得同步，只是把漂移挪了个位置）、
   或者干脆不做守卫（下次新增码原样重演）。
3. `frontend/src/api/v3Ai.spec.ts`：+3 条（401/402 不劝重试；429/5xx/连不上可重试且文案里
   不出现错误码本身与任何连续 4 位以上英文；三个已知码的文案互不相同）。

### 一条守卫必须先证明它会红

新写的契约测试第一次跑就是绿的。**一条永远绿的守卫等于没有守卫**，所以删掉前端
`UPSTREAM_401` 分支又跑了一次：

```
Tests run: 3, Failures: 1, Errors: 0, Skipped: 0
Expecting empty but was: ["UPSTREAM_401"]
```

确认抓得住之后才恢复。守卫本身还带了一条 `fixturePathsExist`，专门防"路径写错导致
两个断言读到空集合而静默通过"——读不懂的时候必须报警，不能当成通过。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `mvn.cmd test -Dtest=AiErrorCodeContractTest`（删掉 401 分支后） | **FAIL**：`Expecting empty but was: ["UPSTREAM_401"]` |
| 同上（恢复后） | `Tests run: 3, Failures: 0` |
| `npx.cmd vitest run src/api/v3Ai.spec.ts` | 16 条通过（原 13 + 3） |
| `npx.cmd vitest run`（全量） | **25 文件 / 767 条通过** |
| `npx.cmd vue-tsc --noEmit` | exit 0 |
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'` | **251 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS |

### 本轮没有做的事（明确声明）

- **没有**真的触发一次上游失败去浏览器里验证这段新文案。可用的两种做法都越界或代价不明：
  把 `base_url` 改成不可达地址会**写入后台配置**（我还没有这个授权），
  用 mock 的 `MockFailureMode` 则要重启另外一套 mock 环境、而"mock 触发的 401"并不是真实场景。
  因此这一轮的证据是**契约测试 + 单元测试**级别，不含真实浏览器验证 —— 不应被上面那张表掩盖。
- **没有**把上游 `Retry-After` 透出到任务响应：后端只在 worker 内部用它算自动重试退避，
  没有存进任务行，前端也就无从显示"还有多少秒"。前端文案因此只能说"稍等一会儿"。
- **没有**新增任何后端字段或迁移。

### 遗留 / 下一步

### 遗留 / 下一步

- 上游真实失败（不可达地址 / 401）的**浏览器级**文案验证仍未做，需要用户授权改后台 `base_url`
  或单独起一套 mock 环境。
- 真实调用的失败分支（超时、`Retry-After`、截断、`CONTENT_VIOLATION`）仍只有 mock 覆盖。
- 改角色 / 禁用账号的前端入口、可审计台账、离线可答仍待用户决定。

## 第 12 轮：跨设备冲突到底丢了什么（A20 / A21）（2026-09-17）

### 问题与证据

第 11 轮查的是"AI 失败时对用户说的话"，本轮查**后果更重**的一类：数据。

顺着 `expectedRevision` 查了整条冲突链路，两侧都在、也都有测试：

- 后端 `AttemptService` 用 `revision` 乐观锁，不匹配回 `409 CONFLICT_REVISION` + `details.currentRevision`；
- 前端 store 收 409 后**停止写入**（`flush()` 开头 `if (this.conflict) return`），页面显示冲突横幅，
  并提供「载入最新进度」。

这部分是对的，而且是刻意设计过的（store 注释写明"静默重试等于把对方的答案覆盖掉，
是本模块最不可接受的失败模式"）。但横幅说的话只有一句：

> 本机刚才的改动没有写上去；载入最新进度后，以另一台设备的版本为准。

**丢的是哪一题、用户当时选了什么，一个字都没有。** 而这条信息本来就在手边：

```ts
// ConflictState
/** 还没能写上去的题号（重新载入后可以对照查看）。 */
pendingQuestionIds: string[]
```

`grep pendingQuestionIds frontend/src` 的结果是——**只有定义处与赋值处，没有一处读取**。
注释里的"（重新载入后可以对照查看）"是**意图**，这条路径从未被实现。

后果不是"静默丢失"（横幅确实说了），而是**"不可核对地丢失"**：用户点一下
「载入最新进度」，`reload()` → `applyDetail()` 会整体替换 `this.answers`（`assessmentV3.ts:297`
`this.answers = answers`），那条未写上去的作答就此消失。用户既不能在载入前核对，
也无法在载入后知道该把那题补回来。

### 做了什么

1. `assessmentV3.ts` 新增 `ConflictState.lostAnswers: LostAnswer[]`，在 409 分支里记下
   **题号与作答内容**（`rating` 为 `null` 表示「这题我说不好」），不只是题号。
2. 新增 getter `lostAnswerLabels(state)`：把每条转成"第 N 题 · 档位文案"。
   题号用**该题在本次测评里的序号**（与页面显示一致），内部 id 一律不进界面；
   内容包缺失时退回题号本身 —— 宁可少说，不要编。
3. 横幅（`AssessView.vue`）逐条列出，并把收尾那句改成"上面这些本机改动没有写上去……
   **被覆盖的题需要重新作答一遍**"，让用户知道载入之后要做什么。
4. `SCALE_CAPTIONS` 提到 store 作为**唯一来源**（A21）：横幅与题卡必须说同一套档位文案，
   否则同一代产品内部又会出现第二份说法 —— 历史上 `ANSWER_CAPTIONS` 与 `SCALE_CAPTIONS`
   分叉的教训已经吃过一次。

### 真实验证：这条链路从来没在浏览器里走过

冲突路径此前**只有 jsdom 单测**（`assessView.spec.ts`），真实浏览器里没有任何脚本制造过 409。
新增 `scripts/browser-verify-conflict.py`：用**两个独立浏览器上下文**（各自一份 cookie，
等价于两台设备）打开同一份草稿 ——

1. 设备 A 注册并答两题（revision=4）；
2. 设备 B 用同一账号登录、打开同一 attempt，读到的也是 revision=4（顺带验证了跨设备续答）；
3. 设备 B 改一题 → revision=5，**设备 A 手里的 expectedRevision 就此过期**；
4. 设备 A 在真实 UI 上点档位 → 必须 409 → 断言横幅逐条列出被丢弃的作答；
5. 点「载入最新进度」→ 冲突解除，且新作答不再冲突（用的是刚读到的最新 revision）；
6. 320 窄屏下横幅不横向溢出。

冲突是**真实制造**的（另一台设备真的改了数据），不是在 console 里伪造请求 ——
否则验的就只是"我构造的那个请求会 409"，而不是产品路径。

### 两处自查出来的脚本缺陷

- 第一版里有一行 `check(True, "已确认横幅处于冲突态")` —— 一个**永远通过**的断言。
  它是我写脚本时留下的占位，正是本轮在批评的那类"绿色噪音"，已删。
- 有一行参数写反了：`check("第" in first, "列出的是题号，不是内部 id")` 把条件与说明文字
  互换，跑出 `PASS True` 这种没有信息量的行。已修正为两条独立断言（是题号 / 界面无英文 id）。

### 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npx.cmd vitest run src/views/assessView.spec.ts` | 20 条通过（+2：逐条列出被丢弃作答；「这题我说不好」也如实列出） |
| 同上（**故意把档位文案写死成固定值后**） | **2 条 FAIL**：`expected '· 第 1 题 · 两边差不多' to contain '很像右边'` / `… to contain '这题我说不好'` |
| `python scripts/browser-verify-conflict.py` | **PASS 22 / FAIL 0 / SKIP 0**（真实双上下文制造 409） |
| 回归 `python scripts/browser-verify-jung-flow.py` | PASS 34 / FAIL 0（答题页被改过，必须复跑） |
| `npx.cmd vitest run`（全量） | 25 文件 / **769 条通过** |
| `npx.cmd vue-tsc --noEmit` / `npm.cmd run build` | exit 0（`index-*.css` 42.75 kB、`index-*.js` 471.12 kB） |
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'` | 251 通过 / 0 失败 / 1 跳过，BUILD SUCCESS |

真实浏览器里横幅的实际内容（脚本摘录，脱敏）：

```
[data-lost-answer] → '· 第 3 题 · 更像右边'
```

### 本轮没有做的事（明确声明）

- **没有**做"冲突自动合并"。两端各自改了不同题目时理论上可以合并，但那要求服务端能
  逐条比对并解决同题冲突，属于产品语义变更（且契约目前明确要求"以另一台设备为准"），
  不在"优化"范围内。
- **没有**把丢失的作答做成可导出/可复制。横幅让用户**看得见**，但真要完全无损失，
  需要一个"把我的改动先存到本地再载入"的机制 —— 那需要新的存储与 UI，属于功能新增。
- **没有**改服务端的冲突判定或 `revision` 语义。

### 遗留 / 下一步

- 上面两条（自动合并 / 本地暂存）若要，属于功能新增，需用户确认。
- 改角色 / 禁用账号的前端入口、可审计台账、离线可答仍待用户决定；真实上游失败的浏览器级验证仍待授权。

## 第 13 轮：两项技术选型的核实（Redis / LangChain4j）＋ 会话表清理（A22 / A23 / A24）（2026-09-17）

本轮用户问了两个"要不要引入外部组件"的问题。**这类问题不该靠印象回答**，所以两轮都先把
现状核清楚再下结论。本轮**没有改动任何产品代码**，产出是三个 backlog 条目与这份评估。

### 用户的两个问题与我的结论

| 问题 | 结论 |
|---|---|
| 是否可以用 Redis 记"上下文" | **本版没有落点，不引入**；用户随后明确选择"作为后续架构项保留" → A23 |
| 是否可以引入 LangChain4j | **不建议**（同一条硬边界；且会削弱现有能力）→ A24 |

### 核实到的关键事实（不是印象）

**Redis：**

- `backend/pom.xml:55-59` 写着"不引入 Spring Session（会话仍走容器 HttpSession，
  绝对期限由 `app_user_session` 表 + `SessionAbsoluteTtlFilter` 落实）"；
- `grep -r Redis backend/src/main` → **零命中**，依赖与配置都不存在；
- `docs/2026-09-16/implementation/README.md` §6.3 专门否决过，理由原文是
  "引入 Redis 会多出一个可能与 MySQL 不一致的状态源……多一个状态源就多一类'两边对不上'的可能；
- 开发提示词第 40 行把它写成硬边界。

这个否决在**本次任务里被两次验证为正确**：第 10 轮的 A15（后台写的密文 AI 模块读不出）
与 A16（保存后 10 秒内仍按旧配置跑），恰好都是"两个状态源对不上"的实例，而且两次都是
**静默降级、两侧测试全绿**。再加一个 Redis 就是把这个失败模式再复制一份。

**LangChain4j：**

- `HttpDeepSeekClient`（约 200 行）不是"随便发个 HTTP"，它承载了这个领域的语义：
  `thinking.type=disabled`（省 token）、`response_format=json_object`、
  **不跟随重定向**（`HttpClient.Redirect.NEVER`，避免把 `Authorization` 带去非预期主机）、
  401/402/429/5xx 各自映射成不同的 `errorCode`、`Retry-After` 同时支持秒数与 HTTP-date；
- 最关键的一条：它把 **`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 分开读**
  （`HttpDeepSeekClient:184-187`），而这两个值正是 `AiCostEstimator:42-44` 的计价输入。
- LangChain4j 的 `TokenUsage` 在部分 provider 上缺缓存 token 字段
  （[issue #4067](https://github.com/langchain4j/langchain4j/issues/4067)、
  [PR #4080](https://github.com/langchain4j/langchain4j/pull/4080) 正在补 Bedrock，
  说明这个能力不是所有实现都有）。换过去可能**丢**这个能力，而费用估算会静默变成 0 或偏低。
- 框架真正省的是"多模型适配 + tools/RAG/memory"：本项目不用 tools、知识来自固定内容包、
  记忆不需要 —— **省的是用不上的那部分**。

### 同一轮里发现的真问题：会话表没有过期清理（A22）

查会话链路时确认：`app_user_session` 的删行只发生在注销、禁用、改密码，
以及"已过期会话**再访问一次**"时（`SessionAbsoluteTtlFilter:88-93` 把删除当副作用）。
容器侧闲置超时（2h）不碰这张表，全仓也没有清理型 `@Scheduled`
（只有 `AnalysisWorker` 与 `AccountDeletionService` 两个）。
所以"注册一次就不再回来"的账号，其会话行会永久残留。

用户选择"收进 backlog 并先不动"。这个决定是合理的：当前量级下影响可忽略，
而清理策略（定期任务 / 惰性删除 / 让容器 `HttpSession` 监听器负责）各有取舍，
值得单独决策，不该塞在选型讨论里顺手做掉。

### 本轮没有做的事（明确声明）

- **没有**改任何代码（Redis 与 LangChain4j 都只是评估）。
- **没有**写 PoC。LangChain4j 若要推进，建议的验收口径写在 A24 里，但那是下一步的事。
- **没有**修 A22：按用户选择只记录。

### 验证

本轮无代码改动，因此没有需要重跑的测试；后端与前端基线沿用第 12 轮结果
（后端 251 / 0 / 1，前端 25 文件 769 条）。

## 第 14 轮：发给 AI 的每条证据都在撒谎（A25 / A26）（2026-09-17）

### 起点：用户同意"按我的建议走" —— 让 AI 的输入更完整

第 13 轮末尾我提出的方向是"动 `ReportInputBuilder` 里**包含什么**"，而不是引入任何新组件。
本轮先做的事是**核实我自己的提议对不对** —— 结果发现我把重点猜错了。

核实过程（都是读代码，不是猜）：

- `processLayer` 的投影**已经很完整**（preferred/unpreferred/hardestSteps/opposites/
  boundaryNotes/basis/frameworkCaveat），我第 13 轮说"补过程层描述"这个提议**没有价值**；
- 契约 03 第 136 行**明确规定** AI 只收 5 个维度字段（`dimension/computedPole/mFinal/boundary/nFinal`），
  报告里那 20 个字段只发 4 个是**契约要求，不是缺陷** —— 我差点把它当成 bug 去"修"；
- 于是缺口只能在证据侧。顺着提示词第 3 条（"倾向较轻的维度要给出**另一侧也值得一起看**的具体读法"）
  去查证据选取，看到 `strongestOpposite` 第 571 行显式跳过 `c == 0`，而 `position()`
  早就写好了 `选了中间（两边差不多）` 的文案 —— 却没人选得中它。

### 真正的缺陷（A25）：不是"漏了一种证据"，是"所有证据都是假的"

顺着 `c` 查下去才发现根本不是"中间档进不来"这么轻：**每一条证据的位置都是错的**。

`packageQuestions()` 重建题目节点时只放 5 个字段（注释写明"只带最小必要字段"，因为已按维度分组），
而 `contribution(JsonNode question, int rating)` 却从节点上读 `dimension`：

```java
String dimension = text(question.path("dimension"));   // 永远是 null
if (rightPole == null || dimension == null || rating < 1 || rating > 5) {
    return 0;                                          // 静默归零，不报错、不记日志
}
```

**后果有三层，一层比一层重：**

1. 每条证据文本都写成"用户选了中间（两边差不多）"—— rating=5 也这么写。
   模型读到的不是"位置"，而是**伪造的位置**；
2. `bestSameDirection`（只认 `|c| >= 1`）与 `strongestOpposite`（显式跳过 `c == 0`）
   **永远返回 null** —— 边界维度那两条"同向 + 反向"证据从来没被选中过；
3. 补足名额的 `-Math.abs(c)` 排序**全部并列**，稳定排序退化成按 `order` 升序 ——
   也就是说 `evidence` 实际上是**按题号取前 8 条**，与用户答了什么完全无关。

实测对比（同一份夹具，走的是真实链路里的同一个 `describe()`）：

| | 缺陷版 | 修复版 |
|---|---|---|
| 选中的证据 | `EI-01…EI-08`（按题号前 8 条） | `EI-01(c=2 很靠右侧第 2 档)`、`EI-11(c=-1 比较靠左侧第 1 档)`、`EI-05(c=0 真的中间)`、… |
| 模型读到的位置 | **每一条**都是"选了中间（两边差不多）" | 真实方向与档位 |

**它为什么能长期绿着**：既有测试对证据文本**只有一条否定断言**
（`AnalysisFlowTest:574` 断言文本不含完整题干），**没有任何一条检查位置文案是否正确**。
而且这个 bug 的产物"看起来很像对的" —— 一份边界维度的报告里出现"两边差不多"毫不出奇，
所以人工抽查也很难发现。这是本轮最有价值的一条经验。

### 做了什么

1. `contribution` 改为 **显式接收维度**（`contribution(String dimension, String rightPole, int rating)`），
   不再从被裁剪过的节点里读 —— 缺字段即静默算 0 的写法不允许再出现，宁可让调用方显式给出；
   注释里写明了这次踩的坑。
2. 边界/平分维度**补一条"用户自己选了中间档"的作答**（A25 的第二半）：
   提示词第 3 条要的"另一侧也值得一起看"，最硬的依据就是当事人自己选"两边差不多"的那一题。
   只对边界维度补 —— 不设边界的维度补它会挤掉更有信息量的同向/反向证据（有专门测试守着）。
3. 新增 `PromptFileContractTest`（A26）：把"文件第一行 = 文件名 = 加载路径"这条**原本只靠人眼**
   的约定变成机械断言，并验证配置默认版本真的能加载、且发给模型的内容不含版本标记行。
4. **没有**改提示词文本：它没有对 evidence 做穷举描述，第 1、3 条本来就要求讲清"哪些只是略偏"，
   修复补的是**材料**而不是**要求**。改措辞会抬 `promptVersion`、让已有分析的可比性变复杂，
   收益不成立。同样**没有**动 `SCOPE_VERSION`，因此去重哈希与同意范围**未受影响**。

### 验证

| 项 | 结果 |
|---|---|
| 新增 5 条 builder 测试（修复前） | **2 条 FAIL**，实际证据 `[EI:item:EI-01, SN:item:SN-01]` |
| 新增 5 条 builder 测试（修复后） | 16 条全通过 |
| 取证对比（临时还原缺陷后打印真实片段） | 缺陷版 8 条全是"中间档"；修复版 `c=2 / c=-1 / c=0` 各就各位 |
| `PromptFileContractTest` 3 条 | 通过；**已用"把第一行改坏"证明它会红**（`expected: <true> but was: <false>`），随后从 git 还原 |
| 后端子集（清空 `target` 后重跑） | **259 通过 / 0 失败 / 1 跳过**（251 + 5 + 3） |
| **payload 级断言**（`payloadEvidenceCarriesRealPositions`） | 通过 —— 断言的是最终会序列化成 user message 的那份 JSON，17 条 builder 测试全绿 |
| **真实浏览器 + 真实模型调用**（用户授权后复验） | **PASS 30 / FAIL 0 / SKIP 0**，`aiEnabled=True`、`aiMock=False`，证据见 `verification/2026-09-17-ai-real-after-fix/` |
| 诊断代码残留 | 0（全量输出中 `DIAG` 零命中） |
| 提示词文件 | `git diff` 无差异（曾被我引入 BOM，已用 `git checkout` 还原并核验） |

### 过程中的诚实交代

本轮我在**自己的夹具**上连踩三个坑，每个都值得记下来：

1. **夹具漏字段**：我给测试内容包的题目漏了 `dimension`，于是测试里复现了与生产同一个 bug，
   一度让我以为"产品已经做对了"；
2. **循环覆盖**：中间档答案写在 `for (index = 3..10)` 的循环范围内，被随后的 `put` 覆盖，
   造成"中间档只有一条"的假象；
3. **Maven 增量判断不可信**：多处出现 `Nothing to compile - all classes are up to date`，
   而 `target/test-classes` 里的字节码与源码**明显不一致**（常量池里根本没有新夹具）。
   此后凡是"结果与源码不符"，一律**先删 `target/classes` 与 `target/test-classes` 再跑**。
   这也是我最终能把根因定位到 `dimension=[null]` 的前提。

另外：为了证明守卫有效，我用 PowerShell 改过提示词文件，`Set-Content -Encoding UTF8`
给它加了 BOM（`git diff` 显示第 1 行变成 `﻿typeme-ai-prompt-v1`）。
已用 `git checkout` 从仓库原样还原，并确认无 BOM、无差异。**这类"为了验证而临时改真实文件"的操作，
事后必须用 git 而不是编辑器还原。**

### 本轮没有做的事

- **没有**改维度字段集合（那需要升 `SCOPE_VERSION`，用户虽已授权，但本轮范围不含）。
- **没有**改提示词文本与 `promptVersion`（理由见上）。

### 用户授权后的真实复验（本轮最后一步）

用户同意重启后端跑一次真实调用，于是：

1. 停掉仍运行**修复前代码**的旧进程（PID 47476），用同一份一次性 H2 文件库
   （`output/typeme-admin-setup`）与**同一个** `TYPEME_SETTINGS_SECRET` 重启（PID 46544）。
   启动日志确认密钥仍能解开管理员存下的密文：
   `AI 设置已加载：enabled=true, model=deepseek-flash, apiKeySource=db, mockMode=false`；
2. 跑真实浏览器 + 真实模型调用：**PASS 30 / FAIL 0 / SKIP 0**，
   `result.json` 里 `aiEnabled=True / aiMock=False`；
3. 服务端日志干净：除脚本权限探测那一条**预期内**的 `FORBIDDEN 403` 外无 ERROR/WARN。

**这次复验能证明与不能证明的事，必须分开说：**

- 能证明：证据形状改变后，真实模型调用链路**仍然完好**（范围确认 → 生成 → 结果 → 刷新 → 额度 → 窄屏）。
- **不能**证明："AI 输出因此变得更贴合用户" —— 那需要把同一份答卷在修复前后各跑一次真实调用
  做**对照**，而本轮只跑了修复后一次。位置数据的正确性是由
  `payloadEvidenceCarriesRealPositions`（断言最终 payload 里的真实档位）证明的，
  不是由这次端到端跑出来的。

顺带纠正一处我自己的记录错误：第 13 轮笔记里我把这个环境变量写成了
`TYPEME_SECURITY_SETTINGS_SECRET`，实际是 **`TYPEME_SETTINGS_SECRET`**（与配置项同名）。
若按错误变量名重启，管理员保存的密钥会解不开、AI 会静默退回 `apiKeySource=none`。

### 附：用户追问"历史报告也能分析吧"（A27）

用户问了这个问题，我用**代码 + 真实浏览器**两条证据回答，而不是靠印象。

**代码层面：支持，且没有按时间设限。** `AnalysisService.create` 的全部前置条件只有
幂等键合法 / AI 已开启且有 key / 报告属于本人（越权与不存在同形 404）；
报告内容是从库里那份 `report_json` 快照现读的，不要求新鲜度。
AI 面板挂在**报告详情组件**上（`ReportV3View:854`），所以历史列表里任何一份报告点开都有面板。
另外 `SCOPE_VERSION` 从 v1 提到 v2 正是为了让"升级前生成的历史分析"不会因为
`request_hash` 相同而被原样复用 —— 历史报告能拿到按新范围重算的分析。

**但我发现一个真实隐患，并去验证它（A27）。** `AiAnalysisPanel` 只在 `onMounted` 里
`loadJobs(props.reportId)`，**没有** `watch(() => props.reportId)`；父组件用
`v-if="reportId"` 挂载它。按这个组合推论，从 B 报告切到 A 报告时实例会被复用、
`onMounted` 不再触发，面板应当**一直显示上一份报告的分析**，而且 `onBeforeUnmount`
的 `stopPolling` 也不会执行（后台会继续轮询）。

为此新写 `scripts/browser-verify-history-ai.py`：注册新账号 → 做**两次**测评 →
在报告之间切换 → 看面板是否串台。**结果是 PASS 18 / FAIL 0，没有串台**。

**但"没串台"的原因和我假设的不同**，这点必须写清楚：真正的保护来自报告正文外面的
`<template v-else-if="view">` 与加载态 —— 换报告时 `reports.loading` 置位、`view` 被清空，
整块正文（含 AI 面板）被**销毁重建**，`onMounted` 因而会重新执行。
**是加载态顺手救了它，不是那个 `v-if` 挡住了问题。** 这条依赖是隐式的：将来若有人把加载态
改成"保留旧内容 + 局部骨架屏"（很常见的体验优化），面板就会开始串台。
本轮**有意不改**（当前行为正确且已有真实浏览器断言守着），只记进 A27。

**一个方法论教训（差点让我得出错误结论）**：脚本初版只断言
`page.locator("[data-ai-job]").count() == 1`，而**这个断言抓不住串台** ——
"1 个任务"既可能是本报告的，也可能是上一份残留的。我因此给 `AiAnalysisPanel` 补了
`data-ai-job-id`，改成**对比两份报告各自的 jobId**（`老=9a5a7321… 新=ec79aca8…`），
那条才是真正有区分力的断言。**"断言通过"与"断言能抓住目标缺陷"是两件事。**

**一处我自己写错的说明，已更正**：脚本初版文档写着"不消耗额度"，
理由是"只验证能发起、不等模型输出"。这是**错的** —— 后端 `AnalysisWorker` 是**急切执行**的，
任务一旦落库就立刻发起真实请求。所以那两次运行里，
**只有我第二次运行的那 2 个任务真正外发了**（后端日志：`14:07:44 tokens=5124`、
`14:07:54 tokens=5015`；第一次运行的任务因当日额度已被上一次用掉而未被接受，
日志里没有对应记录）。加上你授权的那次真实调用（`13:55:09 tokens=5452`），
本轮共 **3 次真实外发**。脚本与产物里的错误说明都已改掉并留痕。

### 验证（附）

| 项 | 结果 |
|---|---|
| `browser-verify-history-ai.py` | **PASS 18 / FAIL 0 / SKIP 0**（真实后端、`mock=False`） |
| 前端 typecheck（改 `AiAnalysisPanel.vue` 后） | exit 0 |
| 前端单测 | **25 文件 / 769 条通过**（未变） |
| 后端错误 | 日志 `ERROR` 0 处；`api-error` 5 处均为脚本权限探测的预期 403 |

## 第 15 轮：广撒网找 bug —— 导出静默降级、三条死路、保存失败被掩盖（A28 / A29 / A30 / A31 / A36）（2026-09-17）

### 起点：用户要求"整体再多过一过，优化优化bug"

A1–A27 基本清零之后，本轮不再顺着清单走，而是**主动找**。做法是两个并行的只读审查
（答题链路 / 会话与错误链路），把它们报回来的每一条都自己核实一遍再决定改不改 ——
审查结论只是线索，不是证据。

### 核实过程里被否掉的假设（同样重要）

**假设 H1：快速连点会伪造出「另一台设备」冲突。** 我自己提出并写了探针
（`scripts/browser-verify-rapid-answers.py`）。结论是**不成立**：

- Playwright 速度连点：`revision=[0,1]`，两个 PATCH 都 200；
- **同一个 JS 回合**内连点两档：`revision=[2,2]`，仍然都 200；
- 取证到关键一点 —— 第二次点击时页面文案已经是「已保存」，说明**第一次保存已经完成**，
  两个请求是**串行**的，不是并发（本地往返只有十几毫秒）。

代码里的窗口是真的（`flush()` 没有串行化，`expectedRevision` 是同步取值），
但在本地网络下撑不开，我无法确定性复现，**因此没有据此改产品代码**。
同类被我否掉的还有两条：`AttemptService` 用"另查一次 COUNT"代替 UPDATE 受影响行数
（确实比正确做法弱，但无法确定性复现，且触碰乐观锁语义，只记录）；
以及我曾以为串行就能证明它 —— 写了一条串行测试，它**通过了**，反证了我的机制推断是错的。

### 真正改掉的三件事

**A28（高）导出把失败伪装成"你没有这部分数据"。**
`safeQuery` 吞掉一切 `DataAccessException` 返回空数组，响应里没有任何标记；
而账号页在导出成功时说「报告与 AI 分析记录**都在里面**」，同一页的注销区又写着
「注销会删除你的全部测评记录与报告，无法恢复……导出数据是**唯一**能把它们带走的办法」。
于是报告查询一旦失败，用户会拿到一份**看起来完整**的备份，按指引注销，
没导出到的那部分**永久丢失且事后无从发现** —— 这是"失败不能静默吞掉"里后果最不可逆的一种。

- 后端：`DataExportService` 新增 `degradedSections: [{section, reason}]`；
  日志从"只记异常类名"改成段名 + 异常消息；缺表（部署未就绪）与查询失败分开报，
  两者都用**段名**而不是内部表名。
- 前端：`ExportResult` 带上降级段落；非空时**不说"都在里面"**，改说"这不是完整备份，
  先不要注销"，并在注销区重复一次；认不出的段名原样显示，不静默吞掉。

**A29（高）保存失败被下一次成功掩盖 → 作答静默丢失。**
`flush()` 每次只发当前这一条，失败时只把 `saveState` 置成 `'error'`；
下一次保存成功时**无条件**置回 `'saved'`。所以"答 Q10 时超时 → 继续答 Q11 成功"
会显示「已保存」，而 Q10 在服务端从未存在，刷新后回到未作答。
而且 `assessment.lastError` 在整个 `AssessView` 里**从未被渲染**，
唯一那句话还是「未同步（网络或登录已失效）」—— 连真正的原因都丢掉了。

- store 新增 `unconfirmed`（本地改了、服务端还没确认的作答）：
  下一次写入会把它**一并重发**（服务端 upsert，重复发同一条无副作用）；
  只有集合为空时才允许回到 `'saved'`；`load()`/冲突时清空（它们代表"以服务端为准"）。
- 页面新增「未同步（N 题的作答还没写上去）」+ 真实原因 + **重试保存**按钮。

**A30（高）NEEDS_REVIEW 是一页死路。** `finishStage()` 只在本地没有未答题时才调
`runReview()`，所以走进 needs-review 时「未答清单」通常必然是空的，
而 `jumpToFirstUnanswered()` 在那种情况下**静默返回** —— 按钮点了毫无反应，
用户只能刷新页面才出得来。修复：按"用户能做什么"排优先级（真有未答题 → 去那一题；
否则去覆盖不足那一维的第一道主测题），并按情况改文案为「回到题目继续调整」。

**A31（中）进入补充题后无法返回主测。** 契约把「跳过补充题」写成用户可选的动
作，但跳过按钮只在 `clarify-offer` 那一步存在；一旦点了「开始补充题」，
就只能把补充题答完，刷新也会被 `restorePosition()` 重新落回补充阶段。
修复：补充阶段保留「回到主测改答」与「跳过补充题，直接交卷」两个出口。

**顺带（会话失效无回路）：** 答题页在 `App.vue` 里隐藏了常规导航，
会话失效时只有「请先登录」+一个必然失败的「重试」，页面上**没有任何能走通的操作**。
现在识别 `UNAUTHENTICATED`，给出「去登录，然后接着答」（路由守卫本来就支持 `redirect`）。

**A36（中）恢复码重新生成：201 但响应里没有码 → 静默丢掉全部恢复码。**
`readStringList` 把字段缺失读成"正常的空数组"，而服务端在返回 201 之前
**已经 `revokeAllUsable` 并把版本号推高** —— 旧码此刻已经作废。
页面既不报错也不显示空态（密码框还会被清空），用户看不出发生过任何事，
也就不会去抄新码。修复：新增 `readRecoveryCodes(value, required)`，
重新生成时 `required=true`（码为空即抛 `UNEXPECTED_RESPONSE`，文案说清
"旧码可能已作废、请重新生成并当场抄下来"）；注册时 `required=false` ——
账号已经建好，因缺字段把注册判成失败会让用户去重试一个已被占用的用户名，
所以照样进下一步、由页面既有的 `codesMissing` 另行提示。
两处期望**故意相反**，测试把两边都钉住。

### 一个让我自己心里一沉的发现

`assessView.spec.ts` 里**原本就有一条测试**断言 needs-review 卡片含「回到未答的题」，
而那个场景服务端明确报着 `baseUnprocessedCount: 1` —— 也就是说测试数据里
**确实有未作答的题**，但按钮点下去不会有任何反应。这条断言断的是**文案**，
不是**行为**，所以它一直是绿的，而用户点不动这件事它一个字都没说。
这正是"测试要断言用户结果，不要断言实现"的反面教材，也是本轮 A30 的直接证据。

### 验证

- 后端子集：**266 / 0 / 1**（第 14 轮为 260，新增 6 条）
- 前端：**28 文件 / 791 测试**全绿；`vue-tsc --noEmit` exit 0（第 14 轮为 26/775）
- 真浏览器 `browser-verify-jung-flow.py`：**PASS 34 / FAIL 0**（答题页与 store 改动后复跑两次都全绿）
- 真浏览器 `browser-verify-conflict.py`：**PASS 22 / FAIL 0**（store 改动没有破坏 409 冲突语义）
- 真浏览器 `browser-verify-narrow-layout.py`：**PASS 40 / FAIL 0**（新增的提示块与按钮没有撑破窄屏）
- 真浏览器 `browser-verify-export.py`：**PASS 19 / FAIL 0** —— 含"下载到的文件里
  确实带上了 `degradedSections`"，以及"有真实数据时 attempts 段真的带回了那条测评"
- 判别力验证（每条新测试都先证明它会红，再恢复）：
  - 去掉 `DataExportService` 的降级记录 → 后端 3 条里红 1 条
  - 恢复 `jumpToFirstUnanswered` 的早期 return → 前端精确红 1 条
  - 去掉"重发未确认作答" → 前端精确红 2 条（两个关键场景）
  - 去掉恢复码的 `required` 守卫 → 前端精确红 3 条，而注册那条**仍然绿**

### 本轮没有做的事 / 未覆盖

- 没有让服务端**真的**失败一次来做导出的端到端验证：运行中的后端以 `AUTO_SERVER=FALSE`
  独占 H2 文件，外部进程连不上（`Database may be already in use`）。降级分支是
  **两层覆盖**（后端单测 + 前端组件测试）+ 真浏览器证明字段在文件里，端到端那一段缺着。
- 快速连点的竞态**没有**被排除，只是没能在本地条件下复现；要真正排除需要节流到 3G
  或改成真并发调用。
- `AttemptService` 的冲突检测弱点、`ReportService` 写 `clarification_skipped` 的时机、
  `Idempotency-Key` 未兑现、恢复码重新生成缺字段时的静默、注销清理吞异常仍标 DONE、
  导出/删除任务编号缺失 —— 这些审查报了但我**没有动**，全部记进 backlog。

## 第 16 轮：前端视觉重构与 AI 体验（2026-09-18）

> 本轮的目标书是用户给的 `docs/DSH-前端视觉重构与AI体验目标.md`。它**明确授权**重做配色、
> 布局与展示组件 —— 也就是说 AGENTS.md 里"复用现有视觉风格"这一条在本轮让位于它。
> 本文只写实测到的东西；没做到的、没验的、我判断不了的都单列在最后。
> （目标书文件名写的是 2026-09-18，本机实测时间是 2026-09-17 16:4x；证据目录沿用 09-18 这个标签。）

### 做了什么

**设计基座（改一处，页面不用各自记颜色）**

- `frontend/tailwind.config.js` 整体换血：「浅色阅读面 + 深墨文字 + 克制的蓝青强调」。
  纸面 `paper #F4F6F9`/`surface #FFFFFF`；文字 `ink #0D1B2A`、`ink-soft #48586A`、
  `ink-faint #5B6B7F`；主色 `primary-600 #14617A`（偏青的深蓝，不是亮蓝）；
  强调 `accent-500 #8E5A0F`；深色区 `navy-800 #0B1A28`/`navy-900 #081320`；辉光 `glow #5AD7E8`。
  圆角 `control 12 / card 16 / question 22 / cover 28`、阴影 `card/lift/deep/action/ring`、
  容器 `shell-wide 82rem`、字体层级、7 个 `keyframes`（fade-rise、fade-in、sheet-up、
  glow-drift、trace-flow、breathe、shimmer）全部集中在这一处。
- `frontend/src/style.css`：**旧类名一个没删**（`.btn`、`.card`、`.notice-*`、`.chip`…），
  只改取值；新增结构类 `.section-index`、`.deep-panel`/`.deep-grid`/`.deep-card`、`.chip-*`、
  `.btn-on-deep`、`.skeleton(-on-deep)`、`.display-hero`、`.measure`、`.tabular`；
  全局可见 `:focus-visible` 环，深色面板内换成辉光色环（否则深底上看不见焦点）。
- `frontend/src/components/AppIcon.vue`：22 个 24×24 描边 SVG，纯内联 —— 无图标库、无远程字体。
- `frontend/src/design/contrast.spec.ts`：把"哪个前景色配哪个底色、对比度多少"变成 **45 条断言**，
  直接 `import tailwind.config.js`。以后改 token 掉到门槛下，测试会先红。

**逐页重建**

| 页面 | 主要改动 |
| --- | --- |
| 首页 `LandingView` | 首屏改深蓝"四轴/罗盘"视觉并直接用真实量表数据；新增 `#report-preview` 锚点，用四行真实量表条回答"报告长什么样"；AI 说明段；FAQ |
| 答题页 `AssessView` | 左侧状态栏收进一张卡；保存态带图标与文字；题卡加维度/题号 chip 与"更靠近哪一侧"提示；选中态三重标识（边框+填充+勾选图标） |
| 报告页 `ReportV3View` | 概览统一成深色面板（`data-report-overview`，带 `data-status`）；区块 01–10 编号；新增目录侧栏（`data-toc`，滚动 + 焦点转移，hash 路由下**不产生假路由**）；维度条换成 `DimensionMeter`；候选/动作/动力学/过程层重排 |
| 历史 / 对比 / 账号 / 认证 | 子代理按"仅布局"授权对齐：表单收进 `.card`、恢复码由 8 个方块改一张卡、成功提示 `notice-info`→`notice-success`、对比页表格收进卡内、后台页深色页头。业务语义、校验、`data-*`、文案逐字未动 |
| AI 洞察区 `AiAnalysisPanel` | 整体重写：深蓝面板 + 白色"洞察纸"。生成前给**结构预览**（你将得到哪五样）；生成前必须展开范围确认并勾选；进行中只有呼吸点与骨架，**没有百分比也没有假阶段**；失败态单独设计；结果按 摘要→分节→做法→自问→边界 排序；历史列表每行都是整行按钮 |

**顺手修掉的真实缺陷**：渲染结果里出现 markdown 星号（`**并列**` 这种）——
`CompareView` 1 处、`AdminView` 3 处、`ScoringFacts` 1 处（AI 面板与首页各 1 处本轮早些已修）。
这类问题**不会让任何测试变红**（它只是普通文本），所以验收脚本里加了一条在真实渲染结果上扫 `**` 的判据。

### 验证

| 命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | exit 0，零错误 |
| `npm.cmd test` | **28 文件 / 817 条全绿**，exit 0 |
| `npm.cmd run build` | exit 0；`index.html 1.11 kB`、`css 55.68 kB（gzip 9.78）`、`js 507.71 kB（gzip 192.48）` |

本轮**没有改任何既有测试断言**（只新增 `contrast.spec.ts`）：视觉重排没有动摇 `data-*` 契约。

> 后端一行未改（`git status` 里 backend 的改动都属于本轮之前的工作），所以**没有复跑后端测试**；
> 汇总表里那行"后端测试子集 266"是第 15 轮的记录，**不是本轮的证据**。

**真实浏览器**：新脚本 `scripts/browser-verify-visual-v2.py`，对一次性内存库 + AI mock 后端（8110）
与 dev server（5175）执行 —— **PASS 155 / FAIL 0 / SKIP 0**。
证据 `docs/optimization/verification/2026-09-18-visual-v2/`（`REPORT.md`、`result.json`、22 张截图、
`screenshot-composition.txt`）。判据全部在**渲染结果**上量：

- 四视口（320/390/768/1440）× 6 个页面：`scrollWidth - clientWidth ≤ 0`，越界时打印越界元素；
- 对比度：取计算色 + 最近的不透明祖先底色，按字号/字重选 4.5 或 3.0 —— 全绿；
- 触控目标：手机 ≥44×44（注册/答题/报告/账号页），桌面按 WCAG 2.5.8 的 ≥24 —— 全绿；
- 200% 缩放：`zoom: 2`（等价 720px 布局宽）与 720px 视口两条路都不横向滚动；
- reduced-motion：所有 `animation-duration ≤ 0.01s`；
- 键盘：真实按 Tab，第一站是「跳到主要内容」**且聚焦后真的从 1×1 展开成可见按钮**，每站都有可见焦点环；
- AI：**打开报告页期间只有读接口、没有任何生成 POST**（目标书要求的"不在页面加载时偷偷调模型"）；
  结构预览 → 范围确认（未勾选不能提交）→ 进行中（**文案里没有 `%`**）→ 结果五段齐全 →
  mock 显著标注 → 演示数据不与真实记录混排；**结果区里没有编造出来的量化指标**
  （潜力值/匹配率/置信度/排名/准确率/相似度 —— 只在模型输出区查，页面别处的免责声明本来就要提这些词）；
- AI 另外三态（**路由 mock 造响应、页面真实渲染**）：额度用尽（`[data-ai-quota-empty]` + 生成按钮禁用）、
  任务失败（`[data-ai-failed]` + 重试按钮 ≥44 高）、输出读不出来（`[data-ai-result-problems]` 如实说明），
  三态都通过了溢出/对比度/残留星号检查；
- 不留轮询：结果出来静置 6s、离开报告页再静置 6s，均无新的 `/api/v3/ai/` 请求（提交后共 2 次）；
- 首屏开销：首页无任何跨域请求（无远程字体/CDN）；首屏内动画元素 1 个、最长 14s；
  所有 `@keyframes` 只动 `transform`/`opacity`。

**"不许回退"的老脚本也复跑了一遍**（视觉重构动了 `AssessView` 的保存态、题卡与报告页结构，
所以要证明保存/刷新/冲突这些老承诺没被顺手破坏）：

| 脚本 | 结果 | 证据 |
|---|---|---|
| `browser-verify-jung-flow.py`（注册 → 作答 → **刷新恢复** → 回退改答 → 补充题与交卷 → 归属边界 → 报告页 → 三视口） | **PASS 34 / FAIL 0 / SKIP 0** | `verification/2026-09-18-flow-after-visual/` |
| `browser-verify-conflict.py`（双上下文真实制造 409 → 停写 → 载入最新进度 → 继续作答 → 320 不溢出） | **PASS 22 / FAIL 0 / SKIP 0** | `verification/2026-09-18-conflict-after-visual/` |

> 这两个脚本的产物目录都**另建**了（`*-after-visual`），没有覆盖第 12/15 轮的原始证据。
> 第一次跑 `jung-flow` 时 exit 1：原因是脚本第 `[3d]` 步要用**第二个账号**验证归属边界，
> 而本机注册限流（1 小时 5 次）刚好用满 → 第二个账号注册拿到 429 → 等恢复码超时。
> 换成新的一次性后端（限流窗口重置）后复跑，**34 条全绿**。这是环境限流，不是回归。

**判别力**：这条"第一站是跳到主要内容"的判据**真的红过一次** —— 最初脚本在同文档 hash 导航后测，
Chromium 保留了顺序焦点起点，测到的不是页面本身（第一站变成首屏主按钮）。改成 `reload()` 后测才对，
原因写进了脚本注释。残留星号那条也是先在浏览器里看到星号、再去改源码的。

**脚本自己也被跑出了三个缺陷**（都是"先红后绿"，写在这里是因为它们同样算证据）：

1. mock 场景用 `browser.new_page()` 开页 —— 那是**新上下文、没有登录 cookie**，
   `/reports/{id}` 的路由守卫把三页全送去登录页（三条一起红，页面上写着"登录状态已经失效"）。
   改用同一个 context 的 `new_page()` 才测到真正要测的东西。
2. 路由回调写成 `handler(route, state=state)` —— Playwright 传的是 **两个**位置参数
   `(route, request)`，第二个参数被 Request 覆盖，炸在 `state['status']`。
   这提醒一件事：**mock 的写法本身也能让"绿灯"变成假的**（比如回调静默不生效时页面会走真实请求）。
3. 复跑撞上注册限流时，脚本会把 `REPORT.md` 覆盖成"0 条 PASS"——等于自毁上一轮证据。
   已加守卫：一条都没跑成就写到 `REPORT-not-run.md`。

顺带记录一条**测到的真实错误态**：本机注册限流（1 小时 5 次）触发时，页面给的是
「操作太频繁了，请等一会儿再试。」+ 服务端说明 + **还要等多少秒** + **报障编号**，
并且没有把账号信息或栈信息漏出来。这条不是本轮设计的，但顺手确认它没有被视觉重构破坏。

**前后对照**：`2026-09-17-layout/320x568-home.png`、`2026-09-17-flow/30-report-detail-390.png`、
`2026-09-17-ai/{10-report-before-ai-390,10-ai-consent-390,11-ai-result-390}.png` 是重构前；
本轮的 `390x844-home.png`、`390x844-report-toc.png`、`390x844-ai-{before,consent,running,result}.png` 是重构后。
`screenshot-composition.txt` 给出像素构成的客观侧面：首页深蓝占 26%+（`#081828` 系），
报告/AI 结果页以 `#F8F8F8` 阅读面为主，AI 生成前页同时出现深蓝与 `#F8E8D0`（示例标注底色）。

### 本轮没有做到 / 没有验到 / 我判断不了

1. **我没有"看"过这些截图。** 本轮跑验收的模型不支持图片输入 ——
   审美层面的结论（好不好看、有没有高级感）**不由我下**。我能给的是可测量的部分
   （对比度、溢出、触控目标、焦点、动画开销、像素构成）加全部截图供人眼复核。
2. **没有"重构前"的构建体积基线。** 上一轮记录的 `css 42.46 / js 437.45 kB` 出自第 9 轮，
   之后又加了 AI 面板、对比页、管理后台等整页功能，所以 `55.68 / 507.71 kB` 里
   **多少属于本轮视觉重构、多少属于其它功能，拆不开**。能确定的是本轮**没有引入任何新依赖**。
3. **后台页（`AdminView`）没有在真实后端上走查**（它需要 ADMIN 引导，且不在目标书点名的页面里）。
   这一页由子代理用**路由 mock 的临时 dev server** 验证（18 组视口无横向溢出 + 计算样式确认 token 生效）；
   我核对了它的改动与 typecheck/测试，但**那是 mock 证据，不等于真实后端证据**。
   我在这页改的 3 处残留星号，只有 typecheck 与读代码两层证据。
   （历史页与对比页原先也在这条里 —— 本轮已用真实后端补上，见上面"补做"一节。）
4. **AI 只验了 mock 适配器**（`mock=true`，没有真实调用）。额度用尽 / 失败 / 输出读不出来这三态，
   我用**路由 mock 造响应**在真浏览器里验证了它们的**渲染**（155 条里的 16 条），
   但真实上游的超时、限流、输出截断本身仍未验证 —— 与本项历史结论一致，不能被本轮绿字掩盖。
5. **动效"贵不贵"只量了声明**（个数/时长/是否含布局属性），没有在低端真机上测帧率（本机无真机条件）。
6. **本机 5173/5174 上那两个更早启动的 dev server 现在是坏的**：`GET /src/style.css` 返回 500
   （postcss 报 `ring-glow-soft` 不存在），而用 CLI 编译同一份 `style.css` 是 exit 0 ——
   原因是它们持有早于 `tailwind.config.js` 最后写入的旧 Tailwind context。
   本轮验收走的是 **5175**（晚于配置写入：`/src/style.css` 200、84 KB、含 `.btn-glow`）。
   那两个进程不是本轮启动的，我没有动它们；**任何想用 5173/5174 截图的人必须先重启它们**。
7. **答题页保存竞态没有排除**：脚本以机器速度连点仍可能在极快节奏下撞到一次 409，
   页面按契约停写并给「载入最新进度」，脚本据此恢复继续（本轮实测 0 次，更早版本 1 次）。
   契约路径是通的，但"人在 3G 下连点"仍未复现过。

### 下一步

- **环境变更（用户要求"重启一下我看看"，2026-09-17 晚）**：原来的 5173 / 5174 两个 dev server
  是坏的（持有早于 `tailwind.config.js` 的 Tailwind context，`/src/style.css` 返回 500，
  整站无样式；5173 还没有 `VITE_DEV_API_TARGET`，走的是默认 `http://127.0.0.1:8080`，
  而 8080 被 Cursor 占着，所以它的接口也一律 500）。**已杀掉并用同一个目标重启**：
  `VITE_DEV_API_TARGET=http://127.0.0.1:8099`（真实开发后端），端口仍为 5173 / 5174。
  重启后实测：`/src/style.css` 200（84,359 字节、含 `.deep-panel` 与 `.btn-glow`）、
  `/api/v1/meta` 200、首页深色面板 `rgb(11,26,40)` / 圆角 28px、390 与 1440 均无横向溢出。
  截图 `verification/2026-09-18-visual-v2/restarted-{5173,5174}-home-{1440x900,390x844}.png`。
  匿名访问首页时控制台有两条 401（`/api/v3/me`、`/api/v3/catalog/current`）—— 这是既有设计
  （`SecurityConfig` 里 `/api/v3/**` 一律 `authenticated()`，只放行 csrf/login/recover），
  首页据此退到内置口径，显示的数字（48 题 / 8–12 分钟 / 四个维度）仍然正确。
- 请人眼看一遍 `verification/2026-09-18-visual-v2/` 的截图（尤其首页与 AI 结果页）——
  审美结论以人的判断为准。方向要调的话，token 已集中在 `tailwind.config.js`，改动成本低。
- 视觉欠账：`AccountView` 六区块只有「修改密码」是主色按钮（要不要收敛成单一主行动，属产品判断）；
  320 宽下账号页提示间距 `mt-3` 与对比页 `mt-4` 不统一（无功能影响）。两条都记进了 backlog A39 / A40。

### 补做：历史与对比页的真实后端走查（同一轮内）

上面 §验证 里"历史 / 对比"当时只有**路由 mock** 证据。目标书把"历史+对比"列为要重建并验收的
页面之一，所以这一页不能在 mock 上收工。做法是复跑既有的两个脚本（真实后端、真实作答）：

| 脚本 | 覆盖 | 结果 | 证据 |
|---|---|---|---|
| `browser-verify-compare.py` | 注册 → **答两份方向相反的测评** → 历史列表 → 选两份比较 → 刷新与直链 → 320/1440 | **PASS 28 / FAIL 0 / SKIP 0** | `verification/2026-09-18-compare-after-visual/` |
| `browser-verify-history-ai.py` | 历史列表 → 从历史进老报告 → **老报告也能发起分析** → 两份报告的任务不串台 → 刷新后仍读得到 | **PASS 18 / FAIL 0 / SKIP 0** | `verification/2026-09-18-history-ai-after-visual/` |

两个产物目录都是**另建**的，没有覆盖第 8 / 14 轮的原始证据。到这一步，目标书点名的页面
（首页 / 答题 / 固定报告 / AI 洞察 / 历史 + 对比 / 账号 + 认证）**全部有真实后端证据**；
只有 `AdminView`（后台页，不在目标书点名的页面里）仍然只有 mock 路由证据。

## 当前汇总（截至第 16 轮结束）

| 项 | 状态 |
|---|---|
| 后端测试子集 | 266 通过 / 0 失败 / 1 跳过（BUILD SUCCESS） |
| 前端测试 | 28 文件 / **817 条通过**（第 16 轮：视觉重构后未改任何断言） |
| 前端 typecheck / build | 均为 exit 0（第 16 轮 build：css 55.68 kB / gzip 9.78，js 507.71 kB / gzip 192.48） |
| 真实浏览器·**视觉重构与 AI 体验（第 16 轮）** | **PASS 155 / FAIL 0 / SKIP 0**（四视口 × 6 页、对比度、触控目标、200% 缩放、reduced-motion、键盘焦点、AI 五态、加载不偷偷调模型、AI 不编量化指标、无残留轮询、首屏无跨域与动画开销；`verification/2026-09-18-visual-v2/`） |
| 真实浏览器·**重构后主流程复跑** | **PASS 34 / FAIL 0 / SKIP 0**（刷新恢复、回退改答、交卷、归属边界；`verification/2026-09-18-flow-after-visual/`） |
| 真实浏览器·**重构后跨设备冲突复跑** | **PASS 22 / FAIL 0 / SKIP 0**（`verification/2026-09-18-conflict-after-visual/`） |
| 真实浏览器·**重构后历史 + 对比复跑** | **PASS 28 / FAIL 0 / SKIP 0**（两份方向相反的报告；`verification/2026-09-18-compare-after-visual/`） |
| 真实浏览器·**重构后历史报告能否分析复跑** | **PASS 18 / FAIL 0 / SKIP 0**（含"两份报告的任务不串台"；`verification/2026-09-18-history-ai-after-visual/`） |
| 真实浏览器·主流程 | PASS 34 / FAIL 0（第 15 轮复跑：答题页改动后仍全绿） |
| 真实浏览器·AI 分析面板（mock） | PASS 31 / FAIL 0（一次性 H2 + AI mock 模式） |
| 真实浏览器·AI 分析面板（**真实调用**） | PASS 30 / FAIL 0 / SKIP 0（后台配置的 key，`apiKeySource=db`，`mock=false`） |
| 真实浏览器·AI 分析面板（**第 14 轮修复后真实调用复验**） | PASS 30 / FAIL 0 / SKIP 0（同一 key，`aiMock=False`；证据 `verification/2026-09-17-ai-real-after-fix/`） |
| 真实浏览器·**历史报告能否分析** | PASS 18 / FAIL 0 / SKIP 0（`verification/2026-09-17-history-ai/`） |
| 真实浏览器·**导出数据的完整性声明** | PASS 19 / FAIL 0（`verification/2026-09-17-export-degraded/`；含"下载到的文件里确实有 `degradedSections`"） |
| 真实浏览器·**快速连点是否伪造冲突** | PASS 10 / FAIL 0，**假设不成立**（取证显示两个 PATCH 是串行的；`verification/2026-09-17-rapid-answers/`） |
| 真实浏览器·复测比较 | PASS 28 / FAIL 0 |
| 真实浏览器·管理后台 | PASS 31 / FAIL 0（分两段：重启后端引导管理员） |
| 真实浏览器·**跨设备冲突** | PASS 22 / FAIL 0 / SKIP 0（双浏览器上下文真实制造 409） |
| 真实浏览器·可读性与导航 | PASS 12 / FAIL 0 / SKIP 0 |
| 真实浏览器·窄屏布局 | PASS 40 / FAIL 0 |
| P0 / P1 / P2 未闭环项 | A27（AI 面板不串台**依赖隐式前提**，当前正确但脆；有意不改）；A31 之后的 A32–A38（本轮审查发现、我核实后**有意未动**的项，见 backlog） |
| 需用户决定 | **第 16 轮视觉方向是否认可**（人眼看截图；不认可就调 `tailwind.config.js` 里的 token）；后台是否开放"改角色/禁用"；同意与设置变更的可审计台账；离线可答；冲突是否要做自动合并/本地暂存；是否授权改后台 `base_url` 以做真实上游失败的浏览器验证；LangChain4j 是否推进 PoC |
| 已记录待办（本版不动） | A22 会话表过期清理（用户选择先不动）；A23 Redis 架构项（用户选择保留）；A24 LangChain4j（默认不引入）；A27 AI 面板串台隐患（当前行为正确，不动）；A32–A38 见 backlog |

> 关于"真实调用"这一行：它验证的是**正常成功路径**。上游超时、限流 `Retry-After`、
> 输出截断、`CONTENT_VIOLATION` 这些失败分支仍未用真实上游验证过（只有 mock 覆盖）；
> 第 11 轮新增的失败文案也只有契约/单元测试级证据。不应被这些绿字掩盖。
>
> 第 15 轮新增的诚实交代：**导出的降级分支没有端到端验证**（只有后端单测 + 前端组件
> 测试 + 真浏览器证明字段在文件里）；**快速连点的竞态没有被排除**，只是没能在本地
> 网络条件下复现。两者都不应被上面的 PASS 掩盖。
>
> 第 16 轮新增的诚实交代：**审美结论我没有下**——本轮跑验收的模型不支持图片输入，
> 155 条 PASS 全部是可测量项（对比度/溢出/触控/焦点/动画/像素构成），
> "好不好看"要看人眼。**构建体积的前后差拆不开**（旧基线出自还没有 AI 面板、对比页、
> 后台的第 9 轮）。**`AdminView`（后台页，不在目标书点名的页面里）是 mock 路由证据**；
> AI 的额度用尽/失败/解析失败三态也是**路由 mock**（页面渲染真、接口响应是造的）。
> **动效只量了声明，没有真机帧率**。

---

# 第 17 轮（2026-09-18 深夜）：AI 与业务链路的"事实核对"

第 16 轮把视觉做完了，这一轮换一个问题问：**界面上写的，跟服务端真实发生的事，是同一件吗？**
做法是先假设"某个状态看起来对，但底层可能是错的"，再逐条去证实或推翻。

本轮修掉的都不是崩溃，而是**"把不是事实的话说成事实"**：

| 用户看到的 | 服务端真实发生的 | 后果 |
|---|---|---|
| 「另一台设备改过这次的进度」 | 没有任何第二台设备，是他自己两次点击发了两个同版本号的写请求 | 用户被迫重载并重答一题 |
| 「有 N 题的作答还没写上去」（重试后） | 那次写入**成功了**，只是响应丢在路上 | 用户把写成功的题当别人的改动丢掉 |
| 「这份测评已经提交」，然后是死路 | 报告**已经生成**，`attempt.reportId` 就在响应里，前端从来没读过 | 白做一遍，或者永远看不到那份报告 |
| 「记录没能载入」 | 记录好好的，只是刚才那个 DELETE 失败了 | 以为历史全丢了 |
| 「你还没做完」 | 那份报告已经被删了 | 被送去重新测一次 |
| 后台入口对普通用户可见 | 上一个登录的人（管理员）的探测结论被复用 | 泄露"本站有后台" |
| 表格里的结论属于 A/B | 用户已经换成 A/C | 拿旧结论理解新选择 |

## 一、先看证据，再改（本轮怎么找问题的）

1. 读上一轮留下的 `progress.md` / `backlog.md` / 契约，区分"已经验过"与"只是写着"；
2. 在**真实浏览器 + 一次性内存库后端**上复跑既有脚本，看哪些"绿"其实是脚本自己宽容；
3. 对每条可疑状态，写出**用户能观察到什么** → 再去看代码为什么（页面 → store → API → 后端）；
4. 改完必须有**判别力**：把修复撤掉，新测试必须变红（本轮每条都做了这一步，见下）。

本轮开了两条独立审查（只读）交叉核对，结论与我自己的走查一致的部分才动手；
不一致的地方以"能不能复现"为准。

## 二、修了什么（按"用户能看到"的顺序）

### 1. 答题页：不再伪造"跨设备冲突"

- `stores/assessmentV3.ts`：`flush()` 改成**无参单飞**（`if (this.flushing) return`），
  内部跑最多 3 轮 `sendPending()`；`select()` 先把作答记进 `unconfirmed` 再 `await flush()`；
  只有响应内容与本地**逐条一致**（`samePatch`）才把该题移出未确认集。
- 新增 `reconcileAfterConflict()`：409 之后**先重读详情逐条比对**，
  服务端内容与本机一致 → 按「已保存」收敛（这是"我自己那次其实写进去了"）；
  真的不一致 → 才弹横幅。
- 新增 `probeSubmission()`（只读，不碰 `lastError`/`saveState`）：交卷失败且非会话失效时探一次，
  已提交且有 `reportId` → 直接进报告；已提交但没报告 → `needs-review` 并说明原因。
  `bootstrap()` 补同样判断（刷新答题页会自动打开已生成的报告）。

**判别力验证**：去掉 `flushing` 守卫 → 「连点不并发」那条精确红；去掉 `reconcileAfterConflict()`
→ 「自己的写入已落地却回 409」那条精确红。

### 2. 报告列表：删除失败说对话

- `stores/reportV3.ts`：新增 `removeError` / `removingId`（在途守卫 + **独立错误通道**）、
  `clearRemoveError()`；删除失败不再写 `listError`（那会把整个列表换成「记录没能载入」）。
- `components/ConfirmDialog.vue`：新增 `busy` / `busyLabel`（在途时两个按钮都禁用、`aria-busy`、文案「正在删除…」）。
- `views/ReportV3View.vue`：删除失败的提示移到页面底部（**不能插进 `v-if/v-else-if` 链**，
  否则空态会和错误一起显示 —— 这一步是调试时踩出来的），列表行在途时禁用删除按钮。

**判别力验证**：把 `remove()` 改回"写 `listError` 且无守卫" → 2 条新测试精确红。

### 3. 比较页：换选即作废，表头写明比的是哪两份

- `views/CompareView.vue`：新增 `watch([idA, idB])`，一换选就 `generation++`、
  清 `result`/`resultIds`/`compareError`、`comparing=false`，需要时自动比较；
  新增 `resultIds` 与 `[data-compare-subject]` 表头（"这次比的是：先看的那份 X；再看的那份 Y"）。
- 迟到的旧响应按 `generation` 丢弃（第 8 轮就有的机制，这次补上了"换选"这个触发点）。

**判别力验证**：`watch` 体清空 → 2 条新测试精确红。

### 4. 报告 404：分清"还没做完"与"报告不在这里"

- `stores/reportV3.ts` 新增 `loadedByAttempt`；`ReportV3View` 按它分两套文案：
  - 按 attempt 取（信息不足）→ 保留"还没有报告可看 / 回去把没处理的题补齐"；
  - 按 reportId 取（**这一页实际走的路**）→ "这份报告打不开了 + 已被删除 / 属于另一个账号 / 编号不完整"，
    主行动改为「回到历史报告」。
- 顺带修掉一个**死代码陷阱**：`loadReportByAttempt` 全仓无调用方，而它的 404 语义正好相反。

### 5. 会话与状态：会话失效、导流与探针缓存

- 答题页载入失败新增 `loadUnrecoverable`（404 / 409 `PACKAGE_UNAVAILABLE` / 403）：
  这几类重试一万次也不会变，改成"如实说明原因 + 重新开始一次测评"。
- 保存失败若 `lastError.sessionExpired` → 给「登录后接着答」而不是「重试保存」。
  （真实浏览器实测发现 **App 层的会话失效桥更早生效**，用户会被直接送去登录页并带 `redirect`
  回到原页 —— 所以页面内这条只是"没触发重定向时"的兜底，两条路都验了，见验收报告。）
- `LoginView` → 注册/恢复链接、`RecoverView.goLogin()` 都带上 `redirect`（站内路径校验不变）。
- `composables/useAdminProbe.ts`：401 不再被缓存成"不是管理员"；新增 `resetAdminProbe()`，
  由 `auth.applyProfile` / `applyAnonymous`（所有身份变化路径的汇聚点）调用 ——
  共用设备上换账号后，后台入口不会留给下一个人。

### 6. AI 面板：不再依赖"父组件会销毁重建"这个隐式前提

- `stores/aiAnalysisV3.ts`：引入 `reportId` **归属**。`ownJobs` 只认
  `job.reportId === state.reportId`；`loadJobs` 带 `loadToken` + 归属过滤；
  `startPolling()` 前置条件 `reportId === null || !hasRunning` → 直接 `stopPolling()`；`reset()` 清全部并 `loadToken++`。
- `components/AiAnalysisPanel.vue`：新增 `watch(() => props.reportId)`（换报告即 `reset()` + 重读）、
  `onBeforeUnmount` 统一 `reset()`；补 `data-ai-jobs-error` / `data-ai-jobs-retry` /
  `data-ai-recheck` / `data-ai-create-cached` / `data-ai-other-running` 钩子。
- `api/v3Ai.ts`：`resultProblems` 只在 `status === 'SUCCEEDED' && parsed === null` 时非空
  （以前"还没成功"也会被当成"输出读不出来"）。

**判别力验证**：去掉 `loadJobs` 的 token/归属守卫 → 2 条精确红；去掉 `startPolling` 前置条件 → 1 条精确红。

### 7. 后端：注销清理失败不再伪装成成功（A37）

- `AccountDataDeletionService.cleanup()` 改成七步 `runStep(failed, section, …)`，
  任一段失败即抛 `AccountCleanupIncompleteException`（消息只带**段名**，不带任何 PII），
  `markDeletedWithRewrittenUsername` 只在**全部成功**后才调用。
- `tableExists` 只捕 `BadSqlGrammarException`（"表还不存在"= 部署未就绪，可跳过）；
  其余 `DataAccessException` 一律上抛；`cancelActiveAiJobs` 不再吞异常。
- 新增 5 条 `AccountDataDeletionServiceTest` + 2 条 `AccountDeletionWorkerTest`
  （失败 → `markFailed("CLEANUP_FAILED")` 且**不** `markDone`）。

**判别力验证**：把 `tableExists` 改回 `catch (DataAccessException)` → 精确红 1 条。

### 8. 组件复用：`FormErrorNotice`

8 处重复的"错误块"（标题 + 字段错误 + 服务器说明 + 还要等多少秒 + 报障编号）收敛成一个组件，
`LoginView` / `RegisterView` / `RecoverView` / `AccountView` / `ReportV3View` 共用。
这一条是**维护性**收益，没有用户可见变化，列在这里是为了说明 diff 里那一大块不是功能改动。

## 三、验证

### 单元与构建

| 项 | 结果 |
|---|---|
| 前端 typecheck | `vue-tsc --noEmit` exit 0 |
| 前端测试 | **29 文件 / 840 条通过**（第 17 轮新增 23 条：AI store 8、比较页 2、报告页 3、答题页 8、管理探针 2） |
| 前端 build | exit 0（`css 55.80 kB / gzip 9.82`，`js 513.74 kB / gzip 194.83`） |
| 后端测试子集 | **273 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS（排除两个真实 MySQL IT：建库/删库未获授权） |
| 内容一致性 | 5 条 `--check` 与重复度脚本 exit 0（本轮未动内容源） |

### 真实浏览器（一次性内存库后端 + AI mock）

`scripts/browser-verify-round17.py`（本轮新增）：

**PASS 58 / FAIL 0 / SKIP 0**，证据 `verification/2026-09-18-round17/`（含 22 张截图、`REPORT.md`、`result.json`）。

覆盖：连点两档不伪造冲突（并核对刷新后确实是最后点的那一档）、保存 401 → 送登录页并回跳成功、
交卷响应丢失 → 仍进报告、删除失败不顶掉列表、404 文案、比较页换选与表头、
320/390/1440 三视口无横向溢出与控件尺寸、离开报告页后无残留 AI 轮询。

其中三条用了 Playwright 路由注入（**响应是造的**，页面渲染与请求时序是真的）：
保存 401、交卷 `route.fetch()+abort`（请求真到后端、响应被丢弃）、删除 500。
这三条在报告里单独列了一节，不冒充端到端证据。

## 四、这一轮没做到 / 没验到 / 需要人判断

1. **审美结论我依然没下**：本轮跑的模型不支持图片输入。58 条 PASS 全部是可测量项，
   "好不好看"要看人眼（截图都在 `verification/2026-09-18-round17/`）。
2. **脚本第一版判据错了，我先跑出 11 条假失败**：初版把**纯文字链接**也按 44×44 量
   （隐藏的「跳到主要内容」1x1、品牌链接 92x19……）。第 16 轮的 `TARGETS_JS` 只量表单控件与按钮。
   已改回同一口径，并把两批实测值（压缩顶栏 `关于 24x16` / `首页 27x22`）登记成 **A54**。
   **"改判据"这件事本身也写进了验收报告**，因为它同样能把红灯变绿。
3. **保存 401 的页面内分支只有组件测试**：真实浏览器里 App 层的重定向先发生，
   所以那条「登录后接着答」通常看不到。我没有为了让截图好看而去掉 App 层的重定向。
4. **A35（create 幂等）与 A51（没有"继续上次未答完"入口）仍然没修**：
   它们是同一件事的两半（草稿列表 + 幂等 create），单独修一半只会制造新问题。
   现状是：`api_idempotency` 表在代码里**只被 DELETE**、从未写入；
   `fetchAttempts`/`deleteAttempt` 没有调用方 → 服务端存着草稿，用户看不到也删不掉。
5. **A52（`AdminView` 把 401 说成"可能后端没响应"）没修**：这页仍然只有 mock 路由证据。
6. **A53 的六条后端边界**（并发 submit 重复键、AI 配额读取失败乐观 `used=0`、
   死代码 `exportData` 吞异常、submit 200 vs 契约 201、并发 `DELETE /me` 500、429 重试后 `reserved_calls` 漂移）
   都是**登记未改**：都需要先构造确定性复现，其中两条要真 MySQL 并发测试。
7. **真实 MySQL IT 仍未运行**（`AccountSqlDialectMySqlIT`、`AiSqlDialectMySqlIT` 会建库/删库，未获授权）。
   所以"273 通过"只能称为**排除这两个 IT 之后的子集**。
8. **AI 相关只验了 mock 适配器**：本轮唯一一条 AI 断言是"离页后无残留轮询"。
   真实模型调用、上游失败分支都没有新增证据。

## 五、下一步优先级（给下一轮）

1. **A51 + A35 一起做**：草稿列表（`fetchAttempts`）+ create 幂等（`Idempotency-Key` 落到后端）
   → 首页才能兑现"换设备接着答"，也让"服务端存着草稿却看不见"这件事消失。
2. **A52 + 后台页可访问性**：`AdminView` 的 401 文案与登录入口；顺带做 A54 的顶栏高度。
3. **A53 挑两条做确定性复现**：AI 配额读取失败（`used=0`）与 429 重试的 `reserved_calls` 漂移，
   这两条不需要真 MySQL 并发也能构造。
4. 若获得授权：跑两个真实 MySQL IT，把"子集通过"升级为"全量通过"。

---

# 第 18 轮（2026-09-18 上午，用户「全部授权」之后）：把授权用在被挡住的地方

用户上一轮末尾的回复是 **「全部授权」**。这一轮先把"授权"变成可复核的事实，
再做我自己在第 17 轮列出的前三项（A51+A35 → A52 → A54）。

## 一、授权立刻兑现的两件事

### 1. 真实 MySQL 测试**跑起来了**（不再只是"子集通过"）

上一轮反复声明的"273 通过只能算子集"，原因是两个 IT 会在本机建库/删库：

```
mvn.cmd test '-Dtest=AccountSqlDialectMySqlIT,AiSqlDialectMySqlIT'
→ Tests run: 5, Failures: 0, Errors: 0, Skipped: 0（4 + 1）BUILD SUCCESS
```

随后跑**全量** `mvn.cmd test`（含这两个 IT、含新增的 8 条幂等 IT）：

**Tests run: 286, Failures: 0, Errors: 0, Skipped: 0 → BUILD SUCCESS**（上一轮 278，新增 8）。

它们各自创建 `typeme_accountdialect_<随机>` / `typeme_aidialect_<随机>` 临时库并在 finally 里 DROP，
脚本里不 `USE` 任何既有库、连接串不带库名 —— 与这两个类的文档一致；我没有改动它们的建库范围。

### 2. 权限的另一半没有被我擅自扩大

授权里还有"真实模型调用与个人数据外发"。**本轮我没有做真实模型调用**：
它的价值主要在错误分支（401/402/429/截断），其中只有 401 能用一把"故意写错的 key"
在不花钱、不外发真实个人数据的前提下稳定构造；而本轮的重点是我自己列的前三项。
这条我如实留在这里，而不是拿"授权了"当理由去做一件不完全必要的事。

## 二、A35：把契约里那句"可选 Idempotency-Key"真正实现

第 17 轮复核出的问题很具体：**`api_idempotency` 这张表从 V5 建好起只被 DELETE 过，从未写入**。

- 新增 `jung/service/IdempotencyGuard.java`：`api_idempotency` 的唯一读写点。
  - `claim` = 先删掉已经死掉的 `IN_PROGRESS`（超过 2 分钟），再 `INSERT`，主键冲突即"别人正拿着"；
  - `completedRef` = 同 key 同指纹且 `COMPLETED` → 返回 `response_ref`；**同 key 不同指纹直接抛 409**（调用方不可能"忘了比对"）；
  - `complete` / `release` / `forgetDangling`；`fingerprint()` 用 SHA-256（契约列宽就是 CHAR(64)）。
- **为什么"过期的 `IN_PROGRESS` 必须能被重新占用"**：一次请求崩在中间会留下一行 `IN_PROGRESS`。
  没有这条逃生口，一次服务重启会让这个键在 TTL 内一直报"上一次还在处理中"。
- `AttemptService.create` 拆成三个事务：占用 → `createOnce`（保持原有事务边界）→ 标记完成。
  标记完成失败**只记日志**（资源已经建好，绝不能让用户以为失败后重试再建一份）。
- `JungController.createAttempt` 接 `@RequestHeader("Idempotency-Key")`。
- 前端 `assessmentV3.create()` 自己生成并保存键：**重试复用、成功后更换**。
  以前它把键交给 API 客户端的默认实现（每次调用都新生成），"重试"在服务端看来就是"另一次点击"。

**新增 `AttemptIdempotencyIT`（8 条）**：同键重放同 id 且草稿只有 1 份、异内容 409 `IDEMPOTENCY_KEY_REUSED`、
**对照用例**（不带键时每次调用各建一份 —— 没有它，前两条即使因为"实现根本没读键"也会通过）、
空白键按缺失处理、超长键 400 且不留草稿、**记录指向的草稿被删后同键能重建**、键按用户隔离、
守卫层的新近 `IN_PROGRESS` 挡住 / 超期放行。

> **这一组测试当场抓出了我实现里的真实缺陷**：第一次跑，"草稿被删后同键重建"红了 ——
> `release` 只删 `IN_PROGRESS`，而那条记录是 `COMPLETED`，于是这个键会**永久命中一个已被删除的 id**
> （用户删掉草稿后再点一次会拿到一个 404 的 id）。修法是新增 `forgetDangling(..., responseRef)`
> 精确删掉这条悬空记录（条件带 `response_ref = ?`，避免误删并发中新写的行）。

## 三、A51：首页终于兑现"换设备接着答"

草稿一直是**服务端权威保存**的，但直到这一轮为止，前端没有任何地方读过草稿列表
（`GET /attempts?status=draft` 没有消费者）—— 用户中途离开后除了地址栏再也回不到那份草稿。

- `assessmentV3`：新增 `drafts` / `draftsError` / `draftProgress` 与 `loadDraftEntry()`、`clearDraftEntry()`，
  getter `resumableDraft` / `otherDraftCount`。
  `loadDraftEntry` **只读**：它绝不调用 `load()`（那会把详情写进答题状态，用户从答题页回首页看一眼
  就会把 `answers`/`revision` 覆盖掉，"已保存"与实际不符）。
- 进度只信**真的读到的那份草稿详情**：分子是主测已答题数，分母是主测题数（补充题不计入）；
  详情读不到就整个不显示进度，只保留"上次答到 …"。
- `LandingView`：已登录时读列表 → 主入口变「继续上次没答完的测评」（指向那一份）、
  次要入口变「重新开始一次测评」、多份时补一句「另外还有 N 份没答完」；
  未登录时**不发**这个请求并 `clearDraftEntry()`（共用设备上不能留下别人的进度）。
- 续答入口还要求路由表里注册了 `assess-attempt`：指向未注册路由的 `RouterLink` 会让用户点了没反应
  （首页在测试里会被单独挂载，这个坑第 17 轮在别的页面上踩过一次）。

## 四、A52：后台的三种状态各说各的

401 以前会落进"没问到"那一支：登录过期的管理员读到的是**「可能只是后端暂时没响应」**，
他会去重启后端、翻日志，而真正该做的只是重新登录一次。

- `access` 增加 `'needs-login'`：`isForbidden` → `denied`，`isSessionExpired` → `needs-login`，其余 `unavailable`；
- 新增 `[data-admin-needs-login]` 提示块（登录入口带 `redirect=/admin`、报障编号）；
- `unavailable` 的文案不再猜原因，改为明确"权限不足与登录失效都会单独提示"。

**真实浏览器实测的收场是"被 App 层会话失效桥送到登录页并带 redirect"** ——
页面内那一支只有组件测试覆盖。这与第 17 轮保存 401 的情形一样，我没有为了让截图好看而拆掉 App 层的重定向。

## 五、A54：顶栏那个矮于 24px 的目标

先把判据立起来：`header` 内每个 `a[href]` 与 `button` 的高度都必须 ≥24px
（顶栏链接不是"正文一句话中间的链接"，WCAG 2.5.8 的正文豁免不适用）。

实测结果与原始记录**不一致**，如实记下：

| 量法 | 品牌链接 | 导航项 |
|---|---|---|
| 第 17 轮最终脚本（展开顶栏） | 92x19（320）/ 203x22（390、1440） | 44 高 |
| 第 18 轮（三个宽度、滚动前后各一次） | 同上 | 44 高，**滚动不改变任何尺寸** |

backlog 里原来记的 `关于 24x16` / `首页 27x22`（"压缩顶栏"）在当前的 `header a[href]` 上量不出来，
而且 `App.vue` 里**没有任何滚动监听**，"压缩态"在现在的代码里并不存在。
所以本轮修的是**能复现的那一个**：品牌链接 `min-h-6`（24px）。
刻意保留 `items-baseline` —— 换成 `items-center` 会把副标题的行内盒重排一遍（实测宽度 203→195）。

**代价说清楚**：窄屏顶栏高度 **88px → 93px**（1440 不变，仍是 69px）；这是可访问性口径的取舍，
不是"顺手改好了"。命中区重叠已实测为 0。

## 六、验证

| 项 | 结果 |
|---|---|
| 后端全量测试（含两个真实 MySQL IT） | **286 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS |
| 前端 typecheck / build | 均 exit 0（build：css 55.83 kB / gzip 9.83，js 517.54 kB / gzip 195.94；第 17 轮为 55.80/9.82 与 513.74/194.83） |
| 前端测试 | **31 文件 / 854 条通过**（新增 `landingResume.spec.ts` 8 条、`stores/assessmentV3.spec.ts` 4 条、`adminView.spec.ts` +2 条；未删改任何既有断言、未降低断言） |
| 真实浏览器·本轮新脚本 `browser-verify-round18.py` | **PASS 34 / FAIL 0 / SKIP 0**，连续三次（含最终报告格式的那一版） |

判别力验证（都做完并撤回）：

| 改动 | 结果 |
|---|---|
| `create()` 不传幂等键 | 精确红 1 条（store 单测） |
| `resumeTarget` 恒为 null | 精确红 5 条（首页单测） |
| 详情失败时编造 `answered: 0` | 精确红 1 条 |
| 401 回落到 `unavailable` | 精确红 1 条（后台单测） |
| 删掉 `forgetDangling` 调用（真实缺陷） | 精确红 1 条（`AttemptIdempotencyIT`） |

## 七、这一轮没做到 / 需要人判断

1. **没有做真实模型调用**（理由见第一节 2）；AI 的错误分支仍然只有 mock 证据。
2. **后台「登录状态已经失效」那一支在真实浏览器里看不见**（App 层重定向先发生），只有组件测试。
3. **A54 的原始数字对不上**：原记录写的是"压缩顶栏"，实测是品牌链接；滚动不改变顶栏尺寸。
   我只修了能复现的那个，并把 backlog 那条描述按实测改写。
4. **答题页顶栏没有重量**：顶栏是同一个组件，第 17 轮曾在答题页量过（当时也只有品牌链接 <24px）。
5. **A53 的六条边界一条都没动**（登记仍在）。其中 ①⑤ 现在有授权可以构造真 MySQL 并发测试了。
6. **真实退出的路径**：本轮"会话失效后入口消失"是由注入 401 触发的；真实点「退出」那条路径
   在会话已失效后按钮不再渲染，因此没有点成（由账号页测试覆盖）。
7. `A57`（新登记）：`api_idempotency` 现在真的会被写入，所以**它的清理**变得有意义了 ——
   `expires_at` 有索引但没有清理任务；AI 模块仍然刻意不用这张表。这属于容量治理，未做。

## 八、下一步优先级

1. **A53 的 ①⑤ 用真 MySQL 并发测试构造**（授权已在）：并发 submit 撞 `uk_report_attempt`、
   并发 `DELETE /me` 撞 `uk_deletion_job_user`。这两条现在能验，而且都是"重复提交/重复删除"语义。
2. **幂等记录的清理任务**（A57）+ 让 `submit` 也走同一个守卫（它的幂等目前只靠 `UNIQUE(attempt_id)`）。
3. **AI 错误分支的真实验证**：用一把故意写错的 key（不花钱、不外发真实个人数据）跑一次，
   看任务是否落成 FAILED 且界面说的是可执行的建议。
4. **A38 / A39**（账号页文案与按钮层级）—— 小改动，需要产品口径。

---

# 第 19 轮（真实上游 AI 失败 + 真实 MySQL 并发 + 交卷契约 + 账号页）

## 一、这一轮做了什么（按用户"按你说的来"的四项）

1. **A53① 并发提交撞唯一约束后读不回报告** —— 修 + 真实 MySQL 验证（含确定性时序用例）。
2. **A53⑤ 并发注销撞唯一约束变成 500** —— 修 + 真实 MySQL 验证。
3. **A53④ 交卷状态码与契约不一致（200 vs 201）** —— 修 + 新增 HTTP 层测试（此前完全没有）。
4. **A57 过期幂等记录清理** —— 新增清理任务 + 测试 + 判别力验证。
5. **真实上游 401 的 AI 失败验收**（用一把故意写错的 key）—— 真实浏览器 21 条全绿。
6. **账号页 A38 / A39**（原计划第四项）—— 顺带发现并修掉 A59（报障编号用法一句话在全站都没渲染过），
   真实浏览器 32 条全绿。

## 二、A53① 并发提交：用户提交成功了，却被告知"这份报告不存在"

`ReportService.submit` 在 `INSERT` 撞 `uk_report_attempt` 之后用**普通一致性读**读回既有报告。
MySQL 是 REPEATABLE READ，而那个事务的快照建立于它自己的第一条 `SELECT`（`requireRow`）——
对方刚提交的报告行对它**永远不可见**，于是抛 `JungApiException`：404「这份报告」。

**这次没有靠"真并发碰运气"**：`ConcurrencyMySqlIT#duplicateReportInsertIsInvisibleToPlainRead`
用两个真实连接把时序按顺序摆出来（C1 `BEGIN`+`SELECT` → C2 `INSERT`+`COMMIT` →
C1 `INSERT` 撞 `23xxx` → C1 普通 `SELECT` 得 **0 行** → C1 `SELECT ... FOR UPDATE` 得 **1 行**）。
修复就是把重复提交分支换成这个当前读（`readReportRowForUpdate`）。
`#concurrentSubmitAlwaysReturnsSameReport` 再做 6 轮真并发：每轮断言两次提交拿到同一个 reportId、
该 attempt 只有一份报告、没有 Throwable。**判别力**：改回 `readReportRow` → 精确红（异常就是那个 404）。

## 三、A53⑤ 并发注销：注销申请已被受理，却回 500

两个并发 `DELETE /me` 双双通过 `requireActive`（各自快照里账号还是 ACTIVE），第二个
`INSERT INTO account_deletion_job` 撞 `uk_deletion_job_user`，`DuplicateKeyException` 一路上抛 = **500**。
修复：`DeletionJobRepository.insertPendingOrGetExisting` —— 冲突时用 `SELECT ... FOR UPDATE`
（同样必须当前读）读回既有任务并返回，重复申请是幂等的。
H2 侧 `AccountDeletionIT#repeatedDeletionRequestInsertIsIdempotent` 与真实 MySQL 侧
`#repeatedDeletionRequestReturnsExistingJob` 都先断言"绕开仓储层直接插第二行必须失败"，
否则这两条断言证明不了唯一约束真的存在。**判别力**：改回直接上抛 → 两条都精确红。

## 四、A53④ 交卷返回 200，契约写 201

契约 02 §7.2 给 `POST /attempts/{id}/submit` 的是 **201 Created**（只有覆盖不足才是
`200 + NEEDS_REVIEW`）。实现两种情况都返回 200，而**整套后端测试里此前没有任何一条**
走过"答满 48 题 → 交卷 → 拿到报告"这条 HTTP 路径 —— 所以这个偏差一直是隐形的。

新增 `SubmitReportIT`（2 条）：答满主测交卷 = 201 + reportId，重复交卷仍是**同一份**报告；
只答一题交卷 = 200 + NEEDS_REVIEW 且不建报告。题号从 `GET /catalog/current/package` 现取，
内容包换版不会让测试跟着烂。**判别力**：控制器改回"一律 200" → 精确红（`expected: 201 but was: 200`）。
真实浏览器回归：重启后端（含本轮全部 Java 改动）后跑 AI 那条脚本（它自己要完整交一次卷）
仍 PASS 21 / FAIL 0 —— 说明前端不依赖这个状态码，而那条"答满 → 交卷 → 报告"当时走的就是 201。

## 五、A57 过期幂等记录清理

`api_idempotency` 只增不减，而在此之前只有**账号注销**会删它。新增
`IdempotencyGuard.deleteExpired(now, limit)` + `IdempotencyCleanupJob`（1 小时一次、
启动后 10 分钟首跑、每轮最多 500 行、异常只记日志）。
两处细节都是踩过才知道的：`DELETE ... LIMIT` 是 MySQL 专有语法（H2 直接语法错），
所以先查主键再按主键删；删的时候**再带一次** `expires_at < ?`，因为"查到"和"删掉"之间
那一行可能被同 key 的并发请求重新占用（那时它带着新的过期时间）。

**判别力（两次）**：先只放宽 `SELECT` 的条件 → 测试**仍然绿**，说明真正兜住活记录的是
`DELETE` 上的那个条件（这条观察写进了代码注释）；再把 `DELETE` 上的条件去掉 → 精确红
（`deleted=3`，期望 1）。测试用三条记录（过期 / 活着 / 别人的）钉住"只删过期的那一条"。

## 六、真实上游 401：AI 失败时用户看到什么

后端以 `TYPEME_AI_MOCK_MODE=false` + **一把不存在的 key** 启动（日志自己打印了
`mockMode=false, baseUrl=https://api.deepseek.com`，脚本把这一行读出来当作"真的打到上游"的证据）。
用一次性合成账号（48 题全选同一档）触发一次生成：

- 任务落成 **FAILED**（不是一直转圈），服务端给的 `errorCode` **就是 `UPSTREAM_401`**、
  `mock` 不是 true、`result` 为空 —— 这三点由脚本直接问 `GET /api/v3/analyses/{id}` 拿到，
  不是从界面文字反推。
- 界面说的是「密钥无效或已过期 … 需要站点管理员处理，你自己重试没有用。基础报告不受影响。」
  （脚本断言含"密钥/无效或过期"+"管理员"+"基础报告不受影响"，且**不含"网络"**这种猜测）。
- 没有任何 AI 结果区、没有演示数据标记、有「重试」这一条下一步。
- **固定报告逐字未变**（概览文本前后完全一致）、分享文本仍在。

## 七、账号页：服务端原话、报障编号用法、按钮层级（A38 / A39 / A59）

这一项原本排在第 19 轮清单的最后（"需要产品口径"），实际动的时候发现**它已经不是一个纯文案问题**。

1. **A38**：`FormErrorNotice.vue`（此前已存在、但**没有测试也没有被 backlog 记为已闭环**）
   把那段提示块的字段集合固定在一处，账号页五个表单都用它。补 `formErrorNotice.spec.ts`
   5 条钉字段集合（主文案 / 字段提示 / 服务器说明 / 限流秒数 / 报障编号 + 提示语 /
   `data-*` 钩子合并到根元素）。真实浏览器：输错当前密码后服务端原话
   「当前密码不正确。」确实单独一行显示。
2. **A59（新发现，是全站范围的）**：写上面那条测试时发现
   「（反馈问题时把这个编号一起发过来，能直接查到这次请求。）」**在所有页面上都没渲染过**。
   原因是 `requestHint` 是布尔 prop，而 **Vue 把缺席的布尔 prop 转成 `false`**，
   于是 `v-if="requestHint !== false"` 永远不成立 —— 注释写着"默认显示"，实际一次都没显示。
   改用 `withDefaults(…, { requestHint: true })`。判别力：**修复前这条测试精确红**
   （5 条里只红这一条），修复后 5/5。
3. **A39**：账号页是平权的六个设置区块，主色按钮却只有一个（还是"修改密码"），
   等于用主色暗示它是这一页最该做的事 —— 没有依据。按"没有单一主行动 → 零主色"处理，
   改回 `btn-secondary`。判定不靠"看起来舒服"：页面里 `.btn-primary` 数量为 0、
   危险按钮 `btn-danger` 且背景色与次级按钮不同、未点开面板时页面里**不存在**「永久删除」按钮。

真实浏览器验收 `scripts/browser-verify-account-page.py`：**PASS 32 / FAIL 0 / SKIP 0**
（320/390/1440 无横向溢出、五个区块的动作都 ≥44px、注销面板的进入条件、
服务端原文与报障编号用法都在页面上）→ `verification/2026-09-18-account-page/`。

## 八、A53② 配额读不到时，不要报一个满额度

`AnalysisService.status()` 在读额度失败时原来按 `used = 0` 算，于是
`remaining = 每日上限` —— 界面会理直气壮地写"今天还可以生成 N 次"，而这一刻服务端
**根本读不到额度**。用户按这个数字做决定，第一次生成就可能撞 429，而界面上一秒刚保证过额度充足。
这属于本轮用户明确点名的"加载/异常状态是否真实反映服务端状态"，所以顺手修掉：

- 契约里 `remainingToday = -1` 就是"算不清"（前端把它映射成"不显示次数"），
  于是**未登录**（额度按账号算，本来就算不清）与**读额度失败**两种情况都返回 `-1`；
- 前端 `fetchAiStatus` 原来把**缺失**的 `remainingToday` 当 `0`（UI 上的意思是"今天用完了"），
  同样是替服务端下一个它没下过的结论 —— 改成 `-1`。

判别力两次都做了：把 catch 改回"按 0 处理" → `AnalysisStatusQuotaTest` 精确红 1 条
（`expected: -1 but was: 20`）；把"未登录也算得清"改回去 → 红 2 条。
新增测试：`AnalysisStatusQuotaTest` 3 条（正常/读失败/匿名）+ `aiAnalysisPanel.spec.ts` 1 条
（`-1` 时既不显示次数、也不禁用生成按钮、更不说"额度已用完"）。

## 九、这一轮没做 / 只做到哪里（诚实交代）

1. **A53 ②③⑥ 未动**：② AI 配额读取失败仍按 `used=0` 乐观显示；③ `exportData`（无调用方的
   死代码）仍把 `BadSqlGrammarException` 吞成 `List.of()`；⑥ 429 自动重试时 `reserved_calls` 漂移。
2. **"submit 也走同一个守卫"只给了结论，没有改代码**：`submit` 的幂等已经由
   `UNIQUE(attempt_id)` + 上面那个当前读保证（同一 attempt 不可能出两份报告），
   再加一层 `Idempotency-Key` 会引入第二个真相来源、多一次写库，收益是"同 key 不同 body
   的提交会 409"这种与当前语义无关的行为。**结论：不加**，理由记在这里而不是悄悄跳过。
3. **`ConcurrencyMySqlIT` 只到服务对象层**：手工装配 `ReportService`（事务由 `TransactionTemplate`
   提供，等价于 `@Transactional(REQUIRED)`），没起 Spring 上下文 —— 临时库名要在上下文启动前
   生成，`@DynamicPropertySource` 用不上。HTTP 状态码那段由 H2 上的 `SubmitReportIT` 覆盖。
4. **真并发"第二路一定撞到唯一约束"靠多轮提高置信度**（每用例 6 轮），不是数学确定性；
   确定性的是那条按顺序摆时序的用例。
5. **上游 401 的原因是我们提供的 key 决定的**，不是上游故障：这条验收证明的是
   "上游拒绝 → 服务端归类 → 界面表达"，不是上游可用性；弱网/超时/429/截断仍只有 mock 证据。
6. **第 18 轮的浏览器脚本没有重跑**（内容未变，且本轮前端改动只涉及账号页的提示块与一个按钮类）；
   本轮的两条脚本（AI 401、账号页）在**重启后的后端**（10:24:58，含全部 Java 改动）上各复跑通过一次。
7. **新登记 A58**：契约把 `GET /catalog/*` 写作公开内容 GET，实现要认证 ——
   改成公开是**放宽**访问边界，属安全配置决策，本轮刻意不动。
8. **账号页这一项只做到 390 宽的交互**：320/1440 只量了布局与按钮尺寸，没有在窄屏真机式地
   跑完五个表单；注销**只到"点开面板 + 确认危险按钮是禁用的"**，没有真的注销任何账号
   （真正执行删除的链路在后端测试里）。
9. **A53② 的前端一半（`fetchAiStatus` 缺失字段默认 `0` → `-1`）没有 API 层测试**：
   它由 store 层的行为测试（`-1` 时不显示次数）间接覆盖，但"服务端真的漏了这个字段"这个
   输入路径没有测试。要做就得给 `api/v3Ai.ts` 配一套 fetch-stub，这一轮没做。

## 十、下一步优先级

1. **A58**：`GET /catalog/*` 是否放开为公开（安全边界决策，需产品/安全口径）+ 若放开要不要限流。
2. **A53 ③⑥**：两条都是小改（③ 删死代码或让它别吞异常；⑥ 429 重试时重新预留额度）。
3. **弱网/超时/429 的 AI 分支**：用 mock 适配器把分支跑全（真实上游不能制造 429）。
4. **`fetchAiStatus` 的缺失字段默认值只有代码注释与 store 层测试**：要给 API 层补一条
   fetch-stub 测试才能真正钉住（这一轮没补，见诚实交代第 9 条）。

---

# 第 20 轮（多量表平台化：从"只有十六型"到"两项测评各自的计分、报告与页面"）

本轮不是"再找几个 bug"，而是把既有的**多量表平台方案**真正落成代码与页面
（方案见 `docs/2026-09-18-platform-plan/`）。因此第一节先交代"这一轮之前仓库里到底有没有这些代码"，
避免把已有工作写成本轮成果。

## 一、起点事实（先看，再改）

`git status --short` 已有 39 个已修改文件与大量未跟踪文件（用户既有工作，全程未删改）。
其中**已经存在**、不是本轮写的：

| 已有 | 位置 |
|---|---|
| 大五内容包（50 题） | `backend/src/main/resources/content/bigfive50-zh-v1.json` |
| 大五模块（内容/领域/计分/报告） | `backend/src/main/java/com/typeme/ipip/**` |
| 平台层（目录、版本解析、报告外壳、查询） | `backend/src/main/java/com/typeme/platform/**` |
| 十六型内容包 v2 | `typeme-jung48-zh-v2.json`、`typeme-type-report-zh-v2.json` |

**本轮之前缺的是什么**（这才是本轮的工作量）：

1. 平台层的**后端**有了，**前端一个消费者都没有** —— `/api/v3/platform/*` 在 `frontend/src/` 里零命中；
2. 没有发现页、没有选择页、没有大五答题页、没有大五报告页、没有统一的历史列表、没有方法说明页；
3. 路由里只有 `/assess`（十六型答题）与 `/reports/:reportId`（十六型报告）；
4. 平台层没有任何**端到端**测试（`BigFiveScoringTest` 直接调 scorer，不走 HTTP）。

## 二、修掉三个只有整体跑起来才会暴露的缺陷

这三个都不是"加功能"，而是**已有代码里的错**，而且都只在端到端路径上才现形。

### 1. 每个平台请求的路径都多了一段 `/api/v3`（功能全废）

`frontend/src/api/platformV3.ts` 里 `const BASE = '/api/v3/platform'`，而 `v3Request` 自己会在前面
加 `/api/v3`（`api/v3.ts` 的 `V3_BASE`）。于是实际请求是
`/api/v3/api/v3/platform/instruments` → 404。

它的表现极具误导性：目录永远是空的、草稿永远没有、报告永远打不开 ——
看起来像"后端还没部署好"或"数据库里没数据"，而不是客户端拼错了路径。修法是把 `BASE` 改成相对前缀
`/platform`，并把原因写进注释（这类错一定会被下一个人再写一次）。

**这一条是本轮最有价值的发现**：它意味着平台层的前端第一次真正跑起来。

### 2. 大五报告**一份都生成不出来**：护栏把正常文案当成违规

`BigFiveReportBuilder.BANNED_WORDS` 里有「高于」「低于」，而 `readingOf()` 一定会写出
"比中间高/低了 N 分"。结果是**任何一份答完的大五报告都在构造阶段抛 IllegalStateException → 500**。
第二层同样致命：`limitations()` 的说明句写的是"本产品没有本地常模，因此**不提供百分位**……"，
而「百分位」本身就在禁用表里 —— 一句话里既有"我们不做这件事"、又有被禁的词。

要拦的是"与外部参照比较"（常模、百分位、其他人的分数），不是"高于/低于中点"这个不可避免的说法。
于是：从禁用表移除「高于」「低于」（保留「常模」「百分位」「低于全国」），
并把这句限制声明改写成不含禁用词的说法 —— **不给护栏开口子**（开口子会让真正越界的文案一起放行）。

顺带给护栏的报错信息加上**来源**（"首屏摘要"/"维度解读 ES"/"限制声明"）：这段文案有四个来源，
不带来源的报错会逼着人把整份报告从头读一遍，而它在 HTTP 上只呈现为一个 500。

### 3. 报告详情接口 100% 失败：`(String)` 强转 `DATETIME` 列

`PlatformQueryService` 里写的是 `(String) row.get("created_at")`。JDBC 取 `DATETIME` 回来的是
`java.sql.Timestamp`，这个强转**必然**抛 ClassCastException：

- 报告能建出来，但**永远打不开**；
- `TimeSource.isoFromUtc(...)` 那条分支从来没被执行过，所以"看起来也对"。

时间一律走 `TimeSource` 转换，不做任何强转。全仓只有这一处这种写法（已用正则复查 `_at` 列）。

## 三、前端：把方案里的页面全部落成

新增 9 个视图、2 个 store、1 个 API 模块，并按"必须先能跑通"的顺序接起来：

| 页面 | 路径 | 关键点 |
|---|---|---|
| 测评发现 | `/instruments`（公开） | 每项说清"你会得到/规模/它不适合"；首项标"推荐先做"；无类型的量表标"不给类型" |
| 方法说明 | `/instruments/:slug/method`（公开） | 逐维度的两端说明、评分口径与版本列表（含 `contentStatus` 的人话、默认版本标记） |
| 选择/继续 | `/assess` | 未答完的草稿按时间倒序置顶；带 `?instrument=<slug>` 可自动开始；**已有草稿时继续那一份，不新建** |
| 答题分发 | `/assess/:attemptId` | 读服务端 `instrumentKind` 决定渲染哪一页，**不传题型参数** |
| 大五答题 | 同上 | 一屏一题、五档 + 「说不好」、自动保存、409 停止保存并给"重新载入" |
| 大五报告 | `/reports/big-five/:reportId` | 先给本次结论与不确定，理论放可折叠的方法区；中点用服务端给的 `midpoint` |
| 报告列表 | `/reports` | **两种报告的统一下标**，按 `reportKind` 分流详情页 |

三处刻意做的判断：

1. **报告种类（`reportKind`）而不是量表种类决定渲染器**：同一项测评将来可以有不同种类的报告。
2. **大五的中点不能用 `(低+高)/2` 推**：量程两端不对称（ES 是 6–50，中点仍是 30）。
   这一条是推理发现的，不是测试发现的 —— 已把 `midpoint` 加进后端维度节点与前端模型。
3. **"未保存"按"这一条有没有进服务端"判定，不按"服务端 revision 变了没有"**：
   后者会在"改完还没发出去"时显示"已保存"。

## 四、验证

### 4.1 真实浏览器验收（本轮补做，全部 PASS）

用户授权后，用 `frontend/dist` + 后端 jar（8080）跑了真实 Chromium，脚本在
`scripts/browser-verify-platform.py`，证据在
`docs/optimization/verification/2026-09-18-platform/`（`REPORT.md` / `result.json` / 9 张截图）。

**结果：PASS 64 / FAIL 0 / SKIP 0**，真实 MySQL 8.4（`typeme_dev`，Flyway 已在版本 8、无新迁移）。

| 看什么 | 关键断言 |
|---|---|
| 未登录的发现页 | 两项都在；大五标出"不给类型"；每项都写了"它不适合"什么；点「开始」去登录页并带 `redirect` |
| 公开的方法页 | 大五 5 个方面、十六型 4 个方面；"结论长什么样"按量表分开说 |
| 选择/自动开始 | `?instrument=bigfive50` 直接进答题页且从 `Q01` 开始；没有"目录报错" |
| 大五答题 | 五档都在、有独立「说不好」且可撤销、选完如实显示"有 1 题还没保存"、50 题后提交可用 |
| 大五报告 | 五个方面、覆盖说明、限制、方法区折叠；出现中点 30；没有破版提示 |
| 我的报告 | 大五那一行标成 `big_five_profile` 且点开落到大五报告页 |
| 320 / 390 / 1440 | 发现页/方法页/选择页/报告列表**四页均无横向溢出**；「开始」「先看题目与口径」都够得着 |

### 4.2 单元与端到端测试

| 项 | 结果 |
|---|---|
| 后端全量测试（排除 3 个真实 MySQL IT） | **313 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS（第 19 轮为 296） |
| 其中本轮新增 `BigFivePlatformIT` | **10 条**：目录公开可读、详情五维、完整流程（建草稿→50 题→交卷→报告）、没答完 200+INCOMPLETE+缺题号、重复交卷同一份报告、同 `Idempotency-Key` 同一份草稿、全部「说不好」不给方向、越权 404、跨入口拒绝大五 slug、AI 请求被明确拒绝 |
| 其中 `ReportInputBuilderTest` | 19 条（本轮 +2：大五报告必须是 `UNSUPPORTED_INSTRUMENT` 400、十六型不受影响） |
| 前端 typecheck | exit 0 |
| 前端测试 | **36 文件 / 894 条通过**（第 19 轮为 32/860） |
| 前端 build | exit 0（css 56.98 kB / gzip 9.96，js 577.80 kB / gzip 214.25） |
| 内容一致性 | `gen-platform-content.mjs --check` 三份 JSON 与源一致；其余 4 条 `--check`/重复度脚本全部 exit 0 |

本轮新增的前端测试文件：`bigFiveAssessView.spec.ts`（8）、`assessChooserView.spec.ts`（7）、
`instrumentMethodView.spec.ts`（8）、`api/platformV3.spec.ts`（11）。

**`api/platformV3.spec.ts` 是这一层的第一组测试**，而且它立刻就撞出了东西 —— 不是产品缺陷，
而是**以往的替身夹具与真实 DTO 对不上**：`ReportDetailView` 要的是 `attemptRevision`，
大五维度要的是 `direction`/`question`/`sideLabel`/`dailySigns`，版本行要的是
`revision`/`reportContentVersion`/`sha256`。也就是说，**这一层以前从来没有被真实形状检验过**。
判别力也验了：把 `BASE` 改回 `/api/v3/platform`，路径那条测试精确变红。

### 4.3 真实浏览器才发现的两条新缺陷（已修）

| ID | 问题 | 为什么单元测试与代码复核都没抓到 |
|---|---|---|
| A69 | **方法说明页换 slug 不重新取数据**：`/instruments/a/method` → `/instruments/b/method` 是同一个组件实例，只在 `onMounted` 取数据，于是切过去以后**继续显示上一项的维度与版本**。实测"十六型方法页给出四个维度"数出了 **5 个** | 页面**看起来有内容**，只是内容是别人的；而且两项测评的维度数量不同（4 vs 5），数字对不上时最容易被当成"内容本身有问题"。已改用 `watch(slug)` + **请求令牌**（防后发先至），并在 `instrumentMethodView.spec.ts` 里用"站内跳转"钉住 —— 把 watcher 去掉，两条测试精确变红 |
| A70 | **方法说明页没有说"结论长什么样"**，也没说分数怎么读 | 只写"看哪几个方面"会让用户以为两项测评的结论是同一种东西（大五没有类型码、没有总分，分数说的是离中间值多远）。已新增按 `hasTypeCode` 分流的一段说明，页面测试与浏览器验收各钉一次 |

顺带把方法页的「开始这项测评」改成带上当前 slug（原来是个不带参数的死链，点进去只会落到选择页）。

## 五、这一轮没做到 / 没验到

> 此节仅记录第20轮结束时的缺口；第1、2项在第21轮已有实现，不是当前待办。见文首补记。

1. **AI 通俗化输出契约没有动**。现状核实：`typeme-ai-prompt-v2.txt` 要求 800–1200 字、2–6 段，
   `ReportAnalysisValidator` 按 9 条校验、`schemaVersion` 固定 `"1"`。方案（`题目报告与AI易读性改造.md` §4）
   已经把目标契约写清楚：新 schema `analysis-readable-v2`、字段 `summary`/`observations[]`（含
   `plainText`/`example`/`evidenceIds`）/`suggestedAction`/`limitations[]`、初始编辑目标 **250–450 字**、
   新 promptVersion 去掉正文最低字数、通俗模式输入**默认不含 `processLayer`**、语义来自审核后的
   `itemMeaning` 与真实答案。要落地必须提示词、输入投影、输出 schema、Java 校验、前端模型与渲染**一起改**，
   半途而废会让旧分析记录读不出来 —— 所以本轮**刻意没开始**，它是下一轮的第一件事。
2. **大五的 AI 解读明确不支持**（本轮只做到"明确拒绝"）：已把它从"500 崩溃"改成 400
   `UNSUPPORTED_INSTRUMENT` 并有测试，但**能力本身没有做**。
3. **浏览器验收只覆盖了两项测评里的页面骨架，没有覆盖**：跨设备 409 冲突（两个浏览器上下文的真冲突）、
   报告删除、AI 解读面板、补充题轮次（十六型答题）。
4. **没有任何真人试读/信度效度证据**；题面仍是 `draft_review_pending`。测试通过不等于题目可读、
   更不等于量表可靠。**不把本轮任何结果称为信度或效度验证。**
5. **阈值决策仍在用户手里**（`docs/2026-09-18-platform-plan/阈值政策对比与决策请求.md`，0.20 vs 0.10）。
   本轮没有替用户选值。

## 六、下一步优先级

1. **AI 通俗化输出契约 `analysis-readable-v2`**：提示词 + 投影 + schema + 校验 + 前端模型 + 渲染
   一起改，并保证**新旧分析记录都能读**（方案 §4 已给出字段与字数目标）。
2. **真人试读（题面可读性）与阈值决策** —— 这两项不是 AI 能代替的。
3. 浏览器验收扩展到 409 真冲突、报告删除、补充题轮次。
4. 大五的 AI 解读能力本身（现在只是明确拒绝）。

---

## 历史汇总（截至第 20 轮结束）

> 以下为当时状态，AI 通俗契约与大五能力的缺口已由第21轮实现；当前复核见文首补记。

| 项 | 状态 |
|---|---|
| 后端测试（**排除** 3 个真实 MySQL IT） | **313 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS |
| 前端测试 | 36 文件 / **894 条通过** |
| 前端 typecheck / build | 均 exit 0（build：css 56.98 kB / gzip 9.96，js 577.80 kB / gzip 214.25） |
| 内容一致性 | 5 条脚本全部 exit 0（含 `gen-platform-content.mjs --check` 三份 JSON 与源一致） |
| **真实浏览器·多量表平台**·第 20 轮 | **PASS 64 / FAIL 0 / SKIP 0**（`verification/2026-09-18-platform/`；真实 MySQL 8.4 `typeme_dev`，Flyway 已在版本 8、无新迁移；320/390/1440 四页无横向溢出；两轮复跑，第二轮含 A69 修复） |
| 真实 MySQL 并发 | 第 19 轮 3 条通过；本轮未重跑 |
| 本轮闭环 | 平台端点路径拼错（前端全废）、大五报告护栏误拦（一份都出不来）、报告详情 `DATETIME` 强转（100% 500）、多量表前端全部页面与路由、`UNSUPPORTED_INSTRUMENT` 明确拒绝、**A69 方法页换 slug 不重载（浏览器实测发现）**、**A70 方法页没说"结论长什么样"**、API 层补上第一组测试 |
| 本轮未闭环 | AI 通俗化契约（`analysis-readable-v2`）、大五 AI 解读能力本身、真人试读与阈值决策 |
| 仍需用户决定 | 阈值 0.20 vs 0.10；是否投入把 AI 解读扩到大五 |
| 仍然缺证据的地方 | 真人题面可读性；量表信度效度；409 真冲突/报告删除/补充题轮次的浏览器验收；AI 各失败分支仍只有 mock 证据 |

---

## 历史汇总（截至第 19 轮结束）

| 项 | 状态 |
|---|---|
| 后端测试（**全量**，含三个真实 MySQL IT） | **296 通过 / 0 失败 / 1 跳过**，BUILD SUCCESS（第 19 轮 +10：`ConcurrencyMySqlIT` 3、`SubmitReportIT` 2、`AnalysisStatusQuotaTest` 3、`AttemptIdempotencyIT` +1 过期清理、`AccountDeletionIT` +1 重复注销） |
| 前端测试 | 32 文件 / **860 条通过**（第 19 轮 +1 文件 / +6 条：`formErrorNotice.spec.ts` 5 条钉提示块字段集合、`aiAnalysisPanel.spec.ts` +1 钉"次数未知"的界面） |
| 前端 typecheck / build | 均 exit 0（build：css 55.83 kB / gzip 9.83，js 517.55 kB / gzip 195.95） |
| 内容一致性 | 第 19 轮未动内容源，未重跑（第 18 轮 5 条脚本 exit 0） |
| **真实上游 AI 失败**·第 19 轮 | **PASS 21 / FAIL 0 / SKIP 0**（`verification/2026-09-18-ai-upstream-401/`，后端 `mockMode=false` + 故意写错的 key，真实打到 `api.deepseek.com`） |
| **真实浏览器·账号页**·第 19 轮 | **PASS 32 / FAIL 0 / SKIP 0**（`verification/2026-09-18-account-page/`，320/390/1440 无溢出、服务端原话与报障编号用法、按钮层级与危险动作门槛） |
| 浏览器验收跑在哪个代码上 | 两条脚本最后都在**重启后的后端（10:24:58，含本轮全部 Java 改动）**上复跑通过 —— 那次"答满 → 交卷 → 报告"走的就是新的 `201 Created` 路径 |
| 真实 MySQL 并发·第 19 轮 | `ConcurrencyMySqlIT` 3 条通过；A53①⑤ 的判别力逐条验证并撤回（`verification/2026-09-18-round19-db-concurrency/`） |
| 真实浏览器·第 18 轮与更早 | 见 `verification/2026-09-18-round18/`（PASS 34/0/0，连续三次）；第 19 轮未重跑第 18 轮脚本 |
| 第 19 轮闭环 | A53 ①（并发提交 404）、A53 ②（配额读不到却报满额度）、A53 ④（交卷状态码与契约不一致）、A53 ⑤（并发注销 500）、A57（幂等记录过期清理）、A38（账号页服务端原文）、A39（账号页按钮层级）、**A59（报障编号用法一句话在全站都没渲染过）** |
| 第 19 轮未闭环 | A53 ③⑥、A58（`GET /catalog/*` 契约说公开、实现要认证）、A40（页面间距节奏，依旧有意不改） |
| 仍需授权/决定 | A54 带来的窄屏顶栏 88→93px 是否接受；后台是否开放"改角色/禁用"；A58 是否把内容 GET 放开为公开 |
| 仍然缺证据的地方 | A53 ③⑥ 未复现；`ConcurrencyMySqlIT` 只到服务对象层（HTTP 层由 H2 的 `SubmitReportIT` 覆盖）；弱网/超时/429/截断的 AI 分支仍只有 mock 证据；`submit` 是否也走 `IdempotencyGuard` 只给了结论（见第八节前的说明）；账号页 320/1440 只量布局未跑完整表单交互；`fetchAiStatus` 缺失字段的默认值没有 API 层测试 |
