<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
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
  legacyScope.value ? legacyInstrumentTagline(quiz.activePackage) : instrument.facts.title,
)

/** 答题页自己渲染完整的进度与操作区；这里不再重复导航，避免误触清空进度。 */
const quizActive = computed(() => route.name === 'quiz' || route.name === 'assess' || route.name === 'assess-attempt')
/**
 * 首页/关于页不显示"开始测评"，避免在使用其它入口时被误点到。
 *
 * 2026-09-16：这里原本还有一个指向 `/quiz` 的「旧版本测试」顶栏链接
 * （`showStartLink` 控制）。产品要求首页移除旧版本测试入口后，这个链接在
 * **每一个非首页的页面上**都还挂着，属于漏网的入口，已一并删除。
 * `/quiz` 路由本身保留，直接改 hash 仍可进入旧站。
 */
const showStartLink = computed(() => {
  if (route.name === 'quiz') return false
  if (route.name === 'landing') return false
  return true
})

/**
 * 新测导航是否可渲染。
 *
 * 与 `authRoutesReady` 同一个理由：`App.vue` 会被单独挂载（测试里只注册两三条路由），
 * 渲染指向未注册路由的链接只会让 vue-router 报一堆警告、用户看到一个点了没反应的入口。
 */
const assessmentRoutesReady = computed(() => router.hasRoute('assess') && router.hasRoute('reports'))

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
</script>

<template>
  <div class="flex min-h-screen flex-col bg-paper">
    <a class="skip-link" href="#main">跳到主要内容</a>

    <header
      class="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-sm"
      :class="quizActive ? 'border-transparent bg-paper/95' : ''"
    >
      <div
        class="mx-auto flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 tablet:px-6 tablet:py-3 laptop:px-8"
        :class="quizActive ? 'max-w-shell-quiz' : 'max-w-shell-wide'"
      >
        <RouterLink
          to="/"
          class="flex items-baseline gap-2 rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          :aria-label="quizActive ? '暂时离开答题，回到首页' : 'TypeMe 首页'"
        >
          <span class="font-display text-[19px] font-bold leading-none tracking-tight text-ink">
            TypeMe
          </span>
          <span class="text-[11.5px] text-ink-faint">{{ shellTagline }}</span>
        </RouterLink>

        <nav
          class="flex flex-wrap items-center justify-end gap-1 text-[13.5px] tablet:gap-2"
          aria-label="站点导航"
        >
          <template v-if="quizActive">
            <RouterLink to="/" class="btn-ghost btn-sm">暂时离开</RouterLink>
          </template>
          <template v-else>
            <!-- 新测入口：主入口是 /assess（登录后跨设备继续）；旧引擎 /quiz 仍然保留，
                 在首页以"旧版本"说明的形式出现，不在这里抢主位。 -->
            <RouterLink
              v-if="assessmentRoutesReady"
              to="/assess"
              class="btn-ghost btn-sm"
              :class="route.name === 'assess' || route.name === 'assess-attempt' ? 'text-primary-700' : ''"
              >开始测评</RouterLink
            >
            <RouterLink
              v-if="assessmentRoutesReady && authRoutesReady && auth.isAuthenticated"
              to="/reports"
              class="btn-ghost btn-sm"
              :class="route.name === 'reports' || route.name === 'report-detail' ? 'text-primary-700' : ''"
              >历史报告</RouterLink
            >
            <RouterLink
              v-if="showStartLink"
              to="/assess"
              class="btn-ghost btn-sm"
              >开始测评</RouterLink
            >
            <RouterLink
              to="/about"
              class="btn-ghost btn-sm"
              :class="route.name === 'about' ? 'text-primary-700' : ''"
              >{{ route.name === 'about' ? '方法与隐私' : '关于' }}</RouterLink
            >

            <!-- 账号入口：把"现在是登录状态"这件事直接写在导航里，不让用户自己猜。
                 会话还没确认时不渲染任何一项，避免先闪一个错的（"登录"或"退出"）。 -->
            <template v-if="authRoutesReady && auth.isAuthenticated">
              <RouterLink
                to="/account"
                class="btn-ghost btn-sm"
                :class="route.name === 'account' ? 'text-primary-700' : ''"
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
                :class="route.name === 'login' ? 'text-primary-700' : ''"
                >登录</RouterLink
              >
              <RouterLink
                to="/register"
                class="btn-ghost btn-sm"
                :class="route.name === 'register' ? 'text-primary-700' : ''"
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
    <footer v-if="!quizActive" class="border-t border-line bg-paper-soft">
      <div
        class="mx-auto w-full max-w-shell-wide px-3 py-7 tablet:px-6 tablet:py-9 laptop:px-8"
      >
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
              {{ instrument.facts.title }}的题目与报告文案为本项目自行撰写；本站
              <strong class="font-medium text-ink-soft">不隶属</strong>
              任何商业人格测评机构，也不是任何机构的官方测评。报告由本站服务端按同一套规则重新计算生成。
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
