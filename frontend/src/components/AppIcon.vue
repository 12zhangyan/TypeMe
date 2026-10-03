<script setup lang="ts">
import { computed } from 'vue'

/**
 * 极简图标集（本地 SVG，24×24 线性描边）。
 *
 * ## 为什么自己画而不用图标库
 *
 * 装一个图标包（或引一个图标字体）会带来三件事：新依赖、首屏多一次请求、
 * 以及一套和本项目视觉语言不同的线条风格。这里用到的一共十几个形状，
 * 全部是 24×24 网格上的直线/圆弧，自己写反而更可控。
 *
 * ## 使用纪律
 *
 * - 图标**永远不单独承载语义**：它旁边必须有文字，或调用方提供 `title`
 *   才会进入无障碍树；否则一律 `aria-hidden`（纯装饰）。
 * - 尺寸由 `size` 控制，默认 20；深色区域用 `currentColor` 继承文字色，
 *   不需要额外配色。
 */
type IconName =
  | 'spark'
  | 'compass'
  | 'dimensions'
  | 'target'
  | 'steps'
  | 'question'
  | 'shield'
  | 'refresh'
  | 'alert'
  | 'info'
  | 'check'
  | 'clock'
  | 'arrow-right'
  | 'arrow-down'
  | 'book'
  | 'compare'
  | 'user'
  | 'sliders'
  | 'lock'
  | 'download'
  | 'copy'
  | 'chart'

const props = withDefaults(
  defineProps<{
    name: IconName
    /** 像素尺寸（正方形） */
    size?: number
    /** 提供后图标进入无障碍树（否则视为装饰） */
    title?: string
  }>(),
  { size: 20, title: undefined },
)

/** 每个图标只描述形状，描边属性统一由外层 <svg> 给。 */
const PATHS: Record<IconName, string[]> = {
  // 洞察 / 灵光
  spark: ['M12 3v4M12 17v4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M3 12h4M17 12h4M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8'],
  // 探索
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm15.5 8.5-2.1 5-5 2.1 2.1-5 5-2.1Z'],
  // 维度 / 双极
  dimensions: ['M3 12h18', 'M6.5 8.5 3 12l3.5 3.5', 'M17.5 8.5 21 12l-3.5 3.5', 'M12 4.5v3M12 16.5v3'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Z', 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
  // 步骤 / 行动
  steps: ['M4 6h5M4 12h10M4 18h16', 'M17.5 4.5 20 6l-2.5 1.5Z'],
  question: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.6 9.2a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.6v.4', 'M12 17.2h.01'],
  shield: ['M12 3 5 6v5.5c0 4 2.9 7.4 7 8.5 4.1-1.1 7-4.5 7-8.5V6l-7-3Z', 'm9.2 12 2 2 3.6-3.8'],
  refresh: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 5v6h-6'],
  alert: ['M12 4.5 3.2 19.5h17.6L12 4.5Z', 'M12 10v4.2', 'M12 17.2h.01'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.2', 'M12 7.8h.01'],
  check: ['m5 13 4.5 4.5L19 7'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  'arrow-right': ['M4 12h15', 'm13 6 6 6-6 6'],
  'arrow-down': ['M12 4v15', 'm6 13 6 6 6-6'],
  book: ['M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z', 'M4 18.5A2.5 2.5 0 0 1 6.5 16H19'],
  compare: ['M12 4v16', 'M7 8 3 12l4 4', 'm17 8 4 4-4 4'],
  user: ['M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M5 20a7 7 0 0 1 14 0'],
  sliders: ['M5 7h14M5 12h14M5 17h14', 'M9 5v4M15 10v4M8 15v4'],
  lock: ['M6.5 11h11v9h-11v-9Z', 'M9 11V8a3 3 0 0 1 6 0v3'],
  download: ['M12 4v11', 'm7.5 11 4.5 4.5 4.5-4.5', 'M5 20h14'],
  copy: ['M9 9h9.5v11H9V9Z', 'M6.5 15H5.5V4H15v1'],
  chart: ['M4 20h16', 'M7 20V11M12 20V5M17 20v-6'],
}

const paths = computed(() => PATHS[props.name] ?? [])
const labelled = computed(() => typeof props.title === 'string' && props.title.length > 0)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="shrink-0"
    :role="labelled ? 'img' : undefined"
    :aria-hidden="labelled ? undefined : 'true'"
    :aria-label="labelled ? title : undefined"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
