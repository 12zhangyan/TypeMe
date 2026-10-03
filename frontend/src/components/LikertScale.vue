<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { AnswerFormat } from '@/domain/types'
import { ANSWER_CAPTIONS, ANSWER_VALUES, isValidAnswerValue } from '@/domain/answers'

/**
 * 五点作答控件 —— 支持两种作答格式（`docs/2026-09-15/...重构开发文档.md` §6.1 / §6.4）：
 *
 *   - `bipolar`（OEJTS）：一对相反描述 + 五档位置，左边对应 1、右边对应 5；
 *   - `agreement`（IPIP）：一句自我描述 + 五档贴切度，1 = 非常不贴切、5 = 非常贴切。
 *
 * 两种格式共用同一套交互与无障碍约定，差别只在两端的呈现与档位文案：
 *   - 五档**等宽一行**（390px 下仍是一行，每格有效点击区 ≥44px；320px 也不隐藏中间档）；
 *   - 选中态包含**边框 + 填充 + 勾选**三重标识，不只靠颜色；
 *   - 选项点击**只更新答案**：不触发任何自动跳题；
 *   - 键盘（radio group pattern）：roving tabindex、方向键在组内移动并选中且**不冒泡**给切题快捷键、
 *     Space / Enter 作用于当前聚焦项。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number | null
    /** 作答格式；缺省为 OEJTS 的双极选择 */
    format?: AnswerFormat
    textLeft?: string
    textRight?: string
    /** `agreement` 格式的陈述句 */
    statement?: string
    /** 五档文案（长度 5，`agreement` 必填，`bipolar` 缺省用 OEJTS 文案） */
    anchors?: string[] | null
    disabled?: boolean
  }>(),
  { format: 'bipolar', anchors: null, disabled: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  /** 无障碍公告：让"用键盘选完了"这件事被读屏软件说出来（而非静默）。 */
  announce: [message: string]
}>()

const isAgreement = computed(() => props.format === 'agreement')

/** 档位短文案：内容包给了 anchors 就用它，否则用 OEJTS 的五档说明。 */
function captionOf(value: number): string {
  const anchors = props.anchors
  if (isAgreement.value && Array.isArray(anchors) && anchors.length === 5) {
    return anchors[value - 1] ?? ANSWER_CAPTIONS[value]
  }
  return ANSWER_CAPTIONS[value]
}

const options = ANSWER_VALUES.map((value) => ({ value, caption: ANSWER_CAPTIONS[value] }))

const buttonRefs = ref<Array<HTMLButtonElement | null>>([])

function indexOfValue(value: number | null): number {
  if (!isValidAnswerValue(value)) return 0
  const index = options.findIndex((option) => option.value === value)
  return index >= 0 ? index : 0
}

/** roving tabindex 的落点：选中项；没有选中时是第一项。 */
const focusIndex = ref(indexOfValue(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    if (isValidAnswerValue(value)) focusIndex.value = indexOfValue(value)
  },
)

function tabIndexFor(index: number): number {
  return index === focusIndex.value ? 0 : -1
}

async function focusOption(index: number) {
  focusIndex.value = index
  await nextTick()
  buttonRefs.value[index]?.focus()
}

function select(value: number) {
  if (props.disabled) return
  emit('update:modelValue', value)
  emit('announce', `第 ${indexOfValue(value) + 1} 项，${captionOf(value)}`)
}

/** 供父组件在"数字键选择"后把焦点还给组内对应项。 */
async function focusSelected(): Promise<void> {
  await focusOption(indexOfValue(props.modelValue))
}

defineExpose({ focusSelected, focusIndex, captionOf })

function onGroupKeydown(event: KeyboardEvent) {
  if (props.disabled) return
  const current = indexOfValue(props.modelValue)
  const focused = buttonRefs.value.findIndex((element) => element === event.target)
  const active = focused >= 0 ? focused : current
  let next = active
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = Math.min(options.length - 1, active + 1)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = Math.max(0, active - 1)
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = options.length - 1
      break
    case ' ':
    case 'Spacebar':
    case 'Enter':
      event.preventDefault()
      event.stopPropagation()
      select(options[active].value)
      void focusOption(active)
      return
    default:
      return
  }
  // 方向键在本题内移动焦点（并选中），不冒泡给答题页的切题快捷键
  event.preventDefault()
  event.stopPropagation()
  void focusOption(next)
  select(options[next].value)
}

