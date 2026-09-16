import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CARD_HEIGHT,
  CARD_SCALE_LOW,
  CARD_WIDTH,
  SHARE_LAYOUT,
  SHARE_MOTTO,
  SHARE_SELF_USE,
  drawShareCard,
  preferredScale,
  readableUrl,
  shareFooterLines,
  verifyImageBlob,
  wrapText,
} from './shareImage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import type { Response, ResponseMap } from '@/domain/answers'
import { analyzeAssessment } from '@/domain/assessment'
import { buildReportViewModel } from '@/domain/report'
import type { ReportViewModel } from '@/domain/report'
import { DIMENSION_ORDER, NEGATIVE_POLE, POSITIVE_POLE } from '@/domain/scoring'
import type { Dimension } from '@/domain/types'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES } from '@/content/fallback'

/**
 * 分享图与分享产物的约束测试（不依赖真实浏览器 canvas）。
 *
 * 旧版断言针对已经删除的 `shareText(result, profile)` / `shareFileName(result)`，
 * 这里按新契约重写：**所有导出渠道（复制文字 / alt / 文件名 / 图片文本）都只从
 * `buildReportViewModel()` 出来的 `ReportViewModel` 取值**（开发方案 §2.3 / §7.4）。
 *
 * 仍然保留的既有约束：
 *   - 画布 1080×1920，低内存 540×960；
 *   - `SHARE_LAYOUT` 的竖向预算不溢出；
 *   - `wrapText` 逐字按宽度测量、不裁断；
 *   - 分享文案不含逐题明细、分数、百分位、外部链接参数；
 *   - 分享文案不出现红线词。
 *
 * 本轮新增的核心回归断言：**未定结果（partial / undetermined / 含信息不足）在任何
 * 导出渠道都不得回退成默认类型（尤其 ISFJ），也不得出现任何一个完整四字母类型码。**
 */

/** 站点默认包已换成 IPIP-50；本文件的 typed / 四字母产物断言属于 OEJTS。 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

/**
 * 本文件的主体断言针对 **OEJTS 的 typed / 四字母产物**（`typeme-profile-ESFP.png`、
 * `-partial.png`、`-undetermined.png`、headline / typeLine、页脚 attribution），
 * 因此这里固定取 OEJTS 内容包，不再跟随 `DEFAULT_PACKAGE_ID`（已换成 IPIP-50）。
 * 新默认包（IPIP-50 大五）的分享模型由文件末尾的独立 describe 覆盖。
 */
const pkg = FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage

/** 16 个合法类型码——逐码断言，避免用一条宽松正则漏掉某个组合。 */
const ALL_TYPE_CODES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP',
  'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
  'ISTP', 'ISFP', 'ESTP', 'ESFP',
] as const

const TYPE_CODE_PATTERN = new RegExp(`\\b(?:${ALL_TYPE_CODES.join('|')})\\b`)

/** 文案红线词（产品方案 §5.2 / §8）。 */
const RED_LINE_WORDS = ['最准', '官方', '权威', '诊断', '注定', '你就是'] as const

/**
 * 逐题构造答卷：每维 8 题的 `centered = direction × (rating − 3)` 求和等于目标偏移。
 *
 * 因为 `direction ∈ {+1,−1}`，任何一题都能贡献 −2..+2 中任意整数
 * （取 `rating = 3 + direction × centered`，仍落在 1–5 内），所以 |δ| ≤ 16 的目标都可达。
 * 不做 `?? 3` 之类的兜底：这里显式构造每一题的 1–5 整数答案。
 */
function responsesWithOffsets(offsets: Partial<Record<Dimension, number>> = {}): ResponseMap {
  const targets: Record<Dimension, number> = { EI: 0, SN: 0, TF: 0, JP: 0, ...offsets }
  const responses: ResponseMap = {}
  for (const dimension of DIMENSION_ORDER) {
    const questions = pkg.questionnaire.questions.filter((question) => question.dimension === dimension)
    expect(questions, `${dimension} 必须有 8 题`).toHaveLength(8)
    let remaining = targets[dimension]
    for (const question of questions) {
      const centered = Math.sign(remaining) * Math.min(2, Math.abs(remaining))
      const rating = 3 + question.direction * centered
      expect(
        Number.isInteger(rating) && rating >= 1 && rating <= 5,
        `Q${question.id} 的作答必须是 1–5 的整数，实际 ${rating}`,
      ).toBe(true)
      responses[question.id] = { kind: 'rating', value: rating as 1 | 2 | 3 | 4 | 5 }
      remaining -= centered
    }
    expect(remaining, `${dimension} 的 centered 之和没有命中目标偏移`).toBe(0)
  }
  return responses
}

/** 每一题都选同一个数字（全 3 即四维 balanced）。 */
function responsesUniform(value: 1 | 2 | 3 | 4 | 5): ResponseMap {
  return Object.fromEntries(
    pkg.questionnaire.questions.map((question) => [question.id, { kind: 'rating', value } as Response]),
  ) as ResponseMap
}

/** 把某维整维标成「暂时无法判断」（8 题全 unknown）。 */
function markDimensionUnknown(responses: ResponseMap, dimension: Dimension): ResponseMap {
  for (const question of pkg.questionnaire.questions.filter((item) => item.dimension === dimension)) {
    responses[question.id] = { kind: 'unknown', reason: 'unclear' }
  }
  return responses
}

/** 只测宽度用的最小替身（与旧断言一致：中文按固定宽度计）。 */
function fakeMeasure(widthPerChar = 28): CanvasRenderingContext2D {
  return {
    measureText: (text: string) => ({ width: text.length * widthPerChar }),
  } as unknown as CanvasRenderingContext2D
}

function reportFrom(responses: ResponseMap, source: AssessmentPackage = pkg): ReportViewModel {
  return buildReportViewModel(analyzeAssessment(responses, source), source, responses)
}

/** 完整（typed）：四维都 leaning → EI:+12 / SN:−12 / TF:−12 / JP:+12 → ESFP。 */
const TYPED_OFFSETS = { EI: 12, SN: -12, TF: -12, JP: 12 }
/** 部分（partial）：三维 leaning + SN 只到 tentative，完整类型必须为空。 */
const PARTIAL_OFFSETS = { EI: -12, SN: 4, TF: -8, JP: 10 }

function typedReport(): ReportViewModel {
  return reportFrom(responsesWithOffsets(TYPED_OFFSETS))
}

function partialReport(): ReportViewModel {
  return reportFrom(responsesWithOffsets(PARTIAL_OFFSETS))
}

