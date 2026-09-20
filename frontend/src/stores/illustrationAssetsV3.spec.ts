// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { WAIT_BUDGET_MS, useIllustrationAssetsStore } from './illustrationAssetsV3'

const { fetchIllustrations } = vi.hoisted(() => ({ fetchIllustrations: vi.fn() }))
vi.mock('@/api/platformV3', () => ({ fetchIllustrations }))

const CACHE_KEY = 'typeme.illustration-urls.v1'
const HOST = 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com'
const HOME = `${HOST}/illustrations/2026-09-20/home-hero.4583aa734b96.webp`

function mapOf(urls: Record<string, string>, version = '21:2026-09-20T00:00:00Z') {
  return { release: '2026-09-20', version, urls }
}

/** 一个能由测试决定何时结束的请求。 */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

describe('插画地址表 store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    fetchIllustrations.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('首次访问：读表成功后可用于解析，地址写进缓存供下次免等', async () => {
    fetchIllustrations.mockResolvedValue(mapOf({ 'home-hero': HOME }))
    const store = useIllustrationAssetsStore()

    expect(store.settled).toBe(false)
    await store.load()

    expect(store.status).toBe('ready')
    expect(store.settled).toBe(true)
    expect(store.urls['home-hero']).toBe(HOME)
    expect(store.release).toBe('2026-09-20')
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}').urls['home-hero']).toBe(HOME)
  })

  it('重复访问：hydrate() 同步读缓存，首帧就有地址，不用等请求', () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      version: '21:2026-09-20T00:00:00Z', release: '2026-09-20', urls: { 'home-hero': HOME },
    }))
    const store = useIllustrationAssetsStore()

    expect(store.status).toBe('idle')
    store.hydrate()

    expect(store.status).toBe('ready')
    expect(store.settled).toBe(true)
    expect(store.urls['home-hero']).toBe(HOME)
  })

  it('缓存内容损坏或为空时当作没有缓存，不影响页面启动', () => {
    for (const broken of ['not json', '{}', '[]', JSON.stringify({ version: '1', urls: {} }), JSON.stringify({ urls: { a: 1 } })]) {
      localStorage.setItem(CACHE_KEY, broken)
      const store = useIllustrationAssetsStore()
      store.hydrate()
      expect(store.status, `缓存内容「${broken}」不应被当成可用地址表`).toBe('idle')
      expect(store.settled).toBe(false)
    }
  })

  it('读表失败且没有缓存：不抛错，状态落到 failed（页面继续用本地资源）', async () => {
    fetchIllustrations.mockRejectedValue(new Error('网络炸了'))
    const store = useIllustrationAssetsStore()

    await store.load()

    expect(store.status).toBe('failed')
    expect(store.settled).toBe(true)
    expect(store.error).toBeTruthy()
    expect(store.urls).toEqual({})
  })

  it('有缓存时刷新失败不降级：缓存里的地址仍然可用，只记录错误', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: 'v1', release: null, urls: { 'home-hero': HOME } }))
    fetchIllustrations.mockRejectedValue(new Error('读表失败'))
    const store = useIllustrationAssetsStore()

    store.hydrate()
    await store.load()

    expect(store.status).toBe('ready')
    expect(store.urls['home-hero']).toBe(HOME)
    expect(store.error).toBeTruthy()
  })

  it('等待预算用尽后不再让首屏等：settled 变真，晚到的地址表照样生效', async () => {
    vi.useFakeTimers()
    const pending = deferred<ReturnType<typeof mapOf>>()
    fetchIllustrations.mockReturnValue(pending.promise)
    const store = useIllustrationAssetsStore()

    const loading = store.load()
    expect(store.settled).toBe(false)

    await vi.advanceTimersByTimeAsync(WAIT_BUDGET_MS)
    expect(store.waitedOut).toBe(true)
    expect(store.settled).toBe(true)
    expect(store.urls).toEqual({})

    // 请求没有取消：它回来之后地址表照常生效（组件下一次解析就会用远端地址）
    pending.resolve(mapOf({ 'home-hero': HOME }))
    await loading
    expect(store.urls['home-hero']).toBe(HOME)
  })

  it('不合法或不该使用的地址被剔除（并留下可排查的警告），其余照常使用', async () => {
    fetchIllustrations.mockResolvedValue(mapOf({
      'home-hero': HOME,
      'welcome': 'http://yan-public-1407914221.cos.ap-beijing.myqcloud.com/welcome.webp',
      'reflection': 'https://user:pass@yan-public-1407914221.cos.ap-beijing.myqcloud.com/a.webp',
      'assessment-jung': '',
    }))
    const store = useIllustrationAssetsStore()

    await store.load()

    expect(Object.keys(store.urls)).toEqual(['home-hero'])
    expect(console.warn).toHaveBeenCalled()
  })

  it('同一份数据只请求一次，除非显式要求刷新', async () => {
    fetchIllustrations.mockResolvedValue(mapOf({}))
    const store = useIllustrationAssetsStore()

    await store.load()
    await store.load()
    expect(fetchIllustrations).toHaveBeenCalledTimes(1)

    await store.load(true)
    expect(fetchIllustrations).toHaveBeenCalledTimes(2)
  })
})
