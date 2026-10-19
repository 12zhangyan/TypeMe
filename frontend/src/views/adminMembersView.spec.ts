// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminMembersView from './AdminMembersView.vue'
import type { Member } from '@/api/adminMembers'
import type { MyAttemptRow, MyReportRow } from '@/api/platformV3'

vi.mock('@/api/adminMembers', () => ({
  members: vi.fn(),
  invitations: vi.fn(),
  attempts: vi.fn(),
  reports: vi.fn(),
  report: vi.fn(),
}))

import * as api from '@/api/adminMembers'

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

afterEach(() => {
  vi.clearAllMocks()
})

describe('管理档案里的状态说法', () => {
  it('大五未完成不叫主测，并列结果和报告页用同一句话', async () => {
    vi.mocked(api.members).mockResolvedValue({ items: [member], page: 0, size: 20, total: 1 })
    vi.mocked(api.invitations).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
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
    vi.mocked(api.invitations).mockResolvedValue({ items: [], page: 0, size: 10, total: 0 })
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
