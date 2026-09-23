<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import AssessView from '@/views/AssessView.vue'
import BigFiveAssessView from '@/views/BigFiveAssessView.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { fetchAttemptMetadata, type InstrumentKind } from '@/api/platformV3'

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
 * ## 判据为什么是归属校验后的元信息，而不是"请求失败"
 *
 * 中性元信息接口先按 `(id, user_id)` 读草稿，再按锁定的内容包判断量表。
 * 读不到就是 `404`；正常分流不需要制造一次 409 错误。于是：
 *
 * - 别人的草稿与不存在的 id 都是 `404` —— 二者同形，既不泄露存在性，
 *   也不会被这里误判成"这是十六型草稿"（那会把"没有这份测评"渲染成一份空白答题页）；
 * - `401`／`403`／网络错误／`PACKAGE_UNAVAILABLE` 同理，都是**不能继续**，不是"换个页面"；
 * - 分流只决定**渲染哪一页**：真正渲染时，各答题页还会用自己的接口读取完整状态。
 *   前端不读任何 `kind` 参数，也不缓存上一次的分流结果。
 *
 * ## 换 id 与竞态
 *
 * 同一个路由换 `attemptId`（点列表里另一份草稿）时组件实例会被复用，
 * 所以必须 `watch` 参数重新分流，并且**只让最后一次请求的响应生效** ——
 * 否则慢的旧请求晚到，会把页面顶回上一份草稿的答题页。
 */

const route = useRoute()

const kind = ref<InstrumentKind | null>(null)
const loading = ref(true)
const error = ref<ErrorDisplay | null>(null)
const notFound = ref(false)

/** 每次分流自增；只有"最新一次"的响应允许改状态。 */
let requestSeq = 0

const attemptId = computed(() => {
  const value = route.params.attemptId
  return typeof value === 'string' ? value : ''
})

async function loadAttempt(id: string): Promise<void> {
  const seq = ++requestSeq
  loading.value = true
  error.value = null
  notFound.value = false
  kind.value = null

  if (!id) {
    loading.value = false
    notFound.value = true
    return
  }

  try {
    // 元信息不返回题目/答案；详情只由实际答题页读取一次。
    const attempt = await fetchAttemptMetadata(id)
    if (seq !== requestSeq) return
    kind.value = attempt.instrumentKind
  } catch (loadError) {
    if (seq !== requestSeq) return
    const display = describeError(loadError)
    if (display.code === 'NOT_FOUND') {
      // 不存在，或不是本人的草稿（同形）。绝不能当成"这是十六型草稿"。
      notFound.value = true
    } else {
      error.value = display
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(attemptId, (id) => void loadAttempt(id), { immediate: true })

// 离开这一页之后，还在路上的响应不该再改任何状态。
onBeforeUnmount(() => {
  requestSeq += 1
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
    <div v-else class="notice-neutral max-w-prose text-[14.5px] leading-relaxed" data-attempt-route-not-found>
      没有找到这份测评。
      <RouterLink to="/instruments" class="link">回到测评列表</RouterLink>重新开始。
    </div>
  </PageContainer>
</template>
