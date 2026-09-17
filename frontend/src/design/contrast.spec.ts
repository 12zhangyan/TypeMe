import { describe, expect, it } from 'vitest'
import tailwindConfig from '../../tailwind.config.js'

/**
 * 设计变量的可读性守卫（WCAG 2.x 对比度）。
 *
 * ## 为什么需要它
 *
 * 2026-09-17 复核时实测：三级文字色 `ink-faint`（当时是 `#7C8892`）对 `paper`
 * 只有 **3.35:1**，低于 WCAG AA 对普通字号要求的 4.5:1。而它承担的恰恰是
 * `.caption`(13px)、`.fineprint`(12px) 与约 40 处 12–13px 的辅助文字 ——
 * 包含**表单校验失败原因**、保存状态提示、报告里的边界说明。
 * 也就是说，"最难读的字"正是"最需要读到的字"。
 *
 * 这类问题在任何渲染测试里都不报错（颜色是合法 CSS），只能靠算对比度发现，
 * 所以把门槛钉在这里：**改了 token 就必须过这一关**。
 *
 * ## 2026-09-18 视觉重构轮的两处改动
 *
 * 1. **改成直接 import 配置对象**。上一版用正则从 `tailwind.config.js` 里抠色值，
 *    而那个正则的区块匹配写错了：它会一路吃到 `colors` 这一层的右花括号，
 *    于是 `colorOf('accent','500')` 实际拿到的是 **primary-500**。
 *    两条断言因此一直在"看着另一个 token"下通过 —— 颜色确实达标，
 *    但**不是它声称的那个颜色**。守卫读错值比没有守卫更糟：它给的是假安全感。
 *    现在直接读配置对象，读的就是页面真正用的那一份。
 * 2. **新增深色区域一组**（`navy-*` 上的文字）：本轮首页主视觉与 AI 洞察区
 *    开始使用深海军蓝表面，那里的对比度必须单独守 —— 浅色底上的达标值
 *    搬到深色底上一般是反向失效的。
 *
 * ## 门槛怎么定（不是一刀切 4.5）
 *
 * - `4.5`：普通字号的正文/辅助文字（WCAG AA normal text）；
 * - `3.0`：大字号（≥18.66px 粗体或 ≥24px 常规）与非文字的图形/边界
 *   （WCAG AA large text / non-text contrast）。
 *
 * ## 刻意没有列入的项
 *
 * `disabled:*` 里的颜色（禁用按钮文字、禁用图标）不列入：WCAG 1.4.3 明确豁免
 * 非活动控件。它们仍会被"调深 token"顺带改善，但不作为门槛。
 */

type Palette = Record<string, string | Record<string, string>>

// `tailwind.config.js` 是 JS，`theme.extend` 被 TS 推成了一个带索引签名的宽类型，
// 直接断言会被判成"类型不重叠"；这里就是要读运行时的真实对象，所以先过一道 unknown。
const colors = (tailwindConfig as unknown as { theme: { extend: { colors: Palette } } }).theme.extend
  .colors

