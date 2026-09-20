import { defineStore } from 'pinia'
import {
  deleteReport,
  fetchReportByAttempt,
  fetchReportDetail,
  fetchReports,
  saveSelfReflection,
  type ReportDetail,
  type ReportSummary,
  type SelfReflection,
} from '@/api/v3Assessment'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { buildReportView, type ReportViewModelV3 } from '@/domain/reportV3'

/**
 * 报告 store —— 契约 `03-AI与前端契约-v1.md` §7.2 / §7.3。
 *
 * 两条纪律：
 *
 *   1. **报告是只读快照**。页面上的每一个字都来自 `GET /reports/{id}` 的 `report_json`
 *      （经 `domain/reportV3.ts` 校验后的 {@link ReportViewModelV3}），本地不重算、不补默认值。
 *   2. **自我理解与问卷结果并列存储**。`selfReflection` 与 `report` 是两个字段，
 *      保存自我理解**只**更新前者；把两者合并成一份"最终结论"会直接违反契约 §6.1
 *      （`report_json` 不可变，自选独立存）。
 */
interface ReportState {
  list: ReportSummary[]
  listTotal: number
  listLoading: boolean
  listError: ErrorDisplay | null
  /**
   * 删除失败的**独立**通道（2026-09-18 第 17 轮）。
   *
   * 以前删除失败被写进 `listError`，而列表区把它渲染成「记录没能载入：…」并整块替换掉列表 ——
   * 用户看到的是"我连历史记录都读不到了"，而真实情况只是"这一份没删掉"。
   * 两种失败的原因、影响面和可做的下一步都不一样，不能共用一条通道。
   */
  removeError: ErrorDisplay | null
  /** 正在删的那一份（同一时刻只允许一个删除在途）。 */
  removingId: string | null
  current: ReportDetail | null
  loading: boolean
  loadRevision: number
  loadError: ErrorDisplay | null
  /**
   * 这份 `current` 是**按 attempt** 取回来的吗（而不是按 reportId）。
   *
   * <p>两种取法的 404 含义完全不同，所以页面必须能分辨（2026-09-18 第 17 轮）：
   *   - 按 attempt 取（交卷后那条路）：404 = 这次尝试**还没有报告**（信息不足），
   *     属预期内的状态，该说"还差什么、回去补答"；
   *   - 按 reportId 取（`/reports/{id}`）：404 = **这份报告不在这里**（已被删除、
   *     编号有误，或链接属于别的账号），跟"你有没有答完"毫无关系。
   *
   * <p>以前页面只有一套文案（"还没有报告可看 …回去把没处理的题补齐"），
   * 于是删掉一份报告后按浏览器后退，用户会被告知"你还没做完"，并被送去重新测一次。
   */
  loadedByAttempt: boolean
  savingReflection: boolean
  reflectionNotice: string | null
}

