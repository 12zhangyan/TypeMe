<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import LikertScale from '@/components/LikertScale.vue'
import { onSessionExpired, type ErrorDisplay } from '@/api/v3'
import { BIG_FIVE_ANCHORS } from '@/domain/answers'
import { questionExample } from '@/domain/readingCompanion'
import type { ItemView } from '@/api/platformV3'
import { useBigFiveStore } from '@/stores/bigFiveV3'

/**
 * 大五倾向测评的答题页。
 *
 * ## 为什么不是把 `AssessView` 改造成通用答题页
 *
 * `AssessView` 里有十六型特有的一整套逻辑：主测与补充题两轮、按维度触发补充、
 * 覆盖度检查、"跳过补充题"、以及 4 个维度各自的进度。这些在大五上都不存在，
 * 而把它们逐条改成 `if (kind === ...)` 之后，任何一次修改都要同时验证两条路径。
 * 这里共用的是**组件与样式**（`LikertScale`、`PageContainer`、`.card`），
 * 不是把两套完成规则塞进一个文件。
 *
 * ## 三件必须做对的事
 *
 * 1. **"未保存"不许显示成"已保存"**：页头一直显示未保存条数与最后一次保存时间；
 *    自动保存（换题 / 离开页面）失败时把原因留在页面上，本地答案不丢。
 * 2. **离开页面先保存**：路由守卫里等一次保存，失败就让用户决定
 *    是留下还是带着未保存的答案离开（草稿还在服务端，但这次改动会丢）。
 * 3. **冲突不静默覆盖**：409 之后停掉自动保存，把"另一台设备改过"写在最上面，
 *    只提供"重新载入"这一个明确动作。
 */

const route = useRoute()
const router = useRouter()
const store = useBigFiveStore()

/** 答题页每次只显示一题：单题视图在 320px 下也不会出现需要横向滚动的长列表。 */
const index = ref(0)
const announce = ref('')
const banner = ref<ErrorDisplay | null>(null)
const leaveDialog = ref(false)
let leaveResolve: ((value: boolean) => void) | null = null
const leavePanel = ref<HTMLElement | null>(null)
const leaveStayButton = ref<HTMLButtonElement | null>(null)
const conflictSelected = ref<string[]>([])
let previouslyFocused: HTMLElement | null = null
let unsubscribe: (() => void) | null = null

const attemptId = computed(() => {
  const value = route.params.attemptId
  return typeof value === 'string' && value !== '' ? value : null
})

const attempt = computed(() => store.attempt)
const items = computed<ItemView[]>(() => attempt.value?.items ?? [])
const current = computed<ItemView | null>(() => items.value[index.value] ?? null)
const readingExample = computed(() => questionExample(attempt.value?.packageId, current.value))

/** 本题当前的作答（rating / unknown / 未处理）。 */
const currentAnswer = computed(() => {
  const item = current.value
  if (!item) return null
  return store.answers[item.id] ?? null
})

const currentRating = computed(() => {
  const answer = currentAnswer.value
  return answer?.kind === 'RATING' ? answer.rating : null
})

const isUnknown = computed(() => currentAnswer.value?.kind === 'UNKNOWN')

const answeredCount = computed(() => store.answeredCount)
const totalCount = computed(() => items.value.length)
const progressPercent = computed(() =>
  totalCount.value === 0 ? 0 : Math.round((answeredCount.value / totalCount.value) * 100),
)

const missingLocally = computed(() => store.missingQuestionIds)

/** 未处理的题里，第一题的下标（用来把"回到第一道没答的"变成一次点击）。 */
function firstUnansweredIndex(): number {
  const missing = new Set(missingLocally.value)
  const found = items.value.findIndex((item) => missing.has(item.id))
  return found >= 0 ? found : 0
}

const canSubmit = computed(
  () => attempt.value !== null && !store.submitting && !store.conflict && missingLocally.value.length === 0,
)

const isSubmitted = computed(() => attempt.value?.status === 'SUBMITTED')

/* ── 载入 ───────────────────────────────────────────────────────────────── */

