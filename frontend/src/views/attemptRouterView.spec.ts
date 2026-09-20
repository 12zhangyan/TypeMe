// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import AttemptRouterView from './AttemptRouterView.vue'

/**
 * `/assess/:attemptId` **分流页**的行为测试。
 *
 * ## 这一页在修什么
 *
 * 线上表现：点开一份**十六型**草稿，看到「这份测评不是大五倾向测评，请从对应的入口继续」。
 * 根因不在服务端 —— 大五端点 `GET /api/v3/platform/attempts/{id}` 对本人十六型草稿
 * 返回 `409 INSTRUMENT_MISMATCH`，那**正是分流信号**；但这一页只认 `NOT_FOUND`/`FORBIDDEN`，
 * 于是把信号当成了致命错误显示出来。同一段代码还有两个"看起来也对"的错法：
 *
 *   1. 把 `404`（没有这份测评）和 `403`（不是你的）当成"这是十六型草稿"，
 *      于是"不存在"会被渲染成一份**空白的十六型答题页**；
 *   2. `attemptId` 在 `setup` 里只算一次、请求只在 `onMounted` 发一次 ——
 *      同一路由换 id（`/assess/A` → `/assess/B`）不重新分流，且**旧响应晚到会覆盖新页面**。
 *
 * ## 替身的形状来自哪里
 *
 * 错误体 `{code,message,requestId,details}` 与状态码是照
 * `PlatformAttemptDispatchIT`（H2 实跑）导出的真实响应抄的：409 `INSTRUMENT_MISMATCH`、
 * 404 `NOT_FOUND`、401 `UNAUTHENTICATED`、409 `PACKAGE_UNAVAILABLE`。
 * 成功体是按 `parseAttempt` 会**严格校验**的字段写的 —— 少一个字段就会解析失败，
 * 所以它不能"随便写个通用草稿"就通过。
 */

const JUNG_ID = 'jung-draft-1'
const BIG_FIVE_ID = 'bigfive-draft-1'

/* ── 替身 ───────────────────────────────────────────────────────────────── */

interface Recorded {
  method: string
  url: string
}

let calls: Recorded[] = []
/** 每个路径要回什么：`{status, body}`、`{networkError: true}`，或一个等待外部放行的闸门。 */
type Reply =
  | { status: number; body: unknown }
  | { networkError: true }
  | { gate: string; reply: { status: number; body: unknown } }

let replies: Record<string, Reply> = {}
const gates = new Map<string, () => void>()
const pendingGates = new Map<string, () => void>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 真实错误体（取自后端 IT 的响应导出）。 */
function errorBody(code: string, message: string): unknown {
  return { code, message, requestId: 'req-fixture-1', details: {} }
}

const MISMATCH = errorBody('INSTRUMENT_MISMATCH', '这份测评不是大五倾向测评，请从对应的入口继续。')
const NOT_FOUND = errorBody('NOT_FOUND', '这份测评不存在。')
const FORBIDDEN = errorBody('FORBIDDEN', '这个操作需要更高的权限。')
const UNAUTHENTICATED = errorBody('UNAUTHENTICATED', '请先登录。')
const PACKAGE_UNAVAILABLE = errorBody('PACKAGE_UNAVAILABLE', '这份测评锁定的题目版本当前不可用，不能继续作答。')

/** 大五草稿的平台视图：字段与后端 `PlatformDtos.AttemptView` 一一对应。 */
function bigFiveAttempt(): Record<string, unknown> {
  return {
    attemptId: BIG_FIVE_ID,
    instrumentSlug: 'bigfive50',
    instrumentKind: 'big_five',
    instrumentTitle: '大五人格倾向测评',
    packageId: 'typeme-bigfive50-zh-v1',
    reportKind: 'big_five_profile',
    status: 'DRAFT',
    revision: 3,
    currentQuestionId: 'Q01',
    clarificationDimensions: [],
    clarificationSkipped: false,
    startedAt: '2026-09-20T01:00:00Z',
    updatedAt: '2026-09-20T01:05:00Z',
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
        help: null,
      },
    ],
    answeredCount: 1,
    requiredCount: 50,
    answerComplete: false,
  }
}

function installFetch(): void {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ method, url })

    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }

    const key = url.replace(/^.*\/api\/v3/, '')
    const reply = replies[key]
    if (!reply) {
      return jsonResponse(errorBody('NOT_FOUND', `没有为 ${method} ${url} 准备替身`), 404)
    }
    if ('networkError' in reply) {
      throw new TypeError('Failed to fetch')
    }
    if ('gate' in reply) {
      await new Promise<void>((resolve) => {
        pendingGates.set(reply.gate, resolve)
      })
      return jsonResponse(reply.reply.body, reply.reply.status)
    }
    return jsonResponse(reply.body, reply.status)
  }
  vi.stubGlobal('fetch', handler as never)
}

/** 放行某个闸门（模拟"慢请求终于回来了"）。 */
async function release(gate: string): Promise<void> {
  const resolve = pendingGates.get(gate) ?? gates.get(gate)
  if (!resolve) throw new Error(`闸门 ${gate} 没有在等：${[...pendingGates.keys()].join(',')}`)
  resolve()
  await flushPromises()
}

/* ── 挂载 ───────────────────────────────────────────────────────────────── */

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/assess/:attemptId', name: 'assess-attempt', component: AttemptRouterView },
      { path: '/instruments', name: 'instruments', component: { template: '<div />' } },
    ],
  })
}

