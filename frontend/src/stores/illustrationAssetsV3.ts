import { defineStore } from 'pinia'
import { fetchIllustrations } from '@/api/platformV3'
import { describeError } from '@/api/v3'
import { normalizeRemoteImageUrl } from '@/design/remoteImageUrl'

/**
 * 公开插画的远端地址表（`名字 → 绝对地址`）。
 *
 * ## 为什么放在 store 里、启动时就读
 *
 * 地址表是**页面渲染插画的前提**，而页面自己不知道"要等多久"。把它收在一个地方，
 * 好处是：整站只发一次请求（不是每个 `<IllustrationFrame>` 各发一次）、
 * 等待预算与降级规则只有一份、浏览器验证脚本能直接观察状态。
 *
 * ## 首屏取舍（刻意的）
 *
 * 地址表是异步到的，首屏第一次访问时它可能还没到。三种选择里选了"短暂占位"：
 *
 *   1. **占位等地址表**（当前实现）：绝不从源站下一张马上要被远端地址替换掉的图；
 *      代价是第一次访问时首屏图片可能晚出现几十毫秒；
 *   2. 先用本地打包资源、到了再换成远端：**不做**——那正是这次迁移要省掉的那次下载，
 *      而且会看到图片换一次；
 *   3. 等到天荒地老：不做。等待有预算（{@link WAIT_BUDGET_MS}），超时就用本地资源。
 *
 * 重复访问时没有这个等待：上一次的地址表在 `localStorage` 里，启动时**同步**读出来，
 * 于是首屏图片地址在第一帧就是确定的（随后再后台刷新一次）。
 *
 * ## 失败不是"页面坏了"
 *
 * 读不到地址表时整站继续用本地打包资源（`design/illustrationAssets.ts` 的默认行为），
 * 页面照常显示，只是又回到"从源站出图"。所以这里不抛错、不阻塞渲染，
 * 只把 `status` 置为 `failed` 并留下 `error` 供排查（同时打一条 console 警告）。
 */
export const useIllustrationAssetsStore = defineStore('illustrationAssets', {
  state: () => ({
    /** `名字 → 绝对地址`。空对象表示"还没有可用的地址表"。 */
    urls: {} as Record<string, string>,
    release: null as string | null,
    version: null as string | null,
    status: 'idle' as IllustrationAssetStatus,
    /** 最近一次读取失败的原因（页面不展示，排查用）。 */
    error: null as string | null,
    /** 等待预算已用尽：组件据此改用本地资源，不再等地址表。 */
    waitedOut: false,
    /** 已尝试过（成败都算）：避免重复请求。 */
    attempted: false,
  }),

  getters: {
    /**
     * 组件是否可以开始解析地址。
     *
     * `true` 的三种情形：拿到了地址表、确定拿不到（失败）、等待预算用尽。
     * 只有全为假时才显示占位——这正是"不要让首屏无限等"的落点。
     */
    settled: (state): boolean =>
      state.status === 'ready' || state.status === 'failed' || state.waitedOut,
  },

  actions: {
    /**
     * 同步读上一次缓存的地址表（启动时调用，必须**不**发请求、不 await）。
     *
     * 读不出来（首次访问、隐私模式、缓存被清、内容损坏）就什么都不做：
     * 那种情况下 `settled` 仍为假，组件显示占位，随后的 `load()` 会补上。
     */
    hydrate(): void {
      const cached = readCache()
      if (!cached) return
      this.urls = cached.urls
      this.release = cached.release
      this.version = cached.version
      this.status = 'ready'
    },

    /**
     * 读一次地址表。
     *
     * 失败**不抛**：调用方在启动时调用，抛出去只会变成没人处理的 rejection。
     * 有缓存时刷新失败**不降级**（缓存里的地址仍然可用），只记录 `error`。
     */
    async load(force = false): Promise<void> {
      if (this.status === 'loading') return
      if (this.attempted && !force) return
      this.attempted = true
      this.error = null
      const hadUrls = Object.keys(this.urls).length > 0
      if (!hadUrls) this.status = 'loading'
      startWaitBudget(this)

      try {
        const map = await fetchIllustrations()
        const { urls, dropped } = usableUrls(map.urls)
        this.urls = urls
        this.release = map.release
        this.version = map.version
        this.status = 'ready'
        writeCache({ version: map.version, release: map.release, urls })
        if (dropped.length > 0) {
          // 不静默：这些图会退回本地资源，得让人知道是哪几个、为什么。
          console.warn(
            `[插画地址] 以下地址不符合使用规则，已改用本地资源：${dropped.join('、')}。`
            + '服务端写入时本应拒绝这些地址，请检查 illustration_asset 表是否被手工改过。',
          )
        }
      } catch (error) {
        this.error = describeError(error).message
        if (!hadUrls) this.status = 'failed'
        console.warn(`[插画地址] 读取失败，本次改用本地打包插画：${this.error}`)
      } finally {
        clearWaitBudget()
      }
    },

    /** 仅供测试与"整页重载"场景使用：把状态退回启动前。 */
    reset(): void {
      clearWaitBudget()
      this.urls = {}
      this.release = null
      this.version = null
      this.status = 'idle'
      this.error = null
      this.waitedOut = false
      this.attempted = false
    },
  },
})

