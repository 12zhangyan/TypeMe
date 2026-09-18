// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PlatformIntro from './PlatformIntro.vue'
import type { InstrumentCard } from '@/api/platformV3'

const { fetchInstruments } = vi.hoisted(() => ({ fetchInstruments: vi.fn() }))
vi.mock('@/api/platformV3', async () => ({
  ...await vi.importActual<typeof import('@/api/platformV3')>('@/api/platformV3'), fetchInstruments,
}))
const card = (slug: string, hasTypeCode: boolean): InstrumentCard => ({
  slug, kind: hasTypeCode ? 'jung' : 'big_five', title: hasTypeCode ? '十六型参考' : '大五倾向',
  tagline: '示例', summary: '说明这次作答的倾向', whatYouLearn: ['倾向'], notFor: ['诊断'],
  format: hasTypeCode ? 'bipolar' : 'agreement', hasTypeCode, supportsClarification: hasTypeCode,
  dimensions: hasTypeCode ? ['EI', 'SN', 'TF', 'JP'] : ['E', 'A', 'C', 'ES', 'O'],
  defaultPackageId: 'fixture', baseItemCount: hasTypeCode ? 48 : 50,
  clarificationItemCount: hasTypeCode ? 16 : 0, maxClarificationItems: hasTypeCode ? 16 : 0,
  estimatedMinutes: 10, contentStatus: 'draft_review_pending',
})
const render = () => mount(PlatformIntro, { global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })

describe('多量表首页入口', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })
  it('题数与入口按服务端每项量表绑定，不把大五写成四字母', async () => {
    fetchInstruments.mockResolvedValue([card('jung48', true), card('bigfive50', false)])
    const wrapper = render()
    await flushPromises()
    const cards = wrapper.findAll('[data-home-instruments] > li')
    expect(cards).toHaveLength(2)
    expect(cards[0]!.text()).toContain('48 题，最多 16 道补充题')
    expect(cards[1]!.text()).toContain('50 题')
    expect(cards[1]!.text()).toContain('没有类型和总分')
    expect(cards[1]!.get('a').attributes('href')).toBe('/assess?instrument=bigfive50')
  })
  it('失败时能重试，空目录不编造测评卡片', async () => {
    fetchInstruments.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.find('[role=alert]').exists()).toBe(true)
    await wrapper.get('[role=alert] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('暂时没有可开始的测评')
    expect(wrapper.find('[data-home-instruments]').exists()).toBe(false)
  })
})
