import type { Attribution } from '@/domain/contentTypes'
import type { ReportDimensionRow, ReportViewModel } from '@/domain/report'
import { dimensionCountPhrase } from './cnNumber'

/**
 * 竖版分享图 —— canvas 纯前端生成（`docs/2026-09-15/...重构开发文档.md` §9.1，
 * 判型与版式见 `TypeMe-测评可信度调整-开发方案.md` §7.4）。
 *
 * 硬约束：
 *   - 实际输出 **1080×1920 PNG**，低内存设备允许降为 **540×960**（`scale = 0.5`）；
 *   - **输入只有 `ReportViewModel`**：图片不允许自己从 `typeCode` 现拼文案。
 *     未定结果里 `share.headline` 与 `share.typeLine` 必为 null，因此图片上
 *     不可能出现完整类型、角色名或由类型派生的确定性描述；
 *   - 不含逐题答案（模型里根本没有答案）、姓名、设备信息、内部会话 ID；
 *   - 网页与导出卡片共用同一套语义色。
 */

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1920
export const CARD_SCALE_LOW = 0.5

const COLORS = {
  paper: '#F7F6F2',
  paperSoft: '#EEEDE7',
  surface: '#FFFFFF',
  ink: '#1D2D3A',
  inkSoft: '#52616B',
  inkFaint: '#7C8892',
  primary: '#264E70',
  primaryDeep: '#1D3C57',
  primaryLight: '#EDF2F6',
  accent: '#B85332',
  accentLight: '#FAEDE5',
  line: '#DCDDD7',
  onPrimary: '#FFFFFF',
  onPrimarySoft: '#C9D9E6',
}

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif'
const DISPLAY_STACK = 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif'

/** 卡片上的一句话——刻意避开判决句和"注定"这类表述。 */
export const SHARE_MOTTO = '人格是连续的，类型是人为的切分'

/** 「仅供自我了解」——分享卡片必须出现的边界说明。 */
export const SHARE_SELF_USE = '仅供自我了解，不是心理诊断。'

/** 去掉协议头，卡片上只出现可读地址（不做假二维码、不放远端结果链接）。 */
export function readableUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** 卡片页脚的署名与许可三行——全部来自内容包的 attribution（CC BY 的硬性义务）。 */
export function shareFooterLines(attribution: Attribution): string[] {
  return [
    `题目基于 ${attribution.source}（${attribution.author}）`,
    readableUrl(attribution.url),
    `${attribution.license} · ${readableUrl(attribution.licenseUrl)}`,
  ]
}

/* ── 基础绘制工具 ─────────────────────────────────────────────────────── */

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height - r)
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
  ctx.lineTo(x + r, y + height)
  ctx.arcTo(x, y + height, x, y + height - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y + r, x + r, y, r)
  ctx.closePath()
}

/** 按字符逐个测量的换行（中英混排比按空格切词可靠）。 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = []
  let current = ''
  for (const char of Array.from(text)) {
    if (char === '\n') {
      lines.push(current)
      current = ''
      continue
    }
    const candidate = current + char
    if (ctx.measureText(candidate).width > maxWidth && current !== '') {
      lines.push(current)
      current = char
    } else {
      current = candidate
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

/** 按宽度换行并**在限定行数内完整收尾**（超出部分省略而不是硬裁断）。 */
function wrapClamped(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines = wrapText(ctx, text, maxWidth)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const rest = lines.slice(maxLines).join('')
  let last = kept[maxLines - 1]
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
    last = last.slice(0, -1)
  }
  kept[maxLines - 1] = rest.length > 0 ? `${last}…` : last
  return kept
}

/* ── 卡片布局（1080×1920 设计栅格） ───────────────────────────────────── */

const PAD = 84

export interface ShareCardLayout {
  heroY: number
  heroH: number
  firstBarCenter: number
  barGap: number
  noticeY: number
  noticeH: number
  mottoY: number
  footRuleY: number
  footTextY: number
}

export const SHARE_LAYOUT: ShareCardLayout = {
  heroY: 160,
  heroH: 560,
  firstBarCenter: 900,
  barGap: 146,
  noticeY: 1440,
  noticeH: 124,
  mottoY: 1614,
  footRuleY: 1700,
  footTextY: 1746,
}

/** 类型代码字号：四字母居中且不超出封面区宽度。 */
const CODE_FONT_SIZE = 186