async function mountAt(router: Router, path: string): Promise<VueWrapper> {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(AttemptRouterView, {
    global: {
      plugins: [router],
      // 两个答题页在这里**只作为"选了哪一页"的标记**：它们各自的网络与状态由
      // assessView.spec / bigFiveAssessView.spec 覆盖，浏览器验收另有真实渲染。
      stubs: {
        AssessView: { template: '<div data-page="jung">十六型答题页</div>' },
        BigFiveAssessView: { template: '<div data-page="big_five">大五答题页</div>' },
      },
    },
  })
  await flushPromises()
  return wrapper
}

function page(wrapper: VueWrapper): string {
  if (wrapper.find('[data-page="jung"]').exists()) return 'jung'
  if (wrapper.find('[data-page="big_five"]').exists()) return 'big_five'
  if (wrapper.find('[data-attempt-route-error]').exists()) return 'error'
  if (wrapper.find('[data-attempt-route-not-found]').exists()) return 'not_found'
  return 'unknown'
}

beforeEach(() => {
  calls = []
  replies = {}
  gates.clear()
  pendingGates.clear()
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ── 用例 ───────────────────────────────────────────────────────────────── */

describe('分流：按服务端说的量表选页面', () => {
  it('大五草稿 → 大五答题页', async () => {
    replies['/platform/attempts/' + BIG_FIVE_ID] = { status: 200, body: bigFiveAttempt() }
    const wrapper = await mountAt(makeRouter(), `/assess/${BIG_FIVE_ID}`)
    expect(page(wrapper)).toBe('big_five')
    expect(calls.some((call) => call.url.includes(`/api/v3/platform/attempts/${BIG_FIVE_ID}`))).toBe(true)
  })

  it('十六型草稿（409 INSTRUMENT_MISMATCH）→ 十六型答题页，而不是错误提示', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 409, body: MISMATCH }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('jung')
    expect(wrapper.text()).not.toContain('这份测评不是大五')
  })

  it('分歧信号只能来自"已按当前用户读过草稿"的那个端点', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 409, body: MISMATCH }
    await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    // 若哪天改成先问一个"万能草稿接口"再按 kind 分流，这条会立刻红：
    // 那样等于让未做归属校验的响应决定渲染哪一页。
    expect(calls.map((call) => call.url)).toEqual([
      `/api/v3/platform/attempts/${JUNG_ID}`,
    ])
  })
})

describe('不能把别的失败当成"这是十六型草稿"', () => {
  it('404（不存在／不是你的）→ 明说没有这份测评，不渲染答题页', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 404, body: NOT_FOUND }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('not_found')
    expect(wrapper.text()).toContain('没有找到这份测评')
  })

  it('403 → 权限错误，不渲染答题页', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 403, body: FORBIDDEN }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('error')
  })

  it('401 → 会话失效提示，不渲染答题页', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 401, body: UNAUTHENTICATED }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('error')
    expect(wrapper.text()).toContain('登录')
  })

  it('409 PACKAGE_UNAVAILABLE → 版本不可用，不渲染答题页', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 409, body: PACKAGE_UNAVAILABLE }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('error')
    expect(wrapper.text()).not.toContain('这份测评不是大五')
  })

  it('网络失败 → 错误提示，不渲染答题页', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { networkError: true }
    const wrapper = await mountAt(makeRouter(), `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('error')
  })
})

describe('同一路由换 attemptId：必须重新分流，且旧响应不许覆盖新页面', () => {
  it('先慢的大五、后快的十六型 → 停在十六型', async () => {
    replies['/platform/attempts/' + BIG_FIVE_ID] = {
      gate: 'slow-bigfive',
      reply: { status: 200, body: bigFiveAttempt() },
    }
    replies['/platform/attempts/' + JUNG_ID] = { status: 409, body: MISMATCH }

    const router = makeRouter()
    const wrapper = await mountAt(router, `/assess/${BIG_FIVE_ID}`)
    expect(page(wrapper)).toBe('unknown') // 慢请求还没回来

    await router.push(`/assess/${JUNG_ID}`)
    await flushPromises()
    expect(page(wrapper)).toBe('jung')

    // 旧请求这时才回来：不许把页面顶回大五
    await release('slow-bigfive')
    expect(page(wrapper)).toBe('jung')
  })

  it('先慢的十六型、后快的大五 → 停在大五', async () => {
    replies['/platform/attempts/' + JUNG_ID] = {
      gate: 'slow-jung',
      reply: { status: 409, body: MISMATCH },
    }
    replies['/platform/attempts/' + BIG_FIVE_ID] = { status: 200, body: bigFiveAttempt() }

    const router = makeRouter()
    const wrapper = await mountAt(router, `/assess/${JUNG_ID}`)
    await router.push(`/assess/${BIG_FIVE_ID}`)
    await flushPromises()
    expect(page(wrapper)).toBe('big_five')

    await release('slow-jung')
    expect(page(wrapper)).toBe('big_five')
  })

  it('从失败的那份换到正常的那份：旧的错误提示必须消失', async () => {
    replies['/platform/attempts/' + JUNG_ID] = { status: 404, body: NOT_FOUND }
    replies['/platform/attempts/' + BIG_FIVE_ID] = { status: 200, body: bigFiveAttempt() }

    const router = makeRouter()
    const wrapper = await mountAt(router, `/assess/${JUNG_ID}`)
    expect(page(wrapper)).toBe('not_found')

    await router.push(`/assess/${BIG_FIVE_ID}`)
    await flushPromises()
    expect(page(wrapper)).toBe('big_five')
    expect(wrapper.text()).not.toContain('这份测评不存在')
  })
})
