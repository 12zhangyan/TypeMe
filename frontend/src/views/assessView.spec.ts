// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import AssessView from './AssessView.vue'
import { useAssessmentStore } from '@/stores/assessmentV3'

/**
 * 新答题页（`/assess/:attemptId`）的行为测试 —— 契约 `03-AI与前端契约-v1.md` §7.4。
 *
 * 这一组测试只钉**这一页最容易做错的四件事**（正因为它们都是"看起来也对"的错法）：
 *
 *   1. **选完答案不许自动跳题**：必须手动点「下一题」。自动前进在手机上会让人来不及改主意。
 *   2. **unknown 与未作答必须能区分**：前者是"已处理这一题"（写进服务端、不计分），
 *      后者是"还没处理"（会让覆盖检查失败、出不了报告）。把它们显示成同一句话，
 *      用户就会以为自己答完了。
 *   3. **409 必须走"重新拉取"路径**：绝不能拿新 revision 静默重发 —— 那等于把另一台
 *      设备的进度覆盖掉。这里断言"冲突之后再点一档，**没有**发出新的 PATCH"。
 *   4. **覆盖不足要说出"还差哪几维"**：只有"信息不足"四个字等于没说。
 */

interface QuestionSpec {
  id: string
  stage: 'base' | 'clarification'
  dimension: string
  order: number
}

const QUESTIONS: QuestionSpec[] = [
  { id: 'q1', stage: 'base', dimension: 'EI', order: 1 },
  { id: 'q2', stage: 'base', dimension: 'EI', order: 2 },
  { id: 'q3', stage: 'base', dimension: 'SN', order: 3 },
  { id: 'q4', stage: 'base', dimension: 'TF', order: 4 },
  { id: 'c1', stage: 'clarification', dimension: 'EI', order: 101 },
]

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
  questions: QUESTIONS.map((question) => ({
    id: question.id,
    stage: question.stage,
    dimension: question.dimension,
    scenario: `情境 ${question.id}`,
    textLeft: `左边 ${question.id}`,
    textRight: `右边 ${question.id}`,
    leftPole: 'I',
    rightPole: 'E',
    help: '这一题的短释义。',
    facet: 'facet',
    order: question.order,
    reviewStatus: 'reviewed',
  })),
  sha256: 'c'.repeat(64),
}

function attemptDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: ATTEMPT_ID,
    packageId: PACKAGE.packageId,
    status: 'BASE_IN_PROGRESS',
    revision: 7,
    currentQuestionId: null,
    clarificationDimensions: [],
    clarificationSkipped: false,
    startedAt: '2026-09-16T10:00:00Z',
    updatedAt: '2026-09-16T10:00:00Z',
    submittedAt: null,
    reportId: null,
    baseAttemptId: null,
    answers: [],
    coverage: [],
    packageContent: PACKAGE,
    ...overrides,
  }
}

const ATTEMPT_ID = 'attempt-1111'

interface Recorded {
  method: string
  url: string
  body: unknown
}

interface ServerOptions {
  detail?: () => Record<string, unknown>
  patch?: (callIndex: number) => { status: number; body: unknown; after?: Promise<void> }
  submit?: () => { status: number; body: unknown }
  /** 让交卷请求"掉在路上"（网络层失败，浏览器拿不到任何响应）。 */
  submitNetworkError?: boolean
  review?: () => { status: number; body: unknown }
}

let calls: Recorded[] = []
let patchCount = 0
let server: ServerOptions = {}

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
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    if (method === 'GET' && url.includes(`/attempts/${ATTEMPT_ID}`)) {
      return jsonResponse(server.detail ? server.detail() : attemptDetail())
    }
    if (method === 'PATCH' && url.includes(`/attempts/${ATTEMPT_ID}/answers`)) {
      patchCount += 1
      const result = server.patch
        ? server.patch(patchCount)
        : {
            status: 200,
            body: {
              revision: 7 + patchCount,
              status: 'BASE_IN_PROGRESS',
              clarificationDimensions: [],
            },
          }
      // `after` 让某个用例把请求"挂住"，用来观察在途期间的界面状态。
      if (result.after) await result.after
      return jsonResponse(result.body, result.status)
    }
    if (method === 'POST' && url.includes(`/attempts/${ATTEMPT_ID}/review`)) {
      return jsonResponse(
        server.review
          ? server.review().body
          : {
              status: 'BASE_IN_PROGRESS',
              needsReview: false,
              clarificationDimensions: [],
              coverage: [],
            },
      )
    }
    if (method === 'POST' && url.includes(`/attempts/${ATTEMPT_ID}/submit`)) {
      if (server.submitNetworkError) {
        // 请求确实发出去了、服务端也真的交卷成功了，但响应没能回来。
        // 浏览器能看到的只有这一层失败。
        throw new TypeError('Failed to fetch')
      }
      const result = server.submit
        ? server.submit()
        : {
            status: 201,
            body: {
              reportId: 'report-1',
              attemptId: ATTEMPT_ID,
              status: 'REFERENCE',
              computedTypeCode: 'ENFP',
              candidateCodes: [],
              coverage: [],
              coverageOk: true,
            },
          }
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
      { path: '/assess/:attemptId', name: 'assess-attempt', component: AssessView },
      { path: '/assess', name: 'assess', component: AssessView },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<p>报告</p>' } },
      { path: '/login', name: 'login', component: { template: '<p>登录</p>' } },
    ],
  })
}

