<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useQuizStore } from '@/stores/quiz'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import { POLE_META } from '@/domain/scoring'
import { dimensionCountPhrase } from '@/utils/cnNumber'
import PageContainer from '@/components/PageContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

/**
 * 方法与隐私 —— 描述的是**首页真正主推的那份测评**（`typeme-jung48-zh-v1`）。
 *
 * ## 2026-09-16：这一页此前整页写的是**旧引擎**的内容包
 *
 * 首页的「方法与隐私」入口说的是「想知道分数怎么算、门槛是怎么定的、回答保存在哪」，
 * 但本页过去由 `useQuizStore().activePackage` 驱动 —— 那是站点默认的 IPIP-50 大五。
 * 于是访客点进来读到「五个维度」「大五量表」「每题给出一句自我描述…非常不贴切」，
 * 没有一句在说他刚被邀请去答的那份量表（双极 1–5、四个维度、四字母参考组合）。
 *
 * 现在整页唯一的口径来源是 `useInstrumentV3Store().facts`
 * （`GET /api/v3/catalog/current`，读不到时用它自己的内置口径）：
 * 量表名、主测/题库题数、补充题上限、预计时长与四个维度全部来自那里；
 * 两端标记与一句话说明取 `POLE_META`，与 `LandingView.vue` 用的是同一份。
 *
 * ## 门槛：不再抄旧内容包的数字
 *
 * 旧版写死的「距中点 1–N 分」「|偏移| ≥ N 分」是**大五/OEJTS 的解释政策**，
 * 新测根本不用那套尺度 —— 它的方向由「每题带符号的贡献之和」的符号决定，
 * 「略偏」的门槛随该维可计分题数变化，数值属于量表自己的计分规则（评分政策），
 * 每份报告的「这份报告是怎么来的」一节会连同规则版本一起打印出来。
 * 访客在登录前读不到那条规则的数值，所以这里**只说规则的样子、不编一个数字**。
 *
 * ## 本地记录：仍然保留，但说清它是哪份问卷的记录
 *
 * 本页同时承担"本地记录管理"：`/quiz` 那套旧问卷的进度留在这台设备上，用户可以查看数量、
 * 一并清除（只删 TypeMe 自己的键，不执行 `localStorage.clear()`）。这一段读的是
 * `useQuizStore()` 的本地状态，与首页主推的新测评是两回事 —— 新测评（登录 + 账号）
 * 的数据在哪，写在上面的「新测的数据怎么存」一节。
 */
const quiz = useQuizStore()
const instrument = useInstrumentV3Store()
const showClear = ref(false)
const cleared = ref(false)

/** 新测的对外口径（量表名 / 题数 / 时长 / 四个维度）—— 与首页同一个来源。 */
const facts = computed(() => instrument.facts)
/** 「四个维度」这类计数文案统一走工具函数，不在这里拼字符串。 */
const dimensionPhrase = computed(() => dimensionCountPhrase(facts.value.dimensionCount))

/**
 * 会测到的维度：数量与顺序来自新测自己的口径，维度名取目录下发的名字，
 * 两端字母与一句话说明取 `POLE_META`（与首页「会测到的N个维度」同一份写法）。
 */
const dimensions = computed(() =>
  facts.value.dimensions.map((item) => {
    const meta = POLE_META[item.dimension]
    return {
      dimension: item.dimension,
      label: `${meta.negativePole} – ${meta.positivePole}`,
      name: item.name,
      hint: meta.hint,
    }
  }),
)

/* ── 本地记录（旧问卷的本地进度）─────────────────────────────────────────
 * 这一段说的是 `/quiz` 那套在本机计分的旧问卷：题数只能问旧引擎自己的 store。
 * 新测评不把作答留在这台设备上，所以这里不用 `facts` 的任何数字。
 */
const legacyTotal = computed(() => quiz.total)
const savedCount = computed(() => quiz.processedCount)
const hasSaved = computed(() => quiz.hasProgress)

const sections = [
  { id: 'how', label: '如何作答' },
  { id: 'dimensions', label: '会测到的维度' },
  { id: 'result', label: '如何理解结果' },
  { id: 'source', label: '来源与限制' },
  { id: 'data', label: '新测数据怎么存' },
  { id: 'records', label: '本地记录' },
]

