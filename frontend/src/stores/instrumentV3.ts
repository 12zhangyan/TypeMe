import { defineStore } from 'pinia'
import { fetchCatalog, type CatalogSummary } from '@/api/v3Assessment'
import { DIMENSIONS, NEGATIVE_POLE, POSITIVE_POLE, type Dimension } from '@/domain/jung/types'

/**
 * 新测（`typeme-jung48`）对外的量表口径 —— 首页首屏与公共壳的**唯一**来源。
 *
 * ## 为什么需要这个 store
 *
 * 首页、公共壳（顶栏副标题 / 页脚署名）过去都从 `useQuizStore().activePackage`
 * 读量表名与题数，而那是**旧引擎**（IPIP-50 大五 / OEJTS-32）的内容包。结果是一份
 * 十六型报告顶着「大五人格倾向自测」的署名、首页主按钮写着「开始测评（50 题）」
 * 却链到 48 题主测的十六型测评（见 `docs/2026-09-16/verification/browser-acceptance.md`
 * 的问题 1 / 问题 2）。
 *
 * 新测的口径只能来自新测自己：`GET /api/v3/catalog/current`。
 *
 * ## 为什么还留了一份内置口径
 *
 * `GET /api/v3/catalog/current` **从 2026-09-21 起是公开的**（`SecurityConfig` 里单独
 * `permitAll`，并配套匿名按 IP 限流）：未登录访客现在拿得到服务端的最新口径。
 * 内置副本仍然保留，因为接口挂掉、离线、或匿名限流命中（429）时，公共壳与首页
 * 必须仍然给出**新测自己的**口径 —— 退回旧引擎的内容包正是本次要修的 bug，
 * 所以内置副本描述的是新测量表本身。
 *
 * ⚠️ 内置口径里的数字要改时，两处必须一起改：
 *   - 内容包 `backend/src/main/resources/content/typeme-jung48-zh-v1.json`
 *   - `docs/2026-09-16/TypeMe-MBTI测评站-产品方案.md` §1（主测 48 题 / 每维 12 题 /
 *     最多 64 题 / 主测 8–12 分钟）
 * 只要读得到目录，下面这些值一律被目录里的真实值覆盖（见 {@link factsOf}）。
 */

/** 首页首屏的维度示意图用它渲染每一条轨道。 */
export interface NewInstrumentDimension {
  dimension: Dimension
  name: string
  /** 左端（负极）记号。 */
  low: string
  /** 右端（正极）记号。 */
  high: string
}

export interface NewInstrumentFacts {
  /** 量表对外名称（目录的 `title`）。 */
  title: string
  /** 主测题数：用户实际要答的那一轮。 */
  baseQuestions: number
  /** 题库总题数（主测 + 补充题上限）。 */
  bankQuestions: number
  /** 补充题上限：只在某一维两边差不多时才出现，可以跳过。 */
  clarificationQuestions: number
  /** 维度数。 */
  dimensionCount: number
  /** 四个维度（顺序与内容包一致）。 */
  dimensions: NewInstrumentDimension[]
  /** 主测预计时长下限（分钟）。 */
  minutesLow: number
  /** 主测预计时长上限（分钟）。 */
  minutesHigh: number
  /** true = 名称与题数来自目录；false = 内置对外口径（未登录或离线）。 */
  fromCatalog: boolean
}

/**
 * 内置对外口径 —— 新测自己的名称与题量，与旧引擎的 IPIP-50 / OEJTS-32 无关。
 *
 * 四个维度名取自 `GET /api/v3/catalog/current` 的 `dimensions[].name`（实测值）；
 * 两端记号取 `domain/jung/types.ts` 的极向定义（框架常量，不是内容包的文案）。
 */
export const NEW_INSTRUMENT_FALLBACK = {
  title: '十六型人格参考测评',
  baseQuestions: 48,
  bankQuestions: 64,
  clarificationQuestions: 16,
} as const

/** 读不到目录时的维度名 —— 必须与内容包 `typeme-jung48-zh-v1.json` 里的 `name` 逐字一致。 */
const FALLBACK_DIMENSION_NAMES: Record<Dimension, string> = {
  EI: '精力方向',
  SN: '信息取向',
  TF: '决策依据',
  JP: '生活节奏',
}

/**
 * 主测预计时长。
 *
 * 产品方案 §1 给的是"主测 48 题 ≈ 8–12 分钟"，即每题的阅读与作答预算 10–15 秒。
 * 这里按这个速率从**目录里的主测题数**换算，而不是写死 8–12：题量一旦变化，
 * 时长跟着变，不会出现"题变多了、时长还是老的"。
 */
