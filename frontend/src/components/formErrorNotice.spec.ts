// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FormErrorNotice from '@/components/FormErrorNotice.vue'
import type { ErrorDisplay } from '@/api/v3'

/**
 * `FormErrorNotice` 的字段契约（A38）。
 *
 * <p>为什么要给一个"纯展示"组件写测试：A38 的缺陷不是某一页写错了一句话，
 * 而是那段提示块被**逐字抄了 8 份**、抄的时候各有增减 —— 账号页的五个表单都漏掉了
 * 「服务器说明」，于是服务端给的精确说法"当前密码不正确。"被丢掉，
 * 用户看到的是给登录页写的映射文案「用户名或密码不对」，而这几个表单里根本没有用户名字段。
 *
 * <p>所以这里钉的不是"能渲染出红色块"，而是**字段集合**：少一个字段就应该是红的，
 * 而不是某个页面上少一句准确的话。
 */
function display(overrides: Partial<ErrorDisplay> = {}): ErrorDisplay {
  return {
    message: '当前密码不对，请重新输入。',
    serverMessage: null,
    fields: [],
    retryAfterSeconds: null,
    requestId: null,
    code: 'INVALID_CREDENTIALS',
    sessionExpired: false,
    ...overrides,
  }
}

describe('FormErrorNotice', () => {
  it('渲染主文案与字段提示', () => {
    const wrapper = mount(FormErrorNotice, {
      props: {
        error: display({
          message: '有几项没填对。',
          fields: [
            { field: 'username', label: '用户名', message: '不能是空白' },
            { field: 'password', label: '密码', message: '至少 8 位' },
          ],
        }),
      },
    })

    expect(wrapper.text()).toContain('有几项没填对。')
    expect(wrapper.text()).toContain('用户名：不能是空白')
    expect(wrapper.text()).toContain('密码：至少 8 位')
    // 这是 A38 的核心：服务端的原话必须露出来
    expect(wrapper.text()).not.toContain('服务器说明')
  })

  it('服务端原文单独一行显示（A38：账号页曾经把它整段丢掉）', () => {
    const wrapper = mount(FormErrorNotice, {
      props: {
        error: display({
          message: '输入的信息不对，请检查后重试。',
          serverMessage: '当前密码不正确。',
        }),
      },
    })

    expect(wrapper.text()).toContain('服务器说明：当前密码不正确。')
  })

  it('限流秒数与报障编号都要显示，编号给全且带"反馈时带上它"的说明', () => {
    const wrapper = mount(FormErrorNotice, {
      props: {
        error: display({
          message: '操作太频繁了。',
          retryAfterSeconds: 42,
          requestId: 'req-0123456789abcdef',
        }),
      },
    })

    expect(wrapper.text()).toContain('大约 42 秒后再试就来得及。')
    expect(wrapper.text()).toContain('req-0123456789abcdef')
    expect(wrapper.text()).toContain('反馈问题时把这个编号一起发过来')
  })

  it('requestHint=false 时只留编号本身（排版更紧的场合）', () => {
    const wrapper = mount(FormErrorNotice, {
      props: {
        error: display({ requestId: 'req-abc' }),
        requestHint: false,
      },
    })

    expect(wrapper.text()).toContain('req-abc')
    expect(wrapper.text()).not.toContain('反馈问题时把这个编号一起发过来')
  })

  it('是 assertive 的告警区域，并把外部传进来的 data-* 钩子合并到根元素', () => {
    const wrapper = mount(FormErrorNotice, {
      props: { error: display({ message: '失败了。' }) },
      attrs: { class: 'mt-3', 'data-account-error-password': '' },
    })

    const root = wrapper.get('div')
    expect(root.attributes('role')).toBe('alert')
    expect(root.attributes('aria-live')).toBe('assertive')
    // 页面靠这个钩子定位"这一段的失败提示"，丢了这个属性页面上的错误就找不到位置
    expect(root.attributes('data-account-error-password')).toBeDefined()
    expect(root.classes()).toContain('notice-error')
    expect(root.classes()).toContain('mt-3')
  })
})
