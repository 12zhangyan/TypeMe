// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCsrfToken } from '@/api/csrf'
import {
  changePassword,
  describeError,
  exportAccountData,
  fetchMe,
  isForbidden,
  isSessionExpired,
  loginAccount,
  readDegradedSections,
  recoverAccount,
  regenerateRecoveryCodes,
  registerAccount,
  requestAccountDeletion,
  updateNickname,
  UNEXPECTED_RESPONSE_CODE,
  V3ApiError,
} from './v3'

/**
 * 账号接口层（`api/v3.ts`）测试 —— 这一层在本轮之前**一条测试都没有**。
 *
 * 为什么值得单独测（而不是靠页面测试顺带覆盖）：
 *   1. 页面测试可以全绿而路径是错的 —— 它们打的是打桩的 `fetch`，只要 stub 认哪个
 *      路径，测出来就"对"；真正决定线上能不能登录的是**这里拼出来的路径与方法**；
 *   2. 这一层决定了"服务端少给一个字段"时用户看到什么。本文件的纪律是：读不出关键字段
 *      就**当场抛 `UNEXPECTED_RESPONSE`**，不返回一个"看起来正常"的空壳；
 *   3. `FORBIDDEN`（登着但没权限）与 `UNAUTHENTICATED`（没登录）必须分开 ——
 *      混起来会让有权限的人在会话抖动时被当成越权、或反之被反复弹回登录页。
 */

interface Call {
  method: string
  url: string
  body: unknown
  headers: Record<string, string>
}

let calls: Call[] = []
let responder: (call: Call) => Response = () => json({})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method ?? 'GET').toUpperCase()
      const headers: Record<string, string> = {}
      for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[key] = value
      }
      const call: Call = {
        method,
        url,
        headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      }
      calls.push(call)
      return responder(call)
    }) as never,
  )
}

/** 只取业务请求（跳过写操作前那次 `/auth/csrf` 取 token）。 */
function business(method: string): Call {
  const found = calls.find((call) => call.method === method && call.url !== '/api/v3/auth/csrf')
  expect(found, `没有发出 ${method} 业务请求`).toBeDefined()
  return found!
}

function catches(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught)
}

const PROFILE = {
  userId: 'u-1',
  username: 'alice',
  nickname: '小艾',
  createdAt: '2026-09-16T10:00:00Z',
  passwordChangedAt: null,
}