const groupLabel = computed(() =>
  isAgreement.value
    ? `对「${props.statement ?? ''}」这句描述的贴切程度，五档选择`
    : `从「${props.textLeft ?? ''}」到「${props.textRight ?? ''}」的五点选择`,
)

function optionLabel(value: number, index: number): string {
  const scale = isAgreement.value ? '（第 N 档，1 为最不贴切，5 为最贴切）' : '（第 N 档，1 为最靠左，5 为最靠右）'
  const selected = props.modelValue === value ? '，当前已选' : ''
  return `${captionOf(value)}${scale.replace('N', String(index + 1))}${selected}`
}
</script>

<template>
  <div class="w-full">
    <!-- agreement：一句自我描述（IPIP 大五的作答格式） -->
    <p
      v-if="isAgreement"
      class="border-t border-line-strong pt-3 text-[18px] font-medium leading-[1.55] text-ink tablet:text-[21px] laptop:text-[23px]"
    >
      <span class="mb-1 block text-[12px] font-normal tracking-wide text-ink-faint">
        这句描述对你有多贴切？
      </span>
      {{ statement }}
    </p>

    <!-- bipolar：两端陈述（细线分区的开放区域，不是两个卡片按钮） -->
    <div v-else class="grid grid-cols-2 gap-x-5 gap-y-0 tablet:gap-x-12">
      <p
        class="border-t border-line-strong pt-3 text-left text-[17px] font-medium leading-[1.5] text-ink tablet:text-[20px] laptop:text-[22px]"
      >
        <span class="mb-1 block text-[12px] font-normal tracking-wide text-ink-faint">
          左边这一侧
        </span>
        {{ textLeft }}
      </p>
      <p
        class="border-t border-line-strong pt-3 text-left text-[17px] font-medium leading-[1.5] text-ink tablet:text-[20px] laptop:text-[22px]"
      >
        <span class="mb-1 block text-[12px] font-normal tracking-wide text-ink-faint">
          右边这一侧
        </span>
        {{ textRight }}
      </p>
    </div>

    <slot name="reading-help" />

    <!-- 五档等宽一行；320px 也不隐藏中间选项 -->
    <div
      class="mt-5 grid grid-cols-5 gap-1.5 tablet:gap-3"
      role="radiogroup"
      :aria-label="groupLabel"
      @keydown="onGroupKeydown"
    >
      <button
        v-for="(option, index) in options"
        :key="option.value"
        :ref="(element) => (buttonRefs[index] = (element as unknown as HTMLButtonElement | null))"
        type="button"
        role="radio"
        :aria-checked="modelValue === option.value"
        :aria-label="optionLabel(option.value, index)"
        :tabindex="tabIndexFor(index)"
        :disabled="disabled"
        class="option-cell"
        @click="select(option.value)"
      >
        <svg
          v-if="modelValue === option.value"
          class="option-check"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <path
            d="M3 8.5l3.2 3L13 4.5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="option-index">{{ index + 1 }}</span>
        <span class="option-caption">{{ captionOf(option.value) }}</span>
      </button>
    </div>

    <!-- 统一的档位说明（五档大小一致，不暗示某个答案更理想） -->
    <p v-if="isAgreement" class="mt-2.5 text-[12.5px] leading-relaxed text-ink-faint">
      1 = 非常不贴切 · 3 = 谈不上贴切或不贴切（也算作答，不代表没想好）· 5 = 非常贴切
    </p>
    <p v-else class="mt-2.5 text-[12.5px] leading-relaxed text-ink-faint">
      1 = 明显偏左 · 3 = 两边相近（也算作答，不代表没想好）· 5 = 明显偏右
    </p>
  </div>
</template>
