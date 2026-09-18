<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import InstrumentCard from '@/components/InstrumentCard.vue'
import { useInstrumentsStore } from '@/stores/instrumentsV3'
import { useAuthStore } from '@/stores/auth'

/**
 * 测评列表（发现页）—— 站点上有哪几项测评，每项能看出什么。
 *
 * ## 这一页要解决的具体问题
 *
 * 改造前首页只有"开始测评"一个按钮，用户不知道点下去会遇到什么、测完会得到什么，
 * 也不知道站上其实不止一项测评。而"这个测评告诉我什么"正是选择测评时唯一重要的事，
 * 所以每张卡片第一行就是它 —— 不是量表名，不是题数。
 *
 * ## 只读目录，不在这里开始答题
 *
 * 卡片上的按钮进**详情页**，详情页才回答"多少题、要看什么、有什么限制"，
 * 并且是详情页负责创建 attempt。放在列表页直接建立 attempt 会带来两个后果：
 * 用户还没看清就被记下一份空草稿；以及一次误点之后就多了一份记录要清理。
 */

const instruments = useInstrumentsStore()
const auth = useAuthStore()
const router = useRouter()

const pendingSlug = ref<string | null>(null)

const cards = computed(() => instruments.items)
onMounted(() => {
  void instruments.load()
})

async function retry(): Promise<void> {
  await instruments.load(true)
}

/**
 * 「查看并开始」：跳到选择页并把这一项带过去（未登录先去登录，登录后回到选择页）。
 *
 * 这里**不能**先跳到 `/instruments/{slug}` —— 仓库里没有这个路由（只有
 * `/instruments` 列表和 `/instruments/{slug}/method` 方法页）。指向一个不存在的路径
 * 的表现是 SPA 回退成空白页，而"开始测评"是这一页最主要的动作，它必须一次点通。
 */
function start(slug: string): void {
  pendingSlug.value = slug
  if (!auth.isAuthenticated) {
    void router.push({ name: 'login', query: { redirect: `/assess?instrument=${slug}` } })
    return
  }
  void router.push({ name: 'assess', query: { instrument: slug } })
}

</script>

<template>
  <PageContainer page="home" class="atelier-catalog">
    <header class="atelier-catalog-heading">
      <p class="section-kicker">TYPEME / 探索目录</p>
      <h1 class="text-[26px] font-semibold leading-snug text-ink tablet:text-[30px]">
        选一项测评
      </h1>
      <p class="mt-3 text-[15.5px] leading-relaxed text-ink-soft">
        同一套题在不同时间、不同状态下答案会不一样，所以这里的每一项都只描述
        <span class="font-medium text-ink">你这次作答时呈现的样子</span>，
        不是给你下一个结论。每张卡片第一行写的是它能告诉你什么。
      </p>
    </header>

    <!-- 载入失败：说清楚失败原因 + 可重试。绝不退化成一份编出来的目录。 -->
    <div v-if="instruments.error" class="notice-error mt-6 max-w-prose" role="alert" data-instruments-error>
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>{{ instruments.error }}</span>
      </p>
      <button type="button" class="btn-ghost btn-sm mt-3" data-instruments-retry @click="retry">
        <AppIcon name="refresh" :size="16" />
        重新载入
      </button>
    </div>

    <p v-else-if="instruments.loading" class="mt-6 text-[15px] text-ink-soft" data-instruments-loading>
      正在载入测评列表…
    </p>

    <div
      v-else-if="cards.length === 0"
      class="notice-neutral mt-6 max-w-prose text-[14px] leading-relaxed"
      data-instruments-empty
    >
      现在还没有可用的测评。这通常是内容包还没登记到服务端 ——
      请稍后再试，或到
      <RouterLink to="/about" class="link">方法说明</RouterLink>
      看看本站的题目与计分口径。
    </div>

    <ul v-else class="assessment-grid mt-7" data-instrument-cards>
      <li
        v-for="(card, index) in cards"
        :key="card.slug"
        class="min-w-0"
        :data-instrument="card.slug"
      >
        <InstrumentCard :instrument="card" :index="index">
          <button
            type="button"
            class="btn-primary btn-sm"
            :disabled="pendingSlug === card.slug"
            :data-start="card.slug"
            @click="start(card.slug)"
          >
            {{ auth.isAuthenticated ? '查看并开始' : '登录后开始' }}
            <AppIcon name="arrow-right" :size="16" />
          </button>
          <RouterLink
            :to="{ name: 'instrument-method', params: { slug: card.slug } }"
            class="btn-ghost btn-sm"
            :data-method="card.slug"
          >
            先看题目与口径
          </RouterLink>
        </InstrumentCard>
      </li>
    </ul>

    <p v-if="!auth.isAuthenticated" class="caption mt-6 max-w-prose" data-instruments-login-hint>
      测评需要登录：答案与报告存在服务端，这样换设备可以接着答、历史报告也找得回来。
      <RouterLink to="/register" class="link">注册</RouterLink>
      或
      <RouterLink to="/login" class="link">登录</RouterLink>。
    </p>
  </PageContainer>
</template>
