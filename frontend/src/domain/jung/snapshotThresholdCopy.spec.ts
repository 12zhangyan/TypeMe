import { describe, expect, it } from 'vitest'
import { describeSnapshotThresholds } from './snapshotThresholdCopy'

const V1 = {
  scoringVersion: 'typeme-jung48-score-v1',
  policyVersion: 'typeme-jung48-score-v1',
  minBaseRatingsPerDimension: 9,
  boundaryNumerator: 2,
  boundaryDenominator: 10,
}

const V3 = {
  ...V1,
  scoringVersion: 'typeme-jung48-score-v3',
  policyVersion: 'typeme-jung48-score-v3',
}

const V4 = {
  ...V1,
  scoringVersion: 'typeme-jung48-score-v4',
  policyVersion: 'typeme-jung48-score-v4',
  boundaryDenominator: 5,
}

describe('describeSnapshotThresholds', () => {
  it('覆盖说明把未作答和「说不好」分成两种效果', () => {
    const copy = describeSnapshotThresholds(V3)
    expect(copy.coverage).toContain('每个方向至少有 9 道有效数字答案')
    expect(copy.coverage).toContain('主测题都处理过')
    expect(copy.coverage).toContain('明确「说不好」不算数字答案，但算已经处理')
    expect(copy.coverage).toContain('还没作答会让这一维覆盖不足')
    expect(copy.coverage).not.toContain('未作答和明确「说不好」都不算')
  })

  it('v3 快照：10 道有效答案、两边差距 2 会记为略偏', () => {
    const { boundary } = describeSnapshotThresholds(V3)
    expect(boundary).toContain('有效作答每 10 题，两边差距不超过 2 就记为略偏')
    expect(boundary).not.toContain('再收紧一档')
    expect(boundary).not.toContain('不会标成略偏')
    expect(boundary).not.toContain('typeme-jung48-score')
  })

  it('v4 快照：文案跟着分母走（每 5 题差距不超过 2），不写死旧版比例', () => {
    const { boundary } = describeSnapshotThresholds(V4)
    expect(boundary).toContain('有效作答每 5 题，两边差距不超过 2 就记为略偏')
    expect(boundary, '不能把 v3 的 10 题说成 v4 的门槛').not.toContain('每 10 题')
    expect(boundary).not.toContain('再收紧一档')
    expect(boundary).not.toContain('不会标成略偏')
    expect(boundary).not.toContain('typeme-jung48-score')
  })

  it('v1/v2 快照：同一组数字不会被说成略偏', () => {
    for (const version of ['typeme-jung48-score-v1', 'typeme-jung48-score-v2'] as const) {
      const { boundary } = describeSnapshotThresholds({ ...V1, scoringVersion: version, policyVersion: version })
      expect(boundary, version).toContain('再收紧一档才记为略偏')
      expect(boundary, version).toContain('有效作答刚好 10 题、两边差距为 2 时，这份快照不会标成略偏')
      expect(boundary, version).not.toContain('两边差距不超过 2 就记为略偏')
      expect(boundary, version).not.toContain('typeme-jung48-score')
    }
  })

  it('policyVersion 是权威：与 scoringVersion 不一致时仍按政策版本解释', () => {
    const mixed = describeSnapshotThresholds({
      ...V4,
      scoringVersion: 'typeme-jung48-score-v3',
      policyVersion: 'typeme-jung48-score-v1',
    })
    expect(mixed.boundary).toContain('再收紧一档才记为略偏')
    expect(mixed.boundary).toContain('这份快照不会标成略偏')
    expect(mixed.boundary).not.toContain('两边差距不超过 2 就记为略偏')
  })

  it('policyVersion 未知时不拿 scoringVersion 猜公式', () => {
    const copy = describeSnapshotThresholds({
      ...V3,
      policyVersion: 'typeme-jung48-score-v9',
    })
    expect(copy.boundary).toContain('按提交当时的规则判定')
    expect(copy.boundary).not.toContain('两边差距不超过 2 就记为略偏')
    expect(copy.boundary).not.toContain('再收紧一档')
  })

  it('比例跟快照走，不是写死 2/10', () => {
    const copy = describeSnapshotThresholds({
      ...V1,
      minBaseRatingsPerDimension: 7,
      boundaryNumerator: 3,
      boundaryDenominator: 8,
    })
    expect(copy.coverage).toContain('每个方向至少有 7 道有效数字答案')
    expect(copy.boundary).toContain('有效作答每 8 题先得到两边差距不超过 3 的一条线')
    expect(copy.boundary).toContain('刚好 8 题、两边差距为 3 时，这份快照不会标成略偏')
  })
})
