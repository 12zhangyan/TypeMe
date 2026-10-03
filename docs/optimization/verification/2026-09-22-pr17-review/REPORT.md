# PR #17 的 Codex 评审处置（2026-09-22）

## 0. 结论速览

| 评审意见 | 我的判定 | 处置 |
| --- | --- | --- |
| ① `V10` 原地改列名应改为增量迁移 | **前提不成立**（不存在应用过旧版 V10 的库） | 结论不变，**把推理补成可复现证据**（A85） |
| ② `requeueForRetry` 纳入 `SUCCEEDED` 会让失败的再生成抹掉旧正文 | **属实，是真缺陷** | **已修**：失败态继续展示上一次正文并标明来源（A84） |

评审原文两条我都读过；下面分别是判定依据、改动、验证与判别力。

---

## 1. 意见②：重新生成失败不应抹掉上一次成功的正文（A84，P1，已修）

### 1.1 为什么判定为真缺陷（读代码，不靠印象）

三处事实合起来构成完整因果链：

| 事实 | 位置 |
| --- | --- |
| 重新入队允许从成功态出发：`WHERE … AND status IN ('FAILED','UNKNOWN','SUCCEEDED')` | `AnalysisJobRepository.java:229` |
| **全仓库只有一处**写 `response_json`：`SET status='SUCCEEDED', response_json = ?, …` | `AnalysisJobRepository.java:183` |
| 重新入队只改状态与调度字段；`markFailed`/`markUnknown` 只改 `error_code`/`usage_json`/`finished_at`，**都不触碰 `response_json`** | `AnalysisJobRepository.java:190`、`:202`、`:229` |

结论：状态落到 `FAILED` / `UNKNOWN` 时，**上一次成功的正文仍在库里，也仍在 `GET …/analyses` 的响应里**
（`AnalysisService.JobView.of` 直接 `parseResult(row.responseJson())`，不按状态过滤）。

但前端 `AiAnalysisPanel.vue` 把两张卡写成同一条 `v-else-if` 链：

```html
<div v-if="running">…</div>
<div v-else-if="failed">失败卡</div>
<div v-else-if="succeeded">结果卡</div>   <!-- FAILED 时永远不会到这里 -->
```

于是用户点一次「再生成一次」失败，**此前能读的分析从界面上消失**（数据还在）。
这与面板里既有的文案「失败不会被算作'已经给过你一份分析'」自相矛盾——那句话暗示旧结果还在。

### 1.2 改动（只动展示层）

- `frontend/src/components/AiAnalysisPanel.vue`
  - 模板拆成两条**独立** `v-if`：失败卡 `v-if="failed"`，结果卡 `v-if="showResult"`。
  - 新增两个 computed：
    - `staleResult = failed && job.result != null`
    - `showResult = succeeded || staleResult`
  - 失败卡文案加分支：有旧正文时说「这次重新生成没有成功，所以下面那份上一次成功生成的内容没有被替换掉」；
    没有旧正文时保持原文案。
  - 结果卡顶部新增 `[data-ai-stale]` 提示：「**这份是上一次成功生成的内容**：本次重新生成没有成功，所以它没有被替换。」
- 未改：数据模型、状态机、`requeueForRetry` 的 SQL、接口响应形状。

### 1.3 `result != null` 能推出「历史上成功过」——由代码保证，不是猜的

因为**只有** `markSucceeded` 会写 `response_json`，所以 `result` 非空 ⇔ 至少成功过一次。
反向用例据此成立：从未成功过的任务（`result: null`）在失败态**不**渲染结果区。

### 1.4 测试与判别力

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 修复态 | `npx vitest run src/components/aiAnalysisPanel.spec.ts` | **15 passed**（原 13 + 新增 2） |
| 判别力 | 把 `showResult` 退回 `computed(() => succeeded.value)` 再跑同一条 | **1 failed / 14 passed**，失败点正是新用例：`expected false to be true` |
| 类型 | `npm run typecheck` | 退出 0 |
| 全量 | `npx vitest run` | **50 文件 / 1074 条通过**（第 31 轮基线 1072，+2） |

新增的两个用例：

1. `重新生成失败：上一次成功的正文不能被藏起来，并要标明"这是上一次的"（A84）`
   —— 断言 `[data-ai-failed]`、`[data-ai-retry]`、`[data-ai-result]`、`[data-ai-stale]` 同时存在，
   且 `[data-ai-summary]` 仍含旧摘要文本。
2. `确实一次都没成功过时，失败分支不凭空渲染结果区（A84 反向）`
   —— `result: null` 时 `[data-ai-result]` 与 `[data-ai-stale]` 都必须不存在。

原始输出：
- `panel-fixed-15-passed.txt`
- `panel-discriminator-revert-1-failed.txt`

### 1.5 未覆盖 / 残留

- **只改了展示层，没有做真实浏览器回归**：本轮无法在不授权真实 AI 调用的前提下制造「先成功、再失败」
  的真实状态（需要上游超时/429/非法 JSON）。要页面级确认需另行授权一次真实 AI 试跑。
