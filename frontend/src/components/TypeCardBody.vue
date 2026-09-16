<script setup lang="ts">
import type { TypeProfile } from '@/domain/contentTypes'

/**
 * 类型文案正文（优势 / 提醒）—— 首页"结果示例"与结果页共用一份，避免两处各写一遍。
 *
 * 文档 §8.1 要求「优势与提醒」各 3 条，且**提醒不是缺陷判决**：
 * 标题刻意用「容易被忽略的地方」而不是"短板""缺点"。
 */
defineProps<{ profile: TypeProfile }>()
</script>

<template>
  <div>
    <h3 class="text-[14px] font-semibold text-ink">你可能比较擅长的地方</h3>
    <ul class="mt-2.5 space-y-2 text-[14px] leading-relaxed text-ink-soft">
      <li v-for="(line, index) in profile.strengths" :key="index" class="list-line">{{ line }}</li>
    </ul>
  </div>
  <div>
    <h3 class="text-[14px] font-semibold text-ink">容易被忽略的地方</h3>
    <ul class="mt-2.5 space-y-2 text-[14px] leading-relaxed text-ink-soft">
      <li v-for="(line, index) in profile.blindSpots" :key="index" class="list-dot">{{ line }}</li>
    </ul>
  </div>
</template>
