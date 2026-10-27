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
