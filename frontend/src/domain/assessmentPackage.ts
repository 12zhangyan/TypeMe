import type { AnswerFormat, Dimension, Pole, Questionnaire } from './types'
import type { Attribution } from './contentTypes'
import { dimensionOrderOf } from './scoring'
import { answerFormatOf, isValidQuestionnaire } from './questionnaire'

/**
 * v2 内容包 —— `docs/2026-09-15/TypeMe-内容包v2-字段规格.md` 的前端契约与校验。
 *
 * 一个包把「题目 + 逐题帮助 + 维度解释文案 + 报告文案 + 解释政策」整体锁在一起：
 * 页面、图片、复制文字与文件名都只从这一个包取文案，因此不会出现
 * 「题面是新版、帮助是旧版」或「报告政策换了、帮助没换」的混版本问题。
 *
 * 这里的校验与后端 `ContentService.validateAssessmentPackage`、Node 生成器
 * `scripts/gen-fallback-content.mjs` 使用**同一套规则**。三处任何一处放宽，
 * 都会让另一处拦住，不会静默通过。
 */

export const PACKAGE_SCHEMA_VERSION = 2

export const CONTENT_STATUSES = ['draft', 'reviewed', 'field_checked'] as const
export type ContentStatus = (typeof CONTENT_STATUSES)[number]

const STATUS_RANK: Readonly<Record<ContentStatus, number>> = {
  draft: 0,
  reviewed: 1,
  field_checked: 2,
}

export const RISK_CODES = ['L', 'B', 'C'] as const
export type RiskCode = (typeof RISK_CODES)[number]

/**
 * 仪器身份。
 *
 * 从 IPIP 大五接入起，这里不再写死成 OEJTS：一个内容包声明自己是哪一份量表
 * （`id` / `revision` / `scoringVersion`）、作答格式，以及**是否产出类型码**。
 * 具体量表的官方题数、维度、符号与常量由下面的 `INSTRUMENT_PROFILES` 逐题钉死。
 */
export interface AssessmentInstrument {
  id: string
  revision: string
  scoringVersion: string
  /**
   * 作答格式：双极选择（OEJTS）或单句贴切度（IPIP）。
   *
   * 可选：对**已有本地仪器档案**的量表（如 oejts32）可以不写，由档案补齐 ——
   * 这样既不改动已锁定包的一个字节，又不允许没有档案的新仪器省略。
   */
  format?: AnswerFormat
  /** 是否把各维度拼成一个类型码（OEJTS = true；大五 = false，它本来就不是类型量表） */
  hasTypeCode?: boolean
}

/**
 * 解释政策。`typeMinDistance` 是**本产品暂定的保守展示策略**，
 * 不是量表新的计分阈值，也不是经验证的置信界限 —— 字段名刻意避开
 * confidence / accuracy / reliability 这类词。
 */
export interface InterpretationPolicy {
  version: string
  minRatingsPerDimension: number
  typeMinDistance: number
  markedDistance: number
}

export interface ItemHelp {
  explanation: string
  reviewStatus: ContentStatus
  riskCodes: RiskCode[]
}

export interface PoleCopy {
  label: string
  description: string
  observation: string
  action: string
}

export interface BalancedCopy {
  summary: string
  observation: string
}

export interface InsufficientCopy {
  summary: string
  nextStep: string
}

export interface DimensionCopy {
  name: string
  /** 低分端的展示记号（OEJTS: 'I'；IPIP: '低'）。缺省时用仪器档案里的值。 */
  lowPole?: string
  /** 高分端的展示记号（OEJTS: 'E'；IPIP: '高'）。 */
  highPole?: string
  /** 数值低侧（OEJTS 的 I / S / F / J；IPIP 的低分侧）。只是数值侧，不含好坏含义。 */
  negative: PoleCopy
  /** 数值高侧（OEJTS 的 E / N / T / P；IPIP 的高分侧）。 */
  positive: PoleCopy
  balanced: BalancedCopy
  insufficient: InsufficientCopy
}

export interface ReportCopy {
  typedTitle: string
  typedSubtitle: string
  partialTitle: string
  partialSubtitle: string
  undeterminedTitle: string
  undeterminedSubtitle: string
  insufficientTitle: string
  insufficientSubtitle: string
  typeReadingLead: string
  scoreMethodNote: string
  dimensionReviewLead: string
  selfReflectionLead: string
}

