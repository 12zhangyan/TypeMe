<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useAiAnalysisStore } from '@/stores/aiAnalysisV3'
import { ANALYSIS_TOPICS, evidenceLabels, isReadablePromptVersion, topicLabel, type AnalysisTopic } from '@/api/v3Ai'
import AppIcon from '@/components/AppIcon.vue'

/**
 * AI 洞察面板（报告页内嵌）—— 契约 `03-AI与前端契约-v1.md` §2 / §3 / §4。
 *
 * ## 这块最重要的一条：AI 是**可选福利**，不是报告的一部分
 *
 * 页面必须让用户在**任何状态**下都能看出"基础报告已经完整了，这块只是多一段视角"。
 * 所以：
 *   - AI 没开 / 额度用完 / 生成失败时，文案一律落到"基础报告不受影响"；
 *   - 固定计分与报告**绝不**因为 AI 结果而改变（这块只读 `reportId`，不写任何报告字段）。
 *
 * ## 为什么要点两次（先确认范围、再生成）
 *
 * 契约 §4 要求"发送范围必须在确认页如实展开"。这里把范围直接列出来（发什么、不发什么），
 * 勾选确认后才能生成。不这么做的话，用户在不清楚"会把哪些作答片段发给模型"的情况下
 * 就点了生成 —— 那正是这份契约想避免的事。
 *
 * ## 2026-09-18 视觉重构：从"报告底部的几段文字"改成一块独立区域
 *
 * 改动只有呈现，没有行为：
 *   - 整块换成深海军蓝面板（`.deep-panel`），与固定报告的浅色阅读栏形成"两种材料"的对比，
 *     AI 因此有了自己的视觉识别，而不是继续当报告的一节；
 *   - **生成前**多了一块"你将得到什么"的结构预览（`data-ai-structure`），
 *     让"要不要用"这件事在点按钮之前就有具体形状；
 *   - **生成中**只有诚实的"正在生成" + 呼吸点 + 骨架屏。**没有百分比、没有阶段名、
 *     没有"正在扫描神经网络"** —— 后端就是一个轮询的任务状态，界面不能编出阶段；
 *   - **生成后**用一段醒目的摘要建立阅读入口，再按「分主题解读 → 可以做 → 可以问自己 →
 *     这段分析的边界」展开；结果正文放在深色面板里的一张白色"纸"上，
 *     长文仍然是浅色底 + 常规行宽，不为了好看牺牲阅读。
 *
 * ## 展示纪律
 *
 * - 模型输出里**不显示**任何内部字段（jobId、promptVersion 之外的技术细节）；
 * - `mock: true` 必须显著标注"这是演示数据，没有调用真实模型"；
 * - 解析中丢掉的部分要**明说**（见 `api/v3Ai.ts` 的 `resultProblems`）；
 * - 失败时给"下一步动作"（重试 / 稍后再看），不显示原始错误 JSON。
 *
 * ## 2026-09-18（第 17 轮）：面板与 store 的归属关系变成显式的
 *
 * 这里原来靠一个**隐式前提**才不串台：报告页换报告时 `reports.loading` 置位、正文整块销毁重建，
 * 面板跟着重新 `onMounted`。那个前提是别人（加载态）顺手给的，任何"保留旧内容 + 局部骨架"
 * 的体验优化都会让它失效，而失效的表现是"B 报告页面上显示 A 的分析"。
 * 现在改成面板自己负责：
 *   - `watch(() => props.reportId)` + 父组件的 `:key`，换报告一定重新加载；
 *   - 卸载调用 `ai.reset()`（不只是 `stopPolling`）—— 顺带清掉上一个用户的额度与正文；
 *   - 渲染一律走 `ai.ownJobs`，与请求同源的 `job` 仍然来自 `ai.activeJob`（已按报告过滤）。
 */

const props = defineProps<{ reportId: string; requiresReadable?: boolean }>()

const ai = useAiAnalysisStore()

const topicId = `ai-topic-${useId()}`
const noteId = `ai-note-${useId()}`
const consentId = `ai-consent-${useId()}`

/** 生成前的确认区是否展开。默认收起：先把"要不要用"讲清楚，不逼着人做决定。 */
const confirmOpen = ref(false)
/** 范围确认勾选。默认不勾（与注册页那条免责声明同一个道理）。 */
const consentChecked = ref(false)
const confirmHeading = ref<HTMLElement | null>(null)
const startButton = ref<HTMLButtonElement | null>(null)
const TOPIC_CONTEXT: Record<AnalysisTopic, { hint: string; example: string }> = {
  overall: { hint: '说说你最想理解的一个习惯，或报告里与你的感受不一致的地方。', example: '例如：我喜欢与朋友聊天，但聚会后又很想独处，这两种感受怎么一起理解？' },
  communication: { hint: '描述一次沟通场景，以及你希望哪一步有所不同。', example: '例如：讨论方案时我习惯先挑问题，对方却觉得我在否定他。我想换一种说法。' },
  studyWork: { hint: '选一个具体环节：开始任务、获取信息、安排进度或做取舍。', example: '例如：开始任务前我想先弄清所有要求，结果总是迟迟不能动手。' },
  growth: { hint: '写一个你想尝试的小变化，也可以说说目前的限制。', example: '例如：遇到临时变动我容易打乱节奏，想试一个不需要每天打卡的小方法。' },
}
const contextPrompt = computed(() => TOPIC_CONTEXT[ai.topic])
const noteHelpId = `ai-note-help-` + useId()
const guided = computed(() => ai.status?.promptVersion === 'typeme-ai-prompt-v5')
const canRetry = computed(() => ai.available && !ai.creating && !ai.retrying && !ai.hasRunning && !outOfQuota.value)
function historyDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const job = computed(() => ai.activeJob)
/**
 * 当前**正在看**的那条任务是不是还在跑。
 *
 * 注意它只看展示中的这一条（决定显示哪张卡），与 `ai.hasRunning`（有没有**任何**任务在跑，
 * 决定能不能再建一个）是两件事：用户在历史里点开一条失败的任务时，另一个任务可能还在跑，
 * 这时该看到的是"失败"那张卡，而"再生成一个"仍然要被挡住。
 */
