<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import LikertScale from '@/components/LikertScale.vue'
import PageContainer from '@/components/PageContainer.vue'
import { ANSWER_CAPTIONS } from '@/domain/answers'
import { UNKNOWN_REASONS, UNKNOWN_REASON_LABEL, type UnknownReason } from '@/domain/answers'
import { packageFormat, responseAnchorsOf } from '@/domain/assessmentPackage'

/**
 * 答题页 —— `docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md` §3.2 / §3.3。
 *
 * 本轮的三个必要新增（都来自用户反馈「有些题目看不懂」）：
 *   1. `这题是什么意思？`：在题卡内展开短释义，**展开本身不改变答案或分数**；
 *   2. `暂时无法判断`：独立于五档之外的状态，带一个可不填的原因；它不会被算成 3 分；
 *   3. 交卷前复查：区分「已处理 / 已选择倾向 / 待判断 / 尚未处理」，
 *      有真正未处理的题时**不允许**静默生成报告，但也不强迫用户猜一个数字。
 *
 * 与上一版一致的行为：手机与 PC 都手动「下一题」（没有自动跳题）；答题卡可跳题回改；
 * 数字键 1–5 快捷选择；进度条 = 已处理题数 / 总题数。
 */
const quiz = useQuizStore()
const router = useRouter()

const showCard = ref(false)
const hint = ref<string | null>(null)
const liveMessage = ref('')
const likert = ref<InstanceType<typeof LikertScale> | null>(null)
const questionHeading = ref<HTMLElement | null>(null)
const cardTrigger = ref<HTMLButtonElement | null>(null)
const cardPanel = ref<HTMLElement | null>(null)
const helpPanel = ref<HTMLElement | null>(null)
const helpOpenIds = ref<number[]>([])
/**
 * 无法判断的**可选原因**下标；`-1` 表示不填。
 *
 * ⚠️ 这里用 0 基下标与 `UNKNOWN_REASONS` 对齐。此前模板给 `<option>` 写的是
 * `index + 1`、提交时用 `UNKNOWN_REASONS[value]`，于是用户选中的原因整体错位一位
 * （选「两边都不适用」会存成 `unsure`）。索引与值必须是同一个口径。
 */
const unknownReasonId = ref(-1)
const showReview = ref(false)
let hintTimer: ReturnType<typeof setTimeout> | undefined

const total = computed(() => quiz.total)
const questionIndex = computed(() => quiz.currentIndex)
const question = computed(() => quiz.currentQuestion)
const processed = computed(() => quiz.processedCount)
const ratings = computed(() => quiz.ratingCount)
const unknowns = computed(() => quiz.unknownCount)
const unanswered = computed(() => quiz.unansweredCount)
const missing = computed(() => quiz.missingCount)
const firstUnanswered = computed(() => quiz.firstUnansweredIndex)
const allProcessed = computed(() => quiz.isProcessed)
const blocked = computed(() => quiz.writesBlocked)
const questionNumber = computed(() => questionIndex.value + 1)
const progressPercent = computed(() => Math.round(quiz.progressRatio * 100))
const isLast = computed(() => total.value > 0 && questionIndex.value === total.value - 1)

/** 当前题的作答（数字评分 / 无法判断 / 未处理）。 */
const selected = computed(() =>
  question.value ? (quiz.responses[question.value.id] ?? null) : null,
)
const selectedRating = computed(() =>
  selected.value?.kind === 'rating' ? selected.value.value : null,
)
const isUnknown = computed(() => selected.value?.kind === 'unknown')

/**
 * 作答格式与五档文案都来自内容包：
 *   - OEJTS 是双极选择（1 明显偏左 … 5 明显偏右）；
 *   - IPIP 大五是单句贴切度（1 非常不贴切 … 5 非常贴切）。
 */
const questionFormat = computed(() =>
  quiz.activePackage ? packageFormat(quiz.activePackage) : 'bipolar',
)
const anchors = computed(() =>
  quiz.activePackage ? responseAnchorsOf(quiz.activePackage) : null,
)
const isAgreement = computed(() => questionFormat.value === 'agreement')

