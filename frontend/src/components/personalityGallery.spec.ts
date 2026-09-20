// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PersonalityGallery from './PersonalityGallery.vue'
import PersonalityPortrait from './PersonalityPortrait.vue'
import IllustrationFrame from './IllustrationFrame.vue'
import { useIllustrationAssetsStore } from '@/stores/illustrationAssetsV3'
import portraits from '@/design/personalityPortraits.json'

const { asset } = vi.hoisted(() => ({ asset: vi.fn() }))
vi.mock('@/design/illustrationAssets', () => ({ illustrationAsset: asset, illustrationLocalFallback: () => undefined }))

describe('人格插画：装饰与结果分开', () => {
  beforeEach(() => {
    // 插画帧要读"地址表是不是已经有结论"（`stores/illustrationAssetsV3`），
    // 因此挂载前必须有一个 active pinia；这里直接置成"已经有了结"，与真实页面同形。
    setActivePinia(createPinia())
    useIllustrationAssetsStore().status = 'ready'
  })

  it('提供全部 16 型，可切换生活速写，明确不是测评结果', async () => {
    asset.mockReturnValue(undefined)
    const wrapper = mount(PersonalityGallery, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
    expect(new Set(portraits.map(item => item.code)).size).toBe(16)
    expect(wrapper.findAll('.portrait-picker button')).toHaveLength(16)
    await wrapper.get('button[aria-label^="INTJ，"]').trigger('click')
    expect(wrapper.get('.portrait-spotlight h3').text()).toBe('路线绘制者')
    expect(wrapper.findAll('button[aria-pressed="true"]')).toHaveLength(1)
    expect(wrapper.get('.portrait-spotlight').text()).toContain('不是测评结果')
    expect(wrapper.text()).toContain('不决定职业、性别或能力')
  })
  it('未知或平分代码不随意选择一个人物', () => {
    expect(mount(PersonalityPortrait, { props: { code: 'TIED' } }).find('svg').exists()).toBe(false)
    expect(mount(PersonalityPortrait, { props: { code: 'XXXX' } }).find('img').exists()).toBe(false)
  })
  it('未交付图片时不请求缺失文件，交付后读取图片，失败回退且换图可恢复', async () => {
    asset.mockReturnValue(undefined)
    const fallback = mount(IllustrationFrame, { props: { name: 'home-hero' }, slots: { default: '<svg data-fallback />' } })
    expect(fallback.find('img').exists()).toBe(false)
    expect(fallback.find('[data-fallback]').exists()).toBe(true)
    asset.mockReturnValue('/synthetic-image.webp')
    const wrapper = mount(IllustrationFrame, { props: { name: 'type-infp', alt: '合成插画' }, slots: { default: '<svg data-fallback />' } })
    expect(wrapper.get('img').attributes('alt')).toBe('合成插画')
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-fallback]').exists()).toBe(true)
    await wrapper.setProps({ name: 'type-intj' })
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(true)
  })
})
