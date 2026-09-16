import { describe, expect, it } from 'vitest'
import type { AssessmentPackage } from './assessmentPackage'
import { instrumentHasTypeCode, packageDimensionOrder, poleTokensOf } from './assessmentPackage'
import type { Dimension, Pole } from './types'
import type { Response, ResponseMap } from './answers'
import { analyzeAssessment, AssessmentError } from './assessment'
import type { AssessmentAnalysis, DimensionAnalysis } from './assessment'
import { buildDimensionReview, buildReportViewModel, responsesFingerprint } from './report'
import { presentationBand, statusForBand, DIMENSION_STATUS_LABEL } from './interpretation'
import { buildDimensionScales, DIMENSION_ORDER, NEGATIVE_POLE, POSITIVE_POLE, scoreQuestionnaire } from './scoring'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES, FALLBACK_QUESTIONNAIRE } from '@/content/fallback'
import { ratingsForOffsets } from '@/dev/seed'

/**
 * 分析模型 + 展示模型 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md`
 * §3.1–§3.4、§2.2–§2.3、§10.1。
 *
 * 这里钉住的核心不变量：
 *   1. 原始计分仍是 OEJTS 1.2 原公式（与旧入口 `scoreQuestionnaire` 同值）；
 *   2. 缺任一题数字答案 → 该维 `score = null`，**不补 3、不按比例补分**；
 *   3. `balanced` 没有主导侧；只有四维都 `leaning` 才拼出参考组合；
 *   4. 一个维度的变化不会改动其他三维的解释；
 *   5. 未定结果在展示模型（页面/图片/复制/文件名/无障碍）里不出现任何完整类型。
 */

/**
 * 站点默认包已换成 IPIP-50；本文件断言的是 OEJTS 的分值与解释政策，所以显式指名 OEJTS 包。
 *
 * `DEFAULT_PACKAGE_ID` 现在指向 `'ipip50-zh1'`，本文件的偏移扫描（8..40）、
 * `POLE_META` 字母、四维齐备与 ±16 可达性都是 OEJTS 专属语义，因此这里的 fixture
 * 不能再跟着默认包走。IPIP-50 的同一条解释政策由文件末尾独立的 describe 钉住。
 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

const pkg = FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage

/** 四维齐全的答案表：给定「原始分 − 中点」的目标偏移，构造 1–5 的合法作答。 */
function responsesWithOffsets(offsets: Partial<Record<Dimension, number>>): ResponseMap {
  const full: Partial<Record<Dimension, number>> = { EI: 0, SN: 0, TF: 0, JP: 0, ...offsets }
  const ratings = ratingsForOffsets(pkg.questionnaire.questions, full)
  return Object.fromEntries(
    Object.entries(ratings).map(([id, value]) => [id, { kind: 'rating', value } as Response]),
  ) as ResponseMap
}

function responsesUniform(value: 1 | 2 | 3 | 4 | 5): ResponseMap {
  return Object.fromEntries(
    pkg.questionnaire.questions.map((question) => [question.id, { kind: 'rating', value } as Response]),
  ) as ResponseMap
}

function responsesAllUnknown(): ResponseMap {
  return Object.fromEntries(
    pkg.questionnaire.questions.map((question) => [
      question.id,
      { kind: 'unknown', reason: 'unclear' } as Response,
    ]),
  ) as ResponseMap
}

function dimensionOf(analysis: AssessmentAnalysis, dimension: Dimension): DimensionAnalysis {
  const found = analysis.dimensions.find((item) => item.dimension === dimension)
  if (!found) throw new Error(`缺少维度 ${dimension}`)
  return found
}

/** 与 `dev/seed.ratingsForOffsets` 同一套算法的独立验算：确认 helper 真的做到了目标偏移。 */
function expectedScores(offsets: Partial<Record<Dimension, number>>): Record<Dimension, number> {
  const full = { EI: 0, SN: 0, TF: 0, JP: 0, ...offsets }
  return {
    EI: 24 + full.EI,
    SN: 24 + full.SN,
    TF: 24 + full.TF,
    JP: 24 + full.JP,
  } as Record<Dimension, number>
}

describe('helper 自检（先确认构造的答卷真的命中目标分数）', () => {
  it('responsesWithOffsets 的原始分与旧计分入口逐维一致', () => {
    const offsets = { EI: -12, SN: 8, TF: -4, JP: 15 }
    const responses = responsesWithOffsets(offsets)
    const analysis = analyzeAssessment(responses, pkg)
    const wanted = expectedScores(offsets)
    for (const dimension of DIMENSION_ORDER) {
      expect(dimensionOf(analysis, dimension).score, `${dimension} 原始分`).toBe(wanted[dimension])
    }
    // 同一份作答交给旧的全问卷入口，数值必须相同（分层不改变量表的算术）
    const numeric = Object.fromEntries(
      Object.entries(responses).map(([id, response]) => [
        Number(id),
        response.kind === 'rating' ? response.value : 3,
      ]),
    )
    const legacy = scoreQuestionnaire(numeric, FALLBACK_QUESTIONNAIRE)
    for (const item of legacy.dimensions) {
      expect(item.score).toBe(dimensionOf(analysis, item.dimension).score)
    }
  })

  it('偏移可达 8..40 的每一个整数（题数与符号允许 |δ| ≤ 16）', () => {
    for (let delta = -16; delta <= 16; delta += 1) {
      const analysis = analyzeAssessment(responsesWithOffsets({ EI: delta }), pkg)
      expect(dimensionOf(analysis, 'EI').score).toBe(24 + delta)
    }
  })
})

