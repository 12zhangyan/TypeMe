# TypeMe 测评可信度调整：开发方案

版本：2.0 · 日期：2026-09-15 · 状态：工程规格可实施；候选中文内容仍待真人审校/试用。

必须配合阅读：[产品方案](TypeMe-测评可信度调整-产品方案.md)、[32题审校与解释草案](TypeMe-32题审校与解释草案.md)、[本轮核验记录](assessment-evidence/核验记录.md)。

## 0. 执行边界与目标

在当前工程内修正**题目解释、无法判断的答案、判型策略和报告生成**。本方案覆盖上一版文档中“每份答卷始终拼完整类型”“结果由一个类型profile驱动”“仅允许1–5且必须全答才能看任何报告”的规则。

保留：Vue 3、Pinia、Java内容服务、原OEJTS数值公式、手机/PC视觉基础、无账号/无数据库/本地计分/只读内容API。不要重新制作整个站点、引入AI判型或自造量表权重。

本轮只交付方案及核验材料，未修改业务源码。后续实施不包含提交、推送、公开发布、上传用户答卷或数据库写入。

### 0.1 一句话技术方案

```text
锁定的题目与解释内容包
  → 分开的“数值/无法判断”回答
  → 每维独立原始计分
  → 有版本号的解释策略
  → 同一份 ReportViewModel
  → 页面 / 图片 / 复制文字 / 文件名
```

内部兼容码不再作为展示模型的必填字段，所有显示端禁止自行回退为ISFJ。

## 1. 当前代码地图与改动位置

| 当前文件 | 当前职责/已观察问题 | 调整 |
|---|---|---|
| `frontend/src/domain/types.ts` | QuizResult强制typeCode；DimensionResult强制dominant | 保留旧数值结果类型用于兼容；新增可未定的分析类型 |
| `domain/scoring.ts` | 原公式与兼容码 | 保留纯数字旧入口；抽出可按维度计分的共享实现 |
| `domain/clarity.ts` | 距离分档，阈值2/5/9 | 旧字段不作为最终判型；新增解释策略版本 |
| `domain/answers.ts` | 仅数字1–5 | 数字校验保留；新增回答联合类型与normalize函数 |
| `domain/questionnaire.ts` | API/存储共用结构校验 | 扩展为内容包与快照统一验证，不削弱原符号表守卫 |
| `stores/quiz.ts` | v2快照、答案、报告profile | 新会话v3、计分/处理进度分开、报告失效与恢复 |
| `views/QuizView.vue` | 单题、答题卡、提交 | 加释义、无法判断、交卷前复查，保留手动下一题 |
| `views/ResultView.vue` | 按typeCode获取profile，均衡仍展示类型正文 | 用ReportViewModel；撤掉类型驱动的个人日常/优势逻辑 |
| `components/DimensionBar.vue` | 均衡文字仍拼dominant | 按状态渲染；未定没有主导字母 |
| `components/TypeCardBody.vue` | 类型优势正文 | 只用于明确标识的类型参考阅读，不能填充未定报告 |
| `utils/shareImage.ts`、`SharePreview.vue` | 直接使用typeCode/profile | 输入ReportViewModel；部分/均衡/信息不足有独立版式 |
| `backend/.../model/Question.java` | 仅题干、维度、符号 | v1保持兼容；v2内容包有帮助与版本元数据 |
| `backend/.../service/ContentService.java` | classpath YAML加载，题数与符号守卫 | 增加独立v2包加载/验证，不扩展v1 quick语义 |
| `scripts/lib/backend-content.mjs`、生成脚本 | YAML→TS内置内容 | 同时支持v2内容包，明确生成清单及只读check |

允许新增 `assessment.ts`、`interpretation.ts`、`report.ts` 等模块，但文件名可按现有组织调整。真正需要隔离的是职责，不是强制固定目录数量。

## 2. 分层数据模型

以下为目标内部契约，不是现有接口已存在的字段。

### 2.1 作答：无法判断与中立分开

```ts
type Dimension = 'EI' | 'SN' | 'TF' | 'JP'
type Pole = 'I' | 'E' | 'S' | 'N' | 'F' | 'T' | 'J' | 'P'
type Rating = 1 | 2 | 3 | 4 | 5
type UnknownReason = 'unclear' | 'no_experience' | 'not_applicable' | 'unsure'

type Response =
  | { kind: 'rating'; value: Rating }
  | { kind: 'unknown'; reason: UnknownReason | null }

type ResponseMap = Record<number, Response>
// 某题完全未处理：map中没有这个key，不写成unknown，不补3。
```