onMounted(() => {
  // 本页正文的量表口径来自新测自己（与首页同源）。
  void instrument.load()
  // 本地记录那一段读的是旧问卷的本地进度：内容包没装载就先装载，并识别更早的作答。
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
        这一页说的就是首页那份<strong class="font-medium text-ink">{{ facts.title }}</strong
        >。它不打算说服你相信结果，只把可查证的来源、可复算的算法，以及我们明确做不到的事情
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

      <p class="mt-3 prose-cn" data-instrument-scope>
        主测 {{ facts.baseQuestions }} 题，题库共 {{ facts.bankQuestions }} 题 = 主测
        {{ facts.baseQuestions }} 题 + 最多 {{ facts.clarificationQuestions }} 道补充题，
        预计 {{ facts.minutesLow }}–{{ facts.minutesHigh }} 分钟。补充题只在某一维两边差不多时出现，
        也可以跳过。
      </p>

      <ul class="mt-4 space-y-2.5 prose-cn">
        <li class="list-dot">
          想<strong class="font-medium text-ink">平常状态</strong>下的自己，不要想"应该成为什么样"。
          状态特别的日子（刚吵完架、刚熬夜）建议换个时间再测。
        </li>
        <li class="list-dot" data-answer-format>
          每题给出一对<strong class="font-medium text-ink">相反的描述</strong>：两边都读完，再选自己更靠近哪一边，
          <strong class="font-medium text-ink">左边永远是 1，右边永远是 5</strong>。
          五个位置是连续的：明显偏左、有些偏左、两边相近、有些偏右、明显偏右，
          两个端点的顺序不会因为美观而调换。
        </li>
        <li class="list-dot">
          中间那一档（3）是<strong class="font-medium text-ink">真实答案</strong>，不是"没想好"。
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

    <!-- 2 会测到的维度 -->
    <section id="dimensions" class="mt-10 scroll-mt-20">
      <h2 class="section-title">会测到的{{ dimensionPhrase }}</h2>

      <p class="mt-3 prose-cn">
        主测的每一题都只属于一个维度，{{ dimensionPhrase }}各由同样多的题目计分。
        每个维度都是一条连续分数，不是几个格子；两端标记与下面的一句话说明，就是这份量表自己的写法。
      </p>

      <dl data-dimension-list class="mt-4 grid gap-x-10 gap-y-4 tablet:grid-cols-2">
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

    <!-- 3 如何理解结果 -->
    <section id="result" class="mt-10 scroll-mt-20">
      <h2 class="section-title">如何理解结果</h2>
      <ul class="mt-4 space-y-2.5 prose-cn">
        <li class="list-dot">
          <strong class="font-medium text-ink">这是一次倾向，不是一个身份。</strong>
          {{ dimensionPhrase }}都是连续分数，四字母只是把连续分数切成四段之后的一种叫法。
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">允许"未定"。</strong>
          每个维度会分别给出四种状态：信息不足（缺有效数字答案，不计算分数）、本次两侧相近
          （没有主导侧）、本次略偏某侧（建议继续观察）、本次回答偏向某侧（可用于参考组合）。
          {{ dimensionPhrase }}都达到展示条件时才会拼出四字母，否则完整类型为空 ——
          不会退回某个默认类型。
        </li>
        <li class="list-dot" data-threshold>
          <strong class="font-medium text-ink">越靠近中点，越不该当成确定结论。</strong>
          一维的结果不是数一数哪边更多：每题的答案先换算成一个带符号的数（1 与 5 是两端、3 是中间，
          再按这题哪一端是负极决定正负号），同一维的有效作答加起来，方向看这个和的符号。
          「略偏」也不是一条写死的分数线：它由这个和的大小、以及这一维实际可计分的题数一起决定
          —— 这一维的有效作答多一些，这条线就跟着放宽一点（比例与取整细节都固定在规则里）。
          具体数值属于这份量表自己的计分规则，写在每份报告的
          「这份报告是怎么来的」一节里（连同这一维最少要有多少题可计分）。
          <strong class="font-medium text-ink">这里不抄一个固定数字</strong>：题目或规则一改，
          抄下来的数字就会变成假话。这条门槛是为了给出一个方向而定下的规则，
          <strong class="font-medium text-ink">不是统计上的显著性判断</strong>，
          也没有证据证明它提升了这份量表的判断质量。
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">不给人群比较。</strong>
          我们没有本土常模样本，所以不会说"你比多少人更外向"，也不会给出类型占比；
          位置与分数只表示偏离中点的程度，不是你在人群里的位置。
        </li>
        <li class="list-dot">
          <strong class="font-medium text-ink">压线不等于"没测出来"。</strong>
          它说明本次作答在那一维两边差不多。这份量表在信度与效度上没有证据，我们也就无法告诉你
          哪一维更稳：压线的维度只当观察方向，隔一段时间、换个状态再看一次。
        </li>
      </ul>
    </section>

    <!-- 4 来源与限制 -->
    <section id="source" class="mt-10 scroll-mt-20">
      <h2 class="section-title">来源与限制</h2>

      <div class="mt-4 space-y-3 prose-cn">
        <p>
          {{ facts.title }}的题目与报告文案由本项目自行撰写，
          <strong class="font-semibold text-ink">没有照搬任何商业量表的题目</strong>，
          也没有翻译或改编任何外部量表。本站<strong class="font-semibold text-ink">不隶属</strong>
          任何商业人格测评机构，也不是任何机构的官方测评。
        </p>
        <p class="rounded-control bg-paper-soft px-4 py-3 text-[14px] leading-relaxed">
          这份量表的内容仍在内部核对中，题目与解释都会继续调整。它
          <strong class="font-medium text-ink">没有信度或效度方面的证据</strong>：
          我们拿不出任何材料来证明它"测得准"。这不是客气话，而是它此刻的真实状态。
        </p>
        <p>
          <strong class="font-medium text-ink">三点限制值得说清。</strong>
          一是样本：我们没有本土常模样本，所以不给人群比较、类型占比这类结论。
          二是语言：中文题面由本项目自行撰写，可读性经过人工核对与逐题释义，
          但没有经过中文样本的检验；人工核对不等于测量学意义上的验证。
          三是用途：它是参考测评，不是心理诊断，不涉及心理疾病，
          也不能用于招聘、晋升或任何筛选。
        </p>
      </div>
    </section>

    <!-- 5 数据怎么存（新测：账号 + 服务端） -->
    <section id="data" class="mt-10 scroll-mt-20">
      <h2 class="section-title">新测的数据怎么存</h2>
      <p class="mt-3 prose-cn">
        下面「本地记录」说的是本站更早那套在本机计分的问卷：它把进度留在这台设备上，不需要登录。
        首页「开始测评」进的那份不一样 ——
        <strong class="font-medium text-ink">登录后</strong>才会开始，因为它的目的是让你
        <strong class="font-medium text-ink">换一台设备也能接着答、也能回看历次报告</strong>。
      </p>

      <dl class="mt-4 divide-y divide-line border-y border-line text-[14px]">
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">存在哪里</dt>
          <dd class="text-ink-soft">
            存在本站自己的服务器上，只与你登录的账号关联。会话是服务器下发的 HttpOnly cookie，
            网页读不到，也不会把任何登录凭据写进浏览器存储。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">存了什么</dt>
          <dd class="text-ink-soft">
            你的逐题作答、答题进度、每次交卷时生成的报告内容，以及你自己填的「我的理解」。
            <strong class="font-medium text-ink">不存</strong>密码原文、恢复码原文，也不记录原始答案到运行日志。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">谁在算分</dt>
          <dd class="text-ink-soft">
            答题过程中页面上那个「目前的粗略倾向」是浏览器即时算给你看的，只为即时反馈；
            <strong class="font-medium text-ink">最终报告一律在我们这边重新算一遍</strong>再生成，
            并以那份结果为准。浏览器算出来的东西不会当成结论上传。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">AI 分析</dt>
          <dd class="text-ink-soft">
            是<strong class="font-medium text-ink">可选的</strong>、需要你单独同意的额外功能，默认不开启，
            不做也不影响报告本身。开启与否、用哪个主题，都由你在报告页上自己决定；
            没有你的同意，不会把你的任何内容发出去。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">怎么导出</dt>
          <dd class="text-ink-soft">
            在「账号与数据」页可以导出一份 JSON 文件，里面有账号基本资料、每次测评的作答、
            报告内容与 AI 记录。拿到的是原始数据，你可以在别处留一份。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">怎么删除</dt>
          <dd class="text-ink-soft">
            单份报告可以在报告列表里直接删（会连同它的答案与相关记录一起删除）；
            整份账号可以在「账号与数据」页注销，注销后立即无法登录，后台异步清理。
            删除是真实的物理删除，不是隐藏。
          </dd>
        </div>
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">不是诊断</dt>
          <dd class="text-ink-soft">
            新测的结果是<strong class="font-medium text-ink">参考测评</strong>，
            不是心理诊断，不能用于招聘、晋升或任何筛选，也不涉及心理疾病。
            解释内容还在通过内部核对，措辞会继续调整；请把它当成一个话题，而不是一个判决。
          </dd>
        </div>
      </dl>
    </section>

    <!-- 6 本地记录（旧问卷的本地进度；新测评不写这里） -->
    <section id="records" class="mt-10 scroll-mt-20">
      <h2 class="section-title">本地记录</h2>

      <p class="mt-3 prose-cn">
        这一段说的是本站更早那套在本机计分的问卷（首页已不再提供它的入口）：题目答案与计分在你的浏览器中处理。为了让你能接着上次继续，这台设备会保留最近一次作答，
        你可以随时清除。首页主推的那份新测评不在这台设备上留底，它的数据在哪见上面的「新测的数据怎么存」。
      </p>

      <dl class="mt-4 divide-y divide-line border-y border-line text-[14px]">
        <div class="flex flex-col gap-1 py-3 tablet:flex-row tablet:gap-6">
          <dt class="w-40 shrink-0 font-medium text-ink">保存了什么</dt>
          <dd class="text-ink-soft">
            这次用到的 {{ legacyTotal }} 道题、你的 {{ legacyTotal }} 个选择、当前答到哪一题，
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
              已处理 {{ savedCount }} / {{ legacyTotal }} 题（数字 {{ quiz.ratingCount }} · 待判断
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
            首页已经不再提供打开它们的入口，你只能在这里查看数量并一并清除。
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
        <li class="list-dot">
          不做公开排行，也不做「你比别人如何」的对比；没有常模，比了也是编的。
        </li>
        <li class="list-dot">
          账号只服务两件事：换设备接着答、回看历次报告。不投放广告，不把作答交给任何第三方统计，
          也不设付费墙：该给的信息在结果页一次给完。
        </li>
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
