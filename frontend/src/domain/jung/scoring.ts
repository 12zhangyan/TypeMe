/**
 * 新测计分（前端预览实现）。
 *
 * ## 这个实现的地位：**预览，不是权威**
 *
 * 权威计分在 Java（`com.typeme.jung.scoring.JungScorer`），报告一旦提交就以服务端结果为准。
 * 这里存在的唯一理由是**即时反馈**：用户在答题过程中看到"目前更偏 E"这类提示，
 * 不必每点一次就请求一次服务端。因此：
 *
 *   - 本地结果**绝不允许**被当作最终报告；提交后必须用服务端返回的 `report_json` 覆盖。
 *   - 本地结果**绝不允许**被发给服务端当作"结论"，服务端只收原始作答。
 *   - 两侧行为一致靠 **同一份夹具**（`domain/__fixtures__/score-cases.json`）保证：
 *     Java 与这里各跑同一批用例，任何偏差点都会让其中一侧的测试失败。
 *
 * 刻意写成纯函数：不读时间、不读存储、不产生副作用，这样才能被夹具直接驱动。
 */

import {
  boundaryThreshold,
  contributionOf,
  DIMENSIONS,
  NEGATIVE_POLE,
  POSITIVE_POLE,
  triggerThreshold,
  type Answer,
  type ContentPackage,
  type Dimension,
  type Item,
  type Pole,
  type ResultStatus,
} from './types'

export interface DimensionCoverage {
  dimension: Dimension
  baseRatingCount: number
  baseUnknownCount: number
  baseUnprocessedCount: number
  needsClarification: boolean
  coverageOk: boolean
}

export interface CoverageReport {
  perDimension: Record<Dimension, DimensionCoverage>
  coverageOk: boolean
  insufficientDimensions: Dimension[]
}

export interface DimensionScore {
  dimension: Dimension
  SBase: number
  nBase: number
  mBase: number | null
  SClar: number
  nClar: number
  mClar: number | null
  SFinal: number
  nFinal: number
  mFinal: number | null
  /** 图示位置 ∈ [0,1]，仅用于画条；**不用于判方向** */
  position: number | null
  /** 计算出的字母；平分为 null */
  computedPole: Pole | null
  tiedSide: 'positive' | 'negative' | 'tied'
  boundary: boolean
  clarificationScheduled: boolean
  clarificationSkipped: boolean
  /** 补充题是否**实际**并进了最终分 */
  clarificationApplied: boolean
  clarificationRatingCount: number
}

export interface Candidate {
  typeCode: string
  /** 与本次方向的规则距离（**不是概率、不是准确率**） */
  cost: number
  differsOn: Dimension[]
  /** 稳定排序键：越小表示越贴近计算出的方向。仅供排序，无任何"可能性"含义 */
  orderKey: number
}

export interface ScoringResult {
  status: ResultStatus
  /** TIED / NEEDS_REVIEW 时为 null */
  computedTypeCode: string | null
  dimensions: DimensionScore[]
  tiedDimensions: Dimension[]
  candidates: Candidate[]
  /** 服务端会安排补充题的维度（与用户是否跳过无关） */
  clarificationDimensions: Dimension[]
  clarificationSkipped: boolean
  coverageOk: boolean
  tieNotice: string | null
}

const itemsOf = (pkg: ContentPackage, dimension: Dimension, stage: Item['stage']): Item[] =>
  pkg.questions.filter((item) => item.dimension === dimension && item.stage === stage)

/** 一组题的 `n` 与 `S`：`unknown` 与未处理都不计入。 */
function sumOf(items: Item[], answers: Map<string, Answer>): { n: number; S: number } {
  let n = 0
  let S = 0
  for (const item of items) {
    const answer = answers.get(item.id)
    if (answer && answer.kind === 'rating' && typeof answer.rating === 'number') {
      n += 1
      S += contributionOf(item, answer.rating)
    }
  }
  return { n, S }
}

/** 归一化偏移；`n = 0` 时是 null（**不能填 0 冒充**：0 表示"正好居中"）。 */
const normalize = (S: number, n: number): number | null => (n === 0 ? null : S / (2 * n))

