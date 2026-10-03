import { isLegalTypeCode, type Dimension, type Pole, type ResultStatus } from './jung/types'
import { asDimension, DIMENSION_SHORT_NAME, orderDimensions } from './jung/labels'
import {
  PROCESS_FUNCTIONS,
  PROCESS_SLOTS,
  PROCESS_TOKENS,
  type ProcessAttitude,
  type ProcessFunction,
  type ProcessSlot,
  type ProcessToken,
} from './jung/dynamics'

/**
 * `report_json` → `ReportViewModelV3`（契约 `03-AI与前端契约-v1.md` §7.3）。
 *
 * ## 这一层的地位：页面、复制文字、图片 headline、alt 的**唯一来源**
 *
 * 「同一个报告在不同出口说法不一致」是这类产品最容易出的丑：页面上写"本次更接近 ENFP"，
 * 复制出来的文字写"你是 ENFP"，图片 alt 又是第三个版本。避免它的办法不是"大家都小心一点"，
 * 而是让四个出口都只读同一份 {@link ReportViewModelV3}：谁想改文案，就只能改这里。
 *
 * ## 三条硬约束（都有单测钉住）
 *
 *   1. `status === 'TIED'` 时 `typeCode === null`，且 `share.headline` / `headline`
 *      **不出现任何四字母**。并列就是并列，不许把候选列表的第一项拿来当主类型。
 *   2. `status === 'TENTATIVE'` 时 headline 必须含「本次更接近」，并且该维的
 *      `details` 里必须有两端描述（一强一弱），不能只给偏向的一侧。
 *   3. `candidate.cost` 的解释里**不许**出现「概率 / 准确率 / 可能性 / 分数高低」这类说法。
 *      `cost` 是"换一个字母需要偏离多少证据"的规则距离，不是"有多像"。
 *
 * ## 缺失字段不猜默认值
 *
 * 契约 §7 明确写着"任何字段缺失都算契约破坏，不允许猜一个默认值"。所以这里对必需字段
 * 一律抛 {@link ReportShapeError}：与其给用户看一段**看起来正常、其实是编的**报告，
 * 不如让页面显示"这份报告读不出来"。
 *
 * 唯一的例外是 `boundaries[]` / `candidates[]` / `tiedDimensions[]` 这三个数组：
 * 契约保证它们存在，但数组**内容**为空是合法状态（REFERENCE 没有边界也没有候选）。
 * 数组本身缺失仍然抛错。
 *
 * ## 过程层（`dynamics` / `processPlan`）：按 `methodology.dynamicsVersion` 判别新旧快照
 *
 * 这两块是新增的：由四字母按框架规则推导出的四个精神活动过程，以及由该结构派生的建议。
 * 契约允许它们在 `status === 'TIED'` 时是 null（没有四字母就不推导）。
 *
 * 判别"这份快照该不该有过程层"用的是 **`methodology.dynamicsVersion`**，不是
 * `computedTypeCode`：前者区分的是「新报告漏发字段（bug，必须大声失败）」与
 * 「旧报告本来就没有这个字段（正常历史数据，照常渲染）」，后者会把两者混成一件事。
 * 没有版本标记的快照，两块一律读成 null、页面不渲染 —— 不知道是哪一版规则推出来的
 * 结构，就不该摆到读者面前。有版本标记时全开严格校验：非 TIED 两块必须都在、
 * `dynamics.typeCode === computedTypeCode`、`processes` 的四个槽位顺序、
 * `decisionSteps` 的 S→N→T→F 顺序 —— 这几条一旦破了，页面会用**另一型**的结构
 * 去解释这一型，而错误又长得完全正常。
 *
 * 唯一与版本无关、任何情况下都抛错的是"只给了一半"（只有 `dynamics` 或只有
 * `processPlan`）：那是真损坏，不是版本差异。
 *
 * ⚠️ 这里**只读服务端**。本地虽然也有一份推导镜像（`./jung/dynamics.ts`），
 * 但它只服务于答题时的预览与测试，**绝不**用来补全或覆盖服务端的 `dynamics` / `processPlan`。
 */

/** 报告形状与契约不符（字段缺失 / 类型不对 / 状态与内容矛盾）。 */
export class ReportShapeError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(message)
    this.name = 'ReportShapeError'
    this.field = field
  }
}

/* ── 视图模型 ───────────────────────────────────────────────────────────── */

export interface DimensionRowV3 {
  dimension: Dimension
  /** 完整维度名（来自 `report_json.dimensions[].name`）。 */
  name: string
  question: string | null
  negativePole: Pole
  negativeLabel: string
  positivePole: Pole
  positiveLabel: string
  /** null = 本次这一维两边接近（平分）。 */
  computedPole: Pole | null
  tiedSide: 'positive' | 'negative' | 'tied'
  /** 0..1；null 表示没有位置点（不可计分）。 */
  position: number | null
  mFinal: number | null
  nFinal: number
  nBase: number
  nClar: number
  boundary: boolean
  coverageOk: boolean
  /** 覆盖不足时的缺口计数，页面据此说明"还差哪一维"。 */
  baseRatingCount: number
  baseUnknownCount: number
  baseUnprocessedCount: number
  clarificationScheduled: boolean
  clarificationSkipped: boolean
  clarificationApplied: boolean
  clarificationRatingCount: number
  /** 该维的中文解释（边界时含另一侧）。 */
  details: string[]
  dailySigns: string[]
  /** 状态文案，例如「本次略偏 E（倾向较轻）」。 */
  statusNote: string
  ariaLabel: string
}

export interface CandidateRowV3 {
  typeCode: string
  /** 换一个字母需要偏离的证据量（规则距离，**不是**概率/准确率/可能性）。 */
  cost: number
  differsOn: Dimension[]
  differsOnNames: string[]
  /** 人话解释；`cost` 写成"需要偏离多少证据"。 */
  costText: string
  differsText: string
  /** 该候选与本次方向一致的那几维，用于"为什么都可能"。 */
  sameDimensions: Dimension[]
  /** 是否是本次方向本身（cost 为 0）。 */
  isComputedDirection: boolean
}

export interface TypeSectionV3 {
  key: string
  title: string
  body: string
}

export interface NextActionV3 {
  title: string
  steps: string[]
}