规则：

- `rating.value`只接受合法整数；新会话不靠隐式字符串转换。
- 新旧格式迁移时可以显式使用既有coerceAnswerValue，但必须记录这是旧数据适配，不能混入正常输入逻辑。
- 点击无法判断覆盖当前数字；再点击数字覆盖无法判断。两者不可能同时存在。
- 打开帮助只影响UI展开状态；不改变回答、处理数量、完成时间或分数。
- unknown的reason可不填；原因用于本地回顾，不触发外发。
- 未知题号、非法kind、NaN/无穷、小数、对象注入等被归为损坏记录，保留其余合法回答并引导补答；不能把损坏值自动当作用户选择了unknown。

### 2.2 维度分析模型

```ts
type DimensionAnalysis =
  | {
      dimension: Dimension
      status: 'insufficient'
      requiredCount: 8
      ratingCount: number
      unknownIds: number[]
      unansweredIds: number[]
      score: null
      signedOffset: null
      pole: null
    }
  | {
      dimension: Dimension
      status: 'balanced' | 'tentative' | 'leaning'
      requiredCount: 8
      ratingCount: 8
      score: number
      signedOffset: number       // score - 24
      pole: Pole | null          // balanced为null；其余为实际偏向
      presentationBand: 'equal' | 'slight' | 'moderate' | 'marked'
      counts: { negative: number; neutral: number; positive: number }
      reviewItemIds: number[]    // 该维8题，固定题库顺序，不按“人格贡献”排名
    }

interface AssessmentAnalysis {
  packageId: string
  scoringVersion: 'oejts-1.2'
  interpretationVersion: 'typeme-conservative-v2'
  dimensions: DimensionAnalysis[]  // EI,SN,TF,JP固定顺序
  suggestedTypeCode: string | null // 只有四维均leaning才有值
  overallStatus: 'typed' | 'partial' | 'undetermined'
}
```

- `overallStatus=typed`：四维均leaning；`partial`：至少一维leaning但不足四维；`undetermined`：没有leaning维度。
- insufficient与balanced不是同一种状态；一个没分数，一个有有效分数但没有偏移。
- `presentationBand`只描述本次数值偏移；不能名为confidence、accuracy或reliability。
- `Pole|null`的一致性由构造函数和测试保证：balanced必为null；tentative/leaning必为所属维合法侧。
- 不把 `rawLegacyTypeCode`放进ReportViewModel。需要查旧公式码时在开发诊断中显式调用旧入口。

### 2.3 展示模型：三端唯一入口

```ts
interface ReportViewModel {
  reportId: string
  packageId: string
  interpretationVersion: string
  overallStatus: AssessmentAnalysis['overallStatus']
  title: string
  subtitle: string
  suggestedTypeCode: string | null
  dimensionRows: Array<{
    dimension: Dimension
    status: DimensionAnalysis['status']
    heading: string
    summary: string
    negativeLabel: string
    positiveLabel: string
    position: number | null   // 0..1；insufficient为null
    details: string[]
    actions: string[]
  }>
  nextSteps: string[]
  attribution: Attribution
  contentStatus: 'draft' | 'reviewed' | 'field_checked'
}
```

页面、图片、复制和文件名都消费这个模型。图片允许减少段落，但不能增加模型没有的类型、角色名或确定性。

## 3. 算法实现与不变量

### 3.1 原公式保持不变

当前数值公式是本量表的基准；不是“看起来不准”就把符号、常量、阈值改掉。

| 维度 | 常量 | 正向题 | 负向题 | 数值高侧/低侧 |
|---|---:|---|---|---|
| EI | 30 | 15,23,27 | 3,7,11,19,31 | E/I |
| SN | 12 | 4,8,12,16,20,32 | 24,28 | N/S |
| TF | 30 | 6,10,22 | 2,14,18,26,30 | T/F |
| JP | 18 | 1,5,13,21,29 | 9,17,25 | P/J |

