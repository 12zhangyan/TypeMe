# TypeMe 登录版十六型人格测评站 —— 实施记录

- 记录日期：2026-09-16
- 工作目录：`D:\develop\develop\code\TypeMe`
- 本轮目标（来自用户原话）：把现有 TypeMe 项目实现为「登录版十六型人格测评站」，并交付可运行结果
- 本轮**未**做：`git commit` / `git push` / 生产部署 / 真实 DeepSeek 联调（无 key）

> 本文件是**实施记录**，回答"做了什么、为什么这么做、哪些是实测哪些是推断"。
> 逐项验收证据见同目录上一级的 `verification/`。

---

## 0. 一句话结论

后端（Java 21 / Spring Boot 3.3.5）、内容体系（64 题 + 16 型报告 + 四维文案）、
数据库迁移（8 个脚本在真实 MySQL 8.4 与 H2 上双向验证）、账号体系、AI 分析模块
**已实现并跑通自动化测试**；前端账号体系与计分引擎已实现并通过 typecheck / build / 518 条测试。
**尚未完成**的部分在 §7 逐条列明，未完成项没有被含糊表述成"基本完成"。

---

## 1. 与原方案的差异（新方案覆盖旧默认）

原 `README.md` / 旧设计把站点定位为"本地存储、后端只读、默认大五人格、保守阈值下隐藏类型"。
新方案明确覆盖这些默认值，实施中按新方案执行：

| 维度 | 旧默认 | 本轮实际 |
|---|---|---|
| 默认量表 | IPIP-50 大五 | `typeme-jung48` 十六型（唯一量表，v1 只做这一个） |
| 作答存储 | 仅浏览器本地 | 服务端持久化 + 跨设备草稿（登录后） |
| 后端角色 | 只读下发内容 | 拥有账号、作答、报告、AI 任务 |
| 结果呈现 | 保守阈值下不出类型 | 出四字母参考类型 + 完整中文解读；仅在平分/边界时降级表述 |
| AI | 无 | 可选的分析能力（默认关闭），基础报告与固定计分完全独立于它 |
| 旧引擎 | 站点主体 | 保留可用、只读兼容，不再作为主入口 |

**旧引擎没有被删除或改写**：`com.typeme.service.ContentService`、v1/v2 控制器、
`com.typeme.model.**`、前端 `stores/quiz.ts`、旧 localStorage 键
（`typeme.quiz.v3`、`typeme.quiz.v2`、`typeme.package.v1`）全部保持原行为。

---

## 2. 内容体系

### 2.1 题库（`implementation/content/jung48-questions.yml`）

64 题 = 主测 48 + 补充 16。每维主测 12 题、补充 4 题。每题 13 个字段：
`id / stage / dimension / scenario / textLeft / textRight / leftPole / rightPole / help / facet / order / reviewStatus / provenance`。

题面写作遵守产品方案 §4 的硬约束，逐条对应：

- **不改编任何官方或第三方原题**：`provenance` 逐题记录来源为"本项目原创"，
  并明示未使用 MBTI 官方、16Personalities、OEJTS 的任何题目。这条是**声明**，
  不是机器可验证的结论 —— 见 §7 的诚实性说明。
- **两极对等**：TF 维刻意避免"理性 vs 感性"这类褒贬对，JP 维避免"勤奋 vs 拖延"。
- **生活场景化**：`scenario` 是具体处境（如"活动之后的精力"），不是抽象特质词。
- **每题两个方向都成立**：`help` 里写"如果你两种都做过，选你更常自然发生的那个"，
  而不是暗示某一侧才是"正常"。
- **左右平衡**：每维主测 6:6、补充 2:2。
  这一点不是形式主义：若某维多数组都把"左侧"排在前，用户的"总点左边"习惯会直接变成
  该维的假倾向。为此有 4 题被**镜像**过（左右文案互换）。

### 2.2 本轮修掉的一类内容缺陷：题面方向与所标极点相反

审校过程中发现 **4 道题的文字方向与其声明的极点相反**：`TF-07`、`TF-12`、`TF-C3`、`EI-C4`。
例如 `TF-07` 的 `textLeft` 是"先把要求列出来，再挑合适的做法"（T 味），却被标成 `leftPole: F`。

- **影响**：这 4 题会被**反向计分** —— 用户在这些题上选"立标准"反而会推高 F 的得分。
  契约 §2.4 的校验查不到它（那一条只检查极点属于本维且两端互异）。
- **修法**：交换 `textLeft` / `textRight` 的**文案**，而不是交换极点。
  极点与 `facet`、左右平衡计数绑定，改极点会牵动平衡与 facet 覆盖检查；
  而"哪一侧的文字放在哪一列"纯粹是排版。修完左右平衡仍是 6:6。
- **教训**：这类缺陷**无法自动检测**（需要判断文字语义），只能靠逐题人工审读。
  因此 `implementation/content/jung48-item-review.md` 里逐题给出了"方向说明"列，
  并以 12 列表格逐题留痕，供人工试测时对照。

### 2.3 四维文案（`dimension-copy-zh-v1.yml`）

每维给出：`name / question / negativePole{label,description,dailySigns} / positivePole{...} / balanced{summary,reading} / tiedNotice`。

- 两极各 5 条 `dailySigns`，写**可观察的行为**（"一个人吃饭、走路、通勤，不太觉得难熬"），
  不写性格标签 —— 用户要能对照自己的日常认出来，而不是接受一个评价。
- 极点标签用「偏内/偏外、偏实/偏想、偏理/偏情、偏定/偏活」而不是「内倾/外倾」：
  后者在中文里已带固定的性格印象（"外倾"常被读成更外向=更好），
  而"偏 X"只描述这次作答落在哪一侧，不含"你是什么样的人"的断言。
- `balanced` 专门解释"两边大致相等"意味着什么，并明确说这既不是缺陷也不是"没有性格"。

### 2.4 16 型报告（`type-reports-zh-v1.yml`）

16 型齐备，每型：`code / nameCn / tagline / summary / sections{8 段} / nextActions{3 条}`。

