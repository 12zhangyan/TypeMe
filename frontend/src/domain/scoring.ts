import type {
  Dimension,
  DimensionResult,
  Pole,
  Question,
  Questionnaire,
  QuizResult,
} from './types'
import { clarityFromDistance, distanceFromMidpoint } from './clarity'
import { ANSWER_MAX, ANSWER_MIN, DEFAULT_ANSWER_VALUE } from './answers'
import { dimensionsOf } from './questionnaire'

/**
 * 计分引擎 —— `docs/需求文档.md` §3.3/§4、`docs/任务拆解.md` §1.1。
 *
 * 官方公式（OEJTS 1.2，逐字实现，不做任何"优化"）：
 *
 *   score(dim) = constants[dim] + Σ ( direction_i × answer_i )
 *   answer_i ∈ {1,2,3,4,5}，5 = textRight 端
 *
 *   判定：score > midpoint → 正极（E / N / T / P），否则负极（I / S / F / J）
 *   ⚠️ 是 `>` 不是 `>=`：中点（24）归到 I / S / F / J 一侧。
 *
 * 本文件**不出现任何题号、方向符号或常量字面量**：
 * 常量来自 `questionnaire.scoring.constants`，符号来自 `questions[].direction`，
 * 中点来自 `questionnaire.scoring.midpoint`。题库一改，结果自动跟着改。
 *
 * 背景（`docs/任务拆解.md` 陷阱 2/3）：GitHub 上的 openjung/core 把 8 题原值
 * 直接相加再判 `>24`，丢掉了符号与常数，导致"跑得通但结果全错"。本实现
 * 由 `scoring.spec.ts` 里的下界/上界断言守住——那两条断言一旦丢了符号就必失败。
 */

/** 题号 → 所选分值（1–5）。未作答的题号允许缺席，但在计分时会被判为错误。 */
export type AnswerMap = Record<number, number>

/**
 * 维度 → 正极 / 负极字母。
 * 这是 §1.1 明文的判定规则（`> midpoint` 为正极），属于契约本身，
 * 不是"题库常量"，因此可以写在这里。
 */
export const POSITIVE_POLE: Readonly<Record<Dimension, Pole>> = { EI: 'E', SN: 'N', TF: 'T', JP: 'P' }
export const NEGATIVE_POLE: Readonly<Record<Dimension, Pole>> = { EI: 'I', SN: 'S', TF: 'F', JP: 'J' }

/**
 * OEJTS 的维度顺序。
 *
 * 从 IPIP 大五接入起，这个常量**不再是引擎的全局假设**：它只代表 OEJTS 这一个仪器，
 * 通用路径请用 `dimensionOrderOf(questionnaire)`（题库声明 → 题目首次出现顺序）。
 * `DIMENSION_ORDER` 作为历史别名保留，供 OEJTS 的只读入口与既有测试使用。
 */
export const OEJTS_DIMENSION_ORDER: readonly Dimension[] = ['EI', 'SN', 'TF', 'JP'] as const

/** @deprecated 新代码请用 `dimensionOrderOf(questionnaire)`；这是 OEJTS 专属顺序。 */
export const DIMENSION_ORDER: readonly Dimension[] = OEJTS_DIMENSION_ORDER

/** 有效作答口径的唯一来源在 `./answers`（值 ∈ 1..5）。这里只做转出，保持既有引用可用。 */
export { ANSWER_MAX, ANSWER_MIN, DEFAULT_ANSWER_VALUE }

/**
 * 极点 / 维度文案的**唯一出处**。
 *
 * 审查 MI-6：极点字母原先在四个地方各自硬编码一份
 * （`DimensionBar`、`ShareCard`、`utils/shareImage`、结果页与落地页的维度说明），
 * 只改 UI 里的一份就能让倾向条与四字母相反，而全部测试仍然绿。
 * 现在统一从这里导出，并由 `scoring.spec.ts` 断言「正极 = E/N/T/P、负极 = I/S/F/J」
 * 与 `> midpoint` 的判定方向一致。
 */
export interface PoleMeta {
  /** 维度中文名 */
  name: string
  /** 负极字母（得分 <= midpoint 一侧） */
  negativePole: Pole
  /** 正极字母（得分 > midpoint 一侧） */
  positivePole: Pole
  negativeLabel: string
  positiveLabel: string
  /** 一句话说明这一维在问什么（落地页用） */
  hint: string
}

