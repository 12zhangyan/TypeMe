# 成员 AI 额度筛选与批量调整 开发方案

> 状态：草稿·未实施
> 日期：2026-10-28 ｜ 基线：git main@3789b11（工作区另有与本任务无关的未提交改动） ｜ 来源：`docs/requirements/2026-10-28/成员管理-AI额度筛选与批量调整.md`（Confirmed，REQ-1~3、AC-1~9；需求 Q-1/Q-2 已裁决）
> 实施范围：`backend/src/main/java/com/typeme/account/`（controller、service、repository、dto）及对应测试；`frontend/src/api/adminMembers.ts`、`frontend/src/views/AdminMembersView.vue` 及对应 spec。不新增数据库迁移，不改 AI 模块的额度判定。

## 执行卡片
- 改变：成员页可只看“今日额度已用完”的成员（跨页准确），并可勾选当前页成员批量设定额度或恢复站点默认，结果逐人反馈。
- 保持：单人 `PUT /api/v3/admin/users/{id}/ai-limit` 契约不变；列表不带新参数时行为和响应不变；仅管理员可用并保留 CSRF；不清零今日已用、不取消在途请求；额度判定逻辑（E-5）不改。
- 先核验：`AdminUserService.list` 与 `UserRepository.page/count` 仍按 E-1、E-3 工作，`ai_usage_budget` 主键仍为 `(scope_key, budget_date)`（E-4）；不符时先停下报告差异。
- 首个切片：S-1（服务端筛选 + 前端开关），一条从页面到 SQL 的完整路径。
- 完成判据：A-1~A-12 通过；后端为排除三类真实 MySQL IT 后的子集结果。

## 背景与目标
- 背景：管理员只能逐个打开档案保存额度（E-6），列表无法按用量筛选（E-1、E-2），一旦设过单独额度就无法回到“沿用默认”（E-7）。
- 非目标：不做“选中全部筛选结果”（需求 Q-1）；不做额度操作记录（需求 Q-2）；不改全站默认额度、AI 开关、总预算和 UTC 日规则；单人档案不新增“恢复默认”按钮（REQ-3 只作用于批量选中成员）。