function minutesOf(baseQuestions: number): { minutesLow: number; minutesHigh: number } {
  const minutesLow = Math.max(1, Math.round((baseQuestions * 10) / 60))
  const minutesHigh = Math.max(minutesLow + 1, Math.round((baseQuestions * 15) / 60))
  return { minutesLow, minutesHigh }
}

function fallbackDimensions(): NewInstrumentDimension[] {
  return DIMENSIONS.map((dimension) => ({
    dimension,
    name: FALLBACK_DIMENSION_NAMES[dimension],
    low: NEGATIVE_POLE[dimension],
    high: POSITIVE_POLE[dimension],
  }))
}

/**
 * 目录 → 对外口径。
 *
 * 目录里缺字段时**退化到内置口径**而不是补 0：首页宁可少说一句题数，也不能显示
 * "0 道题"或另一套量表的数字。维度名同理 —— 目录没给名字时用内置口径的名字，
 * 不用旧引擎内容包里的维度名（那正是原来的错）。
 */
function factsOf(catalog: CatalogSummary | null): NewInstrumentFacts {
  if (!catalog) {
    return {
      title: NEW_INSTRUMENT_FALLBACK.title,
      baseQuestions: NEW_INSTRUMENT_FALLBACK.baseQuestions,
      bankQuestions: NEW_INSTRUMENT_FALLBACK.bankQuestions,
      clarificationQuestions: NEW_INSTRUMENT_FALLBACK.clarificationQuestions,
      dimensionCount: DIMENSIONS.length,
      dimensions: fallbackDimensions(),
      ...minutesOf(NEW_INSTRUMENT_FALLBACK.baseQuestions),
      fromCatalog: false,
    }
  }

  const dimensions: NewInstrumentDimension[] =
    catalog.dimensions.length > 0
      ? catalog.dimensions.map((item) => ({
          dimension: item.dimension,
          name: item.name || FALLBACK_DIMENSION_NAMES[item.dimension],
          low: item.negativePole || NEGATIVE_POLE[item.dimension],
          high: item.positivePole || POSITIVE_POLE[item.dimension],
        }))
      : fallbackDimensions()
  const dimensionCount = dimensions.length

  const baseQuestions =
    catalog.basePerDimension > 0
      ? catalog.basePerDimension * dimensionCount
      : NEW_INSTRUMENT_FALLBACK.baseQuestions
  const clarificationQuestions =
    catalog.maxClarificationItems > 0
      ? catalog.maxClarificationItems
      : catalog.clarificationPerDimension * dimensionCount
  const bankQuestions =
    catalog.questionCount > 0 ? catalog.questionCount : baseQuestions + clarificationQuestions

  return {
    title: catalog.title ?? NEW_INSTRUMENT_FALLBACK.title,
    baseQuestions,
    bankQuestions,
    clarificationQuestions,
    dimensionCount,
    dimensions,
    ...minutesOf(baseQuestions),
    fromCatalog: true,
  }
}

export const useInstrumentV3Store = defineStore('instrumentV3', {
  state: () => ({
    /** `GET /api/v3/catalog/current` 的响应；读不到（离线 / 接口失败 / 匿名被限流）时为 null。 */
    catalog: null as CatalogSummary | null,
    loading: false,
    /** 已经问过一次（成败都算）：首页与公共壳各调一次 `load()`，不会真的发两次请求。 */
    attempted: false,
  }),

  getters: {
    /** 新测的对外口径。**只读**：页面不要自己拼量表名或题数。 */
    facts(state): NewInstrumentFacts {
      return factsOf(state.catalog)
    },
  },

  actions: {
    /**
     * 读一次目录并缓存。
     *
     * 失败（离线 / 接口失败 / 匿名被限流）时**保留内置对外口径**，绝不退回旧内容包；
     * 失败不抛异常：调用方是在 `onMounted` 里 fire-and-forget 的，抛出去只会变成
     * 一个没人处理的 rejection。
     */
    async load(): Promise<void> {
      if (this.attempted || this.loading) return
      this.loading = true
      try {
        this.catalog = await fetchCatalog()
      } catch {
        this.catalog = null
      } finally {
        this.attempted = true
        this.loading = false
      }
    },

    /**
     * 强制重新读一次。
     *
     * 报告页用它兜住一条真实路径：访客在首页读过一次且**没读到**
     * （离线 / 接口失败 / 匿名限流命中），记下了 `attempted`；
     * 之后网络恢复或登录后再进报告页，应该再试一次而不是一直用内置口径。
     */
    async refresh(): Promise<void> {
      this.attempted = false
      await this.load()
    },
  },
})