/**
 * 一个过程（主导 / 辅助 / 第三位 / 第四位）。
 *
 * `preferred` 只有主导与辅助为 true —— 页面上"这一步用不上你偏好的功能"就靠它。
 */
export interface DynamicsProcessV3 {
  slot: ProcessSlot
  /** 1..4，与 `slot` 一一对应。 */
  order: number
  process: ProcessToken
  function: ProcessFunction
  attitude: ProcessAttitude
  /** 中文名，例如「内倾感觉」。 */
  nameCn: string
  /** 位置名，例如「主导过程」「第四位」。 */
  roleTitle: string
  /** 这个过程管的是什么。 */
  what: string
  /** 在你身上它通常长什么样。 */
  reading: string
  preferred: boolean
}

/** 某一维若落到另一侧，结构会怎么变。只在边界（倾向较轻）维度上出现。 */
export interface DynamicsBoundaryNoteV3 {
  dimension: Dimension
  /** 本次落到的这一侧；落在另一侧时结构按 `note` 变。 */
  pole: Pole
  note: string
}

/** 由四字母推导出的过程结构。`status === 'TIED'` 时为 null。 */
export interface DynamicsV3 {
  version: string
  typeCode: string
  /** 为什么是这四个过程（J/P 说的是对外用哪一种过程……）。 */
  rule: string
  /** 说明这一层是按规则推导的，不是本次测出来的另一个结果。 */
  basis: string
  processes: DynamicsProcessV3[]
  boundaryNotes: DynamicsBoundaryNoteV3[]
  notes: {
    /** 框架本身的局限：**必须显示出来**，否则读者会把"推导"当成"测量"。 */
    frameworkCaveat: string
  }
}

/** 发展任务里的一句话活。 */
export interface DevelopmentStageProcessV3 {
  process: ProcessToken
  nameCn: string
  body: string
}

/** 一层发展任务。三层之间的先后有依据，第三层里的两个过程**并列、不分先后**。 */
export interface DevelopmentStageV3 {
  order: number
  title: string
  body: string
  processes: DevelopmentStageProcessV3[]
}

/** 四步决策法的一步。`preferred === false` 的两步正是"用不上你偏好的功能"的那两步。 */
export interface DecisionStepV3 {
  order: number
  function: ProcessFunction
  title: string
  prompt: string
  slot: ProcessSlot
  slotTitle: string
  process: ProcessToken
  preferred: boolean
  how: string
}

/** 互补的一侧（只覆盖 SN / TF 两轴）。 */
export interface OppositeV3 {
  axis: Dimension
  axisName: string
  yourPole: Pole
  needPole: Pole
  need: string
  supply: string
}

/** 按自己那一侧给的沟通规则（EI / SN / TF / JP 各一条）。 */
export interface CommunicationRuleV3 {
  axis: Dimension
  axisName: string
  title: string
  yourPole: Pole
  body: string
}

/** 由过程结构派生的建议。`status === 'TIED'` 时为 null。 */
export interface ProcessPlanV3 {
  version: string
  developmentOrder: DevelopmentStageV3[]
  decisionIntro: string
  /** 固定按 S → N → T → F 排列，共 4 项。 */
  decisionSteps: DecisionStepV3[]
  decisionNote: string
  /** 这几步里用不上偏好功能的那几步的标题。 */
  hardestSteps: string[]
  hardestStepsNote: string
  /** 恰好 2 项（SN、TF）。 */
  opposites: OppositeV3[]
  /** 恰好 4 项（EI / SN / TF / JP）。 */
  communicationRules: CommunicationRuleV3[]
  notes: {
    developmentNote: string
    greyAreaNote: string
  }
}

export interface ShareV3 {
  kind: 'REFERENCE' | 'TENTATIVE' | 'TIED'
  filename: string
  imageTitle: string
  headline: string
  boundaryLine: string | null
  /** 复制用文案。 */
  text: string
  /** 分享图的无障碍名称。 */
  alt: string
}

export interface MethodologyV3 {
  scoringVersion: string
  packageId: string
  reportContentVersion: string
  contentStatus: string
  contentSha256: string
  /**
   * 过程文案包与推导版本。
   *
   * 按"缺失 → null"读，而且 `dynamicsVersion` 不只是展示用：它是"这份快照有没有
   * 过程层"的**权威标记**（服务端给每份新报告都写它，旧快照必然没有）。
   * 判别新旧快照、从而决定"缺字段"该报错还是该照常渲染，用的就是它。
   */
  processCopyVersion: string | null
  processCopySha256: string | null
  dynamicsVersion: string | null
  policyVersion: string
  minBaseRatingsPerDimension: number
  boundaryNumerator: number
  boundaryDenominator: number
  submittedAt: string
}

export interface SelfReflectionView {
  selfSelectedTypeCode: string | null
  note: string | null
  updatedAt: string | null
}

export interface ReportViewModelV3 {
  reportId: string
  attemptId: string
  createdAt: string
  status: Extract<ResultStatus, 'REFERENCE' | 'TENTATIVE' | 'TIED'>
  computedTypeCode: string | null
  /** 只在 status != 'TIED' 时非 null；TIED 时为 null。 */
  typeCode: string | null
  typeTitle: string | null
  typeNameCn: string | null
  /** 用户自选类型（来自 self-reflection，与问卷结果隔离；不覆盖任何问卷字段）。 */
  selfSelectedTypeCode: string | null
  /** 首屏大标题：REFERENCE → 「本次参考类型 ENFP」；TENTATIVE → 「本次更接近 ENFP」；TIED → 「几个类型都值得一起看」。 */
  headline: string
  summary: string
  boundaryNotes: string[]
  tiedDimensions: Dimension[]
  dimensionRows: DimensionRowV3[]
  candidates: CandidateRowV3[]
  candidateCodes: string[]
  tieNotice: string | null
  typeSections: TypeSectionV3[]
  nextActions: NextActionV3[]
  /** 由四字母推导的过程结构；TIED（没有四字母）时为 null。 */
  dynamics: DynamicsV3 | null
  /** 由过程结构派生的建议；TIED（没有四字母）时为 null。 */
  processPlan: ProcessPlanV3 | null
  clarificationDimensions: Dimension[]
  clarificationSkipped: boolean
  share: ShareV3
  methodology: MethodologyV3
  reportHash: string
  /** 自我理解（与问卷结果并列，不覆盖）。 */
  selfReflection: SelfReflectionView
}

