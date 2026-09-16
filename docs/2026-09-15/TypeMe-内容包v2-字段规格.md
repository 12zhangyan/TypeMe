# TypeMe 内容包 v2 · 字段规格（实施契约）

日期：2026-09-15 · 状态：工程实施契约（用于后端加载、脚本生成、前端内置降级三处对齐）。
配套：[开发方案](TypeMe-测评可信度调整-开发方案.md) §5、[32题审校与解释草案](TypeMe-32题审校与解释草案.md)。

本文件只规定**字段与校验规则**。它不修改 OEJTS 1.2 的计分公式，也不代表任何题目或解释已经过心理测量验证。

## 0. 多仪器扩展（IPIP 大五接入后新增）

从接入第二份量表（IPIP 大五 50 题）起，内容包不再假设"一定是 OEJTS 四维双极量表"。
包自己声明是哪份量表，**官方事实由本地仪器档案独立核对**：

| 概念 | 字段 | 说明 |
|---|---|---|
| 作答格式 | `instrument.format` / `questionnaire.format` | `bipolar`（一对相反描述 + 五档位置，OEJTS）或 `agreement`（一句自我描述 + 五档贴切度，IPIP） |
| 是否产出类型码 | `instrument.hasTypeCode` | OEJTS `true`（四字母参考组合）；大五 `false`（本来就不是类型量表） |
| 维度顺序 | 包级 `dimensionOrder` | 可省略；省略时取仪器档案，再退化为"题目中首次出现的顺序" |
| 两端记号 | `dimensionCopy[key].lowPole` / `.highPole` | 可省略；省略时取仪器档案（OEJTS `I`/`E`…，IPIP `低`/`高`） |
| 单句题干 | `questions[].text` | 仅 `agreement` 格式使用；`bipolar` 仍用 `textLeft`/`textRight` |
| 五档文案 | `questionnaire.responseAnchors` | 长度必须为 5；省略时用 OEJTS 的"完全/比较/一半一半"文案 |

> **可选字段与 `null`**：上表里"可省略"的字段，服务端与前端内置副本对**缺省**的表达不同 ——
> YAML 缺省 → TS 里字段不存在，而 Jackson 默认会把它序列化成**显式 `null`**。
> 校验器必须把两者同等对待（`value != null` 才算"没声明"）。写成 `!== undefined`
> 会让接口返回的每一份内容包都被判非法，页面随即静默降级到内置副本 ——
> 这是本轮真实出现过、并被浏览器验收抓到的回归（见 `实施核验记录.md` §7.2 第 1 条）。

**仪器档案（`INSTRUMENT_PROFILES`）是这套设计的核心。** 它用**独立抄录**的官方数据
（题数、维度、每维题数、中点、常量、逐题符号、两端记号、是否类型量表、attribution 规则）
去核对内容包，因此"符号抄反""题目对调""常量被改"都会在装载期被判红。它有两份必须一致的实现：

- 前端：`frontend/src/domain/assessmentPackage.ts`
- Node 生成器：`scripts/lib/backend-content.mjs`

（后端 `ContentService` 亦有同名档案。）**没有本地档案的 `instrument.id` 会被拒绝装载** ——
不允许一份无法被独立核对的量表悄悄上线。

**与量表无关的两条通用不变量**（任何仪器都必须满足，三处校验器都会检查）：

1. **常量配平**：对每个维度，`constant + 3 × Σdirection === midpoint`，
   即"每题都选 3（中立 / 谈不上贴切）"时该维原始分正好落在中点上。
   由此自动得到 `min = midpoint − 2×题数`、`max = midpoint + 2×题数`、区间关于中点对称。
2. **每维题数一致且等于解释政策声明的最低作答数**：`interpretation.minRatingsPerDimension`
   必须等于该仪器每维的实际题数（OEJTS 8、IPIP-50 10）。

## 1. 文件位置与命名

```
backend/src/main/resources/assessment-packages/<packageId>.yml
```

