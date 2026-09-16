import type { Dimension, Pole } from './types'
import type {
  AssessmentPackage,
  ContentStatus,
  DimensionCopy,
  ReportCopy,
} from './assessmentPackage'
import {
  instrumentHasTypeCode,
  packageDimensionOrder,
  packageFormat,
  poleTokensOf,
} from './assessmentPackage'
import type {
  AssessmentAnalysis,
  DimensionAnalysis,
  DimensionCounts,
} from './assessment'
import { hasInsufficientDimension } from './assessment'
import type { DimensionStatus, PresentationBand } from './interpretation'
import { DIMENSION_STATUS_LABEL } from './interpretation'
import type { ResponseMap } from './answers'
import { ratingOf, responseState } from './answers'
import { questionTextOf } from './questionnaire'
import { buildDimensionScales } from './scoring'
import type { DimensionScale } from './scoring'
import type { Attribution } from './contentTypes'

/**
 * 报告展示模型 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §2.3。
 *
 * **页面、分享图片、复制文字、无障碍名称和下载文件名共用这一个模型。**
 * 之所以要把它们全部塞进模型，是因为过去的缺陷正是「页面提示均衡、图片大字 ISFJ」：
 * 只要任何一处可以自己从 `typeCode` 现拼文案，未定结果就有机会在导出渠道回退成某个类型。
 *
 * 本模型里没有逐题答案：分享渲染器读不到答案，也就不可能把答案画到图上。
 * 「为什么这样描述」的回看数据由 `buildDimensionReview()` 单独提供，只给结果页用。
 *
 * 本轮（IPIP 大五接入）的泛化：维度数、维度顺序、两端记号、以及**是否产出类型码**
 * 全部由内容包与仪器档案决定，模型里不再写死"四个维度 / 四字母"。
 */

export interface ReportDimensionRow {
  dimension: Dimension
  status: DimensionStatus
  /** 维度名（来自内容包的 `dimensionCopy.name`，不再硬编码在页面里） */
  heading: string
  /** 一句话状态 */
  summary: string
  negativeLabel: string
  positiveLabel: string
  /** 低分端的展示记号（OEJTS: 'I'；IPIP: '低'），由内容包/仪器档案提供 */
  lowToken: string
  /** 高分端的展示记号 */
  highToken: string
  /**
   * 该量表是否产出类型码（OEJTS true；大五 false）。
   *
   * 与 `ReportViewModel.hasTypeCode` 同源，逐行也带一份，是为了让**只拿到一行的组件**
   * （如维度倾向条）也能说对「不写进完整类型 / 完整结论」，而不必回查整个包。
   */
  canJoinType: boolean
  /** 标记点在轨道上的位置 0..1；`insufficient` 时为 null（不画数值点） */
  position: number | null
  pole: Pole | null
  score: number | null
  signedOffset: number | null
  presentationBand: PresentationBand | null
  counts: DimensionCounts | null
  /** 状态与事实说明（逐段渲染） */
  details: string[]
  /** 观察/行动建议（只来自本维内容） */
  actions: string[]
  /** 无障碍名称与倾向条一起使用 */
  ariaLabel: string
  reviewItemIds: number[]
}

/**
 * 分享版式分支。
 *   `typed`        —— 类型量表且所有维度都达到展示条件（有参考组合码）
 *   `clear`        —— 非类型量表（如 IPIP 大五）且所有维度都有方向：有结论但**没有码**
 *   `partial`      —— 部分维度有方向
 *   `undetermined` —— 没有任何维度达到展示条件
 */
export type ShareKind = 'typed' | 'clear' | 'partial' | 'undetermined'

export interface ReportShareModel {
  kind: ShareKind
  /** 图片顶部主标题 */
  imageTitle: string
  /** 图片中央大字；只有 typed 才有类型码，其余必须为 null */
  headline: string | null
  /** 图片上的类型信息行；未定结果不出现完整类型 */
  typeLine: string | null
  /** 下载文件名 */
  filename: string
  /** 复制文字 */
  text: string
  /** 图片无障碍名称 */
  alt: string
}

