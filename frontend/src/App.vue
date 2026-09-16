<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES, FALLBACK_ATTRIBUTION } from '@/content/fallback'
import { instrumentHasTypeCode, packageDimensionOrder } from '@/domain/assessmentPackage'
import type { Attribution } from '@/domain/contentTypes'
import { fetchMeta } from '@/api/client'
import { applyDevSeed } from '@/dev/seed'

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
 */
const quiz = useQuizStore()
const route = useRoute()
const router = useRouter()

/** 默认包（大五 IPIP-50）的署名：内容包还没装载时也不能先显示另一个量表的许可。 */
const defaultPackage = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]
const attribution = ref<Attribution>(defaultPackage?.attribution ?? FALLBACK_ATTRIBUTION)
let unbindStorage: (() => void) | null = null
let metaLoaded = false

/** 当前内容包的署名；没有装载成功时退回默认包的署名。 */
const activeAttribution = computed<Attribution>(
  () => quiz.activePackage?.attribution ?? attribution.value,
)
const hasTypeCode = computed(() =>
  quiz.activePackage ? instrumentHasTypeCode(quiz.activePackage) : false,
)
/** 副标题：按当前量表的维度数生成（四维 / 五维），不写死某一个量表。 */
const shellTagline = computed(() => {
  const pkg = quiz.activePackage
  if (!pkg) return '人格倾向自测'
  const count = packageDimensionOrder(pkg).length
  return hasTypeCode.value ? `${count} 维人格倾向自测` : `大五人格倾向自测`
})

/** 答题页自己渲染完整的进度与操作区；这里不再重复导航，避免误触清空进度。 */
const quizActive = computed(() => route.name === 'quiz')
/** 首页/关于页不显示"开始测试"，避免在使用其它入口时被误点到。 */
const showStartLink = computed(() => {
  if (route.name === 'quiz') return false
  if (route.name === 'landing') return false
  return true
})

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
        class="mx-auto flex w-full items-center justify-between gap-3 px-3 py-2.5 tablet:px-6 tablet:py-3 laptop:px-8"
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

        <nav class="flex items-center gap-1 text-[13.5px] tablet:gap-3">
          <template v-if="quizActive">
            <RouterLink to="/" class="btn-ghost btn-sm">暂时离开</RouterLink>
          </template>
          <template v-else>
            <RouterLink
              v-if="showStartLink"
              to="/quiz"
              class="btn-ghost btn-sm"
              >开始测试</RouterLink
            >
            <RouterLink
              to="/about"
              class="btn-ghost btn-sm"
              :class="route.name === 'about' ? 'text-primary-700' : ''"
              >{{ route.name === 'about' ? '方法与隐私' : '关于' }}</RouterLink
            >
          </template>
        </nav>
      </div>
    </header>

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
            <p class="fineprint">
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
          </div>
          <nav class="flex flex-wrap items-start gap-x-5 gap-y-2 text-[13.5px]">
            <RouterLink to="/" class="link-quiet">首页</RouterLink>
            <RouterLink to="/about" class="link-quiet">方法与隐私</RouterLink>
            <RouterLink to="/about#records" class="link-quiet">本地记录</RouterLink>
            <a
              :href="activeAttribution.url"
              target="_blank"
              rel="noopener noreferrer nofollow"
              class="link-quiet link-external"
              >原始题目来源</a
            >
          </nav>
        </div>
        <p class="mt-5 fineprint">
          结果仅供自我了解与娱乐参考，不是心理诊断，也不用于招聘或任何筛选。答案只在你的浏览器里参与计算。
        </p>
      </div>
    </footer>
  </div>
</template>
