<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import FormErrorNotice from '@/components/FormErrorNotice.vue'
import AiAnalysisPanel from '@/components/AiAnalysisPanel.vue'
import DimensionMeter from '@/components/DimensionMeter.vue'
import AppIcon from '@/components/AppIcon.vue'
import PersonalityPortrait from '@/components/PersonalityPortrait.vue'
import { plainJungRows, readingParagraphs } from '@/domain/plainReport'

import { useReportStore } from '@/stores/reportV3'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import type { ReportViewModelV3 } from '@/domain/reportV3'
import { isLegalTypeCode } from '@/domain/jung/types'
import { describeSnapshotThresholds } from '@/domain/jung/snapshotThresholdCopy'

const mobileTocOpen = ref(false)

/**
 * 报告页（新测）—— 契约 `03-AI与前端契约-v1.md` §7.2 / §7.3。
 *
 * ## 四种状态必须长得**明显不一样**
 *
 * 这是整块功能最容易做错的地方。最危险的错法是把它们渲染成同一种版式、
 * 只换一行说明文字：
 *
 *   - `REFERENCE`：四字母 + 类型名 + 八段解读，标题写「本次参考类型 XXXX」；
 *   - `TENTATIVE`：标题写「本次更接近 XXXX」，**必须**说明"这一侧只是略偏"，
 *     并同时给出另一侧的描述（`details` 里已经有）；
 *   - `TIED`：**绝不**出现任何四字母作为主标题，标题是「几个类型都值得一起看」，
 *     列出多个候选并说明为什么都可能，四维全部给出两端描述；
 *   - `NEEDS_REVIEW`：**没有报告可看**，说明还差什么。
 *
 * ## cost 不是"有多像"
 *
 * `candidate.cost` 是"换一个字母需要偏离多少证据"的规则距离。页面上**不许**
 * 把它读成概率、准确率、可能性或"分数高低"。文案由 `domain/reportV3.ts` 统一生成，
 * 页面只负责显示，避免同一句话在两个地方各写一遍。
 *
 * ## 过程层：不要把"推导"看成"测量"
 *
 * `dynamics` / `processPlan` 是由四字母按框架规则**推导**出来的结构，不是本次测出的
 * 另一组结果。因此这一块渲染时刻意做两件事：把 `basis` 与 `notes.frameworkCaveat`
 * 作为**可见正文**（不折叠、不缩成小字附注），并明确写出"推导规则版本"。
 * 两块在 TIED（没有四字母）时是 null，此时整块不渲染 —— **不编造、也不用本地推导补全**。
 */

const route = useRoute()
const router = useRouter()
const reports = useReportStore()
const instrument = useInstrumentV3Store()

const copying = ref(false)
const notice = ref<string | null>(null)
const confirmDelete = ref(false)
const reflectionType = ref('')
const reflectionNote = ref('')
const typeId = `report-self-type-${useId()}`
const noteId = `report-self-note-${useId()}`

const reportId = computed(() => (typeof route.params.reportId === 'string' ? route.params.reportId : null))
const view = computed<ReportViewModelV3 | null>(() => reports.view)
const plainReadings = computed(() => plainJungRows(view.value?.dimensionRows ?? []))

// 旧收藏链接也按报告实际种类分流，不能把大五交给四维解析器。
watch(() => reports.current, (current) => {
  const report = current?.report
  if (reportId.value && (report?.reportKind === 'big_five_profile' || report?.status === 'PROFILE')) {
    void router.replace({ name: 'big-five-report', params: { reportId: reportId.value } })
  }
})

/** 报告形状不符合契约：**不降级**成"看起来还行的报告"。 */
const shapeError = computed(() => reports.shapeError)

/**
 * 完整十六型（自选下拉用）。
 *
 * 由 `DIMENSIONS` 的两极组合出来，而不是抄一份 16 行字母表：抄一份就会在
 * "新测 TF/JP 正极与旧实现相反"这件事上留下第二个真相源。
 */
const TYPEME_TYPE_CODES: string[] = (() => {
  const poles = [
    ['I', 'E'],
    ['S', 'N'],
    ['T', 'F'],
    ['J', 'P'],
  ]
  let codes = ['']
  for (const pair of poles) {
    codes = codes.flatMap((prefix) => pair.map((pole) => `${prefix}${pole}`))
  }
  return codes.filter((code) => isLegalTypeCode(code)).sort()
})()

/** 自选下拉候选项：报告的候选与结果优先，其余补齐十六型。 */
const knownTypeCodes = computed(() => {
  const codes = new Set<string>(TYPEME_TYPE_CODES)
  for (const candidate of view.value?.candidates ?? []) codes.add(candidate.typeCode)
  if (view.value?.computedTypeCode) codes.add(view.value.computedTypeCode)
  return [...codes].filter((code) => isLegalTypeCode(code)).sort()
})

onMounted(() => {
  // 量表名要跟着这份报告走，而报告 JSON 里只有 methodology（包 ID / 版本 / 指纹），
  // 没有包标题 —— 包标题只在 `GET /api/v3/catalog/current` 上。访客在首页读过一次时
  // 该接口是 401（要求登录），所以这里在还没读到目录时补一次。
  if (!instrument.facts.fromCatalog) void instrument.refresh()
  if (reportId.value) void reports.loadReport(reportId.value)
  else void reports.loadList()
})

// 同一个组件同时承担 `/reports`（历史列表）与 `/reports/:reportId`（详情）：
// 两者共享"倒序、状态标签、删除、进详情"的全部规则，拆成两个组件只会让规则分叉。
watch(reportId, (value) => {
  if (value) void reports.loadReport(value)
  else {
    reports.clearCurrent()
    void reports.loadList()
  }
})

watch(
  () => view.value?.reportId,
  () => {
    reflectionType.value = view.value?.selfReflection.selfSelectedTypeCode ?? ''
    reflectionNote.value = view.value?.selfReflection.note ?? ''
  },
  { immediate: true },
)

/** 历史列表里的状态标签：与详情页的四状态口径一致。 */
const STATUS_LABEL: Record<string, string> = {
  REFERENCE: '参考类型',
  TENTATIVE: '倾向较轻',
  TIED: '几个方向并列',
  NEEDS_REVIEW: '信息不足（没有报告）',
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status
}

