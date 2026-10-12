import { defineStore } from 'pinia'
import {
  fetchInstrumentDetail,
  fetchInstruments,
  type InstrumentCard,
  type InstrumentDetail,
} from '@/api/platformV3'
import { describeError } from '@/api/v3'

/**
 * 站点上全部测评的目录（**含**十六型与大五）。
 *
 * ## 与 `instrumentV3` 的分工
 *
 * - `instrumentV3` 只回答"十六型参考测评叫什么、多少题"，给公共壳（顶栏副标题、
 *   页脚署名）用。它读的是 `/api/v3/catalog/current`，**未登录也能拿内置口径**。
 * - 这个 store 回答"站点上有哪几项测评、每项是什么"，给发现页、详情页、
 *   "我的测评"用。它读 `/api/v3/platform/instruments`，**公开**
 *   （`SecurityConfig` 里对 GET 单独 permitAll，与十六型目录同口径）。
 *
 * 那为什么还不合并？两个 store 的**失效模式**不同：
 *   - `instrumentV3` 需要"接口失败也能给出新测自己的口径"（它自带内置副本）；
 *   - 这个 store 需要"列表为空/加载中/失败"三种可区分的界面状态。
 * 合并会把两种语义压进一个 store，让公共壳又去依赖"列表就绪"这个条件。
 */
export interface InstrumentListState {
  items: InstrumentCard[]
  loading: boolean
  /** 已尝试过（成败都算）：避免发现页与"我的测评"页各发一次请求。 */
  attempted: boolean
  error: string | null
  details: Record<string, InstrumentDetail>
  generation: number
}

export const useInstrumentsStore = defineStore('instruments', {
  state: (): InstrumentListState => ({
    items: [],
    loading: false,
    attempted: false,
    error: null,
    details: {},
    generation: 0,
  }),

  getters: {
    /** 按 slug 找一项测评；找不到返回 null（页面显示"这项测评不存在"）。 */
    bySlug(state): (slug: string) => InstrumentCard | null {
      return (slug: string) => state.items.find((item) => item.slug === slug) ?? null
    },
  },

  actions: {
    /**
     * 读一次目录并缓存。
     *
     * 失败**不抛**：调用方在 `onMounted` 里调用，抛出去只会变成没人处理的 rejection。
     * 失败时页脚/卡片位置显示 `error`，而不是编一份假的目录。
     */
    async load(force = false): Promise<void> {
      if (this.loading) return
      if (this.attempted && !force) return
      const generation = this.generation
      this.loading = true
      this.error = null
      try {
        const items = await fetchInstruments()
        if (generation === this.generation) this.items = items
      } catch (error) {
        if (generation === this.generation) this.error = describeError(error).message
      } finally {
        if (generation === this.generation) {
          this.loading = false
          this.attempted = true
        }
      }
    },

    async loadDetail(slug: string, force = false): Promise<InstrumentDetail | null> {
      if (!force && this.details[slug]) return this.details[slug]
      const generation = this.generation
      try {
        const detail = await fetchInstrumentDetail(slug)
        if (generation !== this.generation) return null
        this.details = { ...this.details, [slug]: detail }
        return detail
      } catch (error) {
        if (generation === this.generation) this.error = describeError(error).message
        return null
      }
    },

    /** 会话切换时重新读取公开目录，旧请求不能阻塞或覆盖新请求。 */
    reset(): void {
      this.generation += 1
      this.loading = false
      this.items = []
      this.attempted = false
      this.error = null
      this.details = {}
    },
  },
})
