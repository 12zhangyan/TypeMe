import { describe, expect, it } from 'vitest'
import { buildReportView, insufficientDimensionNames, ReportShapeError } from './reportV3'
import type { Dimension } from './jung/types'

/**
 * `report_json` → 视图模型 的契约测试。
 *
 * 夹具**手写**成与 `JungReportBuilder`（Java）实际产出的形状一致：
 * 顶层字段名、`dimensions[]` 的行内字段、`candidates[].differsOn` 的维度名列表，
 * 都照实现来。这样这份测试就能回答一个具体问题：
 * "后端真的按契约发来这样一份 JSON 时，页面渲染出来的东西对吗"。
 *
 * 覆盖的是本任务最容易做错的几件事：
 *   1. 四种状态各自的**标题形态**（TIED 主标题不含四字母；TENTATIVE 含"更接近"）；
 *   2. `cost` 的文案里不许出现"概率/准确率/可能性"这类说法；
 *   3. 字段缺失时**抛错**，而不是猜一个默认值；
 *   4. 平分/边界维度必须同时给两端描述。
 *   5. 过程层（`dynamics` / `processPlan`）：**缺失或 null 都读成 null**（TIED 合法为空、
 *      旧快照也没有这两个键），但有四字母时"只给一半"或"结构与四字母对不上"必须大声抛错 ——
 *      那两种情况下页面会拿另一型的结构去解释这一型，而输出看起来完全正常。
 */

interface RowSpec {
  dimension: Dimension
  computedPole: string | null
  details: string[]
  // 下面这几项不传就用维度文案表里的默认值（夹具只关心"这一行要测什么"）
  name?: string
  negativePole?: string
  negativeLabel?: string
  positivePole?: string
  positiveLabel?: string
  boundary?: boolean
  position?: number | null
  mFinal?: number | null
  nFinal?: number
  nBase?: number
  nClar?: number
  baseRatingCount?: number
  baseUnknownCount?: number
  baseUnprocessedCount?: number
  coverageOk?: boolean
  clarificationScheduled?: boolean
  clarificationSkipped?: boolean
  clarificationApplied?: boolean
}

const DIMENSION_COPY: Record<
  Dimension,
  { name: string; negativePole: string; negativeLabel: string; positivePole: string; positiveLabel: string }
> = {
  EI: { name: '精力方向', negativePole: 'I', negativeLabel: '内倾', positivePole: 'E', positiveLabel: '外倾' },
  SN: { name: '信息偏好', negativePole: 'S', negativeLabel: '实感', positivePole: 'N', positiveLabel: '直觉' },
  TF: { name: '判断依据', negativePole: 'T', negativeLabel: '思考', positivePole: 'F', positiveLabel: '情感' },
  JP: { name: '生活方式', negativePole: 'J', negativeLabel: '计划', positivePole: 'P', positiveLabel: '随性' },
}

function row(spec: RowSpec): Record<string, unknown> {
  const copy = DIMENSION_COPY[spec.dimension]
  const nFinal = spec.nFinal ?? 12
  const coverageOk = spec.coverageOk ?? true
  return {
    dimension: spec.dimension,
    name: spec.name || copy.name,
    question: '这一维问的是什么',
    negativePole: spec.negativePole || copy.negativePole,
    negativeLabel: spec.negativeLabel || copy.negativeLabel,
    positivePole: spec.positivePole || copy.positivePole,
    positiveLabel: spec.positiveLabel || copy.positiveLabel,
    computedPole: spec.computedPole,
    tiedSide:
      spec.computedPole === null
        ? 'tied'
        : spec.computedPole === (spec.positivePole || copy.positivePole)
          ? 'positive'
          : 'negative',
    SBase: 6,
    nBase: spec.nBase ?? nFinal,
    mBase: 0.25,
    SClar: 0,
    nClar: spec.nClar ?? 0,
    mClar: null,
    SFinal: 6,
    nFinal,
    mFinal: spec.mFinal === undefined ? (spec.computedPole === null ? 0 : 0.25) : spec.mFinal,
    position: spec.position === undefined ? (spec.computedPole === null ? 0.5 : 0.625) : spec.position,
    boundary: spec.boundary ?? false,
    baseRatingCount: spec.baseRatingCount ?? 12,
    baseUnknownCount: spec.baseUnknownCount ?? 0,
    baseUnprocessedCount: spec.baseUnprocessedCount ?? 0,
    clarificationScheduled: spec.clarificationScheduled ?? false,
    clarificationSkipped: spec.clarificationSkipped ?? false,
    clarificationApplied: spec.clarificationApplied ?? false,
    clarificationRatingCount: spec.nClar ?? 0,
    coverageOk,
    details: spec.details,
    dailySigns: ['日常迹象一'],
  }
}

const STRONG_EI = row({
  dimension: 'EI',
  computedPole: 'E',
  details: ['这一侧的解释：你更容易在与人来往中恢复精力。'],
})
const STRONG_SN = row({
  dimension: 'SN',
  computedPole: 'N',
  details: ['这一侧的解释：你更常先看整体与可能性。'],
})
const STRONG_TF = row({
  dimension: 'TF',
  computedPole: 'F',
  details: ['这一侧的解释：你更容易先顾及关系。'],
})
const STRONG_JP = row({
  dimension: 'JP',
  computedPole: 'P',
  details: ['这一侧的解释：你更愿意留出余地。'],
})

