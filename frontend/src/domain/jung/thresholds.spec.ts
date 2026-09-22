/**
 * 阈值政策的**独立**边界回归（前端侧），同时钉住**三套口径**。
 *
 * 与 `scoring.fixture.spec.ts` 的分工：
 *   - fixture 用"某一维恰好被造成 n 与 S"的样例做**端到端**跨实现比对；
 *   - 本文件直接把 `T(n)` / `B(n)` 当函数逐点钉住，并断言**内容包声明值**就是这几个数。
 * 两者互补：fixture 覆盖不到很多 n，而阈值对每个 n 都有定义。
 *
 * 三套口径（v4 起并存）：
 *   - `typeme-jung48-score-v4`（当前）：`T(n) = B(n) = floor(2n/5)`（约 `|m| <= 0.20`），边界另要求 `n > 0`；
 *   - `typeme-jung48-score-v3`（2026-09-18 批准）：`T(n) = B(n) = floor(2n/10)`（约 `|m| <= 0.10`）；
 *   - `typeme-jung48-score-v1` / `-v2`（历史，行为冻结）：`B(n) = max(0, T(n) − 1)`。
 *
 * v4 相对 v3 只把分母从 10 改成 5（带宽数值翻倍），口径仍是 `B = T`：
 *   - 触发集合**只会变大**：`T(9)` 1→3、`T(12)` 2→4、`T(16)` 3→6，所以同一份作答在 v4 下
 *     可能**新多出**几维要答补充题（这不是 bug，是已批准的产品取舍）。
 *   - **带宽翻倍不等于"补充题数量翻倍"**：实际多多少道取决于真实答卷落在哪一档，
 *     本轮没有真人数据，不能拿这条公式反推它的效果。
 *
 * 期望值来自契约 §4.1 的文字，不是从实现输出反抄的 —— 否则实现漂了测试会跟着漂。
 * 同一张表在 Java 侧由 `com.typeme.jung.domain.JungScoringPolicyTest` 断言；
 * 两边都失败才算实现分歧，只失败一边就是那一侧写坏了。
 *
 * **本文件通过只说明"实现符合当前记录的规则"，不说明阈值选得对，更不是测量质量证据。**
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertKnownScoringVersion,
  boundaryThreshold,
  isBoundary,
  KNOWN_SCORING_VERSIONS,
  triggerThreshold,
  usesUnifiedBoundaryScale,
  type ContentPackage,
  type ScoringPolicy,
} from './types'

const readPackage = (file: string): ContentPackage =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../../../backend/src/main/resources/content/${file}`), 'utf8'),
  ) as ContentPackage

const V1 = readPackage('typeme-jung48-zh-v1.json')
const V2 = readPackage('typeme-jung48-zh-v2.json')
const V3 = readPackage('typeme-jung48-zh-v3.json')
const V4 = readPackage('typeme-jung48-zh-v4.json')

/** 契约表（与实现无关地写死）：历史尺度的触发阈值 `floor(2n/10)`。 */
const expectedTrigger = (n: number): number => (n <= 0 ? 0 : Math.floor((2 * n) / 10))
/** 历史口径：边界 = 触发 − 1。 */
const expectedLegacyBoundary = (n: number): number => Math.max(0, expectedTrigger(n) - 1)
/** v3 口径：边界 = 触发（分母 10）。 */
const expectedV3Boundary = (n: number): number => expectedTrigger(n)
/** 契约 §4.1 / 开发方案 §3.4 第 4 条：`floor(2n/5)`，也就是 v4 的口径。 */
const expectedV4Boundary = (n: number): number => (n <= 0 ? 0 : Math.floor((2 * n) / 5))

