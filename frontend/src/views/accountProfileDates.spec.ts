// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AccountView from '@/views/AccountView.vue'
import { useAuthStore } from '@/stores/auth'
import { resetAdminProbeForTests } from '@/composables/useAdminProbe'

/**
 * 账号页的「注册时间 / 上次改密码」。
 *
 * 真实浏览器里发现的缺陷：刚登录的用户打开账号页，这两行写着「没有记录」。
 * 原因是登录/注册响应只带 userId / username / nickname，store 里的资料因此没有时间；
 * 只有整页刷新（走 `/me`）才会补上。用户会以为自己的注册时间丢了。
 */

const fetchMe = vi.fn()
const fetchAdminAiSettings = vi.fn()

vi.mock('@/api/v3', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3')>('@/api/v3')
  return { ...actual, fetchMe: (...args: unknown[]) => fetchMe(...args) }
})
vi.mock('@/api/v3Admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Admin')>('@/api/v3Admin')
  return { ...actual, fetchAdminAiSettings: (...args: unknown[]) => fetchAdminAiSettings(...args) }
})

async function mountAccountWith(profile: Record<string, unknown>) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: AccountView },
    ],
  })
  await router.push('/account')
  await router.isReady()
  const auth = useAuthStore()
  auth.profile = profile as never
  auth.status = 'authenticated'
  const wrapper = mount(AccountView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, auth }
}

describe('账号页 · 注册时间与改密时间', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAdminProbeForTests()
    fetchMe.mockReset()
    fetchAdminAiSettings.mockReset()
    fetchAdminAiSettings.mockRejectedValue(new Error('not admin'))
  })

  it('登录后的资料没有时间 → 打开账号页会补读，并显示真实时间而不是「没有记录」', async () => {
    fetchMe.mockResolvedValue({
      userId: 'u1',
      username: 'someone',
      nickname: '某人',
      createdAt: '2026-10-23T06:27:06.640Z',
      passwordChangedAt: '2026-10-23T06:27:06.640Z',
    })
    const { wrapper } = await mountAccountWith({
      userId: 'u1', username: 'someone', nickname: '某人', createdAt: null, passwordChangedAt: null,
    })

    expect(fetchMe).toHaveBeenCalledTimes(1)
    const text = wrapper.text()
    expect(text).not.toContain('没有记录')
    expect(text).toMatch(/2026\s*年\s*10\s*月\s*2[23]\s*日/)
  })

  it('资料已经完整 → 不多发一次请求', async () => {
    await mountAccountWith({
      userId: 'u1', username: 'someone', nickname: null,
      createdAt: '2026-09-17T00:00:00Z', passwordChangedAt: '2026-09-18T00:00:00Z',
    })
    expect(fetchMe).not.toHaveBeenCalled()
  })

  it('补读失败 → 页面照常可用，两行维持「没有记录」，不弹出任何区块错误', async () => {
    fetchMe.mockRejectedValue(new Error('network down'))
    const { wrapper } = await mountAccountWith({
      userId: 'u1', username: 'someone', nickname: null, createdAt: null, passwordChangedAt: null,
    })
    expect(wrapper.text()).toContain('没有记录')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
