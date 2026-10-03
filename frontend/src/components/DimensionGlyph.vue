<script setup lang="ts">
import { computed, useId } from 'vue'
import { POLE_PAIRS } from '@/domain/scoring'

/**
 * 首页主视觉：四维探索图（本地 SVG，深色区域专用）。
 *
 * ## 它是什么 / 不是什么
 *
 * **是什么**：四条穿过中心的轴，每条轴代表量表的一个维度，两端分别是该维的两极；
 * 轴上有节点、节点之间有一条虚线路径 —— 表达"偏好是一条连续的带，
 * 你在两端之间来回"这个产品到底在测什么。
 *
 * **不是什么**：**不是**任何人的成绩单。节点位置是固定的装饰排布，
 * 不由任何作答计算，也不随用户数据变化（拿不到、也不接受分数 props）。
 * 图内和旁边都有"示意图"字样，避免和报告页那张真图混淆。
 *
 * ## 为什么要换掉上一版
 *
 * 上一版是浅灰底 + 四条横线轨道，放在浅色页面上像一张没有被填充的进度条 ——
 * 既不像"探索"，也容易被误读成"还没测"。这一版改成深色区域里的雷达式轴，
 * 配合极缓慢的虚线流动，视觉上更像罗盘/星图，和"了解自己在哪一端"这件事同构。
 *
 * ## 无障碍
 *
 * 整块 `aria-hidden`：它是装饰，读屏用户不会因为它被打断。
 * 同一份信息（四个维度名与两极）在页面正文的「会测到的四个维度」里是**真文字**。
 */
export interface GlyphTrack {
  dimension: string
  /** 轨道旁的小标签（维度名） */
  name: string
  /** 一端记号 */
  low: string
  /** 另一端记号 */
  high: string
}

const props = withDefaults(defineProps<{ compact?: boolean; tracks?: GlyphTrack[] | null }>(), {
  compact: false,
  tracks: null,
})

/** SVG 内的渐变/滤镜 id 必须全局唯一，否则同页多个实例会互相覆盖。 */
const uid = useId()

/** 旧调用方的兜底：OEJTS 四维。 */
const DEFAULT_TRACKS: GlyphTrack[] = POLE_PAIRS.map((item) => ({
  dimension: String(item.dimension),
  name: item.name,
  low: item.meta.negativePole,
  high: item.meta.positivePole,
}))

const tracks = computed<GlyphTrack[]>(() =>
  props.tracks && props.tracks.length > 0 ? props.tracks : DEFAULT_TRACKS,
)

/** 画布是正方形，中心 (230, 230)，坐标全部按它算，改尺寸只需要改这一处。 */
const CENTER = 230
const AXIS_RADIUS = 138
const LABEL_RADIUS = 176

/**
 * 四条轴的起始角（度，0 = 正上方，顺时针）。
 *
 * 刻意**不等分 90°**：等分看上去像坐标纸，略微歪一点才像罗盘。
 * 同时四条轴的两端与标签不能互相压字，所以角度是挑过的。
 */
const AXIS_ANGLES = [-24, 62, 152, 246]

/**
 * 每条轴上节点的位置（-1 = 负极端，1 = 正极端）。
 *
 * **这是装饰排布，不是分数**：四个值刻意各不相同，让图看起来是"有人待在不同位置"，
 * 但它们与任何用户的作答无关，也不随数据变化（组件根本不接受分数入参）。
 */
const NODE_OFFSETS = [-0.42, 0.26, -0.18, 0.5]

interface Axis {
  key: string
  name: string
  low: string
  high: string
  /** 轴两端坐标 */
  x1: number
  y1: number
  x2: number
  y2: number
  /** 节点坐标 */
  nx: number
  ny: number
  /** 标签坐标与对齐 */
  lowX: number
  lowY: number
  highX: number
  highY: number
  lowAnchor: 'start' | 'middle' | 'end'
  highAnchor: 'start' | 'middle' | 'end'
}

function point(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTER + Math.cos(rad) * radius, y: CENTER + Math.sin(rad) * radius }
}

const axes = computed<Axis[]>(() =>
  tracks.value.map((track, index) => {
    const angle = AXIS_ANGLES[index % AXIS_ANGLES.length]!
    const negEnd = point(angle, AXIS_RADIUS)
    const posEnd = point(angle + 180, AXIS_RADIUS)
    const offset = NODE_OFFSETS[index % NODE_OFFSETS.length]!
    const node = point(angle + (offset < 0 ? 180 : 0), AXIS_RADIUS * Math.abs(offset))
    const labelNeg = point(angle, LABEL_RADIUS)
    const labelPos = point(angle + 180, LABEL_RADIUS)

    // 标签水平对齐按它相对圆心的位置定，避免文字压到轴上
    const anchorOf = (x: number): 'start' | 'middle' | 'end' =>
      x < CENTER - 24 ? 'end' : x > CENTER + 24 ? 'start' : 'middle'

    return {
      key: track.dimension,
      name: track.name,
      low: track.low,
      high: track.high,
      x1: negEnd.x,
      y1: negEnd.y,
      x2: posEnd.x,
      y2: posEnd.y,
      nx: node.x,
      ny: node.y,
      lowX: labelNeg.x,
      lowY: labelNeg.y,
      highX: labelPos.x,
      highY: labelPos.y,
      lowAnchor: anchorOf(labelNeg.x),
      highAnchor: anchorOf(labelPos.x),
    }
  }),
)