业务实现由内容包驱动；表用于独立断言。原始依据见 [OEJTS 1.2 PDF](https://openpsychometrics.org/tests/OJTS/development/OEJTS1.2.pdf)。

```text
score[d] = constant[d] + Σ direction[q] × rating[q]
centered[q] = direction[q] × (rating[q] - 3)
signedOffset[d] = Σ centered[q] = score[d] - 24
```

仅当该维8题均有数字评分时计算。新增按维度入口复用原数值逻辑，不能为了让旧的全问卷函数通过而给其他题填3。

### 3.2 新解释策略

```text
for each dimension d:
  收集该维8题
  若缺少任一合法rating → insufficient，score=null，pole=null
  否则按原公式计算score
  delta = score - 24
  delta == 0         → balanced, pole=null, band=equal
  1 <= abs(delta)<=4 → tentative, pole按符号, band=slight
  5 <= abs(delta)<=8 → leaning, pole按符号, band=moderate
  9 <= abs(delta)    → leaning, pole按符号, band=marked

仅四维都是leaning时，按EI,SN,TF,JP拼suggestedTypeCode。
其他情况suggestedTypeCode=null。
```

门槛5是**暂定产品解释政策**，不是量表新的计分阈值，更不是经验证的置信界限。独立记录interpretationVersion，不伪装修改了官方算法。

不要通过裁剪分数掩盖数据错误：原始分不在8–40时应拒绝该内容/数据，不进入正常报告。未知内容、缺少维度、重复题号、非法方向、非法常量都在计算前拦截。

### 3.3 回答分布

`counts`依据centered的符号计算，而非直接统计选左/右，因为题目direction有正反。三个数相加必须等于8。

- 8个neutral：说明这一维8题都选中间；不等于敷衍。
- negative与positive同时存在、合计偏移接近0：说明这组不同题目两侧作答合计接近，不等于逻辑矛盾。
- 全选1或全选5：不自动判无效，因为题目符号不同；可以在回看页展示事实，不加权扣分。
- 不用单次作答计算Cronbach α、人格可靠性、置信区间或正确率。

### 3.4 关键数值样例与新输出

分数顺序均为EI/SN/TF/JP。

| 输入 | 原始分数 | 内部旧码 | 新解释结果 |
|---|---|---|---|
| 全1 | 28/16/28/20 | ESTJ | 只有SN为leaning；partial，完整类型null |
| 全3 | 24/24/24/24 | ISFJ | 四维balanced；undetermined，完整类型null |
| 全5 | 20/32/20/28 | INFP | 只有SN为leaning；partial，完整类型null |
| 全3，Q3=2 | 25/24/24/24 | ESFJ | EI tentative；其余balanced，完整类型null |
| 全3，Q3=4 | 23/24/24/24 | ISFJ | EI tentative；其余balanced，完整类型null |
| 各维四题centered=+2，四题=-2 | 24/24/24/24 | ISFJ | 与全3同为balanced，counts不同 |
| 各维负极端点 | 8/8/8/8 | ISFJ | typed，参考组合ISFJ |
| 各维正极端点 | 40/40/40/40 | ENTP | typed，参考组合ENTP |
| 全3，Q3=unknown | EI=null，其余24 | 不计算完整旧码 | EI insufficient；其余balanced |
| 12/25/16/34的合法答卷 | 相同 | INFP | SN tentative，完整类型null |
| 12/32/16/34的合法答卷 | 相同 | INFP | 四维leaning，参考组合INFP |

后两行用于UI与解释测试；不能把原始分当作用户可提交API输入。测试若需完整答卷，应构造每维centered之和等于目标delta的1–5答案，并独立验算。

## 4. 内容模型：解释不再跟随整个人格类型

### 4.1 维度片段

每维提供四类基础解释：negative、positive、balanced、insufficient。tentative使用两侧介绍及统一“略偏/继续观察”模板；leaning使用本侧介绍。每侧附一条观察提示和一条可行动建议。

```ts
interface PoleCopy {
  label: string
  description: string
  observation: string
  action: string
}
interface DimensionCopy {
  name: string
  negative: PoleCopy
  positive: PoleCopy
  balanced: { summary: string; observation: string }
  insufficient: { summary: string; nextStep: string }
}
```

`negative/positive`是数值侧，无好坏含义；用户界面不出现“负面人格”。内容只谈该维，无跨维推断。

### 4.2 八极点可直接起草的基础文案

以下为非个体断言的内容起点，仍按正常内容审校；所有文案从内容源生成，不散落硬编码在页面。

| 极点 | 描述基础 | 观察提示/小行动 |
|---|---|---|
| I | 这一侧描述更偏好留出独处或内部整理的空间。它不等于害怕社交，也不说明表达能力。 | 回想一次交流前后，哪些安排让你更容易整理想法；下次重要讨论前给自己几分钟准备。 |
| E | 这一侧描述更偏好从外部互动和活动中获得投入感。它不等于总想说话或擅长领导。 | 回想一次互动是否帮助你理清思路；需要想法时可尝试与人短时间交流，再独立整理。 |
| S | 这一侧描述更关注具体事实、经验和可观察信息。它不等于缺少想象力。 | 接触新任务时观察自己是否先找例子和事实；可将已知信息列清，再考虑可能性。 |
| N | 这一侧描述更关注联系、模式和可能性。它不等于更聪明或不重视事实。 | 记录自己形成的一个推测，再找一条可以支持或修正它的实际信息。 |
| F | 这一侧描述更重视价值取向及选择对人的影响。它不等于不理性。 | 做一个选择时写下在意的价值，再补充实际成本与约束。 |
| T | 这一侧描述更重视逻辑一致、原则和分析依据。它不等于没有感受。 | 做一个选择时列出依据，再主动询问相关人的感受与影响。 |
| J | 这一侧描述更偏好确定安排与结构。它不等于勤奋或一定更可靠。 | 观察计划在什么情境帮助你；尝试为一个安排保留可调整的小窗口。 |
| P | 这一侧描述更偏好保留灵活性和继续调整。它不等于拖延或不负责任。 | 观察灵活性在什么情境帮助你；为一件重要事项设一个最晚检查节点。 |

通用balanced：`本次这一维的回答合计接近两侧均衡，先保留未定。可以回看具体题目，再观察不同情境下的偏好。`

通用insufficient：`这一维有题目尚未形成可计分的选择，因此暂不计算分数或判定方向。你可以回看帮助，也可以保留当前报告。`

### 4.3 类型参考文章

- 旧types.yml保留为类型阅读资料；不要全部删除，避免破坏v1或既有用户工作。
- 新个人报告不依赖 `fetchTypeProfile(result.typeCode)`，四维未定时不发默认类型请求。
- typed状态可提供“阅读INFP类型介绍”按钮。内容须显式标识参考资料，与从答案生成的报告分区。
- 不能再“翻一个字母获取另一类型的整段维度说明”。另一侧介绍直接来自同一维的PoleCopy。
- 阅读某类型不改变suggestedTypeCode，不标成测评准确性反馈。

## 5. 新只读内容包接口

### 5.1 为什么允许新增

题干、释义、回答选项和解释策略必须整体锁定；把帮助字段零散从另一接口拉取容易混版本。新增一个只读端点承载同一包，保留v1兼容，仍不提交答案。

**目标端点（当前尚未实现）：**

```http
GET /api/v2/assessment-packages/{packageId}
Accept: application/json
```

首轮建议准备两个不可变内容包：

- `oejts32-zh1-report2`：当前中文题面 + 新报告政策；没有新题面验证承诺。帮助如新增，也须记录helpRevision和draft状态。
- `oejts32-zh2-preview`：审校表候选题面/帮助 + 新报告政策；明确draft，供本地试用。不得把preview别名指向不断变化的内容：编辑后追加修订号，如 `oejts32-zh2-preview-r2`。

这些是内容包ID，不是新量表名称。OEJTS原始instrumentRevision仍1.2；中文改编、帮助、解释政策分别有版本。

### 5.2 返回结构

```ts
interface AssessmentPackage {
  schemaVersion: 2
  packageId: string
  instrument: {
    id: 'oejts32'
    revision: '1.2'
    scoringVersion: 'oejts-1.2'
  }
  locale: 'zh-CN'
  localeRevision: string
  helpRevision: string
  copyRevision: string
  contentStatus: 'draft' | 'reviewed' | 'field_checked'
  interpretation: {
    version: 'typeme-conservative-v2'
    minRatingsPerDimension: 8
    typeMinDistance: 5
    markedDistance: 9
  }
  title: string
  estimatedMinutes: number
  questionnaire: Questionnaire  // 保留现有数值字段与32题核心结构
  itemHelp: Record<string, {    // key严格为"1".."32"，可校验全覆盖
    explanation: string
    reviewStatus: 'draft' | 'reviewed' | 'field_checked'
    riskCodes: Array<'L' | 'B' | 'C'>
  }>
  dimensionCopy: Record<Dimension, DimensionCopy>
  attribution: Attribution
}
```

约束：新核心Question不必增加字段；帮助按题号附加，避免影响旧Question record。unknown选项属于新版客户端回答协议，不作为量表第6个数值档。

### 5.3 身份、错误和兼容

- 路径packageId必须等于响应packageId；使用注册表白名单解析，禁止直接拼用户输入为classpath路径。
- 同一packageId禁止变更任何题面、帮助、计分或报告内容。内容变化产生新ID；包身份可用构建期摘要检查不可变性。
- `questionnaire.version`可继续为原核心结构中的quick；新版会话/API匹配必须使用packageId与包签名，不再用这个quick值识别整套内容。
- 成功200，Content-Type为application/json；未知/不可用包404：`{"code":"ASSESSMENT_PACKAGE_NOT_FOUND","message":"该版本暂不可用"}`。
- 服务异常500：`{"code":"CONTENT_UNAVAILABLE","message":"内容暂时不可用"}`；不返回文件路径、堆栈或秘密。
- 无鉴权、无答案请求、无写接口。v1所有现有端点维持原响应和语义，v1类型文章不被新解释模型污染。
- draft包可在本地开发/明确的试用入口使用；正式可用包注册须依据实际审校状态。不把所有draft改成reviewed来解除校验。
- 不在请求URL、Referer拼接或日志中加入用户答案/分数。获取类型阅读资料可能透露所读类型，UI不把阅读行为当作测评数据上传。

### 5.4 维护、生成与校验

建议独立资源目录 `backend/src/main/resources/assessment-packages/`，避免落入现有 `content/questionnaire-*.yml` 扫描导致v1误加载。现有自定义YAML解析器是否支持新结构需实际验证；优先使用其已支持的结构，不为此引入新解析依赖。

- 后端启动校验与Node生成器校验使用同一规则：32题、1..32唯一连续、每维8题、符号和常量符合原量表、完整帮助/维度文案、合法版本状态。
- 新增包应整体解析失败而不是只丢一段帮助。当前注册为可用的包损坏时启动失败；未注册草稿不影响v1服务启动。
- contentStatus不能高于包内题面/帮助/报告文案实际证据的最低状态。存在任何draft内容就保持draft；状态更新也需新包ID，不修改已锁定包。
- frontend生成副本按packageId索引；运行时一次只选择一个完整包。
- 为新生成器提供 `--check`：只读比较，不能先写正确内容再宣称无漂移。
- API超时/错误/结构非法时，只能用同packageId的有效内置副本。没有同包时显示不可用，不能悄悄切另一版。
- 维持总超时预算，建议1500ms；迟到响应不能覆盖已开始的会话。无独立问卷请求与帮助请求的跨版本竞争。
- 内容包加载完即可本地完成作答和报告。参考类型文章可使用既有独立加载，不阻断主要报告。

## 6. 会话、恢复和版本迁移

### 6.1 v3会话

```ts
interface LocalAssessmentSessionV3 {
  schemaVersion: 3
  source: 'native_v3' | 'legacy_v2'
  sessionId: string
  packageSnapshot: AssessmentPackage
  packageSignature: string
  responses: ResponseMap
  currentQuestionId: number
  startedAt: number
  updatedAt: number
  submittedAt: number | null
  selfReflection: Partial<Record<Dimension, {
    preference: Pole | null
    updatedAt: number
  }>>
}
```

新键 `typeme.quiz.v3`；复用当前v2恢复设计与存储错误处理。`packageSignature`沿用前端确定性序列化思路并覆盖整个快照，包含帮助和解释政策；不需要联网或额外密码学依赖。它证明本地内容一致性，不提供防篡改认证。

序列化固定对象键顺序、数组顺序、数字类型；记录按字节大小限制，初始沿用128KiB，实际包大小须验证。超限时禁止静默截断题目/解释；提示当前不能保存但仍可内存作答。只有实际超限且有证据时再调整限制。

- submittedAt只表示用户提交，不等于存在完整类型。
- 页面加载时从回答重建Analysis及ReportViewModel，不直接信任缓存的类型或文案。
- 分析结果、图片Blob、Object URL不持久化。自我观察不修改responses。
- 答案/包/解释政策改变即失效报告和所有分享缓存；单纯开帮助不失效。
- sessionId与reportId为内部关联标识，不放分享内容；不以其作为安全凭据。

### 6.2 旧v2

1. 读取并校验旧v2题库快照、签名和数字答案；不能拿新中文题面解释旧作答。
2. 能确认是受支持的OEJTS32数值结构时，可以用其**原题快照**和新版维度解释形成 `source=legacy_v2` 的派生会话；中文revision标历史快照标识，新解释版本明确。
3. 旧题面没有对应的已版本化帮助时，不附上新版候选题的帮助；为每个题号填入明确的通用说明“这份历史题目暂无单独审校的释义，无法理解时可以保留无法判断”，标draft，保持itemHelp完整但不编造专门释义。派生包为本地迁移专用，不能假装存在同名服务端包。
4. 丢弃旧缓存profile对新报告的权威性；不删除原v2键。先在内存完成迁移、验证报告、成功写v3，再把迁移视为成功。
5. 旧问卷结构或签名不能验证时，保留原键，显示版本不兼容；用户可确认开始新测。不得强行补字段/填3迁移。
6. v1没有题库内容身份证据，延用既有保留/确认重测流程，不能自动套用新题库。

本地派生包使用保留标识`legacy-v2-local`；仅`source=legacy_v2`的迁移入口可构造，身份按完整packageSignature比较。这是本地迁移特例，不进入服务端包注册表、不允许API请求或响应使用该标识，也不承诺不同历史快照共享同一个内容版本。

### 6.3 多标签和回滚

- 保留现有storage冲突机制；v3页面还需识别v2旧客户端同源写入。不同格式不互相覆盖，提示存在另一版会话。
- 同一v3会话在别处更新：本页停止自动写回，用户可载入最新记录；不要自动合并每题答案。
- v3清除只清TypeMe应用相关键，保留其他localStorage内容。清除前确认，成功后重建首页状态。
- 回滚应用版本时旧客户端不会认识v3。保留旧v2资料，不把v3降级覆盖v2；回滚说明应明确新unknown状态不能无损写回旧格式。
- 不自动删除旧资源或修改用户`.baseline-backup`。本次无自动部署/回滚命令。

## 7. 页面状态与事件改造

### 7.1 答题事件

| 事件 | 回答变化 | 导航/报告变化 |
|---|---|---|
| selectRating(id,v) | 原子替换为rating | 失效报告，保持本题 |
| selectUnknown(id,reason) | 原子替换为unknown | 失效报告，允许下一题 |
| toggleHelp(id) | 无 | 无分数变化 |
| next/previous | 无 | 当前位置改变并保存 |
| openAnswerSheet | 无 | 已选倾向/待判断/未处理分别标示 |
| submit | 无隐式补答 | 未处理则复查；全处理可生成部分报告 |
| reviseAnswer | 仅所选题变化 | 重新分析，清除旧分享和submittedAt |
| saveSelfReflection | responses不变 | 仅更新独立自我理解区 |

第一页无上一题；所有未处理题都要显式选择rating或unknown才进入最终报告。unknown不能只通过隐藏快捷键出现；手机与键盘均可操作。

### 7.2 复查页/区块

可作为QuizView内的提交检查区，不强制新增路由。显示待判断题号及原题、原因（若有）；支持回去改、保留待判断并查看报告。仍有真正未处理题时，不允许静默生成报告。

“题目看不懂”的入口立即可用，不能弹出“至少完成测试后才能反馈”。反馈默认仅保存在本地当前记录。

### 7.3 结果页

- typed：显示参考组合；其他状态标题以偏好概览为主，类型值为null。
- tentative：可写“本次略偏N，继续观察”，但不把N写成确定类型字母；图标/aria-label一致。
- balanced：显示两端名称，**没有主导侧**；不要生成“两侧接近均衡内向I”这种拼接。
- insufficient：不画数值点、不显示0%、24分；显示需要回看的题号入口。
- 其他三维可以有自己的解释。某维状态变化，只更新对应维度和整体组合是否成立。
- 不再默认展示替代类型列表；解释维度另一侧即可。
- 自我理解记录单独标来源，不替代测评标题，不拿用户自选作为算法验证。

### 7.4 分享与复制

| 状态 | 图片标题 | 类型信息 | 文件名建议 |
|---|---|---|---|
| typed | 我的本次偏好概览 | 本次问卷参考组合INFP | `typeme-profile-INFP.png` |
| partial | 我的偏好，还有待观察的部分 | 各维状态，完整类型不出现 | `typeme-profile-partial.png` |
| undetermined且皆balanced | 本次回答没有显示明确方向 | 四维两侧相近 | `typeme-profile-undetermined.png` |
| undetermined且含insufficient | 这次先保留未定 | 信息不足/待观察维度 | `typeme-profile-undetermined.png` |

复制文字由同ReportViewModel生成。例如：`我在TypeMe的本次回答偏向I、F、P，S/N仍待观察，没有形成完整参考类型。` 不得调用旧shareText兜底。

内容包/回答/解释版本组成reportId依赖；生成时捕获ID，完成时再次检查，已失效则丢弃生成结果。图片解码、空Blob、下载/系统分享取消等现有可靠性要求继续保留。

## 8. 内容审校与本地试用实现

新释义与候选题面可直接按配套审校表建立draft包。已有正式/历史包不覆盖。本轮调整无需额外模型或动态提示词。

本地试用至少能做：选择明确标识的内容版本、完成测试、逐题打开解释、记录无法判断原因、查看未定报告。R1保留现中文题面的内容包可作为对照，R2候选版用于理解性试用。

不建设后台审校系统、不接数据库。审校结果先以仓库文档记录；由开发者在收到真实证据后更新对应版本元数据。需要收集真人记录/外发时另按授权执行，本方案不授权自动上传。

研发记录应注明修订的是题面、帮助还是报告。修改题号归属、增加新题、删题重算或调权重都属于量表版本变更，不能作为普通文案优化处理。

## 9. 工作包与验收证据

| 工作包 | 范围 | 完成判据 |
|---|---|---|
| A 复现与固定基线 | 跑现有领域测试、全中立页面/分享复现、内容check | 已知问题与现有正确行为有独立记录 |
| B 分析与报告模型 | 每维计分、可未定类型、维度copy、统一展示模型 | 数值不变量和新判型测试通过 |
| C 三端报告纠偏 | 页面、图片、复制、文件名、aria-label | 默认类型无泄漏；边界改答只改变相关维度 |
| D 作答与内容包 | help、unknown、复查、v2包与内置降级 | 看不懂能继续；同一包驱动题面与解释 |
| E 恢复兼容 | v3存储、旧v2派生、损坏/冲突/回滚 | 旧记录保护、状态不失真、无填3 |
| F 内容试用与交付 | draft内容、审校清单、手机PC验证 | 可试用产物、截图、测试结果、未验证事项 |

工程可分批实施，但B/C/D/E均属于完整调整，不得只把页面加免责声明就关闭任务。

## 10. 测试矩阵

### 10.1 算术和解释策略

- 当前50个领域测试先保留；旧scoreQuestionnaire数字输出不因新报告政策变化而偷偷改预期。
- 对第3.4节全部向量固定断言；对于新策略typeCode为null的情况，测试页面/分享无旧码而不是仅断言字段为空。
- 用每维原始分8..40逐值扫过33个值：24唯一balanced，20/28为tentative边界，19/29开始leaning，15/33进入marked。
- 一题修改只影响该题所属维度的数值；8题中任何一题unknown都使该维score为null。
- unknown→3：该维重新变为可计分，不等于把unknown一直算3。
- 分数=24但counts不同的两组答卷，状态相同、事实解释不同；不能多出置信度指标。
- 16种类型：使用每维正负极端点组合，确保都可达到、文案方向一致。
- 类型仍在同一侧但从距离5降为4：参考组合必须撤销，不能缓存旧类型。
- 改SN一题：EI/TF/JP对应的报告片段与建议逐项保持一致（反例测试）。

### 10.2 输入、内容、恢复

| ID | 情况 | 预期 |
|---|---|---|
| INPUT-01 | 未选择、3、unknown三种 | 处理数量和评分数量各自正确 |
| INPUT-02 | 非法kind/value、未知题号 | 不计分，损坏可修复，其他回答保留 |
| INPUT-03 | 帮助展开/收起/反复查看 | 分数、答案、完成状态不变 |
| INPUT-04 | 全32题unknown | 正常进入undetermined报告；没有任何分数/类型 |
| INPUT-05 | 只完成31题，未处理1题 | 明确定位，不静默标unknown |
| PKG-01 | requestId与responseId不同 | 拒绝，使用同ID内置包或显示不可用 |
| PKG-02 | 题面/帮助/策略发生变化 | 包ID/签名变化；已有会话不被替换 |
| PKG-03 | 缺帮助、缺维度copy、符号错误 | 构建/启动校验失败，不删除校验绕过 |
| PKG-04 | 无新后端或超时 | 同ID内置包支撑完整主流程 |
| STORE-01 | rating+unknown混合刷新 | 全部状态和当前题恢复 |
| STORE-02 | 老v2全中立记录 | 新解释不展示ISFJ；旧键未删除 |
| STORE-03 | 存储不可用、超限、坏签名 | 可读反馈；不假称恢复/保存成功 |
| STORE-04 | 跨标签页改答或清除 | 冲突被识别，旧页不覆盖 |
| STORE-05 | 自我理解改成N | 原始分与问卷报告不变；仅自我理解区变化 |

### 10.3 页面和分享反例

全中立与部分未定分别断言这些位置：页面标题、类型描述、日常表现、优势、建议、类型阅读入口、图片文本输入、复制文字、下载文件名、图片alt、无障碍名称。任何一处默认ISFJ泄漏均不通过。

不要仅搜索字符串“ISFJ”：用户主动打开独立类型资料时允许出现，范围是“用户测评结论与由它导出的分享”。测试应按对应DOM区域/模型/函数定位。

分享截图目视验证均衡、部分、完整三种。图片Canvas mock只验证调用不能证明实际中文可读；须真实导出至少三张并检查尺寸/解码/裁切。

### 10.4 最小浏览器验收

1. 手机390×844：开始→看Q6帮助→选无法判断→完成剩余题→复查→查看部分报告。
2. PC1440×900：全中立→结果无默认类型→分享无默认类型→回改Q3一档→仍未定。
3. 有完整参考组合的答卷：改SN到距中点4，旧组合与旧图片立即失效；其他三维说明不变。
4. 新会话含unknown时刷新、关闭再打开、跨标签页更新，均保留有效状态。
5. API断开：同版本fallback可完成；网络检查无答案外发。
6. iOS Safari/Android Chrome真机可用时补查帮助展开、长文滚动、触控和保存；不可用就标未测，不冒充模拟器等同真机。

## 11. 命令与产物

以下为后续实施验证命令；当前已有端口在使用，不应为方案工作停止或替换未知进程。

```powershell
# 根目录，只读内容漂移基线
node scripts/gen-fallback-content.mjs --check
node docs/2026-09-15/assessment-evidence/score-probe.cjs

# frontend目录；此直接调用不会触发npm pretest
node node_modules/vitest/vitest.mjs run src/domain/scoring.spec.ts src/domain/clarity.spec.ts src/domain/answers.spec.ts

# 完成改造后执行现有标准链及新增测试；npm前置会生成内容
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# backend目录，前端先构建再验证组合资源
mvn test
mvn package -DskipTests
```

为新增包生成器补充check命令并写进README；命令名称按实际新增脚本，不声称当前已有。测试完成需报告测试数量/失败、包ID、源码与产物版本，不沿用旧verification里的156条断言当本轮结果。

建议产物：当前基线记录、新数据模型/内容契约、真实运行截图、三类导出图片、可理解性试用记录模板。没有明确请求，不生成额外任务看板、代理编排器或部署流水线。

## 12. 给dsh的执行提示词

```text
请在当前TypeMe工程中实施以下三份文件：
docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md
docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md
docs/2026-09-15/TypeMe-32题审校与解释草案.md

用户这次重点是“结果不准、判型不合理、部分题目看不懂”，不是继续换皮。
新方案覆盖旧文档中强制四字母、默认ISFJ、单个typeProfile生成全部报告、
以及不能表达无法判断的旧规则。

先复现assessment-evidence中的全中立页面与分享问题，保护现有工作。
保留原OEJTS数值公式，新增独立解释政策；允许维度未定，完整类型可为空。
加入题目帮助、独立的无法判断状态、提交复查，并形成锁定的版本化内容包。
报告改为维度结果驱动，页面/图片/复制/文件名共用同一展示模型。
处理旧v2快照到新会话的兼容，不能用新题面套旧答案，也不能给unknown填3。

按开发方案推进实现与验证。题目候选都是draft，可以做本地试用；
没有真人审校与研究就不能写已验证、准确率提升或官方认证。
不要增加AI猜类型、随意题目加权、长题库、认知功能八维或后台系统。
不要只添加免责声明后交付。

完成后提供实际命令与结果、手机/PC主流程截图、完整/部分/均衡三类分享图，
以及未验证的设备和内容问题。不得自行提交、推送、公开发布或外发答案。
```

## 13. 本次方案检查和待验证事项

- 本轮已运行：当前领域测试50/50、只读探针7/7；实际浏览器复现全中立默认类型与分享问题，见配套核验记录。
- 本文中v2内容包、v3会话、新解释与报告模型都是拟实施设计，不是已经存在的功能。
- 真实用户可理解性、候选题面等效性、心理测量信效度、真机兼容仍待后续证据。
- 完整工程可以继续开发；需要受试者或公开发布授权的部分独立记录，不能伪造完成，也不必因此停止其余已授权工作。
