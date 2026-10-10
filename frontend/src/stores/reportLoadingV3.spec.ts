import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReportStore } from './reportV3'
import { useAuthStore } from './auth'
import type { ReportDetail, ReportListPage, SelfReflection } from '@/api/v3Assessment'

const { fetchReportDetail, fetchReportByAttempt, fetchReports, saveSelfReflection, deleteReport } = vi.hoisted(() => ({
  fetchReportDetail: vi.fn(), fetchReportByAttempt: vi.fn(),
  fetchReports: vi.fn(), saveSelfReflection: vi.fn(), deleteReport: vi.fn(),
}))
vi.mock('@/api/v3Assessment', async () => ({
  ...await vi.importActual<typeof import('@/api/v3Assessment')>('@/api/v3Assessment'),
  fetchReportDetail, fetchReportByAttempt, fetchReports, saveSelfReflection, deleteReport,
}))
function pending<T = ReportDetail>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const detail = (id: string): ReportDetail => ({ report: { reportId: id }, selfReflection: { selfSelectedTypeCode: null, note: null, updatedAt: null }, attemptId: null, attemptRevision: null })

describe('报告切换中的晚到响应', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks() })

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

const reflection = (note: string): SelfReflection => ({ selfSelectedTypeCode: 'INFP', note, updatedAt: '2026-10-10T00:00:00Z' })
const user = (userId: string) => ({ userId, username: userId, nickname: null,
  createdAt: '2026-10-10T00:00:00Z', passwordChangedAt: null })
const listPage = (id: string): ReportListPage => ({
  items: [{ reportId: id, attemptId: 'attempt-' + id, status: 'REFERENCE', computedTypeCode: 'INFP',
    selfSelectedTypeCode: null, createdAt: '2026-10-10T00:00:00Z', summaryLine: id, packageId: 'test', scoringVersion: 'test' }],
  total: 1, page: 0, size: 50,
})

describe('报告自我理解的异步隔离', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks() })

  it.each(['success', 'failure'] as const)('切换报告后旧保存 %s 不污染新报告或解除新保存状态', async (outcome) => {
    const old = pending<SelfReflection>()
    const next = pending<SelfReflection>()
    saveSelfReflection.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    fetchReportDetail.mockResolvedValue(detail('new'))
    const store = useReportStore()
    store.current = detail('old')
    const first = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '旧报告理解' })
    await store.loadReport('new')
    expect(store.savingReflection).toBe(false)
    const second = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '新报告理解' })
    if (outcome === 'success') old.resolve(reflection('旧报告理解'))
    else old.reject(new Error('旧报告保存失败'))
    await first
    expect(store.current).toEqual(detail('new'))
    expect(store.reflectionNotice).toBeNull()
    expect(store.savingReflection).toBe(true)
    next.resolve(reflection('新报告理解'))
    await second
    expect(store.current?.selfReflection.note).toBe('新报告理解')
    expect(store.savingReflection).toBe(false)
  })

  it('同一报告重复点击只发送一次保存，固定报告快照不变', async () => {
    const request = pending<SelfReflection>()
    saveSelfReflection.mockReturnValueOnce(request.promise)
    const store = useReportStore()
    store.current = detail('same')
    const snapshot = store.current.report
    const first = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '  第一份理解  ' })
    const duplicate = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '重复点击' })
    expect(saveSelfReflection).toHaveBeenCalledTimes(1)
    expect(saveSelfReflection).toHaveBeenCalledWith('same', { selfSelectedTypeCode: 'INFP', note: '第一份理解' })
    request.resolve(reflection('第一份理解'))
    await Promise.all([first, duplicate])
    expect(store.current?.report).toBe(snapshot)
    expect(store.current?.selfReflection.note).toBe('第一份理解')
  })

  it('清空并重进同一报告，旧保存不能覆盖重新读取的内容', async () => {
    const request = pending<SelfReflection>()
    saveSelfReflection.mockReturnValueOnce(request.promise)
    const store = useReportStore()
    store.current = detail('same')
    const first = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '过期理解' })
    store.clearCurrent()
    expect(store.savingReflection).toBe(false)
    fetchReportByAttempt.mockResolvedValue(detail('same'))
    await store.loadReportByAttempt('same-attempt')
    request.resolve(reflection('过期理解'))
    await first
    expect(store.current).toEqual(detail('same'))
    expect(store.reflectionNotice).toBeNull()
  })
})