/** TENTATIVE 的 EI：略偏 E，**必须**同时给另一侧 I 的描述。 */
const BOUNDARY_EI = row({
  dimension: 'EI',
  computedPole: 'E',
  boundary: true,
  mFinal: 0.0833,
  position: 0.5417,
  details: [
    '这一侧的解释：你更容易在与人来往中恢复精力。',
    '本次这一侧只是略偏。另一侧「内倾 I」同样值得一起读：你更需要独处来整理。',
  ],
})

/** TIED 的 SN：平分，**必须**给两端描述。 */
const TIED_SN = row({
  dimension: 'SN',
  computedPole: null,
  position: 0.5,
  nFinal: 12,
  details: [
    '这一维两次作答差不多。',
    '两端都不用急着归到某一侧。',
    '实感 S：你更相信眼前看得到的事实。',
    '直觉 N：你更常顺着联想往前走。',
  ],
})

const METHODOLOGY = {
  scoringVersion: 'typeme-jung48-score-v1',
  packageId: 'typeme-jung48-zh-v1',
  reportContentVersion: 'typeme-type-report-zh-v1',
  contentStatus: 'draft_review_pending',
  contentSha256: 'a'.repeat(64),
  processCopyVersion: 'typeme-process-copy-zh-v1',
  processCopySha256: 'c'.repeat(64),
  dynamicsVersion: 'typeme-jung48-dynamics-v1',
  policyVersion: 'typeme-jung48-score-v1',
  minBaseRatingsPerDimension: 9,
  boundaryNumerator: 2,
  boundaryDenominator: 10,
  submittedAt: '2026-09-16T10:20:00Z',
}

/**
 * 一份合法的 `dynamics`（ENFP：Ne → Fi → Te → Si）。
 *
 * 用真型真过程而不是 `A/B/C/D` 占位：这一块最容易出的错就是"结构对不上四字母"，
 * 占位符会让"对不上"这件事看不出来。
 */
function dynamicsBlock(typeCode = 'ENFP'): Record<string, unknown> {
  return {
    version: 'typeme-jung48-dynamics-v1',
    typeCode,
    rule: '你以 E 为主、以 P 结尾。按这套框架的规则，J/P 说的是「对外部世界使用哪一种过程」。',
    basis: '这一层不是本次测出来的另一个结果，而是按四个字母、依据该框架的规则推导出来的结构。',
    processes: [
      {
        slot: 'dominant',
        order: 1,
        process: 'Ne',
        function: 'N',
        attitude: 'e',
        nameCn: '外倾直觉',
        roleTitle: '主导过程',
        what: '在外部世界里看见多种可能。',
        reading: '你会先想到这件事还能变成什么。',
        preferred: true,
      },
      {
        slot: 'auxiliary',
        order: 2,
        process: 'Fi',
        function: 'F',
        attitude: 'i',
        nameCn: '内倾情感',
        roleTitle: '辅助过程',
        what: '在心里判断什么对自己是重要的。',
        reading: '你会在意这件事和自己在乎的东西是否一致。',
        preferred: true,
      },
      {
        slot: 'tertiary',
        order: 3,
        process: 'Te',
        function: 'T',
        attitude: 'e',
        nameCn: '外倾思考',
        roleTitle: '第三位',
        what: '把逻辑用到外部去组织事情。',
        reading: '还没练过的时候，可能不太愿意定标准、排进度。',
        preferred: false,
      },
      {
        slot: 'inferior',
        order: 4,
        process: 'Si',
        function: 'S',
        attitude: 'i',
        nameCn: '内倾感觉',
        roleTitle: '第四位',
        what: '把眼前的事和记住的经验放在一起比。',
        reading: '还没练过的时候，可能不太留得住已经走通的做法。',
        preferred: false,
      },
    ],
    boundaryNotes: [
      {
        dimension: 'EI',
        pole: 'E',
        note: '如果 精力方向 落到另一侧（INFP）：过程还是这四个，但主导与辅助会互换、第三位与第四位也会互换 —— 原来是外倾直觉主导，换过去就是内倾情感主导。',
      },
    ],
    notes: {
      frameworkCaveat:
        '这一层是按四个字母、依据该框架的规则推导出来的（不是本次测量到的另一个结果）。',
    },
  }
}

