// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import IllustrationFrame from './IllustrationFrame.vue'
import { useIllustrationAssetsStore } from '@/stores/illustrationAssetsV3'

const { asset, fallback } = vi.hoisted(() => ({ asset: vi.fn(), fallback: vi.fn() }))
vi.mock('@/design/illustrationAssets', () => ({ illustrationAsset: asset, illustrationLocalFallback: fallback }))

interface Deferred { promise: Promise<void>; resolve: () => void; reject: () => void }

function deferred(): Deferred {
  let resolve: () => void = () => {}
  let reject: () => void = () => {}
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

/**
 * 把地址表 store 置成"已经有结论"（拿到了表 / 确定拿不到 / 等够了）。
 *
 * 组件的行为分两段：地址表还没有结论时只占位（不下载任何图），有结论之后才是
 * 老的"远端 → 本地 → 兜底"链。所以每个用例都要先说明自己在哪一段里。
 */
function settleAddresses(status: 'ready' | 'failed' = 'ready'): void {
  const store = useIllustrationAssetsStore()
  store.status = status
}

/**
 * 图片帧的加载状态：这些用例断言的是**用户能看到的结果**（是否 ready、是否落到兜底、
 * 晚到的旧回调会不会改写当前选择），不是 CSS 透明度的形式。
 */
describe('插画帧：占位、淡入、失败与换图竞态', () => {
  let decodes: Deferred[] = []

  beforeEach(() => {
    decodes = []
    setActivePinia(createPinia())
    asset.mockReset()
    asset.mockImplementation((name: string) => `/${name}.webp`)
    // 默认"没有可回退的本地地址"：地址表里没有这张图时，行为与接入前完全相同。
    fallback.mockReset()
    fallback.mockReturnValue(undefined)
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

  it('地址表还没有结论时只占位：不建 <img>、不拿兜底 SVG 顶替、也不下载任何图', async () => {
    const store = useIllustrationAssetsStore()
    store.status = 'loading'
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })

    expect(wrapper.attributes('data-artwork-state')).toBe('pending')
    expect(wrapper.attributes('data-artwork-source')).toBe('vector')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-fallback]').exists()).toBe(false)

    // 地址表到了（哪怕里面没有这张图）：立刻进入正常的加载态
    store.status = 'ready'
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.get('img').attributes('src')).toBe('/type-infp.webp')
  })

  it('等待预算用尽（或读表失败）后按"地址表里没有这张图"处理，用本地资源', async () => {
    const store = useIllustrationAssetsStore()
    store.status = 'loading'
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    expect(wrapper.find('img').exists()).toBe(false)

    store.waitedOut = true
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.get('img').attributes('src')).toBe('/type-infp.webp')
  })

  it('地址表迟到时不再改用远端：同一张图不付两次下载（本地已渲染的就保持本地）', async () => {
    const store = useIllustrationAssetsStore()
    store.status = 'loading'
    asset.mockImplementation((name: string, urls?: Record<string, string>) => urls?.[name] ?? `/local/${name}.webp`)
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })

    // 等待预算用尽 → 这一帧定在本地
    store.waitedOut = true
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('/local/type-infp.webp')

    // 地址表随后到货：已经渲染过的位置**不**换源（否则本地 + 远端各下一次）
    store.urls = { 'type-infp': 'https://img.example.com/type-infp.webp' }
    store.status = 'ready'
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('/local/type-infp.webp')

    // 同一时刻新出现的位置（换图 = 新的一次渲染）会直接用远端地址
    store.urls = { ...store.urls, 'type-intj': 'https://img.example.com/type-intj.webp' }
    await wrapper.setProps({ name: 'type-intj' })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('https://img.example.com/type-intj.webp')
  })

  it('加载中先用占位尺寸，解码完成后才淡入，全程不拿兜底 SVG 顶替', async () => {
    settleAddresses()
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

  it('解码失败且没有本地资源可退时按失败处理：退出加载态、显示兜底，换图后能恢复', async () => {
    settleAddresses()
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
    settleAddresses()
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
    settleAddresses()
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
    settleAddresses()
    vi.useFakeTimers()
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    await wrapper.get('img').trigger('load')
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    await vi.advanceTimersByTimeAsync(600)
    await nextTick()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
  })

  it('组件卸载后未完成的解码与定时器不再改写状态', async () => {
    settleAddresses()
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

/**
 * 远端地址（对象存储）失败后的一次受控本地回退：`远端 → 本地打包资源 → 兜底 SVG`。
 * 断言的是"用户最终看到了什么"和"最多发了几次请求"，不是内部变量。
 */
describe('插画帧：远端地址失败后的一次受控本地回退', () => {
  const CDN = 'https://img.example.com/illustrations/2026-09-20'

  function useRemote(): void {
    asset.mockImplementation((name: string) => `${CDN}/${name}.4583aa734b96.webp`)
    fallback.mockImplementation((name: string) => `/local-assets/${name}.webp`)
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    settleAddresses()
    asset.mockReset()
    fallback.mockReset()
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: vi.fn(() => Promise.resolve()),
    })
  })

  afterEach(() => {
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode
  })

  it('远端加载失败时改用本地资源，成功后正常淡入', async () => {
    useRemote()
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })
    expect(wrapper.attributes('data-artwork-attempt')).toBe('primary')
    expect(wrapper.get('img').attributes('src')).toBe(`${CDN}/type-infp.4583aa734b96.webp`)

    await wrapper.get('img').trigger('error')
    await nextTick()
    expect(wrapper.attributes('data-artwork-attempt')).toBe('local-fallback')
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.attributes('data-artwork-source')).toBe('image')
    expect(wrapper.get('img').attributes('src')).toBe('/local-assets/type-infp.webp')

    await wrapper.get('img').trigger('load')
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
    expect(wrapper.get('img').classes()).toContain('is-revealed')
  })

  it('远端图加载成功但解码失败时，同样改用本地资源（而不是直接兜底 SVG）', async () => {
    useRemote()
    // 第一张（远端）解码被拒；换成本地那张后解码正常 —— 模拟"HTTP 200 但字节坏了"。
    let decodeCalls = 0
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      writable: true,
      value: vi.fn(() => (++decodeCalls === 1 ? Promise.reject(new Error('decode failed')) : Promise.resolve())),
    })
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })
    expect(wrapper.get('img').attributes('src')).toBe(`${CDN}/type-infp.4583aa734b96.webp`)

    await wrapper.get('img').trigger('load')
    await flushPromises()

    // 关键断言：没有掉到兜底 SVG，而是走了和"网络失败"完全相同的那一次本地回退。
    expect(wrapper.attributes('data-artwork-attempt')).toBe('local-fallback')
    expect(wrapper.attributes('data-artwork-state')).toBe('loading')
    expect(wrapper.attributes('data-artwork-source')).toBe('image')
    expect(wrapper.find('[data-fallback]').exists()).toBe(false)
    expect(wrapper.get('img').attributes('src')).toBe('/local-assets/type-infp.webp')

    await wrapper.get('img').trigger('load')
    await flushPromises()
    expect(wrapper.attributes('data-artwork-state')).toBe('ready')
    expect(wrapper.get('img').classes()).toContain('is-revealed')
  })

  it('本地资源也失败时显示现有兜底，不再发起第三次尝试', async () => {
    useRemote()
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' }, slots: { default: '<svg data-fallback />' } })
    await wrapper.get('img').trigger('error')
    await nextTick()
    await wrapper.get('img').trigger('error')
    await nextTick()

    expect(wrapper.attributes('data-artwork-state')).toBe('fallback')
    expect(wrapper.attributes('data-artwork-source')).toBe('vector')
    // 没有 img 就再也没有可发起请求的元素：这是"不无限重试"的直接保证。
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-fallback]').exists()).toBe(true)

    // 兜底状态下再来的错误事件也不能改变结果（没有回退目标可写）
    expect(wrapper.attributes('data-artwork-attempt')).toBe('local-fallback')
    await nextTick()
    expect(wrapper.attributes('data-artwork-state')).toBe('fallback')
  })

  it('换图后回退状态重置：新图仍先试远端', async () => {
    useRemote()
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp' } })
    await wrapper.get('img').trigger('error')
    await nextTick()
    expect(wrapper.attributes('data-artwork-attempt')).toBe('local-fallback')

    await wrapper.setProps({ name: 'type-intj' })
    await flushPromises()
    expect(wrapper.attributes('data-artwork-attempt')).toBe('primary')
    expect(wrapper.get('img').attributes('src')).toBe(`${CDN}/type-intj.4583aa734b96.webp`)
  })
})
