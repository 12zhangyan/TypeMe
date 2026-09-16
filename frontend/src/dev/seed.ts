import type { Dimension, Question } from '@/domain/types'
import { dimensionOrderOf } from '@/domain/scoring'
import { packageDimensionOrder } from '@/domain/assessmentPackage'
import type { useQuizStore } from '@/stores/quiz'

/**
 * 开发/验收用的答卷种子 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §10.4。
 *
 * 默认**只在开发环境生效**，生产构建里会被整段跳过（`import.meta.env.DEV` 是编译期常量）。
 * 需要验收打包产物时用构建期开关显式打开：`$env:VITE_ENABLE_SEED='1'; npm run build`。
 *
 * 为什么需要它：验收要求可复现的固定向量（全中立 / 全部无法判断 / 部分维度不足 /
 * 有明确方向 / 边界改答），手工点 30–50 题既慢又容易点错，截图就不可复现了。
 *
 * 它写的是**真实会话**（走 `store.selectRating` / `store.selectUnknown`，会落盘），
 * 因此刷新、回改、结果页、分享全部按正常路径工作，不是在页面上伪造显示。
 *
 * **两种量表**（站点默认是 IPIP-50 大五，OEJTS-32 作为可选旧版本保留）：
 * 每维题数不同（OEJTS 每维 8 题 → |偏移| ≤ 16；IPIP 每维 10 题 → |偏移| ≤ 20），
 * 展示门槛也不同，所以目标偏移按**仪器**分表声明，绝不跨量表复用同一组数字。
 *
 * 用法（`#/quiz?seed=...`）：
 *   seed=3           全选 3                     → 各维 balanced，无方向
 *   seed=1 / seed=5  全选 1 / 全选 5            → 只有符号不平衡的维度给出方向，partial
 *   seed=left        推向低分端                  → 各维 leaning
 *   seed=right       推向高分端                  → 各维 leaning
 *   seed=opposing    每维一半 +2 / 一半 −2       → 各维 balanced，但符号分布不同
 *   seed=unknown     全部「暂时无法判断」        → 信息不足，无任何分数
 *   seed=mixed       一个维度信息不足，其余可判  → partial + insufficient
 *   seed=ref-typed   OEJTS −12/+8/−8/+10        → 参考组合 INFP（四个维度都达到展示条件）
 *                    IPIP  −14/+8/−16/+14/+8    → 五个维度都达到展示条件（无类型码）
 *   seed=ref-partial OEJTS −12/+4/−8/+10        → SN 不足以给出方向，完整类型为空
 *                    IPIP  −14/+4/−16/+14/+8    → A 不足以给出方向（边界改答对照）
 */

const SEED_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_SEED === '1'

type SeedName =
  | '1'
  | '3'
  | '5'
  | 'left'
  | 'right'
  | 'opposing'
  | 'unknown'
  | 'mixed'
  | 'ref-typed'
  | 'ref-partial'

/**
 * 每维目标偏移（`score − midpoint`），按 `instrument.id` 分表。
 *
 * 上界由每维题数决定（`2 × 题数`），因此同一组数字只对声明它的量表成立：
 * 把 OEJTS 的 ±12 直接搬到 IPIP 上会得到完全不同的解释状态。
 */
const OFFSET_SEEDS: Record<
  string,
  Partial<Record<SeedName, Partial<Record<Dimension, number>>>>
> = {
  oejts32: {
    'ref-typed': { EI: -12, SN: 8, TF: -8, JP: 10 },
    'ref-partial': { EI: -12, SN: 4, TF: -8, JP: 10 },
    // 三维给出方向 + SN 信息不足
    mixed: { EI: -10, TF: 10, JP: 10 },
  },
  ipip50: {
    // 五个维度都 ≥ 展示门槛(6)：E/C/ES 进入 leaning(≥11)，A/O 停在 tentative
    'ref-typed': { E: -14, A: 8, C: -16, ES: 14, O: 8 },
    // A 只有 4 分：不足以给出方向 → partial（边界改答对照）
    'ref-partial': { E: -14, A: 4, C: -16, ES: 14, O: 8 },
    // 四维给出方向 + ES 信息不足
    mixed: { E: -14, A: 8, C: -16, O: 8 },
  },
}

/** `mixed` 种子里被标记为「信息不足」的维度；未登记时退回该量表的第一维。 */
const INSUFFICIENT_SEED_DIMENSION: Record<string, Dimension> = {
  oejts32: 'SN',
  ipip50: 'ES',
}

/** `mixed` 里保留的数字答案条数：必须低于 `minRatingsPerDimension`（8 / 10），因此固定取 3。 */
const MIXED_NUMERIC_LIMIT = 3

/** 把「该题应有 centered 贡献」换算成 1–5 的评分。 */
export function ratingForCentered(question: Question, centered: number): number {
  const rating = 3 + question.direction * centered
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`题目 #${question.id} 无法用 1–5 表达 centered=${centered}`)
  }
  return rating
}

/**
 * 生成一组「每维偏移恰好等于目标值」的答卷。
 *
 * 逐题从前往后分配：先放 ±2 的题，余下 1 分的那一题用 ±1。
 * 因此 N 题就能得到任意 −2N..2N 的整数偏移（OEJTS N=8 → ±16；IPIP N=10 → ±20），
 * 且答案全部落在 1–5 内。
 */