export interface ReportViewModel {
  /** 内部关联标识（回答 × 内容包 × 解释版本的指纹），不进分享内容 */
  reportId: string
  packageId: string
  interpretationVersion: string
  contentStatus: ContentStatus
  overallStatus: AssessmentAnalysis['overallStatus']
  /** 该量表是否产出类型码（OEJTS true；IPIP 大五 false）。页面据此决定是否给类型参考阅读。 */
  hasTypeCode: boolean
  /** 该量表的维度数（写「N 个维度」而不是写死四维） */
  dimensionCount: number
  title: string
  subtitle: string
  suggestedTypeCode: string | null
  dimensionRows: ReportDimensionRow[]
  nextSteps: string[]
  share: ReportShareModel
  attribution: Attribution
  /** 报告文案（页面需要的固定语句，全部来自内容包） */
  copy: ReportCopy
}

/** 分享卡片上必须出现的边界说明。 */
const SHARE_SELF_USE = '结果仅供自我了解，不是心理诊断。'

/**
 * 回答指纹：固定顺序序列化后的 FNV-1a 双 32 位哈希。
 *
 * 只在本地用于「改答即失效旧报告/旧图片」，不联网、不做安全认证。
 */
export function responsesFingerprint(responses: ResponseMap, ids: readonly number[]): string {
  // 题号顺序不影响指纹：先按数值排序，避免「题库顺序变了 → 报告 ID 变了」这种假失效
  const canonical = [...ids]
    .sort((a, b) => a - b)
    .map((id) => {
      const response = responses[id]
      if (!response) return `${id}:-`
      return response.kind === 'rating' ? `${id}:r${response.value}` : `${id}:u${response.reason ?? ''}`
    })
    .join('|')

  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let index = 0; index < canonical.length; index += 1) {
    const code = canonical.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (code + index), 0x85ebca6b) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export function reportIdOf(
  pkg: AssessmentPackage,
  analysis: AssessmentAnalysis,
  responses: ResponseMap,
): string {
  const ids = pkg.questionnaire.questions.map((question) => question.id)
  return `${pkg.packageId}:${analysis.interpretationVersion}:${responsesFingerprint(responses, ids)}`
}

function dimensionCopyOf(pkg: AssessmentPackage, dimension: Dimension): DimensionCopy {
  return pkg.dimensionCopy[dimension]
}

function otherPoleOf(pole: Pole, tokens: { low: string; high: string }): Pole {
  return pole === tokens.low ? tokens.high : tokens.low
}

function labelOf(copy: DimensionCopy, pole: Pole, tokens: { low: string; high: string }): string {
  return pole === tokens.low ? copy.negative.label : copy.positive.label
}

function poleCopyOf(copy: DimensionCopy, pole: Pole, tokens: { low: string; high: string }) {
  return pole === tokens.low ? copy.negative : copy.positive
}

function positionOf(analysis: DimensionAnalysis, scale: DimensionScale): number | null {
  if (analysis.score === null) return null
  const span = scale.max - scale.min
  if (span <= 0) return null
  const ratio = (analysis.score - scale.min) / span
  return Math.max(0, Math.min(1, ratio))
}

