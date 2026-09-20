# TypeMe 开放裁决项移交（阈值 / 真人试读 / 真实 AI 证据）

日期：2026-09-18。写给**下一位 Agent**：任务是**判断与裁决建议**，不是接着写功能。

> **2026-09-18 更正（复核后，只改文档）**：本文把现行实现的界简写成 `|S| ≤ floor(0.2n)`
> （≈ `|m| ≤ 0.10`），并据此刻画「选项 B：改 `floor(0.4n)`」。这不准确：现行实现是两个量——
> **澄清触发** `T(n) = floor(0.2n)`、**最终边界** `B(n) = max(0, T(n) − 1)`，边界只在最终合并题集上判一次
> （`backend/src/main/java/com/typeme/jung/domain/JungScoringPolicy.java`、冻结契约 §4.1）。
> 另注：契约 §4.1 **关于两套规格差异范围**的那句"差异只出现在 `T(n)` 那一格"**数学上有误**，
> 已加勘误；`T`/`B` 的定义与规则本身不受影响，但引用契约论证时不要照抄那半句。
> 实测 `n=12/S=2` 与 `n=9/S=1` 都是 `REFERENCE`（不是 `TENTATIVE`）。
> **恢复原产品方案的边界口径要求 `B` 本身变成 `floor(0.4n)`，只把分子改成 4 不够。**
> 以 [开放裁决项复核与建议](open-decisions-review.md) 为准；本文其余部分保持原样作为历史交接。

## 目标与边界

- 原始目标：TypeMe 持续优化进行到第 20 轮之后，有三个问题一直没人拍板。本次移交要求接手方在**不伪造证据、不代替用户选定产品值**的前提下，逐项给出可复核的裁决建议：
  1. 触发阈值 `0.20` vs `0.10`（决定用户看到 `REFERENCE` 还是 `TENTATIVE`）。
  2. 真人题面试读与信度/效度证据（目前为空）。
  3. AI 各失败分支的真实证据（目前基本只有 mock）。
  附带两项文档债：`progress.md` / `backlog.md` 只回写到第 20 轮；`backlog.md` 的 A63 条目已过期。
- 当前授权 / 禁止事项：
  - 本次已将累积改动提交并合并（PR #2 → `main`）。**新的提交、推送、发布未获授权。**
  - **数据库只读**：任何 DDL/DML（含往 `assessment_package` 插新阈值包）未授权；3 个会建删真实 MySQL 库的 IT 未授权执行。
  - **真实 AI 上游调用未授权**：把合成报告发到 `api.deepseek.com` 会产生费用，需用户单独授权。
  - **真人试读不能由 AI 自评替代**（项目文档原话：只能报告真实参与者的反馈）。
  - 产品值（阈值数值、是否新发 `scoringVersion`、是否投入真人研究）属于用户的决定；接手方给建议与代价，不替用户选。
- 当前状态：**NeedsConfirmation**。三项都缺「人」或「新证据」才能收敛；AI 能做的是把事实、选项、代价与判定判据钉死。

## 已完成与当前工作区

本会话**实际执行**（可直接采信，仍需按需复跑）：

| 命令 | 结果 |
|---|---|
| `node scripts/{gen-fallback-content,rewrite-types-content,check-type-duplication,convert-jung-content,gen-jung-fixtures,gen-platform-content}.mjs`（5 个 `--check` + 1 个检查） | 全部 exit 0 |
| `npm.cmd run typecheck`（frontend） | exit 0 |
| `npm.cmd test`（frontend） | 39 文件 / **905 条通过** |
| `npm.cmd run build`（frontend） | exit 0 |
| `mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT'`（JDK 21） | exit 0：**332 运行 / 331 通过 / 0 失败 / 0 错误 / 1 跳过** |

- 跳过的是 `AssessmentPackageLoadingTest` 的「空目录」前提（内容目录已有包），非新增跳过。
- `backend/target/surefire-reports/` 里有 2 份**陈旧**报告（`DeepSeekModelDiagnostic` 报 1 error、`TmpDumpReport`，时间 9/16–9/17，对应已不存在的诊断类）。统计只取本次运行新写的 44 份；直接对目录求和会得到「1 error」的假结论。
- VCS：`main` = `59fbb98`（PR #2 的合并提交），与 `origin/main` 同步；特性分支 `feat/optimization-platform-editorial` 已删除（本地与远端）。
- **工作区当前不是干净的，且有一部分不属于本移交**：
  - 29 个根目录一次性运行日志（`admin-*.log`、`atelier-*.log`、`images-*.log`、`visual-*.log`、`editorial-*.log`、`final-*.txt`、`vitest-*.txt`、`typecheck-after.txt`），未跟踪、未提交、未删除。
  - **另一个会话的在途改动**（见「在途工作」），同样未跟踪/未提交；本移交没有碰它们。
