import type { AnswerFormat, Dimension, Question, Questionnaire } from './types'

/**
 * 题库结构契约 —— **接口响应**与**本地快照**共用的唯一校验口径。
 *
 * 为什么要单独一个文件（`docs/2026-09-15/...重构开发文档.md` §10.2）：
 *   - 接口侧需要它：脏数据必须在入口被拦住，而不是喂给计分引擎；
 *   - store 侧需要它：v3 会话里存了完整内容包快照，**不能因为"有快照"就信任任意题库**。
 * 两处如果各写一份，就会出现"接口拦得住、本地快照拦不住"的缺口。
 *
 * 审查 CR-1 的教训保留在这里：原先只查 `typeof constants === 'object'`，
 * 于是 `constants: {}` 能通过校验 → 每个维度都在计分时抛错 → 结果页把用户弹回答题页。
 *
 * 本轮（IPIP 大五接入）的泛化：**不再要求题库必须有 OEJTS 的四个维度**。
 * 这里只做"与量表无关的结构契约"，具体量表的官方符号/常量/题数由
 * `domain/assessmentPackage.ts` 里的**仪器档案**逐题钉死。
 *
 * ⚠️ 可选字段一律用 `!= null` 判断，而不是 `!== undefined`：
 * 服务端（Jackson）会把缺省字段序列化成**显式 `null`**，而 JSON 里没有 `undefined`。
 * 用 `!== undefined` 会把「没声明」当成「声明了 null」，整包被判非法、
 * 页面静默降级到内置副本 —— 真实踩过：接口返回 200，前端却一直走 fallback。
 */

export const ANSWER_FORMATS: readonly AnswerFormat[] = ['bipolar', 'agreement']

/** 五档作答的锚点条数（两种格式都是五档）。 */
export const RESPONSE_ANCHOR_COUNT = 5

export function answerFormatOf(questionnaire: Questionnaire): AnswerFormat {
  return questionnaire.format === 'agreement' ? 'agreement' : 'bipolar'
}

/** 一道题的显示文本（两种格式统一取法，UI 与测试共用）。 */
export function questionTextOf(question: Question, format: AnswerFormat): string {
  if (format === 'agreement') return question.text ?? ''
  return `${question.textLeft ?? ''} / ${question.textRight ?? ''}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidDimensionKey(value: unknown): value is Dimension {
  return isNonEmptyString(value)
}

function isValidQuestion(value: unknown, format: AnswerFormat): value is Question {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Partial<Question>
  if (typeof item.id !== 'number' || !Number.isInteger(item.id)) return false
  if (!isValidDimensionKey(item.dimension)) return false
  if (item.direction !== 1 && item.direction !== -1) return false
  if (format === 'agreement') {
    // 单句陈述：必须有题干；两端字段不适用
    return isNonEmptyString(item.text)
  }
  // 双极：两端都必须有描述，且不能相同（相同疑似笔误）
  return (
    isNonEmptyString(item.textLeft) &&
    isNonEmptyString(item.textRight) &&
    item.textLeft !== item.textRight
  )
}

export function isValidQuestionnaire(value: unknown): value is Questionnaire {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Questionnaire>
  if (typeof candidate.version !== 'string' || !candidate.version) return false
  if (!Array.isArray(candidate.questions) || candidate.questions.length === 0) return false

  if (candidate.format != null && !ANSWER_FORMATS.includes(candidate.format)) return false
  const format = answerFormatOf(candidate as Questionnaire)

  if (candidate.responseAnchors != null) {
    if (
      !Array.isArray(candidate.responseAnchors) ||
      candidate.responseAnchors.length !== RESPONSE_ANCHOR_COUNT ||
      !candidate.responseAnchors.every(isNonEmptyString)
    ) {
      return false
    }
  }

  if (candidate.dimensionOrder != null) {
    if (
      !Array.isArray(candidate.dimensionOrder) ||
      candidate.dimensionOrder.length === 0 ||
      !candidate.dimensionOrder.every(isValidDimensionKey)
    ) {
      return false
    }
    if (new Set(candidate.dimensionOrder).size !== candidate.dimensionOrder.length) return false
  }

  if (
    typeof candidate.scoring !== 'object' ||
    candidate.scoring === null ||
    typeof candidate.scoring.midpoint !== 'number' ||
    !Number.isFinite(candidate.scoring.midpoint) ||
    typeof candidate.scoring.constants !== 'object' ||
    candidate.scoring.constants === null
  ) {
    return false
  }

  // 声明的题数必须与题目数组一致（避免"50 题"标签下面是另一份题库）
  if (
    candidate.questionCount != null &&
    candidate.questionCount !== candidate.questions.length
  ) {
    return false
  }

  const ids = new Set<number>()
  const dimensions = new Set<string>()
  for (const question of candidate.questions) {
    if (!isValidQuestion(question, format)) return false
    if (ids.has(question.id)) return false // 题号必须唯一
    ids.add(question.id)
    dimensions.add(question.dimension)
  }

  // 每个出现过的维度都必须有有限数值常量（`constants: {}` / 缺一个维度都在这里被判掉）
  const constants = candidate.scoring.constants as Record<string, unknown>
  for (const dimension of dimensions) {
    const constant = constants[dimension]
    if (typeof constant !== 'number' || !Number.isFinite(constant)) return false
  }

  // 声明的顺序若存在，必须与题目里出现的维度集合完全一致
  if (candidate.dimensionOrder != null) {
    const declared = new Set(candidate.dimensionOrder)
    if (declared.size !== dimensions.size) return false
    for (const dimension of dimensions) {
      if (!declared.has(dimension)) return false
    }
  }

  return dimensions.size > 0
}

/** 题库里出现的维度（按题目顺序首次出现）。 */
export function dimensionsOf(questionnaire: Questionnaire): Dimension[] {
  const seen: Dimension[] = []
  for (const question of questionnaire.questions) {
    if (!seen.includes(question.dimension)) seen.push(question.dimension)
  }
  return seen
}