function rowFor(
  analysis: DimensionAnalysis,
  pkg: AssessmentPackage,
  scale: DimensionScale,
  tokens: { low: string; high: string },
): ReportDimensionRow {
  const dimension = analysis.dimension
  const copy = dimensionCopyOf(pkg, dimension)
  const negativeLabel = copy.negative.label
  const positiveLabel = copy.positive.label
  const details: string[] = []
  const actions: string[] = []
  const canJoinType = instrumentHasTypeCode(pkg)
  let summary = ''

  if (analysis.status === 'insufficient') {
    const unknown = analysis.unknownIds.length
    const unanswered = analysis.unansweredIds.length
    summary = DIMENSION_STATUS_LABEL.insufficient
    details.push(copy.insufficient.summary)
    details.push(
      `这一维共 ${analysis.requiredCount} 题，其中可计分的数字答案 ${analysis.ratingCount} 题；` +
        `标记“暂时无法判断” ${unknown} 题，尚未处理 ${unanswered} 题。本次不计算这一维的分数，也不判定方向。`,
    )
    details.push(`两端分别是「${negativeLabel} ${tokens.low}」与「${positiveLabel} ${tokens.high}」。`)
    actions.push(copy.insufficient.nextStep)
  } else if (analysis.pole === null) {
    // balanced：有有效分数，但没有主导侧
    summary = DIMENSION_STATUS_LABEL.balanced
    details.push(copy.balanced.summary)
    details.push(
      `本次这一维得分 ${analysis.score}（区间 ${scale.min}–${scale.max}，中点 ${scale.midpoint}），` +
        `正好落在中点，没有主导侧。`,
    )
    details.push(...balancedFactLines(analysis))
    details.push(`${negativeLabel} ${tokens.low}：${copy.negative.description}`)
    details.push(`${positiveLabel} ${tokens.high}：${copy.positive.description}`)
    actions.push(copy.negative.observation, copy.positive.observation)
  } else {
    const pole = analysis.pole
    const poleCopy = poleCopyOf(copy, pole, tokens)
    const label = labelOf(copy, pole, tokens)
    const distance = Math.abs(analysis.signedOffset ?? 0)
    if (analysis.status === 'tentative') {
      summary = `${DIMENSION_STATUS_LABEL.tentative}：略偏${label} ${pole}`
      details.push(poleCopy.description)
      details.push(
        `本次得分 ${analysis.score}（中点 ${scale.midpoint}），距中点只有 ${distance} 分。` +
          `这属于本产品暂定的“继续观察”区间，因此这一侧的文字只是本次作答的方向，不写进完整${
            canJoinType ? '类型' : '结论'
          }。`,
      )
      const other = otherPoleOf(pole, tokens)
      const otherCopy = poleCopyOf(copy, other, tokens)
      details.push(
        `另一侧「${labelOf(copy, other, tokens)} ${other}」同样值得一起读：${otherCopy.description}`,
      )
      actions.push(poleCopy.action, otherCopy.observation)
    } else {
      summary = `${DIMENSION_STATUS_LABEL.leaning}：${label} ${pole}`
      details.push(poleCopy.description)
      details.push(
        `本次得分 ${analysis.score}（中点 ${scale.midpoint}），距中点 ${distance} 分，` +
          (canJoinType
            ? '达到本产品的展示条件，可以参与“本次问卷参考组合”。'
            : '达到本产品的展示条件，这一维可以按方向解读。'),
      )
      actions.push(poleCopy.action)
    }
  }

  return {
    dimension,
    status: analysis.status,
    heading: copy.name,
    summary,
    negativeLabel,
    positiveLabel,
    lowToken: tokens.low,
    highToken: tokens.high,
    canJoinType,
    position: positionOf(analysis, scale),
    pole: analysis.pole,
    score: analysis.score,
    signedOffset: analysis.signedOffset,
    presentationBand: analysis.presentationBand,
    counts: analysis.counts,
    details,
    actions,
    ariaLabel: `${copy.name}：${summary}`,
    reviewItemIds: analysis.reviewItemIds,
  }
}

/**
 * 同分不一定同一种作答情况（产品方案 §4.4）：
 * 全选中立与「两侧相互抵消」都可得中点分，报告要能客观区分，且不设惩罚、不给质量百分比。
 */
function balancedFactLines(analysis: DimensionAnalysis): string[] {
  const counts = analysis.counts
  if (!counts) return []
  if (counts.neutral === analysis.requiredCount) {
    return [`这一维 ${analysis.requiredCount} 题都选了“两侧相近”。`]
  }
  if (counts.negative > 0 && counts.positive > 0) {
    return [
      `这一维不同题目出现了两侧选择（偏左 ${counts.negative} 题、偏右 ${counts.positive} 题、` +
        `两侧相近 ${counts.neutral} 题），合计接近中点。这不是作答矛盾，只是两侧贡献相互抵消。`,
    ]
  }
  return [
    `这一维的选择分布是：偏左 ${counts.negative} 题、两侧相近 ${counts.neutral} 题、偏右 ${counts.positive} 题。`,
  ]
}

