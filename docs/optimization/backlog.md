# TypeMe 问题清单（backlog）

> 本文件是**持续优化任务**的问题台账（见 `docs/DSH-持续优化提示词.md`）。
> 规则：每条必须有**可复现证据**（命令输出 / 截图 / 代码位置），并维护状态，
> 避免多轮重复寻找同一问题。历史文档里的"缺口清单"只作线索，必须重新核实后才进本表。
>
> 状态：`待办` / `进行中` / `已修待验` / `已闭环` / `需用户决定` / `仅记录`
> 优先级：P0 安全/数据/主流程阻断 > P1 口径冲突与状态不同步 > P2 高频页面体验 > P3 性能与维护

## 环境基线（2026-09-17 建立）

| 项 | 实测 |
|---|---|
| 仓库状态 | `git status --short` 干净；HEAD `1dbad2a` |
| 内容一致性 | 5 条 `--check` / 重复度脚本全部 exit 0（详见 progress.md） |
| 前端 typecheck | `vue-tsc --noEmit` exit 0 |
| 前端测试 | Vitest 17 文件 / 693 条通过、exit 0（与 implementation README 记载的 693 一致） |
| JDK | `D:\develop\jdk-21` 存在；PATH 上的 `java` 是 17（需显式设 `JAVA_HOME`） |
| MySQL | 本机 3306 未监听；`typeme_dev` 连接不可用（本轮未做任何数据库写操作） |

## 本轮新增（2026-09-17）