- 该目录**不在** `content/questionnaire-*.yml` 的扫描范围内，v1 的 `/api/v1/questionnaires/{version}` 不受影响。
- 一个文件一个不可变包。`packageId` 必须与文件名（去掉 `.yml`）完全相等。
- 内容一旦发布就不再修改；任何题面、帮助、计分或解释文案改动都必须换新 `packageId`。

本轮已注册的包（注册表在两处必须同时登记：`backend/.../service/ContentService.java` 与
`scripts/lib/backend-content.mjs` 的 `ASSESSMENT_PACKAGE_IDS`）：

| packageId | 量表 | 题面 | 帮助 | 状态 |
|---|---|---|---|---|
| `oejts32-zh1-report2` | OEJTS 32 题（双极） | 现行中文题面 | 针对现行题面撰写 | `draft` |
| `oejts32-zh2-preview-r1` | OEJTS 32 题（双极） | 审校表候选题面 | 审校表帮助候选 | `draft` |
| `ipip50-zh1` | **IPIP 大五 50 题（单句贴切度）** | 自行转写的简体候选稿 | 逐题撰写 | `draft` |

`oejts32-zh2-preview-r1` 不得作为会持续变化的别名使用；内容变更必须追加修订号（`-r2`…）。

## 2. 顶层结构

```yaml
schemaVersion: 2                     # 固定 2
packageId: "oejts32-zh1-report2"     # 必须等于文件名
locale: "zh-CN"
localeRevision: "zh1-2026-09-01"     # 题面修订标识
helpRevision: "help-zh1-r1"          # 帮助文字修订标识
copyRevision: "report2-r1"           # 解释/报告文案修订标识
contentStatus: "draft"               # draft | reviewed | field_checked
instrument:
  id: "oejts32"
  revision: "1.2"                    # OEJTS 原始版本，本轮不改
  scoringVersion: "oejts-1.2"
interpretation:
  version: "typeme-conservative-v2"
  minRatingsPerDimension: 8
  typeMinDistance: 5
  markedDistance: 9
title: "快速版（现行题面）"            # 会话/包选择页展示
estimatedMinutes: 5
questionnaire: { ... }               # 见 §3
itemHelp: { ... }                    # 见 §4
dimensionCopy: { ... }               # 见 §5
reportCopy: { ... }                  # 见 §6
nextSteps: [ "...", "..." ]          # 3 条通用观察建议
attribution: { ... }                 # 见 §7
```

`contentStatus` 不得高于包内题面/帮助/解释实际证据的最低状态：本轮两个包都含 draft 帮助，因此都必须是 `draft`。

## 3. `questionnaire`

沿用现有核心结构（与 `questionnaire-quick.yml` 同形），字段一个不多一个不少：

```yaml
questionnaire:
  version: "quick"
  title: "快速版"
  questionCount: 32
  estimatedMinutes: 5
  scoring:
    midpoint: 24
    constants: { EI: 30, SN: 12, TF: 30, JP: 18 }
  questions:
    - id: 1
      textLeft: "喜欢列清单"
      textRight: "凭记忆"
      dimension: "JP"
      direction: 1
    # …共 32 条，id 必须按 1..32 升序且连续
```

硬约束（三处校验器共用同一套规则）：

1. 32 题、id 恰为 1..32 且升序、无重复。
2. 每维恰好 8 题；维度与符号必须等于 OEJTS 1.2 原公式：

   | 维度 | 常量 | +1 题号 | −1 题号 |
   |---|---:|---|---|
   | EI | 30 | 15,23,27 | 3,7,11,19,31 |
   | SN | 12 | 4,8,12,16,20,32 | 24,28 |
   | TF | 30 | 6,10,22 | 2,14,18,26,30 |
   | JP | 18 | 1,5,13,21,29 | 9,17,25 |

3. `midpoint` 必须为 24，`constants` 必须与上表逐字相等。
4. `textLeft` 对应官方「圈 1」端，`textRight` 对应「圈 5」端；两端不得相同。
5. `questionnaire.version` 允许继续为 `quick`；会话与内容匹配必须用 `packageId` + 包签名，不得用这个值识别整套内容。

## 4. `itemHelp`

