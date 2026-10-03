import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReportStore } from './reportV3'
import type { ReportDetail } from '@/api/v3Assessment'

const { fetchReportDetail, fetchReportByAttempt } = vi.hoisted(() => ({
  fetchReportDetail: vi.fn(), fetchReportByAttempt: vi.fn(),
}))
vi.mock('@/api/v3Assessment', async () => ({
  ...await vi.importActual<typeof import('@/api/v3Assessment')>('@/api/v3Assessment'),
  fetchReportDetail, fetchReportByAttempt,
}))
function pending() {
  let resolve!: (value: ReportDetail) => void
  const promise = new Promise<ReportDetail>(done => { resolve = done })
  return { promise, resolve }
}
const detail = (id: string): ReportDetail => ({ report: { reportId: id }, selfReflection: { selfSelectedTypeCode: null, note: null, updatedAt: null }, attemptId: null, attemptRevision: null })

describe('报告切换中的晚到响应', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('旧报告晚到不覆盖新报告，也不重新触发错误的报告分流', async () => {
    const old = pending()
    fetchReportDetail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail('new'))
    const store = useReportStore()
    const first = store.loadReport('old')
    await store.loadReport('new')
    old.resolve(detail('old'))
    await first
    expect(store.current?.report.reportId).toBe('new')
    expect(store.loading).toBe(false)
  })

  it('离开后清空状态，旧的按答卷查询结果不能复活', async () => {
    const old = pending()
    fetchReportByAttempt.mockReturnValue(old.promise)
    const store = useReportStore()
    const first = store.loadReportByAttempt('old')
    store.clearCurrent()
    old.resolve(detail('old'))
    await first
    expect(store.current).toBeNull()
    expect(store.loading).toBe(false)
  })
})
