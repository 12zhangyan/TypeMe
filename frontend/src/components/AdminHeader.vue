<script setup lang="ts">
import { RouterLink } from 'vue-router'

/**
 * 管理后台两页共用的页头：面包屑 + 标题 + 一句话说明 + 两个页签。
 *
 * 为什么抽出来：成员页和 AI 设置页原来是两套完全不同的页头（一页是大号衬线营销句，
 * 另一页是深色面板），页签也只有单向链接 —— 管理员在两页之间切换时像是进了两个站点，
 * 而且成员页的大标题把真正要用的内容推到了手机首屏之下。
 * 这里两页用同一个结构，页签双向可达，当前页用 `aria-current` 标出（读屏也能知道在哪一页）。
 */
defineProps<{
  active: 'members' | 'ai'
  title: string
  lead?: string
}>()

const TABS = [
  { key: 'members', label: '成员', to: '/admin/members' },
  { key: 'ai', label: 'AI 服务设置', to: '/admin' },
] as const
</script>

<template>
  <header class="admin-header" data-admin-header>
    <p class="section-kicker">管理后台</p>
    <h1 class="mt-1 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]">{{ title }}</h1>
    <p class="mt-2 max-w-prose text-[15px] leading-[1.7] text-ink-soft">
      <slot name="lead">{{ lead }}</slot>
    </p>
    <nav class="mt-4 flex flex-wrap gap-2" aria-label="管理后台页签">
      <RouterLink
        v-for="tab in TABS"
        :key="tab.key"
        :to="tab.to"
        class="btn-sm inline-flex items-center rounded-full border px-4 font-semibold"
        :class="
          tab.key === active
            ? 'border-primary-200 bg-primary-50 text-primary-700'
            : 'border-line bg-surface text-ink-soft hover:text-ink'
        "
        :aria-current="tab.key === active ? 'page' : undefined"
        :data-admin-tab="tab.key"
      >
        {{ tab.label }}
      </RouterLink>
    </nav>
  </header>
</template>