/** 页脚行距（换行后按行推进；1920 高的画布最多放 5 行仍不出界）。 */
const FOOTER_LINE_HEIGHT = 32

/** 页脚最多画几行：`footTextY=1746`，5 行收在 1874 < 1920。 */
const MAX_FOOTER_LINES = 5

export interface ShareImageInput {
  report: ReportViewModel
  /** 画布缩放倍数，默认 1（即 1080×1920 原始像素）；低内存设备可用 0.5 */
  scale?: number
}

/** 维度在卡片上的状态短文案——不引入模型里没有的判断。 */
function rowStateText(row: ReportDimensionRow): string {
  if (row.status === 'insufficient') return '信息不足，本次不计分'
  if (row.status === 'balanced') return '本次两侧相近'
  if (row.status === 'tentative') return `略偏 ${row.pole}（待观察）`
  return `本次偏向 ${row.pole}`
}

/** 未定结果下的摘要行（永远不出现完整类型码）。 */
function untypedSummary(report: ReportViewModel): string[] {
  const leaned = report.dimensionRows.filter((row) => row.status === 'leaning' && row.pole)
  const pending = report.dimensionRows.filter((row) => row.status === 'tentative' && row.pole)
  const insufficient = report.dimensionRows.filter((row) => row.status === 'insufficient')
  const lines: string[] = []
  if (leaned.length > 0) {
    lines.push(`可给出方向：${leaned.map((row) => `${row.pole}（${row.heading}）`).join('、')}`)
  } else {
    lines.push(`${report.dimensionCount} 个维度都没有形成明确方向`)
  }
  const rest: string[] = []
  if (pending.length > 0) rest.push(`待观察：${pending.map((row) => row.pole).join('、')}`)
  if (insufficient.length > 0) rest.push(`信息不足：${insufficient.map((row) => row.heading).join('、')}`)
  if (rest.length > 0) lines.push(rest.join('　'))
  if (report.share.kind !== 'clear') {
    lines.push(report.hasTypeCode ? '完整参考类型：本次为空' : '完整结论：本次为空')
  }
  return lines
}

/**
 * 绘制分享卡片。
 * 抽出这个函数是为了能直接对离屏 canvas 做单测，而不必先插入 DOM。
 */
