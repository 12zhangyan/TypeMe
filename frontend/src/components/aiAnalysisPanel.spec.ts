// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'

/**
 * AI 分析面板（2026-09-17 新增）。
 *
 * 这块最容易做错的地方不是"能不能显示结果"，而是**几种非成功状态下的说法**：
 * AI 没开、额度用完、任务失败、输出读不出来。历史实现里前端完全没有这一段，
 * 所以这组用例的重点是"每种状态都必须给出下一步动作，且都不能让用户以为
 * 基础报告坏了"。
 *
 * 断的是页面上真实出现/不出现的东西（`data-ai-*` 钩子 + 文案），
 * 不是断言内部 state，这样重构模板不会让用例变成"照抄实现"。
 */

const fetchAiStatus = vi.fn()
const fetchReportAnalyses = vi.fn()
const createAnalysis = vi.fn()
const fetchAnalysis = vi.fn()
const retryAnalysis = vi.fn()

vi.mock('@/api/v3Ai', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Ai')>('@/api/v3Ai')
  return {
    ...actual,
    fetchAiStatus: (...args: unknown[]) => fetchAiStatus(...args),
    fetchReportAnalyses: (...args: unknown[]) => fetchReportAnalyses(...args),
    createAnalysis: (...args: unknown[]) => createAnalysis(...args),
    fetchAnalysis: (...args: unknown[]) => fetchAnalysis(...args),
    retryAnalysis: (...args: unknown[]) => retryAnalysis(...args),
  }
})

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
    ],
  })
}

const REPORT_ID = 'r-11111111-1111-1111-1111-111111111111'

async function mountPanel(requiresReadable = false) {
  const router = makeRouter()
  await router.push(`/reports/${REPORT_ID}`)
  await router.isReady()
  const wrapper = mount(AiAnalysisPanel, {
    props: { reportId: REPORT_ID, requiresReadable },
    global: { plugins: [router] },
  })
  await flushPromises()
  return wrapper
}

function status(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mock: false,
    model: 'deepseek-flash',
    dailyLimitPerUser: 2,
    remainingToday: 2,
    apiKeySource: 'env',
    promptVersion: 'typeme-ai-prompt-v2',
    ...overrides,
  }
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'j-1',
    reportId: REPORT_ID,
    status: 'SUCCEEDED',
    topic: 'overall',
    promptVersion: 'typeme-ai-prompt-v2',
    modelRequested: 'deepseek-flash',
    modelReturned: 'deepseek-flash',
    errorCode: null,
    attemptCount: 0,
    createdAt: '2026-09-17T00:00:00Z',
    finishedAt: '2026-09-17T00:00:30Z',
    result: {
      schemaVersion: '1',
      referenceType: 'ENFP',
      summary: '你倾向于先把可能性铺开，再挑一个真正在意的方向深入。',
      sections: [
        { key: 'communication', title: '沟通方式', body: '你更习惯先把气氛打开，再谈具体的事。' },
      ],
      boundaryNotes: ['这段分析基于一次问卷，不构成诊断。'],
      actions: [
        { title: '把想法说慢一点', steps: ['先说结论', '再补两个理由'] },
      ],
      reflectionQuestions: ['最近一次你被谁的想法点亮，是什么让你愿意听下去？'],
      problems: [],
    },
    resultProblems: [],
    mock: false,
    ...overrides,
  }
}

