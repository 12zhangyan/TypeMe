# 导出数据的「完整性声明」（2026-09-17，第 15 轮）

- 被验收地址：`http://127.0.0.1:5174`
- 使用账号：`export_cba2ffa8c8`、`export2_*`（注册时生成的合成值，未记录密码）
- 结论：**PASS 19 / FAIL 0**，且**下载到的文件里确实带上了降级标记**

## 修的是什么

`DataExportService.safeQuery()` 把一切 `DataAccessException` 吞成空数组，响应里没有任何标记；
而账号页在导出成功时说「账号资料、测评记录、答案、报告与 AI 分析记录**都在里面**」，
同一页的注销区又写着「注销会删除你的全部测评记录与报告，无法恢复……
**导出数据是唯一能把它们带走的办法**」。

于是"报告查询失败"会变成一份**看起来完整**的备份：用户按页面指引先导出、再注销，
没导出到的那部分**永久丢失，且事后无从发现**。这是"失败不能静默吞掉"这条规则
最严重的一种违反 —— 后果不可逆。

修复思路不是"让导出 500"（用户要的是自己的数据，缺一张表就不给导出更糟），
而是**把降级说出来**：响应新增 `degradedSections`，页面据此改口径。

## 改动

1. `DataExportService`：`safeQuery` 记录段名与失败原因；`export()` 输出
   `degradedSections: [{section, reason}]`。日志也从"只记异常类名"改成段名 + 异常消息
   （原先排查时连哪一段失败都看不出来）。
   - **缺表**（部署未就绪）与**查询失败**（数据取不到）用不同 reason 区分；
     两者都用**段名**（`reports`/`aiJobs`…）而不是内部表名，前端一张映射表即可覆盖。
2. `frontend/src/api/v3.ts`：`ExportResult` 增加 `degradedSections`；读一次响应文本，
   既挑出降级段落又用它重建 blob（不多读一遍响应体）。
3. `AccountView.vue`：`degradedSections` 非空时**不说"都在里面"**，改为
   「这份文件不是完整备份，请先不要注销账号」并点名缺了哪一段；
   注销区也重复一次（用户可能没看导出区就往下滚）。
   - 认不出的段名原样显示（宁可露出英文标识，也不能把"有东西没导出"说成没事）。

## 断言（脚本 `scripts/browser-verify-export.py`）

真浏览器里走完整 UI：注册 → 进账号页 → 点「导出我的数据」→ 检查**下载下来的文件**。

- PASS：账号页上找得到导出按钮（唯一一个）
- PASS：导出文件确实下载到了本地
- PASS：导出文件是合法 JSON（421 字节）
- PASS：**导出文件里带有 `degradedSections` 字段**（键：aiJobs / attempts / degradedSections /
  excluded / exportedAt / profile / reports / schemaVersion / selfReflections）
- PASS：`degradedSections` 是数组
- PASS：导出文件含 profile / attempts / reports / selfReflections / aiJobs / excluded 六段
- PASS：文件完整时页面说「都在里面」（这是现在唯一可以说这句话的情形）
- PASS：文件完整时**不**显示不完整警告
- PASS：服务端响应体本身也带 `degradedSections`（不只是文件里有）
- PASS：为第二个账号建了一份测评（HTTP 201）
- PASS：**有数据时 `attempts` 段确实带回了那条测评**（条数=1，含 `answers` 数组）
- PASS：有数据且一切正常时 `degradedSections` 为空（证明不会误报降级）
- PASS：有数据且完整时页面照常说「都在里面」

## 未覆盖（如实记录）

- **没有让服务端真的失败一次来做端到端验证**。尝试过用 H2 的
  `ALTER TABLE ... ALTER COLUMN ... RENAME TO` 制造真实的列缺失，但运行中的后端以
  `AUTO_SERVER=FALSE` 独占着库文件，外部进程连不上去（`Database may be already in use`）。
  降级分支因此是**两层覆盖**而不是端到端覆盖：
  - 后端单测 `DataExportDegradationTest`（3 条，mock `JdbcTemplate` 让某个段查询抛异常，
    断言响应声明了 `reports` 段且 reason 区分"查询失败"/"尚未就绪"）；
  - 前端 `v3Export.spec.ts`（6 条，解析判定）+ `accountExport.spec.ts`（4 条，页面文案）；
  - 真浏览器证明了**字段确实出现在下载文件里**（这是"用户事后能自查"的关键一环）。
  缺口是"服务端真失败 → 页面真的显示警告"这一段没有在真机上串起来。
- 后端单测已用临时回退验证过判别力：去掉 `degraded.add(...)` 那一行，3 条里恰好红 1 条。

## 证据

- `10-account-390.png`、`20-after-export-390.png`、`30-with-data-390.png`
- **下载到的导出文件已删除**：它含真实账号数据（AGENTS.md 要求截图与导出证据脱敏），
  断言结果以本文件记录为准。
