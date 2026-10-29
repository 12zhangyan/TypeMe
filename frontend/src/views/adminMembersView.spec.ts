// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminMembersView from './AdminMembersView.vue'
import type { Member } from '@/api/adminMembers'
import type { MyAttemptRow, MyReportRow } from '@/api/platformV3'

vi.mock('@/api/adminMembers', () => ({
  members: vi.fn(),
  attempts: vi.fn(),
  reports: vi.fn(),
  report: vi.fn(),
  setDailyLimit: vi.fn(),
  setDailyLimits: vi.fn(),
  resetDailyLimits: vi.fn(),
}))

import * as api from '@/api/adminMembers'
import { V3ApiError } from '@/api/v3'

const member: Member = {
  id: 'user-1',
  username: 'ada',
  nickname: '艾达',
  role: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-10-01T00:00:00Z',
  lastSeenAt: null,
  reportCount: 1,
  attemptCount: 2,
  aiDailyLimit: null,
  effectiveAiDailyLimit: 3,
  aiUsedToday: 0,
  aiRemainingToday: 3,
  quotaDate: '2026-10-14',
}

const bigFiveDraft: MyAttemptRow = {
  attemptId: 'attempt-bf',
  instrumentSlug: 'bigfive50',
  instrumentKind: 'big_five',
  instrumentTitle: '大五人格倾向测评',
  packageId: 'typeme-bigfive50-zh-v1',
  reportContentVersion: null,
  status: 'BASE_IN_PROGRESS',
  revision: 2,
  startedAt: '2026-10-14T01:00:00Z',
  updatedAt: '2026-10-14T01:10:00Z',
  submittedAt: null,
  reportId: null,
  reportStatus: null,
  computedTypeCode: null,
  answeredCount: 3,
  requiredCount: 50,
}

const tiedReport: MyReportRow = {
  reportId: 'report-tied',
  attemptId: 'attempt-jung',
  instrumentSlug: 'jung48',
  instrumentKind: 'jung',
  instrumentTitle: '十六型人格参考测评',
  reportKind: 'jung_reference',
  packageId: 'typeme-jung48-zh-v4',
  status: 'TIED',
  computedTypeCode: null,
  summaryLine: '四个维度都接近',
  createdAt: '2026-10-14T02:00:00Z',
}

// jsdom 没有布局也没实现 scrollBy：页面出错时的“滚到提示处”在真实浏览器脚本里验收，这里只消掉噪声。
beforeEach(() => {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('管理档案里的状态说法', () => {
  it('大五未完成不叫主测，并列结果和报告页用同一句话', async () => {
    vi.mocked(api.members).mockResolvedValue({ items: [member], page: 0, size: 20, total: 1 })
    vi.mocked(api.attempts).mockResolvedValue({ items: [bigFiveDraft], page: 0, size: 10, total: 1 })
    vi.mocked(api.reports).mockResolvedValue({ items: [tiedReport], page: 0, size: 10, total: 1 })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: AdminMembersView }, { path: '/admin', component: { template: '<div />' } }],
    })
    const wrapper = mount(AdminMembersView, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()

    const progress = wrapper.text()
    expect(progress).toContain('大五人格倾向测评')
    expect(progress).toContain('答题中')
    expect(progress).not.toContain('主测答题中')
    expect(progress).toContain('几个方向并列')
    expect(progress).not.toContain('两边接近')
  })

  it('补充题进行中不把主测题数写成整份已答完', async () => {
    const clarifying: MyAttemptRow = {
      ...bigFiveDraft,
      attemptId: 'attempt-clar',
      instrumentSlug: 'jung48',
      instrumentKind: 'jung',
      instrumentTitle: '十六型人格参考测评',
      status: 'CLARIFICATION_IN_PROGRESS',
      answeredCount: 48,
      requiredCount: 48,
    }
    vi.mocked(api.members).mockResolvedValue({ items: [member], page: 0, size: 20, total: 1 })
    vi.mocked(api.attempts).mockResolvedValue({ items: [clarifying], page: 0, size: 10, total: 1 })
    vi.mocked(api.reports).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: AdminMembersView }, { path: '/admin', component: { template: '<div />' } }],
    })
    const wrapper = mount(AdminMembersView, { global: { plugins: [router] } })
    await flushPromises()
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('补充答题中')
    expect(text).toContain('主测 48 / 48')
    expect(text).not.toContain('已答 48 / 48 题')
  })
})