/* ── 读取工具 ───────────────────────────────────────────────────────────── */

function fail(field: string, message: string): never {
  throw new ReportShapeError(field, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readObject(source: Record<string, unknown>, field: string, where: string): Record<string, unknown> {
  const value = source[field]
  if (!isRecord(value)) fail(field, `${where}里没有对象字段「${field}」，无法渲染（不猜默认值）。`)
  return value
}

/**
 * 可选对象：**缺失或 null 都算 null**。
 *
 * 只用在 `dynamics` / `processPlan` 上 —— 契约允许它们在 TIED 时是 null，
 * 而"加这两个键之前生成的旧快照"里干脆没有这两个字段，两者是同一个意思。
 */
function readNullableObject(
  source: Record<string, unknown>,
  field: string,
  where: string,
): Record<string, unknown> | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  if (!isRecord(value)) fail(field, `${where}的「${field}」不是对象。`)
  return value
}

function readString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.length === 0) {
    fail(field, `${where}里缺少文本字段「${field}」，无法渲染（不猜默认值）。`)
  }
  return value
}

function readNullableString(source: Record<string, unknown>, field: string, where: string): string | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') fail(field, `${where}的「${field}」不是文本。`)
  return value.length === 0 ? null : value
}

function readNumber(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(field, `${where}里缺少数值字段「${field}」，无法渲染（不猜默认值）。`)
  }
  return value
}

function readNullableNumber(source: Record<string, unknown>, field: string, where: string): number | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(field, `${where}的「${field}」不是数值。`)
  }
  return value
}

function readBoolean(source: Record<string, unknown>, field: string, where: string): boolean {
  const value = source[field]
  if (typeof value !== 'boolean') {
    fail(field, `${where}里缺少布尔字段「${field}」，无法渲染（不猜默认值）。`)
  }
  return value
}

function readArray(source: Record<string, unknown>, field: string, where: string): unknown[] {
  const value = source[field]
  if (!Array.isArray(value)) fail(field, `${where}里缺少数组字段「${field}」。`)
  return value
}

function readStringArray(source: Record<string, unknown>, field: string, where: string): string[] {
  return readArray(source, field, where).map((item) => {
    if (typeof item !== 'string') fail(field, `${where}的「${field}」里有非文本项。`)
    return item
  })
}

const POLES: readonly string[] = ['I', 'E', 'S', 'N', 'T', 'F', 'J', 'P']

function readPole(source: Record<string, unknown>, field: string, where: string): Pole {
  const value = source[field]
  if (typeof value !== 'string' || !POLES.includes(value)) {
    fail(field, `${where}的「${field}」不是合法极点字母。`)
  }
  return value as Pole
}

function readNullablePole(source: Record<string, unknown>, field: string, where: string): Pole | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  return readPole(source, field, where)
}

/* ── 过程层的读取器 ─────────────────────────────────────────────────────── */

const PROCESS_TOKEN_SET = new Set<string>(PROCESS_TOKENS)
const PROCESS_SLOT_SET = new Set<string>(PROCESS_SLOTS)
const PROCESS_FUNCTION_SET = new Set<string>(PROCESS_FUNCTIONS)
const PROCESS_ATTITUDE_SET = new Set<string>(['i', 'e'])

function readProcessToken(
  source: Record<string, unknown>,
  field: string,
  where: string,
): ProcessToken {
  const value = source[field]
  if (typeof value !== 'string' || !PROCESS_TOKEN_SET.has(value)) {
    fail(field, `${where}的「${field}」不是八个过程代号之一（Si/Se/Ni/Ne/Ti/Te/Fi/Fe）。`)
  }
  return value as ProcessToken
}

function readProcessSlot(
  source: Record<string, unknown>,
  field: string,
  where: string,
): ProcessSlot {
  const value = source[field]
  if (typeof value !== 'string' || !PROCESS_SLOT_SET.has(value)) {
    fail(field, `${where}的「${field}」不是四个位置之一（dominant/auxiliary/tertiary/inferior）。`)
  }
  return value as ProcessSlot
}

function readProcessFunction(
  source: Record<string, unknown>,
  field: string,
  where: string,
): ProcessFunction {
  const value = source[field]
  if (typeof value !== 'string' || !PROCESS_FUNCTION_SET.has(value)) {
    fail(field, `${where}的「${field}」不是四个功能族之一（S/N/T/F）。`)
  }
  return value as ProcessFunction
}

function readProcessAttitude(
  source: Record<string, unknown>,
  field: string,
  where: string,
): ProcessAttitude {
  const value = source[field]
  if (typeof value !== 'string' || !PROCESS_ATTITUDE_SET.has(value)) {
    fail(field, `${where}的「${field}」不是方向之一（i = 朝里使用，e = 朝外使用）。`)
  }
  return value as ProcessAttitude
}

/* ── 文案 ───────────────────────────────────────────────────────────────── */

/**
 * 维度状态文案。
 *
 * 这里只描述**本次数据的样子**，不评价"好不好"、不提"准确率/置信度"。
 * 边界与平分必须说清"两侧都值得读"，因为那正是用户最容易误读成"结果很确定"的两处。
 */
function statusNoteOf(row: {
  computedPole: Pole | null
  boundary: boolean
  coverageOk: boolean
  baseRatingCount: number
}): string {
  if (!row.coverageOk) {
    return `这一维的有效作答还不够（可计分 ${row.baseRatingCount} 题），本次不给方向。`
  }
  if (row.computedPole === null) return '本次这一维两边接近，没有哪一侧更占优势。'
  if (row.boundary) return `本次略偏 ${row.computedPole}（倾向较轻），另一侧也值得一起读。`
  return `本次回答偏向 ${row.computedPole}。`
}

/** 候选的 cost 解释：**规则距离**，不是概率、不是准确率、不是"有多像"。 */
function costTextOf(candidate: { typeCode: string; cost: number; differsOn: Dimension[] }): string {
  if (candidate.differsOn.length === 0) {
    return '这就是本次作答直接得到的方向，不需要替换任何一维。'
  }
  const names = candidate.differsOn.map((dimension) => DIMENSION_SHORT_NAME[dimension]).join('、')
  return `要写成 ${candidate.typeCode}，需要在${names}上偏离本次作答共 ${candidate.cost} 分证据；` +
    '这是规则换算法，不是"有多像"，也不代表任何一种更可能。'
}