/** 一份合法的 `processPlan`；`decisionSteps` 固定 S → N → T → F。 */
function processPlanBlock(): Record<string, unknown> {
  return {
    version: 'typeme-jung48-dynamics-v1',
    developmentOrder: [
      {
        order: 1,
        title: '先把主导过程用熟',
        body: '主导过程是这套结构里最先形成的那一个。',
        processes: [{ process: 'Ne', nameCn: '外倾直觉', body: '你会先想到这件事还能变成什么。' }],
      },
      {
        order: 2,
        title: '让辅助过程承担对外的事',
        body: '辅助过程与主导过程一个判断一个感知。',
        processes: [{ process: 'Fi', nameCn: '内倾情感', body: '你会在意这件事和自己在乎的东西是否一致。' }],
      },
      {
        order: 3,
        title: '把两个尚未偏好的过程当家里的成员接纳',
        body: '这两个过程并列，没有先后。',
        processes: [
          { process: 'Te', nameCn: '外倾思考', body: '还没练过的时候，可能不太愿意定标准。' },
          { process: 'Si', nameCn: '内倾感觉', body: '还没练过的时候，可能不太留得住已经走通的做法。' },
        ],
      },
    ],
    decisionIntro: '遇到值得认真对待的问题时，按这个顺序把四个过程都用一遍。',
    decisionSteps: [
      {
        order: 1,
        function: 'S',
        title: '先用感觉处理事实',
        prompt: '现在的处境究竟是什么状况？',
        slot: 'inferior',
        slotTitle: '第四位',
        process: 'Si',
        preferred: false,
        how: '这一步用不上你偏好的功能。可以先去问一两个记性好的人。',
      },
      {
        order: 2,
        function: 'N',
        title: '再用直觉列可能性',
        prompt: '这件事还有哪些走法？',
        slot: 'dominant',
        slotTitle: '主导过程',
        process: 'Ne',
        preferred: true,
        how: '这一步对应你的主导过程（Ne），用起来最省力。',
      },
      {
        order: 3,
        function: 'T',
        title: '用思考算清后果',
        prompt: '每条路走下去会发生什么？',
        slot: 'tertiary',
        slotTitle: '第三位',
        process: 'Te',
        preferred: false,
        how: '这一步用不上你偏好的功能。可以把它写成一个清单。',
      },
      {
        order: 4,
        function: 'F',
        title: '用情感称一称分量',
        prompt: '每条路对我在意的东西意味着什么？',
        slot: 'auxiliary',
        slotTitle: '辅助过程',
        process: 'Fi',
        preferred: true,
        how: '这一步对应你的辅助过程（Fi），用起来最省力。',
      },
    ],
    decisionNote: '凡是要用上与你不同的人的长处的那些步骤，一开始都很难，这很正常。',
    hardestSteps: ['先用感觉处理事实', '用思考算清后果'],
    hardestStepsNote:
      '这四步里，「先用感觉处理事实」「用思考算清后果」用不上你偏好的功能，忙起来最容易整段跳过。',
    opposites: [
      {
        axis: 'SN',
        axisName: '信息关注',
        yourPole: 'N',
        needPole: 'S',
        need: '你需要偏感觉的一侧提供：恰当的事实与细节上的把关。',
        supply: '你能提供给偏感觉的一侧：把眼光放远的想象。',
      },
      {
        axis: 'TF',
        axisName: '决策依据',
        yourPole: 'F',
        needPole: 'T',
        need: '你需要偏思考的一侧提供：把问题分析清楚。',
        supply: '你能提供给偏思考的一侧：劝说的通达与人与人之间的调和。',
      },
    ],
    communicationRules: [
      {
        axis: 'EI',
        axisName: '精力方向',
        title: '关于精力的给与取',
        yourPole: 'E',
        body: '你需要和人说说话才能缓过来这件事，别人未必看得出来。',
      },
      {
        axis: 'SN',
        axisName: '信息关注',
        title: '和偏好另一侧的人说事',
        yourPole: 'N',
        body: '先把你想到的方向说出来，再补一句具体能落到哪一步。',
      },
      {
        axis: 'TF',
        axisName: '决策依据',
        title: '要说不同意见的时候',
        yourPole: 'F',
        body: '要说不同意见时，先把事情里可以量化的部分摊开。',
      },
      {
        axis: 'JP',
        axisName: '生活节奏',
        title: '把时间安排说清楚',
        yourPole: 'P',
        body: '和偏计划的人共事时，先说清哪些部分会变、什么时候定。',
      },
    ],
    notes: {
      developmentNote: '四个过程没有高下：主导过程只是「用起来最省力」的那个。',
      greyAreaNote:
        '还没发展起来的过程不会消失：累、压力大或者放松警惕的时候，它会以不太成熟的方式冒出来。',
    },
  }
}

interface ReportSpec {
  status: 'REFERENCE' | 'TENTATIVE' | 'TIED'
  typeCode: string | null
  headline: string
  typeTitle?: string | null
  typeNameCn?: string | null
  summary?: string
  dimensions: Record<string, unknown>[]
  candidates?: { typeCode: string; cost: number; differsOn: string[] }[]
  boundaries?: { note: string }[]
  tiedDimensions?: string[]
  tieNotice?: string | null
  filename?: string
  imageTitle?: string
  boundaryLine?: string | null
  alt?: string
  shareText?: string
  typeSections?: { key: string; title: string; body: string }[]
  nextActions?: { title: string; steps: string[] }[]
  /**
   * 过程层两块。默认按四字母给一份**合法**的结构（有字母就必须两块都在），
   * TIED 默认两块都缺席（服务端此时发的是 null，旧快照则干脆没有这两个键）。
   * 用例可以显式传值/传 null，用来测"只给一半""结构对不上四字母"这类坏形状。
   */
  dynamics?: unknown
  processPlan?: unknown
}

