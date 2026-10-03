# 阈值方案 B（`0.20`）落地为计分版本 v4（2026-09-22）

> 本轮按用户明确指定的方案实施：**澄清触发阈值与最终「倾向较轻」边界都从归一化偏移 `0.10`
> 改到 `0.20`**，即 `T(n) = B(n) = floor(2n/5)`。
>
> 这是**产品政策变更**，不是缺陷修复，也**不宣称提高测量准确性**。
>
> 本文只写实测结果。未跑真实 MySQL、未登记数据库、未提交、未部署，均在 §6 明确写出。

---

## 1. 为什么必须发新版本（而不是原地改）

| 事实 | 证据 |
|---|---|
| 报告把计分版本、包 ID、内容哈希写进正文 | `JungReportBuilder#methodology` 输出 `scoringVersion` / `packageId` / `contentSha256` / `boundaryNumerator` / `boundaryDenominator` 等 |
| 草稿绑定创建时的 `package_id` | `AssessmentCatalog.defaultPackageId` / `JungPackageLoader.CURRENT_PACKAGE_ID` |
| 原地改 v3 会让"同一 `packageId` 在不同时间算出不同结论" | 契约 §1"发布后不可改"；旧草稿旧报告无法解释 |
| `score-v3` / `zh-v3` 已被占用 | 仓库已有 `typeme-jung48-zh-v3.json`；复用 ID 会在 `JungPackageRegistrar` 的 UPSERT 里**覆盖**旧行 |

所以新标识取 **`typeme-jung48-score-v4`** / **`typeme-jung48-zh-v4`**；v1 / v2 / v3 的包、草稿、
报告与哈希**一个字节都没改**。

---

## 2. 规则全文与版本并存

```
T(n) = floor(2n / 5)      // 触发：|S| <= T(n) 且 n >= 9 时安排该维 4 道补充题
B(n) = floor(2n / 5)      // 边界：与触发同一把尺子（沿用 v3 的口径，只换数值）
boundary = (n_final > 0) && (|S_final| <= B(n_final))    // 仍在最终合并题集上判一次
```

| 版本 | 触发 `T` | 边界 `B` | 状态 |
|---|---|---|---|
| `score-v1` / `score-v2` | `floor(2n/10)` | `max(0, T−1)` | 冻结（旧包/旧草稿/旧报告继续按它解释） |
| `score-v3` | `floor(2n/10)` | `T(n)`（且要求 `n>0`） | 冻结（2026-09-18 的决定） |
| **`score-v4`** | **`floor(2n/5)`** | **`T(n)`**（且要求 `n>0`） | **本轮新增，新草稿默认绑定** |
| 未知版本 | — | — | **加载期抛错**，不静默回落 |

选项粒度说明：`floor(2n/5)` 与 `floor(4n/10)` 在整数上相等，但契约 §4.1 原文写的就是 `floor(2n/5)`，
而且 `numerator=4` 会与「分子 4 但仍保留 `B = T−1`」这条**第三套口径**混淆（它 `n=12,|S|=4` 仍是
`REFERENCE`，不是本方案）。所以包声明写成 `{boundaryNumerator: 2, boundaryDenominator: 5}`。

### 2.1 跳档点（两侧逐点核对）

| n | 9 | 12 | 16 |
|---|---|---|---|
| `T`/`B`（v3, `/10`） | 1 | 2 | 3 |
| `T`/`B`（v4, `/5`） | **3** | **4** | **6** |

---

## 3. 用户可见变化（两件，与 v3 那次不同：这次都变大）

| 情形 | v3（冻结） | v4 |
|---|---|---|
| `n=9`、`\|S\|=2`（跳过补充题） | `REFERENCE`、**不安排**澄清 | **安排**澄清（`T(9)=3`）；跳过则 `TENTATIVE`（`B(9)=3`） |
| `n=12`、`\|S\|=3`（跳过补充题） | `REFERENCE`、**不安排**澄清 | **安排**澄清（`T(12)=4`）；跳过则 `TENTATIVE`（`B(12)=4`） |
| `n=12`、`\|S\|=4` | `REFERENCE`（`B(12)=2` 之外） | `TENTATIVE`（等号格） |
| `n=16`、合并后 `\|S\|=5` | `REFERENCE`（`B(16)=3` 之外） | `TENTATIVE`（`\|5\| <= B(16)=6`） |
| `n=16`、合并后 `\|S\|=7` | `REFERENCE` | `REFERENCE`（`B(16)=6` 之外） |