- 八段固定为：`dailyLife / strengths / blindSpots / communication / studyWork / stress / growth / neighbors`。
- 每型八段汉字合计 1272–1433（均值 1329），落在要求的 1200–1800 区间内。
  （文档里几个字数口径**故意分开写**，因为混用过一次：这里是"八段里的汉字数"；
  生成器实际校验的是 `summary + 八段`的字符数落在 [1200, 2000]，当前为 1562–1750、均值 1623。）
- `neighbors` 段 2026-09-16 按过程机制重写完毕：16 型各点出四个"只差一个字母"的邻居，
  并说清是哪一种机制——**共享主导**（S/N 换边）、**共享辅助**（T/F 换边）、
  **同一套四个过程、主辅互换**（E/I 换边）、**每个位置方向不变、类整体互换**（J/P 换边）。
  每段长度 150–219 字，且逐段过了 `work/verify_neighbors.mjs`（方法与输出见
  [`../verification/acceptance-evidence.md`](../verification/acceptance-evidence.md) §10.5，
  与 §8.6）。
  其余七段仍是按四字母的通用描述，按过程结构重写属于 v3。
- 跨类型连续 ≥20 汉字重复 = **0**（有脚本按 20-gram 归一化后全量比对）。
  这一点必须机器查：16 篇各写一遍，最容易出现的就是"换个类型名其余照抄"。
- 禁用词（准确率/概率/百分位/置信/确诊/命中注定/科学证明/MBTI 官方/16Personalities/OEJT…）= **0 命中**。
- 全部内容标记 `contentStatus: draft_review_pending`。**这是如实的状态**，
  不假装已经过真人审读或效度验证。

### 2.5 过程层文案（`process-copy-zh-v1.yml`）

报告里 `dynamics` / `processPlan` 两块用的文案。**它与 16 型报告是两件事**：
16 型报告描述"这一型的通用样子"，过程层描述"你这套结构怎么用"。

- 8 个过程各一份 `what`（这个过程管什么）/ `asDominant` / `whenUnpreferred`；
- 四个决策步各一份 `title` / `prompt` / `whenUnpreferred`（按 19.3 的顺序 S → N → T → F）；
- 4 个极点各一份 `offers`（只写"这一侧能提供给对面那一侧的东西"，前缀由代码按方向拼，
  避免两侧各写一遍导致口径打架）；
- 4 个维度各一对 `negative` / `positive` 沟通规则（按用户自己那一侧取一条）；
- 3 段说明：`frameworkCaveat`（框架有争议）/ `developmentNote`（过程无高下）/ `greyAreaNote`。

**注意 `whenUnpreferred` 不许写成"最生的"**：四个过程里有两个尚未偏好，写"最"就自相矛盾。
排序只在 `hardestStepsNote` 里给一条（第四位发展得最不充分），并紧跟一句"这不是年龄表"。

方法论与逐条页码依据见 [`../TypeMe-分析建议方法论-v2.md`](../TypeMe-分析建议方法论-v2.md)。

---

## 3. 计分与状态机

### 3.1 计分公式（权威实现在 Java）

单题贡献 `c = direction × (rating − 3)`，其中 `direction = +1` 当且仅当该题**右极**等于本维**正极**。
`direction` 只由极点决定，与旧 OEJTS 的符号约定无关 ——
**新测 TF / JP 的正极与旧实现相反**，因此绝不复用旧实现的常数。

- 每维 `S = Σc`（只统计 rating，`unknown` 与未处理都不计入 `n`）。
- `m = S / (2n)`，`position = (m+1)/2` 仅用于画条。
- **方向只由整数 `S` 的符号决定**，不用 `m` 或 `position` 比较 ——
  浮点数在边界上会产生"同一份答卷换台机器结论不同"。

### 3.2 阈值（v1.1 冻结；**v1.2 起走 v3 口径，v1.3 起新草稿走 v4 口径**）

> **现行版本是 v4**：`typeme-jung48-zh-v4` / `scoringVersion = typeme-jung48-score-v4`，
> `B(n) = T(n) = floor(2n/5)`，且最终边界要求 `n > 0`。
> 与 v3 相比，**触发与边界同时放宽一倍带宽**，所以这次**确实会有人多答补充题**
> （具体多多少取决于答卷分布，本轮无样本）。
> 下面两行描述的是 v1/v2 的**冻结行为**（旧包、旧草稿、旧报告继续按它解释）；
> v3 与 v4 是两个**同样冻结**的历史口径。决定记录见契约 §4.1。

- （v1/v2）触发补充题：`|S| <= T(n)`，`T(n) = floor(2n/10)`（v3/v4 分母不同：`floor(2n/10)` / `floor(2n/5)`）
- （v1/v2）算作"倾向较轻"：`|S| <= B(n)`，`B(n) = max(0, T(n) − 1)`（v3/v4：`B(n) = T(n)`）

（v1/v2）`B(9) = 0` 的后果是：**n=9 时只有完全平分（`S = 0`）才算落在边界内**，
任何非零倾向都**不**算"倾向较轻"，会被讲成方向明确。这句话此前写反过（写成"任何非零倾向都算边界"），
2026-09-18 一并订正；v3 下 `B(9) = 1`，v4 下 `B(9) = 3`，`1 <= |S| <= 3` 这一档均改为"倾向较轻"。

### 3.3 四种状态

| 状态 | 条件 | 呈现 |
|---|---|---|
| `NEEDS_REVIEW` | 主测未答完，或某维 rating 数不足 9 | 不出报告，指出还差哪几维 |
| `TIED` | 存在 `S_final == 0` 的维度 | 不给出四字母，并列展示多个候选 |
| `TENTATIVE` | 无平分且至少一维在边界内 | "本次更接近 XXXX"，并说明"只是略偏" |
| `REFERENCE` | 其余情况 | 四字母参考类型 + 完整解读 |

**平分时不给四字母**是刻意的：`S_final = 0` 说明这一维两边的证据完全对等，
此时报出任何一个字母都是在制造并不存在的确定性。

### 3.4 候选与 `cost`

候选只在 `TIED` / `TENTATIVE` 时生成。`cost = Σ|S_final(d)|`，求和范围是
"候选极与该维计算出的极相反"的那些维度。

