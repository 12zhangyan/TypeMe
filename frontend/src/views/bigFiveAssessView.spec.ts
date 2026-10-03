// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import BigFiveAssessView from './BigFiveAssessView.vue'
import { useBigFiveStore } from '@/stores/bigFiveV3'

/**
 * 大五答题页的行为测试。
 *
 * 这一组只钉**多量表改造里最容易做错的四件事**（都是"看起来也对"的错法）：
 *
 *   1. **"未保存"不能显示成"已保存"**：用户把答案当已存下来之后关掉页面，
 *      丢的是他真实的选择。判据必须是"这一条有没有进服务端"，不是"服务端 revision 变了没有"。
 *   2. **409 之后不许再发请求**：拿旧 revision 重试只会一直 409；而"重试到成功"
 *      等于绕过乐观锁覆盖另一台设备的答案。
 *   3. **「说不好」不是第 6 档、也不是中立**：它以 `kind=UNKNOWN` 提交，
 *      再点一次可以撤销（否则误点就是不可逆的）。
 *   4. **本地答完 ≠ 可以提交**：提交接口返回"还缺哪些题"时，页面必须回到那一题，
 *      而不是只显示一句"还差 N 题"。
 */

const ATTEMPT_ID = 'attempt-bigfive-1'

function item(index: number): Record<string, unknown> {
  const dimension = ['E', 'A', 'C', 'ES', 'O'][Math.floor((index - 1) / 10)] ?? 'O'
  return {
    id: `Q${String(index).padStart(2, '0')}`,
    kind: 'agreement_statement',
    stage: 'base',
    dimension,
    order: index,
    scenario: null,
    left: null,
    right: null,
    statement: `陈述句 ${index}`,
    leftPole: null,
    rightPole: null,
    direction: 1,
    help: `第 ${index} 题的短释义。`,
  }
}

const ITEMS = Array.from({ length: 50 }, (_, index) => item(index + 1))

function attemptView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: ATTEMPT_ID,
    instrumentSlug: 'bigfive50',
    instrumentKind: 'big_five',
    instrumentTitle: '大五人格倾向测评',
    packageId: 'typeme-bigfive50-zh-v1',
    reportKind: 'big_five_profile',
    status: 'DRAFT',
    revision: 3,
    currentQuestionId: null,
    clarificationDimensions: [],
    clarificationSkipped: false,
    startedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    submittedAt: null,
    baseAttemptId: null,
    reportId: null,
    answers: [],
    items: ITEMS,
    answeredCount: 0,
    requiredCount: 50,
    answerComplete: false,
    ...overrides,
  }
}

interface Recorded {
  method: string
  url: string
  body: Record<string, unknown> | undefined
}

let calls: Recorded[] = []
let patchCount = 0
let server: {
  detail?: () => Record<string, unknown>
  patch?: (index: number) => { status: number; body: unknown }
  submit?: () => { status: number; body: unknown }
} = {}

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
    if (method === 'GET' && url.includes(`/platform/attempts/${ATTEMPT_ID}`)) {
      return jsonResponse(server.detail ? server.detail() : attemptView())
    }
    if (method === 'PATCH' && url.includes(`/platform/attempts/${ATTEMPT_ID}/answers`)) {
      patchCount += 1
      const result = server.patch
        ? server.patch(patchCount)
        : {
            status: 200,
            body: {
              revision: 3 + patchCount,
              status: 'DRAFT',
              answeredCount: 1,
              requiredCount: 50,
              answerComplete: false,
              currentQuestionId: null,
            },
          }
      return jsonResponse(result.body, result.status)
    }
    if (method === 'POST' && url.includes(`/platform/attempts/${ATTEMPT_ID}/submit`)) {
      const result = server.submit
        ? server.submit()
        : {
            status: 200,
            body: {
              reportId: 'report-bigfive-1',
              attemptId: ATTEMPT_ID,
              status: 'PROFILE',
              reportKind: 'big_five_profile',
              incompleteQuestionIds: [],
              unknownCount: 0,
              unprocessedCount: 0,
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
      {
        path: '/assess/:attemptId',
        name: 'assess-attempt',
        // 和生产相同：答题页是路由组件的普通子组件，不是路由记录。
        component: { components: { BigFiveAssessView }, template: '<BigFiveAssessView />' },
      },
      { path: '/instruments', name: 'instruments', component: { template: '<p>列表</p>' } },
      {
        path: '/reports/big-five/:reportId',
        name: 'big-five-report',
        component: { template: '<p>报告</p>' },
      },
      { path: '/login', name: 'login', component: { template: '<p>登录</p>' } },
    ],
  })
}

async function mountAssess() {
  const router = makeRouter()
  await router.push(`/assess/${ATTEMPT_ID}`)
  await router.isReady()
  // 由路由组件渲染普通子组件，避免测试替生产代码制造不存在的组件守卫。
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper, router }
}