/** 从配置对象里读一个颜色：`colorOf('ink')` 取 DEFAULT，`colorOf('ink','faint')` 取指定档。 */
function colorOf(section: string, shade?: string): string {
  const group = colors[section]
  if (group === undefined) throw new Error(`tailwind.config.js 里找不到颜色分组 ${section}`)
  if (typeof group === 'string') return group
  const value = group[shade ?? 'DEFAULT']
  if (typeof value !== 'string') {
    throw new Error(`tailwind.config.js 的 ${section} 里找不到 ${shade ?? 'DEFAULT'}`)
  }
  return value
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

/** 浅色区域的页面/卡片底色，都是"文字可能落在其上"的真实表面。 */
const BACKGROUNDS = {
  paper: colorOf('paper'),
  'paper-soft': colorOf('paper', 'soft'),
  surface: colorOf('surface'),
} as const

type Rule = {
  /** 出现在哪个 token 上 */
  token: string
  foreground: string
  /** 允许落在哪些底色上；不填=全部 */
  backgrounds?: ReadonlyArray<keyof typeof BACKGROUNDS>
  min: number
  /** 为什么是这个门槛（写清字号/用途，便于以后判断能否改） */
  why: string
}

const RULES: Rule[] = [
  {
    token: 'ink',
    foreground: colorOf('ink'),
    min: 4.5,
    why: '正文主色（16–17px）',
  },
  {
    token: 'ink-soft',
    foreground: colorOf('ink', 'soft'),
    min: 4.5,
    why: '.prose-cn / .prose-sm / .link-quiet 等 14–16.5px 正文与选项文案',
  },
  {
    token: 'ink-faint',
    foreground: colorOf('ink', 'faint'),
    min: 4.5,
    why: '.caption(13px) / .fineprint(12px) / 表单校验失败原因 / 保存状态提示',
  },
  {
    token: 'primary-600',
    foreground: colorOf('primary', '600'),
    min: 4.5,
    why: '.link 与 13–15px 主色文字（按钮底色上的白字另见下一条）',
  },
  {
    token: 'primary-700',
    foreground: colorOf('primary', '700'),
    min: 4.5,
    why: '选中态文字（.option-caption[aria-checked] / .qnum-answered）',
  },
  {
    token: 'accent-500',
    foreground: colorOf('accent', '500'),
    min: 4.5,
    why: '.section-kicker(13px)、答题页维度标签、首页「示例」标注',
  },
  {
    token: 'accent-700',
    foreground: colorOf('accent', '700'),
    min: 4.5,
    why: '.qnum-unknown 与 .notice-uncertain 的正文（accent-100 底）',
    backgrounds: ['surface', 'paper'],
  },
  {
    token: 'danger-700',
    foreground: colorOf('danger', '700'),
    min: 4.5,
    why: '.notice-error 正文与 .btn-danger 的文字',
    backgrounds: ['surface', 'paper'],
  },
  {
    token: 'success-700',
    foreground: colorOf('success', '700'),
    min: 4.5,
    why: '.notice-success / 保存成功提示',
    backgrounds: ['surface', 'paper'],
  },
  {
    token: 'primary-800',
    foreground: colorOf('primary', '800'),
    min: 4.5,
    why: '.notice-info / .chip-primary 的正文',
    backgrounds: ['surface', 'paper'],
  },
]

/**
 * 深色区域（首页主视觉 / AI 洞察）的门槛。
 *
 * 这些颜色**只**出现在 `navy-700/800/900` 三种底色上，所以逐对写清楚，
 * 不用浅色那套"所有底都试一遍"的循环 —— 把 `navy-50` 放到 `paper` 上
 * 本来就是没有意义的组合，测它只会让人以为这些 token 可以随便用。
 */
const DEEP_BACKGROUNDS = {
  'navy-900': colorOf('navy', '900'),
  'navy-800': colorOf('navy', '800'),
  'navy-700': colorOf('navy', '700'),
} as const

const DEEP_RULES: { token: string; foreground: string; on: ReadonlyArray<keyof typeof DEEP_BACKGROUNDS>; min: number; why: string }[] = [
  {
    token: 'white',
    foreground: '#FFFFFF',
    on: ['navy-900', 'navy-800', 'navy-700'],
    min: 4.5,
    why: '深色区域标题与主按钮白字',
  },
  {
    token: 'navy-50',
    foreground: colorOf('navy', '50'),
    on: ['navy-900', 'navy-800', 'navy-700'],
    min: 4.5,
    why: '深色区域正文（.deep-panel 的 text-navy-50）',
  },
  {
    token: 'navy-100',
    foreground: colorOf('navy', '100'),
    on: ['navy-900', 'navy-800', 'navy-700'],
    min: 4.5,
    why: '深色区域次级正文、轴与刻度',
  },
  {
    token: 'navy-200',
    foreground: colorOf('navy', '200'),
    on: ['navy-800', 'navy-700'],
    min: 4.5,
    why: '深色区域辅助文字（说明、边界提示）',
  },
  {
    token: 'glow-soft',
    foreground: colorOf('glow', 'soft'),
    on: ['navy-800', 'navy-700'],
    min: 4.5,
    why: '深色区域里的链接与强调字（.link-on-deep）',
  },
  {
    token: 'glow',
    foreground: colorOf('glow'),
    on: ['navy-900', 'navy-800'],
    min: 4.5,
    why: 'AI 洞察区的小标题与状态字',
  },
]

describe('设计变量的对比度门槛（WCAG AA）', () => {
  for (const rule of RULES) {
    const names = rule.backgrounds ?? (Object.keys(BACKGROUNDS) as Array<keyof typeof BACKGROUNDS>)
    for (const name of names) {
      const background = BACKGROUNDS[name]
      const ratio = contrast(rule.foreground, background)
      it(`${rule.token}（${rule.foreground}）在 ${name}（${background}）上 ≥ ${rule.min}:1`, () => {
        expect(
          Number(ratio.toFixed(2)),
          `${rule.token} 在 ${name} 上只有 ${ratio.toFixed(2)}:1，低于 ${rule.min}:1。\n` +
            `用途：${rule.why}\n` +
            `改法：调深 tailwind.config.js 里该 token 的色值（不要改这条门槛）。`,
        ).toBeGreaterThanOrEqual(rule.min)
      })
    }
  }

  for (const rule of DEEP_RULES) {
    for (const name of rule.on) {
      const background = DEEP_BACKGROUNDS[name]
      const ratio = contrast(rule.foreground, background)
      it(`深色区 ${rule.token}（${rule.foreground}）在 ${name}（${background}）上 ≥ ${rule.min}:1`, () => {
        expect(
          Number(ratio.toFixed(2)),
          `${rule.token} 在 ${name} 上只有 ${ratio.toFixed(2)}:1，低于 ${rule.min}:1。\n` +
            `用途：${rule.why}\n` +
            `改法：调深/调亮 tailwind.config.js 里该 token（不要改这条门槛）。`,
        ).toBeGreaterThanOrEqual(rule.min)
      })
    }
  }

  it('主按钮的白字对 primary-600 底色有足够对比度', () => {
    const ratio = contrast('#FFFFFF', colorOf('primary', '600'))
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(4.5)
  })

  it('.notice-error / .notice-uncertain / .notice-success 的文字在本方浅底上达标', () => {
    const pairs: [string, string, string][] = [
      ['danger-700 on danger-100', colorOf('danger', '700'), colorOf('danger', '100')],
      ['accent-700 on accent-100', colorOf('accent', '700'), colorOf('accent', '100')],
      ['success-700 on success-100', colorOf('success', '700'), colorOf('success', '100')],
      ['primary-800 on primary-50', colorOf('primary', '800'), colorOf('primary', '50')],
    ]
    for (const [label, foreground, background] of pairs) {
      const ratio = contrast(foreground, background)
      expect(Number(ratio.toFixed(2)), `${label} 只有 ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('三级文字色仍明显轻于二级，层级没有被"调深"抹平', () => {
    const faint = luminance(colorOf('ink', 'faint'))
    const soft = luminance(colorOf('ink', 'soft'))
    const ink = luminance(colorOf('ink'))
    // 顺序必须是 ink 最深 → ink-soft → ink-faint 最浅（亮度越大越浅）
    expect(ink).toBeLessThan(soft)
    expect(soft).toBeLessThan(faint)
  })

  it('浅色表面本身足够亮、深色面板本身足够暗（避免"浅色页"用到深底 token）', () => {
    // paper 应该明显亮于 navy-800：两者被混用时，任何一组文字门槛都会失效
    expect(luminance(colorOf('paper'))).toBeGreaterThan(0.8)
    expect(luminance(colorOf('navy', '800'))).toBeLessThan(0.03)
  })
})
