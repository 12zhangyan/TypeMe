import { defineStore } from 'pinia'
import { describeError, newIdempotencyKey, type ErrorDisplay } from '@/api/v3'
import {
  aiFailureHint,
  createAnalysis,
  fetchAiStatus,
  fetchAnalysis,
  fetchReportAnalyses,
  isRunning,
  retryAnalysis,
  type AiStatus,
  type AnalysisJob,
  type AnalysisTopic,
} from '@/api/v3Ai'

/**
 * AI 分析 store —— 契约 `03-AI与前端契约-v1.md` §2 / §3。
 *
 * ## 为什么轮询放在 store 而不是页面
 *
 * 分析是异步任务：创建返回 202，结果要么轮询拿到，要么就永远不知道。
 * 轮询必须能被**干净地停掉**（离开报告页、切换报告、组件卸载），
 * 而"谁在跑、怎么停"这类状态如果放在组件里，很容易出现
 * "页面销毁了 timer 还在跑、回来时两个 timer 一起跑"。
 * 所以这里把 timer 与 generation 计数器都收在 store 内，对外只暴露 `startPolling` / `stopPolling`。
 *
 * ## 2026-09-18（第 17 轮）修复：这个 store 是**单例**，所以它必须自己记住"属于哪一份报告"
 *
 * 修之前这里只有 `jobs`，没有任何归属信息，于是有四个同源的缺陷（每一处都能单独讲通）：
 *
 * 1. `loadJobs(B)` 在途时 `jobs` 里还留着 A 的任务 → 打开报告 B 的首屏会**渲染出 A 的分析正文**
 *    （`activeJob` 取 `jobs[0]`）。若这次列表请求再失败（离线/500/401），`catch` 只写
 *    `jobsError`（而没有任何页面读它），A 的分析就会**永久**留在 B 的页面上。
 * 2. 退出登录不清理这个 store（`auth` 只清自己的状态），共用设备上换号后同样能看见上一个用户的
 *    AI 正文，以及他的剩余额度。
 * 3. `startPolling()` 会在**任何**迟到的异步完成之后被调用（`loadJobs` / `create` / `retry` 三处），
 *    而 `startPolling` 会自己先 `stopPolling` 再建新 timer —— 新 timer 带的是**当前** generation，
 *    所以 `pollOnce` 里的 generation 守卫拦不住它。结果是：用户已经离开页面（`onBeforeUnmount`
 *    停过轮询），一个迟到的响应又把轮询重新武装起来，最多空转 `POLL_MAX_MS`。
 * 4. `reset()` 存在但零调用点 —— 一条"写好了却没人用"的清理路径，等价于没有。
 *
 * 修法是把归属做成 store 的**不变量**，而不是在四个地方各加一个 if：
 *
 * - `reportId` 是当前"拥有者"。切换到另一份报告时**先清空** job 与相关状态（不留旧数据），
 *   并按 `loadToken` 丢弃上一份报告的迟到响应；
 * - 对外暴露的 `ownJobs` / `activeJob` / `hasRunning` 一律只看属于当前报告的任务，
 *   即使将来某条写路径漏了守卫，别人的任务也**渲染不出来**；
 * - `startPolling()` 自检"仍拥有某份报告且确实有在跑的任务"，`reset()` 把 `reportId` 置空，
 *   于是"离开页面后又被重新武装"在入口上就不可能发生；
 * - `reset()` 接进退出登录与面板卸载两条真实路径。
 *
 * ## 额度与"能不能用"分开
 *
 * `status` 说"这台服务器有没有开 AI、今天还剩几次"；`jobs` 说"这份报告已经有哪些任务"。
 * 两者互不阻塞：AI 没开时列表照常为空，页面据此显示"这台服务器没开这项能力"，
 * 而不是让用户点一个注定 503 的按钮。
 * 注意 `remainingToday` 是**按账号**算的，所以它随 `reset()` 一起清掉。
 *
 * ## 不显示的东西
 *
 * 这里的 state 只保存页面要用的字段（见 `api/v3Ai.ts` 的说明），
 * 不留原始 JSON、不保存 note 的副本（note 是用户自己写的近况，发出去就够了）。
 */

/** 轮询间隔：AI 用时通常 10–60s，3 秒一次足够，也不至于把后端打满。 */
const POLL_INTERVAL_MS = 3000
/**
 * 轮询上限：超过这个时长就不再自动问，页面提示"可以稍后重看"。
 *
 * 为什么要有上限：任务卡在 RUNNING（worker 挂了、lease 过期）时，
 * 一个永不停止的轮询会一直发请求，用户却看不到任何变化。停在 4 分钟后
 * 让用户自己重新检查/刷新，比无限轮询更诚实。
 *
 * **这是"无人在看时"的上限**：面板重新挂载（用户从别处回到这份报告）时
 * 由 `loadJobs` 重新计时，因为契约 §6 明确要求"离开页面后从历史报告返回继续轮询" ——
 * 用户回来时任务可能早就好了，不接上就永远看不到结果。
 */
