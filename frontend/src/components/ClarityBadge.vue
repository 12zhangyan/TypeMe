<script setup lang="ts">
import { computed } from 'vue'
import type { Clarity } from '@/domain/types'
import { CLARITY_CODE_NAME, CLARITY_LABEL } from '@/domain/clarity'

/**
 * 倾向分档徽标 —— 前台统一叫「本次倾向」，不再突出 A/B/C/D 字母等级（§7.3）。
 *
 * 视觉：接近均衡（D）与轻微（C）用浅杏底（普通提示，不是红色警告，§4.2）；
 * 较明显与中等用浅蓝底。徽标本身**不承载"稳定性/可信度"含义**。
 */
const props = withDefaults(
  defineProps<{
    clarity: Clarity
    /** 紧凑模式用于倾向条标题行 */
    compact?: boolean
  }>(),
  { compact: false },
)

const STYLES: Record<Clarity, string> = {
  A: 'border-primary-200 bg-primary-50 text-primary-700',
  B: 'border-primary-200 bg-primary-50 text-primary-700',
  C: 'border-accent-200 bg-accent-100 text-accent-700',
  D: 'border-accent-200 bg-accent-100 text-accent-700',
}

const styleClass = computed(() => STYLES[props.clarity])
const label = computed(() => CLARITY_LABEL[props.clarity])
/** 无障碍名称里保留等级字母（开发/读屏可辨），正文里不出现 */
const accessibleName = computed(() => `本次倾向：${CLARITY_CODE_NAME[props.clarity]}`)
</script>

<template>
  <span
    class="inline-flex items-center rounded-full border font-medium"
    :class="[styleClass, compact ? 'px-2 py-[3px] text-[12px]' : 'px-3 py-1 text-[13px]']"
    :aria-label="accessibleName"
  >
    {{ label }}
  </span>
</template>
