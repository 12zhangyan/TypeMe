<script setup lang="ts">
import type { InstrumentCard } from '@/api/platformV3'
import EditorialScene from './EditorialScene.vue'
import IllustrationFrame from './IllustrationFrame.vue'

defineProps<{ instrument: InstrumentCard; index?: number }>()
</script>

<template>
  <article class="assessment-card" :class="{ 'assessment-card-five': !instrument.hasTypeCode }">
    <div class="assessment-card-art">
      <span class="assessment-card-category">{{ instrument.hasTypeCode ? '认识你的偏好' : '发现你的不同侧面' }}</span>
      <IllustrationFrame :name="instrument.hasTypeCode ? 'assessment-jung' : 'assessment-bigfive'" class="assessment-cover-art"><EditorialScene :scene="instrument.hasTypeCode ? 'jung' : 'bigfive'" /></IllustrationFrame>
      <span class="assessment-card-number">{{ String((index ?? 0) + 1).padStart(2, '0') }}</span>
    </div>
    <div class="assessment-card-content">
      <div class="flex flex-wrap items-center gap-2">
        <span class="chip chip-neutral">{{ instrument.hasTypeCode ? '四维偏好' : '五维倾向' }}</span>
        <span class="caption">约 {{ instrument.estimatedMinutes }} 分钟</span>
      </div>
      <h2>{{ instrument.title }}</h2>
      <p class="assessment-card-summary">{{ instrument.summary }}</p>
      <p class="assessment-card-facts">
        {{ instrument.baseItemCount }} 题<template v-if="instrument.supportsClarification">，最多 {{ instrument.maxClarificationItems }} 道补充题</template>
        <span> {{ instrument.hasTypeCode ? '获得参考类型，保留不确定性' : '五个方面分别解读，没有类型和总分' }}</span>
      </p>
      <p v-if="instrument.contentStatus !== 'field_checked'" class="caption">中文题面仍在审校，结果供参考。</p>
      <div class="assessment-card-actions"><slot /></div>
    </div>
  </article>
</template>