**`cost` 不是概率、不是准确率、不是"有多像"。** 它的含义是"换成这个类型，
需要偏离多少证据"。排序仅用于稳定展示。这一点在报告页的文案里必须守住 ——
把 `cost` 讲成"可能性"是最容易犯、也最伤害用户信任的错误。

### 3.5 `scheduled` 与 `skipped` 是两件事

- `scheduled`（服务端安排了哪些维度的补充题）在澄清决策时确定，
  **不因为用户点"跳过"而改变**。
- `skipped` 是用户的选择。

早期实现把两者混为一个字段：跳过时清空 `scheduled`，于是
"提交了未安排维度的补充答案"这类校验会因集合为空而对**一切**提交都报错。
这是一次真实踩过的坑，现在有断言钉住。

### 3.6 过程层（`dynamics` / `processPlan`）：由字母推导结构，再由结构派生建议

方法论与被引章节见 [`../TypeMe-分析建议方法论-v2.md`](../TypeMe-分析建议方法论-v2.md)。
实现上只有三条规则，其它全是拼装：

```
outer = (J ? 判断族(T/F) : 感知族(S/N)) + e      // 对外使用的那个
inner = (J ? 感知族(S/N) : 判断族(T/F)) + i      // 朝里使用的那个
外倾者：主导 = outer，辅助 = inner；内倾者：主导 = inner，辅助 = outer
第三位 = 辅助那一族的「另一个功能」、方向取反
第四位 = 主导那一族的「另一个功能」、方向取反
```

- 权威实现在 `domain/JungTypeDynamics`（构造期逐个校验不变量：主导与辅助功能族不同、
  方向相反；四个过程**恰好各占 S/N/T/F 之一**——最后这条保证了四步决策法里
  "功能族 → 过程"只有一个答案）。`JungProcess` 是八个过程代号。
- **TIED 时两块都是 `null`**：字母都没定，再推一个结构就是在制造确定性。
- `boundaryNotes` 把"略偏"讲成**后果**而不是"另一侧也值得读"，并且**点名换边后的类型码与实际过程**
  （"如果 EI 落到另一侧（ESTJ）：……原来是内倾感觉主导，换过去就是外倾思考主导"）：
  E/I 换边是同一套四个过程、主辅互换；J/P 换边是每个位置方向不变、类整体互换；
  S/N 与 T/F 换边只有那两个位置换功能、方向不变。四条互不相同，**曾经写反过（见 §8.6）**。
- 两块内容都进了 `reportHash` 覆盖范围（`JungReportSchemaTest` 逐字段验证），
  所以"报告不可篡改"这个承诺对它们同样成立。

**踩过的两个坑（都留了断言）**：

1. 内倾那一支最初写成"同族换方向"，于是 ISTP 被推成 `Ni` 主导（应为 `Ti`）。
   正确规则是"**另一族**朝里的那个"。16 型里有 8 型会主导/辅助整对错位，
   而报告照样生成、页面照样渲染 —— 唯一能拦住它的是逐个类型钉住的夹具。
2. 第三位最初写成"辅助的同功能反方向"（Te→Ti），于是四个过程只覆盖两个功能族。
   正确规则是"**同族的另一个功能**、方向取反"（Te→Fi）。
   这两条现在都有"手工拼一个错结构必须当场抛异常"的测试兜底。

---

## 4. 内容流水线与"一份夹具、两套实现"

### 4.1 内容从 YAML 到 JSON（`scripts/convert-jung-content.mjs`）

YAML 是**人写的内容源**，Java 启动时读的是生成出来的 JSON。生成器在发布前校验：

题面长度、`help` 长度、极点配对、左右平衡、facet 覆盖（≥3）、
八段齐备与长度区间、禁用词、跨类型 20 字重复、`nextActions` 恰好 3 条；
以及**过程层文案**的 8 过程 / 4 决策步 / 4 互补 / 4 沟通规则齐备、逐字段最小长度、禁用词。

一次生成**三个产物**：内容包、16 型报告、过程层文案（`typeme-process-copy-zh-v1.json`）。

- 内容包与类型报告各计算一个 sha256，写进 JSON。Java 加载时**重算并与声明值比对**。
- **哈希算法必须两侧一致**：规范形 = 插入顺序 + 紧凑分隔符。
  这里踩过一次真实的坑 —— 生成器原本用"递归按键名排序"的规范化，
  而 Java 按代码里字段的书写顺序构造，于是同一份内容算出两个不同的哈希。
  现在生成器的 `canonicalJson` 就是 `JSON.stringify(value)`，
  并在注释里写明"不要排字母序、不要带缩进"。
- 内容包的哈希**不包含** `license` / `attribution`（它们是元数据，不是计分内容）；
  类型报告的哈希**不包含** `sectionOrder`（与 Java 侧字段对齐）。
- **过程层文案是第三份、也是独立的一份哈希**（不并入内容包）：
  改几句建议文案不该让内容指纹变化、看起来像题库被改过；
  而真正改题库时也不能被建议文案的改动掩盖。报告里三个版本号 + 两个指纹都记进 `methodology`。
- 禁用词表是**全局一张表**（`BANNED_WORDS`）：`匹配率 / 适配度 / 适合度 / 职业匹配 / 恋爱配对`
  这五个词进的是全局表而不是只进过程层，因为 `JungReportBuilder.BANNED_WORDS`（运行期）
  用同一张表 —— 两边不一致会变成"构建期通过、运行期抛异常"。

### 4.2 跨实现夹具（`scripts/gen-jung-fixtures.mjs`）

18 个用例的夹具文件生成 **三份字节相同的副本**：
内容源目录、后端测试资源、前端 `__fixtures__`。

- 生成器内含一份 Node 参考实现（与 Java 同构），逐用例算出期望值。
- 后端 `JungScoringFixtureTest`（4 条）与前端 `scoring.fixture.spec.ts`（129 条）
  **各自独立跑同一份夹具**，任何一侧改坏都会立刻暴露。
- 夹具覆盖：四状态各若干、边界与非边界、平分、跳过与未跳过补充题、
  覆盖不足、澄清合并、候选与 `cost`、`tieNotice` 与歧义性的一致性。
