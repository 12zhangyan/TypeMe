# 2026-09-21 前后端 Review 修复与验证

范围：修复本次整体审查的 7 项发现。提交前从 main 基线建立独立工作树，只纳入本轮修复；原工作区已有 AI v4 等改动未纳入。没有部署、向现有数据库执行迁移或写入、调用真实 AI。

## 修复

| 发现 | 实施 | 回归证据 |
|---|---|---|
| 大五恢复草稿后漏发答案 | 恢复时同步本地修订计数器与已保存水位 | `bigFiveV3.spec.ts` 恢复后首条新增答案发送 |
| 保存期间修改被误确认 | 每批冻结水位，串行排空在途新增改动；并发调用共用保存 Promise；换草稿/退出后丢弃旧响应；提交等待保存 | 在途改答、并发保存、换草稿、等待保存后提交测试 |
| 提交与草稿更新竞态 | 十六型与大五保存、十六型 review/删除草稿、两种提交，在同一事务开始时按 owner 锁定 attempt | `AssessmentConcurrencyH2IT` 两种量表各验证保存竞争、提交等待保存后拒绝旧版本、提交后拒绝等待中的改答 |
| 乐观锁误用 COUNT 判断成功 | 两条 PATCH 路径直接检查 UPDATE 影响行数，失败抛异常并回滚 | 双写只成功一个、失败方不改变答案 |
| AI 旧执行覆盖重试 | 每次 claim 使用独立 execution owner；所有 worker 状态写入携带该标识；外发前要求标记成功且租约未过期；每次认领重置 requested_at | `AnalysisExecutionFenceTest` 旧执行的 requested/成功/失败/unknown/取消/退避均拒绝，新执行正常写回 |
| 撤销“说不好”未同步 | 增加大五 PATCH 的 CLEAR 命令和前端删除待发记录，失败可重试；CLEAR 不入答案表、不计分 | store 撤销失败重试、清空期间重新作答；后端清空后重读无答案、提交为 INCOMPLETE；浏览器刷新不恢复旧值 |
| 注销任务 RUNNING 无法恢复 | 同一事务锁定任务、标 RUNNING、执行清理、标 DONE；扫描也接纳旧版 RUNNING；失败标记不覆盖 DONE | `AccountDeletionRecoveryTest` 模拟执行中断回滚后恢复、两 worker 只清理一次 |

新增 CLEAR 接口语义：`PATCH /api/v3/platform/attempts/{id}/answers` 的 `responses` 支持 `{questionId, kind:"CLEAR", rating:null}`，沿用 required expectedRevision、owner 校验、提交后不可改答及整批事务。其他请求/响应形状不变，无 schema 迁移。前后端配套发布才能使用撤销持久化能力。

## 原工作区验证（包含已有 AI v4 改动）

- `frontend: npm.cmd run typecheck`：退出码 0。
- `frontend: node node_modules/vitest/vitest.mjs run`：50 个文件，1036 项通过，退出码 0。直接运行测试器避免 pretest 写生成内容。
- `frontend: npm.cmd run build`：类型检查、Vite 构建、图片地址产物检查通过，退出码 0。
- JDK 21 下 `backend: mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT'`：400 项，399 通过、0 失败、0 错误、1 跳过，退出码 0。只在测试进程清除了 DEEPSEEK_API_KEY/TYPEME_AI_API_KEY，避免“无环境密钥”用例被宿主环境干扰。跳过项为既有 `AssessmentPackageLoadingTest` 空目录假设（当前已有 3 个 YAML），未修改其跳过逻辑。
- 后续仅修改注释和未执行 MySQL 测试的合成时间戳，重新执行 `mvn.cmd test '-Dtest=AnalysisExecutionFenceTest'`，同时重新编译全部测试源码；不是执行真实 MySQL 测试。
- `python scripts/browser-verify-review-fixes.py`：真实 Chromium、Vite 源码、合成草稿和模拟 API。320/390/1440 宽度共 29 项通过；覆盖恢复、在途改答、串行 revision、撤销后刷新、保存失败与键盘重试、409 停写、焦点、可达性及横向溢出。无未捕获页面异常。所有 API 被拦截，跨域请求阻断；壳页面十六型目录明确模拟离线。详情见同目录 `browser-results.json` 和三张 `bigfive-conflict-*.png`。
- 五项生成内容检查退出码均为 0：`gen-fallback-content.mjs --check`、`rewrite-types-content.mjs --check`、`check-type-duplication.mjs`、`convert-jung-content.mjs --check`、`gen-jung-fixtures.mjs --check`。
- `git diff --check` 无空白错误。

针对性首轮验证另有后端 64/64、前端 27/27 通过。新增回归共前端 7 项、后端 10 项，未放松原有断言。

## 边界

- H2 并发测试使用真实服务事务与独立连接，但不能替代 MySQL 的锁、隔离级别和死锁验证。三类真实 MySQL 测试均未运行。
- 浏览器操作验证使用模拟 API；没有真实浏览器到后端/数据库的端到端验证，没有真实 AI 外发。
- 注销清理改为每账号一个事务，会延长该账号清理期间的行锁持有时间；大数据量清理的性能未实测。
- 新前端 dist 已构建，但未重新打包整站 jar、未部署。后端测试通过不代表生产已修复。
- 全套前端测试日志仍有既有错误分支模拟输出和 Vue 测试警告，测试器未报告未处理异常，浏览器验收无 pageerror。
- 测试原始日志位于本机临时目录 `typeme-review-fix-20260921`；仓库只保存合成浏览器证据和此报告，不复制凭据或真实用户数据。

## PR 提交范围验证

在 `codex/review-fixes-20260921` 独立工作树、main 基线 `0c60bc5` 上重新执行：

- 前端 `node node_modules/vitest/vitest.mjs run`：50 个文件、1031 项通过，退出码 0。数量与原工作区不同，是因为不包含已有 AI v4 功能测试。
- `npm.cmd run build`：类型检查、Vite 和产物图片地址校验通过，退出码 0。
- 浏览器脚本重新验证通过 29 项，320/390/1440 宽度；本目录 JSON 与截图已更新为该独立工作树结果。
- 五项内容一致性检查全部通过。首次新检出受 `core.autocrlf=true` 影响，逐字节检查误报漂移；核对 7 个生成文件去除 CRLF 后与 HEAD blob 完全一致，恢复为 HEAD 的 LF 字节后检查通过，没有修改内容或纳入生成文件。
- 后端首次与前端构建同时启动，复制资源时 dist 尚未就绪，导致 3 项 RealArtifactSpaRoutingTest 返回 404；前端构建完成后重新运行相同完整隔离子集，结果见下方。
- 最终后端命令：JDK 21 下 `mvn.cmd test "-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT"`，397 项、396 通过、0 失败、0 错误、1 既有跳过，BUILD SUCCESS 且退出码 0；静态页面产物测试 4/4 通过。真实 MySQL 与真实 AI 验证仍未执行。
