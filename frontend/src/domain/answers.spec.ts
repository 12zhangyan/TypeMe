// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  coerceAnswerValue,
  coerceResponse,
  isCorruptResponse,
  isValidAnswerValue,
  normalizeAnswers,
  normalizeResponses,
  ratingOf,
  responseState,
} from './answers'
import { canScore } from './scoring'
import { assessmentPackageSignature } from './assessmentPackage'
import type { AssessmentPackage } from './assessmentPackage'
import { STORAGE_KEY, useQuizStore } from '@/stores/quiz'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES, FALLBACK_QUESTIONNAIRE } from '@/content/fallback'
import { isValidQuestionnaire } from '@/domain/questionnaire'

const pkg = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] as AssessmentPackage

/** 站点默认包已换成 IPIP-50；本文件里断言 32 题 / 四字母 / OEJTS 旧记录的用例显式指名 OEJTS 包。 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'
const oejtsPkg = FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage

/** 把一份作答写成本项目当前支持的 **v3 会话**（含完整内容包快照与整包签名）。 */
function writeSession(responses: Record<number | string, unknown>, currentQuestionId = 1) {
  return JSON.stringify({
    schemaVersion: 3,
    source: 'native_v3',
    sessionId: 'session-answers-spec',
    packageSnapshot: pkg,
    packageSignature: assessmentPackageSignature(pkg),
    responses,
    currentQuestionId,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    submittedAt: null,
    selfReflection: {},
  })
}

/**
 * 审查 CR-1 —— 「有效作答」口径必须**只有一份**。
 *
 * 原先三处口径不一致（`isComplete` 只判 number、计分器要求 1–5、`restore` 不校验），
 * 数据被写坏时会出现：
 *   `isComplete === true` → 计分抛错 → 结果页 `router.replace('/quiz')` →
 *   答题页显示 disabled 的「还差 N 题」→ **来回弹，永远看不到结果**。
 *
 * v3 里这条口径进一步分成两层：**数字评分**（1–5）与**暂时无法判断**（不是分数）。
 * 这里把两层入口全部钉住：越界值 / 坏 constants / 字符串作答 / unknown。
 */

describe('有效作答口径（domain/answers）', () => {
  it('只有 1–5 的整数算有效作答', () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isValidAnswerValue(value)).toBe(true)
    for (const value of [0, 6, -1, 9, 3.5, Number.NaN, Infinity, '3', null, undefined, {}, [3]]) {
      expect(isValidAnswerValue(value), `${String(value)} 不该算有效作答`).toBe(false)
    }
  })

  it('coerceAnswerValue 只接受可无损还原的数字字符串', () => {
    expect(coerceAnswerValue('3')).toBe(3)
    expect(coerceAnswerValue(' 05 ')).toBe(5)
    expect(coerceAnswerValue(4)).toBe(4)
    expect(coerceAnswerValue('9')).toBeNull()
    expect(coerceAnswerValue('3.5')).toBeNull()
    expect(coerceAnswerValue('3px')).toBeNull()
    expect(coerceAnswerValue('')).toBeNull()
    expect(coerceAnswerValue({ value: 3 })).toBeNull()
  })

  it('normalizeAnswers 丢弃越界值 / 字符串垃圾 / 不存在的题号，并报告条数', () => {
    const outcome = normalizeAnswers(
      { 1: 3, 2: '4', 3: 9, 4: 0, 5: 'abc', 6: null, 999: 3, 7: 5 },
      FALLBACK_QUESTIONNAIRE,
    )
    expect(outcome.received).toBe(8)
    expect(outcome.answers).toEqual({ 1: 3, 2: 4, 7: 5 })
    expect(outcome.dropped).toBe(5)
  })

  it('非对象输入直接返回空表，不抛错', () => {
    expect(normalizeAnswers(null, FALLBACK_QUESTIONNAIRE)).toEqual({
      answers: {},
      dropped: 0,
      received: 0,
    })
    expect(normalizeAnswers('nope', FALLBACK_QUESTIONNAIRE).answers).toEqual({})
  })
})