describe('成员页错误提示', () => {
  async function mountPage() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: AdminMembersView },
        { path: '/admin', component: { template: '<div />' } },
        { path: '/login', component: { template: '<div />' } },
        { path: '/account', component: { template: '<div />' } },
      ],
    })
    const wrapper = mount(AdminMembersView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('页面不再有邀请码入口', async () => {
    vi.mocked(api.members).mockResolvedValue({ items: [member], page: 0, size: 20, total: 1 })
    const wrapper = await mountPage()
    expect(wrapper.text()).not.toContain('邀请')
    expect(wrapper.find('.invite-form').exists()).toBe(false)
  })

  it('保存额度遇到 409：显示服务端原话与报障编号，不建议重新登录', async () => {
    vi.mocked(api.members).mockResolvedValue({ items: [member], page: 0, size: 20, total: 1 })
    vi.mocked(api.attempts).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.reports).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.setDailyLimit).mockRejectedValue(new V3ApiError(
      { code: 'CONFLICT', message: '额度已被其他管理员修改，请刷新后再试。', requestId: 'req-409', details: {} },
      { status: 409 },
    ))
    const wrapper = await mountPage()
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()
    await wrapper.get('form.quota-form').trigger('submit')
    await flushPromises()

    const notice = wrapper.get('[data-admin-error]')
    expect(notice.text()).toContain('额度已被其他管理员修改')
    expect(notice.text()).toContain('req-409')
    expect(notice.text()).not.toContain('重新登录')
  })

  it('没有管理员权限（403）时仍给出重新登录入口', async () => {
    vi.mocked(api.members).mockRejectedValue(new V3ApiError(
      { code: 'FORBIDDEN', message: '没有权限', requestId: null, details: {} },
      { status: 403 },
    ))
    const wrapper = await mountPage()

    expect(wrapper.get('[data-admin-error]').text()).toContain('重新登录')
    expect(wrapper.text()).toContain('此页面仅对管理员开放')
  })
})

