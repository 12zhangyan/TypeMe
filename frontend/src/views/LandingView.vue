<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuizStore } from '@/stores/quiz'
import { POLE_META } from '@/domain/scoring'
import type { PoleMeta } from '@/domain/scoring'
import {
  instrumentHasTypeCode,
  packageDimensionOrder,
  poleTokensOf,
} from '@/domain/assessmentPackage'
import { fetchMeta } from '@/api/client'
import {
  FALLBACK_ASSESSMENT_PACKAGES,
  FALLBACK_ATTRIBUTION,
  FALLBACK_TYPE_PROFILES,
  DEFAULT_PACKAGE_ID,
} from '@/content/fallback'
import type { Attribution } from '@/domain/contentTypes'
import { UNKNOWN_REASON_LABEL } from '@/domain/answers'
import PageContainer from '@/components/PageContainer.vue'
import DimensionGlyph from '@/components/DimensionGlyph.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import TypeCardBody from '@/components/TypeCardBody.vue'
import { chineseNumeral } from '@/utils/cnNumber'

/**
 * 首页 —— `docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md` §3.1。
 *
 * 本轮的首屏变化：
 *   1. 主文案改成「了解你的偏好，也保留还不确定的部分。」，取消任何"保证测出真实类型"的暗示；
 *   2. 加一段**不计分的教学例子**，说明两端、中间档、以及「暂时无法判断」三个操作；
 *   3. 题目版本选择只列面向访客的两版，并给干净的版本名（维护用的包标题、
 *      修订号、draft/审校状态都不进界面）；
 *   4. 旧版 v2 记录可以显式载入为派生会话（沿用当时的题面 + 新解释政策），旧键保留。
 */
const quiz = useQuizStore()
const router = useRouter()

const attribution = ref<Attribution>(FALLBACK_ATTRIBUTION)
const showRestart = ref(false)
const restartTrigger = ref<HTMLElement | null>(null)
const starting = ref(false)
const ready = ref(false)
const migrateError = ref<string | null>(null)

/**
 * 首屏在内容包装载完成前也要说得出题数与维度：先用站点默认包的内置副本兜底，
 * 装载完成后一律以 `quiz.activePackage` 为准。
 */
const displayPackage = computed(
  () => quiz.activePackage ?? FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] ?? null,
)

const total = computed(() => quiz.total || displayPackage.value?.questionnaire.questionCount || 0)
const estimatedMinutes = computed(() => quiz.activePackage?.estimatedMinutes ?? 5)
const processed = computed(() => quiz.processedCount)

/**
 * 会测到的维度 —— 顺序、数量、名称与两端记号全部来自**当前内容包**
 * （OEJTS 四维 EI/SN/TF/JP；IPIP 大五五维 E/A/C/ES/O）。
 *
 * OEJTS 的四维保留既有的展示文案（`POLE_META` 的名称与一句话说明），
 * 换量表时用内容包自己的维度名与两端标签，避免把「四维」写死在首页。
 * 计数文案统一走 `utils/cnNumber`（结果页与分享图用的是同一份）。
 */
const dimensions = computed(() => {
  const pkg = displayPackage.value
  if (!pkg) return []
  return packageDimensionOrder(pkg).map((dimension) => {
    const copy = pkg.dimensionCopy[dimension]
    const meta: PoleMeta | undefined = POLE_META[dimension]
    const poles = poleTokensOf(pkg, dimension)
    return {
      dimension,
      label: meta ? `${meta.negativePole} – ${meta.positivePole}` : `${poles.low} – ${poles.high}`,
      name: meta?.name ?? copy.name,
      hint: meta?.hint ?? `${copy.negative.label} / ${copy.positive.label}`,
      low: poles.low,
      high: poles.high,
    }
  })
})

/** 首屏抽象图形：轨道数量与名称同样跟当前内容包走（OEJTS 四条 / IPIP 五条）。 */
const glyphTracks = computed(() =>
  dimensions.value.map((item) => ({
    dimension: item.dimension,
    name: item.name,
    low: item.low,
    high: item.high,
  })),
)

const dimensionCountLabel = computed(() => chineseNumeral(dimensions.value.length))

/** 当前量表是否产出类型码（决定类型示例卡、署名与免责声明的写法）。 */
const hasTypeCode = computed(() =>
  displayPackage.value ? instrumentHasTypeCode(displayPackage.value) : true,
)

