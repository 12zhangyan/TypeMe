import type { Dimension, Pole } from './types'
import type { AssessmentPackage, InterpretationPolicy } from './assessmentPackage'
import { instrumentHasTypeCode, packageDimensionOrder, poleTokensOf } from './assessmentPackage'
import type { ResponseMap } from './answers'
import { ratingOf } from './answers'
import type { DimensionScale } from './scoring'
import {
  buildDimensionScales,
  centeredContribution,
  NEGATIVE_POLE,
  POSITIVE_POLE,
  scoreDimension,
} from './scoring'
import type { DimensionStatus, PresentationBand } from './interpretation'
import { presentationBand, statusForBand } from './interpretation'

/**
 * 维度分析模型 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §2.2。
 *
 * 分层在这里落地：
 *   原始计分（`scoring.ts`，OEJTS 1.2 原公式，不改）
 *     → 每维状态（本文件，读包里的解释政策）
 *       → 完整类型是否成立（四维都 `leaning` 才拼码）
 *
 * 三条不变量由本文件保证，并被单测钉住：
 *   1. `insufficient` 与 `balanced` 不是同一种状态：一个没有分数，一个有分数但没有偏移；
 *   2. 缺任一题的数字答案 → 该维 `score = null`，**不补 3、不按比例补分、不缩短分母**；
 *   3. `balanced` 的 `pole` 必须是 `null`；`tentative` / `leaning` 的 `pole` 必须是该维合法侧。
 */

export class AssessmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssessmentError'
  }
}

/** 三档符号分布：依据 centered = direction × (rating − 3) 的符号，三个数相加必须等于该维题数。 */
export interface DimensionCounts {
  negative: number
  neutral: number
  positive: number
}

export interface InsufficientDimensionAnalysis {
  dimension: Dimension
  status: 'insufficient'
  requiredCount: number
  ratingCount: number
  unknownIds: number[]
  unansweredIds: number[]
  score: null
  signedOffset: null
  pole: null
  presentationBand: null
  counts: null
  reviewItemIds: number[]
}

export interface ScoredDimensionAnalysis {
  dimension: Dimension
  status: Exclude<DimensionStatus, 'insufficient'>
  requiredCount: number
  ratingCount: number
  unknownIds: number[]
  unansweredIds: number[]
  score: number
  signedOffset: number
  pole: Pole | null
  presentationBand: PresentationBand
  counts: DimensionCounts
  reviewItemIds: number[]
}

export type DimensionAnalysis = InsufficientDimensionAnalysis | ScoredDimensionAnalysis

export type OverallStatus = 'typed' | 'partial' | 'undetermined'

export interface AssessmentAnalysis {
  packageId: string
  scoringVersion: string
  interpretationVersion: string
  dimensions: DimensionAnalysis[]
  /** 只有四维都 `leaning` 才有值；其余情况必须为 null（**不做默认类型**）。 */
  suggestedTypeCode: string | null
  overallStatus: OverallStatus
}

/**
 * OEJTS 的两端映射（保留给既有测试与只读入口）。
 *
 * ⚠️ 新的分析路径**不再读这两个常量**：端点记号由内容包/仪器档案提供
 * （`poleTokensOf`），这样 IPIP 大五的「低/高」不需要改引擎。
 */
const POSITIVE_POLE_BY_DIMENSION: Readonly<Record<string, Pole>> = POSITIVE_POLE
const NEGATIVE_POLE_BY_DIMENSION: Readonly<Record<string, Pole>> = NEGATIVE_POLE

/** 保证极性映射与 `scoring.ts` 的 `POLE_META` 同源（单测会独立断言一次）。 */
export const NEGATIVE_POLES: Readonly<Record<string, Pole>> = NEGATIVE_POLE_BY_DIMENSION
export const POSITIVE_POLES: Readonly<Record<string, Pole>> = POSITIVE_POLE_BY_DIMENSION

function countsOf(scale: DimensionScale, responses: ResponseMap): DimensionCounts | null {
  let negative = 0
  let neutral = 0
  let positive = 0
  for (const question of scale.questions) {
    const rating = ratingOf(responses[question.id])
    if (rating === null) return null
    const centered = centeredContribution(question, rating)
    if (centered > 0) positive += 1
    else if (centered < 0) negative += 1
    else neutral += 1
  }
  return { negative, neutral, positive }
}

