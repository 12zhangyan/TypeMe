/**
 * 新测（typeme-jung48）领域类型。
 *
 * 与后端契约一一对应（`docs/2026-09-16/implementation/_contracts/01-新测契约-v1.md`）。
 * 这里刻意**不复用**旧 OEJTS/IPIP 的类型：新旧两套的正负极定义不同
 * （TF / JP 的正极与旧实现相反），混用类型定义必然导致"编译通过、结果全反"。
 */

/** 维度权威顺序：任何数组输出都按此序，不按字典序。 */
export const DIMENSIONS = ['EI', 'SN', 'TF', 'JP'] as const

export type Dimension = (typeof DIMENSIONS)[number]

/**
 * 每维第一个字母是负极、第二个是正极。TF / JP 与旧 OEJTS 相反。
 *
 * 值类型写成 {@link Pole} 而不是 `string`：写成 `string` 会让
 * `[NEGATIVE_POLE[d], POSITIVE_POLE[d]]` 被推断成 `string[]`，
 * 于是任何要 `Pole[]` 的地方都得靠断言硬压 —— 而断言恰好会掩盖
 * "某个字母拼错"这类最该被编译器抓住的错误。
 */
export const POSITIVE_POLE: Record<Dimension, Pole> = {
  EI: 'E',
  SN: 'N',
  TF: 'F',
  JP: 'P',
}

export const NEGATIVE_POLE: Record<Dimension, Pole> = {
  EI: 'I',
  SN: 'S',
  TF: 'T',
  JP: 'J',
}

export type Pole = 'I' | 'E' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'

/** 阶段：主测（48 题）与补充（最多 16 题）。 */
export type Stage = 'base' | 'clarification'

/** 结果状态。TIED 时**没有**四字母，NEEDS_REVIEW 时也没有报告。 */
export type ResultStatus = 'NEEDS_REVIEW' | 'TIED' | 'TENTATIVE' | 'REFERENCE'

/**
 * 一条作答。
 *
 * 注意 `unknown` 与"未处理"的区别：未处理 = map 里没有这个题号。
 * 两者在计分上等价（都不计入 n），但在**覆盖判定**上完全不同 ——
 * 未处理会让提交回退成 NEEDS_REVIEW，unknown 不会。
 */
export interface Answer {
  questionId: string
  kind: 'rating' | 'unknown'
  rating?: number
}

export interface Item {
  id: string
  stage: Stage
  dimension: Dimension
  scenario: string
  textLeft: string
  textRight: string
  leftPole: Pole
  rightPole: Pole
  help: string
  facet: string
  order: number
  reviewStatus: string
  provenance: string
}

export interface PoleCopy {
  pole: Pole
  label: string
  description: string
  dailySigns: string[]
}

export interface DimensionCopy {
  dimension: Dimension
  name: string
  question: string
  negativePole: PoleCopy
  positivePole: PoleCopy
  balanced: { summary: string; reading: string }
  tiedNotice: string
}

export interface ScoringPolicy {
  version: string
  minBaseRatingsPerDimension: number
  boundaryNumerator: number
  boundaryDenominator: number
  ratingMin: number
  ratingMax: number
  ratingNeutral: number
}

export interface ContentPackage {
  schemaVersion: number
  packageId: string
  instrument: {
    id: string
    revision: string
    scoringVersion: string
    reportContentVersion: string
    format: string
    hasTypeCode: boolean
    baseItemsPerDimension: number
    clarificationItemsPerDimension: number
    maxClarificationItems: number
  }
  title: string
  contentStatus: string
  scoringPolicy: ScoringPolicy
  dimensions: DimensionCopy[]
  questions: Item[]
  sha256: string
}

/** 单题贡献 `direction × (rating − 3)`，取值 −2..2。 */
export const contributionOf = (item: Item, rating: number): number =>
  (item.rightPole === POSITIVE_POLE[item.dimension] ? 1 : -1) * (rating - 3)

/**
 * 触发阈值 {@code T(n) = floor(boundaryNumerator * n / boundaryDenominator)}；
 * {@code |S| <= T(n)} 需要追加补充题。
 *
 * 具体比值由**内容包声明**：历史版本与 `score-v3` 是 `2/10`，`score-v4` 是 `2/5`。
 * 用整数而不是 `|m| <= 0.1` 这类浮点阈值：0.1 在二进制里不精确，
 * 边界上会出现"同一份答卷换台机器结论不同"。
 */
