import { describe, expect, it } from 'vitest'
import type { Question, Questionnaire } from './types'
import {
  buildDimensionScales,
  canScore,
  dimensionOrderOf,
  dimensionScaleOf,
  DIMENSION_ORDER,
  extremeScore,
  OEJTS_DIMENSION_ORDER,
  POLE_META,
  scoreQuestionnaire,
} from './scoring'
import { assessmentPackageProblems } from './assessmentPackage'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES } from '@/content/fallback'

/**
 * 站点默认包已换成 IPIP-50；本文件里断言 OEJTS 官方符号与常量的用例显式指名 OEJTS 包。
 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

/**
 * 计分引擎单测 —— `docs/任务拆解.md` B5（含勘误后的期望值）。
 *
 * fixture 是**内联**的一份最小合法 Questionnaire：题面刻意使用 OEJTS 1.2 官方 PDF
 * 的英文原文（research/_sources/OEJTS1.2.txt），维度与符号照 `docs/任务拆解.md`
 * §1.1 的常量表逐题抄录。这样做有两个好处：
 *   1. 测试**完全不依赖后端**（不读 YAML、不发请求）；
 *   2. 符号表在这里被独立钉死一遍，R1 可以直接拿官方 PDF 对照复查。
 *
 * ⚠️ 关于 `docs/任务拆解.md` B5 表格的勘误（重要历史，避免后来者误解）
 * ------------------------------------------------------------------
 * 原 B5 表格写的是「全部选 1 → 每维 8 分，ISFJ」「全部选 5 → 每维 40 分，ENTP」。
 * 那组期望值是照「8 题原值直接相加」倒推出来的，**恰好等于 openjung/core 那个
 * 丢掉符号与常数的错误算法**（也就是 §三 陷阱 2/3 明令禁止的算法），与同一份文档
 * §1.1 规定的官方公式 `score = constants[dim] + Σ(direction_i × answer_i)` 数学上
 * 不可能同时成立：
 *
 *   全选 3 = 24  ⟹  constants[dim] = 24 − 3·Σdirection   （对 EI 即 30 ✓）
 *   全选 1 = 8   ⟹  constants[dim] + Σdirection = 8
 *   两式联立要求 constants = 0 且 Σdirection = 8 —— 与 30/12/30/18 矛盾。
 *
 * 官方公式下的真实值（已逐项验算）：
 *   全选 1 → EI 28 / SN 16 / TF 28 / JP 20 → ESTJ
 *   全选 3 → 每维 24                        → ISFJ
 *   全选 5 → EI 20 / SN 32 / TF 20 / JP 28 → INFP
 *
 * 8 与 40 在官方公式下**依然可达**，只是它们不是「全选 1 / 全选 5」：
 *   下界 8  = 负号题选 5、正号题选 1
 *   上界 40 = 负号题选 1、正号题选 5
 * 这两条断言才是真正验证「符号有没有被用上」的回归防线 —— 丢符号的实现会在
 * 这两条上立刻失败，而「全选 3 = 24」那条**不会**失败（因为丢符号也不影响全选 3）。
 * 文档已按此勘误（见 `docs/任务拆解.md` B5 勘误说明）。
 */

/** 官方 OEJTS 1.2 的 32 题：id / 维度 / 方向符号（照 task §1.1 常量表） */
const OFFICIAL_SIGNS: ReadonlyArray<readonly [number, Question['dimension'], 1 | -1]> = [
  [1, 'JP', 1],
  [2, 'TF', -1],
  [3, 'EI', -1],
  [4, 'SN', 1],
  [5, 'JP', 1],
  [6, 'TF', 1],
  [7, 'EI', -1],
  [8, 'SN', 1],
  [9, 'JP', -1],
  [10, 'TF', 1],
  [11, 'EI', -1],
  [12, 'SN', 1],
  [13, 'JP', 1],
  [14, 'TF', -1],
  [15, 'EI', 1],
  [16, 'SN', 1],
  [17, 'JP', -1],
  [18, 'TF', -1],
  [19, 'EI', -1],
  [20, 'SN', 1],
  [21, 'JP', 1],
  [22, 'TF', 1],
  [23, 'EI', 1],
  [24, 'SN', -1],
  [25, 'JP', -1],
  [26, 'TF', -1],
  [27, 'EI', 1],
  [28, 'SN', -1],
  [29, 'JP', 1],
  [30, 'TF', -1],
  [31, 'EI', -1],
  [32, 'SN', 1],
]

