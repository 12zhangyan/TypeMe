<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { fetchInstrumentDetail, type InstrumentDetail } from '@/api/platformV3'
import { useAuthStore } from '@/stores/auth'

/**
 * 一项测评的方法说明（`/instruments/:slug/method`）。
 *
 * ## 为什么这一页必须存在，而且要独立于"开始测评"
 *
 * 用户在被要求作答之前，有权知道：题从哪来、分数怎么算、什么情况不给结论、
 * 这份包现在是什么审校状态。把这些塞进答题页会打断作答；只写在关于页又找不到
 * —— 因为不同测评的口径不同（十六型有类型码与补充题，大五没有）。
 *
 * ## 不隐藏"还没定稿"这件事
 *
 * `contentStatus` 直接显示成人话。把"题面仍在审校"藏起来会让用户以为自己做的
 * 是一份经过验证的量表；说清楚反而不会削弱结果的价值 —— 结果本来就只是这次的参考。
 */

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const loading = ref(true)
const error = ref<ErrorDisplay | null>(null)
const detail = ref<InstrumentDetail | null>(null)

const slug = computed(() => {
  const value = route.params.slug
  return typeof value === 'string' ? value : ''
})

const STATUS_TEXT: Record<string, string> = {
  draft_review_pending: '题面与解释仍在审校中，结果只作参考',
  field_checked: '题面已做过逐题核查',
  published: '已定稿',
}

function statusText(status: string): string {
  return STATUS_TEXT[status] ?? `内容状态：${status}`
}

/**
 * 载入当前 slug 的方法说明。
 *
 * <p>带一个**请求令牌**：`/instruments/a/method` → `/instruments/b/method` 是同一个组件实例，
 * 两次请求会并发。没有令牌时，先发的那次如果后回来，就会把 B 的页面写成 A 的维度与版本
 * —— 而这两项测评的维度数量不同（4 vs 5），页面看起来"有内容"，只是内容是别人的。
 */
async function load(): Promise<void> {
  const token = ++loadToken
  const requested = slug.value
  loading.value = true
  error.value = null
  try {
    const result = await fetchInstrumentDetail(requested)
    if (token !== loadToken) return
    detail.value = result
  } catch (loadError) {
    if (token !== loadToken) return
    error.value = describeError(loadError)
  } finally {
    if (token === loadToken) loading.value = false
  }
}

let loadToken = 0

onMounted(load)

// slug 变了要重新载入。**不能只靠 `onMounted`**：同为一个组件的两次导航不会重新挂载，
// 于是从十六型的方法页切到大五的方法页会继续显示十六型的四个维度。
watch(slug, () => {
  detail.value = null
  void load()
})

function goStart(): void {
  void router.push({ name: 'instruments' })
}

/** 这一项有没有类型码：决定"结论长什么样"那段话说哪一种。 */
const hasTypeCode = computed(() => detail.value?.instrument.hasTypeCode === true)

/** 未登录时先登录：回跳参数带上本页，登录完回到这里。 */
const loginTo = computed(() => ({ name: 'login', query: { redirect: route.fullPath } }))
</script>

