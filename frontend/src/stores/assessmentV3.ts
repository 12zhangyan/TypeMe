import { defineStore } from 'pinia'
import {
  createAttempt,
  currentRevisionOf,
  fetchAttemptDetail,
  patchAnswers,
  reviewAttempt,
  submitAttempt,
  type AnswerPatch,
  type AttemptDetail,
  type CoverageView,
  type PackageView,
  type ReviewResult,
  type SubmitResult,
} from '@/api/v3Assessment'
import { describeError, isV3ApiError, type ErrorDisplay } from '@/api/v3'
import { isRevisionConflict } from '@/api/v3'
import { checkCoverage, score, type ScoringResult } from '@/domain/jung/scoring'
import {
  DIMENSIONS,
  type Answer,
  type Dimension,
  type ContentPackage,
  type Item,
  type Stage,
} from '@/domain/jung/types'

/**
 * 新测草稿 store —— 契约 `03-AI与前端契约-v1.md` §7.1 / §7.4。
 *
 * ## 存的是什么、不存什么
 *
 * 存：
 *   - 服务端 attempt（含 `revision`）与**已同步**的答案；
 *   - 本次测评锁定的内容包视图（题目正文来自服务端，不在浏览器里另存一份）。
 *
 * 不存：
 *   - 任何四字母结论。本地算出来的分数只用于答题过程中的"目前的粗略倾向"，
 *     提交后一律以服务端 `report_json` 为准（见 `domain/jung/scoring.ts` 的说明）。
 *   - 任何凭据。
 *
 * ## revision 冲突（契约 §7.2 PATCH 语义 1）
 *
 * 同一份草稿可能同时在两台设备上打开。服务端用 `expectedRevision` 做乐观并发控制，
 * 不匹配就回 `409 CONFLICT_REVISION` + `details.currentRevision`。
 * 前端**唯一正确**的处理是：**停止写入**、把"另一台设备改过进度"明确告诉用户、
 * 然后重新拉取。静默重试（用新 revision 重发）等于把对方的答案覆盖掉，
 * 是本模块最不可接受的失败模式，所以冲突态一旦置上，就必须由用户显式重新载入才解除。
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict'

/**
 * 1–5 档 → 文案（1 基）。**全站唯一一份**：`AssessView` 与冲突提示都从这里取。
 *
 * <p>刻意不复用旧引擎的 `ANSWER_CAPTIONS`：那是「完全是左边 / 一半一半 / 完全是右边」，
 * 描述的是位置；新测要的是"哪一侧更像你"的程度（很像 / 更像 / 差不多），
 * 两者在"3 分"这一档上的含义不同。契约把文案写死成这五个词，就是为了避免
 * 两代产品在同一个控件上说两套话；同理，同代里也不允许存在第二份。
 */
export const SCALE_CAPTIONS = ['很像左边', '更像左边', '两边差不多', '更像右边', '很像右边'] as const

export interface ConflictState {
  /** 服务端当前 revision（来自 `details.currentRevision`；拿不到时为 null）。 */
  currentRevision: number | null
  /** 用户看到的一句话。 */
  message: string
  /** 还没能写上去的题号。 */
  pendingQuestionIds: string[]
  /**
   * 尚未写上去、且即将随"载入最新进度"一起被丢弃的作答内容。
   *
   * <p>**为什么必须有这一项**：`pendingQuestionIds` 只给题号，对用户没有意义 ——
   * 他需要知道"是第几题、我选的是哪一档"，否则横幅只能说一句"刚才的改动没有写上去"，
   * 而这句话既不能让他核对，也不能让他在载入之后把那题补回来。
   * 字段的旧注释写着"（重新载入后可以对照查看）"，但那时的代码只写不读，这条路径从未存在。
   */
  lostAnswers: LostAnswer[]
}

/** 冲突中被丢弃的一条作答。 */
export interface LostAnswer {
  questionId: string
  /** 1–5 的档位；`null` 表示这条是「这题我说不好」（一次作答，不计分）。 */
  rating: number | null
}

