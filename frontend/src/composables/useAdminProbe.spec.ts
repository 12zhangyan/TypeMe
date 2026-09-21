// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { V3ApiError } from '@/api/v3'
import { resetAdminProbeForTests, useAdminProbe } from '@/composables/useAdminProbe'

/**
 * 管理员探测的并发边界。
 *
 * 身份一变就会 `resetAdminProbe()`，但那只能丢掉 inflight **引用**，取消不了已经发出去的请求。
 * 管理员探测还没回来就换成普通账号时：新账号的 403 可能先落地，旧的 200 随后写入缓存，
 * 顶栏会把普通用户标成管理员。这里钉住"过期响应必须丢弃"。
 */

const fetchAdminAiSettings = vi.fn()

vi.mock('@/api/v3Admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Admin')>('@/api/v3Admin')
  return {
    ...actual,
    fetchAdminAiSettings: (...args: unknown[]) => fetchAdminAiSettings(...args),
  }
})

function forbidden(): V3ApiError {
  return new V3ApiError(
    { code: 'FORBIDDEN', message: '需要更高的权限', requestId: 'rq-9', details: {} },
    { status: 403 },
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('useAdminProbe：过期响应不得落地', () => {
  beforeEach(() => {
    resetAdminProbeForTests()
    fetchAdminAiSettings.mockReset()
  })

  it('新账号的 403 先回来、旧管理员请求后回来：仍判定为不是管理员', async () => {
    const first = deferred<{ enabled: boolean; mockMode: boolean }>()
    fetchAdminAiSettings.mockImplementationOnce(() => first.promise)

    const { isAdmin, refresh } = useAdminProbe()
    const stale = refresh('admin-user')
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(1)

    resetAdminProbeForTests()
    fetchAdminAiSettings.mockRejectedValueOnce(forbidden())
    const next = await refresh('normal-user')

    expect(next).toBe(false)
    expect(isAdmin.value).toBe(false)
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(2)

    first.resolve({ enabled: true, mockMode: true })
    await stale
    expect(isAdmin.value, '过期的 200 不能把普通账号标成管理员').toBe(false)

    const cached = await refresh('normal-user')
    expect(cached, '过期 200 也不能写进缓存').toBe(false)
    expect(fetchAdminAiSettings, '已有 403 缓存后不应再打').toHaveBeenCalledTimes(2)
  })

  it('同一账号并发 refresh 只打一次探测', async () => {
    const pending = deferred<{ enabled: boolean; mockMode: boolean }>()
    fetchAdminAiSettings.mockImplementation(() => pending.promise)
    const { refresh } = useAdminProbe()
    const a = refresh('u1')
    const b = refresh('u1')
    pending.resolve({ enabled: true, mockMode: true })
    expect(await a).toBe(true)
    expect(await b).toBe(true)
    expect(fetchAdminAiSettings).toHaveBeenCalledTimes(1)
  })
})
