// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAssessmentStore } from './assessmentV3'

/**
 * 草稿 store 的**幂等键归属**（A35 的前端一半）。
 *
 * <p>契约 02 §6.1 说 `Idempotency-Key` 的作用是"同一次点击复用同一个键"。
 * 执行这件事的地方只有 store：`createAttempt()` 每次调用都会新生成一个键，
 * 所以如果 store 不自己保存键，"用户点重试"在服务端看来就是**另一次点击**
 * —— 于是建出第二份草稿。而草稿在第 18 轮之前没有任何列表入口，
 * 那份额外的草稿对用户完全不可见（这也是这一轮要同时做 A51 的原因）。
 *
 * <p>注意这里断言的是**请求上真的带了什么**（header 里的键），
 * 而不是"store 里有个字段"—— 后者即使没接上线也照样通过。
 */

const PACKAGE = {
  schemaVersion: 1,
  packageId: 'typeme-jung48-zh-v1',
  instrument: {
    id: 'typeme-jung48',
    revision: 'r1',
    scoringVersion: 'typeme-jung48-score-v1',
    reportContentVersion: 'typeme-type-report-zh-v1',
    format: 'bipolar',
    hasTypeCode: true,
    baseItemsPerDimension: 1,
    clarificationItemsPerDimension: 1,
    maxClarificationItems: 4,
  },
  title: '十六型倾向自测',
  contentStatus: 'draft_review_pending',
  scoringPolicy: {
    version: 'typeme-jung48-score-v1',
    minBaseRatingsPerDimension: 1,
    boundaryNumerator: 2,
    boundaryDenominator: 10,
    ratingMin: 1,
    ratingMax: 5,
    ratingNeutral: 3,
  },
  dimensions: ['EI', 'SN', 'TF', 'JP'].map((dimension) => ({
    dimension,
    name: `维度 ${dimension}`,
    question: '这一维问什么',
    negativePole: { pole: 'I', label: '内倾', description: '独处恢复精力。', dailySigns: ['话不多'] },
    positivePole: { pole: 'E', label: '外倾', description: '与人来往恢复精力。', dailySigns: ['话多'] },
    balanced: { summary: '两边接近。', reading: '两边都可以读。' },
    tiedNotice: '这一维两边接近。',
  })),
  questions: [
    { id: 'q1', stage: 'base', dimension: 'EI', scenario: '一', textLeft: '左', textRight: '右', leftPole: 'I', rightPole: 'E', help: '提示', facet: 'f', order: 1, reviewStatus: 'reviewed' },
  ],
  sha256: 'c'.repeat(64),
}

interface Recorded {
  method: string
  url: string
  idempotencyKey: string | null
}

let calls: Recorded[] = []
/** 每次 POST /attempts 返回的状态码序列（用完后一直用最后一个）。 */
let createStatuses: number[] = []

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  let created = 0
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init?.headers ?? {})
    calls.push({ method, url, idempotencyKey: headers.get('Idempotency-Key') })

    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    if (method === 'POST' && url.endsWith('/attempts')) {
      created += 1
      const status = createStatuses[Math.min(created - 1, createStatuses.length - 1)] ?? 201
      if (status !== 201) {
        return jsonResponse(
          { code: 'INTERNAL_ERROR', message: '服务暂时没能开始这次测评。', requestId: 'req-z', details: {} },
          status,
        )
      }
      return jsonResponse({
        attemptId: `attempt-${created}`,
        packageId: PACKAGE.packageId,
        status: 'BASE_IN_PROGRESS',
        revision: 0,
        currentQuestionId: 'q1',
        clarificationDimensions: [],
        clarificationSkipped: false,
        startedAt: '2026-09-18T10:00:00Z',
        updatedAt: '2026-09-18T10:00:00Z',
        submittedAt: null,
        reportId: null,
      }, 201)
    }
    if (method === 'GET' && /\/attempts\/[^/?]+$/.test(url)) {
      // 详情：带上内容包快照，`load()` 才会真的把包装进来
      return jsonResponse({
        attemptId: url.split('/').pop(),
        packageId: PACKAGE.packageId,
        status: 'BASE_IN_PROGRESS',
        revision: 0,
        currentQuestionId: 'q1',
        clarificationDimensions: [],
        clarificationSkipped: false,
        startedAt: '2026-09-18T10:00:00Z',
        updatedAt: '2026-09-18T10:00:00Z',
        submittedAt: null,
        reportId: null,
        baseAttemptId: null,
        answers: [],
        coverage: [],
        packageContent: PACKAGE,
      })
    }
    return jsonResponse({ code: 'NOT_FOUND', message: `没有为 ${method} ${url} 准备替身` }, 404)
  }
  vi.stubGlobal('fetch', handler as never)
}

function createCalls(): Recorded[] {
  return calls.filter((call) => call.method === 'POST' && call.url.endsWith('/attempts'))
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  createStatuses = [201]
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('草稿 store：建测评的幂等键', () => {
  it('第一次就成功时也带上幂等键（否则服务端根本没有重放的依据）', async () => {
    const store = useAssessmentStore()
    await store.create()

    const sent = createCalls()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.idempotencyKey).toBeTruthy()
  })

  it('建失败后重试必须复用同一个键 —— 服务端才会重放成同一份草稿', async () => {
    createStatuses = [503, 201]
    const store = useAssessmentStore()

    await expect(store.create()).rejects.toBeTruthy()
    await store.create()

    const sent = createCalls()
    expect(sent).toHaveLength(2)
    expect(sent[0]?.idempotencyKey).toBe(sent[1]?.idempotencyKey)
  })

  it('成功之后是"新的一次点击"：换一个新的键（否则会永远拿回同一份草稿）', async () => {
    const store = useAssessmentStore()
    await store.create()
    await store.create()

    const sent = createCalls()
    expect(sent).toHaveLength(2)
    expect(sent[1]?.idempotencyKey).not.toBe(sent[0]?.idempotencyKey)
  })

  it('两次成功的建测评真的得到两份不同的草稿（键不同 → attemptId 不同）', async () => {
    const store = useAssessmentStore()
    const first = await store.create()
    const second = await store.create()

    expect(second.attemptId).not.toBe(first.attemptId)
  })
})