/** 官方英文原文（左端 = 圈 1 端 = textLeft）。 */
const OFFICIAL_TEXTS: ReadonlyArray<readonly [string, string]> = [
  ['makes lists', 'relies on memory'],
  ['sceptical', 'wants to believe'],
  ['bored by time alone', 'needs time alone'],
  ['accepts things as they are', 'unsatisfied with the ways things are'],
  ['keeps a clean room', 'just puts stuff where ever'],
  ['thinks "robotic" is an insult', 'strives to have a mechanical mind'],
  ['energetic', 'mellow'],
  ['prefer to take multiple choice test', 'prefer essay answers'],
  ['chaotic', 'organized'],
  ['easily hurt', 'thick-skinned'],
  ['works best in groups', 'works best alone'],
  ['focused on the present', 'focused on the future'],
  ['plans far ahead', 'plans at the last minute'],
  ["wants people's respect", 'wants their love'],
  ['gets worn out by parties', 'gets fired up by parties'],
  ['fits in', 'stands out'],
  ['keeps options open', 'commits'],
  ['wants to be good at fixing things', 'wants to be good at fixing people'],
  ['talks more', 'listens more'],
  [
    'when describing an event, will tell people what happened',
    'when describing an event, will tell people what it meant',
  ],
  ['gets work done right away', 'procrastinates'],
  ['follows the heart', 'follows the head'],
  ['stays at home', 'goes out on the town'],
  ['wants the big picture', 'wants the details'],
  ['improvises', 'prepares'],
  ['bases morality on justice', 'bases morality on compassion'],
  [
    'finds it difficult to yell very loudly',
    'yelling to others when they are far away comes naturally',
  ],
  ['theoretical', 'empirical'],
  ['works hard', 'plays hard'],
  ['uncomfortable with emotions', 'values emotions'],
  ['likes to perform in front of other people', 'avoids public speaking'],
  ['likes to know "who?", "what?", "when?"', 'likes to know "why?"'],
]

const FIXTURE_QUESTIONS: Question[] = OFFICIAL_SIGNS.map(([id, dimension, direction], index) => {
  const [textLeft, textRight] = OFFICIAL_TEXTS[index]
  return { id, textLeft, textRight, dimension, direction }
})

const FIXTURE: Questionnaire = {
  version: 'quick',
  title: '快速版',
  questionCount: 32,
  estimatedMinutes: 5,
  scoring: {
    midpoint: 24,
    constants: { EI: 30, SN: 12, TF: 30, JP: 18 },
  },
  questions: FIXTURE_QUESTIONS,
}

const DIMENSIONS = ['EI', 'SN', 'TF', 'JP'] as const

/** 生成一份"每题都选同一个值"的答卷。 */
function uniformAnswers(value: number): Record<number, number> {
  const answers: Record<number, number> = {}
  for (const question of FIXTURE.questions) answers[question.id] = value
  return answers
}

/**
 * 生成"把每一维都推到同一侧极端"的答卷。
 * @param end left = 推向负极（I/S/F/J）一侧；right = 推向正极（E/N/T/P）一侧
 *
 * 注意这不是"全部圈 1"：要推到负极，**负号题要选 5、正号题要选 1**。
 * 这正是"符号有没有被用上"的判别点（见文件头勘误说明）。
 */
function extremeAnswers(end: 'left' | 'right'): Record<number, number> {
  const answers: Record<number, number> = {}
  for (const question of FIXTURE.questions) {
    const positive = question.direction === 1
    answers[question.id] = end === 'right' ? (positive ? 5 : 1) : positive ? 1 : 5
  }
  return answers
}

