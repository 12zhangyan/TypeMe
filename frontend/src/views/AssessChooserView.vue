<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { fetchMyAttempts, type InstrumentCard, type MyAttemptRow } from '@/api/platformV3'
import { useInstrumentsStore } from '@/stores/instrumentsV3'
import { useBigFiveStore } from '@/stores/bigFiveV3'
import { useAssessmentStore } from '@/stores/assessmentV3'

/**
 * 开始测评（`/assess`）—— 未答完的草稿 + 可选测评。
 *
 * ## 为什么这一页必须同时有这两块
 *
 * 多量表之后"开始测评"不再是一个动作：用户既可能想接着上次那份继续，
 * 也可能想换一项测评。原来这一页直接创建一份十六型草稿，于是：
 *   - 大五没有入口（首页只有一个按钮，指向的是十六型）；
 *   - 已经有草稿的人再点一次"开始测评"会**多出一份空草稿**，
 *     而草稿列表里的"续答"入口在首页，不在这一页。
 *
 * 现在这一页先把"你手上有什么"和"能从哪一项开始"一次说清，再让用户选。
 *
 * ## 创建草稿只在这里发生
 *
 * 点"开始"才创建 —— 列表页与详情页都不建立 attempt。这样"看过但没开始"
 * 不会在账号里留下任何记录。
 *
 * ## 草稿列表为什么用平台接口而不是 `assessmentV3.loadDraftEntry()`
 *
 * 后者返回的是**十六型专属**的行（没有量表名、没有进度、没有题型），
 * 在大五草稿上会渲染出一行空白。平台接口的行带有量表名、题型与进度，
 * 一份列表就能同时显示两种量表。首页的续答入口仍然用旧接口 —— 它只处理
 * 默认量表的"最近一份草稿"，行为不变。
 */

const instruments = useInstrumentsStore()
const bigFive = useBigFiveStore()
const assessment = useAssessmentStore()
const route = useRoute()
const router = useRouter()

const starting = ref<string | null>(null)
/**
 * 开始失败要说的话。
 *
 * 用**字符串**而不是 `ErrorDisplay`：这里有两种来源 —— 服务端错误（走 `describeError`）
 * 与"URL 里的 slug 不存在"（本地判断，没有服务端响应可描述）。硬把后者塞进
 * `ErrorDisplay` 就要编造 code / fields 这些字段，而它们会被别处当真。
 */
const startError = ref<string | null>(null)
const drafts = ref<MyAttemptRow[]>([])
const draftsLoading = ref(false)
/** 草稿列表问过一遍没有（区别于"正在问"）：自动开始要等它落定。 */
const draftsLoaded = ref(false)
const draftsError = ref<ErrorDisplay | null>(null)

const BIG_FIVE_SLUG = 'bigfive50'

const cards = computed(() => instruments.items)

/** 未答完的草稿（时间倒序，最近动过的在最前）。 */
const openDrafts = computed(() =>
  [...drafts.value]
    .filter((draft) => draft.status !== 'SUBMITTED')
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')),
)

/** 这一项有几份没答完（用于卡片上的标记）。 */
function draftCountOf(slug: string): number {
  return openDrafts.value.filter((draft) => draft.instrumentSlug === slug).length
}

function startErrorText(): string | null {
  return startError.value
}

onMounted(() => {
  // 目录与草稿都要：目录失败不该导致草稿区也空掉，反之亦然。
  void instruments.load()
  void loadDrafts()
})

async function loadDrafts(): Promise<void> {
  draftsLoading.value = true
  draftsError.value = null
  try {
    const page = await fetchMyAttempts(0, 50)
    drafts.value = page.items.filter((item) => item.status !== 'SUBMITTED')
  } catch (error) {
    drafts.value = []
    draftsError.value = describeError(error)
  } finally {
    draftsLoading.value = false
    draftsLoaded.value = true
  }
}