键必须严格为字符串 `"1"` … `"32"`，**全覆盖**，不得缺项也不得多项。

```yaml
itemHelp:
  "1":
    explanation: "比较你通常用什么方式记住要做的事。……"
    reviewStatus: "draft"
    riskCodes: []
  "6":
    explanation: "……"
    reviewStatus: "draft"
    riskCodes: ["L", "B"]
```

- `reviewStatus`：`draft | reviewed | field_checked`。
- `riskCodes`：`[]` 或 `L` / `B` / `C` 的子集（语言可理解性 / 两端不对称 / 情境与社会评价影响）。
- `explanation` 是**用户可见文字**：
  - 必须同时说明两端在比什么，不引导向社会认可的一侧；
  - 不出现「你天生」「你一定」这类断言；
  - 不出现面向开发者的内部批注（例如「若采用『先』字版本需核对」「该解释的场景范围须与最终题面一致」这类句子一律不得进入用户可见文本）；
  - 建议以「如果仍不能判断，或两边都不适用，可以选择『暂时无法判断』。」作为共同结尾（可在该题已表达等价含义时省略）。
- 帮助展开只影响界面，不改变回答、计数或分数。

## 5. `dimensionCopy`

四个维度 `EI` / `SN` / `TF` / `JP` 必须齐全。`negative` 是数值低侧（I / S / F / J），`positive` 是数值高侧（E / N / T / P）。`negative` / `positive` 只是数值侧，不含好坏含义，用户界面不得出现「负面人格」。

```yaml
dimensionCopy:
  EI:
    name: "精力方向"
    negative:
      label: "内向"
      description: "……"   # 只谈这一维的精力与互动偏好
      observation: "……"   # 一条中性观察提示
      action: "……"        # 一条可执行的小行动
    positive:
      label: "外向"
      description: "……"
      observation: "……"
      action: "……"
    balanced:
      summary: "本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。"
      observation: "……"
    insufficient:
      summary: "这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。"
      nextStep: "……"
  SN: { ... }
  TF: { ... }
  JP: { ... }
```

内容规则（与产品方案 §5.2 一致）：

- 一条 EI 解释只谈精力/互动偏好，不因另三维改变而顺带推断「总是照顾别人」。
- 不从 SN 推断智力，从 TF 推断道德，从 JP 推断勤奋，从 EI 推断社交能力。
- 不出现「你一定」「你天生」「你总是」。
- 每侧都要写明「它不等于什么」，避免把偏好读成能力或缺陷（例如 I：不等于害怕社交，也不说明表达能力）。
- 不生成认知功能排序、荣格八维、A/T、职业匹配率、恋爱配对、类型稀有度。

## 6. `reportCopy`

报告页与分享产物共用的固定文案（各维度正文来自 `dimensionCopy`）。

```yaml
reportCopy:
  typedTitle: "本次问卷参考组合"
  typedSubtitle: "四个维度都达到本产品的展示条件。它仍是本次回答下的参考组合，不代表稳定不变的类型。"
  partialTitle: "我的偏好，还有待观察的部分"
  partialSubtitle: "部分维度可以给出方向，其余维度本次不足以判型，因此完整类型为空。"
  undeterminedTitle: "本次回答没有显示明确方向"
  undeterminedSubtitle: "四个维度都落在接近中点的范围，本次不生成完整类型。"
  insufficientTitle: "这次先保留未定"
  insufficientSubtitle: "有维度缺少足够的有效作答，本次不计算这些维度的分数。"
  typeReadingLead: "类型参考介绍：按本版题目组合起来的通用阅读材料，不是逐项测得的个人能力。"
  scoreMethodNote: "得分 = 该维度常量 + Σ(方向符号 × 你的选择)。该维度 8 题都有数字答案时才会计算。"
  dimensionReviewLead: "下面是这一维相关的题目与你的选择。它只帮助回顾，不构成因果或诊断证据。"
  selfReflectionLead: "这段记录只用于你自己的观察，不计入量表分数，也不会改变上面的结果。"
```

这四个标题分别对应 `overallStatus`：

