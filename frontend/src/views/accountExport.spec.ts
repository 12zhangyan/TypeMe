// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import AccountView from '@/views/AccountView.vue'
import { useAuthStore } from '@/stores/auth'
import { resetAdminProbeForTests } from '@/composables/useAdminProbe'

/**
 * 「导出的备份到底完不完整」在**页面上**的说法（2026-09-17 第 15 轮新增）。
 *
 * 这一块的风险很不对称：说"都在里面"而实际不完整，用户会按页面指引
 * （"导出是唯一能把它们带走的办法"）先导出再注销，没导出到的那部分**永久丢失**；
 * 而多说一句"这次不完整"，最坏也只是让用户重导一次。
 *
 * 所以两条分支都要钉住，尤其是"不完整时必须警告" —— 它才是这个修复的目的。
 */

const exportData = vi.fn()

vi.mock('@/api/v3Admin', async () => {
  const actual = await vi.importActual<typeof import('@/api/v3Admin')>('@/api/v3Admin')
  return { ...actual, fetchAdminAiSettings: vi.fn().mockRejectedValue(new Error('not admin')) }
})

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: AccountView },
      { path: '/about', name: 'about', component: { template: '<div />' } },
    ],
  })
}

async function mountAccount() {
  const router = makeRouter()
  await router.push('/account')
  await router.isReady()
  const auth = useAuthStore()
  auth.profile = {
    userId: 'u1',
    username: 'someone',
    nickname: null,
    createdAt: '2026-09-17T00:00:00Z',
    passwordChangedAt: null,
  }
  auth.status = 'authenticated'
  // 直接替换 store 上的导出动作：本测试关心的是"拿到结果之后页面怎么说"，
  // 而不是下载动作本身（那个由 browser-verify-export.py 在真浏览器里验）。
  const patched = auth as unknown as { exportData: () => Promise<unknown> }
  patched.exportData = (...args: unknown[]) => exportData(...args)

  const wrapper = mount(AccountView, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

async function triggerExport(wrapper: Awaited<ReturnType<typeof mountAccount>>) {
  const button = wrapper.findAll('button').find((item) => item.text().includes('导出我的数据'))
  expect(button, '账号页上应有「导出我的数据」按钮').toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
  return button!
}

describe('账号页 · 导出完整性提示', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetAdminProbeForTests()
    exportData.mockReset()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:stub') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('导出完整时：说「都在里面」，且不显示不完整警告，注销区也没有警告', async () => {
    exportData.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'typeme-export.json',
      degradedSections: [],
    })
    const wrapper = await mountAccount()
    await triggerExport(wrapper)

    expect(wrapper.text()).toContain('都在里面')
    expect(wrapper.text()).not.toContain('不是完整备份')
    expect(wrapper.find('[data-export-incomplete-before-delete]').exists()).toBe(false)
  })

  it('有段落没导出成功时：**不说**「都在里面」，明确说不是完整备份，并点名缺了什么', async () => {
    exportData.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'typeme-export.json',
      degradedSections: [{ section: 'reports', reason: '查询失败（DataAccessResourceFailureException）' }],
    })
    const wrapper = await mountAccount()
    await triggerExport(wrapper)

    const text = wrapper.text()
    expect(text, '不能把不完整的备份说成完整备份').not.toContain('都在里面')
    expect(text).toContain('不是完整备份')
    // 点名到具体段落，用户才知道缺的是哪一块
    expect(text).toContain('报告')
    expect(text, '要劝住用户先别注销').toContain('先不要注销账号')
    // 文件里也有标记，告诉用户自查的位置
    expect(text).toContain('degradedSections')
  })

  it('导出不完整时，注销区也给出「先别注销」的最后一道提示', async () => {
    exportData.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'typeme-export.json',
      degradedSections: [{ section: 'aiJobs', reason: '数据表尚未就绪（部署未完成）' }],
    })
    const wrapper = await mountAccount()
    await triggerExport(wrapper)

    const warning = wrapper.find('[data-export-incomplete-before-delete]')
    expect(warning.exists(), '注销区必须也提醒，用户可能没看导出区就往下滚').toBe(true)
    expect(warning.text()).toContain('先别注销')
  })

  it('认不出的段名原样显示，不能因为翻译不了就把警告吞掉', async () => {
    exportData.mockResolvedValue({
      blob: new Blob(['{}'], { type: 'application/json' }),
      filename: 'typeme-export.json',
      degradedSections: [{ section: 'somethingNew', reason: '查询失败' }],
    })
    const wrapper = await mountAccount()
    await triggerExport(wrapper)

    const text = wrapper.text()
    expect(text).toContain('不是完整备份')
    expect(text, '认不出的段名要原样露出来，而不是静默消失').toContain('somethingNew')
  })
})