describe('解释政策：逐值扫过 8..40（§10.1）', () => {
  const CASES: ReadonlyArray<{ delta: number; status: DimensionAnalysis['status']; band: string }> = [
    { delta: 0, status: 'balanced', band: 'equal' },
    { delta: 1, status: 'tentative', band: 'slight' },
    { delta: 4, status: 'tentative', band: 'slight' },
    { delta: 5, status: 'leaning', band: 'moderate' },
    { delta: 8, status: 'leaning', band: 'moderate' },
    { delta: 9, status: 'leaning', band: 'marked' },
    { delta: 16, status: 'leaning', band: 'marked' },
  ]

  it('24 是唯一 balanced；20/28 为 tentative 上界；19/29 进入 leaning；15/33 进入 marked', () => {
    for (const item of CASES) {
      // δ=0 只有一种符号，不要用 -0 去测（+0/-0 在 toBe 下不相等）
      const deltas = item.delta === 0 ? [0] : [item.delta, -item.delta]
      for (const delta of deltas) {
        const analysis = analyzeAssessment(responsesWithOffsets({ EI: delta }), pkg)
        const ei = dimensionOf(analysis, 'EI')
        expect(ei.score, `δ=${delta}`).toBe(24 + delta)
        expect(ei.status, `δ=${delta} 状态`).toBe(item.status)
        expect(ei.presentationBand, `δ=${delta} 档位`).toBe(item.band)
        expect(ei.signedOffset).toBe(delta)
        // 只有 balanced 没有主导侧
        expect(ei.pole === null).toBe(item.status === 'balanced')
      }
    }
  })

  it('只有 δ=0 才是 balanced（33 个值里唯一一个）', () => {
    let balancedCount = 0
    for (let score = 8; score <= 40; score += 1) {
      const analysis = analyzeAssessment(responsesWithOffsets({ EI: score - 24 }), pkg)
      if (dimensionOf(analysis, 'EI').status === 'balanced') balancedCount += 1
    }
    expect(balancedCount).toBe(1)
  })

  it('presentationBand / statusForBand 的边界与包里的政策一致（不写死 5/9）', () => {
    const policy = { ...pkg.interpretation }
    expect(presentationBand(0, policy)).toBe('equal')
    expect(presentationBand(policy.typeMinDistance - 1, policy)).toBe('slight')
    expect(presentationBand(policy.typeMinDistance, policy)).toBe('moderate')
    expect(presentationBand(policy.markedDistance - 1, policy)).toBe('moderate')
    expect(presentationBand(policy.markedDistance, policy)).toBe('marked')
    expect(statusForBand('equal')).toBe('balanced')
    expect(statusForBand('slight')).toBe('tentative')
    expect(statusForBand('moderate')).toBe('leaning')
    expect(statusForBand('marked')).toBe('leaning')
    // 政策放宽后行为随之变化，说明没有写死数字
    expect(presentationBand(4, { ...policy, typeMinDistance: 4 })).toBe('moderate')
  })

  it('极性与 scoring.ts 的 POLE_META 同源（不出现第二份字母映射）', () => {
    const analysis = analyzeAssessment(responsesWithOffsets({ EI: 12, SN: -12 }), pkg)
    expect(dimensionOf(analysis, 'EI').pole).toBe(POSITIVE_POLE.EI)
    expect(dimensionOf(analysis, 'SN').pole).toBe(NEGATIVE_POLE.SN)
    expect(NEGATIVE_POLE).toEqual({ EI: 'I', SN: 'S', TF: 'F', JP: 'J' })
    expect(POSITIVE_POLE).toEqual({ EI: 'E', SN: 'N', TF: 'T', JP: 'P' })
  })
})

describe('信息不足：不补 3、不按比例补分、不缩短分母', () => {
  it('任一题 unknown 都让该维 score=null，且不影响其他维度', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: -12, TF: -12, JP: -12 })
    const eiQuestion = pkg.questionnaire.questions.find((question) => question.dimension === 'EI')!
    const withUnknown: ResponseMap = {
      ...responses,
      [eiQuestion.id]: { kind: 'unknown', reason: 'no_experience' },
    }
    const analysis = analyzeAssessment(withUnknown, pkg)
    const ei = dimensionOf(analysis, 'EI')
    expect(ei.status).toBe('insufficient')
    expect(ei.score).toBeNull()
    expect(ei.signedOffset).toBeNull()
    expect(ei.pole).toBeNull()
    expect(ei.counts).toBeNull()
    expect(ei.ratingCount).toBe(7)
    expect(ei.unknownIds).toEqual([eiQuestion.id])
    expect(ei.unansweredIds).toEqual([])
    // 其他三维照旧
    for (const dimension of ['SN', 'TF', 'JP'] as Dimension[]) {
      expect(dimensionOf(analysis, dimension).status).toBe('leaning')
      expect(dimensionOf(analysis, dimension).score).not.toBeNull()
    }
  })

  it('「没处理」与「无法判断」必须分开记录，且都不等于 3 分', () => {
    const responses = responsesWithOffsets({})
    const eiQuestions = pkg.questionnaire.questions.filter((question) => question.dimension === 'EI')
    const trimmed: ResponseMap = {}
    for (const question of pkg.questionnaire.questions) {
      if (question.id === eiQuestions[0].id) continue // 完全没处理
      if (question.id === eiQuestions[1].id) {
        trimmed[question.id] = { kind: 'unknown', reason: null } // 明确无法判断
        continue
      }
      trimmed[question.id] = responses[question.id]
    }
    const ei = dimensionOf(analyzeAssessment(trimmed, pkg), 'EI')
    expect(ei.unansweredIds).toEqual([eiQuestions[0].id])
    expect(ei.unknownIds).toEqual([eiQuestions[1].id])
    expect(ei.ratingCount).toBe(6)
    expect(ei.score).toBeNull()
    // 如果实现把「没处理」当成 3 分，这里就会得到一个可计分的分数
    expect(ei.status).toBe('insufficient')
  })

  it('unknown 换成数字后该维重新可计分（≠ 把 unknown 一直算 3）', () => {
    const responses = responsesWithOffsets({ EI: -12 })
    const eiQuestions = pkg.questionnaire.questions.filter((question) => question.dimension === 'EI')
    const withUnknown: ResponseMap = { ...responses, [eiQuestions[0].id]: { kind: 'unknown', reason: null } }
    expect(dimensionOf(analyzeAssessment(withUnknown, pkg), 'EI').score).toBeNull()

    const back = { ...withUnknown }
    const original = responses[eiQuestions[0].id]
    back[eiQuestions[0].id] = original
    expect(dimensionOf(analyzeAssessment(back, pkg), 'EI').score).toBe(12)
  })

  it('全 32 题无法判断时：四维都信息不足、没有分数、没有类型', () => {
    const analysis = analyzeAssessment(responsesAllUnknown(), pkg)
    expect(analysis.overallStatus).toBe('undetermined')
    expect(analysis.suggestedTypeCode).toBeNull()
    for (const item of analysis.dimensions) {
      expect(item.status).toBe('insufficient')
      expect(item.score).toBeNull()
      expect(item.ratingCount).toBe(0)
      expect(item.unknownIds).toHaveLength(8)
    }
    const report = buildReportViewModel(analysis, pkg, responsesAllUnknown())
    expect(report.share.kind).toBe('undetermined')
    expect(report.title).toBe(pkg.reportCopy.insufficientTitle)
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    for (const row of report.dimensionRows) {
      expect(row.position).toBeNull()
      expect(row.score).toBeNull()
      expect(row.ariaLabel).toContain(DIMENSION_STATUS_LABEL.insufficient)
    }
  })
})

