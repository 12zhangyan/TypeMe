<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { isSessionChanged } from '@/api/v3'
import { useAuthStore } from '@/stores/auth'
import { POLE_META } from '@/domain/scoring'
import { FALLBACK_TYPE_PROFILES } from '@/content/fallback'
import { BIG_FIVE_ANCHORS, UNKNOWN_REASON_LABEL } from '@/domain/answers'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import { useAssessmentStore } from '@/stores/assessmentV3'
import { fetchMyAttempts, type MyAttemptRow } from '@/api/platformV3'
import { formatLocalTime } from '@/domain/localTime'
import type { Dimension } from '@/domain/jung/types'
import PageContainer from '@/components/PageContainer.vue'
import PhoneFold from '@/components/PhoneFold.vue'
import PlatformIntro from '@/components/PlatformIntro.vue'
import DimensionGlyph from '@/components/DimensionGlyph.vue'
import DimensionMeter from '@/components/DimensionMeter.vue'
import TypeCardBody from '@/components/TypeCardBody.vue'
import AppIcon from '@/components/AppIcon.vue'
import { chineseNumeral } from '@/utils/cnNumber'

/**
 * 首页 —— 视觉重构轮（2026-09-18）。
 *
 * ## 这一版要解决的问题
 *
 * 上一版首页是一份**诚实但扁平**的说明文档：首屏一个 120px 高的抽象图形、
 * 之后连续五段"标题 + 分割线 + 列表"。信息都对，但：
 *   1. 第一眼看不出这是个什么产品，也没有"想试试"的冲动 —— 首屏没有主视觉；
 *   2. 用户看不到**报告长什么样**，只能靠文字想象；
 *   3. AI 分析被写成正文里的一句话，看不出它是什么、会给什么。
 *
 * 这一版按"探索 / 洞察"重排：深色主视觉 → 怎么答 → 报告预览 → 你会得到什么 →
 * 四个维度 → AI 洞察 → 常见问题 → 方法与隐私。所有事实性文案、题数口径、
 * 数据钩子与"示例必须标注"的纪律**原样保留**。
 *
 * ## 首屏的量表口径来自新测自己（不是旧内容包）
 *
 * 主入口 `.btn-primary` 指向 `/assess`，跑的是 `typeme-jung48-zh-v1` 十六型量表。
 * 因此**首屏**的量表名、题数、时长与四个维度都取自 `GET /api/v3/catalog/current`
 * （`stores/instrumentV3.ts`）。过去这些值取自 `useQuizStore().activePackage`，
 * 于是按钮写「开始测评（50 题）」而点进去是 48 题主测的十六型测评。
 *
 * ## 首页不提供「旧版本测试」入口
 *
 * 旧引擎入口按钮组、版本单选、本机旧作答恢复区、「重新开始」确认框与旧内容包署名
 * 已按产品要求整体移除。**旧引擎本身没有被删**：`/quiz`、`/result`、`/about`
 * 与已有旧作答记录全部原样保留，只是首页不再直达。
 *
 * ## 整页只描述一份量表
 *
 * 页面下方「会测到的N个维度」、教学例子、结果示例、报告预览、FAQ 与「你会得到什么」
 * 的唯一口径来源都是 {@link instrumentFacts}（`GET /api/v3/catalog/current`，
 * 读不到时用新测内置口径），旧内容包不参与首页渲染。
 */
const instrument = useInstrumentV3Store()
const assessment = useAssessmentStore()
const router = useRouter()
const auth = useAuthStore()
const platformDraft = ref<MyAttemptRow | null>(null)
const platformOpenTotal = ref(0)
const platformDraftsLoaded = ref(false)
const platformDraftsLoading = ref(false)
const platformDraftsError = ref(false)
let draftGeneration = 0

async function loadPlatformDraft(): Promise<void> {
  const generation = ++draftGeneration
  const owner = auth.profile?.userId
  if (!auth.isAuthenticated || !owner) {
    platformDraft.value = null
    platformOpenTotal.value = 0
    platformDraftsLoaded.value = false
    platformDraftsLoading.value = false
    return
  }
  platformDraftsLoading.value = true
  platformDraftsError.value = false
  try {
    const page = await fetchMyAttempts(0, 1, 'open')
    if (generation !== draftGeneration || auth.profile?.userId !== owner) return
    platformDraft.value = page.items[0] ?? null
    platformOpenTotal.value = page.total
    platformDraftsLoaded.value = true
  } catch (error) {
    if (generation !== draftGeneration || auth.profile?.userId !== owner) return
    if (isSessionChanged(error)) {
      void loadPlatformDraft()
      return
    }
    platformDraftsError.value = true
  } finally {
    if (generation === draftGeneration) platformDraftsLoading.value = false
  }
}

watch(() => [auth.status, auth.profile?.userId] as const, () => {
  if (!auth.isAuthenticated) {
    platformDraft.value = null
    platformOpenTotal.value = 0
    platformDraftsLoaded.value = false
    platformDraftsLoading.value = false
    assessment.clearDraftEntry()
    return
  }
  // 首页往往比会话确认更早挂上。只在 onMounted 里读草稿，会赶在登录态落定之前
  // 放弃，之后主按钮就一直是「开始测评」。
  void loadPlatformDraft()
  void assessment.loadDraftEntry()
}, { immediate: true })
onBeforeUnmount(() => { draftGeneration++ })