export interface AssessmentPackage {
  schemaVersion: 2
  packageId: string
  locale: 'zh-CN'
  localeRevision: string
  helpRevision: string
  copyRevision: string
  contentStatus: ContentStatus
  instrument: AssessmentInstrument
  interpretation: InterpretationPolicy
  title: string
  estimatedMinutes: number
  /** 维度展示顺序（不含则用仪器档案，再退化为题目首次出现顺序）。 */
  dimensionOrder?: string[]
  questionnaire: Questionnaire
  itemHelp: Record<string, ItemHelp>
  dimensionCopy: Record<Dimension, DimensionCopy>
  reportCopy: ReportCopy
  nextSteps: string[]
  attribution: Attribution
}

export const REPORT_COPY_FIELDS: readonly (keyof ReportCopy)[] = [
  'typedTitle',
  'typedSubtitle',
  'partialTitle',
  'partialSubtitle',
  'undeterminedTitle',
  'undeterminedSubtitle',
  'insufficientTitle',
  'insufficientSubtitle',
  'typeReadingLead',
  'scoreMethodNote',
  'dimensionReviewLead',
  'selfReflectionLead',
]

/** 帮助文字里**不得出现**的开发者批注（审校表里的编辑备注，不是用户可见文本）。 */
export const FORBIDDEN_HELP_FRAGMENTS: readonly string[] = [
  '该解释的场景范围须与最终题面一致',
  '若采用',
]

/**
 * 官方 OEJTS 1.2 四条公式展开后的题号 → 符号。
 *
 * 与后端 `ContentService.OFFICIAL_SIGNS` 逐字一致。这里再钉一份是为了让
 * **内置降级副本**也能被独立校验：接口不可用时用的是本地内容，
 * 如果本地那份符号被改反，用户会看到「跑得通但全错」的结果。
 */
export const OFFICIAL_SIGNS: Readonly<Record<Dimension, Readonly<Record<number, 1 | -1>>>> = {
  EI: { 3: -1, 7: -1, 11: -1, 15: 1, 19: -1, 23: 1, 27: 1, 31: -1 },
  SN: { 4: 1, 8: 1, 12: 1, 16: 1, 20: 1, 24: -1, 28: -1, 32: 1 },
  TF: { 2: -1, 6: 1, 10: 1, 14: -1, 18: -1, 22: 1, 26: -1, 30: -1 },
  JP: { 1: 1, 5: 1, 9: -1, 13: 1, 17: -1, 21: 1, 25: -1, 29: 1 },
}

export const OFFICIAL_CONSTANTS: Readonly<Record<Dimension, number>> = {
  EI: 30,
  SN: 12,
  TF: 30,
  JP: 18,
}

export const OFFICIAL_MIDPOINT = 24

/**
 * 仪器档案：**每份量表的官方事实**。
 *
 * 存在的意义：内容包自己声明"我是哪份量表"，而这里的档案用**独立抄录**的官方数据
 * （题号 → 符号、常量、中点、维度）去核对它。符号被改反、题目被对调、常量被改，
 * 都会在这里被判红，而不是等到用户拿到"跑得通但全错"的结果。
 *
 * 新量表接入时必须在这里加一条；没有档案的 instrument.id 只做通用自洽校验。
 */
export interface InstrumentProfile {
  id: string
  /** 官方核心结构里的 questionnaire.version（仅作核对，不用于识别整套内容） */
  questionnaireVersion: string
  format: AnswerFormat
  hasTypeCode: boolean
  questionCount: number
  dimensionOrder: readonly string[]
  perDimension: number
  midpoint: number
  constants: Readonly<Record<string, number>>
  /** 题号 → 符号（缺失表示该仪器不在本地逐题钉死） */
  signs?: Readonly<Record<string, Readonly<Record<number, 1 | -1>>>>
  /** 低/高两端的展示记号 */
  poles: Readonly<Record<string, { low: string; high: string }>>
  /** attribution 是否必须与 `content/method.yml` 逐字相等（OEJTS 的 CC BY 署名义务） */
  attributionMustMatchMethod: boolean
}