describe('回答分布：按 centered 符号统计（§3.3）', () => {
  it('三个数相加恒等于该维题数', () => {
    for (const offsets of [{}, { EI: -12, SN: 8, TF: -4, JP: 15 }, { EI: 16, SN: -16 }]) {
      const analysis = analyzeAssessment(responsesWithOffsets(offsets), pkg)
      for (const item of analysis.dimensions) {
        expect(item.counts).not.toBeNull()
        const counts = item.counts!
        expect(counts.negative + counts.neutral + counts.positive).toBe(item.requiredCount)
      }
    }
  })

  it('全选 3 → 8 个 neutral；全选 1 / 全选 5 → 不全是 neutral（题目有正反号）', () => {
    const all3 = analyzeAssessment(responsesUniform(3), pkg)
    for (const item of all3.dimensions) {
      expect(item.counts).toEqual({ negative: 0, neutral: 8, positive: 0 })
    }
    const all1 = analyzeAssessment(responsesUniform(1), pkg)
    expect(all1.dimensions.some((item) => (item.counts?.neutral ?? 0) < 8)).toBe(true)
  })

  it('同分不同作答情况：全选 3 与「两侧相互抵消」都是中点分，但 counts 不同', () => {
    const uniform = analyzeAssessment(responsesWithOffsets({}), pkg)
    const opposing = analyzeAssessment(
      responsesWithOffsets({ EI: 0, SN: 0, TF: 0, JP: 0 }),
      pkg,
    )
    // 构造「每维 4 题 +2、4 题 −2」的抵消答卷
    const cancelling: ResponseMap = {}
    for (const dimension of DIMENSION_ORDER) {
      const questions = pkg.questionnaire.questions.filter((question) => question.dimension === dimension)
      questions.forEach((question, index) => {
        const centered = index < 4 ? 2 : -2
        const value = 3 + question.direction * centered
        cancelling[question.id] = { kind: 'rating', value: value as 1 | 2 | 3 | 4 | 5 }
      })
    }
    const cancelAnalysis = analyzeAssessment(cancelling, pkg)
    for (const item of cancelAnalysis.dimensions) {
      expect(item.score).toBe(24)
      expect(item.status).toBe('balanced')
      expect(item.counts).toEqual({ negative: 4, neutral: 0, positive: 4 })
    }
    // 与全选 3 同状态、不同事实
    expect(opposing.overallStatus).toBe(uniform.overallStatus)
    const uniformRow = buildReportViewModel(uniform, pkg, responsesUniform(3)).dimensionRows[0]
    const cancelRow = buildReportViewModel(cancelAnalysis, pkg, cancelling).dimensionRows[0]
    expect(uniformRow.details.join('\n')).not.toBe(cancelRow.details.join('\n'))
    expect(uniformRow.details.join('\n')).toContain('都选了')
    expect(cancelRow.details.join('\n')).toContain('相互抵消')
  })
})

