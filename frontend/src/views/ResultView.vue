<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import { buildDimensionReview } from '@/domain/report'
import type { DimensionReviewRow } from '@/domain/report'
import type { Dimension, Pole } from '@/domain/types'
import type { TypeProfile } from '@/domain/contentTypes'
import { fetchTypeProfile } from '@/api/client'
import DimensionBar from '@/components/DimensionBar.vue'
import TypeCardBody from '@/components/TypeCardBody.vue'
import SharePreview from '@/components/SharePreview.vue'
import PageContainer from '@/components/PageContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { shareCardBlob, shareCardDataUrl, copyText } from '@/utils/shareImage'
import { chineseNumeral, dimensionCountPhrase } from '@/utils/cnNumber'

/**
 * 结果报告 —— `docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md` §5。
 *
 * 本轮的实质变化：**报告由各维度结果驱动，而不是由「一个类型」驱动。**
 *   - 维度不全满足展示条件时，完整类型为空，也不去取任何类型文案；
 *   - 一个维度的状态变化只影响这一维（以及整体组合是否成立），
 *     不会把另外几维的解释一起翻转；
 *   - 类型文章只作为**明确标识的可选参考阅读**，且只在有参考组合时提供。
 *
 * 页面、分享图片、复制文字、下载文件名与无障碍名称全部来自同一个 `ReportViewModel`。
 * 结构性错误（内容包坏 / 数据被写坏）**不 replace 回答题页**，原地渲染错误态。
 *
 * 计数与两端记号同样不许写死：站点默认量表是**五维**的大五，任何「四个维度」「I/E」
 * 之类的常量都必须从 `report` 取（`dimensionCount` / `row.lowToken` / `row.highToken`）。
 */
const quiz = useQuizStore()
const router = useRouter()

const report = computed(() => quiz.report)
const analysisError = computed(() => quiz.analysisError)

/** 「五个维度」这样的计数短语（OEJTS 下仍是「四个维度」）。 */
const dimensionCountLabel = computed(() => chineseNumeral(report.value?.dimensionCount ?? 0))
const dimensionCountText = computed(() => dimensionCountPhrase(report.value?.dimensionCount ?? 0))

const previewOpen = ref(false)
const previewImage = ref<string | null>(null)
const previewBlob = ref<Blob | null>(null)
const generating = ref(false)
const shareStatus = ref<{ tone: 'success' | 'error' | 'neutral'; text: string } | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined

const showRetake = ref(false)
const reference = ref<TypeProfile | null>(null)
const referenceLoading = ref(false)
const referenceError = ref<string | null>(null)

/** 生成产物对应的报告指纹：答案一改，reportId 变化 → 旧图片立即失效。 */
const shareToken = computed(() => report.value?.reportId ?? '')
let generatedToken: string | null = null

function flash(tone: 'success' | 'error' | 'neutral', text: string) {
  shareStatus.value = { tone, text }
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    shareStatus.value = null
  }, 6000)
}

type ResultStatus = 'result' | 'incomplete' | 'invalid'
const status = ref<ResultStatus | null>(null)
const classified = ref(false)

function classify(): ResultStatus {
  if (!quiz.activePackage) return 'invalid'
  if (analysisError.value) return 'invalid'
  // 记录存在但不可识别（越界分值 / 未知 kind）：结构性错误，**不 replace 回答题页**（CR-1）
  if (quiz.corruptResponseIds.length > 0) return 'invalid'
  if (!quiz.isProcessed) return 'incomplete'
  if (quiz.submittedAt === null) return 'incomplete'
  return 'result'
}

const errorDetail = computed(() => {
  if (analysisError.value) return analysisError.value
  if (quiz.corruptResponseIds.length > 0) {
    return (
      `有 ${quiz.corruptResponseIds.length} 条作答记录不是 1–5 的整数，也不是「暂时无法判断」` +
      `（第 ${quiz.corruptResponseIds.join('、')} 题）。这类数据无法参与计分，已跳过；` +
      `可以在答题页重新选择这几题来修复，其余作答会保留。`
    )
  }
  return quiz.loadError ?? '无法在当前数据下生成报告。'
})

/* ── 回看数据：只给结果页用（不在展示模型里，因此图片读不到答案） ─────── */

