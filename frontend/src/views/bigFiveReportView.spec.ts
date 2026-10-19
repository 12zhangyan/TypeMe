// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { V3ApiError } from '@/api/v3'
import BigFiveReportView from './BigFiveReportView.vue'
import { fetchPlatformReport } from '@/api/platformV3'

vi.mock('@/api/platformV3', async () => {
  const actual = await vi.importActual<typeof import('@/api/platformV3')>('@/api/platformV3')
  return { ...actual, fetchPlatformReport: vi.fn() }
})

const report = {
  schemaVersion: 2,
  reportId: 'r1',
  attemptId: 'a1',
  createdAt: '2026-09-18T10:10:00Z',
  status: 'PROFILE',
  profileTitle: '大五人格倾向测评',
  hasTypeCode: false,
  summary: '这次外向性的方向比较清楚。',
  dimensions: [{
    dimension: 'E',
    name: '外向性',
    question: '你在人群里是充上电还是耗电？',
    rawScore: 34,
    rangeLow: 10,
    rangeHigh: 50,
    midpoint: 30,
    distance: 4,
    hasResult: true,
    validCount: 10,
    unknownCount: 0,
    unprocessedCount: 0,
    direction: 'high',
    level: 'MARKED_HIGH',
    levelLabel: '比较明显',
    sideLabel: '偏外向',
    description: '你更常从和人打交道里获得精力。',
    dailySigns: ['聚会结束后还愿意再聊一会儿'],
    reading: '本次外向性的分数是 34，比中间值高 4 分。',
    observation: '留意你在聚会前后的精力变化。',
    caution: '这只是本次作答的结果。',
  }],
  coverage: {
    completed: true,
    coverageOk: true,
    unknownCount: 0,
    unprocessedCount: 0,
    incompleteDimensions: [],
  },
  readingOrder: [{ step: '先看方向比较明显的方面', why: '这些读起来最像你。' }],
  limitations: ['这份结果只来自这一次作答。'],
}

const detail = {
  reportId: 'r1',
  attemptId: 'a1',
  instrumentSlug: 'bigfive50',
  instrumentKind: 'big_five',
  instrumentTitle: '大五人格倾向测评',
  reportKind: 'big_five_profile',
  packageId: 'typeme-bigfive50-zh-v1',
  createdAt: '2026-09-18T10:10:00Z',
  status: 'PROFILE',
  computedTypeCode: null,
  summaryLine: report.summary,
  report,
  selfReflection: null,
  attemptRevision: 4,
}

async function mountReport() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports/big-five/:reportId', name: 'big-five-report', component: BigFiveReportView },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<p>十六型报告</p>' } },
      { path: '/reports', name: 'reports', component: { template: '<p>列表</p>' } },
      { path: '/instruments', name: 'instruments', component: { template: '<p>目录</p>' } },
      { path: '/about', name: 'about', component: { template: '<p>说明</p>' } },
    ],
  })
  await router.push('/reports/big-five/r1')
  await router.isReady()
  const wrapper = mount(BigFiveReportView, {
    global: {
      plugins: [router],
      stubs: { AiAnalysisPanel: true, InstrumentArtwork: true },
    },
  })
  await flushPromises()
  return wrapper
}

describe('大五报告页', () => {
  beforeEach(() => {
    vi.mocked(fetchPlatformReport).mockReset()
  })

  it('第一次读取被会话确认打断后重读，不把报告停在失败上', async () => {
    vi.mocked(fetchPlatformReport)
      .mockRejectedValueOnce(new V3ApiError(
        { code: 'SESSION_CHANGED', message: '登录状态已改变，请在当前账号下重新操作。', requestId: null, details: {} },
        { status: 0 },
      ))
      .mockResolvedValueOnce(detail as never)
    const wrapper = await mountReport()
    expect(wrapper.find('[data-bigfive-report-error]').exists()).toBe(false)
    expect(wrapper.text()).toContain('外向性')
    expect(fetchPlatformReport).toHaveBeenCalledTimes(2)
  })
})