describe('完整类型只在四维都达到展示条件时出现（§3.4 向量表）', () => {
  const VECTORS: ReadonlyArray<{
    label: string
    responses: () => ResponseMap
    scores: [number, number, number, number]
    overall: AssessmentAnalysis['overallStatus']
    typeCode: string | null
  }> = [
    {
      label: '全选 1',
      responses: () => responsesUniform(1),
      scores: [28, 16, 28, 20],
      // EI/TF/JP 距中点 4 分（tentative），只有 SN 达到展示条件
      overall: 'partial',
      typeCode: null,
    },
    {
      label: '全选 3',
      responses: () => responsesUniform(3),
      scores: [24, 24, 24, 24],
      overall: 'undetermined',
      typeCode: null,
    },
    {
      label: '全选 5',
      responses: () => responsesUniform(5),
      scores: [20, 32, 20, 28],
      overall: 'partial',
      typeCode: null,
    },
    {
      label: '各维推向负极（8/8/8/8）',
      responses: () =>
        Object.fromEntries(
          pkg.questionnaire.questions.map((question) => [
            question.id,
            {
              kind: 'rating',
              value: (question.direction === 1 ? 1 : 5) as 1 | 2 | 3 | 4 | 5,
            } as Response,
          ]),
        ) as ResponseMap,
      scores: [8, 8, 8, 8],
      overall: 'typed',
      typeCode: 'ISFJ',
    },
    {
      label: '各维推向正极（40/40/40/40）',
      responses: () =>
        Object.fromEntries(
          pkg.questionnaire.questions.map((question) => [
            question.id,
            {
              kind: 'rating',
              value: (question.direction === 1 ? 5 : 1) as 1 | 2 | 3 | 4 | 5,
            } as Response,
          ]),
        ) as ResponseMap,
      scores: [40, 40, 40, 40],
      overall: 'typed',
      typeCode: 'ENTP',
    },
    {
      label: '−12/+8/−8/+10 的合法答卷',
      responses: () => responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 }),
      scores: [12, 32, 16, 34],
      overall: 'typed',
      typeCode: 'INFP',
    },
    {
      label: '−12/+4/−8/+10 的合法答卷（SN 只差 1 分就够）',
      responses: () => responsesWithOffsets({ EI: -12, SN: 4, TF: -8, JP: 10 }),
      scores: [12, 28, 16, 34],
      overall: 'partial',
      typeCode: null,
    },
  ]

  for (const vector of VECTORS) {
    it(`${vector.label} → ${vector.scores.join('/')}，${vector.overall}，类型 ${String(vector.typeCode)}`, () => {
      const responses = vector.responses()
      const analysis = analyzeAssessment(responses, pkg)
      expect(analysis.dimensions.map((item) => item.score)).toEqual(vector.scores)
      expect(analysis.overallStatus).toBe(vector.overall)
      expect(analysis.suggestedTypeCode).toBe(vector.typeCode)
      // 未定时必须为空 —— 绝不允许回退成某个默认类型
      if (vector.typeCode === null) expect(analysis.suggestedTypeCode).toBeNull()
    })
  }

  it('16 种参考组合都可达，且方向与内容包的两侧标签一致', () => {
    const reached = new Set<string>()
    for (let mask = 0; mask < 16; mask += 1) {
      const offsets: Partial<Record<Dimension, number>> = {}
      DIMENSION_ORDER.forEach((dimension, index) => {
        offsets[dimension] = (mask >> index) & 1 ? 12 : -12
      })
      const analysis = analyzeAssessment(responsesWithOffsets(offsets), pkg)
      expect(analysis.overallStatus).toBe('typed')
      const code = analysis.suggestedTypeCode!
      expect(code).toMatch(/^[EISNTFJP]{4}$/)
      analysis.dimensions.forEach((item, index) => {
        const dimension = DIMENSION_ORDER[index]
        const expectedPole: Pole = offsets[dimension]! > 0 ? POSITIVE_POLE[dimension] : NEGATIVE_POLE[dimension]
        expect(item.pole).toBe(expectedPole)
        const row = buildReportViewModel(analysis, pkg, responsesWithOffsets(offsets)).dimensionRows[index]
        const expectedLabel =
          expectedPole === NEGATIVE_POLE[dimension]
            ? pkg.dimensionCopy[dimension].negative.label
            : pkg.dimensionCopy[dimension].positive.label
        expect(row.summary).toContain(expectedLabel)
      })
      reached.add(code)
    }
    expect(reached.size).toBe(16)
  })
})

describe('展示模型：未定结果不在任何渠道出现完整类型（§7.4 / §10.3）', () => {
  const ALL_CODES = [
    'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
    'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP',
  ]

  function expectNoTypeCode(actual: string, where: string) {
    for (const code of ALL_CODES) {
      expect(actual, `${where} 不应出现类型码 ${code}`).not.toContain(code)
    }
  }

  it('全中立：标题/副标题/分享文案/文件名/无障碍名称都没有类型码', () => {
    const responses = responsesUniform(3)
    const analysis = analyzeAssessment(responses, pkg)
    const report = buildReportViewModel(analysis, pkg, responses)
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('undetermined')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.filename).toBe('typeme-profile-undetermined.png')
    expect(report.title).toBe(pkg.reportCopy.undeterminedTitle)
    expect(report.subtitle).toBe(pkg.reportCopy.undeterminedSubtitle)
    expectNoTypeCode(report.title, 'title')
    expectNoTypeCode(report.subtitle, 'subtitle')
    expectNoTypeCode(report.share.text, 'share.text')
    expectNoTypeCode(report.share.alt, 'share.alt')
    expectNoTypeCode(report.share.filename, 'share.filename')
    expectNoTypeCode(report.share.imageTitle, 'share.imageTitle')
    // 也不出现任何类型描述名（例如 ISFJ 的「细节照顾者」）
    expect(report.share.text).not.toContain('细节照顾者')
    expect(report.share.alt).not.toContain('细节照顾者')
    // 每一维都没有主导侧
    for (const row of report.dimensionRows) {
      expect(row.pole).toBeNull()
      expect(row.status).toBe('balanced')
    }
  })

  it('部分未定：完整类型不出现，但可给出方向的维度照常显示', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 4, TF: -8, JP: 10 })
    const analysis = analyzeAssessment(responses, pkg)
    const report = buildReportViewModel(analysis, pkg, responses)
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('partial')
    expect(report.share.filename).toBe('typeme-profile-partial.png')
    expectNoTypeCode(report.share.text, 'share.text')
    expectNoTypeCode(report.share.alt, 'share.alt')
    expect(report.share.text).toContain('没有形成完整参考类型')
    expect(report.share.text).toContain('I')
    expect(report.share.text).toContain('S/N 待观察')
    const sn = report.dimensionRows.find((row) => row.dimension === 'SN')!
    expect(sn.status).toBe('tentative')
    // SN 的正极是 N（数值高侧），δ=+4 因此落在 N 一侧，但只是「待观察」
    expect(sn.pole).toBe('N')
  })

  it('信息不足的维度不显示 0 分、不画数值点', () => {
    const responses = responsesWithOffsets({ EI: -10, TF: 10, JP: 10 })
    const snQuestions = pkg.questionnaire.questions.filter((question) => question.dimension === 'SN')
    snQuestions.forEach((question, index) => {
      responses[question.id] = index < 3 ? { kind: 'rating', value: 3 } : { kind: 'unknown', reason: null }
    })
    const analysis = analyzeAssessment(responses, pkg)
    expect(analysis.overallStatus).toBe('partial')
    const report = buildReportViewModel(analysis, pkg, responses)
    const sn = report.dimensionRows.find((row) => row.dimension === 'SN')!
    expect(sn.status).toBe('insufficient')
    expect(sn.position).toBeNull()
    expect(sn.score).toBeNull()
    // 「信息不足」必须出现在状态行与无障碍名称里，而不是被写成 0 分
    expect(sn.summary).toContain('信息不足')
    expect(sn.ariaLabel).toContain('信息不足')
    expect(sn.details.join('\n')).toContain('不计算这一维的分数')
    expect(sn.details.join('\n')).not.toContain('得分 0')
    expect(sn.details.join('\n')).not.toContain('0%')
  })

  it('有参考组合时：四字母、文件名、文案方向一致', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const analysis = analyzeAssessment(responses, pkg)
    const report = buildReportViewModel(analysis, pkg, responses)
    expect(report.suggestedTypeCode).toBe('INFP')
    expect(report.share.kind).toBe('typed')
    expect(report.share.headline).toBe('INFP')
    expect(report.share.typeLine).toContain('INFP')
    expect(report.share.filename).toBe('typeme-profile-INFP.png')
    expect(report.share.text).toContain('INFP')
    expect(report.share.alt).toContain('INFP')
    expect(report.title).toBe(pkg.reportCopy.typedTitle)
  })

  it('展示模型里没有逐题答案：序列化后不含任何题面文字', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const report = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses)
    const serialized = JSON.stringify(report)
    for (const question of pkg.questionnaire.questions) {
      expect(serialized, `报告模型里不应出现 Q${question.id} 的题面`).not.toContain(question.textLeft)
    }
    // 回看数据是单独的函数，明确带出题面与选择（只给结果页用）
    const review = buildDimensionReview(pkg, responses)
    expect(review).toHaveLength(4)
    const firstItem = review.flatMap((group) => group.items).find((item) => item.id === 1)
    expect(firstItem, '回看数据必须覆盖到第 1 题').toBeDefined()
    expect(firstItem!.text).toBe(
      `${pkg.questionnaire.questions[0].textLeft} / ${pkg.questionnaire.questions[0].textRight}`,
    )
    expect(firstItem!.state).toBe('rating')
    expect(firstItem!.rating).toBe(responses[1].kind === 'rating' ? responses[1].value : null)
    expect(firstItem!.explanation).toBe(pkg.itemHelp['1'].explanation)
    // 无法判断的原因也带出来（本地回顾用，不外发）
    const unknownResponses: ResponseMap = { ...responses, 1: { kind: 'unknown', reason: 'unclear' } }
    const unknownItem = buildDimensionReview(pkg, unknownResponses)
      .flatMap((group) => group.items)
      .find((item) => item.id === 1)!
    expect(unknownItem.state).toBe('unknown')
    expect(unknownItem.rating).toBeNull()
    expect(unknownItem.reason).toBe('unclear')
  })
})