describe('只看今日额度已用完', () => {
  const exhausted: Member = { ...member, id: 'user-2', username: 'bob', nickname: null, aiUsedToday: 3, aiRemainingToday: 0 }

  async function mountPage() {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: AdminMembersView }] })
    const wrapper = mount(AdminMembersView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('打开开关按筛选重新读第一页，计数与翻页都带上条件；关掉恢复全部成员', async () => {
    vi.mocked(api.members).mockImplementation(async (page = 0, aiExhausted = false) => aiExhausted
      ? { items: [exhausted], page, size: 20, total: 21 }
      : { items: [member, exhausted], page, size: 20, total: 2 })
    const wrapper = await mountPage()
    expect(vi.mocked(api.members)).toHaveBeenLastCalledWith(0, false)

    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()
    expect(vi.mocked(api.members)).toHaveBeenLastCalledWith(0, true)
    expect(wrapper.text()).toContain('21 位今日额度已用完')
    expect(wrapper.findAll('button.member-card')).toHaveLength(1)

    await wrapper.get('nav[aria-label="成员翻页"] button:last-child').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.members)).toHaveBeenLastCalledWith(1, true)

    await wrapper.get('[data-exhausted-filter]').setValue(false)
    await flushPromises()
    expect(vi.mocked(api.members)).toHaveBeenLastCalledWith(0, false)
    expect(wrapper.text()).toContain('2 位成员')
  })

  it('筛选结果返回前，计数不把未筛选的总数说成“今日额度已用完”', async () => {
    let resolveFiltered: (value: Awaited<ReturnType<typeof api.members>>) => void = () => {}
    vi.mocked(api.members).mockImplementation((page = 0, aiExhausted = false) => aiExhausted
      ? new Promise(resolve => { resolveFiltered = resolve })
      : Promise.resolve({ items: [member, exhausted], page, size: 20, total: 24 }))
    const wrapper = await mountPage()

    await wrapper.get('[data-exhausted-filter]').setValue(true)
    expect(wrapper.text()).toContain('24 位成员')
    expect(wrapper.text()).not.toContain('位今日额度已用完')

    resolveFiltered({ items: [exhausted], page: 0, size: 20, total: 11 })
    await flushPromises()
    expect(wrapper.text()).toContain('11 位今日额度已用完')
  })

  it('没有人用完时显示专门的空态，而不是“暂无成员”', async () => {
    vi.mocked(api.members).mockImplementation(async (page = 0, aiExhausted = false) => aiExhausted
      ? { items: [], page, size: 20, total: 0 }
      : { items: [member], page, size: 20, total: 1 })
    const wrapper = await mountPage()

    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()

    expect(wrapper.text()).toContain('没有今天额度已用完的成员。')
    expect(wrapper.text()).not.toContain('暂无成员')
  })

  it('筛选请求失败：开关回到关闭，列表仍是原来的全部成员，失败原因可见', async () => {
    vi.mocked(api.members).mockImplementation(async (_page = 0, aiExhausted = false) => {
      if (aiExhausted) throw new V3ApiError({ code: 'INTERNAL', message: '服务暂时不可用', requestId: 'req-500', details: {} }, { status: 500 })
      return { items: [member], page: 0, size: 20, total: 1 }
    })
    const wrapper = await mountPage()

    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()

    expect((wrapper.get('[data-exhausted-filter]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('1 位成员')
    expect(wrapper.get('[data-admin-error]').text()).toContain('req-500')
  })

  it('筛选状态下改额度后重载当前页，已不符合条件的成员离开列表', async () => {
    let raised = false
    vi.mocked(api.members).mockImplementation(async (page = 0, aiExhausted = false) => aiExhausted
      ? { items: raised ? [] : [exhausted], page, size: 20, total: raised ? 0 : 1 }
      : { items: [member, exhausted], page, size: 20, total: 2 })
    vi.mocked(api.attempts).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.reports).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.setDailyLimit).mockImplementation(async (id, aiDailyLimit) => {
      raised = true
      return { ...exhausted, id, aiDailyLimit, effectiveAiDailyLimit: aiDailyLimit, aiRemainingToday: aiDailyLimit - 3 }
    })
    const wrapper = await mountPage()
    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()

    await wrapper.get('form.quota-form input').setValue(10)
    await wrapper.get('form.quota-form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(api.members)).toHaveBeenLastCalledWith(0, true)
    expect(wrapper.findAll('button.member-card')).toHaveLength(0)
    expect(wrapper.text()).toContain('每日额度已保存')
  })

  it('MI-1：筛选状态下改单人额度后，离开列表的成员不再留在批量勾选里', async () => {
    let raised = false
    vi.mocked(api.members).mockImplementation(async (page = 0, aiExhausted = false) => aiExhausted
      ? { items: raised ? [] : [exhausted], page, size: 20, total: raised ? 0 : 1 }
      : { items: [member, exhausted], page, size: 20, total: 2 })
    vi.mocked(api.attempts).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.reports).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.setDailyLimit).mockImplementation(async (id, aiDailyLimit) => {
      raised = true
      return { ...exhausted, id, aiDailyLimit, effectiveAiDailyLimit: aiDailyLimit, aiRemainingToday: aiDailyLimit - 3 }
    })
    const wrapper = await mountPage()
    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()
    await wrapper.get('[data-member-pick]').setValue(true)
    expect(wrapper.get('[data-batch-bar]').text()).toContain('已选 1 位')
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()

    await wrapper.get('form.quota-form input').setValue(10)
    await wrapper.get('form.quota-form').trigger('submit')
    await flushPromises()

    expect(wrapper.findAll('button.member-card')).toHaveLength(0)
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)
  })

  it('MI-2：单人额度已保存但随后刷新列表失败时，仍说明已保存，并提示列表可能不是最新', async () => {
    let saved = false
    vi.mocked(api.members).mockImplementation(async (page = 0, aiExhausted = false) => {
      if (aiExhausted && saved) throw new V3ApiError({ code: 'SERVICE_UNAVAILABLE', message: '暂时无法读取', requestId: 'req-503', details: {} }, { status: 503 })
      return { items: [exhausted], page, size: 20, total: 1 }
    })
    vi.mocked(api.attempts).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.reports).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
    vi.mocked(api.setDailyLimit).mockImplementation(async (id, aiDailyLimit) => {
      saved = true
      return { ...exhausted, id, aiDailyLimit, effectiveAiDailyLimit: aiDailyLimit, aiRemainingToday: aiDailyLimit - 3 }
    })
    const wrapper = await mountPage()
    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()
    await wrapper.get('button.member-card').trigger('click')
    await flushPromises()

    await wrapper.get('form.quota-form input').setValue(10)
    await wrapper.get('form.quota-form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('每日额度已保存')
    expect(wrapper.text()).toContain('刷新成员列表失败')
    expect(wrapper.get('[data-admin-error]').text()).toContain('req-503')
  })
})