function reportTitleAndSubtitle(
  analysis: AssessmentAnalysis,
  copy: ReportCopy,
): { title: string; subtitle: string } {
  if (analysis.overallStatus === 'typed') {
    return { title: copy.typedTitle, subtitle: copy.typedSubtitle }
  }
  if (analysis.overallStatus === 'partial') {
    return { title: copy.partialTitle, subtitle: copy.partialSubtitle }
  }
  if (hasInsufficientDimension(analysis)) {
    return { title: copy.insufficientTitle, subtitle: copy.insufficientSubtitle }
  }
  return { title: copy.undeterminedTitle, subtitle: copy.undeterminedSubtitle }
}

function dimensionPairText(row: ReportDimensionRow): string {
  return `${row.lowToken}/${row.highToken}`
}

function buildShare(
  analysis: AssessmentAnalysis,
  rows: ReportDimensionRow[],
  copy: ReportCopy,
  hasTypeCode: boolean,
): ReportShareModel {
  const leaned = rows.filter((row) => row.status === 'leaning' && row.pole !== null)
  const unresolved = rows.filter((row) => row.status !== 'leaning')

  /**
   * 分享版式分支。
   *
   * `kind` 只描述"本次有多少维度给出了方向"，与"能不能拼类型码"是两件事：
   * OEJTS 是类型量表（所有维度都有方向 → typed，文件名带四字母）；
   * IPIP 大五不是类型量表，即使五个维度都有方向也只写 `typeme-profile-clear.png`。
   */
  const kind: ShareKind =
    analysis.overallStatus === 'typed' && hasTypeCode
      ? 'typed'
      : analysis.overallStatus === 'partial'
        ? 'partial'
        : analysis.overallStatus === 'typed'
          ? 'clear'
          : 'undetermined'

  const imageTitle =
    kind === 'partial'
      ? copy.partialTitle
      : hasInsufficientDimension(analysis)
        ? copy.insufficientTitle
        : kind === 'undetermined'
          ? copy.undeterminedTitle
          : copy.typedTitle

  const headline = kind === 'typed' ? analysis.suggestedTypeCode : null
  const typeLine =
    kind === 'typed' && analysis.suggestedTypeCode
      ? `本次问卷参考组合 ${analysis.suggestedTypeCode}`
      : null

  const filename =
    kind === 'typed' && analysis.suggestedTypeCode
      ? `typeme-profile-${analysis.suggestedTypeCode}.png`
      : kind === 'partial'
        ? 'typeme-profile-partial.png'
        : kind === 'clear'
          ? 'typeme-profile-clear.png'
          : 'typeme-profile-undetermined.png'

  const leaningText = leaned.map((row) => `${row.pole}`).join('、')
  const unresolvedText = unresolved
    .map((row) =>
      row.status === 'insufficient'
        ? `${dimensionPairText(row)} 信息不足`
        : `${dimensionPairText(row)} 待观察`,
    )
    .join('、')

  const wholeLabel = hasTypeCode ? '参考类型' : '结论'

  const text =
    kind === 'typed'
      ? `我在 TypeMe 的本次回答形成了问卷参考组合 ${analysis.suggestedTypeCode}。${SHARE_SELF_USE}`
      : kind === 'clear'
        ? `我在 TypeMe 的本次回答里，${leaningText} 这几个方向比较清楚，其余维度仍在观察。${SHARE_SELF_USE}`
        : leaned.length > 0
          ? `我在 TypeMe 的本次回答偏向 ${leaningText}，${unresolvedText}，没有形成完整${wholeLabel}。${SHARE_SELF_USE}`
          : `我在 TypeMe 的本次回答没有形成完整${wholeLabel}（${unresolvedText}）。${SHARE_SELF_USE}`

  const stateLine = rows
    .map((row) => {
      if (row.status === 'leaning' && row.pole) return `${row.heading}偏向${row.pole}`
      if (row.status === 'tentative' && row.pole) return `${row.heading}略偏${row.pole}（待观察）`
      if (row.status === 'balanced') return `${row.heading}两侧相近`
      return `${row.heading}信息不足`
    })
    .join('；')

  const countText = `${rows.length} 个维度`
  const alt =
    kind === 'typed'
      ? `TypeMe 本次偏好概览图：问卷参考组合 ${analysis.suggestedTypeCode}。${countText}状态：${stateLine}。`
      : `TypeMe 本次偏好概览图：没有形成完整${wholeLabel}。${countText}状态：${stateLine}。`

  return { kind, imageTitle, headline, typeLine, filename, text, alt }
}

