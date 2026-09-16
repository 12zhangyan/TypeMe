<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import { useAssessmentStore } from '@/stores/assessmentV3'
import { useAuthStore } from '@/stores/auth'
import type { Dimension, Item } from '@/domain/jung/types'
import { DIMENSION_SHORT_NAME } from '@/domain/jung/labels'
import { ANSWER_VALUES } from '@/domain/answers'

/**
 * 新测的五档文案（契约 §7.4 固定为这五个词）。
 *
 * ⚠️ **刻意不复用**旧引擎的 `ANSWER_CAPTIONS`：那是「完全是左边 / 一半一半 / 完全是右边」，
 * 描述的是位置；新测要的是"哪一侧更像你"的程度（很像 / 更像 / 差不多），
 * 两者在"3 分"这一档上的含义不同（旧的是"一半一半"，新的是"两边差不多"）。
 * 契约把文案写死成这五个词，就是为了避免两代产品在同一个控件上说两套话。
 */
const SCALE_CAPTIONS = ['很像左边', '更像左边', '两边差不多', '更像右边', '很像右边'] as const

/** 档位 → 文案（1 基）。 */
function captionOf(value: number): string {
  return SCALE_CAPTIONS[value - 1] ?? ''
}

/**
 * 答题页（新测）—— 契约 `03-AI与前端契约-v1.md` §7.4。
 *
 * ## 与旧答题页一致的一点
 *
 * **选完答案不自动跳题**，必须手动点「下一题」。自动跳题在手机上会让人来不及改主意，
 * 也会让"我到底点上没有"变得不可确认（`views.spec.ts` 里有一条守卫测试专门钉这个）。
 *
 * ## unknown 与「未作答」是两件事
 *
 *   - **未作答**：这一题在服务端根本没有任何记录 → 主测覆盖检查会失败 → 不能出报告；
 *   - **这题我说不好（unknown）**：这是一次**作答**，会写进服务端 → 计入覆盖，不计入分数。
 *
 * 界面上两者必须能一眼区分（未作答显示"还没有作答"，unknown 显示"我说不好 · 不计分"），
 * 因为用户对它们的期待完全不同：前者是"待办"，后者是"已经处理完了"。
 *
 * ## 跨设备草稿
 *
 * 每次作答都带 `expectedRevision` 落库。收到 `409 CONFLICT_REVISION` 时**停止写入**，
 * 明确提示"另一台设备改过进度"，并让用户点一下"载入最新进度"才继续 —— 绝不静默覆盖。
 */

const route = useRoute()
const router = useRouter()
const assessment = useAssessmentStore()
const auth = useAuthStore()

/** 三段式流程：主测 → （可能）补充题说明 → 完成。 */
type Step = 'base' | 'clarify-offer' | 'clarification' | 'needs-review'
const step = ref<Step>('base')

const baseIndex = ref(0)
const clarificationIndex = ref(0)
const hint = ref<string | null>(null)
const liveMessage = ref('')
const loading = ref(false)
const loadFailure = ref<string | null>(null)
const showUnanswered = ref(false)
/** 交卷请求进行中（防连点）。 */
const submitting = ref(false)
const submitNotice = ref<string | null>(null)
/** 覆盖不足时服务端给的"还差哪几维"。 */
const needsReview = ref<{ dimension: Dimension; name: string; note: string }[]>([])

const attemptId = computed(() => (typeof route.params.attemptId === 'string' ? route.params.attemptId : null))
const baseQuestions = computed(() => assessment.baseQuestions)
const clarificationQuestions = computed(() => assessment.scheduledClarificationQuestions)
const totalBase = computed(() => baseQuestions.value.length)
const totalClarification = computed(() => clarificationQuestions.value.length)

/** 当前阶段要显示的题集。 */
const activeQuestions = computed<Item[]>(() =>
  step.value === 'clarification' ? clarificationQuestions.value : baseQuestions.value,
)
const activeIndex = computed(() =>
  step.value === 'clarification' ? clarificationIndex.value : baseIndex.value,
)
const currentQuestion = computed<Item | null>(() => activeQuestions.value[activeIndex.value] ?? null)
const activeNumber = computed(() => activeIndex.value + 1)
const activeTotal = computed(() => activeQuestions.value.length)
const isLastInStage = computed(() => activeTotal.value > 0 && activeIndex.value === activeTotal.value - 1)

