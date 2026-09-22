# A58 实施与验证汇总（2026-09-21）

本目录记录把 `GET /api/v3/catalog/current`（含 `/catalog/current/package`）按契约 §7
从"要登录"放开为"公开"的全过程，包含连带修掉的两个通用缺陷（A74 / A75）。

## 文件

| 文件 | 内容 |
|---|---|
| `REPORT.md` | 完整报告：决策依据、改动清单、两个连带缺陷、限流口径、验证、边界与未覆盖 |
| `first-run-red.txt` | 第一次跑新用例时的**红灯**（这就是发现 A74/A75 的现场） |
| `first-run-a75-evidence.txt` | A75 现场：匿名限流用例 `expected: 429 but was: 200`（把匿名当已登录） |
| `after-fix-targeted.txt` | 修复后定向 5 个测试类（35 条）全绿 |
| `after-fix-backend-full.txt` | 修复后后端全量（排除 3 个真实 MySQL IT）404/0/0/1 |
| `after-fix-frontend.txt` | 前端 typecheck + vitest：50 文件 / 1038 条 |
| `discriminator-anonymous.txt` | 判别力 1：撤掉 `CurrentUser` 匿名判定 → 只红匿名限流那条 |
| `discriminator-permitall.txt` | 判别力 2：撤掉新增的两条 `permitAll` → 只红匿名可读那条 |
| `discriminator-userdata.txt` | 判别力 3：把 `/api/v3/**` 放宽成 `permitAll` → 只红用户数据护栏那条 |

## 一句话（给台账用）

`permitAll` 两条只读路径 + 匿名 IP 限流（`5m/120`，已登录不计）+ 新增 4 条测试；
顺手修真两处"把匿名当已登录"的判断与两处"拦不住限流异常"的 advice；
后端 404/0/0/1、前端 50/1038、三条判别力逐条验证；**未跑真实浏览器、未提交、未部署**。