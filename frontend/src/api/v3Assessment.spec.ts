import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createAttempt,
  fetchAttemptDetail,
  fetchReports,
  patchAnswers,
  submitAttempt,
  currentRevisionOf,
} from './v3Assessment'
import { isRevisionConflict, V3ApiError } from './v3'

/**
 * 新测接口层（`api/v3Assessment.ts`）测试。
 *
 * 这一层的价值只有一个：**后端真的发来形状不同的 JSON 时，我们当场报错**，
 * 而不是把 `undefined` 一路带到页面上、让用户看到"未知类型"这种看不出问题的症状。
 *
 * 因此这里集中钉三件事：
 *   1. 请求怎么发（路径、方法、revision、幂等键）；
 *   2. 响应缺字段时抛 `UNEXPECTED_RESPONSE_CODE`（不是静默返回 undefined）；
 *   3. 后端 DTO 与契约文档不一致的地方（`packageContent`、`coverage` 推导覆盖不足）
 *      在**这一层**就被吸收掉，页面不需要知道这些差异。
 */

interface Call {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

let calls: Call[] = []
let responder: (call: Call) => Response = () => json({})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[key] = value
      }
      const call: Call = {
        method,
        url,
        headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      return responder(call)
    }) as never,
  )
}

const PACKAGE = {
  schemaVersion: 1,
  packageId: 'typeme-jung48-zh-v1',
  instrument: { id: 'typeme-jung48', revision: 'r1', scoringVersion: 's1', reportContentVersion: 'c1' },
  title: '十六型倾向自测',
  contentStatus: 'draft_review_pending',
  scoringPolicy: { version: 's1', minBaseRatingsPerDimension: 9 },
  dimensions: [],
  questions: [],
  sha256: 'd'.repeat(64),
}

const DETAIL = {
  attemptId: 'attempt-1',
  packageId: 'typeme-jung48-zh-v1',
  status: 'BASE_IN_PROGRESS',
  revision: 4,
  currentQuestionId: 'q3',
  clarificationDimensions: ['SN'],
  clarificationSkipped: false,
  startedAt: '2026-09-16T10:00:00Z',
  updatedAt: '2026-09-16T10:05:00Z',
  submittedAt: null,
  reportId: null,
  baseAttemptId: null,
  answers: [{ questionId: 'q1', kind: 'RATING', rating: 4 }],
  coverage: [
    {
      dimension: 'EI',
      baseRatingCount: 12,
      baseUnknownCount: 0,
      baseUnprocessedCount: 0,
      needsClarification: false,
      coverageOk: true,
    },
  ],
  // ⚠️ 实现里的字段名（契约文档写的是 `package`）
  packageContent: PACKAGE,
}