const POLL_MAX_MS = 4 * 60 * 1000

interface AiState {
  status: AiStatus | null
  statusError: ErrorDisplay | null
  statusLoading: boolean

  /**
   * 这个 store 当前**归属**的报告 id。
   *
   * `null` 表示"谁也不属于"（还没挂载 / 已卸载 / 已退出登录）。它不是"当前路由"的副本：
   * 它是唯一允许写入 job 状态的那份报告，其它报告的数据一律丢弃。
   */
  reportId: string | null

  /** 当前报告下的全部任务（倒序，服务端给的顺序）。 */
  jobs: AnalysisJob[]
  jobsLoading: boolean
  jobsError: ErrorDisplay | null

  /** 当前正在展示/轮询的任务 id。 */
  activeJobId: string | null
  creating: boolean
  createError: ErrorDisplay | null
  /** 上次创建是否命中了服务端去重（没有新建任务、也没有再扣额度）。 */
  createCached: boolean
  retrying: boolean

  /** 创建时用的主题与近况（只活在本次会话内）。 */
  topic: AnalysisTopic
  note: string

  /** 轮询超过上限时的说明。 */
  pollingGaveUp: boolean
}

let timer: ReturnType<typeof setInterval> | null = null
let pollingStartedAt = 0
/** 每次 `stopPolling` 递增：回调里对不上就丢弃，避免旧 timer 的结果覆盖新状态。 */
let generation = 0
/**
 * 每次"归属变化或重新读列表"递增。
 *
 * 与 `generation` 分工不同：`generation` 管**轮询回调**，这个管**一次性请求**
 * （`loadJobs`）。两个并发 `loadJobs` 只有最后发起的那个可以写入状态。
 */
let loadToken = 0
/** 上一次轮询是否还没回来。慢请求下不允许叠加下一次（否则状态会短暂回退）。 */
let pollInFlight = false

