// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchInstrumentDetail,
  fetchInstruments,
  fetchMyAttempts,
  fetchMyReports,
  fetchPlatformAttempt,
  fetchPlatformReport,
  isEnvelopedReport,
  parseBigFiveReport,
  reportBodyOf,
} from './platformV3'

/**
 * `api/platformV3.ts` 的**接口层**测试：请求打到哪个路径、响应怎么解析。
 *
 * ## 为什么这一层必须有测试（这一轮的直接教训）
 *
 * 第 20 轮之前这个文件**一条测试都没有**，于是两件事同时错了而没人发现：
 *
 *   1. `BASE` 写成了 `/api/v3/platform`，而 `v3Request` 自己会再加 `/api/v3` ——
 *      每个请求都变成 `/api/v3/api/v3/platform/...`，全部 404。页面上的表现是
 *      "目录永远是空的"，看起来像后端没部署。
 *   2. 卡片解析要求 `format`/`dimensions`/`defaultPackageId` 等字段，而当时的替身
 *      夹具是按"看起来合理"编的，字段对不上 → 解析器抛 `UNEXPECTED_RESPONSE_CODE`。
 *
 * 两件事**都只在真实请求与真实响应形状下才暴露**，而它们恰好是"页面看起来正常
 * 但没有内容"这种最难排查的故障。所以这里用请求替身把两边都钉住：
 * 逐字断言 URL，并用**后端真实 DTO 的字段集合**当响应。
 *
 * ## 这些测试不证明什么
 *
 * 它们不证明后端真的会返回这些字段（那由 `BigFivePlatformIT` 的端到端用例证明），
 * 也不证明量表本身可靠。它们只证明"前端发出的路径是对的、解析器接受真实形状"。
 */

const CATALOG_ITEM = {
  slug: 'bigfive50',
  kind: 'big_five',
  title: '大五人格倾向测评',
  tagline: '五个方面各自独立',
  summary: '五个方面各自独立，没有类型、不看总分。',
  whatYouLearn: ['五个方面的位置'],
  notFor: ['判断能力高低'],
  format: 'agreement',
  hasTypeCode: false,
  supportsClarification: false,
  dimensions: ['E', 'A', 'C', 'ES', 'O'],
  defaultPackageId: 'typeme-bigfive50-zh-v1',
  baseItemCount: 50,
  clarificationItemCount: 0,
  maxClarificationItems: 0,
  estimatedMinutes: 10,
  contentStatus: 'draft_review_pending',
}

const ATTEMPT = {
  attemptId: 'a1',
  instrumentSlug: 'bigfive50',
  instrumentKind: 'big_five',
  instrumentTitle: '大五人格倾向测评',
  packageId: 'typeme-bigfive50-zh-v1',
  reportKind: 'big_five_profile',
  status: 'DRAFT',
  revision: 4,
  currentQuestionId: null,
  clarificationDimensions: [],
  clarificationSkipped: false,
  startedAt: '2026-09-18T10:00:00Z',
  updatedAt: '2026-09-18T10:05:00Z',
  submittedAt: null,
  baseAttemptId: null,
  reportId: null,
  answers: [{ questionId: 'Q01', kind: 'RATING', rating: 4 }],
  items: [
    {
      id: 'Q01',
      kind: 'agreement_statement',
      stage: 'base',
      dimension: 'E',
      order: 1,
      scenario: null,
      left: null,
      right: null,
      statement: '我很容易和陌生人聊起来。',
      leftPole: null,
      rightPole: null,
      direction: 1,
      help: '这一题问的是……',
    },
  ],
  answeredCount: 1,
  requiredCount: 50,
  answerComplete: false,
}