const review = computed<DimensionReviewRow[]>(() => {
  const pkg = quiz.activePackage
  if (!pkg) return []
  return buildDimensionReview(pkg, quiz.responses, quiz.analysis ?? undefined)
})

const reviewOpen = ref<Dimension[]>([])

function toggleReview(dimension: Dimension) {
  reviewOpen.value = reviewOpen.value.includes(dimension)
    ? reviewOpen.value.filter((item) => item !== dimension)
    : [...reviewOpen.value, dimension]
}

function reviewStateText(state: 'rating' | 'unknown' | 'unanswered', rating: number | null): string {
  if (state === 'rating') return `你的选择：${rating}`
  if (state === 'unknown') return '你的选择：暂时无法判断'
  return '尚未处理'
}

/* ── 自我观察（不计分，不改变报告） ─────────────────────────────────── */

const openDimensions = computed(
  () => report.value?.dimensionRows.filter((row) => row.status !== 'leaning') ?? [],
)

function selfChoiceOf(dimension: Dimension): Pole | null | undefined {
  return quiz.selfReflection[dimension]?.preference
}

function setSelfChoice(dimension: Dimension, pole: Pole | null) {
  quiz.saveSelfReflection(dimension, pole)
  flash('neutral', '已记录你的自我观察。它不计入量表分数，也不会改变上面的结果。')
}

/* ── 可选参考阅读（只在有参考组合时出现） ───────────────────────────── */

async function openReference() {
  const code = report.value?.suggestedTypeCode
  if (!code) return
  if (reference.value?.code === code) return
  referenceLoading.value = true
  referenceError.value = null
  try {
    const resolved = await fetchTypeProfile(code)
    reference.value = resolved.data
  } catch (error) {
    reference.value = null
    referenceError.value = '类型参考阅读暂时没有读到。上面的维度报告不受影响。'
    console.warn('[typeme] 读取类型参考阅读失败：', error)
  } finally {
    referenceLoading.value = false
  }
}

/* ── 分享 ─────────────────────────────────────────────────────────── */

async function generateShare() {
  const current = report.value
  if (!current || generating.value) return
  if (quiz.writesBlocked) {
    flash('error', '另一页面已更新这次测试，请先载入最新进度再分享。')
    return
  }
  generating.value = true
  shareStatus.value = null
  try {
    const capturedId = current.reportId
    const blob = await shareCardBlob({ report: current })
    if (blob.size === 0) throw new Error('生成的图片为空')
    const image = shareCardDataUrl({ report: current })
    // 生成期间答案可能已经改动：reportId 变了就丢弃这次产物
    if (report.value?.reportId !== capturedId) {
      flash('neutral', '生成过程中答案有改动，这次图片已丢弃。请重新生成。')
      return
    }
    previewImage.value = image
    previewBlob.value = blob
    generatedToken = capturedId
    previewOpen.value = true
  } catch (error) {
    console.warn('[typeme] 生成分享图失败', error)
    flash('error', '生成分享卡片没有成功。可以重试，或先复制结果文字。')
  } finally {
    generating.value = false
  }
}

async function copyShareText() {
  const current = report.value
  if (!current) return
  const ok = await copyText(current.share.text)
  flash(ok ? 'success' : 'error', ok ? '分享文案已复制到剪贴板。' : '复制没有成功，可以在分享预览里手动选择文字。')
}

function closePreview() {
  previewOpen.value = false
  previewImage.value = null
  previewBlob.value = null
  generatedToken = null
}

function releasePreview() {
  previewImage.value = null
  previewBlob.value = null
  generatedToken = null
}

function invalidateShare() {
  releasePreview()
  if (previewOpen.value) {
    previewOpen.value = false
    flash('neutral', '答案已改动，之前的分享图已失效。要看新结果，请重新生成。')
  }
}

function retake() {
  showRetake.value = false
  quiz.dropLegacyV1()
  quiz.dropLegacyV2()
  quiz.start()
  void router.push({ name: 'quiz' })
}

function editAnswers() {
  quiz.goToFirstUnanswered()
  if (quiz.firstUnansweredIndex < 0) quiz.goTo(0)
  void router.push({ name: 'quiz' })
}