/** 确定性 PRNG，保证随机不变量测试可复现。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function scoresOf(result: ReturnType<typeof scoreQuestionnaire>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of result.dimensions) out[item.dimension] = item.score
  return out
}

describe('fixture 自检（先确认题库抄对了，后面的断言才有意义）', () => {
  it('32 题、每维 8 题、id 为 1..32 且唯一', () => {
    expect(FIXTURE.questions).toHaveLength(32)
    expect(new Set(FIXTURE.questions.map((q) => q.id)).size).toBe(32)
    for (const dimension of DIMENSIONS) {
      expect(FIXTURE.questions.filter((q) => q.dimension === dimension)).toHaveLength(8)
    }
  })

  it('常量表与 §1.1 一致，且每个常量都满足「全选 3 = 中点」的配平关系', () => {
    expect(FIXTURE.scoring.constants).toEqual({ EI: 30, SN: 12, TF: 30, JP: 18 })
    for (const dimension of DIMENSIONS) {
      const sumDirection = FIXTURE.questions
        .filter((q) => q.dimension === dimension)
        .reduce((sum, q) => sum + q.direction, 0)
      // 常量不是随便填的：它必须让"全选 3"正好落在中点上
      expect(FIXTURE.scoring.constants[dimension]).toBe(
        FIXTURE.scoring.midpoint - 3 * sumDirection,
      )
    }
  })
})

describe('三组极端输入（任务拆解 B5）', () => {
  it('全部选 1 → EI 28 / SN 16 / TF 28 / JP 20，typeCode === "ESTJ"', () => {
    const result = scoreQuestionnaire(uniformAnswers(1), FIXTURE)
    expect(scoresOf(result)).toEqual({ EI: 28, SN: 16, TF: 28, JP: 20 })
    expect(result.typeCode).toBe('ESTJ')
  })

  it('全部选 3 → 每维 24，typeCode === "ISFJ"（判定是 > 不是 >=，中点归负极）', () => {
    const result = scoreQuestionnaire(uniformAnswers(3), FIXTURE)
    for (const dimension of DIMENSIONS) {
      expect(scoresOf(result)[dimension]).toBe(24)
    }
    expect(result.typeCode).toBe('ISFJ')
    // 压线：与中点距离 0 → D 级，强度 0
    for (const item of result.dimensions) {
      expect(item.distance).toBe(0)
      expect(item.intensity).toBe(0)
      expect(item.clarity).toBe('D')
    }
  })

  it('全部选 5 → EI 20 / SN 32 / TF 20 / JP 28，typeCode === "INFP"', () => {
    const result = scoreQuestionnaire(uniformAnswers(5), FIXTURE)
    expect(scoresOf(result)).toEqual({ EI: 20, SN: 32, TF: 20, JP: 28 })
    expect(result.typeCode).toBe('INFP')
  })
})

describe('极值 8 / 40 —— 符号回归防线（丢了符号必失败）', () => {
  it('下界：负号题选 5、正号题选 1 → 每维恰好 8 分', () => {
    const answers = extremeAnswers('left')
    const scales = buildDimensionScales(FIXTURE)
    for (const dimension of DIMENSIONS) {
      expect(extremeScore(scales[dimension], 'left')).toBe(8)
    }
    const result = scoreQuestionnaire(answers, FIXTURE)
    for (const dimension of DIMENSIONS) {
      expect(scoresOf(result)[dimension]).toBe(8)
    }
    // 8 < 24 → 全部落负极
    expect(result.typeCode).toBe('ISFJ')
  })

  it('上界：负号题选 1、正号题选 5 → 每维恰好 40 分', () => {
    const answers = extremeAnswers('right')
    const scales = buildDimensionScales(FIXTURE)
    for (const dimension of DIMENSIONS) {
      expect(extremeScore(scales[dimension], 'right')).toBe(40)
    }
    const result = scoreQuestionnaire(answers, FIXTURE)
    for (const dimension of DIMENSIONS) {
      expect(scoresOf(result)[dimension]).toBe(40)
    }
    // 40 > 24 → 全部落正极
    expect(result.typeCode).toBe('ENTP')
  })

  it('下界/上界答卷必须与"全选 1 / 全选 5"不是同一份（否则这两条断言是假的）', () => {
    const left = extremeAnswers('left')
    const right = extremeAnswers('right')
    const allOne = uniformAnswers(1)
    const allFive = uniformAnswers(5)
    expect(left).not.toEqual(allOne)
    expect(right).not.toEqual(allFive)
    // 丢符号的实现（8 题原值直接相加）在这份"下界"答卷上会得到 8..40 混在一起的一堆分，
    // 不可能每维都等于 8；这里用它的判定结果做对照，确认两条实现是可区分的。
    const naive = (answers: Record<number, number>) => {
      const out: Record<string, number> = { EI: 0, SN: 0, TF: 0, JP: 0 }
      for (const question of FIXTURE.questions) out[question.dimension] += answers[question.id]
      return out
    }
    expect(Object.values(naive(left))).not.toEqual([8, 8, 8, 8])
  })
})

describe('区间不变量（随机 1000 组作答）', () => {
  it('每维得分恒在 [8, 40] 且为整数，intensity ∈ [0, 100]', () => {
    const random = mulberry32(20260303)
    for (let round = 0; round < 1000; round += 1) {
      const answers: Record<number, number> = {}
      for (const question of FIXTURE.questions) {
        answers[question.id] = 1 + Math.floor(random() * 5)
      }
      const result = scoreQuestionnaire(answers, FIXTURE)
      expect(result.dimensions).toHaveLength(4)
      for (const item of result.dimensions) {
        expect(Number.isInteger(item.score)).toBe(true)
        expect(item.score).toBeGreaterThanOrEqual(8)
        expect(item.score).toBeLessThanOrEqual(40)
        expect(item.intensity).toBeGreaterThanOrEqual(0)
        expect(item.intensity).toBeLessThanOrEqual(100)
        expect(item.distance).toBe(Math.abs(item.score - FIXTURE.scoring.midpoint))
        expect(['A', 'B', 'C', 'D']).toContain(item.clarity)
        expect([item.dominant, item.secondary]).toHaveLength(2)
        expect(item.dominant).not.toBe(item.secondary)
      }
      expect(result.typeCode).toHaveLength(4)
      expect(result.typeCode).toMatch(/^[EISNTFJP]{4}$/)
    }
  })
})

describe('判定规则：> midpoint（不是 >=）', () => {
  it('正好等于中点时归到负极（I / S / F / J）', () => {
    const result = scoreQuestionnaire(uniformAnswers(3), FIXTURE)
    for (const item of result.dimensions) {
      expect(item.score).toBe(FIXTURE.scoring.midpoint)
      expect(item.dominant).toBe({ EI: 'I', SN: 'S', TF: 'F', JP: 'J' }[item.dimension])
    }
  })

  it('中点 +1 立刻翻到正极（E / N / T / P）', () => {
    // 每题把分值抬高，只让 SN 维度越过中点：SN 有 6 道正号题、2 道负号题
    const answers = uniformAnswers(3)
    answers[4] = 5
    answers[8] = 5
    answers[12] = 5
    const result = scoreQuestionnaire(answers, FIXTURE)
    const sn = result.dimensions.find((item) => item.dimension === 'SN')
    expect(sn?.score).toBe(30)
    expect(sn?.dominant).toBe('N')
    expect(sn?.secondary).toBe('S')
  })
})

describe('计分完全由传入的题库驱动（防止硬编码题号/符号/常量）', () => {
  it('把同一份题库改成"无符号、无常数"的加法版本，结果随之改变（即文档勘误表对应的算法）', () => {
    const naive: Questionnaire = {
      ...FIXTURE,
      scoring: { midpoint: 24, constants: { EI: 0, SN: 0, TF: 0, JP: 0 } },
      questions: FIXTURE.questions.map((question) => ({ ...question, direction: 1 as const })),
    }
    // 只有在"符号被丢掉、常量归零"的题库下，全选 1/全选 5 才会得到 8 / 40
    const allOne = scoreQuestionnaire(
      Object.fromEntries(naive.questions.map((q) => [q.id, 1])),
      naive,
    )
    expect(scoresOf(allOne)).toEqual({ EI: 8, SN: 8, TF: 8, JP: 8 })
    expect(allOne.typeCode).toBe('ISFJ')

    const allFive = scoreQuestionnaire(
      Object.fromEntries(naive.questions.map((q) => [q.id, 5])),
      naive,
    )
    expect(scoresOf(allFive)).toEqual({ EI: 40, SN: 40, TF: 40, JP: 40 })
    expect(allFive.typeCode).toBe('ENTP')
  })

  it('改一个方向符号，得分就跟着变（符号来自题库，不是写死的）', () => {
    const flipped: Questionnaire = {
      ...FIXTURE,
      questions: FIXTURE.questions.map((question) =>
        question.id === 15 ? { ...question, direction: -1 as const } : question,
      ),
    }
    const answers = uniformAnswers(1)
    const before = scoresOf(scoreQuestionnaire(answers, FIXTURE)).EI
    const after = scoresOf(scoreQuestionnaire(answers, flipped)).EI
    expect(before).toBe(28)
    expect(after).toBe(26) // Q15 由 +1 变 -1，全选 1 时该题贡献少 2 分
  })

  it('改常量，得分整体平移（常量来自题库）', () => {
    const shifted: Questionnaire = {
      ...FIXTURE,
      scoring: { midpoint: 24, constants: { EI: 31, SN: 12, TF: 30, JP: 18 } },
    }
    const result = scoreQuestionnaire(uniformAnswers(3), shifted)
    expect(scoresOf(result).EI).toBe(25)
    expect(scoresOf(result).SN).toBe(24)
    // 25 > 24 → EI 翻到正极；其余仍在中点 → 负极
    expect(result.typeCode).toBe('ESFJ')
  })
})

describe('错误处理：不做静默兜底', () => {
  it('缺题作答时抛错（不把"没答"当成"答了中立"）', () => {
    const answers = uniformAnswers(3)
    delete answers[17]
    expect(() => scoreQuestionnaire(answers, FIXTURE)).toThrowError(/17/)
  })

  it('分值越界或非整数时抛错', () => {
    expect(() => scoreQuestionnaire({ ...uniformAnswers(3), 5: 0 }, FIXTURE)).toThrowError()
    expect(() => scoreQuestionnaire({ ...uniformAnswers(3), 5: 6 }, FIXTURE)).toThrowError()
    expect(() => scoreQuestionnaire({ ...uniformAnswers(3), 5: 3.5 }, FIXTURE)).toThrowError()
  })

  it('题库结构不合法时抛错', () => {
    expect(() =>
      scoreQuestionnaire(uniformAnswers(3), { ...FIXTURE, questions: [] }),
    ).toThrowError()
    expect(() =>
      scoreQuestionnaire(uniformAnswers(3), {
        ...FIXTURE,
        scoring: { midpoint: 24, constants: { SN: 12, TF: 30, JP: 18 } as never },
      }),
    ).toThrowError(/EI/)
  })

  it('通用建标尺不再假设"必须有四个维度"；OEJTS 的维度完整性由仪器档案与遗留入口负责', () => {
    const noTf: Questionnaire = {
      ...FIXTURE,
      questions: FIXTURE.questions.filter((question) => question.dimension !== 'TF'),
    }
    // 通用引擎只负责"结构自洽"：缺一个维度仍是可计分的题库（IPIP 大五就是五个维度）
    expect(() => buildDimensionScales(noTf)).not.toThrow()
    expect(canScore(noTf)).toBe(true)
    expect(canScore(FIXTURE)).toBe(true)
    // OEJTS 的"四维齐全"改由两个更靠上的层拦住：
    //   ① 仪器档案（内容包校验）——四维/八题/官方符号逐题核对
    expect(
      assessmentPackageProblems({
        ...FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID],
        questionnaire: noTf,
      }).join('；'),
    ).toMatch(/TF/)
    //   ② OEJTS 专属的只读遗留入口（四字母兼容码）
    expect(() =>
      scoreQuestionnaire(
        Object.fromEntries(noTf.questions.map((question) => [question.id, 3])),
        noTf,
      ),
    ).toThrowError(/TF/)
  })
})

/**
 * 审查 IM-4：`span` / `midpoint`「由题库推导」这一性质原先**没有任何回归防线**
 * （变异实测：把 midpoint 硬编码成 24、把 span 硬编码成 16，17/17 全绿）。
 * 下面这几条一旦有人写死数字就会立刻变红。
 */
