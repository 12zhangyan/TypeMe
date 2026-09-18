<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

/**
 * 确认弹窗 —— `docs/2026-09-15/...重构开发文档.md` §4.4 / §5.2。
 *
 * 无障碍要求（逐条落实，不是"看起来像弹窗"）：
 *   - `role="dialog"` + `aria-modal` + `aria-labelledby`；
 *   - **Esc 关闭**；
 *   - **焦点进入弹窗**并**留在弹窗内**（Tab 循环）；
 *   - 关闭后焦点回到**触发它的按钮**；
 *   - 底层不可误操作（遮罩 + 焦点陷阱）；
 *   - 危险动作用 `danger` 变体，但正常页面上不抢主操作。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    description?: string
    confirmLabel: string
    cancelLabel?: string
    /** 危险操作（覆盖本地记录）：确认键用杏橙深色 */
    danger?: boolean
    /** 默认焦点落在哪个按钮：保留 / 取消是更安全的默认（§5.2） */
    initialFocus?: 'cancel' | 'confirm'
    /**
     * 确认之后请求还在路上（2026-09-18 第 17 轮）。
     *
     * <p>为什么弹窗要管这件事：删除这类操作"确认"只是一次网络请求的开始，
     * 而请求期间弹窗曾经**立刻关掉**，于是用户看不到任何"正在处理"，
     * 很自然再点一次 → 第二个 DELETE 并发发出 → 第二个 404，
     * 在数据**已经删掉**之后把结果翻成"删除没能完成"。
     * busy 时两个键都禁用、Esc 与点遮罩也不关闭：在途请求必须要有确定的归宿。
     */
    busy?: boolean
    /** busy 时确认键上的文案（如实说明正在做什么）。 */
    busyLabel?: string
  }>(),
  { cancelLabel: '取消', danger: false, initialFocus: 'cancel', busy: false, busyLabel: '正在处理…' },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const panel = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
/** 唯一标题 id（避免两处弹窗用标题长度拼 id 撞车） */
const titleId = `confirm-title-${useId()}`
/** 关闭后要把焦点还给它 */
let previouslyFocused: HTMLElement | null = null

function focusables(): HTMLElement[] {
  if (!panel.value) return []
  return Array.from(
    panel.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null || element === document.activeElement)
}

function close(confirm: boolean) {
  // 在途时不允许关闭：否则"请求还在跑"这件事就没有任何界面在承载。
  if (props.busy) return
  if (confirm) emit('confirm')
  else emit('cancel')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    // busy 时吞掉 Esc 但不关闭，避免"按了没反应还以为是卡住"。
    close(false)
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && (active === first || !panel.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown, true)
      await nextTick()
      const target = props.initialFocus === 'confirm' ? confirmButton.value : cancelButton.value
      target?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      previouslyFocused?.focus?.()
      previouslyFocused = null
    }
  },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[60] flex items-end justify-center bg-ink/55 p-0 tablet:items-center tablet:p-6"
    @click.self="close(false)"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      class="animate-sheet-up w-full max-w-[30rem] rounded-t-cover border border-line bg-surface px-5 pb-5 pt-6 tablet:animate-fade-in tablet:rounded-cover tablet:px-6 tablet:pb-6 safe-bottom"
    >
      <h2 :id="titleId" class="text-[17px] font-semibold text-ink">
        {{ title }}
      </h2>
      <p v-if="description" class="mt-2 prose-sm">{{ description }}</p>

      <div class="mt-5 flex flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
        <button ref="cancelButton" type="button" class="btn-secondary" :disabled="busy" @click="close(false)">
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          :class="danger ? 'btn-danger' : 'btn-primary'"
          :disabled="busy"
          :aria-busy="busy ? 'true' : 'false'"
          data-confirm-dialog-confirm
          @click="close(true)"
        >
          {{ busy ? busyLabel : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