describe('回答联合类型：数字评分与「无法判断」分开（v3 协议）', () => {
  it('coerceResponse 接受数字 / 数字字符串 / 合法对象，其余一律丢弃', () => {
    expect(coerceResponse(3)).toEqual({ kind: 'rating', value: 3 })
    expect(coerceResponse(' 05 ')).toEqual({ kind: 'rating', value: 5 })
    expect(coerceResponse({ kind: 'rating', value: 4 })).toEqual({ kind: 'rating', value: 4 })
    expect(coerceResponse({ kind: 'unknown', reason: 'unclear' })).toEqual({
      kind: 'unknown',
      reason: 'unclear',
    })
    // 非法 reason 收敛成 null，但**不**把整条丢掉
    expect(coerceResponse({ kind: 'unknown', reason: 'whatever' })).toEqual({
      kind: 'unknown',
      reason: null,
    })
    for (const bad of [0, 6, 9, 3.5, Number.NaN, Infinity, 'abc', '3.5', null, undefined, {}, [], { kind: 'rating', value: 9 }, { kind: 'nope' }]) {
      expect(coerceResponse(bad), `${JSON.stringify(bad)} 不该被接受`).toBeNull()
    }
  })

  it('ratingOf 只返回数字评分；无法判断与未作答都是 null（绝不回落成 3）', () => {
    expect(ratingOf({ kind: 'rating', value: 2 })).toBe(2)
    expect(ratingOf({ kind: 'unknown', reason: null })).toBeNull()
    expect(ratingOf(undefined)).toBeNull()
    expect(ratingOf(null)).toBeNull()
  })

  it('responseState 区分三种状态', () => {
    expect(responseState({ kind: 'rating', value: 3 })).toBe('rating')
    expect(responseState({ kind: 'unknown', reason: null })).toBe('unknown')
    expect(responseState(undefined)).toBe('unanswered')
  })

  it('normalizeResponses 丢弃坏记录、保留合法记录，且不把坏值变成 unknown', () => {
    const outcome = normalizeResponses(
      {
        1: 3,
        2: '4',
        3: { kind: 'unknown', reason: 'not_applicable' },
        4: 9,
        5: { kind: 'rating', value: 0 },
        6: { kind: 'unknown', reason: 'bogus' },
        999: 3,
        7: { kind: 'nope' },
      },
      FALLBACK_QUESTIONNAIRE,
    )
    expect(outcome.received).toBe(8)
    expect(outcome.dropped).toBe(4) // 4 / 5 / 999 / 7
    expect(outcome.responses[1]).toEqual({ kind: 'rating', value: 3 })
    expect(outcome.responses[2]).toEqual({ kind: 'rating', value: 4 })
    expect(outcome.responses[3]).toEqual({ kind: 'unknown', reason: 'not_applicable' })
    expect(outcome.responses[6]).toEqual({ kind: 'unknown', reason: null })
    expect(Object.keys(outcome.responses)).toHaveLength(4)
  })

  it('非对象输入返回空表，不抛错', () => {
    expect(normalizeResponses(null, FALLBACK_QUESTIONNAIRE)).toEqual({
      responses: {},
      dropped: 0,
      received: 0,
    })
    expect(normalizeResponses('nope', FALLBACK_QUESTIONNAIRE).responses).toEqual({})
  })
})

describe('isValidQuestionnaire 补上 constants 四键与题数一致（CR-1 入口二）', () => {
  it('内置题库本身合法', () => {
    expect(isValidQuestionnaire(FALLBACK_QUESTIONNAIRE)).toBe(true)
  })

  it('constants: {} 必须被拒（原先能通过 → 每维计分都抛错 → 弹回）', () => {
    expect(
      isValidQuestionnaire({ ...FALLBACK_QUESTIONNAIRE, scoring: { midpoint: 24, constants: {} } }),
    ).toBe(false)
  })

  it('缺一个维度常量、常量是字符串/NaN/Infinity 都被拒', () => {
    const base = FALLBACK_QUESTIONNAIRE
    const bad: unknown[] = [
      { midpoint: 24, constants: { SN: 12, TF: 30, JP: 18 } },
      { midpoint: 24, constants: { EI: '30', SN: 12, TF: 30, JP: 18 } },
      { midpoint: 24, constants: { EI: Number.NaN, SN: 12, TF: 30, JP: 18 } },
      { midpoint: 24, constants: { EI: Infinity, SN: 12, TF: 30, JP: 18 } },
    ]
    for (const scoring of bad) {
      expect(isValidQuestionnaire({ ...base, scoring })).toBe(false)
    }
  })

  it('questionCount 与题目数不一致、题号重复、缺维度题目都被拒', () => {
    const base = FALLBACK_QUESTIONNAIRE
    expect(isValidQuestionnaire({ ...base, questionCount: 999 })).toBe(false)
    expect(
      isValidQuestionnaire({
        ...base,
        questions: [...base.questions.slice(0, 31), { ...base.questions[0] }],
      }),
    ).toBe(false)
    expect(
      isValidQuestionnaire({
        ...base,
        questions: base.questions.filter((question) => question.dimension !== 'TF'),
      }),
    ).toBe(false)
  })
})

