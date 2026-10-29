// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCsrfToken } from '@/api/csrf'
import { UNEXPECTED_RESPONSE_CODE, V3ApiError } from './v3'
import { attempts, members, resetDailyLimits, setDailyLimit, setDailyLimits } from './adminMembers'

/**
 * 成员接口层（`api/adminMembers.ts`）测试（backlog A71 剩余部分）。
 *
 * `adminMembersView.spec.ts` 整体 mock 了本模块；这里只打桩 `fetch`，
 * 断言真实拼出的路径、方法、请求体、CSRF 与条目解析。
 */

interface Call {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

const CSRF_URL = '/api/v3/auth/csrf'
let calls: Call[] = []
let onBusiness: (call: Call) => Response = () => json({})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function installFetch(): void {
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: typeof input === 'string' ? input : input.toString(),
      headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    if (call.url === CSRF_URL) return json({ token: 'tok-1', headerName: 'X-CSRF' })
    return onBusiness(call)
  }) as never)
}

function business(): Call[] {
  return calls.filter((call) => call.url !== CSRF_URL)
}

function catches(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught)
}

/** 后端 `AdminUserService.view()` 的成员视图。 */
const MEMBER = {
  id: 'u-1', username: 'alice', nickname: null, role: 'USER', status: 'ACTIVE',
  createdAt: '2026-10-01T00:00:00Z', lastSeenAt: null, reportCount: null, attemptCount: 2,
  aiDailyLimit: null, effectiveAiDailyLimit: 3, aiUsedToday: 1, aiRemainingToday: 2, quotaDate: '2026-10-19',
}
const page = (items: unknown[]) => ({ items, page: 0, size: 10, total: items.length })

beforeEach(() => {
  calls = []
  onBusiness = () => json({})
  clearCsrfToken()
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('列表读取', () => {
  it('成员列表打 GET /api/v3/admin/users?page=&size=20，不取 CSRF token，条目原样保留', async () => {
    onBusiness = () => json({ ...page([MEMBER]), size: 20 })

    const result = await members(2)

    expect(business()).toEqual([expect.objectContaining({ method: 'GET', url: '/api/v3/admin/users?page=2&size=20' })])
    expect(calls.some((call) => call.url === CSRF_URL)).toBe(false)
    expect(result.items).toEqual([MEMBER])
  })

  it('只看今日额度已用完：同一路径加 aiExhausted=true；默认不带该参数', async () => {
    onBusiness = () => json({ ...page([MEMBER]), size: 20 })

    await members(1, true)
    await members(0, false)

    expect(business().map((call) => call.url)).toEqual([
      '/api/v3/admin/users?page=1&size=20&aiExhausted=true',
      '/api/v3/admin/users?page=0&size=20',
    ])
  })

  it('外层不是分页结构时抛 UNEXPECTED_RESPONSE', async () => {
    onBusiness = () => json({ items: null, page: 0, total: 0 })

    const error = await catches(members())

    expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })

  it('成员条目缺 username 时抛 UNEXPECTED_RESPONSE，不渲染空白行', async () => {
    onBusiness = () => json(page([{ ...MEMBER, username: '' }]))
    expect(((await catches(members())) as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })
})

describe('写操作', () => {
  it('改每日额度打 PUT /api/v3/admin/users/{id}/ai-limit，请求体只有 aiDailyLimit', async () => {
    onBusiness = () => json({ ...MEMBER, aiDailyLimit: 0, effectiveAiDailyLimit: 0, aiRemainingToday: 0 })

    const updated = await setDailyLimit('u/1', 0)

    const [put] = business()
    expect(put).toMatchObject({ method: 'PUT', url: '/api/v3/admin/users/u%2F1/ai-limit' })
    expect(put!.headers['X-CSRF']).toBe('tok-1')
    expect(put!.body).toEqual({ aiDailyLimit: 0 })
    expect(updated.effectiveAiDailyLimit).toBe(0)
  })

  it('批量设定打 PUT /api/v3/admin/users/ai-limits，带 CSRF，请求体为 userIds + action SET + aiDailyLimit；逐人结果原样返回', async () => {
    onBusiness = () => json({
      updated: 1, failed: 1,
      results: [
        { userId: 'u-1', ok: true, member: { ...MEMBER, aiDailyLimit: 5, effectiveAiDailyLimit: 5 } },
        { userId: 'u-2', ok: false, code: 'NOT_FOUND', message: '成员不存在或已删除。' },
      ],
    })

    const result = await setDailyLimits(['u-1', 'u-2'], 5)

    const [put] = business()
    expect(put).toMatchObject({ method: 'PUT', url: '/api/v3/admin/users/ai-limits' })
    expect(put!.headers['X-CSRF']).toBe('tok-1')
    expect(put!.body).toEqual({ userIds: ['u-1', 'u-2'], action: 'SET', aiDailyLimit: 5 })
    expect(result.updated).toBe(1)
    expect(result.results[0]!.member!.aiDailyLimit).toBe(5)
    expect(result.results[1]).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('恢复默认打同一接口，action 为 RESET_DEFAULT，请求体不带 aiDailyLimit', async () => {
    onBusiness = () => json({ updated: 1, failed: 0, results: [{ userId: 'u-1', ok: true, member: MEMBER }] })

    const result = await resetDailyLimits(['u-1'])

    const [put] = business()
    expect(put).toMatchObject({ method: 'PUT', url: '/api/v3/admin/users/ai-limits' })
    expect(put!.headers['X-CSRF']).toBe('tok-1')
    expect(put!.body).toEqual({ userIds: ['u-1'], action: 'RESET_DEFAULT' })
    expect(result.results[0]!.member!.aiDailyLimit).toBeNull()
  })

  it('批量结果缺 updated/results 或成功项缺成员时抛 UNEXPECTED_RESPONSE，不当成成功', async () => {
    onBusiness = () => json({ ok: true })
    const shapeless = await catches(setDailyLimits(['u-1'], 5))
    expect(shapeless).toBeInstanceOf(V3ApiError)
    expect((shapeless as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)

    onBusiness = () => json({ updated: 1, failed: 0, results: [{ userId: 'u-1', ok: true }] })
    const memberless = await catches(setDailyLimits(['u-1'], 5))
    expect((memberless as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })
})

describe('成员档案', () => {
  it('成员测评打 GET /api/v3/admin/users/{id}/attempts，id 经过转义', async () => {
    onBusiness = () => json(page([]))

    await attempts('u/1', 3)

    expect(business()[0]!.url).toBe('/api/v3/admin/users/u%2F1/attempts?page=3&size=10')
  })
})
