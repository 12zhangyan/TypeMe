// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import ReportV3View from './ReportV3View.vue'
import { useReportStore } from '@/stores/reportV3'
import { buildReportView } from '@/domain/reportV3'

/**
 * 新报告页（`/reports`、`/reports/:reportId`）测试 —— 契约 §7.2 / §7.3。
 *
 * 重点就是**四种状态必须给出明显不同的呈现**。这一块最容易出的错是
 * "四种状态用同一套版式、只换一行说明"：
 *
 *   - `REFERENCE`：四字母 + 类型名 + 八段解读；
 *   - `TENTATIVE`：标题必须含「本次更接近」，并且明说这一侧只是略偏、另一侧也值得读；
 *   - `TIED`：**主标题里绝不能出现任何四字母**，要列出多个候选并解释为什么都可能；
 *   - `NEEDS_REVIEW`：根本没有报告可看，要说明还差什么。
 *
 * 另外两条同样有测试钉住：
 *   - 候选的 `cost` 文案里不许出现"概率 / 准确率 / 可能性"这类词；
 *   - 自我理解与问卷结果并列显示，保存自我理解**不会**改掉问卷结果。
 *
 * 过程层（`dynamics` / `processPlan`）单列一组：它是由四字母**推导**出来的结构，
 * 页面上必须把 `basis` 与 `notes.frameworkCaveat` 作为可见文字（"推导 ≠ 测量"），
 * 并且 `preferred: false` 的那两步要显式标出；TIED（没有四字母）时两块都不渲染。
 */

const REPORT_ID = 'report-1111'
const ATTEMPT_ID = 'attempt-2222'

const METHODOLOGY = {
  scoringVersion: 'typeme-jung48-score-v1',
  packageId: 'typeme-jung48-zh-v1',
  reportContentVersion: 'typeme-type-report-zh-v1',
  contentStatus: 'draft_review_pending',
  contentSha256: 'a'.repeat(64),
  // 这三个键同时也是"这份快照有没有过程层"的判别标记（服务端每份新报告都会写）
  processCopyVersion: 'typeme-process-copy-zh-v1',
  processCopySha256: 'c'.repeat(64),
  dynamicsVersion: 'typeme-jung48-dynamics-v1',
  policyVersion: 'typeme-jung48-score-v1',
  minBaseRatingsPerDimension: 9,
  boundaryNumerator: 2,
  boundaryDenominator: 10,
  submittedAt: '2026-09-16T10:20:00Z',
}

const DIMENSION_COPY = [
  { dimension: 'EI', name: '精力方向', np: 'I', nl: '内倾', pp: 'E', pl: '外倾' },
  { dimension: 'SN', name: '信息偏好', np: 'S', nl: '实感', pp: 'N', pl: '直觉' },
  { dimension: 'TF', name: '判断依据', np: 'T', nl: '思考', pp: 'F', pl: '情感' },
  { dimension: 'JP', name: '生活方式', np: 'J', nl: '计划', pp: 'P', pl: '随性' },
] as const

function dimensionRow(
  index: number,
  computedPole: string | null,
  options: { boundary?: boolean; details?: string[] } = {},
): Record<string, unknown> {
  const copy = DIMENSION_COPY[index]
  return {
    dimension: copy.dimension,
    name: copy.name,
    question: '这一维问什么',
    negativePole: copy.np,
    negativeLabel: copy.nl,
    positivePole: copy.pp,
    positiveLabel: copy.pl,
    computedPole,
    tiedSide: computedPole === null ? 'tied' : computedPole === copy.pp ? 'positive' : 'negative',
    SBase: 6,
    nBase: 12,
    mBase: 0.25,
    SClar: 0,
    nClar: 0,
    mClar: null,
    SFinal: 6,
    nFinal: 12,
    mFinal: computedPole === null ? 0 : 0.25,
    position: computedPole === null ? 0.5 : 0.625,
    boundary: options.boundary ?? false,
    baseRatingCount: 12,
    baseUnknownCount: 0,
    baseUnprocessedCount: 0,
    clarificationScheduled: false,
    clarificationSkipped: false,
    clarificationApplied: false,
    clarificationRatingCount: 0,
    coverageOk: true,
    details: options.details ?? [`${copy.name}这一侧的解释。`],
    dailySigns: ['日常迹象'],
  }
}

/**
 * 一份合法的 `dynamics`（ENFP：Ne → Fi → Te → Si）。
 *
 * 过程层是**由四字母推导**出来的：页面必须把"这是推导、不是测量"写在明面上，
 * 否则读者会把它当成另外四个测出来的分数。下面的 `basis` / `frameworkCaveat`
 * 就是那两句必须在页面上看得见的话。
 */