/**
 * 署名一律取**当前内容包**的 attribution：
 * OEJTS 是 CC BY-NC-SA 4.0（署名 + 非商业），IPIP 是公有领域（允许商用）。
 * `fetchMeta()` 的站点署名只在内容包还没装载时兜底。
 */
const activeAttribution = computed(
  () => displayPackage.value?.attribution ?? attribution.value,
)

/**
 * 首页可选的题目版本（面向访客的两版）。
 *
 * 版本名在这里给，而不是直接用内容包里的 `title`：包标题是维护用的内部命名
 * （「候选修订稿」「审校候选题面·本地试用」），不该出现在访客界面上。
 * **内容包本身没有被改动**：内部那版审校候选仍登记在注册表里（老记录仍能打开），
 * 只是不再作为入口列出来。
 */
const PACKAGE_LABELS: Record<string, string> = {
  'ipip50-zh1': '大五人格 50 题',
  'oejts32-zh1-report2': '快速版 32 题',
}
const VISIBLE_PACKAGE_IDS = ['ipip50-zh1', 'oejts32-zh1-report2']

const packageOptions = computed(() =>
  VISIBLE_PACKAGE_IDS.flatMap((id) => {
    const pkg = FALLBACK_ASSESSMENT_PACKAGES[id]
    if (!pkg) return []
    return [
      {
        id: pkg.packageId,
        title: PACKAGE_LABELS[pkg.packageId] ?? pkg.title,
        dimensions: chineseNumeral(packageDimensionOrder(pkg).length),
        questions: pkg.questionnaire.questionCount,
      },
    ]
  }),
)
const selectedPackageId = ref(DEFAULT_PACKAGE_ID)
const versionLocked = computed(() => quiz.hasProgress)
const switching = ref(false)

watch(
  () => quiz.packageId,
  (id) => {
    if (id) selectedPackageId.value = id
  },
  { immediate: true },
)

async function choosePackage(id: string) {
  if (id === quiz.packageId || versionLocked.value || switching.value) return
  switching.value = true
  try {
    await quiz.selectPackage(id)
  } finally {
    switching.value = false
  }
}

/** 草稿：有作答但还没处理完 */
const hasDraft = computed(() => quiz.hasProgress && !quiz.isProcessed)
/** 完整记录：32 题都处理过（可以直接查看上次报告） */
const hasFinished = computed(() => quiz.isProcessed)

/** 结果示例卡只对**产出类型码**的量表有意义（IPIP 大五没有四字母类型）。 */
const sample = computed(() =>
  displayPackage.value && instrumentHasTypeCode(displayPackage.value)
    ? FALLBACK_TYPE_PROFILES['INFP'] ?? null
    : null,
)

/**
 * 不计分的教学例子。
 *
 * 前两条必须跟着**作答格式**走：OEJTS 是「一对相反描述里选位置」，
 * IPIP 是「一句自我描述选贴切度」。把双极的「左边是 1、右边是 5」留在
 * 大五首页上，等于用另一份量表的话教用户答题。
 */
const TEACHING_EXAMPLE = computed(() =>
  hasTypeCode.value
    ? [
        '两边都读完：左边是 1，右边是 5。',
        '3 表示理解之后觉得两侧差不多符合，不代表没看懂。',
        '不确定该怎么理解、两边都不适用，或没有相关经历，点「暂时无法判断」。',
        '实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。',
      ]
    : [
        '每题是一句自我描述：1 表示非常不贴切，5 表示非常贴切。',
        '3 表示「说不上贴切」，既不算贴切也不算不贴切，不代表没看懂。',
        '不确定该怎么理解、这句话不适用，或没有相关经历，点「暂时无法判断」。',
        '按通常情况下的真实感受选，不要为了选一个“好性格”而选答案。',
      ],
)

