<script setup lang="ts">
/**
 * 页面容器 —— `docs/2026-09-15/...重构开发文档.md` §4.3。
 *
 * 关键点：**不把 `App.vue` 一个 max-width 套给全部页面**。首页、答题页、结果页
 * 各有自己的最大宽度；关于页是阅读型文章，窄一些更好读。
 *
 * 断点规则（文档表格）：
 *   320–767px  单列，左右 16px（320px 时 12px）
 *   768–1023px 约 720px
 *   1024–1439px 1120px
 *   ≥1440px    1200px（结果页正文 760 + 目录 240）
 */
const WIDTHS = {
  home: 'max-w-shell-wide',
  quiz: 'max-w-shell-quiz',
  result: 'max-w-shell-result',
  article: 'max-w-shell-article',
} as const

withDefaults(
  defineProps<{
    /** 页面类型决定最大宽度，而不是让每个页面自己写魔法数字 */
    page?: keyof typeof WIDTHS
    /** 去掉水平内边距（给贴边的封面/色块用） */
    flush?: boolean
    /** 不加顶部留白（答题页自己控制） */
    tight?: boolean
  }>(),
  { page: 'home', flush: false, tight: false },
)
</script>

<template>
  <div
    class="page-container mx-auto w-full px-4 tablet:px-6 laptop:px-8"
    :data-page="page"
    :class="[WIDTHS[page], tight ? '' : 'py-6 tablet:py-8 laptop:py-10']"
  >
    <slot />
  </div>
</template>
