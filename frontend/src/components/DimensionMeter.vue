<script setup lang="ts">
import { computed } from 'vue'

/**
 * 维度位置条（报告 / 报告预览 / 对比页共用）。
 *
 * ## 它在画什么，以及刻意不画什么
 *
 * 画的是服务端给的 `position`（0..1 的归一化位置，中点 0.5 表示两侧接近）。
 * 它是**位置**，不是分数、不是百分比、不是"有多像"：
 *
 *   - 位置点用实心圆 + 光晕表示，**不画从中心到点的填充条** ——
 *     填充条会被读成"你有多偏"的强度条，而本量表没有这个语义；
 *   - 两端只写字母与中文标签，不做任何"好/坏"配色；
 *   - 平分（`computedPole === null`）时点上画两个相邻的半圆，明确表示"两边都在"；
 *   - 不可计分（`position === null`）时轨道改成虚线，并写"本次不可计分"。
 *
 * ## 文本替代
 *
 * 整个图形 `role="img"` + `aria-label`，取服务端生成的 `ariaLabel`
 * （内容含维度名、两端标签与状态）。也就是说，**只看颜色或只看图形都读不出结论**，
 * 读屏用户拿到的信息与视觉用户一致。
 *
 * 调用方还可以传 `showDetails` / `showCounts` 决定这一条到哪里为止：
 * 报告页要完整，首页预览只要形。
 */
export interface MeterRow {
  dimension: string
  name: string
  negativePole: string
  negativeLabel: string
  positivePole: string
  positiveLabel: string
  /** 0..1；null = 本次这一维不可计分 */
  position: number | null
  computedPole: string | null
  tiedSide: 'positive' | 'negative' | 'tied'
  boundary: boolean
  coverageOk: boolean
  statusNote?: string
  ariaLabel?: string
  details?: string[]
  nFinal?: number
  nBase?: number
  nClar?: number
  clarificationScheduled?: boolean
  clarificationApplied?: boolean
  clarificationSkipped?: boolean
}

const props = withDefaults(
  defineProps<{
    row: MeterRow
    /** 显示 `details` 与可计分题数（报告页用） */
    showDetails?: boolean
    /** 紧凑模式：首页预览用，少一层竖向留白 */
    compact?: boolean
    /** 序号（报告页按 01/02 排） */
    index?: number
  }>(),
  { showDetails: false, compact: false, index: undefined },
)

/**
 * 位置点在轨道上的百分比位置。
 *
 * 刻意**不做**边距修正（例如"两端各留 6%"）：那会让「服务端的 0.625」
 * 与「页面上的 62.5%」不再是同一个数，而"位置就是服务端给的那个比例"
 * 是这张图唯一可以被核对的语义。点越界时由轨道自己的 `overflow` 视觉兜住。
 */
const dotPercent = computed(() => {
  const position = props.row.position
  if (position === null) return null
  return Math.min(Math.max(position, 0), 1) * 100
})

/**
 * 状态标签。
 *
 * 与 `domain/reportV3.ts` 的 `statusNote` 同一套口径，只是这里要点成一个短标签：
 * 「偏向 E」「略偏 E」「两边接近」「信息不足」。**不出现任何百分数**。
 */
const stateChip = computed(() => {
  const row = props.row
  if (!row.coverageOk) return { label: '信息不足', tone: 'chip-neutral' as const }
  if (row.computedPole === null) return { label: '两边接近', tone: 'chip-primary' as const }
  if (row.boundary) return { label: `略偏 ${row.computedPole}`, tone: 'chip-accent' as const }
  return { label: `偏向 ${row.computedPole}`, tone: 'chip-primary' as const }
})

/** 位置点的颜色：偏向侧用主色，平分用两端各一半，信息不足不给点。 */
const dotTone = computed(() => {
  const row = props.row
  if (row.computedPole === null) return 'both'
  return 'single'
})

const label = computed(
  () =>
    props.row.ariaLabel ??
    `${props.row.name}：${props.row.negativeLabel} ${props.row.negativePole} ↔ ${props.row.positiveLabel} ${props.row.positivePole}`,
)

