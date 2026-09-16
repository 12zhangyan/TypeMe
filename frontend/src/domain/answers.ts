import type { Questionnaire } from './types'

/**
 * 「有效作答」的**唯一口径** —— 值必须是 1–5 的整数（`docs/任务拆解.md` §1.1）。
 *
 * 为什么单开一个文件：这条口径原先散落在三处，而且三处不一致——
 *   - `stores/quiz.ts` 的 `isComplete` 只判 `typeof === 'number'`（9 也算"答完了"）；
 *   - `domain/scoring.ts` 的 `answerOf` 要求 1–5 的整数（9 直接抛错）；
 *   - `stores/quiz.ts` 的 `restore()` 对 localStorage 里的值**完全不校验**。
 * 结果：本地数据被写坏（`answers:{"1":"3"}`、越界值）时，`isComplete` 说"答完了"、
 * 计分器说"没答完"，结果页计分抛错 → `router.replace('/quiz')` → 答题页显示
 * disabled 的「还差 N 题」→ **来回弹，用户永远看不到结果**（审查 CR-1）。
 *
 * 现在：计分器、store、接口校验全部从这里取口径，任何一处改动都会同时生效。
 */

export const ANSWER_MIN = 1
export const ANSWER_MAX = 5

/** 合法作答值的白名单（同时也是唯一的判据，避免各处各写一个区间判断）。 */
export const ANSWER_VALUES: readonly number[] = [1, 2, 3, 4, 5] as const

export const DEFAULT_ANSWER_VALUE = 3

/** 五个选项的短标签（`docs/需求文档.md` §F-02 的两端陈述之外的解释）。 */
export const ANSWER_CAPTIONS: Readonly<Record<number, string>> = {
  1: '完全是左边',
  2: '比较靠左',
  3: '一半一半',
  4: '比较靠右',
  5: '完全是右边',
}

/** 值是否是「有效作答」——1–5 的整数。非数字、字符串、NaN、小数、越界一律 false。 */
export function isValidAnswerValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= ANSWER_MIN && value <= ANSWER_MAX
}

/**
 * 把任意外部来源的值收敛成合法作答。
 * 字符串 `"3"` 这类**可无损还原**的写法会被接受（历史数据 / 手工写入的 localStorage），
 * 其余一律返回 null，由调用方决定丢弃还是报错。
 */