beforeEach(() => {
  calls = []
  responder = () => json({})
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('请求形状', () => {
  it('PATCH 答案带上 expectedRevision 与逐题作答', async () => {
    responder = () =>
      json({ revision: 5, status: 'BASE_IN_PROGRESS', clarificationDimensions: [], clarificationReset: false })

    const result = await patchAnswers('attempt-1', {
      expectedRevision: 4,
      responses: [{ questionId: 'q3', kind: 'rating', rating: 5 }],
      currentQuestionId: 'q3',
    })

    expect(calls).toHaveLength(2) // 写操作前先取 CSRF token
    const patch = calls.find((call) => call.method === 'PATCH')!
    expect(patch.url).toContain('/attempts/attempt-1/answers')
    expect(patch.body).toMatchObject({
      expectedRevision: 4,
      currentQuestionId: 'q3',
      responses: [{ questionId: 'q3', kind: 'rating', rating: 5 }],
    })
    expect(result.revision).toBe(5)
  })

  it('创建尝试带幂等键（重试不会开出第二次测评）', async () => {
    responder = () => json(DETAIL, 201)

    await createAttempt({})

    const post = calls.find((call) => call.method === 'POST')!
    expect(post.url).toContain('/attempts')
    // 没显式传 key 时必须自己生成一个：否则一次网络重试会开出第二份测评
    expect(post.headers['Idempotency-Key']).toMatch(/[0-9a-f-]{20,}/)
  })

  it('显式传入的幂等键会被原样使用（重试同一次创建）', async () => {
    responder = () => json(DETAIL, 201)
    await createAttempt({ idempotencyKey: 'retry-fixed-key' })
    const post = calls.find((call) => call.method === 'POST')!
    expect(post.headers['Idempotency-Key']).toBe('retry-fixed-key')
  })

  it('409 被识别成"版本冲突"并读出服务端的最新 revision', async () => {
    responder = () =>
      json(
        {
          code: 'CONFLICT_REVISION',
          message: '另一台设备已经更新了这份草稿，请先读取最新版本再合并。',
          requestId: 'req-1',
          details: { currentRevision: 9 },
        },
        409,
      )

    const error = await patchAnswers('attempt-1', {
      expectedRevision: 4,
      responses: [],
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(V3ApiError)
    expect(isRevisionConflict(error)).toBe(true)
    expect(currentRevisionOf(error)).toBe(9)
  })
})

describe('响应形状校验', () => {
  it('attempt 详情：把后端的 `packageContent` 收成 `packageView`', async () => {
    responder = () => json(DETAIL)
    const detail = await fetchAttemptDetail('attempt-1')
    expect(detail.packageView?.packageId).toBe('typeme-jung48-zh-v1')
    // 服务端的大写 kind 在这一层被收成页面认识的小写
    expect(detail.answers).toEqual([{ questionId: 'q1', kind: 'rating', rating: 4 }])
    expect(detail.currentQuestionId).toBe('q3')
    expect(detail.clarificationDimensions).toEqual(['SN'])
    expect(detail.revision).toBe(4)
  })

  it('缺 revision 时抛错，而不是当 0 用（那会立刻写坏服务端状态）', async () => {
    const broken = { ...DETAIL } as Record<string, unknown>
    delete broken.revision
    responder = () => json(broken)
    await expect(fetchAttemptDetail('attempt-1')).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
    })
  })

  it('答案的 kind 是大写 `UNKNOWN` 也能认出来', async () => {
    responder = () =>
      json({
        ...DETAIL,
        answers: [{ questionId: 'q2', kind: 'UNKNOWN', rating: null }],
      })
    const detail = await fetchAttemptDetail('attempt-1')
    expect(detail.answers).toEqual([{ questionId: 'q2', kind: 'unknown', rating: null }])
  })

  it('报告列表缺 items 时抛错（不能显示成"你没有报告"）', async () => {
    responder = () => json({ page: 0, size: 50, total: 3 })
    await expect(fetchReports()).rejects.toMatchObject({ code: 'UNEXPECTED_RESPONSE' })
  })
})

describe('后端没给 insufficientDimensions 时由覆盖行推导', () => {
  it('coverageOk=false 的维度进 insufficientDimensions，并保留服务端名单', async () => {
    responder = () =>
      json(
        {
          reportId: null,
          attemptId: 'attempt-1',
          status: 'NEEDS_REVIEW',
          computedTypeCode: null,
          candidateCodes: [],
          coverageOk: false,
          coverage: [
            {
              dimension: 'EI',
              baseRatingCount: 12,
              baseUnknownCount: 0,
              baseUnprocessedCount: 0,
              needsClarification: false,
              coverageOk: true,
            },
            {
              dimension: 'SN',
              baseRatingCount: 3,
              baseUnknownCount: 0,
              baseUnprocessedCount: 9,
              needsClarification: true,
              coverageOk: false,
            },
          ],
        },
        200,
      )

    const result = await submitAttempt('attempt-1', { expectedRevision: 12 })
    expect(result.status).toBe('NEEDS_REVIEW')
    expect(result.insufficientDimensions).toEqual(['SN'])
    expect(result.reportId).toBeNull()
  })
})