describe('不变量：一个维度改变不影响其它三维的解释（反例测试）', () => {
  it('只把 SN 从 leaning 降到 tentative：EI/TF/JP 的 details 与 actions 逐条不变', () => {
    const typedResponses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const partialResponses = responsesWithOffsets({ EI: -12, SN: 4, TF: -8, JP: 10 })
    const typed = buildReportViewModel(
      analyzeAssessment(typedResponses, pkg),
      pkg,
      typedResponses,
    )
    const partial = buildReportViewModel(
      analyzeAssessment(partialResponses, pkg),
      pkg,
      partialResponses,
    )
    expect(typed.suggestedTypeCode).toBe('INFP')
    expect(partial.suggestedTypeCode).toBeNull()

    for (const dimension of ['EI', 'TF', 'JP'] as Dimension[]) {
      const a = typed.dimensionRows.find((row) => row.dimension === dimension)!
      const b = partial.dimensionRows.find((row) => row.dimension === dimension)!
      expect(b.summary, `${dimension} summary`).toBe(a.summary)
      expect(b.details, `${dimension} details`).toStrictEqual(a.details)
      expect(b.actions, `${dimension} actions`).toStrictEqual(a.actions)
      expect(b.ariaLabel, `${dimension} ariaLabel`).toBe(a.ariaLabel)
      expect(b.position).toBe(a.position)
    }
    // SN 自己确实变了
    const snTyped = typed.dimensionRows.find((row) => row.dimension === 'SN')!
    const snPartial = partial.dimensionRows.find((row) => row.dimension === 'SN')!
    expect(snTyped.status).toBe('leaning')
    expect(snPartial.status).toBe('tentative')
    expect(snPartial.details).not.toBe(snTyped.details)
  })

  it('同一维相同作答与状态得到相同解释（同模型同输出）', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const first = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses)
    const second = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses)
    expect(second).toEqual(first)
  })

  it('容器里的解释文案只来自本维：不含其他维度的关键词句', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const report = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses)
    for (const row of report.dimensionRows) {
      const text = row.details.join('\n')
      for (const other of DIMENSION_ORDER.filter((item) => item !== row.dimension)) {
        // 只允许出现本维的两侧标签；其他维的标签不得混入
        const foreignLabels = [
          pkg.dimensionCopy[other].negative.label,
          pkg.dimensionCopy[other].positive.label,
        ]
        for (const label of foreignLabels) {
          expect(text, `${row.dimension} 的解释里混入了 ${other} 的「${label}」`).not.toContain(label)
        }
      }
    }
  })
})

describe('报告身份：改答即失效', () => {
  it('reportId 依赖回答；改一题就变，重算不变', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8, TF: -8, JP: 10 })
    const id1 = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses).reportId
    const id2 = buildReportViewModel(analyzeAssessment(responses, pkg), pkg, responses).reportId
    expect(id2).toBe(id1)

    const changed = { ...responses }
    const target = pkg.questionnaire.questions.find((question) => question.dimension === 'SN')!
    const original = changed[target.id]
    const value = original.kind === 'rating' ? original.value : 3
    changed[target.id] = { kind: 'rating', value: value === 5 ? 4 : ((value + 1) as 1 | 2 | 3 | 4 | 5) }
    const id3 = buildReportViewModel(analyzeAssessment(changed, pkg), pkg, changed).reportId
    expect(id3).not.toBe(id1)
  })

  it('reportId 含 packageId 与解释政策版本（换内容版本即失效）', () => {
    const responses = responsesWithOffsets({})
    const analysis = analyzeAssessment(responses, pkg)
    const shifted: AssessmentPackage = {
      ...pkg,
      packageId: 'oejts32-zh2-preview-r1',
    }
    const other = buildReportViewModel(analysis, shifted, responses)
    const base = buildReportViewModel(analysis, pkg, responses)
    expect(other.reportId).not.toBe(base.reportId)
    expect(base.reportId).toContain(pkg.packageId)
    expect(base.reportId).toContain(pkg.interpretation.version)
  })

  it('指纹只区分回答内容，不受对象键顺序影响', () => {
    const responses = responsesWithOffsets({ EI: -4 })
    const reversed = Object.fromEntries(Object.entries(responses).reverse()) as ResponseMap
    const ids = pkg.questionnaire.questions.map((question) => question.id)
    expect(responsesFingerprint(reversed, ids)).toBe(responsesFingerprint(responses, ids))
    const idsReordered = [...ids].reverse()
    expect(responsesFingerprint(responses, idsReordered)).toBe(responsesFingerprint(responses, ids))
  })
})

