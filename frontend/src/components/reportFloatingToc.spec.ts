// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ReportFloatingToc from '@/components/ReportFloatingToc.vue'

const ITEMS = [
  { id: 'report-overview', label: '结果概览' },
  { id: 'report-dimensions', label: '四个维度' },
  { id: 'report-method', label: '这份报告是怎么来的' },
]

function setScroll(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
}

async function scrollTo(y: number) {
  setScroll(y)
  window.dispatchEvent(new Event('scroll'))
  // requestAnimationFrame 在 jsdom 里是定时器
  await new Promise((resolve) => setTimeout(resolve, 30))
  await nextTick()
}

afterEach(() => {
  setScroll(0)
  vi.restoreAllMocks()
})

describe('报告页悬浮目录（手机）', () => {
  it('还在页首时不出现；滚过目录之后才出现', async () => {
    setScroll(0)
    const wrapper = mount(ReportFloatingToc, { props: { items: ITEMS }, attachTo: document.body })
    expect(wrapper.find('[data-report-float-toc]').exists()).toBe(false)

    await scrollTo(900)
    expect(wrapper.find('[data-report-float-toc]').exists()).toBe(true)

    await scrollTo(10)
    expect(wrapper.find('[data-report-float-toc]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('点开后列出父级给的每一节，选一节就通知父级跳转并收起', async () => {
    setScroll(900)
    const wrapper = mount(ReportFloatingToc, { props: { items: ITEMS }, attachTo: document.body })
    await nextTick()
    const trigger = wrapper.get('button[aria-expanded]')
    expect(trigger.attributes('aria-expanded')).toBe('false')

    await trigger.trigger('click')
    expect(trigger.attributes('aria-expanded')).toBe('true')
    const labels = wrapper.findAll('[data-float-toc]').map((node) => node.text())
    expect(labels).toEqual(ITEMS.map((item) => item.label))

    await wrapper.get('[data-float-toc="report-dimensions"]').trigger('click')
    expect(wrapper.emitted('jump')).toEqual([['report-dimensions']])
    expect(wrapper.find('[data-float-toc]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('Esc 收起并把焦点还给触发按钮', async () => {
    setScroll(900)
    const wrapper = mount(ReportFloatingToc, { props: { items: ITEMS }, attachTo: document.body })
    await nextTick()
    await wrapper.get('button[aria-expanded]').trigger('click')
    expect(wrapper.find('[data-float-toc]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    await nextTick()

    expect(wrapper.find('[data-float-toc]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('button[aria-expanded]').element)
    wrapper.unmount()
  })

  it('没有可列的区块时不渲染（不给一个点开是空的入口）', async () => {
    setScroll(900)
    const wrapper = mount(ReportFloatingToc, { props: { items: [] }, attachTo: document.body })
    expect(wrapper.find('[data-report-float-toc]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('卸载后不再监听滚动（不泄漏监听器）', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const wrapper = mount(ReportFloatingToc, { props: { items: ITEMS } })
    wrapper.unmount()
    expect(remove.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(['scroll', 'keydown']))
  })
})
