# 2026-09-18 阈值政策（score-v3）收尾验证：浏览器 / 旧版回归 / 报告文案基线

范围：只验证"状态与候选变化的用户可见行为""旧版完整回归""新包没有顺带换报告文案"三件事。
**没有**数据库写入、**没有**后端进程、**没有**真实 AI 调用、**没有**提交或发布。

## 1. 浏览器验证（320 / 390 / 1440）

- 方式：Playwright + **全量拦截 `/api/**`**，静态服务的是**隔离构建产物**
  （`npx vite build --outDir %TEMP%/typeme-v3-verify-dist`，未覆盖 `frontend/dist`，未改动任何页面源文件）。
- 报告数据来自**生产计分器与报告构造器**（`JungReportCopyBaselineTest#writeBrowserFixtures`
  → `backend/target/score-v3-browser-fixtures/`），不是手写的假 JSON。
- 脚本：`scripts/browser-verify-score-v3.py`；结果：`browser-results.json`（**170 项全部通过，0 未捕获错误，0 未定义接口**）。

| 场景 | 报告数据 | 页面断言（每个宽度都跑） |
|---|---|---|
| v3 新边界 | `v3-boundary`：`TENTATIVE`、`ENFP`、2 个候选（`typeme-jung48-score-v3`） | 状态徽标 `TENTATIVE`；说明文字含"差距很小/倾向较轻"；`[data-type-code]` = `ENFP`；`[data-candidate]` = `ENFP`/`INFP`；`[data-boundary-note]` ≥ 1；状态说明/类型码/候选列表都有布局盒且横向不越界；无横向溢出 |
| 旧版同答卷 | `v1-same-answers`：**同一批作答**走 v1 包 → `REFERENCE`、`ENFP`、**0 候选**（`typeme-jung48-score-v1`） | 状态 `REFERENCE`；说明文字含"都有偏向"；类型码 `ENFP`；候选 0；边界说明 0 |
| TIED | `v3-tied`：`TIED`、无四字母、4 个候选 | 状态 `TIED`；`[data-type-code]` **数量 0**；`[data-tied-title]` 存在；候选 4 个 |
| NEEDS_REVIEW | 报告接口 **404**（服务端不为覆盖不足落报告） | 显示 `[data-report-not-found]`；**不渲染** `[data-report-overview]`；无四字母、无候选 |

证据：本目录 12 张全页截图（`{场景}-{宽度}.png`）+ `browser-results.json`。

**限制**：截图是留给人看的；本次执行者**没有图像输入能力，未做人工目视确认**，
所以自动化断言里额外加了"元素有布局盒 / 有可见尺寸 / 横向落在视口内"三条几何判据来替代部分目视检查。
`NEEDS_REVIEW` 的"不落报告"由后端契约测试（`SubmitReportIT`）与这里的 404 空态共同覆盖，
但**没有**在浏览器里跑完整答题→提交链路。

## 2. 旧版（v1 / v2）独立固定期望回归

`JungLegacyScoringRegressionTest`（8 条，`backend/src/test/java/com/typeme/jung/scoring/`）。
期望值**对着冻结规则手算后写死**（`T(n)=floor(2n/10)`、`B(n)=max(0,T(n)−1)`、四状态优先级、候选=边界维×平分维），
输入复用共享夹具的同一批作答（每维 `S`/`n` 与边界规则无关，可安全复用）。

覆盖：边界等号（`n=12,|S|=1` → `TENTATIVE`）；边界外一格（`n=12,|S|=2` → `REFERENCE`，v3 会改判）；
最低覆盖线（`n=9,|S|=1` → `REFERENCE`，v3 会改判）；补充题跳过/完成（`n=12`→`n=16`，`S=2` 与 `S=5` 两种结局）；
平分（`TIED`、无四字母、4 候选、cost `[0,0,1,1]`）；覆盖不足（`NEEDS_REVIEW` 优先，且保留 `n=0` 维 `boundary=true` 的旧定义）；
追问安排与版本无关（三版对同一作答安排相同补充题）；版本绑定（包声明、文案可解析、`2/10`、覆盖下限 9，`n=0..40` 逐点表）。

**断言有效性（变异验证）**：把 v1/v2 的 `B(n)` 临时改成与 v3 相同（统一尺度）→ 本类 **4 条失败**
（CASE-09/CASE-13/CASE-21 状态、`B(5)` 表），已还原并复查无残留。说明这些断言不是"照抄实现"。

## 3. 报告文案基线（不只看常量）

`JungReportCopyBaselineTest`（4 条，`backend/src/test/java/com/typeme/jung/service/`）：

1. **基线**：改动前（`git show HEAD`）`CURRENT_PACKAGE_ID = typeme-jung48-zh-v1`，而 v1 包声明
   `reportContentVersion = typeme-type-report-zh-v1`；当前默认包 v3 声明的**也是同一版**。
   → 改动前新草稿实际用的就是 v1 文案，**不是 v2**（v2 文案只对 v2 绑定包生效）。
2. **解析结果**：加载器按包声明解析出来的 `TypeReport` **没有** `readableSummary` / `readableFirstSteps`，
   `nextActions` 是 3 条、八段解读齐全；同时用 v2 报告内容做**反证**（它有 readable 字段），断言不是恒真。
3. **报告字节**：同一批作答、同一状态（CASE-12 两版都 `REFERENCE`）下，v1 包与 v3 包生成的
   `report_json` 在排除 5 个版本/哈希字段（`scoringVersion`/`packageId`/`reportContentVersion`/`contentSha256`/`policyVersion`）
   与 `reportHash` 后**逐字段完全相同**（500+ 字段比对）。
4. 浏览器夹具的生成与自检（见 §1）。

**断言有效性（变异验证）**：把新包的报告文案改成 `typeme-type-report-zh-v2` 并重新生成内容包 →
本类 **3 条失败**（声明版本不符、解析出 readable 字段、报告结构 340→334 项）；已还原并复查
内容包指纹回到 `declared sha256=44fbb3d374f13772…` / 文件 `93e8c7fff0919704…`。

## 4. 本轮仍未覆盖

- **数据库登记**（`assessment_package` 增加 v3 行）与**真实 MySQL 测试**（3 个 `*MySqlIT`）、**真实 AI 调用**：均未授权、未执行。
- 浏览器验证是"合成报告 + 模拟接口"：**没有**覆盖真实登录会话、真实提交、真实草稿绑定；
  也没有跑 `NEEDS_REVIEW` 的完整答题链路。
- 截图未做人工目视确认（执行者无图像输入）。
- `docs/2026-09-18-platform-plan/题目审校与版本决策.md` L114 仍是决策前的边界口径：
  该文件有另一会话在途改动，本轮只读未写，**继续记为待同步**。