- 本会话**未运行**：完整 `mvn test`、真实浏览器验收、真实 AI 调用、任何数据库写入。

## 证据边界

- **已证实**（本会话直接读代码或执行命令）：
  - 现行阈值是 **0.10 政策**：`backend/src/main/java/com/typeme/jung/scoring/JungScorer.java` L35 `T(n) = floor(2n/10)`、`B(n) = T(n) − 1`；L188-189 `anyBoundary → TENTATIVE`。
  - 两份内容包均为 `"contentStatus": "draft_review_pending"`（`backend/src/main/resources/content/typeme-jung48-zh-v2.json`、`bigfive50-zh-v1.json`）。
  - **大五的 AI 解读已实现**（默认 v3 路径）：`backend/src/main/java/com/typeme/ai/input/ReadableReportInput.java` L33-61 显式分辨 `reportKind = big_five_profile`，按 E/A/C/ES/O 投影、类型码固定 `null`；`ReportInputBuilder.java` L122-135 的 `UNSUPPORTED_INSTRUMENT` 只在**旧提示词版本**（非 `typeme-ai-prompt-v3`）路径触发。
  - 前端有对应闸门：`frontend/src/components/AiAnalysisPanel.vue` L92-93（`readable = status.promptVersion === 'typeme-ai-prompt-v3'`，`supported = !requiresReadable || readable`），测试名「大五遇到旧提示词时禁用生成并解释原因，切换新版后可用」。
- **文档声明、本会话未复核**：所有真实浏览器 PASS/FAIL 计数、真实 MySQL 并发结果、真实上游 401 结果，均来自 `docs/optimization/verification/*/REPORT.md`，本轮未重跑。
- **推断（需确认）**：`backlog.md` A63「大五 AI 能力本身仍未做」在第 21 轮（readable）之后**已失效**——代码与测试都指向已实现。未回写，因此读旧文档的人仍会被误导（本会话已误导过一次，见上一轮汇报）。同类风险适用 A63 之外任何「未做」结论。
- **待确认 / blocker**：三个裁决项本身；以及是否需要给阈值改动新发 `scoringVersion` 与配套 DB 写入授权。

## 三项待裁决

### 1. 阈值 `0.20` vs `0.10`

- 事实：`c = direction × (rating − 3)`，`S = Σc`，`n` = 有效数字回答数，`m = S / (2n)`。原产品/开发方案的**边界**口径是 `5|S| ≤ 2n`（≈ `|m| ≤ 0.20`，且同一个 0.20 也当触发用）；冻结契约与现行实现分开两个量：触发 `T(n) = floor(0.2n)`、最终边界 `B(n) = max(0, T(n) − 1)`。已确认这是规格演进，不是浮点误差。
- 影响举例（JP 维、其他三维明确、跳过补充题；2026-09-18 用当前 TS 计分器 + v2 包实测）：`n=12,S=1` → `TENTATIVE`；`n=12,S=2`、`n=12,S=3`、`n=9,S=1` → 原方案都会标边界，现行实现是 `REFERENCE`。极端情形：`n=9` 时 `B(9)=max(0,1−1)=0`，非零方向**永远不会**被判「略偏」——与 `boundary` 想表达的「倾向较轻」相反。注意**触发不等于结论**：`n=12,S=2` 与 `n=9,S=1` 仍会触发追问，但最终是 `REFERENCE`。
- 选项：A 保持现行两条规则（与 v1 一致、`REFERENCE` 更多，但小 `n` 下「略偏」不可能出现）；B 恢复原产品方案的边界口径，即 `B(n) = floor(0.4n)`（**边界等于触发、不减一**；只改分子保留 `B=T−1` 不是这个方案，`n=12,|S|=4` 仍会是 `REFERENCE`），需新 `scoringVersion` 并解释「同答卷换版本后为何更保守」；C 分层（追问用 `floor(0.4n)`、最终解释另定一条界，语义最合理但实现与文案成本最高）。原文档建议 C，若需快速收敛则 A。
- 缺什么：**没有任何实证依据**说哪个更「准」——没有真实答卷分布、没有真人样本。因此「先固定政策、上线收集分布再评估」本身是可接受的裁决。
- 若选 B/C 的连带成本：需要新 `scoringVersion`、旧报告不得静默重算、`assessment_package` 需新增一行登记（**DDL/DML，需用户授权**）。
- 判定判据：接手方至少应能回答「改动后同一份答卷的用户可见结论会怎么变」「旧报告与新报告如何并存」「这次改动要动哪些表与版本号」。若这些答不清，建议维持 A。