export const useAiAnalysisStore = defineStore('aiAnalysisV3', {
  state: (): AiState => ({
    status: null,
    statusError: null,
    statusLoading: false,
    reportId: null,
    jobs: [],
    jobsLoading: false,
    jobsError: null,
    activeJobId: null,
    creating: false,
    createError: null,
    createCached: false,
    retrying: false,
    topic: 'overall',
    note: '',
    pollingGaveUp: false,
  }),

  getters: {
    /** AI 在这台服务器上是否可用。`null`（还没问到）按"不可用"处理，不显示按钮。 */
    available(state): boolean {
      return state.status?.enabled === true
    },

    /** 今天的剩余次数。尚未登录或问不到时为 null（页面就不显示"还剩几次"）。 */
    remainingToday(state): number | null {
      if (!state.status || !state.status.enabled) return null
      return state.status.remainingToday < 0 ? null : state.status.remainingToday
    },

    /**
     * 只属于当前报告的 task。页面**必须**只渲染这一份，不要直接渲染 `state.jobs`。
     *
     * 过滤而不是"相信 jobs 一定干净"，是因为这份列表是渲染源：一个漏掉的写路径
     * 在这里的代价是"把别人的分析显示给你"，而在别处只是多几行日志。
     */
    ownJobs(state): AnalysisJob[] {
      if (state.reportId === null) return []
      return state.jobs.filter((job) => job.reportId === state.reportId)
    },

    /**
     * 当前展示的任务：优先用户点选的那条（`activeJobId`），否则取最新一条。
     *
     * `ownJobs` 的顺序就是服务端给的顺序（按创建时间倒序），所以 `[0]` 天然是
     * "最近一次生成"。这里刻意**不**再加一个"最新成功的那条"的 getter：
     * 写出来却没人用，会让人以为页面有"失败时不显示旧结果"的逻辑，其实没有。
     */
    activeJob(): AnalysisJob | null {
      if (this.activeJobId) {
        const found = this.ownJobs.find((job) => job.jobId === this.activeJobId)
        if (found) return found
      }
      return this.ownJobs[0] ?? null
    },

    /**
     * 有没有正在跑的任务（决定是否显示"正在生成"、是否轮询、能否再建一个）。
     *
     * 用**全部**属于自己的任务，而不是只有当前展示的那一条：用户可以在历史里点一条
     * 失败的任务去看，但那不代表"没有任务在跑"。
     */
    hasRunning(): boolean {
      return this.ownJobs.some((job) => isRunning(job))
    },
  },

  actions: {
    /** 问"这台服务器开没开 AI、今天还剩几次"。失败不抛：页面降级成不显示入口。 */
    async loadStatus(): Promise<void> {
      this.statusLoading = true
      this.statusError = null
      try {
        this.status = await fetchAiStatus()
      } catch (error) {
        this.status = null
        this.statusError = describeError(error)
      } finally {
        this.statusLoading = false
      }
    },

    /**
     * 读这份报告已有的分析任务，并把它认作 store 的归属报告。
     *
     * 三条纪律：
     * 1. 换报告时**先清空**——旧任务不能在新报告的首屏上出现哪怕一帧；
     * 2. 迟到的响应按 `loadToken` 丢弃；归属被 `reset()` 清掉后也不写；
     * 3. 失败时 `jobs` 保持为空，并把失败留在 `jobsError` 里让页面**显示出来**
     *    （"读不到"和"这份报告还没有分析"是两件不同的事，不能长得一样）。
     */
    async loadJobs(reportId: string): Promise<void> {
      if (this.reportId !== reportId) {
        this.stopPolling()
        this.reportId = reportId
        this.jobs = []
        this.activeJobId = null
        this.jobsError = null
        this.createError = null
        this.createCached = false
        this.pollingGaveUp = false
      }
      const token = ++loadToken
      this.jobsLoading = true
      this.jobsError = null
      try {
        const jobs = await fetchReportAnalyses(reportId)
        if (token !== loadToken || this.reportId !== reportId) return
        this.jobs = jobs.filter((job) => job.reportId === reportId)
        // 有正在跑的任务就自动接上轮询：用户刷新页面回来时不该丢掉进度。
        this.startPolling()
      } catch (error) {
        if (token !== loadToken || this.reportId !== reportId) return
        this.jobsError = describeError(error)
      } finally {
        if (token === loadToken) this.jobsLoading = false
      }
    },

    /**
     * 创建一次分析。
     *
     * 幂等键在这里生成并在**同一次点击**内保持不变：`createAnalysis` 的调用只有一次，
     * 但服务端可能因为超时重发而收到两次，键相同就不会扣两次额度、也不会建两个任务。
     * 服务端还会对"同一份范围"做去重（`cached=true`），页面据此说明"这次没有重复扣额度"。
     */
    async create(reportId: string): Promise<void> {
      if (this.creating) return
      // 归属由 `loadJobs` 设定；这里只在"还没认领"时补上，认领了别的报告就不动。
      if (this.reportId === null) this.reportId = reportId
      if (this.reportId !== reportId) return
      const owner = reportId
      this.creating = true
      this.createError = null
      this.createCached = false
      this.pollingGaveUp = false
      try {
        const result = await createAnalysis({
          reportId,
          topic: this.topic,
          note: this.note,
          scopeVersion: this.status?.promptVersion === 'typeme-ai-prompt-v3'
            ? 'typeme-ai-scope-v3' : 'typeme-ai-scope-v2',
          idempotencyKey: newIdempotencyKey(),
        })
        // 请求在途时用户可能已经离开或换了一份报告：这份结果就不要再写进状态了。
        if (this.reportId !== owner) return
        this.activeJobId = result.jobId
        // 先放一条占位：界面立刻能看到"已排队"，而不用等第一次轮询。
        this.jobs = [
          {
            jobId: result.jobId,
            reportId,
            status: result.status,
            topic: this.topic,
            promptVersion: null,
            modelRequested: null,
            modelReturned: null,
            errorCode: null,
            attemptCount: 0,
            createdAt: new Date().toISOString(),
            finishedAt: null,
            result: null,
            resultProblems: [],
            mock: this.status?.mock === true,
          },
          ...this.jobs.filter((job) => job.jobId !== result.jobId),
        ]
        this.createCached = result.cached
        this.startPolling()
        // 额度可能变了（或者刚才是 -1），刷新一次状态。
        void this.loadStatus()
      } catch (error) {
        if (this.reportId !== owner) return
        this.createError = describeError(error)
      } finally {
        this.creating = false
      }
    },

    /**
     * 重试失败的任务（复用同一行，不新建）。
     *
     * 不需要额外的 `reportId` 参数：**任务必须属于当前报告**才允许重试 ——
     * 这一条是必需的，因为面板共用同一个 store，而 `activeJob` 曾经可能指向别的报告
     * （见文件头 §2026-09-18）。不在这里比对的话，B 页面上点"再试一次"重排的可能是 A 的任务。
     */
    async retry(jobId: string): Promise<void> {
      if (this.retrying) return
      const owner = this.reportId
      const target = this.ownJobs.find((job) => job.jobId === jobId)
      if (owner === null || !target) return
      this.retrying = true
      this.createError = null
      this.createCached = false
      this.pollingGaveUp = false
      try {
        const result = await retryAnalysis(jobId)
        if (this.reportId !== owner) return
        this.activeJobId = result.jobId
        this.patchJob(result.jobId, (job) => ({ ...job, status: result.status, attemptCount: result.attemptCount }))
        this.startPolling()
      } catch (error) {
        if (this.reportId !== owner) return
        this.createError = describeError(error)
      } finally {
        this.retrying = false
      }
    },

    /** 只更新一条任务，保留其余（列表顺序不变）。 */
    patchJob(jobId: string, update: (job: AnalysisJob) => AnalysisJob): void {
      this.jobs = this.jobs.map((job) => (job.jobId === jobId ? update(job) : job))
    },

    /**
     * 开始轮询。重复调用是安全的：会先停掉旧的 timer 再起新的。
     *
     * `generation` 是防"旧 timer 的回调写进新状态"的关键：每次停止都递增，
     * 回调开头对不上就直接返回。
     *
     * **前提自检**是这一步的必要条件（不只是防御性代码）：没有它，任何迟到的
     * `loadJobs` / `create` / `retry` 完成都会在用户离开页面之后把轮询重新点着，
     * 而新 timer 的 generation 就是当前值，回调里的守卫拦不住它。
     */
    startPolling(): void {
      if (this.reportId === null || !this.hasRunning) {
        this.stopPolling()
        return
      }
      this.stopPolling()
      pollingStartedAt = Date.now()
      const myGeneration = generation
      timer = setInterval(() => {
        void this.pollOnce(myGeneration)
      }, POLL_INTERVAL_MS)
    },

    async pollOnce(myGeneration: number): Promise<void> {
      if (myGeneration !== generation) return
      // 上一次还没回来：这一拍直接跳过。否则一个慢请求会让两个响应乱序落地，
      // 较旧的 RUNNING 快照可能盖掉较新的 SUCCEEDED。
      if (pollInFlight) return
      if (Date.now() - pollingStartedAt > POLL_MAX_MS) {
        this.stopPolling()
        this.pollingGaveUp = true
        return
      }
      const running = this.ownJobs.filter((job) => isRunning(job))
      if (running.length === 0) {
        // 没有在跑的任务就不该继续问：否则一个"全部成功"的报告会一直发请求。
        this.stopPolling()
        return
      }
      const owner = this.reportId
      pollInFlight = true
      try {
        for (const job of running) {
          try {
            const fresh = await fetchAnalysis(job.jobId)
            if (myGeneration !== generation || this.reportId !== owner) return
            this.patchJob(fresh.jobId, () => fresh)
          } catch (error) {
            if (myGeneration !== generation || this.reportId !== owner) return
            // 单次失败不停止轮询：网络抖一下很常见，下一次通常会成功。
            // 但把错误留痕，页面在"一直没动静"时显示它。
            this.jobsError = describeError(error)
          }
        }
      } finally {
        pollInFlight = false
      }
      if (!this.hasRunning && myGeneration === generation) {
        this.stopPolling()
        void this.loadStatus()
      }
    },

    stopPolling(): void {
      generation += 1
      pollInFlight = false
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },

    /**
     * 放弃这份报告：停轮询、丢弃在途响应、清掉与它绑定的**全部**状态。
     *
     * 两条真实调用路径（不是"留着备用"）：
     * - 面板卸载（离开报告页）；
     * - 退出登录（`auth` 里调用）—— `status.remainingToday` 是按账号算的，
     *   同一台设备换号后必须重新问，否则会显示上一个用户的额度。
     */
    reset(): void {
      this.stopPolling()
      // 让在途的 loadJobs / create / retry 结果全部失效。
      loadToken += 1
      this.reportId = null
      this.jobs = []
      this.jobsLoading = false
      this.jobsError = null
      this.activeJobId = null
      this.createError = null
      this.createCached = false
      this.pollingGaveUp = false
      this.note = ''
      this.topic = 'overall'
      this.status = null
      this.statusError = null
    },

    /** 给页面用的一句话失败说明（把错误码翻成"用户该做什么"）。 */
    failureHint(job: AnalysisJob | null): string {
      return aiFailureHint(job?.errorCode ?? null, this.createError)
    },
  },
})
