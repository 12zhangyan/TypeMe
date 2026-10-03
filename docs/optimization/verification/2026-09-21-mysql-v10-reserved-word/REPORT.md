# 真实 MySQL 方言复盘：V10 保留字导致部署阻断（A72 / A73）

- 日期：2026-09-21（第 28 轮）
- 环境：本机 MySQL **8.4.0**（`127.0.0.1:3306`，测试用 `root`，见仓库内默认测试属性）；JDK 21
- 授权：用户本轮明确“授权可以在我本地测试”，即允许运行会**自动建库/删库**的三类真实 MySQL IT
- 证据文件：`reproduce.txt`（修复前）、`after-fix.txt`（修复后）、`discriminator.txt`（判别力）

## 1. 结论

两份独立的缺陷，叠加起来让一个部署阻断级问题躲过了一整轮：

1. **A72（P0）**：`V10__illustration_asset.sql` 在任何 MySQL 上都无法应用。列名 `release` 是
   MySQL 8 保留字（`RELEASE SAVEPOINT`），裸写进 DDL 直接 `1064`；而该迁移又用了 MySQL 8 专有的
   `COLLATE utf8mb4_0900_as_cs`，5.7 也不认。**尚未应用 V10 的库（含当前 `typeme_dev`，停在 V8）
   下次启动时 Flyway 直接失败，整个后端起不来。**
2. **A73（P1）**：`ConcurrencyMySqlIT` 的静态初始化把**任何**异常都当成“环境缺失”，整类跳过 ——
   于是一份语法就无法通过的迁移，表现成“跳过 3 条”，报告上看不出任何异常。它还在失败路径上
   不清理建出来的临时库。

## 2. 复现（修复前）

```
mvn test -Dtest=AccountSqlDialectMySqlIT,AiSqlDialectMySqlIT,ConcurrencyMySqlIT

[ERROR] Tests run: 4, ..., Errors: 4, ... -- in com.typeme.account.AccountSqlDialectMySqlIT
[WARNING] Tests run: 3, ..., Skipped: 3, ... -- in com.typeme.ConcurrencyMySqlIT
[ERROR] Tests run: 8, Failures: 0, Errors: 5, Skipped: 3
[INFO] BUILD FAILURE
```

失败信息原文：

```
Migration V10__illustration_asset.sql failed
Error Code : 1064
Message    : You have an error in your SQL syntax; ... near 'release    VARCHAR(32)  NOT NULL,
```

同时对照：H2 上的 400 项后端子集**全绿**（`release` 在 H2 的 MySQL 模式里不是保留字），
所以“全绿”从来不等于“能在 MySQL 上建表”。这一点 `verification/2026-09-20-image-cdn/REPORT.md`
§13.3 其实已经自己写明（“真实 MySQL 上执行建表迁移……目前还没有人在真实 MySQL 上执行过它”）。

另：确认 V10 从未成功过 —— `typeme_dev.flyway_schema_history` 最高只到 **v8**，且
`information_schema` 里**没有任何** `illustration_asset` 表。

## 3. 修复

| 文件 | 改动 |
|---|---|
| `backend/src/main/resources/db/migration/V10__illustration_asset.sql` | 列名 `release` → `release_tag`；头部补写“为什么带 `_tag`”“为什么必须原地修而不是加 V11” |
| `backend/src/main/java/com/typeme/platform/service/IllustrationAssetService.java` | `SELECT` / `UPDATE ... SET` / `INSERT` 与 `row.get(...)` 同步；对外 JSON 字段仍叫 `release`，契约不变 |
| `scripts/gen-image-publish.mjs` | `--emit-sql` 模板同步（**输出与 V10 逐字一致**） |
| `docs/2026-09-20/图片URL入库方案.md` | DDL 示例与“`release` 列”表述同步 |
| `backend/src/test/java/com/typeme/platform/IllustrationAssetIT.java` | 列名断言同步 |
| `backend/src/test/java/com/typeme/ConcurrencyMySqlIT.java` | 迁移失败变红；失败也清理临时库 |

**为什么原地改 V10 而不是追加 V11**：V11 要能执行，前提是 V10 已经成功；而 V10 在 MySQL 8 撞保留字、
在 MySQL 5.7 缺 COLLATE，**不可能成功**，所以不存在“已应用过 V10 的库”，也就没有历史含义需要保留
（也有实测支持：V10 未出现在任何库的 `flyway_schema_history` 里）。反过来，如果只在 V11 里改名，
迁移链会永远卡在 V10 上。

## 4. 验证

| 项 | 结果 |
|---|---|
| 三类真实 MySQL IT（修复后） | **8 通过 / 0 失败 / 0 错误 / 0 跳过**，BUILD SUCCESS（修复前 5 errors + 3 skipped） |
| 重跑一次（确认可重复） | 再次 8/8、0 跳过，BUILD SUCCESS |
| **判别力**：把 V10 列名改回 `release`，只跑 `ConcurrencyMySqlIT` | `Tests run: 3, Errors: 3, Skipped: 0` —— 从“跳过 3 条”变成**红 3 条**，错误直指 `Migration V10 ... failed`；失败后**无残留库** |
| 生成器 ↔ 迁移一致性 | `node scripts/gen-image-publish.mjs --emit-sql --out work/v10-regen.sql` 后与 V10 `diff` → **IDENTICAL** |
| 后端全量子集（排除 3 类真实 MySQL IT） | **400 通过 / 0 失败 / 0 错误 / 1 跳过**，BUILD SUCCESS（含 H2 上的 `IllustrationAssetIT`，与基线一致、无回归） |
| 临时库清理 | 成功与失败两条路径后均无 `typeme_concurrency_*`；此前遗留的两个已手工删除 |

未改动前端源码（对外 JSON 仍是 `release`），故未重跑前端测试。

## 5. 边界与未覆盖

- 只在**本机 MySQL 8.4.0** 验证；MySQL 5.7/8.0 与任何远端/生产库未覆盖。
- **没有把 V10 应用到 `typeme_dev`**，也没在任何现有库上执行迁移。用户给的授权是“跑会自动建/删
  临时库的 IT”，不等于允许改动现有库；因此“部署时 V10 能否成功”是由**在临时库上跑通同一份迁移**
  推出的，不是在生产库上实测的。
- 未做真实浏览器验收、未做真实 AI 外发。
- 前一会话在途的 AI v4 / review-fixes 未提交，本轮未动。
