// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BigFiveCompareView from './BigFiveCompareView.vue'
import type { MyReportRow, ReportDetailView } from '@/api/platformV3'

const { fetchMyReports, fetchPlatformReport, parseBigFiveReport } = vi.hoisted(() => ({
  fetchMyReports: vi.fn(), fetchPlatformReport: vi.fn(), parseBigFiveReport: vi.fn(),
}))
vi.mock('@/api/platformV3', () => ({ fetchMyReports, fetchPlatformReport, parseBigFiveReport }))

const row = (reportId: string): MyReportRow => ({ reportId, attemptId: reportId, instrumentSlug: 'bigfive50',
  instrumentKind: 'big_five', instrumentTitle: '大五', reportKind: 'big_five_profile', packageId: 'v1',
  status: 'PROFILE', computedTypeCode: null, summaryLine: '本次作答', createdAt: '2026-09-23T10:00:00Z' })
const detail = (reportId: string, version = 'v1'): ReportDetailView => ({ ...row(reportId),
  report: { instrument: { scoringVersion: version }, report: { id: reportId } },
  selfReflection: {}, attemptRevision: 1 })

async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/reports/compare/big-five', component: BigFiveCompareView },
    { path: '/reports', component: { template: '<div />' } },
    { path: '/reports/big-five/:reportId', component: { template: '<div />' } },
  ] })
  await router.push('/reports/compare/big-five?a=first&b=second')
  await router.isReady()
  const wrapper = mount(BigFiveCompareView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('大五复测比较', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMyReports.mockResolvedValue({ items: [row('first'), row('second')], page: 0, size: 50, total: 2 })
    fetchPlatformReport.mockImplementation(async (id: string) => detail(id))
    parseBigFiveReport.mockImplementation((snapshot: { report: { id: string } }) => ({
      dimensions: [
        { dimension: 'O', name: '开放性', hasResult: true, rawScore: snapshot.report.id === 'first' ? 28 : 31 },
        { dimension: 'ES', name: '情绪稳定性', hasResult: snapshot.report.id === 'first', rawScore: snapshot.report.id === 'first' ? 30 : null },
      ],
    }))
  })

  it('同版本只比较有结果的维度，信息不足不算差值', async () => {
    const wrapper = await render()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-big-five-comparison]').text()).toContain('+3')
    expect(wrapper.get('[data-big-five-comparison]').text()).toContain('信息不足')
    expect(wrapper.get('[data-big-five-comparison]').text()).toContain('不计算')
  })

  it('计分版本不同即使原始分都存在也不提供差值', async () => {
    fetchPlatformReport.mockImplementation(async (id: string) => detail(id, id === 'first' ? 'v1' : 'v2'))
    const wrapper = await render()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-big-five-comparison]').text()).toContain('不计算分数差值')
    expect(wrapper.get('[data-big-five-comparison]').findAll('table')).toHaveLength(0)
  })

  it('同一时刻且摘要相同的报告仍可在两个选择框中区分', async () => {
    const wrapper = await render()
    const labels = wrapper.findAll('select').at(0)!.findAll('option').slice(1).map((option) => option.text())
    expect(new Set(labels).size).toBe(2)
    expect(labels.every((label) => label.includes('2026 年'))).toBe(true)
  })

  it('列表第二页失败时不展示部分结果，重试后能选到末页报告', async () => {
    fetchMyReports.mockImplementation(async (page: number) => {
      if (page === 1) throw new Error('网络故障')
      return { items: Array.from({ length: 50 }, (_, i) => row(`r${i}`)), page, size: 50, total: 51 }
    })
    const wrapper = await render()
    expect(wrapper.find('[role="alert"]').text()).toContain('请检查网络后重试')
    expect(wrapper.findAll('select')).toHaveLength(0)
    fetchMyReports.mockImplementation(async (page: number) => ({
      items: page === 0 ? Array.from({ length: 50 }, (_, i) => row(`r${i}`)) : [row('last')],
      page, size: 50, total: 51,
    }))
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('select')[0]!.findAll('option').some((option) => option.attributes('value') === 'last')).toBe(true)
  })

})