/**
 * 新测与账号路由是否已注册。
 *
 * 首页会被单独挂载（测试里只给了一个两三条路由的 memory router），
 * 渲染指向未注册路由的 `RouterLink` 只会让 vue-router 报一堆 "No match found"、
 * 用户看到一个点了没反应的入口。没注册就退回到不带链接的说明性文字。
 */
const reportsReady = computed(() => router.hasRoute('reports'))
const authRoutesReady = computed(() => router.hasRoute('login'))

/**
 * 续答入口要用的那份草稿（服务端权威），没有就返回 null。
 *
 * <p>必须同时满足三件事，缺一个就退回普通的「开始测评」：
 *   1. 登录着（未登录时列表接口只会 401，谈不上"你的草稿"）；
 *   2. `loadDraftEntry` 真的读到了草稿；
 *   3. 路由表里注册了 `assess-attempt`（首页在测试里会被单独挂载，
 *      指向未注册路由的 `RouterLink` 会让用户点了没反应）。
 */
const resumeTarget = computed(() => {
  if (!auth.isAuthenticated || !router.hasRoute('assess-attempt')) return null
  if (platformDraftsLoaded.value) return platformDraft.value
  return assessment.resumableDraft
})

/** 续答的是大五时，这一块不能再用十六型的题数和「暂时无法判断」。 */
const resumeIsBigFive = computed(() => {
  const draft = resumeTarget.value
  if (!draft) return false
  if ('instrumentKind' in draft) return draft.instrumentKind === 'big_five'
  return 'packageId' in draft && draft.packageId.startsWith('typeme-bigfive50-')
})

const resumeTitle = computed(() => {
  const draft = resumeTarget.value
  if (draft && 'instrumentTitle' in draft && draft.instrumentTitle) return draft.instrumentTitle
  return '大五人格倾向测评'
})

const resumeRequired = computed(() => {
  const draft = resumeTarget.value
  if (draft && 'requiredCount' in draft && draft.requiredCount > 0) return draft.requiredCount
  return null
})

/** 续答那行说明：已答数只在**读到了**那份草稿详情时出现。 */
const resumeNote = computed(() => {
  const draft = resumeTarget.value
  if (!draft) return ''
  const when = formatLocalTime(draft.updatedAt) || '（时间未记录）'
  const progress = assessment.draftProgress
  const parts: string[] = []
  const jungDetail = progress
    && progress.attemptId === draft.attemptId
    && (!('instrumentKind' in draft) || draft.instrumentKind === 'jung')
  if (jungDetail) {
    parts.push(`已答 ${progress.answered}/${progress.baseTotal} 题（主测）`)
  } else if ('answeredCount' in draft && 'requiredCount' in draft && draft.requiredCount > 0) {
    const counted = `${draft.answeredCount}/${draft.requiredCount} 题`
    parts.push('status' in draft && draft.status === 'CLARIFICATION_IN_PROGRESS'
      ? `主测已答 ${counted}`
      : `已答 ${counted}`)
  }
  parts.push(`上次答到 ${when}`)
  const others = platformDraftsLoaded.value && draft
    ? Math.max(0, platformOpenTotal.value - 1)
    : assessment.otherDraftCount
  if (others > 0) {
    parts.push(`另外还有 ${others} 份没答完`)
  }
  return `接着答不会重新开始：${parts.join(' · ')}。`
})

/**
 * 草稿时间的人类写法。
 *
 * <p>`updatedAt` 是服务端给的 ISO-8601（UTC）。这里只做"把时间说清楚"这一件事：
 * 拿不到或解析不了就**不显示时间**（而不是显示 `Invalid Date` 或者现在的时间）。
 */

/** 新测的对外口径 —— 整页唯一的量表口径。 */
const instrumentFacts = computed(() => instrument.facts)

/** 「约 8–12 分钟」——时长区间按主测题数换算。 */
const minutesLabel = computed(
  () => `${instrumentFacts.value.minutesLow}–${instrumentFacts.value.minutesHigh}`,
)

/**
 * 会测到的维度 —— 数量、顺序、两端记号与维度名全部来自**首页主推的这份新测**。
 */
const dimensions = computed(() =>
  instrumentFacts.value.dimensions.map((item) => {
    const meta = POLE_META[item.dimension]
    return {
      dimension: item.dimension,
      label: `${meta.negativePole} – ${meta.positivePole}`,
      name: item.name,
      hint: meta.hint,
    }
  }),
)

/** 首屏抽象图形的轨道 —— 与上面的维度说明同源。 */
const glyphTracks = computed(() => instrumentFacts.value.dimensions)

const dimensionCountLabel = computed(() => chineseNumeral(dimensions.value.length))

/**
 * 结果示例卡的样例档案。
 *
 * 首页主推的量表产出四字母类型码，所以示例卡**始终**渲染。它是明确标注过的示例，
 * 不是任何人的真实结果。
 */
const sample = FALLBACK_TYPE_PROFILES['INFP'] ?? null

/**
 * 报告预览用的样例维度行。
 *
 * ## 这些数字是**编的**，所以必须被标成示例
 *
 * 预览要有说服力就得有位置点，而位置点只能来自一次真实作答。这里固定写死四条
 * 演示数据（覆盖"偏向 / 略偏 / 两边接近 / 偏向"四种状态），并且：
 *   - 区块标题与说明里**明确写"示例"**，不写"你的结果"；
 *   - 维度名、两端字母与中文标签**取自真实口径**（`instrumentFacts` + `POLE_META`），
 *     所以预览的**结构**是真的，只有位置是编的；
 *   - 预览不做成可点击入口，避免被当成已有报告。
 *
 * `position` 只用来画位置点；`statusNote` 与 `ariaLabel` 是照 `domain/reportV3.ts`
 * 的口径手写的（真实报告里由服务端给出），文案一致才不会被读成另一套规则。
 */