- **好处**：中间地带会被标成「倾向较轻」并列出候选，而不是被讲成「方向明确」；更多边界附近的样例能拿到一次补充确认。
- **代价**：**更多用户要多答补充题**（可能多出若干维 × 4 题），报告里「倾向较轻」的比例会上升。

### 3.1 证据边界（不得省略）

- 归一化界限取 `0.10` 还是 `0.20` **都没有**本次可核验的信度或效度依据，属**产品政策取舍**。
- **带宽翻倍不等于「补充题数量翻倍」**：实际多出多少取决于真实答卷的 `|S|` 分布落在哪一档。
  本轮**没有任何真人试测数据**，不能由公式反推效果，也不能说它让测评更准、更严谨或更可信。
- `0.20` 不是概率、置信度、准确率或匹配度，只是规则里的一条门槛。
- 「倾向较轻」表达的是**这条规则给出的标记**，不是「这个人的倾向真的弱」。

---

## 4. 改了什么

| 层 | 文件 | 改动 |
|---|---|---|
| 内容源（维护入口） | `scripts/gen-platform-content.mjs` | 新增 `V4_*` 常量与 `buildJungV4(v3)`：派生 v4，**断言题目/维度/可读层与 v3 逐字相同**，且 `scoringPolicy` 只允许 `version` 与 `boundaryDenominator` 两个键不同；另写死跳档表自检 |
| 生成产物 | `backend/src/main/resources/content/typeme-jung48-zh-v4.json`（新） | `sha256 = a5208fcd387c34d2c4907a0cc6eff3790782f47cf144a82de2fd71c3c423f103` |
| 后端分发 | `jung/domain/JungScoringPolicy.java` | `UNIFIED_SCALE_VERSIONS` 加 `…-v4`；类注释写明 v4 口径与"不是更准" |
| 后端默认包 | `jung/content/JungPackageLoader.java` | `CURRENT_PACKAGE_ID` → `typeme-jung48-zh-v4` |
| 后端注释 | `jung/scoring/JungScorer.java` | javadoc 去掉硬写版本号与常量 |
| 前端版本表 | `frontend/src/domain/jung/types.ts` | `UNIFIED_BOUNDARY_SCALE_VERSIONS` 加 v4 |
| 共享夹具 | `scripts/gen-jung-fixtures.mjs` + 3 份 `score-cases.json` | 源改为 v4 包；**25 例**，`sha256 = 96943e4bbc1e…` |
| 后端断言 | `JungScoringPolicyTest`(9)、`JungLegacyScoringRegressionTest`(9)、`JungReportCopyBaselineTest`(4)、`JungReportSchemaTest`(15) | v4 逐点表 + v3/v1/v2 冻结表 + 未知版本拒绝 + 报告文案不换版 |
| 前端断言 | `thresholds.spec.ts`、`scoring.fixture.spec.ts`、`snapshotThresholdCopy.spec.ts`、`readingCompanion.spec.ts`、`reportV3View.spec.ts` | 同一张 v4 表的前端侧；阈值文案由快照派生；可读层沿用 |
| 页面验收 | `scripts/browser-verify-score-v4.py`（新） | 自带静态服务、`/api/**` 全拦截、320/390/1440 |

### 4.1 报告文案**没有**换版

`typeme-jung48-zh-v4.json` 声明的 `reportContentVersion` 仍是 **`typeme-type-report-zh-v1`**
（与 v3、v1 相同）。这一点由 `JungReportCopyBaselineTest` 双向钉住：

- `v1PackageReportCopyIsStillTheDefault`：v4 的 `reportContentVersion` == v1 的默认声明；
- `sameAnswersAndStatusProduceIdenticalReportBodies`：用 **CASE-01**（v1 与 v4 都是 `REFERENCE`）
  生成两份报告，除版本/哈希/阈值字段外**逐字段相同**。