describe('批量修改每日额度', () => {
  const other: Member = { ...member, id: 'user-2', username: 'bob', nickname: null, aiUsedToday: 3, aiRemainingToday: 0 }

  async function mountPage(total = 2) {
    vi.mocked(api.members).mockImplementation(async (page = 0) => ({ items: [member, other], page, size: 20, total }))
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: AdminMembersView }] })
    const wrapper = mount(AdminMembersView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  it('全选本页 → 输入额度 → 先确认再提交，提交一次、成功后重读列表并清空勾选', async () => {
    vi.mocked(api.setDailyLimits).mockResolvedValue({ updated: 2, failed: 0, results: [
      { userId: 'user-1', ok: true, member: { ...member, aiDailyLimit: 5, effectiveAiDailyLimit: 5 } },
      { userId: 'user-2', ok: true, member: { ...other, aiDailyLimit: 5, effectiveAiDailyLimit: 5 } },
    ] })
    const wrapper = await mountPage()
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)

    await wrapper.get('[data-pick-all]').setValue(true)
    expect(wrapper.get('[data-batch-bar]').text()).toContain('已选 2 位')

    await wrapper.get('[data-batch-bar] input[type="number"]').setValue(5)
    await wrapper.get('[data-batch-bar]').trigger('submit')
    expect(vi.mocked(api.setDailyLimits)).not.toHaveBeenCalled()
    expect(wrapper.get('[data-batch-confirm]').text()).toContain('将修改 2 位成员的每日额度为 5')

    const confirm = wrapper.get('[data-batch-confirm] button.btn-primary')
    await confirm.trigger('click')
    await confirm.trigger('click')
    await flushPromises()

    expect(vi.mocked(api.setDailyLimits)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.setDailyLimits)).toHaveBeenCalledWith(['user-1', 'user-2'], 5)
    expect(vi.mocked(api.members)).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('已将 2 位成员的每日额度设为 5')
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)
  })

  it('额度为空、小数或越界时提示且不进入确认、不调用接口', async () => {
    const wrapper = await mountPage()
    await wrapper.findAll('[data-member-pick]')[0]!.setValue(true)

    for (const value of ['', '1.5', '10001']) {
      await wrapper.get('[data-batch-bar] input[type="number"]').setValue(value)
      await wrapper.get('[data-batch-bar]').trigger('submit')
      expect(wrapper.text()).toContain('每日额度请输入 0–10000 的整数')
      expect(wrapper.find('[data-batch-confirm]').exists()).toBe(false)
    }
    expect(vi.mocked(api.setDailyLimits)).not.toHaveBeenCalled()
  })

  it('部分失败：说明保存了几位、列出未保存的成员与原因，不显示全部成功', async () => {
    vi.mocked(api.setDailyLimits).mockResolvedValue({ updated: 1, failed: 1, results: [
      { userId: 'user-1', ok: true, member: { ...member, aiDailyLimit: 4, effectiveAiDailyLimit: 4 } },
      { userId: 'user-2', ok: false, code: 'NOT_FOUND', message: '成员不存在或已删除。' },
    ] })
    const wrapper = await mountPage()
    await wrapper.get('[data-pick-all]').setValue(true)
    await wrapper.get('[data-batch-bar] input[type="number"]').setValue(4)
    await wrapper.get('[data-batch-bar]').trigger('submit')
    await wrapper.get('[data-batch-confirm] button.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已保存 1 位成员，1 位未保存')
    expect(wrapper.text()).not.toContain('已将')
    expect(wrapper.get('[data-batch-failures]').text()).toContain('bob：成员不存在或已删除。')
    // 失败者仍在当前页：保持勾选，方便重试。
    expect(wrapper.get('[data-batch-bar]').text()).toContain('已选 1 位')
  })

  it('MI-2：批量已写入但刷新列表失败时，保留部分成功的提示和失败名单，并说明列表可能不是最新', async () => {
    vi.mocked(api.setDailyLimits).mockResolvedValue({ updated: 1, failed: 1, results: [
      { userId: 'user-1', ok: true, member: { ...member, aiDailyLimit: 4, effectiveAiDailyLimit: 4 } },
      { userId: 'user-2', ok: false, code: 'NOT_FOUND', message: '成员不存在或已删除。' },
    ] })
    const wrapper = await mountPage()
    vi.mocked(api.members).mockRejectedValueOnce(new V3ApiError(
      { code: 'SERVICE_UNAVAILABLE', message: '暂时无法读取', requestId: 'req-503', details: {} }, { status: 503 }))
    await wrapper.get('[data-pick-all]').setValue(true)
    await wrapper.get('[data-batch-bar] input[type="number"]').setValue(4)
    await wrapper.get('[data-batch-bar]').trigger('submit')
    await wrapper.get('[data-batch-confirm] button.btn-primary').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已保存 1 位成员，1 位未保存')
    expect(wrapper.text()).toContain('刷新成员列表失败')
    expect(wrapper.get('[data-batch-failures]').text()).toContain('bob：成员不存在或已删除。')
    expect(wrapper.get('[data-admin-error]').text()).toContain('req-503')
  })

  it('恢复系统默认：不需要填额度，确认文案说明会清除单独额度，提交走恢复接口', async () => {
    vi.mocked(api.resetDailyLimits).mockResolvedValue({ updated: 2, failed: 0, results: [
      { userId: 'user-1', ok: true, member: { ...member, aiDailyLimit: null } },
      { userId: 'user-2', ok: true, member: { ...other, aiDailyLimit: null } },
    ] })
    const wrapper = await mountPage()
    await wrapper.get('[data-pick-all]').setValue(true)

    await wrapper.get('[data-batch-reset]').trigger('click')
    expect(wrapper.text()).not.toContain('每日额度请输入')
    const confirmText = wrapper.get('[data-batch-confirm]').text()
    expect(confirmText).toContain('将 2 位成员恢复为沿用系统默认额度')
    expect(confirmText).toContain('原来单独设定的额度会被清除')
    expect(vi.mocked(api.resetDailyLimits)).not.toHaveBeenCalled()

    await wrapper.get('[data-batch-confirm] button.btn-primary').trigger('click')
    await flushPromises()

    expect(vi.mocked(api.resetDailyLimits)).toHaveBeenCalledWith(['user-1', 'user-2'])
    expect(vi.mocked(api.setDailyLimits)).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已将 2 位成员恢复为沿用系统默认额度')
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)
  })

  it('换页或切换筛选时清空勾选', async () => {
    const wrapper = await mountPage(30)
    await wrapper.get('[data-pick-all]').setValue(true)
    await wrapper.get('nav[aria-label="成员翻页"] button:last-child').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)

    await wrapper.findAll('[data-member-pick]')[0]!.setValue(true)
    await wrapper.get('[data-exhausted-filter]').setValue(true)
    await flushPromises()
    expect(wrapper.find('[data-batch-bar]').exists()).toBe(false)
  })
})
