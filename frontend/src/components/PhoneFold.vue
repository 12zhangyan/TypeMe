<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 手机上默认收起、平板及以上始终展开的一段内容。
 *
 * 为什么存在：首页对「有未完成草稿」的用户整段展开，390 宽下长到一万多像素，
 * 其中「你会得到什么 / 维度 / AI / 结果示例」是想了解时才读的参考内容。
 * 手机上收进一行可点的摘要，内容仍在 DOM 里（读屏、搜索、测试都能读到），只是不占首屏之后的滚动。
 *
 * 行为约定：
 *   - 平板及以上：始终展开，摘要行不显示（桌面没有"收起"的需要）；
 *   - 手机：初始收起，用户展开后跨过断点前不替他合上；
 *   - 没有 `matchMedia`（jsdom / 老环境）：按展开处理，内容不会因此读不到。
 */
defineProps<{ summary: string; hint?: string }>()

const open = ref(true)
let query: MediaQueryList | null = null

function syncWithViewport() {
  open.value = query ? query.matches : true
}

function onToggle(event: Event) {
  open.value = (event.target as HTMLDetailsElement).open
}

onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  query = window.matchMedia('(min-width: 768px)')
  syncWithViewport()
  query.addEventListener?.('change', syncWithViewport)
})

onBeforeUnmount(() => {
  query?.removeEventListener?.('change', syncWithViewport)
  query = null
})
</script>

<template>
  <details class="phone-fold mt-12 laptop:mt-16" :open="open" @toggle="onToggle">
    <summary
      class="phone-fold-summary flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[15px] font-semibold text-ink tablet:hidden"
    >
      <span>
        {{ summary }}
        <span v-if="hint" class="mt-0.5 block text-[12.5px] font-normal text-ink-soft">{{ hint }}</span>
      </span>
      <span class="phone-fold-chevron shrink-0 text-ink-soft" aria-hidden="true">{{ open ? '收起' : '展开' }}</span>
    </summary>
    <div class="phone-fold-body">
      <slot />
    </div>
  </details>
</template>
