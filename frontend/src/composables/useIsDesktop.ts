import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 是否处于「桌面宽度」（≥ 768px，即 Tailwind 的 `md:`）。
 *
 * 用途：答题页的「选中即自动跳题」是移动端推导（审查 IM-8）——
 * 桌面上一屏能放下更多内容、并且用户可能在复查，所以 `md:` 起关掉自动跳题，
 * 改成显式点「下一题」。
 *
 * 用 `matchMedia` + `addEventListener`（不用 CSS 断点）是因为这个决策在 JS 里，
 * 必须和 CSS 断点用同一个阈值；环境不支持 `matchMedia`（jsdom / 老浏览器）时
 * 视为移动端，保持原有的自动跳题行为。
 */
export const DESKTOP_QUERY = '(min-width: 768px)'

export function useIsDesktop() {
  const isDesktop = ref(false)

  let query: MediaQueryList | null = null
  const onChange = (event: MediaQueryListEvent) => {
    isDesktop.value = event.matches
  }

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    query = window.matchMedia(DESKTOP_QUERY)
    isDesktop.value = query.matches
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
    } else if (typeof (query as MediaQueryList).addListener === 'function') {
      ;(query as MediaQueryList).addListener(onChange)
    }
  })

  onBeforeUnmount(() => {
    if (!query) return
    if (typeof query.removeEventListener === 'function') {
      query.removeEventListener('change', onChange)
    } else if (typeof (query as MediaQueryList).removeListener === 'function') {
      ;(query as MediaQueryList).removeListener(onChange)
    }
    query = null
  })

  return isDesktop
}