describe('当前内容包（v4）声明的政策', () => {
  it('v4 声明统一尺度，计分常量与契约一致', () => {
    const policy = V4.scoringPolicy
    expect(policy.version).toBe('typeme-jung48-score-v4')
    expect(usesUnifiedBoundaryScale(policy)).toBe(true)
    expect(policy.minBaseRatingsPerDimension).toBe(9)
    expect(policy.boundaryNumerator).toBe(2)
    expect(policy.boundaryDenominator).toBe(5)
    expect(policy.ratingMin).toBe(1)
    expect(policy.ratingMax).toBe(5)
    expect(policy.ratingNeutral).toBe(3)
    // 换包不能让"未改动的口径"漂移：v4 只改分母，分子与覆盖下限必须与 v3 相同。
    expect(policy.boundaryNumerator).toBe(V3.scoringPolicy.boundaryNumerator)
    expect(policy.minBaseRatingsPerDimension).toBe(V3.scoringPolicy.minBaseRatingsPerDimension)
    expect(policy.ratingMin).toBe(V3.scoringPolicy.ratingMin)
    expect(policy.ratingMax).toBe(V3.scoringPolicy.ratingMax)
    expect(policy.ratingNeutral).toBe(V3.scoringPolicy.ratingNeutral)
  })

  it('T(n) / B(n) 在 n=0..40 上与 v4 契约表逐点相等（B=T=floor(2n/5)）', () => {
    const policy = V4.scoringPolicy
    for (let n = 0; n <= 40; n += 1) {
      expect(triggerThreshold(policy, n), `T(${n})`).toBe(expectedV4Boundary(n))
      expect(boundaryThreshold(policy, n), `B(${n})`).toBe(expectedV4Boundary(n))
    }
  })

  it('跳档点单独钉住（改分子/分母时这几行最先红）', () => {
    const policy = V4.scoringPolicy
    expect(triggerThreshold(policy, 2)).toBe(0)
    expect(triggerThreshold(policy, 3)).toBe(1)
    expect(triggerThreshold(policy, 5)).toBe(2)
    expect(triggerThreshold(policy, 8)).toBe(3)
    expect(boundaryThreshold(policy, 9)).toBe(3)
    expect(boundaryThreshold(policy, 12)).toBe(4)
    expect(boundaryThreshold(policy, 13)).toBe(5)
    expect(boundaryThreshold(policy, 16)).toBe(6)
  })

  it('n=0 与负数输入退化到 0，且 v4 在 n=0 时不标记边界', () => {
    const policy = V4.scoringPolicy
    expect(triggerThreshold(policy, 0)).toBe(0)
    expect(boundaryThreshold(policy, 0)).toBe(0)
    expect(triggerThreshold(policy, -1)).toBe(0)
    expect(boundaryThreshold(policy, -1)).toBe(0)
    expect(isBoundary(policy, 0, 0)).toBe(false)
    expect(isBoundary(policy, 1, 0)).toBe(false)
    expect(isBoundary(policy, 0, -1)).toBe(false)
  })
})

describe('上一版内容包（v3）声明的政策', () => {
  it('v3 声明统一尺度，且数值原样冻结', () => {
    const policy = V3.scoringPolicy
    expect(policy.version).toBe('typeme-jung48-score-v3')
    expect(usesUnifiedBoundaryScale(policy)).toBe(true)
    expect(policy.minBaseRatingsPerDimension).toBe(9)
    expect(policy.boundaryNumerator).toBe(2)
    expect(policy.boundaryDenominator).toBe(10)
    expect(policy.ratingMin).toBe(1)
    expect(policy.ratingMax).toBe(5)
    expect(policy.ratingNeutral).toBe(3)
    // 换递归：v3 的分子分母必须与 v1/v2 相同（那次只改边界口径）。
    expect(policy.boundaryNumerator).toBe(V1.scoringPolicy.boundaryNumerator)
    expect(policy.boundaryDenominator).toBe(V1.scoringPolicy.boundaryDenominator)
    expect(policy.minBaseRatingsPerDimension).toBe(V1.scoringPolicy.minBaseRatingsPerDimension)
  })

  it('T(n) / B(n) 在 n=0..40 上与 v3 契约表逐点相等（B=T）', () => {
    const policy = V3.scoringPolicy
    for (let n = 0; n <= 40; n += 1) {
      expect(triggerThreshold(policy, n), `T(${n})`).toBe(expectedTrigger(n))
      expect(boundaryThreshold(policy, n), `B(${n})`).toBe(expectedV3Boundary(n))
    }
  })

  it('v3 在 n=0 时不标记边界', () => {
    const policy = V3.scoringPolicy
    expect(triggerThreshold(policy, 0)).toBe(0)
    expect(boundaryThreshold(policy, 0)).toBe(0)
    expect(isBoundary(policy, 0, 0)).toBe(false)
    expect(isBoundary(policy, 0, -1)).toBe(false)
  })
})

