<script setup lang="ts">
import { computed } from 'vue'
import type { Attribution } from '@/domain/contentTypes'

/**
 * OEJTS 署名块 —— CC BY-NC-SA 4.0 的 **BY 义务**（需求文档 §8.1）。
 *
 * 刻意做成组件而不是复制两段文字：落地页与关于页共用一份，
 * 而且归属信息优先来自接口（`GET /meta` 的 attribution），
 * 这样"署名"这件事由内容层驱动，不会因为改页面而丢。
 */
// props 在模板里直接用（`attribution` / `compact`），无需赋值给局部变量
withDefaults(
  defineProps<{
    attribution: Attribution
    /** 紧凑版用于落地页底部 */
    compact?: boolean
  }>(),
  { compact: false },
)

const year = computed(() => new Date().getFullYear())
</script>

<template>
  <section
    class="rounded-2xl border border-ink-faint/20 bg-white/60"
    :class="compact ? 'px-4 py-4' : 'px-5 py-5'"
    aria-label="题目来源与许可"
  >
    <h2 class="text-[13px] font-semibold tracking-wide text-ink">题目来源与许可</h2>
    <p class="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
      本测评的题目取自
      <strong class="font-semibold">{{ attribution.source }}</strong
      >，作者
      <strong class="font-semibold">{{ attribution.author }}</strong
      >，来自
      <a
        :href="attribution.url"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="text-accent-600 underline decoration-accent-300 underline-offset-2"
        >Open-Source Psychometrics Project</a
      >，依据
      <a
        :href="attribution.licenseUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
        class="text-accent-600 underline decoration-accent-300 underline-offset-2"
        >{{ attribution.license }}</a
      >
      许可使用。本项目对其进行了中文本地化改写，改写后的中文题目同样以
      <strong class="font-semibold">{{ attribution.license }}</strong> 发布。
    </p>

    <ul class="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-ink-soft">
      <li>· 本项目<strong class="font-semibold">非商业用途</strong>，不含任何广告、付费或赞助。</li>
      <li>
        · 本项目<strong class="font-semibold">未获得</strong> Myers &amp; Briggs Foundation、The Myers-Briggs
        Company 或 CPP, Inc. 的任何授权或背书。
      </li>
      <li>
        · OEJTS 官方声明：<em class="not-italic text-ink-faint"
          >“The OEJTS come with no guarantees of reliability or accuracy of any kind.”</em
        >
      </li>
    </ul>

    <p v-if="!compact" class="mt-3 text-[11.5px] leading-relaxed text-ink-faint">
      中文题目与本站文案以同样的 {{ attribution.license }} 发布，可自由复制与再改编（需署名、非商业、相同方式共享）。
      本站 © {{ year }}，不含任何追踪脚本。
    </p>
  </section>
</template>