beforeEach(() => {
  calls = []
  responder = () => json({})
  clearCsrfToken()
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('请求形状', () => {
  it('登录打 POST /api/v3/auth/login，只带用户名与密码', async () => {
    responder = () => json(PROFILE)
    const profile = await loginAccount({ username: 'alice', password: 'pw-1' })

    const post = business('POST')
    expect(post.url).toBe('/api/v3/auth/login')
    expect(post.body).toEqual({ username: 'alice', password: 'pw-1' })
    expect(profile.userId).toBe('u-1')
  })

  it('注册打 POST /api/v3/auth/register，并带上免责声明同意与邀请码', async () => {
    responder = () => json(PROFILE)
    await registerAccount({
      username: 'alice',
      password: 'pw-1',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })

    const post = business('POST')
    expect(post.url).toBe('/api/v3/auth/register')
    expect(post.body).toMatchObject({
      username: 'alice',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })
  })

  it('没传昵称时请求体里不出现 nickname 键（不是传一个 null 上去）', async () => {
    responder = () => json(PROFILE)
    await registerAccount({
      username: 'alice',
      password: 'pw-1',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })

    const body = business('POST').body as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(body, 'nickname')).toBe(false)
  })

  it('昵称只有空白时同样不带上（trim 之后为空等于没填）', async () => {
    responder = () => json(PROFILE)
    await registerAccount({
      username: 'alice',
      password: 'pw-1',
      nickname: '   ',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })

    expect(Object.prototype.hasOwnProperty.call(business('POST').body, 'nickname')).toBe(false)
  })

  it('读自己的资料是 GET /api/v3/me，且不会为读操作多跑一次取 CSRF token', async () => {
    responder = () => json(PROFILE)
    await fetchMe()

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe('/api/v3/me')
  })

  it('改昵称是 PATCH /api/v3/me', async () => {
    responder = () => json({ ...PROFILE, nickname: '新昵称' })
    const profile = await updateNickname('新昵称')

    const patch = business('PATCH')
    expect(patch.url).toBe('/api/v3/me')
    expect(patch.body).toEqual({ nickname: '新昵称' })
    expect(profile.nickname).toBe('新昵称')
  })

  it('改密码是 POST /api/v3/me/password（不是 PATCH /me）', async () => {
    responder = () => new Response(null, { status: 204 })
    await changePassword({ currentPassword: 'old', newPassword: 'new-1' })

    const post = business('POST')
    expect(post.url).toBe('/api/v3/me/password')
    expect(post.body).toEqual({ currentPassword: 'old', newPassword: 'new-1' })
  })

  it('恢复密码是 POST /api/v3/auth/recover，且登录前就带这三个字段', async () => {
    responder = () => new Response(null, { status: 204 })
    await recoverAccount({ username: 'alice', recoveryCode: 'RC-1', newPassword: 'new-1' })

    const post = business('POST')
    expect(post.url).toBe('/api/v3/auth/recover')
    expect(post.body).toEqual({ username: 'alice', recoveryCode: 'RC-1', newPassword: 'new-1' })
  })

  it('注销是 DELETE /api/v3/me，且 confirm 逐字为 DELETE（服务端要求）', async () => {
    responder = () => json({ deletionJobId: 'job-1' }, 202)
    const result = await requestAccountDeletion({ password: 'pw-1', confirm: 'DELETE' })

    const del = business('DELETE')
    expect(del.url).toBe('/api/v3/me')
    expect(del.body).toEqual({ password: 'pw-1', confirm: 'DELETE' })
    expect(result.deletionJobId).toBe('job-1')
  })

  it('导出是 GET /api/v3/me/export，文件名优先用服务端 Content-Disposition 给的', async () => {
    responder = () =>
      new Response('{"userId":"u-1"}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Content-Disposition': 'attachment; filename="typeme-2026-09-22.json"',
        },
      })

    const result = await exportAccountData()
    expect(business('GET').url).toBe('/api/v3/me/export')
    expect(result.filename).toBe('typeme-2026-09-22.json')
  })

  it('导出的文件名是 UTF-8 百分号编码时能还原中文名', async () => {
    responder = () =>
      new Response('{}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Content-Disposition': "attachment; filename*=UTF-8''%E5%AF%BC%E5%87%BA.json",
        },
      })

    expect((await exportAccountData()).filename).toBe('导出.json')
  })
})