## 证据与决策
| ID | 结论 | 证据 | 类型 |
|---|---|---|---|
| E-1 | 列表接口只有 `page`/`size`，`total` 为全部未删除成员；前端固定每页 20，服务端上限 100 | `backend/src/main/java/com/typeme/account/controller/AdminController.java:73-76`、`backend/src/main/java/com/typeme/account/service/AdminUserService.java:37`、`backend/src/main/java/com/typeme/account/service/AdminUserService.java:54-68`、`frontend/src/api/adminMembers.ts:27` | 已证实 |
| E-2 | 今日已用按行查 `ai_usage_budget`（scope_key=`user:<id>`，UTC 日），生效额度＝单独额度或站点默认 | `backend/src/main/java/com/typeme/account/service/AdminUserService.java:124-129`、`backend/src/main/java/com/typeme/ai/service/AiBudgetRepository.java:39-40`、`backend/src/main/java/com/typeme/ai/service/AiBudgetRepository.java:96-100` | 已证实 |
| E-3 | 分页与计数已排除 DELETED，排序 `created_at DESC, id ASC` | `backend/src/main/java/com/typeme/account/repository/UserRepository.java:144-152` | 已证实 |
| E-4 | `ai_usage_budget` 主键 `(scope_key VARCHAR(64), budget_date)`；`app_user.id` 为 `CHAR(36)`；`ai_daily_limit` 可为 NULL，CHECK 0–10000 | `backend/src/main/resources/db/migration/V4__ai_analysis.sql:64-73`、`backend/src/main/resources/db/migration/V1__account_and_session.sql:18`、`backend/src/main/resources/db/migration/V9__invitations_and_user_ai_limit.sql:2-3` | 已证实 |
| E-5 | 创建/重试 AI 分析时在事务内 `FOR UPDATE` 读生效额度，NULL 回落站点默认，无缓存，故写库即生效 | `backend/src/main/java/com/typeme/ai/service/AiBudgetRepository.java:103-107`、`backend/src/main/java/com/typeme/ai/service/AnalysisCreationWriter.java:66`、`backend/src/main/java/com/typeme/ai/service/AnalysisCreationWriter.java:123` | 已证实 |
| E-6 | 单人改额度：请求体 `aiDailyLimit` 必填，服务层拒绝 null 与越界，拒绝已删除成员；整类 `@PreAuthorize("hasRole('ADMIN')")` | `backend/src/main/java/com/typeme/account/controller/AdminController.java:35`、`backend/src/main/java/com/typeme/account/controller/AdminController.java:93-101`、`backend/src/main/java/com/typeme/account/service/AdminUserService.java:93-98`、`backend/src/main/java/com/typeme/account/repository/UserRepository.java:116-118` | 已证实 |
| E-7 | 站点默认由 AI 设置维护且必须为正数，因此“NULL 且默认为 0”在正常配置下不会出现 | `backend/src/main/java/com/typeme/account/dto/AdminAiSettingsUpdateRequest.java:29` | 已证实 |
| E-8 | 成员卡片整体是 `<button class="member-card">`，现有 spec 用该选择器打开档案 | `frontend/src/views/AdminMembersView.vue:113`、`frontend/src/views/adminMembersView.spec.ts:90` | 已证实 |
| E-9 | 筛选在 SQL 中完成：`LEFT JOIN ai_usage_budget b ON b.scope_key = CONCAT('user:', u.id) AND b.budget_date = :today`，条件 `COALESCE(u.ai_daily_limit, :default) > 0 AND COALESCE(b.reserved_calls, 0) >= COALESCE(u.ai_daily_limit, :default)`；分页与计数使用同一条件，排序沿用 E-3 | 需求 REQ-1；E-2、E-3、E-4 | Agent 代决（错了的代价：真实 MySQL 上若出现字符集/排序规则冲突或执行计划不佳，需改为 E-10 的方式） |
| E-10 | 被否决：先取全部未删除成员再在内存中逐个算用量并分页。否决理由：每次筛选都要 N 次用量查询；只有当 E-9 在真实 MySQL 上不可用时才改用 | E-2 | 已否决替代 |
| E-11 | 新参数为布尔 `aiExhausted`（默认 false），不做可扩展的枚举：需求只有一种筛选 | 需求 REQ-1 | Agent 代决（错了的代价：以后增加其他用量筛选时需再加参数） |
| E-12 | 批量为新接口 `PUT /api/v3/admin/users/ai-limits`，请求体 `{userIds, action: SET\|RESET_DEFAULT, aiDailyLimit}`；`action` 显式区分“设定”与“恢复默认”，不让单人接口接受 null | 需求 REQ-2、REQ-3；E-6 | Agent 代决（错了的代价：若前端漏传字段时用 null 表示恢复默认，会静默清掉一批人的单独额度——这正是不采用 null 语义的原因） |
| E-13 | 请求整体校验先于任何写入：`userIds` 1–20 个、去重、非空；`SET` 时 `aiDailyLimit` 为 0–10000 整数，`RESET_DEFAULT` 时不得携带；任一不满足返回 400 且不改任何人 | 需求 REQ-2（一次最多 20 人，Q-1）、AC-6；E-6 | Agent 代决（错了的代价：若只在前端限制 20 人，可绕过上限） |
| E-14 | 逐人处理：每位成员独立更新，已删除或不存在的记为失败（NOT_FOUND），成功的保留；响应列出每个 userId 的结果，成功项带最新成员视图 | 需求 REQ-2 规则与 AC-7；E-6 | 用户已裁决（默认清单第 7 条） |
| E-15 | 前端卡片改为“容器 + 勾选框 + 原 `button.member-card`”，打开档案的按钮及类名不变，勾选框不嵌套在按钮内 | E-8 | Agent 代决（错了的代价：若改动按钮结构，现有 spec 选择器失效需同步修改） |
| E-16 | 换页、切换筛选、批量成功后清空勾选；失败的成员保持勾选以便重试；批量成功后重新请求当前页（筛选状态下调高额度的成员会移出结果） | 需求 REQ-2 结果、AC-4、AC-7 | Agent 代决（错了的代价：若不重载，筛选结果会显示已不符合条件的成员） |
| E-17 | 无需迁移；H2 测试库为 `MODE=MySQL`，三类真实 MySQL IT 会建库删库，需授权才运行 | E-4；`backend/src/test/resources/application-ai-test.properties:27`；`AGENTS.md:78-84` | 已证实 |