export const INSTRUMENT_PROFILES: Readonly<Record<string, InstrumentProfile>> = {
  oejts32: {
    id: 'oejts32',
    questionnaireVersion: 'quick',
    format: 'bipolar',
    hasTypeCode: true,
    questionCount: 32,
    dimensionOrder: ['EI', 'SN', 'TF', 'JP'],
    perDimension: 8,
    midpoint: OFFICIAL_MIDPOINT,
    constants: OFFICIAL_CONSTANTS,
    signs: OFFICIAL_SIGNS,
    poles: {
      EI: { low: 'I', high: 'E' },
      SN: { low: 'S', high: 'N' },
      TF: { low: 'F', high: 'T' },
      JP: { low: 'J', high: 'P' },
    },
    attributionMustMatchMethod: true,
  },
  /**
   * IPIP-50 = Goldberg 的 Big-Five Factor Markers（10 题/因素）。
   *
   * 符号表来自官方计分键 <https://ipip.ori.org/newBigFive5broadKey.htm>：
   * E 5正5反、A 6正4反、C 6正4反、ES(情绪稳定性) 2正8反、O(开放性/智识) 7正3反。
   * 常量按"每题都选 3 时正好落在中点 30"推出（与 OEJTS 同一条配平关系）：
   *   c = 30 − 3·Σdirection → E 30 / A 24 / C 24 / ES 48 / O 18
   * 于是每维区间自动是 10–50（min = 中点 − 2×题数，max = 中点 + 2×题数）。
   *
   * IPIP 是公有领域（可商用、无需授权），因此 attribution 不必等于 method.yml。
   */
  ipip50: {
    id: 'ipip50',
    questionnaireVersion: 'ipip50',
    format: 'agreement',
    hasTypeCode: false,
    questionCount: 50,
    dimensionOrder: ['E', 'A', 'C', 'ES', 'O'],
    perDimension: 10,
    midpoint: 30,
    constants: { E: 30, A: 24, C: 24, ES: 48, O: 18 },
    signs: {
      E: { 1: 1, 6: -1, 11: 1, 16: -1, 21: 1, 26: -1, 31: 1, 36: -1, 41: 1, 46: -1 },
      A: { 2: -1, 7: 1, 12: -1, 17: 1, 22: -1, 27: 1, 32: -1, 37: 1, 42: 1, 47: 1 },
      C: { 3: 1, 8: -1, 13: 1, 18: -1, 23: 1, 28: -1, 33: 1, 38: -1, 43: 1, 48: 1 },
      ES: { 4: -1, 9: 1, 14: -1, 19: 1, 24: -1, 29: -1, 34: -1, 39: -1, 44: -1, 49: -1 },
      O: { 5: 1, 10: -1, 15: 1, 20: -1, 25: 1, 30: -1, 35: 1, 40: 1, 45: 1, 50: 1 },
    },
    poles: {
      E: { low: '低', high: '高' },
      A: { low: '低', high: '高' },
      C: { low: '低', high: '高' },
      ES: { low: '低', high: '高' },
      O: { low: '低', high: '高' },
    },
    attributionMustMatchMethod: false,
  },
}

export function instrumentProfileOf(pkg: AssessmentPackage): InstrumentProfile | undefined {
  return INSTRUMENT_PROFILES[pkg.instrument?.id ?? '']
}/** 内容包的维度展示顺序：包声明 → 仪器档案 → 题目首次出现顺序。 */
export function packageDimensionOrder(pkg: AssessmentPackage): Dimension[] {
  if (Array.isArray(pkg.dimensionOrder) && pkg.dimensionOrder.length > 0) return [...pkg.dimensionOrder]
  const profile = instrumentProfileOf(pkg)
  if (profile) return [...profile.dimensionOrder]
  return dimensionOrderOf(pkg.questionnaire)
}

/** 某一维两端在界面/图片上显示的记号（内容包可覆盖仪器档案）。 */
export function poleTokensOf(
  pkg: AssessmentPackage,
  dimension: Dimension,
): { low: string; high: string } {
  const copy = pkg.dimensionCopy?.[dimension]
  const profilePoles = instrumentProfileOf(pkg)?.poles[dimension]
  return {
    low: copy?.lowPole ?? profilePoles?.low ?? '−',
    high: copy?.highPole ?? profilePoles?.high ?? '+',
  }
}

/** 五档作答的显示文案：内容包声明 → OEJTS 默认文案。 */
export function responseAnchorsOf(pkg: AssessmentPackage): string[] | null {
  const anchors = pkg.questionnaire?.responseAnchors
  if (Array.isArray(anchors) && anchors.length === 5) return [...anchors]
  return null
}