/** 开始（或继续）一项测评。 */
async function start(slug: string): Promise<void> {
  // 已经有没答完的草稿时**继续那一份**，不要再建一份新的。
  //
  // 建新草稿的代价不是多一行数据：用户在旧草稿上答过的题会留在那里，
  // 而"我上次答到哪了"这个问题会出现两个答案。列表区已经有「继续」入口，
  // 卡片上的按钮如果反而建新草稿，两处就会给出相反的行为。
  // 取最近动过的那一份（列表本来就是时间倒序）。
  const openDraft = openDrafts.value.find((draft) => draft.instrumentSlug === slug)
  if (openDraft) {
    await goToAttempt(openDraft.attemptId)
    return
  }
  starting.value = slug
  startError.value = null
  try {
    if (slug === BIG_FIVE_SLUG) {
      const attempt = await bigFive.start(slug)
      await router.push({ name: 'assess-attempt', params: { attemptId: attempt.attemptId } })
      return
    }
    // 十六型：沿用既有 store（它自己负责 package 解析与幂等键）。
    const detail = await assessment.create(null)
    await router.push({ name: 'assess-attempt', params: { attemptId: detail.attemptId } })
  } catch (error) {
    startError.value = describeError(error).message
  } finally {
    starting.value = null
  }
}

/**
 * 从别处直接带 `?instrument=<slug>` 过来时，不用再让人在这一页点一次。
 *
 * 触发条件是"目录已经载入 + 草稿列表已经问过一遍"，因为这两件事都会改变
 * `start()` 的结果：目录没载入时卡片不存在（会被当成未知 slug），草稿没读到时会
 * 多建一份草稿。所以**等两者都落定**再自动开始，且只做一次。
 */
const autoStartHandled = ref(false)
watch(
  () => [route.query.instrument, instruments.attempted, draftsLoaded.value] as const,
  () => {
    if (autoStartHandled.value) return
    const slug = typeof route.query.instrument === 'string' ? route.query.instrument : null
    if (!slug) return
    if (!instruments.attempted || !draftsLoaded.value) return
    autoStartHandled.value = true
    if (!instruments.bySlug(slug)) {
      // 未知 slug 不静默忽略：URL 里带了一个不存在的量表，用户需要知道为什么没反应。
      startError.value = `链接里的量表「${slug}」不在当前可用的测评里，请从下面的列表选一项。`
      return
    }
    void start(slug)
  },
  { immediate: true },
)

/**
 * 继续一份草稿。
 *
 * 路由只有 `/assess/:attemptId` 一条，由 `AttemptRouterView` 读服务端返回的
 * `instrumentKind` 决定渲染哪一页 —— 所以这里**不传**题型参数：多一个客户端
 * 参数就多一处可能与服务端不一致的来源。
 */
async function goToAttempt(attemptId: string): Promise<void> {
  await router.push({ name: 'assess-attempt', params: { attemptId } })
}

function draftStatusLabel(status: string): string {
  switch (status) {
    case 'DRAFT':
      return '没答完'
    case 'SUBMITTED':
      return '已提交'
    case 'NEEDS_REVIEW':
      return '信息不足'
    default:
      return status
  }
}

function formatTime(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '（没有记录时间）'
}

function minutesText(card: InstrumentCard): string {
  return card.supportsClarification
    ? `${card.baseItemCount} 题起，视情况最多再补 ${card.maxClarificationItems} 题，约 ${card.estimatedMinutes} 分钟`
    : `${card.baseItemCount} 题，约 ${card.estimatedMinutes} 分钟`
}
</script>