## 方案

**筛选（REQ-1）**：`GET /api/v3/admin/users?page=&size=&aiExhausted=true`。控制器透传参数；服务层读取当天 UTC 日期与站点默认，把它们交给仓储层带条件的分页和计数（E-9）。返回结构与现有列表相同，`total` 为筛选后的人数。前端在列表上方增加“只看今日额度已用完”开关，空态文案与“暂无成员”区分。

**批量（REQ-2、REQ-3）**：`PUT /api/v3/admin/users/ai-limits`。先整体校验（E-13），再逐人更新：`SET` 写入同一数值，`RESET_DEFAULT` 写入 NULL；不触碰 `ai_usage_budget`，因此今日已用保留（E-5）。响应：

```json
{ "updated": 2, "failed": 1,
  "results": [
    { "userId": "…", "ok": true, "member": { "…": "与列表条目同结构" } },
    { "userId": "…", "ok": false, "code": "NOT_FOUND", "message": "成员不存在或已删除。" } ] }
```

前端：卡片加勾选框（E-15），当前页“全选本页”；选中后出现批量区，可输入额度点“设为”，或点“恢复默认”；点后先出现行内确认“将修改 N 位成员的每日额度为 X” / “将 N 位成员恢复为沿用系统默认额度”，确认后提交。提交中禁用相关按钮；结果区按 E-14 显示成功人数与失败名单（E-16）。

## 工作切片
| 切片 | 可观察结果 | 改动范围 | 硬边界 | 依赖 | 验收 |
|---|---|---|---|---|---|
| S-1 | 管理员打开“只看今日额度已用完”，看到全部页中符合条件的成员，计数与翻页按筛选结果，空态正确 | `AdminController`、`AdminUserService`、`UserRepository`；`adminMembers.ts`、`AdminMembersView.vue`；`AdminApiIT`、`adminMembers.spec.ts`、`adminMembersView.spec.ts` | 不带参数时 SQL 与响应不变；不改 `AiBudgetRepository` | — | A-1~A-4 |
| S-2 | 管理员勾选当前页成员批量设定额度，确认后逐人生效并看到结果 | 新增批量请求 DTO 与接口、服务方法；前端勾选、批量区、确认与结果展示；对应测试 | 单人接口契约不变；整体校验失败时零写入；上限 20 由服务端强制 | S-1（复用列表重载与筛选状态） | A-5~A-10 |
| S-3 | 管理员对选中成员“恢复默认”，成员回到沿用系统默认 | 同 S-2 的接口增加 `RESET_DEFAULT` 分支；前端按钮与确认文案 | 不新增单人恢复入口；不写入默认数字 | S-2 | A-11、A-12 |

切片顺序与粒度是建议；执行 Agent 可合并、细分、重排或并行委派，但不得越过硬边界。

