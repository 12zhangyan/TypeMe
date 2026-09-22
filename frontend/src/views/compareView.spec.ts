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

  /**
   * A40：同一页里「提示 → 紧随其后的操作」与「操作 → 它的反馈」应当是同一种节奏。
   *
   * 账号页的表单反馈一直是 mt-3（12px）：caption / notice-success / notice-error 与
   * 其后的按钮都用它。对比页此前把操作组与错误提示写成 mt-4（16px），两页并排看节奏对不上。
   * 这条只锁「同一节奏」这件事本身，不改动任何功能。
   */
  it('提示与操作组的垂直间距与账号页同一节奏（A40）', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' })],
      page: 0,
      size: 100,
      total: 2,
    })
    compareReports.mockRejectedValue(new Error('boom'))
    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()

    const runGroup = wrapper.find('[data-compare-run]').element.parentElement as HTMLElement
    expect(runGroup.className).toContain('mt-3')
    expect(runGroup.className).not.toContain('mt-4')

    const errorNotice = wrapper.find('[data-compare-error]')
    expect(errorNotice.exists()).toBe(true)
    expect(errorNotice.classes()).toContain('mt-3')
    expect(errorNotice.classes()).not.toContain('mt-4')
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

  /**
   * 「换了下拉框，表格还是上一对」是这一页最坏的一种错：表格本身看起来完全正常，
   * 表头只写「先看的那份 / 再看的那份」，没有任何东西能让用户察觉自己读的是旧对比。
   */
  it('换掉其中一份之后：旧表格立刻消失，不会留着上一对的对比继续显示', async () => {
    fetchReports.mockResolvedValue({
      items: [
        summary(),
        summary({ reportId: 'r2', computedTypeCode: 'INFP' }),
        summary({ reportId: 'r3', computedTypeCode: 'ISTJ' }),
      ],
      page: 0,
      size: 100,
      total: 3,
    })
    const pairResult = (typeCode: string, changed: boolean) => ({
      reports: [summary(), summary({ reportId: typeCode })],
      differences: [
        { dimension: 'EI', fromPole: 'E', toPole: changed ? 'I' : 'E', fromMFinal: 0.42, toMFinal: 0.35, changed },
      ],
      samePackage: true,
      notes: [],
    })
    compareReports.mockResolvedValueOnce(pairResult('r2', true))

    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()
    expect(wrapper.find('[data-compare-row="EI"]').text()).toContain('方向不同')
    // 表格上方必须写出比的是哪两份 —— 否则用户无法核对选择与内容是否一致
    expect(wrapper.find('[data-compare-subject]').text()).toContain('INFP')

    // 换第二份：新的比较还在路上
    let resolveSecond: (value: unknown) => void = () => {}
    compareReports.mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve }))
    await wrapper.find('[data-compare-select-b]').setValue('r3')
    await flushPromises()

    expect(compareReports).toHaveBeenLastCalledWith(['r1', 'r3'])
    // 换选之后旧表格必须立刻消失，不能继续显示上一对的对比
    expect(wrapper.find('[data-compare-result]').exists()).toBe(false)
    // 旧那一对的行也不该留在 DOM 里（表头「方向是否不同」含这几个字，所以按行断言）
    expect(wrapper.find('[data-compare-row="EI"]').exists()).toBe(false)

    resolveSecond(pairResult('r3', false))
    await flushPromises()
    expect(wrapper.find('[data-compare-result]').exists()).toBe(true)
    expect(wrapper.find('[data-compare-row="EI"]').text()).toContain('方向一致')
    expect(wrapper.find('[data-compare-subject]').text()).toContain('ISTJ')
  })

  it('换选后旧请求晚到：不会把已经作废的那一对结果写回页面', async () => {
    fetchReports.mockResolvedValue({
      items: [summary(), summary({ reportId: 'r2' }), summary({ reportId: 'r3' })],
      page: 0,
      size: 100,
      total: 3,
    })
    let resolveOld: (value: unknown) => void = () => {}
    compareReports.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve }))

    const { wrapper } = await mountCompare({ a: 'r1', b: 'r2' })
    await flushPromises()
    expect(compareReports).toHaveBeenCalledTimes(1)

    compareReports.mockResolvedValueOnce({
      reports: [summary(), summary({ reportId: 'r3' })],
      differences: [
        { dimension: 'SN', fromPole: 'N', toPole: 'S', fromMFinal: 0.4, toMFinal: 0.2, changed: true },
      ],
      samePackage: true,
      notes: [],
    })
    await wrapper.find('[data-compare-select-b]').setValue('r3')
    await flushPromises()
    expect(wrapper.find('[data-compare-row="SN"]').text()).toContain('方向不同')

    // 第一对（r1,r2）的响应现在才回来，它已经过期了
    resolveOld({
      reports: [summary(), summary({ reportId: 'r2' })],
      differences: [
        { dimension: 'EI', fromPole: 'E', toPole: 'I', fromMFinal: 0.1, toMFinal: 0.9, changed: true },
      ],
      samePackage: true,
      notes: [],
    })
    await flushPromises()

    // 迟到的旧响应不能覆盖当前选择的对比
    expect(wrapper.find('[data-compare-row="EI"]').exists()).toBe(false)
    expect(wrapper.find('[data-compare-row="SN"]').exists()).toBe(true)
  })
})