describe('store：restore 过滤 + isProcessed 与计分器同口径（CR-1 入口三）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('isProcessed 不再把越界值当成"处理完了"', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    for (const question of pkg.questionnaire.questions) store.selectRating(question.id, 3)
    expect(store.isProcessed).toBe(true)

    // 直接注入越界值（模拟内存被写坏）：它既不是评分、也不是 unknown
    store.responses = { ...store.responses, 3: { kind: 'rating', value: 9 } as never }
    expect(store.isProcessed).toBe(false)
    expect(store.unansweredCount).toBe(1)
    expect(store.scoringAvailable).toBe(true)
  })

  it('恢复时把 "3" 这类字符串收敛成数字评分（否则该题永久处理不完）', () => {
    const store = useQuizStore()
    const raw: Record<string, unknown> = {}
    for (const question of pkg.questionnaire.questions) raw[question.id] = '3'
    localStorage.setItem(STORAGE_KEY, writeSession(raw))
    expect(store.restore()).toBe(true)
    expect(store.isProcessed).toBe(true)
    // 题数由内容包推导（默认包是 50 题的 IPIP-50，不再写死 OEJTS 的 32）
    expect(store.ratingCount).toBe(pkg.questionnaire.questions.length)
    expect(store.droppedResponses).toBe(0)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).responses['1']).toEqual({
      kind: 'rating',
      value: 3,
    })
  })

  it('restore 丢弃坏记录并计数（用于区分"没处理"与"数据被写坏"）', () => {
    const store = useQuizStore()
    const raw: Record<string, unknown> = {}
    for (const question of pkg.questionnaire.questions) raw[question.id] = 3
    raw[5] = 9
    raw[6] = 'x'
    localStorage.setItem(STORAGE_KEY, writeSession(raw))
    expect(store.restore()).toBe(true)
    expect(store.droppedResponses).toBe(2)
    // 只有被写坏的 2 题没有分：题数由内容包推导（默认包是 50 题的 IPIP-50）
    expect(store.ratingCount).toBe(pkg.questionnaire.questions.length - 2)
    expect(store.isProcessed).toBe(false)
    expect(store.unansweredQuestions.map((question) => question.id)).toEqual([5, 6])
    expect(store.firstUnansweredIndex).toBe(4)
    // 被写坏的两题既没有分也没有变成「无法判断」
    expect(store.unknownCount).toBe(0)
    expect(store.analysis?.dimensions.every((item) => item.status !== 'insufficient')).toBe(false)
  })

  it('额外题号被丢弃，且不产生看似完整的报告', () => {
    const store = useQuizStore()
    const raw: Record<string, unknown> = {}
    for (const question of pkg.questionnaire.questions) raw[question.id] = 3
    raw[99] = { kind: 'rating', value: 4 }
    localStorage.setItem(STORAGE_KEY, writeSession(raw))
    expect(store.restore()).toBe(true)
    expect(store.droppedResponses).toBe(1)
    expect(store.responses[99]).toBeUndefined()
    expect(store.isProcessed).toBe(true)
  })

  it('selectRating 拒绝越界值（不把 9 写进 state）', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 9)
    store.selectRating(2, 3)
    expect(Object.keys(store.responses)).toEqual(['2'])
  })

  it('unknown 不计入 ratingCount，也不会让计分器把它当 3 分', () => {
    const store = useQuizStore()
    // 这一条断言的是 **OEJTS 的 EI 维**（32 题 / 每维 8 题），因此显式用 OEJTS 内容包
    store.activePackage = oejtsPkg
    for (const question of oejtsPkg.questionnaire.questions) store.selectRating(question.id, 3)
    const before = store.reportId
    const eiQuestion = oejtsPkg.questionnaire.questions.find((question) => question.dimension === 'EI')!
    store.selectUnknown(eiQuestion.id, 'unclear')
    expect(store.ratingCount).toBe(31)
    expect(store.unknownCount).toBe(1)
    expect(store.reportId).not.toBe(before)
    const ei = store.analysis?.dimensions.find((item) => item.dimension === 'EI')!
    expect(ei.status).toBe('insufficient')
    expect(ei.score).toBeNull()
  })

  it('题库缺常量时 scoringAvailable 为 false（页面据此渲染错误态而不是崩）', () => {
    const store = useQuizStore()
    store.activePackage = {
      ...pkg,
      questionnaire: {
        ...pkg.questionnaire,
        scoring: { midpoint: 24, constants: { EI: 30, SN: 12, TF: 30, JP: Number.NaN } },
      },
    }
    expect(store.scoringAvailable).toBe(false)
    expect(store.analysis).toBeNull()
    expect(store.analysisError).not.toBeNull()
    expect(canScore(store.activePackage.questionnaire)).toBe(false)
  })
})

