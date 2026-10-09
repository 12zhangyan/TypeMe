// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import App from '@/App.vue'
import LandingView from '@/views/LandingView.vue'
import { useAuthStore } from '@/stores/auth'
import { resetAdminProbeForTests } from '@/composables/useAdminProbe'
import { V3ApiError } from '@/api/v3'

/**
 * 公共壳（`App.vue`）顶栏导航的守卫。
 *
 * 这一组用例针对的是 2026-09-17 复核时在真实代码里读出来的两个缺陷：
 *
 * 1. **同一个 entypoint 渲染了两次**：`assessmentRoutesReady` 为真时，
 *    顶栏同时输出两个指向 `/assess` 的「开始测评」（一个带高亮判断、一个是
 *    "旧版本测试"入口清理后的残留）。前者的高亮判断 `route.name === 'assess'`
 *    还**永远为假** —— 因为 `quizActive` 为真时整个 `template v-else` 都不渲染，
 *    而 `/assess` 恰好属于 `quizActive`。结果：重复入口 + 高亮态失效。
 * 2. **两个导航文案写反**：`route.name === 'about' ? '方法与隐私' : '关于'`
 *    停在关于页时显示"方法与隐私"，在别的页面上显示"关于"。导航项应当描述
 *    它的**目标**，而不是当前页。
 *
 * 断言写成"顶栏里指向某路由的入口恰好一个"，而不是断言具体模板结构 ——
 * 后者会随实现变动，前者才是用户实际看到的东西。
 */

const fetchAdminAiSettings = vi.fn()

vi.mock('@/api/v3Admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Admin')>('@/api/v3Admin')
  return {
    ...actual,
    fetchAdminAiSettings: (...args: unknown[]) => fetchAdminAiSettings(...args),
  }
})

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/assess', name: 'assess', component: { template: '<div />' } },
      { path: '/assess/:attemptId', name: 'assess-attempt', component: { template: '<div />' } },
      { path: '/reports', name: 'reports', component: { template: '<div />' } },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
      { path: '/quiz', name: 'quiz', component: { template: '<div />' } },
      { path: '/admin', name: 'admin', component: { template: '<div />' } },
      { path: '/admin/members', name: 'admin-members', component: { template: '<div />' } },
    ],
  })
}

/** 顶栏（`header nav[aria-label="站点导航"]`）里指向指定路径的链接。 */
function navLinksTo(wrapper: ReturnType<typeof mount>, path: string) {
  return wrapper
    .find('header nav[aria-label="站点导航"]')
    .findAll('a')
    .filter((link) => (link.attributes('href') ?? '').split('?')[0] === path)
}

async function mountApp(path: string, options?: { attach?: boolean }) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App as never, {
    attachTo: options?.attach ? document.body : undefined,
    global: { plugins: [router] },
  })
  await flushPromises()
  return { wrapper, router }
}

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')

/** 把首页首包里的备案号节点装进文档，模拟浏览器拿到 `index.html` 之后、脚本挂载之前。 */
function installIcpFromIndexHtml(): HTMLElement {
  document.getElementById('site-icp')?.remove()
  const parsed = new DOMParser().parseFromString(INDEX_HTML, 'text/html')
  const node = parsed.getElementById('site-icp')
  if (!node) throw new Error('index.html 缺少 #site-icp')
  return document.body.appendChild(document.importNode(node, true)) as HTMLElement
}

beforeEach(() => {
  setActivePinia(createPinia())
  resetAdminProbeForTests()
  fetchAdminAiSettings.mockReset()
  fetchAdminAiSettings.mockRejectedValue(new Error('not probed in this case'))
  localStorage.clear()
  document.getElementById('site-icp')?.remove()
})

