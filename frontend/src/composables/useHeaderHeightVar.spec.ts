// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { HEADER_HEIGHT_VAR, useHeaderHeightVar } from './useHeaderHeightVar'

let height = 0
const Host = defineComponent({
  setup() {
    const header = ref<HTMLElement | null>(null)
    useHeaderHeightVar(header)
    return () => h('header', { ref: header })
  },
})

function stubRect() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height } as DOMRect))
}

/** jsdom 不解析样式表：用桩声明顶栏当前是吸顶（sticky）还是随页面滚走（static）。 */
function stubPosition(position: 'sticky' | 'static') {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ position } as CSSStyleDeclaration))
}

function readVar() {
  return document.documentElement.style.getPropertyValue(HEADER_HEIGHT_VAR)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.style.removeProperty(HEADER_HEIGHT_VAR)
})

describe('useHeaderHeightVar', () => {
  it('挂载时写入顶栏实际高度，尺寸变化后跟着更新，卸载时移除', () => {
    let notify = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe() {}
      disconnect = disconnect
    })
    stubRect()
    stubPosition('sticky')
    height = 152.4

    const wrapper = mount(Host)
    expect(readVar()).toBe('153px')

    height = 77
    notify()
    expect(readVar()).toBe('77px')

    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(readVar()).toBe('')
  })

  it('手机宽度顶栏不吸顶 → 写 0，页内跳转不必再让出一截；回到吸顶宽度后恢复实际高度', () => {
    let notify = () => {}
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe() {}
      disconnect() {}
    })
    stubRect()
    stubPosition('static')
    height = 109

    const wrapper = mount(Host)
    expect(readVar()).toBe('0px')

    stubPosition('sticky')
    notify()
    expect(readVar()).toBe('109px')
    wrapper.unmount()
  })

  it('没有 ResizeObserver 时不写内联值，沿用样式表默认的 60/64px', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    stubRect()
    height = 153

    const wrapper = mount(Host)
    expect(readVar()).toBe('')
    wrapper.unmount()
    expect(readVar()).toBe('')
  })
})