- 夹具另带 `dynamicsVersion` 与 `typeProcesses`（16 行：主导/辅助/第三位/第四位）。
  这一层是**纯符号推导**，比计分更容易被一次静默改写弄反：内倾那一支写错，
  16 型里有 8 型的主导与辅助会整对互换，而报告照样生成、页面照样渲染、没有一处报错。
  所以 16 行逐个钉住，Java `JungTypeDynamics`、Node 参考实现、前端 `jung/dynamics.ts`
  三份实现必须给出同一张表（`JungTypeDynamicsTest.agreesWithSharedFixture`）。

**为什么值得为它写一整套生成器**：前端为了让用户即时看到"目前更偏哪边"，
需要一份本地计分实现；而本地实现与服务端实现不一致时，
用户会看到"答题过程中显示偏 E，提交后报告说 I"。
这种矛盾比单纯算错更伤信任，所以两侧必须由**同一份数据**约束。

### 4.3 生成器里修掉的几个真实缺陷（留痕）

- `indexQuestions` 没有读 `order` 字段 → 排序键是 `NaN`、排序静默失效、
  所有填充产生空答案，而断言仍然"通过"（因为它什么都没测）。
  现在缺 `order` 直接抛错。
- 2 级评分（只用 ±2）使每段和恒为 `4k−12`（4 的倍数），±10/±2 这类目标不可达 →
  改为求解 `4s+3p−12=target`。
- 校验阈值时参考实现用了 `B(n)=T(n)` 而 Java 是 `B(n)=T(n)−1` →
  导致 CASE-09/11/14 与 CASE-13/17 的状态判断相反。现已对齐。
- 手写的用例标题曾与实际结果不符（写着 ENTJ 实际是 ENFP）→
  标题改为从计算结果派生，`note` 只留意图。

---

## 5. 数据模型与迁移

8 个脚本：`V1` 账号与会话、`V2` 内容包与作答、`V3` 报告与自我反思、
`V4` AI 分析、`V5` 幂等与删除、`V6` 管理与 AI 设置、
`V7` 给 `ai_analysis_job` 加 `user_note`、`V8` 加宽凭据哈希列。

### 5.1 在真实 MySQL 8.4 上找到的两类真实缺陷

**其一：库默认排序规则把 8 个枚举列的 CHECK 白名单悄悄放宽。**
库默认 `utf8mb4_0900_ai_ci` 是**大小写不敏感**的，于是
`role='user'`、`computed_type_code='istj'`、`kind='rating'`、`status='in_progress'`、
`api_key_source='ENV'` 等在 MySQL 上**能插进去**，而同一批值在 H2 上全部被拒。
修复 = 给这 8 个列钉 `COLLATE utf8mb4_0900_as_cs`。

写法必须是**列定义最末尾的裸 `COLLATE`**：四种候选写法里只有这一种在两个引擎都通过
（`CHARACTER SET x COLLATE y` 紧跟类型会让 H2 语法错误；
放在 `DEFAULT` 之前会让 MySQL 报 1064）。

**其二：`ck_answer_rating` 因 CHECK 的 UNKNOWN 语义放行 `RATING + NULL`。**
MySQL 的 CHECK 在结果为 NULL/UNKNOWN 时视为通过，于是
`kind='RATING' AND rating IS NULL` 这种自相矛盾的行能插进去。
补 `rating IS NOT NULL` 后返回 `ERROR 3819`。

这两条正是"迁移脚本必须同时在 MySQL 与 H2 上跑"的价值所在：
只跑 H2 会漏掉第一条，只跑 MySQL 不会发现第二条在 H2 上的表现差异。

### 5.2 迁移安全边界

- 脚本里**不出现** `CREATE DATABASE` / `USE` / `DROP DATABASE`。
  同一个 MySQL 实例上有用户另外 9 个真实业务库，只操作 `typeme_dev` / `typeme_test`。
- 应用默认数据源指向 `typeme_dev`，生产必须用 `TYPEME_DB_URL` 等环境变量覆盖。

---

## 6. 账号、AI 与安全

### 6.1 账号

会话是 HttpOnly 同源 cookie，**不使用 localStorage 存任何 token**。
CSRF 走 `CookieCsrfTokenRepository.withHttpOnlyFalse()`（cookie `XSRF-TOKEN`，
头名由 `GET /api/v3/auth/csrf` 下发，前端不写死）。登录成功后轮换会话 ID。

找回密码用恢复码：**16 字符显示为 4 段**（`XXXX-XXXX-XXXX-XXXX`）。
恢复码只在注册与重新生成时返回一次，服务端只存哈希，不入日志。
（契约原文写的是"8 组每组 XXXX-XXXX / 128 位"，与实现不符，已按实现更正。）

### 6.2 AI 分析（可选能力）

- 默认 **关闭**（`typeme.ai.enabled=false`）。基础报告与固定计分完全不依赖它。
- apiKey 由管理员在后台配置，**加密存库**，从不回显；
  读取时按 10 秒 TTL 重读 → 管理员改动后 ≤10 秒生效、无需重启。
- **发送给上游的内容受严格约束**：只发维度摘要、状态、类型/候选、
  ≤8 条证据片段、话题与用户可选备注。
  **不发**用户名、昵称、邮箱、IP、完整答题原始记录。
- 幂等由 `ai_analysis_job` 的两个唯一键承担（同 key 同 body 返回同一任务，
  同 key 不同 body 返回 409）；额度预留与补偿在同一事务里。
- 上游状态未知时**不自动重试**（避免重复计费/重复外发）；
  报告删除后晚到的结果直接丢弃。

### 6.3 刻意**没有**使用 Redis

Redis 在本机可用（`PONG`），但没有被采用：限流与额度已经用 MySQL 的事务
保证了一致性，引入 Redis 会多出一个可能与 MySQL 不一致的状态源 ——
在一个"记录用户历史、要求可导出可删除"的场景里，多一个状态源就多一类
"两边对不上"的可能，而收益（这点流量下的性能）不成比例。

---

## 7. 未完成与诚实性说明

**必须分清以下五件事，不能合并表述：**

