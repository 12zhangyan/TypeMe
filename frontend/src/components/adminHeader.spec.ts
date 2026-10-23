// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminHeader from '@/components/AdminHeader.vue'

/** 管理后台两页共用的页头：页签双向可达，当前页用 aria-current 标出。 */
function mountHeader(active: 'members' | 'ai') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin', name: 'admin', component: { template: '<div />' } },
      { path: '/admin/members', name: 'admin-members', component: { template: '<div />' } },
    ],
  })
  return mount(AdminHeader, {
    props: { active, title: '标题', lead: '说明' },
    global: { plugins: [router] },
  })
}

describe('AdminHeader', () => {
  it.each([
    ['members', '/admin/members', '/admin'],
    ['ai', '/admin', '/admin/members'],
  ] as const)('当前页是 %s：它被标为 aria-current，另一页是指向对方的链接', (active, currentHref, otherHref) => {
    const wrapper = mountHeader(active)
    const tabs = wrapper.findAll('[data-admin-tab]')
    expect(tabs).toHaveLength(2)

    const current = tabs.filter((tab) => tab.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]!.attributes('href')).toBe(currentHref)

    const other = tabs.find((tab) => tab.attributes('aria-current') !== 'page')!
    expect(other.attributes('href')).toBe(otherHref)
    expect(wrapper.get('h1').text()).toBe('标题')
    expect(wrapper.text()).toContain('说明')
  })

  it('说明可以用插槽放带强调的文字', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
    const wrapper = mount(AdminHeader, {
      props: { active: 'ai', title: 'T' },
      slots: { lead: '<strong data-lead-strong>当前生效</strong>' },
      global: { plugins: [router] },
    })
    expect(wrapper.find('[data-lead-strong]').exists()).toBe(true)
  })
})