/** 含信息不足的部分结果：SN 整维「暂时无法判断」，其余三维 leaning → partial。 */
function insufficientPartialReport(): ReportViewModel {
  return reportFrom(markDimensionUnknown(responsesWithOffsets({ EI: -12, TF: -8, JP: 10 }), 'SN'))
}

/** 完全未定且含信息不足：SN 无法判断，其余三维落在中点 → undetermined。 */
function insufficientUndeterminedReport(): ReportViewModel {
  return reportFrom(markDimensionUnknown(responsesUniform(3), 'SN'))
}

function undeterminedReport(): ReportViewModel {
  return reportFrom(responsesUniform(3))
}

/** 未定结果：四类都必须走同一套「不泄漏类型」检查。 */
const UNRESOLVED_REPORTS: ReadonlyArray<{ label: string; report: () => ReportViewModel }> = [
  { label: 'partial', report: partialReport },
  { label: 'partial + insufficient', report: insufficientPartialReport },
  { label: 'undetermined', report: undeterminedReport },
  { label: 'undetermined + insufficient', report: insufficientUndeterminedReport },
]

/** 全部四类报告（typed + 未定三类），用于「内部标识 / 个人信息 / 红线词」这类通用检查。 */
const ALL_REPORTS: ReadonlyArray<{ label: string; report: () => ReportViewModel }> = [
  { label: 'typed', report: typedReport },
  ...UNRESOLVED_REPORTS,
]

function expectNoTypeCode(actual: string, where: string): void {
  expect(actual, `${where} 不应匹配任何四字母类型码`).not.toMatch(TYPE_CODE_PATTERN)
  for (const code of ALL_TYPE_CODES) {
    expect(actual, `${where} 不应出现类型码 ${code}`).not.toContain(code)
  }
  // 默认类型尤其不能泄漏（本轮最重要的回归点）
  expect(actual, `${where} 不应出现默认类型 ISFJ`).not.toContain('ISFJ')
}

function expectNoAnswerDetails(text: string, where: string): void {
  expect(text, `${where} 不应出现逐题明细`).not.toMatch(/第\s*\d+\s*题/)
  expect(text, `${where} 不应出现百分位`).not.toContain('百分位')
  expect(text, `${where} 不应出现具体得分`).not.toMatch(/得分\s*\d/)
  expect(text, `${where} 不应出现链接参数`).not.toMatch(/[?&]\w+=/)
  expect(text, `${where} 不应出现外部链接`).not.toMatch(/https?:\/\//)
}

function expectNoRedLineWords(text: string, where: string): void {
  for (const word of RED_LINE_WORDS) {
    if (word === '诊断') {
      // 「结果仅供自我了解，不是心理诊断。」是必须保留的边界说明：
      // 把它摘掉之后再查，任何其它用法的「诊断」仍然判红。
      const withoutDisclaimer = text.split('不是心理诊断').join('')
      expect(
        withoutDisclaimer,
        `${where} 出现了红线词「诊断」（只有免责句「不是心理诊断」允许）`,
      ).not.toContain('诊断')
      continue
    }
    expect(text, `${where} 出现了红线词「${word}」`).not.toContain(word)
  }
}

/* ── 记录型 2D 上下文：把画到卡片上的每一段文字累积下来 ─────────────────── */

interface RecordedText {
  text: string
  x: number
  y: number
}

interface RecordingContext {
  ctx: CanvasRenderingContext2D
  texts: string[]
  calls: RecordedText[]
  measured: string[]
}

/**
 * 记录型假 canvas 2D 上下文。
 *
 * 只实现 `drawShareCard` 真正会用到的方法；`measureText` 按字符数返回宽度，
 * 并把每次测量记下来（用于确认换行确实是「按宽度逐字测量」）。
 *
 * `widthOf` 可换成更贴近真实排版的度量：默认的「每字符等宽」对中英混排过于悲观
 * （真实画布上 26px 的正文字体里，汉字约 26px、拉丁字母约 13px）。页脚那几条
 * 长署名需要这个更真实的度量，否则假画布会把 45 个字符的中英混排也判成放不下，
 * 让「按宽度换行」的断言测不出真实行为。
 */
function recordingContext(widthPerChar = 28): RecordingContext {
  return recordingContextWith((text) => Array.from(text).length * widthPerChar)
}

/** 中英混排度量：汉字 26px、其余 13px（正文 26px 字体的常见比例）。 */
function mixedScriptContext(): RecordingContext {
  return recordingContextWith(textWidth)
}

function recordingContextWith(measure: (text: string) => number): RecordingContext {
  const calls: RecordedText[] = []
  const texts: string[] = []
  const measured: string[] = []
  const record = (text: string, x: number, y: number) => {
    calls.push({ text, x, y })
    texts.push(text)
  }
  const noop = () => {}
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '400 16px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    fillText: record,
    strokeText: record,
    measureText: (text: string) => {
      measured.push(text)
      return { width: measure(text) }
    },
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arcTo: noop,
    arc: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    save: noop,
    restore: noop,
    scale: noop,
    translate: noop,
    rotate: noop,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts, calls, measured }
}

/** 页脚区域实际画出来的文本（按 y 归属，顺序即绘制顺序）。 */
function footerTextsOf(calls: RecordedText[]): string[] {
  return calls.filter((call) => call.y >= SHARE_LAYOUT.footTextY).map((call) => call.text)
}

/** 页脚可用的最大绘制宽度（左右各留 `PAD`）。 */
const FOOTER_MAX_WIDTH = CARD_WIDTH - 84 * 2