const REPORT_BODY = {
  schemaVersion: 2,
  reportId: 'r1',
  attemptId: 'a1',
  createdAt: '2026-09-18T10:10:00Z',
  status: 'PROFILE',
  profileTitle: '大五人格倾向测评',
  hasTypeCode: false,
  summary: '这次回答里，E 这一个方面的方向比较清楚。',
  // 诱饵：故意和外壳层不同。解析器真去读它会拿到 'e'*64，就能被这条用例抓住。
  reportHash: 'e'.repeat(64),
  dimensions: [
    {
      dimension: 'E',
      name: '外向性',
      question: '你在人群里是充上电还是耗电？',
      rawScore: 34,
      rangeLow: 10,
      rangeHigh: 50,
      midpoint: 30,
      distance: 4,
      hasResult: true,
      validCount: 10,
      unknownCount: 0,
      unprocessedCount: 0,
      direction: 'high',
      level: 'MARKED_HIGH',
      levelLabel: '比较明显',
      sideLabel: '偏外向',
      description: '你更常从和人打交道里获得精力。',
      dailySigns: ['聚会结束后还愿意再聊一会儿'],
      reading: '本次外向性的分数是 34，比中间值高 4 分。',
      observation: '留意你在聚会前后的精力变化。',
      caution: '这只是本次作答的结果。',
    },
  ],
  coverage: {
    completed: true,
    coverageOk: true,
    unknownCount: 0,
    unprocessedCount: 0,
    incompleteDimensions: [],
  },
  readingOrder: [{ step: '先看方向比较明显的方面', why: '这些读起来最像你。' }],
  limitations: ['这份结果只来自这一次作答。'],
  methodology: {
    scoringVersion: 'typeme-bigfive50-score-v1',
    packageId: 'typeme-bigfive50-zh-v1',
    contentStatus: 'draft_review_pending',
    contentSha256: 'a'.repeat(64),
    policyVersion: 'typeme-bigfive50-score-v1',
    minBaseRatingsPerDimension: 10,
    midpoint: 30,
    markedDistance: 6,
    strongDistance: 11,
    resolvedDimensions: 5,
    submittedAt: '2026-09-18T10:10:00Z',
  },
}

/** v2 外壳：报告体在 `report` 里，同时带上"按哪一版内容生成"。 */
const ENVELOPED = {
  instrument: { slug: 'bigfive50', kind: 'big_five', packageId: 'typeme-bigfive50-zh-v1' },
  reportKind: 'big_five_profile',
  schemaVersion: 2,
  report: REPORT_BODY,
  // 后端把指纹追加在**外壳**上（finalizeWithHash 在 wrap 之后执行），
  // 所以真实快照的 body 里没有这个键 —— 它比 body 里那个诱饵值更能说明问题。
  reportHash: 'f'.repeat(64),
}

const REPORT_DETAIL = {
  reportId: 'r1',
  attemptId: 'a1',
  instrumentSlug: 'bigfive50',
  instrumentKind: 'big_five',
  instrumentTitle: '大五人格倾向测评',
  reportKind: 'big_five_profile',
  packageId: 'typeme-bigfive50-zh-v1',
  createdAt: '2026-09-18T10:10:00Z',
  status: 'PROFILE',
  computedTypeCode: null,
  summaryLine: REPORT_BODY.summary,
  report: ENVELOPED,
  selfReflection: null,
  // 后端 `ReportDetailView` 的真实字段：报告绑定的那次作答的修订号。
  // 少了它解析器会明确报错 —— 这条正是替身夹具与真实 DTO 对不上的例子。
  attemptRevision: 4,
}

const urls: string[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(routes: Record<string, unknown>): void {
  const handler = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    urls.push(url)
    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    for (const [key, body] of Object.entries(routes)) {
      if (url.includes(key)) return jsonResponse(body)
    }
    return jsonResponse({ code: 'NOT_FOUND', message: `没有为 ${url} 准备替身` }, 404)
  }
  vi.stubGlobal('fetch', handler as never)
}

function platformUrl(suffix: string): string | undefined {
  return urls.find((url) => url.includes(suffix))
}

