// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import RegisterView from '@/views/RegisterView.vue'
import { DISCLAIMER_TEXT } from '@/domain/disclaimerV3'

/**
 * 注册页的免责声明同意项（2026-09-17 新增）。
 *
 * 背景：历史实现里前端**没有**这一项、后端也不读任何 `disclaimer*` 字段，
 * 脚本发的键被静默忽略（`docs/2026-09-16/verification/acceptance-evidence.md` §9.1）。
 * 所以这组用例不测"勾上之后能注册"（那只测到一半），而是把三件事钉死：
 *
 * 1. **未勾选时不能提交** —— 按钮禁用，且点也发不出请求；
 * 2. **勾选状态真的被送出去** —— 断的是请求体里的 `disclaimerAccepted`，
 *    不是断"页面上有个 checkbox"；
 * 3. 勾选框有整句可点的 label（含两个指向 `/about` 的链接），
 *    否则读屏用户只会听到一个孤立的复选框。
 */

const registerAccount = vi.fn()

vi.mock('@/api/v3', () => ({
  registerAccount: (...args: unknown[]) => registerAccount(...args),
  refreshCsrfToken: () => Promise.resolve(null),
  describeError: () => ({
    message: '注册没有成功。',
    serverMessage: null,
    fields: [],
    retryAfterSeconds: null,
    requestId: null,
    code: 'ERROR',
    sessionExpired: false,
  }),
}))

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
    ],
  })
}

async function mountRegister() {
  const router = makeRouter()
  await router.push('/register')
  await router.isReady()
  const wrapper = mount(RegisterView, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

async function fillValidForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("input[name=invitationCode]").setValue("a".repeat(32))
  await wrapper.find("input[name='username']").setValue('zhangsan')
  await wrapper.find("input[name='new-password']").setValue('GoodPassw0rd!')
  await wrapper.find("input[name='confirm-password']").setValue('GoodPassw0rd!')
  await flushPromises()
}

describe('注册页：免责声明同意项', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    registerAccount.mockReset()
    registerAccount.mockResolvedValue({
      profile: { userId: 'u1', username: 'zhangsan', nickname: null, role: 'USER' },
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      recoveryCodePolicyVersion: 'typeme-recovery-code-v1',
    })
  })

  it('没有邀请码不能提交，并明确管理员可查看的范围', async () => {
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await wrapper.find("input[name=invitationCode]").setValue('')
    await wrapper.find('form').trigger('submit')
    expect(registerAccount).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('管理员可查看账号状态、测评进度和报告')
    expect((wrapper.find("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)
  })

  it('默认不勾选：不能提交，且不会静默替用户同意', async () => {
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)

    const checkbox = wrapper.find("input[name='disclaimer-accepted']")
    expect(checkbox.exists()).toBe(true)
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)

    const submit = wrapper.find("button[type='submit']")
    expect((submit.element as HTMLButtonElement).disabled).toBe(true)
    // 顺带说清"为什么不能点"，而不是让用户对着一颗灰按钮猜
    expect(wrapper.text()).toContain('请先勾选')

    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(registerAccount).not.toHaveBeenCalled()
  })

  it('勾选后提交，请求体里带着 disclaimerAccepted: true', async () => {
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await flushPromises()

    const submit = wrapper.find("button[type='submit']")
    expect((submit.element as HTMLButtonElement).disabled).toBe(false)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(registerAccount).toHaveBeenCalledTimes(1)
    const payload = registerAccount.mock.calls[0]![0] as Record<string, unknown>
    expect(payload['disclaimerAccepted']).toBe(true)
    expect(payload['username']).toBe('zhangsan')
  })

  it('label 是整句可点的，并且那句里有两个指向关于页的入口', async () => {
    const { wrapper } = await mountRegister()
    const label = wrapper.find("label[for^='reg-disclaimer-']")
    expect(label.exists()).toBe(true)

    const text = label.text()
    expect(text).toContain(DISCLAIMER_TEXT.before)
    expect(text).toContain(DISCLAIMER_TEXT.limitLink)
    expect(text).toContain(DISCLAIMER_TEXT.dataLink)
    expect(text).toContain(DISCLAIMER_TEXT.after)

    const links = label.findAll('a')
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.attributes('href')).toBe('/about')
    }
  })
})