/** 与 `mixedScriptContext` 同一套度量的宽度计算（断言侧复用，避免两处口径漂移）。 */
function textWidth(text: string): number {
  return Array.from(text).reduce(
    (sum, char) => sum + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 26 : 13),
    0,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('分享卡片规格（§9.1）', () => {
  it('竖版 1080×1920，低内存降级为精确的一半', () => {
    expect(CARD_WIDTH).toBe(1080)
    expect(CARD_HEIGHT).toBe(1920)
    expect(CARD_HEIGHT).toBeGreaterThan(CARD_WIDTH)
    expect(CARD_WIDTH * CARD_SCALE_LOW).toBe(540)
    expect(CARD_HEIGHT * CARD_SCALE_LOW).toBe(960)
  })

  it('竖向预算不溢出画布（每一段都落在 1920 之内）', () => {
    const L = SHARE_LAYOUT
    expect(L.heroY).toBeGreaterThan(120) // 站点名之后
    expect(L.heroY + L.heroH).toBeLessThan(L.firstBarCenter - 46)
    // 四条维度条 + 极性字母
    const lastBarBottom = L.firstBarCenter + 3 * L.barGap + 62
    expect(lastBarBottom).toBeLessThan(L.noticeY)
    expect(L.noticeY + L.noticeH).toBeLessThan(L.mottoY)
    expect(L.mottoY + 50).toBeLessThan(L.footRuleY)
    expect(L.footTextY + 64).toBeLessThan(CARD_HEIGHT)
  })

  it('低内存设备才降级：deviceMemory ≤ 2 → 0.5，其余保持 1', () => {
    vi.stubGlobal('navigator', { deviceMemory: 1 })
    expect(preferredScale()).toBe(CARD_SCALE_LOW)
    vi.stubGlobal('navigator', { deviceMemory: 2 })
    expect(preferredScale()).toBe(CARD_SCALE_LOW)
    vi.stubGlobal('navigator', { deviceMemory: 3 })
    expect(preferredScale()).toBe(1)
    vi.stubGlobal('navigator', { deviceMemory: 8 })
    expect(preferredScale()).toBe(1)
    // 字段缺失或为 0（旧浏览器）不能被误判成低内存
    vi.stubGlobal('navigator', {})
    expect(preferredScale()).toBe(1)
    vi.stubGlobal('navigator', { deviceMemory: 0 })
    expect(preferredScale()).toBe(1)
  })

  it('金句与「仅供自我了解」是卡片上的固定文案', () => {
    expect(SHARE_MOTTO).toBe('人格是连续的，类型是人为的切分')
    expect(SHARE_SELF_USE).toContain('仅供自我了解')
    expect(SHARE_SELF_USE).toContain('不是心理诊断')
  })

  it('readableUrl 去掉协议头与结尾斜杠（授权要求的是可读地址，不是远端结果链接）', () => {
    expect(readableUrl('https://openpsychometrics.org/tests/OEJTS/')).toBe(
      'openpsychometrics.org/tests/OEJTS',
    )
    expect(readableUrl('http://example.com/')).toBe('example.com')
    expect(readableUrl('https://example.com/a/b')).toBe('example.com/a/b')
    expect(readableUrl('')).toBe('')
    // 幂等：重复处理不会继续剥掉路径
    const once = readableUrl('https://creativecommons.org/licenses/by-nc-sa/4.0/')
    expect(once).toBe('creativecommons.org/licenses/by-nc-sa/4.0')
    expect(readableUrl(once)).toBe(once)
    // 不做假二维码、不隐藏许可来源
    expect(once).not.toContain('https://')
  })

  it('shareFooterLines 三行：来源与作者、可读地址、许可与许可地址（全部来自传入的 attribution）', () => {
    const attribution = pkg.attribution
    const footer = shareFooterLines(attribution)
    expect(footer).toHaveLength(3)

    // 第一行：OEJTS 来源与作者（CC BY 的署名义务）
    expect(footer[0]).toContain('OEJTS')
    expect(footer[0]).toContain('Eric Jorgenson')
    expect(footer[0]).toContain(attribution.source)
    expect(footer[0]).toContain(attribution.author)

    // 第二行：可读地址（无协议头）
    expect(footer[1]).toContain('openpsychometrics.org')
    expect(footer[1]).toBe('openpsychometrics.org/tests/OEJTS')
    expect(footer[1]).not.toMatch(/^https?:\/\//)

    // 第三行：许可名与许可地址
    expect(footer[2]).toContain('CC BY-NC-SA 4.0')
    expect(footer[2]).toContain('creativecommons.org')
    expect(footer[2]).not.toContain('https://')
    expect(footer[2]).toBe('CC BY-NC-SA 4.0 · creativecommons.org/licenses/by-nc-sa/4.0')
  })

  it('许可与署名必须来自**传入**的 attribution，不能写死在渲染器里', () => {
    const custom = shareFooterLines({
      source: '示例量表（测试用）',
      author: '示例作者',
      url: 'http://ref.example/demo/',
      license: 'CC BY 4.0',
      licenseUrl: 'https://license.example/by/4.0/',
    })
    expect(custom).toEqual([
      '题目基于 示例量表（测试用）（示例作者）',
      'ref.example/demo',
      'CC BY 4.0 · license.example/by/4.0',
    ])
    for (const line of custom) {
      expect(line).not.toContain('Jorgenson')
      expect(line).not.toContain('openpsychometrics.org')
    }
  })

  it('换行按绘制宽度测量，长文本不会裁断（多余部分省略而不是截断）', () => {
    const lines = wrapText(fakeMeasure(20), '一二三四五六七八九十', 60)
    expect(lines.length).toBeGreaterThan(1)
    // 逐字测量的结果：每一行都不超过最大宽度
    for (const line of lines) {
      expect(line.length * 20).toBeLessThanOrEqual(60 + 20)
      expect(line.length * 20).toBeLessThanOrEqual(60)
    }
    expect(lines.join('')).toBe('一二三四五六七八九十')
  })

  it('wrapText 是逐字测量（而不是按空格切词），且保留显式换行', () => {
    const measured: string[] = []
    const ctx = {
      measureText: (text: string) => {
        measured.push(text)
        return { width: Array.from(text).length * 20 }
      },
    } as unknown as CanvasRenderingContext2D

    const lines = wrapText(ctx, '一二三四五六', 40)
    expect(lines).toEqual(['一二', '三四', '五六'])
    // 每个候选串都被真实测量过：换行是「逐字加一 + 测宽」，不是先按词切好再量
    expect(measured).toEqual(['一', '一二', '一二三', '三四', '三四五', '五六'])
    // 一次换行候选测一次宽：6 个字就是 6 次测量（按词切只有 1 次）
    expect(measured).toHaveLength(6)
    // 触发换行的那一次测量确实是「加了第 3 个字之后」的完整候选串
    expect(measured).toContain('一二三')

    const withBreak = wrapText(ctx, '一二\n三四五', 100)
    expect(withBreak).toEqual(['一二', '三四五'])
  })
})

describe('ReportViewModel → 三类分享产物（§7.4）', () => {
  it('helper 自检：逐维 8 题的 centered 之和真的命中了目标偏移', () => {
    const offsets: Record<string, number> = { EI: -12, SN: 4, TF: -8, JP: 10 }
    const responses = responsesWithOffsets(offsets)
    const analysis = analyzeAssessment(responses, pkg)
    for (const dimension of DIMENSION_ORDER) {
      const item = analysis.dimensions.find((entry) => entry.dimension === dimension)!
      expect(item.score, `${dimension} 原始分`).toBe(24 + offsets[dimension])
      // 独立验算：逐题 centered 求和
      let sum = 0
      for (const question of pkg.questionnaire.questions.filter((q) => q.dimension === dimension)) {
        const response = responses[question.id]
        expect(response?.kind).toBe('rating')
        const rating = response.kind === 'rating' ? response.value : 0
        expect(Number.isInteger(rating) && rating >= 1 && rating <= 5).toBe(true)
        sum += question.direction * (rating - 3)
      }
      expect(sum, `${dimension} centered 之和`).toBe(offsets[dimension])
      expect(item.signedOffset).toBe(offsets[dimension])
    }
  })

  it('完整（typed）：四维都 leaning → 四个字母，headline / typeLine / 文件名一致', () => {
    const report = typedReport()
    const analysis = analyzeAssessment(responsesWithOffsets(TYPED_OFFSETS), pkg)
    for (const item of analysis.dimensions) expect(item.status).toBe('leaning')
    expect(analysis.overallStatus).toBe('typed')

    const code = analysis.suggestedTypeCode
    expect(code).not.toBeNull()
    expect(code).toMatch(/^[A-Z]{4}$/)
    // 四个字母必须与各维极性逐位一致（不是随便四个大写字母）
    const expected = DIMENSION_ORDER.map((dimension) => {
      const item = analysis.dimensions.find((entry) => entry.dimension === dimension)!
      return item.pole === POSITIVE_POLE[dimension] ? POSITIVE_POLE[dimension] : NEGATIVE_POLE[dimension]
    }).join('')
    expect(code).toBe(expected)
    expect(code).toBe('ESFP')

    expect(report.suggestedTypeCode).toBe(code)
    expect(report.share.kind).toBe('typed')
    expect(report.share.headline).toBe(code)
    expect(report.share.typeLine).toContain(code!)
    expect(report.share.typeLine).toBe(`本次问卷参考组合 ${code}`)
    expect(report.share.filename).toBe(`typeme-profile-${code}.png`)
    expect(report.share.filename).toBe('typeme-profile-ESFP.png')
    // typed 才允许在导出内容里出现类型码
    expect(report.share.text).toContain(code!)
    expect(report.share.alt).toContain(code!)
    expect(report.share.imageTitle).toBe(pkg.reportCopy.typedTitle)
  })

  it('部分（partial）：至少一维 leaning 但不足四维 → 完整类型为空，文件名固定 partial', () => {
    const responses = responsesWithOffsets(PARTIAL_OFFSETS)
    const analysis = analyzeAssessment(responses, pkg)
    const leaning = analysis.dimensions.filter((item) => item.status === 'leaning')
    expect(leaning.length).toBeGreaterThan(0)
    expect(leaning.length).toBeLessThan(4)
    expect(analysis.overallStatus).toBe('partial')
    expect(analysis.suggestedTypeCode).toBeNull()

    const report = buildReportViewModel(analysis, pkg, responses)
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('partial')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.filename).toBe('typeme-profile-partial.png')
    expect(report.share.imageTitle).toBe(pkg.reportCopy.partialTitle)
    // 仍然给出可用方向的维度（partial 不是「什么都没说」）
    expect(report.share.text).toContain('没有形成完整参考类型')
    const sn = report.dimensionRows.find((row) => row.dimension === 'SN')!
    expect(sn.status).toBe('tentative')
  })

  it('均衡（undetermined）：四维都 balanced → 完整类型为空，文件名固定 undetermined', () => {
    const responses = responsesUniform(3)
    const analysis = analyzeAssessment(responses, pkg)
    expect(analysis.overallStatus).toBe('undetermined')
    expect(analysis.suggestedTypeCode).toBeNull()
    for (const item of analysis.dimensions) {
      expect(item.status).toBe('balanced')
      expect(item.pole).toBeNull()
      expect(item.score).toBe(24)
    }

    const report = buildReportViewModel(analysis, pkg, responses)
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('undetermined')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.filename).toBe('typeme-profile-undetermined.png')
    expect(report.share.imageTitle).toBe(pkg.reportCopy.undeterminedTitle)
  })

  it('含信息不足的未定结果同样不产生类型，文件名仍是 undetermined（不是 partial / 不是类型名）', () => {
    const report = insufficientUndeterminedReport()
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('undetermined')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.filename).toBe('typeme-profile-undetermined.png')
    expect(report.share.imageTitle).toBe(pkg.reportCopy.insufficientTitle)
  })

  it('含信息不足的部分结果：仍走 partial 文件名，且不因为缺一维就拼出类型', () => {
    const report = insufficientPartialReport()
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('partial')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.filename).toBe('typeme-profile-partial.png')
    const sn = report.dimensionRows.find((row) => row.dimension === 'SN')!
    expect(sn.status).toBe('insufficient')
    expect(sn.position).toBeNull()
    expect(sn.score).toBeNull()
    expect(sn.pole).toBeNull()
  })
})

