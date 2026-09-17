// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import CompareView from '@/views/CompareView.vue'

/**
 * 复测比较页（2026-09-17 新增）。
 *
 * 这一页最容易做错的地方**不是**表格渲染，而是它**说了不该说的话**：
 * 把"方向不同"写成"成长/退步"，把强度当成分数，或者在两次规则版本不同时
 * 照样算出差值。所以用例的一半在钉"必须少说"：
 *
 *   - 少于两份时不给比较入口，而是说清还差什么；
 *   - 规则版本不同时**不显示变化标记**，并说明为什么不算；
 *   - 强度缺失时显示"未记录"，而不是 0.00。
 */

const fetchReports = vi.fn()
const compareReports = vi.fn()

vi.mock('@/api/v3Assessment', () => ({
  fetchReports: (...args: unknown[]) => fetchReports(...args),
  compareReports: (...args: unknown[]) => compareReports(...args),
}))

function summary(overrides: Record<string, unknown> = {}) {
  return {
    reportId: 'r1',
    attemptId: 'a1',
    createdAt: '2026-09-17T10:00:00Z',
    status: 'REFERENCE',
    computedTypeCode: 'ENFP',
    selfSelectedTypeCode: null,
    summaryLine: null,
    packageId: 'typeme-jung48-zh-v1',
    scoringVersion: 'v1',
    ...overrides,
  }
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/reports', name: 'reports', component: { template: '<div />' } },
      { path: '/reports/compare', name: 'report-compare', component: CompareView },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<div />' } },
      { path: '/assess', name: 'assess', component: { template: '<div />' } },
    ],
  })
}

async function mountCompare(query: Record<string, string> = {}) {
  const router = makeRouter()
  await router.push({ path: '/reports/compare', query })
  await router.isReady()
  const wrapper = mount(CompareView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

describe('复测比较页', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchReports.mockReset()
    compareReports.mockReset()
  })

  it('只有一份报告时：说清还差什么，不给比较按钮', async () => {
    fetchReports.mockResolvedValue({ items: [summary()], page: 0, size: 100, total: 1 })
    const { wrapper } = await mountCompare()

    expect(wrapper.find('[data-compare-need-two]').exists()).toBe(true)
    expect(wrapper.find('[data-compare-need-two]').text()).toContain('至少要有两份报告')
    expect(wrapper.find('[data-compare-run]').exists()).toBe(false)
  })

  it('两份都在 URL 里时自动比较，并渲染四个维度的对照', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2', computedTypeCode: 'INFP' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockResolvedValue({
      reports: [summary(), summary({ reportId: 'r2', computedTypeCode: 'INFP' })],
      differences: [
        { dimension: 'EI', fromPole: 'E', toPole: 'I', fromMFinal: 0.42, toMFinal: 0.35, changed: true },
        { dimension: 'SN', fromPole: 'N', toPole: 'N', fromMFinal: 0.5, toMFinal: 0.6, changed: false },
      ],
      samePackage: true,
      notes: ['两次作答的时间、状态与当时的理解都可能影响结果，变化不等于成长或退步。'],
    })

    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    expect(compareReports).toHaveBeenCalledWith(['r1', 'r2'])
    const result = wrapper.find('[data-compare-result]')
    expect(result.exists()).toBe(true)
    expect(result.find('[data-compare-row="EI"]').text()).toContain('方向不同')
    expect(result.find('[data-compare-row="EI"]').text()).toContain('0.42')
    expect(result.find('[data-compare-row="SN"]').text()).toContain('方向一致')
    // 后端给的说明必须显示出来（"变化不等于成长"是这一页的口径核心）
    expect(wrapper.find('[data-compare-note]').text()).toContain('变化不等于成长或退步')
  })

  it('页面不出现"成长/进步/退步/匹配度"这类判断词', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockResolvedValue({
      reports: [summary(), summary({ reportId: 'r2' })],
      differences: [
        { dimension: 'EI', fromPole: 'E', toPole: 'I', fromMFinal: 0.42, toMFinal: 0.35, changed: true },
      ],
      samePackage: true,
      notes: [],
    })
    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    const text = wrapper.text()
    // "变化不等于成长或退步"这条说明本身含这些词，所以只检查表格区域。
    const resultText = wrapper.find('[data-compare-result]').text()
    expect(resultText).toContain('不是分数、不是概率，也不是匹配度')
    expect(resultText).not.toContain('你成长了')
    expect(resultText).not.toContain('进步了')
    expect(resultText).not.toContain('准确率')
    // 页面顶部那句说明必须存在，避免用户把方向变化理解成好坏
    expect(text).toContain('它不判断你变好了还是变差了')
  })

  it('两次规则版本不同：不显示变化标记，并说明为什么不算变化', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockResolvedValue({
      reports: [summary(), summary({ reportId: 'r2' })],
      differences: [
        // 服务端在这种情况下也会把 changed 置 false（samePackage=false）
        { dimension: 'EI', fromPole: 'E', toPole: 'I', fromMFinal: 0.42, toMFinal: 0.35, changed: false },
      ],
      samePackage: false,
      notes: ['两次测评用的题目或规则版本不同，只并列阅读，不计算变化幅度。'],
    })

    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    expect(wrapper.find('[data-compare-different-package]').exists()).toBe(true)
    expect(wrapper.find('[data-compare-different-package]').text()).toContain('没有计算变化')
    expect(wrapper.find('[data-compare-row="EI"]').text()).toContain('方向一致')
    expect(wrapper.find('[data-compare-row="EI"]').text()).not.toContain('方向不同')
  })

  it('强度缺失时显示「未记录」，不用 0.00 冒充', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockResolvedValue({
      reports: [summary(), summary({ reportId: 'r2' })],
      differences: [
        { dimension: 'TF', fromPole: 'T', toPole: null, fromMFinal: null, toMFinal: 0.1, changed: false },
      ],
      samePackage: true,
      notes: [],
    })

    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    const row = wrapper.find('[data-compare-row="TF"]').text()
    expect(row).toContain('未记录')
    expect(row).not.toContain('0.00')
    expect(row).toContain('没有给出方向')
  })

  it('选了同一份：按钮禁用并说明原因（服务端也会拒）', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    const { wrapper } = await mountCompare({ a: 'r1', b: 'r1' })

    expect(wrapper.find('[data-compare-same]').exists()).toBe(true)
    const run = wrapper.find('[data-compare-run]')
    expect((run.element as HTMLButtonElement).disabled).toBe(true)
    expect(compareReports).not.toHaveBeenCalled()
  })

  it('比较失败：显示错误与重试机会，不显示半张表', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    expect(wrapper.find('[data-compare-error]').exists()).toBe(true)
    expect(wrapper.find('[data-compare-result]').exists()).toBe(false)
  })
})