> 基线用例从 CASE-12 换成 CASE-01 是必要的：CASE-12 在 v4 下从 `REFERENCE` 变成 `TENTATIVE`，
> 状态一变换报告正文本来就该不同，继续用它只会证明"状态也变了"，丢掉要证明的东西。

### 4.2 `VERSION_BEARING_FIELDS` 补入 `boundaryNumerator` / `boundaryDenominator`

第一次跑定向时 `sameAnswersAndStatusProduceIdenticalReportBodies` **红 1 条**：
v1 报 `boundaryDenominator=10`、v4 报 `5`。这两个字段本来就**应该**随版本不同 ——
它们记录的是"当时用哪把尺子判的"。补进排除集合后转绿（41/41）。

---

## 5. 验证

### 5.1 内容一致性（改动前先取基线，改动后再跑）

改动前 6 条全绿（`gen-jung-fixtures` 当时 `sha256=00acde79…`）；改动后：

```
gen-fallback-content  exit 0   ✓ 前端内置副本与后端 YAML 一致
rewrite-types-content exit 0   ✓ types.yml 与内容数据源一致
check-type-duplication exit 0  跨类型 >= 6 字连续重合：0 处 / ✓ 无跨类型模板复用
convert-jung-content  exit 0   内容包与 YAML 一致。
gen-jung-fixtures     exit 0   夹具一致（3 份，sha256=96943e4bbc1e）
gen-platform-content  exit 0   v2 / report-v2 / v3 / v4 / bigfive 五份"与源一致"
```

### 5.2 定向

| 命令 | 结果 |
|---|---|
| `mvn test -Dtest=JungScoringPolicyTest,JungLegacyScoringRegressionTest,JungReportCopyBaselineTest,JungReportSchemaTest,JungScoringFixtureTest` | **41 / 0 / 0 / 0**，BUILD SUCCESS（Policy 9、Legacy 9、Fixture 4、CopyBaseline 4、Schema 15） |
| `vitest run`（5 个 spec） | **5 文件 / 243 条通过** |

### 5.3 全量回归

| 项 | 结果 |
|---|---|
| 后端（**排除** `AccountSqlDialectMySqlIT` / `AiSqlDialectMySqlIT` / `ConcurrencyMySqlIT`） | **406 run / 0 fail / 0 error / 1 skip**，BUILD SUCCESS（第 29 轮 404；本数字在最后的断言文案/注释改动后又复跑了一次） |
| 前端 `vue-tsc --noEmit` | exit 0 |
| 前端 `vitest run` | **50 文件 / 1072 条通过**（第 29 轮 1038，本轮 +34） |
| 前端 `vite build` | exit 0（构建到隔离目录 `work/v4-verify-dist`，**未覆盖** `frontend/dist`） |

### 5.4 真实浏览器（合成报告 + 全量模拟接口）

脚本：`scripts/browser-verify-score-v4.py`；证据：本目录 `browser-results.json` + 12 张 PNG。

| 项 | 值 |
|---|---|
| 宽度 | 320 / 390 / 1440 |
| 断言 | **197 通过 / 0 失败** |
| 未捕获页面异常 | 0 |
| 未登记的 API 路径 | 0（拦截器对每个请求记账，任何漏网都会红） |
| 报告夹具 | `v4-boundary`（`TENTATIVE` / ENFP / 2 候选 / 分母 5）、`v1-same-answers`（`REFERENCE` / ENFP / 0 候选 / 分母 10）、`v4-tied`（`TIED` / 无四字母 / 4 候选 / 分母 5） |
| 覆盖不足 | 走"报告接口 404 → 空态卡片"分支，确认不渲染类型码、不给候选 |

**本轮最关键的一条页面断言**：`[data-method-thresholds]` 的口径由**快照自己声明的政策**派生 ——

- v4 快照渲染「有效作答每 **5** 题，两边差距不超过 **2** 就记为略偏」；
- v1 历史快照仍渲染「每 **10** 题先得到一条线，**再收紧一档**才记为略偏」。

这就是"不静默用新算法重算旧报告、也不把旧口径说到新报告上"的可核验证据。