function captionOf(value: number): string {
  if (isAgreement.value && anchors.value) return anchors.value[value - 1] ?? ANSWER_CAPTIONS[value]
  return ANSWER_CAPTIONS[value]
}

const questionPrompt = computed(() =>
  isAgreement.value ? '这句描述对你有多贴切？' : '哪一侧更接近平常的你？',
)

/** 当前题的帮助文字（来自本轮锁定内容包，不在线生成）。 */
const helpText = computed(() => {
  const current = question.value
  if (!current) return ''
  return quiz.activePackage?.itemHelp[String(current.id)]?.explanation ?? ''
})
const helpOpen = computed(() => (question.value ? helpOpenIds.value.includes(question.value.id) : false))

/** 待判断题号（答题卡与复查区共用）。 */
const unknownIds = computed(() =>
  quiz.questions
    .filter((item) => quiz.responses[item.id]?.kind === 'unknown')
    .map((item) => questionPosition(item.id)),
)
const unansweredIds = computed(() => quiz.unansweredQuestions.map((item) => questionPosition(item.id)))

const interlude = computed(() => {
  const ordinal = questionIndex.value + 1
  if (ordinal === 8) return '已完成四分之一'
  if (ordinal === 16) return '已完成一半，可随时回改'
  if (ordinal === 24) return '还剩 8 题'
  return null
})

function questionPosition(id: number): number {
  return quiz.questions.findIndex((item) => item.id === id) + 1
}

function stateOf(id: number): 'rating' | 'unknown' | 'unanswered' {
  const response = quiz.responses[id]
  if (!response) return 'unanswered'
  return response.kind === 'rating' ? 'rating' : 'unknown'
}

function stateLabel(id: number): string {
  const state = stateOf(id)
  if (state === 'rating') return '已选倾向'
  if (state === 'unknown') return '待判断'
  return '未处理'
}

function flash(message: string) {
  hint.value = message
  liveMessage.value = message
  if (hintTimer !== undefined) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    hint.value = null
  }, 4600)
}

async function focusHeading() {
  await nextTick()
  questionHeading.value?.focus()
}

function scrollToHeading() {
  void nextTick().then(() => {
    questionHeading.value?.scrollIntoView?.({ block: 'center', behavior: 'auto' })
  })
}

function onSelect(value: number) {
  const current = question.value
  if (!current || blocked.value) return
  quiz.selectRating(current.id, value)
  hint.value = null
}

function onSelectUnknown() {
  const current = question.value
  if (!current || blocked.value) return
  const reason =
    unknownReasonId.value >= 0 ? (UNKNOWN_REASONS[unknownReasonId.value] as UnknownReason) : null
  quiz.selectUnknown(current.id, reason ?? null)
  hint.value = null
  liveMessage.value = `第 ${questionNumber.value} 题已标记为暂时无法判断`
}

/** 帮助展开：只影响界面，不改变回答、处理数量、完成时间或分数。 */
function toggleHelp() {
  const current = question.value
  if (!current) return
  const open = helpOpenIds.value.includes(current.id)
  helpOpenIds.value = open
    ? helpOpenIds.value.filter((id) => id !== current.id)
    : [...helpOpenIds.value, current.id]
  if (!open) {
    void nextTick().then(() => helpPanel.value?.focus())
  }
}

function goPrev() {
  if (questionIndex.value <= 0) return
  quiz.prev()
  void focusHeading()
}

/** 进入下一题。**不自动前进**：只有用户点按钮或按快捷键才会走到这里。 */
function goNext() {
  if (selected.value === null) {
    flash('先选择一个位置，或标记「暂时无法判断」')
    return
  }
  if (isLast.value) {
    finish()
    return
  }
  quiz.next()
  void focusHeading()
}

function jumpTo(target: number) {
  quiz.goTo(target)
  closeCard()
  void focusHeading()
  scrollToHeading()
}

function jumpToId(id: number) {
  quiz.goToId(id)
  closeCard()
  void focusHeading()
  scrollToHeading()
}

function jumpToFirstUnanswered() {
  if (firstUnanswered.value < 0) return
  jumpTo(firstUnanswered.value)
}

/* ── 交卷：先复查，再导航。没有隐式补答，也没有假进度。 ───────────────── */

