<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { POLE_META } from '@/domain/scoring'
import { FALLBACK_TYPE_PROFILES } from '@/content/fallback'
import { UNKNOWN_REASON_LABEL } from '@/domain/answers'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import PageContainer from '@/components/PageContainer.vue'
import DimensionGlyph from '@/components/DimensionGlyph.vue'
import TypeCardBody from '@/components/TypeCardBody.vue'
import { chineseNumeral } from '@/utils/cnNumber'

/**
 * 首页 —— `docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md` §3.1。
 *
 * 本轮的首屏变化：
 *   1. 主文案改成「了解你的偏好，也保留还不确定的部分。」，取消任何"保证测出真实类型"的暗示；
 *   2. 加一段**不计分的教学例子**，说明两端、中间档、以及「暂时无法判断」三个操作。
 *
 * ## 首屏的量表口径来自新测自己（不是旧内容包）
 *
 * 主入口 `.btn-primary` 指向 `/assess`，跑的是 `typeme-jung48-zh-v1` 十六型量表。
 * 因此**首屏**的量表名、题数、时长与四个维度都取自 `GET /api/v3/catalog/current`
 * （`stores/instrumentV3.ts`）。过去这些值取自 `useQuizStore().activePackage`，
 * 于是按钮写「开始测评（50 题）」而点进去是 48 题主测的十六型测评
 * （`docs/2026-09-16/verification/browser-acceptance.md` 问题 1）。
 *
 * ## 首页已不再提供「旧版本测试」入口（2026-09-16 产品要求）
 *
 * 首页此前还有：旧引擎入口按钮组、两版题目版本单选、这台设备上更早作答的恢复区、
 * 「重新开始」确认框、以及旧内容包的来源与许可署名。这五块**已按产品要求整体移除**，
 * 连带它们专用的 `PACKAGE_LABELS` / `packageOptions` / `choosePackage` /
 * `selectedPackageLabel` / `hasDraft` / `hasFinished` / `migrateLegacyV2` 等一并删掉。
 *
 * ⚠️ **旧引擎本身没有被删**：题库、`stores/quiz.ts`、`/quiz`、`/result`、`/about`
 * 与已有旧作答记录全部原样保留，只是首页不再直达；旧站此前已有作答记录也没有被清理。
 *
 * ## 整页只描述一份量表（2026-09-16 修复）
 *
 * 页面下方的「会测到的N个维度」、教学例子、结果示例卡、FAQ 与「你会得到什么」
 * 此前仍读 `useQuizStore().activePackage`（站点默认的 IPIP-50 大五），于是首页出现
 * 「主测 48 题」配「会测到的五个维度 E/A/C/ES/O」、教学例子讲单句贴切度、
 * 结果示例卡被隐藏（大五没有类型码）这类自相矛盾的区块。
 * 现在整页唯一的口径来源是 {@link instrumentFacts}（`GET /api/v3/catalog/current`，
 * 读不到时用 `stores/instrumentV3.ts` 里的新测内置口径），旧内容包不再参与首页渲染。
 */
const instrument = useInstrumentV3Store()
const router = useRouter()
const auth = useAuthStore()

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
 * 新测的对外口径 —— 整页唯一的量表口径：量表名、主测题数、题库题数、预计时长与四个维度。
 *
 * 能连上目录时全部来自 `GET /api/v3/catalog/current`；未登录（该接口要求登录，
 * 实测返回 401）或离线时退回 store 里的**新测内置口径**（不是旧内容包）。
 */
const instrumentFacts = computed(() => instrument.facts)

/** 「约 8–12 分钟」——时长区间按主测题数换算（产品方案 §1：主测 48 题约 8–12 分钟）。 */
const minutesLabel = computed(
  () => `${instrumentFacts.value.minutesLow}–${instrumentFacts.value.minutesHigh}`,
)