export const POLE_META: Readonly<Record<Dimension, PoleMeta>> = {
  EI: {
    name: '精力方向',
    negativePole: 'I',
    positivePole: 'E',
    negativeLabel: '内向',
    positiveLabel: '外向',
    hint: '独处回血，还是在人群中回血',
  },
  SN: {
    name: '信息偏好',
    negativePole: 'S',
    positivePole: 'N',
    negativeLabel: '感觉',
    positiveLabel: '直觉',
    hint: '看具体事实，还是看背后的模式',
  },
  TF: {
    name: '决策依据',
    negativePole: 'F',
    positivePole: 'T',
    negativeLabel: '情感',
    positiveLabel: '思考',
    hint: '先看人情与价值，还是先看逻辑与效率',
  },
  JP: {
    name: '生活节奏',
    negativePole: 'J',
    positivePole: 'P',
    negativeLabel: '判断',
    positiveLabel: '感知',
    hint: '提前定下来，还是留到最后一刻',
  },
}

/** 展示用的维度对（左负极 – 右正极），顺序即 `DIMENSION_ORDER`。 */
export const POLE_PAIRS: ReadonlyArray<{
  dimension: Dimension
  label: string
  name: string
  hint: string
  meta: PoleMeta
}> = DIMENSION_ORDER.map((dimension) => ({
  dimension,
  label: `${POLE_META[dimension].negativePole} – ${POLE_META[dimension].positivePole}`,
  name: POLE_META[dimension].name,
  hint: POLE_META[dimension].hint,
  meta: POLE_META[dimension],
}))

/** 某个维度在给定题库下的取值区间（全部由题库推导，无字面量常量）。 */
export interface DimensionScale {
  dimension: Dimension
  constant: number
  /** 理论下界（8） */
  min: number
  /** 理论上界（40） */
  max: number
  /** 中点（24） */
  midpoint: number
  /** 中点到底数两侧的最大距离，用于把偏离度归一到 0–100 */
  span: number
  questions: Question[]
}

/**
 * 题库的维度顺序（通用）：题库声明 → 题目中首次出现的顺序。
 *
 * 顺序只影响展示与公式书写，不参与数值计算。
 */
export function dimensionOrderOf(questionnaire: Questionnaire): Dimension[] {
  const declared = questionnaire.dimensionOrder
  if (Array.isArray(declared) && declared.length > 0) return [...declared]
  return dimensionsOf(questionnaire)
}

export class ScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScoringError'
  }
}

function isPositiveDirection(question: Question): boolean {
  return question.direction === 1
}

/** 同一道题在两个极端答案下分别贡献多少分。 */
function contributionRange(question: Question): { low: number; high: number } {
  const a = question.direction * ANSWER_MIN
  const b = question.direction * ANSWER_MAX
  return { low: Math.min(a, b), high: Math.max(a, b) }
}

/**
 * 由题库推导每个维度的常量、上下界与中点。
 * 导出是为了让测试与 UI 能够断言/展示"这些数字都是从题库算出来的"。
 */
export function buildDimensionScales(
  questionnaire: Questionnaire,
): Record<Dimension, DimensionScale> {
  const { scoring, questions } = questionnaire

  if (!scoring || typeof scoring.midpoint !== 'number' || !Number.isFinite(scoring.midpoint)) {
    throw new ScoringError('题库缺少合法的 scoring.midpoint，无法计分')
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new ScoringError('题库 questions 为空，无法计分')
  }

  const scales = {} as Record<Dimension, DimensionScale>

  for (const question of questions) {
    const dimension = question.dimension
    const constant = scoring.constants?.[dimension]
    if (typeof constant !== 'number' || !Number.isFinite(constant)) {
      throw new ScoringError(`题库缺少维度 ${String(dimension)} 的计分常量，无法计分`)
    }
    if (question.direction !== 1 && question.direction !== -1) {
      throw new ScoringError(
        `题目 #${question.id} 的 direction 必须是 +1 或 -1，实际为 ${String(question.direction)}`,
      )
    }

    const { low, high } = contributionRange(question)
    const existing = scales[dimension]
    if (existing) {
      existing.min += low
      existing.max += high
      existing.questions.push(question)
    } else {
      scales[dimension] = {
        dimension,
        constant,
        min: constant + low,
        max: constant + high,
        midpoint: scoring.midpoint,
        span: 0, // 稍后统一计算
        questions: [question],
      }
    }
  }

  for (const scale of Object.values(scales)) {
    // 偏离度归一化的分母：由题库推导（OEJTS 两侧都是 16，IPIP-50 是 20），不写死。
    scale.span = Math.max(
      Math.abs(scale.midpoint - scale.min),
      Math.abs(scale.max - scale.midpoint),
    )
  }

  // 声明了顺序时，顺序里的每个维度都必须真的有题目（否则展示顺序会指向空维度）。
  // 注意：**"必须有 OEJTS 的四个维度"不再是引擎的假设** —— 那是具体量表的契约，
  // 由 `domain/assessmentPackage.ts` 的仪器档案逐题钉死（IPIP-50 就是五个维度）。
  const declared = questionnaire.dimensionOrder
  if (Array.isArray(declared)) {
    const missing = declared.filter((dimension) => scales[dimension] === undefined)
    if (missing.length > 0) {
      throw new ScoringError(`题库声明了维度 ${missing.join('、')}，但没有对应题目，无法计分`)
    }
  }
  if (Object.keys(scales).length === 0) {
    throw new ScoringError('题库里没有可计分的维度')
  }

  return scales
}