const SAMPLE_POSITIONS: Record<string, { position: number; note: string }> = {
  EI: { position: 0.31, note: '本次回答偏向 I。' },
  SN: { position: 0.63, note: '本次略偏 N（倾向较轻），另一侧也值得一起读。' },
  TF: { position: 0.5, note: '本次这一维两边接近，没有哪一侧更占优势。' },
  JP: { position: 0.74, note: '本次回答偏向 P。' },
}

const sampleRows = computed(() =>
  dimensions.value.map((item) => {
    const meta = POLE_META[item.dimension as Dimension]
    const spec = SAMPLE_POSITIONS[item.dimension] ?? { position: 0.5, note: '' }
    const tied = spec.position === 0.5
    const pole = tied ? null : spec.position < 0.5 ? meta.negativePole : meta.positivePole
    const boundary = !tied && Math.abs(spec.position - 0.5) <= 0.18
    return {
      dimension: item.dimension,
      name: item.name,
      negativePole: meta.negativePole,
      negativeLabel: meta.negativeLabel,
      positivePole: meta.positivePole,
      positiveLabel: meta.positiveLabel,
      position: spec.position,
      computedPole: pole,
      tiedSide: tied ? ('tied' as const) : spec.position < 0.5 ? ('negative' as const) : ('positive' as const),
      boundary,
      coverageOk: true,
      statusNote: boundary
        ? `本次略偏 ${pole}（倾向较轻），另一侧也值得一起读。`
        : spec.note,
      ariaLabel: `${item.name}：${meta.negativeLabel} ${meta.negativePole} ↔ ${meta.positiveLabel} ${meta.positivePole}（示例）`,
      details: tied
        ? [`${meta.negativeLabel}一侧：更习惯先按自己的节奏来。`, `${meta.positiveLabel}一侧：也需要外部信息推一把。`]
        : [],
    }
  }),
)

/**
 * 报告预览的四个阅读层次。
 *
 * 与真实报告页的章节一一对应（结果概览 → 维度依据 → 具体解读 → 行动建议），
 * 让"你会看到什么"这句话在点进来之前就有具体形状。
 */
const REPORT_SECTIONS = computed(() => [
  { title: '结果概览', body: '类型名、结果状态（参考 / 略偏 / 并列）与一段总述。' },
  { title: '四个维度的依据', body: `每一维给出位置、状态与可计分题数，边界维度会写出另一侧。` },
  { title: '这一型的读法', body: '按你真正作答的维度展开的分段解读，不给未定的维度套类型描述。' },
  { title: '可以试试', body: '由过程结构派生的具体做法，不是泛泛的鼓励。' },
])

/**
 * AI 洞察会返回什么。
 *
 * 这里列的是**接口真实返回的字段**（`api/v3Ai.ts` 的 `AnalysisResultView`），
 * 不是设想中的能力。写"你将得到什么"时必须能一一对上，否则就是在承诺没实现的东西。
 */
const AI_STRUCTURE = [
  { key: 'summary', title: '一句话结论', body: '先说这次回答反映了什么，以及哪些地方还不确定。' },
  { key: 'sections', title: '为什么这样说', body: '最多两条解释，用生活中的例子帮助理解。' },
  { key: 'actions', title: '可以试一次', body: '一件小事：怎么做、何时试、留意什么。证据不足时不给针对性建议。' },
  { key: 'boundaries', title: '这段分析的边界', body: '模型自己说明它的推测在哪里可能不成立。' },
]

/**
 * 不计分的教学例子 —— 按新测实际的双极作答格式讲。
 */
const BIG_FIVE_HOW_TO = computed(() => [
  `1 是「${BIG_FIVE_ANCHORS[0]}」，5 是「${BIG_FIVE_ANCHORS[4]}」。`,
  `3 是「${BIG_FIVE_ANCHORS[2]}」，仍然算一次有效作答。`,
  '不理解、这句话不适用，或没有相关经历，选「说不好」。它和中间那一档不是一回事。',
  '按平时的感受选，不必为了显得某一种性格而改答案。',
])

const TEACHING_EXAMPLE = computed(() => [
  '两边都读完：左边是 1，右边是 5。',
  '3 表示理解之后觉得两侧差不多符合，不代表没看懂。',
  '不确定该怎么理解、两边都不适用，或没有相关经历，点「暂时无法判断」。',
  '实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。',
])

const BIG_FIVE_DIMENSIONS = [
  { name: '外向性', hint: '更愿意主动接触外界，还是更常把精力留在自己这边。' },
  { name: '宜人性', hint: '合作、体谅别人的倾向有多明显。' },
  { name: '尽责性', hint: '做事有多按计划、有多在意把事情做完。' },
  { name: '情绪稳定性', hint: '情绪起伏时，自己能多稳地待着。' },
  { name: '开放性', hint: '对新想法、新体验有多愿意接触。' },
] as const