function dynamicsBlock(typeCode = 'ENFP'): Record<string, unknown> {
  return {
    version: 'typeme-jung48-dynamics-v1',
    typeCode,
    rule: '你以 E 为主、以 P 结尾，对外使用的是感知过程；主导过程因而是外倾直觉（Ne）。',
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
        '这一层是按四个字母、依据该框架的规则推导出来的（不是本次测量到的另一个结果）。这套框架的假设在学界一直有争议。',
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

function reportJson(spec: {
  status: 'REFERENCE' | 'TENTATIVE' | 'TIED'
  typeCode: string | null
  headline: string
  imageTitle: string
  summary: string
  dimensions: Record<string, unknown>[]
  candidates?: { typeCode: string; cost: number; differsOn: string[] }[]
  boundaries?: { note: string }[]
  tiedDimensions?: string[]
  tieNotice?: string | null
  filename: string
  boundaryLine?: string | null
  typeSections?: { key: string; title: string; body: string }[]
  /**
   * 过程层两块。默认随四字母给一份合法结构（有字母就必须两块都在）；
   * TIED 默认两块都缺席，服务端此时发 null、旧快照则没有这两个键，两者都读成 null。
   */
  dynamics?: unknown
  processPlan?: unknown
}): Record<string, unknown> {
  const json: Record<string, unknown> = {
    schemaVersion: 1,
    reportId: REPORT_ID,
    attemptId: ATTEMPT_ID,
    createdAt: '2026-09-16T10:20:00Z',
    status: spec.status,
    computedTypeCode: spec.typeCode,
    typeSource: spec.typeCode ? 'computed' : 'none',
    selfSelectedTypeCode: null,
    typeTitle: spec.typeCode ? '织梦者' : null,
    typeNameCn: spec.typeCode ? '织梦者' : null,
    typeTagline: spec.typeCode ? '心里有一套标准。' : null,
    summary: spec.summary,
    boundaries: spec.boundaries ?? [],
    tiedDimensions: spec.tiedDimensions ?? [],
    dimensions: spec.dimensions,
    candidates: spec.candidates ?? [],
    tieNotice: spec.tieNotice ?? null,
    clarificationDimensions: [],
    clarificationSkipped: false,
    typeSections:
      spec.typeSections ??
      (spec.typeCode
        ? [
            { key: 'dailyLife', title: '日常表现', body: '日常里的样子。' },
            { key: 'strengths', title: '可能用得顺手的地方', body: '顺手的地方。' },
            { key: 'blindSpots', title: '容易卡住的地方', body: '容易卡住的地方。' },
            { key: 'communication', title: '沟通与关系', body: '沟通里的样子。' },
            { key: 'studyWork', title: '学习与工作方式', body: '学习与工作的方式。' },
            { key: 'stress', title: '压力下的观察', body: '压力下的样子。' },
            { key: 'growth', title: '成长行动', body: '可以试的成长方向。' },
            { key: 'neighbors', title: '相邻类型区别', body: '与相邻类型的区别。' },
          ]
        : []),
    nextActions: [{ title: '这周试试', steps: ['做十分钟。'] }],
    share: {
      kind: spec.status,
      imageTitle: spec.imageTitle,
      headline: spec.headline,
      boundaryLine: spec.boundaryLine ?? null,
      filename: spec.filename,
      text: `${spec.headline}：复制用的文字。`,
      alt: `TypeMe 分享图：${spec.headline}`,
    },
    methodology: METHODOLOGY,
    reportHash: 'b'.repeat(64),
  }
  // 有字母时两块必须都在（契约）；TIED 时两块都是 null（默认直接不出现这两个键）。
  if (spec.dynamics !== undefined) json.dynamics = spec.dynamics
  else if (spec.typeCode !== null) json.dynamics = dynamicsBlock(spec.typeCode)
  if (spec.processPlan !== undefined) json.processPlan = spec.processPlan
  else if (spec.typeCode !== null) json.processPlan = processPlanBlock()
  return json
}

/**
 * 把一份报告改成"过程层上线**之前**生成的旧快照"：两块没有，版本标记也没有。
 *
 * 判别新旧快照靠的是 `methodology.dynamicsVersion`（见 `domain/reportV3.ts` 里那段注释），
 * 所以这里必须把它和另两个新键一起去掉 —— 只删两块、留着版本标记，测的就是另一件事了
 * （那属于"新报告漏字段"，必须抛错）。
 */
function withoutProcessLayer(source: Record<string, unknown>): Record<string, unknown> {
  const raw = { ...source }
  delete raw.dynamics
  delete raw.processPlan
  const methodology = { ...(raw.methodology as Record<string, unknown>) }
  delete methodology.processCopyVersion
  delete methodology.processCopySha256
  delete methodology.dynamicsVersion
  raw.methodology = methodology
  return raw
}

const REFERENCE = reportJson({
  status: 'REFERENCE',
  typeCode: 'ENFP',
  headline: '本次参考类型 ENFP 织梦者',
  imageTitle: '本次参考类型',
  summary: '四个方向都比较清楚，可以按下面的描述读。',
  filename: 'typeme-ENFP-reference.png',
  dimensions: [
    dimensionRow(0, 'E'),
    dimensionRow(1, 'N'),
    dimensionRow(2, 'F'),
    dimensionRow(3, 'P'),
  ],
})

const TENTATIVE = reportJson({
  status: 'TENTATIVE',
  typeCode: 'ENFP',
  headline: '本次更接近 ENFP 织梦者',
  imageTitle: '本次更接近',
  boundaryLine: '倾向较轻：E（另一侧也值得一起读）',
  summary: '有一个方向只是略偏。',
  filename: 'typeme-ENFP-tentative.png',
  boundaries: [{ note: '本次略偏 E（倾向较轻），另一侧也值得一起读。' }],
  dimensions: [
    dimensionRow(0, 'E', {
      boundary: true,
      details: [
        '外倾 E 这一侧的解释。',
        '本次这一侧只是略偏。另一侧「内倾 I」同样值得一起读：你更需要独处整理。',
      ],
    }),
    dimensionRow(1, 'N'),
    dimensionRow(2, 'F'),
    dimensionRow(3, 'P'),
  ],
})

const TIED = reportJson({
  status: 'TIED',
  typeCode: null,
  headline: '几个类型都值得一起看',
  imageTitle: '本次没有唯一类型',
  summary: '有一维两边几乎一样。',
  filename: 'typeme-tied.png',
  tiedDimensions: ['SN'],
  tieNotice: '这些候选在本次数据里没有区别：换其中任何一个字母，需要的证据偏离程度都一样。',
  candidates: [
    { typeCode: 'ENFP', cost: 0, differsOn: [] },
    { typeCode: 'INFP', cost: 6, differsOn: ['EI'] },
    { typeCode: 'ESFP', cost: 4, differsOn: ['SN'] },
  ],
  dimensions: [
    dimensionRow(0, 'E'),
    dimensionRow(1, null, {
      details: [
        '这一维两次作答差不多。',
        '实感 S：你更相信眼前看得到的事实。',
        '直觉 N：你更常顺着联想往前走。',
      ],
    }),
    dimensionRow(2, 'F'),
    dimensionRow(3, 'P'),
  ],
})

/* ── 服务端替身 ─────────────────────────────────────────────────────────── */

interface ReportApiOptions {
  detail?: () => { status: number; body: unknown }
  /** 按 attempt 取报告（`GET /attempts/{id}/report`）：交卷后那条路的 404 含义不同。 */
  attemptReport?: () => { status: number; body: unknown }
  list?: () => { status: number; body: unknown }
  reflection?: () => { status: number; body: unknown }
  onReflectionPut?: (body: unknown) => void
  /** 删除报告的替身：返回一个 Response，或一个（可以一直挂着的）Promise。 */
  onDelete?: () => Response | Promise<Response> | { status: number; body: unknown }
}

let calls: { method: string; url: string; body: unknown }[] = []
let api: ReportApiOptions = {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const rawBody = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url, body: rawBody })

    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    if (method === 'PUT' && url.includes('/self-reflection')) {
      api.onReflectionPut?.(rawBody)
      return jsonResponse(
        api.reflection
          ? api.reflection().body
          : {
              selfSelectedTypeCode: rawBody?.selfSelectedTypeCode ?? null,
              note: rawBody?.note ?? null,
              updatedAt: '2026-09-17T00:00:00Z',
            },
        api.reflection ? api.reflection().status : 200,
      )
    }
    if (method === 'DELETE' && url.includes('/reports/')) {
      if (api.onDelete) {
        const result = await api.onDelete()
        if (result instanceof Response) return result
        return jsonResponse(result.body, result.status)
      }
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && /\/attempts\/[^/?]+\/report$/.test(url)) {
      const result = api.attemptReport
        ? api.attemptReport()
        : {
            status: 404,
            body: {
              code: 'NOT_FOUND',
              message: '这次测评还没有报告。',
              requestId: 'req-a',
              details: {},
            },
          }
      return jsonResponse(result.body, result.status)
    }
    if (method === 'GET' && url.includes('/reports/')) {
      const result = api.detail ? api.detail() : { status: 200, body: { report: REFERENCE } }
      return jsonResponse(result.body, result.status)
    }
    if (method === 'GET' && url.includes('/reports')) {
      const result = api.list
        ? api.list()
        : { status: 200, body: { items: [], page: 0, size: 50, total: 0 } }
      return jsonResponse(result.body, result.status)
    }
    return jsonResponse({ code: 'NOT_FOUND', message: `没有为 ${method} ${url} 准备替身` }, 404)
  }
  vi.stubGlobal('fetch', handler as never)
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports', name: 'reports', component: ReportV3View },
      { path: '/reports/:reportId', name: 'report-detail', component: ReportV3View },
      { path: '/assess', name: 'assess', component: { template: '<p>答题</p>' } },
    ],
  })
}

