// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AdminView from '@/views/AdminView.vue'
import { resetAdminProbeForTests } from '@/composables/useAdminProbe'
import { V3ApiError } from '@/api/v3'

/**
 * 管理后台页（2026-09-17 新增）。
 *
 * 这一页的风险不在"表单能不能填"，而在四件事上，用例基本都围着它们转：
 *
 *   1. **权限三态不能混**：403 要显示"你不是管理员"，网络失败要显示"没问到，
 *      别去改权限配置"。把后者说成前者，会让管理员在后端抖动时到处找权限问题。
 *   2. **密钥只写不读**：页面文本里不得出现已保存密钥的任何形态；
 *      提交成功后输入框必须被清空。
 *   3. **只发改动过的字段**：全量提交会把"解析错的值"写进库。
 *   4. **空 = 不改动，勾选「清除」= 明确清除**：这两个意图不能共用一个表示。
 */

const fetchAdminAiSettings = vi.fn()
const updateAdminAiSettings = vi.fn()
const fetchAdminUsers = vi.fn()

vi.mock('@/api/v3Admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Admin')>('@/api/v3Admin')
  return {
    ...actual,
    fetchAdminAiSettings: (...args: unknown[]) => fetchAdminAiSettings(...args),
    updateAdminAiSettings: (...args: unknown[]) => updateAdminAiSettings(...args),
    fetchAdminUsers: (...args: unknown[]) => fetchAdminUsers(...args),
  }
})

function settings(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mockMode: true,
    baseUrlHost: 'api.example.com',
    model: 'demo-model',
    promptVersion: 'v1',
    dailyLimitPerUser: 3,
    retryLimitPerHour: 5,
    globalDailyCallBudget: 200,
    globalDailyTokenBudget: 2000000,
    workerConcurrency: 2,
    connectTimeoutMs: 5000,
    requestDeadlineMs: 60000,
    maxTokens: 1500,
    apiKeyConfigured: true,
    apiKeyFingerprint: 'abcdef12',
    apiKeySource: 'env',
    updatedAt: '2026-09-17T08:00:00Z',
    updatedBy: 'admin-1',
    ...overrides,
  }
}

function forbidden(): V3ApiError {
  return new V3ApiError({ code: 'FORBIDDEN', message: '需要更高的权限', requestId: 'rq-1', details: {} }, { status: 403 })
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/admin', name: 'admin', component: AdminView },
      { path: '/admin/members', name: 'admin-members', component: { template: '<div />' } },
    ],
  })
}

