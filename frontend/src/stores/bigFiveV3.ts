import { defineStore } from 'pinia'
import { describeError, newIdempotencyKey } from '@/api/v3'
import {
  createPlatformAttempt,
  fetchPlatformAttempt,
  isPlatformError,
  patchPlatformAnswers,
  submitPlatformAttempt,
  type AnswerKind,
  type AttemptView,
  type SubmitResponse,
} from '@/api/platformV3'

/**
 * 大五倾向测评的作答状态。
 *
 * ## 与 `assessmentV3`（十六型）的关系
 *
 * 两者**不共用**一个 store，因为完成规则与轮次结构不同：十六型分主测与按维度触发的
 * 补充题两轮、有覆盖检查与"跳过补充题"；大五一次答完、没有补充题。
 * 硬合成一个 store 的结果是每条写入路径上都要问一次"这是哪种量表"。
 *
 * 共同的部分（乐观锁 revision、409 冲突、未保存与已保存的区分）在这一层用同样的方式实现。
 *
 * ## 三条不可妥协的性质
 *
 * 1. **未保存不许显示成已保存**：`pending` 非空就说明有答案没进服务端，
 *    界面必须一直说到它进为止。断网时答案留在内存里，重连后可以再点一次保存。
 * 2. **409 不静默覆盖**：另一台设备改过之后，本地修订号已过期。
 *    这时**不自动重取重写**，而是明确告诉用户"另一台设备更新过"并让他选择重新载入。
 * 3. **提交前必须服务端完整**：本地"50 题都答了"不算数 —— 提交接口会返回
 *    还缺哪些题（可能来自另一台设备的修改），页面按服务端结果回去补。
 */

/** 本地记录的一题作答。 */
export interface LocalAnswer {
  kind: AnswerKind
  rating: number | null
  /** 本地修订号：每次改动 +1，用于区分"这条改过"与"服务端已经有它"。 */
  localRevision: number
}

export interface ConflictChange {
  questionId: string
  local: { kind: AnswerKind | 'CLEAR'; rating: number | null }
  server: { kind: AnswerKind; rating: number | null } | null
}

export interface BigFiveState {
  attempt: AttemptView | null
  /** 本地答案（题号 → 作答）。以服务端返回的 answers 为初始值。 */
  answers: Record<string, LocalAnswer>
  loading: boolean
  loadError: string | null
  saving: boolean
  /** 上一次保存的结果（成功/失败）—— 页面据此显示"已保存 / 未保存"。 */
  lastSaveError: string | null
  lastSavedAt: string | null
  /** 冲突（409）：另一台设备改过。为 true 时禁止保存，直到用户选择重新载入。 */
  conflict: boolean
  conflictMessage: string | null
  conflictServer: AttemptView | null
  conflictChanges: ConflictChange[]
  conflictLocalRevision: number | null
  conflictLoading: boolean
  submitting: boolean
  submitError: string | null
  /** 提交返回"还缺题"时记下缺的题号，答题页据此高亮。 */
  incompleteQuestionIds: string[]
  /** 提交成功后的结果（reportId 由页面用来跳转）。 */
  submitResult: SubmitResponse | null
  /**
   * 本地修订号计数器。
   *
   * 它不是服务端的 `revision`（那是乐观锁），而是**本地**用来回答
   * "哪些改动还没进服务端"的记号。两者混用会得到一个很糟的 bug：
   * 保存成功后本地修订号与服务端修订号看起来一样，于是"未保存"永远显示成"已保存"。
   */
  nextLocalRevision: number
  /** 已被服务端确认的最大本地修订号；任何大于它的答案都是未保存的。 */
  lastSavedLocalRevision: number
  /** 下一次保存要写入的"当前题"（用于换设备后继续在正确的位置）。 */
  pendingCurrentQuestionId: string | null
  /** 撤销也是待保存的修改，不能从待发集合中消失。 */
  pendingClears: Record<string, number>
  generation: number
  /** Same creation intent keeps its key until a fully parsed response succeeds. */
  createKey: string | null
}

const saves = new WeakMap<object, Promise<boolean>>()
const creations = new WeakMap<object, Promise<AttemptView>>()

function localFrom(attempt: AttemptView): Record<string, LocalAnswer> {
  const answers: Record<string, LocalAnswer> = {}
  let revision = 0
  for (const answer of attempt.answers) {
    revision += 1
    answers[answer.questionId] = { kind: answer.kind, rating: answer.rating, localRevision: revision }
  }
  return answers
}

