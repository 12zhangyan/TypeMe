import { createRouter, createWebHashHistory } from 'vue-router'
import LandingView from '@/views/LandingView.vue'
import QuizView from '@/views/QuizView.vue'
import ResultView from '@/views/ResultView.vue'
import AboutView from '@/views/AboutView.vue'
import LoginView from '@/views/LoginView.vue'
import RegisterView from '@/views/RegisterView.vue'
import RecoverView from '@/views/RecoverView.vue'
import AccountView from '@/views/AccountView.vue'
import AssessView from '@/views/AssessView.vue'
import ReportV3View from '@/views/ReportV3View.vue'
import CompareView from '@/views/CompareView.vue'
import AdminView from '@/views/AdminView.vue'
import { useAuthStore } from '@/stores/auth'

/**
 * 路由 —— 用 **hash 模式**是刻意的选择：
 *   - 纯静态产物放到任何地方（对象存储、单文件分发、file:// 直接打开）都能用；
 *   - 不依赖服务端 SPA 回退配置（后端 WebConfig 即使没配好也不会 404）；
 *   - 微信内置浏览器里刷新不会丢页面。
 * 需求文档 §7.3 把"单文件 HTML 备份方案"列为推荐路径，hash 模式正是为它留的余地。
 */
declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /** 需要登录：未登录访问会跳登录页并带回来路（契约 03 §7.2）。 */
    requiresAuth?: boolean
    /** 只有未登录时才该看：已登录访问会跳回 redirect 或账号页。 */
    guestOnly?: boolean
  }
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // 标题不带量表名：站点默认是大五（IPIP-50），但用户可以在首页切到 OEJTS 旧版本，
    // 写死任意一个都会在另一种情况下说错话。具体量表名由壳里的副标题动态显示。
    { path: '/', name: 'landing', component: LandingView, meta: { title: 'TypeMe · 十六型人格参考测评' } },
    { path: '/quiz', name: 'quiz', component: QuizView, meta: { title: '答题中 · TypeMe' } },
    { path: '/result', name: 'result', component: ResultView, meta: { title: '你的结果 · TypeMe' } },
    { path: '/about', name: 'about', component: AboutView, meta: { title: '关于与方法说明 · TypeMe' } },

    // 账号模块（契约 03 §7.2）。认证三页公开，但已登录时不该再看：
    // 一个已经登录的人看到"登录"表单，只会以为自己掉线了。
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { title: '登录 · TypeMe', guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: RegisterView,
      meta: { title: '注册 · TypeMe', guestOnly: true },
    },
    {
      path: '/recover',
      name: 'recover',
      component: RecoverView,
      meta: { title: '用恢复码重置密码 · TypeMe', guestOnly: true },
    },
    {
      path: '/account',
      name: 'account',
      component: AccountView,
      meta: { title: '账号与数据 · TypeMe', requiresAuth: true },
    },
    // 管理后台。**不在导航里露出**：这一页是否可用由服务端判定（非管理员得到
    // 403 → 页面显示"你没有权限"），所以隐藏入口不是为了"安全靠隐蔽"，
    // 而是不让每个普通用户在顶栏看到一个点进去必然没用的链接。
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { title: '管理后台 · TypeMe', requiresAuth: true },
    },

    // ── 新测（契约 03 §7.2）───────────────────────────────────────────────
    // 需要登录：答案与报告都放在服务端，这样"换设备继续"与"回看历史报告"
    // 才是真的成立。旧引擎（/quiz、/result）仍然不需要登录，且行为一字未改。
    {
      path: '/assess',
      name: 'assess',
      component: AssessView,
      meta: { title: '开始测评 · TypeMe', requiresAuth: true },
    },
    {
      path: '/assess/:attemptId',
      name: 'assess-attempt',
      component: AssessView,
      meta: { title: '答题中 · TypeMe', requiresAuth: true },
    },
    {
      path: '/reports',
      name: 'reports',
      component: ReportV3View,
      meta: { title: '历史报告 · TypeMe', requiresAuth: true },
    },
    // ⚠️ `/reports/compare` **必须**排在 `/reports/:reportId` 前面。
    // vue-router 按声明顺序匹配，反过来的话 `/reports/compare` 会先命中详情路由，
    // 于是把它当成一份 id 为 "compare" 的报告去请求（结果是一个"报告打不开"的 404 页面）。
    // 服务端那边靠 Spring 的"字面量优先于模板变量"消歧，不依赖顺序 —— 两边机制不同。
    {
      path: '/reports/compare',
      name: 'report-compare',
      component: CompareView,
      meta: { title: '复测比较 · TypeMe', requiresAuth: true },
    },
    {
      path: '/reports/:reportId',
      name: 'report-detail',
      component: ReportV3View,
      meta: { title: '报告 · TypeMe', requiresAuth: true },
    },

    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

/**
 * 登录守卫。
 *
 * 两个容易做错的点：
 *
 * 1. **必须等会话确认完再判断**。刷新页面时 store 里还没有登录态，
 *    直接按"没登录"处理会把已登录用户踢到登录页 —— 这是最招人烦的一类 bug。
 *    所以这里 `await auth.ensureLoaded()`；它内部合并并发、且**永不抛异常**
 *    （连不上服务器时状态是 `unavailable`，不等于"没登录"，但仍然拦住需要登录的页面，
 *    因为确实无法证明你登录了）。
 * 2. **回跳地址只接受站内路径**。`?redirect=` 直接丢给 `router.replace` 时，
 *    `//evil.example` 这类值会被浏览器当成协议相对地址带走，等于开放重定向。
 */
router.beforeEach(async (to) => {
  const needsAuth = to.meta.requiresAuth === true
  const guestOnly = to.meta.guestOnly === true
  if (!needsAuth && !guestOnly) return true

  const auth = useAuthStore()
  await auth.ensureLoaded()

  if (needsAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (guestOnly && auth.isAuthenticated) {
    return { path: safeRedirect(to.query.redirect, '/account') }
  }
  return true
})

/** 只接受站内绝对路径，其余一律退回默认落点。 */
function safeRedirect(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

router.afterEach((to) => {
  const title = to.meta.title
  if (typeof title === 'string') document.title = title
})