<template>
  <PageContainer page="home">
    <header class="max-w-prose">
      <h1 class="text-[26px] font-semibold leading-snug text-ink tablet:text-[30px]">开始测评</h1>
      <p class="mt-3 text-[15.5px] leading-relaxed text-ink-soft">
        下面先列出你还没答完的，再列出可以开始的。每次测评的答案都存在服务端，
        换设备可以接着答，报告会一直留着。
      </p>
    </header>

    <!-- ① 没答完的 -->
    <section class="mt-7" aria-labelledby="assess-drafts">
      <h2 id="assess-drafts" class="section-title flex items-center gap-2">
        <AppIcon name="clock" :size="18" class="text-primary-600" />
        还没答完的
      </h2>

      <p v-if="draftsLoading" class="mt-2 text-[14.5px] text-ink-soft">正在读取…</p>

      <!-- 读不到草稿时说明原因并提供重试，绝不说"你没有未完成的测评" -->
      <div v-else-if="draftsError" class="notice-uncertain mt-3 max-w-prose" role="alert" data-assess-drafts-error>
        <p class="text-[14px] leading-relaxed">
          没能读到未完成的测评列表：{{ draftsError.message }}
        </p>
        <button type="button" class="btn-ghost btn-sm mt-2" data-assess-drafts-retry @click="loadDrafts">
          <AppIcon name="refresh" :size="16" />
          重新读取
        </button>
      </div>

      <p v-else-if="openDrafts.length === 0" class="mt-2 text-[14.5px] text-ink-soft" data-assess-no-drafts>
        现在没有没答完的测评。在下面挑一项开始就行。
      </p>

      <ul v-else class="mt-3 grid gap-3" data-assess-drafts>
        <li
          v-for="draft in openDrafts"
          :key="draft.attemptId"
          class="card"
          :data-draft="draft.attemptId"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[16.5px] font-semibold text-ink">{{ draft.instrumentTitle }}</h3>
            <span class="chip chip-accent">{{ draftStatusLabel(draft.status) }}</span>
            <span class="chip chip-neutral">
              {{ draft.answeredCount }} / {{ draft.requiredCount }} 题
            </span>
          </div>
          <p class="caption mt-1.5">
            上次动过：{{ formatTime(draft.updatedAt) }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn-primary btn-sm"
              data-draft-continue
              @click="goToAttempt(draft.attemptId)"
            >
              接着答
              <AppIcon name="arrow-right" :size="16" />
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- ② 可以开始的 -->
    <section class="mt-9" aria-labelledby="assess-catalog">
      <h2 id="assess-catalog" class="section-title flex items-center gap-2">
        <AppIcon name="compass" :size="18" class="text-primary-600" />
        可以开始的测评
      </h2>

      <div v-if="instruments.error" class="notice-error mt-3 max-w-prose" role="alert" data-assess-catalog-error>
        <p class="text-[14px] leading-relaxed">{{ instruments.error }}</p>
        <button type="button" class="btn-ghost btn-sm mt-2" @click="instruments.load(true)">
          <AppIcon name="refresh" :size="16" />
          重新载入
        </button>
      </div>

      <p v-else-if="instruments.loading && cards.length === 0" class="mt-2 text-[14.5px] text-ink-soft">
        正在载入测评列表…
      </p>

      <ul v-else class="mt-3 grid gap-4 laptop:grid-cols-2" data-assess-catalog-list>
        <li v-for="card in cards" :key="card.slug" class="card flex flex-col gap-2.5" :data-instrument="card.slug">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[17.5px] font-semibold leading-snug text-ink">{{ card.title }}</h3>
            <span v-if="draftCountOf(card.slug) > 0" class="chip chip-accent">
              有 {{ draftCountOf(card.slug) }} 份没答完
            </span>
          </div>
          <p class="text-[14.5px] leading-relaxed text-ink">{{ card.summary }}</p>
          <p class="caption">{{ minutesText(card) }} · 你会得到：{{ card.whatYouLearn.join('、') }}</p>
          <div class="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              class="btn-primary btn-sm"
              :disabled="starting !== null"
              :data-start="card.slug"
              @click="start(card.slug)"
            >
              {{ starting === card.slug ? '正在准备…' : '开始这项' }}
              <AppIcon name="arrow-right" :size="16" />
            </button>
            <RouterLink :to="`/instruments/${card.slug}`" class="btn-ghost btn-sm">
              它问什么、怎么算
            </RouterLink>
          </div>
        </li>
      </ul>

      <div v-if="startErrorText()" class="notice-error mt-4 max-w-prose" role="alert" data-assess-start-error>
        <p class="text-[14.5px] leading-relaxed">{{ startErrorText() }}</p>
      </div>
    </section>

    <p class="caption mt-8 max-w-prose">
      测评是自我探索的参考，不是诊断，也不是官方 MBTI、招聘或配对的判定工具。
      每份报告都会写清这次的不确定之处，以及这次没有给出方向的维度。
    </p>
  </PageContainer>
</template>