const SECTIONS = computed(() => [
  { id: 'conclusion', label: '结论' },
  { id: 'dimensions', label: `${dimensionCountLabel.value}个维度` },
  { id: 'review', label: '为什么这样描述' },
  { id: 'self', label: '继续认识自己' },
  { id: 'actions', label: '可以尝试的做法' },
  { id: 'share', label: '保存或分享' },
  { id: 'method', label: '方法说明' },
])

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(async () => {
  window.addEventListener('beforeunload', releasePreview)
  if (!quiz.activePackage) await quiz.load()
  status.value = classify()
  classified.value = true
  if (status.value === 'incomplete') {
    void router.replace({ name: 'quiz' })
  }
})

watch(shareToken, () => {
  if (!classified.value) return
  if (generatedToken !== null && generatedToken !== shareToken.value) invalidateShare()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', releasePreview)
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  releasePreview()
})
</script>

<template>
  <!-- 结构性错误：内容包坏 / 作答被写坏。**绝不 replace 回答题页** -->
  <PageContainer v-if="status === 'invalid'" page="result">
    <div class="mx-auto max-w-[34rem]" role="alert">
      <h1 class="font-display text-[24px] font-bold text-ink">这次没能生成报告</h1>
      <p class="mt-2 prose-cn">
        原因是<strong class="font-medium text-ink">数据本身不完整</strong>，而不是你的作答有问题。
        在结果页和答题页之间来回跳没有意义，所以这里直接把问题说清楚。
      </p>
      <p class="notice-neutral mt-4 text-[13.5px] leading-relaxed">{{ errorDetail }}</p>
      <div class="mt-5 flex flex-col-reverse gap-2 tablet:flex-row">
        <RouterLink to="/" class="btn-secondary">回到首页</RouterLink>
        <RouterLink to="/quiz" class="btn-primary">回去补答</RouterLink>
      </div>
      <button type="button" class="btn-ghost btn-sm mt-3 px-0 text-ink-soft" @click="retake">
        清空本地进度并重新测试
      </button>
    </div>
  </PageContainer>

  <PageContainer v-else-if="status === 'incomplete'" page="result">
    <div class="mx-auto max-w-[34rem] text-center">
      <h1 class="font-display text-[22px] font-bold text-ink">还差 {{ quiz.unansweredCount }} 题</h1>
      <p class="mt-2 prose-cn">
        还差 {{ quiz.unansweredCount }} 题尚未处理（已处理 {{ quiz.processedCount }} /
        {{ quiz.total }}）。每题选择数字或标记「暂时无法判断」后就能看到报告。
      </p>
      <div class="mt-5 flex flex-col-reverse gap-2 tablet:flex-row tablet:justify-center">
        <RouterLink to="/" class="btn-secondary">回到首页</RouterLink>
        <RouterLink to="/quiz" class="btn-primary">继续答题</RouterLink>
      </div>
    </div>
  </PageContainer>

  <PageContainer v-else-if="!report" page="result">
    <p class="text-center prose-sm">正在准备你的报告……</p>
  </PageContainer>

  <!-- ── 正常报告 ──────────────────────────────────────────────────── -->
  <div v-else class="pb-12">
    <!-- 1 结论区：标题由整体状态决定，未定时不出现完整类型 -->
    <section id="conclusion" data-report-hero class="scroll-mt-20 bg-primary-600 text-white">
      <PageContainer page="result" class="py-8 tablet:py-10 laptop:py-12">
        <div class="grid gap-6 laptop:grid-cols-[minmax(0,1fr)_18rem] laptop:items-end laptop:gap-10">
          <div>
            <p class="text-[13px] text-primary-100">
              {{
                report.share.kind === 'typed'
                  ? '本次问卷参考组合'
                  : report.share.kind === 'partial'
                    ? '本次偏好概览（未形成完整类型）'
                    : report.share.kind === 'clear'
                      ? '本次偏好概览（每个维度都有方向）'
                      : '本次偏好概览（没有明确方向）'
              }}
            </p>

            <template v-if="report.suggestedTypeCode">
              <h1
                data-suggested-type
                class="mt-1.5 font-display text-[56px] font-bold leading-none tracking-[0.06em] tablet:text-[72px] laptop:text-[80px] desktop:text-[88px]"
              >
                {{ report.suggestedTypeCode }}
              </h1>
              <p class="mt-3 text-[19px] font-semibold tablet:text-[21px]">{{ report.title }}</p>
            </template>
            <template v-else>
              <h1
                class="mt-1.5 font-display text-[28px] font-bold leading-tight tablet:text-[34px] laptop:text-[38px]"
              >
                {{ report.title }}
              </h1>
            </template>

            <p class="mt-3 max-w-[42rem] text-[14.5px] leading-relaxed text-primary-100">
              {{ report.subtitle }}
            </p>
          </div>

          <!-- 四维状态速览：未定维度不显示字母，只显示状态 -->
          <ul
            data-dimension-summary
            class="space-y-1.5 text-[14px] tablet:grid tablet:grid-cols-2 tablet:gap-x-6 tablet:space-y-0 laptop:block laptop:space-y-1.5"
          >
            <li
              v-for="row in report.dimensionRows"
              :key="row.dimension"
              class="flex items-center justify-between gap-3 border-b border-white/15 pb-1.5"
            >
              <span class="text-primary-100">{{ row.heading }}</span>
              <span class="flex items-center gap-1.5 font-display text-[15px] font-bold">
                <template v-if="row.status === 'leaning'">{{ row.pole }}</template>
                <template v-else-if="row.status === 'insufficient'">信息不足</template>
                <template v-else>未定</template>
                <span
                  v-if="row.status !== 'leaning'"
                  class="rounded-full bg-white/20 px-1.5 py-[1px] text-[11px] font-medium text-white"
                  >{{ row.status === 'insufficient' ? '未计分' : '待观察' }}</span
                >
              </span>
            </li>
          </ul>
        </div>
      </PageContainer>
    </section>

    <PageContainer page="result" class="py-8 tablet:py-10">
      <div class="grid gap-8 laptop:grid-cols-[minmax(0,47.5rem)_15rem] laptop:items-start laptop:gap-10">
        <div class="min-w-0 space-y-10">
          <!-- 2 各维度的说明 -->
          <section id="dimensions" class="scroll-mt-20">
            <h2 class="section-title">{{ dimensionCountText }}上的结果</h2>
            <p class="mt-2 prose-sm">
              每个维度单独判断：<strong class="font-medium text-ink">信息不足</strong>不计算分数、
              <strong class="font-medium text-ink">本次两侧相近</strong>没有主导侧、
              <strong class="font-medium text-ink">略偏</strong>只作观察，
              只有<strong class="font-medium text-ink">达到展示条件</strong>的维度才参与参考组合。
              这些是本产品的展示策略，不是人群占比、概率或准确率。
            </p>
            <div class="mt-4 space-y-3">
              <DimensionBar
                v-for="row in report.dimensionRows"
                :key="row.dimension"
                :row="row"
              />
            </div>

            <div class="mt-4 space-y-3">
              <article
                v-for="row in report.dimensionRows"
                :key="`${row.dimension}-text`"
                data-dimension-text
                :data-dimension="row.dimension"
                :data-status="row.status"
                class="rounded-question border border-line bg-surface px-4 py-4 tablet:px-5"
              >
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 class="text-[15px] font-semibold text-ink">{{ row.heading }}</h3>
                  <p class="text-[13px] text-ink-soft">
                    {{ row.negativeLabel }} {{ row.lowToken }} ↔
                    {{ row.positiveLabel }} {{ row.highToken }}
                  </p>
                </div>
                <p
                  v-for="(line, index) in row.details"
                  :key="index"
                  class="mt-2 text-[14.5px] leading-[1.75] text-ink-soft"
                >
                  {{ line }}
                </p>
              </article>
            </div>

            <details class="mt-4 rounded-question border border-line bg-paper-soft px-4 py-3">
              <summary class="cursor-pointer text-[14px] font-medium text-ink">
                分数是怎么算的？
              </summary>
              <p class="mt-2 prose-sm">{{ report.copy.scoreMethodNote }}</p>
              <p class="mt-2 prose-sm">
                判定只比较「大于中点」还是「不大于中点」，所以每一维都可能有 1 分之差就换方向的情况；
                本产品把距中点 1–4 分标为“待观察”，正是为了不把这种差异写成确定结论。
              </p>
            </details>
          </section>

          <!-- 3 为什么这样描述（默认折叠，回看题目与选择） -->
          <section id="review" class="scroll-mt-20">
            <h2 class="section-title">为什么这样描述</h2>
            <p class="mt-2 prose-sm">{{ report.copy.dimensionReviewLead }}</p>
            <div class="mt-4 divide-y divide-line border-y border-line">
              <div v-for="(group, index) in review" :key="group.dimension">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-4 py-3.5 text-left text-[15px] font-medium text-ink"
                  :aria-expanded="reviewOpen.includes(group.dimension)"
                  :aria-controls="`review-${group.dimension}`"
                  @click="toggleReview(group.dimension)"
                >
                  <span>
                    {{ group.heading }}
                    <span class="ml-2 text-[13px] font-normal text-ink-soft">
                      {{ report.dimensionRows[index]?.summary }}
                    </span>
                  </span>
                  <span class="text-ink-faint" aria-hidden="true">
                    {{ reviewOpen.includes(group.dimension) ? '－' : '＋' }}
                  </span>
                </button>
                <ul
                  v-if="reviewOpen.includes(group.dimension)"
                  :id="`review-${group.dimension}`"
                  class="pb-4"
                >
                  <li
                    v-for="item in group.items"
                    :key="item.id"
                    class="border-t border-line-soft py-2.5 text-[13.5px] leading-relaxed"
                  >
                    <p class="text-ink">
                      <span class="font-medium">第 {{ item.ordinal }} 题</span>
                      · {{ item.text }}
                    </p>
                    <p
                      class="mt-1"
                      :class="item.state === 'rating' ? 'text-ink-soft' : 'text-accent-700'"
                    >
                      {{ reviewStateText(item.state, item.rating) }}
                    </p>
                    <p v-if="item.explanation" class="mt-1 text-ink-faint">
                      释义：{{ item.explanation }}
                    </p>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <!-- 4 继续认识自己（自我观察，不计分） -->
          <section id="self" class="scroll-mt-20">
            <h2 class="section-title">继续认识自己</h2>
            <p class="mt-2 prose-sm">{{ report.copy.selfReflectionLead }}</p>

            <div v-if="openDimensions.length === 0" class="mt-4 notice-info text-[13.5px] leading-relaxed">
              本次{{ dimensionCountText }}都达到了展示条件，没有需要额外观察的维度。你仍然可以在下面的“我的当前理解”里
              记录自己的看法；它不会改变上面的结果。
            </div>

            <div v-else class="mt-4 space-y-3">
              <article
                v-for="row in openDimensions"
                :key="`self-${row.dimension}`"
                class="rounded-question border border-line bg-surface px-4 py-4"
              >
                <h3 class="text-[14.5px] font-semibold text-ink">
                  {{ row.heading }}：换一个情境，你更自然地偏向哪一侧？
                </h3>
                <p class="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
                  这里只作你自己的观察笔记，不计入量表分数，也不会改变上面的报告。
                </p>
                <div class="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    :aria-pressed="selfChoiceOf(row.dimension) === row.lowToken"
                    @click="setSelfChoice(row.dimension, row.lowToken)"
                  >
                    更偏 {{ row.negativeLabel }}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    :aria-pressed="selfChoiceOf(row.dimension) === row.highToken"
                    @click="setSelfChoice(row.dimension, row.highToken)"
                  >
                    更偏 {{ row.positiveLabel }}
                  </button>
                  <button
                    type="button"
                    class="btn-secondary btn-sm"
                    :aria-pressed="selfChoiceOf(row.dimension) === null"
                    @click="setSelfChoice(row.dimension, null)"
                  >
                    暂不确定
                  </button>
                </div>
                <p
                  v-if="selfChoiceOf(row.dimension) !== undefined"
                  data-self-reflection
                  class="mt-2 text-[13px] text-primary-700"
                >
                  我的当前理解：{{
                    selfChoiceOf(row.dimension) === null
                      ? '暂不确定'
                      : selfChoiceOf(row.dimension) === row.lowToken
                        ? `更偏 ${row.negativeLabel}`
                        : `更偏 ${row.positiveLabel}`
                  }}
                </p>
              </article>
            </div>

            <button
              v-if="Object.keys(quiz.selfReflection).length > 0"
              type="button"
              class="btn-ghost btn-sm mt-2 px-0 text-ink-soft"
              @click="quiz.clearSelfReflection()"
            >
              清除自我观察记录
            </button>
          </section>

          <!-- 5 可以尝试的做法：只用被支持的维度片段 + 通用观察 -->
          <section id="actions" class="scroll-mt-20">
            <h2 class="section-title">可以尝试的做法</h2>
            <p class="mt-2 prose-sm">
              优先给出被本次回答支持的维度片段；没有明确方向的维度只给观察行为，不给某类型专属的优势判断。
            </p>
            <ul class="mt-4 space-y-3">
              <li
                v-for="row in report.dimensionRows"
                :key="`action-${row.dimension}`"
                class="rounded-question border border-line bg-primary-50 px-4 py-3.5"
              >
                <p class="text-[13px] font-semibold text-primary-700">
                  {{ row.heading }} · {{ row.summary }}
                </p>
                <ul class="mt-1.5 space-y-1.5">
                  <li
                    v-for="(action, index) in row.actions"
                    :key="index"
                    class="text-[14.5px] leading-[1.7] text-ink"
                  >
                    · {{ action }}
                  </li>
                </ul>
              </li>
            </ul>
            <ul class="mt-4 space-y-2">
              <li
                v-for="(step, index) in report.nextSteps"
                :key="index"
                class="border-t border-line pt-2.5 text-[14px] leading-[1.7] text-ink-soft"
              >
                {{ step }}
              </li>
            </ul>
          </section>

          <!-- 6 可选参考阅读：只有形成参考组合时才出现 -->
          <section v-if="report.suggestedTypeCode" id="reference" class="scroll-mt-20">
            <h2 class="section-title">可选参考阅读</h2>
            <p class="mt-2 prose-sm">{{ report.copy.typeReadingLead }}</p>
            <div class="mt-3">
              <button
                v-if="!reference"
                type="button"
                class="btn-secondary"
                :disabled="referenceLoading"
                @click="openReference"
              >
                {{ referenceLoading ? '正在读取…' : `阅读 ${report.suggestedTypeCode} 类型介绍（参考资料）` }}
              </button>
              <p v-if="referenceError" class="notice-neutral mt-3 text-[13px] leading-relaxed">
                {{ referenceError }}
              </p>
              <div v-if="reference" data-type-reference class="rounded-question border border-line bg-surface px-4 py-4">
                <p class="text-[13px] font-semibold text-ink">{{ report.copy.typeReadingLead }}</p>
                <p class="mt-2 font-display text-[22px] font-bold text-ink">
                  {{ reference.code }} · {{ reference.nameCn }}
                </p>
                <p class="mt-1 text-[14px] leading-relaxed text-ink-soft">{{ reference.tagline }}</p>
                <div class="mt-3">
                  <TypeCardBody :profile="reference" />
                </div>
              </div>
            </div>
          </section>

          <!-- 7 保存或分享 -->
          <section id="share" class="scroll-mt-20">
            <h2 class="section-title">保存或分享这份报告</h2>
            <p class="mt-2 prose-sm">
              生成的是一张竖版卡片，内容严格等于上面这份报告：
              <strong class="font-medium text-ink">未定结果不会出现任何完整类型或人格描述</strong>，
              也不含逐题答案、姓名或设备信息。文件名：{{ report.share.filename }}。
            </p>

            <div class="mt-4 flex flex-col gap-2 tablet:flex-row tablet:flex-wrap">
              <button type="button" class="btn-primary tablet:w-auto" :disabled="generating" @click="generateShare">
                {{ generating ? '正在生成…' : '生成分享卡片' }}
              </button>
              <button type="button" class="btn-secondary tablet:w-auto" @click="copyShareText">
                复制结果文字
              </button>
              <button type="button" class="btn-secondary tablet:w-auto" @click="editAnswers">修改答案</button>
              <button type="button" class="btn-secondary tablet:w-auto" @click="showRetake = true">
                重新测试
              </button>
            </div>

            <p class="mt-3 text-[13px] leading-relaxed text-ink-soft" data-share-text>
              将复制的文字：{{ report.share.text }}
            </p>

            <p
              v-if="shareStatus"
              class="mt-3 rounded-control px-3 py-2.5 text-[13px] leading-relaxed"
              :class="
                shareStatus.tone === 'success'
                  ? 'bg-primary-50 text-primary-800'
                  : shareStatus.tone === 'neutral'
                    ? 'bg-paper-soft text-ink-soft'
                    : 'bg-accent-100 text-accent-700'
              "
              role="status"
              aria-live="polite"
            >
              {{ shareStatus.text }}
            </p>

            <p class="mt-3 fineprint">
              分享失败不会清空你的答卷，也不会离开这份报告。图片只存在你的设备上。
            </p>
          </section>

          <!-- 8 方法说明 -->
          <section id="method" class="scroll-mt-20">
            <h2 class="section-title">怎么看这份报告</h2>
            <div class="mt-3 divide-y divide-line border-y border-line">
              <details class="group py-3.5">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
                  为什么有的维度只写“待观察”或“信息不足”？
                  <span class="text-ink-faint transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
                </summary>
                <p class="mt-2 prose-sm">
                  离中点很近的维度只标为“待观察”，缺少有效数字答案的维度标为“信息不足”。
                  这是为了不把噪音当成方向而设的展示规则，
                  <strong class="font-medium text-ink">不是统计置信阈值</strong>，
                  也没有证据表明它提升了准确率。
                </p>
                <p class="mt-2 prose-sm">
                  {{ dimensionCountText }}里只要有一个没有达到展示条件，完整{{
                    report.hasTypeCode ? '类型' : '结论'
                  }}就为空 —— 页面不会退回某个默认{{
                    report.hasTypeCode ? '类型' : '答案'
                  }}，也不使用 XXXX 之类的占位写法。
                </p>
              </details>
              <details class="group py-3.5">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
                  为什么结果会变？
                  <span class="text-ink-faint transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
                </summary>
                <p class="mt-2 prose-sm">
                  {{ dimensionCountText }}都是连续分数，靠近中点时换个时间或状态作答就可能落到另一侧。
                  常见做法是间隔数周再测一次，而不是反复重测直到拿到“想要”的结果。
                </p>
              </details>
              <details class="group py-3.5">
                <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink">
                  来源与方法
                  <span class="text-ink-faint transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
                </summary>
                <div class="mt-2 space-y-2 prose-sm">
                  <p>
                    题目取自 {{ report.attribution.source }}（{{ report.attribution.author }}），依
                    <a
                      :href="report.attribution.licenseUrl"
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      class="link link-external"
                      >{{ report.attribution.license }}</a
                    >
                    使用，本项目做了中文本地化改写。
                  </p>
                  <p>{{ report.copy.scoreMethodNote }}</p>
                  <RouterLink to="/about" class="link">读完整的方法说明 →</RouterLink>
                </div>
              </details>
            </div>

            <p class="mt-4 fineprint">
              结果仅供自我了解与娱乐参考，不构成任何心理诊断或专业建议，也不得用于招聘、晋升或筛选。
              <template v-if="report.hasTypeCode">
                这不是 MBTI 官方测评，与 The Myers &amp; Briggs Foundation 无任何关联。
              </template>
            </p>
          </section>
        </div>

        <!-- 右侧目录 -->
        <nav class="laptop:sticky laptop:top-20" aria-label="报告目录">
          <p class="hidden text-[13px] font-semibold text-ink laptop:block">报告目录</p>
          <ul class="flex flex-wrap gap-1.5 laptop:mt-3 laptop:flex-col laptop:gap-0">
            <li v-for="section in SECTIONS" :key="section.id">
              <a
                :href="`#${section.id}`"
                class="inline-block rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-primary-400 hover:text-primary-700 laptop:w-full laptop:rounded-none laptop:border-0 laptop:border-l-2 laptop:border-transparent laptop:bg-transparent laptop:px-3 laptop:py-1.5 laptop:hover:border-primary-400"
                @click.prevent="scrollToSection(section.id)"
                >{{ section.label }}</a
              >
            </li>
          </ul>

          <div class="mt-6 hidden rounded-question border border-line bg-surface px-4 py-4 laptop:block">
            <p class="text-[13px] font-semibold text-ink">本次作答</p>
            <p class="mt-1 text-[13px] leading-relaxed text-ink-soft">
              已处理 {{ quiz.processedCount }} / {{ quiz.total }} 题（数字 {{ quiz.ratingCount }} ·
              待判断 {{ quiz.unknownCount }}）
            </p>
          </div>
        </nav>
      </div>
    </PageContainer>

    <SharePreview
      :open="previewOpen"
      :image="previewImage"
      :report="report"
      :blob="previewBlob"
      @close="closePreview"
    />

    <ConfirmDialog
      :open="showRetake"
      title="重新测试会清空这台设备上保留的本次作答，是否继续？"
      description="清空后无法恢复，需要重新回答全部题目。"
      confirm-label="清空并重新测试"
      cancel-label="取消"
      danger
      @confirm="retake"
      @cancel="showRetake = false"
    />
  </div>
</template>