/** 节点之间连一条虚线路径：表达"几个维度是连在一起看的"。 */
const pathD = computed(() => {
  const list = axes.value
  if (list.length < 2) return ''
  return `M ${list.map((axis) => `${axis.nx.toFixed(1)} ${axis.ny.toFixed(1)}`).join(' L ')} Z`
})
</script>

<template>
  <svg
    viewBox="0 0 460 460"
    class="h-full w-full"
    role="presentation"
    aria-hidden="true"
    focusable="false"
    data-hero-orbit
  >
    <defs>
      <!-- 中心向外扩散的光晕：把视线引到中间 -->
      <radialGradient :id="`coreGlow-${uid}`" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#5AD7E8" stop-opacity="0.55" />
        <stop offset="60%" stop-color="#5AD7E8" stop-opacity="0.08" />
        <stop offset="100%" stop-color="#5AD7E8" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`nodeFill-${uid}`" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#7FE3F0" />
        <stop offset="100%" stop-color="#2BB3C9" />
      </linearGradient>
    </defs>

    <!-- 外层刻度环：最外一圈的"量角器"感，纯装饰 -->
    <circle
      :cx="CENTER"
      :cy="CENTER"
      :r="AXIS_RADIUS + 26"
      fill="none"
      stroke="#B6D3E6"
      stroke-opacity="0.18"
      stroke-width="1"
      stroke-dasharray="2 8"
    />
    <circle
      :cx="CENTER"
      :cy="CENTER"
      :r="AXIS_RADIUS + 54"
      fill="none"
      stroke="#B6D3E6"
      stroke-opacity="0.1"
      stroke-width="1"
    />

    <!-- 中心光晕：不是"分数"，只是把视线引到中间 -->
    <circle :cx="CENTER" :cy="CENTER" :r="130" :fill="`url(#coreGlow-${uid})`" />

    <!-- 四条维度轴 -->
    <g v-for="axis in axes" :key="axis.key" :data-hero-axis="axis.key">
      <line
        :x1="axis.x1"
        :y1="axis.y1"
        :x2="axis.x2"
        :y2="axis.y2"
        stroke="#B6D3E6"
        stroke-opacity="0.3"
        stroke-width="1.5"
        stroke-linecap="round"
      />
      <!-- 两端刻度：短促的一笔，表示"端点是可站的地方" -->
      <circle :cx="axis.x2" :cy="axis.y2" r="3" fill="#B6D3E6" fill-opacity="0.45" />

      <!-- 节点：本次姿态未知，只是"有人在某处"的意思 -->
      <circle :cx="axis.nx" :cy="axis.ny" r="13" :fill="`url(#nodeFill-${uid})`" fill-opacity="0.18" />
      <circle :cx="axis.nx" :cy="axis.ny" r="5.2" :fill="`url(#nodeFill-${uid})`" />
      <circle :cx="axis.nx" :cy="axis.ny" r="1.6" fill="#081320" />

      <!-- 维度名（在靠近中心处，随轴向外） -->
      <text
        v-if="!compact"
        :x="axis.nx"
        :y="axis.ny - 16"
        font-size="12.5"
        fill="#E4EFF7"
        fill-opacity="0.82"
        font-weight="600"
        :text-anchor="axis.lowAnchor"
      >
        {{ axis.name }}
      </text>

      <!-- 两极记号：两端各一个字母，是这张图里唯一的"真数据"（量表的极） -->
      <text
        :x="axis.lowX"
        :y="axis.lowY + 4"
        font-size="14"
        fill="#7FE3F0"
        font-weight="700"
        :text-anchor="axis.lowAnchor"
      >
        {{ axis.low }}
      </text>
      <text
        :x="axis.highX"
        :y="axis.highY + 4"
        font-size="14"
        fill="#5AD7E8"
        fill-opacity="0.62"
        font-weight="700"
        :text-anchor="axis.highAnchor"
      >
        {{ axis.high }}
      </text>
    </g>

    <!-- 节点之间的虚线路径：缓慢流动，表达"这些维度是一起看的" -->
    <path
      v-if="pathD"
      :d="pathD"
      fill="none"
      stroke="#5AD7E8"
      stroke-opacity="0.35"
      stroke-width="1.2"
      stroke-dasharray="5 9"
      class="animate-trace-flow"
    />

    <!-- 中心：一个菱形，别用"靶心"（容易被读成准确度） -->
    <g :transform="`translate(${CENTER} ${CENTER})`">
      <rect x="-7" y="-7" width="14" height="14" rx="2" transform="rotate(45)" fill="#0B1A28" stroke="#7FE3F0" stroke-opacity="0.75" stroke-width="1.4" />
      <circle r="2" fill="#7FE3F0" />
    </g>

    <!-- 明确写清这是示意图，避免被当成某人的结果 -->
    <text
      v-if="!compact"
      :x="CENTER"
      :y="452"
      font-size="11.5"
      fill="#B6D3E6"
      fill-opacity="0.62"
      text-anchor="middle"
    >
      示意图：{{ axes.length }} 条轴对应 {{ axes.length }} 个维度，不代表任何人的分数
    </text>
  </svg>
</template>