interface AssessmentState {
  attemptId: string | null
  status: string
  revision: number
  currentQuestionId: string | null
  clarificationDimensions: Dimension[]
  clarificationSkipped: boolean
  packageView: PackageView | null
  answers: Record<string, Answer>
  coverage: CoverageView[]
  saveState: SaveState
  /** 已保存过一次（用于区分"从来没写过"和"写成功了"）。 */
  savedAtLeastOnce: boolean
  /**
   * 本地改了、但**还没被服务端确认**的作答（题号 → 当时要写上去的内容）。
   *
   * <p>**为什么必须有这一项**（2026-09-17 第 15 轮）：`flush()` 每次只发当前这一条，
   * 失败时只把 `saveState` 置成 `'error'` 并把错误放进 `lastError`。于是——
   *
   * <ol>
   *   <li>答 Q10 时 PATCH 超时 → 左栏显示「未同步（网络或登录已失效）」；</li>
   *   <li>继续答 Q11，这次成功 → `saveState` 被**无条件**置回 `'saved'`；</li>
   *   <li>Q10 在服务端从未存在，而界面写着「已保存」。刷新后 Q10 回到未作答。</li>
   * </ol>
   *
   * <p>失败被后一次成功掩盖掉，是"未保存不得显示成已保存"最直接的违反。
   * 有了这份集合：失败的那条会在下一次写入时**一并重发**（服务端是 upsert，
   * 重复发同一条没有副作用），并且只要集合非空，状态就不允许回到 `'saved'`。
   */
  unconfirmed: Record<string, Answer>
  conflict: ConflictState | null
  loading: boolean
  lastError: ErrorDisplay | null
  /** 本次 review 的结果（是否安排补充题）。 */
  review: ReviewResult | null
  /** 覆盖不足时服务端给出的维度名单。 */
  insufficientDimensions: Dimension[]
  /** 建 attempt 的幂等键：一次点击复用一个，断网重试不会产生两份草稿。 */
  createKey: string | null
}

/** 服务端 `kind` 与前端域模型的小写口径对齐。 */
function toAnswer(kind: 'rating' | 'unknown', rating: number | null): Answer | null {
  if (kind === 'rating') return rating === null ? null : { questionId: '', kind: 'rating', rating }
  return { questionId: '', kind: 'unknown' }
}

/** 把服务端的内容包视图转成前端域模型（`Item` 需要 `provenance`，服务端不下发）。 */
function toContentPackage(view: PackageView): ContentPackage {
  const questions: Item[] = view.questions.map((question) => ({
    id: question.id,
    stage: question.stage,
    dimension: question.dimension,
    scenario: question.scenario,
    textLeft: question.textLeft,
    textRight: question.textRight,
    leftPole: (question.leftPole || 'I') as Item['leftPole'],
    rightPole: (question.rightPole || 'E') as Item['rightPole'],
    help: question.help,
    facet: question.facet,
    order: question.order,
    reviewStatus: question.reviewStatus,
    // ⚠️ 服务端的 `PackageResponse` 不下发 `provenance`（契约 §7.2 的实现里没有它）。
    // 空字符串是**唯一**诚实的取值：题目出处属于内容审校信息，前端不臆造。
    provenance: '',
  }))
  return {
    schemaVersion: view.schemaVersion,
    packageId: view.packageId,
    instrument: {
      id: view.instrument.id,
      revision: view.instrument.revision,
      scoringVersion: view.instrument.scoringVersion,
      reportContentVersion: view.instrument.reportContentVersion,
      format: view.instrument.format,
      hasTypeCode: view.instrument.hasTypeCode,
      baseItemsPerDimension: view.instrument.baseItemsPerDimension,
      clarificationItemsPerDimension: view.instrument.clarificationItemsPerDimension,
      maxClarificationItems: view.instrument.maxClarificationItems,
    },
    title: view.title,
    contentStatus: view.contentStatus,
    scoringPolicy: {
      version: view.scoringPolicy.version,
      minBaseRatingsPerDimension: view.scoringPolicy.minBaseRatingsPerDimension,
      boundaryNumerator: view.scoringPolicy.boundaryNumerator,
      boundaryDenominator: view.scoringPolicy.boundaryDenominator,
      ratingMin: view.scoringPolicy.ratingMin,
      ratingMax: view.scoringPolicy.ratingMax,
      ratingNeutral: view.scoringPolicy.ratingNeutral,
    },
    dimensions: view.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      name: dimension.name,
      question: dimension.question,
      negativePole: { ...dimension.negativePole, pole: dimension.negativePole.pole as Item['leftPole'] },
      positivePole: { ...dimension.positivePole, pole: dimension.positivePole.pole as Item['leftPole'] },
      balanced: dimension.balanced ?? { summary: '', reading: '' },
      tiedNotice: dimension.tiedNotice ?? '',
    })),
    questions,
    sha256: view.sha256,
  }
}