<template>
  <PageContainer page="article">
    <p v-if="loading" class="text-[15px] text-ink-soft" data-method-loading>正在载入…</p>

    <div v-else-if="error" class="notice-error max-w-prose" role="alert" data-method-error>
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>{{ error.message }}</span>
      </p>
      <p v-if="error.requestId" class="mt-2 break-all text-[12.5px]">
        报障编号：<code class="font-mono">{{ error.requestId }}</code>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn-secondary btn-sm" @click="load">重试</button>
        <RouterLink to="/instruments" class="btn-ghost btn-sm">回到测评列表</RouterLink>
      </div>
    </div>

    <template v-else-if="detail">
      <header class="max-w-prose">
        <p class="caption">方法说明</p>
        <h1 class="mt-2 text-[24px] font-semibold leading-snug text-ink tablet:text-[28px]">
          {{ detail.instrument.title }}
        </h1>
        <p class="mt-3 text-[15.5px] leading-relaxed text-ink">{{ detail.instrument.summary }}</p>
        <p class="caption mt-2">{{ statusText(detail.instrument.contentStatus) }}</p>

        <!--
          结果长什么样必须在这一页说清：大五是五个方面各自独立、**没有类型码**；
          十六型是四个维度的组合，可能给出四个字母、也可能因为平分而不给。
          只写"看哪几个方面"会让用户以为两项测评的结论是同一种东西。
        -->
        <div
          v-if="hasTypeCode"
          class="notice-info mt-4 max-w-prose text-[14px] leading-relaxed"
          data-method-result-shape
        >
          这一项的结论是<strong>四个维度的组合</strong>：四个方向都明确时给出四个字母；某一维只是略偏会说成
          「更接近」；两边证据完全对等时<strong>不给字母</strong>，并列展示几个可能。
        </div>
        <div
          v-else
          class="notice-info mt-4 max-w-prose text-[14px] leading-relaxed"
          data-method-result-shape
        >
          这一项<strong>没有类型码、也没有总分</strong>：{{ detail.dimensions.length }}
          个方面各自独立给一个位置；某个方面作答不够时只有那一个方面不给方向，其余照常。
          分数说的是「离中间值有多远」，不与任何外部群体比较。
        </div>
      </header>

      <section class="mt-8 max-w-prose" aria-labelledby="method-learn">
        <h2 id="method-learn" class="section-title">它能让你看到什么，不能让你看到什么</h2>
        <div class="card mt-3 grid gap-3">
          <div>
            <p class="text-[13.5px] font-medium text-ink">你会得到</p>
            <ul class="mt-1 grid gap-1 text-[14.5px] leading-relaxed text-ink-soft">
              <li v-for="(item, index) in detail.instrument.whatYouLearn" :key="index" class="flex gap-2">
                <span aria-hidden="true">·</span><span>{{ item }}</span>
              </li>
            </ul>
          </div>
          <div>
            <p class="text-[13.5px] font-medium text-ink">它不适合</p>
            <ul class="mt-1 grid gap-1 text-[14.5px] leading-relaxed text-ink-soft">
              <li v-for="(item, index) in detail.instrument.notFor" :key="index" class="flex gap-2">
                <span aria-hidden="true">·</span><span>{{ item }}</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section class="mt-8" aria-labelledby="method-dimensions">
        <h2 id="method-dimensions" class="section-title">它看哪几个方面</h2>
        <p class="caption mt-1 max-w-prose">
          每一项都写成"两端各长什么样"，是为了让你判断自己更靠哪边，
          而不是先给你一个结论让你去对号入座。
        </p>
        <ol class="mt-3 grid gap-4" data-method-dimensions>
          <li
            v-for="copy in detail.dimensions"
            :key="copy.dimension"
            class="card"
            :data-dimension="copy.dimension"
          >
            <h3 class="text-[16.5px] font-semibold leading-snug text-ink">{{ copy.name }}</h3>
            <p class="mt-1 text-[14.5px] leading-relaxed text-ink">{{ copy.question }}</p>
            <dl class="mt-3 grid gap-2 tablet:grid-cols-2">
              <div>
                <dt class="text-[13.5px] font-medium text-ink">{{ copy.lowLabel }}</dt>
                <dd class="text-[14px] leading-relaxed text-ink-soft">{{ copy.lowDescription }}</dd>
                <dd v-if="copy.lowSigns.length" class="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
                  {{ copy.lowSigns.join('；') }}
                </dd>
              </div>
              <div>
                <dt class="text-[13.5px] font-medium text-ink">{{ copy.highLabel }}</dt>
                <dd class="text-[14px] leading-relaxed text-ink-soft">{{ copy.highDescription }}</dd>
                <dd v-if="copy.highSigns.length" class="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
                  {{ copy.highSigns.join('；') }}
                </dd>
              </div>
            </dl>
            <p v-if="copy.balancedSummary" class="caption mt-3">
              <span class="font-medium text-ink">两边差不多时：</span>{{ copy.balancedSummary }}
            </p>
            <p class="notice-info mt-3 text-[13.5px] leading-relaxed">{{ copy.caution }}</p>
          </li>
        </ol>
      </section>

      <section class="mt-8 max-w-prose" aria-labelledby="method-versions">
        <h2 id="method-versions" class="section-title">题目与计分规则版本</h2>
        <p class="caption mt-1">
          每份报告都绑定生成时的那一版题目与计分规则，历史报告不会用新版本重算。
        </p>
        <div class="card mt-3 overflow-x-auto">
          <table class="w-full min-w-[30rem] border-collapse text-left text-[13.5px]">
            <caption class="sr-only">这项测评的内容版本</caption>
            <thead>
              <tr class="border-b border-line-strong text-[13px] text-ink-soft">
                <th scope="col" class="py-2 pr-3 font-medium">内容版本</th>
                <th scope="col" class="py-2 pr-3 font-medium">题数</th>
                <th scope="col" class="py-2 pr-3 font-medium">计分规则</th>
                <th scope="col" class="py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="version in detail.versions"
                :key="version.packageId"
                class="border-b border-line last:border-b-0"
              >
                <td class="py-2 pr-3">
                  <span class="font-mono text-[12.5px]">{{ version.packageId }}</span>
                  <span v-if="version.isDefault" class="chip chip-primary ml-2">当前默认</span>
                </td>
                <td class="py-2 pr-3">
                  {{ version.baseItemCount }}
                  <template v-if="version.clarificationItemCount > 0">
                    + 最多 {{ version.clarificationItemCount }}
                  </template>
                </td>
                <td class="py-2 pr-3 font-mono text-[12px]">{{ version.scoringVersion }}</td>
                <td class="py-2">{{ statusText(version.contentStatus) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="mt-9 flex flex-wrap items-center gap-2">
        <RouterLink
          v-if="auth.isAuthenticated"
          :to="{ name: 'assess', query: { instrument: slug } }"
          class="btn-primary btn-sm"
        >
          开始这项测评
          <AppIcon name="arrow-right" :size="16" />
        </RouterLink>
        <RouterLink v-else :to="loginTo" class="btn-primary btn-sm">登录后开始</RouterLink>
        <button type="button" class="btn-ghost btn-sm" @click="goStart">看其他测评</button>
        <RouterLink to="/about" class="btn-ghost btn-sm">本站整体说明</RouterLink>
      </div>
    </template>
  </PageContainer>
</template>