describe('归一化参数完全由题库推导（IM-4 回归防线）', () => {
  it('本题库的四维区间是 min 8 / max 40 / midpoint 24 / span 16', () => {
    const scales = buildDimensionScales(FIXTURE)
    for (const dimension of DIMENSION_ORDER) {
      expect(scales[dimension].min).toBe(8)
      expect(scales[dimension].max).toBe(40)
      expect(scales[dimension].midpoint).toBe(24)
      expect(scales[dimension].span).toBe(16)
    }
  })

  it('把 EI 常量改成 31（midpoint 仍是 24）→ EI 的 min 9 / max 41 / span 17', () => {
    const shifted: Questionnaire = {
      ...FIXTURE,
      scoring: { ...FIXTURE.scoring, constants: { ...FIXTURE.scoring.constants, EI: 31 } },
    }
    const scale = buildDimensionScales(shifted).EI
    expect(scale.constant).toBe(31)
    expect(scale.min).toBe(9)
    expect(scale.max).toBe(41)
    expect(scale.span).toBe(17) // max(|24-9|, |41-24|) = 17，不是写死的 16
    // 其余维度不受影响
    expect(buildDimensionScales(shifted).SN.span).toBe(16)
    expect(dimensionScaleOf(shifted, 'EI')?.span).toBe(17)
  })

  it('常数与中点只来自传进来的题库，与上一份题库互不污染', () => {
    const shifted: Questionnaire = {
      ...FIXTURE,
      scoring: { ...FIXTURE.scoring, constants: { ...FIXTURE.scoring.constants, EI: 31 } },
    }
    expect(buildDimensionScales(FIXTURE).EI.span).toBe(16)
    expect(buildDimensionScales(shifted).EI.span).toBe(17)
    expect(buildDimensionScales(FIXTURE).EI.span).toBe(16) // 再算一次还是 16
  })

  it('span 确实被用作 intensity 的分母：span 17 时偏离 1 分的强度是可复算的', () => {
    const shifted: Questionnaire = {
      ...FIXTURE,
      scoring: { ...FIXTURE.scoring, constants: { ...FIXTURE.scoring.constants, EI: 31 } },
    }
    const answers = uniformAnswers(3)
    // EI 的符号和 Σdirection = -2（3 道正号题、5 道负号题），全选 3 → EI = 31 - 6 = 25
    // 这里把 Q15（EI 的正号题）从 3 抬到 4 → EI = 26，偏离中点 24 共 2 分
    answers[15] = 4
    const ei = scoreQuestionnaire(answers, shifted).dimensions.find((d) => d.dimension === 'EI')!
    expect(ei.score).toBe(26)
    expect(ei.distance).toBe(2)
    expect(ei.intensity).toBe(Math.round((2 / 17) * 100)) // 12，分母必须是 17 而不是 16
    expect(Math.round((2 / 16) * 100)).toBe(13) // 对照：写死 16 会得到 13，与 12 可区分
    expect(shifted.scoring.midpoint).toBe(24) // 本题库中点没动
  })

  it('midpoint=18 的题库会把极性整体翻转（判定用的是题库里的中点）', () => {
    // 常量按配平关系现算：constant = midpoint − 3·Σdirection（不手抄，避免抄错）
    const sumDirection = (dimension: (typeof DIMENSIONS)[number]) =>
      FIXTURE.questions
        .filter((question) => question.dimension === dimension)
        .reduce((sum, question) => sum + question.direction, 0)
    const constantsAt = (midpoint: number) => ({
      EI: midpoint - 3 * sumDirection('EI'),
      SN: midpoint - 3 * sumDirection('SN'),
      TF: midpoint - 3 * sumDirection('TF'),
      JP: midpoint - 3 * sumDirection('JP'),
    })
    // FIXTURE 的 Σdirection：EI −2 / SN 4 / TF −2 / JP 2 → 中点 18 时 { 24, 6, 24, 12 }
    expect(constantsAt(18)).toEqual({ EI: 24, SN: 6, TF: 24, JP: 12 })
    // 逐维核一遍：这组常量必须让"全选 3"正好落在中点上（m − 3Σ + 3Σ = m）
    for (const dimension of DIMENSIONS) {
      expect(constantsAt(18)[dimension] + 3 * sumDirection(dimension)).toBe(18)
    }
    const lowerMidpoint: Questionnaire = {
      ...FIXTURE,
      scoring: { midpoint: 18, constants: constantsAt(18) },
    }

    // ① 中点 18 下，全选 3 恰好等于中点 → 压线、四维全落**负极**（判定是 `>` 不是 `>=`）
    //    这一条同时证明中点读的是题库：若实现写死 24，distance 会变成 6、clarity 会变成 B
    const exactlyAtMidpoint = scoreQuestionnaire(uniformAnswers(3), lowerMidpoint)
    for (const item of exactlyAtMidpoint.dimensions) {
      expect(item.score).toBe(18)
      expect(item.distance).toBe(0)
      expect(item.intensity).toBe(0)
      expect(item.clarity).toBe('D')
      expect(item.dominant).toBe(POLE_META[item.dimension].negativePole)
      expect(item.secondary).toBe(POLE_META[item.dimension].positivePole)
    }
    expect(exactlyAtMidpoint.typeCode).toBe('ISFJ')

    // ② 同一份"全选 3"放到中点 24 的题库里：每维 24 → 仍是压线 ISFJ，但分数不同
    const sameAnswersAt24 = scoreQuestionnaire(uniformAnswers(3), FIXTURE)
    expect(sameAnswersAt24.dimensions.every((item) => item.score === 24)).toBe(true)
    expect(sameAnswersAt24.dimensions.every((item) => item.distance === 0)).toBe(true)
    expect(sameAnswersAt24.typeCode).toBe('ISFJ')

    // ③ 只改中点、**常量不动** → 同一份作答的判定必须跟着翻（这才是"中点由题库驱动"的判别性证据）
    //    注意：`constantsAt(m) = m − 3Σ` 会保持 `c − m` 不变，两套题库行为完全等价，
    //    所以必须用"常量不变、只改中点"来构造，否则测不出任何东西。
    const mid18SameConstants: Questionnaire = {
      ...FIXTURE,
      scoring: { midpoint: 18, constants: FIXTURE.scoring.constants },
    }
    const at24 = scoreQuestionnaire(uniformAnswers(3), FIXTURE)
    const at18 = scoreQuestionnaire(uniformAnswers(3), mid18SameConstants)
    // 全选 3 → 每维 24：m=24 下压线落负极；m=18 下 24 > 18 全部翻到正极
    expect(at24.dimensions.every((item) => item.score === 24 && item.clarity === 'D')).toBe(true)
    expect(at24.typeCode).toBe('ISFJ')
    expect(at18.dimensions.every((item) => item.score === 24 && item.distance === 6)).toBe(true)
    expect(at18.dimensions.every((item) => item.clarity === 'B')).toBe(true)
    expect(at18.dimensions.every((item) => item.dominant === POLE_META[item.dimension].positivePole)).toBe(true)
    expect(at18.typeCode).toBe('ENTP')

    // ④ span 由题库推导：它恒等于 2 × 该维度题数（与中点无关）
    for (const dimension of DIMENSIONS) {
      const scale = buildDimensionScales(FIXTURE)[dimension]
      expect(scale.span).toBe(2 * scale.questions.length)
    }
    expect(buildDimensionScales(FIXTURE).EI.span).toBe(16)
    expect(buildDimensionScales(FIXTURE).EI.min).toBe(8)
    expect(buildDimensionScales(FIXTURE).EI.max).toBe(40)
    // 把 EI 削到 4 题（Σ 归零、常量取 24）→ span 必须变成 8；若实现写死 16 这条会红
    const sparse: Questionnaire = {
      ...FIXTURE,
      questions: [
        ...FIXTURE.questions.filter((q) => q.dimension !== 'EI'),
        ...FIXTURE.questions.filter((q) => q.dimension === 'EI' && [11, 15, 19, 23].includes(q.id)),
      ],
      scoring: { midpoint: 24, constants: { ...FIXTURE.scoring.constants, EI: 24 } },
    }
    expect(buildDimensionScales(sparse).EI.questions.length).toBe(4)
    expect(buildDimensionScales(sparse).EI.min).toBe(16)
    expect(buildDimensionScales(sparse).EI.max).toBe(32)
    expect(buildDimensionScales(sparse).EI.span).toBe(8)
  })

  it('把中点整体上移 1 → 同一份作答的极性方向全部反过来', () => {
    const higher: Questionnaire = {
      ...FIXTURE,
      scoring: { midpoint: 25, constants: FIXTURE.scoring.constants },
    }
    const before = scoreQuestionnaire(uniformAnswers(3), FIXTURE)
    const after = scoreQuestionnaire(uniformAnswers(3), higher)
    expect(before.typeCode).toBe('ISFJ')
    expect(after.typeCode).toBe('ISFJ') // 每维 24 < 25，仍全落负极
    for (const item of after.dimensions) {
      expect(item.distance).toBe(1)
      expect(item.clarity).toBe('D')
    }
    // 而每维 26 分（全选 3 且把常数 +2）在中点 25 下变成正极
    const bumped: Questionnaire = {
      ...higher,
      scoring: {
        midpoint: 25,
        constants: { EI: 32, SN: 14, TF: 32, JP: 20 },
      },
    }
    const bumpedResult = scoreQuestionnaire(uniformAnswers(3), bumped)
    expect(bumpedResult.typeCode).toBe('ENTP')
    for (const item of bumpedResult.dimensions) {
      expect(item.score).toBe(26)
      expect(item.dominant).toBe(POLE_META[item.dimension].positivePole)
      expect(item.secondary).toBe(POLE_META[item.dimension].negativePole)
    }
  })
})