async function load(): Promise<void> {
  if (!attemptId.value) return
  try {
    await store.load(attemptId.value)
    // 回到上次答到的位置：换设备之后"接着答"才是真的接着。
    const saved = attempt.value?.currentQuestionId ?? null
    const savedIndex = saved ? items.value.findIndex((item) => item.id === saved) : -1
    index.value = savedIndex >= 0 ? savedIndex : firstUnansweredIndex()
    if (isSubmitted.value && attempt.value?.reportId) {
      await router.replace({ name: 'big-five-report', params: { reportId: attempt.value.reportId } })
    }
  } catch {
    // loadError 已写入 store，页面模板负责显示
  }
}

onMounted(() => {
  unsubscribe = onSessionExpired((display) => {
    banner.value = display
  })
  void load()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('keydown', onLeaveKeydown, true)
  removeLeaveGuard()
  leaveResolve?.(false)
})

function onBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}

watch(
  () => store.unsavedCount,
  (count) => {
    if (count > 0) window.addEventListener('beforeunload', onBeforeUnload)
    else window.removeEventListener('beforeunload', onBeforeUnload)
  },
)

watch(leaveDialog, async (open) => {
  if (open) {
    previouslyFocused = document.activeElement as HTMLElement | null
    await nextTick()
    leaveStayButton.value?.focus()
    document.addEventListener('keydown', onLeaveKeydown, true)
  } else {
    document.removeEventListener('keydown', onLeaveKeydown, true)
    previouslyFocused?.focus?.()
    previouslyFocused = null
  }
})

