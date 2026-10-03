<script setup lang="ts">
import InstrumentArtwork from '@/components/InstrumentArtwork.vue'
import { plainBigFiveRow } from '@/domain/plainReport'
import { formatLocalTime } from '@/domain/localTime'
import { bigFiveExport } from '@/domain/bigFiveExport'
import { computed, watch, onBeforeUnmount, ref } from 'vue'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import {
  fetchPlatformReport,
  parseBigFiveReport,
  type BigFiveReportView,
  type ReportDetailView,
} from '@/api/platformV3'

/**
 * 大五倾向测评的报告页。
 *
 * ## 这一页的顺序是刻意的
 *
 * 1. **这次的结果**（五维各自的原始分、离中点的距离、人话解读）；
 * 2. **这次可靠到什么程度**（答了多少、有几题"说不好"、哪几维没给方向）；
 * 3. **接下来可以做什么**（每维一条可观察的动作）；
 * 4. **理论说明**（折起来，默认不展开）。
 *
 * 理论放最后且默认折叠，是因为一份报告要先回答"我这次是什么样"，
 * 而不是先讲大五模型从哪来。旧报告同样按这个顺序渲染 —— 页面不区分新旧，
 * 区分点只有"报告体在根节点还是在 report 里"。
 *
 * ## 不做什么
 *
 * - 不把五个维度合成一个"人格总分"，不排序、不给百分位；
 * - 不说"高于/低于常模"（本仓库没有常模数据，说了就是编）；
 * - 不用类型码 —— 大五没有类型码。
 */

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const error = ref<ErrorDisplay | null>(null)
const detail = ref<ReportDetailView | null>(null)
const report = ref<BigFiveReportView | null>(null)
const renderError = ref<string | null>(null)
const copying = ref(false)
const downloading = ref(false)
const actionNotice = ref<string | null>(null)
const exportModel = computed(() => detail.value && report.value ? bigFiveExport(detail.value, report.value) : null)

async function copySummary(): Promise<void> {
  const model = exportModel.value
  if (!model || copying.value) return
  copying.value = true
  actionNotice.value = null
  try {
    await navigator.clipboard.writeText(model.text)
    actionNotice.value = '报告摘要已复制。'
  } catch {
    actionNotice.value = '自动复制失败，请展开下面的摘要手动复制。'
  } finally {
    copying.value = false
  }
}

function imageBlob(model: NonNullable<typeof exportModel.value>): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('当前浏览器不支持图片导出'))
  canvas.width = 1080
  ctx.font = '32px system-ui, sans-serif'
  const lines: string[] = []
  for (const paragraph of model.text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > 930 && line) {
        lines.push(line)
        line = ''
      }
      line += char
    }
    lines.push(line)
  }
  canvas.height = Math.max(1280, 190 + lines.length * 52)
  ctx.fillStyle = '#F4F6F9'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#14617A'
  ctx.fillRect(0, 0, canvas.width, 16)
  ctx.fillStyle = '#0D1B2A'
  ctx.font = '32px system-ui, sans-serif'
  lines.forEach((line, index) => ctx.fillText(line, 75, 120 + index * 52))
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('浏览器未能生成图片')),
    'image/png',
  ))
}

async function downloadImage(): Promise<void> {
  const model = exportModel.value
  if (!model || downloading.value) return
  downloading.value = true
  actionNotice.value = null
  try {
    const blob = await imageBlob(model)
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = model.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      actionNotice.value = `已发起下载：${model.filename}`
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  } catch (error) {
    actionNotice.value = `图片导出失败：${error instanceof Error ? error.message : '未知原因'}。可以复制文字摘要。`
  } finally {
    downloading.value = false
  }
}

const reportId = computed(() => {
  const value = route.params.reportId
  return typeof value === 'string' && value !== '' ? value : null
})

const createdAtText = computed(() => {
  const raw = detail.value?.createdAt
  return raw ? formatLocalTime(raw) : ''
})

/** 哪几维这次没给出方向。 */
const undecided = computed(
  () => report.value?.dimensions.filter((dimension) => !dimension.hasResult) ?? [],
)

const decided = computed(
  () => report.value?.dimensions.filter((dimension) => dimension.hasResult) ?? [],
)
const hasHistoricalRangeError = computed(() => report.value?.dimensions.some(
  dimension => dimension.rangeLow !== 10 || dimension.rangeHigh !== 50,
) ?? false)

