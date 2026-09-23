import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAiAnalysisStore } from '@/stores/aiAnalysisV3'
import { V3ApiError } from '@/api/v3'

/**
 * AI 分析 store 的**归属不变量**（2026-09-18 第 17 轮）。
 *
 * 修之前这里是一个没有归属的单例：`loadJobs` 失败保留旧 `jobs`、迟到的响应无条件覆盖、
 * `startPolling` 会被任何迟到的完成重新点着、`reset()` 零调用点。后果全都是
 * "把上一份报告的 AI 正文显示在下一份报告上"，在共用设备上还会跨账号。
 *
 * 这组用例只钉四件事，因为它们正是那四条缺陷的判据：
 *   1. 换报告时**先清空**（不等新响应）；
 *   2. 迟到的 / 无归属的响应一律丢弃；
 *   3. `reset()`（卸载 / 退出登录）之后不可能再有轮询被武装；
 *   4. `retry` 不能被用来操作别的报告的任务。
 *
 * 断的是 store 对外可见的结果（`ownJobs` / `activeJob` / 是否发出请求），
 * 不是内部字段，这样重构实现不会让用例变成"照抄实现"。
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

const REPORT_A = 'report-aaaa'
const REPORT_B = 'report-bbbb'

function job(reportId: string, overrides: Record<string, unknown> = {}) {
  return {
    jobId: `j-${reportId}`,
    reportId,
    status: 'SUCCEEDED',
    topic: 'overall',
    promptVersion: 'v2',
    modelRequested: null,
    modelReturned: null,
    errorCode: null,
    attemptCount: 0,
    createdAt: null,
    finishedAt: null,
    result: null,
    resultProblems: [],
    mock: false,
    ...overrides,
  }
}

/** 手动控制的挂起 promise，用来精确制造"响应迟到"的顺序。 */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('AI 分析 store：归属与轮询清理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchAiStatus.mockReset().mockResolvedValue({ enabled: true, mock: false })
    fetchReportAnalyses.mockReset()
    createAnalysis.mockReset()
    fetchAnalysis.mockReset()
    retryAnalysis.mockReset()
  })

  it.each(['typeme-ai-prompt-v3', 'typeme-ai-prompt-v4', 'typeme-ai-prompt-v5'])('%s 创建分析发送维度摘要范围', async (version) => {
    const store = useAiAnalysisStore()
    fetchAiStatus.mockResolvedValue({ enabled: true, mock: false, promptVersion: version })
    await store.loadStatus()
    createAnalysis.mockResolvedValue({ jobId: 'new-job', status: 'SUCCEEDED', cached: false })
    await store.create(REPORT_A)
    expect(createAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      reportId: REPORT_A,
      scopeVersion: 'typeme-ai-scope-v3',
    }))
    expect(retryAnalysis).not.toHaveBeenCalled()
    store.reset()
  })

  it('换报告时先清空旧任务：新报告的界面不会出现旧报告的分析（哪怕响应还没回来）', async () => {
    const store = useAiAnalysisStore()

    fetchReportAnalyses.mockResolvedValueOnce([job(REPORT_A)])
    await store.loadJobs(REPORT_A)
    expect(store.ownJobs).toHaveLength(1)
    expect(store.activeJob?.jobId).toBe(`j-${REPORT_A}`)

    const pendingB = deferred<unknown[]>()
    fetchReportAnalyses.mockReturnValueOnce(pendingB.promise)
    const loadingB = store.loadJobs(REPORT_B)

    // 关键断言：这一刻 B 的列表还没回来，但 A 的任务必须已经不在渲染源里。
    // （修之前 `jobs` 直到 B 的响应到达前都还是 A 的，`activeJob` 取 jobs[0]，
    //  于是 B 的首屏会画出 A 的分析正文。）
    expect(store.ownJobs).toEqual([])
    expect(store.activeJob).toBeNull()

    pendingB.resolve([job(REPORT_B)])
    await loadingB
    expect(store.ownJobs.map((item) => item.jobId)).toEqual([`j-${REPORT_B}`])
  })

  it('迟到的旧报告响应被丢弃，不会覆盖新报告', async () => {
    const store = useAiAnalysisStore()
    const pendingA = deferred<unknown[]>()
    const pendingB = deferred<unknown[]>()
    fetchReportAnalyses.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise)

    const loadingA = store.loadJobs(REPORT_A)
    const loadingB = store.loadJobs(REPORT_B)

    // B 先回来，A 后回来 —— 乱序落地是真实网络下会发生的事。
    pendingB.resolve([job(REPORT_B)])
    await loadingB
    pendingA.resolve([job(REPORT_A)])
    await loadingA

    expect(store.reportId).toBe(REPORT_B)
    expect(store.ownJobs.map((item) => item.jobId)).toEqual([`j-${REPORT_B}`])
  })

  it('列表读失败时如实留痕，并且不把"读不到"当成"没有分析"以外的东西', async () => {
    const store = useAiAnalysisStore()
    fetchReportAnalyses.mockRejectedValueOnce(new Error('boom'))

    await store.loadJobs(REPORT_A)

    expect(store.jobsError).not.toBeNull()
    expect(store.jobsLoading).toBe(false)
    expect(store.ownJobs).toEqual([])
  })

  it('reset() 之后不留下任何正文，也不会把轮询重新点着', async () => {
    vi.useFakeTimers()
    try {
      const store = useAiAnalysisStore()
      const pending = deferred<unknown[]>()
      fetchReportAnalyses.mockReturnValueOnce(pending.promise)

      const loading = store.loadJobs(REPORT_A)
      // 用户在响应回来之前离开了页面：面板卸载 → reset()
      store.reset()
      pending.resolve([job(REPORT_A, { status: 'RUNNING', result: null })])
      await loading

      expect(store.reportId).toBeNull()
      expect(store.ownJobs).toEqual([])
      // `ownJobs` 已经挡住了渲染，但"渲染不出来"和"已经不在了"是两件事：
      // 这是 App 级单例，共用设备上换号时留在里面的分析正文就是一处分险。
      expect(store.jobs).toEqual([])

      // 这一步必须在推进时间**之前**断言：修之前这里会 `startPolling()`，
      // 于是在没有面板的情况下每 3 秒问一次，最长 POLL_MAX_MS（4 分钟）。
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchAnalysis).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有归属报告时 startPolling 不会建 timer（退出登录后也不会有后台请求）', async () => {
    vi.useFakeTimers()
    try {
      const store = useAiAnalysisStore()
      fetchReportAnalyses.mockResolvedValue([job(REPORT_A, { status: 'RUNNING', result: null })])
      await store.loadJobs(REPORT_A)
      store.reset()

      store.startPolling()
      // 没有归属报告就不该建 timer（这一步必须在推进时间之前断言）。
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchAnalysis).not.toHaveBeenCalled()
      expect(store.reportId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('有任务在跑时会接上轮询（离开再回来不丢进度）', async () => {
    vi.useFakeTimers()
    try {
      const store = useAiAnalysisStore()
      fetchReportAnalyses.mockResolvedValue([job(REPORT_A, { status: 'RUNNING', result: null })])
      fetchAnalysis.mockResolvedValue(job(REPORT_A, { status: 'SUCCEEDED' }))

      await store.loadJobs(REPORT_A)
      await vi.advanceTimersByTimeAsync(3_500)

      expect(fetchAnalysis).toHaveBeenCalledTimes(1)
      expect(store.activeJob?.status).toBe('SUCCEEDED')
    } finally {
      vi.useRealTimers()
    }
  })

  it('页面隐藏时不发轮询，回到前台仍能刷新且不耗掉四分钟上限', async () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const visibility = {
      visibilityState: 'hidden',
      addEventListener: (_event: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_event: string, callback: () => void) => listeners.delete(callback),
    }
    vi.stubGlobal('document', visibility)
    try {
      const store = useAiAnalysisStore()
      fetchReportAnalyses.mockResolvedValue([job(REPORT_A, { status: 'RUNNING', result: null })])
      fetchAnalysis.mockResolvedValue(job(REPORT_A, { status: 'SUCCEEDED' }))
      await store.loadJobs(REPORT_A)
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(fetchAnalysis).not.toHaveBeenCalled()
      visibility.visibilityState = 'visible'
      listeners.forEach((listener) => listener())
      await vi.advanceTimersByTimeAsync(3_100)
      expect(fetchAnalysis).toHaveBeenCalledTimes(1)
      expect(store.pollingGaveUp).toBe(false)
      store.reset()
      expect(listeners.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('429 按服务端建议退避，成功后清除暂时错误', async () => {
    vi.useFakeTimers()
    try {
      const store = useAiAnalysisStore()
      fetchReportAnalyses.mockResolvedValue([job(REPORT_A, { status: 'RUNNING', result: null })])
      fetchAnalysis.mockRejectedValueOnce(new V3ApiError({
        code: 'RATE_LIMITED', message: '稍后再试', requestId: null,
        details: { retryAfterSeconds: 15 },
      }, { status: 429 })).mockResolvedValueOnce(job(REPORT_A, { status: 'SUCCEEDED' }))
      await store.loadJobs(REPORT_A)
      await vi.advanceTimersByTimeAsync(3_100)
      expect(store.jobsError).not.toBeNull()
      await vi.advanceTimersByTimeAsync(12_000)
      expect(fetchAnalysis).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3_100)
      expect(fetchAnalysis).toHaveBeenCalledTimes(2)
      expect(store.jobsError).toBeNull()
      store.reset()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retry 拒绝不属于当前报告的任务（不会去重排别人的队）', async () => {
    const store = useAiAnalysisStore()
    fetchReportAnalyses.mockResolvedValueOnce([job(REPORT_A)])

    await store.loadJobs(REPORT_A)
    // 伪装成"面板手里有一条别的报告的任务"：即使真传进来也不该发请求。
    await store.retry(`j-${REPORT_B}`)

    expect(retryAnalysis).not.toHaveBeenCalled()
  })

  it('hasRunning 只看当前报告：别的报告在跑不影响这一份的判断', async () => {
    const store = useAiAnalysisStore()
    fetchReportAnalyses.mockResolvedValueOnce([job(REPORT_A, { status: 'RUNNING', result: null })])

    await store.loadJobs(REPORT_A)
    expect(store.hasRunning).toBe(true)

    fetchReportAnalyses.mockResolvedValueOnce([job(REPORT_B)])
    await store.loadJobs(REPORT_B)
    expect(store.hasRunning).toBe(false)
  })

  it('同一范围已有成功分析时，再生成会走重试，而不是停在「没有新建」', async () => {
    const store = useAiAnalysisStore()
    fetchReportAnalyses.mockResolvedValueOnce([job(REPORT_A)])
    await store.loadJobs(REPORT_A)

    createAnalysis.mockResolvedValue({
      jobId: `j-${REPORT_A}`,
      status: 'SUCCEEDED',
      cached: true,
    })
    retryAnalysis.mockResolvedValue({
      jobId: `j-${REPORT_A}`,
      status: 'QUEUED',
      attemptCount: 1,
    })

    await store.create(REPORT_A)

    expect(retryAnalysis).toHaveBeenCalledWith(`j-${REPORT_A}`)
    expect(store.createCached).toBe(false)
    expect(store.activeJob?.status).toBe('QUEUED')
  })
  it('卸载后返回同一报告，旧状态响应不能覆盖新账号额度', async () => {
    const store = useAiAnalysisStore()
    const old = deferred<any>()
    fetchAiStatus.mockReturnValueOnce(old.promise)
    const loading = store.loadStatus()
    store.reset()
    fetchAiStatus.mockResolvedValueOnce({ enabled: false, remainingToday: 0 })
    await store.loadStatus()
    old.resolve({ enabled: true, remainingToday: 99 })
    await loading
    expect(store.status?.enabled).toBe(false)
    expect(store.status?.remainingToday).toBe(0)
    expect(store.statusLoading).toBe(false)
  })

  it('旧创建响应不能清掉返回同一报告后新请求的提交状态', async () => {
    const store = useAiAnalysisStore()
    const old = deferred<any>(), fresh = deferred<any>()
    createAnalysis.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const first = store.create(REPORT_A)
    store.reset()
    const second = store.create(REPORT_A)
    old.resolve({ jobId: 'old', status: 'QUEUED', cached: false })
    expect(await first).toBe(false)
    expect(store.creating).toBe(true)
    expect(store.jobs).toEqual([])
    fresh.resolve({ jobId: 'fresh', status: 'QUEUED', cached: false })
    expect(await second).toBe(true)
    expect(store.activeJob?.jobId).toBe('fresh')
    expect(store.creating).toBe(false)
    store.reset()
  })

  it('提交参数固定在点击时，失败返回 false 并保留近况', async () => {
    const store = useAiAnalysisStore(), pending = deferred<any>()
    store.topic = 'communication'; store.note = '一个沟通场景'
    createAnalysis.mockReturnValueOnce(pending.promise)
    const creating = store.create(REPORT_A)
    store.topic = 'growth'
    pending.resolve({ jobId: 'new', status: 'QUEUED', cached: false })
    expect(await creating).toBe(true)
    expect(store.activeJob?.topic).toBe('communication')
    store.reset()
    store.note = '这个内容不能丢'
    createAnalysis.mockRejectedValueOnce(new V3ApiError({ code: 'BUDGET_EXCEEDED', message: '额度不足', requestId: null, details: {} }, { status: 429 }))
    expect(await store.create(REPORT_A)).toBe(false)
    expect(store.note).toBe('这个内容不能丢')
    expect(store.createError).not.toBeNull()
    store.reset()
  })

  it('相同输入命中未加载的旧任务时先取回正文再重试', async () => {
    const store = useAiAnalysisStore()
    createAnalysis.mockResolvedValue({ jobId: 'old', status: 'SUCCEEDED', cached: true })
    fetchAnalysis.mockResolvedValue(job(REPORT_A, { jobId: 'old', result: { summary: '旧正文' } }))
    retryAnalysis.mockResolvedValue({ jobId: 'old', status: 'QUEUED', attemptCount: 1 })
    expect(await store.create(REPORT_A)).toBe(true)
    expect(retryAnalysis).toHaveBeenCalledWith('old')
    expect(store.activeJob?.result?.summary).toBe('旧正文')
    store.reset()
  })

  it('已有运行任务时不再创建或重试，避免重复消耗', async () => {
    const store = useAiAnalysisStore()
    fetchReportAnalyses.mockResolvedValue([job(REPORT_A, { status: 'RUNNING' })])
    await store.loadJobs(REPORT_A)
    expect(await store.create(REPORT_A)).toBe(false)
    expect(await store.retry('anything')).toBe(false)
    expect(createAnalysis).not.toHaveBeenCalled()
    expect(retryAnalysis).not.toHaveBeenCalled()
    store.reset()
  })

  it('命中任务读取时已被另一页面重排，接上运行状态且不再次重试', async () => {
    const store = useAiAnalysisStore()
    createAnalysis.mockResolvedValue({ jobId: 'old', status: 'SUCCEEDED', cached: true })
    fetchAnalysis.mockResolvedValue(job(REPORT_A, { jobId: 'old', status: 'RUNNING', result: { summary: '旧正文' } }))
    expect(await store.create(REPORT_A)).toBe(true)
    expect(store.activeJob?.status).toBe('RUNNING')
    expect(store.activeJob?.result?.summary).toBe('旧正文')
    expect(store.createCached).toBe(true)
    expect(retryAnalysis).not.toHaveBeenCalled()
    store.reset()
  })

})
