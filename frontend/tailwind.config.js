/** @type {import('tailwindcss').Config} */
/**
 * 设计变量（`docs/2026-09-15/TypeMe-整体体验重构开发文档.md` §4.2）
 *
 * 三个语义角色固定，页面不再自由发挥颜色：
 *   paper  奶白 —— 页面背景 / 次级表面
 *   ink    墨蓝 —— 主文字、主色、焦点
 *   accent 杏橙 —— 仅用于少量序号、图形与提示
 *
 * `shell-*` 是**每页各自的容器上限**（文档 §4.3）：
 *   shell-quiz    答题页 1120px
 *   shell-result  结果页 1200px（正文 760 + 目录 240）
 *   shell-wide    首页 1200px
 *   prose-result  结果正文栏 760px（避免把长段落拉成超长行）
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F7F6F2',
          soft: '#EEEDE7',
          deep: '#E5E3DB',
        },
        surface: {
          DEFAULT: '#FFFFFF',
          soft: '#FBFAF7',
        },
        ink: {
          DEFAULT: '#1D2D3A',
          soft: '#52616B',
          faint: '#7C8892',
        },
        primary: {
          50: '#EDF2F6',
          100: '#DCE6EE',
          200: '#BFD0DE',
          300: '#94AFC6',
          400: '#5E86A6',
          500: '#3A6488',
          600: '#264E70',
          700: '#1D3C57',
          800: '#162E43',
        },
        accent: {
          50: '#FCF2EC',
          100: '#FAEDE5',
          200: '#F0D2C2',
          300: '#DFA98D',
          400: '#C97A54',
          500: '#B85332',
          600: '#9C4527',
          700: '#7D3B26',
        },
        line: {
          DEFAULT: '#DCDDD7',
          soft: '#E8E8E2',
          strong: '#C4C6BD',
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
      },
      maxWidth: {
        /** 答题页 / 结果页可读正文栏 */
        prose: '38rem',
        'prose-result': '47.5rem',
        'shell-quiz': '70rem',
        'shell-result': '75rem',
        'shell-wide': '75rem',
        'shell-article': '48rem',
      },
      screens: {
        /** 平板：答题卡转为抽屉外的单列，结果可带目录 */
        tablet: '768px',
        /** 笔记本：两栏布局起点 */
        laptop: '1024px',
        /** 桌面：首页/结果页最大舒展宽度 */
        desktop: '1440px',
      },
      borderRadius: {
        control: '12px',
        question: '20px',
        cover: '24px',
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
      },
      animation: {
        'fade-rise': 'fade-rise 180ms ease-out both',
        'fade-in': 'fade-in 140ms ease-out both',
        'sheet-up': 'sheet-up 160ms ease-out both',
      },
    },
  },
  plugins: [],
}