export function drawShareCard(ctx: CanvasRenderingContext2D, input: ShareImageInput): void {
  const { report } = input
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  const L = SHARE_LAYOUT
  const barW = W - PAD * 2

  ctx.save()
  ctx.fillStyle = COLORS.paper
  ctx.fillRect(0, 0, W, H)

  // ── 站点名 ─────────────────────────────────────────────
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COLORS.ink
  ctx.font = `700 40px ${FONT_STACK}`
  ctx.fillText('TypeMe', PAD, 120)
  ctx.textAlign = 'right'
  ctx.fillStyle = COLORS.inkFaint
  ctx.font = `400 32px ${FONT_STACK}`
  ctx.fillText('人格倾向自测', W - PAD, 120)

  // ── 墨蓝封面区 ─────────────────────────────────────────
  ctx.fillStyle = COLORS.primary
  roundRect(ctx, PAD, L.heroY, barW, L.heroH, 48)
  ctx.fill()

  ctx.textAlign = 'center'
  if (report.share.headline) {
    // typed：四字母 + 明确标注「本次问卷参考组合」
    // （顶部不再重复一遍 `imageTitle`：`typeLine` 已经写明了同一件事）
    ctx.fillStyle = COLORS.onPrimary
    ctx.font = `700 ${CODE_FONT_SIZE}px ${DISPLAY_STACK}`
    ctx.fillText(report.share.headline, W / 2, L.heroY + 240)

    ctx.font = `500 40px ${FONT_STACK}`
    ctx.fillText(report.share.typeLine ?? '', W / 2, L.heroY + 330)

    ctx.fillStyle = COLORS.onPrimarySoft
    ctx.font = `400 31px ${FONT_STACK}`
    const typedLines = wrapClamped(ctx, report.subtitle, barW - 120, 3)
    typedLines.forEach((line, index) => {
      ctx.fillText(line, W / 2, L.heroY + 410 + index * 42)
    })
  } else {
    // partial / undetermined：没有四字母，标题即结论
    ctx.fillStyle = COLORS.onPrimary
    ctx.font = `700 58px ${FONT_STACK}`
    const titleLines = wrapClamped(ctx, report.share.imageTitle, barW - 96, 2)
    titleLines.forEach((line, index) => {
      ctx.fillText(line, W / 2, L.heroY + 110 + index * 74)
    })

    ctx.fillStyle = COLORS.onPrimarySoft
    ctx.font = `400 31px ${FONT_STACK}`
    const summary = untypedSummary(report)
    let cursorY = L.heroY + 300
    for (const line of summary) {
      for (const wrapped of wrapClamped(ctx, line, barW - 120, 2)) {
        ctx.fillText(wrapped, W / 2, cursorY)
        cursorY += 46
      }
      cursorY += 26
    }
  }

  // ── 四维简化条 ─────────────────────────────────────────
  const barH = 26

  report.dimensionRows.forEach((row, index) => {
    const y = L.firstBarCenter + index * L.barGap

    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.ink
    ctx.font = `600 34px ${FONT_STACK}`
    ctx.fillText(row.heading, PAD, y - 46)

    ctx.textAlign = 'right'
    ctx.fillStyle = row.status === 'leaning' ? COLORS.primaryDeep : COLORS.inkFaint
    ctx.font = `400 30px ${FONT_STACK}`
    ctx.fillText(rowStateText(row), W - PAD, y - 46)

    // 两端记号：有主导侧时用主色，其余都用淡色（未定没有主导侧）。
    //
    // ⚠️ 必须取行模型里的 `lowToken` / `highToken`（内容包按量表给：OEJTS 是 I/E 字母，
    // 大五是「低/高」）。曾经这里查 OEJTS 专用的 `NEGATIVE_POLE` / `POSITIVE_POLE`，
    // 换成大五后画布上直接刷出两行字面量 "undefined"（页面里则是空白，因为它把
    // undefined 渲染成空字符串）—— 只有导出图会把这个缺陷暴露成可见文字。
    const negativePole = row.lowToken
    const positivePole = row.highToken
    ctx.textAlign = 'left'
    ctx.fillStyle = row.pole === negativePole ? COLORS.primary : COLORS.inkFaint
    ctx.font = `700 42px ${FONT_STACK}`
    ctx.fillText(negativePole, PAD, y + 62)
    ctx.textAlign = 'right'
    ctx.fillStyle = row.pole === positivePole ? COLORS.primary : COLORS.inkFaint
    ctx.fillText(positivePole, W - PAD, y + 62)

    // 轨道
    const trackX = PAD + 52
    const trackW = barW - 104
    ctx.fillStyle = COLORS.paperSoft
    roundRect(ctx, trackX, y, trackW, barH, barH / 2)
    ctx.fill()

    // 中线
    const centerX = trackX + trackW / 2
    ctx.fillStyle = COLORS.ink
    ctx.fillRect(centerX - 2, y - 9, 4, barH + 18)

    // 位置标记点：信息不足时不画点（避免把「没算分」画成 0 分）
    if (row.position !== null) {
      const dotX = trackX + trackW * row.position
      ctx.beginPath()
      ctx.arc(dotX, y + barH / 2, 17, 0, Math.PI * 2)
      ctx.fillStyle = row.status === 'leaning' ? COLORS.primary : COLORS.accent
      ctx.fill()
      ctx.lineWidth = 5
      ctx.strokeStyle = COLORS.surface
      ctx.stroke()
    } else {
      ctx.fillStyle = COLORS.inkFaint
      ctx.font = `400 24px ${FONT_STACK}`
      ctx.textAlign = 'center'
      ctx.fillText('未计分', centerX, y - 6)
    }
    ctx.textAlign = 'left'
  })

  // ── 结论提示 ───────────────────────────────────────────
  const kind = report.share.kind
  const noticeTitle =
    kind === 'typed'
      ? '这是本次回答下的参考组合'
      : kind === 'partial'
        ? '完整结论本次为空'
        : kind === 'clear'
          ? '每个维度本次都有较明确的方向'
          : '本次没有显示明确方向'
  const pendingRows = report.dimensionRows.filter((row) => row.status !== 'leaning')
  const pendingNames = pendingRows.map((row) =>
    row.status === 'insufficient' ? `${row.heading}·信息不足` : row.heading,
  )
  const countPhrase = dimensionCountPhrase(report.dimensionCount)
  /**
   * 提示正文。
   *
   * ⚠️ 这里必须**短**：提示框只有两行的高度，`wrapClamped` 超出行数会加省略号，
   * 于是「请结合两侧描述理解」这句关键说明会被吃掉（真机导出实测过）。
   * 四维全未定时不再逐条列名字，只说结论。
   */
  const noticeBody =
    kind === 'typed'
      ? `${countPhrase}都达到本产品的展示条件；它仍是本次回答下的参考组合，不代表稳定不变的类型。`
      : kind === 'clear'
        ? `所有维度都达到本产品的展示条件；请以各维度的方向与两侧描述理解，本次不做类型归类。`
        : pendingRows.length === report.dimensionRows.length
          ? '所有维度都落在接近中点的范围，本次不生成完整结论；请结合每一维两侧的描述理解。'
          : `未达到展示条件的维度：${pendingNames.join('、')}。请结合它们两侧的描述理解。`

  ctx.fillStyle = kind === 'typed' ? COLORS.primaryLight : COLORS.accentLight
  roundRect(ctx, PAD, L.noticeY, barW, L.noticeH, 32)
  ctx.fill()

  ctx.textAlign = 'left'
  ctx.fillStyle = kind === 'typed' ? COLORS.primaryDeep : COLORS.accent
  ctx.font = `600 32px ${FONT_STACK}`
  ctx.fillText(noticeTitle, PAD + 36, L.noticeY + 48)

  ctx.fillStyle = COLORS.inkSoft
  ctx.font = `400 27px ${FONT_STACK}`
  wrapClamped(ctx, noticeBody, barW - 72, 2).forEach((line, index) => {
    ctx.fillText(line, PAD + 36, L.noticeY + 88 + index * 34)
  })

  // ── 金句 + 仅供自我了解 ────────────────────────────────
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.ink
  ctx.font = `500 42px ${DISPLAY_STACK}`
  ctx.fillText(SHARE_MOTTO, W / 2, L.mottoY)
  ctx.fillStyle = COLORS.inkFaint
  ctx.font = `400 28px ${FONT_STACK}`
  ctx.fillText(SHARE_SELF_USE, W / 2, L.mottoY + 50)

  // ── 来源署名与许可（可读地址，不是假二维码） ────────────
  ctx.fillStyle = COLORS.line
  ctx.fillRect(PAD, L.footRuleY, W - PAD * 2, 2)

  const footer = shareFooterLines(report.attribution)
  /**
   * 页脚必须**按宽度换行**，不能一行一条硬画。
   *
   * OEJTS 的署名短（"Open Extended Jungian Type Scales (OEJTS) 1.2 / Eric Jorgenson"），
   * 一行放得下；公有领域的 IPIP 署名长得多（"International Personality Item Pool (IPIP)
   * — Goldberg's Big-Five Factor Markers / Lewis R. Goldberg"），硬画会在 1080 宽的画布上
   * **左右同时被裁掉**（导出图上真的出现了 "ational … Lewis R. Go" 这种断头文字）。
   * 这里逐条换行，并把整个页脚限制在 `MAX_FOOTER_LINES` 行内，超出部分用省略号收尾。
   */
  const footerLines: { text: string; strong: boolean }[] = []
  for (const [index, line] of footer.entries()) {
    const strong = index === 0
    ctx.font = `${strong ? '400 26px' : '400 24px'} ${FONT_STACK}`
    const remaining = MAX_FOOTER_LINES - footerLines.length
    if (remaining <= 0) break
    for (const wrapped of wrapClamped(ctx, line, W - PAD * 2, Math.min(2, remaining))) {
      footerLines.push({ text: wrapped, strong })
    }
  }

  footerLines.forEach((line, index) => {
    ctx.fillStyle = line.strong ? COLORS.inkSoft : COLORS.inkFaint
    ctx.font = `${line.strong ? '400 26px' : '400 24px'} ${FONT_STACK}`
    ctx.fillText(line.text, W / 2, L.footTextY + index * FOOTER_LINE_HEIGHT)
  })

  ctx.restore()
}