describe('响应解析：缺关键字段必须当场报错', () => {
  it('资料里没有 userId 时抛 UNEXPECTED_RESPONSE，而不是造一个空账号', async () => {
    responder = () => json({ username: 'alice', nickname: '小艾' })
    const error = await catches(fetchMe())

    expect(error).toBeInstanceOf(V3ApiError)
    expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })

  it('时间字段被写成毫秒时间戳时转成 ISO 字符串（不让数字进界面）', async () => {
    responder = () => json({ ...PROFILE, createdAt: Date.UTC(2026, 8, 16, 10, 0, 0) })
    const profile = await fetchMe()

    expect(profile.createdAt).toBe('2026-09-16T10:00:00.000Z')
  })

  it('重新生成恢复码但响应里没有码：抛错，不能静默成功', async () => {
    // 那一刻旧码已经作废 —— 安静返回空数组等于让用户在毫无察觉的情况下失去全部恢复码
    responder = () => json({ recoveryCodes: [] })
    const error = await catches(regenerateRecoveryCodes('pw-1'))

    expect(error).toBeInstanceOf(V3ApiError)
    expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
    expect((error as V3ApiError).message).toContain('恢复码')
  })

  it('新恢复码存在时原样读出来，并带上策略版本', async () => {
    responder = () => json({ recoveryCodes: ['A1-B2', 'C3-D4'], recoveryCodePolicyVersion: 'rc-1' })
    const codes = await regenerateRecoveryCodes('pw-1')

    expect(business('POST').url).toBe('/api/v3/me/recovery-codes')
    expect(codes).toEqual(['A1-B2', 'C3-D4'])
  })

  it('注册响应里没有恢复码：不当作失败（账号已经建好了）', async () => {
    responder = () => json(PROFILE)
    const result = await registerAccount({
      username: 'alice',
      password: 'pw-1',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })

    expect(result.recoveryCodes).toEqual([])
    expect(result.profile.userId).toBe('u-1')
  })

  it('注册响应里有恢复码时读出来', async () => {
    responder = () => json({ ...PROFILE, recoveryCodes: ['A1-B2'], recoveryCodePolicyVersion: 'rc-1' })
    const result = await registerAccount({
      username: 'alice',
      password: 'pw-1',
      disclaimerAccepted: true,
      invitationCode: 'INV-1',
    })

    expect(result.recoveryCodes).toEqual(['A1-B2'])
    expect(result.recoveryCodePolicyVersion).toBe('rc-1')
  })

  it('2xx 但不是 JSON：抛 UNEXPECTED_RESPONSE（不把脏 body 当数据）', async () => {
    responder = () => new Response('<html>维护中</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
    const error = await catches(fetchMe())

    expect(error).toBeInstanceOf(V3ApiError)
    expect((error as V3ApiError).code).toBe(UNEXPECTED_RESPONSE_CODE)
  })
})

describe('导出正文里的降级段落', () => {
  it('读得出「这次没导出成功的段」', () => {
    const sections = readDegradedSections(
      JSON.stringify({
        userId: 'u-1',
        degradedSections: [{ section: 'ai_analysis_job', reason: '表不存在' }],
      }),
    )
    expect(sections).toEqual([{ section: 'ai_analysis_job', reason: '表不存在' }])
  })

  it('正文不是合法 JSON 时返回空数组（不因为前端解析失败就多报一个警告）', () => {
    expect(readDegradedSections('不是 JSON')).toEqual([])
  })

  it('缺失或不认识的字段不会造出假段落', () => {
    expect(readDegradedSections(JSON.stringify({ degradedSections: [{ section: '', reason: 'x' }] }))).toEqual([])
    expect(readDegradedSections(JSON.stringify({ degradedSections: 'nope' }))).toEqual([])
    expect(readDegradedSections(JSON.stringify({ userId: 'u-1' }))).toEqual([])
  })

  it('导出的文件里带着降级段落时，调用方拿得到（页面据此提示备份不完整）', async () => {
    responder = () =>
      new Response(JSON.stringify({ degradedSections: [{ section: 'assessment_report', reason: '查询失败' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const result = await exportAccountData()
    expect(result.blob.size).toBeGreaterThan(0)
    expect(result.degradedSections).toEqual([{ section: 'assessment_report', reason: '查询失败' }])
  })
})

describe('错误映射：没登录 / 已登录但没权限，必须分开', () => {
  it('403 FORBIDDEN 不算会话失效（否则会话一抖，有权限的人就被当成未登录）', async () => {
    responder = () => json({ code: 'FORBIDDEN', message: '你没有访问这个后台的权限。' }, 403)
    const error = await catches(fetchMe())

    expect(isForbidden(error)).toBe(true)
    expect(isSessionExpired(error)).toBe(false)
    const display = describeError(error)
    expect(display.code).toBe('FORBIDDEN')
    expect(display.sessionExpired).toBe(false)
  })

  it('401 UNAUTHENTICATED 才算会话失效，并带上服务端原话', async () => {
    responder = () =>
      json({ code: 'UNAUTHENTICATED', message: '登录状态已过期，请重新登录。', requestId: 'req-9' }, 401)
    const error = await catches(fetchMe())

    expect(isSessionExpired(error)).toBe(true)
    expect(isForbidden(error)).toBe(false)
    const display = describeError(error)
    expect(display.sessionExpired).toBe(true)
    expect(display.requestId).toBe('req-9')
  })

  it('既不是 V3ApiError 也不是已知错误体时，走网络错误的兜底说明并保留 code', async () => {
    const display = describeError(new Error('boom'))
    expect(display.message).toContain('网络')
    expect(display.sessionExpired).toBe(false)
  })
})