/** ISO 时间 → 用户时区的可读日期。 */
function formatTime(value: string | null): string {
  if (!value) return '没有记录时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const deleteTarget = ref<string | null>(null)

/**
 * 删除这类动作的结果与"列表能不能读"是两件事，提示也分开（2026-09-18 第 17 轮）。
 *
 * 以前删除失败会写进 `listError`，列表区把它渲染成「记录没能载入：…」并整块替换掉列表 ——
 * 用户会以为自己的历史记录都读不到了；而真相只是"这一份没删掉"。
 * 现在失败落在 `reports.removeError`（下面单独一块 alert），列表保持原样。
 */
async function removeFromList(target: string): Promise<void> {
  const ok = await reports.remove(target)
  deleteTarget.value = null
  notice.value = ok ? '报告已经删除（连同它的答案与 AI 记录）。' : null
}

async function copyShareText(): Promise<void> {
  const share = view.value?.share
  if (!share) return
  copying.value = true
  notice.value = null
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(share.text)
      notice.value = '已复制报告文字，可以直接粘贴给别人。'
    } else {
      throw new Error('这个浏览器不允许自动复制')
    }
  } catch {
    notice.value = `这个浏览器没能自动复制。可以手动选中下面这段文字：\n${share.text}`
  } finally {
    copying.value = false
  }
}

/**
 * 导出分享图。
 *
 * 图片的标题、文件名、替代文本**全部**取自同一份 `share`（页面/复制/图片/alt 唯一来源），
 * 所以三者永远说的是同一件事。
 */
async function downloadShareImage(): Promise<void> {
  const share = view.value?.share
  if (!share) return
  notice.value = null
  try {
    const blob = await renderShareBlob(share.imageTitle, share.headline, share.boundaryLine, share.text)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = share.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    // 交给浏览器之后立刻释放；image 元素不需要它了
    setTimeout(() => URL.revokeObjectURL(url), 0)
    notice.value = `已发起下载：${share.filename}`
  } catch (error) {
    notice.value = `图片没能生成：${error instanceof Error ? error.message : '未知原因'}。报告文字仍可复制。`
  }
}

/** 1080×1920 的分享卡片（与旧引擎同样的画布尺寸，文案来自新报告快照）。 */
async function renderShareBlob(
  imageTitle: string,
  headline: string,
  boundaryLine: string | null,
  text: string,
): Promise<Blob> {
  if (typeof document === 'undefined') throw new Error('分享图需要在浏览器里生成')
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1920
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 canvas 2d')
  // 2026-09-18 视觉重构：分享图换成与页面同一套色值（浅色纸面 + 藏青墨 + 蓝青），
  // 否则用户导出的图片会是一张"上一版设计"的图。
  ctx.fillStyle = '#F4F6F9'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // 顶部一条主色带：与页面深色概览面板形成同一个视觉签名
  ctx.fillStyle = '#14617A'
  ctx.fillRect(0, 0, canvas.width, 18)
  ctx.fillStyle = '#0D1B2A'
  ctx.textAlign = 'center'
  ctx.font = '500 36px system-ui, sans-serif'
  ctx.fillText(imageTitle, 540, 300)
  ctx.font = '700 96px system-ui, sans-serif'
  wrapLines(ctx, headline, 900).forEach((line, index) => {
    ctx.fillText(line, 540, 480 + index * 120)
  })
  let y = 760
  if (boundaryLine) {
    ctx.font = '400 34px system-ui, sans-serif'
    ctx.fillStyle = '#48586A'
    wrapLines(ctx, boundaryLine, 900).forEach((line) => {
      ctx.fillText(line, 540, y)
      y += 48
    })
    y += 24
  }
  ctx.font = '400 32px system-ui, sans-serif'
  ctx.fillStyle = '#48586A'
  wrapLines(ctx, text, 900).forEach((line) => {
    ctx.fillText(line, 540, y)
    y += 46
  })
  ctx.font = '400 28px system-ui, sans-serif'
  ctx.fillStyle = '#5B6B7F'
  ctx.fillText('参考测评，不是诊断 · 内容仍在内部审校中', 540, 1780)

  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((value) => resolve(value), 'image/png')
    } catch {
      resolve(null)
    }
  })
  if (!blob || blob.size === 0) throw new Error('canvas 没有产出图片数据')
  return blob
}

/**
 * 按宽度折行。
 *
 * 中文没有空格，`\n` 之外无法靠 word wrap 断句，所以按**字符**累计宽度 —— 与旧分享图
 * 同一套做法（那边也是逐字测量）。
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (ctx.measureText(line + char).width > maxWidth && line) {
        lines.push(line)
        line = char
      } else {
        line += char
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

async function saveReflection(): Promise<void> {
  const selected = reflectionType.value.trim()
  if (selected && !isLegalTypeCode(selected)) {
    notice.value = '自选类型必须是四个字母（例如 INFP）。'
    return
  }
  await reports.saveReflection({
    selfSelectedTypeCode: selected || null,
    note: reflectionNote.value,
  })
  notice.value = reports.reflectionNotice
}

async function removeReport(): Promise<void> {
  const target = view.value?.reportId ?? reportId.value
  if (!target) {
    confirmDelete.value = false
    return
  }
  const ok = await reports.remove(target)
  confirmDelete.value = false
  notice.value = ok ? '报告已经删除（连同它的答案与 AI 记录）。' : null
}

/**
 * 概览面板右侧的那句状态说明。
 *
 * 它替代了旧版"每种状态一套标题"的做法：三种状态的**版式相同**，
 * 差别只在有没有类型码、以及这句话 —— 平分不该因为"没测出类型"看起来更低一等。
 * 三句话都刻意不含「本次参考类型 / 本次更接近」这类措辞：
 * 那是 `share.headline` 的职责，两处都写就会互相矛盾。
 */
const overviewNote = computed(() => {
  switch (view.value?.status) {
    case 'REFERENCE':
      return '这次回答在四个方面都有偏向，仍只作参考'
    case 'TENTATIVE':
      return '至少一个方面的差距很小，还不能当成确定的类型'
    case 'TIED':
      return '有些方面两边得分相同，这次不选出唯一类型'
    default:
      return ''
  }
})

/**
 * 报告目录。
 *
 * 长报告最大的问题是"读完不知道读到哪、也没法跳" —— 这里按**当前这份报告实际
 * 渲染出来的区块**生成目录（没有过程层就不列过程层那一节），每一条都能滚到对应位置。
 *
 * ⚠️ 点击用的是 `scrollIntoView` 而**不是** `<a href="#id">`：本站路由是 hash 模式，
 * 浏览器会把 `#report-dynamics` 当成一次路由跳转，用户会落到一个不存在的路由上。
 */