async function mountAssess() {
  const router = makeRouter()
  await router.push(`/assess/${ATTEMPT_ID}`)
  await router.isReady()
  const wrapper = mount(AssessView, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

function patchCalls(): Recorded[] {
  return calls.filter((call) => call.method === 'PATCH')
}

/**
 * 让 `GET /attempts/{id}` 回指定状态码再挂载（默认替身只会回 200）。
 *
 * <p>会话失效走的是 `UNAUTHENTICATED` 这个码，而它只能由 401 触发，
 * 所以需要单独一条"详情请求失败"的替身。
 */
async function mountAssessWithStatus(status: number, code = 'UNAUTHENTICATED', message = '请先登录。') {
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && url.includes(`/attempts/${ATTEMPT_ID}`)) {
      return new Response(
        JSON.stringify({ code, message, requestId: 'req-x', details: {} }),
        { status, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    return jsonResponse({}, 200)
  }) as never)

  const router = makeRouter()
  await router.push(`/assess/${ATTEMPT_ID}`)
  await router.isReady()
  const wrapper = mount(AssessView, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  patchCount = 0
  server = {}
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('答题页：手动下一题', () => {
  it('选一档之后仍停在同一题（没有任何自动跳题）', async () => {
    const { wrapper } = await mountAssess()
    expect(wrapper.text()).toContain('情境 q1')

    const option = wrapper.findAll('[data-rating]').find((node) => node.attributes('data-rating') === '4')!
    await option.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('情境 q1')
    expect(wrapper.text()).not.toContain('情境 q2')
  })

  it('手动点「下一题」才前进，并记住当前位置', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[2].trigger('click')
    await flushPromises()
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('情境 q2')
    const positions = patchCalls().filter((call) => {
      const body = call.body as { currentQuestionId?: string } | undefined
      return body?.currentQuestionId === 'q1'
    })
    expect(positions.length).toBeGreaterThan(0)
  })

  it('未作答时点「下一题」给可见提示且不前进', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('这一题还没有作答')
    expect(wrapper.text()).toContain('情境 q1')
  })

  it('每一题都能看到键盘与五档说明，且五档文案与契约一致', async () => {
    const { wrapper } = await mountAssess()
    const captions = ['很像左边', '更像左边', '两边差不多', '更像右边', '很像右边']
    for (const caption of captions) {
      expect(wrapper.text(), `缺少档位文案「${caption}」`).toContain(caption)
    }
  })
})

describe('答题页：unknown 与「未作答」是两件事', () => {
  it('未作答时显示"还没有作答"', async () => {
    const { wrapper } = await mountAssess()
    const state = wrapper.find('[data-answer-state]').text()
    expect(state).toContain('还没有作答')
    // 未作答时不能出现"已作答"的确认措辞
    expect(state).toContain('两者都算处理过这一题')
    expect(state).not.toContain('已作答')
  })

  it('标「这题我说不好」之后显示已作答案，并且不会被当成未作答', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.find('[data-unknown]').trigger('click')
    await flushPromises()

    const state = wrapper.find('[data-answer-state]').text()
    expect(state).toContain('我说不好')
    expect(state).toContain('已作答')
    expect(state).not.toContain('还没有作答')

    // 发出去的是 kind=unknown（不是 rating=3，也不是什么都不发）
    const last = patchCalls().at(-1)!
    const body = last.body as { responses: { kind: string; rating?: number }[] }
    expect(body.responses[0].kind).toBe('unknown')
    expect(body.responses[0].rating).toBeUndefined()
  })

  it('标了 unknown 之后点「下一题」可以前进（unknown 算处理过）', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.find('[data-unknown]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('情境 q2')
  })

  it('unknownown 可以被数字答案替换', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.find('[data-unknown]').trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-rating]')[0].trigger('click')
    await flushPromises()

    const body = patchCalls().at(-1)!.body as { responses: { kind: string; rating?: number }[] }
    expect(body.responses[0].kind).toBe('rating')
    expect(body.responses[0].rating).toBe(1)
  })
})