| 项目 | 状态 |
|---|---|
| 工程实现 | 后端+内容+迁移+账号+AI 已实现；前端账号、答题、报告页已实现并能构建。**端到端冒烟 27/27 通过**（真实 MySQL + 真实 HTTP 会话） |
| **真人题目试测** | **未做**。没有任何真人作答数据。题面的可读性、是否有歧义、是否诱发社会赞许作答，全部**未经真人验证** |
| 真实 MySQL 验证 | **已做**（8 个迁移在 8.4.0 上跑通，约束用非法数据打穿验证；另有端到端链路跑在真实 MySQL 上） |
| 真实 DeepSeek 联调 | **未做**。没有 API key，AI 全流程走的是 `MockDeepSeekClient`。HTTP 客户端（超时、错误码映射、宽松解析）只做了代码级验证，**从未调用过真实接口** |
| 生产部署 | **未做**。没有部署、没有压测、没有真实流量 |

其余未完成项：

1. **浏览器实机验收截图**：见 `../verification/browser-acceptance.md`（**32 张**真实 Chrome 截图，
   320 / 390 / 1440 三档 + 1440 全页）。走查抓到 **2 个硬缺陷**（首页与报告页显示了
   旧量表的文案/署名）以及 3 个可用性/无障碍问题，详见
   `../verification/acceptance-evidence.md` §9。三个可用性问题**未修**（属产品取舍，现状如实记录）。
2. **题面方向一致性无法自动校验**：§2.2 的 4 道题是靠人工审读发现的。
   这类缺陷只能靠真人试测覆盖，不能靠断言。
3. **`cost` 的展示口径**：代码与文案已避免把它说成概率，但"用户是否会误读"
   需要真人测试才能确认。
4. **内容效度**：没有做任何信度/效度分析，也不应做 ——
   16 型框架本身在学界有争议。报告的定位是"参考与自我探索的起点"，
   页面上不许出现准确率、概率、百分位、诊断之类表述（生成器会拦）。
5. **`typeme_dev` 与 `typeme_test` 之外**：未在其它环境验证过。
6. **Flyway 对 MySQL 8.4 的告警**：Flyway 10.10.0 明确提示
   "MySQL 8.4 is newer than this version of Flyway and support has not been tested"。
   实测迁移成功，但这是供应商未声明支持的组合，升级 Flyway 时应复验。
7. **`typeme_dev` 不能直接启动应用**：它有 15 张表但**没有 `flyway_schema_history`**，
   而本项目 `baseline-on-migrate: false`（刻意不 baseline，避免把手工建的库
   当成"已迁移"而跳过校验）。首次在本机库上运行请用空库，
   或先自行确认库结构与 8 个迁移一致。**我没有对既有 `typeme_dev` 跑迁移**
   —— 那会改动用户既有数据。
8. **AI 分析的前端界面**：后端接口（`/reports/{id}/analyses`、`/ai/status`、轮询）
   与适配器已实现，前端页面尚未接。详见 §10。

---

## 8. 端到端实测：单测全绿仍然漏掉的 3 个真实缺陷

**这一节是本轮最重要的记录。** 在 148 条后端测试 + 518 条前端测试**全绿**、
typecheck 零错误的条件下，把 jar 打包后对着**全新空库**启动、
用真实 HTTP 走完整流程，一次就撞出 **3 个足以让产品完全不可用**的缺陷。

> 共同点：**测试为了让断言可写而补上的那部分，恰好就是生产代码缺的那部分。**
> 三个缺陷都不是"逻辑写错"，而是"测试侧满足了约定、生产侧没有"。

### 8.1 PBKDF2 参数错位 —— 密码只做了 32 轮拉伸

```java
// 修复前（错）
new Pbkdf2PasswordEncoder("", 8, 32, iterations)
// 修复后（对）—— 真实签名是 (secret, saltLength, iterations, hashWidth)
new Pbkdf2PasswordEncoder("", 8, iterations, 32)
```

| 配置 | 修复前哈希长度 |
|---|---|
| `iterations=1000`（测试档位） | 266 字符 |
| `iterations=210000`（生产默认） | **52516 字符** |

- **安全后果**：实际只跑了 **32 轮**迭代，密钥拉伸基本不存在。
  而**登录完全正常** —— 存进去、取出来、`matches()` 都对，零可观察异常。
- **可用性后果**：生产默认档下注册写入
  `Data truncation: Data too long for column 'password_hash'` → **HTTP 500**。
  `app_user.password_hash` 是 `VARCHAR(512)`。
- **为什么测试漏掉**：测试档位把 `pbkdf2-iterations` 调到 1000 让测试跑得快，
  此时 266 字符恰好塞得进 512 —— **为了提速做的调整，正好抹掉了唯一能暴露它的维度**。

修复后新增 `PasswordEncoderParametersTest`（6 条），并做**变异验证**：
把缺陷重新注入后 4 条失败（`expected: 210000 but was: 32`、`266 -> 52516`），
确认该测试真能拦住它。

### 8.2 内容包从未播种 —— 新测评一个都建不出来

`assessment_attempt.package_id` 外键指向 `assessment_package`，
但 **`src/main` 里没有任何代码插入过 `assessment_package` 行**（只有测试辅助会插）：

```
POST /api/v3/attempts → HTTP 500
Cannot add or update a child row: a foreign key constraint fails
(`assessment_attempt`, CONSTRAINT `fk_attempt_package` ...)
```

登录、注册、目录接口全部正常，**唯独"开始做测评"必然失败**。
测试没抓到是因为**所有集成测试都自己 `INSERT` 了内容包行**，
等于替生产代码把它该做的那一步补上了。

修复：新增 `JungPackageRegistrar`（`ApplicationRunner`）启动时 upsert 内容包；
`AttemptService.create()` 前置检查，缺失时返回 `503 PACKAGE_NOT_SEEDED`
而不是让数据库抛外键违例。新增 `JungPackageRegistrarTest`（4 条）。

> 为什么放启动期 seeding 而不是写进 Flyway 迁移：内容包是**随 jar 走的资源**，
> 它的 sha256 要能对着磁盘上的真实文件重算验证；写进迁移脚本就变成一份无法自证的副本。

### 8.3 认证主体缺 `getUserId()` —— 把用户名当主键用