const TOC = computed(() => {
  const report = view.value
  if (!report) return []
  const items: { id: string; label: string }[] = [{ id: 'report-overview', label: '结果概览' }]
  items.push({ id: 'report-dimensions', label: '四个维度' })
  if (report.boundaryNotes.length > 0) items.push({ id: 'report-boundaries', label: '哪几维只是略偏' })
  if (report.candidates.length > 0) items.push({ id: 'report-candidates', label: '还可以一起看的方向' })
  if (report.typeSections.length > 0) items.push({ id: 'report-sections', label: '这一型的读法' })
  if (report.nextActions.length > 0) items.push({ id: 'report-actions', label: '可以试试' })
  if (report.dynamics) items.push({ id: 'report-dynamics', label: '四个精神活动过程' })
  if (report.processPlan) items.push({ id: 'report-process-plan', label: '按这套结构可以做的事' })
  items.push({ id: 'report-self', label: '你自己的理解' })
  items.push({ id: 'report-share', label: '带走这份报告' })
  items.push({ id: 'report-ai', label: 'AI 分析（可选）' })
  items.push({ id: 'report-method', label: '这份报告是怎么来的' })
  return items
})

/**
 * 这份快照自己记下的计分门槛。
 *
 * 包 ID、指纹、规则版本号不给普通用户看；但覆盖条件和略偏公式必须跟这份快照的
 * 政策版本走——v1/v2 会再收紧一档，不能用 v3 的句子去解释旧报告。
 */
const methodThresholds = computed(() => {
  const methodology = view.value?.methodology
  return methodology ? describeSnapshotThresholds(methodology) : null
})

/** 目录跳转：滚动 + 把焦点交给目标区块（键盘与读屏用户才不会"跳完不知道到哪了"）。 */
function jumpToSection(id: string): void {
  const target = document.getElementById(id)
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}
</script>