/**
 * 由「维度分析 + 内容包」生成唯一的展示模型。
 * 纯函数：同一份分析必然得到同一份报告（同一维相同作答 → 相同解释）。
 */
export function buildReportViewModel(
  analysis: AssessmentAnalysis,
  pkg: AssessmentPackage,
  responses: ResponseMap,
): ReportViewModel {
  const scales = buildDimensionScales(pkg.questionnaire)
  const rows = analysis.dimensions.map((item) =>
    rowFor(item, pkg, scales[item.dimension], poleTokensOf(pkg, item.dimension)),
  )
  const { title, subtitle } = reportTitleAndSubtitle(analysis, pkg.reportCopy)

  // 完整性守卫：任何一处未定结果都不能携带完整类型码
  if (
    analysis.suggestedTypeCode === null &&
    rows.some((row) => row.status === 'leaning' && row.pole === null)
  ) {
    throw new Error('报告模型自相矛盾：未定结果里出现了没有主导侧的“本次偏向”维度')
  }

  return {
    reportId: reportIdOf(pkg, analysis, responses),
    packageId: pkg.packageId,
    interpretationVersion: analysis.interpretationVersion,
    contentStatus: pkg.contentStatus,
    overallStatus: analysis.overallStatus,
    hasTypeCode: instrumentHasTypeCode(pkg),
    dimensionCount: rows.length,
    title,
    subtitle,
    suggestedTypeCode: analysis.suggestedTypeCode,
    dimensionRows: rows,
    nextSteps: [...pkg.nextSteps],
    share: buildShare(analysis, rows, pkg.reportCopy, instrumentHasTypeCode(pkg)),
    attribution: pkg.attribution,
    copy: pkg.reportCopy,
  }
}

/* ── 「为什么这样描述」：只给结果页用的回看数据（不含在展示模型里） ────────── */

export interface DimensionReviewItem {
  id: number
  ordinal: number
  text: string
  /** 用户本次的处理状态 */
  state: 'rating' | 'unknown' | 'unanswered'
  /** 数字答案（state === 'rating'） */
  rating: number | null
  /** 无法判断的原因（state === 'unknown'） */
  reason: string | null
  explanation: string
}

export interface DimensionReviewRow {
  dimension: Dimension
  heading: string
  items: DimensionReviewItem[]
}

/**
 * 回看数据。
 *
 * 题面文案与帮助都取自**同一个内容包**，所以不会出现「用新题面解释旧答案」；
 * 结果页把它渲染在默认折叠的区块里，并明确它只帮助回顾，不构成因果或诊断证据。
 */
export function buildDimensionReview(
  pkg: AssessmentPackage,
  responses: ResponseMap,
  analysis?: AssessmentAnalysis,
): DimensionReviewRow[] {
  const order = analysis?.dimensions.map((item) => item.dimension) ?? packageDimensionOrder(pkg)
  const format = packageFormat(pkg)
  return order.map((dimension) => {
    const copy = dimensionCopyOf(pkg, dimension)
    const items: DimensionReviewItem[] = pkg.questionnaire.questions
      .filter((question) => question.dimension === dimension)
      .map((question) => {
        const response = responses[question.id]
        const state = responseState(response)
        return {
          id: question.id,
          ordinal: pkg.questionnaire.questions.findIndex((item) => item.id === question.id) + 1,
          text: questionTextOf(question, format),
          state,
          rating: ratingOf(response),
          reason: response?.kind === 'unknown' ? response.reason : null,
          explanation: pkg.itemHelp[String(question.id)]?.explanation ?? '',
        }
      })
    return { dimension, heading: copy.name, items }
  })
}
