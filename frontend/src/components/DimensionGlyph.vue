<script setup lang="ts">
import { computed } from 'vue'
import { POLE_PAIRS } from '@/domain/scoring'

/**
 * 首页维度抽象图形 —— 文档 §4.5「首页四维原创图形规格」，本轮泛化为「N 维」。
 *
 * 硬约束：
 *   - **本地 SVG**，不依赖外站头像、网络字体或第三方人物插画；
 *   - 属于装饰，**不表现虚构的个人分数**（没有刻度、没有填充比例）；
 *   - 每个维度一条粗细适中的轨道 + 几何端点，每条旁有该维的展示名称与两端记号；
 *   - `aria-hidden`：装饰不进入无障碍树，读屏用户不会被无用图形打断。
 *
 * 轨道由调用方按**当前内容包**传入（OEJTS 四维 / IPIP 大五五维）；
 * 不传时退回 OEJTS 的四维（保持旧调用方的渲染结果不变）。
 *
 * 手机把它缩成约 120px 高的局部装饰（由父级控制容器高度），PC 上放大到约 420×438。
 */
export interface GlyphTrack {
  dimension: string
  /** 轨道旁的小标签（维度名） */
  name: string
  /** 左端记号（数值低侧） */
  low: string
  /** 右端记号（数值高侧） */
  high: string
}

const props = withDefaults(defineProps<{ compact?: boolean; tracks?: GlyphTrack[] | null }>(), {
  compact: false,
  tracks: null,
})

/** 旧调用方的兜底：OEJTS 四维（与泛化前的图形完全一致）。 */
const DEFAULT_TRACKS: GlyphTrack[] = POLE_PAIRS.map((item) => ({
  dimension: String(item.dimension),
  name: item.name,
  low: item.meta.negativePole,
  high: item.meta.positivePole,
}))

const tracks = computed<GlyphTrack[]>(() =>
  props.tracks && props.tracks.length > 0 ? props.tracks : DEFAULT_TRACKS,
)

/** 轨道间距固定 78：四维时 viewBox 高度仍是 360，与泛化前逐像素一致。 */
const TRACK_GAP = 78
const FIRST_TRACK_Y = 28
/** 末条轨道到画布底边的留白（含底部说明行）。 */
const TAIL_SPACE = 98

const viewHeight = computed(() => FIRST_TRACK_Y + (tracks.value.length - 1) * TRACK_GAP + TAIL_SPACE)
const footerY = computed(() => viewHeight.value - 16)
</script>

<template>
  <svg
    :viewBox="`0 0 420 ${viewHeight}`"
    class="h-full w-full"
    role="presentation"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 浅色底：不是分数，只是分层 -->
    <rect x="0" y="0" width="420" :height="viewHeight" rx="24" fill="#EEEDE7" />

    <!-- 每个维度一条轨道：左端 = 低分侧，右端 = 高分侧 -->
    <g
      v-for="(item, index) in tracks"
      :key="item.dimension"
      :transform="`translate(0, ${FIRST_TRACK_Y + index * TRACK_GAP})`"
    >
      <!-- 轨道 -->
      <path
        :d="`M 34 ${22 + (index % 2 === 0 ? 0 : 6)} C 130 ${2 + (index % 2 === 0 ? -10 : 12)}, 290 ${
          46 + (index % 2 === 0 ? 8 : -12)
        }, 386 ${22 + (index % 2 === 0 ? 4 : 0)}`"
        fill="none"
        :stroke="index % 2 === 0 ? '#264E70' : '#52616B'"
        :stroke-width="index === 0 ? 3 : 2"
        :stroke-opacity="index === 0 ? 1 : 0.5"
        stroke-linecap="round"
      />

      <!-- 几何端点 -->
      <circle
        cx="34"
        :cy="22 + (index % 2 === 0 ? 0 : 6)"
        r="5"
        fill="#FFFFFF"
        stroke="#264E70"
        stroke-width="2"
      />
      <rect
        x="378"
        :y="22 + (index % 2 === 0 ? 4 : 0) - 5"
        width="10"
        height="10"
        rx="3"
        fill="#B85332"
      />

      <!-- 小标签（维度名 + 两端记号），标签只是标识，不是数据 -->
      <text
        x="34"
        :y="22 + (index % 2 === 0 ? 0 : 6) - 12"
        font-size="13"
        fill="#52616B"
        font-weight="500"
      >
        {{ item.name }}
      </text>
      <text
        x="360"
        :y="22 + (index % 2 === 0 ? 4 : 0) + 24"
        font-size="12"
        fill="#7C8892"
        text-anchor="end"
      >
        {{ item.low }} · {{ item.high }}
      </text>
    </g>

    <!-- 底部一行说明：明确这是示意图，不是你的分数 -->
    <text v-if="!compact" x="34" :y="footerY" font-size="12" fill="#7C8892">
      示意图：{{ tracks.length }} 条轨道对应 {{ tracks.length }} 个维度，不代表任何人的分数
    </text>
  </svg>
</template>
