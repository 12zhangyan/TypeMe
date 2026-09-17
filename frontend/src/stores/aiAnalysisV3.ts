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
 * ## 额度与"能不能用"分开
 *
 * `status` 说"这台服务器有没有开 AI、今天还剩几次"；`jobs` 说"这份报告已经有哪些任务"。
 * 两者互不阻塞：AI 没开时列表照常为空，页面据此显示"这台服务器没开这项能力"，
 * 而不是让用户点一个注定 503 的按钮。
 *
 * ## 不显示的东西
 *
 * 这里的 state 只保存页面要用的字段（见 `api/v3Ai.ts` 的说明），
 * 不留原始 JSON、不保存 note 的副本（note 是用户自己写的近况，发出去就够了）。
 */

/** 轮询间隔：AI 用时通常 10–60s，3 秒一次足够，也不至于把后端打满。 */
const POLL_INTERVAL_MS = 3000
/**
 * 轮询上限：超过这个时长就不再自动问，页面提示"可以在列表里稍后回看"。
 *
 * 为什么要有上限：任务卡在 RUNNING（worker 挂了、lease 过期）时，
 * 一个永不停止的轮询会一直发请求，用户却看不到任何变化。停在 4 分钟后
 * 让用户自己刷新/重试，比无限轮询更诚实。
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

  /** 该报告下的全部任务（倒序，服务端给的顺序）。 */
  jobs: AnalysisJob[]
  jobsLoading: boolean
  jobsError: ErrorDisplay | null

  /** 当前正在展示/轮询的任务 id。 */
  activeJobId: string | null
  creating: boolean
  createError: ErrorDisplay | null
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

export const useAiAnalysisStore = defineStore('aiAnalysisV3', {
  state: (): AiState => ({
    status: null,
    statusError: null,
    statusLoading: false,
    jobs: [],
    jobsLoading: false,
    jobsError: null,
    activeJobId: null,
    creating: false,
    createError: null,
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
     * 当前展示的任务：优先用户点选的那条（`activeJobId`），否则取最新一条。
     *
     * `jobs` 的顺序就是服务端给的顺序（按创建时间倒序），所以 `jobs[0]` 天然是
     * "最近一次生成"。这里刻意**不**再加一个"最新成功的那条"的 getter：
     * 写出来却没人用，会让人以为页面有"失败时不显示旧结果"的逻辑，其实没有。
     */
    activeJob(state): AnalysisJob | null {
      if (state.activeJobId) {
        const found = state.jobs.find((job) => job.jobId === state.activeJobId)
        if (found) return found
      }
      return state.jobs[0] ?? null
    },

    /** 有没有正在跑的任务（决定是否显示"正在生成"与是否轮询）。 */
    hasRunning(state): boolean {
      return state.jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING')
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

    /** 读这份报告已有的分析任务。 */
    async loadJobs(reportId: string): Promise<void> {
      this.jobsLoading = true
      this.jobsError = null
      try {
        const jobs = await fetchReportAnalyses(reportId)
        this.jobs = jobs
        // 有正在跑的任务就自动接上轮询：用户刷新页面回来时不该丢掉进度。
        if (jobs.some((job) => job.status === 'QUEUED' || job.status === 'RUNNING')) {
          this.startPolling()
        }
      } catch (error) {
        this.jobsError = describeError(error)
      } finally {
        this.jobsLoading = false
      }
    },

    /**
     * 创建一次分析。
     *
     * 幂等键在这里生成并在**同一次点击**内保持不变：`createAnalysis` 的调用只有一次，
     * 但服务端可能因为超时重发而收到两次，键相同就不会扣两次额度、也不会建两个任务。
     */
    async create(reportId: string): Promise<void> {
      if (this.creating) return
      this.creating = true
      this.createError = null
      this.pollingGaveUp = false
      try {
        const result = await createAnalysis({
          reportId,
          topic: this.topic,
          note: this.note,
          idempotencyKey: newIdempotencyKey(),
        })
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
        if (result.cached) {
          // 命中去重：拿到的是同一份范围的既有任务，没有新建。
          // 页面用"这次没有重复扣额度"来表述，别说成"复用了旧结果"。
          this.createError = null
        }
        this.startPolling()
        // 额度可能变了（或者刚才是 -1），刷新一次状态。
        void this.loadStatus()
      } catch (error) {
        this.createError = describeError(error)
      } finally {
        this.creating = false
      }
    },

    /**
     * 重试失败的任务（复用同一行，不新建）。
     *
     * 不需要 `reportId`：任务本身已经绑定了报告，服务端只认 `jobId` + 当前用户。
     * 传进来却不使用，比不传更容易让人以为这里做了什么归属校验。
     */
    async retry(jobId: string): Promise<void> {
      if (this.retrying) return
      this.retrying = true
      this.createError = null
      this.pollingGaveUp = false
      try {
        const result = await retryAnalysis(jobId)
        this.activeJobId = result.jobId
        this.patchJob(result.jobId, (job) => ({ ...job, status: result.status, attemptCount: result.attemptCount }))
        this.startPolling()
      } catch (error) {
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
     */
    startPolling(): void {
      this.stopPolling()
      pollingStartedAt = Date.now()
      const myGeneration = generation
      timer = setInterval(() => {
        void this.pollOnce(myGeneration)
      }, POLL_INTERVAL_MS)
    },

    async pollOnce(myGeneration: number): Promise<void> {
      if (myGeneration !== generation) return
      if (Date.now() - pollingStartedAt > POLL_MAX_MS) {
        this.stopPolling()
        this.pollingGaveUp = true
        return
      }
      const running = this.jobs.filter((job) => isRunning(job))
      if (running.length === 0) {
        // 没有在跑的任务就不该继续问：否则一个"全部成功"的报告会一直发请求。
        this.stopPolling()
        return
      }
      for (const job of running) {
        try {
          const fresh = await fetchAnalysis(job.jobId)
          if (myGeneration !== generation) return
          this.patchJob(fresh.jobId, () => fresh)
        } catch (error) {
          if (myGeneration !== generation) return
          // 单次失败不停止轮询：网络抖一下很常见，下一次通常会成功。
          // 但把错误留痕，页面在"一直没动静"时可以显示它。
          this.jobsError = describeError(error)
        }
      }
      if (!this.hasRunning && myGeneration === generation) {
        this.stopPolling()
        void this.loadStatus()
      }
    },

    stopPolling(): void {
      generation += 1
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    },

    /** 离开报告页时调用：停轮询并清掉与这份报告绑定的状态。 */
    reset(): void {
      this.stopPolling()
      this.jobs = []
      this.jobsError = null
      this.activeJobId = null
      this.createError = null
      this.pollingGaveUp = false
      this.note = ''
      this.topic = 'overall'
    },

    /** 给页面用的一句话失败说明（把错误码翻成"用户该做什么"）。 */
    failureHint(job: AnalysisJob | null): string {
      return aiFailureHint(job?.errorCode ?? null, this.createError)
    },
  },
})
