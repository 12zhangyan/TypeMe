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
const fetchCaptcha = vi.fn()

vi.mock('@/api/v3', () => ({
  registerAccount: (...args: unknown[]) => registerAccount(...args),
  fetchCaptcha: (...args: unknown[]) => fetchCaptcha(...args),
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

async function mountRegister(attachToDocument = false) {
  const router = makeRouter()
  await router.push('/register')
  await router.isReady()
  const wrapper = mount(RegisterView, {
    attachTo: attachToDocument ? document.body : undefined,
    global: { plugins: [router] },
  })
  await flushPromises()
  return { wrapper, router }
}

async function fillValidForm(wrapper: ReturnType<typeof mount>) {
  await wrapper.find("input[name=captchaAnswer]").setValue('ab7k2')
  await wrapper.find("input[name='username']").setValue('zhangsan')
  await wrapper.find("input[name='new-password']").setValue('GoodPassw0rd!')
  await wrapper.find("input[name='confirm-password']").setValue('GoodPassw0rd!')
  await flushPromises()
}

describe('注册页：免责声明同意项', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    registerAccount.mockReset()
    fetchCaptcha.mockReset()
    fetchCaptcha.mockResolvedValue({ token: 'tok-1', image: 'data:image/png;base64,AAAA', expiresInSeconds: 180 })
    registerAccount.mockResolvedValue({
      profile: { userId: 'u1', username: 'zhangsan', nickname: null, role: 'USER' },
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
      recoveryCodePolicyVersion: 'typeme-recovery-code-v1',
    })
  })

  it('进入页面就取验证码并显示图片；不再要求邀请码', async () => {
    const { wrapper } = await mountRegister()
    expect(fetchCaptcha).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-captcha-image]').attributes('src')).toBe('data:image/png;base64,AAAA')
    expect(wrapper.find('input[name=invitationCode]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('邀请码')
  })

  it('没填验证码不能提交，并说明原因；同时说明管理员可查看的范围', async () => {
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await wrapper.find('input[name=captchaAnswer]').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(registerAccount).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请输入图片里的验证码')
    expect(wrapper.text()).toContain('管理员可查看账号状态、测评进度和报告')
    expect((wrapper.find("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)
  })

  it('提交时带上令牌和用户填的答案', async () => {
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    const payload = registerAccount.mock.calls[0]![0] as Record<string, unknown>
    expect(payload['captchaToken']).toBe('tok-1')
    expect(payload['captchaAnswer']).toBe('ab7k2')
    expect(payload).not.toHaveProperty('invitationCode')
  })

  it('提交失败后自动换一张新验证码并清空答案（旧码已被服务端消耗）', async () => {
    registerAccount.mockRejectedValue(new Error('boom'))
    fetchCaptcha
      .mockResolvedValueOnce({ token: 'tok-1', image: 'data:image/png;base64,AAAA', expiresInSeconds: 180 })
      .mockResolvedValueOnce({ token: 'tok-2', image: 'data:image/png;base64,BBBB', expiresInSeconds: 180 })
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetchCaptcha).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-captcha-image]').attributes('src')).toBe('data:image/png;base64,BBBB')
    expect((wrapper.get('input[name=captchaAnswer]').element as HTMLInputElement).value).toBe('')
    // 用户名等其它字段保留，不让人重填整张表
    expect((wrapper.get("input[name='username']").element as HTMLInputElement).value).toBe('zhangsan')
    expect((wrapper.get("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)
  })

  it('验证码加载失败：显示原因、不能提交，点「换一张」可重试', async () => {
    fetchCaptcha.mockRejectedValueOnce(new Error('network'))
    const { wrapper } = await mountRegister()
    await fillValidForm(wrapper)
    await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
    expect(wrapper.find('[data-captcha-error]').exists()).toBe(true)
    expect(wrapper.find('[data-captcha-image]').exists()).toBe(false)
    expect(wrapper.text()).toContain('验证码没有加载出来')
    expect((wrapper.get("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-captcha-refresh]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-captcha-error]').exists()).toBe(false)
    expect(wrapper.find('[data-captcha-image]').exists()).toBe(true)
  })

  it('验证码过期后标记为已过期并禁止提交，不悄悄换图', async () => {
    vi.useFakeTimers()
    try {
      fetchCaptcha.mockResolvedValue({ token: 'tok-1', image: 'data:image/png;base64,AAAA', expiresInSeconds: 30 })
      const { wrapper } = await mountRegister()
      await fillValidForm(wrapper)
      await wrapper.find("input[name='disclaimer-accepted']").setValue(true)
      expect((wrapper.get("button[type='submit']").element as HTMLButtonElement).disabled).toBe(false)

      await vi.advanceTimersByTimeAsync(26_000)
      await flushPromises()
      expect(fetchCaptcha).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[data-captcha-image]').exists()).toBe(false)
      expect(wrapper.text()).toContain('验证码已过期')
      expect((wrapper.get("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)
      // 用户正在输入的答案不被清掉
      expect((wrapper.get('input[name=captchaAnswer]').element as HTMLInputElement).value).toBe('ab7k2')
    } finally {
      vi.useRealTimers()
    }
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

  it('表单还没填完时，点灰色的创建账号不会提交，而是把挡住的那一格聚焦', async () => {
    const { wrapper } = await mountRegister(true)
    const blocked = wrapper.get('[data-register-blocked]')
    const input = wrapper.get("input[name='username']")
    await blocked.trigger('click')
    expect(registerAccount).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input.element)
    expect((wrapper.get("button[type='submit']").element as HTMLButtonElement).disabled).toBe(true)
    wrapper.unmount()
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