export const useReportStore = defineStore('reportV3', {
  state: (): ReportState => ({
    list: [],
    listTotal: 0,
    listLoading: false,
    listError: null,
    removeError: null,
    removingId: null,
    current: null,
    loading: false,
    loadRevision: 0,
    loadError: null,
    loadedByAttempt: false,
    savingReflection: false,
    reflectionNotice: null,
  }),

  getters: {
    /**
     * 这份尝试**根本没有报告**（服务端 404）。
     *
     * 为什么单独拎出来：它是**预期内的状态**（答题没答完就交卷、某维有效作答不够），
     * 不是故障。页面要据此告诉用户"还差什么、回哪去补"，
     * 而不是把 404 混进"打开失败"里让用户以为系统坏了。
     */
    notFound(state): boolean {
      return state.loadError !== null && state.loadError.code === 'NOT_FOUND'
    },

    /** 当前报告的视图模型（唯一来源）；没有报告或形状不对时为 null。 */
    view(state): ReportViewModelV3 | null {
      if (!state.current) return null
      try {
        // 整份快照进解析器（解析器自己下钻到报告体；reportHash 在外壳层）。
        return buildReportView(state.current.report, state.current.selfReflection)
      } catch {
        // 形状不符合契约：由 `shapeError` 单独呈现，绝不降级成"页面上看起来还行的报告"
        return null
      }
    },

    /** 报告形状不符合契约时的人话说明（页面据此显示"这份报告读不出来"）。 */
    shapeError(state): string | null {
      if (!state.current) return null
      try {
        buildReportView(state.current.report, state.current.selfReflection)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : '这份报告读不出来。'
      }
    },

    /** 历史列表：倒序（服务端已按创建时间倒序，这里再兜一次，避免中间层改序）。 */
    listDescending(state): ReportSummary[] {
      return [...state.list].sort((a, b) => {
        const left = a.createdAt ?? ''
        const right = b.createdAt ?? ''
        return right.localeCompare(left)
      })
    },
  },

  actions: {
    async loadList(): Promise<void> {
      this.listLoading = true
      this.listError = null
      this.removeError = null
      try {
        const page = await fetchReports({ page: 0, size: 50 })
        this.list = page.items
        this.listTotal = page.total
      } catch (error) {
        this.listError = describeError(error)
      } finally {
        this.listLoading = false
      }
    },

    async loadReport(reportId: string): Promise<void> {
      const revision = ++this.loadRevision
      this.loading = true
      this.loadError = null
      this.current = null
      this.loadedByAttempt = false
      try {
        const current = await fetchReportDetail(reportId)
        if (revision !== this.loadRevision) return
        this.current = current
        this.reflectionNotice = null
      } catch (error) {
        if (revision !== this.loadRevision) return
        this.loadError = describeError(error)
      } finally {
        if (revision === this.loadRevision) this.loading = false
      }
    },

    /** 交卷后直接按 attempt 取报告，省掉"查列表再匹配"的竞态。 */
    async loadReportByAttempt(attemptId: string): Promise<void> {
      const revision = ++this.loadRevision
      this.loading = true
      this.loadError = null
      this.current = null
      this.loadedByAttempt = true
      try {
        const current = await fetchReportByAttempt(attemptId)
        if (revision === this.loadRevision) this.current = current
      } catch (error) {
        if (revision === this.loadRevision) this.loadError = describeError(error)
      } finally {
        if (revision === this.loadRevision) this.loading = false
      }
    },

    /**
     * 保存"我的自我理解"。
     *
     * 只更新 `current.selfReflection`：**不碰** `current.report`。
     * 空字符串按"清除"处理（服务端 `VARCHAR(500) NULL`，空串与 null 语义无差别，
     * 但存空串会让"有没有填过"变得看不出来）。
     */
    async saveReflection(input: {
      selfSelectedTypeCode: string | null
      note: string | null
    }): Promise<void> {
      const reportId = this.current?.report['reportId']
      if (typeof reportId !== 'string' || reportId.length === 0) return
      this.savingReflection = true
      this.reflectionNotice = null
      try {
        const saved: SelfReflection = await saveSelfReflection(reportId, {
          selfSelectedTypeCode: input.selfSelectedTypeCode,
          note: input.note === null || input.note.trim() === '' ? null : input.note.trim(),
        })
        if (this.current) {
          this.current = { ...this.current, selfReflection: saved }
        }
        this.reflectionNotice = '已保存。问卷结果不会因此改变，两件事分开显示。'
      } catch (error) {
        this.reflectionNotice = `没有保存成功：${describeError(error).message}`
      } finally {
        this.savingReflection = false
      }
    },

    /**
     * 删除报告：顺带删掉它的 attempt、答案与 AI 记录（服务端一次性完成）。
     *
     * 三重防护（第 17 轮补齐）：
     *   1. 同一时刻只允许一个删除在途 —— 双击确认以前会发两个 DELETE，第二个 404，
     *      于是在报告**已经删掉**之后把提示翻成「删除没能完成」；
     *   2. 失败写进 `removeError` 而不是 `listError`，列表不会被整块顶掉；
     *   3. 删除成功才把这一份从列表里拿掉 —— 失败时列表保持原样，不留"看起来删了"的中间态。
     */
    async remove(reportId: string): Promise<boolean> {
      if (this.removingId !== null) return false
      this.removingId = reportId
      this.removeError = null
      try {
        await deleteReport(reportId)
        this.list = this.list.filter((item) => item.reportId !== reportId)
        if (this.listTotal > 0) this.listTotal -= 1
        if (this.current && this.current.report['reportId'] === reportId) this.current = null
        return true
      } catch (error) {
        this.removeError = describeError(error)
        return false
      } finally {
        this.removingId = null
      }
    },

    clearRemoveError(): void {
      this.removeError = null
    },

    clearCurrent(): void {
      this.loadRevision += 1
      this.loading = false
      this.current = null
      this.loadError = null
      this.reflectionNotice = null
    },
  },
})