function report(spec: ReportSpec): Record<string, unknown> {
  const typeCode = spec.typeCode
  const json: Record<string, unknown> = {
    schemaVersion: 1,
    reportId: '11111111-1111-1111-1111-111111111111',
    attemptId: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-09-16T10:20:00Z',
    status: spec.status,
    computedTypeCode: typeCode,
    typeSource: typeCode === null ? 'none' : 'computed',
    selfSelectedTypeCode: null,
    typeTitle: spec.typeTitle === undefined ? (typeCode ? '织梦者' : null) : spec.typeTitle,
    typeNameCn: spec.typeNameCn === undefined ? (typeCode ? '织梦者' : null) : spec.typeNameCn,
    typeTagline: typeCode ? '心里有一套标准，慢慢把事情织成样子' : null,
    summary: spec.summary ?? '本次的摘要。',
    boundaries: spec.boundaries ?? [],
    tiedDimensions: spec.tiedDimensions ?? [],
    dimensions: spec.dimensions,
    candidates: spec.candidates ?? [],
    tieNotice: spec.tieNotice ?? null,
    clarificationDimensions: [],
    clarificationSkipped: false,
    typeSections: spec.typeSections ?? [
      { key: 'dailyLife', title: '日常表现', body: '日常里的样子。' },
      { key: 'strengths', title: '可能用得顺手的地方', body: '顺手的地方。' },
      { key: 'blindSpots', title: '容易卡住的地方', body: '容易卡住的地方。' },
      { key: 'communication', title: '沟通与关系', body: '沟通里的样子。' },
      { key: 'studyWork', title: '学习与工作方式', body: '学习与工作的方式。' },
      { key: 'stress', title: '压力下的观察', body: '压力下的样子。' },
      { key: 'growth', title: '成长行动', body: '可以试的成长方向。' },
      { key: 'neighbors', title: '相邻类型区别', body: '与相邻类型的区别。' },
    ],
    nextActions: spec.nextActions ?? [{ title: '这周试试', steps: ['做十分钟。', '写一句卡在哪。'] }],
    share: {
      kind: spec.status,
      imageTitle: spec.imageTitle ?? '本次参考类型',
      headline: spec.headline,
      boundaryLine: spec.boundaryLine ?? null,
      filename: spec.filename ?? 'typeme-INFP-reference.png',
      text: spec.shareText ?? `${spec.headline}：这是一段复制文字。`,
      alt: spec.alt ?? `TypeMe 分享图：${spec.headline}`,
    },
    methodology: METHODOLOGY,
    reportHash: 'b'.repeat(64),
  }
  // 过程层：有字母时两块**必须都在**（契约），所以默认按四字母补上一份合法结构；
  // TIED（没有字母）默认两块都缺席 —— 读成 null，与显式 null 同义。
  if (spec.dynamics !== undefined) json.dynamics = spec.dynamics
  else if (typeCode !== null) json.dynamics = dynamicsBlock(typeCode)
  if (spec.processPlan !== undefined) json.processPlan = spec.processPlan
  else if (typeCode !== null) json.processPlan = processPlanBlock()
  return json
}

const REFERENCE_REPORT = report({
  status: 'REFERENCE',
  typeCode: 'ENFP',
  headline: '本次参考类型 ENFP 织梦者',
  filename: 'typeme-ENFP-reference.png',
  dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
})

const TENTATIVE_REPORT = report({
  status: 'TENTATIVE',
  typeCode: 'ENFP',
  headline: '本次更接近 ENFP 织梦者',
  filename: 'typeme-ENFP-tentative.png',
  imageTitle: '本次更接近',
  boundaryLine: '倾向较轻：E（另一侧也值得一起读）',
  boundaries: [{ note: '本次略偏 E（倾向较轻），另一侧也值得一起读。' }],
  dimensions: [BOUNDARY_EI, STRONG_SN, STRONG_TF, STRONG_JP],
})

const TIED_REPORT = report({
  status: 'TIED',
  typeCode: null,
  headline: '几个类型都值得一起看',
  imageTitle: '本次没有唯一类型',
  filename: 'typeme-tied.png',
  typeTitle: null,
  typeNameCn: null,
  summary: '这次有 1 个方面两边几乎一样（S/N），所以没有唯一的一个类型。',
  tiedDimensions: ['SN'],
  tieNotice: '这些候选在本次数据里没有区别：换其中任何一个字母，需要的证据偏离程度都一样。',
  candidates: [
    { typeCode: 'ENFP', cost: 0, differsOn: [] },
    { typeCode: 'INFP', cost: 6, differsOn: ['EI'] },
    { typeCode: 'ESFP', cost: 4, differsOn: ['SN'] },
    { typeCode: 'ISFP', cost: 10, differsOn: ['EI', 'SN'] },
  ],
  dimensions: [STRONG_EI, TIED_SN, STRONG_TF, STRONG_JP],
})

