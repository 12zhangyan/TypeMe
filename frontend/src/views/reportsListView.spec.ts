// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReportsListView from './ReportsListView.vue'
import { fetchMyReports, type MyReportRow } from '@/api/platformV3'
import { deleteReport } from '@/api/v3Assessment'

vi.mock('@/api/platformV3', () => ({ fetchMyReports: vi.fn() }))
vi.mock('@/api/v3Assessment', () => ({ deleteReport: vi.fn() }))

function row(index: number, kind: MyReportRow['reportKind'] = 'jung_reference'): MyReportRow {
  return {
    reportId: `report-${index}`, attemptId: `attempt-${index}`,
    instrumentSlug: kind === 'jung_reference' ? 'jung48' : 'bigfive50',
    instrumentKind: kind === 'jung_reference' ? 'jung' : 'big_five',
    instrumentTitle: kind === 'jung_reference' ? '十六型人格参考测评' : '大五人格倾向测评',
    reportKind: kind, packageId: 'bound-v1', status: kind === 'jung_reference' ? 'REFERENCE' : 'PROFILE',
    computedTypeCode: kind === 'jung_reference' ? 'ENFP' : null, summaryLine: '本次参考报告',
    createdAt: new Date(Date.UTC(2026, 8, 23, 0, index)).toISOString(),
  }
}

async function mountList() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reports', component: ReportsListView },
      { path: '/instruments', component: { template: '<p>目录</p>' } },
      { path: '/reports/compare', component: { template: '<p>比较</p>' } },
      { path: '/reports/big-five/:id', component: { template: '<p>大五详情</p>' } },
      { path: '/reports/:id', component: { template: '<p>详情</p>' } },
    ],
  })
  await router.push('/reports')
  await router.isReady()
  const wrapper = mount(ReportsListView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(deleteReport).mockResolvedValue(undefined)
})

describe('历史报告分页', () => {
  it('51 份报告可到第三页，总数与本页种类计数不混用', async () => {
    const all = Array.from({ length: 51 }, (_, index) => row(index, index % 2 ? 'big_five_profile' : 'jung_reference'))
    vi.mocked(fetchMyReports).mockImplementation(async (page = 0, size = 20) => ({
      items: all.slice(page * size, (page + 1) * size), page, size, total: all.length,
    }))
    const wrapper = await mountList()
    expect(wrapper.find('[data-report-counts]').text()).toContain('共 51 份')
    await wrapper.findAll('[data-report-pagination] button')[1]!.trigger('click')
    await flushPromises()
    await wrapper.findAll('[data-report-pagination] button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(11)
    expect(wrapper.find('[data-report-pagination]').text()).toContain('第 3 / 3 页')
    expect(wrapper.find('[data-report-counts]').text()).toContain('本页 11 份')
    expect(fetchMyReports).toHaveBeenLastCalledWith(2, 20, undefined)
  })

  it('切换筛选隔离旧响应', async () => {
    let finishOld!: (value: { items: MyReportRow[]; page: number; size: number; total: number }) => void
    vi.mocked(fetchMyReports).mockResolvedValueOnce({ items: [row(0)], page: 0, size: 20, total: 41 })
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
      .mockResolvedValueOnce({ items: [row(40, 'big_five_profile')], page: 0, size: 20, total: 1 })
    const wrapper = await mountList()
    await wrapper.findAll('[data-report-filters] button')[1]!.trigger('click')
    await wrapper.findAll('[data-report-filters] button')[2]!.trigger('click')
    await flushPromises()
    finishOld({ items: [row(99)], page: 0, size: 20, total: 99 })
    await flushPromises()
    expect(wrapper.find('[data-report-counts]').text()).toContain('共 1 份')
    expect(wrapper.find('[data-report-row]').attributes('data-report-kind')).toBe('big_five_profile')
  })

  it('删除末页最后一份后回到有效页并刷新服务端总数', async () => {
    const all = Array.from({ length: 41 }, (_, index) => row(index))
    vi.mocked(fetchMyReports).mockImplementation(async (page = 0, size = 20) => ({
      items: all.slice(page * size, (page + 1) * size), page, size, total: all.length,
    }))
    vi.mocked(deleteReport).mockImplementation(async (id) => {
      const index = all.findIndex((item) => item.reportId === id)
      all.splice(index, 1)
    })
    const wrapper = await mountList()
    for (let index = 0; index < 2; index++) {
      await wrapper.findAll('[data-report-pagination] button')[1]!.trigger('click')
      await flushPromises()
    }
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(1)
    await wrapper.find('[data-delete-report]').trigger('click')
    await wrapper.findComponent({ name: 'ConfirmDialog' }).findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-report-pagination]').text()).toContain('第 2 / 2 页')
    expect(wrapper.findAll('[data-report-row]')).toHaveLength(20)
    expect(wrapper.find('[data-report-counts]').text()).toContain('共 40 份')
  })
})