const running = computed(() => job.value?.status === 'QUEUED' || job.value?.status === 'RUNNING')
/** 有别的任务在跑：这时不能再建一个（额度与并发都该挡在这里）。 */
const otherJobRunning = computed(() => ai.hasRunning && !running.value)
/**
 * 任务已经成功结束。
 *
 * 注意这里**不**要求 `result !== null`：服务端把一次输出判为成功（进了 `SUCCEEDED`）
 * 之后，前端仍可能读不懂它的结构（旧版本输出格式）。那种情况不是"还在跑"、
 * 也不是"没生成"，页面必须能落到"读不出来"这一支上如实说明 ——
 * 如果把 `result === null` 也算成"没成功"，用户看到的就是一个永远转不完的圈。
 */
const succeeded = computed(() => job.value?.status === 'SUCCEEDED')
const failed = computed(() => job.value?.status === 'FAILED' || job.value?.status === 'UNKNOWN')

/**
 * 上一次成功留下的正文，而这一次重新生成没有成功（A84）。
 *
 * 服务端「重新入队」复用同一行任务，并且**不会**清掉 `response_json`：
 * `AnalysisJobRepository.requeueForRetry` 只改状态与调度字段，`markFailed`/`markUnknown` 也不动它。
 * 所以状态已经是 FAILED/UNKNOWN 时，`result` 仍可能是上一次成功的正文。
 * 原来的模板把失败与结果写成同一条 `v-else-if` 链，会把这块正文整片挡掉 ——
 * 用户点一次「再生成一次」失败，此前能读的分析就从界面上消失了（数据其实还在库里）。
 *
 * 反过来推也成立：只有 `markSucceeded` 会写 `response_json`，所以 `result` 非空
 * 就意味着历史上成功过至少一次 —— 那正是「上一次成功」这个说法的依据，不是猜的。
 */
const staleResult = computed(() => !succeeded.value && job.value?.result != null)
/** 当前成功或仍保留旧成功正文时可读；解析错误也需要明确显示。 */
const showResult = computed(() => succeeded.value || staleResult.value || (job.value?.resultProblems.length ?? 0) > 0)

/** 成功后可再生成；相同主题和近况复用任务，具体去重由服务端判断。 */
const showGenerator = computed(() => !ai.jobsLoading && (!ai.jobsError || ai.ownJobs.length > 0) && (!job.value || failed.value || succeeded.value))

/** 额度用完：按钮禁用，并说清"什么时候能再来"。 */
const outOfQuota = computed(() => ai.remainingToday !== null && ai.remainingToday <= 0)
/**
 * 服务端当前提示词版本是否支持可读版契约（v3 / v4 / v5）。
 *
 * 用**同一个** `readable` 同时驱动三件事：大五是否禁用、结构预览用哪一套、确认区列举的
 * 发送范围用哪一套。此前模板里另写了一份 `=== 'typeme-ai-prompt-v3'` 字面量 ——
 * 两处一旦漂开，界面会出现"按钮说暂不支持、确认区却按新版列范围"这种自相矛盾。
 */
const readable = computed(() => isReadablePromptVersion(ai.status?.promptVersion))
const supported = computed(() => !props.requiresReadable || readable.value)

watch(() => [ai.status?.promptVersion, ai.topic, ai.note], () => { consentChecked.value = false })

const canSubmit = computed(
  () =>
    ai.available &&
    supported.value &&
    !ai.creating &&
    !ai.retrying &&
    !ai.jobsLoading &&
    !ai.hasRunning &&
    consentChecked.value &&
    !outOfQuota.value,
)

const statusText = computed(() => {
  if (!ai.status) return null
  if (!ai.status.enabled) return null
  if (ai.remainingToday === null) return '这项能力已开启。'
  return `今天还可以生成 ${ai.remainingToday} 次。`
})

/**
 * 生成前的结构预览。
 *
 * 列的必须是**接口真实返回的字段**（`api/v3Ai.ts` 的 `AnalysisResultView`）：
 * summary / sections / actions / reflectionQuestions / boundaryNotes。
 * 每一项都刻意**不带** `data-ai-summary` 这类结果钩子 —— 那些钩子只属于真正生成出来的
 * 内容，自动化验收靠它们的计数判断"有没有结果"，预览混进去就会让计数失去意义。
 */