export const triggerThreshold = (policy: ScoringPolicy, n: number): number =>
  n <= 0 ? 0 : Math.floor((policy.boundaryNumerator * n) / policy.boundaryDenominator)

/**
 * 边界与触发**同一条尺度**（`B(n) = T(n)`，不再减一）的计分版本。
 *
 * 必须与后端 `JungScoringPolicy.UNIFIED_SCALE_VERSIONS` 一致：两侧不一致就会出现
 * "预览说这一维倾向较轻、服务端报告说明确"这种同一份答卷两个结论的问题。
 * 注意这张表只决定**边界是否减一**；“分子/分母到底取多少”由各包自己的
 * `scoringPolicy` 声明（v3 = `2/10`，v4 = `2/5`），不在本表里写死。
 */
const UNIFIED_BOUNDARY_SCALE_VERSIONS: readonly string[] = [
  'typeme-jung48-score-v3',
  'typeme-jung48-score-v4',
]

/** 边界 `= 触发 − 1` 的历史版本（行为冻结，旧包/旧草稿/旧报告继续走这一套）。 */
const SEPARATE_BOUNDARY_VERSIONS: readonly string[] = [
  'typeme-jung48-score-v1',
  'typeme-jung48-score-v2',
]

/** 已知计分版本（报错信息与自检用）。 */
export const KNOWN_SCORING_VERSIONS: readonly string[] = [
  ...SEPARATE_BOUNDARY_VERSIONS,
  ...UNIFIED_BOUNDARY_SCALE_VERSIONS,
]

/**
 * 未知计分版本直接拒绝，**不静默落回某一套规则**。
 *
 * 后端在内容包加载期做同一件事（`JungScoringPolicy` 的紧凑构造器）。
 * 这里再做一次是为了预览侧：前端先用本地函数算一遍给用户看，
 * 若按另一套规则算出一个数字，用户会先看到一个与服务端不同的结论。
 */
export const assertKnownScoringVersion = (policy: ScoringPolicy): void => {
  if (!KNOWN_SCORING_VERSIONS.includes(policy.version)) {
    throw new Error(
      `未知计分版本：${policy.version}（已知：${KNOWN_SCORING_VERSIONS.join('、')}）。`
        + '新增计分版本必须在前端与后端的版本表里同时登记。',
    )
  }
}

/** 本版本是否使用"边界 = 触发"的统一尺度。 */
export const usesUnifiedBoundaryScale = (policy: ScoringPolicy): boolean =>
  UNIFIED_BOUNDARY_SCALE_VERSIONS.includes(policy.version)

/** 边界阈值 `B(n) = max(0, T(n) − 1)`（历史）或 `max(0, T(n))`（统一尺度）。 */
export const boundaryThreshold = (policy: ScoringPolicy, n: number): number => {
  const trigger = triggerThreshold(policy, n)
  return usesUnifiedBoundaryScale(policy) ? Math.max(0, trigger) : Math.max(0, trigger - 1)
}

/**
 * 是否需要把该维标成"倾向较轻"。
 *
 * 统一尺度版本额外要求 `nFinal > 0`：没有任何有效数字回答时不存在"较轻的倾向"，
 * 那种情况该走覆盖不足（NEEDS_REVIEW）。历史版本保持原样（行为冻结）。
 */
export const isBoundary = (policy: ScoringPolicy, sFinal: number, nFinal: number): boolean => {
  if (usesUnifiedBoundaryScale(policy) && nFinal <= 0) return false
  return Math.abs(sFinal) <= boundaryThreshold(policy, nFinal)
}

/** 类型码严格匹配，只接受大写规范形。 */
export const isLegalTypeCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[EI][SN][TF][JP]$/.test(value)

/** 该题的"点数"语义：点在左边还是右边意味着什么。 */
export interface SideMeaning {
  /** 点左侧得到的字母 */
  left: Pole
  /** 点右侧得到的字母 */
  right: Pole
  /** 该题右侧是否为正极（决定贡献符号，UI 用来决定进度条方向） */
  rightIsPositive: boolean
}