| overallStatus | 标题字段 | 含义 |
|---|---|---|
| `typed` | `typedTitle` | 四维都达到展示条件 |
| `partial` | `partialTitle` | 至少一维达到，但不足四维 |
| `undetermined` | `undeterminedTitle` | 没有任何维度达到展示条件，且不存在信息不足维度 |
| `undetermined` + 存在 `insufficient` | `insufficientTitle` | 同上，但至少一维信息不足 |

## 7. `attribution`

与 v1 `method.yml` 的 attribution 逐字段同形（CC BY 的署名义务）：

```yaml
attribution:
  source: "Open Extended Jungian Type Scales (OEJTS) 1.2"
  author: "Eric Jorgenson"
  url: "https://openpsychometrics.org/tests/OEJTS/"
  license: "CC BY-NC-SA 4.0"
  licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/"
```

以上五个键的值必须与 `backend/src/main/resources/content/method.yml` 的 attribution 完全一致（由校验器与测试断言）。

## 8. 解释政策（写进 `interpretation`，但算法在客户端）

```text
对每个维度 d：
  收集该维度 8 题
  若存在任一题没有合法 1–5 数字答案（无法判断 / 未处理 / 损坏）→ insufficient
      score = null，pole = null，不补 3、不按比例补分、不缩短分母
  否则按 OEJTS 1.2 原公式计算 score
  delta = score − midpoint
  delta == 0            → balanced，pole = null
  1 ≤ |delta| ≤ 4       → tentative，pole 按符号
  5 ≤ |delta| ≤ 8       → leaning，pole 按符号
  9 ≤ |delta|           → leaning，pole 按符号
仅当四个维度都是 leaning 时才拼出 suggestedTypeCode（顺序 EI, SN, TF, JP）。
```

`typeMinDistance = 5` 是**本产品暂定的保守展示策略**，不是统计置信阈值，也没有证据证明它提升测量准确率。它必须版本化（`interpretation.version`），不得对外表述为 OEJTS 或 MBTI 官方规则。

### 8.1 门槛的跨量表换算（IPIP-50 的 6 / 11 是这么来的）

`typeMinDistance` / `markedDistance` 是**该量表偏移量程上的绝对分**，所以换量表必须重新给数：

| 量表 | 每维题数 | 偏移量程 | 门槛（略偏 / 明确） | 占量程比例 |
|---|---:|---|---|---|
| OEJTS 32 | 8 | ±16（中点 24，区间 8–40） | 5 / 9 | 31.3% / 56.3% |
| IPIP-50 | 10 | ±20（中点 30，区间 10–50） | 6 / 11 | 30% / 55% |

IPIP-50 的门槛是按**相同比例**（≈31%/≈56% 的最大偏移）换算并取整得到的，
目的是让两份量表对"多远才算有方向"保持同一尺度感。它同样是**展示策略**，不是心理测量阈值。
每次改这两个数字都属于**解释政策变更**：必须同时改 `interpretation.version`、写进内容包，
并保留旧版本可复现。

## 9. 三处校验的一致性要求

后端启动校验、Node 生成器校验、前端内置降级校验必须使用同一套规则（本文件 §3–§7）。
新增包整体解析失败即失败，不允许「只丢一段帮助」继续启动；已注册为可用的包损坏时后端启动失败。

- 后端：`GET /api/v2/assessment-packages/{packageId}`，只读、无鉴权、无答案请求、无写接口。
  - 成功 200 + `application/json`；
  - 未知包 404：`{"code":"ASSESSMENT_PACKAGE_NOT_FOUND","message":"该版本暂不可用"}`；
  - 服务异常 500：`{"code":"CONTENT_UNAVAILABLE","message":"内容暂时不可用"}`（不得回传文件路径、堆栈或秘密）。
  - `packageId` 必须经注册表白名单解析，禁止把用户输入直接拼成 classpath 路径。
- Node 生成器：`node scripts/gen-fallback-content.mjs --check` 必须同时覆盖内容包副本。
- 前端：接口超时/错误/结构非法时，只能用**同一个 packageId** 的有效内置副本；没有同包时显示不可用，不得悄悄切到另一版。
