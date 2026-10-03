// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import { parseAnalysisResult } from '@/api/v3Ai'
import { useAiAnalysisStore } from '@/stores/aiAnalysisV3'
import { V3ApiError } from '@/api/v3'

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

  it.each(['typeme-ai-prompt-v3', 'typeme-ai-prompt-v4'])('大五遇到旧提示词时禁用生成并解释原因，切换 %s 后可用', async (version) => {
    const wrapper = await mountPanel(true)
    expect(wrapper.get('[data-ai-start]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-ai-unsupported]').text()).toContain('还不支持大五报告')
    wrapper.unmount()
    fetchAiStatus.mockResolvedValue(status({ promptVersion: version }))
    const readable = await mountPanel(true)
    expect(readable.get('[data-ai-start]').attributes('disabled')).toBeUndefined()
    expect(readable.text()).toContain('最多两条解释')
    readable.unmount()
  })

  it('提示词版本兼容：未知/更新的版本按旧版处理，且「能否走大五」与「确认区列哪套范围」必须同源', async () => {
    // 后端对未知版本一律落到旧版输入；前端不能"乐观地"把 v999 当成新版：
    // 否则会出现"按钮说暂不支持大五、确认区却按新版列发送范围"这种自相矛盾。
    fetchAiStatus.mockResolvedValue(status({ promptVersion: 'typeme-ai-prompt-v999' }))
    const unknownOnJung = await mountPanel()
    await unknownOnJung.find('[data-ai-start]').trigger('click')
    const unknownText = unknownOnJung.find('[data-ai-consent]').text()
    expect(unknownText).toContain('最多 8 条作答片段')
    expect(unknownText).not.toContain('最多 5 条维度摘要')
    unknownOnJung.unmount()

    const unknownOnBigFive = await mountPanel(true)
    expect(unknownOnBigFive.get('[data-ai-start]').attributes('disabled')).toBeDefined()
    expect(unknownOnBigFive.get('[data-ai-unsupported]').text()).toContain('还不支持大五报告')
    unknownOnBigFive.unmount()

    // v4 延用可读版契约：两条路径同时切换过去。
    fetchAiStatus.mockResolvedValue(status({ promptVersion: 'typeme-ai-prompt-v4' }))
    const readableOnJung = await mountPanel()
    await readableOnJung.find('[data-ai-start]').trigger('click')
    const readableText = readableOnJung.find('[data-ai-consent]').text()
    expect(readableText).toContain('最多 5 条维度摘要')
    expect(readableText).not.toContain('最多 8 条作答片段')
    readableOnJung.unmount()

    const readableOnBigFive = await mountPanel(true)
    expect(readableOnBigFive.get('[data-ai-start]').attributes('disabled')).toBeUndefined()
    readableOnBigFive.unmount()
  })

  it('AI 没开：说清"基础报告不受影响"，且不显示生成按钮', async () => {
    fetchAiStatus.mockResolvedValue(status({ enabled: false }))
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-disabled]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-disabled]').text()).toContain('AI 解读暂未开放')
    expect(wrapper.text()).toContain('固定报告无需 AI 即可阅读')
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
    expect(wrapper.find('[data-ai-regenerate]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-start]').text()).toContain('再生成一次')
  })

  it('成功后点「再生成一次」会打开确认范围，而不是没有入口', async () => {
    fetchReportAnalyses.mockResolvedValue([job()])
    const wrapper = await mountPanel()

    await wrapper.find('[data-ai-start]').trigger('click')
    expect(wrapper.find('[data-ai-consent]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-submit]').exists()).toBe(true)
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

  it('重新生成失败：上一次成功的正文不能被藏起来，并要标明"这是上一次的"（A84）', async () => {
    // 同一行任务被重新生成：服务端不会清 response_json，所以 FAILED 时 result 仍带着旧正文
    fetchReportAnalyses.mockResolvedValue([
      job({ status: 'FAILED', errorCode: 'TIMEOUT', attemptCount: 1 }),
    ])
    const wrapper = await mountPanel()

    // 失败提示与重试入口照旧
    expect(wrapper.find('[data-ai-failed]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-retry]').exists()).toBe(true)
    // 但旧正文必须还在，而且说清它是哪一次留下的
    expect(wrapper.find('[data-ai-result]').exists()).toBe(true)
    const stale = wrapper.find('[data-ai-stale]')
    expect(stale.exists()).toBe(true)
    expect(stale.text()).toContain('上一次成功生成')
    expect(wrapper.find('[data-ai-summary]').text()).toContain('你倾向于先把可能性铺开')
  })

  it('确实一次都没成功过时，失败分支不凭空渲染结果区（A84 反向）', async () => {
    fetchReportAnalyses.mockResolvedValue([
      job({ status: 'FAILED', errorCode: 'TIMEOUT', result: null, resultProblems: [] }),
    ])
    const wrapper = await mountPanel()

    expect(wrapper.find('[data-ai-failed]').exists()).toBe(true)
    expect(wrapper.find('[data-ai-result]').exists()).toBe(false)
    expect(wrapper.find('[data-ai-stale]').exists()).toBe(false)
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
  it('新版按真实依据展示场景、核对问题和行动理由', async () => {
    fetchAiStatus.mockResolvedValue(status({ promptVersion: 'typeme-ai-prompt-v5' }))
    const result = parseAnalysisResult({
      schemaVersion: 'analysis-guided-v3', referenceType: null, summary: '先核对场景。',
      observations: [{ title: '先看交流节奏', plainText: '精力方向接近两边。', example: '如果讨论变长，观察自己是否需要独处。', checkQuestion: '什么时候正好相反？', evidenceIds: ['EI:summary'] }],
      suggestedAction: { what: '记一次交流。', why: '核对这次平分。', when: '下次聊天后。', observe: '是否受场景影响。', evidenceIds: ['EI:summary'] },
      limitations: ['平分不推导类型。'],
    })
    fetchReportAnalyses.mockResolvedValue([job({ result, promptVersion: 'typeme-ai-prompt-v5' })])
    const wrapper = await mountPanel()
    expect(wrapper.get('[data-ai-evidence]').text()).toContain('精力方向')
    expect(wrapper.get('[data-ai-example]').text()).toContain('如果讨论变长')
    expect(wrapper.get('[data-ai-check-question]').text()).toContain('什么时候正好相反')
    expect(wrapper.get('[data-ai-action-why]').text()).toContain('核对这次平分')
    for (const label of ['怎么做', '何时试', '观察什么']) expect(wrapper.get('[data-ai-actions]').text()).toContain(label)
    expect(wrapper.text()).not.toContain('EI:summary')
    wrapper.unmount()
  })

  it('提交失败保留填写表单、近况和可修正的反馈', async () => {
    createAnalysis.mockRejectedValueOnce(new V3ApiError({ code: 'BUDGET_EXCEEDED', message: '额度不足', requestId: null, details: {} }, { status: 429 }))
    const wrapper = await mountPanel()
    await wrapper.get('[data-ai-start]').trigger('click')
    await wrapper.get('[data-ai-topic="communication"]').trigger('click')
    await wrapper.get('textarea').setValue('我想把分歧表达得更清楚')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('[data-ai-submit]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-ai-consent]').exists()).toBe(true)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('我想把分歧表达得更清楚')
    expect(wrapper.get('[data-ai-create-error]').text()).toContain('额度')
    expect(wrapper.get('[data-ai-note-count]').text()).toContain('11 / 300')
    wrapper.unmount()
  })

  it.each(['FAILED', 'RUNNING'])('重生成处于 %s 时继续显示旧正文并明确标记', async state => {
    fetchReportAnalyses.mockResolvedValue([job({ status: state, errorCode: state === 'FAILED' ? 'TIMEOUT' : null })])
    const wrapper = await mountPanel()
    expect(wrapper.get('[data-ai-summary]').text()).toContain('先把可能性铺开')
    expect(wrapper.get('[data-ai-stale]').text()).toContain('上一次成功生成')
    if (state === 'RUNNING') expect(wrapper.find('[data-ai-running]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('关闭 AI 后历史结果仍可阅读，重新生成不可用', async () => {
    fetchAiStatus.mockResolvedValue(status({ enabled: false }))
    fetchReportAnalyses.mockResolvedValue([job()])
    const wrapper = await mountPanel()
    expect(wrapper.get('[data-ai-summary]').text()).toContain('先把可能性铺开')
    expect(wrapper.find('[data-ai-start]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('修改近况或切换报告会清掉原发送确认', async () => {
    const wrapper = await mountPanel()
    await wrapper.get('[data-ai-start]').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('textarea').setValue('补充一个新问题')
    expect(wrapper.get('[data-ai-submit]').attributes('disabled')).toBeDefined()
    await wrapper.setProps({ reportId: 'another-report' })
    await flushPromises()
    expect(wrapper.find('[data-ai-consent]').exists()).toBe(false)
    expect(useAiAnalysisStore().note).toBe('')
    wrapper.unmount()
  })

})
