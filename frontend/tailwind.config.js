/** @type {import('tailwindcss').Config} */
/**
 * TypeMe 设计变量 v3：暖白、靛蓝与清晰的中文阅读层级。
 * 保留语义 token 名称，让登录、测评、报告与旧页面共享视觉语言。
 * navy / glow 为兼容已有组件保留的深绿表面和浅绿文字 token。
 * 可读性由 src/design/contrast.spec.ts 验证；普通文字对比度门槛不变。
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ── 浅色阅读表面 ─────────────────────────────────────────────── */
        paper: {
          DEFAULT: '#F5F6FB',
          soft: '#ECEEF8',
          deep: '#E0E4F2',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#F8F9FD',
        },

        /* ── 文字三层 ─────────────────────────────────────────────────── */
        ink: {
          DEFAULT: '#1B2038',
          soft: '#424A66',
          faint: '#586079',
        },

        /* ── 主色：森林绿（链接 / 主按钮 / 进度 / 选中态） ───────────────── */
        primary: {
          50: '#EEF0FF',
          100: '#E0E4FF',
          200: '#C3CAFC',
          300: '#9AA6F7',
          400: '#7482EE',
          500: '#5B67E0',
          600: '#4650C8',
          700: '#373FA3',
          800: '#2A307E',
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
          DEFAULT: '#E0E3F0',
          soft: '#EBEDF6',
          strong: '#BFC6DC',
        },

        /* ── 深森林绿：报告概览 + AI 洞察区（只在深色区域使用） ──────── */
        navy: {
          50: '#EEF0FF',
          100: '#CDD3F5',
          200: '#A9B3E8',
          300: '#7F8CD0',
          400: '#5A67B0',
          500: '#3E4A8F',
          600: '#2B3570',
          700: '#1F2859',
          800: '#181F47',
          900: '#111633',
        },

        /* ── 光晕 / 轨迹（深色区域里的图形与点缀，不用于正文） ─────────── */
        glow: {
          DEFAULT: '#FFD2AE',
          soft: '#FFE6D2',
          deep: '#F6B98A',
        },
      },

      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          '"Hiragino Sans GB"',
          '"Source Han Sans SC"',
          '"Noto Sans CJK SC"',
          'sans-serif',
        ],
        display: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"PingFang SC"',
          '"Microsoft YaHei UI"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          'sans-serif',
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
        control: '14px',
        card: '22px',
        question: '24px',
        cover: '32px',
        pill: '999px',
      },

      boxShadow: {
        /** 静态卡片：几乎看不见，只用来把白卡从纸面上"抬起来"一点 */
        card: '0 1px 2px rgba(27, 32, 56, 0.04), 0 4px 14px -6px rgba(54, 64, 140, 0.10)',
        /** 悬浮 / 可点卡片 */
        lift: '0 18px 36px -16px rgba(54, 64, 140, 0.30)',
        /** 深色区域投影 */
        deep: '0 14px 36px -22px rgba(24, 31, 71, 0.45)',
        /** 主按钮：用主色投影而不是灰黑 */
        action: '0 6px 14px -6px rgba(70, 80, 200, 0.45)',
        /** 焦点 / 选中态外环 */
        ring: '0 0 0 4px rgba(91, 103, 224, 0.20)',
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
