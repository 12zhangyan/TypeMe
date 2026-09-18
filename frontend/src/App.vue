<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import { useAuthStore } from '@/stores/auth'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES, FALLBACK_ATTRIBUTION } from '@/content/fallback'
import { instrumentHasTypeCode } from '@/domain/assessmentPackage'
import type { Attribution } from '@/domain/contentTypes'
import { fetchMeta } from '@/api/client'
import { applyDevSeed } from '@/dev/seed'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import { isLegacyEngineRoute, legacyInstrumentTagline } from '@/utils/instrumentNaming'

/**
 * 公共壳 —— `docs/2026-09-15/...重构开发文档.md` §4.5 / §10.4。
 *
 * 刻意很薄：`App.vue` 不持有计分与恢复规则，只负责
 *   ① 顶部轻量导航（手机首屏不塞四五个导航项）；
 *   ② 全局的"另一标签页改动了这次测试"提示（§10.4）；
 *   ③ 页脚署名与本地记录入口。
 *
 * 答题页会用一个只读的 `quizActive` 标记隐藏页脚、把导航降到最小，
 * 让答题成为一屏专注的"工作区"（文档 §4.5：移除营销式导航和长页脚）。
 *
 * 量表换成大五（IPIP-50）之后，壳里的"四维 / 四字母"与 Myers & Briggs 免责声明
 * 不能再写死：署名与免责声明一律取**当前内容包**的 attribution，
 * 副标题按当前量表的维度数生成。
 *
 * ⚠️ 但"当前内容包"只对**旧引擎的页面**成立（`/quiz`、`/result`、方法页 `/about`）。
 * 首页、`/assess`、`/reports` 是新站，它们跑的是 `typeme-jung48-zh-v1` 十六型量表，
 * 名称与题数只能来自新测自己的目录接口。过去壳层一律读旧内容包，于是十六型报告的
 * 顶栏写「大五人格倾向自测」、页脚署名指向 IPIP（浏览器验收报告问题 1 / 问题 2）。
 * 现在按路由分开取：见 {@link legacyScope}。
 */
const quiz = useQuizStore()
const instrument = useInstrumentV3Store()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** 退出请求进行中：按钮要有明确的状态，不能点了没反应。 */
const loggingOut = ref(false)
/** 退出没能通知到服务器时的可见提示（本地已清干净，但不能不说）。 */
const accountNotice = ref<string | null>(null)

/**
 * 账号相关的路由是否已注册。
 *
 * 不是在炫耀防御性编程：`App.vue` 会被单独挂载（测试里就只给了一个两三条路由的
 * memory router），这时渲染指向未注册路由的 `RouterLink` 只会让 vue-router
 * 打一堆 "No match found" 警告，用户看到的则是一个点了没反应的入口。
 * 路由没注册就不渲染，比渲染一个假的入口诚实。
 */
const authRoutesReady = computed(() => router.hasRoute('login') && router.hasRoute('account'))

/** 默认包（大五 IPIP-50）的署名：内容包还没装载时也不能先显示另一个量表的许可。 */
const defaultPackage = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]
const attribution = ref<Attribution>(defaultPackage?.attribution ?? FALLBACK_ATTRIBUTION)
let unbindStorage: (() => void) | null = null
let metaLoaded = false

/** 当前内容包的署名；没有装载成功时退回默认包的署名。只用于旧引擎页面。 */
const activeAttribution = computed<Attribution>(
  () => quiz.activePackage?.attribution ?? attribution.value,
)
const hasTypeCode = computed(() =>
  quiz.activePackage ? instrumentHasTypeCode(quiz.activePackage) : false,
)

/**
 * 当前页面是不是旧引擎（旧站）的页面。
 *
 * 只有旧引擎的页面才该用 `quiz.activePackage` 的量表名与署名 —— 那是它们真正在跑的
 * 量表。其余页面属于新站，口径来自目录接口（`instrument.facts`）。
 */
const legacyScope = computed(() => isLegacyEngineRoute(route.name))

/** 副标题：旧引擎页面按当前内容包生成；新站页面用新测自己的量表名。 */
const shellTagline = computed(() =>
  legacyScope.value ? legacyInstrumentTagline(quiz.activePackage) : '多种测评，帮助你理解自己',
)