const faqs = computed(() => [
  {
    q: '看不懂题目怎么办？',
    a: '每题下面都有「这题是什么意思？」，点开可以看这条题的短释义，展开不会改变你的答案。如果读完仍然说不清、这句话不适用或没有相关经历，可以点「暂时无法判断」。',
  },
  {
    q: '选「暂时无法判断」会怎样？',
    a: '它和「两边相近」是两件事：不会被算成 3 分，也不会被平均填充。相关维度会显示“信息不足”，不计算分数；其余维度照常给出结果，报告会明确写出哪些维度暂时没有结论。',
  },
  {
    q: '结果会不会一直固定不变？',
    a: hasTypeCode.value
      ? '不会。四个维度是连续分数，靠近中点时，换个时间或状态作答就可能落到另一侧。如果四个维度没有都达到展示条件，完整类型会留空，而不是给一个默认类型。'
      : '不会。五个维度各自是连续分数，靠近中点时，换个时间或状态作答就可能落到另一侧。达不到展示条件的维度只会写「两侧相近」或「信息不足」，不会硬给一个方向。',
  },
  {
    q: '我的答案会上传吗？',
    a: '不会。题目答案、帮助文字与计分都在你的浏览器里完成，没有提交答案的接口，也没有账号、统计脚本或第三方分析。',
  },
  {
    q: '测到一半关掉页面怎么办？',
    a: `进度保存在这台设备的浏览器里，回来点「继续测试」会回到第 ${
      processed.value + 1
    } 题附近；也可以在答题卡里回改任意一题。清除浏览器数据后就没了。`,
  },
])

const VALUES = computed(() =>
  hasTypeCode.value
    ? [
        {
          mark: '01',
          title: '四个维度的结果，而不是一个默认类型',
          body: '每一维分别给出信息不足、两侧相近、略偏、偏向四种状态。四维都达到展示条件时才拼出参考组合，否则完整类型为空。',
        },
        {
          mark: '02',
          title: '看得懂、答得出的过程',
          body: '每题有「这题是什么意思？」的短释义，也有独立的「暂时无法判断」。看不懂或没有相关经历时，不必猜一个数字。',
        },
        {
          mark: '03',
          title: '被答案支持的内容',
          body: '解释与建议只来自你真正作答的维度；不确定的维度给的是观察行为，不是某一类型的优势判断。',
        },
      ]
    : [
        {
          mark: '01',
          title: '五个维度各自的结果，而不是一个标签',
          body: '每一维分别给出信息不足、两侧相近、略偏、偏向四种状态；有方向的维度给方向，没有的就说没有，不把五个维度拼成一个人格标签。',
        },
        {
          mark: '02',
          title: '看得懂、答得出的过程',
          body: '每题有「这题是什么意思？」的短释义，也有独立的「暂时无法判断」。看不懂或没有相关经历时，不必猜一个数字。',
        },
        {
          mark: '03',
          title: '被答案支持的内容',
          body: '解释与建议只来自你真正作答的维度；不确定的维度给的是观察行为，不是某一端的优势判断。',
        },
      ],
)

const showAllFaq = ref(false)
const visibleFaqs = computed(() => (showAllFaq.value ? faqs.value : faqs.value.slice(0, 3)))

onMounted(async () => {
  void fetchMeta()
    .then((resolved) => {
      attribution.value = resolved.data.attribution
    })
    .catch(() => {
      /* 保留内置署名 */
    })
  if (!quiz.activePackage) await quiz.load()
  ready.value = true
})

function openRestart(trigger: Event) {
  restartTrigger.value = (trigger.currentTarget as HTMLElement) ?? null
  showRestart.value = true
}

function cancelRestart() {
  showRestart.value = false
  restartTrigger.value?.focus?.()
}

/** 确认重新开始：替换本机保留的上次作答（旧版记录保留，除非用户另行清除）。 */
function confirmRestart() {
  showRestart.value = false
  beginFresh()
}

function beginFresh() {
  if (starting.value) return
  starting.value = true
  quiz.start()
  void router.push({ name: 'quiz' })
}

function resume() {
  void router.push({ name: 'quiz' })
}

function viewResult() {
  void router.push({ name: 'result' })
}

/** 载入旧版 v2 记录为派生会话：用当时的题面 + 新的解释政策。 */
function migrateLegacyV2() {
  migrateError.value = null
  const ok = quiz.migrateLegacyV2()
  if (!ok) {
    migrateError.value = '这份作答无法按当时的题目打开。原记录已经保留，你也可以直接开始新的一次。'
    return
  }
  void router.push({ name: quiz.isProcessed ? 'result' : 'quiz' })
}
</script>