const submitting = ref(false)

function finish() {
  if (submitting.value) return
  if (blocked.value) {
    flash('另一页面已更新这次测试，请先「载入最新进度」再交卷。')
    return
  }
  if (!allProcessed.value) {
    // 未处理的题必须显式选择数字或「暂时无法判断」；这里只提示并打开复查区
    showReview.value = true
    flash(`还有 ${missing.value} 题尚未处理，可以在下面定位并补答。`)
    return
  }
  if (unknowns.value > 0) {
    showReview.value = true
    liveMessage.value = `有 ${unknowns.value} 题暂时无法判断，部分维度将暂不判型`
    return
  }
  confirmSubmit()
}

function confirmSubmit() {
  if (!quiz.submit()) {
    flash('还有题目尚未处理，先补齐再查看报告。')
    return
  }
  submitting.value = true
  void router.push({ name: 'result' })
}

function finishFromCard() {
  closeCard()
  finish()
}

/* ── 答题卡抽屉（手机） ───────────────────────────────────────────────── */

async function openCard() {
  showCard.value = true
  await nextTick()
  cardPanel.value?.querySelector<HTMLElement>('.qnum')?.focus()
}

function closeCard() {
  if (!showCard.value) return
  showCard.value = false
  void nextTick().then(() => cardTrigger.value?.focus())
}

function onCardKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeCard()
    return
  }
  if (event.key !== 'Tab') return
  const items = cardPanel.value?.querySelectorAll<HTMLElement>('button:not([disabled])')
  if (!items || items.length === 0) return
  const list = Array.from(items)
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

/* ── 键盘快捷键 ──────────────────────────────────────────────────────── */

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable === true
  )
}

function onKeydown(event: KeyboardEvent) {
  if (showCard.value) return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (typeof event.isComposing === 'boolean' && event.isComposing) return
  if (isTypingTarget(event.target)) return

  if (event.key >= '1' && event.key <= '5') {
    const current = question.value
    if (!current) return
    event.preventDefault()
    onSelect(Number(event.key))
    void nextTick().then(() => likert.value?.focusSelected())
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goPrev()
    return
  }
  if (event.key === 'ArrowRight') {
    if ((event.target as HTMLElement | null)?.closest('[role="radiogroup"]')) return
    event.preventDefault()
    goNext()
    return
  }
  if (event.key === 'Enter') {
    if ((event.target as HTMLElement | null)?.tagName === 'BUTTON') return
    event.preventDefault()
    goNext()
  }
}

async function onLikertAnnounce(message: string) {
  liveMessage.value = message
  await nextTick()
  await likert.value?.focusSelected()
}

/**
 * 内部报错（包 ID、接口、内置副本之类的字眼）只在开发环境显示；
 * 部署版给访客看的是上面那句普通说明，细节留在控制台里。
 */
const showInternalError = import.meta.env.DEV

async function retryLoad() {
  await quiz.load(quiz.packageId ?? undefined)
  if (!quiz.activePackage) return
  if (!quiz.currentQuestionId) quiz.goTo(0)
}

watch(questionIndex, () => {
  hint.value = null
  if (showCard.value) closeCard()
})

watch(
  () => quiz.processedCount,
  () => {
    if (allProcessed.value && unknowns.value === 0) showReview.value = false
  },
)

