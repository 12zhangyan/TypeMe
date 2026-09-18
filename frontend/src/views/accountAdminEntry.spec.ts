// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AccountView from '@/views/AccountView.vue'
import { useAuthStore } from '@/stores/auth'
import { resetAdminProbeForTests } from '@/composables/useAdminProbe'
import { V3ApiError } from '@/api/v3'

/**
 * 账号页的**管理后台入口**（2026-09-17 新增）。
 *
 * 这一块的风险只有一条，但很实在：入口显示错了，就等于告诉一个普通用户
 * "你是管理员"（或者反过来，让真正的管理员找不到后台）。
 * 所以三个分支都要钉住：
 *
 *   - 200 → 显示入口；
 *   - 403 → **不**显示（而且不能因此把整页搞坏）；
 *   - 网络失败 → **不**显示，但**不缓存**这个结论。
 *
 * 最后一条尤其重要：`/me` 不回 role，所以"是不是管理员"只能靠问受保护的接口。
 * 如果探测失败被当成"不是管理员"并缓存下来，后端恢复后管理员刷新页面仍然看不到入口，
 * 而且没有任何提示说明为什么。
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
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: AccountView },
      { path: '/admin', name: 'admin', component: { template: '<div />' } },
    ],
  })
}

async function mountAccount() {
  const router = makeRouter()
  await router.push('/account')
  await router.isReady()
  const auth = useAuthStore()
  auth.profile = {
    userId: 'u1',
    username: 'someone',
    nickname: null,
    createdAt: '2026-09-17T00:00:00Z',
    passwordChangedAt: null,
  }
  auth.status = 'authenticated'
  const wrapper = mount(AccountView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

function forbidden(): V3ApiError {
  return new V3ApiError({ code: 'FORBIDDEN', message: '需要更高的权限', requestId: 'rq-9', details: {} }, { status: 403 })
}

describe('账号页 · 管理后台入口', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAdminProbeForTests()
    fetchAdminAiSettings.mockReset()
  })

  it('服务端回 200 → 显示入口，链接指向 /admin', async () => {
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const wrapper = await mountAccount()
    await flushPromises()

    const entry = wrapper.find('[data-admin-entry]')
    expect(entry.exists()).toBe(true)
    // RouterLink 渲染的是路由路径本身；hash 前缀（`#`）是 createWebHashHistory 在
    // 浏览器地址栏层面加的，不在 `href` 里。这里断言路径，别断言 `#/admin`。
    const link = entry.find('[data-admin-entry-link]')
    expect(link.attributes('href')).toBe('/admin')
    expect(link.text()).toContain('打开管理后台')
  })

  it('服务端回 403 → 不显示入口，且账号页其它内容照常显示', async () => {
    fetchAdminAiSettings.mockRejectedValue(forbidden())
    const wrapper = await mountAccount()
    await flushPromises()

    expect(wrapper.find('[data-admin-entry]').exists()).toBe(false)
    // 关键：403 不能把整页弄坏 —— 普通用户仍然要看得到自己的账号信息
    expect(wrapper.text()).toContain('账号与数据')
    expect(wrapper.text()).toContain('someone')
  })

  it('探测失败（网络/5xx）→ 不显示入口，但**不缓存**这个结论：重试能拿到入口', async () => {
    fetchAdminAiSettings.mockRejectedValue(new Error('boom'))
    const wrapper = await mountAccount()
    await flushPromises()

    // 探测失败时也显示不出来（普通用户根本不该知道有后台），但"不显示"不等于"判定为不是管理员"
    expect(wrapper.find('[data-admin-entry]').exists()).toBe(false)

    // 后端恢复后重新探测：必须能拿到入口 —— 这证明失败没有被缓存成 false
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const { refresh } = await import('@/composables/useAdminProbe').then((mod) => mod.useAdminProbe())
    await refresh()
    await flushPromises()
    expect(wrapper.find('[data-admin-entry]').exists()).toBe(true)
  })

  /**
   * 会话失效（401）同样属于"没问到"，不是"这个账号不是管理员"。
   *
   * <p>把它缓存成 false 的后果：用户在同一个页面里重新登录之后，后台入口仍然不出现 ——
   * 不刷新整页就永远看不到，而本文件的注释一直写着"失败不缓存"。
   * 注意这条与上面的网络失败不同：401 会让 `auth` 变成未登录，然后**重新登录**，
   * 这才是真实序列。
   */
  it('401 之后重新登录：入口能重新拿到（会话失效不能被缓存成"不是管理员"）', async () => {
    fetchAdminAiSettings.mockRejectedValue(
      new V3ApiError(
        { code: 'UNAUTHENTICATED', message: '请先登录。', requestId: 'rq-1', details: {} },
        { status: 401 },
      ),
    )
    const wrapper = await mountAccount()
    await flushPromises()
    expect(wrapper.find('[data-admin-entry]').exists()).toBe(false)

    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    const { refresh } = await import('@/composables/useAdminProbe').then((mod) => mod.useAdminProbe())
    await refresh()
    await flushPromises()
    expect(wrapper.find('[data-admin-entry]').exists()).toBe(true)
  })

  /**
   * 共用一个浏览器换账号时，探针缓存属于**上一个账号**。
   *
   * <p>`cached` 是模块级的：管理员登录后缓存 `true`，退出、换成普通用户登录，
   * 入口仍然显示 —— 虽然点进去会 403，但"这个入口存在"本身就已经告诉普通用户
   * 这台站有后台（本组件开头的注释写明普通用户根本不该知道）。
   */
  it('换账号（先管理员后普通用户）：上一个账号的探测结论必须作废', async () => {
    fetchAdminAiSettings.mockResolvedValue({ enabled: true, mockMode: true })
    await mountAccount()
    await flushPromises()
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(1)

    // 管理员退出：所有"变成未登录"的路径都走 applyAnonymous
    useAuthStore().applyAnonymous()

    // 普通用户登录（同一页，不刷新）：服务端会回 403
    fetchAdminAiSettings.mockRejectedValue(forbidden())
    useAuthStore().applyProfile({
      userId: 'u2',
      username: 'normal',
      nickname: null,
      createdAt: '2026-09-18T00:00:00Z',
      passwordChangedAt: null,
    })

    const { refresh } = await import('@/composables/useAdminProbe').then((mod) => mod.useAdminProbe())
    const isAdmin = await refresh()
    expect(isAdmin, '不能把上一个账号的"是管理员"留给下一个登录的人').toBe(false)
    expect(fetchAdminAiSettings, '身份变了必须重新问一次，而不是复用缓存').toHaveBeenCalledTimes(2)
  })
})