function patchCalls(): Recorded[] {
  return calls.filter((call) => call.method === 'PATCH')
}

/** 点第 N 档（1 基）。 */
async function choose(wrapper: Awaited<ReturnType<typeof mountAssess>>['wrapper'], value: number) {
  const radios = wrapper.findAll('[role="radio"]')
  await radios[value - 1]!.trigger('click')
  await flushPromises()
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

describe('大五答题页', () => {
  it('会话失效后能走登录入口，未同步答案不被普通离页弹窗阻断', async () => {
    server.patch = () => ({
      status: 401,
      body: { code: 'UNAUTHENTICATED', message: '登录状态已过期。', requestId: null, details: {} },
    })
    const { wrapper, router } = await mountAssess()
    await choose(wrapper, 5)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-bigfive-session-expired]').exists()).toBe(true)
    expect(useBigFiveStore().unsavedCount).toBe(1)

    await wrapper.find('[data-bigfive-session-expired] a').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/login')
    expect(useBigFiveStore().unsavedCount).toBe(1)
    expect(wrapper.find('[role="alertdialog"]').exists()).toBe(false)
  })

  it('载入后显示量表名、五档选项与「说不好」，且一开始没有未保存项', async () => {
    const { wrapper } = await mountAssess()

    expect(wrapper.text()).toContain('大五人格倾向测评')
    expect(wrapper.text()).toContain('第 1 / 50 题')
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(5)
    expect(wrapper.find('[data-bigfive-unknown]').exists()).toBe(true)
    // 没有任何改动时不应说"有 N 题还没保存"
    expect(wrapper.find('[data-bigfive-save-state]').text()).toContain('改动会自动保存')
  })

  it('选了一档之后立刻显示「有 1 题还没保存」，保存成功后才变「已保存」', async () => {
    const { wrapper } = await mountAssess()

    await choose(wrapper, 4)

    // 关键断言：这一次改动**还没有**进服务端，界面必须如实说未保存。
    // 如果实现用服务端 revision 判断"已保存"，这里就会显示"已保存" —— 那正是要拦的错。
    expect(wrapper.find('[data-bigfive-save-state]').text()).toContain('有 1 题还没保存')
    expect(patchCalls()).toHaveLength(0)

    // 换到下一题会顺带保存（自动保存的唯一时机）
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()

    expect(patchCalls()).toHaveLength(1)
    expect(wrapper.find('[data-bigfive-save-state]').text()).toContain('已保存')
    // 提交的是"这一题 + 当前题号"，不是整份答卷
    expect(patchCalls()[0]!.body?.['responses']).toEqual([
      { questionId: 'Q01', kind: 'RATING', rating: 4 },
    ])
  })

  it('保存只带上还没保存的那几题（已保存的不会重复发）', async () => {
    const { wrapper } = await mountAssess()

    await choose(wrapper, 2)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()
    await choose(wrapper, 5)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()

    expect(patchCalls()).toHaveLength(2)
    expect(patchCalls()[0]!.body?.['responses']).toHaveLength(1)
    expect(patchCalls()[1]!.body?.['responses']).toEqual([
      { questionId: 'Q02', kind: 'RATING', rating: 5 },
    ])
  })

  it('409 修订冲突之后停止自动保存，并提示核对服务端进度', async () => {
    server.patch = () => ({
      status: 409,
      body: { code: 'CONFLICT_REVISION', message: '另一台设备改过这份草稿。' },
    })
    const { wrapper } = await mountAssess()

    await choose(wrapper, 3)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()

    expect(patchCalls()).toHaveLength(1)
    expect(wrapper.find('[data-bigfive-conflict]').exists()).toBe(true)
    expect(wrapper.find('[data-bigfive-save-state]').text()).toContain('服务端进度已变化')
    expect(wrapper.find('[data-bigfive-conflict]').text()).toContain('读取服务端进度并核对')

    // 冲突未解决时再选一档 + 换题：**不允许**再发 PATCH。
    // 拿旧 revision 重试只会一直 409；"重试到成功"等于覆盖另一台设备的答案。
    await choose(wrapper, 5)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()
    expect(patchCalls()).toHaveLength(1)
  })

  it('「说不好」以 UNKNOWN 提交，再点一次撤销回未作答', async () => {
    const { wrapper } = await mountAssess()

    await wrapper.find('[data-bigfive-unknown]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-bigfive-unknown]').attributes('aria-pressed')).toBe('true')

    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()
    expect(patchCalls()[0]!.body?.['responses']).toEqual([
      { questionId: 'Q01', kind: 'UNKNOWN', rating: null },
    ])

    // 回到第 1 题再点一次「说不好」→ 撤销
    await wrapper.find('[data-bigfive-prev]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-bigfive-unknown]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-bigfive-unknown]').attributes('aria-pressed')).toBe('false')
  })

  it('还有题没处理时提交按钮禁用，且给出「回到第一道没答的」入口', async () => {
    const { wrapper } = await mountAssess()

    expect(wrapper.find('[data-bigfive-submit]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-bigfive-first-missing]').exists()).toBe(true)
    const text = wrapper.find('[data-bigfive-submit]').element.closest('section')!.textContent ?? ''
    expect(text).toContain('还有 50 题没处理过')
  })

  it('服务端说还缺题时回到那一题，而不是只显示"还差 N 题"', async () => {
    // 本地 50 题都处理过（构造一份满答的草稿），但服务端不认其中一题 ——
    // 这对应"另一台设备删掉了这一题的作答"这类真实情况。
    const answers = ITEMS.map((each, index) => ({
      questionId: each['id'] as string,
      kind: 'RATING',
      rating: (index % 5) + 1,
    }))
    server.detail = () => attemptView({ answers, answeredCount: 50, answerComplete: true })
    server.submit = () => ({
      status: 200,
      body: {
        reportId: null,
        attemptId: ATTEMPT_ID,
        status: 'INCOMPLETE',
        reportKind: 'big_five_profile',
        incompleteQuestionIds: ['Q07'],
        unknownCount: 0,
        unprocessedCount: 1,
      },
    })
    const { wrapper } = await mountAssess()

    expect(wrapper.find('[data-bigfive-submit]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-bigfive-submit]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-bigfive-submit-error]').text()).toContain('还有 1 题')
    // 页面上当前题必须是服务端说缺的那一题
    expect(wrapper.find('[data-bigfive-item]').attributes('data-bigfive-item')).toBe('Q07')
    expect(wrapper.text()).toContain('服务端还缺这一题')
  })

  it('提交成功跳到该报告的详情页', async () => {
    const answers = ITEMS.map((each, index) => ({
      questionId: each['id'] as string,
      kind: 'RATING',
      rating: (index % 5) + 1,
    }))
    server.detail = () => attemptView({ answers, answeredCount: 50, answerComplete: true })
    const { wrapper, router } = await mountAssess()

    await wrapper.find('[data-bigfive-submit]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('big-five-report')
    expect(router.currentRoute.value.params.reportId).toBe('report-bigfive-1')
  })

  it('冲突先对照服务端与本机，默认不覆盖；勾选后才发送选中的题', async () => {
    let revision = 3
    let serverRating: number | null = null
    server.detail = () => attemptView({ revision, answers: serverRating === null ? [] : [
      { questionId: 'Q01', kind: 'RATING', rating: serverRating },
    ] })
    server.patch = (index) => index === 1
      ? { status: 409, body: { code: 'CONFLICT_REVISION', message: '进度冲突' } }
      : { status: 200, body: { revision: ++revision, status: 'DRAFT', answeredCount: 1,
        requiredCount: 50, answerComplete: false, currentQuestionId: null } }
    const { wrapper } = await mountAssess()
    // 首次读取后另一台设备改变这一题。
    revision = 8
    serverRating = 3
    await choose(wrapper, 5)
    await wrapper.find('[data-bigfive-next]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-bigfive-reload]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-bigfive-conflict-choices]').text()).toContain('服务端：')
    expect(wrapper.find('[data-bigfive-conflict-choices]').text()).toContain('本机：')
    expect(patchCalls()).toHaveLength(1)
    await wrapper.find('[data-bigfive-conflict-choices] input[type="checkbox"]').setValue(true)
    await wrapper.find('[data-bigfive-apply-conflict]').trigger('click')
    await flushPromises()
    expect(patchCalls()).toHaveLength(2)
    expect(patchCalls()[1]!.body?.['expectedRevision']).toBe(8)
    expect(patchCalls()[1]!.body?.['responses']).toEqual([
      { questionId: 'Q01', kind: 'RATING', rating: 5 },
    ])
  })

  it('嵌套答题页切换草稿时保存失败需明确确认，取消后保留作答', async () => {
    server.patch = () => ({ status: 503, body: { code: 'UNAVAILABLE', message: '暂时无法保存' } })
    const { wrapper, router } = await mountAssess()
    await choose(wrapper, 4)

    const navigation = router.push(`/assess/${ATTEMPT_ID}-other`)
    await flushPromises()
    expect(patchCalls()).toHaveLength(1)
    expect(wrapper.find('[data-bigfive-leave-stay]').exists()).toBe(true)
    expect(wrapper.text()).toContain('会丢掉这 1 题的改动')
    await wrapper.find('[data-bigfive-leave-stay]').trigger('click')
    await navigation
    expect(router.currentRoute.value.params.attemptId).toBe(ATTEMPT_ID)
    expect(wrapper.find('[data-bigfive-save-state]').text()).toContain('有 1 题还没保存')

    const leave = router.push('/instruments')
    await flushPromises()
    await wrapper.find('[data-bigfive-leave-anyway]').trigger('click')
    await leave
    expect(router.currentRoute.value.name).toBe('instruments')
  })
})