describe('答题页：409 冲突走"重新拉取"，不静默覆盖', () => {
  it('409 之后显示冲突提示，并且**不再发出任何写入**', async () => {
    server.patch = () => ({
      status: 409,
      body: {
        code: 'CONFLICT_REVISION',
        message: '另一台设备已经更新了这份草稿，请先读取最新版本再合并。',
        requestId: 'req-1',
        details: { currentRevision: 9 },
      },
    })

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(true)
    expect(wrapper.text()).toContain('另一台设备改过这次的进度')
    expect(wrapper.text()).toContain('载入最新进度')

    const before = patchCalls().length
    // 冲突状态下再点一档：必须被拦住，而不是拿新 revision 重发
    await wrapper.findAll('[data-rating]')[1].trigger('click')
    await flushPromises()
    expect(patchCalls().length, '冲突未解决前不该再写').toBe(before)
  })

  it('点「载入最新进度」重新拉取，并以服务端 revision 继续', async () => {
    let revision = 7
    server.patch = () => ({
      status: 409,
      body: {
        code: 'CONFLICT_REVISION',
        message: '另一台设备已经更新了这份草稿。',
        requestId: 'req-2',
        details: { currentRevision: 9 },
      },
    })
    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()

    // 另一台设备把它改到了 revision 9，并且答了第一题
    revision = 9
    server.detail = () =>
      attemptDetail({
        revision,
        answers: [{ questionId: 'q1', kind: 'RATING', rating: 5 }],
      })
    server.patch = () => ({
      status: 200,
      body: { revision: revision + 1, status: 'BASE_IN_PROGRESS', clarificationDimensions: [] },
    })

    await wrapper.find('[data-reload-latest]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(false)
    const reloaded = calls.filter(
      (call) => call.method === 'GET' && call.url.includes(`/attempts/${ATTEMPT_ID}`),
    )
    expect(reloaded.length).toBeGreaterThanOrEqual(2)

    // 冲突解除后可以继续写，而且带的是刚读到的 revision
    await wrapper.findAll('[data-rating]')[2].trigger('click')
    await flushPromises()
    const body = patchCalls().at(-1)!.body as { expectedRevision: number }
    expect(body.expectedRevision).toBe(9)
  })

  it('冲突横幅要说清丢的是哪一题、自己选了什么（否则用户没法核对）', async () => {
    server.patch = () => ({
      status: 409,
      body: {
        code: 'CONFLICT_REVISION',
        message: '另一台设备已经更新了这份草稿。',
        requestId: 'req-3',
        details: { currentRevision: 12 },
      },
    })

    const { wrapper } = await mountAssess()
    // 第 2 题选第 5 档（"很像右边"），这一条会撞 409
    await wrapper.findAll('[data-rating]')[4].trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(true)
    const lost = wrapper.findAll('[data-lost-answer]')
    expect(lost.length, '必须逐条列出被丢弃的作答').toBe(1)
    // 只写"没写上去"是不够的：用户要知道是哪一题、自己选的是哪一档。
    expect(lost[0].text()).toContain('很像右边')
    expect(lost[0].text()).toMatch(/第 \d+ 题/)
    // 内部 id 不许出现在界面上
    expect(lost[0].text()).not.toContain('q2')
  })

  it('「这题我说不好」被丢弃时也如实列出，不显示成空白档位', async () => {
    server.patch = () => ({
      status: 409,
      body: {
        code: 'CONFLICT_REVISION',
        message: '另一台设备已经更新了这份草稿。',
        requestId: 'req-4',
        details: { currentRevision: 3 },
      },
    })

    const { wrapper } = await mountAssess()
    await wrapper.find('[data-unknown]').trigger('click')
    await flushPromises()

    const lost = wrapper.findAll('[data-lost-answer]')
    expect(lost.length).toBe(1)
    expect(lost[0].text()).toContain('这题我说不好')
  })
})

describe('答题页：覆盖不足时说明还差哪几维', () => {
  it('提交返回 NEEDS_REVIEW 时列出未达标的维度与人话原因', async () => {
    server.submit = () => ({
      status: 200,
      body: {
        reportId: null,
        attemptId: ATTEMPT_ID,
        status: 'NEEDS_REVIEW',
        computedTypeCode: null,
        candidateCodes: [],
        coverageOk: false,
        coverage: [
          { dimension: 'EI', baseRatingCount: 1, baseUnknownCount: 0, baseUnprocessedCount: 0, needsClarification: false, coverageOk: true },
          { dimension: 'SN', baseRatingCount: 0, baseUnknownCount: 0, baseUnprocessedCount: 1, needsClarification: false, coverageOk: false },
          { dimension: 'TF', baseRatingCount: 0, baseUnknownCount: 0, baseUnprocessedCount: 1, needsClarification: false, coverageOk: false },
          { dimension: 'JP', baseRatingCount: 0, baseUnknownCount: 1, baseUnprocessedCount: 0, needsClarification: false, coverageOk: true },
        ],
      },
    })

    const { wrapper } = await mountAssess()
    // 把主测四题都处理掉（数字或"说不好"都算处理），然后交卷
    await wrapper.findAll('[data-rating]')[2].trigger('click')
    await flushPromises()
    for (let index = 0; index < 3; index += 1) {
      await wrapper.find('[data-next]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-unknown]').trigger('click')
      await flushPromises()
    }
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-needs-review]').exists()).toBe(true)
    const text = wrapper.find('[data-needs-review]').text()
    expect(text).toContain('维度 SN')
    expect(text).toContain('维度 TF')
    expect(text).toContain('1 题没有作答')
    // 这里服务端说 SN/TF 各还有 1 题没作答，但本地这一轮**没有留下未答的主测题**
    // （q1 选了档，q2–q4 都标了「说不好」）。原先按钮无条件写「回到未答的题」，
    // 点下去却什么也不会发生 —— 那个文案本身就是个坑。
    expect(text).toContain('回到题目继续调整')
    expect(wrapper.find('[data-back-to-unanswered]').exists()).toBe(true)
  })

  it('点「回到题目继续调整」真的能回到题卡（不是一条死路）', async () => {
    server.submit = () => ({
      status: 200,
      body: {
        reportId: null,
        attemptId: ATTEMPT_ID,
        status: 'NEEDS_REVIEW',
        computedTypeCode: null,
        candidateCodes: [],
        coverageOk: false,
        coverage: [
          { dimension: 'EI', baseRatingCount: 1, baseUnknownCount: 0, baseUnprocessedCount: 0, needsClarification: false, coverageOk: true },
          { dimension: 'SN', baseRatingCount: 0, baseUnknownCount: 1, baseUnprocessedCount: 0, needsClarification: false, coverageOk: false },
          { dimension: 'TF', baseRatingCount: 1, baseUnknownCount: 0, baseUnprocessedCount: 0, needsClarification: false, coverageOk: true },
          { dimension: 'JP', baseRatingCount: 1, baseUnknownCount: 0, baseUnprocessedCount: 0, needsClarification: false, coverageOk: true },
        ],
      },
    })

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[2].trigger('click')
    await flushPromises()
    for (let index = 0; index < 3; index += 1) {
      await wrapper.find('[data-next]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-unknown]').trigger('click')
      await flushPromises()
    }
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-needs-review]').exists()).toBe(true)

    await wrapper.find('[data-back-to-unanswered]').trigger('click')
    await flushPromises()

    // 关键：必须回到题卡。原先 unansweredBaseIds 为空时这里静默返回，
    // 页面仍停在 needs-review，用户只能刷新才出得来。
    expect(wrapper.find('[data-needs-review]').exists()).toBe(false)
    expect(wrapper.find('[data-question-card]').exists()).toBe(true)
    // 覆盖不足的是 SN 维（本地未答的是别的情况），落点应是那一维的题
    expect(wrapper.find('[data-question-card]').text()).toContain('情境 q3')
  })
})