新测模块（`jung.api.CurrentUser`）与 AI 模块（`ai.controller.AiCurrentUser`）
刻意**不依赖账号模块的类名**（并行开发时跨模块编译依赖会互相卡住），
约定是"主体上有 `getUserId()`，取不到退回 `Authentication#getName()`"。

但账号模块建立会话时用的是
`new UsernamePasswordAuthenticationToken(username, null, authorities)` ——
主体是**用户名字符串**，没有 `getUserId()`。于是那两个模块**每次都走退路**：

```
POST /api/v3/attempts → HTTP 500
Cannot add or update a child row: a foreign key constraint fails
(`assessment_attempt`, CONSTRAINT `fk_attempt_user`
 FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))
```

`app_user.id` 是 UUID，username 不是主键 → **每个建测评请求都撞外键**，AI 分析同理。

测试没抓到是因为：集成测试大量用 `@WithMockUser` 或自建假主体，
而 AI 的测试辅助 `AiTestAuthentication` **自己实现了 `getUserId()`** ——
**测试替生产代码履了约**。

修复：新增 `TypemeUserPrincipal implements UserDetails`（带 `getUserId()`），
`TypemeUserDetailsService` 与 `AccountService.establishSession` 都用它作主体；
新增 `LoginPrincipalCarriesUserIdIT`（2 条）走**真实注册接口**（不 mock 认证）。
`getUserId` 方法上写了"不可改名"的注释 —— 改名不会编译失败，
只会让那两个模块静默退回 username，然后在**外键上**炸掉。

### 8.4 附带修掉的一个框架歧义

`JungPackageRegistrar` 原先有两个构造器（2 参与 3 参），Spring 报
`No default constructor found` —— 多个候选构造器时需要 `@Autowired` 才认。
改为**只留一个构造器**，时间依赖改用模块内既有的 `TimeSource`
（它本身就是为"测试能塞固定时刻"而存在的），于是既没有第二个构造器、测试也能控时。

> 顺带一条工具坑：PowerShell 的 `-Encoding UTF8` **会写 BOM**，
> 带 BOM 的 `.java` 文件 `javac` 直接报"非法字符: '\ufeff'"。
> 写 Java 源文件要用 `[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`。

### 8.5 为这三个缺陷补的测试，以及"变异验证"

新增 13 条测试专门钉住上面三个缺陷：

| 测试 | 条数 | 钉住什么 |
|---|---|---|
| `PasswordEncoderParametersTest` | 6 | 迭代数真的是 210000、哈希宽度真的是 32、长度不随迭代数增长 |
| `JungPackageRegistrarTest` | 4 | 启动后内容包行存在、存的 sha256 与重算一致、重复注册幂等 |
| `LoginPrincipalCarriesUserIdIT` | 2 | 主体有 `getUserId()`、其值等于 `app_user.id` 且 ≠ username |
| `AssessmentCreationThroughRealSessionIT` | 1 | 真实注册会话能建测评；测评挂在自己名下；别人看不到 |

**这 13 条全部做过变异验证**（把缺陷重新注入，确认测试真的会红）：

| 变异 | 预期失败方式 | 实测 |
|---|---|---|
| `Pbkdf2PasswordEncoder("", 8, 32, iterations)` | 迭代数 32、哈希长度 52516 | ✅ 4 条失败，`expected: 210000 but was: 32`、`266 -> 52516` |
| 主体换回 `username` 字符串 | 撞 `fk_attempt_user` | ✅ `DataIntegrityViolationException`，失败在 `INSERT INTO assessment_attempt` |
| 移除 `JungPackageRegistrar` 的 `@Component` | `503 PACKAGE_NOT_SEEDED` | ✅ `期望 201，实际 503` |

**没有做变异验证的测试，不能算作防线。** 一条永远为真的断言
（例如 `undefined === undefined`）在测试报告里看起来和真测试一模一样，
只有把缺陷注进去才知道它拦不拦得住 —— 详见 §9 里两个真实的假通过案例。

**留给未来的一条检查**：这三个缺陷有同一个模式 ——
**约定只写在注释里，没有任何编译期或测试期的强制**。
`getUserId()` 改名不会编译失败；"内容包该由谁播种"没有类型层面的约束。
后续再有类似的跨模块约定，应优先让它**编译不过**（共享接口/类型），
而不是靠注释和"记得"。

### 8.6 换边后果写反：一次"测试替错误作证"

第 10 个缺陷不在上面三个里，但属于同一类"全绿也漏"：**换边后果的语义写反了**。

`JungTypeDynamics.flipEffect` 原来用两个布尔（`dimensionsTraded` / `attitudesSwapped`）描述
"某一维换到另一侧，结构会怎么变"，结果把 J/P 标成"连功能族都换"、把 E/I 标成"只是方向对调"，
**两条正好对调**。真实后果见 `JungTypeDynamics` 的类注释与验收证据 §10.5：

| 换边 | 真实后果 |
|---|---|
| E/I | 还是那四个过程，但主导与辅助互换（第三位与第四位也互换） |
| J/P | 每个位置方向不变，但每个位置的过程都换成另一类（判断↔感知） |
| S/N、T/F | 只有这一类的那两个位置换功能，方向不变 |

**它为什么一直绿**：旧测试拿 `ESTJ`（那是 E/I 换边的结果）去"印证 J/P 换边"，
断言永远成立。注意这与 §9 里两个"假通过"案例是同一种病：
**断言看起来在验证一件事，其实验证的是另一件无关紧要的事。**

现在的防线是 16 型 × 4 维 = **64 组逐槽位对拍**（`flipEffectsMatchTheFlippedType`），
并且做过变异验证 —— 把后果改回当初那两条对调的写法：

| 变异 | 预期失败方式 | 实测 |
|---|---|---|
| J/P 与 E/I 的后果互换 | E/I 槽位朝向对不上、J/P 后果枚举不符 | ✅ 2 条失败，`expected: DOMINANT_AUXILIARY_SWAP but was: CATEGORIES_SWAP_SLOTS`、`expected: 'i' but was: 'e'` |