const STRUCTURE_PREVIEW = computed(() => readable.value ? [
  { icon: 'spark' as const, title: '一句话结论', body: '先说这次回答反映了什么。' },
  { icon: 'book' as const, title: '为什么这样说', body: guided.value ? '围绕你的问题，解释相关依据、适用场景和待核对之处。' : '最多两条解释，用生活中的例子帮助理解。' },
  { icon: 'steps' as const, title: '可以试一次', body: '一件小事：为什么试、怎么做、何时做、留意什么。' },
  { icon: 'alert' as const, title: '哪些还不能确定', body: '说明这次作答和这段解释的限制。' },
] : [
  { icon: 'spark' as const, title: '整体印象', body: '把几个维度放一起，先给一段总述。' },
  { icon: 'book' as const, title: '分主题解读', body: '按你选的主题展开几段，而不是重复报告。' },
  { icon: 'steps' as const, title: '可以试试', body: '带步骤的做法，不是"多与人交流"这类空话。' },
  { icon: 'question' as const, title: '可以问问自己', body: '留给你自己回答的问题。' },
  { icon: 'alert' as const, title: '这段分析的边界', body: '模型自己说明推测在哪里可能不成立。' },
])

onMounted(() => {
  void ai.loadStatus()
  void ai.loadJobs(props.reportId)
})

/**
 * 换报告必须重新读一次。
 *
 * 父组件同时给了 `:key="reportId"`，所以正常路径下这里是**重新挂载**而不是 prop 变化。
 * 保留这个 watch 是为了让"panel 认哪份报告"成为组件自己的性质：将来谁把 `:key` 去掉
 * （或者把加载态改成保留旧内容），换报告也不会继续显示上一份的分析。
 */
watch(
  () => props.reportId,
  (reportId) => {
    ai.reset()
    confirmOpen.value = false
    consentChecked.value = false
    void ai.loadStatus()
    void ai.loadJobs(reportId)
  },
)

onBeforeUnmount(() => {
  // `reset()` 而不是 `stopPolling()`：这是一个内嵌面板，报告页切走时它会被销毁。
  // 只停 timer 的话，`jobs`/`status` 会连同"上一个用户还剩几次额度"一起留在单例里，
  // 下次挂载（哪怕是另一个账号）在 `loadJobs` 回来之前会先渲染出旧内容。
  ai.reset()
})

/** 列表读失败时的手动重试：这是唯一能把"读不到"变成"读到了"的动作。 */
function reloadJobs(): void {
  void ai.loadJobs(props.reportId)
}

function openConfirm(): void {
  if (job.value && ANALYSIS_TOPICS.some(option => option.value === job.value?.topic)) ai.topic = job.value.topic as AnalysisTopic
  confirmOpen.value = true
  consentChecked.value = false
  void nextTick(() => confirmHeading.value?.focus())
}

function cancelConfirm(): void {
  confirmOpen.value = false
  consentChecked.value = false
  void nextTick(() => startButton.value?.focus())
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  const reportId = props.reportId
  const accepted = await ai.create(reportId)
  if (accepted && props.reportId === reportId) {
    confirmOpen.value = false
    consentChecked.value = false
  }
}

async function retry(): Promise<void> {
  const current = job.value
  // 任务必须属于这份报告才允许重试。归属在 store 里已经过滤过一遍，
  // 这里再对一次是因为"点错报告的任务"代价很高：排的是别人的队。
  if (!current || current.reportId !== props.reportId || !canRetry.value) return
  await ai.retry(current.jobId)
}

function pickTopic(value: AnalysisTopic): void {
  ai.topic = value
}
</script>