## 验收
| ID | 场景与输入 | 期望 | 必须保持的拒绝 / 隔离 / 不执行 | 验证方式（计划，未运行） |
|---|---|---|---|---|
| A-1 | 需求 AC-1：25 名成员中，第 1 页与第 2 页各有已用完者，另有 0/0 与已用 1/2 者；`aiExhausted=true&size=20` | 只返回已用完者，`total` 等于其人数，翻页连续无重复 | 0/0（停用）与未用完者不出现；已删除成员不出现 | `AdminApiIT` 新增筛选用例（H2） |
| A-2 | 沿用默认（NULL）且已用等于站点默认的成员 | 出现在筛选结果中 | — | 同上 |
| A-3 | 需求 AC-3：用户量日期为前一 UTC 日 | 不出现在今日筛选结果中 | 不按北京时间自然日判定 | 同上，写入不同 `budget_date` |
| A-4 | 需求 AC-2：无人已用完；前端开关 | 空态文案区别于“暂无成员”；关闭开关恢复全部 | 不带参数的列表请求 URL 与现在一致 | `adminMembersView.spec.ts`、`adminMembers.spec.ts` |
| A-5 | 需求 AC-4：选中 3 人 `SET 5` | 3 人 `aiDailyLimit=5`，今日已用不变；其中已用 < 5 的成员下一次创建分析成功 | 不改 `ai_usage_budget` | `AdminApiIT`；下一次创建沿用 `AnalysisFlowTest` 改额度后立即生效的写法（`backend/src/test/java/com/typeme/ai/AnalysisFlowTest.java:125-145`） |
| A-6 | 需求 AC-5：今日已用 2 的成员被 `SET 1` | 剩余 0，新请求被拒，已用仍为 2 | 在途请求不取消 | 同上 |
| A-7 | 需求 AC-6：`aiDailyLimit` 为空/小数/-1/10001，`userIds` 为空、超过 20 个或含重复，`RESET_DEFAULT` 携带数值 | 400，所有成员额度不变 | 零写入 | `AdminApiIT` 参数化用例 |
| A-8 | 需求 AC-6：非管理员调用批量接口；管理员不带 CSRF | 403；额度不变 | 权限与 CSRF 边界保留 | `AdminApiIT`（同 `nonAdminIsForbidden` 写法，`backend/src/test/java/com/typeme/account/AdminApiIT.java:41`） |
| A-9 | 需求 AC-7：3 个 id 中 1 个已删除 | `updated=2, failed=1`，失败项为 NOT_FOUND；页面列出失败成员，不显示“全部已保存”，失败者保持勾选 | 成功的两人不回滚 | `AdminApiIT`；`adminMembersView.spec.ts` |
| A-10 | 前端：勾选后换页 / 切换筛选；批量提交中重复点击 | 勾选被清空；提交只发一次 | 打开档案仍用 `button.member-card` | `adminMembersView.spec.ts` |
| A-11 | 需求 AC-8：单独额度 5 的成员 `RESET_DEFAULT` | `aiDailyLimit=null`，生效额度等于站点默认；之后修改站点默认，生效额度随之改变 | 不写入默认数字 | `AdminApiIT` |
| A-12 | 需求 AC-9：选中的人中有已沿用默认者 | 该项 `ok=true`，今日已用不变 | — | `AdminApiIT` |

整体验证（计划，未运行）：
- 后端（`backend` 目录）：`mvn.cmd test '-Dtest=AdminApiIT,AnalysisFlowTest'`，再跑排除三类真实 MySQL IT 的全量子集（`AGENTS.md:80`）。
- 前端（`frontend` 目录）：`npm.cmd test`，并确认新增 spec 实际执行；`npm.cmd run build`。
- 浏览器：成员页在 320 / 390 / 1440 宽度下检查勾选框与“查看档案”可分别操作、批量区不遮挡、确认与结果文案可读（`AGENTS.md:34-40`）。

## 兼容、风险与回滚
- **兼容**：列表新增可选参数，旧前端不受影响；新前端配旧后端时，`aiExhausted` 会被忽略而显示全部成员，因此**先发布后端再发布前端**。批量是新接口，不影响单人接口。
- **真实 MySQL 未验证**：E-9 的 `CONCAT('user:', u.id)` 与 `VARCHAR(64)` 主键列比较，需在真实 MySQL 上确认无排序规则冲突且能使用主键；三类真实 MySQL IT 需用户授权目标后运行（E-17）。若不可用，改用 E-10。
- **并发**：批量更新与创建分析时的 `FOR UPDATE`（E-5）互相等待，不会读到半更新状态；两位管理员同时修改同一成员时以后提交者为准，与现有单人修改一致。
- **已知风险（需求 Q-2）**：批量设定与恢复默认会覆盖原单独额度，且没有记录，无法查回原值。
- **回滚**：无 schema 变化，回退代码即可；已写入的额度值保留（属于正常业务数据）。