function differsTextOf(candidate: { differsOn: Dimension[] }): string {
  if (candidate.differsOn.length === 0) return '与本次方向完全一致。'
  const names = candidate.differsOn.map((dimension) => DIMENSION_SHORT_NAME[dimension])
  return `与本次方向不同的一维：${names.join('、')}。`
}

/* ── 过程层解析 ─────────────────────────────────────────────────────────── */

/**
 * 解析 `dynamics`。
 *
 * `typeCode` 必须与报告算出的四字母一致：过程结构是**跟着四字母走**的，
 * 一旦对不上，页面就会用另一型的结构去解释这一型 —— 这比缺字段更危险，
 * 因为输出看起来完全正常。
 */
function parseDynamics(raw: Record<string, unknown>, computedTypeCode: string): DynamicsV3 {
  const where = '过程结构（dynamics）'
  const version = readString(raw, 'version', where)
  const typeCode = readString(raw, 'typeCode', where)
  if (!isLegalTypeCode(typeCode)) {
    fail('dynamics.typeCode', `${where}的类型码「${typeCode}」不合法。`)
  }
  if (typeCode !== computedTypeCode) {
    fail(
      'dynamics.typeCode',
      `${where}的类型码（${typeCode}）与报告算出的类型码（${computedTypeCode}）不一致：` +
        '过程结构是由四字母推导出来的，必须跟着它走。',
    )
  }
  const rule = readString(raw, 'rule', where)
  const basis = readString(raw, 'basis', where)

  const processesRaw = readArray(raw, 'processes', where)
  if (processesRaw.length !== PROCESS_SLOTS.length) {
    fail(
      'dynamics.processes',
      `${where}必须有 ${PROCESS_SLOTS.length} 个过程（主导 / 辅助 / 第三位 / 第四位），` +
        `实际给了 ${processesRaw.length} 个。`,
    )
  }
  const processes: DynamicsProcessV3[] = processesRaw.map((item, index) => {
    const rowWhere = `${where}第 ${index + 1} 个过程`
    if (!isRecord(item)) fail('dynamics.processes', `${rowWhere}不是对象。`)
    const slot = readProcessSlot(item, 'slot', rowWhere)
    const expectedSlot = PROCESS_SLOTS[index]
    if (slot !== expectedSlot) {
      fail(
        'dynamics.processes',
        `${rowWhere}的位置是「${slot}」，但第 ${index + 1} 个位置必须是「${expectedSlot}」：` +
          '四个过程的顺序是固定的，不按字典序、也不按别的顺序。',
      )
    }
    const order = readNumber(item, 'order', rowWhere)
    if (order !== index + 1) {
      fail('dynamics.processes', `${rowWhere}的 order 是 ${order}，第 ${index + 1} 个过程应当是 ${index + 1}。`)
    }
    const preferred = readBoolean(item, 'preferred', rowWhere)
    const expectedPreferred = index <= 1
    if (preferred !== expectedPreferred) {
      fail(
        'dynamics.processes',
        `${rowWhere}的 preferred 是 ${preferred}，但只有主导与辅助是「用起来最省力」的过程；` +
          '这一位对不上时，页面对"哪两步用不上偏好的功能"的标注就会反过来。',
      )
    }
    return {
      slot,
      order,
      process: readProcessToken(item, 'process', rowWhere),
      function: readProcessFunction(item, 'function', rowWhere),
      attitude: readProcessAttitude(item, 'attitude', rowWhere),
      nameCn: readString(item, 'nameCn', rowWhere),
      roleTitle: readString(item, 'roleTitle', rowWhere),
      what: readString(item, 'what', rowWhere),
      reading: readString(item, 'reading', rowWhere),
      preferred,
    }
  })

  const boundaryNotes: DynamicsBoundaryNoteV3[] = readArray(raw, 'boundaryNotes', where).map(
    (item, index) => {
      const noteWhere = `${where}第 ${index + 1} 条换侧说明`
      if (!isRecord(item)) fail('dynamics.boundaryNotes', `${noteWhere}不是对象。`)
      const dimensionValue = readString(item, 'dimension', noteWhere)
      const dimension = asDimension(dimensionValue)
      if (!dimension) fail('dynamics.boundaryNotes', `${noteWhere}的维度名「${dimensionValue}」不认识。`)
      return {
        dimension,
        pole: readPole(item, 'pole', noteWhere),
        note: readString(item, 'note', noteWhere),
      }
    },
  )

  const notesRaw = readObject(raw, 'notes', where)
  return {
    version,
    typeCode,
    rule,
    basis,
    processes,
    boundaryNotes,
    notes: {
      frameworkCaveat: readString(notesRaw, 'frameworkCaveat', `${where}的说明`),
    },
  }
}