describe('报告列表与账号隔离', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.resetAllMocks() })

  it.each(['success', 'failure'] as const)('新列表请求完成后旧请求 %s 不能覆盖内容或错误', async (outcome) => {
    const old = pending<ReportListPage>()
    fetchReports.mockReturnValueOnce(old.promise).mockResolvedValueOnce(listPage('new'))
    const store = useReportStore()
    const first = store.loadList()
    await store.loadList()
    if (outcome === 'success') old.resolve(listPage('old'))
    else old.reject(new Error('旧列表失败'))
    await first
    expect(store.list).toEqual(listPage('new').items)
    expect(store.listError).toBeNull()
    expect(store.listLoading).toBe(false)
  })

  it('旧列表先结束时，新列表仍显示加载中', async () => {
    const old = pending<ReportListPage>()
    const next = pending<ReportListPage>()
    fetchReports.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const store = useReportStore()
    const first = store.loadList()
    const second = store.loadList()
    old.resolve(listPage('old'))
    await first
    expect(store.list).toEqual([])
    expect(store.listLoading).toBe(true)
    next.resolve(listPage('new'))
    await second
    expect(store.list).toEqual(listPage('new').items)
  })

  it.each(['logout', 'expire', 'switch'] as const)('%s 清理报告与提示，晚到响应不能复活旧账号数据', async (action) => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useReportStore()
    store.current = detail('old')
    store.list = listPage('old').items
    store.listTotal = 1
    store.reflectionNotice = '旧提示'
    const oldDetail = pending()
    const oldList = pending<ReportListPage>()
    fetchReportDetail.mockReturnValueOnce(oldDetail.promise)
    fetchReports.mockReturnValueOnce(oldList.promise)
    const first = store.loadReport('old')
    const second = store.loadList()
    if (action === 'switch') auth.applyProfile(user('b'))
    else auth.applyAnonymous(action === 'expire' ? '登录已过期' : null)
    expect(store.current).toBeNull()
    expect(store.list).toEqual([])
    expect(store.listTotal).toBe(0)
    expect(store.loading).toBe(false)
    expect(store.listLoading).toBe(false)
    expect(store.reflectionNotice).toBeNull()
    fetchReportDetail.mockResolvedValueOnce(detail('new'))
    await store.loadReport('new')
    oldDetail.resolve(detail('old'))
    oldList.resolve(listPage('old'))
    await Promise.all([first, second])
    expect(store.current?.report.reportId).toBe('new')
    expect(store.list).toEqual([])
  })

  it.each(['logout', 'expire', 'switch'] as const)('%s 立即清除已经展示的报告和个人理解', (action) => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useReportStore()
    store.current = { ...detail('private'), selfReflection: reflection('账号甲的个人理解') }
    if (action === 'switch') auth.applyProfile(user('b'))
    else auth.applyAnonymous(action === 'expire' ? '登录已过期' : null)
    expect(store.current).toBeNull()
    expect(store.view).toBeNull()
  })

  it.each(['success', 'failure'] as const)('退出后重新登录，旧保存 %s 不能污染当前账号', async (outcome) => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useReportStore()
    store.current = detail('old')
    const old = pending<SelfReflection>()
    saveSelfReflection.mockReturnValueOnce(old.promise)
    const first = store.saveReflection({ selfSelectedTypeCode: 'INFP', note: '账号甲的个人理解' })
    auth.applyAnonymous()
    auth.applyProfile(user('b'))
    fetchReportDetail.mockResolvedValueOnce(detail('new'))
    await store.loadReport('new')
    if (outcome === 'success') old.resolve(reflection('账号甲的个人理解'))
    else old.reject(new Error('旧账号保存失败'))
    await first
    expect(store.current).toEqual(detail('new'))
    expect(store.reflectionNotice).toBeNull()
    expect(store.savingReflection).toBe(false)
  })

  it('刷新同一账号资料保留当前报告', () => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const store = useReportStore()
    store.current = detail('same')
    auth.applyProfile({ ...user('a'), nickname: '新昵称' })
    expect(store.current).toEqual(detail('same'))
  })

  it.each(['success', 'failure'] as const)('换号后的旧删除 %s 不影响新账号列表及正在删除的状态', async (outcome) => {
    const auth = useAuthStore()
    auth.applyProfile(user('a'))
    const old = pending<void>()
    const next = pending<void>()
    deleteReport.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const store = useReportStore()
    const first = store.remove('old')
    auth.applyProfile(user('b'))
    store.list = listPage('new').items
    store.listTotal = 1
    const second = store.remove('new')
    if (outcome === 'success') old.resolve()
    else old.reject(new Error('旧账号删除失败'))
    expect(await first).toBe(false)
    expect(store.listTotal).toBe(1)
    expect(store.list).toEqual(listPage('new').items)
    expect(store.removeError).toBeNull()
    expect(store.removingId).toBe('new')
    next.resolve()
    expect(await second).toBe(true)
    expect(store.list).toEqual([])
    expect(store.listTotal).toBe(0)
  })

  it('删除成功后，删除前发出的列表不能复活已删报告', async () => {
    const old = pending<ReportListPage>()
    fetchReports.mockReturnValueOnce(old.promise)
    deleteReport.mockResolvedValueOnce(undefined)
    const store = useReportStore()
    store.list = listPage('old').items
    store.listTotal = 1
    const first = store.loadList()
    expect(await store.remove('old')).toBe(true)
    old.resolve(listPage('old'))
    await first
    expect(store.list).toEqual([])
    expect(store.listTotal).toBe(0)
    expect(store.listLoading).toBe(false)
  })
})
