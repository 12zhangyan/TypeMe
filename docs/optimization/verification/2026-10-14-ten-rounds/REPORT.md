# 2026-10-14 第 36–45 轮验证

十轮都落在当前工作区，没有提交，没有写现有数据库。

## 命令

| 命令 | 结果 |
|---|---|
| `frontend`：`npx.cmd vitest run`（全量） | 58 个文件，1209 条通过，exit 0 |
| `frontend`：聚焦 7 个 spec | 96 条通过，exit 0 |
| `frontend`：`npm.cmd run typecheck` | exit 0 |
| `backend`：`JAVA_HOME=D:\develop\jdk-21`，`mvn.cmd test -Dtest=SubmitReportIT` | Tests run: 4, Failures: 0, Errors: 0, Skipped: 0，BUILD SUCCESS |
| `python docs/optimization/verification/2026-10-14-ten-rounds/browser_check.py` | `failures: []`，`unknown: []`。见 `browser-result.json` |

`SubmitReportIT` 跑在测试用的 H2 上。没有跑 `AccountSqlDialectMySqlIT`、`AiSqlDialectMySqlIT`、`ConcurrencyMySqlIT`，也没有跑后端全量子集。前端全量是 Vitest，不含 `npm test` 的内容生成前置脚本。

## 浏览器

前端 dev server：`http://127.0.0.1:5173/`。Playwright 拦截 `/api/v3/**`，不连接 8080，不写库。账号是合成的 `browser_owner`，截图里没有密码、令牌或恢复码。

每个页面在 320、390、1440 宽度各留一张视口图，横向溢出（`scrollWidth - clientWidth`）均为 0：

- `shots/home-resume-*.png`：续答说明含「已答 10/48 题」
- `shots/jung-conflict-*.png`：冲突横幅与「载入最新进度」，下一题禁用，仍是情境 q1
- `shots/skip-confirm-*.png`：已答补充题后再跳过，先出现「跳过已经答过的补充题」
- `shots/method-*.png`：四个维度，页面没有停在「登录状态已改变」
- `shots/bigfive-conflict-*.png`：仍是陈述句 1，下一题禁用，有「读取服务端进度并核对」

会话变更打断方法页这一条，浏览器脚本没有制造竞态，组件测试覆盖。分享图没有在浏览器里导出。