describe('未定结果不在任何导出渠道回退成默认类型（§8 / §10.3）', () => {
  for (const entry of UNRESOLVED_REPORTS) {
    it(`${entry.label}：text / alt / filename / imageTitle 都不含任何一个完整类型码`, () => {
      const report = entry.report()
      expect(report.suggestedTypeCode, `${entry.label} 不应有参考组合`).toBeNull()
      expect(report.share.headline).toBeNull()
      expect(report.share.typeLine).toBeNull()

      expectNoTypeCode(report.share.text, `${entry.label} share.text`)
      expectNoTypeCode(report.share.alt, `${entry.label} share.alt`)
      expectNoTypeCode(report.share.filename, `${entry.label} share.filename`)
      expectNoTypeCode(report.share.imageTitle, `${entry.label} share.imageTitle`)
      expectNoTypeCode(report.title, `${entry.label} title`)
      expectNoTypeCode(report.subtitle, `${entry.label} subtitle`)

      // 手动再钉一次默认类型（最容易被写死的那一个）
      expect(report.share.text).not.toContain('ISFJ')
      expect(report.share.alt).not.toContain('ISFJ')
      expect(report.share.imageTitle).not.toContain('ISFJ')
      expect(report.share.filename).not.toContain('ISFJ')
      expect(report.share.filename).not.toMatch(/typeme-profile-[A-Z]{4}\.png/)
    })
  }

  for (const entry of UNRESOLVED_REPORTS) {
    it(`${entry.label}：复制文字不含逐题明细、分数、百分位与外部链接参数`, () => {
      const report = entry.report()
      expectNoAnswerDetails(report.share.text, `${entry.label} share.text`)
      expectNoAnswerDetails(report.share.alt, `${entry.label} share.alt`)
      expectNoAnswerDetails(report.share.filename, `${entry.label} share.filename`)
    })
  }

  it('分享文案里不出现红线词（typed 与未定结果都要检查）', () => {
    for (const { label, report: build } of ALL_REPORTS) {
      const report = build()
      for (const [where, value] of Object.entries({
        'share.text': report.share.text,
        'share.alt': report.share.alt,
        'share.imageTitle': report.share.imageTitle,
        title: report.title,
        subtitle: report.subtitle,
      })) {
        expectNoRedLineWords(value, `${label} ${where}`)
        expect(value.length, `${label} ${where} 不应为空`).toBeGreaterThan(0)
      }
      // 边界说明必须仍然在（不能为了躲开「诊断」把免责句删掉）
      expect(report.share.text).toContain('仅供自我了解')
      expect(report.share.text).toContain('不是心理诊断')
    }
  })
})