const selected = computed(() => {
  const question = currentQuestion.value
  return question ? assessment.answerOf(question.id) : null
})
const selectedRating = computed(() =>
  selected.value?.kind === 'rating' ? (selected.value.rating ?? null) : null,
)
const isUnknown = computed(() => selected.value?.kind === 'unknown')
const isUnanswered = computed(() => selected.value === null)

/** 主测进度：分母固定 48，不倒退。 */
const processedBase = computed(() => assessment.processedBaseCount)
const unansweredBaseIds = computed(() => assessment.unansweredBaseIds)
const clarificationProcessed = computed(() =>
  clarificationQuestions.value.filter((question) => assessment.answerOf(question.id)).length,
)

/** 本地预览：**明确标注为"目前的粗略倾向"**，不是结论。 */
const preview = computed(() => assessment.previewScores)
const previewLines = computed(() => {
  const result = preview.value
  if (!result) return []
  return result.dimensions.map((row) => ({
    dimension: row.dimension,
    name:
      assessment.contentPackage?.dimensions.find((copy) => copy.dimension === row.dimension)?.name ??
      DIMENSION_SHORT_NAME[row.dimension],
    pole: row.computedPole,
    text:
      row.computedPole === null
        ? '目前两边差不多'
        : row.boundary
          ? `目前略偏 ${row.computedPole}`
          : `目前偏向 ${row.computedPole}`,
  }))
})

/** 保存状态三态（契约 §7.4）：正在保存 / 已保存 / 未同步。 */
const saveLabel = computed(() => {
  switch (assessment.saveState) {
    case 'saving':
      return '正在保存…'
    case 'saved':
      return '已保存'
    case 'conflict':
      return '未同步（另一台设备改过进度）'
    case 'error':
      return '未同步（网络或登录已失效）'
    default:
      return '还没有需要保存的内容'
  }
})

const saveTone = computed(() => {
  switch (assessment.saveState) {
    case 'saved':
      return 'text-primary-700'
    case 'conflict':
    case 'error':
      return 'text-accent-700 font-medium'
    default:
      return 'text-ink-faint'
  }
})

const clarificationReason = computed(() => {
  const dimensions = assessment.clarificationDimensions
  if (dimensions.length === 0) return ''
  const names = dimensions
    .map(
      (dimension) =>
        assessment.contentPackage?.dimensions.find((copy) => copy.dimension === dimension)?.name ??
        DIMENSION_SHORT_NAME[dimension],
    )
    .join('、')
  return `${names}这${dimensions.length > 1 ? '几' : '一'}维两边差不多，再问几题才能看出方向。`
})

/* ── 载入 / 断点续答 ─────────────────────────────────────────────────────── */

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await bootstrap()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

async function bootstrap(): Promise<void> {
  loading.value = true
  loadFailure.value = null
  try {
    if (attemptId.value) {
      await assessment.load(attemptId.value)
    } else {
      if (!auth.isAuthenticated) {
        await router.replace({ name: 'login', query: { redirect: '/assess' } })
        return
      }
      const detail = await assessment.create()
      // 用 replace：答题页的 URL 必须能直接分享/刷新续答
      await router.replace({ name: 'assess-attempt', params: { attemptId: detail.attemptId } })
    }
    restorePosition()
  } catch (error) {
    loadFailure.value = error instanceof Error ? error.message : '这份测评没能载入。'
  } finally {
    loading.value = false
  }
}

/**
 * 断点续答的落点选择。
 *
 * 规则刻意简单且可解释：
 *   - 服务端记了 `currentQuestionId` 就回到那一题（用户上次离开的地方）；
 *   - 否则回到第一道**未作答**的主测题；
 *   - 主测全部处理过、且已安排补充题时，直接进入补充阶段。
 */
