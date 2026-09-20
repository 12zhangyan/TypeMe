// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import IllustrationFrame from './IllustrationFrame.vue'

const { asset } = vi.hoisted(() => ({ asset: vi.fn() }))
vi.mock('@/design/illustrationAssets', () => ({ illustrationAsset: asset }))

interface Deferred { promise: Promise<void>; resolve: () => void; reject: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => {}
  let reject: () => void = () => {}
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

/**
 * 图片帧的加载状态：这些用例断言的是**用户能看到的结果**（是否 ready、是否落到兜底、
 * 晚到的旧回调会不会改写当前选择），不是 CSS 透明度的形式。
 */
describe('插画帧：占位、淡入、失败与换图竞态', () => {
  let decodes: Deferred[] = []

  beforeEach(() => {
    decodes = []
    asset.mockReset()
    asset.mockImplementation((name: string) => `/${name}.webp`)
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: vi.fn(() => {
        const pending = deferred()
        decodes.push(pending)
        return pending.promise
      }),
    })
  })

  afterEach(() => {
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode
    vi.useRealTimers()
  })

  it('加载中先用占位尺寸，解码完成后才淡入，全程不拿兜底 SVG 顶替', async () => {
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.attributes('data-artwork-source')).toBe('image')
    expect(wrapper.find('[data-fallback]').exists()).toBe(false)

    await wrapper.get('img').trigger('load')
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.get('img').classes()).not.toContain('is-revealed')

    decodes[0].resolve()
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
    expect(wrapper.get('img').classes()).toContain('is-revealed')
  })

  it('解码失败按失败处理：退出加载态、显示兜底，换图后能恢复', async () => {
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })
    await wrapper.get('img').trigger('load')
    decodes[0].reject()
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('fallback')
    expect(wrapper.attributes('data-artwork-source')).toBe('vector')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-fallback]').exists()).toBe(true)

    await wrapper.setProps({ name: 'type-intj' })
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.get('img').attributes('src')).toBe('/type-intj.webp')
  })

  it('换图后旧资源的解码回调无权把新选择标成 ready', async () => {
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    await wrapper.get('img').trigger('load')
    await wrapper.setProps({ name: 'type-intj' })
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    await wrapper.get('img').trigger('load')

    decodes[0].resolve()
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.get('img').attributes('src')).toBe('/type-intj.webp')

    decodes[1].resolve()
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
  })

  it('已在内存缓存里的图片插入当帧直接显示，不闪占位也不为动画再解码一次', async () => {
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    const img = wrapper.get('img').element as HTMLImageElement
    Object.defineProperty(img, 'complete', { configurable: true, value: true })
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 640 })

    await wrapper.setProps({ name: 'type-intj' })
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
    expect(wrapper.get('img').classes()).toContain('is-revealed')
    expect(decodes).toHaveLength(0)
  })

  it('decode 迟迟不落地也会退出加载态，不会让内容一直空着', async () => {
    vi.useFakeTimers()
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    await wrapper.get('img').trigger('load')
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
  })

  it('组件卸载后未完成的解码与定时器不再改写状态', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    await wrapper.get('img').trigger('load')
    wrapper.unmount()
    decodes[0].resolve()
    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    warn.mockRestore()
    error.mockRestore()
  })
})