/** 答题页自己渲染完整的进度与操作区；这里不再重复导航，避免误触清空进度。 */
const quizActive = computed(() => route.name === 'quiz' || route.name === 'assess' || route.name === 'assess-attempt')
/**
 * 顶栏「开始测评」入口的唯一一份。
 *
 * 2026-09-16：这里原本还有一个指向 `/quiz` 的「旧版本测试」顶栏链接
 * （由 `showStartLink` 控制）。产品要求首页移除旧版本测试入口后，那个链接改指
 * `/assess`，却与下面新测自己的入口**并排留下了两份**：顶栏于是出现两个一模一样、
 * 指向同一路由的「开始测评」（`shellNav.spec.ts` 钉住这一条），
 * 而且带高亮判断的那一份的判断永远为假 —— `/assess` 与 `/assess/:id` 属于
 * `quizActive`，那时整个 `v-else` 分支都不渲染，导航里只剩"暂时离开"。
 *
 * 现在只保留一份（带高亮的那份），重复的那份与 `showStartLink` 一起删除；
 * 非答题页的排除已经由 `quizActive` 分支承担，再加一层判断只会再造出同样的重复。
 * `/quiz` 路由本身保留，直接改 hash 仍可进入旧站。
 */

/**
 * 新测导航是否可渲染。
 *
 * 与 `authRoutesReady` 同一个理由：`App.vue` 会被单独挂载（测试里只注册两三条路由），
 * 渲染指向未注册路由的链接只会让 vue-router 报一堆警告、用户看到一个点了没反应的入口。
 */
const assessmentRoutesReady = computed(() => router.hasRoute('assess') && router.hasRoute('reports'))

/**
 * 「开始测评」指向哪一页。
 *
 * 多量表之后它不能直接指向 `/assess`：那一页现在先问"哪一项"。
 * 但**文案与数量都不能变**（`shellNav.spec.ts` 钉住"指向某一路径的入口恰好一个、
 * 文案是「开始测评」"）—— 顶栏不是放量表清单的地方，它是入口。
 * 所以这里优先指向 `instruments`（发现页：有哪些测评），
 * 未注册该路由时（测试里只注册部分路由）退回 `assess`，避免渲染死链。
 */
const startRouteName = computed(() => (router.hasRoute('instruments') ? 'instruments' : 'assess'))

function loadMeta() {
  if (metaLoaded) return
  metaLoaded = true
  void fetchMeta()
    .then((resolved) => {
      attribution.value = resolved.data.attribution
    })
    .catch(() => {
      /* 沿用内置署名：BY 义务永远有兜底 */
    })
}

onMounted(() => {
  quiz.detectLegacy()
  unbindStorage = quiz.bindStorageSync()
  loadMeta()
  // 新测的对外口径：读一次目录并缓存。未登录（401）或离线时 store 保留内置口径，
  // 页面不会因此空白，也不会退回旧内容包的量表名。
  void instrument.load()
  // 登录态只问一次（内部合并并发）：导航栏的账号入口依赖它。
  // 失败也不提示——连不上服务器时"没确认登录状态"由登录页负责解释。
  void auth.ensureLoaded()
  // 仅开发环境：`?seed=` 写入一份可复现的答卷，用于截图与人工验收（见 dev/seed.ts）
  if (!quiz.activePackage) {
    void quiz.load().then(() => applyDevSeed(quiz))
  } else {
    applyDevSeed(quiz)
  }
})

onBeforeUnmount(() => {
  unbindStorage?.()
  unbindStorage = null
})

/**
 * 会话在**停留期间**失效时，把用户送回登录页。
 *
 * 路由守卫只在"导航到某个页面"时检查登录态。用户不导航、只是点一下"再试一次"或者
 * 等轮询回来时，401 不会触发任何导航 —— 于是页面停在原地，每个请求都 401，
 * 顶栏却还写着"已登录 / 退出"（见 `api/v3.ts` 里 `onSessionExpired` 的说明）。
 * 这里补上那一步：`auth` 由桥接清成匿名后，只要当前页是需要登录的，就带 `redirect` 去登录页，
 * 登录完能回到原处。`guestOnly` 页面（登录页自己）不动，否则会自己踢自己。
 */
