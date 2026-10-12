// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { clearCsrfToken, currentCsrfHeader, ensureCsrfToken, rememberCsrfToken } from './csrf'
import { v3Request, updateNickname } from './v3'
import { installSessionExpiryBridge, useAuthStore } from '@/stores/auth'
import { useInstrumentsStore } from '@/stores/instrumentsV3'

const profile = (userId: string) => ({ userId, username: userId, nickname: userId, createdAt: null, passwordChangedAt: null })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const csrf = (token = 'synthetic-current') => ({ token, headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
let unbind: () => void

beforeEach(() => {
  setActivePinia(createPinia())
  clearCsrfToken()
  useAuthStore().applyProfile(profile('account-a'))
  unbind = installSessionExpiryBridge()
})
afterEach(() => { unbind(); vi.unstubAllGlobals(); clearCsrfToken() })

function switchAccount() {
  const auth = useAuthStore()
  auth.applyAnonymous()
  auth.applyProfile(profile('account-b'))
  return auth
}

describe('请求只属于发起时的会话', () => {
  it('旧请求的 401 不能退出后登录的新账号', async () => {
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => old.promise))
    const pending = v3Request('GET', '/reports').catch((error) => error)
    const auth = switchAccount()
    old.resolve(json({ code: 'UNAUTHENTICATED', message: 'old session expired' }, 401))
    await pending
    expect(auth.profile?.userId).toBe('account-b')
    expect(auth.status).toBe('authenticated')
  })

  it('当前会话的 401 仍然清除登录状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'UNAUTHENTICATED' }, 401)))
    await v3Request('GET', '/reports').catch(() => {})
    expect(useAuthStore().status).toBe('anonymous')
  })

  it('错误正文迟到时也不能退出新账号', async () => {
    const body = deferred<unknown>()
    const response = json({}, 401)
    response.json = () => body.promise
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const pending = v3Request('GET', '/reports').catch((error) => error)
    await flushPromises()
    switchAccount()
    body.resolve({ code: 'UNAUTHENTICATED' })
    await pending
    expect(useAuthStore().profile?.userId).toBe('account-b')
  })

  it('旧写请求的 CSRF 错误不能用新账号自动重发', async () => {
    const old = deferred<Response>()
    let writes = 0
    rememberCsrfToken(csrf())
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/csrf')) return json(csrf())
      writes += 1
      return writes === 1 ? old.promise : json(profile('account-b'))
    }))
    const pending = updateNickname('只属于甲的昵称').catch((error) => error)
    await flushPromises()
    expect(writes).toBe(1)
    switchAccount()
    old.resolve(json({ code: 'CSRF_INVALID' }, 403))
    await pending
    expect(writes).toBe(1)
    expect(useAuthStore().profile?.userId).toBe('account-b')
  })

  it('等待安全校验时更换账号，不再发送旧的业务写入', async () => {
    const token = deferred<Response>()
    let writes = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/csrf')) return token.promise
      writes += 1
      return json(profile('account-b'))
    }))
    const pending = updateNickname('只属于甲的昵称').catch((error) => error)
    await flushPromises()
    switchAccount()
    token.resolve(json(csrf('synthetic-old')))
    await pending
    expect(writes).toBe(0)
  })

  it('迟到的个人资料不能把新账号覆盖成旧账号', async () => {
    const old = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => old.promise))
    const auth = useAuthStore()
    const pending = auth.refreshProfile().catch((error) => error)
    switchAccount()
    old.resolve(json(profile('account-a')))
    await pending
    expect(auth.profile?.userId).toBe('account-b')
    expect(auth.lastError).toBeNull()
  })

  it('成功响应正文仍在读取时换号，不接受旧账号资料', async () => {
    const body = deferred<unknown>()
    const response = json(profile('account-a'))
    response.json = () => body.promise
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const pending = useAuthStore().refreshProfile().catch((error) => error)
    await flushPromises()
    switchAccount()
    body.resolve(profile('account-a'))
    await pending
    expect(useAuthStore().profile?.userId).toBe('account-b')
  })

  it('读取导出正文期间换号，不把旧账号文件交给新页面', async () => {
    const body = deferred<string>()
    const response = json({})
    response.text = () => body.promise
    rememberCsrfToken(csrf())
    vi.stubGlobal('fetch', vi.fn(async () => response))
    const pending = useAuthStore().exportData().catch((error) => error)
    await flushPromises()
    switchAccount()
    body.resolve(JSON.stringify({ userId: 'account-a', reports: [] }))
    const result = await pending
    expect(result.code).toBe('SESSION_CHANGED')
    expect(useAuthStore().lastError).toBeNull()
  })

  it('账号切换后立即重新载入目录，旧请求不结束新 loading 或留下错误', async () => {
    const old = deferred<Response>(), fresh = deferred<Response>()
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetch)
    const instruments = useInstrumentsStore()
    const first = instruments.load()
    switchAccount()
    const second = instruments.load()
    old.resolve(json({ code: 'UNAUTHENTICATED' }, 401))
    await first
    try {
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(instruments.loading).toBe(true)
      expect(instruments.error).toBeNull()
      expect(instruments.attempted).toBe(false)
    } finally {
      fresh.resolve(json({ items: [] }))
      await second
    }
    expect(instruments.attempted).toBe(true)
    expect(instruments.loading).toBe(false)
  })

  it('旧动作的 finally 不解除新登录请求的忙碌状态', async () => {
    const old = deferred<Response>(), login = deferred<Response>()
    rememberCsrfToken(csrf())
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/auth/csrf')) return json(csrf())
      if (url.endsWith('/auth/login')) return login.promise
      return old.promise
    }))
    const auth = useAuthStore()
    const saving = auth.saveNickname('旧昵称').catch((error) => error)
    await flushPromises()
    auth.applyAnonymous()
    const loggingIn = auth.login('account-b', 'synthetic-password').catch((error) => error)
    await flushPromises()
    old.resolve(json(profile('account-a')))
    await saving
    try { expect(auth.busy).toBe(true) }
    finally { login.resolve(json(profile('account-b'))); await loggingIn }
    expect(auth.profile?.userId).toBe('account-b')
    expect(auth.busy).toBe(false)
  })
})

describe('安全校验缓存失效', () => {
  it('旧请求的清理回调不能移除仍在获取的新 token 请求', async () => {
    const old = deferred<Response>(), fresh = deferred<Response>()
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetch)
    const first = ensureCsrfToken()
    clearCsrfToken()
    const second = ensureCsrfToken()
    old.resolve(json(csrf('synthetic-old')))
    await first
    const third = ensureCsrfToken()
    fresh.resolve(json(csrf('synthetic-fresh')))
    await Promise.all([second, third])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(currentCsrfHeader()?.value).toBe('synthetic-fresh')
  })

  it('清理旧缓存后新请求独立取值，迟到旧结果不覆盖新缓存', async () => {
    const old = deferred<Response>(), fresh = deferred<Response>()
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    vi.stubGlobal('fetch', fetch)
    const first = ensureCsrfToken()
    clearCsrfToken()
    const second = ensureCsrfToken()
    fresh.resolve(json(csrf('synthetic-fresh')))
    old.resolve(json(csrf('synthetic-old')))
    await Promise.all([first, second])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(currentCsrfHeader()?.value).toBe('synthetic-fresh')
  })
})