/**
 * 默认包换成 IPIP-50 之后，**回答口径不跟着变**：
 * 数字评分仍是 1–5、「无法判断」仍不是分数、写坏的值仍既不算已处理也不变成 unknown。
 * 这一组对默认包（IPIP）与 OEJTS 旧题面跑同一批输入，确认两边收敛结果一致。
 */
describe('回答口径跨仪器一致（IPIP-50 默认包 / OEJTS 旧包）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('越界 0/6、字符串 "3"、null、坏 reason 在 IPIP 默认包下的收敛结果与 OEJTS 完全相同', () => {
    const raw = {
      1: 0,
      2: 6,
      3: '3',
      4: null,
      5: { kind: 'unknown', reason: 'not-a-reason' },
      6: { kind: 'rating', value: 3 },
    }
    const ipip = normalizeResponses(raw, pkg.questionnaire)
    const oejts = normalizeResponses(raw, FALLBACK_QUESTIONNAIRE)
    // 同一批输入 → 同一份结果（题号 1–6 在两种题面上都存在）
    expect(ipip).toEqual(oejts)
    expect(ipip.received).toBe(6)
    expect(ipip.dropped).toBe(3) // 0 / 6 / null 被丢弃
    expect(ipip.responses[3]).toEqual({ kind: 'rating', value: 3 })
    expect(ipip.responses[5]).toEqual({ kind: 'unknown', reason: null })
    expect(Object.keys(ipip.responses)).toHaveLength(3)
  })

  it('isCorruptResponse / responseState 对同一批值判定一致，IPIP 默认包下也一样', () => {
    const batch: Array<[unknown, boolean, string]> = [
      [{ kind: 'rating', value: 0 }, true, 'unanswered'],
      [{ kind: 'rating', value: 6 }, true, 'unanswered'],
      [{ kind: 'rating', value: 3 }, false, 'rating'],
      [{ kind: 'unknown', reason: 'not_applicable' }, false, 'unknown'],
      [{ kind: 'unknown', reason: null }, false, 'unknown'],
      // 裸字符串（历史数据写法）不是 Response 对象，因此不算「写坏」也未处理：
      // 它在入口就被 coerceResponse / normalizeResponses 适配成数字评分（上面那条用例已钉住）
      ['3', false, 'unanswered'],
      [undefined, false, 'unanswered'],
      [null, false, 'unanswered'],
    ]
    for (const [value, corrupt, state] of batch) {
      expect(isCorruptResponse(value as never), `${JSON.stringify(value)} 的损坏判定`).toBe(corrupt)
      expect(responseState(value as never), `${JSON.stringify(value)} 的处理状态`).toBe(state)
    }

    // 同一口径在 IPIP 默认包的 store 上同样成立：写坏的第 1 题既不算已处理、也不算 unknown
    const store = useQuizStore()
    store.activePackage = pkg
    for (const question of pkg.questionnaire.questions) store.selectRating(question.id, 3)
    expect(store.isProcessed).toBe(true)
    store.responses = { ...store.responses, 1: { kind: 'rating', value: 0 } as never }
    expect(store.corruptResponseIds).toEqual([1])
    expect(store.processedCount).toBe(pkg.questionnaire.questions.length - 1)
    expect(store.ratingCount).toBe(pkg.questionnaire.questions.length - 1)
    expect(store.unansweredCount).toBe(1)
    expect(store.unknownCount).toBe(0)
    expect(store.isProcessed).toBe(false)
  })
})
