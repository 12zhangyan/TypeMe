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