async function mountReport(path = `/reports/${REPORT_ID}`) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ReportV3View, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  api = {}
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('报告页：REFERENCE', () => {
  it('渲染四字母 + 类型名 + 八段解读', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-status="REFERENCE"]').exists()).toBe(true)
    const heading = wrapper.find('h1').text()
    expect(heading).toContain('本次参考类型')
    expect(heading).toContain('ENFP')
    expect(wrapper.find('[data-type-name]').text()).toContain('织梦者')
    // 八段解读
    for (const title of [
      '日常表现',
      '可能用得顺手的地方',
      '容易卡住的地方',
      '沟通与关系',
      '学习与工作方式',
      '压力下的观察',
      '成长行动',
      '相邻类型区别',
    ]) {
      expect(wrapper.text(), `缺少解读段「${title}」`).toContain(title)
    }
  })

  it('能读取带 version 2 中性外壳的报告体', async () => {
    api.detail = () => ({
      status: 200,
      body: {
        report: {
          schemaVersion: 2,
          instrument: { slug: 'jung48' },
          reportKind: 'jung_reference',
          reportId: REPORT_ID,
          attemptId: ATTEMPT_ID,
          createdAt: '2026-09-16T10:20:00Z',
          report: REFERENCE,
          // 真实快照的指纹在**外壳**层（后端 finalizeWithHash 在 wrap 之后追加），
          // 报告体里没有它。替身必须照这个形状放，否则测不出"读错层"。
          reportHash: 'b'.repeat(64),
        },
      },
    })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-shape-error]').exists()).toBe(false)
    expect(wrapper.find('[data-status="REFERENCE"]').exists()).toBe(true)
    expect(wrapper.find('h1').text()).toContain('ENFP')
  })

  it('四维得分条用 position 画位置，两端标签用内容包给的名称', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    const ei = wrapper.find('[data-dimension="EI"]')
    expect(ei.text()).toContain('内倾')
    expect(ei.text()).toContain('外倾')
    const dot = ei.find('[data-position-dot]')
    expect(dot.exists()).toBe(true)
    expect(dot.attributes('style')).toContain('62.5%')
  })

  it('页脚固定声明写明"参考测评、不是诊断、内容仍在内部审校中"，不露出内部状态码', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()
    const disclaimer = wrapper.find('[data-disclaimer]').text()
    expect(disclaimer).toContain('参考测评')
    expect(disclaimer).toContain('不是心理诊断')
    expect(disclaimer).toContain('内容仍在内部审校中')
    expect(disclaimer).not.toContain('draft_review_pending')
    expect(disclaimer).not.toContain('contentStatus')
  })
})

