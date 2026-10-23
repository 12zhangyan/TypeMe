<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

/**
 * 报告页（手机宽度）的悬浮「目录」按钮。
 *
 * 为什么存在：手机上报告 6000+ 像素，目录只在最上面，读到后面想回看「四个维度」
 * 只能手动滚回顶部。这里在滚过目录之后给一个固定的入口，点开是同一份目录
 * （由父级传入，所以仍然只列「这份报告实际渲染出来的区块」，没有死链）。
 *
 * 笔记本起目录本来就粘在右侧，这个控件整个不显示（`laptop:hidden`）。
 */
defineProps<{ items: { id: string; label: string }[] }>()
const emit = defineEmits<{ (e: 'jump', id: string): void }>()

/** 滚过这么多像素后才出现：目录本身还在视野里时没必要再给一个入口。 */
const SHOW_AFTER_PX = 520

const visible = ref(false)
const open = ref(false)
const panelId = `report-float-toc-${useId()}`
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
let frame = 0

function measure() {
  frame = 0
  visible.value = window.scrollY > SHOW_AFTER_PX
  if (!visible.value) open.value = false
}

function onScroll() {
  if (frame) return
  frame = window.requestAnimationFrame(measure)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    open.value = false
    void nextTick(() => trigger.value?.focus())
  }
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return
  const target = event.target as Node | null
  if (target && (panel.value?.contains(target) || trigger.value?.contains(target))) return
  open.value = false
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    panel.value?.querySelector<HTMLButtonElement>('button')?.focus()
  }
}

function choose(id: string) {
  open.value = false
  emit('jump', id)
}

onMounted(() => {
  measure()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerDown)
  if (frame) window.cancelAnimationFrame(frame)
})

</script>

<template>
  <div
    v-if="visible && items.length > 0"
    class="report-float-toc fixed right-4 z-40 laptop:hidden"
    style="bottom: max(1rem, env(safe-area-inset-bottom))"
    data-report-float-toc
  >
    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      class="mb-2 max-h-[60vh] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-card border border-line bg-surface p-2 shadow-card"
      role="group"
      aria-label="跳到报告的某一节"
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="flex min-h-[44px] w-full items-center rounded-control px-3 text-left text-[14px] text-ink hover:bg-primary-50"
        :data-float-toc="item.id"
        @click="choose(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="flex justify-end">
      <button
        ref="trigger"
        type="button"
        class="btn-primary btn-sm shadow-card"
        :aria-expanded="open"
        :aria-controls="open ? panelId : undefined"
        @click="toggle"
      >
        {{ open ? '收起目录' : '目录' }}
      </button>
    </div>
  </div>
</template>
