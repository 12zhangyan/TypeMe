<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuizStore } from '@/stores/quiz'
import {
  instrumentHasTypeCode,
  packageDimensionOrder,
  packageFormat,
  responseAnchorsOf,
} from '@/domain/assessmentPackage'
import { ANSWER_CAPTIONS } from '@/domain/answers'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES, FALLBACK_ATTRIBUTION } from '@/content/fallback'
import PageContainer from '@/components/PageContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

/**
 * 方法与隐私 —— `docs/2026-09-15/...重构开发文档.md` §11.3。
 *
 * 结构固定为四部分（可查证的来源 + 容易理解的说明）：
 *   1 如何作答   2 如何理解结果   3 来源与限制   4 本地记录
 *
 * 部署版不再向访客展示维护细节：内容包 ID、内容状态、修订号、本地键名、
 * 旧版记录的技术处置、接口/内置副本这类字眼都撤掉了（细节仍在控制台与仓库文档里）。
 * 留下的是用户真正需要知道的三件事：怎么答、怎么理解、东西存在哪。
 *
 * 本页同时承担"本地记录管理"：说明保存了什么、保存在哪、保留范围，并提供
 * **清除本地记录**按钮（只删 TypeMe 自己的键，不执行 localStorage.clear()）。
 */
const quiz = useQuizStore()
const showClear = ref(false)
const cleared = ref(false)

/** 署名一律取当前内容包；内容包还没装载时退回默认包（不清空署名义务）。 */
const attribution = computed(
  () =>
    quiz.activePackage?.attribution ??
    FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]?.attribution ??
    FALLBACK_ATTRIBUTION,
)
const savedCount = computed(() => quiz.processedCount)
const hasSaved = computed(() => quiz.hasProgress)

/* ── 当前量表（站点默认是 IPIP-50 大五，OEJTS-32 作为可选旧版本保留）─────────
 * 方法页过去整页写死 OEJTS：四字母、四维、S–N 最难测、CC BY-NC-SA。
 * 这些句子对大五来说是**错话**（大五没有类型码，而且 IPIP 属公有领域），
 * 所以每一处都改成由当前内容包 + 仪器档案推导。
 */
const activePackage = computed(() => quiz.activePackage)
const hasTypeCode = computed(() =>
  activePackage.value ? instrumentHasTypeCode(activePackage.value) : false,
)
const dimensionCount = computed(() =>
  activePackage.value ? packageDimensionOrder(activePackage.value).length : 5,
)
/** 署名一律取**当前内容包**的 attribution：OEJTS 是 CC BY-NC-SA，IPIP 是公有领域。 */
const activeAttribution = attribution
const answerFormat = computed(() =>
  activePackage.value ? packageFormat(activePackage.value) : 'agreement',
)
const anchors = computed(() => {
  const fromPackage = activePackage.value ? responseAnchorsOf(activePackage.value) : null
  if (fromPackage) return fromPackage
  return [1, 2, 3, 4, 5].map((value) => ANSWER_CAPTIONS[value])
})
const totalQuestions = computed(
  () => quiz.total || activePackage.value?.questionnaire.questionCount || 0,
)
/** 「略偏」这一档的上界由内容包的解释政策决定（OEJTS 1–4；IPIP 1–5）。 */
const slightBandMax = computed(() => {
  const policy = activePackage.value?.interpretation
  return policy ? Math.max(0, policy.typeMinDistance - 1) : 4
})
const markedDistance = computed(() => activePackage.value?.interpretation.markedDistance ?? 9)

const sections = [
  { id: 'how', label: '如何作答' },
  { id: 'result', label: '如何理解结果' },
  { id: 'source', label: '来源与限制' },
  { id: 'records', label: '本地记录' },
]

onMounted(() => {
  if (!quiz.activePackage) void quiz.load()
  quiz.detectLegacy()
})

