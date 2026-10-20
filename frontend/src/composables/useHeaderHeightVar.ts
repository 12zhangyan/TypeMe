import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * 把粘性顶栏的实际高度写进全站的 `--header-h`（A154）。
 *
 * 顶栏内容 `flex-wrap`，导航项又随登录状态和管理员身份增减：同是 320 宽，
 * 未登录约 109px、管理员约 153px，桌面约 77px。CSS 里写死的 60/64px 总是偏小，
 * 依赖 `scroll-margin-top: calc(var(--header-h) + …)` 的页内跳转会把标题落到顶栏下面。
 *
 * 环境不支持 `ResizeObserver`（jsdom / 老浏览器）时不写，沿用 `style.css` 的默认值。
 */
export const HEADER_HEIGHT_VAR = '--header-h'

export function useHeaderHeightVar(header: Ref<HTMLElement | null>) {
  let observer: ResizeObserver | null = null

  function write() {
    const el = header.value
    if (!el) return
    document.documentElement.style.setProperty(HEADER_HEIGHT_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`)
  }

  onMounted(() => {
    if (!header.value || typeof ResizeObserver !== 'function') return
    observer = new ResizeObserver(write)
    observer.observe(header.value)
    write()
  })

  onBeforeUnmount(() => {
    if (!observer) return
    observer.disconnect()
    observer = null
    document.documentElement.style.removeProperty(HEADER_HEIGHT_VAR)
  })
}