const faqs = computed(() => resumeIsBigFive.value ? [
  {
    q: '看不懂题目怎么办？',
    a: '可以选「说不好」。它表示这题没有作答，不会被当成中间那一档「说不上符合或不符合」。',
  },
  {
    q: '选「说不好」会怎样？',
    a: '这题不计入有效作答。一个方面有效作答不够时，这一方面不给方向；其余方面照常说明。',
  },
  {
    q: '结果会不会合成一个类型？',
    a: '不会。五个方面各自说明，不加总，也不给字母组合。分数是这次作答的原始分，不是人群排名。',
  },
] : [
  {
    q: '看不懂题目怎么办？',
    a: '每题下面有「这题是什么意思？」，展开不会改变答案。仍说不清、不适用或没有相关经历，可以点「暂时无法判断」。',
  },
  {
    q: '选「暂时无法判断」会怎样？',
    a: '它和「两边相近」不同：不会被算成 3 分，也不会被平均填充。相关维度显示“信息不足”，其余维度照常给结果，报告会写明哪些维度暂时没有结论。',
  },
  {
    q: '结果会不会一直固定不变？',
    a: '不会。四个维度是连续分数，靠近中点时，换个时间或状态作答可能落到另一侧。四个维度没有都达到展示条件时，类型留空，不给默认类型。',
  },
  {
    q: '我的答案会上传吗？',
    a: '作答和报告保存在账号下，可跨设备续答和回看。数据处理与访问范围请看方法与隐私；账号页可导出或删除数据。',
  },
  {
    q: '测到一半关掉页面怎么办？',
    a: '作答存在你的账号里，换设备或浏览器登录同一账号都能接着答，会回到上次答到的位置附近，也可以用「上一题」改前面的答案。',
  },
])

const VALUES = computed(() => resumeIsBigFive.value ? [
  {
    icon: 'dimensions' as const,
    title: '五个方面各自说明',
    body: '不加总，也不合成一个类型。某一方面有效作答不够时，只说这一方面这次看不清。',
  },
  {
    icon: 'question' as const,
    title: '中间档与「说不好」不同',
    body: '3 是「说不上符合或不符合」，仍然算有效作答。选「说不好」表示这题没有作答。',
  },
  {
    icon: 'chart' as const,
    title: '只解释这次答过的部分',
    body: '看不清的方面不补方向。',
  },
] : [
  {
    icon: 'dimensions' as const,
    title: '四个维度各自的结果',
    body: '每一维分别给出信息不足、两侧相近、略偏、偏向四种状态。四维都达到展示条件才给出参考类型，否则类型为空。',
  },
  {
    icon: 'question' as const,
    title: '每题有释义',
    body: '每题有「这题是什么意思？」的短释义，也可以选「暂时无法判断」，不必猜一个数字。',
  },
  {
    icon: 'chart' as const,
    title: '解释只来自你的作答',
    body: '解释与建议只针对你作答过的维度；不确定的维度只给观察建议，不套类型描述。',
  },
])

const showAllFaq = ref(false)
const visibleFaqs = computed(() => (showAllFaq.value ? faqs.value : faqs.value.slice(0, 3)))

/**
 * 首屏「先看一份报告长什么样」。
 *
 * ⚠️ 这里**不能**写成 `<a href="#report-preview">`：本站路由用的是 hash 模式，
 * 浏览器会把 `#report-preview` 当成一次路由跳转，用户会落到一个不存在的路由上
 * （而不是滚动到预览区）。所以用 JS 滚动，并且按钮本身是可聚焦的 button。
 */
function scrollToPreview(): void {
  const target = document.getElementById('report-preview')
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target.focus({ preventScroll: true })
}

onMounted(() => {
  void instrument.load()
})
</script>