/** 内容包的作答格式：仪器声明 → 档案 → 题库字段（缺省 = 双极）。 */
export function packageFormat(pkg: AssessmentPackage): AnswerFormat {
  const declared = pkg.instrument?.format ?? instrumentProfileOf(pkg)?.format
  if (declared === 'agreement' || declared === 'bipolar') return declared
  return pkg.questionnaire?.format === 'agreement' ? 'agreement' : 'bipolar'
}

/** 该量表是否产出类型码：仪器声明 → 档案 → false。 */
export function instrumentHasTypeCode(pkg: AssessmentPackage): boolean {
  return pkg.instrument?.hasTypeCode ?? instrumentProfileOf(pkg)?.hasTypeCode ?? false
}

export const EXPECTED_INSTRUMENT: AssessmentInstrument = {
  id: 'oejts32',
  revision: '1.2',
  scoringVersion: 'oejts-1.2',
  format: 'bipolar',
  hasTypeCode: true,
}

export class PackageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackageValidationError'
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isContentStatus(value: unknown): value is ContentStatus {
  return typeof value === 'string' && (CONTENT_STATUSES as readonly string[]).includes(value)
}

function isValidRiskCode(value: unknown): value is RiskCode {
  return typeof value === 'string' && (RISK_CODES as readonly string[]).includes(value)
}

function isValidPoleCopy(value: unknown): value is PoleCopy {
  if (typeof value !== 'object' || value === null) return false
  const copy = value as Partial<PoleCopy>
  return (
    isNonEmptyString(copy.label) &&
    isNonEmptyString(copy.description) &&
    isNonEmptyString(copy.observation) &&
    isNonEmptyString(copy.action)
  )
}

function isValidDimensionCopy(value: unknown): value is DimensionCopy {
  if (typeof value !== 'object' || value === null) return false
  const copy = value as Partial<DimensionCopy>
  const balanced = copy.balanced as Partial<BalancedCopy> | undefined
  const insufficient = copy.insufficient as Partial<InsufficientCopy> | undefined
  return (
    isNonEmptyString(copy.name) &&
    isValidPoleCopy(copy.negative) &&
    isValidPoleCopy(copy.positive) &&
    typeof balanced === 'object' &&
    balanced !== null &&
    isNonEmptyString(balanced.summary) &&
    isNonEmptyString(balanced.observation) &&
    typeof insufficient === 'object' &&
    insufficient !== null &&
    isNonEmptyString(insufficient.summary) &&
    isNonEmptyString(insufficient.nextStep)
  )
}

export function isValidAttribution(value: unknown): value is Attribution {
  if (typeof value !== 'object' || value === null) return false
  const attribution = value as Partial<Attribution>
  return (
    isNonEmptyString(attribution.source) &&
    isNonEmptyString(attribution.author) &&
    isNonEmptyString(attribution.url) &&
    isNonEmptyString(attribution.license) &&
    isNonEmptyString(attribution.licenseUrl)
  )
}

/**
 * 完整包校验。返回不符合原因数组（空数组表示通过）。
 *
 * 与后端硬断言同一套规则；`origin` 用于把「文件名必须等于 packageId」也说清楚
 * （前端没有文件名概念，调用方传 packageId 即可）。
 */
