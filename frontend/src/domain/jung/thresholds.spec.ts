/**
 * 阈值政策的**独立**边界回归（前端侧），同时钉住**两套口径**。
 *
 * 与 `scoring.fixture.spec.ts` 的分工：
 *   - fixture 用"某一维恰好被造成 n 与 S"的样例做**端到端**跨实现比对；
 *   - 本文件直接把 `T(n)` / `B(n)` 当函数逐点钉住，并断言**内容包声明值**就是这几个数。
 * 两者互补：fixture 覆盖不到很多 n，而阈值对每个 n 都有定义。
 *
 * 两套口径（2026-09-18 起并存）：
 *   - `typeme-jung48-score-v3`（当前）：`T(n) = B(n) = floor(2n/10)`，边界另要求 `n > 0`；
 *   - `typeme-jung48-score-v1` / `-v2`（历史，行为冻结）：`B(n) = max(0, T(n) − 1)`。
 * 两者只差 `|S| = T(n)` 这一格（外加 v3 在 `n = 0` 上的收紧），触发条件完全相同 ——
 * 这次调整不会让任何人多答一道补充题。
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

/** 契约表（与实现无关地写死）：两套口径各自独立写一遍。 */
const expectedTrigger = (n: number): number => (n <= 0 ? 0 : Math.floor((2 * n) / 10))
/** 历史口径：边界 = 触发 − 1。 */
const expectedLegacyBoundary = (n: number): number => Math.max(0, expectedTrigger(n) - 1)
/** 当前口径（v3）：边界 = 触发。 */
const expectedUnifiedBoundary = (n: number): number => expectedTrigger(n)

/** 开发方案 §3.4 第 4 条的边界口径：5|S| <= 2n，等价于 |S| <= floor(0.4n)。 */
const originalDesignBoundary = (n: number): number => Math.floor((2 * n) / 5)