export function coerceAnswerValue(value: unknown): number | null {
  if (isValidAnswerValue(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    // 只接受纯数字字符串：'3' / '04' / ' 5 ' 可以，'3.5' / '3px' / '' 不行
    if (!/^[+-]?\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return isValidAnswerValue(parsed) ? parsed : null
  }
  return null
}

/* ────────────────────────────────────────────────────────────────────────────
 * v3 回答协议：数字评分与「暂时无法判断」分开
 *
 * `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §2.1。
 * 关键点：
 *   - 「无法判断」不是第 6 个数值档，也不代表中立（3）；
 *   - 某题完全未处理时，`ResponseMap` 里**没有这个 key**，不写 unknown、不补 3；
 *   - 打开帮助只影响界面，不产生任何回答。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 合法评分（与 `ANSWER_VALUES` 同一个口径，写成联合类型便于穷尽检查）。 */
export type Rating = 1 | 2 | 3 | 4 | 5

export const UNKNOWN_REASONS = ['unclear', 'no_experience', 'not_applicable', 'unsure'] as const

export type UnknownReason = (typeof UNKNOWN_REASONS)[number]

/** 无法判断的可选原因（本地回顾用，不联网提交，可以不填）。 */
export const UNKNOWN_REASON_LABEL: Readonly<Record<UnknownReason, string>> = {
  unclear: '没理解题目',
  no_experience: '没有相关经历',
  not_applicable: '两边都不适用',
  unsure: '说不清',
}

export type Response =
  | { kind: 'rating'; value: Rating }
  | { kind: 'unknown'; reason: UnknownReason | null }

export type ResponseMap = Record<number, Response>

/** 一道题在用户视角下的处理状态。 */
export type ResponseState = 'unanswered' | 'rating' | 'unknown'

export function isRating(value: unknown): value is Rating {
  return typeof value === 'number' && Number.isInteger(value) && value >= ANSWER_MIN && value <= ANSWER_MAX
}

export function ratingResponse(value: unknown): { kind: 'rating'; value: Rating } | null {
  return isRating(value) ? { kind: 'rating', value } : null
}

export function unknownResponse(reason: UnknownReason | null = null): Response {
  return { kind: 'unknown', reason }
}

/**
 * 取数字评分；无法判断、未作答、以及**被写坏的评分**都返回 null
 * （绝不回落成 3 —— 那正是「没答被算成答了中立」的静默污染）。
 */
export function ratingOf(response: Response | undefined | null): Rating | null {
  if (!response || response.kind !== 'rating') return null
  return isRating(response.value) ? response.value : null
}

/**
 * 一道题的处理状态。
 *
 * ⚠️ `kind === 'rating'` 但值越界（内存/存储被写坏）时按**未处理**计算：
 * 这与 CR-1 的口径一致 —— 不能对一条不可计分的记录宣称"已处理"，
 * 否则页面会显示"32 题都处理好了"，而计分/分析却说信息不足。
 */
export function responseState(response: Response | undefined | null): ResponseState {
  if (!response) return 'unanswered'
  if (response.kind === 'rating') return isRating(response.value) ? 'rating' : 'unanswered'
  return response.kind === 'unknown' ? 'unknown' : 'unanswered'
}

function isUnknownReason(value: unknown): value is UnknownReason {
  return typeof value === 'string' && (UNKNOWN_REASONS as readonly string[]).includes(value)
}

/** 把一条外部来源的记录收敛为 `Response`；无法收敛时返回 null（由调用方计入 dropped）。 */
export function coerceResponse(value: unknown): Response | null {
  if (value === null || value === undefined) return null
  const direct = ratingResponse(value)
  if (direct) return direct
  if (typeof value === 'string') {
    // 历史数据 / 手工写入的 localStorage 里存的是 '3' 这类纯数字字符串。
    // 这是**显式的旧数据适配**，不混进正常输入路径（正常输入只走 ratingResponse）。
    const coerced = coerceAnswerValue(value)
    return coerced === null ? null : { kind: 'rating', value: coerced as Rating }
  }
  if (typeof value !== 'object') return null
  const record = value as { kind?: unknown; value?: unknown; reason?: unknown }
  if (record.kind === 'rating') {
    const rating = ratingResponse(record.value)
    return rating
  }
  if (record.kind === 'unknown') {
    const reason = isUnknownReason(record.reason) ? record.reason : null
    return { kind: 'unknown', reason }
  }
  return null
}

/**
 * 一条记录**存在但不可用**（本地数据被写坏）。
 *
 * 它与「完全没处理」必须分开：没处理是用户还没答，页面应该引导补答；
 * 写坏是数据结构损坏，页面必须如实说明（CR-1），而不是假装用户没答完、
 * 也不是静默丢掉后继续出一份看起来正常的报告。
 */
export function isCorruptResponse(response: Response | undefined | null): boolean {
  if (!response || typeof response !== 'object') return false
  if (response.kind === 'rating') return !isRating(response.value)
  if (response.kind === 'unknown') return false
  return true
}

export interface NormalizeResponsesResult {
  responses: ResponseMap
  /** 被丢弃的条数（非法 kind/value、未知题号、损坏值） */
  dropped: number
  received: number
}

/**
 * 过滤外部来源（localStorage / 旧会话 / 手工构造）的回答表。
 * 损坏的记录被丢弃并计数，其余合法回答照常保留；**不把损坏值当成 unknown**。
 */
export function normalizeResponses(
  raw: unknown,
  questionnaire: Questionnaire,
): NormalizeResponsesResult {
  const responses: ResponseMap = {}
  if (typeof raw !== 'object' || raw === null) return { responses, dropped: 0, received: 0 }

  let received = 0
  let dropped = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    received += 1
    if (!hasQuestionId(questionnaire, key)) {
      dropped += 1
      continue
    }
    const coerced = coerceResponse(value)
    if (coerced === null) {
      dropped += 1
      continue
    }
    responses[Number(key)] = coerced
  }
  return { responses, dropped, received }
}

/** 题号是否属于这份题库（题号可能来自 JSON，故同时接受数字字符串）。 */
function hasQuestionId(questionnaire: Questionnaire, id: unknown): boolean {
  if (typeof id === 'number') {
    return questionnaire.questions.some((question) => question.id === id)
  }
  if (typeof id === 'string' && /^[+-]?\d+$/.test(id.trim())) {
    const parsed = Number(id)
    return questionnaire.questions.some((question) => question.id === parsed)
  }
  return false
}

export interface NormalizeAnswersResult {
  /** 只保留合法作答（题号在题库内 + 值 ∈ 1..5） */
  answers: Record<number, number>
  /** 有多少条外部记录被丢弃（越界值 / 非数字 / 题号不存在） */
  dropped: number
  /** 外部记录总数 */
  received: number
}

/**
 * 过滤外部来源（localStorage / 接口 / 手工构造）的作答表。
 *
 * 不抛错、不静默：把丢弃条数一并返回，UI 才能区分
 * 「用户还没答完」（→ 回答题页）与「数据被写坏」（→ 渲染错误态，不弹回）。
 */
export function normalizeAnswers(
  raw: unknown,
  questionnaire: Questionnaire,
): NormalizeAnswersResult {
  const answers: Record<number, number> = {}
  if (typeof raw !== 'object' || raw === null) return { answers, dropped: 0, received: 0 }

  let received = 0
  let dropped = 0
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    received += 1
    if (!hasQuestionId(questionnaire, key)) {
      dropped += 1
      continue
    }
    const coerced = coerceAnswerValue(value)
    if (coerced === null) {
      dropped += 1
      continue
    }
    answers[Number(key)] = coerced
  }
  return { answers, dropped, received }
}