### 2. 真人题面试读与信度/效度证据

- 事实：两份内容包 `contentStatus = draft_review_pending`；后端启动日志会打 WARN「题目……审核状态是『内部审核中』，尚未经过真人试读」。所有「读起来顺不顺」的判断至今来自开发者或模型视角；没有真人样本、没有重测一致性、没有与外部量表的相关证据。
- 选项：① 先做小样本可用性访谈（文档建议 5–8 名不熟悉人格术语者，用于发现理解障碍，**不能**称为统计代表性或效度验证）；② 先不做、维持 `draft_review_pending` 并按此口径对外表述；③ 做正式信效度研究（成本量级完全不同，需用户决定）。
- 缺什么：真人参与，AI 无法替代。AI 可产出的只有访谈提纲、试读材料、记录表与结果整理模板。
- 判定判据：是否有一份**真实参与者**签署/记录的反馈，能指出题面被误读的点；以及「不能把测试通过当作可读性或效度证明」这句是否被写进对外口径。

### 3. AI 各失败分支的真实证据

- 事实（按证据强度分档）：
  - **真实**：仅上游 401（`TYPEME_AI_MOCK_MODE=false` + 故意写错的 key，真打到 `api.deepseek.com`，任务 `errorCode=UPSTREAM_401`、`mock≠true`），且那是 **v2 契约时期**的证据。
  - **只有 mock**：上游超时、429 限流、输出截断（`TRUNCATED`）、模型返回不合格 JSON（被 `ReportAnalysisValidator` 拒）、额度/排队相关。
  - **完全未验证**：`typeme-ai-prompt-v3` 本身的语言质量、拒答率、重试分布与成本。readable 轮自己写明「没有验证真实模型的语言质量、拒答／重试分布和成本；白名单和格式测试不等于模型不会做过度解释」。
- 选项：① 申请一次受控真实调用（合成报告、限定次数与预算），把 401/超时/截断各补一条真实证据；② 维持 mock 证据并在文档中明确标注「失败分支为设计级保证」；③ 不做，等真实上线后观测。
- 缺什么：用户对真实调用与费用的授权；以及「哪些失败分支值得花真实调用买证据」的取舍。
- 判定判据：接手方应能说明每个分支「用户会看到什么」的现有保证来自哪一次测量，并指出哪些只是设计意图。

## 接手入口

- **先核验**（按信息价值排序，均为只读）：
  1. `backend/src/main/java/com/typeme/jung/scoring/JungScorer.java`（L30-40 注释、L134、L175-195）与 `backend/src/main/java/com/typeme/jung/domain/JungScoringPolicy.java`（L41 `isBoundary(sFinal, nFinal)`）—— 确认阈值的**实际**语义与 T/B 两界用途。
  2. `backend/src/main/java/com/typeme/ai/input/ReadableReportInput.java`（L30-80）与 `ReportInputBuilder.java`（L105-140、L200-235）—— 确认大五 AI 解读的真实支持面，避免沿用 A63 的过期结论。
  3. `docs/2026-09-18-platform-plan/阈值政策对比与决策请求.md`（全文 80 行）与 `docs/2026-09-18-platform-plan/计分审计与验证记录.md`（阈值演变证据）。
  4. `backend/src/main/resources/content/*.json` 的 `contentStatus`，以及启动日志里两条 `contentStatus=draft_review_pending` 的 WARN。
- **可立即推进**（互不覆盖，可并行）：
  1. 产出一份**裁决建议**：逐项「事实 → 选项 → 代价 → 缺什么证据 → 建议」，产品值保持为空（不替用户选），并明确哪些结论是本次复核过的、哪些是转述。完成判据：每项都能追到上面「最小证据索引」里的具体文件或命令。
  2. 回写文档债（纯文档，不需要跑测试）：`backlog.md` 的 A63 标注为「第 21 轮已实现，仅旧提示词路径保留 400」，并把 readable / visual / editorial / admin / atelier / generated-images 六轮补进 `progress.md`。完成判据：条目结论与当前代码一致，且不再有「未做」的过期表述。