let loadSequence = 0
async function load(): Promise<void> {
  const sequence = ++loadSequence
  detail.value = null
  report.value = null
  if (!reportId.value) return
  loading.value = true
  error.value = null
  renderError.value = null
  try {
    const result = await fetchPlatformReport(reportId.value)
    if (sequence !== loadSequence) return
    if (result.reportKind !== 'big_five_profile') {
      // 报告种类与页面不匹配：把用户送到正确的页面，而不是在这里强行渲染。
      await router.replace({ name: 'report-detail', params: { reportId: result.reportId } })
      return
    }
    detail.value = result
    try {
      // 整份快照进解析器（解析器自己下钻到报告体；reportHash 在外壳层）。
      report.value = parseBigFiveReport(result.report)
    } catch (parseError) {
      // 报告体不完整时**不猜**：如实说这份报告无法渲染，并给出报障编号。
      report.value = null
      renderError.value =
        parseError instanceof Error
          ? `这份报告的字段不完整，无法渲染：${parseError.message}`
          : '这份报告的字段不完整，无法渲染。'
    }
  } catch (loadError) {
    if (sequence !== loadSequence) return
    error.value = describeError(loadError)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

watch(reportId, () => { void load() }, { immediate: true })
onBeforeUnmount(() => { loadSequence++ })

function formatRange(low: number, high: number): string {
  return `${low}–${high}`
}

/** 距离条仅用于量程元数据正确的快照；位置不是人群排名。 */
function distanceLeft(distance: number, rangeLow: number, rangeHigh: number): number {
  const span = Math.max(1, rangeHigh - rangeLow)
  const ratio = (distance + span / 2) / span
  return Math.min(100, Math.max(0, ratio * 100))
}
</script>

<template>
  <PageContainer page="result">
    <p v-if="loading" class="text-[15px] text-ink-soft" data-bigfive-report-loading>正在载入报告…</p>

    <div v-else-if="error" class="notice-error max-w-prose" role="alert" data-bigfive-report-error>
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>{{ error.message }}</span>
      </p>
      <p v-if="error.requestId" class="mt-2 break-all text-[12.5px]">
        报障编号：<code class="font-mono">{{ error.requestId }}</code>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn-secondary btn-sm" @click="load">重试</button>
        <RouterLink to="/reports" class="btn-ghost btn-sm">回到历史报告</RouterLink>
      </div>
    </div>

    <div v-else-if="renderError" class="notice-error max-w-prose" role="alert" data-bigfive-report-broken>
      <p class="text-[14.5px] leading-relaxed">{{ renderError }}</p>
      <p class="mt-2 text-[13.5px] leading-relaxed">
        报告内容在提交时就已冻结，不会自动重算。请把报告编号
        <code class="font-mono">{{ reportId }}</code> 一并反馈。
      </p>
    </div>

    <template v-else-if="detail && report">
      <header class="report-cover">
        <span class="report-number">大五人格倾向测评</span>
        <InstrumentArtwork kind="big_five" />
        <p class="caption">
          {{ detail.instrumentTitle }} · {{ createdAtText }}
        </p>
        <h1 class="mt-2 text-[24px] font-semibold leading-snug text-ink tablet:text-[28px]">
          {{ report.profileTitle }}
        </h1>
        <p class="mt-3 max-w-prose text-[15.5px] leading-relaxed text-ink">{{ report.summary }}</p>
        <p v-if="hasHistoricalRangeError" class="notice-uncertain mt-4" data-historical-range-warning>
          这份旧报告保存的分数范围有误，因此暂不显示位置条。原始分与原报告保持不变；完整作答时各方面的正确范围均为 10–50 分。
        </p>
      </header>

      <section class="mt-6 max-w-prose" aria-label="带走这份报告" data-bigfive-export>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary btn-sm" :disabled="copying" @click="copySummary">
            <AppIcon name="copy" :size="16" />{{ copying ? '正在复制…' : '复制报告摘要' }}
          </button>
          <button type="button" class="btn-secondary btn-sm" :disabled="downloading" @click="downloadImage">
            <AppIcon name="download" :size="16" />{{ downloading ? '正在生成…' : '保存摘要图片' }}
          </button>
          <RouterLink to="/reports/compare/big-five" class="btn-ghost btn-sm">比较两次大五</RouterLink>
        </div>
        <p v-if="actionNotice" class="caption mt-2" role="status">{{ actionNotice }}</p>
        <details class="mt-3"><summary class="cursor-pointer caption">查看可复制的摘要与图片替代文本</summary>
          <pre class="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed">{{ exportModel?.text }}</pre>
          <p class="caption mt-2">图片替代文本：{{ exportModel?.alt }}</p>
        </details>
      </section>

      <!-- ① 这次的结果 -->
      <section class="mt-8" aria-labelledby="bigfive-dimensions">
        <h2 id="bigfive-dimensions" class="section-title">这次五个维度的样子</h2>
        <p class="caption mt-1 max-w-prose">
          五项分别解读，不加总、不排名。
        </p>

        <ul class="mt-4 grid gap-4" data-bigfive-dimensions>
          <li
            v-for="dimension in report.dimensions"
            :key="dimension.dimension"
            class="card"
            :data-dimension="dimension.dimension"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 class="text-[17px] font-semibold leading-snug text-ink">{{ plainBigFiveRow(dimension)?.title ?? dimension.name }}</h3>
              <p class="caption">{{ dimension.question }}</p>
            </div>

            <template v-if="dimension.hasResult">
              <div class="mt-3 flex flex-wrap items-center gap-3">
                <span class="chip chip-primary">{{ dimension.levelLabel ?? dimension.level }}</span>
                <span class="text-[13.5px] text-ink-soft">
                  偏向：{{ dimension.sideLabel ?? dimension.direction }}
                </span>
              </div>

              <div v-if="plainBigFiveRow(dimension)" class="mt-3 text-[14.5px] leading-relaxed text-ink" data-plain-report>
                <p>{{ plainBigFiveRow(dimension)?.result }}</p>
                <p class="mt-2 text-ink-soft">{{ plainBigFiveRow(dimension)?.example }}</p>
                <p class="mt-2 text-[12px] text-ink-soft">例子只帮助理解；这不是能力、人品或人群排名。</p>
              </div>
              <p v-else-if="dimension.description" class="mt-3 text-[14.5px] leading-relaxed text-ink">{{ dimension.description }}</p>

              <details class="mt-3">
                <summary class="cursor-pointer text-[13.5px] font-medium text-ink-soft">查看分数、例子与判断依据</summary>
                <p v-if="dimension.description" class="mt-3 text-[14.5px] leading-relaxed text-ink">{{ dimension.name }}：{{ dimension.description }}</p>
              <!-- 距离条：以中点为 0，两端为这次作答可能到达的极值 -->
              <div class="mt-4">
                <div v-if="!hasHistoricalRangeError" class="relative h-2 w-full rounded-full bg-line">
                  <div class="absolute inset-y-0 left-1/2 w-px bg-line-strong" aria-hidden="true" />
                  <div
                    class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-600 ring-2 ring-surface"
                    :style="{ left: `${distanceLeft(dimension.distance ?? 0, dimension.rangeLow, dimension.rangeHigh)}%` }"
                    aria-hidden="true"
                  />
                </div>
                <p class="caption mt-2">
                  原始分 {{ dimension.rawScore }}（{{ hasHistoricalRangeError ? '旧报告记录的范围，已知有误' : '这次作答的范围' }} {{ formatRange(dimension.rangeLow, dimension.rangeHigh) }}，
                  中点 {{ dimension.midpoint }}）· 离中点
                  {{ dimension.distance }} 分 · 有效作答 {{ dimension.validCount }} 题
                </p>
              </div>

              <p class="mt-2 max-w-prose text-[14.5px] leading-relaxed text-ink">
                {{ dimension.reading }}
              </p>

              <div v-if="dimension.dailySigns.length > 0" class="mt-3">
                <p class="text-[13.5px] font-medium text-ink">日常里可能长这样</p>
                <ul class="mt-1.5 grid gap-1 text-[14px] leading-relaxed text-ink-soft">
                  <li v-for="(sign, signIndex) in dimension.dailySigns" :key="signIndex" class="flex gap-2">
                    <span aria-hidden="true">·</span>
                    <span>{{ sign }}</span>
                  </li>
                </ul>
              </div>

              </details>

              <p v-if="dimension.observation" class="notice-info mt-3 text-[13.5px] leading-relaxed">
                <span class="font-medium">可以留意：</span>{{ dimension.observation }}
              </p>
            </template>

            <!-- 没有结论时如实说，绝不画成"接近中间" -->
            <div v-else class="notice-uncertain mt-3 text-[14px] leading-relaxed" data-dimension-undecided>
              <p class="font-medium">这一维这次没有给出方向。</p>
              <p class="mt-1">
                有效作答 {{ dimension.validCount }} 题（需要至少 10 题），其中
                {{ dimension.unknownCount }} 题选了「说不好」、
                {{ dimension.unprocessedCount }} 题没有处理过。
                低于下限时不推断方向 —— 少于 10 题的信息不足以支撑一个说法。
              </p>
            </div>

            <p class="caption mt-3">{{ dimension.caution }}</p>
          </li>
        </ul>
      </section>

      <!-- ② 这次可靠到什么程度 -->
      <section class="mt-8" aria-labelledby="bigfive-coverage">
        <h2 id="bigfive-coverage" class="section-title flex items-center gap-2">
          <AppIcon name="shield" :size="18" class="text-primary-600" />
          哪些方面答得够，哪些还看不清
        </h2>
        <div class="card mt-3 max-w-prose" data-bigfive-coverage>
          <ul class="grid gap-1.5 text-[14px] leading-relaxed text-ink-soft">
            <li>五维都达到有效作答下限：{{ report.coverage.coverageOk ? '是' : '否' }}；这次给出方向的维度 {{ decided.length }} / 5。</li>
            <li>选「说不好」的题共 {{ report.coverage.unknownCount }} 道；完全没处理的题 {{ report.coverage.unprocessedCount }} 道。</li>
            <li v-if="undecided.length > 0">
              没有给出方向的维度：{{ undecided.map((item) => item.name).join('、') }}。
            </li>
            <li>
              以下因素会让同一份题在别的日子得出不同结果：当时的处境与情绪、最近发生的事、
              对题面的理解。所以这里描述的是<span class="font-medium text-ink">这次作答时</span>的样子，
              不是稳定的性格定论。
            </li>
          </ul>
        </div>
      </section>

      <!-- ③ 读这份报告的建议顺序 -->
      <section v-if="report.readingOrder.length > 0" class="mt-8" aria-labelledby="bigfive-order">
        <h2 id="bigfive-order" class="section-title flex items-center gap-2">
          <AppIcon name="book" :size="18" class="text-primary-600" />
          怎么读这份报告
        </h2>
        <ol class="mt-3 grid max-w-prose gap-2">
          <li v-for="(step, stepIndex) in report.readingOrder" :key="stepIndex" class="flex gap-3">
            <span class="chip chip-neutral shrink-0">{{ stepIndex + 1 }}</span>
            <span class="text-[14.5px] leading-relaxed text-ink">
              {{ step.step }}
              <span class="mt-0.5 block text-[13.5px] text-ink-soft">{{ step.why }}</span>
            </span>
          </li>
        </ol>
      </section>

      <!-- ④ 限制（默认展开：这是"不许当成诊断"的落点，藏起来不合适） -->
      <section v-if="report.limitations.length > 0" class="mt-8" aria-labelledby="bigfive-limits">
        <h2 id="bigfive-limits" class="section-title">这份报告不能用来做什么</h2>
        <ul class="notice-neutral mt-3 grid max-w-prose gap-1.5 text-[14px] leading-relaxed" data-bigfive-limitations>
          <li v-for="(item, itemIndex) in report.limitations" :key="itemIndex" class="flex gap-2">
            <span aria-hidden="true">·</span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </section>

      <!-- 方法论折起来 -->
      <details class="mt-8 max-w-prose" data-bigfive-method>
        <summary class="cursor-pointer text-[13.5px] font-medium text-ink-soft">
          这一页的分数是怎么算出来的
        </summary>
        <div class="mt-3 grid gap-2 text-[13.5px] leading-relaxed text-ink-soft">
          <p>
            50 道自评句，每维 10 题。每题按 1–5 作答，计分键表决定正向题还是反向题；
            该维原始分 = 整维基准分 + Σ（方向 × 作答）。基准分把"每题都选中立档"定在中点上。
          </p>
          <p>
            「说不好」与未作答都<b>不计入</b>有效题数，也不会被补成中间档；
            某维有效作答少于 10 题时不给方向。
          </p>
          <p>
            题目来自 IPIP-50（International Personality Item Pool，Goldberg Big-Five Factor Markers，
            公有领域）；中文题面与逐题解释是本仓库的改写稿。完整作答时，每维范围均为 10–50 分。
          </p>
        </div>
      </details>

      <AiAnalysisPanel v-if="reportId" :key="reportId" :report-id="reportId" requires-readable />

      <div class="mt-8 flex flex-wrap items-center gap-2">
        <RouterLink to="/reports" class="btn-secondary btn-sm">看全部历史报告</RouterLink>
        <RouterLink to="/instruments" class="btn-ghost btn-sm">再测一次</RouterLink>
        <RouterLink to="/about" class="btn-ghost btn-sm">方法说明</RouterLink>
      </div>
    </template>
  </PageContainer>
</template>