> **夹具防过期护栏（本轮踩坑后补的）**：脚本启动时断言每份夹具**自报的** `scoringVersion` /
> `reportContentVersion`，不符即红并提示先重跑 `JungReportCopyBaselineTest`。
> 为什么需要：做下面的变异验证时，跑一次生成测试会**顺手把夹具覆盖成变异版**（且不重算 `sha256`），
> 若之后只跑浏览器验收，就会拿着过期数据通过。登记为 backlog **A76**。

### 5.5 判别力（逐条"改回去 → 看它精确红 → 还原"）

| # | 变异 | 期望红 | 实际（原始输出：`work/v4-disc-java.log` / `work/v4-disc-fe.log` / `work/v4-disc3-browser.log`） |
|---|---|---|---|
| 1 | 包内 `scoringPolicy.boundaryDenominator` 5→10（并重生成） | 内容自洽 + 后端评分 | ✅ 内容 `--check` 红（"与生成结果不一致（源改了但没重新生成？）"）；后端定向 **41 run / 9 failures / 0 errors**：`JungScoringPolicyTest` 1、`JungLegacyScoringRegressionTest` 4、`JungScoringFixtureTest` 2、`JungReportCopyBaselineTest` 2（`JungReportSchemaTest` 未红）。原文含 `expected: <5> but was: <10>`、`v4 CASE-14 状态 ==> expected: <TENTATIVE> but was: <REFERENCE>`、`夹具哈希 ==> expected: <a5208fcd…> but was: <4923071243…>`；`gen-jung-fixtures --check` 在 `CASE-25` 直接失败（`EI-C4 属于未安排的维度 EI`） |
| 2 | `thresholds.spec.ts` 自己的契约表 `/5`→`/10` | 只红那几条 | ✅ 前端定向 **4 failed / 239 passed (243)**：逐点表、等号格、与开发方案口径对比两条 |
| 3 | 夹具 `v4-boundary.json` 的 `boundaryDenominator` 5→10 | 页面阈值口径那条 | ✅ 浏览器验收**首条即红**：`AssertionError: 320/v4-boundary: 方法节写明 v4 的口径（每 5 题）`（脚本在任何页面断言之前就会跑它） |
| 4 | `JungScoringPolicy.UNIFIED_SCALE_VERSIONS` 去掉 v4 | 未知版本拒绝生效 | ✅ 后端定向 **27 run / 0 failures / 27 errors**（5 个测试类全体构造失败）：`java.lang.IllegalArgumentException: 未知计分版本：typeme-jung48-score-v4（已知：typeme-jung48-score-v1、typeme-jung48-score-v2、typeme-jung48-score-v3）`；证明"未知版本在加载期报错、不静默回落"这条护栏真的在跑 |

**全部还原并复跑**：4 份内容/夹具与 `JungScoringPolicy.java` 逐字节回到基线（`diff` 为空），
内容 `--check` 全绿，后端定向 **41/41**、前端定向 **243/243**、浏览器 **197/197** 复跑通过。

---

## 6. 边界与未覆盖（诚实交代）

1. **没有真人数据**。`0.20` 与 `0.10` 都没有信度/效度依据。**带宽翻倍不等于补充题数量翻倍**：
   实际多出多少取决于真实答卷分布，本轮**无样本**，不能由公式反推（backlog A78）。
   「`TENTATIVE` 占比会升多少」同样没有数字。
2. **未登记数据库**。`typeme-jung48-zh-v4` 需要部署时由 `JungPackageRegistrar` UPSERT 进
   `assessment_package`。该写入属**现有库变更，需单独授权**。
   本轮**没有把后端启动到任何库**（启动会自动登记，属写入）。不登记时新草稿因外键失败，**上线前必须做**。
3. **未跑 3 个真实 MySQL IT**（与本次改动无关，且属现有库范围）。
4. **浏览器验收是"合成报告 + 全量模拟接口"**。报告 JSON 由**生产的**计分器与报告构造器生成
   （`JungReportCopyBaselineTest#writeBrowserFixtures` 写入 `backend/target/score-v4-browser-fixtures/`），
   但所有 API 在浏览器层被拦截 —— **不覆盖**真实登录会话、真实提交/保存、数据库与 AI。
   `NEEDS_REVIEW` 只验证"报告接口 404 之后的页面"，**不能**当作"服务端不落报告"的运行证据。