onMounted(async () => {
  if (!quiz.activePackage) await quiz.load()
  if (!quiz.activePackage) return
  if (!quiz.currentQuestionId) quiz.goTo(0)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  if (hintTimer !== undefined) clearTimeout(hintTimer)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!-- 题目没准备好：错误态 = 标题 + 原因概述 + 一个首要恢复按钮 -->
  <PageContainer v-if="!quiz.activePackage" page="quiz" tight class="py-10">
    <div class="mx-auto max-w-[32rem] text-center">
      <h1 class="font-display text-[22px] font-bold text-ink">
        {{ quiz.loading ? '正在准备题目' : '题目没有准备好' }}
      </h1>
      <p class="mt-2 prose-sm">
        {{
          quiz.loading
            ? '马上就好，不需要刷新页面。'
            : '题目暂时没有加载成功。可以重试，或先回到首页。'
        }}
      </p>
      <p
        v-if="quiz.loadError && !quiz.loading && showInternalError"
        class="notice-neutral mt-3 text-[13px] leading-relaxed"
      >
        {{ quiz.loadError }}
      </p>
      <div class="mt-5 flex flex-col-reverse gap-2 tablet:flex-row tablet:justify-center">
        <RouterLink to="/" class="btn-secondary">回到首页</RouterLink>
        <button v-if="!quiz.loading" type="button" class="btn-primary" @click="retryLoad">
          重试
        </button>
      </div>
    </div>
  </PageContainer>

  <PageContainer v-else page="quiz" tight class="pad-action-bar py-4 tablet:py-6 laptop:pb-10">
    <div class="laptop:grid laptop:grid-cols-[17rem_minmax(0,1fr)] laptop:items-start laptop:gap-8">
      <!-- ── 左栏（PC 常驻）：进度 + 答题卡 ───────────────────────────── -->
      <aside class="hidden laptop:sticky laptop:top-20 laptop:block">
        <p class="text-[15px] font-medium text-ink">
          已处理 <span class="font-display text-[18px] font-bold">{{ processed }}</span> /
          {{ total }}
        </p>
        <div
          class="mt-2 h-2 w-full overflow-hidden rounded-full bg-line-soft"
          role="progressbar"
          :aria-valuenow="progressPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`作答进度 ${progressPercent}%`"
        >
          <div
            class="h-full rounded-full bg-primary-600 transition-[width] duration-200"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <p class="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
          已选择倾向 {{ ratings }} · 待判断 {{ unknowns }} · 尚未处理 {{ unanswered }}
        </p>

        <h2 class="mt-6 text-[14px] font-semibold text-ink">答题卡</h2>
        <p class="mt-1 fineprint">点题号可以直接跳过去修改。</p>
        <div class="mt-3 grid grid-cols-6 gap-1.5">
          <button
            v-for="item in quiz.questions"
            :key="item.id"
            type="button"
            class="qnum"
            :class="[
              item.id === quiz.currentQuestionId ? 'qnum-current' : '',
              item.id === quiz.currentQuestionId
                ? ''
                : stateOf(item.id) === 'rating'
                  ? 'qnum-answered'
                  : stateOf(item.id) === 'unknown'
                    ? 'qnum-unknown'
                    : 'qnum-unanswered',
            ]"
            :aria-current="item.id === quiz.currentQuestionId ? 'step' : undefined"
            :aria-label="`第 ${questionPosition(item.id)} 题，${stateLabel(item.id)}${
              item.id === quiz.currentQuestionId ? '，当前题' : ''
            }`"
            @click="jumpToId(item.id)"
          >
            {{ questionPosition(item.id) }}
            <svg
              v-if="stateOf(item.id) !== 'unanswered' && item.id !== quiz.currentQuestionId"
              class="absolute -right-0.5 -top-0.5 h-3 w-3"
              :class="stateOf(item.id) === 'unknown' ? 'text-accent-500' : 'text-primary-500'"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="6" fill="currentColor" />
            </svg>
          </button>
        </div>

        <div class="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
          <p class="text-[13.5px] text-ink-soft">
            已处理 {{ processed }} / {{ total }}
            <template v-if="unanswered > 0">
              · <span class="text-accent-600">还差 {{ unanswered }} 题</span>
            </template>
          </p>
          <button
            v-if="unanswered > 0"
            type="button"
            class="link-quiet text-[13px]"
            @click="jumpToFirstUnanswered"
          >
            去第一道未处理题
          </button>
        </div>
      </aside>

      <!-- ── 右栏 / 手机主区：进度条 + 题卡 ───────────────────────────── -->
      <div>
        <div class="laptop:hidden">
          <div class="flex items-baseline justify-between gap-3">
            <p class="text-[14px] font-medium text-ink">
              第 <span class="font-display text-[17px] font-bold">{{ questionNumber }}</span> /
              {{ total }} 题
            </p>
            <p class="text-[13px] text-ink-soft">已处理 {{ processed }}/{{ total }}</p>
          </div>
          <div
            class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line-soft"
            role="progressbar"
            :aria-valuenow="progressPercent"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="`作答进度 ${progressPercent}%`"
          >
            <div
              class="h-full rounded-full bg-primary-600 transition-[width] duration-200"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
        </div>

        <p
          v-if="interlude"
          class="animate-fade-in mt-4 rounded-control bg-paper-soft px-4 py-2.5 text-[13.5px] text-ink-soft"
          role="status"
        >
          {{ interlude }}
        </p>

        <p v-if="blocked" class="notice-uncertain mt-4 text-[13.5px] leading-relaxed" role="alert">
          另一页面已更新这次测试，本页暂停保存新的选择。请先在页面顶部选择「载入最新进度」。
        </p>

        <!-- 本地数据被写坏：如实说明，并让用户重新选择来修复（不静默丢弃、不当成没答）
             （`docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §2.1 / INPUT-02） -->
        <p
          v-if="quiz.corruptResponseIds.length > 0"
          class="notice-uncertain mt-4 text-[13.5px] leading-relaxed"
          role="alert"
        >
          有 {{ quiz.corruptResponseIds.length }} 条作答记录无法识别（第
          {{ quiz.corruptResponseIds.join('、') }} 题，可能是本地数据被写坏）。
          这些题会按「尚未处理」显示，重新选择一次即可修复；其余作答会保留。
        </p>

        <!-- ── 题卡：两端描述 + 五档 + 帮助 + 无法判断 ────────────────── -->
        <section
          v-if="question"
          :key="question.id"
          class="mt-4 rounded-question border border-line bg-surface px-4 py-5 tablet:px-7 tablet:py-7"
          aria-labelledby="question-heading"
        >
          <p
            id="question-heading"
            ref="questionHeading"
            tabindex="-1"
            class="text-[14px] font-medium text-ink-soft focus:outline-none"
          >
            <span class="sr-only">第 {{ questionNumber }} 题，共 {{ total }} 题。</span>
            {{ questionPrompt }}
          </p>

          <LikertScale
            ref="likert"
            class="mt-3"
            :model-value="selectedRating"
            :format="questionFormat"
            :text-left="question.textLeft"
            :text-right="question.textRight"
            :statement="question.text"
            :anchors="anchors"
            :disabled="blocked"
            @update:model-value="onSelect"
            @announce="onLikertAnnounce"
          />

          <!-- 这题是什么意思？（题卡内展开，展开本身不改变答案） -->
          <div class="mt-4 border-t border-line pt-3.5">
            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-[14px] font-medium text-primary-700"
              :aria-expanded="helpOpen"
              :aria-controls="`question-help-${question.id}`"
              @click="toggleHelp"
            >
              这题是什么意思？
              <span aria-hidden="true">{{ helpOpen ? '▴' : '▾' }}</span>
            </button>
            <div
              v-if="helpOpen"
              :id="`question-help-${question.id}`"
              ref="helpPanel"
              tabindex="-1"
              class="mt-2 rounded-control bg-primary-50 px-3.5 py-3 focus:outline-none"
            >
              <p class="text-[13.5px] leading-[1.75] text-ink-soft">{{ helpText }}</p>
            </div>
          </div>

          <!-- 暂时无法判断：独立于五档，不会被算成 3 分 -->
          <div class="mt-3.5 rounded-control border border-line bg-paper-soft px-3.5 py-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[13.5px] font-medium text-ink">看不懂、没有相关经历，或两边都不适用？</p>
                <p class="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
                  可以保留「暂时无法判断」。它不是错误，也不会被算成 3 分；
                  相关维度会显示信息不足，其余维度照常给结果。
                </p>
              </div>
              <button
                type="button"
                class="btn-secondary btn-sm shrink-0"
                :class="isUnknown ? 'ring-2 ring-accent-400' : ''"
                :disabled="blocked"
                :aria-pressed="isUnknown"
                @click="onSelectUnknown"
              >
                {{ isUnknown ? '已标记：暂时无法判断' : '暂时无法判断' }}
              </button>
            </div>
            <label class="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
              <span>原因（可不填）：</span>
              <select
                v-model.number="unknownReasonId"
                class="rounded-control border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
              >
                <option :value="-1">不填</option>
                <option v-for="(reason, index) in UNKNOWN_REASONS" :key="reason" :value="index">
                  {{ UNKNOWN_REASON_LABEL[reason] }}
                </option>
              </select>
              <span class="text-ink-faint">原因只留在本机，用于你自己回顾。</span>
            </label>
          </div>

          <!-- 保存状态 / 固定短提示 -->
          <p
            class="mt-4 min-h-[1.25rem] text-[13px] leading-relaxed"
            :class="hint ? 'text-accent-600' : 'text-ink-faint'"
            role="status"
            aria-live="polite"
          >
            <template v-if="hint">{{ hint }}</template>
            <template v-else-if="blocked">暂停保存：请先载入最新进度。</template>
            <template v-else-if="isUnknown">已保存到这台浏览器：这题暂时无法判断。</template>
            <template v-else-if="selectedRating !== null">
              已保存到这台浏览器：{{ captionOf(selectedRating) }}。
            </template>
            <template v-else>先选择一个位置，或标记「暂时无法判断」，再点「下一题」。</template>
          </p>

          <!-- PC 操作行 -->
          <div class="mt-2 hidden items-center gap-3 laptop:flex">
            <button type="button" class="btn-secondary" :disabled="questionIndex === 0" @click="goPrev">
              上一题
            </button>
            <div class="flex-1" />
            <button v-if="allProcessed && !isLast" type="button" class="btn-ghost" @click="finish">
              查看报告
            </button>
            <button v-if="!isLast" type="button" class="btn-primary min-w-[8rem]" @click="goNext">
              下一题
            </button>
            <template v-else>
              <button v-if="unanswered > 0" type="button" class="btn-secondary" @click="jumpToFirstUnanswered">
                去补答
              </button>
              <button type="button" class="btn-primary min-w-[9rem]" @click="finish">
                {{ unanswered > 0 ? `还差 ${unanswered} 题` : '查看报告' }}
              </button>
            </template>
          </div>
        </section>

        <!-- ── 交卷前复查区（§3.3） ──────────────────────────────────── -->
        <section
          v-if="showReview"
          class="mt-4 rounded-question border border-accent-200 bg-accent-100/60 px-4 py-4 tablet:px-5"
          aria-labelledby="review-heading"
        >
          <h2 id="review-heading" class="text-[15px] font-semibold text-ink">交卷前看一下</h2>
          <ul class="mt-2 space-y-1 text-[13.5px] leading-relaxed text-ink-soft">
            <li>已处理：{{ processed }} / {{ total }} 题（数字答案 {{ ratings }} 题、待判断 {{ unknowns }} 题）</li>
            <li v-if="unanswered > 0">
              尚未处理 {{ unanswered }} 题：第 {{ unansweredIds.join('、') }} 题。
              这些题需要你选择数字或标记「暂时无法判断」，系统不会替你猜一个答案。
            </li>
            <li v-if="unknowns > 0">
              有 {{ unknowns }} 题暂时无法判断，部分维度将暂不判型。待判断题：第
              {{ unknownIds.join('、') }} 题。
            </li>
            <li v-if="unknowns === 0 && unanswered === 0">32 题都形成了可计分的数字答案。</li>
          </ul>
          <div class="mt-3 flex flex-col gap-2 tablet:flex-row">
            <button
              v-if="unanswered > 0"
              type="button"
              class="btn-primary"
              @click="jumpToFirstUnanswered"
            >
              去第一道未处理题
            </button>
            <button v-else type="button" class="btn-primary" @click="confirmSubmit">
              按现有答案查看报告
            </button>
            <button type="button" class="btn-secondary" @click="showReview = false">回去看看</button>
          </div>
        </section>

        <p class="mt-3 hidden fineprint laptop:block">
          数字键 1–5 直接选择，方向键在五个选项间移动；这里不会自动跳题，选完点「下一题」。
        </p>
      </div>
    </div>

    <!-- ── 手机/平板底部固定操作条 ────────────────────────────────────── -->
    <div class="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/97 backdrop-blur laptop:hidden">
      <div class="safe-bottom mx-auto w-full max-w-shell-quiz px-3 pb-2.5 pt-2.5 tablet:px-6">
        <p
          v-if="unanswered > 0 && questionIndex >= total - 1"
          class="mb-2 text-center text-[13px] text-accent-600"
        >
          还差 {{ unanswered }} 题
        </p>
        <div class="flex items-stretch gap-2">
          <button
            type="button"
            class="btn-secondary btn-sm flex-1"
            :disabled="questionIndex === 0"
            @click="goPrev"
          >
            上一题
          </button>
          <button ref="cardTrigger" type="button" class="btn-secondary btn-sm flex-1" @click="openCard">
            答题卡
          </button>
          <button v-if="!isLast" type="button" class="btn-primary btn-sm flex-[1.4]" @click="goNext">
            下一题
          </button>
          <template v-else>
            <button v-if="unanswered > 0" type="button" class="btn-secondary btn-sm flex-1" @click="jumpToFirstUnanswered">
              去补答
            </button>
            <button type="button" class="btn-primary btn-sm flex-[1.4]" @click="finish">
              {{ unanswered > 0 ? `还差 ${unanswered} 题` : '查看报告' }}
            </button>
          </template>
        </div>
      </div>
    </div>

    <!-- ── 答题卡抽屉（手机/平板） ────────────────────────────────────── -->
    <div
      v-if="showCard"
      class="fixed inset-0 z-50 flex items-end bg-ink/45 laptop:hidden"
      @click.self="closeCard"
    >
      <div
        ref="cardPanel"
        role="dialog"
        aria-modal="true"
        aria-label="答题卡"
        class="animate-sheet-up flex w-full flex-col rounded-t-cover border-t border-line bg-surface"
        :style="{ maxHeight: '75dvh' }"
        @keydown="onCardKeydown"
      >
        <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 class="text-[16px] font-semibold text-ink">答题卡</h2>
            <p class="text-[13px] text-ink-soft">
              已处理 {{ processed }} / {{ total }}（待判断 {{ unknowns }}）
            </p>
          </div>
          <button type="button" class="btn-secondary btn-sm" @click="closeCard">关闭</button>
        </div>

        <div class="flex-1 overflow-y-auto px-4 py-4">
          <div class="grid grid-cols-6 gap-2 tablet:grid-cols-8">
            <button
              v-for="item in quiz.questions"
              :key="item.id"
              type="button"
              class="qnum"
              :class="[
                item.id === quiz.currentQuestionId ? 'qnum-current' : '',
                item.id === quiz.currentQuestionId
                  ? ''
                  : stateOf(item.id) === 'rating'
                    ? 'qnum-answered'
                    : stateOf(item.id) === 'unknown'
                      ? 'qnum-unknown'
                      : 'qnum-unanswered',
              ]"
              :aria-current="item.id === quiz.currentQuestionId ? 'step' : undefined"
              :aria-label="`第 ${questionPosition(item.id)} 题，${stateLabel(item.id)}${
                item.id === quiz.currentQuestionId ? '，当前题' : ''
              }`"
              @click="jumpToId(item.id)"
            >
              {{ questionPosition(item.id) }}
            </button>
          </div>

          <p class="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
            深色圆点＝已选倾向，橙色圆点＝待判断。尚未处理的题需要用数字或「暂时无法判断」处理。
          </p>
          <p v-if="unanswered > 0" class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            还没有处理的题：<span class="text-accent-600">{{ unanswered }}</span> 题。
          </p>
          <p v-else-if="unknowns > 0" class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            有 {{ unknowns }} 题标记为「暂时无法判断」，相关维度会显示信息不足。
          </p>
        </div>

        <div class="safe-bottom border-t border-line px-4 py-3">
          <button v-if="unanswered > 0" type="button" class="btn-secondary btn-block" @click="jumpToFirstUnanswered">
            去第一道未处理题（第 {{ firstUnanswered + 1 }} 题）
          </button>
          <button v-else type="button" class="btn-primary btn-block" @click="finishFromCard">
            查看报告
          </button>
        </div>
      </div>
    </div>

    <p class="sr-only" aria-live="polite">{{ liveMessage }}</p>
  </PageContainer>
</template>
