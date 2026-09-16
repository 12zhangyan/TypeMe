import { createRouter, createWebHashHistory } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import QuizView from '@/views/QuizView.vue'
import ResultView from '@/views/ResultView.vue'
import AboutView from '@/views/AboutView.vue'

/**
 * 路由 —— 用 **hash 模式**是刻意的选择：
 *   - 纯静态产物放到任何地方（对象存储、单文件分发、file:// 直接打开）都能用；
 *   - 不依赖服务端 SPA 回退配置（后端 WebConfig 即使没配好也不会 404）；
 *   - 微信内置浏览器里刷新不会丢页面。
 * 需求文档 §7.3 把"单文件 HTML 备份方案"列为推荐路径，hash 模式正是为它留的余地。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // 标题不带量表名：站点默认是大五（IPIP-50），但用户可以在首页切到 OEJTS 旧版本，
    // 写死任意一个都会在另一种情况下说错话。具体量表名由壳里的副标题动态显示。
    { path: '/', name: 'landing', component: LandingView, meta: { title: 'TypeMe · 人格倾向自测' } },
    { path: '/quiz', name: 'quiz', component: QuizView, meta: { title: '答题中 · TypeMe' } },
    { path: '/result', name: 'result', component: ResultView, meta: { title: '你的结果 · TypeMe' } },
    { path: '/about', name: 'about', component: AboutView, meta: { title: '关于与方法说明 · TypeMe' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = to.meta.title
  if (typeof title === 'string') document.title = title
})
