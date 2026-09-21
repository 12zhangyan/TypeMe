// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import InstrumentMethodView from './InstrumentMethodView.vue'

/**
 * 方法说明页（`/instruments/:slug/method`）的行为测试。
 *
 * 这一页有两个**只有真实浏览器才看得出来的**错法，都在这里钉住：
 *
 *   1. **同一个组件换 slug 不重新取数据**。`/instruments/a/method` → `/instruments/b/method`
 *      是同一个组件实例，只写 `onMounted` 的话会继续显示**上一项**的维度与版本。
 *      而两项测评的维度数量不同（4 vs 5），页面看起来"有内容"，只是内容是别人的。
 *      发现方式：第 20 轮的真实浏览器验收里，"十六型方法页给出四个维度"实际数出了 5 个。
 *   2. **后发先至**。两次请求并发时，先发的那次如果后回来，会把 B 的页面写成 A 的数据。
 *      所以 `load()` 带请求令牌。
 *
 * 另外钉住"结论长什么样"必须按量表说：大五没有类型码、没有总分，十六型平分时不给字母。
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

const JUNG_ITEM = {
  ...CATALOG_ITEM,
  slug: 'jung48',
  kind: 'jung',
  title: '十六型人格参考测评',
  format: 'bipolar',
  hasTypeCode: true,
  supportsClarification: true,
  dimensions: ['EI', 'SN', 'TF', 'JP'],
  defaultPackageId: 'typeme-jung48-zh-v2',
  baseItemCount: 48,
  clarificationItemCount: 16,
  maxClarificationItems: 16,
  estimatedMinutes: 15,
}

function dimensionCopy(dimension: string): Record<string, unknown> {
  return {
    dimension,
    name: `${dimension} 维度`,
    question: `${dimension} 在比较什么？`,
    lowLabel: `${dimension} 的低端`,
    highLabel: `${dimension} 的高端`,
    lowDescription: '低端描述',
    highDescription: '高端描述',
    lowSigns: ['低端表现'],
    highSigns: ['高端表现'],
    balancedSummary: '两边差不多时……',
    caution: '不要拿它给自己贴标签。',
    observation: '留意你在不同场合的表现。',
  }
}

/** 版本行的字段集合照抄后端 `InstrumentVersionView`（少一个字段解析器就会明确报错）。 */
function versionRow(item: Record<string, unknown>, index: number): Record<string, unknown> {
  const isJung = item['slug'] === 'jung48'
  return {
    packageId: isJung && index === 0 ? 'typeme-jung48-zh-v2' : String(item['defaultPackageId']),
    revision: `r${index + 1}`,
    scoringVersion: isJung ? 'jung-score-v2' : 'typeme-bigfive50-score-v1',
    reportContentVersion: isJung ? 'typeme-type-report-zh-v2' : 'typeme-bigfive50-report-v1',
    contentStatus: 'draft_review_pending',
    sha256: 'b'.repeat(64),
    isDefault: index === 0,
    baseItemCount: item['baseItemCount'],
    clarificationItemCount: item['clarificationItemCount'],
  }
}

function detail(item: Record<string, unknown>): Record<string, unknown> {
  const dimensionCodes = item['dimensions'] as string[]
  // 十六型真实上有两版（v2 是默认、v1 仍可读），大五一版
  const versionCount = item['slug'] === 'jung48' ? 2 : 1
  return {
    instrument: item,
    dimensions: dimensionCodes.map(dimensionCopy),
    versions: Array.from({ length: versionCount }, (_, index) => versionRow(item, index)),
  }
}

let requests: string[] = []
let delayFor: Record<string, number> = {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  const handler = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    requests.push(url)
    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    const path = url.split('?')[0] ?? url
    const slug = path.split('/').filter(Boolean).pop() ?? ''
    const item = slug === 'jung48' ? JUNG_ITEM : CATALOG_ITEM
    const wait = delayFor[slug] ?? 0
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    return jsonResponse(detail(item))
  }
  vi.stubGlobal('fetch', handler as never)
}

// 排障用：把服务端替身实际收到的 URL 打出来（断言失败时能直接看到差在哪）
function dumpRequests(): string {
  return requests.length === 0 ? '(没有发出任何请求)' : requests.join(' | ')
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/instruments', name: 'instruments', component: { template: '<p>列表</p>' } },
      {
        path: '/instruments/:slug/method',
        name: 'instrument-method',
        component: InstrumentMethodView,
      },
      { path: '/assess', name: 'assess', component: { template: '<p>答题</p>' } },
      { path: '/login', name: 'login', component: { template: '<p>登录</p>' } },
      { path: '/about', name: 'about', component: { template: '<p>关于</p>' } },
    ],
  })
}