export function assessmentPackageProblems(value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) return ['内容包不是一个对象']
  const pkg = value as Partial<AssessmentPackage>

  if (pkg.schemaVersion !== PACKAGE_SCHEMA_VERSION) {
    problems.push(`schemaVersion 必须是 ${PACKAGE_SCHEMA_VERSION}，实际 ${String(pkg.schemaVersion)}`)
  }
  if (!isNonEmptyString(pkg.packageId)) problems.push('packageId 不能为空')
  if (pkg.locale !== 'zh-CN') problems.push(`locale 必须是 zh-CN，实际 ${String(pkg.locale)}`)
  for (const field of ['localeRevision', 'helpRevision', 'copyRevision'] as const) {
    if (!isNonEmptyString(pkg[field])) problems.push(`${field} 不能为空`)
  }
  if (!isNonEmptyString(pkg.title)) problems.push('title 不能为空')
  if (
    typeof pkg.estimatedMinutes !== 'number' ||
    !Number.isInteger(pkg.estimatedMinutes) ||
    pkg.estimatedMinutes < 1 ||
    pkg.estimatedMinutes > 60
  ) {
    problems.push(`estimatedMinutes 必须是 1–60 的整数，实际 ${String(pkg.estimatedMinutes)}`)
  }

  // 仪器身份：声明自己是哪份量表（不再写死 OEJTS）
  const instrument = pkg.instrument as Partial<AssessmentInstrument> | undefined
  const instrumentKeys = ['id', 'revision', 'scoringVersion'] as const
  if (
    typeof instrument !== 'object' ||
    instrument === null ||
    !instrumentKeys.every((key) => isNonEmptyString(instrument[key]))
  ) {
    problems.push('instrument 必须声明 id / revision / scoringVersion')
  }
  const profile =
    typeof instrument?.id === 'string' ? INSTRUMENT_PROFILES[instrument.id] : undefined
  // 声明值优先；未声明时由本地仪器档案补齐（已有 OEJTS 包因此不需要改一个字节）
  const effectiveFormat = instrument?.format ?? profile?.format
  const effectiveTypeCode = instrument?.hasTypeCode ?? profile?.hasTypeCode
  if (effectiveFormat !== 'bipolar' && effectiveFormat !== 'agreement') {
    problems.push(
      `instrument.format 必须是 bipolar 或 agreement（该仪器必须有本地档案或显式声明），实际 ${String(instrument?.format)}`,
    )
  }
  if (typeof effectiveTypeCode !== 'boolean') {
    problems.push('instrument.hasTypeCode 必须是布尔值（大五这类非类型量表必须为 false）')
  }
  // `null` 与「没这个字段」等价：Jackson 默认会把缺省字段序列化成显式 null，
  // 而 JSON 里没有 `undefined`。这里只把**真的写了值**的声明拿去和档案比对，
  // 否则 OEJTS 包（不含 format/hasTypeCode）会一路被判成"与档案不一致"。
  if (profile && instrument?.format != null && profile.format !== instrument.format) {
    problems.push(`instrument.format 与档案不一致：${profile.id} 应为 ${profile.format}`)
  }
  if (profile && instrument?.hasTypeCode != null && profile.hasTypeCode !== instrument.hasTypeCode) {
    problems.push(`instrument.hasTypeCode 与档案不一致：${profile.id} 应为 ${String(profile.hasTypeCode)}`)
  }
  if (profile && pkg.questionnaire?.version !== profile.questionnaireVersion) {
    problems.push(
      `questionnaire.version 必须是 ${profile.questionnaireVersion}，实际 ${String(pkg.questionnaire?.version)}`,
    )
  }

  // 解释政策：数字必须显式写在包里，前端的判型逻辑只读它
  const policy = pkg.interpretation as Partial<InterpretationPolicy> | undefined
  if (typeof policy !== 'object' || policy === null) {
    problems.push('缺少 interpretation 解释政策')
  } else {
    if (!isNonEmptyString(policy.version)) problems.push('interpretation.version 不能为空')
    for (const field of ['minRatingsPerDimension', 'typeMinDistance', 'markedDistance'] as const) {
      const value = policy[field]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        problems.push(`interpretation.${field} 必须是 >= 1 的整数，实际 ${String(value)}`)
      }
    }
    if (
      typeof policy.typeMinDistance === 'number' &&
      typeof policy.markedDistance === 'number' &&
      policy.markedDistance <= policy.typeMinDistance
    ) {
      problems.push(
        `interpretation.markedDistance 必须大于 typeMinDistance（实际 ${policy.markedDistance} vs ${policy.typeMinDistance}）`,
      )
    }
  }

  // 题目：复用题库结构契约，再按「通用不变量 + 仪器档案」核对
  if (!isValidQuestionnaire(pkg.questionnaire)) {
    problems.push('questionnaire 不是合法的题库结构')
  } else {
    const questionnaire = pkg.questionnaire
    const format = answerFormatOf(questionnaire)

    // 作答格式必须与仪器声明一致
    const declaredFormat = instrument?.format ?? profile?.format
    if (declaredFormat !== undefined && declaredFormat !== format) {
      problems.push(
        `questionnaire.format（${format}）与 instrument.format（${declaredFormat}）不一致`,
      )
    }

    // 仪器档案：题数 / 维度集合 / 顺序
    if (profile) {
      if (questionnaire.questions.length !== profile.questionCount) {
        problems.push(
          `questionnaire 必须恰好 ${profile.questionCount} 题，实际 ${questionnaire.questions.length}`,
        )
      }
      const declaredOrder = pkg.dimensionOrder?.length ? pkg.dimensionOrder : profile.dimensionOrder
      const actualDimensions = new Set(questionnaire.questions.map((question) => question.dimension))
      const expectedDimensions = [...declaredOrder]
      const missing = expectedDimensions.filter((dimension) => !actualDimensions.has(dimension))
      const extra = [...actualDimensions].filter((dimension) => !expectedDimensions.includes(dimension))
      if (missing.length > 0) {
        problems.push(`questionnaire 缺少维度 ${missing.join('/')} 的题目`)
      }
      if (extra.length > 0) {
        problems.push(`questionnaire 出现了档案之外的维度 ${extra.join('/')}`)
      }
      if (questionnaire.dimensionOrder && questionnaire.dimensionOrder.join(',') !== expectedDimensions.join(',')) {
        problems.push(
          `questionnaire.dimensionOrder 必须与档案一致（${expectedDimensions.join('/')}），实际 ${questionnaire.dimensionOrder.join('/')}`,
        )
      }
    }

    // 通用不变量（与具体量表无关）：
    //   ① 每维题数一致，且等于解释政策声明的最低作答数；
    //   ② 每题都选 3（中立/谈不上贴切）时，该维原始分正好落在中点上。
    //      这条配平关系保证「中点」确实代表"没有方向"，而不是某个被拍出来的数字。
    const counts: Record<string, number> = {}
    const sumDirection: Record<string, number> = {}
    for (const question of questionnaire.questions) {
      counts[question.dimension] = (counts[question.dimension] ?? 0) + 1
      sumDirection[question.dimension] = (sumDirection[question.dimension] ?? 0) + question.direction
    }
    for (const [dimension, count] of Object.entries(counts)) {
      if (typeof policy?.minRatingsPerDimension === 'number' && count !== policy.minRatingsPerDimension) {
        problems.push(
          `${dimension} 必须有 ${policy.minRatingsPerDimension} 题，实际 ${count}`,
        )
      }
      const constant = questionnaire.scoring.constants[dimension]
      if (typeof constant === 'number' && Number.isFinite(constant)) {
        const neutralScore = constant + 3 * (sumDirection[dimension] ?? 0)
        if (neutralScore !== questionnaire.scoring.midpoint) {
          problems.push(
            `${dimension} 的常量没有配平：每题都选 3 时得到 ${neutralScore}，不等于中点 ${questionnaire.scoring.midpoint}`,
          )
        }
      }
    }

    // 仪器档案：常量 / 中点 / 逐题符号
    if (profile) {
      if (questionnaire.scoring.midpoint !== profile.midpoint) {
        problems.push(
          `scoring.midpoint 必须是 ${profile.midpoint}，实际 ${questionnaire.scoring.midpoint}`,
        )
      }
      for (const dimension of profile.dimensionOrder) {
        const constant = questionnaire.scoring.constants[dimension]
        if (constant !== profile.constants[dimension]) {
          problems.push(
            `${dimension} 的计分常量必须与官方一致 ${profile.constants[dimension]}，实际 ${String(constant)}`,
          )
        }
        const expected = profile.signs?.[dimension]
        if (!expected) continue
        const actual: Record<number, 1 | -1> = {}
        for (const question of questionnaire.questions) {
          if (question.dimension === dimension) actual[question.id] = question.direction
        }
        const actualKeys = Object.keys(actual).sort((a, b) => Number(a) - Number(b))
        const expectedKeys = Object.keys(expected).sort((a, b) => Number(a) - Number(b))
        if (actualKeys.join(',') !== expectedKeys.join(',')) {
          problems.push(`${dimension} 的题号集合与官方不一致：${actualKeys.join(',')}`)
        } else {
          for (const key of expectedKeys) {
            if (actual[Number(key)] !== expected[Number(key)]) {
              problems.push(`Q${key} 在 ${dimension} 的符号应为 ${expected[Number(key)]}`)
            }
          }
        }
      }
    } else {
      problems.push(
        `instrument.id=${String(instrument?.id)} 没有本地仪器档案：符号/常量/维度无法被独立核对，拒绝装载`,
      )
    }
  }

  // 逐题帮助：键必须与题库的题号集合**完全一致**
  const itemHelp = pkg.itemHelp
  const questionIds = Array.isArray(pkg.questionnaire?.questions)
    ? pkg.questionnaire!.questions.map((question) => String(question.id))
    : []
  if (typeof itemHelp !== 'object' || itemHelp === null) {
    problems.push('缺少 itemHelp 逐题帮助')
  } else {
    const keys = Object.keys(itemHelp).sort((a, b) => Number(a) - Number(b))
    const expectedKeys = [...questionIds].sort((a, b) => Number(a) - Number(b))
    if (expectedKeys.length === 0 || keys.join(',') !== expectedKeys.join(',')) {
      problems.push(
        `itemHelp 的键必须恰好覆盖题库的全部题号（${expectedKeys[0] ?? '?'}..${expectedKeys[expectedKeys.length - 1] ?? '?'}），实际 ${keys.length} 条`,
      )
    }
    for (const key of keys) {
      const entry = itemHelp[key] as Partial<ItemHelp> | undefined
      if (typeof entry !== 'object' || entry === null) {
        problems.push(`itemHelp["${key}"] 不是一个对象`)
        continue
      }
      if (!isNonEmptyString(entry.explanation)) {
        problems.push(`itemHelp["${key}"].explanation 不能为空`)
      } else {
        for (const fragment of FORBIDDEN_HELP_FRAGMENTS) {
          if (entry.explanation.includes(fragment)) {
            problems.push(`itemHelp["${key}"].explanation 含开发者批注「${fragment}」`)
          }
        }
      }
      if (!isContentStatus(entry.reviewStatus)) {
        problems.push(`itemHelp["${key}"].reviewStatus 不合法：${String(entry.reviewStatus)}`)
      }
      if (!Array.isArray(entry.riskCodes) || !entry.riskCodes.every(isValidRiskCode)) {
        problems.push(`itemHelp["${key}"].riskCodes 只能包含 L / B / C`)
      }
    }
  }

  // contentStatus 不得高于包内实际证据的最低状态
  const statuses: unknown[] = []
  if (typeof itemHelp === 'object' && itemHelp !== null) {
    for (const entry of Object.values(itemHelp as Record<string, ItemHelp>)) {
      statuses.push((entry as Partial<ItemHelp> | undefined)?.reviewStatus)
    }
  }
  if (isContentStatus(pkg.contentStatus)) {
    const evidence = statuses.filter(isContentStatus)
    if (evidence.length > 0) {
      const lowest = evidence.reduce((min, status) =>
        STATUS_RANK[status] < STATUS_RANK[min] ? status : min,
      )
      if (STATUS_RANK[pkg.contentStatus] > STATUS_RANK[lowest]) {
        problems.push(
          `contentStatus=${pkg.contentStatus} 高于包内最低证据状态 ${lowest}（含 draft 内容就必须保持 draft）`,
        )
      }
    }
  } else {
    problems.push(`contentStatus 不合法：${String(pkg.contentStatus)}`)
  }

  // 维度解释文案：键必须与题库的维度集合一致
  const dimensionCopy = pkg.dimensionCopy
  if (typeof dimensionCopy !== 'object' || dimensionCopy === null) {
    problems.push('缺少 dimensionCopy 维度解释文案')
  } else {
    const declaredDimensions = Array.isArray(pkg.questionnaire?.questions)
      ? [...new Set(pkg.questionnaire!.questions.map((question) => question.dimension))]
      : []
    const keys = Object.keys(dimensionCopy).sort()
    const expectedKeys = [...declaredDimensions].sort()
    if (expectedKeys.length === 0 || keys.join(',') !== expectedKeys.join(',')) {
      problems.push(
        `dimensionCopy 的键必须恰好是 ${expectedKeys.join('/') || '（题库未声明维度）'}，实际 ${keys.join('/') || '（空）'}`,
      )
    }
    for (const dimension of expectedKeys) {
      const copy = (dimensionCopy as Record<string, unknown>)[dimension]
      if (!isValidDimensionCopy(copy)) {
        problems.push(`dimensionCopy.${dimension} 缺少必填文案（name/negative/positive/balanced/insufficient）`)
      }
    }
  }

  // 报告文案：规格 §6 的字段一个都不能少，且不能为空
  const reportCopy = pkg.reportCopy as Partial<ReportCopy> | undefined
  if (typeof reportCopy !== 'object' || reportCopy === null) {
    problems.push('缺少 reportCopy 报告文案')
  } else {
    for (const field of REPORT_COPY_FIELDS) {
      if (!isNonEmptyString(reportCopy[field])) problems.push(`reportCopy.${field} 不能为空`)
    }
  }

  if (!Array.isArray(pkg.nextSteps) || pkg.nextSteps.length < 3 || !pkg.nextSteps.every(isNonEmptyString)) {
    problems.push('nextSteps 至少要有 3 条非空建议')
  }

  if (!isValidAttribution(pkg.attribution)) {
    problems.push('attribution 缺少署名/许可字段（CC BY 的署名义务）')
  }

  return problems
}

