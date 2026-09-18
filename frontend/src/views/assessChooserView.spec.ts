// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import AssessChooserView from './AssessChooserView.vue'

/**
 * `/assess` 选择页的行为测试。
 *
 * 这一页在多量表改造里承担两个新职责，两条都属于"看起来也对"的错法：
 *
 *   1. **从量表页带 `?instrument=<slug>` 过来时不能再要求点一次**，但自动开始
 *      必须等"目录"和"草稿列表"都落定 —— 早一步动手就会走成未知 slug，或者
 *      在还没读到已有草稿时又建一份新的。
 *   2. **已经有没答完的草稿时，卡片上的按钮必须继续那一份**，不是建新草稿。
 *      建新的不会报错、界面也正常，但用户在旧草稿上答过的题会留在那里，
 *      "我上次答到哪了"因此有两个答案。
 */

const CATALOG = {
  items: [
    {
      slug: 'jung48',
      kind: 'jung',
      title: '十六型人格参考测评',
      tagline: '四个维度上的倾向',
      summary: '看你在四个维度上的倾向，给出四个字母的参考类型。',
      whatYouLearn: ['四个维度的倾向', '倾向的强弱'],
      notFor: ['招聘筛选'],
      format: 'bipolar',
      hasTypeCode: true,
      supportsClarification: true,
      dimensions: ['EI', 'SN', 'TF', 'JP'],
      defaultPackageId: 'typeme-jung48-zh-v2',
      baseItemCount: 48,
      clarificationItemCount: 16,
      maxClarificationItems: 16,
      estimatedMinutes: 15,
      contentStatus: 'draft_review_pending',
    },
    {
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
    },
  ],
}

interface Recorded {
  method: string
  url: string
  body: Record<string, unknown> | undefined
}

let calls: Recorded[] = []
let drafts: Record<string, unknown>[] = []
let catalogDelay: Promise<void> | null = null

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
    if (method === 'GET' && url.includes('/platform/instruments')) {
      if (catalogDelay) await catalogDelay
      return jsonResponse(CATALOG)
    }
    if (method === 'GET' && url.includes('/platform/attempts')) {
      return jsonResponse({ items: drafts, total: drafts.length, page: 0, size: 50 })
    }
    if (method === 'POST' && url.includes('/platform/attempts')) {
      return jsonResponse(
        {
          attemptId: 'attempt-new',
          instrumentSlug: 'bigfive50',
          instrumentKind: 'big_five',
          instrumentTitle: '大五人格倾向测评',
          packageId: 'typeme-bigfive50-zh-v1',
          reportKind: 'big_five_profile',
          status: 'DRAFT',
          revision: 0,
          currentQuestionId: null,
          clarificationDimensions: [],
          clarificationSkipped: false,
          startedAt: '2026-09-18T10:00:00Z',
          updatedAt: '2026-09-18T10:00:00Z',
          submittedAt: null,
          baseAttemptId: null,
          reportId: null,
          items: [],
          answers: [],
          answeredCount: 0,
          requiredCount: 50,
          answerComplete: false,
        },
        201,
      )
    }
    if (method === 'POST' && url.includes('/api/v3/attempts')) {
      return jsonResponse(
        {
          attemptId: 'attempt-jung',
          packageId: 'typeme-jung48-zh-v2',
          status: 'BASE_IN_PROGRESS',
          revision: 0,
        },
        201,
      )
    }
    return jsonResponse({ code: 'NOT_FOUND', message: `没有为 ${method} ${url} 准备替身` }, 404)
  }
  vi.stubGlobal('fetch', handler as never)
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assess', name: 'assess', component: AssessChooserView },
      {
        path: '/assess/:attemptId',
        name: 'assess-attempt',
        component: { template: '<p>答题</p>' },
      },
      { path: '/instruments', name: 'instruments', component: { template: '<p>列表</p>' } },
      { path: '/login', name: 'login', component: { template: '<p>登录</p>' } },
    ],
  })
}

async function mountChooser(query = '') {
  const router = makeRouter()
  await router.push(`/assess${query}`)
  await router.isReady()
  // `attachTo`：卡片上的按钮是真实点击路径的一部分，挂到 document 上更贴近实际渲染。
  const wrapper = mount(AssessChooserView, {
    global: { plugins: [router] },
    attachTo: document.body,
  })
  // 自动开始是一条"目录 → 草稿 → 建草稿 → 跳转"的异步链，每一环都要一次微任务。
  // 只 flush 一次会让断言看到一个**进行到一半**的状态（请求已发出、路由还没跳），
  // 那不是产品行为，只是测试自己的时序。
  await settle()
  return { wrapper, router }
}