async function mountAdmin() {
  const router = makeRouter()
  await router.push('/admin')
  await router.isReady()
  const wrapper = mount(AdminView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('管理后台 · AI 设置', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAdminProbeForTests()
    fetchAdminAiSettings.mockReset()
    updateAdminAiSettings.mockReset()
    fetchAdminUsers.mockReset()
    fetchAdminUsers.mockResolvedValue({ items: [], page: 0, size: 20, total: 0 })
  })

  it('403：说清是权限问题，并明确否认"这是加载失败"', async () => {
    fetchAdminAiSettings.mockRejectedValue(forbidden())
    const { wrapper } = await mountAdmin()

    const denied = wrapper.find('[data-admin-denied]')
    expect(denied.exists()).toBe(true)
    expect(denied.text()).toContain('只对管理员开放')
    expect(denied.text()).toContain('不是加载失败')
    // 没有权限就不该显示任何设置内容
    expect(wrapper.find('[data-admin-summary]').exists()).toBe(false)
    expect(wrapper.find('[data-admin-save]').exists()).toBe(false)
    expect(wrapper.find('[data-admin-unavailable]').exists()).toBe(false)
  })

  it('网络失败：说"没问到"，不能冒充成没有权限', async () => {
    fetchAdminAiSettings.mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountAdmin()

    const box = wrapper.find('[data-admin-unavailable]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('这不代表你没有权限')
    expect(box.text()).toContain('请不要据此去改权限配置')
    expect(wrapper.find('[data-admin-denied]').exists()).toBe(false)
  })

  /**
   * 401（会话失效）以前会落进"没问到"那一支，于是登录过期的管理员读到的是
   * 「可能只是后端暂时没响应」—— 他会去重启后端、翻日志，而真正该做的只是重新登录。
   * 三个状态必须各说各的：403 → 没权限，401 → 重新登录，其它 → 没问到。
   */
  it('401：说清是登录态失效，并给一条带 redirect 的登录入口', async () => {
    fetchAdminAiSettings.mockRejectedValue(
      new V3ApiError(
        { code: 'UNAUTHENTICATED', message: '请先登录。', requestId: 'rq-401', details: {} },
        { status: 401 },
      ),
    )
    const { wrapper } = await mountAdmin()

    const box = wrapper.find('[data-admin-needs-login]')
    expect(box.exists()).toBe(true)
    expect(box.text()).toContain('登录状态已经失效')
    // 不能借用"后端没响应"或"没权限"的说法
    expect(wrapper.find('[data-admin-unavailable]').exists()).toBe(false)
    expect(wrapper.find('[data-admin-denied]').exists()).toBe(false)
    expect(box.text()).toContain('rq-401')

    // 登录入口必须带回跳，否则管理员登录后被丢到首页，还得自己摸回后台
    const link = box.find('a')
    expect(link.attributes('href')).toContain('/login')
    expect(link.attributes('href')).toContain('redirect')
  })

  it('登录失效时不显示任何设置内容（避免拿旧数据让人以为还有权限）', async () => {
    fetchAdminAiSettings.mockRejectedValue(
      new V3ApiError(
        { code: 'UNAUTHENTICATED', message: '请先登录。', requestId: 'rq-401', details: {} },
        { status: 401 },
      ),
    )
    const { wrapper } = await mountAdmin()

    expect(wrapper.find('[data-admin-summary]').exists()).toBe(false)
    expect(wrapper.find('[data-admin-save]').exists()).toBe(false)
  })

  it('有权限：显示当前状态，且页面文本里不出现密钥的任何形态', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    const { wrapper } = await mountAdmin()

    expect(wrapper.find('[data-admin-enabled]').text()).toBe('已开启')
    expect(wrapper.find('[data-admin-base-host]').text()).toBe('api.example.com')
    expect(wrapper.find('[data-admin-key-state]').text()).toBe('部署环境变量')
    expect(wrapper.find('[data-admin-key-fingerprint]').text()).toBe('abcdef12')

    // 只写不读：key 输入框必须是空的，且页面上不存在任何密钥值。
    const keyInput = wrapper.find('[data-admin-key-input]').element as HTMLInputElement
    expect(keyInput.value).toBe('')
    expect(wrapper.text()).not.toContain('sk-')
  })

  it('来源未记录时如实说未知，不猜是环境变量还是后台设置', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings({ apiKeySource: null, apiKeyFingerprint: null }))
    const { wrapper } = await mountAdmin()

    expect(wrapper.find('[data-admin-key-state]').text()).toBe('已配置（来源未记录）')
  })

  it('没有改动时保存按钮禁用，并说明原因', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    const { wrapper } = await mountAdmin()

    const save = wrapper.find('[data-admin-save]')
    expect((save.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('[data-admin-dirty]').text()).toContain('还没有改动')
  })

  it('只提交改动过的字段（不改的字段根本不进请求体）', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    updateAdminAiSettings.mockResolvedValue(settings({ maxTokens: 2000, mockMode: false }))
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-number="maxTokens"]').setValue('2000')
    await wrapper.find('[data-admin-mock-toggle]').setValue(false)
    await flushPromises()

    // 提示里列出将提交哪些字段，避免"点了保存但不知道改了什么"
    expect(wrapper.find('[data-admin-dirty]').text()).toContain('maxTokens')

    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()

    expect(updateAdminAiSettings).toHaveBeenCalledTimes(1)
    const patch = updateAdminAiSettings.mock.calls[0][0] as Record<string, unknown>
    expect(patch).toEqual({ maxTokens: 2000, mockMode: false })
    // 未改动的字段一个都不能出现
    expect(patch).not.toHaveProperty('model')
    expect(patch).not.toHaveProperty('dailyLimitPerUser')
    expect(patch).not.toHaveProperty('baseUrl')
    expect(patch).not.toHaveProperty('apiKey')
  })

  it('baseUrl 不预填：留空时不进补丁（避免把主机名当完整地址写进去）', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    const { wrapper } = await mountAdmin()

    const baseUrl = wrapper.find('[data-admin-base-url]').element as HTMLInputElement
    expect(baseUrl.value).toBe('')
    expect(baseUrl.placeholder).toContain('api.example.com')

    await wrapper.find('[data-admin-enabled-toggle]').setValue(false)
    await flushPromises()
    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()

    const patch = updateAdminAiSettings.mock.calls[0][0] as Record<string, unknown>
    expect(patch).not.toHaveProperty('baseUrl')
  })

  it('填了新密钥：提交后输入框清空，提示说明只写不读', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    updateAdminAiSettings.mockResolvedValue(settings({ apiKeyFingerprint: '99887766' }))
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-key-input]').setValue('sk-test-0123456789')
    await flushPromises()
    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()

    const patch = updateAdminAiSettings.mock.calls[0][0] as Record<string, unknown>
    expect(patch.apiKey).toBe('sk-test-0123456789')

    // 提交后：输入框必须已经空了，页面上也不留任何痕迹
    expect((wrapper.find('[data-admin-key-input]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).not.toContain('sk-test-0123456789')
    expect(wrapper.find('[data-admin-saved]').text()).toContain('只写不读')
  })

  it('勾选「清除密钥」：提交的是空串（明确清除），不是"不改动"', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    updateAdminAiSettings.mockResolvedValue(settings({ apiKeyConfigured: false, apiKeyFingerprint: null }))
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-clear-key]').setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-admin-clear-warning]').exists()).toBe(true)

    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()

    const patch = updateAdminAiSettings.mock.calls[0][0] as Record<string, unknown>
    expect(patch).toHaveProperty('apiKey')
    expect(patch.apiKey).toBe('')
  })

  it('数值非法：保存按钮禁用并逐字段说明，不把坏值发出去', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-number="dailyLimitPerUser"]').setValue('0')
    await flushPromises()

    expect(wrapper.text()).toContain('要填正整数')
    expect((wrapper.find('[data-admin-save]').element as HTMLButtonElement).disabled).toBe(true)
    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()
    expect(updateAdminAiSettings).not.toHaveBeenCalled()
  })

  it('baseUrl 缺协议：拦住并说明要完整地址', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-base-url]').setValue('api.example.com')
    await flushPromises()

    expect(wrapper.text()).toContain('以 http:// 或 https:// 开头')
    expect((wrapper.find('[data-admin-save]').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('保存失败：显示错误与报障编号，且不假装成功', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    updateAdminAiSettings.mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountAdmin()

    await wrapper.find('[data-admin-enabled-toggle]').setValue(false)
    await flushPromises()
    await wrapper.find('[data-admin-save]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-admin-save-error]').exists()).toBe(true)
    expect(wrapper.find('[data-admin-saved]').exists()).toBe(false)
  })

  it('用户概览是只读的：没有改角色/禁用入口，报告数未知不显示成 0', async () => {
    fetchAdminAiSettings.mockResolvedValue(settings())
    fetchAdminUsers.mockResolvedValue({
      items: [
        { id: 'u1', username: 'one', nickname: null, role: 'ADMIN', status: 'ACTIVE', createdAt: '2026-09-17T08:00:00Z', reportCount: 2 },
        { id: 'u2', username: 'two', nickname: '小二', role: 'USER', status: 'DISABLED', createdAt: null, reportCount: null },
      ],
      page: 0,
      size: 20,
      total: 2,
    })
    const { wrapper } = await mountAdmin()

    const table = wrapper.find('[data-admin-users]')
    expect(table.exists()).toBe(true)
    expect(table.text()).toContain('one')
    expect(table.text()).toContain('ADMIN')
    expect(table.text()).toContain('DISABLED')
    // null 报告数显示"未知"，不能是 0
    expect(wrapper.find('[data-admin-user="two"]').text()).toContain('未知')

    // 只读：页面里没有提交角色/禁用的控件
    expect(wrapper.find('[data-admin-users] button').exists()).toBe(false)
    expect(wrapper.text()).toContain('不提供')
  })
})