describe('REPORT：REFERENCE', () => {
  const view = buildReportView(REFERENCE_REPORT)

  it('标题是「本次参考类型 XXXX」，四字母与类型名都在', () => {
    expect(view.status).toBe('REFERENCE')
    expect(view.headline).toContain('本次参考类型')
    expect(view.headline).toContain('ENFP')
    expect(view.typeCode).toBe('ENFP')
    expect(view.typeNameCn).toBe('织梦者')
  })

  it('八段解读按内容包顺序给出，每段都有标题与正文', () => {
    expect(view.typeSections.map((section) => section.key)).toEqual([
      'dailyLife',
      'strengths',
      'blindSpots',
      'communication',
      'studyWork',
      'stress',
      'growth',
      'neighbors',
    ])
    for (const section of view.typeSections) {
      expect(section.title.length).toBeGreaterThan(0)
      expect(section.body.length).toBeGreaterThan(0)
    }
  })

  it('REFERENCE 不生成候选（没有"还可以一起看的方向"）', () => {
    expect(view.candidates).toEqual([])
    expect(view.candidateCodes).toEqual([])
  })

  it('四维顺序固定为 EI, SN, TF, JP，位置取自 position', () => {
    expect(view.dimensionRows.map((rowItem) => rowItem.dimension)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(view.dimensionRows[0].position).toBeCloseTo(0.625)
    expect(view.dimensionRows[0].statusNote).toContain('偏向 E')
  })

  it('分享三件套（文字 / alt / 文件名）都来自同一份 share', () => {
    expect(view.share.text.length).toBeGreaterThan(0)
    expect(view.share.alt).toContain('分享图')
    expect(view.share.filename).toBe('typeme-ENFP-reference.png')
    expect(view.share.kind).toBe('REFERENCE')
  })
})

describe('REPORT：TENTATIVE', () => {
  const view = buildReportView(TENTATIVE_REPORT)

  it('标题含「本次更接近」', () => {
    expect(view.status).toBe('TENTATIVE')
    expect(view.headline).toContain('本次更接近')
    expect(view.share.headline).toContain('本次更接近')
  })

  it('边界维度的状态文案明说「略偏」，details 同时给出另一侧', () => {
    const ei = view.dimensionRows.find((rowItem) => rowItem.dimension === 'EI')!
    expect(ei.boundary).toBe(true)
    expect(ei.statusNote).toContain('略偏')
    expect(ei.statusNote).toContain('另一侧')
    const joined = ei.details.join('\n')
    expect(joined).toContain('内倾 I')
    expect(joined).toContain('独处')
  })

  it('boundaryNotes 与 share.boundaryLine 都在，说明"哪几维只是略偏"', () => {
    expect(view.boundaryNotes).toHaveLength(1)
    expect(view.boundaryNotes[0]).toContain('略偏')
    expect(view.share.boundaryLine).toContain('倾向较轻')
  })

  it('边界维度若没给另一侧描述，构建时直接抛错（不猜一个默认文案）', () => {
    const broken = report({
      status: 'TENTATIVE',
      typeCode: 'ENFP',
      headline: '本次更接近 ENFP 织梦者',
      dimensions: [
        row({ dimension: 'EI', computedPole: 'E', boundary: true, details: ['只有一侧。'] }),
        STRONG_SN,
        STRONG_TF,
        STRONG_JP,
      ],
    })
    expect(() => buildReportView(broken)).toThrow(ReportShapeError)
  })
})

describe('REPORT：TIED', () => {
  const view = buildReportView(TIED_REPORT)

  it('主标题不含任何四字母，且 typeCode 为 null', () => {
    expect(view.status).toBe('TIED')
    expect(view.typeCode).toBeNull()
    expect(view.computedTypeCode).toBeNull()
    expect(view.headline).toBe('几个类型都值得一起看')
    expect(view.share.headline).not.toMatch(/[EI][SN][TF][JP]/)
    expect(view.headline).not.toMatch(/[EI][SN][TF][JP]/)
  })

  it('列出多个候选，并说明为什么都可能（tiedDimensions + tieNotice）', () => {
    expect(view.tiedDimensions).toEqual(['SN'])
    expect(view.candidateCodes.length).toBeGreaterThan(1)
    expect(view.candidateCodes).toContain('ENFP')
    expect(view.candidateCodes).toContain('INFP')
    expect(view.tieNotice).not.toBeNull()
  })

  it('四维全部给出两端描述（平分维度两端都在）', () => {
    for (const rowItem of view.dimensionRows) {
      expect(rowItem.details.length, `${rowItem.dimension} 的 details`).toBeGreaterThanOrEqual(1)
    }
    const sn = view.dimensionRows.find((rowItem) => rowItem.dimension === 'SN')!
    const joined = sn.details.join('\n')
    expect(joined).toContain('实感 S')
    expect(joined).toContain('直觉 N')
    expect(sn.statusNote).toContain('两边接近')
  })
})

describe('候选的 cost 是人话，且不是概率', () => {
  const view = buildReportView(TIED_REPORT)

  it('cost 文案里不出现概率 / 准确率 / 可能性 / 百分位 / 置信', () => {
    const banned = ['概率', '准确率', '可能性', '百分位', '置信', '几率']
    for (const candidate of view.candidates) {
      for (const word of banned) {
        expect(candidate.costText, `${candidate.typeCode} 的 costText 不该出现「${word}」`).not.toContain(word)
        expect(candidate.differsText, `${candidate.typeCode} 的 differsText 不该出现「${word}」`).not.toContain(word)
      }
    }
  })

  it('cost 被解释成"需要偏离多少证据"，并给出维度的人话名', () => {
    const infp = view.candidates.find((candidate) => candidate.typeCode === 'INFP')!
    expect(infp.differsOn).toEqual(['EI'])
    expect(infp.differsOnNames).toEqual(['精力方向'])
    expect(infp.costText).toContain('偏离本次作答共 6 分证据')
    expect(infp.costText).toContain('精力方向')
    expect(infp.costText).toContain('不是')
    expect(infp.isComputedDirection).toBe(false)
  })

  it('与本次方向一致的那个候选（cost 0 / differsOn 空）说清"不需要替换任何一维"', () => {
    const same = view.candidates.find((candidate) => candidate.typeCode === 'ENFP')!
    expect(same.isComputedDirection).toBe(true)
    expect(same.costText).toContain('不需要替换任何一维')
  })
})

describe('缺失字段一律抛错，不猜默认值', () => {
  it('没有 dimensions 抛错', () => {
    const raw = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
    })
    delete raw.dimensions
    expect(() => buildReportView(raw)).toThrow(/dimensions/)
  })

  it('没有 share 抛错', () => {
    const raw = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
    })
    delete raw.share
    expect(() => buildReportView(raw)).toThrow(/share/)
  })

  it('TIED 却带了类型码抛错（假的主类型比没有主类型更危险）', () => {
    const raw = report({
      status: 'TIED',
      typeCode: 'ENFP',
      headline: '几个类型都值得一起看',
      dimensions: [STRONG_EI, TIED_SN, STRONG_TF, STRONG_JP],
      candidates: [{ typeCode: 'ENFP', cost: 0, differsOn: [] }],
    })
    expect(() => buildReportView(raw)).toThrow(/TIED/)
  })

  it('NEEDS_REVIEW 状态根本没有报告可渲染', () => {
    const raw = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
    })
    raw.status = 'NEEDS_REVIEW'
    expect(() => buildReportView(raw)).toThrow(/NEEDS_REVIEW/)
  })
})