function restorePosition(): void {
  const remembered = assessment.currentQuestionId
  const base = baseQuestions.value
  if (remembered) {
    const index = base.findIndex((question) => question.id === remembered)
    if (index >= 0) {
      baseIndex.value = index
      step.value = 'base'
      return
    }
    const clarificationIndexFound = clarificationQuestions.value.findIndex(
      (question) => question.id === remembered,
    )
    if (clarificationIndexFound >= 0) {
      clarificationIndex.value = clarificationIndexFound
      step.value = 'clarification'
      return
    }
  }
  const firstUnanswered = base.findIndex((question) => !assessment.answerOf(question.id))
  if (firstUnanswered >= 0) {
    baseIndex.value = firstUnanswered
    step.value = 'base'
    return
  }
  if (clarificationQuestions.value.length > 0) {
    step.value = 'clarification'
    return
  }
  step.value = 'base'
}

/* ── 作答 ───────────────────────────────────────────────────────────────── */

async function chooseRating(value: number): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (assessment.conflict) {
    hint.value = '先处理上方的同步提示，再继续作答（避免把另一台设备的进度覆盖掉）。'
    return
  }
  hint.value = null
  await assessment.select(question.id, 'rating', value)
  announce(`第 ${activeNumber.value} 题已选：${captionOf(value)}。点「下一题」继续。`)
}

async function chooseUnknown(): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (assessment.conflict) {
    hint.value = '先处理上方的同步提示，再继续作答（避免把另一台设备的进度覆盖掉）。'
    return
  }
  hint.value = null
  await assessment.select(question.id, 'unknown')
  announce('已记下「这题我说不好」。这是一次作答，不会计入分数，但不会再算作未作答。')
}

function announce(message: string): void {
  liveMessage.value = message
}

/** 手动前进。未作答时**不前进**，只给可见提示（与旧答题页一致）。 */
async function next(): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (!assessment.answerOf(question.id)) {
    hint.value = '这一题还没有作答。请选一档，或选「这题我说不好」（两者都算处理过这一题）。'
    announce('还没有作答，不能前进。')
    return
  }
  hint.value = null
  if (!isLastInStage.value) {
    // 先记住"我刚刚在哪一题"，再前进：反过来会把下一题的位置写上去，
    // 下次回来就从更后面开始了。
    await assessment.rememberPosition(question.id)
    if (step.value === 'clarification') clarificationIndex.value += 1
    else baseIndex.value += 1
    announce(`第 ${activeNumber.value} 题。`)
    return
  }
  await finishStage()
}

async function previous(): Promise<void> {
  hint.value = null
  if (activeIndex.value === 0) return
  if (step.value === 'clarification') clarificationIndex.value -= 1
  else baseIndex.value -= 1
}

/** 主动跳到某道题（未答题入口用）。 */
async function jumpTo(questionId: string): Promise<void> {
  const baseAt = baseQuestions.value.findIndex((question) => question.id === questionId)
  if (baseAt >= 0) {
    step.value = 'base'
    baseIndex.value = baseAt
    showUnanswered.value = false
    hint.value = null
    await assessment.rememberPosition(questionId)
    return
  }
  const clarificationAt = clarificationQuestions.value.findIndex(
    (question) => question.id === questionId,
  )
  if (clarificationAt >= 0) {
    step.value = 'clarification'
    clarificationIndex.value = clarificationAt
    showUnanswered.value = false
    hint.value = null
  }
}

/** 跳到第一道未作答的主测题。 */
async function jumpToFirstUnanswered(): Promise<void> {
  const first = unansweredBaseIds.value[0]
  if (!first) return
  await jumpTo(first)
}

/* ── 阶段收尾：review → 补充题或直接交卷 ─────────────────────────────────── */

async function finishStage(): Promise<void> {
  if (step.value === 'clarification') {
    await submit(false)
    return
  }
  // 主测结束：先看有没有未答题，再让服务端决定是否安排补充题
  if (unansweredBaseIds.value.length > 0) {
    showUnanswered.value = true
    hint.value = `还有 ${unansweredBaseIds.value.length} 题没有处理，先看完再交卷。`
    announce('主测还有未作答的题。')
    return
  }
  await runReview()
}

async function runReview(): Promise<void> {
  loading.value = true
  try {
    const result = await assessment.runReview()
    if (result.needsReview) {
      needsReview.value = assessment.insufficientDetails()
      step.value = 'needs-review'
      announce('还差几维信息，暂时不能出报告。')
      return
    }
    if (result.clarificationDimensions.length > 0) {
      step.value = 'clarify-offer'
      announce(clarificationReason.value)
      return
    }
    await submit(false)
  } catch (error) {
    hint.value = error instanceof Error ? error.message : '提交前的检查没能完成。'
  } finally {
    loading.value = false
  }
}