beforeEach(() => {
  urls.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('平台接口的请求路径', () => {
  it('每个请求都只用一段 /api/v3 前缀（不要拼成 /api/v3/api/v3/...）', async () => {
    installFetch({
      '/platform/instruments/bigfive50': {
        instrument: CATALOG_ITEM,
        dimensions: [],
        versions: [],
      },
      '/platform/instruments': { items: [CATALOG_ITEM] },
      '/platform/attempts/a1': ATTEMPT,
      '/platform/reports/r1': REPORT_DETAIL,
      '/platform/attempts?page=0&size=20': { items: [], page: 0, size: 20, total: 0 },
      '/platform/reports?page=0&size=20': { items: [], page: 0, size: 20, total: 0 },
    })

    await fetchInstruments()
    await fetchInstrumentDetail('bigfive50')
    await fetchPlatformAttempt('a1')
    await fetchPlatformReport('r1')
    await fetchMyAttempts()
    await fetchMyReports()

    expect(urls.length).toBeGreaterThanOrEqual(6)
    for (const url of urls) {
      if (url.includes('/auth/csrf')) continue
      expect(url.startsWith('/api/v3/platform/')).toBe(true)
      expect(url).not.toContain('/api/v3/api/v3')
    }
    // 逐句断言具体路径，让"前缀写全"这种错在测试里一眼可见
    expect(platformUrl('/platform/instruments')).toBeDefined()
    expect(platformUrl('/platform/attempts/a1')).toBeDefined()
    expect(platformUrl('/platform/reports/r1')).toBeDefined()
  })

  it('slug 会被转义（slug 不是可信输入）', async () => {
    installFetch({ '/platform/instruments': { instrument: CATALOG_ITEM, dimensions: [], versions: [] } })
    await fetchInstrumentDetail('a b/c')
    expect(urls.some((url) => url.includes('a%20b%2Fc'))).toBe(true)
  })
})

describe('目录解析', () => {
  it('接受后端真实字段集合', async () => {
    installFetch({ '/platform/instruments': { items: [CATALOG_ITEM] } })
    const items = await fetchInstruments()
    expect(items).toHaveLength(1)
    expect(items[0]!.slug).toBe('bigfive50')
    expect(items[0]!.kind).toBe('big_five')
    expect(items[0]!.hasTypeCode).toBe(false)
    expect(items[0]!.dimensions).toEqual(['E', 'A', 'C', 'ES', 'O'])
  })

  it('缺字段时明确报错，而不是编一个默认值', async () => {
    const broken = { ...CATALOG_ITEM } as Record<string, unknown>
    delete broken['estimatedMinutes']
    installFetch({ '/platform/instruments': { items: [broken] } })
    await expect(fetchInstruments()).rejects.toThrow(/estimatedMinutes/)
  })

  it('未知的量表种类不会被当成已知的', async () => {
    installFetch({ '/platform/instruments': { items: [{ ...CATALOG_ITEM, kind: 'hexaco' }] } })
    await expect(fetchInstruments()).rejects.toThrow(/kind/)
  })
})

describe('答题视图解析', () => {
  it('解析题干、方向与已作答', async () => {
    installFetch({ '/platform/attempts/a1': ATTEMPT })
    const view = await fetchPlatformAttempt('a1')
    expect(view.instrumentKind).toBe('big_five')
    expect(view.reportKind).toBe('big_five_profile')
    expect(view.items[0]!.statement).toBe('我很容易和陌生人聊起来。')
    expect(view.items[0]!.direction).toBe(1)
    expect(view.items[0]!.left).toBeNull()
    expect(view.answers[0]!.rating).toBe(4)
    expect(view.requiredCount).toBe(50)
    expect(view.answerComplete).toBe(false)
  })

  it('rating 缺失与 rating=null 都当成"没有分数"，不当成 0', async () => {
    const unknownAnswer = { ...ATTEMPT, answers: [{ questionId: 'Q01', kind: 'UNKNOWN' }] }
    installFetch({ '/platform/attempts/a1': unknownAnswer })
    const view = await fetchPlatformAttempt('a1')
    expect(view.answers[0]!.rating).toBeNull()

    const zero = { ...ATTEMPT, answers: [{ questionId: 'Q01', kind: 'RATING', rating: 0 }] }
    installFetch({ '/platform/attempts/a1': zero })
    const again = await fetchPlatformAttempt('a1')
    // 0 是"一个数值"，不是"没有分数"—— 两者必须分得开
    expect(again.answers[0]!.rating).toBe(0)
  })
})

describe('报告解析', () => {
  it('认出 v2 外壳并把报告体取出来', async () => {
    installFetch({ '/platform/reports/r1': REPORT_DETAIL })
    const detail = await fetchPlatformReport('r1')
    expect(detail.instrumentTitle).toBe('大五人格倾向测评')
    expect(isEnvelopedReport(detail.report)).toBe(true)
    // 外壳那一层才有 reportKind；`report` 里面是报告体
    expect(detail.report['reportKind']).toBe('big_five_profile')
    const body = reportBodyOf(detail.report)
    expect(body['reportKind']).toBeUndefined()
    expect(body['status']).toBe('PROFILE')
    expect(body['dimensions']).toHaveLength(1)
  })

  it('解析器吃整份快照：外壳在、报告体里没有指纹时也不能报错', async () => {
    // 这条用例来自一个真实故障：调用方之前先 `reportBodyOf()` 下钻一层再交给解析器，
    // 而 `reportHash` 只在外壳上（后端 finalizeWithHash 在 wrap 之后追加），
    // 于是 2026-09-20 之后生成的新报告一律显示「这份报告读不出来」。
    installFetch({ '/platform/reports/r1': REPORT_DETAIL })
    const detail = await fetchPlatformReport('r1')
    const view = parseBigFiveReport(detail.report)
    expect(view.status).toBe('PROFILE')
    expect(view.dimensions).toHaveLength(1)
    // 指纹属于快照而不属于报告体；换成 body 后读到的是另一层（这里放了个诱饵值）。
    expect((detail.report as Record<string, unknown>)['reportHash']).toBe('f'.repeat(64))
    expect(reportBodyOf(detail.report)['reportHash']).toBe('e'.repeat(64))
  })

  it('没有外壳的旧报告也能读（不能因为升级就打成破版）', async () => {
    // v1 报告没有 instrument/report 外壳，raw 就是报告本身；
    // 此时根节点既是外壳又是报告体，解析器照样吃整份快照。
    const unwrapped = { ...REPORT_DETAIL, report: REPORT_BODY }
    installFetch({ '/platform/reports/r1': unwrapped })
    const detail = await fetchPlatformReport('r1')
    expect(isEnvelopedReport(detail.report)).toBe(false)
    // 解析器要能吃下这种形状
    const parsed = parseBigFiveReport(detail.report)
    expect(parsed.dimensions).toHaveLength(1)
  })

  it('中点取自服务端，而不是两端平均', async () => {
    installFetch({ '/platform/reports/r1': REPORT_DETAIL })
    const detail = await fetchPlatformReport('r1')
    const parsed = parseBigFiveReport(detail.report)
    expect(parsed.dimensions[0]!.midpoint).toBe(30)

    // 反例：把量程改成大五真实的不对称形状（ES 是 6–50）。
    // 此时两端平均是 28，而权威中点仍是 30 —— 用平均去算就会画错位置。
    const asymmetric = JSON.parse(JSON.stringify(ENVELOPED)) as Record<string, unknown>
    const asymBody = asymmetric['report'] as Record<string, unknown>
    const dims = asymBody['dimensions'] as Record<string, unknown>[]
    dims[0]!['rangeLow'] = 6
    dims[0]!['rangeHigh'] = 50
    const parsedAsymmetric = parseBigFiveReport(asymmetric)
    expect(parsedAsymmetric.dimensions[0]!.midpoint).toBe(30)
    expect(
      (parsedAsymmetric.dimensions[0]!.rangeLow + parsedAsymmetric.dimensions[0]!.rangeHigh) / 2,
    ).toBe(28)
  })

  it('报告体缺字段时抛出可诊断的错误', async () => {
    const broken = JSON.parse(JSON.stringify(ENVELOPED)) as Record<string, unknown>
    const body = broken['report'] as Record<string, unknown>
    delete body['coverage']
    installFetch({ '/platform/reports/r1': { ...REPORT_DETAIL, report: broken } })
    const detail = await fetchPlatformReport('r1')
    expect(() => parseBigFiveReport(detail.report)).toThrow(/coverage/)
  })
})