describe('答题页：补充题阶段必须留有出口', () => {
  /** 主测四题全处理掉，并让 review 安排一道 EI 补充题，然后进入补充阶段。 */
  async function enterClarification() {
    const { wrapper } = await mountAssess()
    server.review = () => ({
      status: 200,
      body: {
        status: 'CLARIFICATION_IN_PROGRESS',
        needsReview: false,
        clarificationDimensions: ['EI'],
        coverage: [],
        insufficientDimensions: [],
      },
    })
    for (let index = 0; index < 4; index += 1) {
      await wrapper.findAll('[data-rating]')[2].trigger('click')
      await flushPromises()
      if (index < 3) {
        await wrapper.find('[data-next]').trigger('click')
        await flushPromises()
      }
    }
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    await flushPromises()
    return wrapper
  }

  it('点了「开始补充题」之后，仍能回到主测改答', async () => {
    const wrapper = await enterClarification()
    expect(wrapper.find('[data-clarify-offer]').exists()).toBe(true)

    await wrapper.find('[data-start-clarification]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-question-card]').text()).toContain('情境 c1')

    // 契约把「跳过补充题」写成用户可以选的动作，进入补充阶段后也必须留出口；
    // 原先这一步没有任何回主测或跳过的入口，只能把补充题答完。
    expect(wrapper.find('[data-back-to-base]').exists()).toBe(true)
    await wrapper.find('[data-back-to-base]').trigger('click')
    await flushPromises()

    const card = wrapper.find('[data-question-card]')
    expect(card.exists()).toBe(true)
    // 回到主测第一题（base 阶段），而不是停在补充题
    expect(card.text()).toContain('情境 q1')
    expect(card.text()).not.toContain('情境 c1')
  })

  it('补充阶段也能跳过并直接交卷', async () => {
    const wrapper = await enterClarification()
    await wrapper.find('[data-start-clarification]').trigger('click')
    await flushPromises()

    await wrapper.find('[data-skip-clarification-in-progress]').trigger('click')
    await flushPromises()

    // 跳过就等于交卷：应该发出 submit，而不是继续要求答补充题
    expect(calls.some((call) => call.method === 'POST' && call.url.includes('/submit'))).toBe(true)
  })
})