/**
 * 主测覆盖检查（不含补充题）。
 *
 * 两条独立要求：
 *   1. 48 道主测题**每一题都被处理**（rating 或 unknown 之一）；
 *   2. 每维主测 rating 数 >= `minBaseRatingsPerDimension`（首版 9）。
 *
 * 未处理题不得被当成 unknown —— 这正是"答到一半就走了"与"明确说这题判断不了"的区别，
 * 前者不该出报告。
 */
export function checkCoverage(pkg: ContentPackage, answers: Map<string, Answer>): CoverageReport {
  const perDimension = {} as Record<Dimension, DimensionCoverage>
  const insufficientDimensions: Dimension[] = []
  let coverageOk = true
  const minRatings = pkg.scoringPolicy.minBaseRatingsPerDimension

  for (const dimension of DIMENSIONS) {
    const items = itemsOf(pkg, dimension, 'base')
    let baseRatingCount = 0
    let baseUnknownCount = 0
    let baseUnprocessedCount = 0
    for (const item of items) {
      const answer = answers.get(item.id)
      if (!answer) baseUnprocessedCount += 1
      else if (answer.kind === 'rating') baseRatingCount += 1
      else baseUnknownCount += 1
    }
    const { S } = sumOf(items, answers)
    const needsClarification =
      baseRatingCount >= minRatings &&
      Math.abs(S) <= triggerThreshold(pkg.scoringPolicy, baseRatingCount)
    const dimensionOk = baseRatingCount >= minRatings && baseUnprocessedCount === 0
    if (!dimensionOk) {
      coverageOk = false
      insufficientDimensions.push(dimension)
    }
    perDimension[dimension] = {
      dimension,
      baseRatingCount,
      baseUnknownCount,
      baseUnprocessedCount,
      needsClarification,
      coverageOk: dimensionOk,
    }
  }

  return { perDimension, coverageOk, insufficientDimensions }
}

/**
 * 服务端会安排补充题的维度（按权威序）。
 *
 * 覆盖不足时返回空数组：**先补完主测**，不要让补充题掩盖主测缺答。
 */
export function reviewClarification(pkg: ContentPackage, answers: Map<string, Answer>): Dimension[] {
  const coverage = checkCoverage(pkg, answers)
  if (!coverage.coverageOk) return []
  return DIMENSIONS.filter((dimension) => coverage.perDimension[dimension].needsClarification)
}

/**
 * 候选类型。仅在 `status !== 'REFERENCE'` 时生成。
 *
 * `cost` 是把"换一个字母需要偏离多少证据"加起来，**不是概率**。
 * 排序只用于稳定展示；`cost` 并列时不得让字典序产生"最可能"的暗示。
 */
function buildCandidates(dimensions: DimensionScore[]): Candidate[] {
  const choices: Pole[][] = dimensions.map((score) => {
    const dimension = score.dimension
    if (score.computedPole === null) {
      return [NEGATIVE_POLE[dimension], POSITIVE_POLE[dimension]]
    }
    if (score.boundary) {
      const opposite = score.computedPole === POSITIVE_POLE[dimension]
        ? NEGATIVE_POLE[dimension]
        : POSITIVE_POLE[dimension]
      return [score.computedPole, opposite]
    }
    return [score.computedPole]
  })

  const total = choices.reduce((product, options) => product * options.length, 1)
  const candidates: Candidate[] = []
  for (let index = 0; index < total; index += 1) {
    let remainder = index
    const poles = new Array<Pole>(4)
    for (let d = 3; d >= 0; d -= 1) {
      poles[d] = choices[d][remainder % choices[d].length]
      remainder = Math.floor(remainder / choices[d].length)
    }

    let cost = 0
    const differsOn: Dimension[] = []
    let orderKey = 0
    DIMENSIONS.forEach((dimension, position) => {
      const score = dimensions[position]
      if (poles[position] !== score.computedPole) {
        cost += Math.abs(score.SFinal)
        differsOn.push(dimension)
      }
      // 平分的维度按"负极优先"给稳定次序；这不代表负极更可能
      const preferred = score.computedPole ?? NEGATIVE_POLE[dimension]
      orderKey = orderKey * 10 + (poles[position] === preferred ? 0 : 1)
    })

    candidates.push({ typeCode: poles.join(''), cost, differsOn, orderKey })
  }

  candidates.sort((a, b) => a.cost - b.cost || a.orderKey - b.orderKey)
  return candidates
}