<template>
  <PageContainer page="home">
    <!-- ── Hero ──────────────────────────────────────────────────────── -->
    <section class="grid gap-8 laptop:grid-cols-[minmax(0,1fr)_26rem] laptop:items-start laptop:gap-12">
      <div class="animate-fade-rise">
        <p class="section-kicker">
          <template v-if="hasTypeCode">
            {{ dimensionCountLabel }}维人格倾向自测 · {{ total }} 题 · 约 {{ estimatedMinutes }} 分钟
          </template>
          <template v-else>
            大五人格倾向自测 · {{ total }} 题 · 约 {{ estimatedMinutes }} 分钟
          </template>
        </p>
        <h1
          class="mt-3 font-display text-[30px] font-bold leading-[1.25] tracking-tight text-ink tablet:text-[38px] laptop:text-[48px] desktop:text-[52px]"
        >
          了解你的偏好，<br class="hidden tablet:inline" />也保留还不确定的部分。
        </h1>
        <p class="mt-4 max-w-[34rem] prose-cn">
          {{ total }} 组日常描述。按通常情况下的真实感受选择，没有理想答案。不理解或缺少经历时可以标记
          「暂时无法判断」。
        </p>

        <ul class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-ink-soft">
          <li class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden="true" />
            <span><strong class="font-semibold text-ink">{{ total }} 道题</strong></span>
          </li>
          <li class="text-line-strong" aria-hidden="true">·</li>
          <li>约 {{ estimatedMinutes }} 分钟</li>
          <li class="text-line-strong" aria-hidden="true">·</li>
          <li>免费 · 无需登录</li>
        </ul>

        <div class="mt-6 flex flex-col gap-2.5 tablet:flex-row tablet:items-center">
          <template v-if="!ready">
            <button type="button" class="btn-primary tablet:w-auto tablet:px-8" disabled>
              <span
                class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              正在准备题目
            </button>
          </template>
          <template v-else-if="hasFinished">
            <button type="button" class="btn-primary tablet:w-auto tablet:px-8" @click="viewResult">
              查看上次报告
            </button>
            <button type="button" class="btn-secondary tablet:w-auto" @click="openRestart">
              重新测试
            </button>
          </template>
          <template v-else-if="hasDraft">
            <button type="button" class="btn-primary tablet:w-auto tablet:px-8" @click="resume">
              继续测试 · 已处理 {{ processed }}/{{ total }}
            </button>
            <button type="button" class="btn-secondary tablet:w-auto" @click="openRestart">
              重新开始
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn-primary tablet:w-auto tablet:px-8"
              :disabled="starting || switching"
              @click="beginFresh"
            >
              开始测试
            </button>
          </template>
        </div>

        <p class="mt-3 text-[13.5px] text-ink-soft">
          实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。
        </p>

        <p v-if="quiz.storageUnavailable" class="notice-uncertain mt-4 max-w-[34rem] text-[13px] leading-relaxed" role="status">
          这台设备无法保存进度：本次仍可正常作答，但关闭或刷新后进度可能丢失。
        </p>
      </div>

      <div class="order-first laptop:order-none" aria-hidden="false">
        <div class="h-[120px] laptop:h-[360px]">
          <DimensionGlyph :compact="false" :tracks="glyphTracks" />
        </div>
      </div>
    </section>

    <!-- ── 开始前说明（不计分的教学例子） ───────────────────────────── -->
    <section class="mt-12 laptop:mt-16">
      <h2 class="section-title">开始前，先说清楚怎么答</h2>
      <ul class="mt-5 grid gap-4 tablet:grid-cols-2 tablet:gap-x-10">
        <li
          v-for="(line, index) in TEACHING_EXAMPLE"
          :key="index"
          class="flex gap-3 border-t border-line pt-3.5 text-[14.5px] leading-[1.7] text-ink-soft"
        >
          <span class="font-display text-[14px] font-bold text-accent-500" aria-hidden="true">
            {{ index + 1 }}
          </span>
          <span>{{ line }}</span>
        </li>
      </ul>
      <p class="mt-4 fineprint">
        上面的说明不计分，也不会收集任何个人资料。情境例子只用于解释题目，不限定整份量表的作答时间窗。
      </p>
    </section>

    <!-- ── 题目版本（两版，版本名干净） ───────────────────────────────── -->
    <section class="mt-12 laptop:mt-16">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="section-title">题目版本</h2>
        <p class="caption">
          两版的题目与说明各自成套；换一版就是换一套题，不会把两版的题目混在一起。
        </p>
      </div>

      <div class="mt-4 space-y-2">
        <label
          v-for="option in packageOptions"
          :key="option.id"
          class="flex cursor-pointer gap-3 rounded-question border px-4 py-3.5 transition-colors"
          :class="
            selectedPackageId === option.id
              ? 'border-primary-400 bg-primary-50'
              : 'border-line bg-surface'
          "
        >
          <input
            type="radio"
            name="content-version"
            class="mt-1"
            :value="option.id"
            :checked="selectedPackageId === option.id"
            :disabled="versionLocked || switching"
            @change="choosePackage(option.id)"
          />
          <span class="min-w-0">
            <span class="flex flex-wrap items-baseline gap-2">
              <span class="text-[14.5px] font-semibold text-ink">{{ option.title }}</span>
              <span class="rounded-full bg-paper-soft px-2 py-[1px] text-[11.5px] text-ink-soft"
                >{{ option.dimensions }}个维度 · {{ option.questions }} 题</span
              >
            </span>
          </span>
        </label>
      </div>

      <p v-if="versionLocked" class="mt-2 text-[13px] leading-relaxed text-ink-soft">
        当前已有作答记录，因此不能在本次会话中途换版本。要换版本请先重新测试。
      </p>
    </section>

    <!-- ── 这台设备上更早保存的作答（按当时的题目打开，或忽略） ────────── -->
    <section v-if="quiz.legacyV2 || quiz.legacyV1" class="mt-12 laptop:mt-16">
      <h2 class="section-title">这台设备上有更早保存的作答</h2>
      <div v-if="quiz.legacyV2" class="mt-4 rounded-question border border-line bg-surface px-4 py-4">
        <p class="text-[14.5px] font-semibold text-ink">
          有一份 {{ Object.keys(quiz.legacyV2.answers).length }} 题的作答
        </p>
        <p class="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
          它用的是当时的题目，所以不会被套到现在的题目上，也不会被自动删除。
          你可以按当时的题目打开它，或直接开始新的一次。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-secondary btn-sm" :disabled="quiz.hasProgress" @click="migrateLegacyV2">
            按当时的题目打开
          </button>
          <RouterLink to="/about#records" class="btn-ghost btn-sm text-primary-600">查看本地记录</RouterLink>
        </div>
        <p v-if="migrateError" class="notice-neutral mt-3 text-[13px] leading-relaxed" role="alert">
          {{ migrateError }}
        </p>
      </div>
      <div v-if="quiz.legacyV1" class="mt-3 rounded-question border border-line bg-surface px-4 py-4">
        <p class="text-[14.5px] font-semibold text-ink">
          还有一份更早的作答（{{ quiz.legacyV1.answeredCount }} 题）
        </p>
        <p class="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
          无法确认它当时的题目与现在是否一致，所以不会自动套用，也不会被自动删除。
          你可以在「方法与隐私 → 本地记录」里清除它。
        </p>
      </div>
    </section>

    <!-- ── 你会得到什么 ──────────────────────────────────────────────── -->
    <section class="mt-12 laptop:mt-16">
      <h2 class="section-title">你会得到什么</h2>
      <ul class="mt-5 grid gap-5 tablet:grid-cols-3 tablet:gap-8">
        <li
          v-for="item in VALUES"
          :key="item.title"
          class="flex gap-3.5 border-t border-line pt-4 tablet:flex-col tablet:gap-0"
        >
          <span
            class="font-display text-[15px] font-bold leading-none text-accent-500 tablet:mb-2 tablet:block"
            aria-hidden="true"
            >{{ item.mark }}</span
          >
          <div>
            <h3 class="text-[16px] font-semibold text-ink">{{ item.title }}</h3>
            <p class="mt-1.5 prose-sm">{{ item.body }}</p>
          </div>
        </li>
      </ul>
    </section>

    <!-- ── 会测到的维度（跟着当前内容包：OEJTS 四维 / IPIP 五维） ─────── -->
    <section class="mt-12 laptop:mt-16">
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

    <!-- ── 结果示例卡（明确标"示例"；只有产出类型码的量表才有） ────────── -->
    <section v-if="sample" data-result-example class="mt-12 laptop:mt-16">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="section-title">结果示例</h2>
        <p class="caption">
          下面是一份<strong class="font-semibold text-accent-500">示例</strong
          >，不是你的结果，也不代表任何真实作答。
        </p>
      </div>
      <div class="mt-5 overflow-hidden rounded-cover border border-line bg-surface">
        <div class="bg-primary-600 px-5 py-6 text-white tablet:px-8 tablet:py-7">
          <p class="text-[12.5px] text-primary-100">示例：本次问卷参考组合（四维都达到展示条件时才有）</p>
          <p
            class="mt-1 font-display text-[52px] font-bold leading-none tracking-[0.08em] tablet:text-[64px]"
          >
            INFP
          </p>
          <p class="mt-2 text-[16px] font-semibold tablet:text-[18px]">{{ sample.nameCn }}</p>
          <p class="mt-1.5 max-w-[42rem] text-[14px] leading-relaxed text-primary-100">
            {{ sample.tagline }}
          </p>
        </div>
        <div class="grid gap-5 px-5 py-6 tablet:grid-cols-2 tablet:px-8 tablet:gap-8">
          <TypeCardBody :profile="sample" />
        </div>
      </div>
      <p class="mt-3 fineprint">
        类型介绍属于参考阅读；真实报告以四个维度各自的结果为主，未定的维度不会套用任何类型专属描述。
      </p>
    </section>

    <!-- ── FAQ ───────────────────────────────────────────────────────── -->
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
        v-if="!showAllFaq"
        type="button"
        class="btn-ghost btn-sm mt-2 px-0 text-primary-600 hover:bg-transparent"
        @click="showAllFaq = true"
      >
        还有更多问题
      </button>
    </section>

    <!-- ── 方法与隐私入口 ─────────────────────────────────────────────── -->
    <section class="mt-12 laptop:mt-16">
      <div class="notice-neutral flex flex-wrap items-center justify-between gap-3">
        <p class="text-[13.5px] leading-relaxed">
          想知道分数怎么算、门槛是怎么定的、回答保存在哪，可以读
          <RouterLink to="/about" class="link">方法与隐私</RouterLink>。
          标记「暂时无法判断」时可选的原因有：{{ Object.values(UNKNOWN_REASON_LABEL).join(' / ') }}。
        </p>
        <RouterLink to="/about#records" class="btn-ghost btn-sm text-primary-600"
          >本地记录与清除</RouterLink
        >
      </div>
      <p class="mt-4 fineprint">
        结果仅供自我了解，不是心理诊断，也不用于招聘或晋升。
      </p>
      <details class="group mt-3 max-w-[34rem]">
        <summary
          class="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          <template v-if="hasTypeCode">基于 OEJTS 1.2，非官方 MBTI 测验。</template>
          <template v-else>基于 IPIP 公有领域量表（大五），非官方测评。</template>
          <span class="underline decoration-dotted underline-offset-2">来源与许可</span>
          <span class="transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <div class="notice-neutral mt-2 text-[12.5px] leading-relaxed">
          题目取自 {{ activeAttribution.source }}，作者 {{ activeAttribution.author }}，来自
          <a
            :href="activeAttribution.url"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="link link-external"
            >{{ activeAttribution.source }}</a
          >，依
          <a
            :href="activeAttribution.licenseUrl"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="link link-external"
            >{{ activeAttribution.license }}</a
          >
          使用。
          <template v-if="hasTypeCode">
            本项目做了中文本地化改写，非商业用途，且
            <strong class="font-medium">未获得</strong> Myers &amp; Briggs 相关机构的授权或背书。
          </template>
          <template v-else>
            IPIP 量表属<strong class="font-medium">公有领域</strong>，允许自由使用（含商业用途）。
            中文题面由本项目自行撰写；本站不隶属任何商业人格测评机构，也不是任何机构的官方测评。
          </template>
        </div>
      </details>
    </section>

    <ConfirmDialog
      :open="showRestart"
      title="重新开始会替换这台设备上保留的上次作答，是否继续？"
      description="替换后无法恢复。更早保存的作答不会被自动删除，可以稍后单独清除。"
      confirm-label="重新开始"
      cancel-label="保留记录"
      danger
      @confirm="confirmRestart"
      @cancel="cancelRestart"
    />
  </PageContainer>
</template>
