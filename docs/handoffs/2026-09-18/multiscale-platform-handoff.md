# TypeMe 多量表平台化 移交

> **后续更新（2026-09-18）**：下文保留移交时的历史状态；AI 通俗契约、大五 AI 支持、通用报告链接分流和易读文案接入已在续作中实现。大五范围说明已查出错误并修复，不能继续引用本文的旧范围判断。以 [续作实施与验收](../../optimization/verification/2026-09-18-readable/REPORT.md) 为本轮代码与验证依据；其中单独列出尚未验证的真实 AI、MySQL 与真人试读。

> 移交时间：2026-09-18 · 仓库：`D:/develop/develop/code/TypeMe`（git，最新提交 `10fc466`）
> 状态：**PartiallyComplete** · 本轮没有被 commits，工作区里有大量未提交改动（见"当前工作区"）

## 目标与边界

- **原始目标**：把只有十六型的单量表站点改成**多量表测评平台**，首批完整支持
  「十六型人格参考测评」（`jung48`，48 主测题 + 最多 16 补充题）与「大五人格倾向测评」
  （`bigfive50`，IPIP-50，50 题）。解决三件事：① 题目难懂、看不出两个选项在比什么；
  ② 固定报告满是术语；③ AI 分析又长又抽象。**要真代码、真内容、真页面，不要只重写方案。**
- **当前授权**：用户 2026-09-18 说"全部允许"——包含数据库写入/迁移、启动后端到现有库、
  真实 AI 调用。但以下仍需**逐项**确认，不要当成已授权：
  - **真人可用性访谈**（题面可读性）——不能伪造，只能记为待办；
  - **阈值政策选值**（0.20 vs 0.10，见 `阈值政策对比与决策请求.md`）——这是业务决定，不要替用户选；
  - **提交/推送/发布/部署**——本轮一次都没做，也没被要求。
- **禁止事项（沿用仓库规则，未被"全部允许"覆盖）**：不得删除/覆盖/重写用户既有未提交工作；
  不得暴露密码、token、cookie、恢复码、连接串；不得把测试通过说成信度或效度验证；
  不得为了让测试变绿而放宽业务断言。

## 已完成与当前工作区

### 本届（第 20 轮）已证实的工作

| 做了什么 | 位置 |
|---|---|
| 修掉"平台层前端一条请求都发不出去"（`BASE` 多了一段 `/api/v3`） | `frontend/src/api/platformV3.ts` |
| 修掉"大五报告一份都生成不出来"（护栏把正常文案当违规） | `backend/src/main/java/com/typeme/ipip/report/BigFiveReportBuilder.java` |
| 修掉"报告详情 100% 500"（`(String)` 强转 `DATETIME` 列） | `backend/src/main/java/com/typeme/platform/service/PlatformQueryService.java` |
| 大五报告请求 AI 从 500 改成明确的 400 `UNSUPPORTED_INSTRUMENT` | `ai/config/AiException.java`、`ai/input/ReportInputBuilder.java` |
| 多量表前端全部页面 + 路由 + 两个 store | `frontend/src/views/`（`InstrumentsView`/`InstrumentMethodView`/`AssessChooserView`/`AttemptRouterView`/`BigFiveAssessView`/`BigFiveReportView`/`ReportsListView`）、`stores/bigFiveV3.ts`、`stores/instrumentsV3.ts` |
| 方法说明页换 slug 不重载（浏览器实测发现）+ 请求令牌防后发先至 | `frontend/src/views/InstrumentMethodView.vue` |
| 方法说明页补"结论长什么样"（大五没有类型码/总分） | 同上 |
| 平台层端到端测试 | `backend/src/test/java/com/typeme/platform/BigFivePlatformIT.java`（10 条） |
| API 层第一组测试 | `frontend/src/api/platformV3.spec.ts`（11 条） |
| 三个页面/组件测试 | `bigFiveAssessView.spec.ts`（8）、`assessChooserView.spec.ts`（7）、`instrumentMethodView.spec.ts`（8） |
| 真实浏览器验收脚本 + 证据 | `scripts/browser-verify-platform.py`、`docs/optimization/verification/2026-09-18-platform/` |
| 台账与说明更新 | `docs/optimization/progress.md`（第 20 轮）、`docs/optimization/backlog.md`（A60–A71）、`README.md` 顶部、`frontend/package.json` description |

### 当前工作区 / VCS 状态