/**
 * UI 用的单个维度取值区间。
 * 题库不完整时返回 null（而不是抛错），让页面能渲染一句可读的错误态。
 */
export function dimensionScaleOf(
  questionnaire: Questionnaire,
  dimension: Dimension,
): DimensionScale | null {
  try {
    return buildDimensionScales(questionnaire)[dimension] ?? null
  } catch {
    return null
  }
}

/** 这份题库能不能计分（结构性自检）。UI 用它在渲染前决定"显示结果"还是"显示错误态"。 */
export function canScore(questionnaire: Questionnaire | null | undefined): boolean {
  if (!questionnaire) return false
  try {
    buildDimensionScales(questionnaire)
    return true
  } catch {
    return false
  }
}

/** OEJTS 原版文档里的维度变量名（I–E 维度在公式里写作 `IE`，与其它三个一致）。 */
const FORMULA_VARIABLE: Readonly<Record<Dimension, string>> = {
  EI: 'IE',
  SN: 'SN',
  TF: 'FT',
  JP: 'JP',
}

export interface DimensionFormula {
  dimension: Dimension
  variable: string
  /** 形如 `IE = 30 - Q3 - Q7 + Q15 ...` */
  formula: string
  constant: number
}

/**
 * 把本题库的常数与逐题符号写成公式（方法页展示用）。
 *
 * 审查 MI-6：方法页原先手抄了四条写死题号的公式，题库一改就静默说错话。
 * 这里完全由题库生成——`constant` 来自 `scoring.constants`，
 * 每一项来自 `questions[].direction`，题号用数组**下标**（= 展示用的第 N 题）。
 *
 * 变量名沿用 OEJTS 的历史写法（IE/SN/FT/JP）；其它仪器没有这种写法时退化为维度键本身。
 */
export function buildDimensionFormulas(questionnaire: Questionnaire): DimensionFormula[] {
  const scales = buildDimensionScales(questionnaire)
  return dimensionOrderOf(questionnaire).map((dimension) => {
    const scale = scales[dimension]
    const variable = FORMULA_VARIABLE[dimension] ?? dimension
    const terms = scale.questions.map((question) => {
      const position = questionnaire.questions.indexOf(question) + 1
      return `${question.direction === 1 ? '+' : '-'} Q${position}`
    })
    return {
      dimension,
      variable,
      formula: `${variable} = ${scale.constant} ${terms.join(' ')}`,
      constant: scale.constant,
    }
  })
}

function answerOf(answers: AnswerMap, question: Question): number {
  const raw = answers[question.id]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new ScoringError(`题目 #${question.id} 尚未作答，不能计分`)
  }
  if (!Number.isInteger(raw) || raw < ANSWER_MIN || raw > ANSWER_MAX) {
    throw new ScoringError(
      `题目 #${question.id} 的作答必须是 ${ANSWER_MIN}–${ANSWER_MAX} 的整数，实际为 ${String(raw)}`,
    )
  }
  return raw
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 由原始分得到 DimensionResult。
 */
