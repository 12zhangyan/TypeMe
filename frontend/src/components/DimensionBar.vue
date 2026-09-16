<script setup lang="ts">
import { computed } from 'vue'
import type { ReportDimensionRow } from '@/domain/report'
import { DIMENSION_STATUS_NOTE, DIMENSION_STATUS_LABEL } from '@/domain/interpretation'

/**
 * 维度倾向条 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §7.3。
 *
 * 与前一轮实现的关键差别：**输入是报告行模型，而不是「带主导字母的原始结果」**。
 *   - `balanced`：两端名称都显示，**没有主导侧**，不再拼出「两侧接近均衡内向 I」；
 *   - `insufficient`：不画数值点、不显示 0 分或 0%，只说明需要回看哪几题；
 *   - `tentative`：写「本次略偏 N，继续观察」，但 N 不作为确定类型字母；
 *   - 只有 `leaning` 才显示「可用于本次问卷参考组合」。
 *
 * 两端记号**只能**取行模型里的 `lowToken` / `highToken`：那是内容包按当前量表给的
 * （OEJTS 是字母 I/E…，大五是「低/高」）。曾经这里直接查 OEJTS 专用的
 * `NEGATIVE_POLE` / `POSITIVE_POLE`，换成大五后两端记号就整片变成空白。
 */
const props = defineProps<{
  row: ReportDimensionRow
}>()

const negativePole = computed(() => props.row.lowToken)
const positivePole = computed(() => props.row.highToken)

const positionPercent = computed(() =>
  props.row.position === null ? null : Math.round(props.row.position * 1000) / 10,
)

const isInsufficient = computed(() => props.row.status === 'insufficient')
const isBalanced = computed(() => props.row.status === 'balanced')
const isTentative = computed(() => props.row.status === 'tentative')
const isLeaning = computed(() => props.row.status === 'leaning')

const statusTone = computed(() => {
  if (isInsufficient.value) return 'bg-paper-soft text-ink-soft'
  if (isLeaning.value) return 'bg-primary-50 text-primary-800'
  return 'bg-accent-100 text-accent-700'
})

const dotClass = computed(() => (isLeaning.value ? 'bg-primary-600' : 'bg-accent-500'))

/** 本次得分只在真的算过时才显示（信息不足绝不显示 0 分或 0%）。 */
const scoreText = computed(() => {
  if (props.row.score === null) return '本次未计算分数'
  const offset = props.row.signedOffset ?? 0
  const direction = offset === 0 ? '正好落在中点' : `距中点 ${Math.abs(offset)} 分`
  return `本次得分 ${props.row.score} · ${direction}`
})

const countsText = computed(() => {
  const counts = props.row.counts
  if (!counts) return '这一维还没有足够的数字答案，因此没有符号分布。'
  return `符号分布：偏左 ${counts.negative} 题 · 两侧相近 ${counts.neutral} 题 · 偏右 ${counts.positive} 题`
})

const reviewText = computed(() =>
  props.row.reviewItemIds.length > 0
    ? `相关题目：第 ${props.row.reviewItemIds.join('、')} 题`
    : '这一维没有相关题目。',
)
</script>

<template>
  <article
    class="rounded-question border border-line bg-surface px-4 py-4 tablet:px-5 tablet:py-5"
    :aria-label="row.ariaLabel"
  >
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
      <div class="flex flex-wrap items-baseline gap-x-2.5">
        <h3 class="text-[16px] font-semibold text-ink tablet:text-[17px]">{{ row.heading }}</h3>
        <p class="text-[13px] text-ink-soft">
          {{ row.negativeLabel }} {{ negativePole }} ↔ {{ row.positiveLabel }} {{ positivePole }}
        </p>
      </div>
      <span class="rounded-full px-2.5 py-1 text-[12.5px] font-medium" :class="statusTone">
        {{ DIMENSION_STATUS_LABEL[row.status] }}
      </span>
    </div>

    <!-- 位置轨道：中线可见，一个标记点表示位置；信息不足时不画点 -->
    <div class="mt-4">
      <div class="flex items-baseline justify-between text-[12px] text-ink-faint">
        <span class="font-display text-[15px] font-bold text-ink-soft">{{ negativePole }}</span>
        <span class="text-[11.5px]">中点</span>
        <span class="font-display text-[15px] font-bold text-ink-soft">{{ positivePole }}</span>
      </div>
      <div class="relative mt-1.5 h-2.5 w-full rounded-full bg-line-soft">
        <div
          class="absolute inset-y-[-4px] left-1/2 w-px -translate-x-1/2 bg-ink/35"
          aria-hidden="true"
        />
        <div
          v-if="positionPercent !== null"
          class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm transition-[left] duration-300"
          :class="dotClass"
          :style="{ left: `${positionPercent}%` }"
          aria-hidden="true"
        />
        <p
          v-else
          class="absolute inset-0 flex items-center justify-center text-[12px] font-medium text-ink-faint"
        >
          未计分
        </p>
      </div>
    </div>

    <p class="mt-3 text-[15px] font-medium text-ink">{{ row.summary }}</p>
    <p class="mt-1 text-[13px] leading-relaxed text-ink-soft">{{ scoreText }}</p>
    <p class="mt-0.5 text-[12.5px] leading-relaxed text-ink-faint">{{ countsText }}</p>

    <p
      v-if="!isLeaning"
      class="mt-3 rounded-control px-3 py-2.5 text-[13px] leading-relaxed"
      :class="isInsufficient ? 'bg-paper-soft text-ink-soft' : 'bg-accent-100 text-accent-700'"
    >
      {{ DIMENSION_STATUS_NOTE[row.status] }}
      <template v-if="isBalanced">
        两端「{{ row.negativeLabel }}」与「{{ row.positiveLabel }}」的描述都可以参考。
      </template>
      <template v-else-if="isTentative">
        这一侧只是本次作答的方向，不写进{{ row.canJoinType ? '完整类型' : '完整结论' }}。
      </template>
      <template v-else>需要回看的题号见下方「为什么这样描述」。</template>
    </p>

    <p class="mt-2 text-[12.5px] leading-relaxed text-ink-faint">{{ reviewText }}</p>
  </article>
</template>