describe('报告页：TENTATIVE', () => {
  it('标题含「本次更接近」，且明说这一侧只是略偏、另一侧也值得读', async () => {
    api.detail = () => ({ status: 200, body: { report: TENTATIVE } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-status="TENTATIVE"]').exists()).toBe(true)
    const heading = wrapper.find('h1').text()
    expect(heading).toContain('本次更接近')
    expect(heading).toContain('ENFP')

    const notice = wrapper.find('[data-tentative-notice]').text()
    expect(notice).toContain('略偏')
    expect(notice).toContain('两端')
    // 另一侧的描述确实在页面里
    expect(wrapper.find('[data-dimension="EI"]').text()).toContain('内倾 I')
    expect(wrapper.find('[data-dimension="EI"]').text()).toContain('独处')
  })

  it('边界说明单独成段，说明"哪几维只是略偏"', async () => {
    api.detail = () => ({ status: 200, body: { report: TENTATIVE } })
    const { wrapper } = await mountReport()
    expect(wrapper.text()).toContain('哪几维只是略偏')
    expect(wrapper.text()).toContain('倾向较轻')
  })
})

describe('报告页：TIED', () => {
  it('主标题里**没有**任何四字母，也没有把候选第一项当主类型', async () => {
    api.detail = () => ({ status: 200, body: { report: TIED } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-status="TIED"]').exists()).toBe(true)
    const heading = wrapper.find('h1').text()
    expect(heading).not.toMatch(/[EI][SN][TF][JP]/)
    expect(heading).toContain('几个类型都值得一起看')

    // 整个页面里唯一出现四字母的地方只能是候选列表 / 自选下拉 / 方法与删除区，
    // **不能**出现"你是 XXXX"这种主类型措辞
    const text = wrapper.text()
    expect(text).not.toContain('本次参考类型')
    expect(text).not.toContain('本次更接近')
    expect(text).toContain('没有哪一个四字母类型更适合当主标题')
  })

  it('列出多个候选，并说明为什么都可能（平分维度 + 候选解释）', async () => {
    api.detail = () => ({ status: 200, body: { report: TIED } })
    const { wrapper } = await mountReport()

    const items = wrapper.findAll('[data-candidate]')
    expect(items.length).toBeGreaterThan(1)
    expect(items.map((item) => item.attributes('data-candidate'))).toEqual([
      'ENFP',
      'INFP',
      'ESFP',
    ])
    expect(wrapper.find('[data-tie-notice]').text()).toContain('没有区别')

    // 平分维度的两端描述都在
    const sn = wrapper.find('[data-dimension="SN"]').text()
    expect(sn).toContain('实感 S')
    expect(sn).toContain('直觉 N')
    expect(sn).toContain('两边接近')
  })

  it('候选的 cost 文案不出现「概率 / 准确率 / 可能性」，而是"需要偏离多少证据"', async () => {
    api.detail = () => ({ status: 200, body: { report: TIED } })
    const { wrapper } = await mountReport()

    const list = wrapper.find('[data-candidate-list]').text()
    for (const banned of ['概率', '准确率', '可能性', '几率', '百分位']) {
      expect(list, `候选说明里不该出现「${banned}」`).not.toContain(banned)
    }
    expect(list).toContain('需要偏离')
    expect(list).toContain('分证据')
    expect(list).toContain('精力方向')
  })
})

describe('报告页：404 的两种含义必须分开', () => {
  /**
   * `/reports/{id}` 的 404 **不是**"你还没做完"。
   * 这条路径只能按 reportId 取报告，所以 404 的含义是"这份报告不在这里"
   * （已被删除、编号有误，或链接属于别的账号）。
   * 以前这里会说"这次测评还没有报告可看 …回去把没处理的题补齐"，
   * 于是删掉一份报告后按浏览器后退，用户会被告知"你还没做完"并被送去重测一次。
   */
  it('按 reportId 打不开（404）：说的是"报告不在这里"，不是"你还没做完"', async () => {
    api.detail = () => ({
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: '没找到这个内容，可能已经被删掉了。',
        requestId: 'req-3',
        details: {},
      },
    })
    const { wrapper } = await mountReport(`/reports/${REPORT_ID}`)

    expect(wrapper.find('[data-report-not-found]').exists()).toBe(true)
    const text = wrapper.text()
    expect(text).toContain('这份报告打不开了')
    expect(text).toContain('已经被删除')
    expect(text).toContain('属于另一个账号')
    // 不能再让用户以为是自己没答完
    expect(text).not.toContain('还没有报告可看')
    expect(text).not.toContain('回去把没处理的题补齐')
    // 下一步是"回历史报告"，重新做一次只是次要选项
    expect(wrapper.find('a[href="/reports"]').exists()).toBe(true)
  })

  it('按 attempt 取不到（信息不足）：仍然说"还没有报告可看"并给回去补答的入口', async () => {
    api.detail = () => ({
      status: 404,
      body: {
        code: 'NOT_FOUND',
        message: '这次测评还没有报告。',
        requestId: 'req-4',
        details: {},
      },
    })
    const { wrapper } = await mountReport(`/reports/${REPORT_ID}`)
    const store = useReportStore()
    // 走"按 attempt 取报告"这条路（`AssessView` 交卷后的路径）
    await store.loadReportByAttempt(ATTEMPT_ID)
    await flushPromises()

    expect(store.loadedByAttempt).toBe(true)
    expect(store.notFound).toBe(true)
    // 这条路上 404 = 预期内的状态（信息不足），文案与下一步都要是"回去补答"
    const text = wrapper.text()
    expect(text).toContain('还没有报告可看')
    expect(text).toContain('回去把没处理的题补齐')
    expect(text).not.toContain('属于另一个账号')
  })
})

describe('报告页：报告形状不符合契约', () => {
  it('报告形状不符合契约时明确说读不出来，不用默认值补齐', async () => {
    api.detail = () => ({
      status: 200,
      body: { report: { reportId: REPORT_ID, status: 'REFERENCE' } },
    })
    const { wrapper } = await mountReport(`/reports/${REPORT_ID}`)
    expect(wrapper.find('[data-shape-error]').exists()).toBe(true)
    expect(wrapper.text()).toContain('不会用默认值补齐缺失字段')
  })
})

describe('报告页：分享三件套与自我理解', () => {
  it('复制的文字 / 图片替代文本 / 导出文件名都来自同一份 share', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-share-text]').text()).toContain('本次参考类型 ENFP 织梦者：复制用的文字。')
    expect(wrapper.text()).toContain('TypeMe 分享图：本次参考类型 ENFP 织梦者')
    expect(wrapper.text()).toContain('typeme-ENFP-reference.png')
  })

  it('复制走剪贴板，失败时给出手动复制的文字', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('没有权限'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    await wrapper.find('[data-copy-share]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalled()
    expect(wrapper.find('[data-notice]').text()).toContain('没能自动复制')
    expect(wrapper.find('[data-notice]').text()).toContain('复制用的文字')
  })

  it('保存自我理解只更新自我理解，不覆盖问卷结果', async () => {
    let current = REFERENCE
    api.detail = () => ({ status: 200, body: { report: current } })
    const { wrapper } = await mountReport()

    await wrapper.find('select').setValue('INFP')
    await wrapper.find('textarea').setValue('我自己觉得更像另一种。')
    await wrapper.find('[data-save-reflection]').trigger('click')
    await flushPromises()

    const put = calls.find((call) => call.method === 'PUT')!
    expect((put.body as { selfSelectedTypeCode: string }).selfSelectedTypeCode).toBe('INFP')
    expect(wrapper.find('[data-notice]').text()).toContain('问卷结果不会因此改变')
    // 问卷结果仍然是服务端那份快照
    expect(wrapper.find('h1').text()).toContain('ENFP')
    expect(wrapper.find('[data-type-name]').text()).toContain('织梦者')
  })
})