/** 把上面那条链推到底。 */
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await flushPromises()
  }
}

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: 'attempt-open',
    instrumentSlug: 'bigfive50',
    instrumentKind: 'big_five',
    instrumentTitle: '大五人格倾向测评',
    packageId: 'typeme-bigfive50-zh-v1',
    reportContentVersion: null,
    status: 'DRAFT',
    revision: 3,
    startedAt: '2026-09-18T09:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
    submittedAt: null,
    reportId: null,
    reportStatus: null,
    computedTypeCode: null,
    answeredCount: 12,
    requiredCount: 50,
    ...overrides,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  drafts = []
  catalogDelay = null
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('/assess 选择页', () => {
  it('列出来源目录里的两项，并说明各自会得到什么', async () => {
    const { wrapper } = await mountChooser()

    const cards = wrapper.findAll('[data-instrument]')
    expect(cards).toHaveLength(2)
    expect(wrapper.text()).toContain('十六型人格参考测评')
    expect(wrapper.text()).toContain('大五人格倾向测评')
    expect(wrapper.text()).toContain('48 题')
    expect(wrapper.text()).toContain('50 题')
  })

  it('带 ?instrument=<slug> 过来时自动开始那一项，不需要再点一次', async () => {
    const { router } = await mountChooser('?instrument=bigfive50')

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(calls.find((call) => call.method === 'POST')!.url).toContain('/platform/attempts')
    expect(calls.find((call) => call.method === 'POST')!.body?.['instrument']).toBe('bigfive50')
    expect(router.currentRoute.value.name).toBe('assess-attempt')
    expect(router.currentRoute.value.params.attemptId).toBe('attempt-new')
  })

  it('目录还没回来时不会拿着 slug 去建草稿', async () => {
    // 挂住目录请求：这段时间里页面必须什么都不做
    let release: () => void = () => {}
    catalogDelay = new Promise((resolve) => {
      release = resolve as () => void
    })
    const router = makeRouter()
    await router.push('/assess?instrument=bigfive50')
    await router.isReady()
    const wrapper = mount(AssessChooserView, { global: { plugins: [router] } })
    await flushPromises()

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)

    release()
    await settle()
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
    expect(wrapper.exists()).toBe(true)
  })

  it('URL 里带的量表不存在时明确说出来，而不是毫无反应', async () => {
    const { wrapper } = await mountChooser('?instrument=nope-99')

    expect(wrapper.find('[data-assess-start-error]').text()).toContain('nope-99')
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
  })

  it('已有没答完的草稿时，卡片按钮继续那一份，不新建', async () => {
    drafts = [draft()]
    const { wrapper, router } = await mountChooser()

    await clickCardStart(wrapper, 'bigfive50')

    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(router.currentRoute.value.params.attemptId).toBe('attempt-open')
  })

  it('带 slug 过来时若已有没答完的草稿，继续那一份而不是新建', async () => {
    drafts = [draft()]
    const { router } = await mountChooser('?instrument=bigfive50')

    // "等草稿落定"这一条如果没做到，这里会先建一份新草稿：用户答过的 12 题
    // 留在旧草稿里，而人被带进一份空白的。
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0)
    expect(router.currentRoute.value.params.attemptId).toBe('attempt-open')
  })

  it('已经提交过的记录不算草稿入口', async () => {
    drafts = [draft({ status: 'SUBMITTED' })]
    const { router } = await mountChooser('?instrument=bigfive50')

    const post = calls.find((call) => call.method === 'POST')
    expect(post).toBeTruthy()
    expect(post!.url).toContain('/platform/attempts')
    expect(router.currentRoute.value.params.attemptId).toBe('attempt-new')
  })
})

/** 点某一项卡片上的「开始」按钮，然后等路由与请求都落地。 */
async function clickCardStart(
  wrapper: Awaited<ReturnType<typeof mountChooser>>['wrapper'],
  slug: string,
): Promise<void> {
  const button = wrapper.find(`[data-start="${slug}"]`)
  expect(button.exists()).toBe(true)
  await button.trigger('click')
  await settle()
}