/**
 * 计分。
 *
 * @param clarificationSkipped 用户是否明确跳过补充题。跳过时最终分**只用主测**，
 *   但 `clarificationDimensions` 仍如实报告"本来安排了哪些"——那是服务端的决定，
 *   不因为用户跳过而改变。
 */
export function score(
  pkg: ContentPackage,
  answers: Map<string, Answer>,
  clarificationSkipped: boolean,
): ScoringResult {
  const coverage = checkCoverage(pkg, answers)
  const clarificationDimensions = coverage.coverageOk
    ? DIMENSIONS.filter((dimension) => coverage.perDimension[dimension].needsClarification)
    : []

  const dimensions: DimensionScore[] = DIMENSIONS.map((dimension) => {
    const base = sumOf(itemsOf(pkg, dimension, 'base'), answers)
    const clar = sumOf(itemsOf(pkg, dimension, 'clarification'), answers)
    const scheduled = coverage.perDimension[dimension].needsClarification
    // "被安排 + 没跳过 + 真的答了补充题"三者同时成立，补充题才进最终分
    const applied = scheduled && !clarificationSkipped && clar.n > 0
    const SFinal = applied ? base.S + clar.S : base.S
    const nFinal = applied ? base.n + clar.n : base.n
    const mFinal = normalize(SFinal, nFinal)
    const computedPole: Pole | null =
      SFinal > 0 ? POSITIVE_POLE[dimension] : SFinal < 0 ? NEGATIVE_POLE[dimension] : null

    return {
      dimension,
      SBase: base.S,
      nBase: base.n,
      mBase: normalize(base.S, base.n),
      SClar: clar.S,
      nClar: clar.n,
      mClar: normalize(clar.S, clar.n),
      SFinal,
      nFinal,
      mFinal,
      position: mFinal === null ? null : (mFinal + 1) / 2,
      computedPole,
      tiedSide:
        computedPole === null
          ? 'tied'
          : computedPole === POSITIVE_POLE[dimension]
            ? 'positive'
            : 'negative',
      boundary: Math.abs(SFinal) <= boundaryThreshold(pkg.scoringPolicy, nFinal),
      clarificationScheduled: scheduled,
      clarificationSkipped: scheduled && clarificationSkipped,
      clarificationApplied: applied,
      clarificationRatingCount: clar.n,
    }
  })

  // 覆盖不足：直接回退，不给类型也不给候选（此时讨论候选没有意义）
  if (!coverage.coverageOk) {
    return {
      status: 'NEEDS_REVIEW',
      computedTypeCode: null,
      dimensions,
      tiedDimensions: [],
      candidates: [],
      clarificationDimensions,
      clarificationSkipped,
      coverageOk: false,
      tieNotice: null,
    }
  }

  const tiedDimensions = dimensions
    .filter((score) => score.computedPole === null)
    .map((score) => score.dimension)
  const anyBoundary = dimensions.some((score) => score.boundary)
  const status: ResultStatus =
    tiedDimensions.length > 0 ? 'TIED' : anyBoundary ? 'TENTATIVE' : 'REFERENCE'

  const computedTypeCode =
    status === 'REFERENCE' || status === 'TENTATIVE'
      ? dimensions.map((score) => score.computedPole).join('')
      : null

  const candidates = status === 'REFERENCE' ? [] : buildCandidates(dimensions)

  const bestCost = candidates.length > 0 ? candidates[0].cost : 0
  const tiedAtBest = candidates.filter((candidate) => candidate.cost === bestCost).length
  const ambiguous = candidates.length > 1 && (tiedDimensions.length >= 2 || tiedAtBest > 1)

  return {
    status,
    computedTypeCode,
    dimensions,
    tiedDimensions,
    candidates,
    clarificationDimensions,
    clarificationSkipped,
    coverageOk: true,
    tieNotice: ambiguous
      ? '这些候选在本次数据里没有区别：换其中任何一个字母，需要的证据偏离程度都一样。'
      : null,
  }
}

/** 由作答数组构造 map（同题号重复时以最后一条为准，与服务端 upsert 语义一致）。 */
export function answerMapOf(answers: readonly Answer[]): Map<string, Answer> {
  const map = new Map<string, Answer>()
  for (const answer of answers) map.set(answer.questionId, answer)
  return map
}