- **数据模型层面仍只有一份结果**：`uk_ai_job_request` 决定同一份发送范围只有一行任务、一个 `response_json`。
  所以「重新生成**成功**」会原地覆盖上一份正文，**没有历史版本可回退**。要保留多份需要新表/新列 + 增量迁移，
  属需用户决定项，本轮未动。

---

## 2. 意见①：V10 该不该改成增量迁移（A85，P3，结论不变）

### 2.1 评审的前提

评审认为「旧版脚本在仓库支持的 H2 MySQL 模式下可以成功执行」，因此担心存在
「已经执行过旧版 V10、表里只有 `release` 列」的库；那种库在本次原地修改后会先撞 Flyway checksum 不匹配，
即使跳过校验也会因为代码查 `release_tag` 而失败。

前提里「H2 能过」这一半，我复现并确认成立（见 2.2 第 ⑤ 条）。**缺的是另一半：是否真有库应用过它。**

### 2.2 取证（全部只读 + 一次性探测库，跑完即删）

| # | 探测 | 证据文件 | 结果 |
| --- | --- | --- | --- |
| ① | 在真实 MySQL 8.4 上执行**原版** V10（`git show 6bc09ca^:…V10__illustration_asset.sql`） | `mysql8-original-v10-rejected.txt` | `ERROR 1064 … near 'release VARCHAR(32) NOT NULL, …'`；该库**一条语句都没成功**，`illustration_asset` 根本没建出来 |
| ② | 全机三个 TypeMe 库的 `flyway_schema_history` 里 `version>=9` | `mysql-flyway-history-and-column.txt` | 只有 `typeme_dev` 有 9/10 两条；`typeme_show`、`typeme_test` **为空** |
| ③ | 全库 `illustration_asset` 表及其列名 | 同上 | 只有 `typeme_dev` 一张，列名 `asset_name,url,sha256,release_tag,updated_at` —— **没有 `release`** |
| ④ | 两个被 gitignore 的 H2 文件库（`output/*.mv.db`） | 同上（清单） | 迁移停在 **V8**，且整个文件里 **0 处** `illustration_asset` 字样 |
| ⑤ | 旧版 DDL 在 H2 MySQL 模式下执行 | `h2-old-v10-accepted-by-h2.txt` | 退出 0 —— **评审的前提这一半成立** |

> 探测库 `typeme_r32_probe` 用完即删；未使用 `--force`，遇错即停。
> 注意：`mysql` 必须从脚本文件读入，不能在命令行再写 `</dev/null`（否则会读空文件、假成功，我第一版就踩了这个坑）。

### 2.3 结论

**不追加 V11，保持原地修正。** 理由：

1. 不存在应用过旧版 V10 的库（①②③④），所以不存在「需要被重命名保护」的历史状态；
2. V10 不成功时 V11 永远轮不到执行（Flyway 按序应用，失败即停）——追加 V11 反而掩盖了「V10 本身写错」这件事；
3. 全库唯一存在的 `illustration_asset`（`typeme_dev`）本来就已是 `release_tag`，且它就是本轮 V10 应用出来的。

同时把这条从「迁移注释里的推理」升级为**可复查证据**，并把五条探测原始输出存档到本目录。

---

## 3. 本轮文件清单

改动源码：

- `frontend/src/components/AiAnalysisPanel.vue`（A84 修复）
- `frontend/src/components/aiAnalysisPanel.spec.ts`（A84 +2 用例）

文档与账本：

- `docs/optimization/backlog.md`（新增「第 32 轮新增」：A84、A85）
- `docs/optimization/progress.md`（新增「第 32 轮」）
- `docs/optimization/verification/2026-09-22-pr17-review/`（本目录）

本目录证据文件：

| 文件 | 内容 |
| --- | --- |
| `panel-fixed-15-passed.txt` | 修复态组件测试原始输出（15/15） |
| `panel-discriminator-revert-1-failed.txt` | 判别力：退回修复前的精确红（1 failed / 14 passed） |
| `mysql8-original-v10-rejected.txt` | 原版 V10 打真实 MySQL 8.4 → `ERROR 1064`，表未建出 |
| `h2-old-v10-ddl.sql` | 用于探测的旧版 DDL（含 `release` 列） |
| `h2-old-v10-accepted-by-h2.txt` | 同一份 DDL 打 H2 MySQL 模式 → 退出 0 |
| `mysql-flyway-history-and-column.txt` | 三个 TypeMe 库的 flyway 历史与 `illustration_asset` 列名盘点 |

## 4. 与评审的差异

- 评审建议①「新增后续迁移，不要重写 V10」——**未采纳**，因为其前提（存在已应用旧版 V10 的库）经取证不成立；
  但我把「为什么前提不成立」补成了证据，而不是继续用注释里的推理。若将来确有库应用过 V10，
  Flyway 会先报 checksum 不匹配（这是期望行为，不静默）。
- 评审建议②——**采纳**，但修法选择「展示层不隐藏旧正文 + 明确标注来源」，
  而不是「保留再生成前的成功结果」所需的表结构改造。后者的正确形态涉及新表/新列与迁移，属需用户决定项。