同一轮的 16 型 `neighbors` 重写也配了一个逐段核对脚本（`work/verify_neighbors.mjs`）：
按钉住的 16 型过程表检查每段"邻居找得对不对、机制说得对不对、过程名有没有越界"。
它当场抓到 9 段初稿**只讲抽象机制、一个过程名都没点出来**（另有 3 段连"主辅换了位置"
这层意思都没说清）—— 与上面那条错误是同一种毛病。
方法与输出见 [`../verification/acceptance-evidence.md`](../verification/acceptance-evidence.md) §10.5。

---

## 9. 端到端冒烟脚本

脚本 [`../verification/run-e2e-smoke.mjs`](../verification/run-e2e-smoke.mjs)：
Node ESM、零依赖、自带 cookie jar 与 CSRF 处理，27 个步骤全部真实 HTTP 往返。
结果落盘 [`../verification/e2e-smoke-result.json`](../verification/e2e-smoke-result.json)。

写这个脚本时我自己造出过**两次假通过**，都比较隐蔽，留痕：

1. **信封层级读错**：`GET /api/v3/reports/{id}` 返回
   `{ report: {...}, selfReflection, attemptId, attemptRevision }`，
   报告本体在 `.report` 里。我第一版读顶层 `doc.computedTypeCode`，
   于是所有断言拿到 `undefined`，而 **`undefined === undefined` 成立** ——
   一整批断言全都"通过"了。
2. **`step()` 返回值不是我以为的东西**：它返回的是**给人看的说明字符串**，
   不是 `fn` 的返回值，于是 `registration.userId` 恒为 `undefined`。
   修法是引入 `ok(message, value)` 显式区分"日志说明"与"传给下一步的结构化值"。

还有一条**是我判断错了、不是实现错了**：我最初断言"二次提交必须被拒"，
实际服务端设计是**幂等** —— 重复提交返回同一份报告（一份 attempt 只对应一份报告），
HTTP 200 是正确行为。已改为断言 reportId 不变、报告仍 1 份、`reportHash` 不变。
**把"幂等"误判成"必须报错"是一个真实存在的审查盲点。**

顺带验证到限流**在真实运行路径上确实生效**：探测中连续注册把注册限流打满
（`429`，`register.ip-limit=5/小时`），不是只写在配置里。

---

## 10. 已知的前端缺口（明确未做）

以下为**后端接口已实现、前端页面尚未接**或**完全未实现**的部分：

| 缺口 | 说明 |
|---|---|
| AI 分析界面 | 后端 `/api/v3/reports/{id}/analyses`、`/analyses/{id}`、`/analyses/{id}/retry`、`/ai/status` 已实现，前端无对应页面与轮询 |
| 对比视图 | 无 `CompareView`、无对应路由（后端 `GET /reports/compare?ids=` 已实现） |
| 独立分享卡片模块 | 无独立 `utils/shareCardV3.ts`，canvas 导出内联在 `ReportV3View.vue` |
| 答题页离线队列 | 无 offline outbox 队列；断网时作答不排队重发 |
| 管理员 DeepSeek key 配置页 | 后端 `/api/v3/admin` 已实现（key 加密存库、`apiKeySource ∈ db\|env\|none`），前端无配置页面 |
| **注册时的免责声明同意** | **前端无此项、后端不校验**（`RegisterRequest` 里没有该字段，全仓无人读 `disclaimer`）。详见 `../verification/acceptance-evidence.md` §9.1 |
| **首页下半部分仍由旧内容包驱动** | `你会得到什么` / `会测到的五个维度` / `常见问题` / `本地记录与清除` / `来源与许可` 仍是 IPIP-50 大五的文案。首屏以上已改成新测口径，但页面下方**全文**仍能命中 `大五` / `50 题`。属"新旧两代内容共存"的遗留，需产品定范围后统一 |
| **无障碍与移动端可用性** | 小字号辅助文字对比度 3.35–3.62:1（低于 WCAG AA 4.5:1）；320×720 首屏放不下答题操作区；320 宽 sticky 顶栏占首屏 19%。三者**均未修**，属产品取舍，实测值见 `../verification/acceptance-evidence.md` §9.1 |

### 10.1 已修的界面缺陷（浏览器验收发现）

浏览器走查抓到 2 个**硬缺陷**，已修并在 jar 产物上复验：

| 缺陷 | 根因 | 修法 |
|---|---|---|
| 首页宣传「大五 / 50 题」，主按钮却链到 48 题主测的十六型测评 | 新站页面从**旧引擎**的 `useQuizStore().activePackage` 读量表名与题数 | 新增 `stores/instrumentV3.ts` 作为新测口径唯一来源（读 `GET /api/v3/catalog/current`，离线退到**新测自己**的内置口径，**绝不退回旧包**）；`App.vue` / `LandingView.vue` 按路由分代 |
| `jung48` 产出的 ENFP 报告，顶栏写「大五」、页脚署名 IPIP/Goldberg | 同上（壳层与分享预览都写死了旧量表名） | `ReportV3View.vue` / `SharePreview.vue` 改成取报告自己的 `methodology` + 目录接口 |

顺带修正了 `frontend/index.html` 的静态 `<title>` / `description` / `<noscript>` ——
它此前写着「大五人格倾向自测（IPIP-50）」「**免费无需登录**」
「所有计算都在你的浏览器里完成，**没有服务器参与**」，
与新站的"需登录、数据存账号里"**直接矛盾**，且是分享预览与爬虫看到的文案。

> **两条测试断言被同步更新，不是为了变绿。** `views.spec.ts` 与
> `instrumentCopy.spec.ts` 里"首页显示旧包题数/署名"的断言
> **忠实钉住的正是这个缺陷本身**。旧引擎的断言逐条保留，
> 只是挂到了真正属于旧引擎的路由（`/about`）上。
> 教训与 §8.5 一致：**测试也可以忠实地验证一个错误的接线。**

---

## 11. 本地运行方式

```powershell
# 后端
$env:JAVA_HOME='D:\develop\jdk-21'
cd backend
mvn.cmd -o test              # 210 条测试 / 0 失败 / 1 刻意跳过
mvn.cmd -o spring-boot:run   # 起服务（默认 8080）

# 前端
cd frontend
npm.cmd install
npm.cmd run typecheck        # vue-tsc，必须零错误
npm.cmd test                 # vitest，16 文件 / 584 条
npm.cmd run dev              # 开发服务器
npm.cmd run build            # 构建（含 typecheck），产物进 dist/
```