/** 从行模型取端点字母的唯一出处是 `scoring.ts` 的 `POLE_META`（避免再抄一份映射）。 */

/* ── 画布与产物 ───────────────────────────────────────────────────────── */

/** 是否为低内存环境（决定是否降到 540×960）。 */
export function preferredScale(): number {
  if (typeof navigator === 'undefined') return 1
  const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= 2) return CARD_SCALE_LOW
  return 1
}

/** 创建离屏 canvas 并绘制，返回 canvas（调用方可继续 toBlob / toDataURL）。 */
export function renderShareCard(input: ShareImageInput): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('分享图需要在浏览器环境中生成')
  }
  const scale = input.scale ?? 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(CARD_WIDTH * scale)
  canvas.height = Math.round(CARD_HEIGHT * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 canvas 2d，无法生成分享图')
  if (scale !== 1) ctx.scale(scale, scale)
  drawShareCard(ctx, input)
  return canvas
}

/**
 * 生成分享图 Blob（PNG）。
 * 成功后必须检查：Blob 非空、类型为图片、尺寸正确。
 */
export async function shareCardBlob(input: ShareImageInput): Promise<Blob> {
  const scale = input.scale ?? preferredScale()
  const canvas = renderShareCard({ ...input, scale })
  const expectedWidth = canvas.width
  const expectedHeight = canvas.height

  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((value) => resolve(value), 'image/png')
      } catch {
        resolve(null)
      }
    })
    if (blob && blob.size > 0) return blob
    console.warn('[typeme] canvas.toBlob 返回空产物，降级为 dataURL 转换')
  }

  const dataUrl = canvas.toDataURL('image/png')
  if (!dataUrl || !dataUrl.startsWith('data:image/png')) {
    throw new Error('分享图生成失败：canvas 没有产出有效图片数据')
  }
  const binary = atob(dataUrl.split(',')[1] ?? '')
  if (binary.length === 0) throw new Error('分享图生成失败：图片数据为空')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  const blob = new Blob([bytes], { type: 'image/png' })
  if (blob.size === 0) throw new Error('分享图生成失败：图片数据为空')
  if (expectedWidth !== canvas.width || expectedHeight !== canvas.height) {
    throw new Error('分享图生成失败：输出尺寸与预期不一致')
  }
  return blob
}

