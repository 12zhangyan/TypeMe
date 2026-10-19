// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { V3ApiError } from '@/api/v3'
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

  it('第一次读取被会话确认打断后重读，不把比较页停在失败上', async () => {
    fetchMyReports.mockReset()
    fetchMyReports
      .mockRejectedValueOnce(new V3ApiError(
        { code: 'SESSION_CHANGED', message: '登录状态已改变，请在当前账号下重新操作。', requestId: null, details: {} },
        { status: 0 },
      ))
      .mockResolvedValue({ items: [row('first'), row('second')], page: 0, size: 50, total: 2 })
    const wrapper = await render()
    expect(wrapper.text()).not.toContain('登录状态已改变')
    expect(wrapper.findAll('select')).toHaveLength(2)
    expect(fetchMyReports).toHaveBeenCalledTimes(2)
  })

  it('比较请求被会话确认打断后重读，仍显示差值', async () => {
    fetchPlatformReport.mockReset()
    fetchPlatformReport
      .mockRejectedValueOnce(new V3ApiError(
        { code: 'SESSION_CHANGED', message: '登录状态已改变，请在当前账号下重新操作。', requestId: null, details: {} },
        { status: 0 },
      ))
      .mockImplementation(async (id: string) => detail(id))
    const wrapper = await render()
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).not.toContain('登录状态已改变')
    expect(wrapper.get('[data-big-five-comparison]').text()).toContain('+3')
    expect(fetchPlatformReport.mock.calls.length).toBeGreaterThanOrEqual(3)
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

  it('两栏按看的顺序称呼，不写成第一次和第二次', async () => {
    const wrapper = await render()
    const text = wrapper.text()
    expect(text).toContain('先看的那份')
    expect(text).toContain('再看的那份')
    expect(text).not.toContain('第一次')
    expect(text).not.toContain('第二次')
    await wrapper.get('button.btn-primary').trigger('click')
    await flushPromises()
    const compared = wrapper.get('[data-big-five-comparison]').text()
    expect(compared).toContain('再看的那份自报的原始分更高')
    expect(compared).not.toContain('第一次')
    expect(compared).not.toContain('第二次')
  })

  it('较新的报告排在前面时，不把它写成第 1 份', async () => {
    // 页面按**读者本地时区**显示时间；这里用 UTC 正午，避免在 UTC-11…UTC+11 的机器上
    // 被推到相邻月份，让断言依赖跑测试的机器时区。
    const newer = { ...row('newer'), createdAt: '2026-10-14T12:00:00Z', summaryLine: '最近一次' }
    const older = { ...row('older'), createdAt: '2026-09-01T12:00:00Z', summaryLine: '早先一次' }
    fetchMyReports.mockResolvedValue({ items: [newer, older], page: 0, size: 50, total: 2 })
    const wrapper = await render()
    const labels = wrapper.findAll('select').at(0)!.findAll('option').slice(1).map((option) => option.text())
    expect(labels[0]).toContain('2026 年 10 月')
    expect(labels[0]).not.toContain('第 1 份')
    expect(labels[1]).toContain('2026 年 9 月')
    expect(labels.join('\n')).not.toContain('第 1 份')
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