describe('分享产物不含内部标识与个人信息', () => {
  it('reportId / packageId / 解释版本 / 会话标识都不进分享内容', () => {
    for (const { label, report: build } of ALL_REPORTS) {
      const report = build()
      expect(report.reportId.length).toBeGreaterThan(0)
      for (const [where, value] of Object.entries({
        'share.text': report.share.text,
        'share.alt': report.share.alt,
        'share.filename': report.share.filename,
        'share.imageTitle': report.share.imageTitle,
      })) {
        expect(value, `${label} ${where} 不应带 reportId`).not.toContain(report.reportId)
        expect(value, `${label} ${where} 不应带 packageId`).not.toContain(report.packageId)
        expect(value, `${label} ${where} 不应带解释政策版本`).not.toContain(report.interpretationVersion)
        expect(value, `${label} ${where} 不应带内容包前缀`).not.toContain('oejts32')
      }
    }
  })

  it('文件名只有产品前缀 + 类型码/未定状态，没有时间戳或长数字 ID', () => {
    for (const { label, report: build } of ALL_REPORTS) {
      const name = build().share.filename
      expect(name, `${label} 的文件名形状`).toMatch(
        /^typeme-profile-(?:[A-Z]{4}|partial|undetermined)\.png$/,
      )
      expect(name, `${label} 的文件名不应含时间戳`).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(name, `${label} 的文件名不应含长数字 ID`).not.toMatch(/\d{6,}/)
    }
  })
})

describe('画布输出：图片上出现的文本也受同一套约束（§7.4 / §10.3）', () => {
  it('typed：卡片上出现四字母大字与类型信息行（不再重复一遍 imageTitle）', () => {
    const report = typedReport()
    const { ctx, texts, measured } = recordingContext()
    drawShareCard(ctx, { report })

    expect(texts).toContain(report.share.headline)
    expect(texts).toContain(report.share.typeLine)
    expect(texts).toContain(report.suggestedTypeCode)
    // 「本次问卷参考组合」这层含义必须仍然出现在卡片上，只是由 typeLine 承担，
    // 不再额外画一遍 imageTitle（同一句话画两次是实测发现的冗余）。
    expect(report.share.typeLine).toContain(report.share.imageTitle)
    expect(texts.join('')).toContain(report.share.imageTitle)
    // 换行确实按宽度测量过
    expect(measured.length).toBeGreaterThan(0)
  })

  it('结论提示的两行正文不会被省略号吃掉关键说明（真实导出实测过的回归）', () => {
    for (const { label, report: build } of ALL_REPORTS) {
      const report = build()
      const { ctx, texts } = recordingContext()
      drawShareCard(ctx, { report })
      const noticeTitle =
        report.share.kind === 'typed'
          ? '这是本次回答下的参考组合'
          : report.share.kind === 'partial'
            ? '完整结论本次为空'
            : report.share.kind === 'clear'
              ? '每个维度本次都有较明确的方向'
              : '本次没有显示明确方向'
      const index = texts.indexOf(noticeTitle)
      expect(index, `${label} 结论提示标题必须被画出`).toBeGreaterThanOrEqual(0)
      const body = texts.slice(index + 1, index + 3).join('')
      expect(body, `${label} 提示正文不应被省略号截断`).not.toContain('…')
      if (report.share.kind !== 'typed') {
        expect(body, `${label} 提示正文必须保留「结合…描述」的说明`).toContain('描述')
      }
    }
  })

  for (const entry of UNRESOLVED_REPORTS) {
    it(`${entry.label}：画出的所有文本都不含任何一个完整类型码`, () => {
      const report = entry.report()
      const { ctx, texts } = recordingContext()
      drawShareCard(ctx, { report })

      const joined = texts.join('\n')
      expectNoTypeCode(joined, `${entry.label} 图片文本`)
      expect(joined).not.toContain('ISFJ')

      // 没有四字母大字可画时，画的是标题而不是空串
      expect(texts).toContain(report.share.imageTitle)
      expect(texts.length).toBeGreaterThan(3)
    })
  }

  it('任何一次 fillText 都不是空串，且都落在 1080×1920 画布内', () => {
    for (const { label, report: build } of ALL_REPORTS) {
      const { ctx, calls } = recordingContext()
      drawShareCard(ctx, { report: build() })
      expect(calls.length).toBeGreaterThan(10)
      for (const call of calls) {
        expect(call.text, `${label} 画出了空文本`).not.toBe('')
        expect(call.y, `${label} 文本 y 越界：${call.text}`).toBeGreaterThan(0)
        expect(call.y, `${label} 文本 y 越界：${call.text}`).toBeLessThan(CARD_HEIGHT)
        expect(call.x, `${label} 文本 x 越界：${call.text}`).toBeGreaterThanOrEqual(0)
        expect(call.x, `${label} 文本 x 越界：${call.text}`).toBeLessThanOrEqual(CARD_WIDTH)
      }
    }
  })

  it('三行页脚（署名 / 可读地址 / 许可）确实被画到卡片上，长署名按宽度换行且不吞字', () => {
    const report = typedReport()
    const { ctx, texts, calls } = mixedScriptContext()
    drawShareCard(ctx, { report })

    const footer = shareFooterLines(report.attribution)
    expect(footer).toHaveLength(3)

    // 页脚是**按宽度换行**画的：把页脚区域画出来的片段原样拼回去必须等于源文本。
    // 这条同时钉住两件事：三条署名都真的画上去了；换行只切分、不吞字也不截断。
    const footerTexts = footerTextsOf(calls)
    expect(footerTexts.length).toBeGreaterThanOrEqual(3)
    expect(footerTexts.join('')).toBe(footer.join(''))
    // 每一段都放得下（超宽才是真实的裁切缺陷）
    expect(footerTexts.every((line) => !line.endsWith('…'))).toBe(true)

    expect(texts.join('\n')).toContain('OEJTS')
    expect(texts.join('\n')).toContain('Jorgenson')
    expect(texts.join('\n')).toContain('openpsychometrics.org')
    expect(texts.join('\n')).toContain('CC BY-NC-SA 4.0')
    expect(texts.join('\n')).toContain('creativecommons.org')
    // 金句与边界说明也在图上
    expect(texts).toContain(SHARE_MOTTO)
    expect(texts).toContain(SHARE_SELF_USE)
  })

  it('页脚的每一段都不超过画布可用宽度（OEJTS 的短署名同样要守住）', () => {
    const { ctx, calls, measured } = mixedScriptContext()
    drawShareCard(ctx, { report: typedReport() })
    const footerTexts = footerTextsOf(calls)
    expect(footerTexts.length).toBeGreaterThanOrEqual(3)
    for (const line of footerTexts) {
      expect(textWidth(line), `页脚这段超宽会被裁掉：${line}`).toBeLessThanOrEqual(FOOTER_MAX_WIDTH)
    }
    expect(measured.length).toBeGreaterThan(0)
  })

  it('页脚的署名/许可取自传入内容包的 attribution（换包即换署名）', () => {
    const customPackage: AssessmentPackage = {
      ...pkg,
      attribution: {
        source: '示例量表（测试用）',
        author: '示例作者',
        url: 'http://ref.example/demo/',
        license: 'CC BY 4.0',
        licenseUrl: 'https://license.example/by/4.0/',
      },
    }
    const responses = responsesWithOffsets(TYPED_OFFSETS)
    const report = reportFrom(responses, customPackage)
    expect(report.attribution).toEqual(customPackage.attribution)

    const { ctx, texts, calls } = mixedScriptContext()
    drawShareCard(ctx, { report })

    // 换行会切开长行，所以按页脚区域拼回去再比（拼接不插字，等于源文本才叫没吞字）
    const joined = footerTextsOf(calls).join('')
    expect(joined).toContain('题目基于 示例量表（测试用）（示例作者）')
    expect(joined).toContain('ref.example/demo')
    expect(joined).toContain('CC BY 4.0 · license.example/by/4.0')
    // 页脚里不许再出现默认包的署名/许可
    expect(joined).not.toContain('Jorgenson')
    expect(joined).not.toContain('openpsychometrics.org')
    expect(joined).not.toContain('CC BY-NC-SA 4.0')
    // 正文其它位置也没有把旧署名带出来
    expect(texts.join('\n')).not.toContain('Jorgenson')
  })
})