/** 生成 dataURL（PNG），用于 <img> 预览 / 长按保存。 */
export function shareCardDataUrl(input: ShareImageInput): string {
  const scale = input.scale ?? preferredScale()
  const url = renderShareCard({ ...input, scale }).toDataURL('image/png')
  if (!url || !url.startsWith('data:image/png')) {
    throw new Error('分享图生成失败：canvas 没有产出有效图片数据')
  }
  return url
}

/** 校验 Blob 真的是一张能解码的 PNG（而不是 0 字节或坏数据）。 */
export async function verifyImageBlob(blob: Blob): Promise<{ width: number; height: number }> {
  if (blob.size === 0) throw new Error('分享图 Blob 为空')
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('分享图无法解码'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ── 用户操作路径 ─────────────────────────────────────────────────────── */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'unsupported'

export function canShareImageFile(file: File): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean }
  if (typeof nav.share !== 'function') return false
  if (typeof nav.canShare !== 'function') return true
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** 用户取消系统分享——不是错误，但也要给一句中性的可见反馈。 */
export function isShareCancelled(error: unknown): boolean {
  const name =
    typeof DOMException !== 'undefined' && error instanceof DOMException
      ? error.name
      : error instanceof Error
        ? error.name
        : ''
  return name === 'AbortError' || name === 'NotAllowedError'
}

function triggerDownload(url: string, filename: string): boolean {
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return true
  } catch (error) {
    console.warn('[typeme] 触发下载失败', error)
    return false
  }
}

export interface DeliverOptions {
  blob: Blob
  filename: string
  preferShare: boolean
  /**
   * 系统分享面板里的标题。
   *
   * 默认值刻意不再是"四维"：站点默认量表是大五（IPIP-50），
   * 调用方按当前报告模型的 `hasTypeCode` 传对应的说法。
   */
  shareTitle?: string
}

export async function deliverShareImage(options: DeliverOptions): Promise<ShareOutcome> {
  const { blob, filename, preferShare, shareTitle = 'TypeMe 人格倾向自测' } = options
  const file = new File([blob], filename, { type: 'image/png' })

  if (preferShare && canShareImageFile(file)) {
    try {
      await navigator.share({ files: [file], title: shareTitle })
      return 'shared'
    } catch (error) {
      if (isShareCancelled(error)) return 'cancelled'
      console.warn('[typeme] navigator.share 失败，降级为下载', error)
    }
  }

  const url = URL.createObjectURL(blob)
  const started = triggerDownload(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return started ? 'downloaded' : 'unsupported'
}

/** 复制文案（HTTP 下没有 navigator.clipboard，退回到 execCommand）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走降级路径 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', 'readonly')
    area.style.position = 'fixed'
    area.style.top = '0'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
