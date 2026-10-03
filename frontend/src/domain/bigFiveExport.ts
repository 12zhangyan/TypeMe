import type { BigFiveReportView, ReportDetailView } from '@/api/platformV3'
import { formatLocalTime } from './localTime'

export interface BigFiveExportModel {
  title: string
  summary: string
  lines: string[]
  boundary: string
  text: string
  alt: string
  filename: string
}

export function bigFiveExport(detail: ReportDetailView, report: BigFiveReportView): BigFiveExportModel {
  const title = `${detail.instrumentTitle} · ${formatLocalTime(detail.createdAt)}`
  const lines = report.dimensions.map((dimension) =>
    dimension.hasResult && dimension.rawScore !== null
      ? `${dimension.name}：${dimension.rawScore} 分（${dimension.levelLabel ?? dimension.sideLabel ?? '本次倾向'}）`
      : `${dimension.name}：信息不足（有效作答 ${dimension.validCount} / 10）`,
  )
  const boundary = '五维独立，不计算总分或类型；分数是本次作答的原始分，不是人群百分位或诊断。'
  const text = [title, report.profileTitle, report.summary, ...lines, boundary, ...report.limitations].join('\n')
  const date = new Date(detail.createdAt)
  const datePart = Number.isNaN(date.getTime())
    ? '未记录日期'
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return {
    title,
    summary: report.summary,
    lines,
    boundary,
    text,
    alt: `${title}。${report.profileTitle}。${report.summary}。${lines.join('；')}。${boundary}。${report.limitations.join('；')}`,
    filename: `TypeMe-大五倾向-${datePart}.png`,
  }
}

export function bigFiveComparable(a: ReportDetailView, b: ReportDetailView): boolean {
  if (a.reportKind !== 'big_five_profile' || b.reportKind !== 'big_five_profile') return false
  if (a.packageId !== b.packageId) return false
  const version = (detail: ReportDetailView): string | null => {
    const instrument = detail.report['instrument']
    if (!instrument || typeof instrument !== 'object' || Array.isArray(instrument)) return null
    const value = (instrument as Record<string, unknown>)['scoringVersion']
    return typeof value === 'string' && value !== '' ? value : null
  }
  const first = version(a)
  return first !== null && first === version(b)
}