watch(
  () => auth.isAuthenticated,
  async (nowAuthenticated, wasAuthenticated) => {
    if (nowAuthenticated || !wasAuthenticated) return
    if (route.meta.requiresAuth !== true) return
    await router.replace({ name: 'login', query: { redirect: route.fullPath } })
  },
)

/**
 * 退出登录。
 *
 * 本地状态一定会清干净（`auth.logout()` 里保证），服务端有没有收到则如实说出来：
 * 共用设备上"以为退出了其实没退出"是安全问题，不能静默。
 */
async function onLogout() {
  if (loggingOut.value) return
  loggingOut.value = true
  accountNotice.value = null
  try {
    const { notifiedServer } = await auth.logout()
    if (!notifiedServer) {
      accountNotice.value =
        '这台设备上的登录状态已经清掉了，但没能通知到服务器（网络或服务暂时不可用）。如果这是共用设备，请联网后再退出一次。'
    }
    if (route.meta.requiresAuth === true) await router.replace({ name: 'login' })
  } finally {
    loggingOut.value = false
  }
}

function loadLatest() {
  quiz.loadLatest()
  // 载入后重新对齐当前页面的判断：处理完的留在结果页，没处理完的回答题页
  if (route.name === 'result' && !quiz.isProcessed) void router.replace({ name: 'quiz' })
}

/**
 * 顶栏导航项的当前页样式。
 *
 * 2026-09-18 视觉重构：原先"当前页"只靠文字变成主色表示 —— 在一行灰字里
 * 这个差别太弱，窄屏上几乎看不出停在哪儿。现在多一层浅主色底：
 * 不改变布局高度，也不和主按钮抢注意力，但一眼能认出当前位置。
 */