### 11.1 数据库配置

`backend/src/main/resources/application.yml` 默认连
`jdbc:mysql://127.0.0.1:3306/typeme_dev`，账号密码走
`${TYPEME_DB_USER:root}` / `${TYPEME_DB_PASSWORD:123456}`，
可用环境变量覆盖（**不要把真实密码写进配置文件**）。

⚠️ **`typeme_dev` 上首次启动会被 Flyway 拒绝**：它有 15 张表但**没有
`flyway_schema_history`**，而本项目 `baseline-on-migrate: false`
（刻意不 baseline —— 那会把手工建的库当成"已迁移"从而跳过校验）。
请用一个空库，例如：

```powershell
mysql -h 127.0.0.1 -uroot -p123456 -e "CREATE DATABASE typeme_local CHARACTER SET utf8mb4;"
$env:TYPEME_DB_URL='jdbc:mysql://127.0.0.1:3306/typeme_local?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8'
```

> `characterEncoding` 必须是 `UTF-8`。写成 `utf8mb4` 会得到
> `UnsupportedEncodingException: Unsupported character encoding 'utf8mb4'`。
> `mysql` 命令行客户端也要加 `-h 127.0.0.1`，否则可能走 socket/具名管道而不是 TCP。

### 11.2 端到端冒烟与可选的 AI 配置

```powershell
# 端到端冒烟（需要后端已启动）
node docs/2026-09-16/verification/run-e2e-smoke.mjs `
  --base http://127.0.0.1:8099 `
  --out  docs/2026-09-16/verification/e2e-smoke-result.json
```

AI 分析是**可选能力**，不配也能用（基础报告与固定计分完全不依赖它）：

```powershell
$env:TYPEME_SETTINGS_SECRET='<用于加密入库的 DeepSeek key，务必换掉默认值>'
$env:TYPEME_ADMIN_BOOTSTRAP_USERNAME='<首个管理员用户名>'
# 或直接用环境变量提供 key：
$env:DEEPSEEK_API_KEY='sk-...'
```

`apiKeySource` 会如实报告 key 来自 `db` / `env` / `none`，不会把
env 来源伪装成 db 来源。

内容改动后必须重新生成，否则启动期哈希校验会对不上：

```powershell
node scripts/convert-jung-content.mjs   # YAML → backend JSON（含 sha256）
node scripts/gen-jung-fixtures.mjs      # 重算三份夹具副本
```

---

## 12. 过程中修掉的构建/环境问题（留痕）

- `@SpringBootTest` **没有** `excludeFilters` 属性 —— 写在它上面直接编译不过，
  整个测试源码集无法编译。排除扫描必须挂在带 `@ComponentScan` 的类上，
  或走 `@TypeExcludeFilters`（正确包名是 `org.springframework.boot.test.autoconfigure.filter`，
  不是 `...test.context.filter`）。
- 测试作用域里的 `AiTestApplication` 会与生产 `AiClock` 撞名，
  导致所有 `@SpringBootTest` 一起红且报错指向别的模块。已用
  `@ExcludeCrossModuleTestConfigs` 统一处理。
- 全站集成测试此前隐式继承 `application.yml` 的 MySQL 数据源，
  于是"测试通过"实际依赖"本机 MySQL 开着"。已补 `application-test.properties`
  显式切到 H2（`MODE=MySQL`），顺带持续验证迁移的双引擎兼容性。
- `application.yml` 的 JDBC URL 曾写 `characterEncoding=utf8mb4`，
  Connector/J 直接抛 `UnsupportedEncodingException` —— 应用默认配置**起不来**。
  应为 `UTF-8`（连上后协商出的仍是 utf8mb4）。
- Jackson 的 `writeValueAsString` 抛受检异常；改用 `JsonNode#toString`
  避免为纯 JSON 值平白引入一层 try/catch。
- 报告 `reportHash` 必须覆盖"除自己以外的每个字段"，因此是"序列化→算哈希→追加→再序列化"。
  这段两步舞原先散在 `ReportService` 里，任何人都能在两次序列化之间插字段而让它逃出哈希。
  已收进 `JungReportBuilder.finalizeWithHash`，并有测试逐字段验证覆盖范围。
- **Maven 只有 stderr 输出时会回 `exit code: 1`，即使 `BUILD SUCCESS`。**
  判断成败必须看 `BUILD` 行，不要看退出码 —— 否则一次全绿的运行会被误读成失败。
- **`mvn -Dtest=A+B` 在 surefire 里不成立**，多个测试类要用**逗号**分隔，
  否则报 "No tests matching pattern"。
- **PowerShell 的 `-Encoding UTF8` 会写 BOM**，带 BOM 的 `.java` 文件 `javac`
  直接报 `非法字符: '\ufeff'` 并把后面每一行都报成"需要 class/interface"。
  写 Java 源文件用：
  `[System.IO.File]::WriteAllText($p, $s, (New-Object System.Text.UTF8Encoding($false)))`。
- **用 `Select-String | Select-Object -First N` 过滤 Maven 输出会截断 `Tests run` 行**，
  把一次通过的运行显示成失败。要落盘后再过滤，或先 grep `BUILD` 行。
- **测试库隔离不能靠 `@DynamicPropertySource` 继承**。实测四种做法全部失败：
  子类换名静态方法、子类同名覆盖、非静态实例方法（报
  `must be static`）、系统属性间接层。原因是基类的 `@DynamicPropertySource`
  与任何后加的 `ContextCustomizer` 都用 `addFirst`，**基类的值仍然胜出**。
  可行方案：子类**完全不声明**数据源 `@DynamicPropertySource`，
  由基类统一注册，再用按测试类名生成库名的 `ContextCustomizerFactory` 提供值。
  实测 `AdminApiIT` → `typeme_adminapiit_<RUN_ID>`、
  `AdminBootstrapIT` → `typeme_adminbootstrapit_<RUN_ID>`，隔离成立。
- **Java 静态方法不能被覆写**：`@Override static` 直接编译失败，
  不能用"子类覆盖静态方法"来改变基类的注册目标。