/**
 * 审查 MI-6：极点字母原先在 4 处 UI 里各自硬编码，只改一处就能让倾向条
 * 与四字母相反而测试全绿。现在收敛为 `POLE_META`，这里钉死它与判定方向一致。
 */
describe('极点映射唯一出处（MI-6 回归防线）', () => {
  it('负极为 I/S/F/J、正极为 E/N/T/P，与 §1.1 的判定规则一致', () => {
    expect(POLE_META.EI).toMatchObject({ negativePole: 'I', positivePole: 'E' })
    expect(POLE_META.SN).toMatchObject({ negativePole: 'S', positivePole: 'N' })
    expect(POLE_META.TF).toMatchObject({ negativePole: 'F', positivePole: 'T' })
    expect(POLE_META.JP).toMatchObject({ negativePole: 'J', positivePole: 'P' })
  })

  it('下限答卷（每维最低分）落负极、上限答卷（每维最高分）落正极', () => {
    const low = scoreQuestionnaire(extremeAnswers('left'), FIXTURE)
    const high = scoreQuestionnaire(extremeAnswers('right'), FIXTURE)
    for (const item of low.dimensions) {
      expect(item.score).toBeLessThan(FIXTURE.scoring.midpoint)
      expect(item.dominant).toBe(POLE_META[item.dimension].negativePole)
    }
    for (const item of high.dimensions) {
      expect(item.score).toBeGreaterThan(FIXTURE.scoring.midpoint)
      expect(item.dominant).toBe(POLE_META[item.dimension].positivePole)
    }
    expect(low.typeCode).toBe('ISFJ')
    expect(high.typeCode).toBe('ENTP')
  })

  it('每个维度都有中文名与两端标签（UI 不再各自硬编码一份）', () => {
    for (const dimension of DIMENSION_ORDER) {
      const meta = POLE_META[dimension]
      expect(meta.name.length).toBeGreaterThan(0)
      expect(meta.negativeLabel.length).toBeGreaterThan(0)
      expect(meta.positiveLabel.length).toBeGreaterThan(0)
      expect(meta.negativePole).not.toBe(meta.positivePole)
    }
  })
})