/**
 * 会测到的维度 —— 数量、顺序、两端记号与维度名全部来自**首页主推的这份新测**
 * （`instrumentFacts.dimensions`，即 `GET /api/v3/catalog/current` 的 `dimensions`）。
 *
 * 一个维度的两面用 `POLE_META` 的极向字母表示（`I – E` 这类），一句话说明也取它；
 * 维度名用目录下发的名字（`item.name`，例如「信息关注」），不写死在本文件里。
 * 计数文案统一走 `utils/cnNumber`（结果页与分享图用的是同一份）。
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

/** 首屏抽象图形的轨道 —— 与上面的维度说明同源，画的都是主按钮点进去要答的那份量表。 */
const glyphTracks = computed(() => instrumentFacts.value.dimensions)

const dimensionCountLabel = computed(() => chineseNumeral(dimensions.value.length))

/**
 * 结果示例卡的样例档案。
 *
 * 首页主推的量表产出四字母类型码，所以示例卡**始终**渲染（不再有"某个内容包不产类型码
 * 就藏起来"的分支）。它是明确标注过的示例，不是任何人的真实结果。
 */
const sample = FALLBACK_TYPE_PROFILES['INFP'] ?? null

/**
 * 不计分的教学例子 —— 按新测实际的双极作答格式讲。
 *
 * 每题是一对相反描述，左边是 1、右边是 5；中间 3 是"两侧差不多"，
 * 另有独立的「暂时无法判断」。单句贴切度（「1 表示非常不贴切」）是另一份量表的口径，
 * 不再出现在首页。
 */
const TEACHING_EXAMPLE = computed(() => [
  '两边都读完：左边是 1，右边是 5。',
  '3 表示理解之后觉得两侧差不多符合，不代表没看懂。',
  '不确定该怎么理解、两边都不适用，或没有相关经历，点「暂时无法判断」。',
  '实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。',
])

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
    a: '不会。四个维度是连续分数，靠近中点时，换个时间或状态作答就可能落到另一侧。如果四个维度没有都达到展示条件，完整类型会留空，而不是给一个默认类型。',
  },
  {
    q: '我的答案会上传吗？',
    a: '会存在你的账号里。这样你换一台设备登录后能接着答，也能回看自己历次的报告。你不必为此作答之外的目的提供信息：报告只在你的账号里，没有统计脚本或第三方分析，随时可以整体导出或删除。',
  },
  {
    q: '测到一半关掉页面怎么办？',
    a: '登录后的作答存在你的账号里：换设备或换浏览器登录同一账号都能接着答，回来会停在你上次答到的位置附近，也可以用「上一题」回去改前面答过的题。',
  },
])

const VALUES = computed(() => [
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
])

const showAllFaq = ref(false)
const visibleFaqs = computed(() => (showAllFaq.value ? faqs.value : faqs.value.slice(0, 3)))

onMounted(() => {
  // 整页（首屏的量表名 / 题数 / 时长 / 维度说明）都取新测自己的对外口径。
  void instrument.load()
})
</script>