describe('历史版本（v1/v2）行为冻结', () => {
  for (const [label, pkg] of [['v1', V1], ['v2', V2]] as const) {
    it(`${label} 声明历史口径，T(n) / B(n)=T−1 在 n=0..40 上与契约表逐点相等`, () => {
      const policy: ScoringPolicy = pkg.scoringPolicy
      expect(usesUnifiedBoundaryScale(policy)).toBe(false)
      for (let n = 0; n <= 40; n += 1) {
        expect(triggerThreshold(policy, n), `T(${n})`).toBe(expectedTrigger(n))
        expect(boundaryThreshold(policy, n), `B(${n})`).toBe(expectedLegacyBoundary(n))
      }
      // 旧版本保持原来的退化行为（冻结，不是"顺手修好"）。
      expect(isBoundary(policy, 0, 0)).toBe(true)
    })
  }

  it('v3 与旧版只差 |S| = T(n) 这一格（触发档为 0 时不差）', () => {
    for (let n = 0; n <= 40; n += 1) {
      const v3 = boundaryThreshold(V3.scoringPolicy, n)
      const legacy = boundaryThreshold(V1.scoringPolicy, n)
      expect(v3 - legacy, `n=${n}`).toBe(expectedTrigger(n) >= 1 ? 1 : 0)
      if (expectedTrigger(n) >= 1) {
        // 这一格正是 CASE-09：v3/v4 判"较轻"，旧规则判"明确"。
        expect(isBoundary(V3.scoringPolicy, expectedTrigger(n), n), `v3 n=${n}`).toBe(true)
        expect(isBoundary(V1.scoringPolicy, expectedTrigger(n), n), `v1 n=${n}`).toBe(false)
      }
    }
  })

  it('v4 只会比 v3 宽：T/B 逐点 >= v3，且多出来的幅度就是带宽差', () => {
    for (let n = 1; n <= 40; n += 1) {
      const v4Trigger = triggerThreshold(V4.scoringPolicy, n)
      const v4Boundary = boundaryThreshold(V4.scoringPolicy, n)
      const v3Trigger = triggerThreshold(V3.scoringPolicy, n)
      const v3Boundary = boundaryThreshold(V3.scoringPolicy, n)
      expect(v4Trigger, `T(${n})`).toBeGreaterThanOrEqual(v3Trigger)
      expect(v4Boundary, `B(${n})`).toBeGreaterThanOrEqual(v3Boundary)
      expect(v4Trigger - v3Trigger, `n=${n} 的触发扩幅`).toBe(
        Math.floor((4 * n) / 10) - Math.floor((2 * n) / 10),
      )
      // 旧版本下判"明确"的边界格，在 v4 下可能变成"较轻" —— 这就是本次改动的直接后果。
      if (v3Trigger >= 1) {
        expect(isBoundary(V4.scoringPolicy, v3Trigger, n), `v4 n=${n}`).toBe(true)
      }
    }
  })

  it('单调不减，且 0 <= B(n) <= T(n)（四个版本各自成立）', () => {
    for (const policy of [V1.scoringPolicy, V2.scoringPolicy, V3.scoringPolicy, V4.scoringPolicy]) {
      for (let n = 1; n <= 60; n += 1) {
        const trigger = triggerThreshold(policy, n)
        const boundary = boundaryThreshold(policy, n)
        expect(boundary, `${policy.version} n=${n}`).toBeGreaterThanOrEqual(
          boundaryThreshold(policy, n - 1),
        )
        expect(boundary, `${policy.version} n=${n}`).toBeLessThanOrEqual(trigger)
        expect(boundary).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('未知计分版本被拒绝，不静默回落', () => {
  it('assertKnownScoringVersion 对未知版本抛错并列出已知版本', () => {
    const unknown: ScoringPolicy = { ...V1.scoringPolicy, version: 'typeme-jung48-score-v9' }
    expect(() => assertKnownScoringVersion(unknown)).toThrowError(/typeme-jung48-score-v9/)
    expect(() => assertKnownScoringVersion(unknown)).toThrowError(/typeme-jung48-score-v4/)
    for (const version of [
      'typeme-jung48-score-v1',
      'typeme-jung48-score-v2',
      'typeme-jung48-score-v3',
      'typeme-jung48-score-v4',
    ]) {
      expect(KNOWN_SCORING_VERSIONS).toContain(version)
      expect(() => assertKnownScoringVersion({ ...V1.scoringPolicy, version })).not.toThrow()
    }
  })
})

describe('边界是闭区间，且与 S 的正负无关', () => {
  const policy = V4.scoringPolicy

  it('|S| = B(n) 算边界，|S| = B(n)+1 不算（两侧都试）', () => {
    for (const n of [1, 5, 9, 10, 12, 16, 20, 24]) {
      const boundary = boundaryThreshold(policy, n)
      expect(boundary, `n=${n} 的等号应算边界`).toBe(expectedV4Boundary(n))
      expect(isBoundary(policy, boundary, n)).toBe(true)
      expect(isBoundary(policy, -boundary, n), `n=${n} 的负向等号应算边界`).toBe(true)
      expect(isBoundary(policy, boundary + 1, n), `n=${n} 越出一格不该算边界`).toBe(false)
      expect(isBoundary(policy, -(boundary + 1), n)).toBe(false)
    }
  })

  it('等号明细：n=12/|S|=4 与 n=9/|S|=3 在 v4 下算边界，在 v3 下不算', () => {
    // v4 的等号格（B(12)=4、B(9)=3）。
    expect(isBoundary(policy, 4, 12)).toBe(true)
    expect(isBoundary(V3.scoringPolicy, 4, 12)).toBe(false)
    expect(isBoundary(policy, 3, 9)).toBe(true)
    expect(isBoundary(V3.scoringPolicy, 3, 9), 'v3 的 B(9)=1').toBe(false)
    expect(isBoundary(policy, 5, 12), 'n=12 越出一格（B=4）').toBe(false)
    // v3 的等号格在 v4 下仍在带内（只会更宽，不会变窄）。
    expect(isBoundary(policy, 2, 12)).toBe(true)
    expect(isBoundary(policy, 1, 9)).toBe(true)
    // 触发扩到 |S|=T(n)：v4 下 |S|=4 会安排澄清，v3 下不会。
    expect(Math.abs(4) <= triggerThreshold(policy, 12)).toBe(true)
    expect(Math.abs(4) <= triggerThreshold(V3.scoringPolicy, 12), 'v3 T(12)=2').toBe(false)
  })
})

describe('v4 就是开发方案 §3.4 第 4 条的边界口径（与 v3、「分子 4 + B=T−1」两者都不同）', () => {
  const policy = V4.scoringPolicy
  /** 分子 4 但仍走历史口径（B=T−1）：这是第三条规则，既不是开发方案，也不是 v3/v4。 */
  const numeratorFourLegacyScale: ScoringPolicy = { ...V1.scoringPolicy, boundaryNumerator: 4 }

  it('v4 的边界与开发方案口径逐点相同，而 v3 更窄', () => {
    for (const n of [0, 1, 2, 5, 9, 12, 16, 20, 40]) {
      const original = expectedV4Boundary(n)
      expect(boundaryThreshold(policy, n), `v4 n=${n}`).toBe(original)
      expect(Math.floor(0.4 * n), `floor(0.4n) 必须等于 floor(2n/5)（n=${n}）`).toBe(original)
      if (n >= 5) {
        expect(original, `v4 必须严格宽于 v3（n=${n}）`).toBeGreaterThan(
          boundaryThreshold(V3.scoringPolicy, n),
        )
      }
    }
  })

  it('n=12 分歧点：开发方案/v4 到 |S|=4，v3 到 2，「分子 4 且仍是 B=T−1」只到 3', () => {
    expect(boundaryThreshold(policy, 12)).toBe(4)
    expect(boundaryThreshold(V3.scoringPolicy, 12)).toBe(2)
    expect(boundaryThreshold(numeratorFourLegacyScale, 12)).toBe(3)
    expect(isBoundary(policy, 4, 12), 'v4 下 |S|=4 是边界（等号格）').toBe(true)
    expect(isBoundary(V3.scoringPolicy, 4, 12), 'v3 下 |S|=4 不是边界').toBe(false)
    expect(
      isBoundary(numeratorFourLegacyScale, 4, 12),
      '|S|=4 在「分子 4 + B=T−1」下仍不是边界 —— 所以那不是开发方案的口径',
    ).toBe(false)
    // v4 与「分子 4 + B=T−1」在 n>=5 时也不同：只有 v4 不带 −1。
    for (const n of [9, 12, 16, 20]) {
      expect(expectedV4Boundary(n), `n=${n}`).toBe(boundaryThreshold(numeratorFourLegacyScale, n) + 1)
    }
  })
})