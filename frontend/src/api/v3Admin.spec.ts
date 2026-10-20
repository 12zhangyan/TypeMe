// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCsrfToken } from '@/api/csrf'
import { UNEXPECTED_RESPONSE_CODE, V3ApiError } from './v3'
import { fetchAdminAiSettings, fetchAdminUsers, probeAdminAccess, updateAdminAiSettings } from './v3Admin'

/**
 * 管理后台 AI 设置接口层（`api/v3Admin.ts`）测试（backlog A71 剩余部分）。
 *
 * 页面测试 `adminView.spec.ts` 用 `vi.mock` 整体替换了本模块，所以这里拼出来的路径、方法、
 * 请求体和解析纪律此前从未被执行过。本文件只打桩 `fetch`，让真实的请求层跑起来。
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

/** 后端 `AiSettingsService.adminView()` 的 18 个键。 */
const SETTINGS = {
  enabled: true,
  baseUrlHost: 'api.deepseek.com',
  model: 'deepseek-chat',
  promptVersion: 'v5',
  dailyLimitPerUser: 3,
  retryLimitPerHour: 2,
  globalDailyCallBudget: 500,
  globalDailyTokenBudget: 2000000,
  workerConcurrency: 2,
  connectTimeoutMs: 3000,
  requestDeadlineMs: 60000,
  maxTokens: 1800,
  mockMode: false,
  apiKeyConfigured: true,
  apiKeyFingerprint: 'ab12cd34',
  apiKeySource: 'db',
  updatedAt: '2026-10-18T08:00:00Z',
  updatedBy: 'admin-1',
}

beforeEach(() => {
  calls = []
  onBusiness = () => json({})
  clearCsrfToken()
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AI 设置', () => {
  it('读取打 GET /api/v3/admin/ai-settings，不为读操作取 CSRF token，18 个字段原样解析', async () => {
    onBusiness = () => json(SETTINGS)

    const settings = await fetchAdminAiSettings()

    expect(business()).toEqual([expect.objectContaining({ method: 'GET', url: '/api/v3/admin/ai-settings' })])
    expect(calls.some((call) => call.url === CSRF_URL)).toBe(false)
    expect(settings).toEqual(SETTINGS)
  })

  it('缺 enabled 或 mockMode 开关时整次读取失败，不猜一个开关状态', async () => {
    for (const missing of ['enabled', 'mockMode']) {
      const body: Record<string, unknown> = { ...SETTINGS }
      delete body[missing]
      onBusiness = () => json(body)

      const error = await catches(fetchAdminAiSettings())

      expect(error, `缺 ${missing} 应抛错`).toBeInstanceOf(V3ApiError)
      expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
    }
  })

  it('数值缺失回落 0，未知的 apiKeySource 记为 null 而不是原样透传', async () => {
    const body: Record<string, unknown> = { ...SETTINGS, apiKeySource: 'vault' }
    delete body['maxTokens']
    onBusiness = () => json(body)

    const settings = await fetchAdminAiSettings()

    expect(settings.maxTokens).toBe(0)
    expect(settings.apiKeySource).toBeNull()
  })

  it('保存打 PUT /api/v3/admin/ai-settings，带 CSRF 头；apiKey 为空串（清除）时原样发出', async () => {
    onBusiness = () => json({ ...SETTINGS, apiKeyConfigured: false, apiKeyFingerprint: null, apiKeySource: 'none' })

    const saved = await updateAdminAiSettings({ apiKey: '', dailyLimitPerUser: 5 })

    const [put] = business()
    expect(put).toMatchObject({ method: 'PUT', url: '/api/v3/admin/ai-settings' })
    expect(put!.headers['X-CSRF']).toBe('tok-1')
    expect(put!.body).toEqual({ apiKey: '', dailyLimitPerUser: 5 })
    expect(saved.apiKeyConfigured).toBe(false)
  })
})

describe('用户列表', () => {
  it('打 GET /api/v3/admin/users 并带 page / size；reportCount 的 null（未知）与 0 分开', async () => {
    onBusiness = () => json({
      items: [
        { id: 'u-1', username: 'alice', nickname: null, role: 'ADMIN', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', reportCount: 0 },
        { id: 'u-2', username: 'bob', nickname: '小博', role: 'USER', status: 'ACTIVE', createdAt: null, reportCount: null },
      ],
      page: 1,
      size: 20,
      total: 22,
    })

    const page = await fetchAdminUsers({ page: 1 })

    const url = new URL(business()[0]!.url, 'http://local')
    expect(url.pathname).toBe('/api/v3/admin/users')
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', size: '20' })
    expect(page.items.map((item) => item.reportCount)).toEqual([0, null])
    expect(page).toMatchObject({ page: 1, size: 20, total: 22 })
  })

  it('条目缺 id 或 username 时抛 UNEXPECTED_RESPONSE，而不是渲染一行空白', async () => {
    onBusiness = () => json({ items: [{ id: 'u-1', role: 'USER' }], page: 0, size: 20, total: 1 })

    const error = await catches(fetchAdminUsers())

    expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })
})

describe('权限探测分三类', () => {
  it('200 是 granted，403 是 denied', async () => {
    onBusiness = () => json(SETTINGS)
    expect((await probeAdminAccess()).kind).toBe('granted')

    onBusiness = () => json({ code: 'FORBIDDEN', message: '没有权限' }, 403)
    expect((await probeAdminAccess()).kind).toBe('denied')
  })

  it('5xx 与会话失效是 unavailable，不能把“没问到”说成“没有权限”', async () => {
    onBusiness = () => json({ code: 'INTERNAL_ERROR', message: '服务器出错' }, 500)
    expect((await probeAdminAccess()).kind).toBe('unavailable')

    onBusiness = () => json({ code: 'UNAUTHENTICATED', message: '请先登录' }, 401)
    expect((await probeAdminAccess()).kind).toBe('unavailable')
  })
})