<template>
  <section
    id="report-ai"
    data-anchor
    class="deep-panel deep-grid mt-12 scroll-mt-24 rounded-cover px-5 py-7 shadow-deep tablet:px-9 tablet:py-10"
    aria-labelledby="report-ai-title"
    data-ai-panel
  >
    <!-- 区域识别：这块不是报告的第九节，而是另一种材料 -->
    <div class="flex flex-wrap items-center gap-3">
      <span
        class="flex h-10 w-10 items-center justify-center rounded-card border border-glow/40 bg-white/[0.06] text-glow"
        aria-hidden="true"
      >
        <AppIcon name="spark" :size="19" />
      </span>
      <div class="min-w-0">
        <h2 id="report-ai-title" class="display-hero text-[20px] leading-tight text-white tablet:text-[25px]">
          AI 解读
        </h2>
        <p class="mt-0.5 text-[13px] text-navy-200">可选 · 不改写固定结果</p>
      </div>
    </div>

    <p class="mt-4 max-w-[44rem] text-[14.5px] leading-[1.75] text-navy-100">
      把这份报告放进你关心的生活场景，看看哪些解释符合自己，再选一件小事试试。
    </p>

    <!-- ① 问不到状态（未登录 / 网络失败）：只说明，不给按钮 -->
    <div v-if="!ai.status && !ai.statusLoading" class="deep-card mt-5" data-ai-status-unavailable>
      <p class="flex items-start gap-2.5 text-[14px] leading-relaxed text-navy-100">
        <AppIcon name="info" :size="17" class="mt-0.5 text-glow" />
        <!--
          "登录已失效"与"这台服务器问不到"必须分开说：前者重试一百次也没用，
          后者等一会儿可能就好了。修之前 401 也落在这里，文案会把用户引向刷新页面。
        -->
        <span v-if="ai.statusError?.sessionExpired">
          登录状态已经失效，所以现在读不到 AI 能力状态。重新登录后回到这份报告就能继续生成。
        </span>
        <span v-else>暂时无法确认 AI 是否可用。已有分析仍可阅读，你可以重新检查后再生成。</span>
      </p>
      <button v-if="!ai.statusError?.sessionExpired" type="button" class="btn-on-deep btn-sm mt-3"
        :disabled="ai.statusLoading" data-ai-status-retry @click="ai.loadStatus()">重新检查</button>
    </div>
    <p v-else-if="ai.statusLoading && !ai.status" class="mt-5 text-[13.5px] text-navy-200">
      正在确认 AI 能力…
    </p>

    <!-- ② 服务器没开这项能力 -->
    <div v-else-if="ai.status && !ai.status.enabled" class="deep-card mt-5" role="note" data-ai-disabled>
      <p class="flex items-start gap-2.5">
        <AppIcon name="info" :size="17" class="mt-0.5 text-glow" />
        <span class="text-[14.5px] font-medium leading-relaxed text-white">AI 解读暂未开放，已有分析仍可阅读。固定报告无需 AI 即可阅读。</span>
      </p>
    </div>

    <div>
      <!-- 能力与额度：一条就够，别拆成三处重复 -->
      <div class="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p v-if="statusText" class="flex items-center gap-2 text-[13.5px] text-navy-100" data-ai-quota>
          <AppIcon name="target" :size="15" class="text-glow" />
          {{ statusText }}
        </p>
        <p v-if="ai.remainingToday === 0" class="text-[13.5px] text-navy-200" data-ai-quota-empty>
          今天的额度已经用完，明天会重新计算。
        </p>
      </div>

      <!--
        ③ 读不到这份报告已有的分析：必须**说出来**并给重试。
        以前这里只把错误写进 `jobsError`（没有任何模板读它），结果是同一个界面既可能显示
        上一份报告的列表，也可能显示"生成一段 AI 分析"——后者会让用户以为这份报告还没有分析。
        "读不到"和"还没有"不能长得一样。
      -->
      <div
        v-if="ai.jobsError && !ai.jobsLoading"
        class="mt-5 rounded-card border border-danger-300/40 bg-danger-500/10 px-4 py-4"
        role="alert"
        data-ai-jobs-error
      >
        <p class="flex items-start gap-2.5">
          <AppIcon name="alert" :size="17" class="mt-0.5 text-danger-200" />
          <span class="text-[14px] leading-relaxed text-white">
            分析记录暂时没有更新成功。这不代表没有生成过；已读到的内容会继续保留，基础报告不受影响。
          </span>
        </p>
        <p v-if="ai.jobsError.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed text-navy-200">
          报障编号：<code class="font-mono">{{ ai.jobsError.requestId }}</code>
        </p>
        <button
          type="button"
          class="btn-on-deep btn-sm mt-3"
          :disabled="ai.jobsLoading"
          data-ai-jobs-retry
          @click="reloadJobs"
        >
          <AppIcon name="refresh" :size="16" />
          重新读取
        </button>
      </div>

      <p v-if="ai.jobsLoading && !job" class="mt-5 text-sm text-navy-100" role="status">正在读取这份报告的分析记录…</p>
      <!-- ③ 已有任务：展示结果 / 等待 / 失败 -->
      <!--
        `data-ai-job-id` 是给自动化验收用的观测标记：只带 `data-ai-job` 无法区分
        "面板加载了**本报告**的任务" 与 "面板还挂着**上一份报告**的任务"
        （两者都会让 data-ai-job 计数为 1）。jobId 是随机 UUID，不含任何个人信息。
      -->
      <div v-if="job" class="mt-5" data-ai-job :data-ai-job-status="job.status" :data-ai-job-id="job.jobId">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span class="chip chip-on-deep">
            <AppIcon name="sliders" :size="13" />
            主题：{{ topicLabel(job.topic) }}
          </span>
          <span class="text-[13px] text-navy-200">第 {{ job.attemptCount + 1 }} 次尝试</span>
        </div>

        <!--
          mock 必须被看见：这是全站唯一一处"内容不是真的"的地方，
          用浅色琥珀条压在深色面板上，是这块区域里最显眼的元素。
        -->
        <p v-if="job.mock" class="notice-uncertain mt-4 text-[14px] leading-relaxed" role="note" data-ai-mock>
          <span class="font-medium">这是演示数据</span>：这台服务器用的是模拟适配器，
          没有真的调用外部模型。内容仅用于界面联调，不要当成分析结论。
        </p>

        <!-- 等待中：只表达"还在跑"，不编阶段、不编百分比 -->
        <div v-if="running" class="deep-card mt-4" role="status" aria-live="polite" data-ai-running>
          <div class="flex items-center gap-3">
            <span class="flex items-center gap-1" aria-hidden="true">
              <span class="h-1.5 w-1.5 animate-breathe rounded-full bg-glow" />
              <span class="h-1.5 w-1.5 animate-breathe rounded-full bg-glow [animation-delay:0.3s]" />
              <span class="h-1.5 w-1.5 animate-breathe rounded-full bg-glow [animation-delay:0.6s]" />
            </span>
            <p class="text-[14.5px] font-medium leading-relaxed text-white">{{ job.status === 'QUEUED' ? '已排队，等待生成' : '正在生成' }}</p>
          </div>
          <p class="mt-2 max-w-[42rem] text-[14px] leading-relaxed text-navy-100">
            通常需要十几秒到一分钟。可以留在这个页面，也可以先去别处 —— 回来时进度还在。
          </p>
          <!-- 骨架屏只是占位，不表示"已完成 60%" -->
          <div class="mt-4 space-y-2.5" aria-hidden="true">
            <div class="skeleton skeleton-on-deep h-3.5 w-[68%]" />
            <div class="skeleton skeleton-on-deep h-3.5 w-[92%]" />
            <div class="skeleton skeleton-on-deep h-3.5 w-[80%]" />
          </div>
          <p v-if="ai.pollingGaveUp" class="mt-4 text-[13px] leading-relaxed text-navy-200" data-ai-polling-gave-up>
            已经等了很久还没有结果，自动刷新先停下来了。任务本身可能还在跑 ——
            点下面这个按钮再问一次，或者过一会儿刷新页面。
          </p>
          <button
            v-if="ai.pollingGaveUp"
            type="button"
            class="btn-on-deep btn-sm mt-3"
            :disabled="ai.jobsLoading"
            data-ai-recheck
            @click="reloadJobs"
          >
            <AppIcon name="refresh" :size="16" />
            重新检查
          </button>
        </div>

        <!--
          失败与结果**不互斥**（A84）：服务端重新入队不会清 response_json，所以 status=FAILED 时
          result 仍可能是上一次成功的正文。这里刻意拆成两条独立的 v-if，
          再由 staleResult 决定要不要在失败提示下面补上那份旧正文。
          失败：说清原因 + 给下一步，不显示原始错误码。
        -->
        <div
          v-if="failed"
          class="mt-4 rounded-card border border-danger-300/40 bg-danger-500/10 px-4 py-4"
          role="alert"
          data-ai-failed
        >
          <p class="flex items-start gap-2.5">
            <AppIcon name="alert" :size="17" class="mt-0.5 text-danger-200" />
            <span class="text-[14.5px] leading-relaxed text-white">{{ ai.failureHint(job) }}</span>
          </p>
          <p class="mt-2 text-[13px] leading-relaxed text-navy-200">
            <template v-if="staleResult">
              这次重新生成没有成功，所以下面那份上一次成功生成的内容没有被替换掉。
              重试会沿用原主题和原近况，重新占用一次生成额度。固定报告不受影响。
            </template>
            <template v-else>
              重试会沿用原主题和原近况，重新占用一次生成额度。固定报告不受影响。
            </template>
          </p>
          <button
            type="button"
            class="btn-on-deep btn-sm mt-3"
            :disabled="!canRetry"
            data-ai-retry
            @click="retry"
          >
            <AppIcon name="refresh" :size="16" />
            {{ ai.retrying ? '正在重试…' : outOfQuota ? '今天额度已用完' : '再试一次' }}
          </button>
        </div>

        <!-- 成功：一张从深色面板里"浮出来"的纸。失败但留着上一次正文时也走这一支 -->
        <div v-if="showResult" class="mt-4" data-ai-result>
          <p
            v-if="staleResult"
            class="notice-uncertain mt-3 text-[14px] leading-relaxed"
            role="note"
            data-ai-stale
          >
            <span class="font-medium">这份是上一次成功生成的内容</span>：
            {{ running ? '新分析仍在生成，你可以先继续阅读。' : '本次重新生成没有成功，原有内容仍然保留。' }}
          </p>
          <p v-if="job.mock" class="text-[12.5px] text-navy-200" data-ai-result-mock>
            （演示数据，非真实模型输出）
          </p>

          <p
            v-if="job.resultProblems.length > 0"
            class="notice-uncertain mt-3 text-[14px] leading-relaxed"
            data-ai-result-problems
          >
            <span class="font-medium">这份分析有一部分没读出来：</span>
            <span class="mt-1 block">{{ job.resultProblems.join(' ') }}</span>
          </p>

          <div v-if="job.result" class="mt-3 overflow-hidden rounded-cover bg-surface shadow-deep">
            <!-- 摘要：阅读入口。它和下面几节不是同一层级，所以单独占一条"引子"带 -->
            <div
              v-if="job.result.summary"
              class="border-b border-line bg-surface px-5 py-5 tablet:px-7 tablet:py-6"
              data-ai-summary
            >
              <p class="flex items-center gap-2 text-[12.5px] font-medium text-primary-600">
                <AppIcon name="spark" :size="15" />
                {{ job.result.schemaVersion === 'analysis-guided-v3' ? '先看这次发现' : '整体印象' }}
                <span v-if="job.result.referenceType" class="chip chip-primary ml-1">
                  基于 {{ job.result.referenceType }}
                </span>
              </p>
              <p class="mt-2.5 max-w-[42rem] text-[16px] leading-[1.75] text-ink tablet:text-[17px]">
                {{ job.result.summary }}
              </p>
            </div>

            <div class="px-5 py-5 tablet:px-7 tablet:py-6">
              <!-- 分主题解读：编号 + 连接线，让"有几段、读到第几段"看得见 -->
              <ol v-if="job.result.sections.length > 0" class="relative space-y-5 border-l border-line pl-6">
                <li
                  v-for="(section, index) in job.result.sections"
                  :key="section.key"
                  class="relative"
                  data-ai-section
                >
                  <span
                    class="absolute -left-[1.95rem] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-[10.5px] font-bold text-white"
                    aria-hidden="true"
                    >{{ index + 1 }}</span
                  >
                  <h3 class="text-[16px] font-semibold text-ink">{{ section.title }}</h3>
                  <p class="mt-1.5 max-w-[42rem] whitespace-pre-line text-[14.5px] leading-[1.75] text-ink-soft">
                    {{ section.body }}
                  </p>
                  <p v-if="evidenceLabels(section.evidenceIds).length" class="mt-2 text-[12.5px] text-primary-700" data-ai-evidence>
                    本次报告依据：{{ evidenceLabels(section.evidenceIds).join('、') }}
                  </p>
                  <div v-if="section.example" class="mt-3 rounded-card border border-line bg-surface-soft px-4 py-3" data-ai-example>
                    <p class="text-[12.5px] font-medium text-ink-faint">放到具体场景里看</p>
                    <p class="mt-1 text-[14px] leading-relaxed text-ink-soft">{{ section.example }}</p>
                  </div>
                  <p v-if="section.checkQuestion" class="mt-3 text-[14px] leading-relaxed text-primary-800" data-ai-check-question>
                    <span class="font-semibold">问问自己：</span>{{ section.checkQuestion }}
                  </p>
                </li>
              </ol>

              <!-- 可以试试：可执行步骤，编号而不是圆点 -->
              <div v-if="job.result.actions.length > 0" class="mt-7 border-t border-line pt-6" data-ai-actions>
                <h3 class="flex items-center gap-2 text-[16px] font-semibold text-ink">
                  <AppIcon name="steps" :size="17" class="text-primary-600" />
                  可以试试的具体做法
                </h3>
                <div class="mt-3 grid gap-3" :class="{ 'tablet:grid-cols-2': job.result.actions.length > 1 }">
                  <article
                    v-for="(action, index) in job.result.actions"
                    :key="`${index}-${action.title}`"
                    class="rounded-question border border-line bg-surface-soft px-4 py-4"
                  >
                    <p class="text-[14.5px] font-semibold text-ink">{{ action.title }}</p>
                    <p v-if="action.why" class="mt-2 text-[14px] leading-relaxed text-ink-soft" data-ai-action-why><span class="font-medium text-ink">为什么试：</span>{{ action.why }}</p>
                    <p v-if="evidenceLabels(action.evidenceIds).length" class="mt-2 text-[12.5px] text-primary-700">本次报告依据：{{ evidenceLabels(action.evidenceIds).join('、') }}</p>
                    <ul class="mt-3 space-y-3">
                      <li
                        v-for="(step, stepIndex) in action.steps"
                        :key="step"
                        class="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-soft"
                      >
                        <span
                          class="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[11px] font-semibold text-primary-700"
                          aria-hidden="true"
                          >{{ stepIndex + 1 }}</span
                        >
                        <span><strong v-if="action.stepLabels?.[stepIndex]" class="mb-0.5 block font-semibold text-ink">{{ action.stepLabels[stepIndex] }}</strong>{{ step }}</span>
                      </li>
                    </ul>
                  </article>
                </div>
              </div>

              <!-- 可以问问自己 -->
              <div v-if="job.result.reflectionQuestions.length > 0" class="mt-7 border-t border-line pt-6" data-ai-questions>
                <h3 class="flex items-center gap-2 text-[16px] font-semibold text-ink">
                  <AppIcon name="question" :size="17" class="text-primary-600" />
                  可以问问自己
                </h3>
                <ul class="mt-3 space-y-2.5">
                  <li
                    v-for="question in job.result.reflectionQuestions"
                    :key="question"
                    class="flex gap-3 rounded-card border border-line-soft bg-surface-soft px-4 py-3 text-[14.5px] leading-relaxed text-ink"
                  >
                    <span class="font-display text-[15px] font-bold text-primary-500" aria-hidden="true">?</span>
                    <span>{{ question }}</span>
                  </li>
                </ul>
              </div>

              <!-- 边界：AI 自己的限定，用报告里同一套"不确定"视觉 -->
              <div v-if="job.result.boundaryNotes.length > 0" class="mt-7 border-t border-line pt-6" data-ai-boundaries>
                <h3 class="flex items-center gap-2 text-[16px] font-semibold text-ink">
                  <AppIcon name="alert" :size="17" class="text-accent-500" />
                  这段分析的边界
                </h3>
                <ul class="mt-3 space-y-2">
                  <li
                    v-for="note in job.result.boundaryNotes"
                    :key="note"
                    class="notice-uncertain text-[13.5px] leading-relaxed"
                  >
                    {{ note }}
                  </li>
                </ul>
              </div>

              <p class="mt-6 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-faint">
                这段文字由模型生成，不是心理诊断，也不改变上面那份固定报告。
                如果它和你自己的感受不一致，以你自己的感受为准。
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- ④ 生成入口：还没有任务、失败了、或已经成功（再生成一次） -->
      <div v-if="showGenerator && ai.available" class="mt-6">
        <!--
          生成前先说清"你将得到什么"。已经有结果时不再推销结构，只留「再生成一次」。
        -->
        <div v-if="!confirmOpen && !succeeded" data-ai-structure>
          <p class="text-[13.5px] font-medium text-navy-100">你将得到</p>
          <ul class="mt-3 grid gap-2.5 tablet:grid-cols-2 laptop:grid-cols-3">
            <li v-for="item in STRUCTURE_PREVIEW" :key="item.title" class="deep-card">
              <p class="flex items-center gap-2 text-[13.5px] font-semibold text-white">
                <AppIcon :name="item.icon" :size="15" class="text-glow" />
                {{ item.title }}
              </p>
              <p class="mt-1 text-[12.5px] leading-relaxed text-navy-100">{{ item.body }}</p>
            </li>
          </ul>

          <button
            type="button"
            class="btn-glow mt-4"
            :disabled="!ai.available || !supported || outOfQuota || ai.creating || ai.retrying || otherJobRunning"
            ref="startButton"
            data-ai-start
            @click="openConfirm"
          >
            <AppIcon name="spark" :size="17" />
            {{ ai.creating ? '正在提交…' : outOfQuota ? '今天额度已用完' : '生成一段 AI 分析' }}
          </button>
          <p v-if="!supported && ai.status" class="mt-3 text-[13.5px] text-navy-100" data-ai-unsupported>
            当前 AI 解读版本还不支持大五报告，基础报告可正常阅读。
          </p>
        </div>

        <div v-else-if="!confirmOpen && succeeded" data-ai-regenerate>
          <button
            type="button"
            class="btn-on-deep btn-sm"
            :disabled="!ai.available || !supported || outOfQuota || ai.creating || ai.retrying || otherJobRunning"
            data-ai-start
            @click="openConfirm"
          >
            <AppIcon name="refresh" :size="16" />
            {{ outOfQuota ? '今天额度已用完' : '再生成一次' }}
          </button>
          <p class="mt-2 text-[12.5px] leading-relaxed text-navy-200">
            相同主题和近况会重新生成，成功后替换原内容；更换主题或近况会另存一份。每次生成占用一次额度。
          </p>
        </div>

        <!--
          确认区：契约 §4 要求如实展开"发什么、不发什么"。
          表单放在**白色卡片**上（深色面板里的表单可读性明显更差），
          也让"这一步是需要你确认的动作"与上面的说明区分开。
        -->
        <div v-else class="rounded-question bg-surface px-5 py-5 shadow-deep" data-ai-consent>
          <h3 ref="confirmHeading" tabindex="-1" class="flex items-center gap-2 text-[15.5px] font-semibold text-ink">
            <AppIcon name="shield" :size="17" class="text-primary-600" />
            确认要发送的范围
          </h3>
          <div class="mt-3 grid gap-3 tablet:grid-cols-2">
            <div class="rounded-card border border-primary-200 bg-primary-50 px-3.5 py-3">
              <p class="text-[13.5px] font-semibold text-primary-800">会发送</p>
              <ul class="mt-1.5 space-y-1 text-[13.5px] leading-relaxed text-primary-800">
                <template v-if="readable">
                  <li class="list-dot">这份报告的维度含义、分数或方向，以及回答是否足够</li>
                  <li class="list-dot">本次结果状态，以及最多 5 条维度摘要作为解释依据</li>
                  <li class="list-dot">你选的关注主题，以及主动填写的近况（如果有）</li>
                </template>
                <template v-else>
                  <li class="list-dot">四个维度的方向、强度与是否处于边界</li>
                  <li class="list-dot">结果状态与候选方向（规则距离，不是概率）</li>
                  <li class="list-dot">最多 8 条作答片段（题号、左右字母、你选的位置档位）</li>
                  <li class="list-dot">报告里「四个精神活动过程」那一块的摘要</li>
                </template>
              </ul>
            </div>
            <div class="rounded-card border border-line bg-surface-soft px-3.5 py-3">
              <p class="text-[13.5px] font-semibold text-ink">不会发送</p>
              <ul class="mt-1.5 space-y-1 text-[13.5px] leading-relaxed text-ink-soft">
                <li class="list-dot">用户名、昵称、任何登录信息</li>
                <li class="list-dot">完整题库正文与完整答卷</li>
                <li class="list-dot">你的其他报告与历史记录</li>
                <li class="list-dot">报告编号、测评编号一类的内部标识</li>
              </ul>
            </div>
          </div>

          <div class="mt-5">
            <label :for="topicId" class="block text-[14.5px] font-medium text-ink">这次想侧重什么</label>
            <div class="mt-2 grid gap-2 tablet:grid-cols-2">
              <button
                v-for="option in ANALYSIS_TOPICS"
                :key="option.value"
                type="button"
                class="rounded-card border-2 px-3 py-2.5 text-left text-[14px] leading-relaxed transition-colors"
                :class="
                  ai.topic === option.value
                    ? 'border-primary-600 bg-primary-50 text-ink shadow-ring'
                    : 'border-line bg-surface text-ink-soft hover:border-primary-300'
                "
                :disabled="ai.creating || ai.retrying"
                :aria-pressed="ai.topic === option.value"
                :data-ai-topic="option.value"
                @click="pickTopic(option.value)"
              >
                <span class="flex items-center gap-2 font-medium">
                  <span
                    class="flex h-4 w-4 items-center justify-center rounded-full border-2"
                    :class="ai.topic === option.value ? 'border-primary-600 bg-primary-600' : 'border-line-strong'"
                    aria-hidden="true"
                  >
                    <span v-if="ai.topic === option.value" class="h-1.5 w-1.5 rounded-full bg-white" />
                  </span>
                  {{ option.label }}
                </span>
                <span class="mt-0.5 block pl-6 text-[13px] text-ink-faint">{{ option.hint }}</span>
              </button>
            </div>
            <p :id="topicId" class="caption mt-1.5">一次只生成一个主题，换主题会另外占一次额度。</p>
          </div>

          <div class="mt-5">
            <label :for="noteId" class="block text-[14.5px] font-medium text-ink">
              想让这次分析帮你看什么？
            </label>
            <p class="caption mt-1.5">{{ contextPrompt.hint }} 可不填，最多 300 字。</p>
            <textarea
              :id="noteId"
              v-model="ai.note"
              :placeholder="contextPrompt.example"
              :aria-describedby="noteHelpId"
              :disabled="ai.creating || ai.retrying"
              name="ai-note"
              rows="3"
              maxlength="300"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            />
            <div :id="noteHelpId" class="mt-1.5 flex flex-wrap justify-between gap-2 text-[12.5px] leading-relaxed text-ink-faint">
              <p class="max-w-[36rem]">内容会发送给模型作为背景；请省略姓名、联系方式等个人信息。自述用于选择角度，不作为测量结论。</p>
              <span data-ai-note-count>{{ ai.note.length }} / 300</span>
            </div>
          </div>

          <div class="mt-5 rounded-card border border-line bg-surface-soft px-4 py-3.5">
            <div class="flex items-start gap-3">
              <input
                :id="consentId"
                v-model="consentChecked"
                name="ai-consent"
                :disabled="ai.creating || ai.retrying"
                type="checkbox"
                class="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong"
              />
              <label :for="consentId" class="text-[14px] leading-relaxed text-ink">
                我确认要把上面列出的范围发给模型服务，用来生成这段分析。
              </label>
            </div>
            <p v-if="!consentChecked" class="caption mt-2 pl-8">勾选后才能生成。</p>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-primary btn-sm"
              :disabled="!canSubmit"
              data-ai-submit
              @click="submit"
            >
              {{ ai.creating ? '正在提交…' : '确认生成' }}
            </button>
            <button type="button" :disabled="ai.creating || ai.retrying" class="btn-ghost btn-sm" data-ai-cancel @click="cancelConfirm">
              先不生成
            </button>
          </div>
        </div>

        <!-- 创建失败：如实说明 + 给下一步 -->
        <div v-if="ai.createError" class="notice-error mt-3" role="alert" data-ai-create-error>
          <p class="text-[14.5px] font-medium leading-relaxed">{{ ai.failureHint(null) }}</p>
          <p v-if="ai.createError.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
            报障编号：<code class="font-mono">{{ ai.createError.requestId }}</code>
          </p>
        </div>

        <!--
          命中去重：服务端对"同一份范围"已有任务时不会再建、也不会再扣额度。
          这句话必须说出来，否则用户会以为刚才那一下又花了一次次数。
        -->
        <p
          v-if="ai.createCached"
          class="mt-3 rounded-card border border-glow/30 bg-white/[0.06] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-navy-100"
          role="status"
          data-ai-create-cached
        >
          <AppIcon name="info" :size="15" class="mr-1.5 inline align-[-2px] text-glow" />
          这次没有新建任务：同一份范围的生成请求已经在下面了，也没有重复占用今天的次数。
        </p>

        <!--
          另一个任务还在跑：把"按钮为什么点不动"说清楚，而不是让按钮静静地禁用着。
        -->
        <p
          v-if="otherJobRunning"
          class="mt-3 text-[13px] leading-relaxed text-navy-200"
          data-ai-other-running
        >
          另一次生成还在进行中。等它结束后再开始新的分析 —— 同一份报告同时跑两个不会更快。
        </p>
      </div>

      <!-- ⑤ 历史任务列表（同一报告多次生成时） -->
      <div v-if="ai.ownJobs.length > 1" class="deep-card mt-6" data-ai-history>
        <h3 class="flex items-center gap-2 text-[14.5px] font-semibold text-white">
          <AppIcon name="clock" :size="16" class="text-glow" />
          这份报告生成过的分析
        </h3>
        <ul class="mt-2 divide-y divide-white/10">
          <li v-for="item in ai.ownJobs" :key="item.jobId">
            <!--
              整行做成一个 ≥44px 的按钮（而不是把可点区域留在一个 14px 的
              文字链接上）：底下的任务列表是"切换看哪一次分析"的唯一入口，
              手机上必须点得中。
            -->
            <button
              type="button"
              class="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left"
              :aria-current="item.jobId === job?.jobId ? 'true' : undefined"
              @click="ai.activeJobId = item.jobId"
            >
              <span
                class="link-on-deep text-[14px]"
                :class="item.jobId === job?.jobId ? 'font-semibold text-white' : ''"
              >
                {{ topicLabel(item.topic) }}
              </span>
              <span class="text-[12.5px] text-navy-200">
                {{ item.status === 'SUCCEEDED' ? '已生成' : item.status === 'FAILED' || item.status === 'UNKNOWN' ? '未成功' : '进行中' }}
              </span>
              <time v-if="historyDate(item.createdAt)" class="text-[12.5px] text-navy-200" :datetime="item.createdAt ?? undefined">{{ historyDate(item.createdAt) }}</time>
              <span v-if="item.jobId === job?.jobId" class="chip chip-on-deep">正在看这一次</span>
            </button>
          </li>
        </ul>
      </div>

    </div>
  </section>
</template>