/** 已锁定的内容包（域模型）。 */
function contentPackageOf(view: PackageView | null): ContentPackage | null {
  return view ? toContentPackage(view) : null
}

export const useAssessmentStore = defineStore('assessmentV3', {
  state: (): AssessmentState => ({
    attemptId: null,
    status: '',
    revision: 0,
    currentQuestionId: null,
    clarificationDimensions: [],
    clarificationSkipped: false,
    packageView: null,
    answers: {},
    coverage: [],
    saveState: 'idle',
    savedAtLeastOnce: false,
    unconfirmed: {},
    conflict: null,
    loading: false,
    lastError: null,
    review: null,
    insufficientDimensions: [],
    createKey: null,
  }),

  getters: {
    /**
     * 已锁定的内容包（域模型）；没装载成功时为 null。
     *
     * ⚠️ 下面的 getter 一律**不通过 `this` 调其他 getter**：Pinia 对这种相互引用的
     * 推断会失败（`this.contentPackage` 在 getter 内部解析成 `any`/不存在），
     * 而类型一旦退化成 any，"维度名拼错"这类最该被编译器抓住的问题就漏过去了。
     * 因此这里统一走模块级纯函数，输入显式、类型确定。
     */
    contentPackage(state): ContentPackage | null {
      return contentPackageOf(state.packageView)
    },

    /** 主测题（顺序由服务端给定，这里不重排）。 */
    baseQuestions(state): Item[] {
      return (contentPackageOf(state.packageView)?.questions ?? []).filter(
        (item) => item.stage === 'base',
      )
    },

    /** 补充题（全部题目，不只已安排的）。 */
    clarificationQuestions(state): Item[] {
      return (contentPackageOf(state.packageView)?.questions ?? []).filter(
        (item) => item.stage === 'clarification',
      )
    },

    /** 已安排的补充题**只属于**服务端决定的维度，前端不自行挑题。 */
    scheduledClarificationQuestions(state): Item[] {
      const scheduled = state.clarificationDimensions
      return (contentPackageOf(state.packageView)?.questions ?? []).filter(
        (item) => item.stage === 'clarification' && scheduled.includes(item.dimension),
      )
    },

    answerMap(state): Map<string, Answer> {
      return new Map(Object.entries(state.answers))
    },

    answeredCount(state): number {
      return Object.keys(state.answers).length
    },

    /** 主测中"未处理"（既没选数字，也没标"这题我说不好"）的题号。 */
    unansweredBaseIds(state): string[] {
      return (contentPackageOf(state.packageView)?.questions ?? [])
        .filter((item) => item.stage === 'base' && !state.answers[item.id])
        .map((item) => item.id)
    },

    /** 主测已处理的题数。 */
    processedBaseCount(state): number {
      const base = (contentPackageOf(state.packageView)?.questions ?? []).filter(
        (item) => item.stage === 'base',
      )
      return base.filter((item) => state.answers[item.id] !== undefined).length
    },

    /**
     * 本地预览计分。
     *
     * ⚠️ **这是预览，不是结论**。页面必须把它标注成"目前的粗略倾向"，
     * 并且提交后一律用服务端报告覆盖。它存在的唯一理由是即时反馈。
     */
    previewScores(state): ScoringResult | null {
      const pkg = contentPackageOf(state.packageView)
      if (!pkg) return null
      return score(pkg, new Map(Object.entries(state.answers)), state.clarificationSkipped)
    },

    /** 本地覆盖检查（与服务端同一套规则）。 */
    previewCoverage(state) {
      const pkg = contentPackageOf(state.packageView)
      if (!pkg) return null
      return checkCoverage(pkg, new Map(Object.entries(state.answers)))
    },

    /**
     * 冲突中被丢弃的作答，逐条转成"第几题 · 选了什么"。
     *
     * <p>题号用**该题在本次测评里的序号**（与服务端 `Order` 一致、与页面上显示的一致），
     * 而不是内部 id —— 内部 id 对用户没有意义，产品口径也不允许内部标识进入界面。
     * 找不到题目（内容包缺失等）时退回题号本身，宁可少说也不要编。
     */
    lostAnswerLabels(state): string[] {
      if (!state.conflict) return []
      const questions = contentPackageOf(state.packageView)?.questions ?? []
      return state.conflict.lostAnswers.map((lost) => {
        const index = questions.findIndex((item) => item.id === lost.questionId)
        const position = index >= 0 ? `第 ${index + 1} 题` : lost.questionId
        const choice = lost.rating === null ? '这题我说不好（不计分）' : SCALE_CAPTIONS[lost.rating - 1]
        return choice ? `${position} · ${choice}` : position
      })
    },
  },

  actions: {
    /** 进入答题页：按 attemptId 恢复（断点续答）。 */
    async load(attemptId: string): Promise<void> {
      this.loading = true
      this.lastError = null
      try {
        const detail = await fetchAttemptDetail(attemptId)
        this.applyDetail(detail)
      } catch (error) {
        this.lastError = describeError(error)
        throw error
      } finally {
        this.loading = false
      }
    },

    /**
     * 新建一次测评。
     *
     * 幂等键在 store 里保留到成功为止：用户点两下、或断网重试，都只会得到一份草稿。
     */
    async create(baseReportId?: string | null): Promise<AttemptDetail> {
      const summary = await createAttempt({ baseReportId: baseReportId ?? null })
      const detail = await fetchAttemptDetail(summary.attemptId)
      this.applyDetail(detail)
      this.createKey = null
      return detail
    },

    applyDetail(detail: AttemptDetail): void {
      this.attemptId = detail.attemptId
      this.status = detail.status
      this.revision = detail.revision
      this.currentQuestionId = detail.currentQuestionId
      this.clarificationDimensions = [...detail.clarificationDimensions]
      this.clarificationSkipped = detail.clarificationSkipped
      if (detail.packageView) this.packageView = detail.packageView
      const answers: Record<string, Answer> = {}
      for (const answer of detail.answers) {
        const converted = toAnswer(answer.kind, answer.rating)
        if (!converted) continue
        answers[answer.questionId] = { ...converted, questionId: answer.questionId }
      }
      this.answers = answers
      this.coverage = detail.coverage
      this.conflict = null
      // 载入代表服务端状态：本地"还没写上去"的记录到此为止（它们要么已被服务端采纳，
      // 要么就是用户在冲突提示里选择放弃的那些）。留着会让状态永远显示"未保存"。
      this.unconfirmed = {}
      this.saveState = detail.answers.length > 0 ? 'saved' : 'idle'
      this.savedAtLeastOnce = detail.answers.length > 0
      this.lastError = null
    },

    /** 当前题的作答（null = 未处理）。 */
    answerOf(questionId: string): Answer | null {
      return this.answers[questionId] ?? null
    },

    /**
     * 记一题（本地立即生效，随后异步落库）。
     *
     * `unknown` 与"未作答"是**两件不同的事**：unknown 会写进服务端（`kind: "unknown"`），
     * 未作答只是本地没有这一条。选「这题我说不好」绝不能等同于"跳过"。
     */
    async select(questionId: string, kind: 'rating' | 'unknown', rating?: number): Promise<void> {
      if (kind === 'rating' && (rating === undefined || !Number.isInteger(rating))) return
      const answer: Answer =
        kind === 'rating'
          ? { questionId, kind: 'rating', rating: rating as number }
          : { questionId, kind: 'unknown' }
      this.answers = { ...this.answers, [questionId]: answer }
      await this.flush(questionId)
    },

    /** 记录"当前在第几题"（不带答案变更；服务端允许 responses 为空 + currentQuestionId）。 */
    async rememberPosition(questionId: string): Promise<void> {
      this.currentQuestionId = questionId
      if (this.conflict) return
      await this.flush(null)
    },

    /**
     * 把**本地新增**的作答写上去。
     *
     * 只发这一条：`PATCH` 支持批量，但逐条发能让"某一条非法被整批拒绝"的影响范围最小，
     * 也让 409 之后"哪几条没写上去"是确定的。服务端是 upsert 语义，重复发同一条没有副作用。
     */
    async flush(questionId: string | null): Promise<void> {
      const attemptId = this.attemptId
      if (!attemptId) return
      // 冲突未解决前**绝不**再写：这正是"不要静默覆盖"的实现位置。
      if (this.conflict) return
      const responses: AnswerPatch[] = []
      const included = new Set<string>()
      if (questionId) {
        const answer = this.answers[questionId]
        if (answer) {
          responses.push(this.toPatch(questionId, answer))
          included.add(questionId)
        }
      }
      // 把**之前没写上去**的也一并重发（服务端 upsert，重复发同一条没有副作用）。
      // 不这样做的话，那一条会永远留在本地，而界面在下一次成功保存后显示「已保存」。
      for (const [id, answer] of Object.entries(this.unconfirmed)) {
        if (included.has(id)) continue
        if (!this.answers[id]) {
          // 本地已经把它清掉了（例如改了主测答案导致补充题被重置）：不必也不能重发
          delete this.unconfirmed[id]
          continue
        }
        responses.push(this.toPatch(id, answer))
      }
      if (responses.length === 0 && !this.currentQuestionId) return

      this.saveState = 'saving'
      try {
        const result = await patchAnswers(attemptId, {
          expectedRevision: this.revision,
          responses,
          currentQuestionId: this.currentQuestionId,
        })
        this.revision = result.revision
        this.status = result.status || this.status
        this.clarificationDimensions = [...result.clarificationDimensions]
        if (result.clarificationReset) {
          // 改主测答案导致已安排的补充题被清空：清掉本地的补充题答案，避免它们"看起来还在"。
          const clarificationIds = new Set(
            (contentPackageOf(this.packageView)?.questions ?? [])
              .filter((item) => item.stage === 'clarification')
              .map((item) => item.id),
          )
          const kept: Record<string, Answer> = {}
          for (const [id, answer] of Object.entries(this.answers)) {
            if (!clarificationIds.has(id)) kept[id] = answer
          }
          this.answers = kept
        }
        // 这一批都写成功了：把它们从未确认集合里摘掉。
        for (const id of Object.keys(this.unconfirmed)) {
          if (this.answers[id]) delete this.unconfirmed[id]
        }
        // **只有全部确认之后才允许说"已保存"**，否则失败的那条会被这一次成功掩盖。
        const outstanding = this.listUnconfirmedIds()
        if (outstanding.length === 0) {
          this.saveState = 'saved'
          this.savedAtLeastOnce = true
          this.lastError = null
        } else {
          this.saveState = 'error'
        }
      } catch (error) {
        if (isRevisionConflict(error)) {
          // 先记下这一批（本次要写的 + 之前没写上去的），再清空集合 —— 顺序反了就会丢内容。
          const lostIds = [...new Set([...(questionId ? [questionId] : []), ...Object.keys(this.unconfirmed)])]
          const lost: LostAnswer[] = []
          for (const id of lostIds) {
            const answer = this.answers[id]
            if (!answer) continue
            // 'unknown'（这题我说不好）与"选了某一档"都要如实在横幅里区分开，
            // 所以这里判 kind 而不是判 rating 是否存在。
            lost.push({
              questionId: id,
              rating: answer.kind === 'rating' && typeof answer.rating === 'number' ? answer.rating : null,
            })
          }
          // 冲突时清掉未确认集合：这些改动即将随"载入最新进度"被丢弃，
          // 留着会让冲突解除后的第一次写入把它们当成"待重发"再推一次。
          this.unconfirmed = {}
          this.saveState = 'conflict'
          this.conflict = {
            currentRevision: currentRevisionOf(error),
            message:
              '另一台设备改过这次的进度，所以这一条没有写上去。请先载入最新进度，再从最新版本继续作答。',
            pendingQuestionIds: lost.map((item) => item.questionId),
            lostAnswers: lost,
          }
          return
        }
        // 失败的那几条留进未确认集合，等下一次写入（或用户点「重试保存」）一并重发。
        const persisted: Record<string, Answer> = {}
        for (const response of responses) {
          const answer = this.answers[response.questionId]
          if (answer) persisted[response.questionId] = answer
        }
        this.unconfirmed = persisted
        this.saveState = 'error'
        this.lastError = describeError(error)
      }
    },

    /** 已改但还没被服务端确认的题号（本地已经清掉的不算）。 */
    listUnconfirmedIds(): string[] {
      return Object.keys(this.unconfirmed).filter((id) => Boolean(this.answers[id]))
    },

    /**
     * 重试把未确认的作答写上去（用户点「重试保存」，或下一次写入自动带上它们）。
     *
     * <p>它**不抛异常**：失败照常由 {@link flush} 记录成 `saveState`/`lastError`，
     * 页面读状态即可。冲突态下直接返回（那种情况下要用户先载入最新进度）。
     */
    async retryUnconfirmed(): Promise<void> {
      if (this.attemptId === null || this.conflict) return
      await this.flush(null)
    },

    /** `Answer` → PATCH 的一条（rating 与 unknown 互斥，由服务端再校验一次）。 */
    toPatch(questionId: string, answer: Answer): AnswerPatch {
      return answer.kind === 'rating'
        ? { questionId, kind: 'rating', rating: answer.rating ?? null }
        : { questionId, kind: 'unknown' }
    },

    /**
     * 冲突之后重新拉取最新版本。
     *
     * **本地的改动会被丢弃**，所以界面必须让用户先看到冲突提示再点这个动作，
     * 并且点完之后如实说明"以另一台设备的进度为准"。
     */
    async reload(): Promise<void> {
      const attemptId = this.attemptId
      if (!attemptId) return
      await this.load(attemptId)
      this.saveState =
        this.listUnconfirmedIds().length > 0 ? 'error' : this.savedAtLeastOnce ? 'saved' : 'idle'
    },

    /** 主测答完后调用：由服务端决定是否安排补充题。 */
    async runReview(): Promise<ReviewResult> {
      const attemptId = this.attemptId
      if (!attemptId) throw new Error('还没有正在进行的测评。')
      const result = await reviewAttempt(attemptId)
      this.review = result
      this.status = result.status || this.status
      this.clarificationDimensions = [...result.clarificationDimensions]
      if (result.coverage.length > 0) this.coverage = result.coverage
      this.insufficientDimensions = [...result.insufficientDimensions]
      return result
    },

    /**
     * 交卷。
     *
     * 覆盖不足时服务端返回 `200 + NEEDS_REVIEW`（不是异常）：这里照样把结果交给页面，
     * 由页面用 `insufficientDimensions` 明确告诉用户"还差哪几维"。
     */
    async submit(options: { clarificationSkipped: boolean; idempotencyKey?: string }): Promise<SubmitResult> {
      const attemptId = this.attemptId
      if (!attemptId) throw new Error('还没有正在进行的测评。')
      const result = await submitAttempt(attemptId, {
        expectedRevision: this.revision,
        clarificationSkipped: options.clarificationSkipped,
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      })
      this.status = result.status || this.status
      if (result.coverage.length > 0) this.coverage = result.coverage
      this.insufficientDimensions = [...result.insufficientDimensions]
      this.clarificationSkipped = options.clarificationSkipped
      this.saveState = 'saved'
      return result
    },

    /** 用户明确跳过补充题：如实记下来（跳过 ≠ 未答）。 */
    markClarificationSkipped(): void {
      this.clarificationSkipped = true
    },

    /** 覆盖不足时"还差哪几维"（维度名 + 原因）。 */
    insufficientDetails(): { dimension: Dimension; name: string; note: string }[] {
      const pkg = contentPackageOf(this.packageView)
      const byDimension = new Map<Dimension, CoverageView>(
        this.coverage.map((row) => [row.dimension, row]),
      )
      const list =
        this.insufficientDimensions.length > 0
          ? this.insufficientDimensions
          : DIMENSIONS.filter((dimension) => {
              const row = byDimension.get(dimension)
              return row !== undefined && !row.coverageOk
            })
      return list.map((dimension) => {
        const row = byDimension.get(dimension)
        const name = pkg?.dimensions.find((copy) => copy.dimension === dimension)?.name ?? dimension
        const unprocessed = row?.baseUnprocessedCount ?? 0
        const ratings = row?.baseRatingCount ?? 0
        return {
          dimension,
          name,
          note:
            unprocessed > 0
              ? `还有 ${unprocessed} 题没有作答（既没有选，也没有标「这题我说不好」）。`
              : `有效作答只有 ${ratings} 题，还不够形成方向。`,
        }
      })
    },

    /** 某道题所在的阶段（决定进度分母）。 */
    stageOf(questionId: string): Stage | null {
      return (
        contentPackageOf(this.packageView)?.questions.find((item) => item.id === questionId)?.stage ??
        null
      )
    },

    clearError(): void {
      this.lastError = null
    },

    reset(): void {
      this.$reset()
    },

    /** 供页面判断"这个错误要不要把用户送回登录页"。 */
    isSessionExpired(error: unknown): boolean {
      return isV3ApiError(error) && describeError(error).sessionExpired
    },
  },
})