function toDimensionResult(scale: DimensionScale, score: number): DimensionResult {
  const distance = distanceFromMidpoint(score, scale.midpoint)
  const intensity = scale.span === 0 ? 0 : clamp(Math.round((distance / scale.span) * 100), 0, 100)
  const isPositive = score > scale.midpoint
  const positive = POSITIVE_POLE[scale.dimension]
  const negative = NEGATIVE_POLE[scale.dimension]
  if (!positive || !negative) {
    throw new ScoringError(
      `维度 ${String(scale.dimension)} 不属于 OEJTS，无法用四字母兼容码表示（这是 OEJTS 专属入口）`,
    )
  }
  return {
    dimension: scale.dimension,
    score,
    intensity,
    dominant: isPositive ? positive : negative,
    secondary: isPositive ? negative : positive,
    clarity: clarityFromDistance(distance),
    distance,
  }
}

/**
 * 计分入口。`docs/任务拆解.md` B3。
 *
 * @throws ScoringError 作答缺失/越界，或题库结构不合法时抛出。
 *   （刻意不做 openjung 那种 `?? 3` 的静默兜底——那会把"没答"算成"答了中立"，
 *   静默污染分数。）
 */
export function scoreQuestionnaire(
  answers: AnswerMap | Map<number, number>,
  questionnaire: Questionnaire,
): QuizResult {
  const normalized: AnswerMap = answers instanceof Map ? Object.fromEntries(answers) : answers
  const scales = buildDimensionScales(questionnaire)

  // 这个入口是 **OEJTS 专属的只读遗留入口**（四字母兼容码），因此在这里补上
  // OEJTS 的维度完整性断言：通用引擎不再假设"必须有四个维度"（IPIP-50 是五个）。
  const missing = OEJTS_DIMENSION_ORDER.filter((dimension) => scales[dimension] === undefined)
  if (missing.length > 0) {
    throw new ScoringError(`题库缺少维度 ${missing.join('、')} 的题目，无法计分`)
  }

  const dimensions: DimensionResult[] = OEJTS_DIMENSION_ORDER.map((dimension) => {
    const scale = scales[dimension]
    let total = scale.constant
    for (const question of scale.questions) {
      total += question.direction * answerOf(normalized, question)
    }
    return toDimensionResult(scale, total)
  })

  if (dimensions.length === 0) {
    throw new ScoringError('题库里没有可计分的维度')
  }

  return {
    // 四字母按 §1.5 的维度顺序拼接（如 I + S + F + P → "ISFP"）
    typeCode: dimensions.map((item) => item.dominant).join(''),
    dimensions,
  }
}

/**
 * 某一维在给定「题号 → 1–5」下的**原始分**（原公式的按维度入口）。
 *
 * 抽出来是为了让 v3 的按维度计分与旧的全问卷入口使用同一份数值逻辑：
 * 不允许为了让旧函数通过而给其他题填 3，也不允许在这里出现第二套公式。
 *
 * @throws ScoringError 缺任一题或分值越界（刻意不做 `?? 3` 的静默兜底）
 */
export function scoreDimension(scale: DimensionScale, ratings: Record<number, number>): number {
  let total = scale.constant
  for (const question of scale.questions) {
    total += question.direction * answerOf(ratings, question)
  }
  return total
}

/**
 * 单题对维度偏移的贡献：`centered = direction × (rating − 3)`。
 *
 * 符号分布（negative / neutral / positive）依据它统计，而不是直接看用户选了左还是右 ——
 * 因为题目有正反号，同一个「选 1」在不同题上方向相反。
 */
export function centeredContribution(question: Question, rating: number): number {
  return question.direction * (rating - DEFAULT_ANSWER_VALUE)
}

/**
 * 某个维度在"把这一维推到某一侧极端"时的理论分数。
 *
 * ⚠️ 注意「推到极端」不等于「全部选 1」：
 *   推向**负极**（I/S/F/J）一侧 → 正号题选 1、负号题选 5 → 得 `min`（本题库为 8）
 *   推向**正极**（E/N/T/P）一侧 → 正号题选 5、负号题选 1 → 得 `max`（本题库为 40）
 * 这两条正是"符号有没有被用上"的判别点：丢符号的实现拿不到 8 / 40。
 */
export function extremeScore(scale: DimensionScale, end: 'left' | 'right'): number {
  let total = scale.constant
  for (const question of scale.questions) {
    const positive = isPositiveDirection(question)
    const answer =
      end === 'right' ? (positive ? ANSWER_MAX : ANSWER_MIN) : positive ? ANSWER_MIN : ANSWER_MAX
    total += question.direction * answer
  }
  return total
}