/** 解析 `processPlan`（由过程结构派生的建议）。 */
function parseProcessPlan(raw: Record<string, unknown>): ProcessPlanV3 {
  const where = '过程建议（processPlan）'
  const version = readString(raw, 'version', where)

  const developmentOrder: DevelopmentStageV3[] = readArray(raw, 'developmentOrder', where).map(
    (item, index) => {
      const stageWhere = `${where}第 ${index + 1} 层发展任务`
      if (!isRecord(item)) fail('processPlan.developmentOrder', `${stageWhere}不是对象。`)
      const order = readNumber(item, 'order', stageWhere)
      if (order !== index + 1) {
        fail('processPlan.developmentOrder', `${stageWhere}的 order 是 ${order}，应当是 ${index + 1}。`)
      }
      const processes: DevelopmentStageProcessV3[] = readArray(item, 'processes', stageWhere).map(
        (entry, entryIndex) => {
          const entryWhere = `${stageWhere}第 ${entryIndex + 1} 个过程`
          if (!isRecord(entry)) fail('processPlan.developmentOrder', `${entryWhere}不是对象。`)
          return {
            process: readProcessToken(entry, 'process', entryWhere),
            nameCn: readString(entry, 'nameCn', entryWhere),
            body: readString(entry, 'body', entryWhere),
          }
        },
      )
      if (processes.length === 0) {
        fail('processPlan.developmentOrder', `${stageWhere}没有给出任何过程。`)
      }
      return {
        order,
        title: readString(item, 'title', stageWhere),
        body: readString(item, 'body', stageWhere),
        processes,
      }
    },
  )

  const decisionSteps: DecisionStepV3[] = readArray(raw, 'decisionSteps', where).map(
    (item, index) => {
      const stepWhere = `${where}第 ${index + 1} 个决策步`
      if (!isRecord(item)) fail('processPlan.decisionSteps', `${stepWhere}不是对象。`)
      const order = readNumber(item, 'order', stepWhere)
      if (order !== index + 1) {
        fail('processPlan.decisionSteps', `${stepWhere}的 order 是 ${order}，应当是 ${index + 1}。`)
      }
      return {
        order,
        function: readProcessFunction(item, 'function', stepWhere),
        title: readString(item, 'title', stepWhere),
        prompt: readString(item, 'prompt', stepWhere),
        slot: readProcessSlot(item, 'slot', stepWhere),
        slotTitle: readString(item, 'slotTitle', stepWhere),
        process: readProcessToken(item, 'process', stepWhere),
        preferred: readBoolean(item, 'preferred', stepWhere),
        how: readString(item, 'how', stepWhere),
      }
    },
  )
  // 决策步的顺序是**方法的一部分**：感觉 → 直觉 → 思考 → 情感。乱序就等于换了一套方法。
  const stepFunctions = decisionSteps.map((step) => step.function)
  if (stepFunctions.length !== PROCESS_FUNCTIONS.length) {
    fail(
      'processPlan.decisionSteps',
      `${where}必须恰好有 ${PROCESS_FUNCTIONS.length} 个决策步，实际 ${stepFunctions.length} 个。`,
    )
  }
  if (stepFunctions.some((fn, index) => fn !== PROCESS_FUNCTIONS[index])) {
    fail(
      'processPlan.decisionSteps',
      `${where}的决策步必须按 ${PROCESS_FUNCTIONS.join(' → ')} 排列，实际是 ${stepFunctions.join(' → ')}。`,
    )
  }
  if (!decisionSteps.some((step) => !step.preferred)) {
    fail(
      'processPlan.decisionSteps',
      `${where}里没有任何一步标为 preferred: false：四步里必然有用不上偏好功能的那几步，` +
        '全标成"省力"就是在骗读者。',
    )
  }

  const opposites: OppositeV3[] = readArray(raw, 'opposites', where).map((item, index) => {
    const rowWhere = `${where}第 ${index + 1} 条互补`
    if (!isRecord(item)) fail('processPlan.opposites', `${rowWhere}不是对象。`)
    const axisValue = readString(item, 'axis', rowWhere)
    const axis = asDimension(axisValue)
    if (!axis) fail('processPlan.opposites', `${rowWhere}的轴「${axisValue}」不认识。`)
    return {
      axis,
      axisName: readString(item, 'axisName', rowWhere),
      yourPole: readPole(item, 'yourPole', rowWhere),
      needPole: readPole(item, 'needPole', rowWhere),
      need: readString(item, 'need', rowWhere),
      supply: readString(item, 'supply', rowWhere),
    }
  })
  const oppositeAxes = opposites.map((row) => row.axis)
  if (oppositeAxes.length !== 2 || oppositeAxes[0] !== 'SN' || oppositeAxes[1] !== 'TF') {
    fail(
      'processPlan.opposites',
      `${where}的互补只覆盖 SN 与 TF 两轴，且按这个顺序给出；实际是 [${oppositeAxes.join(', ')}]。`,
    )
  }

  const communicationRules: CommunicationRuleV3[] = readArray(raw, 'communicationRules', where).map(
    (item, index) => {
      const rowWhere = `${where}第 ${index + 1} 条沟通规则`
      if (!isRecord(item)) fail('processPlan.communicationRules', `${rowWhere}不是对象。`)
      const axisValue = readString(item, 'axis', rowWhere)
      const axis = asDimension(axisValue)
      if (!axis) fail('processPlan.communicationRules', `${rowWhere}的轴「${axisValue}」不认识。`)
      return {
        axis,
        axisName: readString(item, 'axisName', rowWhere),
        title: readString(item, 'title', rowWhere),
        yourPole: readPole(item, 'yourPole', rowWhere),
        body: readString(item, 'body', rowWhere),
      }
    },
  )
  const ruleAxes = communicationRules.map((row) => row.axis)
  if (
    ruleAxes.length !== 4 ||
    ruleAxes.some((axis, index) => axis !== (['EI', 'SN', 'TF', 'JP'] as Dimension[])[index])
  ) {
    fail(
      'processPlan.communicationRules',
      `${where}的沟通规则应当按 EI / SN / TF / JP 给出四条；实际是 [${ruleAxes.join(', ')}]。`,
    )
  }

  const notesRaw = readObject(raw, 'notes', where)
  return {
    version,
    developmentOrder,
    decisionIntro: readString(raw, 'decisionIntro', where),
    decisionSteps,
    decisionNote: readString(raw, 'decisionNote', where),
    hardestSteps: readStringArray(raw, 'hardestSteps', where),
    hardestStepsNote: readString(raw, 'hardestStepsNote', where),
    opposites,
    communicationRules,
    notes: {
      developmentNote: readString(notesRaw, 'developmentNote', `${where}的说明`),
      greyAreaNote: readString(notesRaw, 'greyAreaNote', `${where}的说明`),
    },
  }
}

/* ── 主入口 ─────────────────────────────────────────────────────────────── */

