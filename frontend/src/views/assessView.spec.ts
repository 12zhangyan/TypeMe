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
  patch?: (callIndex: number) => { status: number; body: unknown }
  submit?: () => { status: number; body: unknown }
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
      return jsonResponse(result.body, result.status)
    }
    if (method === 'POST' && url.includes(`/attempts/${ATTEMPT_ID}/review`)) {
      return jsonResponse({
        status: 'BASE_IN_PROGRESS',
        needsReview: false,
        clarificationDimensions: [],
        coverage: [],
      })
    }
    if (method === 'POST' && url.includes(`/attempts/${ATTEMPT_ID}/submit`)) {
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
    expect(text).toContain('回到未答的题')
  })
})

describe('答题页：本地预览只是"粗略倾向"', () => {
  it('预览区明确写出它不是结论', async () => {
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
})