| ID | 问题 | 证据 | 影响 | 优先级 | 状态 |
|---|---|---|---|---|---|
| A1 | 顶栏导航把「开始测评」渲染了**两次**，同一个目标 `/assess` 相邻出现两个入口 | `frontend/src/App.vue` L204-210 与 L218-223 两个 `<RouterLink to="/assess">开始测评</RouterLink>`；前者的 `route.name` 高亮判断永远为假（`quizActive` 已经排除 assess / assess-attempt），后者才是原本要删的"旧版本测试"入口残留 | 顶栏出现重复入口；高亮态失效，"我现在在测评页"这件事在导航上不可见 | P2 | 已闭环（见 progress.md 第 1 轮） |
| A2 | 顶栏「关于」与「方法与隐私」两个文案**写反** | `App.vue` L228：`route.name === 'about' ? '方法与隐私' : '关于'` —— 停在关于页时反而显示"方法与隐私" | 导航文案与当前页面不符，用户以为还有第二个页面 | P2 | 已闭环（第 1 轮） |
| A3 | `ink-faint`（#7C8892）作为 12–13px 辅助文字时对比度 **3.35:1**（纸上）/ 3.62:1（白底），低于 WCAG AA 小字 4.5:1 | 计算脚本 `work/verify/contrast.mjs` 输出；`style.css` 的 `.fineprint`(12px)/`.caption`(13px) 与约 40 处 `text-ink-faint` 小字号用法 | 页脚署名、表单辅助说明与**校验错误提示**这类必须读到的字最难读 | P2 | 已闭环（第 2 轮） |
| A4 | 注册时**没有**免责声明同意项，后端也不校验 | `frontend/src/views/RegisterView.vue` 无勾选框；`docs/2026-09-16/verification/browser-acceptance.md` §"未能验证的部分" 1 与 `acceptance-evidence.md` §9.1 实测（`input[type=checkbox]` 为 0）；`RegisterRequest` 无该字段 | 产品方案与"数据存账号里"的告知义务缺一环；历史上有过被误当成已实现的情况 | P1 | 需用户决定（见下） |
| **A5** | **`GET /api/v3/attempts/{id}` 在 H2 上直接 500，答题页整页不可用**（跨库移植性缺陷） | 内存 H2 起真实后端复现：`POST /api/v3/attempts` → 201，紧接着 `GET /api/v3/attempts/{id}` → 500；日志 `java.lang.ClassCastException: class java.sql.Timestamp cannot be cast to class java.time.LocalDateTime`，位于 `AttemptService.detail(AttemptService.java:164)`（修复前）。根因：`queryForList` 走 `ColumnMapRowMapper` → `ResultSet.getObject(name)`，H2 2.x 返回 `Timestamp`、Connector/J 返回 `LocalDateTime`，而代码直接强转。同形写法另有 `ReportService.java:303`（`selfReflection`）与 `:357`（`compare`）。 | **P0**：真实用户在答题页看到「这份测评没能载入：请求 /attempts/xxx 失败（HTTP 500）」且无题可答；旧测试全绿也漏掉了它 | P0 | 已闭环（第 3 轮，含反向验证） |
| A6 | 320 宽窄屏下粘性顶栏占首屏 **24.5%**（报告页实测 139px / 568px） | `scripts/browser-verify-narrow-layout.py` 输出；原因为品牌行副标题 + 三个导航入口同时折行 | 常驻顶栏挤占矮机型首屏 | P2 | 已闭环（第 4 轮，88px / 15.5%） |
| **A7** | **作答中途刷新会回退到已答过的题，第一道未作答的题被"越过去"** | 真实浏览器实测：答到 47/48 时刷新，页面回到第 47 题（脚本 `[3b]` 变红）；`work/debug-resume.py` 请求日志显示前端前进时 PATCH 的 `currentQuestionId` 是**刚答完那一题**，服务端指针一路落后一题，而 `restorePosition()` 却把它当首选落点 | **P1**：断点续答的核心承诺"接着答"失效，用户以为进度丢了；未答题只能靠手动"跳到未答的题"找到 | P1 | 已闭环（第 5 轮，含反向验证） |
| A8 | 注册时的免责声明同意项（原 A4） | 用户 2026-09-17 明确选择"实施" | 告知义务闭环 | P1 | 已闭环（第 6 轮，含契约与 README 同步） |
| A9 | 报告页**没有** AI 分析入口：后端五个端点齐备，前端零消费者 | `frontend/src/` 全文搜 `analyses`/`ai/status` 无命中；`ReportV3View.vue` 无入口。用户 2026-09-17 决定"做"，范围限定报告页生成+展示+失败重试 | 可选能力完全用不上；报告页少一段用户明确要求的视角 | P1 | 已闭环（第 7 轮，真实浏览器 31 项通过） |
| A10 | `scripts/browser-verify-jung-flow.py` 的作答循环偶发停住（复跑时停在 16/48） | 同脚本连跑：一次 FAIL（`/assess/...`，页面 16/48）、一次通过。读按钮状态与真正点击之间隔着一次保存往返，读到"可用"时它可能又变回禁用 | **仅脚本问题**，不影响产品；但会让验收结果忽红忽绿、掩盖真实回归 | P3 | 已闭环（第 7 轮：改成显式等「下一题」恢复可用，修复后连跑 6 次全绿） |
| A11 | `scripts/browser-verify-optimization.py` 的"后端是否就绪"探测**恒为否**：后端明明在跑也一律报 `后端未就绪` 并 SKIP | 实跑输出 `SKIP … （/actuator/health → 0）`，改探 `/api/v3/ai/status` 后变 `→ 401`，改探 `/api/v1/meta` 后变 `→ 200` 却仍 SKIP。三个独立缺陷叠在一起：(1) `vite.config.ts` 只代理 `/api`，`/actuator/health` 落进 SPA 回退拿到 index.html；(2) `browser.new_page()` 停在 `about:blank`，从那里 fetch 一律 `Failed to fetch`；(3) 解析前把响应体截断到 200 字符，截断点正好在 JSON 数组中间，`json.loads` 必然失败 —— 所以**即使后端健康也永远判为不健康** | 这条探测形同虚设：它会掩盖后端真的没起来这件事，让"SKIP"看起来像正常状态 | P2 | 已闭环（第 7 轮：落到站点后探匿名接口 `/api/v1/meta`，解析完整响应体；现在后端就绪时是 PASS 且记录 contentVersion） |
| A12 | 复测比较**整页缺失**，且 `compareReports` 是死代码 | `frontend/src/api/v3Assessment.ts` 里 `compareReports()` 与 `CompareResult` 都已写好，全仓**零消费者**（全文搜 `compareReports` 只有定义处）；`router/index.ts` 无 `/reports/compare` 路由。⚠️ 复核时纠正了 backlog 原先的说法：接口消费者不是"完全没有"，而是"有客户端、没有页面" | 后端能力白做；已写好的客户端代码无人调用，将来会被当成"没实现"再写一遍 | P2 | 已闭环（第 8 轮，真实浏览器 28 项通过） |
| A13 | 管理后台 AI 设置页整页缺失，`AdminController` 的四个端点在前端**零消费者** | 全文搜 `/admin/ai-settings`、`fetchAdminUsers` 只命中后端与契约；`router/index.ts` 无 `/admin` 路由；`AccountView` 无入口 | 后台能力只能靠环境变量 + 重启使用；`apiKey` 轮换要动部署配置 | P1 | 已闭环（第 9 轮，真实浏览器 31 项通过） |
| A14 | 后台**表单数字字段填不进值**（`readPositive` 直接 `.trim()`） | 新增 `AdminView` 的第一版：`type="number"` 的输入框在真实浏览器与 jsdom 里都会把 `v-model` 值算成 **number**，于是 `raw.trim is not a function` 抛出，被 `catch` 吞成"保存失败"。是 `adminView.spec.ts` 里"把 maxTokens 改成 2000"这条普通路径先撞出来的；`vue-tsc` 看不出来（字段声明为 string） | 管理员改任何一个配额都会看到"保存失败"，且原因被错误提示掩盖 | P1 | 已闭环（第 9 轮：`readPositive` 按运行时事实收 `unknown` 并先 `String(...)`） |
| A15 | **管理员在后台保存的 apiKey，AI 模块永远读不到**：`SecretCipher` 只有接口、没有实现 | `com.typeme.ai.port.SecretCipher` 全仓仅接口定义，无实现类、无测试（`grep SecretCipher backend/src` 只命中接口与注入点）；后台写入侧 `AiSettingsService` 用 `TextEncryptor`（`Encryptors.delux` + `typeme.security.settings-secret` 派生盐）加密落库，读取侧 `AiRuntimeSettingsProvider` 解密只能靠注入该 port，拿不到就回退环境变量并只打一条 WARN。复现：`AdminAiKeyReachesAiModuleIT` 走真实写入+真实读取路径，修复前 `Tests run: 3, Failures: 2`（bean 为 null；`hasApiKey()` 为 false） | 管理员填完 key、页面显示"已保存"、指纹也变了，但创建分析返回 503 `AI_NOT_CONFIGURED`；**用户按提示做完了每一件事，系统却说他没配**。两个模块各自的测试都是绿的，所以单边测试永远发现不了 | P1 | 已闭环（第 10 轮：新增 `security/SecretCipherConfig` 提供实现；真实调用 PASS 30/0） |
| A16 | 后台**保存设置后 10 秒内仍按旧配置跑**：`AiRuntimeSettingsProvider.invalidate()` 存在但无人调用 | `invalidate()` 只改 `cachedAt`，全仓无调用方；生效设置缓存 `CACHE_TTL = Duration.ofSeconds(10)`，写入方 `AiSettingsService.update()` 保存后不通知读取侧 | 把「演示模式」关掉保存、立刻点生成分析，仍按 mock 配置跑 —— 不报错，只给出"看起来正常但用的是上一版配置"的结果。这类静默错配比报错难发现得多 | P2 | 已闭环（第 10 轮：新增 `AiSettingsCacheInvalidator` port 避免 account→ai→account 环路；保存后立即失效；用例先灌缓存再改、中间不 sleep） |
| A17 | `browser-verify-ai-analysis.py` 的 `result.json.**aiMock` 恒为 `true`，与实测相反 | `finally` 分支写死 `report(None, username, True, True)`；真实模式下观察记录写着 `mock=False`、断言也走真实分支，但产物字段是 `True` | 任何依据该字段判断"这份结果是不是演示数据"的人都会被误导；真实调用的证据会被记成"演示数据"。另外 `mock` 专属断言（必须出现「演示数据」标注）在真实模式下必然 FAIL，使这条脚本无法用于真实验收 | P2 | 已闭环（第 10 轮：改用 `/ai/status` 实测值；mock 断言按模式改判；已更正本次产物并说明原因） |
| A18 | 四个**会真实落库**的 AI 错误码在前端没有专门说法，落进万能兜底：`UPSTREAM_401` / `UPSTREAM_402` / `UPSTREAM_429` / `UPSTREAM_5XX` / `UPSTREAM_UNAVAILABLE` / `UPSTREAM_ERROR` 只覆盖了最后一个 | 后端 `DeepSeekException.Codes` 声明了 12 个任务失败码，前端 `aiFailureHint` 的 `switch` 只 `case` 了 8 个，其余走 `default`。两侧都"有测试"：后端用例只断言"库里存了这个码"，前端 `default` 分支也会成功给出一句话 | **管理员 key 失效（401）或余额不足（402）时，用户看到的是"这次生成没有成功，可以重试一次"** —— 而重试一万次也不会成功，真正该做的是换 key / 充值。用户会一直点重试，问题永远不暴露给能修它的人 | P1 | 已闭环（第 11 轮：补 6 个分支；401/402 明说"需要站点管理员处理，你自己重试没有用"） |
| A19 | 上述漂移**没有任何机制守着**：后端新增一个错误码，不会让任何测试变红 | 无跨端契约测试；Java 与 TypeScript 之间没有共享常量，两侧的码清单只能靠人眼比对 | 这类漂移天生单边测不出来（见 A18），下一次新增码会原样重演 | P2 | 已闭环（第 11 轮：`AiErrorCodeContractTest` 直接读 `frontend/src/api/v3Ai.ts` 的 `case` 分支机械对账；先删一个 case 验证它会红，再恢复） |
| A20 | 跨设备冲突横幅**只写"有改动没写上去"，不说丢的是哪一题、自己选了什么** | `ConflictState.pendingQuestionIds` 的注释写着"（重新载入后可以对照查看）"，但全仓**只写不读**（`grep pendingQuestionIds` 只有定义处与赋值处）。`reloadLatest()` → `reload()` → `applyDetail()` 会整体替换 `this.answers`，本地那条未写上去的作答就此消失 | 用户看到"本机刚才的改动没有写上去"却无从核对是哪一条；点一下「载入最新进度」后连自己刚才选过什么都不确定，无法在载入后把那题补回来。**不是静默丢，但是"不可核对地丢"** | P1 | 已闭环（第 12 轮：新增 `ConflictState.lostAnswers`，横幅逐条列出「第 N 题 · 档位文案」；真实浏览器双上下文制造 409 验证 22 项通过） |
| A21 | 五档文案 `SCALE_CAPTIONS` 只存在于 `AssessView.vue`，store 若也要用就会各写一份 | 冲突横幅要显示"用户当时选的那一档"，文案来源必须在 store 与页面之间共享 | 两代产品各说一套话（`ANSWER_CAPTIONS` vs `SCALE_CAPTIONS`）是历史上已经踩过的坑；同代再分叉一次会以同样方式出问题 | P3 | 已闭环（第 12 轮：提到 store 作为唯一来源，`AssessView` 改为 import） |
| A22 | `app_user_session` **没有批量过期清理**：过期后再未回访的会话行永久残留 | 删行只发生在注销（`deleteByUserId`）、禁用、改密码（`deleteBySessionId` / `deleteByUserIdExcept`）以及"已过期会话再访问一次"时（`SessionAbsoluteTtlFilter:88-93` 把删除当副作用）。容器侧闲置超时（`server.servlet.session.timeout=2h`）**不碰这张表**；全仓无清理型 `@Scheduled`（只有 `AnalysisWorker` 与 `AccountDeletionService` 两个） | 表会随"注册一次就不再回来"的账号无界增长；`SessionAbsoluteTtlFilter` 每个已认证请求都要按 `session_id` 主键查一次这张表，行数越大占用越多 | P3 | 用户 2026-09-17 选择"收进 backlog 先不动"：当前量级下影响可忽略，且清理策略（定期任务 vs 惰性删除）需要单独决策 |
| A23 | **Redis 作为后续架构项**（用户 2026-09-17 明确选择保留） | 现状：会话走容器 `HttpSession` + `app_user_session` 绝对期限账本（每请求 1 次主键 SELECT，`SessionAbsoluteTtlFilter:86`）；`SessionRegistryService` 用**进程内** `ConcurrentHashMap`；限流/额度用 MySQL 事务；AI 任务队列用 DB lease + 2s 轮询。**Redis 在本版没有落点**：单体单实例，"跨实例共享会话"这个最大卖点用不上；而上多实例时它会真正成为必需 | 若将来水平扩展，需要 Redis 的三处：① 会话（替换进程内 registry）② 限流/额度（注意：这里是**一致性**而非性能问题，切换要先定"以谁为准"）③ AI 任务队列（替换 DB lease）。本版不动代码 | P3 | 仅记录（架构评估，未实施） |
| A24 | **是否引入 LangChain4j**（用户 2026-09-17 询问） | 核实结论：**不建议**。① 开发提示词第 40 行是硬边界"不引入独立 AI 框架"；② 现有 `HttpDeepSeekClient`（约 200 行）已承载领域语义：`thinking.type=disabled`、`response_format=json_object`、不跟随重定向（避免把 `Authorization` 带去非预期主机）、401/402/429/5xx 分码、`Retry-After`（秒数与 HTTP-date 两种形态）、以及**缓存命中/未命中 token 分开**（`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`）—— 后者正是 `AiCostEstimator` 的计价输入（`AiCostEstimator:42-44`）。LangChain4j 的 `TokenUsage` 在部分 provider 上缺缓存 token 字段（见 [issue #4067](https://github.com/langchain4j/langchain4j/issues/4067)、[PR #4080](https://github.com/langchain4j/langchain4j/pull/4080)），换过去可能**丢**这个能力；③ 框架主要省的是"模型适配 + tools/RAG/memory"，而本项目不用 tools、知识来自固定内容包、记忆不需要 —— **省的是用不上的那部分**，要付的是新依赖 + 又一次框架迁移 | 若仍要推进：做限时 PoC，验收口径是"不丢缓存 token 计价、不丢 401/402/429 分码与 Retry-After、不丢 幂等/预算/lease"，并保留回退 | 待用户决定（默认：不引入） |
| A25 | **发给 AI 的每条证据都在撒谎**：`contribution()` 因缺字段静默返回 0，导致每题位置都被写成"选了中间（两边差不多）" | `packageQuestions()` 重建题目节点时只放 `id/scenario/leftPole/rightPole/order`（注释写明"只带最小必要字段"，因为已按维度分组），而 `contribution(JsonNode, int)` 却从节点读 `dimension`，读到 null 即 `return 0`。后果有三层：① 每条证据文本都是"中间档"，模型读到的是**伪造的位置**（rating=5 也写"两边差不多"）；② `bestSameDirection`（只认 \|c\|≥1）与 `strongestOpposite`（显式跳过 c==0）**永远返回 null**；③ 补足名额的 `|c| 降序` 退化成按 `order` 升序 —— 即"证据"变成**按题号取前 8 条**，与答题内容无关。**实测对比**（同一夹具）：缺陷版 `EI-01…EI-08` 全是"中间"；修复版为 `EI-01(c=2 很靠右) / EI-11(c=-1 反向) / EI-05(c=0 真的中立)`。它长期绿着的原因：既有测试对证据文本**只有一条否定断言**（`AnalysisFlowTest:574` 断言不含题干），**没有任何一条检查位置文案** | P1（AI 输入质量，非页面崩溃） | 已闭环（第 14 轮：`contribution` 改为显式接收维度；边界维度补一条"真的中立"证据；新增 5 条测试并逐条验证先红后绿） |
| A26 | 提示词文件与 `prompt-version` 的一致性**只靠人眼** | `SystemPrompt.load` 按 `ai/prompts/<version>.txt` 找文件、缺失即抛；文件第一行的版本标记"便于人工核对"。改文件名、改第一行、或配置默认值写成不存在的版本，都只在**真正发起分析**（用户正在等结果）时才暴露 | P3 | 已闭环（第 14 轮：`PromptFileContractTest` 3 条断言；已用"改坏第一行"证明它会红） |
| A27 | `AiAnalysisPanel` 依赖一个**隐式**前提才不串台 | 面板只在 `onMounted` 里 `ai.loadJobs(props.reportId)`，**没有** `watch(() => props.reportId)`；父组件用 `v-if="reportId"` 挂载它。之所以现在正确，是因为报告正文包在 `<template v-else-if="view">` 里、换报告时 `reports.loading` 置位导致整块**销毁重建**。第 14 轮用真实浏览器（`browser-verify-history-ai.py`，PASS 18/0）证实当前**不串台**，但这条保护是隐式的：若有人把加载态改成"保留旧内容 + 局部骨架屏"（常见体验优化），面板就会开始显示**上一份报告**的分析，而且 `onBeforeUnmount` 的 `stopPolling` 也不会触发（后台会继续每 3 秒轮询）。**注意**：本轮初版脚本只数 `data-ai-job` 的个数，**那个断言抓不住这个 bug**（"1 个任务"无法区分是哪一份的）；已补 `data-ai-job-id` 并改为对比 jobId | P2（当前行为正确，但是**脆的**） | 未闭环（有意不改：现行为有真实浏览器断言守着，改动收益小于引入风险）。建议将来若要动加载态，一并加 `watch(() => props.reportId)` |
| A28 | **导出把失败伪装成"你没有这部分数据"**：`safeQuery` 吞掉一切 `DataAccessException` 返回空数组，响应无任何标记 | 账号页在导出成功时说「报告与 AI 分析记录**都在里面**」，同页注销区写着「注销会删除你的全部测评记录与报告，无法恢复……导出数据是**唯一**能把它们带走的办法」。于是报告查询一旦失败（缺列、连接抖动），用户拿到一份**看起来完整**的备份、按指引注销，没导出到的部分**永久丢失且事后无从发现**。日志也只记异常类名，连哪一段失败都看不出来 | **高** | **已闭环（第 15 轮）**：响应新增 `degradedSections: [{section, reason}]`；缺表（部署未就绪）与查询失败分开报且都用段名；前端非空时不说"都在里面"，改说"不是完整备份，先不要注销"，并在注销区重复。证据 `verification/2026-09-17-export-degraded/`（PASS 19/0，含文件里确有该字段） |
| A29 | **保存失败被下一次成功掩盖 → 作答静默丢失**：`flush()` 每次只发当前一条，失败只置 `saveState='error'`，下次成功**无条件**置回 `'saved'` | 场景：答 Q10 时 PATCH 超时 → 继续答 Q11 成功 → 界面显示「已保存」，而 Q10 在服务端从未存在，刷新后回到未作答。且 `assessment.lastError` 在整个 `AssessView` 里**从未被渲染**，用户只看到「未同步（网络或登录已失效）」，连真实原因都丢掉 | **高** | **已闭环（第 15 轮）**：store 新增 `unconfirmed`（本地改了、服务端未确认的作答），下次写入一并重发（服务端 upsert 无副作用），集合非空时不允许回到 `'saved'`；页面新增「未同步（N 题的作答还没写上去）」+ 真实原因 + requestId + **重试保存**按钮。判别力已验证：去掉重发逻辑精确红 2 条 |
| A30 | **NEEDS_REVIEW 是一页死路**：`jumpToFirstUnanswered()` 在 `unansweredBaseIds` 为空时**静默返回** | 而 `finishStage()` 只在本地没有未答题时才调 `runReview()`，所以走进 needs-review 时"未答清单"通常必然是空的 → 点「回到未答的题」零反应，用户只能刷新页面才出得来。`insufficientDetails()` 其实已经算出是哪一维短了 | **高** | **已闭环（第 15 轮）**：按"用户能做什么"排优先级（真有未答题→去那一题；否则去覆盖不足那一维的第一道主测题），并据情况把文案改成「回到题目继续调整」。判别力已验证：恢复早期 return 精确红 1 条 |
| A31 | **进入补充题后无法返回主测**：跳过按钮只在 `clarify-offer` 那一步存在 | 契约把「跳过补充题」写成用户可选的动作，但一旦点了「开始补充题」就只能把补充题全部答完；刷新也会被 `restorePosition()` 重新落回补充阶段 | 中 | **已闭环（第 15 轮）**：补充阶段保留「回到主测改答」与「跳过补充题，直接交卷」两个出口 |
| A32 | **会话失效时答题页无回路**：只给「请先登录」+一个必然失败的「重试」 | 答题页在 `App.vue` 里隐藏了常规导航（`quizActive`），登录入口只在 `v-else` 分支渲染，所以页面上**没有任何能走通的操作**；`AssessView` 也没用过 `isSessionExpired` | 中高 | **已闭环（第 15 轮）**：识别 `UNAUTHENTICATED`，给出「去登录，然后接着答」（路由守卫本就支持 `redirect`），并不再为这种情况提供「重试」 |
| A33 | `AttemptService.patchAnswers` 的冲突检测**比正确做法弱**：丢弃 UPDATE 受影响行数，改用"另查一次 `COUNT(*) WHERE revision = 新版本号" | 那个 COUNT 只能证明**有人**把 revision 推到了该值 —— 真并发时另一个请求的提交也会被数进去，于是"自己一行都没改到"会被判成 200。正确做法是用 UPDATE 的受影响行数。**注意**：我为此写的串行测试**通过了**，反证了我最初"串行即可复现"的推断是错的；真并发窗口在 H2 + MockMvc 下无法确定性构造 | 中（真并发下才显现） | **未闭环（有意不改）**：无法确定性复现，且改动触碰乐观锁这一核心不变量（草稿遵守 `expectedRevision` 与 409 语义）。建议将来用真 MySQL 并发测试或注入延迟来证实后再动 |
| A34 | `ReportService` 在覆盖检查**之前**就写 `clarification_skipped = 1` | 一次因覆盖不足返回 NEEDS_REVIEW 的提交会把草稿**永久**标记为"已跳过补充题"，之后带补充题答案的提交会撞 400。要真撞上需要覆盖率在 review 与 submit 之间由 ok 变回不 ok，而当前 UI 没有回退覆盖的路径（patchAnswers 只增不删主测答案） | 低（当前不可达） | **未闭环（无法构造触发路径）**：记录在案，等 UI 出现"可以删掉已答主测题"的能力时再复核 |
| A35 | `POST /attempts` 未兑现 `Idempotency-Key`，前端 `createKey` 是**死字段** | 契约 02 §7.2 写"可选 Idempotency-Key"，`JungController` 没有 `@RequestHeader`；`assessmentV3.ts` 的 `createKey` 只被置 null，从不写入/读取。create 丢响应后点「重试」会新建第二份草稿。当前前端没有任何 `fetchAttempts` 调用点、没有草稿列表，所以用户暂时看不到 | 低（用户不可感知） | **未闭环（有意不改）**：修它要同时动后端契约与前端 store，收益取决于将来是否做草稿列表 |
| A36 | **恢复码重新生成：201 但响应里没有码时页面零反馈，而旧码已作废** | `readStringList` 把字段缺失读成"正常空数组"；`AccountView` 的恢复码区只在 `recoveryCodes.length` 时渲染，密码框还会被清空。而服务端在返回 201 前已经 `revokeAllUsable` + `bumpRecoveryCodeVersion` —— 用户看不出发生过任何事，也不会去抄新码，等于无提示地丢掉全部恢复码。注册页对**同一个字段**有显式处理（`codesMissing`），这里没有 | 中（需响应缺字段才触发） | **已闭环（第 15 轮）**：新增 `readRecoveryCodes(value, required)`。重新生成时 `required=true` —— 码为空就抛 `UNEXPECTED_RESPONSE`，文案说清"旧码可能已作废、请重新生成并当场抄下来"；注册时 `required=false` —— 账号已经建好，因缺字段把注册判成失败会让用户去重试一个已被占用的用户名，所以照样进下一步、由页面的 `codesMissing` 另行提示。两处期望**故意相反**，`v3RecoveryCodes.spec.ts` 把两边都钉住（判别力已验证：去掉守卫精确红 3 条、注册那条仍绿） |
| A37 | **注销清理吞掉真实数据库异常并把任务标记为 DONE** | `deleteUserScoped` 把所有 `DataAccessException` 吞成 WARN，`cleanup()` 七步后无条件 `return true`，于是 `AccountDeletionService` 必然 `markDone`。清理中途一次真实 DB 失败 → 数据不删、任务却 DONE 且不再重试；此时账号已 DISABLED、用户名已改写，用户**再也登录不进去也无法重发**，而页面承诺的是"正在被删除" | 中（条件触发，但后果是个人数据永久留存） | **未闭环（有意不改）**：需要把"缺表（部署未就绪，可跳过）"与"删除失败（必须重试）"分开，让 worker 走 `markFailed`。属账号删除链路，改动面比本轮其他几项大，建议单独一轮做 |
| A38 | 账号页丢弃 `serverMessage`：改密/生成恢复码/注销输错当前密码时显示「用户名或密码不对」 | `INVALID_CREDENTIALS` 的映射文案是给登录页写的，而这三个表单里根本没有用户名字段；后端给的精确说法"当前密码不正确。"被这一页丢掉（登录/注册/恢复三页都渲染了"服务器说明"） | 中低 | **未闭环（有意不改）**：最小改动是补一行 `v-if="error.serverMessage"`，但属文案一致性，优先级低于上面几条 |
| A39 | 账号页六个区块里只有「修改密码」是主色按钮，其余都是次级按钮 | 第 16 轮视觉对齐：`AccountView.vue` 的按钮层级由子代理保留原样（它被授权只做布局）。这一页本身没有单一主行动，所以保留层级是合理的；但"一页一个主色按钮"是本站其它页面的口径 | 低 | **未闭环（需产品判断）**：要么把「修改密码」也降为次级，要么接受账号页是"多主行动"页面 |
| A40 | 提示与按钮间距在页面之间不统一（账号页 `mt-3`、对比页 `mt-4`） | 第 16 轮实测：两页在最窄 320 下都无溢出、无遮挡，纯粹是节奏差异 | 极低（无功能影响） | **未闭环（有意不改）**：等下一次动这两页时一起收口，避免为统一间距产生无意义的 diff |


## 历史缺口复核（线索 → 现状）

| 线索（历史文档） | 复核结论 | 状态 |
|---|---|---|
| 首页下半部分仍由旧内容包驱动（`大五`/`50 题`） | **已不成立**。`LandingView.vue` 整页口径唯一来自 `instrumentV3.facts`（`GET /api/v3/catalog/current`，离线退新测内置口径）；该文件里剩余的"大五"只出现在解释历史的注释中 | 已闭环 |
| 小字号对比度 3.35–3.62:1 | **仍成立**，见 A3 | 已闭环（第 2 轮） |
| AI 分析前端界面缺失 | **已不成立**：`api/v3Ai.ts` + `stores/aiAnalysisV3.ts` + `components/AiAnalysisPanel.vue` 已接入报告页，真实浏览器验证 31 项通过 | 已闭环（第 7 轮） |
| AI 管理员后台配置页 | **已不成立**：`api/v3Admin.ts` + `views/AdminView.vue` + `composables/useAdminProbe.ts` 已接入；普通账号看不到入口、直接访问得到权限说明。真实浏览器验证 31 项通过（分两段：重启后端引导管理员） | 已闭环（第 9 轮） |
| 报告对比视图缺失（`GET /reports/compare`） | **原表述不准确，已纠正**：客户端 `compareReports()` 与 `CompareResult` 早就写好了，缺的是**页面与路由**（见 A12） | 已闭环（第 8 轮） |
| 答题页离线 outbox | **仍成立**：断网时作答不进队列 | 仅记录（需产品决定是否要"离线可答"） |
| 320×720 首屏放不下答题操作区 / sticky 顶栏占 19% | **已复核并修复**：320×568 上首页/登录/注册/关于顶栏均为 88px（15.5%），最差的历史值出现在**报告页**（139px / 24.5%，三个导航入口都在时）。修法是窄屏隐藏品牌行副标题。注意：这个数字是 **320 宽**机型的最差情况，390 宽起是 69–91px | 已闭环（第 4 轮） |
| 独立分享卡片模块（`utils/shareCardV3.ts`） | 代码组织问题，`shareImage.ts` 已存在且被复用；无用户可见影响 | 仅记录 |

## 需用户决定的事项

| ID | 事项 | 事实 | 建议 |
|---|---|---|---|
| A4 | 注册页是否必须勾选免责声明/条款同意 | **用户 2026-09-17 已决定：实施**（勾选框 + 服务端校验 + 契约同步）。见 progress.md 第 6 轮 | 已闭环 |
| — | AI 分析前端界面是否本轮做 | **用户 2026-09-17 已决定：做**，范围限定"报告页生成分析 + 展示 + 失败重试"，不做管理员配置页 | 已闭环（第 7 轮） |
| — | AI 管理员后台配置页是否要做 | **用户 2026-09-17 已决定：做**。已完成（第 9 轮）：只做 AI 设置读写 + 只读账号概览；改角色/禁用按"不可逆操作需单独确认"暂不开放入口 | 已闭环（第 9 轮） |
| — | 后台是否开放"改角色 / 禁用账号" | 后端 `PUT /admin/users/{id}/role`、`POST /admin/users/{id}/disable` **早已实现且被测试覆盖**，但前端未接。禁用会撤销对方全部会话、把账号置为不可登录，属不可逆操作 | 待用户决定（本轮只做了只读概览） |
| — | 是否需要可审计的同意/设置变更台账 | 目前注册同意只进服务端日志、AI 设置变更只有 `updated_at/updated_by` 两列；要做完整审计需加表/加列（DDL，需授权） | 待用户决定 |
| — | 是否引入 Redis | **仓库已有明确否决结论**：开发提示词第 40 行把"不引入 Redis/MQ/向量库"写成硬边界；`docs/2026-09-16/implementation/README.md` §6.3 专门讨论过（Redis 在本机可用但未采用，理由是"限流与额度已用 MySQL 事务保证一致性，多一个状态源就多一类两边对不上"）。**用户 2026-09-17 明确选择：作为后续架构项保留**（不改本版代码） | 见 A23 的架构评估；本版不动代码 |
| — | 是否引入 LangChain4j | **同一硬边界**（"不引入独立 AI 框架"）。用户 2026-09-17 询问；核实后建议**不引入**，理由见 A24。若仍要推进，建议做限时 PoC 并保留回退 | 待用户决定（默认：不引入） |
| — | 登录会话表缺少过期清理 | 见 A22。用户 2026-09-17 选择"收进 backlog 并先不动" | 仅记录（已知且可接受） |