describe('报告页：过程层（由四字母推导，不是测量）', () => {
  it('四个过程、推导说明与框架局限都以可见文字出现', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    const block = wrapper.find('[data-dynamics]')
    expect(block.exists()).toBe(true)
    // 四个过程：位置 · 中文名 · 代号 · what · reading
    const processes = wrapper.findAll('[data-process]')
    expect(processes.map((item) => item.attributes('data-process'))).toEqual(['Ne', 'Fi', 'Te', 'Si'])
    expect(processes[0].text()).toContain('主导过程')
    expect(processes[0].text()).toContain('外倾直觉')
    expect(processes[0].text()).toContain('在外部世界里看见多种可能。')
    expect(processes[0].text()).toContain('你会先想到这件事还能变成什么。')

    // "推导"与"测量"的分界必须看得见（这一层的全部意义）
    expect(wrapper.find('[data-dynamics-basis]').text()).toContain('不是本次测出来的另一个结果')
    expect(wrapper.find('[data-dynamics-caveat]').text()).toContain('不是本次测量到的另一个结果')
    expect(wrapper.find('[data-dynamics-rule]').text().length).toBeGreaterThan(0)
    // 边界维度的换侧说明：要讲 E/I 换边的**真实后果**（同一套过程、主辅互换），
    // 而不是"方向整体对调"那种抽象说法——抽象措辞正是曾把 E/I 与 J/P 说反的土壤。
    const boundaryNote = wrapper.find('[data-boundary-note="EI"]').text()
    expect(boundaryNote).toContain('主导与辅助会互换')
    expect(boundaryNote).toContain('INFP')
  })

  it('建议块给出 3 段发展任务、4 个决策步（标出用不上偏好功能的两步）、互补与沟通规则', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-process-plan]').exists()).toBe(true)
    expect(wrapper.findAll('[data-development-stage]')).toHaveLength(3)
    expect(wrapper.findAll('[data-development-process]')).toHaveLength(4)

    const steps = wrapper.findAll('[data-decision-step]')
    expect(steps.map((step) => step.attributes('data-decision-step'))).toEqual(['S', 'N', 'T', 'F'])
    const unpreferred = wrapper.findAll('[data-decision-unpreferred]')
    expect(unpreferred).toHaveLength(2)
    expect(unpreferred.map((node) => node.text())).toEqual([
      '这一步用不上你偏好的功能',
      '这一步用不上你偏好的功能',
    ])
    expect(steps[0].text()).toContain('先用感觉处理事实')
    expect(wrapper.find('[data-hardest-note]').text()).toContain('最容易整段跳过')

    const opposites = wrapper.findAll('[data-opposite]')
    expect(opposites.map((node) => node.attributes('data-opposite'))).toEqual(['SN', 'TF'])
    expect(opposites[0].text()).toContain('你需要偏感觉的一侧提供')
    expect(opposites[0].text()).toContain('你能提供给偏感觉的一侧')

    const rules = wrapper.findAll('[data-communication-rule]')
    expect(rules.map((node) => node.attributes('data-communication-rule'))).toEqual([
      'EI',
      'SN',
      'TF',
      'JP',
    ])
    expect(wrapper.find('[data-development-note]').text()).toContain('四个过程没有高下')
    expect(wrapper.find('[data-grey-area-note]').text()).toContain('还没发展起来的过程不会消失')
  })

  it('过程层的文案里不出现准确率 / 概率 / 百分位 / 置信 / 确诊 / 命中注定 / 科学证明', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    const text = `${wrapper.find('[data-dynamics]').text()}\n${wrapper.find('[data-process-plan]').text()}`
    for (const banned of ['准确率', '概率', '百分位', '置信', '确诊', '命中注定', '科学证明']) {
      expect(text, `过程层不该出现「${banned}」`).not.toContain(banned)
    }
  })

  it('TIED（没有四字母）时两块都不渲染，也不编造内容', async () => {
    api.detail = () => ({ status: 200, body: { report: TIED } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-dynamics]').exists()).toBe(false)
    expect(wrapper.find('[data-process-plan]').exists()).toBe(false)
    expect(wrapper.findAll('[data-process]')).toHaveLength(0)
    expect(wrapper.findAll('[data-decision-step]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('主导过程')
    expect(wrapper.text()).not.toContain('四个精神活动过程')
  })

  it('旧快照（没有 methodology.dynamicsVersion、也没有这两块）照常渲染，不报读不出来', async () => {
    api.detail = () => ({ status: 200, body: { report: withoutProcessLayer(REFERENCE) } })
    const { wrapper } = await mountReport()

    // 旧快照是**正常的历史数据**，不是损坏：绝不能落到形状错误分支
    expect(wrapper.find('[data-shape-error]').exists()).toBe(false)
    expect(wrapper.find('[data-dynamics]').exists()).toBe(false)
    expect(wrapper.find('[data-process-plan]').exists()).toBe(false)
    // 其余内容照常
    expect(wrapper.find('h1').text()).toContain('ENFP')
    expect(wrapper.find('[data-dimension="EI"]').exists()).toBe(true)
    expect(wrapper.find('[data-share-text]').exists()).toBe(true)
  })

  it('标了过程层版本却只给了一块时，明确说读不出来（新报告漏字段是 bug）', async () => {
    const broken = reportJson({
      status: 'REFERENCE',
      typeCode: 'ENFP',
      headline: '本次参考类型 ENFP 织梦者',
      imageTitle: '本次参考类型',
      summary: '四个方向都比较清楚。',
      filename: 'typeme-ENFP-reference.png',
      dimensions: [
        dimensionRow(0, 'E'),
        dimensionRow(1, 'N'),
        dimensionRow(2, 'F'),
        dimensionRow(3, 'P'),
      ],
      // 只给结构、不给建议：这个组合在**新旧快照里都**是真损坏
      dynamics: dynamicsBlock(),
      processPlan: null,
    })
    api.detail = () => ({ status: 200, body: { report: broken } })
    const { wrapper } = await mountReport()

    expect(wrapper.find('[data-shape-error]').exists()).toBe(true)
    expect(wrapper.text()).toContain('只给了过程结构的一半')
    expect(wrapper.find('[data-dynamics]').exists()).toBe(false)
  })
})

describe('报告页：「这份报告是怎么来的」不展示内部版本号', () => {
  const INTERNAL_TOKENS = [
    'typeme-jung48-score',
    'typeme-type-report',
    'typeme-jung48-zh',
    'typeme-process-copy',
    'typeme-jung48-dynamics',
    'draft_review_pending',
    'methodology',
    '/api/v3/catalog',
    '指纹',
    'contentStatus',
  ]

  it('只写人能读的来源与权威口径，不把包 ID、指纹、接口字段名印出来', async () => {
    api.detail = () => ({ status: 200, body: { report: REFERENCE } })
    const { wrapper } = await mountReport()

    const method = wrapper.find('#report-method')
    expect(method.exists()).toBe(true)
    const text = method.text()
    expect(text).toContain('十六型人格参考测评')
    expect(text).toContain('自行撰写')
    expect(text).toContain('最终结论以这份报告为准')
    expect(wrapper.find('[data-delete-report]').exists()).toBe(true)
    const thresholds = wrapper.find('[data-method-thresholds]')
    expect(thresholds.exists()).toBe(true)
    expect(thresholds.text()).toContain('每个方向至少有 9 道有效数字答案')
    expect(thresholds.text()).toContain('主测题都处理过')
    expect(thresholds.text()).toContain('明确「说不好」不算数字答案，但算已经处理')
    expect(thresholds.text()).toContain('还没作答会让这一维覆盖不足')
    expect(thresholds.text()).not.toContain('未作答和明确「说不好」都不算')
    expect(thresholds.text()).toContain('再收紧一档才记为略偏')
    expect(thresholds.text()).toContain('有效作答刚好 10 题、两边差距为 2 时，这份快照不会标成略偏')
    expect(thresholds.text()).not.toContain('两边差距不超过 2 就记为略偏')
    expect(thresholds.text()).not.toContain('2/10 规则')
    for (const token of INTERNAL_TOKENS) {
      expect(text, `方法节不该出现「${token}」`).not.toContain(token)
    }
  })

  it('门槛数字跟这份快照走，不是页面写死的', async () => {
    api.detail = () => ({
      status: 200,
      body: {
        report: {
          ...REFERENCE,
          methodology: {
            ...METHODOLOGY,
            minBaseRatingsPerDimension: 7,
            boundaryNumerator: 3,
            boundaryDenominator: 8,
          },
        },
      },
    })
    const { wrapper } = await mountReport()
    const text = wrapper.find('[data-method-thresholds]').text()
    expect(text).toContain('每个方向至少有 7 道有效数字答案')
    expect(text).toContain('有效作答每 8 题先得到两边差距不超过 3 的一条线')
    expect(text).toContain('刚好 8 题、两边差距为 3 时，这份快照不会标成略偏')
    expect(text).not.toContain('每个方向至少有 9 道有效数字答案')
    expect(text).not.toContain('typeme-jung48-score')
  })

  it('v3 快照用统一尺度解释略偏，且仍不露出版本号', async () => {
    api.detail = () => ({
      status: 200,
      body: {
        report: {
          ...REFERENCE,
          methodology: {
            ...METHODOLOGY,
            scoringVersion: 'typeme-jung48-score-v3',
            policyVersion: 'typeme-jung48-score-v3',
          },
        },
      },
    })
    const { wrapper } = await mountReport()
    const text = wrapper.find('[data-method-thresholds]').text()
    expect(text).toContain('有效作答每 10 题，两边差距不超过 2 就记为略偏')
    expect(text).not.toContain('再收紧一档')
    expect(text).not.toContain('typeme-jung48-score')
    expect(text).toContain('还没作答会让这一维覆盖不足')
  })

  it('v4 快照按新的分母解释略偏（每 5 题差距不超过 2），且仍不露出版本号', async () => {
    api.detail = () => ({
      status: 200,
      body: {
        report: {
          ...REFERENCE,
          methodology: {
            ...METHODOLOGY,
            scoringVersion: 'typeme-jung48-score-v4',
            policyVersion: 'typeme-jung48-score-v4',
            boundaryDenominator: 5,
          },
        },
      },
    })
    const { wrapper } = await mountReport()
    const text = wrapper.find('[data-method-thresholds]').text()
    expect(text).toContain('有效作答每 5 题，两边差距不超过 2 就记为略偏')
    expect(text, '不能把 v3 的 10 题门槛说到 v4 的快照上').not.toContain('每 10 题')
    expect(text).not.toContain('再收紧一档')
    expect(text).not.toContain('typeme-jung48-score')
  })

  it('旧快照同样不露出内部版本占位', async () => {
    api.detail = () => ({ status: 200, body: { report: withoutProcessLayer(REFERENCE) } })
    const { wrapper } = await mountReport()

    const text = wrapper.find('#report-method').text()
    expect(text).toContain('自行撰写')
    expect(text).not.toContain('这份快照没有记录')
    for (const token of INTERNAL_TOKENS) {
      expect(text, `旧快照方法节不该出现「${token}」`).not.toContain(token)
    }
  })
})

describe('报告页：历史列表', () => {
  it('倒序显示日期与状态，能进详情，能删除', async () => {
    api.list = () => ({
      status: 200,
      body: {
        items: [
          {
            reportId: 'report-old',
            attemptId: 'a1',
            createdAt: '2026-09-01T08:00:00Z',
            status: 'TIED',
            computedTypeCode: null,
            selfSelectedTypeCode: null,
            summaryLine: '早一点的那次。',
            packageId: 'typeme-jung48-zh-v1',
            scoringVersion: 'typeme-jung48-score-v1',
          },
          {
            reportId: 'report-new',
            attemptId: 'a2',
            createdAt: '2026-09-16T08:00:00Z',
            status: 'REFERENCE',
            computedTypeCode: 'ENFP',
            selfSelectedTypeCode: 'INFP',
            summaryLine: '最近的那次。',
            packageId: 'typeme-jung48-zh-v1',
            scoringVersion: 'typeme-jung48-score-v1',
          },
        ],
        page: 0,
        size: 50,
        total: 2,
      },
    })

    const { wrapper } = await mountReport('/reports')
    expect(wrapper.find('[data-report-list]').exists()).toBe(true)

    const rows = wrapper.findAll('[data-report-row]')
    expect(rows.map((row) => row.attributes('data-report-row'))).toEqual(['report-new', 'report-old'])
    expect(rows[0].text()).toContain('参考类型')
    expect(rows[0].text()).toContain('你自己觉得更像：INFP')
    expect(rows[1].text()).toContain('几个方向并列')

    const link = rows[0].find('a')
    expect(link.attributes('href')).toBe('/reports/report-new')

    // 删除必须先确认：这里只断言"弹窗出现了"，真正的删除另有一条测试
    await rows[1].find('[data-delete-report]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('删除这条记录会同时删掉它的答案与相关记录')
    expect(wrapper.text()).toContain('保留')
  })

  it('确认后真的发出 DELETE，并把该行从列表里去掉', async () => {
    api.list = () => ({
      status: 200,
      body: {
        items: [
          {
            reportId: 'report-new',
            attemptId: 'a2',
            createdAt: '2026-09-16T08:00:00Z',
            status: 'REFERENCE',
            computedTypeCode: 'ENFP',
            selfSelectedTypeCode: null,
            summaryLine: '最近的那次。',
            packageId: 'typeme-jung48-zh-v1',
            scoringVersion: 'typeme-jung48-score-v1',
          },
        ],
        page: 0,
        size: 50,
        total: 1,
      },
    })
    const { wrapper } = await mountReport('/reports')
    await wrapper.find('[data-delete-report="report-new"]').trigger('click')
    await flushPromises()

    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '删除记录')!
    await confirm.trigger('click')
    await flushPromises()

    const deletes = calls.filter((call) => call.method === 'DELETE')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].url).toContain('/reports/report-new')
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(0)
  })

  it('没有记录时说明"做完一次之后会出现在这里"', async () => {
    const { wrapper } = await mountReport('/reports')
    expect(wrapper.text()).toContain('还没有完成的测评')
    expect(wrapper.text()).toContain('换设备登录也能看到')
  })

  it('列表载入失败时给出重试入口，不显示空列表', async () => {
    api.list = () => ({
      status: 500,
      body: { code: 'INTERNAL', message: '服务器出错了。', requestId: 'req-9', details: {} },
    })
    const { wrapper } = await mountReport('/reports')
    expect(wrapper.text()).toContain('记录没能载入')
    expect(wrapper.findAll('button').some((button) => button.text() === '重试')).toBe(true)
    expect(wrapper.text()).not.toContain('还没有完成的测评')
  })

  /**
   * 删除失败以前被写进"列表载入失败"那条通道，于是整块列表被替换成
   * 「记录没能载入：…」—— 用户会以为自己的历史记录都读不到了，
   * 而真相只是"这一份没删掉"。这两件事的原因、影响面和下一步都不一样。
   */
  it('删除失败时：只说这一份没删掉，列表不会被「记录没能载入」顶掉', async () => {
    api.list = () => ({
      status: 200,
      body: {
        items: [
          {
            reportId: 'report-new',
            attemptId: 'a2',
            createdAt: '2026-09-16T08:00:00Z',
            status: 'REFERENCE',
            computedTypeCode: 'ENFP',
            selfSelectedTypeCode: null,
            summaryLine: '最近的那次。',
            packageId: 'typeme-jung48-zh-v1',
            scoringVersion: 'typeme-jung48-score-v1',
          },
        ],
        page: 0,
        size: 50,
        total: 1,
      },
    })
    api.onDelete = () => ({
      status: 500,
      body: { code: 'INTERNAL', message: '服务器出错了。', requestId: 'req-77', details: {} },
    })

    const { wrapper } = await mountReport('/reports')
    await wrapper.find('[data-delete-report="report-new"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '删除记录')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-report-remove-error]').exists()).toBe(true)
    expect(wrapper.find('[data-report-remove-error]').text()).toContain('服务器出错了')
    // 列表必须原样留着：这一份还在，用户还能再试一次
    expect(wrapper.find('[data-report-list]').exists()).toBe(true)
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(1)
    // 也不许把它说成"记录没能载入"
    expect(wrapper.text()).not.toContain('记录没能载入')
  })

  /**
   * 双击确认曾经会发出两个 DELETE：第二个撞 404，于是在数据**已经删掉**之后
   * 把结果翻成"删除没能完成"。在途期间必须只有一个请求，而且界面要如实显示"正在删除"。
   */
  it('删除在途时：只有一个 DELETE，确认键禁用并显示「正在删除…」', async () => {
    api.list = () => ({
      status: 200,
      body: {
        items: [
          {
            reportId: 'report-new',
            attemptId: 'a2',
            createdAt: '2026-09-16T08:00:00Z',
            status: 'REFERENCE',
            computedTypeCode: 'ENFP',
            selfSelectedTypeCode: null,
            summaryLine: '最近的那次。',
            packageId: 'typeme-jung48-zh-v1',
            scoringVersion: 'typeme-jung48-score-v1',
          },
        ],
        page: 0,
        size: 50,
        total: 1,
      },
    })
    let release: (() => void) | null = null
    api.onDelete = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(new Response(null, { status: 204 }))
      })

    const { wrapper } = await mountReport('/reports')
    await wrapper.find('[data-delete-report="report-new"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '删除记录')!.trigger('click')
    await flushPromises()

    // 请求还在路上：弹窗不关、确认键禁用且如实说明在做什么
    expect(wrapper.text()).toContain('删除这条记录会同时删掉它的答案与相关记录')
    const busy = wrapper.findAll('button').find((button) => button.text() === '正在删除…')
    expect(busy).toBeTruthy()
    expect((busy!.element as HTMLButtonElement).disabled).toBe(true)

    // 再点一次（模拟双击的第二下）
    await busy!.trigger('click')
    await flushPromises()
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
    // 还没成功，这一行就不该消失
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(1)

    release!()
    await flushPromises()
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(0)
    expect(wrapper.text()).toContain('报告已经删除')
    expect(wrapper.find('[data-report-remove-error]').exists()).toBe(false)
  })
})

describe('视图模型对四种状态的口径（与页面一致）', () => {
  it('TIED 的 share.headline 与 h1 都不含四字母；TENTATIVE 含"更接近"', () => {
    const tied = buildReportView(TIED)
    expect(tied.share.headline).not.toMatch(/[EI][SN][TF][JP]/)
    expect(tied.typeCode).toBeNull()

    const tentative = buildReportView(TENTATIVE)
    expect(tentative.share.headline).toContain('本次更接近')
    expect(tentative.boundaryNotes.length).toBeGreaterThan(0)
  })
})
