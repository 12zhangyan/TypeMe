# 真实 MySQL 并发验收（A53 ①④⑤ + A57）

本轮没有界面改动，证据是**真实数据库行为**与测试输出，不是截图。所有命令都在
`backend/` 下执行（`JAVA_HOME=D:\develop\jdk-21`）。

## 环境与安全边界

- 目标：本机 `127.0.0.1:3306`（MySQL 8.4，root/123456）。
- `ConcurrencyMySqlIT` 全程只创建/删除形如 `typeme_concurrency_<随机>` 的**临时库**：
  连接串不带库名 → `CREATE DATABASE` → Flyway 跑迁移 → 用例 → JVM 退出钩子 `DROP DATABASE`。
  不 `USE` 任何既有库，不对其它库执行任何语句（与本仓库另外两个 MySQL IT 的边界一致）。
- `SubmitReportIT` 跑在 H2 内存库上（`AccountIntegrationTestBase`），不碰真实库。

## 命令与结果

```
mvn.cmd -o test '-Dtest=ConcurrencyMySqlIT'          → Tests run: 3, Failures: 0, Errors: 0
mvn.cmd -o test '-Dtest=SubmitReportIT'              → Tests run: 2, Failures: 0, Errors: 0
mvn.cmd -o test '-Dtest=AttemptIdempotencyIT'        → Tests run: 9, Failures: 0, Errors: 0
mvn.cmd -o test                                      → Tests run: 293, Failures: 0, Errors: 0, Skipped: 1, BUILD SUCCESS
```

（原始 surefire 输出见同目录下的两个 `.txt`。）

## A53① 并发提交：报告行对普通一致性读不可见

**真实缺陷**：`ReportService.submit` 在 `INSERT` 撞 `uk_report_attempt` 之后，用普通
`SELECT` 读回既有报告。MySQL 是 **REPEATABLE READ**，而那个事务的快照建立于它自己的
第一条 `SELECT`（`requireRow`）——对方刚提交的报告行对它**永远不可见**，于是
`readReportRow` 抛 `JungApiException`：**404「这份报告」**。用户提交成功了却被告知报告不存在。

确定性证据（`ConcurrencyMySqlIT#duplicateReportInsertIsInvisibleToPlainRead`，两个真实连接按顺序执行）：

1. 连接 A：`BEGIN` + `SELECT`（建立快照）；
2. 连接 B：`BEGIN` + `INSERT` 报告 + `COMMIT`；
3. 连接 A：`INSERT` → SQLState `23xxx`（唯一约束真的存在）；
4. 连接 A：普通 `SELECT` → **0 行**（这就是旧代码 404 的来路）；
5. 连接 A：`SELECT ... FOR UPDATE` → **1 行**（这就是修复）。

**修复**：重复提交那条分支改用 `readReportRowForUpdate`（当前读）。
**判别力**：把那一行改回 `readReportRow` → `ConcurrencyMySqlIT#concurrentSubmitAlwaysReturnsSameReport`
立刻变红，异常就是 `JungApiException: 这份报告不存在`（404）；服务级用例在 6 轮并发里每轮都断言
"两次提交拿到同一个 reportId + 该 attempt 只有一份报告"。

## A53⑤ 并发注销：第二个申请撞唯一约束变成 500

**真实缺陷**：两个并发 `DELETE /me` 会双双通过 `requireActive`（各自快照里账号还是 ACTIVE），
第二个走到 `INSERT INTO account_deletion_job` 时撞 `uk_deletion_job_user`，
`DuplicateKeyException` 一路上抛就是 **500** —— 而他的注销申请其实已经被受理了。

**修复**：`DeletionJobRepository.insertPendingOrGetExisting` —— 冲突时用 `SELECT ... FOR UPDATE`
（同样必须当前读）读回既有任务并返回它，重复申请是幂等的。
**判别力**：改回"直接把冲突抛上去" → `ConcurrencyMySqlIT#repeatedDeletionRequestReturnsExistingJob`
报 `DuplicateKeyException`（真实 MySQL），同时 H2 侧的
`AccountDeletionIT#repeatedDeletionRequestInsertIsIdempotent` 也变红。两条用例都先断言
`uk_deletion_job_user` 真实存在（绕开仓储层直接插第二行必须失败），否则断言本身证明不了什么。

