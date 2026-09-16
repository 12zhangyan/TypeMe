import type { Clarity } from './types'

/**
 * 倾向分档 —— `docs/2026-09-15/...重构开发文档.md` §7.3。
 *
 * d = |score - midpoint|
 *   d >= 9        → A（较明显）
 *   5 <= d < 9    → B（中等）
 *   2 <= d < 5    → C（轻微）
 *   d <= 1        → D（接近均衡）
 *
 * ⚠️ 这是**产品展示分档**，不是经过统计验证的置信区间、正确率、稳定性或回答一致性指标。
 * 旧版文案里的「作答方向很一致」「比较稳定」都超出了"距离计算"能证明的范围，
 * 本轮按要求改写为只描述"离中点多远"。
 */

export const CLARITY_THRESHOLDS = {
  /** d >= 该值 → A */
  a: 9,
  /** d >= 该值 → B */
  b: 5,
  /** d >= 该值 → C；否则 D */
  c: 2,
} as const

/** 用户可见的档名（§7.3 表格的"用户文案"列）。 */
export const CLARITY_LABEL: Record<Clarity, string> = {
  A: '较明显',
  B: '中等',
  C: '轻微',
  D: '接近均衡',
}

/**
 * 每个等级的一句解释。
 * 全部围绕"本次得分离中点多远"来写，不暗示稳定性或可信度（§7.3）。
 */
export const CLARITY_EXPLANATION: Record<Clarity, string> = {
  A: '本次得分离中点较远，这一侧的描述通常更贴切。',
  B: '本次偏向一侧，方向清楚，但还没到很远的位置。',
  C: '本次只是轻微偏向一侧，两侧的特征都可以参考。',
  D: '两侧几乎打平，不宜只按前面的字母理解这一维。',
}

/**
 * 旧的 A/B/C/D 等级名（领域层字段保留兼容，但前台不再突出字母等级，§7.3）。
 * 只用于无障碍名称与开发调试，不出现在正文里。
 */
export const CLARITY_CODE_NAME: Record<Clarity, string> = {
  A: 'A 较明显',
  B: 'B 中等',
  C: 'C 轻微',
  D: 'D 接近均衡',
}

/** C / D 视为"需要提示"的级别（结果页的均衡提示紧邻倾向条展示）。 */
export function needsTieNotice(clarity: Clarity): boolean {
  return clarity === 'C' || clarity === 'D'
}

/** 得分与中点的距离。 */
export function distanceFromMidpoint(score: number, midpoint: number): number {
  return Math.abs(score - midpoint)
}

/** 由距离得到分档。 */
export function clarityFromDistance(distance: number): Clarity {
  const d = Math.abs(distance)
  if (!Number.isFinite(d)) {
    throw new TypeError(`倾向分档需要有限数值，收到 ${String(distance)}`)
  }
  if (d >= CLARITY_THRESHOLDS.a) return 'A'
  if (d >= CLARITY_THRESHOLDS.b) return 'B'
  if (d >= CLARITY_THRESHOLDS.c) return 'C'
  return 'D'
}

/** 便捷组合：由原始分与中点直接得到分档。 */
export function clarityOfScore(score: number, midpoint: number): Clarity {
  return clarityFromDistance(distanceFromMidpoint(score, midpoint))
}