function clearRecords() {
  showClear.value = false
  // 只删本应用自己的键：v3 会话 + 旧版 v1/v2 记录 + 内容版本偏好
  quiz.clearSession()
  quiz.dropLegacyV1()
  quiz.dropLegacyV2()
  quiz.clearPreferredPackage()
  cleared.value = true
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <PageContainer page="article">
    <header>
      <p class="section-kicker">方法与隐私</p>
      <h1
        class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[34px]"
      >
        题目从哪来，分数怎么算，哪些结论不该下
      </h1>
      <p class="mt-3 prose-cn">
        这一页不打算说服你相信结果。它只把可查证的来源、可复算的算法，以及我们明确做不到的事情
        写清楚，剩下的判断留给你。
      </p>

      <!-- 页内锚点：可查证的来源和容易理解的说明 -->
      <nav class="mt-5 flex flex-wrap gap-1.5" aria-label="页内章节">
        <button
          v-for="section in sections"
          :key="section.id"
          type="button"
          class="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-primary-400 hover:text-primary-700"
          @click="scrollTo(section.id)"
        >
          {{ section.label }}
        </button>
      </nav>
    </header>

    <!-- 1 如何作答 -->
    <section id="how" class="mt-10 scroll-mt-20">
      <h2 class="section-title">如何作答</h2>
      <ul class="mt-4 space-y-2.5 prose-cn">
        <li class="list-dot">
          想<strong class="font-medium text-ink">平常状态</strong>下的自己，不要想"应该成为什么样"。
          状态特别的日子（刚吵完架、刚熬夜）建议换个时间再测。
        </li>
        <li class="list-dot">
          <template v-if="answerFormat === 'agreement'">
            每题给出一句<strong class="font-medium text-ink">自我描述</strong>，请按它对你平常状态的贴切程度选择：
            {{ anchors.join('、') }}。左边永远对应 1（最不贴切），右边永远对应 5（最贴切），
            两个端点的顺序不会因为美观而调换。
          </template>
          <template v-else>
            每题给出一对相反的描述，位置是连续的：明显偏左、有些偏左、两边相近、有些偏右、明显偏右。
            左边永远对应 1，右边永远对应 5，两个端点的顺序不会因为美观而调换。
          </template>
        </li>
        <li class="list-dot">
          中间那档（{{ anchors[2] }}）是<strong class="font-medium text-ink">真实答案</strong>，不是"没想好"。
          但五个位置都不代表"更理想"，只代表更接近哪一侧。
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">看不懂、没有相关经历、两边都不适用时，</strong>
          可以点题目卡里的「这题是什么意思？」读短释义，或直接标记
          <strong class="font-medium text-ink">「暂时无法判断」</strong>。它不是错误，也不会被算成 3 分
          ——相关维度会显示"信息不足"，其余维度照常给结果。
        </li>
        <li class="list-dot">
          没有标准答案，也没有时间限制。答错位置随时可以回改，答题卡能直接跳到任意一题。
        </li>
      </ul>
    </section>

    <!-- 2 如何理解结果 -->
    <section id="result" class="mt-10 scroll-mt-20">
      <h2 class="section-title">如何理解结果</h2>
      <ul class="mt-4 space-y-2.5 prose-cn">
        <li class="list-dot">
          <strong class="font-medium text-ink">这是一次倾向，不是一个身份。</strong>
          <template v-if="hasTypeCode">
            {{ dimensionCount }} 个维度都是连续分数，四字母只是把连续分数切成四段之后的一种叫法。
          </template>
          <template v-else>
            {{ dimensionCount }} 个维度都是连续分数。大五量表<strong class="font-medium text-ink"
              >没有类型码</strong
            >：它给出每个维度各自的方向，报告不会把几个字母拼成一个"类型"。
          </template>
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">允许"未定"。</strong>
          每个维度会分别给出四种状态：信息不足（缺有效数字答案，不计算分数）、本次两侧相近
          （没有主导侧）、本次略偏某侧（建议继续观察）、本次回答偏向某侧（可用于参考组合）。
          <template v-if="hasTypeCode">
            {{ dimensionCount }} 个维度都达到展示条件时才会拼出四字母，否则完整类型为空 ——
            不会退回某个默认类型。
          </template>
          <template v-else>
            {{ dimensionCount }} 个维度都达到展示条件时，报告才会给出完整的方向总结；否则只展示
            达到条件的那些维度，其余维度保留未定 —— 不会用一个默认类型补齐。
          </template>
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">越靠近中点，越不该当成确定结论。</strong>
          距中点 1–{{ slightBandMax }} 分的维度只作观察方向；|偏移| ≥ {{ markedDistance }} 分才算"偏向"。
          这份门槛是我们为了给出方向而定的一条规则，
          <strong class="font-medium text-ink">不是统计置信阈值</strong>，也没有证据证明它提升测量准确率。
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">不给人群百分位。</strong>
          我们没有本土常模样本，所以不会说"你比多少人更外向"。位置与分数只表示偏离中点的程度，
          不是你在人群里的位置。
        </li>
        <li v-if="hasTypeCode" class="list-dot">
          <strong class="font-medium text-ink">S–N 维度本身就难测准。</strong>
          与 I–E、F–T、J–P 相比，这一维在不同研究里的区分度一直偏低。如果它压线，当参考方向就好。
        </li>
        <li v-else class="list-dot">
          <strong class="font-medium text-ink">大五的五个维度各自独立，不要当成五种"性格类型"。</strong>
          它们描述的是可以分开看待的五个方面；某一维偏向哪一侧，不决定其余四维，也不构成一个整体标签。
        </li>
      </ul>
    </section>

    <!-- 3 来源与限制 -->
    <section id="source" class="mt-10 scroll-mt-20">
      <h2 class="section-title">来源与限制</h2>

      <div class="mt-4 space-y-3 prose-cn">
        <p>
          本测评当前使用的量表题目取自
          <a
            :href="activeAttribution.url"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="link link-external"
            >{{ activeAttribution.source }}</a
          >，作者
          <strong class="font-semibold text-ink">{{ activeAttribution.author }}</strong
          >，依据
          <a
            :href="activeAttribution.licenseUrl"
            target="_blank"
            rel="noopener noreferrer nofollow"
            class="link link-external"
            >{{ activeAttribution.license }}</a
          >
          使用。
          <template v-if="hasTypeCode">
            本项目对其进行了中文本地化改写，改写后的中文题目同样以
            {{ activeAttribution.license }} 发布。
          </template>
          <template v-else>
            本项目自行撰写了简体中文题面，题号与正负键值严格照官方键值表，未改动任何一项的计分方向。
          </template>
        </p>
        <p v-if="hasTypeCode">
          本项目<strong class="font-semibold text-ink">非商业用途</strong>，不含任何广告、付费或赞助；
          也<strong class="font-semibold text-ink">未获得</strong> Myers &amp; Briggs Foundation、
          The Myers-Briggs Company 或 CPP, Inc. 的任何授权或背书。这不是 MBTI 官方测评。
        </p>
        <p v-else>
          IPIP 量表<strong class="font-semibold text-ink">属公有领域（public domain）</strong>，
          官方声明允许包括商业用途在内的自由使用，不需要另行申请授权。本站的中文题面与各维文案由本项目
          自行撰写，<strong class="font-semibold text-ink">未经 IPIP 官方校验</strong>；
          IPIP 也明确说明其收录的各种语言译本均未经他们验证。本站与任何商业人格测评机构没有关系，
          这不是 MBTI 官方测评，也不是任何机构的官方大五测评。
        </p>
        <p v-if="hasTypeCode" class="rounded-control bg-paper-soft px-4 py-3 text-[14px] leading-relaxed">
          OEJTS 官方声明：<em class="not-italic text-ink-soft"
            >“The OEJTS come with no guarantees of reliability or accuracy of any kind.”</em
          >
        </p>
        <p v-else class="rounded-control bg-paper-soft px-4 py-3 text-[14px] leading-relaxed">
          IPIP 官方说明：这些量表条目属于公有领域，可用于研究、教学与商业用途；但
          <em class="not-italic text-ink-soft"
            >IPIP 不为其收录的译本提供任何信度或效度验证</em
          >。
        </p>
        <p>
          <strong class="font-medium text-ink">中文题目未做信效度验证。</strong>
          <template v-if="hasTypeCode">
            译文的信度、效度没有经过中文样本检验；四字母的方向与正文内容经过人工核对，
            但这不等于心理测量学意义上的验证。
          </template>
          <template v-else>
            中文题面的可读性经过人工核对与逐题释义，但没有经过中文样本的信效度检验；
            五个维度的方向与正文内容经过人工核对，但这不等于心理测量学意义上的验证。
          </template>
        </p>
      </div>
    </section>

    <!-- 4 本地记录 -->
    <section id="records" class="mt-10 scroll-mt-20">
      <h2 class="section-title">本地记录</h2>

      <p class="mt-3 prose-cn">
        题目答案与计分在你的浏览器中处理。为了让你能接着上次继续，这台设备会保留最近一次作答，
        你可以随时清除。
      </p>

      <dl class="mt-4 divide-y divide-line border-y border-line text-[14px]">
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">保存了什么</dt>
          <dd class="text-ink-soft">
            这次用到的 {{ totalQuestions }} 道题、你的 {{ totalQuestions }} 个选择、当前答到哪一题，
            以及开始与更新时间。
            <strong class="font-medium text-ink">没有</strong>姓名、账号、设备标识或 IP。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">保存在哪</dt>
          <dd class="text-ink-soft">
            只写在这台设备的浏览器里，没有提交答案的接口，作答不会离开这台设备。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">保留多久</dt>
          <dd class="text-ink-soft">
            保留最近一次作答，直到你主动清除或确认重新测试。我们不设定时清理，也不会替你决定什么时候删。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">当前状态</dt>
          <dd class="text-ink-soft">
            <template v-if="hasSaved">
              已处理 {{ savedCount }} / {{ quiz.total }} 题（数字 {{ quiz.ratingCount }} · 待判断
              {{ quiz.unknownCount }}）
            </template>
            <template v-else-if="quiz.storageError">
              {{ quiz.storageError }}
            </template>
            <template v-else> 这台设备上目前没有保留作答记录。 </template>
          </dd>
        </div>
        <div v-if="quiz.legacyV2 || quiz.legacyV1" class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">更早保存的作答</dt>
          <dd class="text-ink-soft">
            这台设备上还有
            <template v-if="quiz.legacyV2"
              >一份 {{ Object.keys(quiz.legacyV2.answers).length }} 题的作答</template
            ><template v-if="quiz.legacyV2 && quiz.legacyV1">，以及</template
            ><template v-if="quiz.legacyV1"
              >一份更早的作答（{{ quiz.legacyV1.answeredCount }} 题）</template
            >。它们用的是当时的题目，所以不会被套到现在的题目上，也不会被自动删除；
            可以在首页按当时的题目打开，或者在这里一并清除。
          </dd>
        </div>
      </dl>

      <div class="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-secondary"
          :disabled="!hasSaved && !quiz.legacyV1 && !quiz.legacyV2"
          @click="showClear = true"
        >
          清除本地记录
        </button>
        <RouterLink to="/" class="btn-ghost btn-sm text-primary-600">回到首页</RouterLink>
      </div>

      <p
        v-if="cleared"
        class="notice-info mt-3 text-[13.5px] leading-relaxed"
        role="status"
        aria-live="polite"
      >
        已清除本站在这台设备上保存的记录（只删除 TypeMe 自己的记录，其它网站的数据不受影响）。
      </p>
    </section>

    <!-- 全站不做的事 -->
    <section class="mt-10 rounded-question border border-line bg-surface px-5 py-5">
      <h2 class="section-title">本站不做的事</h2>
      <ul class="mt-3 space-y-2 prose-sm">
        <li class="list-dot">不给「你在人群中排第几」——没有本土常模，给了就是编的。</li>
        <li class="list-dot">不做诊断、不涉及心理疾病，也不用于招聘、晋升或任何筛选。</li>
        <li class="list-dot">不做账号、不做排行、不做对比榜单，不收集任何个人信息。</li>
        <li class="list-dot">不设付费墙：结果页把该给的信息一次给完。</li>
      </ul>
    </section>

    <ConfirmDialog
      :open="showClear"
      title="清除本地记录会删掉这台设备上保存的本次作答，是否继续？"
      description="只删除 TypeMe 保存在这个浏览器里的记录，不会影响其它网站的数据。"
      confirm-label="清除记录"
      cancel-label="保留"
      danger
      @confirm="clearRecords"
      @cancel="showClear = false"
    />
  </PageContainer>
</template>
