/**
 * 前端计分与 Java 权威实现的**跨实现一致性测试**。
 *
 * 数据来源是**同一份夹具文件**（`src/domain/__fixtures__/score-cases.json`），
 * 后端 `JungScoringFixtureTest` 读的是 `backend/src/test/resources/fixtures/` 下的同一个文件
 * （由 `scripts/gen-jung-fixtures.mjs` 生成三份副本）。
 *
 * 这份测试的意义不在于"前端算得对"（那不是重点：前端结果只是预览），
 * 而在于**任何一侧改坏了都会立刻被发现** —— 前端细节与后端不一致时，
 * 用户会看到"答题过程中显示偏 E，提交后报告说 I"，这种矛盾比单纯的 bug 更伤信任。
 *
 * 因此这里对每个字段都做严格相等断言，而不是抽样比对。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkCoverage, reviewClarification, score } from '../jung/scoring'
import { DIMENSIONS, type Answer, type ContentPackage, type Dimension } from '../jung/types'

/** 夹具绑定的是**当前内容包**（`JungPackageLoader.CURRENT_PACKAGE_ID`）。 */
const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../backend/src/main/resources/content/typeme-jung48-zh-v4.json'), 'utf8'),
) as ContentPackage

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../__fixtures__/score-cases.json'), 'utf8'),
) as {
  scoringVersion: string
  packageId: string
  cases: Array<{
    id: string
    title: string
    answers: Record<string, { kind: 'rating' | 'unknown'; rating?: number }>
    clarification: { scheduled: Dimension[]; skipped: boolean; submitted: string[] }
    expect: Record<string, any>
  }>
}

const pkgVersion = packageJson.instrument.scoringVersion
/**
 * 报告文案版本按**包自己声明的**那一版读取，而不是写死一个默认版本：
 * v4 复用了 v3 的报告文案（与 v3 一样指向 zh-v1），若写死或只比较常量，就可能"常量对得上、文件对不上"。
 */
const reportVersion = packageJson.instrument.reportContentVersion
const reportsJson = JSON.parse(
  readFileSync(resolve(__dirname, `../../../../backend/src/main/resources/content/${reportVersion}.json`), 'utf8'),
) as { sha256: string; reportContentVersion: string }

/** 夹具里 answers 是"题号 → 作答"的对象；补充题作答也在同一张表里。 */
function toAnswerMap(entry: (typeof fixture.cases)[number]): Map<string, Answer> {
  const map = new Map<string, Answer>()
  for (const [questionId, answer] of Object.entries(entry.answers)) {
    map.set(questionId, { questionId, kind: answer.kind, rating: answer.rating })
  }
  return map
}

describe('新测计分：与夹具（Java 权威实现）逐字段一致', () => {
  it('夹具版本与内容包版本匹配', () => {
    expect(fixture.scoringVersion).toBe(pkgVersion)
    expect(fixture.packageId).toBe(packageJson.packageId)
  })

  it('内容包自带指纹，且它声明的报告文案版本能取到对应文件', () => {
    expect(packageJson.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(reportsJson.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(reportsJson.reportContentVersion).toBe(reportVersion)
  })

  it('覆盖检查逻辑本身是纯函数（同一输入两次结果相同）', () => {
    const entry = fixture.cases[0]
    const a = checkCoverage(packageJson, toAnswerMap(entry))
    const b = checkCoverage(packageJson, toAnswerMap(entry))
    expect(a).toEqual(b)
  })

  for (const entry of fixture.cases) {
    describe(`${entry.id}（${entry.title}）`, () => {
      const answers = toAnswerMap(entry)
      const coverage = checkCoverage(packageJson, answers)
      const scheduled = reviewClarification(packageJson, answers)
      const result = score(packageJson, answers, entry.clarification.skipped)
      const expected = entry.expect

      it('服务端是否安排补充题', () => {
        expect(scheduled).toEqual(expected.reviewScheduled)
        expect(result.clarificationDimensions).toEqual(expected.reviewScheduled)
      })

      it('覆盖结果', () => {
        expect(coverage.coverageOk).toBe(expected.coverageOk)
        expect(result.coverageOk).toBe(expected.coverageOk)
        expect(coverage.insufficientDimensions).toEqual(expected.insufficientDimensions ?? [])
        for (const dimension of DIMENSIONS) {
          const actual = coverage.perDimension[dimension]
          const want = expected.coverage[dimension]
          expect({
            rating: actual.baseRatingCount,
            unknown: actual.baseUnknownCount,
            unprocessed: actual.baseUnprocessedCount,
          }).toEqual(want)
        }
      })

      it('状态与类型码', () => {
        expect(result.status).toBe(expected.status)
        expect(result.computedTypeCode).toBe(expected.computedTypeCode)
      })

      it('维度顺序固定为 EI,SN,TF,JP', () => {
        expect(result.dimensions.map((d) => d.dimension)).toEqual(expected.dimensionOrder)
      })

      it('四维每一维的全部字段', () => {
        for (const dimension of DIMENSIONS) {
          const actual = result.dimensions.find((d) => d.dimension === dimension)
          const want = expected.dimensions[dimension]
          expect({
            SBase: actual?.SBase,
            nBase: actual?.nBase,
            mBase: actual?.mBase,
            SClar: actual?.SClar,
            nClar: actual?.nClar,
            mClar: actual?.mClar,
            SFinal: actual?.SFinal,
            nFinal: actual?.nFinal,
            mFinal: actual?.mFinal,
            position: actual?.position,
            computedPole: actual?.computedPole,
            tiedSide: actual?.tiedSide,
            boundary: actual?.boundary,
            coverageOk: coverage.perDimension[dimension].coverageOk,
            baseRatingCount: coverage.perDimension[dimension].baseRatingCount,
            baseUnknownCount: coverage.perDimension[dimension].baseUnknownCount,
            baseUnprocessedCount: coverage.perDimension[dimension].baseUnprocessedCount,
            clarificationScheduled: actual?.clarificationScheduled,
            clarificationApplied: actual?.clarificationApplied,
            clarificationRatingCount: actual?.clarificationRatingCount,
          }).toEqual(want)
        }
      })

      it('平分维度与候选', () => {
        expect(result.tiedDimensions).toEqual(expected.tiedDimensions)
        expect(result.candidates.map((c) => c.typeCode)).toEqual(expected.candidateCodes)
        expect(result.candidates.map((c) => c.cost)).toEqual(expected.candidateCosts)
        expect(result.candidates.map((c) => c.differsOn)).toEqual(expected.candidateDiffersOn)
      })

      it('tieNotice 恰好在意向不明时为非空', () => {
        // 契约：候选 > 1 且（平分维度 >= 2 或 最优 cost 并列）时必须给出说明，其余情况必须为空。
        // 这里**独立重算**一遍这个条件，而不是复用 tieNotice 本身，否则等于拿结论证明结论。
        const best = result.candidates.length > 0 ? result.candidates[0].cost : 0
        const tiedAtBest = result.candidates.filter((c) => c.cost === best).length
        const ambiguous =
          result.candidates.length > 1 && (result.tiedDimensions.length >= 2 || tiedAtBest > 1)
        expect(result.tieNotice !== null).toBe(ambiguous)
      })
    })
  }
})
