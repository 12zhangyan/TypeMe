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
})