<template>
  <PageContainer page="home">
    <!-- ── Hero ──────────────────────────────────────────────────────── -->
    <section class="grid gap-8 laptop:grid-cols-[minmax(0,1fr)_26rem] laptop:items-start laptop:gap-12">
      <div class="animate-fade-rise">
        <p class="section-kicker" data-instrument-kicker>
          {{ instrumentFacts.title }} · 主测 {{ instrumentFacts.baseQuestions }} 题 · 约 {{ minutesLabel }} 分钟
        </p>
        <h1
          class="mt-3 font-display text-[30px] font-bold leading-[1.25] tracking-tight text-ink tablet:text-[38px] laptop:text-[48px] desktop:text-[52px]"
        >
          了解你的偏好，<br class="hidden tablet:inline" />也保留还不确定的部分。
        </h1>
        <p class="mt-4 max-w-[34rem] prose-cn">
          主测 {{ instrumentFacts.baseQuestions }} 组日常情境描述。按通常情况下的真实感受选择，
          没有理想答案。不理解或缺少经历时可以标记「暂时无法判断」。
        </p>

        <ul class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-ink-soft">
          <li class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-accent-400" aria-hidden="true" />
            <span><strong class="font-semibold text-ink">主测 {{ instrumentFacts.baseQuestions }} 道题</strong></span>
          </li>
          <li class="text-line-strong" aria-hidden="true">·</li>
          <li>约 {{ minutesLabel }} 分钟</li>
          <li class="text-line-strong" aria-hidden="true">·</li>
          <li>免费 · 需登录</li>
        </ul>

        <!--
          题量口径：主按钮点进去先答「主测」那一轮。题库总数与它的关系必须写清楚，
          否则紧挨着按钮放一个裸的「64 题」会让人以为要答 64 题。
        -->
        <p class="mt-3 max-w-[34rem] text-[13px] leading-relaxed text-ink-soft" data-instrument-scope>
          题量口径：题库共 {{ instrumentFacts.bankQuestions }} 题 = 主测 {{ instrumentFacts.baseQuestions }} 题 + 最多 {{ instrumentFacts.clarificationQuestions }} 道补充题。补充题只在你某一维两边差不多时才会出现，也可以跳过。
        </p>

        <div class="mt-6 flex flex-col gap-2.5 tablet:flex-row tablet:items-center">
          <!-- 主入口：新测（登录后跨设备继续、可回看历史报告） -->
          <RouterLink
            to="/assess"
            class="btn-primary tablet:w-auto tablet:px-8"
            data-primary-entry
          >
            开始测评（主测 {{ instrumentFacts.baseQuestions }} 题）
          </RouterLink>
          <RouterLink
            v-if="reportsReady && auth.isAuthenticated"
            to="/reports"
            class="btn-secondary tablet:w-auto"
          >
            历史报告
          </RouterLink>
          <RouterLink
            v-else-if="authRoutesReady"
            :to="{ name: 'login', query: { redirect: '/reports' } }"
            class="btn-secondary tablet:w-auto"
          >
            登录后看历史报告
          </RouterLink>
        </div>

        <p class="mt-3 text-[13.5px] leading-relaxed text-ink-soft" data-entry-note>
          登录后可以跨设备接着答，也能回看自己历次的报告；报告是参考测评，不是诊断。
        </p>

        <p class="mt-3 text-[13.5px] text-ink-soft">
          实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。
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

    <!-- ── 会测到的维度（跟着首页主推的这份新测：四维 EI/SN/TF/JP） ───── -->
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

    <!-- ── 结果示例卡（明确标"示例"；首页主推的量表产出四字母类型码） ────── -->
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
      </div>
      <p class="mt-4 fineprint">
        结果仅供自我了解，不是心理诊断，也不用于招聘或晋升。
      </p>
      <!--
        署名：描述**新测自己**。此前这里用的是旧引擎内容包的 attribution
        （`fetchMeta` 的 `/api/v1/meta`），于是十六型首页的页脚写着「基于 OEJTS 1.2 /
        基于 IPIP 公有领域量表（大五）」—— 又是一处"页面说的量表和实际入口不是同一份"。
        旧引擎的署名与许可仍在旧站自己那几页（`/quiz`、`/about`）里，不受影响。
      -->
      <details class="group mt-3 max-w-[34rem]">
        <summary
          class="inline-flex cursor-pointer list-none items-center gap-1 text-[12.5px] text-ink-faint transition-colors hover:text-ink-soft"
        >
          {{ instrumentFacts.title }}：来源与许可
          <span class="transition-transform group-open:rotate-180" aria-hidden="true">⌄</span>
        </summary>
        <div class="notice-neutral mt-2 text-[12.5px] leading-relaxed" data-instrument-attribution>
          {{ instrumentFacts.title }}的题目与报告文案为本项目自行撰写，没有照搬任何商业量表的题目。
          本站<strong class="font-medium">不隶属</strong>任何商业人格测评机构，也不是任何机构的官方测评。
          它是一份参考测评，没有信度或效度证据，内容仍在内部审校中，不得用于诊断或选拔。
        </div>
      </details>
    </section>
  </PageContainer>
</template>