/**
 * 报告快照的两层结构：**外壳**（`instrument` / `reportKind` / `schemaVersion` /
 * `reportId` / `reportHash`）与**报告体**（外壳里的 `report`）。
 *
 * 为什么要在这里一次说清（2026-09-20 的故障复盘）：
 *
 * - 后端把 `reportHash` 追加在**外壳**上 —— `JungReportBuilder.finalizeWithHash` 跑在
 *   `ReportEnvelope.wrap` 之后，因为哈希必须覆盖"除自己以外的每个字段"，它只能落在外层；
 *   报告体里**天生没有**这个键。
 * - 结论层字段（`status` / `dimensions` / `share` / `methodology` …）在**报告体**那层。
 *
 * 所以两层谁都不能被调用方直接当入口：报告体进解析器会让 `reportHash` 消失，
 * 页面显示「这份报告读不出来」；整份快照进解析器则会连 `status` 都读不到
 * （大五那边正好踩过这个坑：`parseBigFiveReport(detail.report)` 直接报 coverage 缺失）。
 *
 * 因此入口只接受**整份快照**，由这里统一下钻一次；调用方不再自己 `reportBodyOf`。
 * v1 旧快照没有外壳，下钻条件（根节点有没有 `report` 对象）不成立，原样使用 ——
 * 那种形状里根节点既是外壳又是报告体，历史报告照旧可读。
 */
function bodyOfSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const nested = snapshot['report']
  return isRecord(nested) ? nested : snapshot
}

/**
 * 把服务端的 `report_json` 快照转成视图模型。
 *
 * @param raw 整份快照（`GET /reports/{id}` 返回的 `report` 原样，含外壳）——
 *            **不要**先下钻：`reportHash` 在外壳层，下钻后就没了。
 * @param selfReflection 自我理解（可选；与报告隔离，**不会**写回报告任何字段）
 */