describe('错误处理：内容/数据异常在计算前拦截，不用裁剪分数掩盖', () => {
  it('题库里有非法方向时抛错（ScoringError）', () => {
    const bad: AssessmentPackage = {
      ...pkg,
      questionnaire: {
        ...pkg.questionnaire,
        questions: pkg.questionnaire.questions.map((question) =>
          question.id === 3 ? { ...question, direction: 0 as 1 } : question,
        ),
      },
    }
    expect(() => analyzeAssessment(responsesUniform(3), bad)).toThrowError()
  })

  it('题库缺一整个维度时抛错', () => {
    const bad: AssessmentPackage = {
      ...pkg,
      questionnaire: {
        ...pkg.questionnaire,
        questions: pkg.questionnaire.questions.filter((question) => question.dimension !== 'TF'),
      },
    }
    expect(() => analyzeAssessment(responsesUniform(3), bad)).toThrowError()
  })

  it('AssessmentError 用来说明「数据本身自相矛盾」这一类拒绝', () => {
    // 直接验证错误类型可被页面区分（不 replace 回答题页）
    const error = new AssessmentError('示例')
    expect(error.name).toBe('AssessmentError')
    expect(error).toBeInstanceOf(Error)
  })
})

/**
 * 新默认包：IPIP-50 大五。
 *
 * 站点默认内容包已从 OEJTS-32 换成 IPIP-50，所以「缺答不计分」「conservative
 * 展示档位」「不拼类型码」这些解释政策不能只在 OEJTS 上被钉住 —— 那正是本轮
 * 换默认包最容易悄悄丢掉的覆盖。本块**只新增**断言，不改动上面任何一条。
 *
 * 与 OEJTS 的三处结构差异在这里被显式钉住：
 *   1. 维度是 5 个（E/A/C/ES/O），不是 4 个；
 *   2. 每维 10 题、中点 30、区间 10–50，不是 8 题 / 24 / 8–40；
 *   3. `instrument.hasTypeCode === false`，因此五维都有方向也只写结论，不拼码。
 */
