import {
  KNOWN_SCORING_VERSIONS,
  usesUnifiedBoundaryScale,
  type ScoringPolicy,
} from './types'

/**
 * 报告方法节用的门槛说明：数字来自快照，公式跟这份快照的计分版本走。
 *
 * 不把 `typeme-jung48-score-v1` 这类版本号印给用户；只把「这份报告当时怎么判」说成人话。
 * v1/v2 的略偏是 `B(n) = max(0, T(n) − 1)`，v3 才是 `B(n) = T(n)`。
 * 若按 v3 的句子去解释旧快照，10 道有效答案、两边差距为 2 会被说成略偏，而当时根本不会标。
 */
export interface SnapshotScoringFacts {
  scoringVersion: string
  policyVersion: string
  minBaseRatingsPerDimension: number
  boundaryNumerator: number
  boundaryDenominator: number
}

export interface SnapshotThresholdCopy {
  coverage: string
  boundary: string
}

function scoringVersionOf(facts: SnapshotScoringFacts): string {
  if (KNOWN_SCORING_VERSIONS.includes(facts.scoringVersion)) return facts.scoringVersion
  if (KNOWN_SCORING_VERSIONS.includes(facts.policyVersion)) return facts.policyVersion
  return facts.scoringVersion || facts.policyVersion
}

function policyFromFacts(facts: SnapshotScoringFacts): ScoringPolicy | null {
  const version = scoringVersionOf(facts)
  if (!KNOWN_SCORING_VERSIONS.includes(version)) return null
  return {
    version,
    minBaseRatingsPerDimension: facts.minBaseRatingsPerDimension,
    boundaryNumerator: facts.boundaryNumerator,
    boundaryDenominator: facts.boundaryDenominator,
    ratingMin: 1,
    ratingMax: 5,
    ratingNeutral: 3,
  }
}

export function describeSnapshotThresholds(facts: SnapshotScoringFacts): SnapshotThresholdCopy {
  const min = facts.minBaseRatingsPerDimension
  const numerator = facts.boundaryNumerator
  const denominator = facts.boundaryDenominator
  const coverage =
    `每个方向至少有 ${min} 道有效数字答案，并且这一维的主测题都处理过，才会给出倾向。` +
    `明确「说不好」不算数字答案，但算已经处理；还没作答会让这一维覆盖不足，即使数字答案已经够数。`

  const policy = policyFromFacts(facts)
  if (!policy) {
    return {
      coverage,
      boundary:
        '「略偏」按提交当时的规则判定：有效作答越多，这条线越宽。所以略偏不是信息不够，也不是一条对所有题数都相同的分数线。',
    }
  }
  if (usesUnifiedBoundaryScale(policy)) {
    return {
      coverage,
      boundary:
        `「略偏」按当时记下的比例判定：有效作答每 ${denominator} 题，两边差距不超过 ${numerator} 就记为略偏；` +
        `题数不足时按同一比例向下取整。所以略偏不是信息不够，也不是一条对所有题数都相同的分数线。`,
    }
  }
  return {
    coverage,
    boundary:
      `「略偏」按当时记下的比例判定：有效作答每 ${denominator} 题先得到两边差距不超过 ${numerator} 的一条线，` +
      `再收紧一档才记为略偏。所以有效作答刚好 ${denominator} 题、两边差距为 ${numerator} 时，这份快照不会标成略偏。`,
  }
}
