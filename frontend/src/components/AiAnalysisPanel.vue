<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { RouterLink } from 'vue-router'
import { useAiAnalysisStore } from '@/stores/aiAnalysisV3'
import { ANALYSIS_TOPICS, topicLabel, type AnalysisTopic } from '@/api/v3Ai'
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
 */

const props = defineProps<{ reportId: string }>()

const ai = useAiAnalysisStore()

const topicId = `ai-topic-${useId()}`
const noteId = `ai-note-${useId()}`
const consentId = `ai-consent-${useId()}`

/** 生成前的确认区是否展开。默认收起：先把"要不要用"讲清楚，不逼着人做决定。 */
const confirmOpen = ref(false)
/** 范围确认勾选。默认不勾（与注册页那条免责声明同一个道理）。 */
const consentChecked = ref(false)

const job = computed(() => ai.activeJob)
const running = computed(() => job.value?.status === 'QUEUED' || job.value?.status === 'RUNNING')
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

/** 额度用完：按钮禁用，并说清"什么时候能再来"。 */
const outOfQuota = computed(() => ai.remainingToday !== null && ai.remainingToday <= 0)

const canSubmit = computed(
  () => ai.available && !ai.creating && !running.value && consentChecked.value && !outOfQuota.value,
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
const STRUCTURE_PREVIEW = [
  { icon: 'spark' as const, title: '整体印象', body: '把四个维度放一起，先给一段总述。' },
  { icon: 'book' as const, title: '分主题解读', body: '按你选的主题展开几段，而不是重复报告。' },
  { icon: 'steps' as const, title: '可以试试', body: '带步骤的做法，不是"多与人交流"这类空话。' },
  { icon: 'question' as const, title: '可以问问自己', body: '留给你自己回答的问题。' },
  { icon: 'alert' as const, title: '这段分析的边界', body: '模型自己说明推测在哪里可能不成立。' },
]

onMounted(() => {
  void ai.loadStatus()
  void ai.loadJobs(props.reportId)
})

onBeforeUnmount(() => {
  // 停轮询是必须的：这是一个内嵌面板，报告页切走时它会被销毁。
  // 漏掉这一步就会出现"用户已经离开，后台还在每 3 秒问一次"。
  ai.stopPolling()
})

function openConfirm(): void {
  confirmOpen.value = true
  consentChecked.value = false
}

function cancelConfirm(): void {
  confirmOpen.value = false
  consentChecked.value = false
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  await ai.create(props.reportId)
  confirmOpen.value = false
  consentChecked.value = false
}

async function retry(): Promise<void> {
  const current = job.value
  if (!current) return
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
          AI 洞察
        </h2>
        <p class="mt-0.5 text-[13px] text-navy-200">可选的一段额外视角 · 不改写上面的固定结果</p>
      </div>
      <span class="chip chip-on-deep ml-auto">可选</span>
    </div>

    <p class="mt-4 max-w-[44rem] text-[14.5px] leading-[1.75] text-navy-100">
      这一块会把你<strong class="font-semibold text-white">已经看到</strong>的报告结构发给模型，
      换一段更贴近日常的说法回来。它不改写上面的固定结果，也不是诊断 ——
      上面的报告本身已经是完整的，不生成 AI 也一样完整。
    </p>

    <!-- ① 问不到状态（未登录 / 网络失败）：只说明，不给按钮 -->
    <div v-if="!ai.status && !ai.statusLoading" class="deep-card mt-5" data-ai-status-unavailable>
      <p class="flex items-start gap-2.5 text-[14px] leading-relaxed text-navy-100">
        <AppIcon name="info" :size="17" class="mt-0.5 text-glow" />
        <span>现在问不到这台服务器的 AI 能力状态，暂时不能生成。可以稍后刷新页面再看。</span>
      </p>
    </div>
    <p v-else-if="ai.statusLoading && !ai.status" class="mt-5 text-[13.5px] text-navy-200">
      正在确认 AI 能力…
    </p>

    <!-- ② 服务器没开这项能力 -->
    <div v-else-if="ai.status && !ai.status.enabled" class="deep-card mt-5" role="note" data-ai-disabled>
      <p class="flex items-start gap-2.5">
        <AppIcon name="info" :size="17" class="mt-0.5 text-glow" />
        <span class="text-[14.5px] font-medium leading-relaxed text-white">这台服务器没有开启 AI 分析。</span>
      </p>
      <p class="mt-2 text-[14px] leading-relaxed text-navy-100">
        上面的固定报告与四个维度都不受影响，它们不依赖 AI 就能看。
        历史报告、对比、导出与删除也照常可用 —— 只是少了这一段额外视角。
      </p>
    </div>

    <template v-else>
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
            <p class="text-[14.5px] font-medium leading-relaxed text-white">正在生成</p>
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
            已经等了很久还没有结果，自动刷新先停下来了。可以稍后在下面重试，或过一会儿刷新页面。
          </p>
        </div>

        <!-- 失败：说清原因 + 给下一步，不显示原始错误码 -->
        <div
          v-else-if="failed"
          class="mt-4 rounded-card border border-danger-300/40 bg-danger-500/10 px-4 py-4"
          role="alert"
          data-ai-failed
        >
          <p class="flex items-start gap-2.5">
            <AppIcon name="alert" :size="17" class="mt-0.5 text-danger-200" />
            <span class="text-[14.5px] leading-relaxed text-white">{{ ai.failureHint(job) }}</span>
          </p>
          <p class="mt-2 text-[13px] leading-relaxed text-navy-200">
            失败不会被算作"已经给过你一份分析"：重试用的是同一次任务，不会多占一次新额度以外的记录。
            上面的固定报告没有受任何影响。
          </p>
          <button
            type="button"
            class="btn-on-deep btn-sm mt-3"
            :disabled="ai.retrying"
            data-ai-retry
            @click="retry"
          >
            <AppIcon name="refresh" :size="16" />
            {{ ai.retrying ? '正在重试…' : '再试一次' }}
          </button>
        </div>

        <!-- 成功：一张从深色面板里"浮出来"的纸 -->
        <div v-else-if="succeeded" class="mt-4" data-ai-result>
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
                整体印象
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
                  <p class="mt-1.5 max-w-[42rem] text-[14.5px] leading-[1.75] text-ink-soft">
                    {{ section.body }}
                  </p>
                </li>
              </ol>

              <!-- 可以试试：可执行步骤，编号而不是圆点 -->
              <div v-if="job.result.actions.length > 0" class="mt-7 border-t border-line pt-6" data-ai-actions>
                <h3 class="flex items-center gap-2 text-[16px] font-semibold text-ink">
                  <AppIcon name="steps" :size="17" class="text-primary-600" />
                  可以试试的具体做法
                </h3>
                <div class="mt-3 grid gap-3 tablet:grid-cols-2">
                  <article
                    v-for="(action, index) in job.result.actions"
                    :key="`${index}-${action.title}`"
                    class="rounded-question border border-line bg-surface-soft px-4 py-4"
                  >
                    <p class="text-[14.5px] font-semibold text-ink">{{ action.title }}</p>
                    <ul class="mt-2 space-y-1.5">
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
                        <span>{{ step }}</span>
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

      <!-- ④ 生成入口 -->
      <div v-if="!job || failed" class="mt-6">
        <!--
          生成前先说清"你将得到什么"。这一段只在还没有结果时出现 ——
          已经有结果的人不需要再被推销一次。
        -->
        <div v-if="!confirmOpen" data-ai-structure>
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
            :disabled="!ai.available || outOfQuota || ai.creating"
            data-ai-start
            @click="openConfirm"
          >
            <AppIcon name="spark" :size="17" />
            {{ ai.creating ? '正在提交…' : outOfQuota ? '今天额度已用完' : '生成一段 AI 分析' }}
          </button>
        </div>

        <!--
          确认区：契约 §4 要求如实展开"发什么、不发什么"。
          表单放在**白色卡片**上（深色面板里的表单可读性明显更差），
          也让"这一步是需要你确认的动作"与上面的说明区分开。
        -->
        <div v-else class="rounded-question bg-surface px-5 py-5 shadow-deep" data-ai-consent>
          <h3 class="flex items-center gap-2 text-[15.5px] font-semibold text-ink">
            <AppIcon name="shield" :size="17" class="text-primary-600" />
            确认要发送的范围
          </h3>
          <div class="mt-3 grid gap-3 tablet:grid-cols-2">
            <div class="rounded-card border border-primary-200 bg-primary-50 px-3.5 py-3">
              <p class="text-[13.5px] font-semibold text-primary-800">会发送</p>
              <ul class="mt-1.5 space-y-1 text-[13.5px] leading-relaxed text-primary-800">
                <li class="list-dot">四个维度的方向、强度与是否处于边界</li>
                <li class="list-dot">结果状态与候选方向（规则距离，不是概率）</li>
                <li class="list-dot">最多 8 条作答片段（题号、左右字母、你选的位置档位）</li>
                <li class="list-dot">报告里「四个精神活动过程」那一块的摘要</li>
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
              想补充的近况（可不填，最多 300 字）
            </label>
            <textarea
              :id="noteId"
              v-model="ai.note"
              name="ai-note"
              rows="3"
              maxlength="300"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            />
            <p class="caption mt-1.5">
              这段会作为<strong class="font-medium text-ink-soft">背景资料</strong>发给模型（不会当成指令），可以留空。
            </p>
          </div>

          <div class="mt-5 rounded-card border border-line bg-surface-soft px-4 py-3.5">
            <div class="flex items-start gap-3">
              <input
                :id="consentId"
                v-model="consentChecked"
                name="ai-consent"
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
            <button type="button" class="btn-ghost btn-sm" data-ai-cancel @click="cancelConfirm">
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
      </div>

      <!-- ⑤ 历史任务列表（同一报告多次生成时） -->
      <div v-if="ai.jobs.length > 1" class="deep-card mt-6" data-ai-history>
        <h3 class="flex items-center gap-2 text-[14.5px] font-semibold text-white">
          <AppIcon name="clock" :size="16" class="text-glow" />
          这份报告生成过的分析
        </h3>
        <ul class="mt-2 divide-y divide-white/10">
          <li v-for="item in ai.jobs" :key="item.jobId">
            <!--
              整行做成一个 ≥44px 的按钮（而不是把可点区域留在一个 14px 的
              文字链接上）：底下的任务列表是"切换看哪一次分析"的唯一入口，
              手机上必须点得中。
            -->
            <button
              type="button"
              class="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left"
              @click="ai.activeJobId = item.jobId"
            >
              <span
                class="link-on-deep text-[14px]"
                :class="item.jobId === ai.activeJobId ? 'font-semibold text-white' : ''"
              >
                {{ topicLabel(item.topic) }}
              </span>
              <span class="text-[12.5px] text-navy-200">
                {{ item.status === 'SUCCEEDED' ? '已生成' : item.status === 'FAILED' || item.status === 'UNKNOWN' ? '未成功' : '进行中' }}
              </span>
              <span v-if="item.jobId === ai.activeJobId" class="chip chip-on-deep">正在看这一次</span>
            </button>
          </li>
        </ul>
      </div>

      <p class="mt-6 border-t border-white/10 pt-4 text-[12px] leading-relaxed text-navy-200">
        AI 分析是可选的附加视角。它由模型生成、可能出错，不参与固定计分，
        也不改变上面那份报告的内容。详情见
        <RouterLink to="/about" class="link-on-deep">关于</RouterLink>。
      </p>
    </template>
  </section>
</template>
