// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { V3ApiError } from '@/api/v3'

/**
 * 首次会话探测（`GET /me`）的结果解释。
 *
 * 真实浏览器里的缺陷：匿名新访客打开登录页，页面上方写着「登录状态已经失效，请重新登录。」，
 * 像是被踢下线。首次探测 401 只说明现在没有登录态，不是「失效」。
 * 而「用着用着被服务端拒绝」仍然要解释原因 —— 两种情况必须分开。
 */

const fetchMe = vi.fn()

vi.mock('@/api/v3', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3')>('@/api/v3')
  return { ...actual, fetchMe: (...args: unknown[]) => fetchMe(...args) }
})

function unauthenticated(): V3ApiError {
  return new V3ApiError({ code: 'UNAUTHENTICATED', message: '请先登录。', requestId: 'rq-1', details: {} }, { status: 401 })
}

describe('认证 store · 首次会话探测', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMe.mockReset()
  })

  it('首次探测 401 → 变成未登录，且不带「登录状态已经失效」的提示', async () => {
    fetchMe.mockRejectedValue(unauthenticated())
    const auth = useAuthStore()

    await auth.ensureLoaded()

    expect(auth.status).toBe('anonymous')
    expect(auth.sessionNotice).toBeNull()
  })

  it('连不上服务器 → 仍然是「不可用」并说明原因，不能假装成未登录', async () => {
    fetchMe.mockRejectedValue(new Error('network down'))
    const auth = useAuthStore()

    await auth.ensureLoaded()

    expect(auth.status).toBe('unavailable')
    expect(auth.sessionNotice).toBeTruthy()
  })

  it('已登录期间被服务端拒绝 → 仍然提示登录已失效', async () => {
    fetchMe.mockResolvedValue({ userId: 'u1', username: 'a', nickname: null, createdAt: null, passwordChangedAt: null })
    const auth = useAuthStore()
    await auth.ensureLoaded()
    expect(auth.status).toBe('authenticated')

    auth.captureError(unauthenticated())

    expect(auth.status).toBe('anonymous')
    expect(auth.sessionNotice).toContain('登录状态已经失效')
  })
})