describe('自我理解与问卷结果并列', () => {
  it('传入的自我理解不会覆盖报告里的任何字段', () => {
    const view = buildReportView(REFERENCE_REPORT, {
      selfSelectedTypeCode: 'INFP',
      note: '我自己觉得更像另一种。',
      updatedAt: '2026-09-17T00:00:00Z',
    })
    expect(view.selfSelectedTypeCode).toBe('INFP')
    expect(view.selfReflection.note).toBe('我自己觉得更像另一种。')
    // 问卷结果仍然是服务端那份
    expect(view.typeCode).toBe('ENFP')
    expect(view.headline).toContain('ENFP')
  })

  it('报告快照里的 selfSelectedTypeCode 不会被当成用户自选（那是生成时刻的空值）', () => {
    const view = buildReportView(REFERENCE_REPORT, null)
    expect(view.selfSelectedTypeCode).toBeNull()
  })
})

describe('覆盖不足时的"还差哪几维"', () => {
  it('优先用服务端给的维度名单，并给出人话原因', () => {
    const rows = [
      { ...buildReportView(REFERENCE_REPORT).dimensionRows[0], coverageOk: false, baseUnprocessedCount: 3 },
    ]
    const list = insufficientDimensionNames(['EI'], rows)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('精力方向')
    expect(list[0].note).toContain('3 题没有作答')
  })

  it('服务端没给名单时退回维度行自己的覆盖标记', () => {
    const base = buildReportView(REFERENCE_REPORT).dimensionRows
    const rows = base.map((rowItem, index) =>
      index === 2 ? { ...rowItem, coverageOk: false, baseRatingCount: 4, baseUnprocessedCount: 0 } : rowItem,
    )
    const list = insufficientDimensionNames([], rows)
    expect(list.map((item) => item.dimension)).toEqual(['TF'])
    expect(list[0].note).toContain('有效作答只有 4 题')
  })
})