const countsText = computed(() => {
  const row = props.row
  if (row.nFinal === undefined) return null
  const parts = [`可计分 ${row.nFinal} 题`]
  if (row.nBase !== undefined) {
    parts.push(`主测 ${row.nBase}${row.nClar !== undefined ? ` · 补充 ${row.nClar}` : ''}`)
  }
  if (row.clarificationScheduled) {
    parts.push(
      row.clarificationApplied
        ? '补充题已计入'
        : row.clarificationSkipped
          ? '补充题被你跳过了（只按主测绘）'
          : '补充题尚未计入',
    )
  }
  return parts.join(' · ')
})
</script>

<template>
  <article
    class="rounded-question border bg-surface px-4 shadow-card"
    :class="[compact ? 'py-3.5' : 'py-4', row.boundary ? 'border-accent-200' : 'border-line']"
    :data-dimension="row.dimension"
    :data-meter-state="stateChip.label"
  >
    <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
      <h3 class="flex items-baseline gap-2 text-[16px] font-semibold text-ink">
        <span v-if="index !== undefined" class="section-index" aria-hidden="true">
          {{ String(index + 1).padStart(2, '0') }}
        </span>
        {{ row.name }}
      </h3>
      <span class="chip" :class="stateChip.tone">{{ stateChip.label }}</span>
    </div>

    <!-- 位置图：role=img + 服务端生成的 aria-label -->
    <div class="mt-3" role="img" :aria-label="label">
      <div class="flex items-baseline justify-between gap-2 text-[12.5px]">
        <!--
          两端标签与字母必须在**同一个文本节点**里（"内倾 I"）：
          这不只是排版，而是报告页单测与读屏用户读到的那句话的形状。
          把它们拆成两个相邻元素会让 `wrapper.text()` 得到 "内倾\n I"，
          也会让"标签 + 字母"这个组合在复制粘贴时断成两截。
        -->
        <span class="font-medium" :class="row.computedPole === row.negativePole ? 'text-ink' : 'text-ink-faint'">{{ row.negativeLabel }} <span class="font-display font-bold">{{ row.negativePole }}</span></span>
        <span class="text-[11.5px] text-ink-faint" aria-hidden="true">中点</span>
        <span class="font-medium" :class="row.computedPole === row.positivePole ? 'text-ink' : 'text-ink-faint'"><span class="font-display font-bold">{{ row.positivePole }}</span> {{ row.positiveLabel }}</span>
      </div>

      <div
        class="relative mt-2 h-3 w-full rounded-pill"
        :class="row.position === null ? 'border border-dashed border-line-strong bg-transparent' : 'bg-line-soft'"
      >
        <!-- 中点刻度：只有一条细线，不做"合格线"的暗示 -->
        <div class="absolute inset-y-[-3px] left-1/2 w-px -translate-x-1/2 bg-ink/30" aria-hidden="true" />

        <template v-if="dotPercent !== null">
          <!-- 光晕：让位置点在一屏之外也看得见，且不表示强度 -->
          <div
            class="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-400/25"
            :style="{ left: `${dotPercent}%` }"
            aria-hidden="true"
          />
          <div
            class="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600 shadow-card"
            :class="dotTone === 'both' ? 'ring-2 ring-accent-300' : ''"
            :style="{ left: `${dotPercent}%` }"
            aria-hidden="true"
            data-position-dot
          />
        </template>
        <p v-else class="absolute inset-0 flex items-center justify-center text-[12px] text-ink-faint">
          本次不可计分
        </p>
      </div>
    </div>

    <p v-if="row.statusNote" class="mt-3 text-[14.5px] font-medium text-ink">{{ row.statusNote }}</p>

    <ul v-if="showDetails && row.details && row.details.length > 0" class="mt-2 space-y-1.5">
      <li
        v-for="(detail, detailIndex) in row.details"
        :key="detailIndex"
        class="text-[13.5px] leading-relaxed text-ink-soft"
      >
        {{ detail }}
      </li>
    </ul>

    <p v-if="showDetails && countsText" class="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
      {{ countsText }}
    </p>
  </article>
</template>
