import type { InterpretationPolicy } from './assessmentPackage'

/**
 * 解释政策 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §3.2。
 *
 * 本文件**只**把「原始分偏移」翻译成产品可展示的维度状态，不改动 OEJTS 1.2 的
 * 数值公式，也不引入任何新的量表阈值。
 *
 * 关于 `typeMinDistance`（默认 5）必须说清楚：
 *   它是**本产品暂定的保守展示策略**，用来避免「一分之差就输出整套人格叙事」。
 *   它不是统计置信阈值，没有证据证明它提升测量准确率，也不得对外表述为
 *   OEJTS 或 MBTI 的官方规则。字段名刻意避开 confidence / accuracy / reliability。
 */

export type DimensionStatus = 'insufficient' | 'balanced' | 'tentative' | 'leaning'

/** 只描述本次数值偏移的展示档位；不是置信度、正确率或稳定性。 */
export type PresentationBand = 'equal' | 'slight' | 'moderate' | 'marked'

export const PRESENTATION_BANDS: readonly PresentationBand[] = [
  'equal',
  'slight',
  'moderate',
  'marked',
]

/** 用户可见的维度状态名。 */
export const DIMENSION_STATUS_LABEL: Readonly<Record<DimensionStatus, string>> = {
  insufficient: '信息不足',
  balanced: '本次两侧相近',
  tentative: '本次略偏某侧，建议继续观察',
  leaning: '本次回答偏向某侧',
}

/** 状态的一句话解释（不暗示稳定性或可信度）。 */
export const DIMENSION_STATUS_NOTE: Readonly<Record<DimensionStatus, string>> = {
  insufficient: '这一维还没有足够的数字答案，因此不计算分数，也不判定方向。',
  balanced: '本次这一维的作答合计正好落在中点，没有哪一侧更占优势。',
  tentative: '这一维离中点很近，本次的方向只作参考，换个时间作答可能落到另一侧。',
  leaning: '这一维达到了本产品的展示条件，可以用于问卷参考组合。',
}

/**
 * 由绝对偏移得到展示档位。
 *
 *   |δ| == 0              → equal（两侧相近，没有主导侧）
 *   1 ≤ |δ| < min         → slight（略偏）
 *   min ≤ |δ| < marked    → moderate
 *   |δ| ≥ marked          → marked
 *
 * 上界由包里的 `typeMinDistance` / `markedDistance` 决定，不写死在调用方。
 */
export function presentationBand(absDelta: number, policy: InterpretationPolicy): PresentationBand {
  if (!Number.isFinite(absDelta) || absDelta < 0) {
    throw new TypeError(`展示档位需要非负有限数值，收到 ${String(absDelta)}`)
  }
  const distance = Math.abs(absDelta)
  if (distance === 0) return 'equal'
  if (distance < policy.typeMinDistance) return 'slight'
  if (distance < policy.markedDistance) return 'moderate'
  return 'marked'
}

/**
 * 档位 → 维度状态。
 * 只有 `moderate` / `marked` 才允许参与「问卷参考组合」。
 * 返回值刻意排除 `insufficient`：信息不足来自「有没有足够的数字答案」，不是距离函数的结果。
 */
export function statusForBand(band: PresentationBand): Exclude<DimensionStatus, 'insufficient'> {
  if (band === 'equal') return 'balanced'
  if (band === 'slight') return 'tentative'
  return 'leaning'
}

/** 该状态是否可用于拼出完整参考组合。 */
export function canJoinReferenceType(status: DimensionStatus): boolean {
  return status === 'leaning'
}