function onLeaveKeydown(event: KeyboardEvent): void {
  if (!leaveDialog.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    resolveLeave(false)
    return
  }
  if (event.key !== 'Tab' || !leavePanel.value) return
  const focusable = Array.from(
    leavePanel.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

/* ── 作答 ───────────────────────────────────────────────────────────────── */

function choose(rating: number): void {
  if (store.submitting || isSubmitted.value || store.conflict) return
  const item = current.value
  if (!item) return
  store.setAnswer(item.id, 'RATING', rating)
  announce.value = `第 ${index.value + 1} 题记为：${BIG_FIVE_ANCHORS[rating - 1] ?? rating}`
  // 选完不自动跳题：用户可能需要改上一题，自动跳转会让"想改"变成"回退一次"。
}

function chooseUnknown(): void {
  if (store.submitting || isSubmitted.value || store.conflict) return
  const item = current.value
  if (!item) return
  if (isUnknown.value) {
    // 再点一次撤销：让"说不好"不会变成一个撤不掉的坑。
    store.clearAnswer(item.id)
    announce.value = `第 ${index.value + 1} 题已恢复为未作答`
    return
  }
  store.setAnswer(item.id, 'UNKNOWN', null)
  announce.value = `第 ${index.value + 1} 题记为：说不好`
}

async function go(delta: number): Promise<void> {
  if (store.saving || store.submitting) return
  const next = index.value + delta
  if (next < 0 || next >= items.value.length) return
  // 换题时顺手保存：这是最自然的自动保存时机，且不需要额外的定时器。
  await flush(true)
  index.value = next
  store.rememberCurrentQuestion(items.value[next].id)
}

async function jumpTo(index2: number): Promise<void> {
  if (store.saving || store.submitting) return
  if (index2 === index.value) return
  await flush(true)
  index.value = index2
}

/** 保存当前未保存的改动；失败时把原因放进页头提示（不打断答题）。 */
async function flush(quiet = false): Promise<boolean> {
  if (store.conflict) return false
  const item = current.value
  if (item) store.rememberCurrentQuestion(item.id)
  const ok = await store.saveNow()
  if (!ok && !quiet) {
    // 由模板上的 store.lastSaveError 显示
  }
  return ok
}

/** 键盘：数字键 1–5 选择，方向键切题（题内方向键由 LikertScale 自己处理并阻止冒泡）。 */
function onKeydown(event: KeyboardEvent): void {
  if (leaveDialog.value) return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  if (event.key >= '1' && event.key <= '5') {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    event.preventDefault()
    choose(Number(event.key))
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    if (event.target instanceof HTMLElement && event.target.closest('[role="radiogroup"]')) return
    event.preventDefault()
    void go(-1)
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    if (event.target instanceof HTMLElement && event.target.closest('[role="radiogroup"]')) return
    event.preventDefault()
    void go(1)
  }
}

/* ── 提交 ───────────────────────────────────────────────────────────────── */

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const result = await store.submit()
  if (result?.reportId) {
    await router.push({ name: 'big-five-report', params: { reportId: result.reportId } })
    return
  }
  // 还缺题：直接跳到第一道缺的题上，而不是只给一句"还差 N 题"。
  if (result && result.incompleteQuestionIds.length > 0) {
    const missing = new Set(result.incompleteQuestionIds)
    const target = items.value.findIndex((item) => missing.has(item.id))
    if (target >= 0) index.value = target
  }
}

/* ── 离开页面 ───────────────────────────────────────────────────────────── */

/**
 * 离开前先保存。
 *
 * 保存失败或发生冲突时**不直接放行**：那等于把用户这次的改动悄悄丢掉。
 * 用页面内的对话框问一次，而不是 `window.confirm` —— 后者的文案在移动端浏览器里
 * 会被截断，而"会丢多少条"正是用户判断的依据。
 */
async function protectDeparture(): Promise<boolean> {
  if (store.submitting) return false
  if (!attempt.value || isSubmitted.value) return true
  if (store.unsavedCount === 0 && !store.conflict) {
    // 没有未保存的改动，但仍记一下"做到哪一题"，方便下次继续。
    const item = current.value
    if (item) {
      store.rememberCurrentQuestion(item.id)
      await store.saveNow()
    }
    return true
  }
  const ok = await flush(true)
  if (ok && !store.conflict) return true
  leaveDialog.value = true
  return await new Promise<boolean>((resolve) => {
    leaveResolve = resolve
  })
}

// The router view renders this page as a child, not as a route record component.
const removeLeaveGuard = router.beforeEach((to, from) => {
  if (from.name !== 'assess-attempt' || from.params.attemptId !== store.attempt?.attemptId) return true
  if (to.fullPath === from.fullPath) return true
  // After a confirmed 401, re-authentication is the recovery path. The store keeps
  // pending answers in memory for this account, so a second PATCH cannot help here.
  if (to.name === 'login' && banner.value?.sessionExpired) return true
  return protectDeparture()
})

function resolveLeave(leave: boolean): void {
  leaveDialog.value = false
  leaveResolve?.(leave)
  leaveResolve = null
}

/* ── 冲突 ───────────────────────────────────────────────────────────────── */

async function resolveCheckedConflict(): Promise<void> {
  if (!await store.applyConflictChoices(conflictSelected.value)) return
  conflictSelected.value = []
  const saved = attempt.value?.currentQuestionId ?? null
  const savedIndex = saved ? items.value.findIndex((item) => item.id === saved) : -1
  index.value = savedIndex >= 0 ? savedIndex : firstUnansweredIndex()
}

function answerLabel(kind: string | null | undefined, rating: number | null | undefined): string {
  if (!kind || kind === 'CLEAR') return '未处理'
  if (kind === 'UNKNOWN') return '说不好'
  return BIG_FIVE_ANCHORS[(rating ?? 0) - 1] ?? `第 ${rating} 档`
}

watch(() => store.conflictServer, () => { conflictSelected.value = [] })

watch(
  () => store.attempt?.attemptId,
  () => {
    index.value = 0
  },
)

/** 未处理的题号集合（用于题号条上的标记）。 */
const missingSet = computed(() => new Set(missingLocally.value))
/** 提交返回的缺题集合（服务端口径，可能与本地不同）。 */
const serverMissingSet = computed(() => new Set(store.incompleteQuestionIds))
</script>

<template>
  <PageContainer page="quiz" @keydown="onKeydown">
    <!-- 会话失效：说清楚并给出唯一出口 -->
    <div v-if="banner" class="notice-error mb-4" role="alert" data-bigfive-session-expired>
      <p class="text-[14.5px] font-medium leading-relaxed">{{ banner.message }}</p>
      <RouterLink
        class="btn-primary btn-sm mt-3"
        :to="{ name: 'login', query: { redirect: route.fullPath } }"
      >
        重新登录后继续
      </RouterLink>
    </div>

    <div v-if="store.loadError" class="notice-error" role="alert" data-bigfive-load-error>
      <p class="text-[14.5px] font-medium leading-relaxed">{{ store.loadError }}</p>
      <button type="button" class="btn-ghost btn-sm mt-3" @click="load">
        <AppIcon name="refresh" :size="16" />
        重新载入
      </button>
    </div>

    <p v-else-if="store.loading && !attempt" class="text-[15px] text-ink-soft">正在载入这一份测评…</p>

    <div v-else-if="!attempt" class="notice-neutral text-[14.5px] leading-relaxed" data-bigfive-missing>
      这份测评不存在，或者它不属于当前账号。
      <RouterLink to="/instruments" class="link">回到测评列表</RouterLink>重新开始。
    </div>

    <template v-else>
      <!-- 页头：量表名 + 进度 + 保存状态。三者都是"我做到哪了"的一部分，放在一起。 -->
      <header class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h1 class="text-[20px] font-semibold leading-snug text-ink tablet:text-[23px]">
            {{ attempt.instrumentTitle }}
          </h1>
          <p class="caption mt-1">
            第 {{ index + 1 }} / {{ totalCount }} 题 · 已处理 {{ answeredCount }} 题
          </p>
        </div>
        <p class="caption" data-bigfive-save-state>
          <template v-if="store.conflict">未保存：服务端进度已变化</template>
          <template v-else-if="store.saving">正在保存…</template>
          <template v-else-if="store.unsavedCount > 0">
            有 {{ store.unsavedCount }} 题还没保存
          </template>
          <template v-else-if="store.lastSavedAt">已保存</template>
          <template v-else>改动会自动保存</template>
        </p>
      </header>

      <!-- 进度条：不只是装饰，它是"还剩多少"的唯一即时反馈 -->
      <div
        class="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        :aria-valuenow="progressPercent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`已处理 ${answeredCount} / ${totalCount} 题`"
      >
        <div class="h-full rounded-full bg-primary-600 transition-[width]" :style="{ width: `${progressPercent}%` }" />
      </div>

      <!-- 默认服务端，逐题明确勾选后才允许重新应用本机答案。 -->
      <div v-if="store.conflict" class="notice-uncertain mt-5" role="alert" data-bigfive-conflict>
        <p class="flex items-start gap-2 text-[14.5px] leading-relaxed">
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>{{ store.conflictMessage }}</span>
        </p>
        <p v-if="store.lastSaveError" class="mt-2 text-[13px]">{{ store.lastSaveError }}</p>
        <button type="button" class="btn-secondary btn-sm mt-3" data-bigfive-reload :disabled="store.conflictLoading || store.saving" @click="store.inspectConflict()">
          <AppIcon name="refresh" :size="16" />
          {{ store.conflictLoading ? '正在核对…' : '读取服务端进度并核对' }}
        </button>
        <div v-if="store.conflictServer" class="mt-4" data-bigfive-conflict-choices>
          <p class="text-[13.5px]">默认保留服务端答案。只有勾选的本机答案才会重新应用；勾选“未处理”会清掉服务端那题的作答。</p>
          <ul class="mt-3 grid gap-2">
            <li v-for="change in store.conflictChanges" :key="change.questionId" class="border-t border-line py-2">
              <label class="flex items-start gap-2 text-[14px]">
                <input v-model="conflictSelected" type="checkbox" :value="change.questionId" :disabled="store.saving" class="mt-1" />
                <span>
                  {{ items.findIndex((item) => item.id === change.questionId) + 1 }}. {{ items.find((item) => item.id === change.questionId)?.statement ?? change.questionId }}<br />
                  服务端：{{ answerLabel(change.server?.kind, change.server?.rating) }}；本机：{{ answerLabel(change.local.kind, change.local.rating) }}
                </span>
              </label>
            </li>
          </ul>
          <button type="button" class="btn-primary btn-sm mt-3" data-bigfive-apply-conflict :disabled="store.saving || store.conflictLoading" @click="resolveCheckedConflict">
            {{ store.saving ? '正在确认…' : conflictSelected.length ? `应用选中的 ${conflictSelected.length} 题` : '全部采用服务端答案' }}
          </button>
        </div>
      </div>

      <!-- 保存失败：把原因与"答案还在"一起说清楚 -->
      <div v-else-if="store.lastSaveError" class="notice-error mt-5" role="alert" data-bigfive-save-error>
        <p class="flex items-start gap-2 text-[14.5px] leading-relaxed">
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>
            {{ store.lastSaveError }}
            <span class="mt-1 block">有 {{ store.unsavedCount }} 题未保存，本页作答仍在。</span>
          </span>
        </p>
        <button type="button" class="btn-secondary btn-sm mt-3" @click="flush(false)">
          <AppIcon name="refresh" :size="16" />
          再试一次保存
        </button>
      </div>

      <p v-if="announce" class="sr-only" role="status" aria-live="polite">{{ announce }}</p>

      <!-- 题目卡片 -->
      <section v-if="current" class="card mt-6" :data-bigfive-item="current.id" aria-labelledby="bigfive-question">
        <div class="flex flex-wrap items-center gap-2">
          <span class="chip chip-neutral">日常习惯 · 第 {{ index + 1 }} 题</span>
          <span v-if="missingSet.has(current.id)" class="chip chip-accent">还没作答</span>
          <span v-else-if="serverMissingSet.has(current.id)" class="chip chip-danger">服务端还缺这一题</span>
        </div>

        <div id="bigfive-question" class="mt-4">
          <LikertScale
            :model-value="currentRating"
            :disabled="store.submitting || store.conflict || isSubmitted"
            format="agreement"
            :statement="current.statement ?? ''"
            :anchors="BIG_FIVE_ANCHORS as unknown as string[]"
            @update:model-value="choose"
          >
            <template #reading-help>
              <p v-if="readingExample" class="reading-example" data-question-example><span>这句话在问什么</span>{{ readingExample }}</p>
              <p v-if="index === 0" class="mt-3 text-[13px] leading-relaxed text-ink-soft">按平时的自己回答。</p>
            </template>
          </LikertScale>
        </div>

        <!-- 「说不好」与数字档分开：它不是第 6 档，也不代表中立 -->
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="btn-ghost btn-sm"
            :aria-pressed="isUnknown"
            data-bigfive-unknown
            :disabled="store.submitting || store.conflict || isSubmitted"
            @click="chooseUnknown"
          >
            <AppIcon :name="isUnknown ? 'check' : 'question'" :size="16" />
            {{ isUnknown ? '已记「说不好」（再点一次撤销）' : '说不好' }}
          </button>
          <p class="caption max-w-prose">
            说不好：暂时无法判断，不计分；中间档会计分。
          </p>
        </div>

        <details v-if="current.help" class="mt-5 border-t border-line pt-3">
          <summary class="cursor-pointer text-[13.5px] font-medium text-ink-soft">
            这道题在问什么
          </summary>
          <p class="mt-2 max-w-prose text-[13.5px] leading-relaxed text-ink-soft">{{ current.help }}</p>
        </details>
      </section>

      <!-- 导航 -->
      <div class="quiz-navigation mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-secondary btn-sm"
          :disabled="index === 0 || store.saving || store.submitting"
          data-bigfive-prev
          @click="go(-1)"
        >
          上一题
        </button>
        <button
          type="button"
          class="btn-primary btn-sm"
          :disabled="index >= totalCount - 1 || store.saving || store.submitting"
          data-bigfive-next
          @click="go(1)"
        >
          下一题
        </button>
        <RouterLink to="/instruments" class="btn-ghost btn-sm" data-bigfive-exit>保存并退出</RouterLink>
      </div>

      <!-- 题号条：一眼看出哪几题没处理 -->
      <details class="quiz-index mt-6">
        <summary class="cursor-pointer text-[13.5px] font-medium text-ink-soft">
          题目清单（{{ answeredCount }} / {{ totalCount }} 已处理）
        </summary>
        <ol class="mt-3 flex flex-wrap gap-1.5" data-bigfive-grid>
          <li v-for="(item, itemIndex) in items" :key="item.id">
            <button
              type="button"
              class="chip min-h-[44px] min-w-[44px] justify-center"
              :class="[
                itemIndex === index ? 'chip-primary ring-2 ring-primary-300' : '',
                store.answers[item.id] ? 'chip-success' : 'chip-neutral',
                serverMissingSet.has(item.id) ? 'chip-danger' : '',
              ]"
              :aria-label="`第 ${itemIndex + 1} 题${store.answers[item.id] ? '，已处理' : '，未处理'}`"
              :aria-current="itemIndex === index ? 'true' : undefined"
              :disabled="store.saving || store.submitting"
              @click="jumpTo(itemIndex)"
            >
              {{ itemIndex + 1 }}
            </button>
          </li>
        </ol>
      </details>

      <!-- 提交区 -->
      <section class="quiz-finish card mt-6" aria-labelledby="bigfive-submit">
        <h2 id="bigfive-submit" class="section-title">生成报告</h2>
        <p v-if="missingLocally.length > 0" class="mt-2 text-[14px] leading-relaxed text-ink-soft">
          还有 {{ missingLocally.length }} 题没处理过。五维各需要至少 10 题的有效作答才给方向，
          所以先把它们处理完（选一个数字档，或选「说不好」）。
        </p>
        <p v-else class="mt-2 text-[14px] leading-relaxed text-ink-soft">
          {{ totalCount }} 题都处理过了。报告会分别解释五个方面的倾向，
          也会告诉你哪些地方还看不清楚。
        </p>

        <div v-if="store.submitError" class="notice-error mt-3" role="alert" data-bigfive-submit-error>
          <p class="text-[14.5px] leading-relaxed">{{ store.submitError }}</p>
        </div>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-primary"
            :disabled="!canSubmit"
            data-bigfive-submit
            @click="submit"
          >
            {{ store.submitting ? '正在生成…' : '提交并生成报告' }}
            <AppIcon name="arrow-right" :size="17" />
          </button>
          <button
            v-if="missingLocally.length > 0"
            type="button"
            class="btn-ghost btn-sm"
            data-bigfive-first-missing
            @click="jumpTo(firstUnansweredIndex())"
          >
            回到第一道没答的
          </button>
        </div>
      </section>
    </template>

    <!-- 离开确认：把"会丢几条"写在按钮旁边 -->
    <div
      v-if="leaveDialog"
      ref="leavePanel"
      class="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="bigfive-leave-title"
    >
      <div class="card w-full max-w-md">
        <h2 id="bigfive-leave-title" class="section-title">这次改动还没能保存</h2>
        <p class="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
          {{ store.conflict ? store.conflictMessage : store.lastSaveError || '服务端暂时没能保存你这几题的改动。' }}
        </p>
        <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">
          <template v-if="store.unsavedCount > 0">
            现在离开会丢掉这 {{ store.unsavedCount }} 题的改动（已经保存过的答案不受影响）。
          </template>
          <template v-else>现在离开不会丢答案。</template>
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button ref="leaveStayButton" type="button" class="btn-primary btn-sm" data-bigfive-leave-stay @click="resolveLeave(false)">
            留在这页再试一次
          </button>
          <button type="button" class="btn-ghost btn-sm" data-bigfive-leave-anyway @click="resolveLeave(true)">
            仍然离开
          </button>
        </div>
      </div>
    </div>
  </PageContainer>
</template>