function analyzeDimension(
  scale: DimensionScale,
  responses: ResponseMap,
  policy: InterpretationPolicy,
  tokens: { low: string; high: string },
): DimensionAnalysis {
  const dimension = scale.dimension
  const reviewItemIds = scale.questions.map((question) => question.id)
  const unknownIds: number[] = []
  const unansweredIds: number[] = []
  const ratings: Record<number, number> = {}

  for (const question of scale.questions) {
    const rating = ratingOf(responses[question.id])
    if (rating === null) {
      // unknown 与「完全没处理」必须分开记录：前者是用户明确表达，后者是还没答
      if (responses[question.id]?.kind === 'unknown') unknownIds.push(question.id)
      else unansweredIds.push(question.id)
      continue
    }
    ratings[question.id] = rating
  }

  const requiredCount = scale.questions.length
  const ratingCount = requiredCount - unknownIds.length - unansweredIds.length
  const minimum = Math.min(policy.minRatingsPerDimension, requiredCount)

  if (ratingCount < minimum) {
    return {
      dimension,
      status: 'insufficient',
      requiredCount,
      ratingCount,
      unknownIds,
      unansweredIds,
      score: null,
      signedOffset: null,
      pole: null,
      presentationBand: null,
      counts: null,
      reviewItemIds,
    }
  }

  const total = scoreDimension(scale, ratings)

  // 数据/内容异常必须拒绝，不能用裁剪分数掩盖（§3.2）
  if (!Number.isInteger(total) || total < scale.min || total > scale.max) {
    throw new AssessmentError(
      `${dimension} 的原始分 ${String(total)} 不在题库区间 ${scale.min}–${scale.max} 内，拒绝生成报告`,
    )
  }

  const signedOffset = total - scale.midpoint
  const band = presentationBand(Math.abs(signedOffset), policy)
  const status = statusForBand(band)
  const counts = countsOf(scale, responses)
  if (counts === null) {
    throw new AssessmentError(`${dimension} 的符号分布无法计算，但该维已完成计分，数据自相矛盾`)
  }
  const pole =
    signedOffset === 0 ? null : signedOffset > 0 ? tokens.high : tokens.low

  // balanced 必为 null；其余必为合法侧 —— 由构造函数保证，测试再断言一次
  if (status === 'balanced' && pole !== null) {
    throw new AssessmentError(`${dimension} 处于 balanced 状态却给出了主导侧 ${pole}`)
  }
  if (status !== 'balanced' && pole === null) {
    throw new AssessmentError(`${dimension} 处于 ${status} 状态却没有主导侧`)
  }

  return {
    dimension,
    status,
    requiredCount,
    ratingCount,
    unknownIds,
    unansweredIds,
    score: total,
    signedOffset,
    pole,
    presentationBand: band,
    counts,
    reviewItemIds,
  }
}

/**
 * 分析一份作答。纯函数：不改动传入的 answers / package。
 *
 * @throws ScoringError 题库结构非法（常量缺失、四维不全、符号非法）
 * @throws AssessmentError 原始分越界等数据异常
 */
export function analyzeAssessment(
  responses: ResponseMap,
  pkg: AssessmentPackage,
): AssessmentAnalysis {
  const scales = buildDimensionScales(pkg.questionnaire)
  const policy = pkg.interpretation
  // 维度顺序与两端记号都来自内容包（OEJTS 四维 / IPIP 五维走同一条代码路径）
  const order = packageDimensionOrder(pkg)

  const dimensions = order.map((dimension) => {
    const scale = scales[dimension]
    if (!scale) {
      throw new AssessmentError(`内容包声明了维度 ${dimension}，但题库里没有对应题目`)
    }
    return analyzeDimension(scale, responses, policy, poleTokensOf(pkg, dimension))
  })

  const leaning = dimensions.filter((item) => item.status === 'leaning')
  const overallStatus: OverallStatus =
    leaning.length === dimensions.length ? 'typed' : leaning.length > 0 ? 'partial' : 'undetermined'

  // 只有**类型量表**（instrument.hasTypeCode，未声明时由仪器档案补齐）才拼四字母参考组合；
  // 大五这类连续特质量表即使各维都有方向，也不产出类型码。
  const suggestedTypeCode =
    overallStatus === 'typed' && instrumentHasTypeCode(pkg)
      ? dimensions.map((item) => item.pole).join('')
      : null

  if (suggestedTypeCode !== null && !/^[A-Z]{4}$/.test(suggestedTypeCode)) {
    throw new AssessmentError(`拼出的参考组合 ${suggestedTypeCode} 不是四个字母，拒绝展示`)
  }

  return {
    packageId: pkg.packageId,
    scoringVersion: pkg.instrument.scoringVersion,
    interpretationVersion: policy.version,
    dimensions,
    suggestedTypeCode,
    overallStatus,
  }
}

/** 是否至少有一维信息不足（用于报告标题与分享版式分支）。 */
export function hasInsufficientDimension(analysis: AssessmentAnalysis): boolean {
  return analysis.dimensions.some((item) => item.status === 'insufficient')
}

/** 报告里用来描述「本次能给出方向的维度」。 */
export function leaningDimensions(analysis: AssessmentAnalysis): DimensionAnalysis[] {
  return analysis.dimensions.filter((item) => item.status === 'leaning')
}

/** 报告里用来描述「还待观察的维度」。 */
export function tentativeDimensions(analysis: AssessmentAnalysis): DimensionAnalysis[] {
  return analysis.dimensions.filter((item) => item.status === 'tentative')
}