describe('新默认包 IPIP-50（大五）：五维、无类型码，缺答同样不计分', () => {
  /** 站点默认包 = IPIP-50；这里读的正是 `DEFAULT_PACKAGE_ID`，确认默认包真的换了。 */
  const ipip = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] as AssessmentPackage
  const IPIP_DIMENSION_ORDER = ['E', 'A', 'C', 'ES', 'O'] as const

  /** IPIP 每维 10 题（OEJTS 是 8 题），所以 `ratingsForOffsets` 的 8 题假设不适用，单列一套 helper。 */
  function ipipUniform(value: 1 | 2 | 3 | 4 | 5): ResponseMap {
    return Object.fromEntries(
      ipip.questionnaire.questions.map((question) => [
        question.id,
        { kind: 'rating', value } as Response,
      ]),
    ) as ResponseMap
  }

  function ipipAllUnknown(): ResponseMap {
    return Object.fromEntries(
      ipip.questionnaire.questions.map((question) => [
        question.id,
        { kind: 'unknown', reason: 'unclear' } as Response,
      ]),
    ) as ResponseMap
  }

  /** 把某一维推到该侧极端（正号题与负号题取相反的值），其余维度保持中立 3。 */
  function ipipExtreme(dimension: Dimension, end: 'low' | 'high'): ResponseMap {
    const responses: ResponseMap = {}
    for (const question of ipip.questionnaire.questions) {
      const positive = question.direction === 1
      const value: 1 | 2 | 3 | 4 | 5 =
        question.dimension !== dimension
          ? 3
          : end === 'high'
            ? positive
              ? 5
              : 1
            : positive
              ? 1
              : 5
      responses[question.id] = { kind: 'rating', value }
    }
    return responses
  }

  /** 五个维度一起推到同一侧极端：用来验证「每维都有方向，但量表不产类型码」。 */
  function ipipAllExtreme(end: 'low' | 'high'): ResponseMap {
    const responses: ResponseMap = {}
    for (const question of ipip.questionnaire.questions) {
      const positive = question.direction === 1
      const value: 1 | 2 | 3 | 4 | 5 = end === 'high' ? (positive ? 5 : 1) : positive ? 1 : 5
      responses[question.id] = { kind: 'rating', value }
    }
    return responses
  }

  /** IPIP 每维 10 题：逐题分配 ±2、余下 1 分用 ±1，可覆盖 −20..20 的任意整数偏移。 */
  function ipipResponsesWithOffset(dimension: Dimension, offset: number): ResponseMap {
    const sign = offset < 0 ? -1 : 1
    let remaining = Math.abs(offset)
    const responses: ResponseMap = {}
    for (const question of ipip.questionnaire.questions) {
      if (question.dimension !== dimension) {
        responses[question.id] = { kind: 'rating', value: 3 }
        continue
      }
      let centered = 0
      if (remaining >= 2) {
        centered = 2 * sign
        remaining -= 2
      } else if (remaining === 1) {
        centered = sign
        remaining = 0
      }
      const value = 3 + question.direction * centered
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error(`题目 #${question.id} 无法用 1–5 表达 centered=${centered}`)
      }
      responses[question.id] = { kind: 'rating', value: value as 1 | 2 | 3 | 4 | 5 }
    }
    if (remaining !== 0) throw new Error(`${dimension} 的目标偏移 ${offset} 未能完全分配`)
    return responses
  }

  it('默认包就是 ipip50-zh1；维度顺序与维度数由包声明（5 维：E/A/C/ES/O）', () => {
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]).toBe(ipip)
    expect(ipip.dimensionOrder).toEqual([...IPIP_DIMENSION_ORDER])
    expect(packageDimensionOrder(ipip)).toEqual([...IPIP_DIMENSION_ORDER])

    const responses = ipipUniform(3)
    const analysis = analyzeAssessment(responses, ipip)
    expect(analysis.dimensions).toHaveLength(5)
    expect(analysis.dimensions.map((item) => item.dimension)).toEqual([...IPIP_DIMENSION_ORDER])

    const report = buildReportViewModel(analysis, ipip, responses)
    expect(report.dimensionCount).toBe(5)
    expect(report.dimensionRows.map((row) => row.dimension)).toEqual([...IPIP_DIMENSION_ORDER])

    // 大五不是类型量表：这一条后面所有「不拼码」的断言都建立在它之上
    expect(instrumentHasTypeCode(ipip)).toBe(false)
    expect(ipip.instrument.hasTypeCode).toBe(false)
  })

  it('中点 30 与逐维常量 {E:30,A:24,C:24,ES:48,O:18} 都读自包，并与字面量、量尺一致', () => {
    const constants = ipip.questionnaire.scoring.constants
    const LITERAL: Record<string, number> = { E: 30, A: 24, C: 24, ES: 48, O: 18 }
    const scales = buildDimensionScales(ipip.questionnaire)

    expect(ipip.questionnaire.scoring.midpoint).toBe(30)
    // 包对象与字面量各断言一次：既证明数字来自内容包，也证明它确实等于约定值
    expect(ipip.questionnaire.scoring).toEqual({ midpoint: 30, constants: LITERAL })
    expect(constants).toEqual(LITERAL)
    expect(ipip.interpretation.minRatingsPerDimension).toBe(10)
    expect(ipip.interpretation.minRatingsPerDimension).toBe(scales.E.questions.length)

    for (const dimension of IPIP_DIMENSION_ORDER) {
      expect(constants[dimension], `${dimension} 常量（包）`).toBe(LITERAL[dimension])
      expect(scales[dimension].constant, `${dimension} 常量（量尺）`).toBe(constants[dimension])
      expect(scales[dimension].constant, `${dimension} 常量（字面量）`).toBe(LITERAL[dimension])
      expect(scales[dimension].midpoint, `${dimension} 中点（字面量）`).toBe(30)
      expect(scales[dimension].midpoint, `${dimension} 中点（包）`).toBe(
        ipip.questionnaire.scoring.midpoint,
      )
      expect(scales[dimension].questions).toHaveLength(10)
      // 每题都选「谈不上贴切或不贴切」（3）时正好落在中点 —— 与 OEJTS 同一条配平关系
      const sumDirection = scales[dimension].questions.reduce(
        (sum, question) => sum + question.direction,
        0,
      )
      expect(scales[dimension].constant + 3 * sumDirection).toBe(30)
    }

    // 五维常量与 OEJTS 的四维常量不同 → 默认包确实换了，而不是把 OEJTS 的数字抄过来
    expect(constants).not.toEqual(
      (FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage).questionnaire.scoring
        .constants,
    )
  })

  it('E 维：区间 10–50，两端都 leaning，全选 3 落在中点 balanced', () => {
    const scales = buildDimensionScales(ipip.questionnaire)
    expect(scales.E.questions).toHaveLength(10)
    expect(scales.E.min).toBe(10)
    expect(scales.E.max).toBe(50)
    // 区间也能由「中点 ± 2×题数」推出来，不只是抄了两个上界下界
    expect(scales.E.min).toBe(30 - 2 * scales.E.questions.length)
    expect(scales.E.max).toBe(30 + 2 * scales.E.questions.length)

    const neutral = dimensionOf(analyzeAssessment(ipipUniform(3), ipip), 'E')
    expect(neutral.score).toBe(30)
    expect(neutral.status).toBe('balanced')
    expect(neutral.pole).toBeNull()

    const low = analyzeAssessment(ipipExtreme('E', 'low'), ipip)
    const eLow = dimensionOf(low, 'E')
    expect(eLow.score).toBe(10)
    expect(eLow.signedOffset).toBe(-20)
    expect(eLow.status).toBe('leaning')
    expect(eLow.pole).toBe(poleTokensOf(ipip, 'E').low)
    expect(eLow.pole).toBe('低')

    const high = analyzeAssessment(ipipExtreme('E', 'high'), ipip)
    const eHigh = dimensionOf(high, 'E')
    expect(eHigh.score).toBe(50)
    expect(eHigh.signedOffset).toBe(20)
    expect(eHigh.status).toBe('leaning')
    expect(eHigh.pole).toBe(poleTokensOf(ipip, 'E').high)
    expect(eHigh.pole).toBe('高')

    // 只有 E 有方向 → partial；其余四维保持中立
    for (const dimension of ['A', 'C', 'ES', 'O'] as Dimension[]) {
      const item = dimensionOf(low, dimension)
      expect(item.status, `${dimension} 保持中立`).toBe('balanced')
      expect(item.score, `${dimension} 仍在中点`).toBe(30)
    }
    expect(low.overallStatus).toBe('partial')
    expect(low.suggestedTypeCode).toBeNull()
  })

  it('五维都有方向也只写结论、不拼类型码（hasTypeCode = false）', () => {
    for (const end of ['low', 'high'] as const) {
      const responses = ipipAllExtreme(end)
      const analysis = analyzeAssessment(responses, ipip)
      expect(analysis.overallStatus).toBe('typed')
      expect(analysis.suggestedTypeCode).toBeNull()
      for (const item of analysis.dimensions) {
        expect(item.status).toBe('leaning')
        expect(item.pole).toBe(poleTokensOf(ipip, item.dimension)[end])
      }

      const report = buildReportViewModel(analysis, ipip, responses)
      expect(report.hasTypeCode).toBe(false)
      expect(report.suggestedTypeCode).toBeNull()
      // 五维都有方向但量表不是类型量表 → `clear`（有结论、没有码），不是 `typed`
      expect(report.share.kind).toBe('clear')
      expect(report.share.headline).toBeNull()
      expect(report.share.typeLine).toBeNull()
      expect(report.share.filename).toBe('typeme-profile-clear.png')
    }
  })

  it('档位边界同样由 IPIP 包给出（6 分才 leaning、11 分才 marked），10..50 逐值可达', () => {
    const policy = ipip.interpretation
    expect(policy).toEqual({
      version: 'typeme-conservative-v2',
      minRatingsPerDimension: 10,
      typeMinDistance: 6,
      markedDistance: 11,
    })
    expect(presentationBand(policy.typeMinDistance - 1, policy)).toBe('slight')
    expect(presentationBand(policy.typeMinDistance, policy)).toBe('moderate')
    expect(presentationBand(policy.markedDistance - 1, policy)).toBe('moderate')
    expect(presentationBand(policy.markedDistance, policy)).toBe('marked')

    const CASES: ReadonlyArray<{ delta: number; status: DimensionAnalysis['status']; band: string }> = [
      { delta: 0, status: 'balanced', band: 'equal' },
      { delta: 1, status: 'tentative', band: 'slight' },
      { delta: 5, status: 'tentative', band: 'slight' },
      { delta: 6, status: 'leaning', band: 'moderate' },
      { delta: 10, status: 'leaning', band: 'moderate' },
      { delta: 11, status: 'leaning', band: 'marked' },
      { delta: 20, status: 'leaning', band: 'marked' },
    ]
    for (const item of CASES) {
      // δ=0 只有一种符号，不要用 -0 去测（+0/-0 在 toBe 下不相等）
      const deltas = item.delta === 0 ? [0] : [item.delta, -item.delta]
      for (const delta of deltas) {
        const e = dimensionOf(analyzeAssessment(ipipResponsesWithOffset('E', delta), ipip), 'E')
        expect(e.score, `δ=${delta}`).toBe(30 + delta)
        expect(e.status, `δ=${delta} 状态`).toBe(item.status)
        expect(e.presentationBand, `δ=${delta} 档位`).toBe(item.band)
        expect(e.signedOffset).toBe(delta)
      }
    }

    // 10..50 的每一个整数都能表达（共 41 个值）；其中只有中点 30 是 balanced
    let balancedCount = 0
    for (let score = 10; score <= 50; score += 1) {
      const e = dimensionOf(analyzeAssessment(ipipResponsesWithOffset('E', score - 30), ipip), 'E')
      expect(e.score).toBe(score)
      if (e.status === 'balanced') balancedCount += 1
    }
    expect(balancedCount).toBe(1)
  })

  it('未知/缺答一律 insufficient（score=null），不会静默按 3 计分', () => {
    const allUnknown = analyzeAssessment(ipipAllUnknown(), ipip)
    expect(allUnknown.overallStatus).toBe('undetermined')
    expect(allUnknown.suggestedTypeCode).toBeNull()
    for (const item of allUnknown.dimensions) {
      expect(item.status).toBe('insufficient')
      expect(item.score).toBeNull()
      expect(item.signedOffset).toBeNull()
      expect(item.pole).toBeNull()
      expect(item.counts).toBeNull()
      expect(item.ratingCount).toBe(0)
      expect(item.unknownIds).toHaveLength(10)
      expect(item.unansweredIds).toEqual([])
    }

    const neutral = ipipUniform(3)
    const eQuestions = ipip.questionnaire.questions.filter((question) => question.dimension === 'E')
    expect(eQuestions).toHaveLength(10)

    const withUnknown: ResponseMap = {
      ...neutral,
      [eQuestions[0].id]: { kind: 'unknown', reason: 'no_experience' },
    }
    const unknownAnalysis = analyzeAssessment(withUnknown, ipip)
    const eUnknown = dimensionOf(unknownAnalysis, 'E')
    expect(eUnknown.status).toBe('insufficient')
    expect(eUnknown.score).toBeNull()
    expect(eUnknown.unknownIds).toEqual([eQuestions[0].id])
    expect(eUnknown.ratingCount).toBe(eQuestions.length - 1)

    // 其他四维不受影响，仍落在中点
    for (const dimension of ['A', 'C', 'ES', 'O'] as Dimension[]) {
      const item = dimensionOf(unknownAnalysis, dimension)
      expect(item.score, `${dimension} 原始分`).toBe(30)
      expect(item.status).toBe('balanced')
    }

    // 展示模型里也不显示 0 分、不画数值点
    const report = buildReportViewModel(unknownAnalysis, ipip, withUnknown)
    const eRow = report.dimensionRows.find((row) => row.dimension === 'E')!
    expect(eRow.status).toBe('insufficient')
    expect(eRow.position).toBeNull()
    expect(eRow.score).toBeNull()
    expect(eRow.ariaLabel).toContain(DIMENSION_STATUS_LABEL.insufficient)

    // 「完全没处理」与「无法判断」分开记录，两者都不用 3 兜底
    const missing: ResponseMap = { ...neutral }
    delete missing[eQuestions[1].id]
    const eMissing = dimensionOf(analyzeAssessment(missing, ipip), 'E')
    expect(eMissing.status).toBe('insufficient')
    expect(eMissing.score).toBeNull()
    expect(eMissing.unansweredIds).toEqual([eQuestions[1].id])
    expect(eMissing.unknownIds).toEqual([])
    expect(eMissing.ratingCount).toBe(eQuestions.length - 1)

    // 把 unknown 换成数字后重新可计分（说明之前真的是「不计分」而不是「算成 3」）
    const repaired: ResponseMap = {
      ...withUnknown,
      [eQuestions[0].id]: { kind: 'rating', value: 3 },
    }
    expect(dimensionOf(analyzeAssessment(repaired, ipip), 'E').score).toBe(30)
  })
})
