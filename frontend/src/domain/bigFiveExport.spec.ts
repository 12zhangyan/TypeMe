import { describe, expect, it } from 'vitest'
import { bigFiveComparable, bigFiveExport } from './bigFiveExport'
import type { BigFiveReportView, ReportDetailView } from '@/api/platformV3'

const detail = (packageId: string, scoringVersion?: string): ReportDetailView => ({
  reportId: 'test-id', attemptId: 'draft-id', instrumentSlug: 'bigfive50', instrumentKind: 'big_five',
  instrumentTitle: '大五人格倾向测评', reportKind: 'big_five_profile', packageId,
  createdAt: '2026-09-23T12:00:00Z', status: 'PROFILE', computedTypeCode: null, summaryLine: null,
  report: { schemaVersion: 2, instrument: { scoringVersion }, report: {} }, selfReflection: {}, attemptRevision: 1,
})

const dimension = (name: string, hasResult: boolean, rawScore: number | null, validCount: number): BigFiveReportView['dimensions'][number] => ({
  dimension: name, name, question: '本次状态', hasResult, rawScore, validCount,
  rangeLow: 10, rangeHigh: 50, midpoint: 30, distance: rawScore === null ? null : rawScore - 30,
  level: hasResult ? 'middle' : null, levelLabel: hasResult ? '略高' : null,
  direction: 'middle', unknownCount: 0, unprocessedCount: 0, sideLabel: null,
  description: null, dailySigns: [], reading: '', observation: null, caution: '',
})
const report: BigFiveReportView = {
  status: 'PROFILE',
  profileTitle: '本次的五维倾向', summary: '只描述本次作答',
  dimensions: [
    dimension('开放性', true, 41, 10),
    dimension('情绪稳定性', false, null, 9),
  ], limitations: ['不能用于诊断'],
  coverage: { completed: true, coverageOk: false, unknownCount: 1, unprocessedCount: 0, incompleteDimensions: ['ES'] },
  readingOrder: [],
}

describe('大五报告导出与比较边界', () => {
  it('复制、图片和替代文本来自相同快照，不补足信息不足的维度', () => {
    const result = bigFiveExport(detail('v1'), report)
    expect(result.lines).toContain('情绪稳定性：信息不足（有效作答 9 / 10）')
    expect(result.text).toContain(result.summary)
    expect(result.text).toContain(result.boundary)
    expect(result.text).toContain('不能用于诊断')
    expect(result.alt).toContain('情绪稳定性：信息不足')
    expect(result.text).not.toContain('test-id')
    expect(result.filename).toMatch(/^TypeMe-大五倾向-\d{4}-\d{2}-\d{2}\.png$/)
  })

  it('只有同包、同计分版本且版本信息完整才能计算差值', () => {
    const a = detail('v1', 'score-v1')
    expect(bigFiveComparable(a, detail('v1', 'score-v1'))).toBe(true)
    expect(bigFiveComparable(a, detail('v2', 'score-v1'))).toBe(false)
    expect(bigFiveComparable(a, detail('v1', 'score-v2'))).toBe(false)
    expect(bigFiveComparable(a, detail('v1'))).toBe(false)
    expect(bigFiveComparable(detail('v1'), detail('v1'))).toBe(false)
  })
})