## A53④ 交卷状态码与契约不一致

**真实缺陷**：契约 02 §7.2 给 `POST /attempts/{id}/submit` 的状态码是 **201 Created**
（覆盖不足才是 `200 + NEEDS_REVIEW`），实现两种情况都返回 200。此前**没有任何后端测试**
走过"答满 48 题 → 交卷 → 拿到报告"这条 HTTP 路径，所以一直没人发现。

**修复**：`reportId != null` → 201，否则 200 + NEEDS_REVIEW。
**新测试 `SubmitReportIT`（2 条，H2）**：答满主测交卷 = 201 + reportId，重复交卷仍是同一份报告
（仍 201）；只答一题交卷 = 200 + NEEDS_REVIEW 且**不建报告**。题号从
`GET /catalog/current/package` 现取（不写死），内容包换版不会让测试跟着烂。
**判别力**：把控制器改回"一律 200" → 第一条立刻红（`expected: 201 but was: 200`）。
真实浏览器回归：`scripts/browser-verify-ai-upstream-failure.py`（它自己会走一遍完整交卷）
在改动后复跑仍 **PASS 21 / FAIL 0**。

## A57 过期幂等记录没有清理

`api_idempotency` 每来一次建测评/交卷/建分析就多一行、TTL 24 小时，而在此之前
**只有账号注销**会删（按用户删全部）——不注销的账号会让这张表无限涨，
`idx_idempotency_expires` 建了却没有消费者。

**修复**：`IdempotencyGuard.deleteExpired(now, limit)` + `IdempotencyCleanupJob`
（`@Scheduled`，默认 1 小时一次、启动后 10 分钟首跑、每轮最多 500 行；抛异常只记日志，
不让一次清理失败停掉后续调度）。分两步（先查主键再按主键删）是因为
`DELETE ... LIMIT` 是 MySQL 专有语法、H2 会直接报错；删的时候**再带一次**
`expires_at < ?`，避免把"查到之后又被同 key 并发重新占用"的活记录删掉。

**测试 `AttemptIdempotencyIT#deleteExpiredOnlyRemovesExpiredRows`**：三条记录（一条过期、
一条活着、另一个账号的一条），断言只删掉过期的那一条，活着的与别人的都不受影响。
**判别力**：先只放宽 `SELECT` 的条件 → 测试仍绿（说明真正兜住活记录的是 `DELETE` 上的条件，
这条观察写进了代码注释）；再把 `DELETE` 上的 `expires_at < ?` 去掉 → 测试变红（`deleted=3`，期望 1）。

## 本轮没做的

- **A53②③⑥** 未动：② AI 配额读取失败时前端乐观按 `used=0` 显示；③ `ReportService.exportData`
  （无调用方的死代码）仍把 `BadSqlGrammarException` 吞成 `List.of()`；⑥ AI 任务 429 自动重试时
  `reserved_calls` 漂移。三条都登记在 backlog，本轮不碰。
- **A53① 的"两个请求都拿到同一份报告"只验到服务对象层**：`ConcurrencyMySqlIT` 手工装配
  `ReportService`（事务由 `TransactionTemplate` 提供，与 `@Transactional(REQUIRED)` 等价），
  没有起 Spring 上下文（临时库名在上下文启动前才生成，`@DynamicPropertySource` 用不上）。
  因此 HTTP 状态码那一段由 H2 上的 `SubmitReportIT` 覆盖，两者合起来才是完整链路。
- 真并发下"第二路一定撞到唯一约束"这件事靠**多轮**提高置信度（每用例 6 轮），
  不是数学意义上的确定性；确定性的是 `duplicateReportInsertIsInvisibleToPlainRead`
  那条按顺序摆出的时序。
