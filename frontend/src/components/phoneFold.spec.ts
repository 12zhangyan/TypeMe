// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import PhoneFold from '@/components/PhoneFold.vue'

type Listener = () => void

function stubViewport(wide: boolean) {
  const listeners = new Set<Listener>()
  const query = {
    matches: wide,
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    resize(nextWide: boolean) {
      query.matches = nextWide
      for (const fn of listeners) fn()
    },
    listeners,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PhoneFold：手机收起、平板及以上展开', () => {
  it('手机宽度：初始收起，但内容仍在 DOM 里（读屏与搜索能读到）', async () => {
    stubViewport(false)
    const wrapper = mount(PhoneFold, { props: { summary: '更多说明' }, slots: { default: '<p data-inside>正文</p>' } })
    await nextTick()
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(false)
    expect(wrapper.find('[data-inside]').exists()).toBe(true)
    expect(wrapper.get('summary').text()).toContain('更多说明')
    expect(wrapper.get('summary').text()).toContain('展开')
  })

  it('平板及以上：展开，且摘要行带 tablet:hidden（桌面不出现可收起的控件）', async () => {
    stubViewport(true)
    const wrapper = mount(PhoneFold, { props: { summary: '更多说明' } })
    await nextTick()
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(true)
    expect(wrapper.get('summary').classes()).toContain('tablet:hidden')
  })

  it('没有 matchMedia：按展开处理，内容不会因环境缺失而读不到', async () => {
    vi.stubGlobal('matchMedia', undefined)
    const wrapper = mount(PhoneFold, { props: { summary: '更多说明' } })
    await nextTick()
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(true)
  })

  it('跨过断点时跟着变，卸载时摘掉监听', async () => {
    const viewport = stubViewport(false)
    const wrapper = mount(PhoneFold, { props: { summary: '更多说明' } })
    await nextTick()
    expect(viewport.listeners.size).toBe(1)

    viewport.resize(true)
    await nextTick()
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(true)

    wrapper.unmount()
    expect(viewport.listeners.size).toBe(0)
  })
})
