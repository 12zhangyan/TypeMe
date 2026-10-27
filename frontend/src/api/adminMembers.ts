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
export const members = (page = 0) => list<Member>(`/admin/users?page=${page}&size=20`, parseMember)
export const setDailyLimit = (id: string, aiDailyLimit: number) => request<Member>('PUT', `/admin/users/${encodeURIComponent(id)}/ai-limit`, { aiDailyLimit })
export const attempts = (id: string, page = 0) => list(`/admin/users/${encodeURIComponent(id)}/attempts?page=${page}&size=10`, parseMyAttempt)
export const reports = (id: string, page = 0) => list(`/admin/users/${encodeURIComponent(id)}/reports?page=${page}&size=10`, parseMyReport)
export async function report(id: string, reportId: string) {
  const path = `/admin/users/${encodeURIComponent(id)}/reports/${encodeURIComponent(reportId)}`
  return parseReportDetail(await request<unknown>('GET', path), path)
}