export type IllustrationAssetStatus = 'idle' | 'loading' | 'ready' | 'failed'

/**
 * 等待地址表的预算。
 *
 * 数字是取舍不是常量：同一台服务器上的一个小 JSON，正常远快于它；只有"网络很差或
 * 服务端卡住"时才会走到超时。设得再大，收益只是多一张可能会换掉的图；
 * 设得太小，首屏图片会白等一次本地下载。1.2s 与首屏图片自身的加载时间同量级。
 */
export const WAIT_BUDGET_MS = 1200

const CACHE_KEY = 'typeme.illustration-urls.v1'

interface IllustrationCache {
  version: string
  release: string | null
  urls: Record<string, string>
}

/**
 * 过滤出"能用"的地址。
 *
 * 这里与解析层（`design/illustrationAssets.ts`）**刻意重复**一次校验：这里过滤是为了
 * "一次算清楚、并留下可排查的警告"，解析层那一次是最后一道闸（组件总会经过它）。
 * 返回被丢掉的 `名字（原因）`，供上面那条警告使用。
 */
export function usableUrls(raw: Record<string, string>): { urls: Record<string, string>; dropped: string[] } {
  const urls: Record<string, string> = {}
  const dropped: string[] = []
  for (const [name, value] of Object.entries(raw)) {
    const normalized = normalizeRemoteImageUrl(value)
    if (normalized) urls[name] = normalized
    else dropped.push(`${name}（${value || '空地址'}）`)
  }
  return { urls, dropped }
}

/* ── 等待预算的定时器 ───────────────────────────────────────────────────── */

let waitTimer: ReturnType<typeof setTimeout> | null = null

function startWaitBudget(store: { waitedOut: boolean }): void {
  clearWaitBudget()
  if (store.waitedOut) return
  waitTimer = setTimeout(() => {
    waitTimer = null
    // 超时只是"别再等了"：请求仍在飞，晚到的地址表照样会被采用（刷新不影响正确性）。
    store.waitedOut = true
  }, WAIT_BUDGET_MS)
}

function clearWaitBudget(): void {
  if (waitTimer !== null) {
    clearTimeout(waitTimer)
    waitTimer = null
  }
}

/* ── localStorage 缓存 ──────────────────────────────────────────────────── */

function readCache(): IllustrationCache | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const record = parsed as Record<string, unknown>
    const urls = record['urls']
    if (typeof record['version'] !== 'string' || typeof urls !== 'object' || urls === null) return null
    const cleaned: Record<string, string> = {}
    for (const [name, value] of Object.entries(urls as Record<string, unknown>)) {
      if (typeof value === 'string') cleaned[name] = value
    }
    if (Object.keys(cleaned).length === 0) return null
    const release = record['release']
    return {
      version: record['version'],
      release: typeof release === 'string' ? release : null,
      urls: cleaned,
    }
  } catch {
    // 隐私模式、配额、被手工改坏的内容：都当成"没有缓存"，不能因此让页面起不来。
    return null
  }
}

function writeCache(cache: IllustrationCache): void {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // 写不进去只是失去"下次免等"的优化，不影响本次已经拿到的地址表。
  }
}