describe('过程层：有字母就必须两块都在，且结构与四字母对得上', () => {
  /** 带完整过程层的 REFERENCE（ENFP）。 */
  function reportWithProcessLayer(): Record<string, unknown> {
    return report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: dynamicsBlock(),
      processPlan: processPlanBlock(),
    })
  }

  const view = buildReportView(reportWithProcessLayer())

  it('四个过程按主导 / 辅助 / 第三位 / 第四位给出，位置与代号都保留', () => {
    expect(view.dynamics).not.toBeNull()
    const dynamics = view.dynamics!
    expect(dynamics.typeCode).toBe('ENFP')
    expect(dynamics.processes.map((process) => process.slot)).toEqual([
      'dominant',
      'auxiliary',
      'tertiary',
      'inferior',
    ])
    expect(dynamics.processes.map((process) => process.process)).toEqual(['Ne', 'Fi', 'Te', 'Si'])
    expect(dynamics.processes.map((process) => process.order)).toEqual([1, 2, 3, 4])
    // preferred 只有主导与辅助
    expect(dynamics.processes.map((process) => process.preferred)).toEqual([true, true, false, false])
    expect(dynamics.processes[0].nameCn).toBe('外倾直觉')
    expect(dynamics.processes[0].roleTitle).toBe('主导过程')
    expect(dynamics.processes[0].what.length).toBeGreaterThan(0)
    expect(dynamics.processes[0].reading.length).toBeGreaterThan(0)
  })

  it('框架说明（basis / frameworkCaveat）与换侧说明都在视图模型里', () => {
    const dynamics = view.dynamics!
    expect(dynamics.basis).toContain('不是本次测出来的另一个结果')
    expect(dynamics.notes.frameworkCaveat.length).toBeGreaterThan(0)
    expect(dynamics.rule.length).toBeGreaterThan(0)
    expect(dynamics.boundaryNotes).toHaveLength(1)
    expect(dynamics.boundaryNotes[0].dimension).toBe('EI')
    expect(dynamics.boundaryNotes[0].pole).toBe('E')
  })

  it('建议块：3 段发展任务、S→N→T→F 四步、2 条互补、4 条沟通规则', () => {
    const plan = view.processPlan!
    expect(plan.developmentOrder.map((stage) => stage.order)).toEqual([1, 2, 3])
    // 第三层的两个过程并列，各给一条
    expect(plan.developmentOrder.map((stage) => stage.processes.length)).toEqual([1, 1, 2])
    expect(plan.decisionSteps.map((step) => step.function)).toEqual(['S', 'N', 'T', 'F'])
    // 四步里用不上偏好功能的那两步必须被标出来
    expect(plan.decisionSteps.filter((step) => !step.preferred).map((step) => step.title)).toEqual(
      plan.hardestSteps,
    )
    expect(plan.opposites.map((row) => row.axis)).toEqual(['SN', 'TF'])
    expect(plan.communicationRules.map((row) => row.axis)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(plan.notes.developmentNote.length).toBeGreaterThan(0)
    expect(plan.notes.greyAreaNote.length).toBeGreaterThan(0)
  })

  it('TIED：没有四字母，两块按"缺失 → null / 显式 null → null"读成 null', () => {
    // TIED_REPORT 里干脆没有这两个键（旧快照就是这样）
    expect(buildReportView(TIED_REPORT).dynamics).toBeNull()
    expect(buildReportView(TIED_REPORT).processPlan).toBeNull()

    // 服务端显式发 null（TIED 时的正常形状）也一样
    const explicitNull = buildReportView(
      report({
        status: 'TIED',
        typeCode: null,
        headline: '几个类型都值得一起看',
        dimensions: [STRONG_EI, TIED_SN, STRONG_TF, STRONG_JP],
        candidates: [
          { typeCode: 'ENFP', cost: 0, differsOn: [] },
          { typeCode: 'ESFP', cost: 4, differsOn: ['SN'] },
        ],
        dynamics: null,
        processPlan: null,
      }),
    )
    expect(explicitNull.dynamics).toBeNull()
    expect(explicitNull.processPlan).toBeNull()
  })

  it('TIED 却带了过程结构时抛错（没有字母就不推导）', () => {
    const broken = report({
      status: 'TIED',
      typeCode: null,
      headline: '几个类型都值得一起看',
      dimensions: [STRONG_EI, TIED_SN, STRONG_TF, STRONG_JP],
      candidates: [
        { typeCode: 'ENFP', cost: 0, differsOn: [] },
        { typeCode: 'ESFP', cost: 4, differsOn: ['SN'] },
      ],
      dynamics: dynamicsBlock('ENFP'),
      processPlan: processPlanBlock(),
    })
    expect(() => buildReportView(broken)).toThrow(/TIED/)
  })

  it('标了过程层版本、有字母却给成 null（两块都空）时抛错，不静默当成"这一层没有"', () => {
    const broken = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: null,
      processPlan: null,
    })
    expect(() => buildReportView(broken)).toThrow(/却没给过程结构/)
  })

  it('有字母却只给了一半（缺 dynamics 或缺 processPlan）时抛错', () => {
    const onlyDynamics = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: dynamicsBlock(),
      processPlan: null,
    })
    expect(() => buildReportView(onlyDynamics)).toThrow(/processPlan/)

    const onlyPlan = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: null,
      processPlan: processPlanBlock(),
    })
    expect(() => buildReportView(onlyPlan)).toThrow(/dynamics/)
  })

  it('dynamics.typeCode 与报告算出的四字母不一致时抛错（会拿另一型的结构解释这一型）', () => {
    const broken = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: dynamicsBlock('INFP'),
      processPlan: processPlanBlock(),
    })
    expect(() => buildReportView(broken)).toThrow(/不一致/)
  })

  it('processes 少于 4 个、或槽位顺序被换过时抛错', () => {
    const short = dynamicsBlock()
    short.processes = (short.processes as unknown[]).slice(0, 3)
    expect(() =>
      buildReportView(
        report({
          status: 'REFERENCE',
          typeCode: 'ENFP',
          headline: '本次参考类型 ENFP 织梦者',
          dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
          dynamics: short,
          processPlan: processPlanBlock(),
        }),
      ),
    ).toThrow(/4 个过程/)

    const swapped = dynamicsBlock()
    const rows = swapped.processes as Record<string, unknown>[]
    ;[rows[0], rows[1]] = [rows[1], rows[0]]
    expect(() =>
      buildReportView(
        report({
          status: 'REFERENCE',
          typeCode: 'ENFP',
          headline: '本次参考类型 ENFP 织梦者',
          dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
          dynamics: swapped,
          processPlan: processPlanBlock(),
        }),
      ),
    ).toThrow(/固定的/)
  })

  it('decisionSteps 的 function 不是 S → N → T → F 时抛错', () => {
    const plan = processPlanBlock()
    const steps = plan.decisionSteps as Record<string, unknown>[]
    // 只改功能族、不动 order：这样命中的确实是"顺序必须是 S → N → T → F"那条校验
    steps[0].function = 'T'
    expect(() =>
      buildReportView(
        report({
          status: 'REFERENCE',
          typeCode: 'ENFP',
          headline: '本次参考类型 ENFP 织梦者',
          dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
          dynamics: dynamicsBlock(),
          processPlan: plan,
        }),
      ),
    ).toThrow(/S → N → T → F/)
  })
})

