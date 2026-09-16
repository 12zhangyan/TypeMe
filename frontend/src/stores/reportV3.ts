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
  current: ReportDetail | null
  loading: boolean
  loadError: ErrorDisplay | null
  savingReflection: boolean
  reflectionNotice: string | null
}

export const useReportStore = defineStore('reportV3', {
  state: (): ReportState => ({
    list: [],
    listTotal: 0,
    listLoading: false,
    listError: null,
    current: null,
    loading: false,
    loadError: null,
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
      this.loading = true
      this.loadError = null
      this.current = null
      try {
        this.current = await fetchReportDetail(reportId)
        this.reflectionNotice = null
      } catch (error) {
        this.loadError = describeError(error)
      } finally {
        this.loading = false
      }
    },

    /** 交卷后直接按 attempt 取报告，省掉"查列表再匹配"的竞态。 */
    async loadReportByAttempt(attemptId: string): Promise<void> {
      this.loading = true
      this.loadError = null
      this.current = null
      try {
        this.current = await fetchReportByAttempt(attemptId)
      } catch (error) {
        this.loadError = describeError(error)
      } finally {
        this.loading = false
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

    /** 删除报告：顺带删掉它的 attempt、答案与 AI 记录（服务端一次性完成）。 */
    async remove(reportId: string): Promise<boolean> {
      try {
        await deleteReport(reportId)
        this.list = this.list.filter((item) => item.reportId !== reportId)
        if (this.current && this.current.report['reportId'] === reportId) this.current = null
        return true
      } catch (error) {
        this.listError = describeError(error)
        return false
      }
    },

    clearCurrent(): void {
      this.current = null
      this.loadError = null
      this.reflectionNotice = null
    },
  },
})