- `git status --short`：**107 项**，其中 **53 个已跟踪文件被修改**，其余为未跟踪（含本轮新增目录）。
  最新提交是 `10fc466`，**本轮没有任何 commit / push**。
- **重要**：本轮开始前工作区就已经有 39 个已修改文件与大量未跟踪文件（用户既有工作）。
  这些既存改动**不是**本轮产物，也不得回退；要区分"我改的"与"原本就在的"，用 `git diff` 逐个看。
- 删除过本会话产生的临时文件（`backend/bigfive-it-out.txt` 等）；仓库根目录另有 5 个
  `2026-09-17` 的 `*.txt` 日志，那是用户既有文件，**没有动**。
- 后端与前端服务**当前都已停止**（8080 已验证不再监听）。
- 数据库：`typeme_dev`（本机 MySQL 8.4）。本轮启动过后端，Flyway 校验 8 个迁移、**已在版本 8、无新迁移**。
  副作用只有本轮浏览器验收造的**一次性合成账号与它们的报告**（账号名形如 `plat_xxxx`）。

### 验证（都是本轮实际执行的）

| 命令 | 结果 |
|---|---|
| `mvn.cmd -o test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT'`（backend，需 `JAVA_HOME=D:\develop\jdk-21`） | **Tests run: 313, Failures: 0, Errors: 0, Skipped: 1**，BUILD SUCCESS |
| `npm.cmd run typecheck`（frontend） | exit 0 |
| `npm.cmd test`（frontend） | **Test Files 36 passed / Tests 894 passed** |
| `npm.cmd run build`（frontend） | exit 0（css 56.98 kB / gzip 9.96；js 577.80 kB / gzip 214.25） |
| `node scripts/gen-platform-content.mjs --check` 等 5 条内容脚本 | 全部 exit 0 |
| `python scripts/browser-verify-platform.py`（需后端在 8080 上跑） | **PASS 64 / FAIL 0 / SKIP 0**；在**最终代码**上跑过两轮 |

## 证据边界

- **已证实（本轮亲自执行并可重跑）**：上表全部命令与结果；三个 P0 缺陷的根因
  （`/api/v3/api/v3/...` 404、`IllegalStateException` 护栏误拦、`ClassCastException: Timestamp`）；
  A69 在真实浏览器里数出 "5 个维度"、去掉 watcher 后测试精确变红。
- **仅由本移交声明、接手方未复核**：`git status` 的 107/53 项拆分、"副作用只有合成账号"、
  "8080 已停止"——这三条请用只读命令自核。
- **推断（有依据但未直接验证）**：
  - 大五的中点必须取服务端值（`midpoint`），不能用 `(rangeLow+rangeHigh)/2`——ES 是 6–50，
    两端平均是 28 而中点是 30。已写进前端模型与一条 API 层测试。
  - `assessment_report.computed_type_code` 的 CHECK 只允许 16 个十六型编码或 NULL，
    因此大五必须用 NULL，这是数据库层约束而非选择。
- **待确认 / blocker**：
  1. **AI 通俗化输出契约完全没动**——三个核心诉求里唯一未兑现的一项。现状：`typeme-ai-prompt-v2.txt`
     要求 800–1200 字、`ReportAnalysisValidator` 校验 9 条、`schemaVersion` 固定 `"1"`。
     目标契约方案已写好：`docs/2026-09-18-platform-plan/题目报告与AI易读性改造.md` §4
     （新 schema `analysis-readable-v2`；`summary` / `observations[]`(含 `plainText`/`example`/`evidenceIds`)
     / `suggestedAction` / `limitations[]`；**初始编辑目标 250–450 字**；新 promptVersion 去掉正文最低字数；
     通俗模式输入默认**不含** `processLayer`；语义来自审核后的 `itemMeaning` 与真实答案）。
  2. **大五的 AI 解读只是"明确拒绝"**，能力本身没做。
  3. **阈值决策 0.20 vs 0.10** 仍在用户手里。
  4. **真人试读/信度效度证据为零**；所有题面仍是 `draft_review_pending`。
  5. **浏览器验收未覆盖**：409 真冲突（两个浏览器上下文）、报告删除、AI 解读面板、十六型补充题轮次。
  6. 已知小坑（本轮有意未改）：用旧的 `/reports/{reportId}` 路径打开大五报告仍会渲染
     `ReportV3View`；列表生成的链接是对的（会去 `/reports/big-five/{id}`），改它会碰到 `reportV3View.spec.ts`。

## 接手入口