describe('答题页：会话在作答过程中失效', () => {
  it('载入时 401：给出「去登录」而不是一个必然失败的「重试」', async () => {
    server.detail = () => ({
      code: 'UNAUTHENTICATED',
      message: '请先登录。',
      requestId: 'req-x',
      details: {},
    })
    // 让详情接口真的回 401（installFetch 默认给 200，这里用 patch 之外的方式更直接）
    const { wrapper } = await mountAssessWithStatus(401)

    const text = wrapper.text()
    expect(text).toContain('登录状态已经失效')
    // 关键：必须有去登录的入口。答题页在 App.vue 里隐藏了常规导航，
    // 只给「重试」等于把用户卡在这一页。
    expect(wrapper.find('[data-assess-login-link]').exists()).toBe(true)
    expect(text).not.toContain('重试')
  })

  /**
   * 会话失效也可能发生在**保存**的时候（不是载入）。那时给「重试保存」同样是死路：
   * 在那个状态下重试必然再失败一次，用户会一直点一个永远不会成功的按钮。
   */
  it('保存时 401：给的是「登录后接着答」，而不是「重试保存」', async () => {
    server.patch = () => ({
      status: 401,
      body: { code: 'UNAUTHENTICATED', message: '请先登录。', requestId: 'req-s', details: {} },
    })

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-save-failed]').exists()).toBe(true)
    expect(wrapper.find('[data-save-login-link]').exists()).toBe(true)
    expect(wrapper.find('[data-retry-save]').exists(), '会话已失效时重试必然再失败').toBe(false)
    // 登录后要回到这一页继续答，所以必须带上 redirect
    expect(wrapper.find('[data-save-login-link]').attributes('href')).toContain('redirect')
  })

  /**
   * 404 / 409 PACKAGE_UNAVAILABLE / 403 这类失败**重试一万次也不会变**。
   * 以前它们与"网络抖了一下"共用同一个「重试」，用户只能对着一个必然失败的按钮点。
   */
  it('测评在服务端已不存在（404）：给「重新开始一次」而不是只有一个重试', async () => {
    const { wrapper } = await mountAssessWithStatus(404, 'NOT_FOUND', '没找到这个测评。')

    expect(wrapper.find('[data-assess-restart]').exists()).toBe(true)
    expect(wrapper.text()).toContain('重新开始一次测评')
    expect(wrapper.text()).toContain('已经不存在了')
  })

  it('测评已下线（409 PACKAGE_UNAVAILABLE）：如实说明原因，并给出重新开始的路', async () => {
    const { wrapper } = await mountAssessWithStatus(409, 'PACKAGE_UNAVAILABLE', '这份内容包已经不能用了。')

    expect(wrapper.find('[data-assess-restart]').exists()).toBe(true)
    expect(wrapper.text()).toContain('这次测评已经下线')
    expect(wrapper.text()).not.toContain('内容包')
  })
})

