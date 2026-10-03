# 2026-09-20 分流缺陷修复：十六型草稿进答题页被判成"不是大五"

范围：`/assess/:attemptId` 的分流。**没有**数据库写入、**没有**启动后端进程、**没有**真实 AI、
**没有**真实 MySQL IT。替身响应来自 H2 实跑导出，不是手写通用草稿。

## 现象与复现（先有失败证据）

进入一份**十六型**草稿的答题页 `/assess/<attemptId>`，页面显示：

> 这份测评不是大五倾向测评，请从对应的入口继续。

修复前证据：[before-fix-reproduction.txt](before-fix-reproduction.txt)（同一套脚本、同一批替身，
只把 `AttemptRouterView.vue` 换回修复前版本重构建后运行，320 宽度第一条即失败）、
[before-fix-320.png](before-fix-320.png)（失败现场截图）。

## 根因

分流页先请求**大五**端点 `GET /api/v3/platform/attempts/{id}`（`PlatformController` → `BigFiveAttemptService.detail`）。
该端点对**本人的十六型草稿**返回 `409 INSTRUMENT_MISMATCH` —— 这是**分流信号**，
但 `AttemptRouterView` 只把 `NOT_FOUND` / `FORBIDDEN` 当成"该走十六型"，其余一律显示成致命错误。

同一段代码还有两处相邻缺陷（都属"看起来也对"的错法）：

1. `404`（不存在，或不是本人的草稿）与 `403` 被当成"这是十六型草稿" → "没有这份测评"会被渲染成一份答题页；
2. `attemptId` 在 `setup` 里只算一次、请求只在 `onMounted` 发一次 → 同一路由换 id 不重新分流，
   且旧请求晚到会覆盖新页面。

后端本身是对的：`detail` 先做 `attempts.requireRow(userId, attemptId)`（`WHERE id=? AND user_id=?`，读不到即 404），
再判"锁定的包是不是大五"，所以 `INSTRUMENT_MISMATCH` **不会**泄露他人草稿的存在性。

## 改动

| 文件 | 改动 |
|---|---|
| `frontend/src/views/AttemptRouterView.vue` | 判据改为 `INSTRUMENT_MISMATCH` → 十六型；`404` → 独立的"没有找到这份测评"空态；`403`/`401`/网络/`PACKAGE_UNAVAILABLE` → 错误态。`watch(attemptId)` 重新分流 + 请求序号丢弃过期响应 + 卸载后失效 |
| `backend/src/test/java/com/typeme/platform/PlatformAttemptDispatchIT.java`（新） | 钉住分流判据与状态码；导出真实响应夹具 |
| `frontend/src/views/attemptRouterView.spec.ts`（新） | 11 项：两种量表、409 分流信号、404/403/401/版本不可用/网络失败、换 id 与竞态 |
| `scripts/browser-verify-attempt-router.py`（新） | 隔离构建 + 全量模拟接口，320/390/1440 从入口到答题页 |
| `docs/2026-09-16/implementation/_contracts/03-AI与前端契约-v1.md` §7.2 | 把判据与状态码写成契约条款 |

未改：计分规则、内容包、草稿/答案/revision/版本绑定、权限校验、大五答题页与十六型答题页本身
（这两页有另一会话在途改动，本轮只读）。

## 验证

**先红后绿（前端单测）**：修复前 `attemptRouterView.spec.ts` **6/11 失败**
（409 当致命错误、404→十六型、403→十六型、三条换 id/竞态）；修复后 **11/11 通过**。

**后端契约（H2 实跑）**：`PlatformAttemptDispatchIT` **3/3 通过**，钉住：
本人十六型草稿走大五端点 → `409 INSTRUMENT_MISMATCH`；他人草稿与不存在的 id → 同形 `404`；
未登录 → `401`；大五草稿走十六型端点 → `409 PACKAGE_UNAVAILABLE`（十六型侧按绑定包复校验）；
大五详情 `200` 且 `items[0].kind=agreement_statement`、50 题。

**浏览器（隔离构建 + 模拟接口）**：`scripts/browser-verify-attempt-router.py` **62 项通过**，320/390/1440 各覆盖：
十六型草稿→十六型答题页（`[data-question-card]` 且无错误文案）、大五草稿→大五答题页、
不存在→空态不渲染答题页、会话失效→错误态/登录页且不渲染答题页、版本不可用→错误态、
同页换 id→页面跟着换。0 未捕获异常、0 未定义接口。

**全量前端**：`npm run typecheck` exit 0；`vitest run` 43 文件 / 971 项通过。

## 未覆盖（不得扩写成"全站已验收"）

- 全部浏览器验证都是**模拟接口 + 合成草稿**，**不等于**真实数据库联调；未启动任何连库后端。
- 真实 MySQL 方言/并发（3 个 `*MySqlIT`）与真实 AI 调用未执行。
- 未验证真实登录会话下的跳转、真实提交/报告链路；`401` 一条只到"退回登录页/错误态"为止。
- 单测里两个答题页是替身（只断言"选了哪一页"）；**真实页面渲染**由本目录的浏览器证据覆盖，
  且用的是后端导出的真实响应字节。
- 截图未做人工目视（执行模型无图像输入），断言以 DOM/几何判据为准。
- 本轮**没有**重建 `frontend/dist`（另一会话正在并行构建该目录），也没有打包整站
  jar；上面的浏览器证据用的是本轮自己的隔离构建目录（`%TEMP%/typeme-router-verify-dist`）。
  要让静态资源/整站产物带上本次修复，需要重新 `npm run build` 后再打包。