5. **截图未做人工目视**（执行模型无图像输入），以"元素有布局盒 / 有可见尺寸 / 横向越界 / 无横向溢出"
   这类几何断言替代。
6. **`frontend/dist` 未重建、jar 未重打包、未提交、未部署**。
7. **`fetchScoringPolicy` 的防御性缺省值仍是 `2/10`**：只在报告缺字段时生效；已确认后端一定下发这两个字段，
   本轮**未改**（改掉会让"字段缺失"被静默掩盖）。
8. **上一轮 A75 那类"只看 `isAuthenticated()`"的全仓扫描未重做**（本轮不涉及鉴权）。

---

## 7. 交付与后续步骤（需要授权）

| # | 步骤 | 性质 | 状态 |
|---|---|---|---|
| 1 | 合并代码（含本轮的 v4 内容包与前端/夹具改动） | 写入 | **未执行**（未提交） |
| 2 | 部署时启动后端 → `JungPackageRegistrar` 把 v4 包 UPSERT 进 `assessment_package` | **现有库写入** | **未执行，待单独授权** |
| 3 | 部署后在新草稿上确认绑定 `typeme-jung48-zh-v4` | 验证 | 未执行 |
| 4 | （可选）真人试测，获得补充题多出量与 `TENTATIVE` 占比的真实分布 | 研究 | 未执行（需产品决定） |

> 步骤 2 不完成时，新草稿会因 `assessment_package` 外键失败 —— 这是**上线前的硬前置**，
> 不是可选步骤。旧包 v1/v2/v3 的行**不需要**任何迁移。

---

## 8. 本轮附带修正的文档与记录（不改行为）

阈值方案 B 的“已决定”不能再只写在决策文档里 —— 仓库里还有几处按旧口径写的
“现行/当前默认”说法。本节列出实际改过的文档，区分**改事实描述**与**只改排版**：

| 文件 | 改了什么 | 性质 |
|---|---|---|
| `_contracts/01-新测契约-v1.md` | 新增 v1.3 修订行与 §4.1 v1.3 决策记录；§10.1 补登 `CASE-22..25`、原“`TIED` 报告”条改为 `CASE-26`；§10.1 里裸露的 `\|S\|` 转义为 `\|S\|`（不改则表格被拆列）；v1.2 那句“夹具绑定 `…-zh-v3`”加脚注指向 v1.3 | 事实 + 排版 |
| `阈值政策对比与决策请求.md` | 顶部标为“已决定并已实施（归档）”，加 2026-09-18 / 2026-09-21 两次决定的对照与答复归档表 | 事实 |
| `题目审校与版本决策.md` | §5 版本状态块改为 v1/v2 → v3 → v4 三段（生产/消费边界、带宽不宣称）；补写“后后续（2026-09-21）” | 事实 |
| `open-decisions-decision-list.md` | §1 加“再已决（2026-09-21）”；新增 §9 v4 追加记录（证据索引 / 与 v3 的差别 / 剩余限制） | 事实 |
| `docs/2026-09-16/implementation/README.md` §3.2 | “现行版本是 v3” → **v4** | 事实 |
| `docs/optimization/progress.md` | 新增第 30 轮（插在第 29 轮之前、第 0 轮之前） | 记录 |
| `docs/optimization/backlog.md` | 新增第 30 轮段：A76（夹具防过期护栏，已闭环）、A77（前端契约表不是自比，仅记录）、A78（多出多少题无样本，仅记录）、A79（契约 `CASE-22` 编号冲突，已闭环） | 记录 |
| `JungReportCopyBaselineTest.java` | 断言文案里的“v3 包 =”改为“当前包 =”（它比的是 v1 vs 当前包）；类注释由“5 个字段”改为“7 个” | 注释/文案 |

未改：任何历史证据目录（`2026-09-18-score-v3`、`2026-09-20-score-v3-closeout`）与
上一会话两项在途工作的证据目录；也未改动 `docs/optimization/progress.md` 里
第 21–26 轮那段“未重跑，不能当作当前验收”的声明。