describe('AI 分析面板', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchAiStatus.mockReset().mockResolvedValue(status())
    fetchReportAnalyses.mockReset().mockResolvedValue([])
    createAnalysis.mockReset()
    fetchAnalysis.mockReset()
    retryAnalysis.mockReset()
  })

  it('大五遇到旧提示词时禁用生成并解释原因，切换新版后可用', async () => {
    const wrapper = await mountPanel(true)
    expect(wrapper.get('[data-ai-start]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-ai-unsupported]').text()).toContain('还不支持大五报告')
    wrapper.unmount()
    fetchAiStatus.mockResolvedValue(status({ promptVersion: 'typeme-ai-prompt-v3' }))
    const readable = await mountPanel(true)
    expect(readable.get('[data-ai-start]').attributes('disabled')).toBeUndefined()
    expect(readable.text()).toContain('最多两条解释')
    readable.unmount()
  })

  it('AI 没开：说清"基础报告不受影响"，且不显示生成按钮', async () => {
    fetchAiStatus.mockResolvedValue(status({ enabled: false }))
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-disabled]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-disabled]').text()).toContain('固定报告与各个维度都不受影响')
    // 关键：不给一个注定 503 的按钮
    expect(wrapper.find('[data-ai-start]').exists()).toBe(false)
  })

  it('未勾选同意范围时不能提交（不会替用户同意外发）', async () => {
    const wrapper = await mountPanel()

    await wrapper.find('[data-ai-start]').trigger('click')
    const consent = wrapper.find('[data-ai-consent]')
    expect(consent.exists()).toBe(true)
    // 范围必须如实展开：发什么、不发什么
    expect(consent.text()).toContain('会发送')
    expect(consent.text()).toContain('不会发送')
    expect(consent.text()).toContain('用户名、昵称、任何登录信息')
    expect(consent.text()).toContain('完整题库正文与完整答卷')

    const submit = wrapper.find('[data-ai-submit]')
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    await submit.trigger('click')
    await flushPromises()
    expect(createAnalysis).not.toHaveBeenCalled()

    await wrapper.find("input[name='ai-consent']").setValue(true)
    await flushPromises()
    expect((wrapper.find('[data-ai-submit]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('生成成功后展示摘要、分节、行动与自省问题，并标明不改变固定报告', async () => {
    fetchReportAnalyses.mockResolvedValue([job()])
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-result]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-summary]').text()).toContain('先把可能性铺开')
    expect(wrapper.find('[data-ai-section]').text()).toContain('沟通方式')
    expect(wrapper.find('[data-ai-actions]').text()).toContain('先说结论')
    expect(wrapper.find('[data-ai-questions]').text()).toContain('被谁的想法点亮')
    expect(wrapper.find('[data-ai-boundaries]').text()).toContain('不构成诊断')
    expect(wrapper.text()).toContain('不改变上面那份固定报告')
  })

  it('mock 输出必须显著标注"没有调用真实模型"', async () => {
    fetchAiStatus.mockResolvedValue(status({ mock: true }))
    fetchReportAnalyses.mockResolvedValue([job({ mock: true })])
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-mock]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-mock]').text()).toContain('没有真的调用外部模型')
  })

  it('输出读不出来时：明说读了哪一部分，而不是安静地少显示', async () => {
    fetchReportAnalyses.mockResolvedValue([
      job({
        result: null,
        resultProblems: ['这份分析的输出没能被当前页面解析出来（可能是旧版本的输出格式）。'],
      }),
    ])
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-result-problems]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-result-problems]').text()).toContain('没能被当前页面解析出来')
  })

  it('任务失败：给出可点的重试，并说明不复用旧结果、不影响基础报告', async () => {
    fetchReportAnalyses.mockResolvedValue([
      job({ status: 'FAILED', errorCode: 'TIMEOUT', result: null, resultProblems: [] }),
    ])
    retryAnalysis.mockResolvedValue({ jobId: 'j-1', status: 'QUEUED', attemptCount: 1 })
    const wrapper = await mountPanel()

    const failed = wrapper.find('[data-ai-failed]')
    expect(failed.exists()).toBe(true)
    expect(failed.text()).toContain('超时')

    await wrapper.find('[data-ai-retry]').trigger('click')
    await flushPromises()
    expect(retryAnalysis).toHaveBeenCalledWith('j-1')
    // 重试后回到"进行中"，而不是继续显示失败
    expect(wrapper.find('[data-ai-running]').exists()).toBe(true)
  })

  it('额度用完：按钮说明原因并禁用，不让人白点', async () => {
    fetchAiStatus.mockResolvedValue(status({ remainingToday: 0 }))
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-quota-empty]').exists()).toBe(true)
    const start = wrapper.find('[data-ai-start]')
    expect((start.element as HTMLButtonElement).disabled).toBe(true)
    expect(start.text()).toContain('额度已用完')
  })

  it('次数算不清（-1）：不显示次数、也不说「额度已用完」，生成按钮照常可用（A53②）', async () => {
    // 服务端读额度失败（或未登录）时给的是 -1。原来的行为是"按 used=0 算"，
    // 页面会说"今天还可以生成 N 次" —— 一个服务端并不知道的数字。
    fetchAiStatus.mockResolvedValue(status({ remainingToday: -1 }))
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-quota-empty]').exists()).toBe(false)
    const quota = wrapper.find('[data-ai-quota]')
    expect(quota.exists()).toBe(true)
    expect(quota.text()).not.toMatch(/还可以生成\s*\d+\s*次/)
    expect(quota.text()).toContain('这项能力已开启')
    const start = wrapper.find('[data-ai-start]')
    expect((start.element as HTMLButtonElement).disabled).toBe(false)
    expect(start.text()).not.toContain('额度已用完')
  })

  it('离开页面时停掉轮询（不留后台请求）', async () => {
    fetchReportAnalyses.mockResolvedValue([job({ status: 'RUNNING', result: null })])
    const wrapper = await mountPanel()
    expect(wrapper.find('[data-ai-running]').exists()).toBe(true)

    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    wrapper.unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