<template>
  <PageContainer page="result">
    <!-- ══ 历史列表：/reports ══════════════════════════════════════════ -->
    <section v-if="!reportId" data-report-list>
      <header>
        <p class="section-kicker">历史报告</p>
        <h1 class="mt-2 font-display text-[24px] font-bold leading-tight text-ink tablet:text-[30px]">
          你的测评记录
        </h1>
        <p class="mt-3 prose-cn">
          按时间倒序排列。报告是提交那一刻的快照，之后改答不会改它 —— 想对比就再来一次。
        </p>
        <!--
          复测比较的入口（2026-09-17 新增）。只在**至少两份**报告时才显示：
          做成常驻链接的话，只有一份报告的用户点进去只会看到一句"还不满两份"，
          那是把"这个功能现在对你没用"变成一个需要点击才发现的事实。
        -->
        <p v-if="reports.listDescending.length >= 2" class="mt-3">
          <RouterLink to="/reports/compare" class="btn-secondary btn-sm" data-compare-entry>
            把两次测评放在一起看
          </RouterLink>
        </p>
      </header>

      <div v-if="reports.listError" class="notice-error mt-5" role="alert">
        <p class="text-[14.5px] font-medium">记录没能载入：{{ reports.listError.message }}</p>
        <button type="button" class="btn-secondary mt-3" @click="reports.loadList()">重试</button>
      </div>

      <p v-else-if="reports.listLoading" class="mt-6 text-[15px] text-ink-soft">正在载入记录…</p>

      <p v-else-if="reports.listDescending.length === 0" class="notice-neutral mt-6 text-[14px] leading-relaxed">
        还没有完成的测评。做完一次之后，报告会出现在这里，换设备登录也能看到。
      </p>

      <ul v-else class="mt-6 space-y-3">
        <li
          v-for="item in reports.listDescending"
          :key="item.reportId"
          class="rounded-question border border-line bg-surface px-4 py-4 shadow-card transition-shadow hover:shadow-lift tablet:px-5"
          :data-report-row="item.reportId"
        >
          <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <span class="font-display text-[22px] font-bold leading-none tracking-[0.04em] text-ink">
                  {{ item.computedTypeCode ?? '——' }}
                </span>
                <span class="chip" :class="item.status === 'REFERENCE' ? 'chip-primary' : item.status === 'NEEDS_REVIEW' ? 'chip-neutral' : 'chip-accent'">
                  {{ statusLabel(item.status) }}
                </span>
              </p>
              <p v-if="!item.computedTypeCode" class="mt-1.5 text-[13px] text-ink-faint">这一份没有单一类型</p>
            </div>
            <p class="text-[13px] text-ink-faint">{{ formatTime(item.createdAt) }}</p>
          </div>
          <p v-if="item.summaryLine" class="mt-2.5 max-w-[46rem] text-[14px] leading-relaxed text-ink-soft">
            {{ item.summaryLine }}
          </p>
          <p v-if="item.selfSelectedTypeCode" class="mt-1 text-[13px] text-ink-faint">
            你自己觉得更像：{{ item.selfSelectedTypeCode }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <RouterLink :to="`/reports/${item.reportId}`" class="btn-secondary btn-sm">打开报告</RouterLink>
            <button
              type="button"
              class="btn-ghost btn-sm"
              :data-delete-report="item.reportId"
              :disabled="reports.removingId !== null"
              @click="deleteTarget = item.reportId"
            >
              {{ reports.removingId === item.reportId ? '正在删除…' : '删除' }}
            </button>
          </div>
        </li>
      </ul>
    </section>

    <template v-else>
    <!--
      404 的两种含义必须分开说（2026-09-18 第 17 轮）：
        - 按 attempt 取（交卷那条路）→ 这次尝试**还没有报告**（信息不足），是预期内的状态，
          该说清还差什么、给一条回去补答的路；
        - 按 reportId 取（`/reports/{id}`，也就是这一页实际走的路）→ **这份报告不在这里**：
          它可能已被删除、编号有误，或者链接属于别的账号。这跟"你有没有答完"毫无关系。
      以前两种情况共用一套文案，于是删掉一份报告后按浏览器后退，用户会被告知
      "你还没做完"，并被送去重新测一次 —— 这既不是事实，也丢掉了真正的下一步。
    -->
    <div v-if="reports.notFound" class="card" data-status="NEEDS_REVIEW" data-report-not-found>
      <template v-if="reports.loadedByAttempt">
        <p class="section-kicker">信息不足</p>
        <h1 class="mt-2 font-display text-[24px] font-bold leading-tight text-ink tablet:text-[30px]">
          这次测评还没有报告可看
        </h1>
        <p class="mt-3 prose-cn">
          报告不是每题一答就开始生成的：有维度没达到最少有效作答数时，我们宁可不出报告，
          也不出一份看起来完整、实际上靠默认值拼出来的结论。
        </p>
        <ul class="mt-4 space-y-2 prose-cn">
          <li class="list-dot">可能有题目还没处理（既没有选，也没有标「这题我说不好」）。</li>
          <li class="list-dot">也可能某个维度的有效作答太少，或者补充题被跳过了。</li>
          <li class="list-dot">
            回到答题页时会直接告诉你是哪几个维度、还差几题 —— 不写"信息不足"四个字了事。
          </li>
        </ul>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <RouterLink to="/assess" class="btn-primary">回去把没处理的题补齐</RouterLink>
          <RouterLink to="/reports" class="btn-secondary">回到历史报告</RouterLink>
        </div>
      </template>

      <template v-else>
        <p class="section-kicker">报告不在这里</p>
        <h1 class="mt-2 font-display text-[24px] font-bold leading-tight text-ink tablet:text-[30px]">
          这份报告打不开了
        </h1>
        <p class="mt-3 prose-cn">
          服务端说没有这份报告。常见的原因有三个，都不是"系统坏了"：
        </p>
        <ul class="mt-4 space-y-2 prose-cn">
          <li class="list-dot">它已经被删除了（删除是立刻生效的，链接会失效）。</li>
          <li class="list-dot">这个链接属于另一个账号 —— 报告只对生成它的账号可见。</li>
          <li class="list-dot">链接里的编号不完整或被改动过。</li>
        </ul>
        <p class="mt-3 prose-cn text-[13.5px] text-ink-soft">
          如果这份报告是刚刚生成的，可以
          <button type="button" class="link" @click="reports.loadReport(reportId ?? '')">再读一次</button>；
          已经交卷的测评不会因为打不开这一页而消失。
        </p>
        <div class="mt-5 flex flex-wrap items-center gap-3">
          <RouterLink to="/reports" class="btn-primary">回到历史报告</RouterLink>
          <RouterLink to="/assess" class="btn-secondary">重新做一次测评</RouterLink>
        </div>
      </template>
    </div>

    <!-- 载入失败（真的出错了，不是"还没做完"） -->
    <div v-else-if="reports.loadError" class="notice-error" role="alert">
      <p class="text-[15px] font-medium">这份报告没能打开：{{ reports.loadError.message }}</p>
      <p v-if="reports.loadError.requestId" class="mt-1 break-all text-[12.5px]">
        报障编号：<code class="font-mono">{{ reports.loadError.requestId }}</code>
      </p>
      <RouterLink to="/reports" class="btn-secondary mt-3 inline-flex">回到历史报告</RouterLink>
    </div>

    <p v-else-if="reports.loading" class="text-[15px] text-ink-soft">正在打开报告…</p>

    <!-- 报告形状不符合契约：明确说读不出来，不给一份"看起来还行"的报告 -->
    <div v-else-if="shapeError" class="notice-error" role="alert" data-shape-error>
      <p class="text-[15px] font-medium">这份报告的内容读不出来</p>
      <p class="mt-1 text-[13.5px] leading-relaxed">{{ shapeError }}</p>
      <p class="mt-1 text-[13px] leading-relaxed">
        页面不会用默认值补齐缺失字段 —— 那样会显示一份看起来正常、实际上是我们编的报告。
      </p>
    </div>

    <template v-else-if="view">
      <!--
        正文与目录的布局：手机单列（目录在最上面一排 chip），laptop 起变成
        「正文 + 右侧粘性目录」。用 `flex flex-col` 打底、`laptop:grid` 覆盖，
        是为了让 `order-first`（手机把目录提到最前）与 `laptop:order-none`
        （桌面回到"正文在左、目录在右"的源码顺序）能同时成立 —— 只用一个
        grid 时 `order` 会连列位置一起改掉，目录会跑到左列去。
      -->
      <div
        class="flex flex-col gap-6 laptop:grid laptop:grid-cols-[minmax(0,1fr)_14rem] laptop:items-start laptop:gap-10"
      >
        <div class="min-w-0">
          <!-- ══ 结果概览：暖白个人档案 ═══════════════════════════════════
            三种状态共用一块面板，靠 `:data-status` 区分 —— 状态之间的差别由
            里面的**文案与有没有类型码**表达，而不是换一套版式：
            平分时不该因为"没测出类型"就被降级成一张灰卡片。
          -->
          <article
            id="report-overview"
            data-anchor
            data-report-overview
            class="report-paper scroll-mt-24"
            :data-status="view.status"
          >
            <p class="report-paper-label">TYPEME / 个人探索档案</p>
            <p class="report-paper-status">
              <span class="chip">{{ statusLabel(view.status) }}</span>
              <span data-status-note>{{ overviewNote }}</span>
            </p>

            <div class="report-paper-identity">
              <p
                v-if="view.typeCode"
                class="report-paper-code"
                data-type-code
              >
                {{ view.typeCode }}
              </p>
              <div class="min-w-0">
                <h1
                  class="report-paper-title"
                  :data-tied-title="view.status === 'TIED' || null"
                >
                  {{ view.headline }}
                </h1>
                <p
                  v-if="view.typeNameCn"
                  class="report-paper-name"
                  data-type-name
                >
                  {{ view.typeNameCn }}
                </p>
              </div>
            </div>

            <!--
              略偏与平分必须当场说清楚 —— 这两处最容易被读成"结果很确定"。
              用日常语言解释差距，同时保留略偏、两端与不指定唯一类型的含义。
            -->
            <p
              v-if="view.status === 'TENTATIVE'"
              class="report-paper-notice"
              data-tentative-notice
            >
              有些方面只是略偏：你选择两端做法的差距不大。这些地方的两种描述都值得读，不必急着认定自己只属于一边。
            </p>
            <p
              v-else-if="view.status === 'TIED'"
              class="report-paper-notice"
              data-tied-notice
            >
              有些方面两边得分相同，所以没有哪一个四字母类型更适合当主标题。可以一起看看几种描述，这次不必选出唯一答案。
            </p>

            <div class="report-paper-summary" data-plain-report>
              <p class="font-semibold">先看这四句话，就能了解这次结果</p>
              <p class="mt-2 text-[12.5px]">下面根据你这次的回答说明，不代表你一直如此，也不是能力评价。</p>
              <ul class="plain-report-list"><li v-for="reading in plainReadings" :key="reading.title"><h2>{{ reading.title }}</h2><p>{{ reading.result }}</p></li></ul>
              <details class="mt-4"><summary class="cursor-pointer text-[13px]">查看保存时的完整摘要</summary><p class="mt-2">{{ view.summary }}</p></details>
            </div>
            <figure v-if="view.typeCode" class="report-character-study" data-report-character>
              <PersonalityPortrait :code="view.typeCode" /><figcaption><span>类型生活速写</span><p>一种理解自己的角度，<br>不是你必须活成的样子。</p><small>角色为原创插画，不是额外测量。</small></figcaption>
            </figure>
          </article>

          <!-- ══ 四维得分条 ════════════════════════════════════════════════ -->
          <section class="mt-10 scroll-mt-24" id="report-dimensions" data-anchor aria-labelledby="report-dimensions-title">
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">01</span>
              <h2 id="report-dimensions-title" class="section-title">四个方面，分别怎么看</h2>
            </div>
            <p class="mt-2 max-w-[42rem] text-[13.5px] leading-relaxed text-ink-soft">
              位置点表示本次作答落在两端之间的哪个地方。靠哪一端都不是「更好」，
              只是这一侧的解释更贴近本次的作答。
            </p>
            <div class="mt-4 space-y-3">
              <div v-for="(row, index) in view.dimensionRows" :key="row.dimension">
              <p class="reading-example"><span>{{ plainReadings[index]?.title }} · 举个例子</span>{{ plainReadings[index]?.example }}例子只帮助理解，不代表你一定经历过。</p>
              <DimensionMeter
                :row="row"
                :index="index"
                show-details
              />
              </div>
            </div>
          </section>

          <!-- ══ 边界说明（TENTATIVE 必看） ═══════════════════════════════ -->
          <section
            v-if="view.boundaryNotes.length > 0"
            id="report-boundaries"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-boundaries"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">02</span>
              <h2 id="report-boundaries" class="section-title">哪几维只是略偏</h2>
            </div>
            <ul class="mt-3 space-y-2">
              <li v-for="(note, index) in view.boundaryNotes" :key="index" class="notice-uncertain text-[14px] leading-relaxed">
                {{ note }}
              </li>
            </ul>
          </section>

          <!-- ══ 候选类型 ═════════════════════════════════════════════════ -->
          <section
            v-if="view.candidates.length > 0"
            id="report-candidates"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-candidates-title"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">03</span>
              <h2 id="report-candidates-title" class="section-title">还可以一起看的方向</h2>
            </div>
            <p class="mt-2 max-w-[42rem] text-[13.5px] leading-relaxed text-ink-soft">
              下面的「需要偏离 N 分证据」是规则换算：换一个字母需要偏离多少本次作答的证据量。
              它不是概率、不是准确率、不是可能性，也不表示谁更准。
            </p>
            <p v-if="view.tieNotice" class="notice-neutral mt-3 text-[13.5px] leading-relaxed" data-tie-notice>
              {{ view.tieNotice }}
            </p>
            <ul class="mt-3 grid gap-3 tablet:grid-cols-2" data-candidate-list>
              <li
                v-for="candidate in view.candidates"
                :key="candidate.typeCode"
                class="rounded-card border border-line bg-surface px-4 py-3.5 shadow-card"
                :data-candidate="candidate.typeCode"
              >
                <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span class="font-display text-[19px] font-bold tracking-[0.05em] text-ink">{{ candidate.typeCode }}</span>
                  <span v-if="candidate.isComputedDirection" class="chip chip-primary">本次方向本身</span>
                  <span class="text-[12.5px] text-ink-faint">需要偏离 {{ candidate.cost }} 分证据</span>
                </p>
                <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft" data-cost-text>
                  {{ candidate.costText }}
                </p>
                <p class="mt-1 text-[13px] leading-relaxed text-ink-faint" data-differs-text>
                  {{ candidate.differsText }}
                </p>
              </li>
            </ul>
          </section>

          <!-- ══ 八段解读 ═════════════════════════════════════════════════ -->
          <section
            v-if="view.typeSections.length > 0"
            id="report-sections"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-sections-title"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">04</span>
              <h2 id="report-sections-title" class="section-title">这一型的读法</h2>
            </div>
            <div class="mt-4 divide-y divide-line border-y border-line">
              <details v-for="(section, index) in view.typeSections" :key="section.key" class="py-4">
                <summary class="cursor-pointer text-[16px] font-semibold text-ink">
                  <span class="section-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                  {{ section.title }}
                </summary>
                <p v-for="(paragraph, paragraphIndex) in readingParagraphs(section.body)" :key="paragraphIndex" class="mt-3 max-w-[46rem] text-[14.5px] leading-[1.9] text-ink-soft">{{ paragraph }}</p>
              </details>
            </div>
          </section>

          <!-- ══ 可以试试 ═════════════════════════════════════════════════ -->
          <section
            v-if="view.nextActions.length > 0"
            id="report-actions"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-actions-title"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">05</span>
              <h2 id="report-actions-title" class="section-title">可以试试</h2>
            </div>
            <div class="mt-4 grid gap-3 tablet:grid-cols-2">
              <article
                v-for="action in view.nextActions"
                :key="action.title"
                class="rounded-question border border-line bg-surface px-4 py-4 shadow-card"
              >
                <h3 class="flex items-start gap-2 text-[15.5px] font-semibold text-ink">
                  <AppIcon name="steps" :size="17" class="mt-1 text-primary-600" />
                  {{ action.title }}
                </h3>
                <ol class="mt-3 space-y-2">
                  <li
                    v-for="(step, index) in action.steps"
                    :key="index"
                    class="flex gap-2.5 text-[13.5px] leading-relaxed text-ink-soft"
                  >
                    <span class="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-50 text-[11px] font-semibold text-primary-700">
                      {{ index + 1 }}
                    </span>
                    <span>{{ step }}</span>
                  </li>
                </ol>
              </article>
            </div>
          </section>

          <details v-if="view.dynamics || view.processPlan" class="mt-10 rounded-card border border-line p-4">
            <summary class="cursor-pointer font-semibold">进阶阅读：由类型推导的理论说明（不是额外测量）</summary>
          <!-- ══ 四个过程（由四字母推导，不是测量） ═══════════════════════ -->
          <!--
            这一块的全部意义就是"不能让它被读成测量结果"，所以 `basis` 与
            `notes.frameworkCaveat` **必须**是可见文字，而不是折叠起来的附注：
            读者看到四个过程，最自然的误解就是"这是测出来的另外四个分数"。
          -->
          <section
            v-if="view.dynamics"
            id="report-dynamics"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-dynamics-title"
            data-dynamics
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <span class="section-index" aria-hidden="true">06</span>
              <h2 id="report-dynamics-title" class="section-title">四个精神活动过程</h2>
              <span class="chip chip-accent">由 {{ view.dynamics.typeCode }} 推导</span>
            </div>
            <p class="mt-2 max-w-[42rem] text-[13.5px] leading-relaxed text-ink-soft">
              下面这四个过程是由四个字母（{{ view.dynamics.typeCode }}）按这套框架的规则
              <strong class="font-medium text-ink">推导</strong>出来的，不是本次问卷另外测出来的结果。
            </p>
            <p class="notice-uncertain mt-3 text-[13.5px] leading-relaxed" data-dynamics-basis>
              {{ view.dynamics.basis }}
            </p>
            <p class="notice-neutral mt-2 text-[13.5px] leading-relaxed" data-dynamics-caveat>
              {{ view.dynamics.notes.frameworkCaveat }}
            </p>
            <p class="mt-3 text-[13.5px] leading-relaxed text-ink-soft" data-dynamics-rule>
              {{ view.dynamics.rule }}
            </p>
            <p class="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
              推导规则版本：{{ view.dynamics.version }}
            </p>

            <div class="mt-4 grid gap-3 tablet:grid-cols-2">
              <article
                v-for="process in view.dynamics.processes"
                :key="process.slot"
                class="rounded-question border border-line bg-surface px-4 py-4 shadow-card"
                :class="process.preferred ? 'border-primary-200' : ''"
                :data-process="process.process"
              >
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 class="flex items-baseline gap-2 text-[16px] font-semibold text-ink">
                    <span
                      class="font-display text-[15px] font-bold text-primary-700"
                      aria-hidden="true"
                      >{{ process.process }}</span
                    >
                    {{ process.roleTitle }} · {{ process.nameCn }}
                  </h3>
                  <span class="chip" :class="process.preferred ? 'chip-primary' : 'chip-neutral'">
                    {{ process.preferred ? '用起来最省力的一侧' : '还没有偏好的过程' }} · 第 {{ process.order }} 位
                  </span>
                </div>
                <p class="mt-2.5 text-[14.5px] leading-relaxed text-ink">{{ process.what }}</p>
                <p class="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{{ process.reading }}</p>
              </article>
            </div>

            <!-- 边界维度：换到另一侧，结构会怎么变（比"另一侧也值得读"具体得多） -->
            <div v-if="view.dynamics.boundaryNotes.length > 0" class="mt-5" data-dynamics-boundaries>
              <h3 class="text-[15.5px] font-semibold text-ink">这一维若落到另一侧，结构会这样变</h3>
              <ul class="mt-2 space-y-2">
                <li
                  v-for="note in view.dynamics.boundaryNotes"
                  :key="note.dimension"
                  class="notice-uncertain text-[13.5px] leading-relaxed"
                  :data-boundary-note="note.dimension"
                >
                  {{ note.note }}
                </li>
              </ul>
            </div>
          </section>

          <!-- ══ 由过程结构派生的建议 ═══════════════════════════════════════ -->
          <section
            v-if="view.processPlan"
            id="report-process-plan"
            data-anchor
            class="mt-10 scroll-mt-24"
            aria-labelledby="report-process-plan-title"
            data-process-plan
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">07</span>
              <h2 id="report-process-plan-title" class="section-title">按这套结构可以做的事</h2>
            </div>
            <p class="mt-2 max-w-[42rem] text-[13.5px] leading-relaxed text-ink-soft">
              下面的建议都由上面那四个过程派生而来，同样不是另一次测量的结论。
              四个过程没有高下：主导只是「用起来最省力」的那一个。
            </p>

            <!-- 三段发展任务 -->
            <div class="mt-4 space-y-3" data-development-order>
              <article
                v-for="stage in view.processPlan.developmentOrder"
                :key="stage.order"
                class="rounded-question border border-line bg-surface px-4 py-4 shadow-card"
                :data-development-stage="stage.order"
              >
                <h3 class="flex items-baseline gap-2 text-[16px] font-semibold text-ink">
                  <span class="section-index" aria-hidden="true">{{ String(stage.order).padStart(2, '0') }}</span>
                  {{ stage.title }}
                </h3>
                <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">{{ stage.body }}</p>
                <ul class="mt-2.5 space-y-2">
                  <li
                    v-for="item in stage.processes"
                    :key="item.process"
                    class="rounded-control border border-line-soft bg-surface-soft px-3 py-2.5"
                    :data-development-process="item.process"
                  >
                    <p class="text-[13.5px] font-medium text-ink">{{ item.process }} · {{ item.nameCn }}</p>
                    <p class="mt-1 text-[13px] leading-relaxed text-ink-soft">{{ item.body }}</p>
                  </li>
                </ul>
              </article>
            </div>

            <!-- 四步决策法（顺序固定：感觉 → 直觉 → 思考 → 情感） -->
            <div class="mt-6" data-decision-plan>
              <h3 class="text-[16px] font-semibold text-ink">拿四个过程过一遍一个决定</h3>
              <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
                {{ view.processPlan.decisionIntro }}
              </p>
              <ol class="mt-3 space-y-3">
                <li
                  v-for="step in view.processPlan.decisionSteps"
                  :key="step.order"
                  class="rounded-question border px-4 py-4 shadow-card"
                  :class="step.preferred ? 'border-line bg-surface' : 'border-accent-200 bg-accent-50'"
                  :data-decision-step="step.function"
                >
                  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 class="flex items-baseline gap-2 text-[15.5px] font-semibold text-ink">
                      <span class="section-index" aria-hidden="true">{{ String(step.order).padStart(2, '0') }}</span>
                      {{ step.title }}
                    </h4>
                    <span class="chip" :class="step.preferred ? 'chip-primary' : 'chip-accent'">
                      {{ step.slotTitle }} · {{ step.process }}
                    </span>
                  </div>
                  <!--
                    「用不上你偏好的功能」两步必须**显式**标出来：跳过决策步骤的人，
                    跳过的往往正是与自己不同的那两步，而这两步恰恰是最需要外部补上的。
                  -->
                  <p
                    v-if="!step.preferred"
                    class="mt-2.5 inline-block rounded-pill border border-accent-200 bg-surface px-2.5 py-1 text-[12.5px] font-medium text-accent-700"
                    data-decision-unpreferred
                  >
                    这一步用不上你偏好的功能
                  </p>
                  <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{{ step.prompt }}</p>
                  <p class="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{{ step.how }}</p>
                </li>
              </ol>
              <p class="mt-2 text-[13px] leading-relaxed text-ink-soft">{{ view.processPlan.decisionNote }}</p>
              <div class="notice-uncertain mt-3" data-hardest-note>
                <p v-if="view.processPlan.hardestSteps.length > 0" class="text-[13.5px] font-medium text-ink">
                  最容易整段跳过的两步：{{ view.processPlan.hardestSteps.join('、') }}
                </p>
                <p class="mt-1 text-[13px] leading-relaxed">{{ view.processPlan.hardestStepsNote }}</p>
              </div>
            </div>

            <!-- 互补的一侧（只覆盖 SN / TF 两轴） -->
            <div class="mt-6" data-opposites>
              <h3 class="text-[16px] font-semibold text-ink">和你不同的人，能补上什么</h3>
              <div class="mt-3 grid gap-3 tablet:grid-cols-2">
                <article
                  v-for="item in view.processPlan.opposites"
                  :key="item.axis"
                  class="rounded-question border border-line bg-surface px-4 py-4"
                  :data-opposite="item.axis"
                >
                  <h4 class="text-[15px] font-semibold text-ink">
                    {{ item.axisName }}：你偏 {{ item.yourPole }}，另一侧是 {{ item.needPole }}
                  </h4>
                  <p class="mt-2 text-[13.5px] leading-relaxed text-ink">{{ item.need }}</p>
                  <p class="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{{ item.supply }}</p>
                </article>
              </div>
            </div>

            <!-- 按自己那一侧给的沟通规则 -->
            <div class="mt-6" data-communication-rules>
              <h3 class="text-[16px] font-semibold text-ink">和另一侧的人说事时</h3>
              <div class="mt-3 space-y-3">
                <article
                  v-for="rule in view.processPlan.communicationRules"
                  :key="rule.axis"
                  class="rounded-question border border-line bg-surface px-4 py-4"
                  :data-communication-rule="rule.axis"
                >
                  <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h4 class="text-[15px] font-semibold text-ink">{{ rule.title }}</h4>
                    <p class="text-[12.5px] text-ink-faint">{{ rule.axisName }} · 你偏 {{ rule.yourPole }}</p>
                  </div>
                  <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{{ rule.body }}</p>
                </article>
              </div>
            </div>

            <div class="mt-6 space-y-2" data-process-notes>
              <p class="notice-neutral text-[13.5px] leading-relaxed" data-development-note>
                {{ view.processPlan.notes.developmentNote }}
              </p>
              <p class="notice-neutral text-[13.5px] leading-relaxed" data-grey-area-note>
                {{ view.processPlan.notes.greyAreaNote }}
              </p>
            </div>
          </section>

          </details>

          <!-- ══ 自我理解（与问卷结果并列，不覆盖） ═════════════════════════ -->
          <section
            id="report-self"
            data-anchor
            class="mt-10 scroll-mt-24 rounded-question border border-line bg-surface px-4 py-5 shadow-card tablet:px-6"
            aria-labelledby="report-self-title"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">08</span>
              <h2 id="report-self-title" class="section-title">你自己的理解</h2>
            </div>
            <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
              问卷结果是问卷算出来的；这里是你自己的判断。两者分开显示，
              <strong class="font-medium text-ink">谁都不会覆盖谁</strong>。
            </p>
            <div class="mt-4 grid gap-4 tablet:grid-cols-[10rem_minmax(0,1fr)]">
              <div>
                <label :for="typeId" class="block text-[14px] font-medium text-ink">你更认同哪一型</label>
                <select
                  :id="typeId"
                  v-model="reflectionType"
                  class="mt-1.5 min-h-[44px] w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
                >
                  <option value="">暂不确定</option>
                  <option v-for="code in knownTypeCodes" :key="code" :value="code">{{ code }}</option>
                </select>
              </div>
              <div>
                <label :for="noteId" class="block text-[14px] font-medium text-ink">想补充的话（最多 300 字）</label>
                <textarea
                  :id="noteId"
                  v-model="reflectionNote"
                  rows="3"
                  maxlength="300"
                  class="mt-1.5 w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
                />
              </div>
            </div>
            <button type="button" class="btn-primary mt-3" data-save-reflection :disabled="reports.savingReflection" @click="saveReflection">
              {{ reports.savingReflection ? '正在保存…' : '保存我的理解' }}
            </button>
            <p v-if="view.selfReflection.updatedAt" class="mt-2 text-[12.5px] text-ink-faint">
              上次保存：{{ view.selfReflection.updatedAt }}
            </p>
          </section>

          <!-- ══ 分享与导出 ═══════════════════════════════════════════════ -->
          <section
            id="report-share"
            data-anchor
            class="mt-10 scroll-mt-24 rounded-question border border-line bg-surface px-4 py-5 shadow-card tablet:px-6"
            aria-labelledby="report-share-title"
          >
            <div class="flex items-baseline gap-3">
              <span class="section-index" aria-hidden="true">09</span>
              <h2 id="report-share-title" class="section-title">带走这份报告</h2>
            </div>
            <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
              复制的文字、导出的图片、图片的替代文本都来自同一份报告快照，说的永远是同一件事。
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button type="button" class="btn-primary" data-copy-share :disabled="copying" @click="copyShareText">
                <AppIcon name="copy" :size="17" />
                {{ copying ? '正在复制…' : '复制报告文字' }}
              </button>
              <button type="button" class="btn-secondary" data-download-share @click="downloadShareImage">
                <AppIcon name="download" :size="17" />
                导出分享图（{{ view.share.filename }}）
              </button>
            </div>
            <!-- alt 与复制文字都展示出来，便于人工核对（图片的 alt 也用它） -->
            <div class="mt-4 space-y-2">
              <p class="text-[13px] text-ink-soft">
                图片替代文本：<span class="text-ink">{{ view.share.alt }}</span>
              </p>
              <pre class="whitespace-pre-wrap rounded-card border border-line-soft bg-surface-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft" data-share-text>{{ view.share.text }}</pre>
            </div>
          </section>
        </div>

        <!--
          报告目录：手机在最上面一排可横向换行的 chip，laptop 起变成右侧粘性目录。
          它列的是**这份报告实际渲染出来的区块**（没有过程层就不列那一节），
          所以不会出现"点了没反应"的死链。
        -->
        <aside class="order-first laptop:order-none laptop:sticky laptop:top-6 laptop:self-start">
          <nav
            class="rounded-card border border-line bg-surface px-3 py-3 shadow-card laptop:px-3.5 laptop:py-4"
            aria-label="报告目录"
          >
            <p class="section-kicker hidden laptop:mb-2 laptop:block">报告目录</p>
            <button type="button" class="flex min-h-[44px] w-full items-center justify-between text-[14px] font-medium laptop:hidden"
              :aria-expanded="mobileTocOpen" aria-controls="report-navigation" @click="mobileTocOpen = !mobileTocOpen">
              查看报告目录 <span aria-hidden="true">{{ mobileTocOpen ? '−' : '+' }}</span>
            </button>
            <ul id="report-navigation" class="flex-wrap gap-1.5 laptop:flex laptop:flex-col laptop:gap-0.5" :class="mobileTocOpen ? 'flex' : 'hidden'">
              <li v-for="item in TOC" :key="item.id">
                <button
                  type="button"
                  class="inline-flex min-h-[44px] items-center rounded-control px-2.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-primary-50 hover:text-primary-700 laptop:min-h-[36px] laptop:w-full"
                  :data-toc="item.id"
                  @click="jumpToSection(item.id)"
                >
                  {{ item.label }}
                </button>
              </li>
            </ul>
            <p class="mt-3 hidden border-t border-line-soft pt-3 text-[12px] leading-relaxed text-ink-faint laptop:block">
              读完一层想回看时点这里。报告是一次提交的快照，之后改答不会改它。
            </p>
          </nav>
        </aside>
      </div>

      <!-- ══ AI 分析（可选，独立于上面的固定报告） ═════════════════════ -->
      <!--
        位置是刻意的：放在「带走这份报告」之后、「这份报告是怎么来的」之前。
        固定报告到此已经完整，AI 只是多一段视角 —— 放在最上面会让用户误以为
        不生成 AI 就没有报告。`reportId` 为 null 时（列表页）不渲染。
        它**不在**上面的两栏网格里：这是有意让 AI 洞察占满整个内容宽度，
        与"报告正文是阅读栏、AI 是一块独立区域"的层次一致。
      -->
      <!--
        `:key` 是必须的，不是保险：面板内部是一个 App 级单例 store（`aiAnalysisV3`），
        它的 `jobs` 曾经会跨越报告边界（B 的首屏渲染出 A 的分析）。
        加上 key 之后换报告必定重新挂载 → `onMounted` 重新按新 reportId 加载。
        面板自己也 `watch(reportId)`，这里只是让常见路径更直接。
      -->
      <AiAnalysisPanel v-if="reportId" :key="reportId" :report-id="reportId" />

      <!-- ══ 方法与删除 ═══════════════════════════════════════════════ -->
      <section id="report-method" data-anchor class="mt-10 scroll-mt-24 section-rule" aria-labelledby="report-method-title">
        <div class="flex items-baseline gap-3">
          <span class="section-index" aria-hidden="true">10</span>
          <h2 id="report-method-title" class="section-title">这份报告是怎么来的</h2>
        </div>
        <!--
          署名：报告页过去由公共壳统一写「题目基于 IPIP … 属公有领域」，而这份报告其实是
          十六型量表算出来的（浏览器验收报告问题 2）。这里只写人能读的来源与权威口径，
          不把包 ID、指纹、内部版本号或接口字段名印给普通用户。
        -->
        <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft" data-instrument-attribution>
          这是「<strong class="font-medium text-ink">{{ instrument.facts.title }}</strong>」提交时留下的快照，
          题目与报告文案为本项目自行撰写；本站
          <strong class="font-medium text-ink">不隶属</strong>
          任何商业人格测评机构，也不是任何机构的官方测评。答题时的即时倾向只作预览，最终结论以这份报告为准。
        </p>
        <p
          v-if="methodThresholds"
          class="mt-3 text-[13.5px] leading-relaxed text-ink-soft"
          data-method-thresholds
        >
          这份快照按提交当时的规则计分：{{ methodThresholds.coverage }}
          {{ methodThresholds.boundary }}
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <RouterLink to="/reports" class="btn-secondary">回到历史报告</RouterLink>
          <button type="button" class="btn-danger" data-delete-report @click="confirmDelete = true">删除这份报告</button>
        </div>
      </section>

      <!-- 页脚固定声明 -->
      <p class="mt-8 rounded-control bg-paper-soft px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft" data-disclaimer>
        这是参考测评，不是心理诊断，也不用于招聘或任何筛选。内容仍在内部审校中。如果这些描述让你不舒服，
        以你自己的感受为准。
      </p>
    </template>

    <p v-else class="text-[15px] text-ink-soft">没有指定报告。可以到 <RouterLink to="/reports" class="link">历史报告</RouterLink>里挑一份。</p>
    </template>

    <!--
      删除失败**不能**借用"记录没能载入"那块来表达：那会让用户以为整个历史都读不到了。
      这里只说"这一份没删掉、它还在"，并明确指出下一步。
      位置放在页面底部：删除入口在报告详情页与列表里各有一个，这里对两者都可见。
    -->
    <FormErrorNotice
      v-if="reports.removeError"
      :error="reports.removeError"
      class="mt-6 max-w-prose"
      data-report-remove-error
    />
    <p v-if="reports.removeError" class="caption mt-2">
      这一份还在你的记录里，可以稍后再删一次。
      <button type="button" class="link" @click="reports.clearRemoveError()">知道了</button>
    </p>

    <p v-if="notice" class="notice-neutral mt-6 whitespace-pre-wrap text-[13.5px] leading-relaxed" role="status" aria-live="polite" data-notice>
      {{ notice }}
    </p>

    <ConfirmDialog
      :open="confirmDelete"
      title="删除这份报告会同时删掉它的答案与相关记录，是否继续？"
      description="删除后无法恢复。这是你自己数据的一部分，任何时候都可以删。"
      confirm-label="删除报告"
      cancel-label="保留"
      danger
      :busy="reports.removingId !== null"
      busy-label="正在删除…"
      @confirm="removeReport"
      @cancel="confirmDelete = false"
    />

    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删除这条记录会同时删掉它的答案与相关记录，是否继续？"
      description="删除后无法恢复。这是你自己数据的一部分，任何时候都可以删。"
      confirm-label="删除记录"
      cancel-label="保留"
      danger
      :busy="reports.removingId !== null"
      busy-label="正在删除…"
      @confirm="deleteTarget && removeFromList(deleteTarget)"
      @cancel="deleteTarget = null"
    />
  </PageContainer>
</template>