export const useBigFiveStore = defineStore('bigFive', {
  state: (): BigFiveState => ({
    attempt: null,
    answers: {},
    loading: false,
    loadError: null,
    saving: false,
    lastSaveError: null,
    lastSavedAt: null,
    conflict: false,
    conflictMessage: null,
    conflictServer: null,
    conflictChanges: [],
    conflictLocalRevision: null,
    conflictLoading: false,
    submitting: false,
    submitError: null,
    incompleteQuestionIds: [],
    submitResult: null,
    nextLocalRevision: 0,
    lastSavedLocalRevision: 0,
    pendingCurrentQuestionId: null,
    pendingClears: {},
    generation: 0,
    createKey: null,
  }),

  getters: {
    /** 已处理的题数（评分或"说不好"都算处理过）。 */
    answeredCount(state): number {
      return Object.keys(state.answers).length
    },
    requiredCount(state): number {
      return state.attempt?.requiredCount ?? 0
    },
    /** 本地是否每题都处理过。**不等于**服务端已完整 —— 提交时以服务端为准。 */
    locallyComplete(state): boolean {
      return state.attempt !== null && Object.keys(state.answers).length >= state.attempt.requiredCount
    },
    /**
     * 有没有答案还没进服务端。
     *
     * 判据是"存在本地修订号大于已保存修订号的题"。**不能**用服务端的 `revision`
     * 或"已答数"来判断：保存成功后服务端修订号会变，而某一题恰好答得和上次一样时
     * 已答数根本不变 —— 两种判据都会把"未保存"显示成"已保存"。
     */
    hasUnsaved(state): boolean {
      if (Object.keys(state.pendingClears).length > 0) return true
      for (const answer of Object.values(state.answers)) {
        if (answer.localRevision > state.lastSavedLocalRevision) return true
      }
      return false
    },
    unsavedCount(state): number {
      let count = Object.keys(state.pendingClears).length
      for (const answer of Object.values(state.answers)) {
        if (answer.localRevision > state.lastSavedLocalRevision) count += 1
      }
      return count
    },
    /** 缺哪些题（本次会话内本地算出来的，用于作答时提示"还差几题"）。 */
    missingQuestionIds(state): string[] {
      if (!state.attempt) return []
      return state.attempt.items.map((item) => item.id).filter((id) => !state.answers[id])
    },
  },

  actions: {
    /** 载入草稿；同一份草稿有待同步答案时先核对服务端修订，不静默丢弃。 */
    async load(attemptId: string, discardPending = false): Promise<void> {
      const generation = ++this.generation
      this.loading = true
      this.loadError = null
      try {
        const attempt = await fetchPlatformAttempt(attemptId)
        if (generation !== this.generation) return
        this.loading = false
        if (!discardPending && this.attempt?.attemptId === attemptId && this.hasUnsaved) {
          this.saving = false
          if (attempt.revision !== this.attempt.revision) {
            this.conflict = true
            this.conflictServer = null
            this.conflictChanges = []
            this.conflictLocalRevision = null
            this.conflictMessage = '服务端进度已变化，本机尚未同步的答案仍在。请先对照，再决定是否载入服务端进度。'
            this.lastSaveError = null
          } else {
            this.lastSaveError = '服务端进度已核对，本地改动仍待同步。请点击重新保存。'
          }
          return
        }
        this.adopt(attempt)
      } catch (error) {
        if (generation !== this.generation) return
        this.loadError = describe(error)
        throw error
      } finally {
        if (generation === this.generation) this.loading = false
      }
    },

    /** 开始一份新测评并接管它。 */
    async start(instrument = 'bigfive50', idempotencyKey?: string): Promise<AttemptView> {
      const inFlight = creations.get(this)
      if (inFlight) return inFlight
      if (!this.createKey) this.createKey = idempotencyKey ?? newIdempotencyKey()
      const key = this.createKey
      const generation = this.generation
      this.loading = true
      this.loadError = null
      const task = createPlatformAttempt({ instrument, idempotencyKey: key })
      creations.set(this, task)
      try {
        const attempt = await task
        if (generation !== this.generation) throw new Error('账号或草稿已切换，请重新进入测评列表。')
        this.loading = false
        this.adopt(attempt)
        this.createKey = null
        return attempt
      } catch (error) {
        if (generation === this.generation) this.loadError = describe(error)
        throw error
      } finally {
        if (creations.get(this) === task) creations.delete(this)
        if (generation === this.generation) this.loading = false
      }
    },

    /** 用服务端的 attempt 覆盖本地状态。 */
    adopt(attempt: AttemptView): void {
      this.generation += 1
      saves.delete(this)
      this.saving = false
      this.attempt = attempt
      this.answers = localFrom(attempt)
      this.lastSavedLocalRevision = maxLocalRevisionOf(this.answers)
      this.nextLocalRevision = this.lastSavedLocalRevision
      this.pendingClears = {}
      this.pendingCurrentQuestionId = null
      this.lastSavedAt = null
      this.lastSaveError = null
      this.conflict = false
      this.conflictMessage = null
      this.conflictServer = null
      this.conflictChanges = []
      this.conflictLocalRevision = null
      this.conflictLoading = false
      this.submitError = null
      this.incompleteQuestionIds = []
      this.submitResult = null
    },

    /**
     * 记一题的答案（本地）。
     *
     * 只改本地，不自动发请求：自动保存会在用户快速点选时打出一串请求，
     * 而其中任何一个 409 都会让"我到底答了没有"变得说不清。保存由页面显式触发
     * （离开当前题/离开页面/点保存）或由 `saveNow()` 调用。
     */
    setAnswer(questionId: string, kind: AnswerKind, rating: number | null): void {
      this.nextLocalRevision += 1
      delete this.pendingClears[questionId]
      this.answers = {
        ...this.answers,
        [questionId]: { kind, rating, localRevision: this.nextLocalRevision },
      }
      this.lastSaveError = null
      this.incompleteQuestionIds = this.incompleteQuestionIds.filter((id) => id !== questionId)
    },

    /** 清除一题的作答（回到未作答）。 */
    clearAnswer(questionId: string): void {
      if (!this.answers[questionId]) return
      const next = { ...this.answers }
      delete next[questionId]
      this.answers = next
      this.nextLocalRevision += 1
      this.pendingClears[questionId] = this.nextLocalRevision
      this.lastSaveError = null
    },

    /**
     * 把未保存的答案提交到服务端。
     *
     * @returns 是否保存成功；失败时 `lastSaveError` 有可读原因，本地答案**保留**
     */
    async saveNow(currentQuestionId?: string | null): Promise<boolean> {
      if (currentQuestionId !== undefined) this.pendingCurrentQuestionId = currentQuestionId
      if (!this.attempt || this.conflict) return false
      const inFlight = saves.get(this)
      if (inFlight) return inFlight
      const task = this.drainPending()
      saves.set(this, task)
      try {
        return await task
      } finally {
        if (saves.get(this) === task) saves.delete(this)
      }
    },

    /** 一个请求完成后再发送其间产生的修改；所有调用者等待同一轮保存完成。 */
    async drainPending(): Promise<boolean> {
      const generation = this.generation
      this.saving = true
      this.lastSaveError = null
      try {
        while (this.attempt && !this.conflict && generation === this.generation) {
          const attempt = this.attempt
          const sentRevision = this.nextLocalRevision
          const nextCurrent = this.pendingCurrentQuestionId
          const pending: { questionId: string; kind: AnswerKind | 'CLEAR'; rating: number | null }[] =
            Object.entries(this.answers)
              .filter(([, answer]) => answer.localRevision > this.lastSavedLocalRevision)
              .map(([questionId, answer]) => ({ questionId, kind: answer.kind, rating: answer.rating }))
          for (const questionId of Object.keys(this.pendingClears)) {
            pending.push({ questionId, kind: 'CLEAR', rating: null })
          }
          if (pending.length === 0 && !nextCurrent) return true
          const response = await patchPlatformAnswers(attempt.attemptId, {
            expectedRevision: attempt.revision,
            currentQuestionId: nextCurrent,
            responses: pending,
          })
          if (generation !== this.generation) return false
          this.attempt = {
            ...attempt,
            revision: response.revision,
            status: response.status,
            answeredCount: response.answeredCount,
            answerComplete: response.answerComplete,
            currentQuestionId: response.currentQuestionId,
          }
          this.lastSavedLocalRevision = sentRevision
          for (const [questionId, revision] of Object.entries(this.pendingClears)) {
            if (revision <= sentRevision) delete this.pendingClears[questionId]
          }
          this.lastSavedAt = new Date().toISOString()
          if (this.pendingCurrentQuestionId === nextCurrent) this.pendingCurrentQuestionId = null
        }
        return false
      } catch (error) {
        if (generation !== this.generation) return false
        if (isPlatformError(error) && error.code === 'CONFLICT_REVISION') {
          this.conflict = true
          this.conflictServer = null
          this.conflictChanges = []
          this.conflictLocalRevision = null
          this.conflictMessage =
            '服务端进度已变化，本机改动仍保留。请先核对两边的答案，再决定是否重新应用。'
          return false
        }
        this.lastSaveError = describe(error)
        return false
      } finally {
        if (generation === this.generation) this.saving = false
      }
    },

    /** 记住"当前做到哪一题"，随下一次保存一起提交。 */
    rememberCurrentQuestion(questionId: string): void {
      this.pendingCurrentQuestionId = questionId
    },

    /** 只读服务端最新进度，本机待保存内容不动。 */
    async inspectConflict(): Promise<boolean> {
      const attempt = this.attempt
      if (!attempt || !this.conflict || this.conflictLoading) return false
      const generation = this.generation
      this.conflictLoading = true
      this.lastSaveError = null
      try {
        const server = await fetchPlatformAttempt(attempt.attemptId)
        if (generation !== this.generation || this.attempt?.attemptId !== attempt.attemptId) return false
        const serverAnswers = new Map(server.answers.map((answer) => [answer.questionId, answer]))
        const changes: ConflictChange[] = Object.entries(this.answers)
          .filter(([, answer]) => answer.localRevision > this.lastSavedLocalRevision)
          .map(([questionId, answer]) => ({ questionId,
            local: { kind: answer.kind, rating: answer.rating },
            server: serverAnswers.get(questionId) ?? null }))
        for (const questionId of Object.keys(this.pendingClears)) {
          changes.push({ questionId, local: { kind: 'CLEAR', rating: null },
            server: serverAnswers.get(questionId) ?? null })
        }
        this.conflictServer = server
        this.conflictChanges = changes
        this.conflictLocalRevision = this.nextLocalRevision
        return true
      } catch (error) {
        if (generation === this.generation) this.lastSaveError = describe(error)
        return false
      } finally {
        if (generation === this.generation) this.conflictLoading = false
      }
    },

    /** 默认接受服务端；仅显式勾选的本机题目按核对过的修订重应用。 */
    async applyConflictChoices(questionIds: string[]): Promise<boolean> {
      const server = this.conflictServer
      if (!server || !this.conflict || this.conflictLoading || this.saving) return false
      if (this.attempt?.attemptId !== server.attemptId) return false
      const selected = new Set(questionIds)
      if (selected.size !== questionIds.length ||
          [...selected].some((id) => !this.conflictChanges.some((change) => change.questionId === id))) return false
      if (this.conflictLocalRevision !== this.nextLocalRevision) {
        this.conflictMessage = '核对后本机又有新改动，请重新读取服务端进度并核对。'
        return false
      }
      const generation = this.generation
      const localRevision = this.nextLocalRevision
      const changes = this.conflictChanges.filter((change) => selected.has(change.questionId))
      this.saving = true
      this.lastSaveError = null
      try {
        const latest = await fetchPlatformAttempt(server.attemptId)
        if (generation !== this.generation || this.attempt?.attemptId !== server.attemptId) return false
        if (this.nextLocalRevision !== localRevision) {
          this.conflictMessage = '核对期间本机又有新改动，请重新读取并核对。'
          return false
        }
        if (latest.revision !== server.revision) {
          this.conflictServer = null
          this.conflictChanges = []
          this.conflictLocalRevision = null
          this.conflictMessage = '服务端在核对期间又有新改动，请重新读取并核对。'
          return false
        }
        if (changes.length) {
          await patchPlatformAnswers(server.attemptId, {
            expectedRevision: server.revision,
            currentQuestionId: null,
            responses: changes.map((change) => ({ questionId: change.questionId,
              kind: change.local.kind, rating: change.local.rating })),
          })
          if (generation !== this.generation) return false
        }
        const confirmed = changes.length ? await fetchPlatformAttempt(server.attemptId) : latest
        if (generation !== this.generation) return false
        if (this.nextLocalRevision !== localRevision) {
          this.conflictServer = null
          this.conflictChanges = []
          this.conflictLocalRevision = null
          this.conflictMessage = '核对期间本机又有新改动，已保留本机答案，请重新读取并核对。'
          return false
        }
        this.adopt(confirmed)
        return true
      } catch (error) {
        if (generation !== this.generation) return false
        this.lastSaveError = describe(error)
        if (isPlatformError(error) && error.code === 'CONFLICT_REVISION') {
          this.conflictServer = null
          this.conflictChanges = []
          this.conflictLocalRevision = null
          this.conflictMessage = '服务端在核对期间又有新改动，请重新读取并核对。'
        }
        return false
      } finally {
        if (generation === this.generation) this.saving = false
      }
    },

    /**
     * 解决冲突：丢弃本地未保存改动，重新载入服务端版本。
     *
     * 这是**用户显式选择**的动作，不是自动行为 —— 自动重取重写会让两边的答案
     * 无声地互相覆盖。
     */
    async resolveConflictByReloading(): Promise<void> {
      const attempt = this.attempt
      if (!attempt) return
      const dropped = this.unsavedCount
      await this.load(attempt.attemptId, true)
      this.lastSaveError =
        dropped > 0 ? `已重新载入服务端版本，本地那 ${dropped} 条未保存的改动已丢弃。` : null
    },

    /** 提交并生成报告。 */
    async submit(): Promise<SubmitResponse | null> {
      const attempt = this.attempt
      if (!attempt || this.submitting) return null
      const generation = this.generation
      this.submitting = true
      this.submitError = null
      try {
        // 提交前先尝试保存：否则"我明明答完了"与"服务端还缺几题"会同时出现。
        {
          const saved = await this.saveNow()
          if (generation !== this.generation) return null
          if (!saved) {
            this.submitError = this.conflict
              ? this.conflictMessage
              : this.lastSaveError ?? '还有答案没能保存，请先解决上面的提示再提交。'
            return null
          }
        }
        const result = await submitPlatformAttempt(attempt.attemptId, this.attempt?.revision ?? attempt.revision)
        if (generation !== this.generation) return null
        this.submitResult = result
        if (result.status === 'INCOMPLETE') {
          this.incompleteQuestionIds = result.incompleteQuestionIds
          this.submitError =
            `还有 ${result.incompleteQuestionIds.length} 题没有处理过（既没作答也没选「说不上」）。` +
            '补齐之后就能生成报告。'
          return result
        }
        this.incompleteQuestionIds = []
        if (result.reportId) {
          this.attempt = { ...this.attempt!, status: 'SUBMITTED', reportId: result.reportId }
        }
        return result
      } catch (error) {
        if (generation !== this.generation) return null
        if (isPlatformError(error) && error.code === 'CONFLICT_REVISION') {
          this.conflict = true
          this.conflictMessage =
            '另一台设备已经更新了这份草稿。请重新载入最新版本后再提交。'
        }
        this.submitError = describe(error)
        return null
      } finally {
        if (generation === this.generation) this.submitting = false
      }
    },

    /** 离开页面时清掉这一份的状态，避免串到下一份测评上。 */
    suspendForSession(): void {
      this.generation += 1
      this.conflictServer = null
      this.conflictChanges = []
      this.conflictLocalRevision = null
      this.conflictLoading = false
      creations.delete(this)
      this.loading = false
      this.saving = false
      this.submitting = false
      this.loadError = null
      this.lastSaveError = '登录状态已过期，尚未同步的答案仍保留在本页；重新登录后请确认服务端进度。'
    },

    reset(): void {
      this.generation += 1
      saves.delete(this)
      creations.delete(this)
      this.createKey = null
      this.attempt = null
      this.answers = {}
      this.loading = false
      this.loadError = null
      this.saving = false
      this.lastSaveError = null
      this.lastSavedAt = null
      this.conflict = false
      this.conflictMessage = null
      this.conflictServer = null
      this.conflictChanges = []
      this.conflictLocalRevision = null
      this.conflictLoading = false
      this.submitting = false
      this.submitError = null
      this.incompleteQuestionIds = []
      this.submitResult = null
      this.nextLocalRevision = 0
      this.lastSavedLocalRevision = 0
      this.pendingCurrentQuestionId = null
      this.pendingClears = {}
    },
  },
})

/** 当前本地答案里最大的修订号（= 已确认到哪一条）。 */
function maxLocalRevisionOf(answers: Record<string, LocalAnswer>): number {
  let max = 0
  for (const answer of Object.values(answers)) {
    if (answer.localRevision > max) max = answer.localRevision
  }
  return max
}

/**
 * 把异常转成一句给用户看的话。
 *
 * 走 `describeError` 而不是直接读 `error.message`：错误码 → 人话的映射只应该有一份
 * （`api/v3.ts` 的表），否则同一个 401 在答题页与报告页会显示成两句不同的话。
 */
function describe(error: unknown): string {
  const display = describeError(error)
  return display.message
}