export function buildReportView(
  raw: unknown,
  selfReflection?: SelfReflectionView | null,
): ReportViewModelV3 {
  if (!isRecord(raw)) {
    fail('report', '这份报告的响应里没有内容，无法渲染。')
  }
  const report = bodyOfSnapshot(raw)

  const reportId = readString(report, 'reportId', '报告')
  const attemptId = readString(report, 'attemptId', '报告')
  const createdAt = readString(report, 'createdAt', '报告')
  const statusRaw = readString(report, 'status', '报告')
  if (statusRaw !== 'REFERENCE' && statusRaw !== 'TENTATIVE' && statusRaw !== 'TIED') {
    fail(
      'status',
      `这份报告的状态是「${statusRaw}」，不是可渲染的三种状态之一（REFERENCE / TENTATIVE / TIED）。` +
        '覆盖不足时不会生成报告，因此这里不应该出现 NEEDS_REVIEW。',
    )
  }
  const status = statusRaw

  const computedTypeCode = readNullableString(report, 'computedTypeCode', '报告')
  if (computedTypeCode !== null && !isLegalTypeCode(computedTypeCode)) {
    fail('computedTypeCode', `报告里的类型码「${computedTypeCode}」不合法。`)
  }
  if (status === 'TIED' && computedTypeCode !== null) {
    fail('computedTypeCode', '并列（TIED）报告不应带任何类型码。')
  }
  if (status !== 'TIED' && computedTypeCode === null) {
    fail('computedTypeCode', '非并列报告必须带类型码。')
  }

  const shareRaw = readObject(report, 'share', '报告')
  const shareKind = readString(shareRaw, 'kind', '分享信息')
  if (shareKind !== status) {
    fail('share.kind', `分享信息的 kind（${shareKind}）与报告状态（${status}）不一致。`)
  }

  const headline = readString(shareRaw, 'headline', '分享信息')
  // 硬约束：TIED 的标题里不许出现任何四字母；TENTATIVE 必须写"本次更接近"。
  if (status === 'TIED' && /[EI][SN][TF][JP]/.test(headline)) {
    fail('share.headline', '并列报告的标题里出现了四字母类型码。')
  }
  if (status === 'TENTATIVE' && !headline.includes('本次更接近')) {
    fail('share.headline', '倾向较轻（TENTATIVE）报告的标题必须写「本次更接近」。')
  }
  if (status === 'REFERENCE' && !headline.includes('本次参考类型')) {
    fail('share.headline', '参考类型（REFERENCE）报告的标题必须写「本次参考类型」。')
  }

  const dimensionsRaw = readArray(report, 'dimensions', '报告')
  if (dimensionsRaw.length === 0) {
    fail('dimensions', '报告里一维都没有，无法渲染。')
  }

  const dimensionRows: DimensionRowV3[] = dimensionsRaw.map((item, index) => {
    const where = `报告第 ${index + 1} 个维度`
    if (!isRecord(item)) fail('dimensions', `${where}不是对象。`)
    const dimensionValue = readString(item, 'dimension', where)
    const dimension = asDimension(dimensionValue)
    if (!dimension) fail('dimensions', `${where}的维度名「${dimensionValue}」不认识。`)

    const negativePole = readPole(item, 'negativePole', where)
    const positivePole = readPole(item, 'positivePole', where)
    const computedPole = readNullablePole(item, 'computedPole', where)
    const tiedSideRaw = readString(item, 'tiedSide', where)
    if (tiedSideRaw !== 'positive' && tiedSideRaw !== 'negative' && tiedSideRaw !== 'tied') {
      fail('tiedSide', `${where}的 tiedSide「${tiedSideRaw}」不认识。`)
    }
    const nFinal = readNumber(item, 'nFinal', where)
    const boundary = readBoolean(item, 'boundary', where)
    const coverageOk = readBoolean(item, 'coverageOk', where)
    const baseRatingCount = readNumber(item, 'baseRatingCount', where)
    const details = readStringArray(item, 'details', where)
    const mFinal = readNullableNumber(item, 'mFinal', where)
    const position = readNullableNumber(item, 'position', where)
    if (position !== null && (position < 0 || position > 1)) {
      fail('position', `${where}的位置 ${position} 超出了 0..1。`)
    }
    // 平分（computedPole 为 null）必须给出两端描述：否则用户只看到"两边接近"却读不到任何一侧。
    if (computedPole === null && details.length < 2) {
      fail('details', `${where}是平分维度，但没有给出两端的描述。`)
    }
    // 边界维度必须给出"另一侧"的说明，否则"倾向较轻"就只是一句空话。
    if (boundary && computedPole !== null && details.length < 2) {
      fail('details', `${where}被标为边界（倾向较轻），但没有给出另一侧的说明。`)
    }
    if (nFinal !== 0 && mFinal === null) {
      fail('mFinal', `${where}有 ${nFinal} 题可计分，却没有给出归一化偏移。`)
    }

    const row: DimensionRowV3 = {
      dimension,
      name: readString(item, 'name', where),
      question: readNullableString(item, 'question', where),
      negativePole,
      negativeLabel: readString(item, 'negativeLabel', where),
      positivePole,
      positiveLabel: readString(item, 'positiveLabel', where),
      computedPole,
      tiedSide: tiedSideRaw,
      position,
      mFinal,
      nFinal,
      nBase: readNumber(item, 'nBase', where),
      nClar: readNumber(item, 'nClar', where),
      boundary,
      coverageOk,
      baseRatingCount,
      baseUnknownCount: readNumber(item, 'baseUnknownCount', where),
      baseUnprocessedCount: readNumber(item, 'baseUnprocessedCount', where),
      clarificationScheduled: readBoolean(item, 'clarificationScheduled', where),
      clarificationSkipped: readBoolean(item, 'clarificationSkipped', where),
      clarificationApplied: readBoolean(item, 'clarificationApplied', where),
      clarificationRatingCount: readNumber(item, 'clarificationRatingCount', where),
      details,
      dailySigns: readStringArray(item, 'dailySigns', where),
      statusNote: '',
      ariaLabel: '',
    }
    row.statusNote = statusNoteOf(row)
    row.ariaLabel = `${row.name}：${row.negativeLabel} ${negativePole} ↔ ${row.positiveLabel} ${positivePole}，${row.statusNote}`
    return row
  })

  const tiedDimensions = orderDimensions(readStringArray(report, 'tiedDimensions', '报告'))

  const candidatesRaw = readArray(report, 'candidates', '报告')
  const candidates: CandidateRowV3[] = candidatesRaw.map((item, index) => {
    const where = `报告第 ${index + 1} 个候选项`
    if (!isRecord(item)) fail('candidates', `${where}不是对象。`)
    const typeCode = readString(item, 'typeCode', where)
    if (!isLegalTypeCode(typeCode)) fail('candidates', `${where}的类型码「${typeCode}」不合法。`)
    const cost = readNumber(item, 'cost', where)
    const differsOn = orderDimensions(readStringArray(item, 'differsOn', where))
    const row: CandidateRowV3 = {
      typeCode,
      cost,
      differsOn,
      differsOnNames: differsOn.map((dimension) => DIMENSION_SHORT_NAME[dimension]),
      costText: '',
      differsText: '',
      sameDimensions: dimensionRows
        .map((dimensionRow) => dimensionRow.dimension)
        .filter((dimension) => !differsOn.includes(dimension)),
      isComputedDirection: cost === 0 && differsOn.length === 0,
    }
    row.costText = costTextOf(row)
    row.differsText = differsTextOf(row)
    return row
  })

  // 硬约束：TIED 必须给出多个候选，否则"几个类型都值得一起看"就是一句空话。
  if (status === 'TIED' && candidates.length < 2 && tiedDimensions.length === 0) {
    fail('candidates', '并列报告没有候选，也没有平分维度，无法说明为什么都可能。')
  }

  const typeSections: TypeSectionV3[] = readArray(report, 'typeSections', '报告').map((item, index) => {
    const where = `报告第 ${index + 1} 段解读`
    if (!isRecord(item)) fail('typeSections', `${where}不是对象。`)
    return {
      key: readString(item, 'key', where),
      title: readString(item, 'title', where),
      body: readString(item, 'body', where),
    }
  })

  const nextActions: NextActionV3[] = readArray(report, 'nextActions', '报告').map((item, index) => {
    const where = `报告第 ${index + 1} 条行动建议`
    if (!isRecord(item)) fail('nextActions', `${where}不是对象。`)
    return {
      title: readString(item, 'title', where),
      steps: readStringArray(item, 'steps', where),
    }
  })

  /*
   * `methodology` 先读：它的 `dynamicsVersion` 是"这份快照到底有没有过程层"的**权威标记**，
   * 下面判别旧快照 / 新快照就靠它（见那段注释）。
   */
  const methodologyRaw = readObject(report, 'methodology', '报告')
  const methodology: MethodologyV3 = {
    scoringVersion: readString(methodologyRaw, 'scoringVersion', '方法论信息'),
    packageId: readString(methodologyRaw, 'packageId', '方法论信息'),
    reportContentVersion: readString(methodologyRaw, 'reportContentVersion', '方法论信息'),
    contentStatus: readString(methodologyRaw, 'contentStatus', '方法论信息'),
    contentSha256: readString(methodologyRaw, 'contentSha256', '方法论信息'),
    // 三个新键按"缺失 → null"读：报告是快照，加它们之前生成的旧报告本来就没有。
    processCopyVersion: readNullableString(methodologyRaw, 'processCopyVersion', '方法论信息'),
    processCopySha256: readNullableString(methodologyRaw, 'processCopySha256', '方法论信息'),
    dynamicsVersion: readNullableString(methodologyRaw, 'dynamicsVersion', '方法论信息'),
    policyVersion: readString(methodologyRaw, 'policyVersion', '方法论信息'),
    minBaseRatingsPerDimension: readNumber(methodologyRaw, 'minBaseRatingsPerDimension', '方法论信息'),
    boundaryNumerator: readNumber(methodologyRaw, 'boundaryNumerator', '方法论信息'),
    boundaryDenominator: readNumber(methodologyRaw, 'boundaryDenominator', '方法论信息'),
    submittedAt: readString(methodologyRaw, 'submittedAt', '方法论信息'),
  }

  /*
   * 过程层。判别这份快照"有没有过程层"用的是 `methodology.dynamicsVersion`，
   * **不是** `computedTypeCode` —— 这两件事必须分开：
   *
   *   - 「新报告漏发了字段」是 **bug**，必须大声失败，否则页面会安静地少一整块；
   *   - 「旧报告本来就没有这个字段」是**正常的历史数据**，必须照常渲染。
   *
   * 只看 `computedTypeCode` 会把这两件事混成一件：两者都是"有字母但没结构"，
   * 而我们既不能对前者装看不见，也不能对后者报错。`methodology.dynamicsVersion`
   * 恰好是服务端给每份**新**报告都会写、旧快照必然没有的那个标记，所以用它判别：
   *
   *   1. 有 `dynamicsVersion` → 过程层上线之后生成的快照，严格全开：
   *      有字母时两块必须都在（且 typeCode / 槽位顺序 / 决策步顺序全部校验），
   *      没字母（TIED）时两块必须都空。
   *   2. 没有 `dynamicsVersion` → 生成时还没有过程层：两块一律读成 null、页面不渲染这一块。
   *      即使 JSON 里真的塞了 `dynamics`，也不能拿它的 `typeCode` 去对四字母 ——
   *      我们无法知道它是按哪一版规则推的，而"不知道哪一版"时正确做法是不展示，不是猜。
   *
   * 唯一**与版本无关**、任何情况下都要抛错的是"只给了一半"：那是真损坏，
   * 不是版本差异。半份结构比缺一份更危险 —— 页面上会看出"结构有了、建议没了"，
   * 而读者无法知道是服务端没发还是自己没看到。
   */
  const dynamicsRaw = readNullableObject(report, 'dynamics', '报告')
  const processPlanRaw = readNullableObject(report, 'processPlan', '报告')
  if ((dynamicsRaw === null) !== (processPlanRaw === null)) {
    fail(
      'dynamics',
      '这份报告只给了过程结构的一半（' +
        `dynamics ${dynamicsRaw === null ? '缺' : '有'} / processPlan ${processPlanRaw === null ? '缺' : '有'}）：` +
        '两块要么都有、要么都没有。半份结构不是"少显示一块"，而是这份快照本身坏了。',
    )
  }

  let dynamics: DynamicsV3 | null = null
  let processPlan: ProcessPlanV3 | null = null
  if (dynamicsRaw !== null && processPlanRaw !== null) {
    if (methodology.dynamicsVersion === null) {
      // 旧快照：生成时还没有过程层，两块都不读、不渲染，其余字段照常解析。
      // 注意这里刻意不报错、也不"尽力而为"地解析一份来历不明的结构：
      // 没有版本标记就无法知道它是按哪一版规则推出来的。
    } else if (computedTypeCode === null) {
      fail(
        'dynamics',
        '这份报告标了过程层版本（methodology.dynamicsVersion），状态却是并列（TIED）：' +
          '没有四字母就不该带过程结构与派生建议 —— 有字母才推得出来。',
      )
    } else {
      dynamics = parseDynamics(dynamicsRaw, computedTypeCode)
      processPlan = parseProcessPlan(processPlanRaw)
    }
  } else if (methodology.dynamicsVersion !== null && computedTypeCode !== null) {
    // 两块都缺（半份的情况已在上面抛错），但这份快照标明自己有过程层：
    // 这是新报告漏发字段，不是旧快照，必须当场失败。
    fail(
      'dynamics',
      `${computedTypeCode} 这份报告标了过程层版本（methodology.dynamicsVersion），却没给过程结构：` +
        '这是新快照漏发字段（不是旧快照），必须当场失败，页面不能安静地少一整块。',
    )
  }

  const typeTitle = readNullableString(report, 'typeTitle', '报告')
  const typeNameCn = readNullableString(report, 'typeNameCn', '报告')
  if (status !== 'TIED' && typeTitle === null) {
    fail('typeTitle', '非并列报告缺少类型名。')
  }

  return {
    reportId,
    attemptId,
    createdAt,
    status,
    computedTypeCode,
    typeCode: status === 'TIED' ? null : computedTypeCode,
    typeTitle,
    typeNameCn,
    // ⚠️ 报告快照生成时 selfSelectedTypeCode 恒为 null（契约 §6.1：自选独立存储）。
    // 这里**不读**报告里的那个字段当作用户自选，避免把某个时刻的快照当成当前值。
    selfSelectedTypeCode: selfReflection?.selfSelectedTypeCode ?? null,
    headline,
    summary: readString(report, 'summary', '报告'),
    boundaryNotes: readArray(report, 'boundaries', '报告').map((item, index) => {
      const where = `报告第 ${index + 1} 条边界说明`
      if (!isRecord(item)) fail('boundaries', `${where}不是对象。`)
      return readString(item, 'note', where)
    }),
    tiedDimensions,
    dimensionRows,
    candidates,
    candidateCodes: candidates.map((candidate) => candidate.typeCode),
    tieNotice: readNullableString(report, 'tieNotice', '报告'),
    typeSections,
    nextActions,
    dynamics,
    processPlan,
    clarificationDimensions: orderDimensions(
      readStringArray(report, 'clarificationDimensions', '报告'),
    ),
    clarificationSkipped: readBoolean(report, 'clarificationSkipped', '报告'),
    share: {
      kind: status,
      filename: readString(shareRaw, 'filename', '分享信息'),
      imageTitle: readString(shareRaw, 'imageTitle', '分享信息'),
      headline,
      boundaryLine: readNullableString(shareRaw, 'boundaryLine', '分享信息'),
      text: readString(shareRaw, 'text', '分享信息'),
      alt: readString(shareRaw, 'alt', '分享信息'),
    },
    methodology,
    // 指纹在**外壳（快照根）**上：后端 finalizeWithHash 跑在 wrap 之后，哈希要覆盖
    // "除自己以外的每个字段"，所以它必然落在封套那一层；报告体里没有这个键。
    reportHash: readString(raw, 'reportHash', '报告'),
    selfReflection: selfReflection ?? { selfSelectedTypeCode: null, note: null, updatedAt: null },
  }
}

/* ── 页面用的派生工具 ───────────────────────────────────────────────────── */

/** 覆盖不足时"还差哪几维"：先看服务端给的维度列表，再退回维度行自己的覆盖标记。 */
export function insufficientDimensionNames(
  declared: readonly Dimension[],
  rows: readonly DimensionRowV3[],
): { dimension: Dimension; name: string; note: string }[] {
  const source =
    declared.length > 0
      ? declared.map((dimension) => rows.find((row) => row.dimension === dimension)).filter(
          (row): row is DimensionRowV3 => row !== undefined,
        )
      : rows.filter((row) => !row.coverageOk)
  return source.map((row) => ({
    dimension: row.dimension,
    name: row.name,
    note:
      row.baseUnprocessedCount > 0
        ? `还有 ${row.baseUnprocessedCount} 题没有作答（既没有选，也没有标「这题我说不好」）。`
        : `有效作答只有 ${row.baseRatingCount} 题，还不够形成方向。`,
  }))
}
