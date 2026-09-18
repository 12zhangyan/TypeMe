<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import AssessView from '@/views/AssessView.vue'
import BigFiveAssessView from '@/views/BigFiveAssessView.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { fetchPlatformAttempt, type InstrumentKind } from '@/api/platformV3'

/**
 * `/assess/:attemptId` 的分流页。
 *
 * ## 为什么要先分一次流，而不是让答题页自己判断
 *
 * 两份答题页的**完成规则不同**（十六型有按维度触发的补充题与覆盖检查，大五一次答完），
 * 所以它们不是同一个组件的两种皮肤。如果让 `AssessView` 去读一份大五草稿，
 * 它会在"补充题维度"这些字段上得到空值，然后渲染出一个**看起来正常但题目空白**的页面 ——
 * 比直接说"这份草稿该去另一个页面"糟糕得多。
 *
 * ## 为什么不能用路由参数判断
 *
 * 用户可能直接粘一个 `/assess/<id>` 链接，也可能从"我的测评"点进来，
 * 那条路径上没有 `?kind=`。所以**归属必须由服务端说了算**：先读一次 attempt，
 * 按服务端返回的 `instrumentKind` 决定渲染哪一页。代价是多一次请求，
 * 换来的是"任何入口进来都不会渲染错页面"。
 */

const route = useRoute()

const kind = ref<InstrumentKind | null>(null)
const loading = ref(true)
const error = ref<ErrorDisplay | null>(null)

const attemptId = (() => {
  const value = route.params.attemptId
  return typeof value === 'string' ? value : ''
})()

onMounted(async () => {
  if (!attemptId) {
    loading.value = false
    return
  }
  try {
    // 这一页只用它来判断归属；真正的草稿状态由被渲染的答题页自己再读一次
    // （重复读一次换来的是"两个 store 各自持有完整状态"，而不是互相污染）。
    const attempt = await fetchPlatformAttempt(attemptId)
    kind.value = attempt.instrumentKind
  } catch (loadError) {
    const display = describeError(loadError)
    // 大五接口对十六型草稿会返回 404 —— 那不是错误，是"该走另一条路"。
    // 判据用「这个 attempt 不是大五」而不是「有没有报错」，避免把网络错误
    // 也当成"这是十六型的草稿"。
    if (display.code === 'NOT_FOUND' || display.code === 'FORBIDDEN') {
      kind.value = 'jung'
    } else {
      error.value = display
    }
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <BigFiveAssessView v-if="kind === 'big_five'" />
  <AssessView v-else-if="kind === 'jung'" />

  <PageContainer v-else-if="loading" page="quiz">
    <p class="text-[15px] text-ink-soft">正在确认这份测评…</p>
  </PageContainer>

  <PageContainer v-else page="quiz">
    <div v-if="error" class="notice-error max-w-prose" role="alert" data-attempt-route-error>
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>{{ error.message }}</span>
      </p>
      <p v-if="error.requestId" class="mt-2 break-all text-[12.5px]">
        报障编号：<code class="font-mono">{{ error.requestId }}</code>
      </p>
      <RouterLink to="/instruments" class="btn-secondary btn-sm mt-3">回到测评列表</RouterLink>
    </div>
    <div v-else class="notice-neutral max-w-prose text-[14.5px] leading-relaxed">
      没有找到这份测评。
      <RouterLink to="/instruments" class="link">回到测评列表</RouterLink>重新开始。
    </div>
  </PageContainer>
</template>
