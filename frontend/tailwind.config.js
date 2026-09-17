/** @type {import('tailwindcss').Config} */
/**
 * TypeMe 设计变量 v2 —— 「人格探索」视觉系统（2026-09-18 视觉重构轮）。
 *
 * ## 这一版和上一版的区别
 *
 * 上一版是"奶白纸感 + 墨蓝 + 杏橙"的温润阅读风格（`paper #F7F6F2` /
 * `ink #1D2D3A` / `accent #B04E2E`）。本轮按
 * `docs/DSH-前端视觉重构与AI体验目标.md` 换成：
 *
 *   - **清爽的浅色阅读表面**：`paper` 换成偏冷的近白（#F4F6F9），
 *     中文长文阅读时不发黄、和深色区域对比更强；
 *   - **深墨色文字**：`ink` 换成更深的藏青墨（#0D1B2A），标题更有力量；
 *   - **克制的蓝青强调**：`primary` 从灰蓝换成蓝青（#14617A 一档），
 *     承担链接、主按钮、进度、选中态；
 *   - **琥珀色只做"注意/不确定"**：`accent` 从砖红换成琥珀，
 *     不再与主色抢注意力；
 *   - **新增 `navy` / `glow`**：首页主视觉与 AI 洞察区的深海军蓝表面 +
 *     光晕，是这一版辨识度的来源。它们**只用于深色区域**，
 *     普通阅读页面仍然是浅色。
 *
 * ## 三条硬约束（改色值前请先读）
 *
 * 1. **可读性由机器守**：每一个"文字可能落在其上"的色值组合都在
 *    `src/design/contrast.spec.ts` 里按 WCAG 公式实算，普通字号 ≥ 4.5:1。
 *    改 token 就会触发它，不要改门槛去迁就色值。
 * 2. **深色区域的对比度是另一套**：`navy-*` 上的文字同样有断言守住。
 * 3. **层级不能被"调深"抹平**：`ink` → `ink-soft` → `ink-faint`
 *    必须保持递增亮度（同样有断言）。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── 浅色阅读表面 ─────────────────────────────────────────────── */
        paper: {
          DEFAULT: '#F4F6F9',
          soft: '#EAEEF3',
          deep: '#DEE4EC',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#F8FAFC',
        },

        /* ── 文字三层 ─────────────────────────────────────────────────── */
        ink: {
          DEFAULT: '#0D1B2A',
          soft: '#48586A',
          /**
           * 三级文字色。承担 `.caption`(13px)、`.fineprint`(12px)、
           * 表单校验原因、保存状态提示等"最需要读到的字"。
           *
           * 实测：paper 5.03:1 / paper-soft 4.68:1 / 白 5.45:1，全部达标；
           * 且仍明显轻于 `ink-soft`（paper 6.74:1），层级没有被抹平。
           * 守卫：`src/design/contrast.spec.ts`。
           */
          faint: '#5B6B7F',
        },

        /* ── 主色：蓝青（链接 / 主按钮 / 进度 / 选中态） ───────────────── */
        primary: {
          50: '#EFF8FB',
          100: '#D8EEF5',
          200: '#AEDCEA',
          300: '#7CC3D8',
          400: '#3F9CBB',
          500: '#1D7A97',
          /** 正文级用途（`.link`、13–15px 主色文字）实测 ≥ 4.5:1 */
          600: '#14617A',
          700: '#0F4E63',
          800: '#0B3D4E',
        },

        /* ── 强调：琥珀，只用于"注意 / 还说不准 / 补充题" ──────────────── */
        accent: {
          50: '#FDF6EC',
          100: '#FAEBD5',
          200: '#F0D3A8',
          300: '#E0B071',
          400: '#A96D14',
          /** 13px 小字级：paper 5.36:1 / paper-soft 4.98:1 */
          500: '#8E5A0F',
          600: '#77490C',
          700: '#5E3A09',
        },

        /* ── 失败 / 危险：真正出错时才用（删除、加载失败） ─────────────── */
        danger: {
          50: '#FEF5F3',
          100: '#FBE5E1',
          200: '#F2C6BF',
          300: '#E29C91',
          400: '#C86A5C',
          500: '#AE4033',
          600: '#95342A',
          700: '#7C2A21',
        },

        /* ── 成功 / 已确认（保存成功、额度可用） ──────────────────────── */
        success: {
          50: '#F0FAF6',
          100: '#DDF2E9',
          200: '#B7E2D2',
          300: '#83CBB2',
          400: '#3FA985',
          500: '#238063',
          600: '#1B6A51',
          700: '#145641',
        },

        /* ── 分割线 ───────────────────────────────────────────────────── */
        line: {
          DEFAULT: '#DDE3EB',
          soft: '#E9EDF3',
          strong: '#C3CCD8',
        },

        /* ── 深海军蓝：首页主视觉 + AI 洞察区（只在深色区域使用） ──────── */
        navy: {
          50: '#E4EFF7',
          100: '#B6D3E6',
          200: '#6E9FC0',
          300: '#3E739B',
          400: '#2A5578',
          500: '#1B3D5A',
          600: '#143049',
          700: '#0E1F30',
          800: '#0B1A28',
          900: '#081320',
        },

        /* ── 光晕 / 轨迹（深色区域里的图形与点缀，不用于正文） ─────────── */
        glow: {
          DEFAULT: '#5AD7E8',
          soft: '#7FE3F0',
          deep: '#2BB3C9',
        },
      },

      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Source Han Sans SC"',
          '"Noto Sans CJK SC"',
          'sans-serif',
        ],
        display: [
          'Georgia',
          '"Times New Roman"',
          '"Songti SC"',
          '"SimSun"',
          'serif',
        ],
        mono: ['"SFMono-Regular"', 'Consolas', '"Liberation Mono"', 'monospace'],
      },

      maxWidth: {
        /** 阅读型正文栏（避免超长行） */
        prose: '38rem',
        'prose-result': '47.5rem',
        'shell-quiz': '70rem',
        'shell-result': '75rem',
        'shell-wide': '82rem',
        'shell-article': '48rem',
      },

      screens: {
        /** 平板：答题卡转为单列，结果可带目录 */
        tablet: '768px',
        /** 笔记本：两栏布点起点 */
        laptop: '1024px',
        /** 桌面：首页 / 结果页最舒展宽度 */
        desktop: '1440px',
      },

      borderRadius: {
        control: '12px',
        card: '16px',
        question: '22px',
        cover: '28px',
        pill: '999px',
      },

      boxShadow: {
        /** 静态卡片：几乎看不见，只用来把白卡从纸面上"抬起来"一点 */
        card: '0 1px 2px rgba(13, 27, 42, 0.04), 0 1px 3px rgba(13, 27, 42, 0.06)',
        /** 悬浮 / 可点卡片 */
        lift: '0 14px 30px -14px rgba(13, 27, 42, 0.22)',
        /** 深色区域投影 */
        deep: '0 30px 70px -30px rgba(8, 19, 32, 0.55)',
        /** 主按钮：用主色投影而不是灰黑 */
        action: '0 10px 24px -12px rgba(20, 97, 122, 0.55)',
        /** 焦点 / 选中态外环 */
        ring: '0 0 0 4px rgba(29, 122, 151, 0.18)',
      },

      keyframes: {
        'fade-rise': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'sheet-up': {
          '0%': { opacity: '0', transform: 'translateY(100%)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        /**
         * 主视觉光晕的极缓慢漂移（22s 一轮、幅度很小）。
         * 作用是让静态的深色区域"活着"，不是让人盯着看；
         * `prefers-reduced-motion` 下由 style.css 统一停掉。
         */
        'glow-drift': {
          '0%, 100%': { opacity: '0.55', transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { opacity: '0.8', transform: 'translate3d(1.5%, -1.5%, 0) scale(1.06)' },
        },
        /** 轨迹虚线缓慢流动：方向感 / 探索感，速度必须慢到不干扰阅读 */
        'trace-flow': {
          '0%': { strokeDashoffset: '0' },
          '100%': { strokeDashoffset: '-160' },
        },
        /** "正在生成"的呼吸点：只表达"还活着"，不表达百分比 */
        breathe: {
          '0%, 100%': { opacity: '0.35', transform: 'scale(0.85)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
        /** 骨架屏的柔和扫光 */
        shimmer: {
          '0%': { backgroundPosition: '-220% 0' },
          '100%': { backgroundPosition: '220% 0' },
        },
      },

      animation: {
        'fade-rise': 'fade-rise 200ms ease-out both',
        'fade-in': 'fade-in 140ms ease-out both',
        'sheet-up': 'sheet-up 160ms ease-out both',
        'glow-drift': 'glow-drift 22s ease-in-out infinite',
        'trace-flow': 'trace-flow 14s linear infinite',
        breathe: 'breathe 1.8s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
}