describe('当前内容包（v3）声明的政策', () => {
  it('v3 声明统一尺度，计分常量与契约一致', () => {
    const policy = V3.scoringPolicy
    expect(policy.version).toBe('typeme-jung48-score-v3')
    expect(usesUnifiedBoundaryScale(policy)).toBe(true)
    expect(policy.minBaseRatingsPerDimension).toBe(9)
    expect(policy.boundaryNumerator).toBe(2)
    expect(policy.boundaryDenominator).toBe(10)
    expect(policy.ratingMin).toBe(1)
    expect(policy.ratingMax).toBe(5)
    expect(policy.ratingNeutral).toBe(3)
    // 换包不能让"未改动的口径"漂移：v3 只改边界，分子分母必须与 v1/v2 相同。
    expect(policy.boundaryNumerator).toBe(V1.scoringPolicy.boundaryNumerator)
    expect(policy.boundaryDenominator).toBe(V1.scoringPolicy.boundaryDenominator)
    expect(policy.minBaseRatingsPerDimension).toBe(V1.scoringPolicy.minBaseRatingsPerDimension)
  })

  it('T(n) / B(n) 在 n=0..40 上与 v3 契约表逐点相等（B=T）', () => {
    const policy = V3.scoringPolicy
    for (let n = 0; n <= 40; n += 1) {
      expect(triggerThreshold(policy, n), `T(${n})`).toBe(expectedTrigger(n))
      expect(boundaryThreshold(policy, n), `B(${n})`).toBe(expectedUnifiedBoundary(n))
    }
  })

  it('跳档点单独钉住（改分子/分母时这几行最先红）', () => {
    const policy = V3.scoringPolicy
    expect(triggerThreshold(policy, 9)).toBe(1)
    expect(boundaryThreshold(policy, 9)).toBe(1)
    expect(triggerThreshold(policy, 10)).toBe(2)
    expect(boundaryThreshold(policy, 10)).toBe(2)
    expect(triggerThreshold(policy, 14)).toBe(2)
    expect(triggerThreshold(policy, 15)).toBe(3)
    expect(boundaryThreshold(policy, 15)).toBe(3)
  })

  it('n=0 与负数输入退化到 0，且 v3 在 n=0 时不标记边界', () => {
    const policy = V3.scoringPolicy
    expect(triggerThreshold(policy, 0)).toBe(0)
    expect(boundaryThreshold(policy, 0)).toBe(0)
    expect(triggerThreshold(policy, -1)).toBe(0)
    expect(boundaryThreshold(policy, -1)).toBe(0)
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

  it('两套口径只差 |S| = T(n) 这一格（触发档为 0 时不差）', () => {
    for (let n = 0; n <= 40; n += 1) {
      const unified = boundaryThreshold(V3.scoringPolicy, n)
      const legacy = boundaryThreshold(V1.scoringPolicy, n)
      expect(unified - legacy, `n=${n}`).toBe(expectedTrigger(n) >= 1 ? 1 : 0)
      if (expectedTrigger(n) >= 1) {
        // 这一格正是 CASE-09：v3 判"较轻"，旧规则判"明确"。
        expect(isBoundary(V3.scoringPolicy, expectedTrigger(n), n), `v3 n=${n}`).toBe(true)
        expect(isBoundary(V1.scoringPolicy, expectedTrigger(n), n), `v1 n=${n}`).toBe(false)
      }
    }
  })

  it('单调不减，且 0 <= B(n) <= T(n)（两个版本各自成立）', () => {
    for (const policy of [V1.scoringPolicy, V2.scoringPolicy, V3.scoringPolicy]) {
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
    expect(() => assertKnownScoringVersion(unknown)).toThrowError(/typeme-jung48-score-v3/)
    for (const version of ['typeme-jung48-score-v1', 'typeme-jung48-score-v2', 'typeme-jung48-score-v3']) {
      expect(KNOWN_SCORING_VERSIONS).toContain(version)
      expect(() => assertKnownScoringVersion({ ...V1.scoringPolicy, version })).not.toThrow()
    }
  })
})

describe('边界是闭区间，且与 S 的正负无关', () => {
  const policy = V3.scoringPolicy

  it('|S| = B(n) 算边界，|S| = B(n)+1 不算（两侧都试）', () => {
    for (const n of [1, 5, 9, 10, 12, 16, 20, 24]) {
      const boundary = boundaryThreshold(policy, n)
      expect(boundary, `n=${n} 的等号应算边界`).toBe(expectedUnifiedBoundary(n))
      expect(isBoundary(policy, boundary, n)).toBe(true)
      expect(isBoundary(policy, -boundary, n), `n=${n} 的负向等号应算边界`).toBe(true)
      expect(isBoundary(policy, boundary + 1, n), `n=${n} 越出一格不该算边界`).toBe(false)
      expect(isBoundary(policy, -(boundary + 1), n)).toBe(false)
    }
  })

  it('等号明细：n=12/|S|=2 与 n=9/|S|=1 在 v3 下都算边界（旧规则下不算）', () => {
    expect(isBoundary(policy, 2, 12)).toBe(true)
    expect(isBoundary(V1.scoringPolicy, 2, 12)).toBe(false)
    expect(isBoundary(policy, 1, 9)).toBe(true)
    expect(isBoundary(V1.scoringPolicy, 1, 9)).toBe(false)
    expect(isBoundary(policy, 3, 12), 'n=12 越出一格（B=2）').toBe(false)
    // 触发条件没变：|S|=T(n) 仍然触发澄清（v1/v2/v3 都一样）。
    expect(Math.abs(2) <= triggerThreshold(policy, 12)).toBe(true)
    expect(Math.abs(2) <= triggerThreshold(V1.scoringPolicy, 12)).toBe(true)
  })
})

describe('「只改分子」不等于恢复开发方案的边界口径（勘误的机械版本）', () => {
  const policy = V3.scoringPolicy
  /** 分子 4 但仍走历史口径（B=T−1）：这是第三条规则，不是开发方案，也不是 v3。 */
  const numeratorFourLegacyScale: ScoringPolicy = { ...V1.scoringPolicy, boundaryNumerator: 4 }

  it('两套规格的差异是一整段区间，不是单个值', () => {
    for (const n of [9, 12, 16]) {
      const original = originalDesignBoundary(n)
      const current = boundaryThreshold(policy, n)
      expect(original).toBeGreaterThan(current)
      for (let s = current + 1; s <= original; s += 1) {
        expect(Math.abs(s) <= original, `原方案应把 |S|=${s} 算作边界（n=${n}）`).toBe(true)
        expect(isBoundary(policy, s, n), `现行规则不应把 |S|=${s} 算作边界（n=${n}）`).toBe(false)
      }
    }
  })

  it('n=12：原方案到 |S|=4，现行（v3）到 2，而「分子 4 且仍是 B=T−1」只到 3', () => {
    expect(boundaryThreshold(policy, 12)).toBe(2)
    expect(boundaryThreshold(numeratorFourLegacyScale, 12)).toBe(3)
    expect(originalDesignBoundary(12)).toBe(4)
    expect(isBoundary(numeratorFourLegacyScale, 4, 12)).toBe(false)
  })
})