export function ratingsForOffsets(
  questions: Question[],
  offsets: Partial<Record<Dimension, number>>,
): Record<number, number> {
  const ratings: Record<number, number> = {}
  for (const [dimension, offset] of Object.entries(offsets) as [Dimension, number][]) {
    const dimensionQuestions = questions.filter((question) => question.dimension === dimension)
    // 题数从题库里读，不再写死 8：换量表（IPIP 每维 10 题）时上限自动跟着变
    const perDimension = dimensionQuestions.length
    if (perDimension === 0) {
      throw new Error(`本题库里没有维度 ${dimension} 的题目（偏移 ${offset} 无法实现）`)
    }
    const limit = 2 * perDimension
    if (!Number.isInteger(offset) || Math.abs(offset) > limit) {
      throw new Error(`${dimension} 的目标偏移 ${offset} 无法由 ${perDimension} 题实现（上限 ±${limit}）`)
    }
    const sign = offset < 0 ? -1 : 1
    let remaining = Math.abs(offset)
    for (const question of dimensionQuestions) {
      let centered = 0
      if (remaining >= 2) {
        centered = 2 * sign
        remaining -= 2
      } else if (remaining === 1) {
        centered = sign
        remaining = 0
      }
      ratings[question.id] = ratingForCentered(question, centered)
    }
    if (remaining !== 0) {
      throw new Error(`${dimension} 的目标偏移 ${offset} 未能完全分配`)
    }
  }
  return ratings
}

export function applyDevSeed(store: ReturnType<typeof useQuizStore>): void {
  if (!SEED_ENABLED) return
  if (typeof window === 'undefined') return
  const pkg = store.activePackage
  if (!pkg) return

  // 两个来源都要看：路由是 hash 模式，`?seed=` 常写在 hash 里（`#/result?seed=3`），
  // 但只要 URL 里**还有任何 search 参数**（缓存破坏参数、utm、来源标记……），
  // `window.location.search` 就是真值，只用它会把 hash 里的 seed 静默丢掉。
  const params = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const seed = (hashParams.get('seed') ?? params.get('seed')) as SeedName | null
  if (!seed) return

  const questions = pkg.questionnaire.questions
  store.start()

  const instrumentId = pkg.instrument?.id ?? ''
  const offsetSeed = OFFSET_SEEDS[instrumentId]?.[seed]
  if (offsetSeed) {
    const ratings = ratingsForOffsets(questions, offsetSeed)
    if (seed === 'mixed') {
      // 目标维度只留 3 题数字答案（其余标记「没有相关经历」）→ 该维信息不足，
      // 其余维度照常有明确方向，用来验收「部分维度不足，其余维度仍可展示有效信息」。
      // 维度名按仪器取（OEJTS: SN；IPIP: ES），不再写死其中一个量表的字母。
      const thin =
        INSUFFICIENT_SEED_DIMENSION[instrumentId] ?? packageDimensionOrder(pkg)[0] ?? null
      let thinRatings = 0
      for (const question of questions) {
        if (question.dimension === thin) {
          if (thinRatings < MIXED_NUMERIC_LIMIT) {
            thinRatings += 1
            store.selectRating(question.id, ratings[question.id] ?? 3)
          } else {
            store.selectUnknown(question.id, 'no_experience')
          }
          continue
        }
        store.selectRating(question.id, ratings[question.id] ?? 3)
      }
    } else {
      for (const question of questions) store.selectRating(question.id, ratings[question.id] ?? 3)
    }
  } else if (seed === 'unknown') {
    for (const question of questions) store.selectUnknown(question.id, 'unclear')
  } else if (seed === 'opposing') {
    // 每维前半推向高分侧、后半推向低分侧：总量回到中点，但两侧都有选择。
    // 一半的切分按该维实际题数算（OEJTS 8→4/4；IPIP 10→5/5）。
    for (const dimension of dimensionOrderOf(pkg.questionnaire)) {
      const dimensionQuestions = questions.filter((question) => question.dimension === dimension)
      const half = Math.floor(dimensionQuestions.length / 2)
      dimensionQuestions.forEach((question, index) => {
        store.selectRating(question.id, ratingForCentered(question, index < half ? 2 : -2))
      })
    }
  } else if (seed === 'left' || seed === 'right') {
    for (const question of questions) {
      const positive = question.direction === 1
      const rating =
        seed === 'right' ? (positive ? 5 : 1) : positive ? 1 : 5
      store.selectRating(question.id, rating)
    }
  } else if (seed === '1' || seed === '3' || seed === '5') {
    const value = Number(seed)
    for (const question of questions) store.selectRating(question.id, value)
  } else {
    return
  }

  store.goTo(0)
  // 种子代表"用户已经看完并提交了这一次"，因此显式提交。
  // 结果页要求 submittedAt 非空（否则会正确地把你送回答题页，避免生成未提交的报告）。
  store.submit()
  // 去掉 query，避免刷新时重复播种（答案已经在会话里了）
  const clean = `${window.location.pathname}${window.location.hash.split('?')[0]}`
  window.history.replaceState(null, '', clean)
  console.info(
    `[typeme] dev seed「${seed}」已写入：已处理 ${store.processedCount} 题（数字 ${store.ratingCount} / 无法判断 ${store.unknownCount}）`,
  )
}
