import { defineStore } from 'pinia'
import { describeError } from '@/api/v3'
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
}

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
    submitting: false,
    submitError: null,
    incompleteQuestionIds: [],
    submitResult: null,
    nextLocalRevision: 0,
    lastSavedLocalRevision: 0,
    pendingCurrentQuestionId: null,
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
      for (const answer of Object.values(state.answers)) {
        if (answer.localRevision > state.lastSavedLocalRevision) return true
      }
      return false
    },
    unsavedCount(state): number {
      let count = 0
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
    /** 载入（或重新载入）一份草稿，丢弃本地未保存的改动。 */
    async load(attemptId: string): Promise<void> {
      this.loading = true
      this.loadError = null
      try {
        const attempt = await fetchPlatformAttempt(attemptId)
        this.adopt(attempt)
      } catch (error) {
        this.loadError = describe(error)
        throw error
      } finally {
        this.loading = false
      }
    },

    /** 开始一份新测评并接管它。 */
    async start(instrument = 'bigfive50', idempotencyKey?: string): Promise<AttemptView> {
      this.loading = true
      this.loadError = null
      try {
        const attempt = await createPlatformAttempt({ instrument, idempotencyKey })
        this.adopt(attempt)
        return attempt
      } catch (error) {
        this.loadError = describe(error)
        throw error
      } finally {
        this.loading = false
      }
    },

    /** 用服务端的 attempt 覆盖本地状态。 */
    adopt(attempt: AttemptView): void {
      this.attempt = attempt
      this.answers = localFrom(attempt)
      this.lastSavedLocalRevision = maxLocalRevisionOf(this.answers)
      this.lastSavedAt = null
      this.lastSaveError = null
      this.conflict = false
      this.conflictMessage = null
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
      this.lastSaveError = null
    },

    /**
     * 把未保存的答案提交到服务端。
     *
     * @returns 是否保存成功；失败时 `lastSaveError` 有可读原因，本地答案**保留**
     */
    async saveNow(currentQuestionId?: string | null): Promise<boolean> {
      const attempt = this.attempt
      if (!attempt) return false
      if (this.conflict) {
        // 冲突未解决前不发请求：拿旧 revision 重试只会一直 409，而"重试到成功"
        // 等于绕过乐观锁去覆盖另一台设备的修改。
        return false
      }
      const pending = Object.entries(this.answers)
        .filter(([, answer]) => answer.localRevision > this.lastSavedLocalRevision)
        .map(([questionId, answer]) => ({
          questionId,
          kind: answer.kind,
          rating: answer.rating,
        }))
      const nextCurrent =
        currentQuestionId === undefined ? this.pendingCurrentQuestionId : currentQuestionId
      if (pending.length === 0 && !nextCurrent) return true

      this.saving = true
      this.lastSaveError = null
      try {
        const response = await patchPlatformAnswers(attempt.attemptId, {
          expectedRevision: attempt.revision,
          currentQuestionId: nextCurrent,
          responses: pending,
        })
        // 保存成功后把 attempt 的 revision 推进到服务端返回值：
        // 用本地推算的 revision 会在并发编辑时立刻失真。
        this.attempt = {
          ...attempt,
          revision: response.revision,
          status: response.status,
          answeredCount: response.answeredCount,
          answerComplete: response.answerComplete,
          currentQuestionId: response.currentQuestionId,
        }
        this.lastSavedLocalRevision = maxLocalRevisionOf(this.answers)
        this.lastSavedAt = new Date().toISOString()
        this.pendingCurrentQuestionId = null
        return true
      } catch (error) {
        if (isPlatformError(error) && error.status === 409) {
          this.conflict = true
          this.conflictMessage =
            '另一台设备已经更新了这份草稿。为避免覆盖那边的答案，这里没有自动重写 —— ' +
            '请选择重新载入最新版本（本页未保存的改动会丢失）。'
          return false
        }
        this.lastSaveError = describe(error)
        return false
      } finally {
        this.saving = false
      }
    },

    /** 记住"当前做到哪一题"，随下一次保存一起提交。 */
    rememberCurrentQuestion(questionId: string): void {
      this.pendingCurrentQuestionId = questionId
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
      await this.load(attempt.attemptId)
      this.lastSaveError =
        dropped > 0 ? `已重新载入服务端版本，本地那 ${dropped} 条未保存的改动已丢弃。` : null
    },

    /** 提交并生成报告。 */
    async submit(): Promise<SubmitResponse | null> {
      const attempt = this.attempt
      if (!attempt) return null
      this.submitting = true
      this.submitError = null
      try {
        // 提交前先尝试保存：否则"我明明答完了"与"服务端还缺几题"会同时出现。
        if (this.unsavedCount > 0) {
          const saved = await this.saveNow()
          if (!saved) {
            this.submitError = this.conflict
              ? this.conflictMessage
              : this.lastSaveError ?? '还有答案没能保存，请先解决上面的提示再提交。'
            return null
          }
        }
        const result = await submitPlatformAttempt(attempt.attemptId, this.attempt?.revision ?? attempt.revision)
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
          this.attempt = { ...attempt, status: 'SUBMITTED', reportId: result.reportId }
        }
        return result
      } catch (error) {
        if (isPlatformError(error) && error.status === 409) {
          this.conflict = true
          this.conflictMessage =
            '另一台设备已经更新了这份草稿。请重新载入最新版本后再提交。'
        }
        this.submitError = describe(error)
        return null
      } finally {
        this.submitting = false
      }
    },

    /** 离开页面时清掉这一份的状态，避免串到下一份测评上。 */
    reset(): void {
      this.attempt = null
      this.answers = {}
      this.loading = false
      this.loadError = null
      this.saving = false
      this.lastSaveError = null
      this.lastSavedAt = null
      this.conflict = false
      this.conflictMessage = null
      this.submitting = false
      this.submitError = null
      this.incompleteQuestionIds = []
      this.submitResult = null
      this.nextLocalRevision = 0
      this.lastSavedLocalRevision = 0
      this.pendingCurrentQuestionId = null
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
