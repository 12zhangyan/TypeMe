// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import App from '@/App.vue'
import LandingView from '@/views/LandingView.vue'

/**
 * 公共壳（`App.vue`）顶栏导航的守卫。
 *
 * 这一组用例针对的是 2026-09-17 复核时在真实代码里读出来的两个缺陷：
 *
 * 1. **同一个 entypoint 渲染了两次**：`assessmentRoutesReady` 为真时，
 *    顶栏同时输出两个指向 `/assess` 的「开始测评」（一个带高亮判断、一个是
 *    "旧版本测试"入口清理后的残留）。前者的高亮判断 `route.name === 'assess'`
 *    还**永远为假** —— 因为 `quizActive` 为真时整个 `template v-else` 都不渲染，
 *    而 `/assess` 恰好属于 `quizActive`。结果：重复入口 + 高亮态失效。
 * 2. **两个导航文案写反**：`route.name === 'about' ? '方法与隐私' : '关于'`
 *    停在关于页时显示"方法与隐私"，在别的页面上显示"关于"。导航项应当描述
 *    它的**目标**，而不是当前页。
 *
 * 断言写成"顶栏里指向某路由的入口恰好一个"，而不是断言具体模板结构 ——
 * 后者会随实现变动，前者才是用户实际看到的东西。
 */

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/assess', name: 'assess', component: { template: '<div />' } },
      { path: '/assess/:attemptId', name: 'assess-attempt', component: { template: '<div />' } },
      { path: '/reports', name: 'reports', component: { template: '<div />' } },
      { path: '/reports/:reportId', name: 'report-detail', component: { template: '<div />' } },
      { path: '/account', name: 'account', component: { template: '<div />' } },
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/register', name: 'register', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
      { path: '/quiz', name: 'quiz', component: { template: '<div />' } },
    ],
  })
}

/** 顶栏（`header nav[aria-label="站点导航"]`）里指向指定路径的链接。 */
function navLinksTo(wrapper: ReturnType<typeof mount>, path: string) {
  return wrapper
    .find('header nav[aria-label="站点导航"]')
    .findAll('a')
    .filter((link) => (link.attributes('href') ?? '').split('?')[0] === path)
}

async function mountApp(path: string) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App as never, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('顶栏导航（App.vue）', () => {
  it('指向「开始测评」的入口只出现一次', async () => {
    const { wrapper } = await mountApp('/about')
    const assessLinks = navLinksTo(wrapper, '/assess')
    expect(
      assessLinks.length,
      `顶栏里指向 /assess 的入口有 ${assessLinks.length} 个：` +
        assessLinks.map((link) => `「${link.text()}」`).join('、'),
    ).toBe(1)
    expect(assessLinks[0]!.text()).toBe('开始测评')
  })

  it('停在关于页时，导航项写的仍然是它自己的目标名', async () => {
    const onAbout = await mountApp('/about')
    expect(navLinksTo(onAbout.wrapper, '/about').map((link) => link.text())).toEqual(['关于'])

    const onLanding = await mountApp('/')
    expect(navLinksTo(onLanding.wrapper, '/about').map((link) => link.text())).toEqual(['关于'])
  })

  it('未登录时不渲染重复的账号入口', async () => {
    const { wrapper } = await mountApp('/about')
    expect(navLinksTo(wrapper, '/login')).toHaveLength(1)
    expect(navLinksTo(wrapper, '/register')).toHaveLength(1)
  })
})