describe('答题页：保存失败不能被下一次成功掩盖', () => {
  /**
   * 关键场景：答 Q1 时保存失败（网络问题），继续答 Q2 时保存成功。
   *
   * <p>原先 `flush()` 每次只发当前这一条，且成功时**无条件**把 `saveState` 置回
   * `'saved'` —— 于是 Q1 在服务端从未存在，界面却写着「已保存」，刷新后 Q1 回到未作答。
   * 这是"未保存不得显示成已保存"最直接的违反。
   */
  it('第一条保存失败后再答一条：不许中途显示「已保存」，恢复时要把它补发上去', async () => {
    // 前两次都失败：第一次是 Q1 的作答，第二次是点「下一题」时的位置写入。
    // 这样 Q1 一直处于"没写上去"的状态，直到第三次（Q2 作答）才被一并补发。
    let attempt = 0
    server.patch = () => {
      attempt += 1
      if (attempt <= 2) {
        return { status: 503, body: { code: 'INTERNAL', message: '服务暂时不可用。', requestId: 'req-1' } }
      }
      return {
        status: 200,
        body: { revision: 7 + attempt, status: 'BASE_IN_PROGRESS', clarificationDimensions: [] },
      }
    }

    const { wrapper } = await mountAssess()
    // Q1 选第 4 档 —— 这一条会失败
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-save-state]').text()).toContain('未同步')
    expect(wrapper.find('[data-save-failed]').exists()).toBe(true)

    // 点「下一题」：这一次的位置写入也会失败，Q1 仍未写上去
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-save-failed]').exists()).toBe(true)
    expect(wrapper.find('[data-save-state]').text()).not.toBe('已保存')

    // 到 Q2 作答 —— 这一次会成功，并把 Q1 一起补发上去
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()

    // 断言一：这一次成功的请求**必须把 Q1 一起带上**。
    // 否则 Q1 会永远留在本地，而界面（在修复前）已经显示「已保存」。
    const lastBody = patchCalls().at(-1)!.body as {
      responses: { questionId: string; rating: number | null }[]
    }
    const ids = lastBody.responses.map((item) => item.questionId)
    expect(ids, '成功的这次保存要把之前失败的那条一起重发').toContain('q1')
    expect(ids).toContain('q2')

    // 断言二：补发成功之后才允许说「已保存」，并且不再显示未同步提示
    expect(wrapper.find('[data-save-state]').text()).toContain('已保存')
    expect(wrapper.find('[data-save-failed]').exists()).toBe(false)
  })

  it('「重试保存」能把未写上去的作答补上，补上之后状态回到「已保存」', async () => {
    let attempt = 0
    server.patch = () => {
      attempt += 1
      if (attempt === 1) {
        return { status: 503, body: { code: 'INTERNAL', message: '服务暂时不可用。', requestId: 'req-2' } }
      }
      return {
        status: 200,
        body: { revision: 7 + attempt, status: 'BASE_IN_PROGRESS', clarificationDimensions: [] },
      }
    }

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-save-failed]').exists()).toBe(true)

    // 页面要给出重试入口 —— 原先这里只有一个死掉的文案，没有任何可操作项。
    await wrapper.find('[data-retry-save]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-save-state]').text()).toContain('已保存')
    expect(wrapper.find('[data-save-failed]').exists()).toBe(false)
    // 重试必须真的发出请求（否则只是把文案改好看了）
    expect(patchCalls().length).toBeGreaterThanOrEqual(2)
  })

  it('保存失败提示里说清有几题没写上去', async () => {
    server.patch = () => ({
      status: 503,
      body: { code: 'INTERNAL', message: '服务暂时不可用。', requestId: 'req-3' },
    })

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-save-state]').text()).toContain('1 题')
    expect(wrapper.find('[data-save-failed]').text()).toContain('1 题')
  })
})

describe('答题页：本地预览只是"粗略倾向"', () => {  it('预览区明确写出它不是结论', async () => {
    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[4].trigger('click')
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('目前的粗略倾向')
    expect(text).toContain('不是结论')
    expect(text).toContain('以服务端生成的报告为准')
  })

  it('保存状态有三态文案，初始是"还没有需要保存的内容"', async () => {
    const { wrapper } = await mountAssess()
    expect(wrapper.find('[data-save-state]').text()).toContain('还没有需要保存的内容')
  })
})

describe('答题页：键盘', () => {
  it('数字键 1–5 直接作答，且同样不自动跳题', async () => {
    const { wrapper } = await mountAssess()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }))
    await flushPromises()

    expect(wrapper.find('[data-answer-state]').text()).toContain('更像右边')
    expect(wrapper.text()).toContain('情境 q1')
  })

  it('方向键切换题目', async () => {
    const { wrapper } = await mountAssess()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }))
    await flushPromises()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('情境 q2')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await flushPromises()
    expect(wrapper.text()).toContain('情境 q1')
  })
})