describe('顶栏导航（App.vue）', () => {
  it('指向「开始测评」的入口只出现一次', async () => {
    const { wrapper } = await mountApp('/about')
    const assessLinks = navLinksTo(wrapper, '/assess')
    expect(
      assessLinks.length,
      `顶栏里指向 /assess 的入口有 ${assessLinks.length} 个：` +
        assessLinks.map((link) => `「${link.text()}」`).join('、'),
    ).toBe(1)
    expect(assessLinks[0]!.text()).toBe('开始测评')
  })

  it('首页首包带有居中的 ICP 备案号，挂载后进入页脚正中且仍然只有一份', async () => {
    expect(INDEX_HTML).toContain('text-align: center')
    expect(INDEX_HTML).not.toContain('is-parked')
    const source = installIcpFromIndexHtml()
    const sourceLink = source.querySelector('a')
    expect(sourceLink?.textContent).toBe('京ICP备2026066393号')
    expect(sourceLink?.getAttribute('href')).toBe('https://beian.miit.gov.cn/')
    expect(sourceLink?.getAttribute('target')).toBe('_blank')
    expect(sourceLink?.getAttribute('rel')).toContain('noopener')

    const { wrapper, router } = await mountApp('/', { attach: true })
    const link = wrapper.get('footer .icp-filing-row.text-center a[href="https://beian.miit.gov.cn/"]')
    expect(link.text()).toBe('京ICP备2026066393号')
    expect(document.querySelectorAll('a[href="https://beian.miit.gov.cn/"]')).toHaveLength(1)
    expect(link.element.closest('#site-icp')?.classList.contains('is-parked')).toBe(false)

    await router.push('/quiz')
    await flushPromises()
    expect(wrapper.find('footer').exists()).toBe(false)
    const parked = document.getElementById('site-icp')
    expect(parked?.classList.contains('is-parked')).toBe(true)
    expect(parked?.querySelector('a')?.textContent).toBe('京ICP备2026066393号')
    expect(document.querySelectorAll('a[href="https://beian.miit.gov.cn/"]')).toHaveLength(1)
    wrapper.unmount()
  })

  it('停在关于页时，导航项写的仍然是它自己的目标名', async () => {
    const onAbout = await mountApp('/about')
    expect(navLinksTo(onAbout.wrapper, '/about').map((link) => link.text())).toEqual(['关于'])

    const onLanding = await mountApp('/')
    expect(navLinksTo(onLanding.wrapper, '/about').map((link) => link.text())).toEqual(['关于'])
  })

  it('未登录时不渲染重复的账号入口', async () => {
    const { wrapper } = await mountApp('/about')
    expect(navLinksTo(wrapper, '/login')).toHaveLength(1)
    expect(navLinksTo(wrapper, '/register')).toHaveLength(1)
  })

  it('未登录时顶栏没有「管理」', async () => {
    const { wrapper } = await mountApp('/about')
    expect(wrapper.find('[data-admin-nav]').exists()).toBe(false)
    expect(navLinksTo(wrapper, '/admin/members')).toHaveLength(0)
  })

  it('管理员登录后顶栏有恰好一个「管理」，指向成员页', async () => {
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const auth = useAuthStore()
    auth.status = 'authenticated'
    auth.profile = {
      userId: 'u1',
      username: 'admin',
      nickname: null,
      createdAt: '2026-09-17T00:00:00Z',
      passwordChangedAt: null,
    }
    const { wrapper } = await mountApp('/about')
    await flushPromises()
    const links = navLinksTo(wrapper, '/admin/members')
    expect(links).toHaveLength(1)
    expect(links[0]!.text()).toBe('管理')
  })

  it('同一账号更新资料后顶栏「管理」仍在，且不再打探测', async () => {
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const auth = useAuthStore()
    auth.status = 'authenticated'
    auth.profile = {
      userId: 'u1',
      username: 'admin',
      nickname: null,
      createdAt: '2026-09-17T00:00:00Z',
      passwordChangedAt: null,
    }
    const { wrapper } = await mountApp('/about')
    await flushPromises()
    expect(navLinksTo(wrapper, '/admin/members')).toHaveLength(1)
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(1)

    auth.applyProfile({
      userId: 'u1',
      username: 'admin',
      nickname: '新昵称',
      createdAt: '2026-09-17T00:00:00Z',
      passwordChangedAt: null,
    })
    await flushPromises()
    expect(navLinksTo(wrapper, '/admin/members')).toHaveLength(1)
    expect(fetchAdminAiSettings, '改昵称不该让管理入口消失或再探一次').toHaveBeenCalledTimes(1)
  })

  it('已登录时换成另一个账号：顶栏按新账号重新探测', async () => {
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const auth = useAuthStore()
    auth.status = 'authenticated'
    auth.profile = {
      userId: 'u1',
      username: 'admin',
      nickname: null,
      createdAt: '2026-09-17T00:00:00Z',
      passwordChangedAt: null,
    }
    const { wrapper } = await mountApp('/about')
    await flushPromises()
    expect(navLinksTo(wrapper, '/admin/members')).toHaveLength(1)

    fetchAdminAiSettings.mockRejectedValue(
      new V3ApiError(
        { code: 'FORBIDDEN', message: '需要更高的权限', requestId: 'rq-9', details: {} },
        { status: 403 },
      ),
    )
    auth.applyProfile({
      userId: 'u2',
      username: 'normal',
      nickname: null,
      createdAt: '2026-09-18T00:00:00Z',
      passwordChangedAt: null,
    })
    await flushPromises()
    expect(wrapper.find('[data-admin-nav]').exists()).toBe(false)
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(2)
  })

  it('管理员探测未完成就换成普通账号：过期的 200 不会让顶栏出现「管理」', async () => {
    let resolveAdmin: ((value: { enabled: boolean; mockMode: boolean }) => void) | undefined
    fetchAdminAiSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdmin = resolve
        }),
    )
    const auth = useAuthStore()
    auth.status = 'authenticated'
    auth.profile = {
      userId: 'u1',
      username: 'admin',
      nickname: null,
      createdAt: '2026-09-17T00:00:00Z',
      passwordChangedAt: null,
    }
    const { wrapper } = await mountApp('/about')
    await flushPromises()
    expect(wrapper.find('[data-admin-nav]').exists()).toBe(false)

    fetchAdminAiSettings.mockRejectedValue(
      new V3ApiError(
        { code: 'FORBIDDEN', message: '需要更高的权限', requestId: 'rq-9', details: {} },
        { status: 403 },
      ),
    )
    auth.applyAnonymous()
    auth.applyProfile({
      userId: 'u2',
      username: 'normal',
      nickname: null,
      createdAt: '2026-09-18T00:00:00Z',
      passwordChangedAt: null,
    })
    await flushPromises()
    expect(wrapper.find('[data-admin-nav]').exists()).toBe(false)

    resolveAdmin?.({ enabled: true, mockMode: true })
    await flushPromises()
    expect(wrapper.find('[data-admin-nav]').exists(), '过期探测不能让普通用户顶栏出现管理入口').toBe(
      false,
    )
  })
})