<template>
  <PageContainer page="home">
    <PlatformIntro :resume="resumeTarget" :checking-drafts="platformDraftsLoading" />
    <div v-if="platformDraftsError" class="notice-error mt-4" role="alert" data-home-drafts-error>
      还没能确认上次的作答进度。
      <button type="button" class="btn-secondary btn-sm" @click="loadPlatformDraft">重新读取进度</button>
    </div>
    <details class="mt-8" :open="!!resumeTarget" data-jung-introduction>
      <summary class="cursor-pointer text-[16px] font-semibold text-ink">{{ resumeIsBigFive ? `接着答：${resumeTitle}` : '十六型测评：答题和报告示例' }}</summary>
      <div class="mt-5">
    <!-- ══ 主视觉：深色面板（不是满屏出血，而是一块有边界的"探索界面"） ══ -->
    <section
      class="deep-panel deep-grid rounded-cover px-5 py-7 shadow-deep tablet:px-10 tablet:py-12 laptop:px-14 laptop:py-16"
      data-hero
    >
      <div class="grid gap-8 laptop:grid-cols-[minmax(0,1fr)_24rem] laptop:items-center laptop:gap-12">
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-navy-100" data-instrument-kicker>
            <span class="chip chip-on-deep">
              <AppIcon name="compass" :size="14" />
              <!-- 首屏的量表口径：量表名 · 主测题数 · 时长。这一行的文本被单测钉住。 -->
              <span v-if="resumeIsBigFive">{{ resumeTitle }}<template v-if="resumeRequired"> · {{ resumeRequired }} 题</template></span>
              <span v-else>{{ instrumentFacts.title }} · 主测 {{ instrumentFacts.baseQuestions }} 题 · 约 {{ minutesLabel }} 分钟</span>
            </span>
          </p>

          <h2
            class="display-hero mt-5 text-[32px] leading-[1.18] text-white tablet:text-[42px] laptop:text-[50px]"
          >
            {{ resumeIsBigFive ? resumeTitle : instrumentFacts.title }}
          </h2>

          <p v-if="resumeIsBigFive" class="mt-5 max-w-[34rem] text-[15.5px] leading-[1.75] text-navy-100 tablet:text-[16.5px]">
            按平时的感受选择。不理解或缺少经历时可以选「说不好」。五个方面各自说明，不合成一个类型。
          </p>
          <p v-else class="mt-5 max-w-[34rem] text-[15.5px] leading-[1.75] text-navy-100 tablet:text-[16.5px]">
            主测 {{ instrumentFacts.baseQuestions }} 组日常情境描述。按通常情况下的真实感受选择，
            没有理想答案。不理解或缺少经历时可以标记「暂时无法判断」。
          </p>

          <ul class="mt-6 flex flex-wrap items-center gap-2">
            <li class="chip chip-on-deep">
              <AppIcon name="steps" :size="14" />
              <template v-if="resumeIsBigFive">{{ resumeRequired ? `${resumeRequired} 道题` : '按题目清单接着答' }}</template>
              <template v-else>主测 {{ instrumentFacts.baseQuestions }} 道题</template>
            </li>
            <li v-if="!resumeIsBigFive" class="chip chip-on-deep">
              <AppIcon name="clock" :size="14" />
              约 {{ minutesLabel }} 分钟
            </li>
            <li class="chip chip-on-deep">
              <AppIcon name="shield" :size="14" />
              免费 · 需登录
            </li>
            <li class="chip chip-on-deep">
              <AppIcon name="dimensions" :size="14" />
              <template v-if="resumeIsBigFive">五个方面分别说明</template>
              <template v-else>{{ dimensionCountLabel }}个维度分别成结论</template>
            </li>
          </ul>

          <div class="mt-7 flex flex-col gap-2.5 tablet:flex-row tablet:items-center">
            <!--
              主入口会在"服务端确实有一份没答完的测评"时变成「继续」。
              这是首页对上面那句「登录后可以跨设备接着答」的兑现 —— 在此之前，
              草稿虽然一直存在服务端，但除了浏览器地址栏没有任何回去的路（A51）。
            -->
            <RouterLink
              v-if="resumeTarget"
              :to="{ name: 'assess-attempt', params: { attemptId: resumeTarget.attemptId } }"
              class="btn-primary tablet:w-auto tablet:px-8"
              data-primary-entry
              data-resume-entry
            >
              继续{{ 'instrumentTitle' in resumeTarget ? resumeTarget.instrumentTitle : '上次没答完的测评' }}
              <AppIcon name="arrow-right" :size="18" />
            </RouterLink>
            <RouterLink
              v-else
              to="/assess"
              class="btn-primary tablet:w-auto tablet:px-8"
              data-primary-entry
            >
              开始测评（主测 {{ instrumentFacts.baseQuestions }} 题）
              <AppIcon name="arrow-right" :size="18" />
            </RouterLink>
            <!-- 有草稿时，原来的两个次要入口让位给「重新开始」：继续才是此刻的主意图。 -->
            <RouterLink
              v-if="resumeTarget"
              to="/assess"
              class="btn-on-deep"
              data-restart-entry
            >
              重新开始一次测评
            </RouterLink>
            <button v-else type="button" class="btn-on-deep" data-report-preview-entry @click="scrollToPreview">
              先看一份报告长什么样
              <AppIcon name="arrow-down" :size="17" />
            </button>
          </div>

          <!--
            续答的进度只写**真的读到的东西**：已答数来自那份草稿的详情，
            时间来自列表接口。读不到进度时这一行只剩时间（绝不显示猜出来的题数）。
          -->
          <p
            v-if="resumeTarget"
            class="mt-3 text-[13px] leading-relaxed text-navy-100"
            data-resume-note
          >
            {{ resumeNote }}
          </p>

          <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <RouterLink
              v-if="reportsReady && auth.isAuthenticated"
              to="/reports"
              class="link-on-deep text-[13.5px]"
            >
              看你自己的历史报告
            </RouterLink>
            <RouterLink
              v-else-if="authRoutesReady"
              :to="{ name: 'login', query: { redirect: '/reports' } }"
              class="link-on-deep text-[13.5px]"
            >
              登录后看历史报告
            </RouterLink>
            <p class="text-[13px] leading-relaxed text-navy-200" data-entry-note>
              登录后可以跨设备接着答，也能回看自己历次的报告；报告是参考测评，不是诊断。
            </p>
          </div>

          <!--
            题量口径：主按钮点进去先答「主测」那一轮。题库总数与它的关系必须写清楚，
            否则紧挨着按钮放一个裸的「64 题」会让人以为要答 64 题。
          -->
          <p v-if="resumeIsBigFive" class="mt-4 max-w-[36rem] text-[12.5px] leading-relaxed text-navy-200" data-instrument-scope>
            题量口径：这一份是{{ resumeTitle }}<template v-if="resumeRequired">，一共 {{ resumeRequired }} 题</template>。没有十六型那种补充题。
          </p>
          <p v-else class="mt-4 max-w-[36rem] text-[12.5px] leading-relaxed text-navy-200" data-instrument-scope>
            题量口径：题库共 {{ instrumentFacts.bankQuestions }} 题 = 主测 {{ instrumentFacts.baseQuestions }} 题 + 最多
            {{ instrumentFacts.clarificationQuestions }} 道补充题。补充题只在你某一维两边差不多时才会出现，也可以跳过。
          </p>
        </div>

        <!-- 主视觉图形：四条维度轴。它是装饰，不显示任何人的分数。大五续答时不放这张图，避免写成四个维度。 -->
        <div v-if="!resumeIsBigFive" class="order-first mx-auto h-[190px] w-full max-w-[280px] tablet:h-[240px] laptop:order-none laptop:h-[360px] laptop:max-w-none">
          <DimensionGlyph :compact="false" :tracks="glyphTracks" />
        </div>
      </div>
    </section>

    <!-- ══ 开始前说明（不计分的教学例子） ═══════════════════════════════ -->
    <section class="mt-12 laptop:mt-16" data-how-to-answer>
      <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 class="section-title">怎么作答</h2>
        <p class="caption">示例不计分。</p>
      </div>

      <div v-if="resumeIsBigFive" class="mt-5 rounded-question border border-line bg-surface px-4 py-4 shadow-card tablet:px-6 tablet:py-5">
        <div class="grid grid-cols-5 gap-1.5 tablet:gap-3">
          <div
            v-for="(anchor, index) in BIG_FIVE_ANCHORS"
            :key="anchor"
            class="flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-card border-2 border-line bg-surface px-1 text-center"
          >
            <span class="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong text-[12.5px] font-semibold text-ink-soft">{{ index + 1 }}</span>
            <span class="text-[11px] leading-snug text-ink-soft">{{ anchor }}</span>
          </div>
        </div>
        <p class="mt-3 text-center text-[12.5px] text-ink-soft">
          示例：3 是「{{ BIG_FIVE_ANCHORS[2] }}」。选「说不好」表示这题没有作答，不会计入有效题。
        </p>
      </div>
      <!-- 一张真的可以看懂的作答示意图：左 1 ── 中 3 ── 右 5 -->
      <div v-else class="mt-5 rounded-question border border-line bg-surface px-4 py-4 shadow-card tablet:px-6 tablet:py-5" aria-hidden="true">
        <div class="flex items-center justify-between text-[12.5px] text-ink-soft">
          <span class="font-medium text-ink">左边这一侧</span>
          <span class="font-medium text-ink">右边这一侧</span>
        </div>
        <div class="mt-3 grid grid-cols-5 gap-1.5 tablet:gap-3">
          <div
            v-for="value in [1, 2, 3, 4, 5]"
            :key="value"
            class="flex min-h-[56px] flex-col items-center justify-center gap-1.5 rounded-card border-2 border-line bg-surface"
            :class="value === 2 ? 'border-primary-600 bg-primary-50' : ''"
          >
            <span
              class="flex h-7 w-7 items-center justify-center rounded-full border text-[12.5px] font-semibold"
              :class="value === 2 ? 'border-primary-600 bg-primary-600 text-white' : 'border-line-strong text-ink-soft'"
              >{{ value }}</span
            >
          </div>
        </div>
        <p class="mt-3 text-center text-[12.5px] text-ink-soft">
          示例：选 2 表示「更靠左边这一侧一点」；3 是「两侧差不多」。
        </p>
      </div>

      <ul class="mt-6 grid gap-4 tablet:grid-cols-2 tablet:gap-x-10">
        <li
          v-for="(line, index) in (resumeIsBigFive ? BIG_FIVE_HOW_TO : TEACHING_EXAMPLE)"
          :key="index"
          class="flex gap-3 border-t border-line pt-3.5 text-[14.5px] leading-[1.7] text-ink-soft"
        >
          <span class="section-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
          <span>{{ line }}</span>
        </li>
      </ul>
    </section>

    <!-- ══ 报告预览（首屏的第二个入口就落在这里） ══════════════════════ -->
    <section
      v-if="!resumeIsBigFive"
      id="report-preview"
      data-anchor
      tabindex="-1"
      class="mt-12 focus:outline-none laptop:mt-16"
      data-report-preview
    >
      <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 class="section-title">报告长这样</h2>
        <p class="caption">
          <strong class="font-semibold text-accent-500">示例</strong
          >，结构与真实报告一致，内容不是任何人的结果。
        </p>
      </div>

      <div class="mt-5 overflow-hidden rounded-cover border border-line bg-surface shadow-card">
        <!-- 概览条：和报告页的头部同一个结构（状态 + 类型 + 名称） -->
        <div
          class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line bg-surface px-5 py-5 tablet:px-8 tablet:py-6"
        >
          <div class="min-w-0">
            <p class="flex items-center gap-2 text-[12.5px] font-medium text-ink-faint">
              <span class="chip chip-accent">示例</span>
              参考类型（四个维度都有结论时才显示）
            </p>
            <p class="mt-2 display-hero text-[40px] leading-none tracking-[0.06em] text-ink tablet:text-[52px]">
              INFP
            </p>
            <p v-if="sample" class="mt-2 text-[16px] font-semibold text-ink tablet:text-[17px]">
              {{ sample.nameCn }}
            </p>
          </div>
          <ul class="flex flex-wrap gap-2">
            <li class="chip chip-primary">参考类型</li>
            <li class="chip chip-neutral">四维都有结论</li>
          </ul>
        </div>

        <!-- 维度依据：和真实报告同一种位置图 -->
        <div class="grid gap-5 px-5 py-6 tablet:grid-cols-2 tablet:gap-6 tablet:px-8">
          <DimensionMeter v-for="(row, index) in sampleRows" :key="row.dimension" :row="row" :index="index" />
        </div>

        <!-- 阅读层次：告诉用户接下来还能读到什么 -->
        <div class="border-t border-line bg-surface-soft px-5 py-6 tablet:px-8">
          <h3 class="text-[15px] font-semibold text-ink">往下还有</h3>
          <ol class="mt-4 grid gap-4 tablet:grid-cols-2 laptop:grid-cols-4">
            <li v-for="(item, index) in REPORT_SECTIONS" :key="item.title" class="flex gap-3">
              <span class="section-index mt-0.5" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
              <div>
                <p class="text-[14.5px] font-semibold text-ink">{{ item.title }}</p>
                <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{{ item.body }}</p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <RouterLink to="/assess" class="btn-primary btn-sm">直接开始测评</RouterLink>
        <p class="fineprint">
          平分、略偏、信息不足时，报告不强行补类型，也不显示百分比。
        </p>
      </div>
    </section>

    <!-- 手机上把「想了解时才读」的四段收进一行（平板及以上照常展开） -->
    <PhoneFold summary="更多说明" :hint="resumeIsBigFive ? '你会得到什么、会测到的方面、AI 分析' : '你会得到什么、四个维度、AI 分析、结果示例'">
    <!-- ══ 你会得到什么 ═════════════════════════════════════════════════ -->
    <section class="mt-6 tablet:mt-0 phone-fold-first">
      <h2 class="section-title">你会得到什么</h2>
      <ul class="mt-5 grid gap-6 tablet:grid-cols-3 tablet:gap-8">
        <li
          v-for="item in VALUES"
          :key="item.title"
          class="border-t-2 border-primary-100 pt-4"
        >
          <span class="inline-flex h-9 w-9 items-center justify-center rounded-card bg-primary-50 text-primary-700">
            <AppIcon :name="item.icon" :size="18" />
          </span>
          <h3 class="mt-3 text-[16px] font-semibold text-ink">{{ item.title }}</h3>
          <p class="mt-2 prose-sm">{{ item.body }}</p>
        </li>
      </ul>
    </section>

    <!-- ══ 会测到的维度 ════════════════════════════════════════════════ -->
    <section v-if="resumeIsBigFive" class="mt-12 laptop:mt-16">
      <h2 class="section-title">会测到的五个方面</h2>
      <dl data-dimension-list class="mt-5 grid gap-x-10 gap-y-4 tablet:grid-cols-2">
        <div v-for="item in BIG_FIVE_DIMENSIONS" :key="item.name" class="flex gap-4 border-t border-line pt-3.5">
          <dt class="w-[7.5rem] shrink-0 font-display text-[15px] font-bold text-primary-600">{{ item.name }}</dt>
          <dd class="prose-sm">{{ item.hint }}</dd>
        </div>
      </dl>
    </section>
    <section v-else class="mt-12 laptop:mt-16">
      <h2 class="section-title">会测到的{{ dimensionCountLabel }}个维度</h2>
      <dl data-dimension-list class="mt-5 grid gap-x-10 gap-y-4 tablet:grid-cols-2">
        <div
          v-for="item in dimensions"
          :key="item.dimension"
          :data-dimension="item.dimension"
          class="flex gap-4 border-t border-line pt-3.5"
        >
          <dt class="w-[7.5rem] shrink-0">
            <span class="font-display text-[15px] font-bold text-primary-600">{{ item.label }}</span>
            <span class="mt-0.5 block text-[13px] text-ink-soft">{{ item.name }}</span>
          </dt>
          <dd class="prose-sm">{{ item.hint }}</dd>
        </div>
      </dl>
    </section>

    <!-- ══ AI 洞察（可选能力，独立视觉识别） ═══════════════════════════ -->
    <section
      class="deep-panel deep-grid mt-12 rounded-cover px-5 py-7 shadow-deep tablet:px-10 tablet:py-10 laptop:mt-16 laptop:px-12"
      aria-labelledby="landing-ai"
      data-landing-ai
    >
      <div class="grid gap-8 laptop:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] laptop:gap-12">
        <div>
          <p class="chip chip-on-deep">
            <AppIcon name="spark" :size="14" />
            可选 · 需要你主动生成
          </p>
          <h2 id="landing-ai" class="display-hero mt-4 text-[24px] leading-snug text-white tablet:text-[30px]">
            AI 分析（可选）
          </h2>
          <p class="mt-4 max-w-[34rem] text-[15px] leading-[1.75] text-navy-100">
            固定报告不依赖 AI。AI 分析只读你已经看到的那份报告，用更日常的说法改写，并给出可以照着做的步骤。
          </p>

          <ul class="mt-6 space-y-3">
            <li class="flex gap-3 text-[14px] leading-relaxed text-navy-100">
              <AppIcon name="sliders" :size="17" class="mt-0.5 text-glow" />
              <span
                >先选一个主题（全面 / 沟通 / 学习工作 / 成长），再看清楚
                <strong class="font-semibold text-white">会发送哪些信息</strong>，勾选确认后才会调用模型。</span
              >
            </li>
            <li class="flex gap-3 text-[14px] leading-relaxed text-navy-100">
              <AppIcon name="shield" :size="17" class="mt-0.5 text-glow" />
              <span>不发送用户名、登录信息、完整题库与完整答卷；页面会逐条列出会发和不发的内容。</span>
            </li>
            <li class="flex gap-3 text-[14px] leading-relaxed text-navy-100">
              <AppIcon name="alert" :size="17" class="mt-0.5 text-glow" />
              <span>不改写固定结果，AI 的内容与报告分开显示。服务器没开这项能力时，页面会直接说明。</span>
            </li>
          </ul>

        </div>

        <!-- 结构预览：编号 + 连接线，是"科技感来自结构清晰"而不是霓虹 -->
        <ol class="relative space-y-3 border-l border-white/15 pl-6">
          <li v-for="(item, index) in AI_STRUCTURE" :key="item.key" class="relative">
            <span
              class="absolute -left-[1.9rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-glow/40 bg-navy-800 text-[10.5px] font-bold text-glow"
              aria-hidden="true"
              >{{ index + 1 }}</span
            >
            <div class="deep-card">
              <p class="text-[14.5px] font-semibold text-white">{{ item.title }}</p>
              <p class="mt-1 text-[13.5px] leading-relaxed text-navy-100">{{ item.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- ══ 结果示例卡（明确标"示例"） ══════════════════════════════════ -->
    <section v-if="sample && !resumeIsBigFive" data-result-example class="mt-12 laptop:mt-16">
      <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 class="section-title">结果示例</h2>
        <p class="caption">
          <strong class="font-semibold text-accent-500">示例</strong
          >，不是你的结果。
        </p>
      </div>
      <div class="mt-5 grid gap-5 rounded-cover border border-line bg-surface px-5 py-6 shadow-card tablet:grid-cols-[16rem_minmax(0,1fr)] tablet:gap-8 tablet:px-8">
        <div>
          <p class="chip chip-accent">示例：四维都达到展示条件时才有</p>
          <p class="mt-3 display-hero text-[44px] leading-none tracking-[0.06em] text-ink">INFP</p>
          <p class="mt-2 text-[16px] font-semibold text-ink">{{ sample.nameCn }}</p>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{{ sample.tagline }}</p>
        </div>
        <div class="min-w-0 border-t border-line pt-5 tablet:border-l tablet:border-t-0 tablet:pl-8 tablet:pt-0">
          <TypeCardBody :profile="sample" />
        </div>
      </div>
      <p class="mt-3 fineprint">
        类型介绍仅供参考；真实报告以四个维度各自的结果为主，未定的维度不套用类型描述。
      </p>
    </section>

    </PhoneFold>

    <!-- ══ 常见问题 ════════════════════════════════════════════════════ -->
    <section class="mt-12 laptop:mt-16">
      <h2 class="section-title">常见问题</h2>
      <div class="mt-4 divide-y divide-line border-y border-line">
        <details v-for="item in visibleFaqs" :key="item.q" class="group py-3.5">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-ink"
          >
            {{ item.q }}
            <span class="shrink-0 text-ink-faint transition-transform group-open:rotate-45" aria-hidden="true">＋</span>
          </summary>
          <p class="mt-2 max-w-[46rem] prose-sm">{{ item.a }}</p>
        </details>
      </div>
      <button
        v-if="!showAllFaq && faqs.length > visibleFaqs.length"
        type="button"
        class="btn-ghost btn-sm mt-2 px-0 text-primary-600 hover:bg-transparent"
        @click="showAllFaq = true"
      >
        还有更多问题
      </button>
    </section>

    <!-- ══ 方法与隐私入口 ══════════════════════════════════════════════ -->
    <section class="mt-12 laptop:mt-16">
      <div class="notice-neutral flex flex-wrap items-center justify-between gap-3">
        <p class="text-[13.5px] leading-relaxed" data-unknown-note>
          分数怎么算、数据存在哪，见
          <RouterLink to="/about" class="link">方法与隐私</RouterLink>。
          <template v-if="resumeIsBigFive">选「说不好」表示这题没有作答，不计入有效题；它和「说不上符合或不符合」不是一回事。</template>
          <template v-else>标记「暂时无法判断」时可选的原因有：{{ Object.values(UNKNOWN_REASON_LABEL).join(' / ') }}。</template>
        </p>
      </div>
      <p class="mt-4 fineprint">
        结果仅供自我了解，不是心理诊断，也不用于招聘或晋升。
      </p>
      <details class="group mt-3 max-w-[34rem]">
        <summary
          class="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          {{ resumeIsBigFive ? resumeTitle : instrumentFacts.title }}：来源与许可
          <span class="transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <div class="notice-neutral mt-2 text-[12.5px] leading-relaxed" data-instrument-attribution>
          <template v-if="resumeIsBigFive">
            题目来自 IPIP-50（International Personality Item Pool，Goldberg Big-Five Factor Markers，公有领域）；中文题面与逐题解释是本仓库的改写稿。
          </template>
          <template v-else>
            {{ instrumentFacts.title }}的题目与报告文案为本项目自行撰写，没有照搬任何商业量表的题目。
          </template>
          本站<strong class="font-medium">不隶属</strong>任何商业人格测评机构，也不是任何机构的官方测评。
          它是一份参考测评，没有信度或效度证据，内容仍在内部审校中，不得用于诊断或选拔。
        </div>
      </details>
    </section>
      </div>
    </details>
  </PageContainer>
</template>