describe('答题页：断点续答', () => {
  it('进入时恢复服务端记下的位置与已答', async () => {
    server.detail = () =>
      attemptDetail({
        currentQuestionId: 'q3',
        answers: [
          { questionId: 'q1', kind: 'RATING', rating: 2 },
          { questionId: 'q2', kind: 'UNKNOWN', rating: null },
        ],
      })

    const { wrapper } = await mountAssess()
    expect(wrapper.text()).toContain('情境 q3')
    expect(wrapper.find('[data-save-state]').text()).toContain('已保存')
    const store = useAssessmentStore()
    expect(store.answeredCount).toBe(2)
  })

  it('服务端的指针停在已答过的题上时，刷新落到第一道未作答，而不是回退到那道题', async () => {
    // 2026-09-17 真实浏览器抓到的缺陷：答题页 next() 写进服务端的 currentQuestionId
    // 是**刚答完的那一题**（安全值）。如果恢复时把它当权威，答到第 47 题刷新就会
    // 回到第 47 题——实测在 48 题的包上表现为"回到第 1 题"（q1 未答时更早）。
    // 这里用 3 题的最小样例把同一条规则钉死：q1 已答、指针停在 q1、q2 未答 → 应落在 q2。
    server.detail = () =>
      attemptDetail({
        currentQuestionId: 'q1',
        answers: [{ questionId: 'q1', kind: 'RATING', rating: 2 }],
      })

    const { wrapper } = await mountAssess()
    expect(wrapper.text()).toContain('情境 q2')
    expect(wrapper.text()).not.toContain('情境 q3')
  })

  it('主测全部答完时，才回到服务端记下的那一题（用于回看）', async () => {
    server.detail = () =>
      attemptDetail({
        currentQuestionId: 'q2',
        answers: [
          { questionId: 'q1', kind: 'RATING', rating: 2 },
          { questionId: 'q2', kind: 'RATING', rating: 4 },
          { questionId: 'q3', kind: 'RATING', rating: 3 },
          { questionId: 'q4', kind: 'UNKNOWN', rating: null },
        ],
      })

    const { wrapper } = await mountAssess()
    expect(wrapper.text()).toContain('情境 q2')
  })
})

/** 答完四道主测题（每答一题点一次「下一题」），回到最后一题的操作区。 */
async function answerAllBase(wrapper: Awaited<ReturnType<typeof mountAssess>>['wrapper']) {
  for (let index = 0; index < QUESTIONS.filter((item) => item.stage === 'base').length; index += 1) {
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()
    if (index < 3) {
      await wrapper.find('[data-next]').trigger('click')
      await flushPromises()
    }
  }
}

