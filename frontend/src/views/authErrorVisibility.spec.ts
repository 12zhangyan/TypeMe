// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import LoginView from '@/views/LoginView.vue'
import RegisterView from '@/views/RegisterView.vue'
import { V3ApiError } from '@/api/v3'

/**
 * 登录页与注册页的失败提示必须真的显示出来。
 *
 * 真实浏览器里发现的缺陷：这两页的模板里有 `<FormErrorNotice>`，脚本里却没有 import，
 * Vue 把它当成未知的自定义元素渲染成一个空标签 —— 密码错、邀请码无效、被限流时
 * 用户点了按钮什么都没发生。旧用例只断言「有 `[data-login-error]` 这个元素」，
 * 空标签也满足，所以一直没拦住。这里断言的是用户能读到的文字与报障编号。
 */

const loginAccount = vi.fn()
const registerAccount = vi.fn()

vi.mock('@/api/v3', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3')>('@/api/v3')
  return {
    ...actual,
    loginAccount: (...args: unknown[]) => loginAccount(...args),
    registerAccount: (...args: unknown[]) => registerAccount(...args),
    refreshCsrfToken: () => Promise.resolve(null),
  }
})

function rejection(code: string, message: string, status: number, extra: Record<string, unknown> = {}) {
  return new V3ApiError({ code, message, requestId: 'rq-visible-1', details: extra }, { status })
}

async function mountView(component: unknown, path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: component as never },
      { path: '/register', name: 'register', component: component as never },
      { path: '/recover', name: 'recover', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as never, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

describe('登录页 / 注册页 · 失败提示可见', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    loginAccount.mockReset()
    registerAccount.mockReset()
  })

  it('登录失败：显示服务端口径的文案和报障编号，而且是一个真实渲染的提示块', async () => {
    loginAccount.mockRejectedValue(rejection('INVALID_CREDENTIALS', '用户名或密码不正确。', 401))
    const wrapper = await mountView(LoginView, '/login')

    await wrapper.find('input[name=username]').setValue('someone')
    await wrapper.find('input[name=password]').setValue('wrong-password')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const notice = wrapper.get('[data-login-error]')
    expect(notice.element.tagName).toBe('DIV')
    expect(notice.attributes('role')).toBe('alert')
    expect(notice.text()).toContain('rq-visible-1')
    expect(notice.text().replace(/\s+/g, '')).not.toBe('')
  })

  it('登录被限流：告诉用户要等多久，而不是毫无反应', async () => {
    loginAccount.mockRejectedValue(
      rejection('RATE_LIMITED', '该账号的登录尝试过于频繁，请稍后再试。', 429, { retryAfterSeconds: 365 }),
    )
    const wrapper = await mountView(LoginView, '/login')

    await wrapper.find('input[name=username]').setValue('someone')
    await wrapper.find('input[name=password]').setValue('whatever-1')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const text = wrapper.get('[data-login-error]').text()
    expect(text).toContain('太频繁')
    expect(text).toContain('365')
  })

  it('注册失败：邀请码无效之类的原因显示在表单里', async () => {
    registerAccount.mockRejectedValue(rejection('VALIDATION_FAILED', '邀请码无效、已使用、已撤销或已过期，请联系管理员。', 400))
    const wrapper = await mountView(RegisterView, '/register')

    await wrapper.find('input[name=invitationCode]').setValue('a'.repeat(32))
    await wrapper.find("input[name='username']").setValue('zhangsan')
    await wrapper.find("input[name='new-password']").setValue('GoodPassw0rd!')
    await wrapper.find("input[name='confirm-password']").setValue('GoodPassw0rd!')
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await flushPromises()
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const notice = wrapper.get('[data-register-error]')
    expect(notice.element.tagName).toBe('DIV')
    expect(notice.text()).toContain('rq-visible-1')
    expect(notice.text().replace(/\s+/g, '')).not.toBe('')
  })
})