describe('过程层：新快照 / 旧快照靠 methodology.dynamicsVersion 判别', () => {
  /** 一份"过程层上线之前"生成的 REFERENCE 快照：既没有两块，也没有版本标记。 */
  function oldSnapshot(): Record<string, unknown> {
    const raw = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
    })
    delete raw.dynamics
    delete raw.processPlan
    const methodology = { ...(raw.methodology as Record<string, unknown>) }
    delete methodology.processCopyVersion
    delete methodology.processCopySha256
    delete methodology.dynamicsVersion
    raw.methodology = methodology
    return raw
  }

  it('① 新快照（有 methodology.dynamicsVersion + 两块）→ 正常解析，严格校验照常生效', () => {
    const view = buildReportView(
      report({
        status: 'REFERENCE',
        typeCode: 'ENFP',
        headline: '本次参考类型 ENFP 织梦者',
        dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
        dynamics: dynamicsBlock(),
        processPlan: processPlanBlock(),
      }),
    )
    expect(view.methodology.dynamicsVersion).toBe('typeme-jung48-dynamics-v1')
    expect(view.dynamics?.typeCode).toBe('ENFP')
    expect(view.processPlan?.decisionSteps.map((step) => step.function)).toEqual(['S', 'N', 'T', 'F'])

    // 同一份新快照里结构与四字母对不上，仍然要抛错（严格性没有被"新旧判别"削弱）
    const broken = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: dynamicsBlock('INFP'),
      processPlan: processPlanBlock(),
    })
    expect(() => buildReportView(broken)).toThrow(/不一致/)
  })

  it('② 旧快照（无 dynamicsVersion、无两块）→ 正常解析，两块为 null，不报形状错误', () => {
    const view = buildReportView(oldSnapshot())
    expect(view.dynamics).toBeNull()
    expect(view.processPlan).toBeNull()
    expect(view.methodology.dynamicsVersion).toBeNull()
    // 其余字段照常解析：不能因为"没有过程层"就整份读不出来
    expect(view.typeCode).toBe('ENFP')
    expect(view.headline).toContain('ENFP')
    expect(view.dimensionRows).toHaveLength(4)
    expect(view.typeSections.length).toBeGreaterThan(0)
  })

  it('旧快照即使带了这两块也不读（没有版本标记就不知道是按哪一版规则推的）', () => {
    const raw = oldSnapshot()
    raw.dynamics = dynamicsBlock()
    raw.processPlan = processPlanBlock()
    const view = buildReportView(raw)
    expect(view.dynamics).toBeNull()
    expect(view.processPlan).toBeNull()
  })

  it('③ 有 dynamicsVersion 但缺其中一块 → 抛错（新报告漏发字段是 bug，不是版本差异）', () => {
    const missingPlan = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: dynamicsBlock(),
      processPlan: null,
    })
    expect(() => buildReportView(missingPlan)).toThrow(/只给了过程结构的一半/)
    expect(() => buildReportView(missingPlan)).toThrow(/processPlan 缺/)

    const missingDynamics = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
      dynamics: null,
      processPlan: processPlanBlock(),
    })
    expect(() => buildReportView(missingDynamics)).toThrow(/dynamics 缺/)

    // 旧快照同样不许"只给一半"：那是真损坏，与版本差异无关
    const oldAndHalf = oldSnapshot()
    oldAndHalf.dynamics = dynamicsBlock()
    expect(() => buildReportView(oldAndHalf)).toThrow(/只给了过程结构的一半/)
  })

  it('TIED + 有版本标记 + 两块都空 → 两块都是 null', () => {
    const view = buildReportView(
      report({
        status: 'TIED',
        typeCode: null,
        headline: '几个类型都值得一起看',
        dimensions: [STRONG_EI, TIED_SN, STRONG_TF, STRONG_JP],
        candidates: [
          { typeCode: 'ENFP', cost: 0, differsOn: [] },
          { typeCode: 'ESFP', cost: 4, differsOn: ['SN'] },
        ],
        dynamics: null,
        processPlan: null,
      }),
    )
    expect(view.dynamics).toBeNull()
    expect(view.processPlan).toBeNull()
  })
})

describe('methodology 的过程层版本号', () => {
  it('报告里给了就读出来', () => {
    const view = buildReportView(REFERENCE_REPORT)
    expect(view.methodology.processCopyVersion).toBe('typeme-process-copy-zh-v1')
    expect(view.methodology.processCopySha256).toBe('c'.repeat(64))
    expect(view.methodology.dynamicsVersion).toBe('typeme-jung48-dynamics-v1')
  })

  it('旧快照里没有这三个键时读成 null，而不是让整份报告读不出来', () => {
    const raw = report({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      dimensions: [STRONG_EI, STRONG_SN, STRONG_TF, STRONG_JP],
    })
    // 复制一份再删键：METHODOLOGY 是共享常量，直接改它会污染同文件里的其它用例
    const methodology = { ...(raw.methodology as Record<string, unknown>) }
    delete methodology.processCopyVersion
    delete methodology.processCopySha256
    delete methodology.dynamicsVersion
    raw.methodology = methodology
    const view = buildReportView(raw)
    expect(view.methodology.processCopyVersion).toBeNull()
    expect(view.methodology.processCopySha256).toBeNull()
    expect(view.methodology.dynamicsVersion).toBeNull()
  })
})