async function startClarification(): Promise<void> {
  step.value = 'clarification'
  clarificationIndex.value = 0
  hint.value = null
  announce(`补充题开始，共 ${totalClarification.value} 题。`)
}

/** 跳过补充题：**跳过 ≠ 未答**，如实说明代价。 */
async function skipClarification(): Promise<void> {
  assessment.markClarificationSkipped()
  announce('已选择跳过补充题：这几维只按主测作答说明，方向可能仍然看不清。')
  await submit(true)
}

async function submit(skipped: boolean): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  submitNotice.value = null
  try {
    const result = await assessment.submit({ clarificationSkipped: skipped })
    if (result.status === 'NEEDS_REVIEW') {
      needsReview.value = assessment.insufficientDetails()
      step.value = 'needs-review'
      submitNotice.value = '服务端复核后认为信息还不够，没有生成报告。草稿已经留下，可以接着补答。'
      announce('覆盖不足，未生成报告。')
      return
    }
    if (!result.reportId) {
      submitNotice.value = '服务端没有返回报告编号，暂时无法打开报告。可以稍后在报告列表里查看。'
      announce('提交成功但没有报告编号。')
      return
    }
    await router.push({ name: 'report-detail', params: { reportId: result.reportId } })
  } catch (error) {
    const display = error instanceof Error ? error.message : '提交没能完成。'
    submitNotice.value = display
    announce('提交失败。')
  } finally {
    submitting.value = false
  }
}

/* ── 冲突处理 ───────────────────────────────────────────────────────────── */

async function reloadLatest(): Promise<void> {
  loading.value = true
  try {
    await assessment.reload()
    restorePosition()
    hint.value = null
    announce('已载入另一台设备上的最新进度。')
  } catch (error) {
    hint.value = error instanceof Error ? error.message : '没能载入最新进度。'
  } finally {
    loading.value = false
  }
}

/* ── 键盘 ───────────────────────────────────────────────────────────────── */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * 焦点已经在按钮/链接上时**不**接管 Enter / 空格：
 * 那种情况浏览器自己的"激活"行为更符合预期，接管会让一次按键变成两次操作。
 * 数字键与方向键不受此限制（radio group 内部自己 stopPropagation）。
 */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a, summary, [role="radio"]') !== null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (isTypingTarget(event.target)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  // 数字键 1–5 作答
  const digit = Number.parseInt(event.key, 10)
  if (Number.isInteger(digit) && ANSWER_VALUES.includes(digit)) {
    event.preventDefault()
    void chooseRating(digit)
    return
  }
  const activatable = isActivatable(event.target)
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      void next()
      return
    case 'ArrowLeft':
      event.preventDefault()
      void previous()
      return
    case 'Enter':
      if (activatable) return
      event.preventDefault()
      void next()
      return
    case 'Backspace':
      event.preventDefault()
      void previous()
      return
    default:
      return
  }
}

/** 页面上的维度名（内容包优先）。 */
function dimensionName(dimension: Dimension): string {
  return (
    assessment.contentPackage?.dimensions.find((copy) => copy.dimension === dimension)?.name ??
    DIMENSION_SHORT_NAME[dimension]
  )
}

/** 主测是否全部处理完（决定"完成主测"按钮是否可用）。 */
const baseReady = computed(() => totalBase.value > 0 && unansweredBaseIds.value.length === 0)
/** 当前这一题**之前**还有多少题没处理（服务端要求全处理，界面要提前说清楚）。 */
const earlierUnanswered = computed(() =>
  activeQuestions.value
    .slice(0, activeIndex.value)
    .filter((question) => !assessment.answerOf(question.id)).length,
)
</script>