async function mountMethod(path: string): Promise<ReturnType<typeof mount>> {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(InstrumentMethodView, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  requests = []
  delayFor = {}
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('结果长什么样：必须按量表说', () => {
  it('大五：说清没有类型码、也没有总分', async () => {
    const wrapper = await mountMethod('/instruments/bigfive50/method')
    const shape = wrapper.find('[data-method-result-shape]')
    expect(shape.exists(), dumpRequests()).toBe(true)
    const text = shape.text()
    expect(text).toContain('没有类型码')
    expect(text).toContain('没有总分')
    expect(text).toContain('5')
    expect(text).not.toContain('四个字母')
  })

  it('十六型：说清平分时不给字母', async () => {
    const wrapper = await mountMethod('/instruments/jung48/method')
    const text = wrapper.find('[data-method-result-shape]').text()
    expect(text).toContain('不给字母')
    expect(text).not.toContain('没有类型码')
  })

  it('维度数量按量表给（4 vs 5）', async () => {
    const big = await mountMethod('/instruments/bigfive50/method')
    expect(big.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(5)
    const jung = await mountMethod('/instruments/jung48/method')
    expect(jung.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(4)
  })
})

describe('站内换 slug 必须重新取数据', () => {
  it('从大五的方法页跳到十六型：维度数从 5 变成 4', async () => {
    const router = makeRouter()
    await router.push('/instruments/bigfive50/method')
    await router.isReady()
    const wrapper = mount(InstrumentMethodView, { global: { plugins: [router] } })
    await flushPromises()
    await flushPromises()
    expect(wrapper.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(5)

    // 这次是**路由跳转**，不是重新挂载：组件实例是同一个
    await router.push('/instruments/jung48/method')
    await flushPromises()
    await flushPromises()

    expect(wrapper.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(4)
    expect(wrapper.find('[data-method-result-shape]').text()).toContain('不给字母')
    // 确实又问了服务端一次，而不是复用了上一份
    expect(requests.filter((url) => url.includes('/instruments/'))).toHaveLength(2)
  })

  it('后发先至：先发的请求后回来，不能覆盖当前页', async () => {
    // 先发的那次（bigfive50）慢，后发的那次（jung48）快
    delayFor = { bigfive50: 60, jung48: 0 }
    const router = makeRouter()
    await router.push('/instruments/bigfive50/method')
    await router.isReady()
    const wrapper = mount(InstrumentMethodView, { global: { plugins: [router] } })
    await flushPromises()

    await router.push('/instruments/jung48/method')
    await flushPromises()
    await flushPromises()
    expect(wrapper.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(4)

    // 等慢的那次回来：它必须被丢弃
    await new Promise((resolve) => setTimeout(resolve, 120))
    await flushPromises()
    expect(wrapper.findAll('[data-method-dimensions] [data-dimension]')).toHaveLength(4)
    expect(wrapper.find('[data-method-result-shape]').text()).toContain('不给字母')
  })
})

describe('页面上的其它事实', () => {
  it('未登录时给登录入口并带上回跳地址，而不是直接「开始」', async () => {
    const wrapper = await mountMethod('/instruments/bigfive50/method')
    const html = wrapper.html()
    expect(html).toContain('登录后开始')
    expect(html).toContain('redirect')
    expect(html).not.toContain('开始这项测评')
  })

  it('内容审校状态说成人话，不露出内部状态码', async () => {
    const wrapper = await mountMethod('/instruments/bigfive50/method')
    const text = wrapper.text()
    expect(text).toContain('仍在审校中')
    expect(text).not.toContain('draft_review_pending')
  })

  it('不把内部包 ID 或计分版本号给普通用户看', async () => {
    const wrapper = await mountMethod('/instruments/bigfive50/method')
    const text = wrapper.text()
    expect(wrapper.find('[data-method-versions]').text()).toContain('按提交当时的题目与计分规则生成')
    expect(text).not.toContain('typeme-bigfive50-zh-v1')
    expect(text).not.toContain('typeme-bigfive50-score-v1')
    expect(text).not.toContain('当前默认')
    expect(wrapper.find('table').exists()).toBe(false)
  })
})
