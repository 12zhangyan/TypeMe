// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { regenerateRecoveryCodes, registerAccount, UNEXPECTED_RESPONSE_CODE } from '@/api/v3'

/**
 * 恢复码「服务端 201 了、码却没回来」时该怎么算（2026-09-17，A36）。
 *
 * 这一条的风险全在**后果的不对称**上：
 *
 * - 服务端在返回 201 之前已经 `revokeAllUsable` + 推高版本号 —— 旧码**此刻已经作废**；
 * - 如果前端把"响应里没有 recoveryCodes"读成"正常的空数组"，
 *   页面既不报错也不显示空态（密码框还会被清空），用户看不出发生过任何事，
 *   也就不会去抄新码 —— 等于**在无提示的情况下丢掉全部恢复码**。
 *
 * 而注册流程对**同一个字段**必须反过来处理：账号已经建好了，
 * 因为"响应没带码"就把注册判成失败，用户会以为没注册成、再去重试一个已被占用的用户名。
 * 所以这两处的期望是**故意不同**的，本文件把两边都钉住。
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubFetch(handler: (url: string, method: string) => Response): void {
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    return handler(url, method)
  }) as never)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('重新生成恢复码', () => {
  it('正常拿到码时原样返回', async () => {
    stubFetch(() => jsonResponse({ recoveryCodes: ['AAAA-1111', 'BBBB-2222'] }))

    await expect(regenerateRecoveryCodes('pw')).resolves.toEqual(['AAAA-1111', 'BBBB-2222'])
  })

  it('201 但响应里**没有** recoveryCodes：必须判失败，不能安静地返回空数组', async () => {
    // 旧码此刻已经作废，如果这里安静通过，用户永远不会知道要去抄新码。
    stubFetch(() => jsonResponse({}, 201))

    await expect(regenerateRecoveryCodes('pw')).rejects.toMatchObject({
      code: UNEXPECTED_RESPONSE_CODE,
    })
  })

  it('recoveryCodes 是空数组同样判失败（"生成成功但没码"和"没生成"对用户是一回事）', async () => {
    stubFetch(() => jsonResponse({ recoveryCodes: [] }, 201))

    await expect(regenerateRecoveryCodes('pw')).rejects.toMatchObject({
      code: UNEXPECTED_RESPONSE_CODE,
    })
  })

  it('错误文案要说清"旧码可能已作废、请重新生成"', async () => {
    // 只报"服务器返回了看不懂的内容"没用 —— 用户需要知道下一步该做什么，
    // 而且要知道自己手里的旧码可能已经不能用了。
    stubFetch(() => jsonResponse({ recoveryCodes: null }, 201))

    await expect(regenerateRecoveryCodes('pw')).rejects.toMatchObject({
      message: expect.stringContaining('作废'),
    })
  })
})

describe('注册时对同一个字段的期望（故意相反）', () => {
  it('注册成功但响应没带码：账号照样算建成，由页面另行提示', async () => {
    // 这里如果抛错，用户会以为账号没建成，然后去重试注册 —— 而用户名已被占用。
    stubFetch(() =>
      jsonResponse(
        {
          userId: 'u-1',
          username: 'someone',
          nickname: null,
          createdAt: '2026-09-17T00:00:00Z',
          passwordChangedAt: null,
          // 刻意不给 recoveryCodes
        },
        201,
      ),
    )

    const result = await registerAccount({
      username: 'someone',
      password: 'TestPassw0rd!',
      disclaimerAccepted: true,
      invitationCode: "a".repeat(32),
    })

    expect(result.profile.userId).toBe('u-1')
    expect(result.recoveryCodes).toEqual([])
  })
})