describe('答题页：快速操作不会制造假冲突', () => {
  /**
   * 这一组钉的是 2026-09-18 第 17 轮修掉的假冲突：`flush()` 之间没有串行化，
   * 网络稍慢时连点两档就会发出两个带**同一个** `expectedRevision` 的 PATCH，
   * 第二个必然撞服务端的严格 CAS → 屏幕上弹出「另一台设备改过这次的进度」，
   * 并把用户自己刚点的那一题列进「本机改动没有写上去」，逼他重新载入重答一遍。
   * 根本没有第二台设备。
   */
  it('在途期间的第二次点击不会另发一个 PATCH，也不会被说成"另一台设备改过"', async () => {
    let release: (() => void) | null = null
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.patch = () => ({
      status: 200,
      body: { revision: 8, status: 'BASE_IN_PROGRESS', clarificationDimensions: [] },
      after: gate,
    })

    const { wrapper } = await mountAssess()
    const buttons = wrapper.findAll('[data-rating]')
    // 两次点击之间不等待：模拟"手快连点两档"
    const first = buttons[3].trigger('click')
    const second = buttons[4].trigger('click')
    await first
    await second
    await flushPromises()

    expect(patchCalls(), '在途期间不许并发发出第二个 PATCH').toHaveLength(1)
    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(false)

    // 放开这一轮：第二档必须被自动带上（点得快 ≠ 丢掉答案）
    release!()
    await flushPromises()
    await flushPromises()

    const bodies = patchCalls().map(
      (call) => call.body as { responses: { questionId: string; rating: number | null }[] },
    )
    expect(bodies).toHaveLength(2)
    expect(bodies[0].responses.map((item) => item.rating)).toEqual([4])
    expect(bodies[1].responses.map((item) => item.rating), '第二档要补写上去').toEqual([5])
    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(false)
    expect(wrapper.find('[data-save-state]').text()).toContain('已保存')
  })

  /**
   * 另一种假冲突：请求**其实写成功了**，但响应丢在路上（超时/断网），用户点「重试保存」
   * 就会带着落后的 revision 再发一次，撞上服务端严格 CAS 得到 409 —— 而这条 409 的含义是
   * "你自己那次已经写进去了"，不是"另一台设备改过"。
   * 判据必须是服务端的**实际内容**，不是猜：重读一次详情，逐条比对。
   */
  it('自己的写入已落地却回了 409：按"已保存"收敛，不弹「另一台设备」横幅', async () => {
    // 第一次 GET：服务端还没有这一条（页面因此停在第 1 题）
    // 之后的 GET：服务端已经有了我们刚写的值（说明那一次写入其实落地了）
    let landed = false
    server.detail = () =>
      landed
        ? attemptDetail({ revision: 8, answers: [{ questionId: 'q1', kind: 'RATING', rating: 4 }] })
        : attemptDetail()
    server.patch = () => {
      landed = true
      return {
        status: 409,
        body: {
          code: 'CONFLICT_REVISION',
          message: '另一台设备已经更新了这份草稿。',
          requestId: 'req-own',
          details: { currentRevision: 8 },
        },
      }
    }

    const { wrapper } = await mountAssess()
    // 第 4 档（rating 4）—— 正是服务端"已经收到"的那个值
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-conflict-banner]').exists(), '这不是冲突，不该弹横幅').toBe(false)
    expect(wrapper.text()).not.toContain('另一台设备改过这次的进度')
    expect(wrapper.find('[data-save-state]').text()).toContain('已保存')
  })

  it('服务端存的东西与本机不一致时，仍然按真冲突处理（不能把真冲突说成已保存）', async () => {
    // 另一台设备把第 1 题改成了第 2 档：这不是"自己那次落地了"，必须按冲突处理。
    let landed = false
    server.detail = () =>
      landed
        ? attemptDetail({ revision: 8, answers: [{ questionId: 'q1', kind: 'RATING', rating: 2 }] })
        : attemptDetail()
    server.patch = () => {
      landed = true
      return {
        status: 409,
        body: {
          code: 'CONFLICT_REVISION',
          message: '另一台设备已经更新了这份草稿。',
          requestId: 'req-real',
          details: { currentRevision: 8 },
        },
      }
    }

    const { wrapper } = await mountAssess()
    await wrapper.findAll('[data-rating]')[3].trigger('click')
    await flushPromises()
    await flushPromises()

    expect(wrapper.find('[data-conflict-banner]').exists()).toBe(true)
    expect(wrapper.text()).toContain('另一台设备改过这次的进度')
  })
})

describe('答题页：交卷响应丢失也要能到报告', () => {
  /**
   * 交卷成功但响应没回来时，用户重试只会得到一句「这份测评已经提交」。
   * 契约里 `attempt.reportId` 就是为这条路准备的，前端以前从来不读它 ——
   * 于是刷新页面也回不到那份**已经生成**的报告，用户唯一能做的只有"再测一次"。
   */
  it('交卷响应丢失后发现其实已提交：直接带到那份报告', async () => {
    server.submitNetworkError = true
    let submitted = false
    server.detail = () =>
      submitted
        ? attemptDetail({
            status: 'SUBMITTED',
            revision: 9,
            reportId: 'report-7',
            submittedAt: '2026-09-18T10:00:00Z',
            answers: [
              { questionId: 'q1', kind: 'RATING', rating: 4 },
              { questionId: 'q2', kind: 'RATING', rating: 4 },
              { questionId: 'q3', kind: 'RATING', rating: 4 },
              { questionId: 'q4', kind: 'RATING', rating: 4 },
            ],
          })
        : attemptDetail()

    const { wrapper, router } = await mountAssess()
    await answerAllBase(wrapper)
    // 交卷请求发出去了（服务端因此真的交卷成功），但浏览器看到的是网络失败
    submitted = true
    await wrapper.find('[data-next]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('report-detail')
    expect(router.currentRoute.value.params.reportId).toBe('report-7')
  })

  it('带着一份已交卷的测评刷新答题页：自动打开那份报告，而不是停在一堆答完的题上', async () => {
    server.detail = () =>
      attemptDetail({
        status: 'SUBMITTED',
        revision: 9,
        reportId: 'report-9',
        submittedAt: '2026-09-18T10:00:00Z',
      })

    const { router } = await mountAssess()
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('report-detail')
    expect(router.currentRoute.value.params.reportId).toBe('report-9')
  })
})
