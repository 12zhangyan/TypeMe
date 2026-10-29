import { v3Request, v3ReadJson, unexpectedResponse } from './v3'
import { parseMyAttempt, parseMyReport, parseReportDetail } from './platformV3'

export interface Member {
  id: string; username: string; nickname: string | null; role: string; status: string
  createdAt: string; lastSeenAt: string | null; reportCount: number | null; attemptCount: number
  aiDailyLimit: number | null; effectiveAiDailyLimit: number; aiUsedToday: number
  aiRemainingToday: number; quotaDate: string
}
export interface Page<T> { items: T[]; page: number; size: number; total: number }
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await v3Request(method as 'GET' | 'POST' | 'PUT', path, body === undefined ? {} : { body })
  return v3ReadJson<T>(response, path)
}
async function list<T>(path: string, parse?: (raw: unknown, path: string) => T): Promise<Page<T>> {
  const data = await request<Page<T>>('GET', path)
  if (!Array.isArray(data.items) || !Number.isInteger(data.total) || !Number.isInteger(data.page)) throw unexpectedResponse('管理列表格式不正确，请重试。')
  return { ...data, items: parse ? data.items.map((item, i) => parse(item, `${path}[${i}]`)) : data.items }
}
const isText = (value: unknown) => typeof value === 'string' && value !== ''
// 条目缺关键字段就当场报错，不让页面渲染出没有名字或状态的空白行（与 v3Admin.parseUser 同一纪律）。
function parseMember(raw: unknown, path: string): Member {
  const item = raw as Partial<Member> | null
  if (!item || !isText(item.id) || !isText(item.username)) throw unexpectedResponse(`成员条目缺少 id 或 username：${path}`)
  return item as Member
}
// 不筛选时 URL 与旧版完全一致；筛选在服务端做，跨页的 total 才准确。
export const members = (page = 0, aiExhausted = false) =>
  list<Member>(`/admin/users?page=${page}&size=20${aiExhausted ? '&aiExhausted=true' : ''}`, parseMember)
export const setDailyLimit = (id: string, aiDailyLimit: number) => request<Member>('PUT', `/admin/users/${encodeURIComponent(id)}/ai-limit`, { aiDailyLimit })
export interface BatchAiLimitItem { userId: string; ok: boolean; member?: Member; code?: string; message?: string }
export interface BatchAiLimitResult { updated: number; failed: number; results: BatchAiLimitItem[] }
// 批量修改：服务端先整体校验、再逐人处理，响应逐人给结果；结构不对时报错，不让页面把未知结果当成功。
export const setDailyLimits = (userIds: string[], aiDailyLimit: number) => batchLimits({ userIds, action: 'SET', aiDailyLimit })
// 恢复默认用显式 action，不传 aiDailyLimit：清除单独额度，之后跟随站点默认。
export const resetDailyLimits = (userIds: string[]) => batchLimits({ userIds, action: 'RESET_DEFAULT' })
async function batchLimits(body: { userIds: string[]; action: 'SET' | 'RESET_DEFAULT'; aiDailyLimit?: number }): Promise<BatchAiLimitResult> {
  const path = '/admin/users/ai-limits'
  const data = await request<Partial<BatchAiLimitResult> | null>('PUT', path, body)
  if (!data || !Number.isInteger(data.updated) || !Number.isInteger(data.failed) || !Array.isArray(data.results)) throw unexpectedResponse('批量修改的结果格式不正确，请刷新后核对额度。')
  const results = data.results.map((item, i) => item.ok ? { ...item, member: parseMember(item.member, `${path}.results[${i}]`) } : item)
  return { updated: data.updated as number, failed: data.failed as number, results }
}
export const attempts = (id: string, page = 0) => list(`/admin/users/${encodeURIComponent(id)}/attempts?page=${page}&size=10`, parseMyAttempt)
export const reports = (id: string, page = 0) => list(`/admin/users/${encodeURIComponent(id)}/reports?page=${page}&size=10`, parseMyReport)
export async function report(id: string, reportId: string) {
  const path = `/admin/users/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}`
  return parseReportDetail(await request<unknown>('GET', path), path)
}