/**
 * 新默认包（IPIP-50 大五）的建标尺 —— 通用引擎不假设"四个 OEJTS 维度"。
 *
 * 上面那条「通用建标尺不再假设必须有四个维度」用的是内联 OEJTS fixture（缺 TF），
 * 这里把**站点实际默认的那份题库**算出来的数字钉住：五个维度、每维 10 题，
 * 且 min / max 完全由中点与题数推出（min = midpoint − 2×题数，max = midpoint + 2×题数），
 * 没有一处是写死的 8 / 40 / 24。
 */
describe('站点默认包（IPIP-50）的建标尺完全由题库推导', () => {
  const ipip = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'].questionnaire

  it('默认包确实换成了 IPIP-50，且它恰好建出五个维度标尺', () => {
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]).toBe(
      FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'],
    )
    const scales = buildDimensionScales(ipip)
    expect(Object.keys(scales)).toHaveLength(5)
    expect(Object.keys(scales)).toEqual(['E', 'A', 'C', 'ES', 'O'])
    expect(canScore(ipip)).toBe(true)
  })

  it('每维 min = midpoint − 2×题数、max = midpoint + 2×题数（中点 30、每维 10 题 → 10 / 50）', () => {
    const scales = buildDimensionScales(ipip)
    const midpoint = ipip.scoring.midpoint
    expect(midpoint).toBe(30)
    for (const scale of Object.values(scales)) {
      const count = scale.questions.length
      expect(count).toBe(10)
      expect(scale.midpoint).toBe(midpoint)
      expect(scale.min).toBe(midpoint - 2 * count)
      expect(scale.max).toBe(midpoint + 2 * count)
      // span 同样是推出来的：两侧对称时为 2×题数（OEJTS 是 16，IPIP-50 是 20）
      expect(scale.span).toBe(2 * count)
    }
  })

  it('dimensionOrderOf 取题库自己的顺序；OEJTS_DIMENSION_ORDER 不受默认包更换影响', () => {
    expect(dimensionOrderOf(ipip)).toEqual(['E', 'A', 'C', 'ES', 'O'])
    expect(OEJTS_DIMENSION_ORDER).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(dimensionOrderOf(ipip)).not.toEqual([...OEJTS_DIMENSION_ORDER])
  })
})
