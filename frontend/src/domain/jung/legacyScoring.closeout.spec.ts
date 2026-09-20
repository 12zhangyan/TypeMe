import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { reviewClarification, score } from './scoring'
import type { Answer, ContentPackage } from './types'

// Inputs are frozen separately from the regenerated v3 fixture. Expectations are
// explicit legacy contract values, never obtained by calling the current scorer.
const root = resolve(__dirname, '../../../../')
const cases = JSON.parse(readFileSync(resolve(root,
  'backend/src/test/resources/fixtures/legacy-score-closeout.json'), 'utf8')).cases as Array<{
  id: string; answers: Record<string, { kind: 'rating' | 'unknown'; rating?: number }>
  skipped: boolean; status: string; typeCode: string | null; finalN: number; finalS: number
  boundary: boolean; applied: boolean; candidates: string[]; costs: number[]; scheduled: string[]
}>

for (const version of ['v1', 'v2']) {
  const pkg = JSON.parse(readFileSync(resolve(root,
    `backend/src/main/resources/content/typeme-jung48-zh-${version}.json`), 'utf8')) as ContentPackage
  describe(`frozen legacy scoring ${version}`, () => {
    for (const entry of cases) it(entry.id, () => {
      expect(pkg.packageId).toBe(`typeme-jung48-zh-${version}`)
      expect(pkg.instrument.scoringVersion).toBe(`typeme-jung48-score-${version}`)
      expect(pkg.scoringPolicy.version).toBe(pkg.instrument.scoringVersion)
      expect(pkg.instrument.reportContentVersion).toBe(`typeme-type-report-zh-${version}`)
      const answers = new Map<string, Answer>(Object.entries(entry.answers)
        .map(([questionId, answer]) => [questionId, { questionId, ...answer }]))
      const result = score(pkg, answers, entry.skipped)
      expect(reviewClarification(pkg, answers)).toEqual(entry.scheduled)
      expect(result.status).toBe(entry.status)
      expect(result.coverageOk).toBe(entry.status !== 'NEEDS_REVIEW')
      expect(result.computedTypeCode).toBe(entry.typeCode)
      expect(result.candidates.map(c => c.typeCode)).toEqual(entry.candidates)
      expect(result.candidates.map(c => c.cost)).toEqual(entry.costs)
      const ei = result.dimensions.find(d => d.dimension === 'EI')!
      expect([ei.nFinal, ei.SFinal, ei.boundary, ei.clarificationApplied])
        .toEqual([entry.finalN, entry.finalS, entry.boundary, entry.applied])
      if (entry.finalN === 0) expect(ei.mFinal).toBeNull()
    })
  })
}