- **在途工作**：**另一个会话正在做「report-paper」一轮**（无句柄可调用，本移交无法取得其所有者）。观测到的事实：`frontend/src/design/atelier.css`、`frontend/src/views/ReportV3View.vue` 被修改（+41/−13），新增 `docs/optimization/verification/2026-09-18-report-paper/`（30 张 320/390/1440 截图 + `atelier-checks.json`）与根目录 `report-paper-{build,tests,browser}.log`，最后写入时间 17:17–17:18。本移交只读观测，未修改、未提交、未删除其中任何文件。
  - 等待条件与约束：接手方**不要**把上述文件纳入自己的提交，也不要覆盖它们的改动；若接手方也要改 `frontend/src/` 的视觉或报告页，先确认该会话已结束（`report-paper-*.log` 停止增长、工作区不再变动），否则会产生覆盖冲突。
  - 与本次裁决的关系：这一轮属于视觉/报告排版，**不影响**本文档三项裁决的事实基础（阈值在 `jung/scoring`、AI 支持面在 `ai/input`、内容状态在 `resources/content`）。因此三项裁决可以照常推进。
- **需要时再扩展**：只有在上述 4 条复核与旧结论**冲突**时，才去读 `docs/optimization/verification/2026-09-18-*` 各目录的重跑脚本（`scripts/browser-verify-*.py`）；重跑需要可用的后端与数据库，属未授权范围，先问。

## 最小证据索引

| 路径 / 命令 | 为什么需要读；证明什么 |
|---|---|
| `backend/src/main/java/com/typeme/jung/scoring/JungScorer.java` | 阈值现状的唯一权威来源（`T(n)=floor(2n/10)`、`B(n)=T(n)−1`、`TENTATIVE` 判定） |
| `docs/2026-09-18-platform-plan/阈值政策对比与决策请求.md` | 两个规格的出处、影响表、A/B/C 三案与代价、待确认问题清单 |
| `docs/2026-09-18-platform-plan/计分审计与验证记录.md` | 证明「0.20 vs 0.10 是规格实质变化」而非误差 |
| `backend/src/main/java/com/typeme/ai/input/ReadableReportInput.java` | 大五 AI 解读**已实现**的证据（五维投影、类型码 null） |
| `backend/src/main/java/com/typeme/ai/input/ReportInputBuilder.java` | 旧提示词路径的 400 `UNSUPPORTED_INSTRUMENT` 边界，以及 `isBigFiveReport` 的双形状判别 |
| `backend/src/main/resources/content/typeme-jung48-zh-v2.json`、`bigfive50-zh-v1.json` | `contentStatus = draft_review_pending`（真人试读为空的直接证据） |
| `docs/optimization/verification/2026-09-18-ai-upstream-401/REPORT.md` | 唯一一条真实上游失败证据的范围（401 + v2 契约） |
| `docs/optimization/verification/2026-09-18-readable/REPORT.md` | v3 未做真实调用、语言质量与成本未验证的自述 |
| `docs/optimization/backlog.md`（A63 所在「第 20 轮新增」表） | 过期结论的样本：判断旧文档时先核对代码 |
| `docs/optimization/progress.md`（末尾「当前汇总」） | 文档债范围：只到第 20 轮 |

## 可复制提示

```text
请先阅读 docs/handoffs/2026-09-18/open-decisions-review-handoff.md，按「先核验」顺序读完最小证据索引前 4 项，
再推进「可立即推进」的两个动作。你的任务是判断与建议，不是实现功能：不要替用户选定阈值数值或研究投入，
不要把 REPORT.md 里的历史结论当成当前已验证，也不要沿用 backlog 里未经代码复核的「未做」结论。
数据库保持只读（任何 DDL/DML 需用户单独授权）；不要发起真实 AI 上游调用；不要提交、推送或发布。
工作区里有另一个会话的在途改动（report-paper 一轮：atelier.css、ReportV3View.vue、docs/optimization/verification/2026-09-18-report-paper/、report-paper-*.log），不要纳入你的提交，也不要覆盖。
若你复核出的事实与本文档冲突，以当前可复核证据为准并明确报告差异。
```

## 备注（给用户）

- 本文档本身是**新增未提交文件**；本会话的授权范围只覆盖到此前的 commit / push / PR 合并，因此没有 add、commit 或 push 这份移交文档。
- 文档不含任何密钥、密码、连接串或个人信息；涉及真实调用的部分只写了配置键名（`TYPEME_AI_MOCK_MODE`、`TYPEME_AI_API_KEY`）与授权要求。