describe('verifyImageBlob 的失败路径', () => {
  const originalCreateObjectURL = (URL as unknown as { createObjectURL?: unknown }).createObjectURL
  const originalRevokeObjectURL = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL

  afterEach(() => {
    ;(URL as unknown as { createObjectURL?: unknown }).createObjectURL = originalCreateObjectURL
    ;(URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = originalRevokeObjectURL
  })

  /** 假 Image：调用方设置 src 后异步触发 onload / onerror，模拟浏览器解码。 */
  function fakeImage(options: { fail: boolean; width?: number; height?: number }) {
    return class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = options.width ?? CARD_WIDTH
      naturalHeight = options.height ?? CARD_HEIGHT
      private source = ''
      set src(value: string) {
        this.source = value
        queueMicrotask(() => {
          if (options.fail) this.onerror?.()
          else this.onload?.()
        })
      }
      get src(): string {
        return this.source
      }
    }
  }

  function stubObjectUrl() {
    const create = vi.fn((blob: Blob) => `blob:typeme-test-${blob.size}`)
    const revoke = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = create
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revoke
    return { create, revoke }
  }

  it('空 Blob 直接抛错（不能把 0 字节当成图）', async () => {
    await expect(verifyImageBlob(new Blob([]))).rejects.toThrow('分享图 Blob 为空')
  })

  it('非空 Blob 走 <img> 解码分支：成功时返回真实尺寸并回收 Object URL', async () => {
    // node 环境没有 createImageBitmap，必然走 <img> 分支
    expect(typeof createImageBitmap).toBe('undefined')
    const { create, revoke } = stubObjectUrl()
    vi.stubGlobal('Image', fakeImage({ fail: false }))

    const size = await verifyImageBlob(new Blob(['fake-png-bytes'], { type: 'image/png' }))
    expect(size).toEqual({ width: CARD_WIDTH, height: CARD_HEIGHT })
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledTimes(1)
  })

  it('非空但无法解码时抛错（坏数据不能被当成有效图片）', async () => {
    stubObjectUrl()
    vi.stubGlobal('Image', fakeImage({ fail: true }))

    await expect(
      verifyImageBlob(new Blob(['not-a-real-png'], { type: 'image/png' })),
    ).rejects.toThrow('分享图无法解码')
  })

  /**
   * 这里不测 `renderShareCard` / `shareCardBlob` 的**成功**路径：
   * node 环境的 canvas 没有 2d 上下文（返回 null），真实导出尺寸/裁切按开发方案
   * §13.3 的浏览器验收（SHARE-01..04）负责，不在这里用假通过断言冒充。
   */
})

describe('断言自检：守卫真的能判红（不是空跑）', () => {
  it('泄漏类型码 / 逐题明细 / 红线词的文本必须被判红', () => {
    // 默认类型与任何完整类型码都必须判红，无论是在文案还是文件名里
    expect(() => expectNoTypeCode('我在 TypeMe 的本次回答形成了问卷参考组合 ISFJ。', '自检')).toThrow()
    expect(() => expectNoTypeCode('完整参考类型：ESFP', '自检')).toThrow()
    expect(() => expectNoTypeCode('typeme-profile-INFP.png', '自检')).toThrow()

    // 逐题明细 / 分数 / 百分位 / 外部链接参数
    expect(() => expectNoAnswerDetails('第 3 题选了 5，得分 30，百分位 80', '自检')).toThrow()
    expect(() => expectNoAnswerDetails('https://example.com/result?id=3', '自检')).toThrow()

    // 红线词
    expect(() => expectNoRedLineWords('这是最准的官方结论', '自检')).toThrow()
    expect(() => expectNoRedLineWords('你注定是这种人', '自检')).toThrow()
    expect(() => expectNoRedLineWords('你就是内向的人', '自检')).toThrow()

    // 合法的边界说明与单字母方向不能误判（否则「删掉免责句」也能换来绿灯）
    expect(() => expectNoRedLineWords('结果仅供自我了解，不是心理诊断。', '自检')).not.toThrow()
    expect(() => expectNoTypeCode('本次回答偏向 I、F、P；S/N 待观察', '自检')).not.toThrow()
    expect(() => expectNoAnswerDetails('typeme-profile-partial.png', '自检')).not.toThrow()
  })
})