<template>
  <PageContainer page="quiz" tight>
    <div class="py-4 tablet:py-6 laptop:grid laptop:grid-cols-[17rem_minmax(0,1fr)] laptop:gap-8">
      <!-- 左栏：进度与状态（laptop 起固定在左） -->
      <aside class="laptop:sticky laptop:top-6 laptop:self-start">
        <p class="section-kicker">人格倾向自测（新测）</p>
        <h1 class="mt-1 font-display text-[20px] font-bold leading-tight text-ink tablet:text-[23px]">
          一屏一题，选完点「下一题」
        </h1>

        <div class="mt-4 space-y-1.5">
          <p v-if="step === 'base' || step === 'clarify-offer'" class="text-[14px] font-medium text-ink">
            主测 {{ processedBase }} / {{ totalBase }}
          </p>
          <p
            v-if="step === 'clarification' || (step === 'clarify-offer' && totalClarification > 0)"
            class="text-[14px] font-medium text-ink"
          >
            补充 {{ clarificationProcessed }} / {{ totalClarification }}
          </p>
          <p v-if="step === 'base'" class="text-[13px] text-ink-soft">
            第 {{ activeNumber }} 题 / 共 {{ activeTotal }} 题
          </p>
          <p v-else-if="step === 'clarification'" class="text-[13px] text-ink-soft">
            补充题 第 {{ activeNumber }} 题 / 共 {{ activeTotal }} 题
          </p>
        </div>

        <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-line-soft" role="presentation">
          <div
            class="h-full rounded-full bg-primary-500 transition-[width] duration-300"
            :style="{
              width: `${totalBase > 0 ? Math.round((processedBase / totalBase) * 100) : 0}%`,
            }"
          />
        </div>

        <p class="mt-3 text-[13px] leading-relaxed" :class="saveTone" data-save-state>
          {{ saveLabel }}
        </p>

        <!-- 本地预览：明确标注为"目前的粗略倾向"，不是结论 -->
        <div v-if="previewLines.length > 0" class="mt-4 rounded-control border border-line bg-surface-soft px-3 py-3">
          <p class="text-[12.5px] font-medium text-ink-soft">目前的粗略倾向（仅供参考）</p>
          <p class="mt-1 text-[12px] leading-relaxed text-ink-faint">
            这是边答边算的即时预览，不是结论；交卷后以服务端生成的报告为准。
          </p>
          <ul class="mt-2 space-y-1">
            <li v-for="line in previewLines" :key="line.dimension" class="text-[13px] text-ink-soft">
              {{ line.name }}：{{ line.text }}
            </li>
          </ul>
        </div>

        <div class="mt-4 hidden laptop:block">
          <button type="button" class="btn-secondary btn-block" data-jump-unanswered @click="jumpToFirstUnanswered">
            {{
              unansweredBaseIds.length > 0
                ? `跳到未答的题（还剩 ${unansweredBaseIds.length} 题）`
                : '主测已全部处理'
            }}
          </button>
        </div>
      </aside>

      <!-- 右栏：题卡 -->
      <section class="mt-5 min-w-0 laptop:mt-0">
        <!-- 同步冲突：绝不静默覆盖 -->
        <div
          v-if="assessment.conflict"
          class="notice-uncertain"
          role="alert"
          aria-live="assertive"
          data-conflict-banner
        >
          <p class="text-[14.5px] font-medium leading-relaxed">
            另一台设备改过这次的进度
          </p>
          <p class="mt-1 text-[13.5px] leading-relaxed">
            {{ assessment.conflict.message }}
          </p>
          <p class="mt-1 text-[13px] leading-relaxed">
            本机刚才的改动没有写上去；载入最新进度后，以另一台设备的版本为准。
          </p>
          <button
            type="button"
            class="btn-secondary mt-3"
            data-reload-latest
            :disabled="loading"
            @click="reloadLatest"
          >
            {{ loading ? '正在载入…' : '载入最新进度' }}
          </button>
        </div>

        <!-- 载入失败 -->
        <div v-if="loadFailure" class="notice-error mt-4" role="alert">
          <p class="text-[14.5px] font-medium">这份测评没能载入：{{ loadFailure }}</p>
          <button type="button" class="btn-secondary mt-3" @click="bootstrap">重试</button>
        </div>

        <p v-else-if="loading && !currentQuestion" class="mt-6 text-[15px] text-ink-soft">正在载入题目…</p>

        <!-- 补充题说明：说清原因，并允许跳过 -->
        <div v-else-if="step === 'clarify-offer'" class="card" data-clarify-offer>
          <h2 class="section-title">主测答完了，这几维还需要再问几题</h2>
          <p class="mt-2 prose-cn">{{ clarificationReason }}</p>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            补充题只有 {{ totalClarification }} 道，都是同一批维度上的固定题目；答完会一起计入最终结果。
          </p>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            可以跳过。跳过的意思是：这几维只按主测作答来说明，
            <strong class="font-medium">方向可能仍然看不清</strong>，报告也不会给出倾向较轻的边界说明。
            跳过<strong class="font-medium">不等于</strong>没答——主测的作答会原样保留并计分。
          </p>
          <div class="mt-4 flex flex-col gap-2 tablet:flex-row">
            <button type="button" class="btn-primary" data-start-clarification @click="startClarification">
              开始补充题（{{ totalClarification }} 题）
            </button>
            <button
              type="button"
              class="btn-secondary"
              data-skip-clarification
              :disabled="submitting"
              @click="skipClarification"
            >
              {{ submitting ? '正在交卷…' : '跳过补充题，直接交卷' }}
            </button>
          </div>
        </div>

        <!-- 覆盖不足：还差哪几维 -->
        <div v-else-if="step === 'needs-review'" class="card" data-needs-review>
          <h2 class="section-title">还差一点信息，暂时不能出报告</h2>
          <p v-if="submitNotice" class="mt-2 prose-cn">{{ submitNotice }}</p>
          <p v-else class="mt-2 prose-cn">
            服务端复核后认为信息还不够，所以没有生成报告。草稿完整保留，可以接着补答。
          </p>
          <ul class="mt-3 space-y-2">
            <li v-for="item in needsReview" :key="item.dimension" class="rounded-control bg-paper-soft px-3 py-2.5">
              <p class="text-[14px] font-medium text-ink">{{ item.name }}</p>
              <p class="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{{ item.note }}</p>
            </li>
          </ul>
          <div class="mt-4 flex flex-col gap-2 tablet:flex-row">
            <button type="button" class="btn-primary" data-back-to-unanswered @click="jumpToFirstUnanswered">
              回到未答的题
            </button>
            <button
              type="button"
              class="btn-secondary"
              :disabled="submitting"
              @click="submit(assessment.clarificationSkipped)"
            >
              再交一次
            </button>
          </div>
        </div>

        <!-- 题卡 -->
        <div v-else-if="currentQuestion" class="card" data-question-card>
          <p class="text-[12.5px] font-medium tracking-wide text-accent-500">
            {{ currentQuestion.dimension }} · {{ dimensionName(currentQuestion.dimension) }}
            <span class="ml-1 text-ink-faint">{{ currentQuestion.facet }}</span>
          </p>
          <h2 class="mt-2 font-display text-[19px] font-bold leading-snug text-ink tablet:text-[22px]">
            {{ currentQuestion.scenario }}
          </h2>

          <!-- 两端陈述 -->
          <div class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 tablet:gap-x-10">
            <p class="border-t border-line-strong pt-3 text-[16px] font-medium leading-[1.5] text-ink tablet:text-[19px]">
              <span class="mb-1 block text-[12px] font-normal text-ink-faint">左边这一侧</span>
              {{ currentQuestion.textLeft }}
            </p>
            <p class="border-t border-line-strong pt-3 text-[16px] font-medium leading-[1.5] text-ink tablet:text-[19px]">
              <span class="mb-1 block text-[12px] font-normal text-ink-faint">右边这一侧</span>
              {{ currentQuestion.textRight }}
            </p>
          </div>

          <!-- 五档：1 左 ── 中间 ── 5 右 -->
          <div class="mt-5 grid grid-cols-5 gap-1.5 tablet:gap-3" role="radiogroup" :aria-label="`第 ${activeNumber} 题的五档选择，1 为最靠左，5 为最靠右`">
            <button
              v-for="value in ANSWER_VALUES"
              :key="value"
              type="button"
              role="radio"
              class="option-cell"
              :aria-checked="selectedRating === value"
              :aria-label="`${captionOf(value)}（第 ${value} 档，1 最靠左、5 最靠右）${selectedRating === value ? '，当前已选' : ''}`"
              :data-rating="value"
              @click="chooseRating(value)"
            >
              <span class="option-index">{{ value }}</span>
              <span class="option-caption">{{ captionOf(value) }}</span>
            </button>
          </div>

          <!-- unknown：与"未作答"是不同的两件事 -->
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-unknown
              :aria-pressed="isUnknown"
              @click="chooseUnknown"
            >
              {{ isUnknown ? '已选：这题我说不好' : '这题我说不好' }}
            </button>
            <span class="text-[12.5px] leading-relaxed text-ink-faint">
              这也是一次作答：不计分，但不会算作"没答"。
            </span>
          </div>

          <p class="mt-3 text-[13px] leading-relaxed" data-answer-state>
            <template v-if="isUnanswered">
              <span class="font-medium text-accent-700">还没有作答。</span>
              选一档，或点「这题我说不好」——两者都算处理过这一题。
            </template>
            <template v-else-if="isUnknown">
              <span class="font-medium text-primary-700">我说不好（已作答，不计分）。</span>
              之后想改也可以再选一档。
            </template>
            <template v-else>
              <span class="font-medium text-primary-700">
                已选：{{ selectedRating }} · {{ captionOf(selectedRating ?? 3) }}
              </span>
            </template>
          </p>

          <details v-if="currentQuestion.help" class="mt-3">
            <summary class="link cursor-pointer text-[13.5px]">这题是什么意思？</summary>
            <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{{ currentQuestion.help }}</p>
          </details>

          <p v-if="hint" class="notice-uncertain mt-4 text-[13.5px] leading-relaxed" role="status" aria-live="polite">
            {{ hint }}
          </p>

          <p v-if="earlierUnanswered > 0" class="mt-3 text-[13px] leading-relaxed text-ink-faint" data-earlier-note>
            前面还有 {{ earlierUnanswered }} 题没有处理；全部处理完才能出报告。
          </p>
          <p v-else-if="baseReady" class="mt-3 text-[13px] text-primary-700" data-base-ready>
            主测 {{ totalBase }} 题都处理过了。
          </p>

          <!-- 操作区 -->
          <div class="mt-5 flex flex-col gap-2 tablet:flex-row tablet:justify-between">
            <button
              type="button"
              class="btn-secondary"
              data-previous
              :disabled="activeIndex === 0"
              @click="previous"
            >
              上一题
            </button>
            <button
              type="button"
              class="btn-primary"
              data-next
              :disabled="submitting || loading"
              @click="next"
            >
              {{ isLastInStage ? (step === 'clarification' ? '完成并交卷' : '完成主测') : '下一题' }}
            </button>
          </div>

          <div class="mt-3 flex flex-wrap gap-2 laptop:hidden">
            <button type="button" class="btn-ghost btn-sm" @click="jumpToFirstUnanswered">
              跳到未答的题（还剩 {{ unansweredBaseIds.length }} 题）
            </button>
          </div>
        </div>

        <p v-else class="mt-6 text-[15px] text-ink-soft">
          这次测评没有可以继续作答的题目。可以到
          <RouterLink to="/reports" class="link">历史报告</RouterLink>看看已经完成的记录。
        </p>

        <!-- 未作答清单 -->
        <div v-if="showUnanswered && unansweredBaseIds.length > 0" class="card mt-4" data-unanswered-list>
          <h3 class="section-title">主测还有 {{ unansweredBaseIds.length }} 题没有处理</h3>
          <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
            未作答的题必须处理（选一档，或标「这题我说不好」）才可能生成报告。
          </p>
          <ul class="mt-3 flex flex-wrap gap-2">
            <li v-for="questionId in unansweredBaseIds" :key="questionId">
              <button
                type="button"
                class="qnum qnum-unanswered"
                :aria-label="`跳到第 ${baseQuestions.findIndex((item) => item.id === questionId) + 1} 题（未作答）`"
                @click="jumpTo(questionId)"
              >
                {{ baseQuestions.findIndex((item) => item.id === questionId) + 1 }}
              </button>
            </li>
          </ul>
        </div>

        <p v-if="step !== 'base'" class="mt-4 text-[13px] text-ink-faint">
          主测已处理 {{ processedBase }} / {{ totalBase }} 题。
        </p>

        <p class="sr-only" aria-live="polite" data-live>{{ liveMessage }}</p>
      </section>
    </div>
  </PageContainer>
</template>