- **先核验（按这个顺序，能最快裁决下一步）**：
  1. `docs/optimization/progress.md` 的"第 20 轮"章节 + 文件末尾"当前汇总（截至第 20 轮结束）"——
     它写明本轮闭环了什么、缺什么；若与代码冲突，**以代码为准**。
  2. `docs/optimization/verification/2026-09-18-platform/REPORT.md`（含"诚实交代"）——
     浏览器验收到底验了什么、没验什么。
  3. `docs/2026-09-18-platform-plan/题目报告与AI易读性改造.md` §4——下一件事的目标契约。
- **可立即推进（无需再问，前提是先用只读命令核对现状）**：
  - **主行动：落地 `analysis-readable-v2`**。它必须**一次贯通**：新 prompt 版本 + 输入投影
    （通俗模式去 `processLayer`、补审核过的 `itemMeaning`）+ 输出 JSON schema + `ReportAnalysisValidator`
    + 前端模型与渲染；**旧分析记录（schema 1）必须继续可读**。完成判据：旧记录在报告页仍能正常渲染；
    新记录字段齐全且长度落在目标区间；结构校验失败时按现有失败反馈处理，**不展示半份伪造成功结果**。
  - 并列可做（互不覆盖）：给 `api/v3.ts` 补 API 层测试（`platformV3.ts` 已有，其它模块仍为零）；
    浏览器验收扩到 409 真冲突与报告删除。
- **依赖关系**：AI 契约是单条主线，不建议并行拆给两个人（提示词/投影/schema/校验/前端六处必须同版本）。
- **在途工作**：无。本会话没有派发子 Agent，没有未收的后台任务。
- **需要时再扩展**：真实 AI 调用已获授权（"全部允许"），但要自己控制成本与数据范围；
  真实 MySQL 并发测试（3 个 `*MySqlIT`）会自动建库/删库，跑之前想清楚目标库。

## 最小证据索引

- `docs/optimization/progress.md`（第 20 轮 + 当前汇总）——本轮唯一完整叙事，含"没做到"清单；**先读这个**。
- `docs/optimization/verification/2026-09-18-platform/REPORT.md` + `result.json` —— 浏览器验收的原始判据与诚实交代。
- `docs/2026-09-18-platform-plan/题目报告与AI易读性改造.md` —— 下一件事（AI 通俗化）的目标契约，§4 是字段与字数。
- `docs/2026-09-18-platform-plan/阈值政策对比与决策请求.md` —— 唯一还等用户决定的技术政策。
- `backend/src/test/java/com/typeme/platform/BigFivePlatformIT.java` —— 大五端到端不变量（幂等、无类型码、
  全「说不好」不给方向、越权 404）都在这里，比读实现快。
- `frontend/src/api/platformV3.ts` 顶部关于 `BASE` 的注释 —— 说明为什么路径必须相对；配套测试在
  `frontend/src/api/platformV3.spec.ts`。
- `frontend/src/views/InstrumentMethodView.vue` 的 `load()` 与 `watch(slug)` —— A69 的修法与理由。
- `scripts/browser-verify-platform.py` —— 想把浏览器验收扩到别的页面，照这个骨架改。
- `AGENTS.md` —— 仓库协作规则、验证命令入口、权限边界（**接手前必读**）。

## 可复制提示

```text
请先阅读 docs/handoffs/2026-09-18/multiscale-platform-handoff.md，然后核验"最小证据索引"的首要材料
（docs/optimization/progress.md 的第 20 轮章节与当前汇总），再用只读命令自核工作区状态
（git status --short、8080 是否监听），再开始推进。

本轮主线是一件未完成的事：落地 AI 通俗化输出契约 analysis-readable-v2
（见 docs/2026-09-18-platform-plan/题目报告与AI易读性改造.md §4）。它必须一次贯通
提示词 + 输入投影 + 输出 schema + ReportAnalysisValidator + 前端模型 + 渲染，
并且旧的 schema 1 分析记录必须继续可读。

边界：不要回退工作区里任何既有未提交改动（本轮前就有 39 个修改文件，不是你的产物）；
阈值 0.20 vs 0.10 与真人可用性访谈由用户决定，不要替他选值、不要伪造真人证据；
不得把测试通过称为信度或效度验证；不要 commit/push/发布。
数据库与真实 AI 调用用户已授权（2026-09-18"全部允许"），但仍要控制成本与数据范围。

若当前代码或证据与移交文档冲突，以当前可复核证据为准，并明确报告差异。
```