function navPill(active: boolean): string {
  return active ? 'bg-primary-50 text-primary-700' : ''
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-paper">
    <a class="skip-link" href="#main">跳到主要内容</a>

    <header
      class="site-header sticky top-0 z-30 border-b backdrop-blur-md"
      :class="quizActive ? 'border-transparent bg-paper/95' : 'border-line bg-surface/85'"
    >
      <div
        class="mx-auto flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 tablet:px-6 tablet:py-3 laptop:px-8"
        :class="quizActive ? 'max-w-shell-quiz' : 'max-w-shell-wide'"
      >
        <!--
          品牌链接的命中区必须够大（A54）：它原来只有文字行高那么高
          —— 实测 320px 下 92x19、390/1440 下 203x22，是顶栏里唯一一个
          矮于 24px 的可点目标（导航项走 `.btn-sm`，是 44px）。
          这里给它 `min-h-6`（24px，WCAG 2.5.8 的最小目标尺寸）。
          刻意保留原来的 `items-baseline`：多出来的 5px 留在盒子底部，
          文字与圆点的位置一个像素都不动（换成 items-center 实测会把副标题的
          行内盒重新排一遍，宽度从 203 变成 195）。
        -->
        <RouterLink
          to="/"
          class="brand-link flex min-h-6 items-baseline gap-2 rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          aria-label="TypeMe 首页"
        >
          <span class="flex items-baseline gap-2">
            <span
              class="brand-mark inline-block h-[9px] w-[9px] shrink-0 translate-y-[-1px] rounded-[3px] bg-primary-600"
              aria-hidden="true"
            />
            <span class="font-display text-[19px] font-bold leading-none tracking-tight text-ink">
              TypeMe
            </span>
          </span>
          <!--
            品牌行的量表副标题。**窄屏（<360px）不显示**：它和导航一样会折行，
            320px 上实测把顶栏撑到 139px —— 占 568px 首屏的 24.5%，而粘性顶栏是
            常驻的。隐藏后顶栏固定为两行（品牌 + 三个导航入口），实测 88px；
            量表口径在首页正文与页脚署名里仍然完整，没有信息丢失
            （`scripts/browser-verify-narrow-layout.py` 会量这个高度）。
          -->
          <span class="brand-caption hidden text-[11.5px] text-ink-faint laptop:inline">{{ shellTagline }}</span>
        </RouterLink>

        <nav
          class="flex flex-wrap items-center justify-end gap-1 text-[13.5px] tablet:gap-2"
          aria-label="站点导航"
        >
          <template v-if="quizActive">
            <RouterLink to="/" class="btn-ghost btn-sm">暂时离开</RouterLink>
          </template>
          <template v-else>
            <!--
              新测入口：主入口是 /assess（登录后跨设备继续）。**只渲染一份** ——
              这里曾经同时挂着两份指向 /assess 的「开始测评」，见文件上方那段注释。
              旧引擎的 /quiz 路由仍然保留，直接改 hash 可进入，不占顶栏。
            -->
            <RouterLink
              v-if="assessmentRoutesReady"
              :to="{ name: startRouteName }"
              class="btn-ghost btn-sm"
              :class="navPill(startRouteName === 'instruments' ? route.name === 'instruments' : route.name === 'assess' || route.name === 'assess-attempt')"
              >开始测评</RouterLink
            >
            <RouterLink
              v-if="assessmentRoutesReady && authRoutesReady && auth.isAuthenticated"
              to="/reports"
              class="btn-ghost btn-sm"
              :class="navPill(route.name === 'reports' || route.name === 'report-detail')"
              >历史报告</RouterLink
            >
            <!--
              导航项写的是**目标**的名字，与当前停在哪一页无关。
              原先这里是 `route.name === 'about' ? '方法与隐私' : '关于'` —— 反了：
              停在关于页时显示"方法与隐私"，在别的页面上显示"关于"，
              用户会以为还存在另一个页面（`shellNav.spec.ts` 钉住这一条）。
            -->
            <RouterLink
              to="/about"
              class="btn-ghost btn-sm"
              :class="navPill(route.name === 'about')"
              >关于</RouterLink
            >

            <!-- 账号入口：把"现在是登录状态"这件事直接写在导航里，不让用户自己猜。
                 会话还没确认时不渲染任何一项，避免先闪一个错的（"登录"或"退出"）。 -->
            <template v-if="authRoutesReady && auth.isAuthenticated">
              <RouterLink
                to="/account"
                class="btn-ghost btn-sm"
                :class="navPill(route.name === 'account')"
                :aria-label="`账号与数据（已登录：${auth.displayName}）`"
              >
                <span class="hidden max-w-[10rem] truncate tablet:inline">{{ auth.displayName }}</span>
                <span class="tablet:hidden">账号</span>
              </RouterLink>
              <button
                type="button"
                class="btn-ghost btn-sm"
                :disabled="loggingOut"
                @click="onLogout"
              >
                {{ loggingOut ? '退出中…' : '退出' }}
              </button>
            </template>
            <template v-else-if="authRoutesReady && !auth.isChecking">
              <RouterLink
                to="/login"
                class="btn-ghost btn-sm"
                :class="navPill(route.name === 'login')"
                >登录</RouterLink
              >
              <RouterLink
                to="/register"
                class="btn-ghost btn-sm"
                :class="navPill(route.name === 'register')"
                >注册</RouterLink
              >
            </template>
          </template>
        </nav>
      </div>
    </header>

    <!-- 退出没能通知服务器：本地已退出，但这件事必须说出来（共用设备上是安全问题） -->
    <div v-if="accountNotice" class="border-b border-line bg-paper-soft">
      <div class="mx-auto w-full max-w-shell-wide px-3 py-3 tablet:px-6 laptop:px-8">
        <div class="flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
          <p class="min-w-0 flex-1 text-[13.5px] leading-relaxed text-ink-soft">{{ accountNotice }}</p>
          <button type="button" class="btn-ghost btn-sm" @click="accountNotice = null">知道了</button>
        </div>
      </div>
    </div>

    <!-- 另一标签页改动了这次测试：停止自动覆盖，由用户决定（§10.4） -->
    <div v-if="quiz.externalChange" class="border-b border-accent-200 bg-accent-100">
      <div class="mx-auto w-full max-w-shell-wide px-3 py-3 tablet:px-6 laptop:px-8">
        <div class="flex flex-wrap items-center justify-between gap-3" role="status">
          <p class="text-[14px] leading-relaxed text-accent-700">
            另一页面已更新这次测试，本页没有继续覆盖它。
          </p>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" @click="loadLatest">
              载入最新进度
            </button>
            <RouterLink to="/" class="btn-ghost btn-sm">回到首页</RouterLink>
          </div>
        </div>
      </div>
    </div>

    <main id="main" class="flex-1">
      <RouterView />
    </main>

    <!-- 答题页不渲染页脚：一屏专注，也避免长页脚把移动端操作条顶开（§4.5） -->
    <footer v-if="!quizActive" class="site-footer relative border-t border-line bg-paper-soft">
      <!-- 页脚以品牌字标收尾，量表与数据处理说明保留在下方。 -->
      <span
        class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary-600 via-glow to-transparent"
        aria-hidden="true"
      />
      <div
        class="mx-auto w-full max-w-shell-wide px-3 py-7 tablet:px-6 tablet:py-9 laptop:px-8"
      >
        <div class="footer-wordmark" aria-hidden="true">TypeMe<span>向内探索，<br />向外生长。</span></div>
        <div class="flex flex-col gap-5 laptop:flex-row laptop:justify-between laptop:gap-10">
          <div class="max-w-prose space-y-2">
            <p class="text-[13.5px] font-semibold text-ink">TypeMe · {{ shellTagline }}</p>

            <!-- 旧引擎页面：署名取当前内容包（OEJTS 非商业 / IPIP 公有领域）。 -->
            <p v-if="legacyScope" class="fineprint">
              题目基于 {{ activeAttribution.source }}（{{ activeAttribution.author }}），依
              <a
                :href="activeAttribution.licenseUrl"
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="link link-external"
                >{{ activeAttribution.license }}</a
              >
              使用。
              <template v-if="hasTypeCode">
                本项目做了中文本地化改写，并<strong class="font-medium text-ink-soft">未获得</strong>
                Myers &amp; Briggs Foundation 等机构的任何授权或背书。
              </template>
              <template v-else>
                中文题面为本项目自写候选稿；IPIP 量表属公有领域，
                <strong class="font-medium text-ink-soft">不隶属</strong>
                任何商业人格测评机构，也不是任何机构的官方测评。
              </template>
            </p>

            <!--
              新站页面（首页 / 新测 / 报告 / 账号）：署名只描述新测自己。
              这里不出现旧内容包的来源与许可 —— 一份十六型报告顶着 IPIP 大五的署名，
              是浏览器验收报告里的问题 2。
            -->
            <p v-else class="fineprint" data-new-instrument-attribution>
              十六型题目与报告文案为本项目自写参考稿；大五使用 IPIP 公有领域题目，中文为项目改写稿。本站
              <strong class="font-medium text-ink-soft">不隶属</strong>
              任何商业人格测评机构，也不是任何机构的官方测评。各量表独立计分，历史报告保留生成时的结果。
            </p>
          </div>
          <nav class="flex flex-wrap items-start gap-x-5 gap-y-2 text-[13.5px]">
            <RouterLink to="/" class="link-quiet">首页</RouterLink>
            <RouterLink to="/about" class="link-quiet">方法与隐私</RouterLink>
            <RouterLink to="/about#records" class="link-quiet">本地记录</RouterLink>
            <a
              v-if="legacyScope"
              :href="activeAttribution.url"
              target="_blank"
              rel="noopener noreferrer nofollow"
              class="link-quiet link-external"
              >原始题目来源</a
            >
          </nav>
        </div>
        <p v-if="legacyScope" class="mt-5 fineprint">
          结果仅供自我了解与娱乐参考，不是心理诊断，也不用于招聘或任何筛选。答案只在你的浏览器里参与计算。
        </p>
        <p v-else class="mt-5 fineprint" data-new-instrument-compute>
          结果仅供自我了解与娱乐参考，不是心理诊断，也不用于招聘或任何筛选。答题进度与报告保存在你的账号下；
          页面上的「目前的粗略倾向」只是即时预览，最终报告由服务端重新计算。
        </p>
      </div>
    </footer>
  </div>
</template>