/**
 * 新默认内容包（IPIP-50 大五）的分享模型。
 *
 * 与上面的 OEJTS 断言互补：OEJTS 是**类型量表**——四维都有方向就是 `typed`，文件名带四字母；
 * IPIP-50 不是类型量表——五个维度都有方向也只到 `clear`，既没有 headline / typeLine，
 * 也没有任何四字母产物。这里只走公开入口（`analyzeAssessment` / `buildReportViewModel` /
 * `share` 模型 / `drawShareCard`），不复制一份拼码逻辑，也不改动上面任何一条 OEJTS 断言。
 */
describe('新默认包 IPIP-50（大五）：有方向、无类型码（§7.4）', () => {
  /** 站点默认注册表里的默认包；上面的 OEJTS 断言用的是同一个注册表里的另一份包。 */
  const ipip = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1'] as AssessmentPackage

  /**
   * 四字母类型码的字面形状：[EI]（第一维两极）+ [SN]（第二维两极）+ [TF] + [JP]，
   * 且前后都是词边界——中文与拉丁字母之间也有边界，所以中文句子里的 `ISFJ` 同样会被抓到。
   *
   * 刻意不写 `/[EI][SN][TF][JP]{2,4}/`：那个写法会把 5–6 个字母的词（如 `INTJX`）也判红，
   * 抓到的是"像类型码"而不是"就是类型码"。这里要求整段恰好 4 个字母、前后不与其他
   * 字母数字相连，因此它命中什么就一定是四字母类型码（下面还有一条正则自检，
   * 用「必须命中 ISFJ / ESFP、必须不命中 TypeMe 与产品自有文案」证明它不是空跑）。
   */
  const FOUR_LETTER_TYPE_SHAPE = /\b[EI][SN][TF][JP]\b/

  /**
   * 五维全部 leaning 的目标偏移。
   *
   * IPIP 每维 10 题、`centered = direction × (rating − 3)` 每题最大 ±2，所以 |δ| 可达 20；
   * 本包的解释政策是 typeMinDistance 6 / markedDistance 11，|δ| = 12 必然 leaning。
   */
  const IPIP_LEANING_OFFSETS: Readonly<Record<string, number>> = {
    E: 12,
    A: -12,
    C: 12,
    ES: -12,
    O: 12,
  }

  /**
   * 五维都落在中点（都 `balanced` → undetermined 卡片）。
   *
   * 用它与 clear 一起覆盖「两端记号」的两种画法：undetermined 没有主导侧，
   * 两端记号都应当是淡色，但**仍然必须画出来**（不是空白、更不是 undefined）。
   */
  const IPIP_NEUTRAL_OFFSETS: Readonly<Record<string, number>> = {}

  /** 逐题构造大五答卷：某一维的 centered 之和正好等于目标偏移（每维 10 题，不填兜底 3）。 */
  function ipipResponses(offsets: Readonly<Record<string, number>>): ResponseMap {
    const responses: ResponseMap = {}
    const dimensions = [...new Set(ipip.questionnaire.questions.map((question) => question.dimension))]
    for (const dimension of dimensions) {
      const questions = ipip.questionnaire.questions.filter(
        (question) => question.dimension === dimension,
      )
      expect(questions, `${dimension} 必须有 10 题`).toHaveLength(10)
      let remaining = offsets[dimension] ?? 0
      for (const question of questions) {
        const centered = Math.sign(remaining) * Math.min(2, Math.abs(remaining))
        const rating = 3 + question.direction * centered
        expect(
          Number.isInteger(rating) && rating >= 1 && rating <= 5,
          `Q${question.id} 的作答必须是 1–5 的整数，实际 ${rating}`,
        ).toBe(true)
        responses[question.id] = { kind: 'rating', value: rating as 1 | 2 | 3 | 4 | 5 }
        remaining -= centered
      }
      expect(remaining, `${dimension} 的 centered 之和没有命中目标偏移`).toBe(0)
    }
    return responses
  }

  function ipipReport(offsets: Readonly<Record<string, number>>): {
    analysis: ReturnType<typeof analyzeAssessment>
    responses: ResponseMap
    report: ReportViewModel
  } {
    const responses = ipipResponses(offsets)
    const analysis = analyzeAssessment(responses, ipip)
    return { analysis, responses, report: buildReportViewModel(analysis, ipip, responses) }
  }

  it('默认包就是 IPIP-50，而且它不是类型量表', () => {
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(ipip).toBe(FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID])
    expect(ipip.packageId).toBe(DEFAULT_PACKAGE_ID)
    expect(ipip.instrument.id).toBe('ipip50')
    expect(ipip.instrument.hasTypeCode).toBe(false)
    expect(ipip.questionnaire.questions).toHaveLength(50)
  })

  it('五维都 leaning：没有类型码，导出文件名是 clear 而不是四字母类型名', () => {
    const { analysis, report } = ipipReport(IPIP_LEANING_OFFSETS)

    // 五个维度全部达到展示条件（|δ| = 12 ≥ 本包 markedDistance 11）
    expect(analysis.dimensions).toHaveLength(5)
    for (const item of analysis.dimensions) expect(item.status).toBe('leaning')
    // `overallStatus === 'typed'` 只说明「所有维度都有方向」，与「能不能拼出类型码」是两件事
    expect(analysis.overallStatus).toBe('typed')
    // 大五不是类型量表：即使五维都有方向也不拼码（更不会拼出一个五位的"码"）
    expect(analysis.suggestedTypeCode).toBeNull()

    expect(report.hasTypeCode).toBe(false)
    expect(report.dimensionCount).toBe(5)
    expect(report.dimensionRows).toHaveLength(5)
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.packageId).toBe('ipip50-zh1')

    expect(report.share.kind).toBe('clear')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()
    expect(report.share.imageTitle).toBe(ipip.reportCopy.typedTitle)

    // 导出的文件名是「有方向但没有码」的状态名，而不是类型名
    expect(report.share.filename).toBe('typeme-profile-clear.png')
    expect(report.share.filename).not.toMatch(/^typeme-profile-[A-Z]{4}\.png$/)
    // 文件名里没有任何大写字母——类型码是四个大写字母，所以这条同时覆盖
    // 「不是类型名」和「没有别的类型痕迹」
    expect(report.share.filename).not.toMatch(/[A-Z]/)
    expect(report.share.filename).not.toMatch(FOUR_LETTER_TYPE_SHAPE)
  })

  it('复制文字 / 无障碍名称：提到 5 个维度，且不含任何四字母类型码', () => {
    const { report } = ipipReport(IPIP_LEANING_OFFSETS)

    // 维度数：`share.alt` 用「N 个维度」的措辞给出；`share.imageTitle` 那一侧用中文数字
    // 写「五个维度」。两处都钉住，避免计数在换包时被写死回「四个维度」。
    // （clear 分支的 `share.text` 列的是各维方向清单、本身不写计数，所以计数断言落在 alt 上。）
    expect(report.share.alt).toContain('5 个维度')
    expect(report.share.imageTitle).toContain('五个维度')
    // 五个维度都被点到：alt 逐个列出本次状态
    for (const row of report.dimensionRows) {
      expect(report.share.alt, `alt 应包含维度「${row.heading}」`).toContain(row.heading)
    }

    // 大五的展示记号是「低/高」：复制文字里的方向清单就是这五个（顺序 = 包声明的维度顺序）
    const poles = report.dimensionRows.map((row) => row.pole)
    expect(poles).toEqual(['高', '低', '高', '低', '高'])
    expect(report.share.text).toContain(poles.join('、'))
    expect(report.share.text).toContain('这几个方向比较清楚')
    expect(report.share.text).toContain('不是心理诊断')

    // 不是类型量表，所以整份文案说「结论」，不说「参考类型」
    expect(report.share.alt).toContain('没有形成完整结论')
    expect(report.share.alt).not.toContain('参考类型')
    expect(report.share.text).not.toContain('参考类型')

    // 形状正则自检：对类型码必须判红、对产品自有文案必须不误判（否则下面的断言就是空跑）
    expect('本次问卷参考组合 ISFJ').toMatch(FOUR_LETTER_TYPE_SHAPE)
    expect('typeme-profile-ESFP.png').toMatch(FOUR_LETTER_TYPE_SHAPE)
    expect('TypeMe 本次偏好概览图').not.toMatch(FOUR_LETTER_TYPE_SHAPE)

    // 所有导出渠道都不出现四字母类型码：形状正则 + 16 个类型码清单双重检查
    for (const [where, value] of Object.entries({
      'share.text': report.share.text,
      'share.alt': report.share.alt,
      'share.filename': report.share.filename,
      'share.imageTitle': report.share.imageTitle,
    })) {
      expect(value, `IPIP ${where} 不应匹配四字母类型码形状`).not.toMatch(FOUR_LETTER_TYPE_SHAPE)
      expectNoTypeCode(value, `IPIP ${where}`)
    }
  })

  it('图片渠道同样受约束：clear 的卡片上没有四字母类型码，页脚换成 IPIP 的署名', () => {
    const { report } = ipipReport(IPIP_LEANING_OFFSETS)
    const { ctx, texts, calls } = mixedScriptContext()
    drawShareCard(ctx, { report })

    const joined = texts.join('\n')
    expect(FOUR_LETTER_TYPE_SHAPE.test(joined)).toBe(false)
    expectNoTypeCode(joined, 'IPIP 图片文本')

    // clear 没有四字母大字可画：画的是标题，而不是空串
    expect(texts).toContain(report.share.imageTitle)
    expect(texts).toContain(SHARE_MOTTO)
    expect(texts).toContain(SHARE_SELF_USE)

    // 页脚署名取自 IPIP 包自己的 attribution（不再是 OEJTS 那一份）。
    // 公有领域的署名比 OEJTS 长得多，必须按宽度换行：拼回去要等于源文本，
    // 且每一段都放得下（否则 1080 宽的画布会左右同时裁掉一截）。
    const footer = shareFooterLines(report.attribution)
    expect(footer).toHaveLength(3)
    const footerTexts = footerTextsOf(calls)
    expect(footerTexts.join('')).toBe(footer.join(''))
    for (const line of footerTexts) {
      expect(textWidth(line), `IPIP 页脚这段超宽会被裁掉：${line}`).toBeLessThanOrEqual(
        FOOTER_MAX_WIDTH,
      )
    }
    expect(joined).toContain('IPIP')
    expect(joined).not.toContain('OEJTS')
    expect(joined).not.toContain('Jorgenson')
  })

  /**
   * **导出图上的两端记号**（真实踩过的缺陷）。
   *
   * 画布渲染曾经查 OEJTS 专用的 `NEGATIVE_POLE` / `POSITIVE_POLE`，大五的维度键
   * （E/A/C/ES/O）在表里不存在，于是 `fillText(undefined)` 把字面量 **"undefined"**
   * 画到了卡片上（页面里则是空白，因为 Vue 把 undefined 渲染成空串，所以只有导出图
   * 会把它暴露成可见文字）。这条同时钉住「有低/高」与「没有 undefined」。
   */
  it('两侧记号画的是内容包的「低/高」，画布上不会出现字面量 undefined', () => {
    for (const [label, offsets] of [
      ['clear（五维都有方向）', IPIP_LEANING_OFFSETS],
      ['undetermined（五维都落在中点）', IPIP_NEUTRAL_OFFSETS],
    ] as const) {
      const { report } = ipipReport(offsets)
      const { ctx, texts } = mixedScriptContext()
      drawShareCard(ctx, { report })

      const joined = texts.join('\n')
      expect(joined, `${label} 画布上出现了 undefined`).not.toContain('undefined')
      expect(joined, `${label} 画布上出现了 null`).not.toContain('null')
      expect(joined, `${label} 画布上出现了 NaN`).not.toContain('NaN')

      // 每个维度的两端记号都真的画上去了（低/高各一次，按行模型取值）
      for (const row of report.dimensionRows) {
        expect(row.lowToken).toBe('低')
        expect(row.highToken).toBe('高')
        expect(texts, `${label} 缺少 ${row.heading} 的低端记号`).toContain(row.lowToken)
        expect(texts, `${label} 缺少 ${row.heading} 的高端记号`).toContain(row.highToken)
      }
      // 大五的记号不是字母：卡片上不该出现 OEJTS 的极点字母
      for (const letter of ['I', 'E', 'S', 'N', 'T', 'F', 'J', 'P']) {
        expect(texts, `${label} 卡片上不该出现 OEJTS 极点字母 ${letter}`).not.toContain(letter)
      }
    }
  })
})