export function isValidAssessmentPackage(value: unknown): value is AssessmentPackage {
  return assessmentPackageProblems(value).length === 0
}

/** 断言式校验：适合在装载边界使用，失败时抛出可读原因。 */
export function assertAssessmentPackage(value: unknown, label = '内容包'): AssessmentPackage {
  const problems = assessmentPackageProblems(value)
  if (problems.length > 0) {
    throw new PackageValidationError(`${label}校验失败：${problems.join('；')}`)
  }
  return value as AssessmentPackage
}

/**
 * 包签名 —— 固定顺序字段的规范化 JSON。
 *
 * 用于**内容一致性比较**（会话恢复、分享产物失效判断），不是安全认证：
 * 不联网、不依赖加密能力。它覆盖整个快照，包含帮助与解释政策，
 * 因此「只有帮助被改过」也会让签名变化。
 */
export function assessmentPackageSignature(pkg: AssessmentPackage): string {
  const questions = [...pkg.questionnaire.questions]
    .sort((a, b) => a.id - b.id)
    .map((question) => [
      question.id,
      // 两种格式的文本都要覆盖：改题面必须让签名变化
      question.text ?? null,
      question.textLeft ?? null,
      question.textRight ?? null,
      question.dimension,
      question.direction,
    ])
  const itemHelp = Object.keys(pkg.itemHelp)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => {
      const entry = pkg.itemHelp[key]
      return [key, entry.explanation, entry.reviewStatus, [...entry.riskCodes].sort()]
    })
  const order = packageDimensionOrder(pkg)
  const dimensionCopy = order.map((dimension) => {
    const copy = pkg.dimensionCopy[dimension]
    return [
      dimension,
      copy.name,
      copy.lowPole ?? null,
      copy.highPole ?? null,
      [copy.negative.label, copy.negative.description, copy.negative.observation, copy.negative.action],
      [copy.positive.label, copy.positive.description, copy.positive.observation, copy.positive.action],
      [copy.balanced.summary, copy.balanced.observation],
      [copy.insufficient.summary, copy.insufficient.nextStep],
    ]
  })
  const reportCopy = REPORT_COPY_FIELDS.map((field) => [field, pkg.reportCopy[field]])

  return JSON.stringify([
    pkg.schemaVersion,
    pkg.packageId,
    pkg.locale,
    pkg.localeRevision,
    pkg.helpRevision,
    pkg.copyRevision,
    pkg.contentStatus,
    [
      pkg.instrument.id,
      pkg.instrument.revision,
      pkg.instrument.scoringVersion,
      pkg.instrument.format,
      pkg.instrument.hasTypeCode,
    ],
    [
      pkg.interpretation.version,
      pkg.interpretation.minRatingsPerDimension,
      pkg.interpretation.typeMinDistance,
      pkg.interpretation.markedDistance,
    ],
    pkg.title,
    pkg.estimatedMinutes,
    order,
    pkg.questionnaire.version,
    pkg.questionnaire.questionCount,
    pkg.questionnaire.format ?? null,
    pkg.questionnaire.responseAnchors ?? null,
    pkg.questionnaire.dimensionOrder ?? null,
    pkg.questionnaire.scoring.midpoint,
    order.map((dimension) => pkg.questionnaire.scoring.constants[dimension]),
    questions,
    itemHelp,
    dimensionCopy,
    reportCopy,
    pkg.nextSteps,
    [pkg.attribution.source, pkg.attribution.author, pkg.attribution.url, pkg.attribution.license, pkg.attribution.licenseUrl],
  ])
}

/** 维度端点的展示记号（内容包 → 仪器档案），供类型层引用。 */
export type PackagePole = Pole
