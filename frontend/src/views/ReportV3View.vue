<script setup lang="ts">
import { computed, onMounted, ref, useId, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useReportStore } from '@/stores/reportV3'
import { useInstrumentV3Store } from '@/stores/instrumentV3'
import type { ReportViewModelV3 } from '@/domain/reportV3'
import { isLegalTypeCode } from '@/domain/jung/types'

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

async function removeFromList(reportId2: string): Promise<void> {
  deleteTarget.value = null
  const ok = await reports.remove(reportId2)
  notice.value = ok ? '报告已经删除（连同它的答案与 AI 记录）。' : '删除没能完成。'
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
  ctx.fillStyle = '#F7F6F2'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1D2D3A'
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
    ctx.fillStyle = '#52616B'
    wrapLines(ctx, boundaryLine, 900).forEach((line) => {
      ctx.fillText(line, 540, y)
      y += 48
    })
    y += 24
  }
  ctx.font = '400 32px system-ui, sans-serif'
  ctx.fillStyle = '#52616B'
  wrapLines(ctx, text, 900).forEach((line) => {
    ctx.fillText(line, 540, y)
    y += 46
  })
  ctx.font = '400 28px system-ui, sans-serif'
  ctx.fillStyle = '#7C8892'
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
  confirmDelete.value = false
  const target = view.value?.reportId ?? reportId.value
  if (!target) return
  const ok = await reports.remove(target)
  notice.value = ok ? '报告已经删除（连同它的答案与 AI 记录）。' : '删除没能完成。'
}

/** 位置百分比（位置只表示"落在两端之间的哪里"，不表示好坏）。 */
function positionPercent(position: number | null): number | null {
  if (position === null) return null
  return Math.round(position * 1000) / 10
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
          class="rounded-question border border-line bg-surface px-4 py-4"
          :data-report-row="item.reportId"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p class="text-[15.5px] font-semibold text-ink">
              {{ item.computedTypeCode ?? '（没有单一类型）' }}
              <span class="ml-2 rounded-full bg-paper-soft px-2.5 py-1 text-[12.5px] font-medium text-ink-soft">
                {{ statusLabel(item.status) }}
              </span>
            </p>
            <p class="text-[13px] text-ink-faint">{{ formatTime(item.createdAt) }}</p>
          </div>
          <p v-if="item.summaryLine" class="mt-2 text-[14px] leading-relaxed text-ink-soft">
            {{ item.summaryLine }}
          </p>
          <p v-if="item.selfSelectedTypeCode" class="mt-1 text-[13px] text-ink-faint">
            你自己觉得更像：{{ item.selfSelectedTypeCode }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <RouterLink :to="`/reports/${item.reportId}`" class="btn-secondary btn-sm">打开报告</RouterLink>
            <button type="button" class="btn-ghost btn-sm" :data-delete-report="item.reportId" @click="deleteTarget = item.reportId">
              删除
            </button>
          </div>
        </li>
      </ul>
    </section>

    <template v-else>
    <!--
      「这份尝试还**没有**报告」和「报告存在但打不开」是两件不同的事，必须先分开：
      前者是**预期内的状态**（答题没答完 / 信息不足，服务端没有生成报告），
      正确处置是告诉用户还差什么、给一条回去补答的路；
      后者才是故障（网络、权限、服务端错误），要给报障编号。
      如果把两者都说成"打开失败"，用户会以为系统坏了，而不是自己还没答完。
    -->
    <div v-if="reports.notFound" class="card" data-status="NEEDS_REVIEW">
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
      <!-- ══ 状态一：REFERENCE ══════════════════════════════════════════ -->
      <article v-if="view.status === 'REFERENCE'" data-status="REFERENCE">
        <header>
          <p class="section-kicker">参考类型</p>
          <h1 class="mt-2 font-display text-[28px] font-bold leading-tight text-ink tablet:text-[36px]">
            {{ view.headline }}
          </h1>
          <p v-if="view.typeNameCn" class="mt-2 text-[17px] font-medium text-primary-700" data-type-name>
            {{ view.typeNameCn }}
          </p>
          <p class="mt-3 prose-cn">{{ view.summary }}</p>
        </header>
      </article>

      <!-- ══ 状态二：TENTATIVE ══════════════════════════════════════════ -->
      <article v-else-if="view.status === 'TENTATIVE'" data-status="TENTATIVE">
        <header>
          <p class="section-kicker">倾向较轻</p>
          <h1 class="mt-2 font-display text-[28px] font-bold leading-tight text-ink tablet:text-[36px]">
            {{ view.headline }}
          </h1>
          <p v-if="view.typeNameCn" class="mt-2 text-[17px] font-medium text-primary-700" data-type-name>
            {{ view.typeNameCn }}
          </p>
          <p class="notice-uncertain mt-4 text-[14px] leading-relaxed" data-tentative-notice>
            这一侧只是略偏，还不足以当成确定的类型。下面每一维都写了两端的样子，
            两个方向都值得一起读。
          </p>
          <p class="mt-3 prose-cn">{{ view.summary }}</p>
        </header>
      </article>

      <!-- ══ 状态三：TIED ══════════════════════════════════════════════ -->
      <article v-else data-status="TIED">
        <header>
          <p class="section-kicker">几个方向并列</p>
          <h1 class="mt-2 font-display text-[28px] font-bold leading-tight text-ink tablet:text-[36px]" data-tied-title>
            {{ view.headline }}
          </h1>
          <p class="notice-uncertain mt-4 text-[14px] leading-relaxed" data-tied-notice>
            本次作答里，有维度两边的证据正好一样多，因此没有哪一个四字母类型更适合当主标题。
            下面是几个都说得通的方向，请当成"一起看"，而不是"哪一个更准"。
          </p>
          <p class="mt-3 prose-cn">{{ view.summary }}</p>
        </header>
      </article>

      <!-- ══ 四维得分条 ════════════════════════════════════════════════ -->
      <section class="mt-8" aria-labelledby="report-dimensions">
        <h2 id="report-dimensions" class="section-title">四个维度各自落在哪里</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          位置点表示本次作答落在两端之间的哪个地方。靠哪一端都不是「更好」，
          只是这一侧的解释更贴近本次的作答。
        </p>
        <div class="mt-4 space-y-3">
          <article
            v-for="row in view.dimensionRows"
            :key="row.dimension"
            class="rounded-question border border-line bg-surface px-4 py-4"
            :aria-label="row.ariaLabel"
            :data-dimension="row.dimension"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 class="text-[16px] font-semibold text-ink">{{ row.name }}</h3>
              <p class="text-[13px] text-ink-soft">
                {{ row.negativeLabel }} {{ row.negativePole }} ↔ {{ row.positiveLabel }} {{ row.positivePole }}
              </p>
            </div>

            <div class="mt-3">
              <div class="flex items-baseline justify-between text-[12px] text-ink-faint">
                <span class="font-display text-[15px] font-bold text-ink-soft">{{ row.negativePole }}</span>
                <span class="text-[11.5px]">中点</span>
                <span class="font-display text-[15px] font-bold text-ink-soft">{{ row.positivePole }}</span>
              </div>
              <div class="relative mt-1.5 h-2.5 w-full rounded-full bg-line-soft">
                <div class="absolute inset-y-[-4px] left-1/2 w-px -translate-x-1/2 bg-ink/35" aria-hidden="true" />
                <div
                  v-if="positionPercent(row.position) !== null"
                  class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary-600 shadow-sm"
                  :style="{ left: `${positionPercent(row.position)}%` }"
                  aria-hidden="true"
                  data-position-dot
                />
                <p v-else class="absolute inset-0 flex items-center justify-center text-[12px] text-ink-faint">
                  本次不可计分
                </p>
              </div>
            </div>

            <p class="mt-3 text-[14.5px] font-medium text-ink">{{ row.statusNote }}</p>
            <ul class="mt-2 space-y-1.5">
              <li v-for="(detail, index) in row.details" :key="index" class="text-[13.5px] leading-relaxed text-ink-soft">
                {{ detail }}
              </li>
            </ul>
            <p class="mt-2 text-[12.5px] leading-relaxed text-ink-faint">
              可计分 {{ row.nFinal }} 题（主测 {{ row.nBase }} · 补充 {{ row.nClar }}）
              <template v-if="row.clarificationScheduled">
                ·
                {{ row.clarificationApplied ? '补充题已计入' : row.clarificationSkipped ? '补充题被你跳过了（只按主测绘）' : '补充题尚未计入' }}
              </template>
            </p>
          </article>
        </div>
      </section>

      <!-- ══ 边界说明（TENTATIVE 必看） ═══════════════════════════════ -->
      <section v-if="view.boundaryNotes.length > 0" class="mt-8" aria-labelledby="report-boundaries">
        <h2 id="report-boundaries" class="section-title">哪几维只是略偏</h2>
        <ul class="mt-3 space-y-2">
          <li v-for="(note, index) in view.boundaryNotes" :key="index" class="notice-uncertain text-[14px] leading-relaxed">
            {{ note }}
          </li>
        </ul>
      </section>

      <!-- ══ 候选类型 ═════════════════════════════════════════════════ -->
      <section v-if="view.candidates.length > 0" class="mt-8" aria-labelledby="report-candidates">
        <h2 id="report-candidates" class="section-title">还可以一起看的方向</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          下面的「需要偏离 N 分证据」是规则换算：换一个字母需要偏离多少本次作答的证据量。
          它不是概率、不是准确率、不是可能性，也不表示谁更准。
        </p>
        <p v-if="view.tieNotice" class="notice-neutral mt-3 text-[13.5px] leading-relaxed" data-tie-notice>
          {{ view.tieNotice }}
        </p>
        <ul class="mt-3 space-y-2" data-candidate-list>
          <li
            v-for="candidate in view.candidates"
            :key="candidate.typeCode"
            class="rounded-control border border-line bg-surface px-4 py-3"
            :data-candidate="candidate.typeCode"
          >
            <p class="text-[15px] font-semibold text-ink">
              {{ candidate.typeCode }}
              <span v-if="candidate.isComputedDirection" class="ml-2 text-[13px] font-normal text-primary-700">
                （本次方向本身）
              </span>
              <span class="ml-2 text-[12.5px] font-normal text-ink-faint">需要偏离 {{ candidate.cost }} 分证据</span>
            </p>
            <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft" data-cost-text>
              {{ candidate.costText }}
            </p>
            <p class="mt-1 text-[13px] leading-relaxed text-ink-faint" data-differs-text>
              {{ candidate.differsText }}
            </p>
          </li>
        </ul>
      </section>

      <!-- ══ 八段解读 ═════════════════════════════════════════════════ -->
      <section v-if="view.typeSections.length > 0" class="mt-8" aria-labelledby="report-sections">
        <h2 id="report-sections" class="section-title">这一型的读法</h2>
        <div class="mt-4 space-y-4">
          <article v-for="section in view.typeSections" :key="section.key" class="rounded-question border border-line bg-surface px-4 py-4">
            <h3 class="text-[16px] font-semibold text-ink">{{ section.title }}</h3>
            <p class="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{{ section.body }}</p>
          </article>
        </div>
      </section>

      <!-- ══ 可以试试 ═════════════════════════════════════════════════ -->
      <section v-if="view.nextActions.length > 0" class="mt-8" aria-labelledby="report-actions">
        <h2 id="report-actions" class="section-title">可以试试</h2>
        <div class="mt-4 space-y-3">
          <article v-for="action in view.nextActions" :key="action.title" class="rounded-question border border-line bg-surface px-4 py-4">
            <h3 class="text-[15.5px] font-semibold text-ink">{{ action.title }}</h3>
            <ol class="mt-2 space-y-1.5">
              <li v-for="(step, index) in action.steps" :key="index" class="list-line text-[13.5px] leading-relaxed text-ink-soft">
                {{ step }}
              </li>
            </ol>
          </article>
        </div>
      </section>

      <!-- ══ 四个过程（由四字母**推导**，不是测量） ═══════════════════════ -->
      <!--
        这一块的全部意义就是"不能让它被读成测量结果"，所以 `basis` 与
        `notes.frameworkCaveat` **必须**是可见文字，而不是折叠起来的附注：
        读者看到四个过程，最自然的误解就是"这是测出来的另外四个分数"。
      -->
      <section v-if="view.dynamics" class="mt-8" aria-labelledby="report-dynamics" data-dynamics>
        <h2 id="report-dynamics" class="section-title">四个精神活动过程</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
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

        <div class="mt-4 space-y-3">
          <article
            v-for="process in view.dynamics.processes"
            :key="process.slot"
            class="rounded-question border border-line bg-surface px-4 py-4"
            :data-process="process.process"
          >
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 class="text-[16px] font-semibold text-ink">
                {{ process.roleTitle }} · {{ process.nameCn }}
                <span class="ml-2 font-display text-[15px] font-bold text-primary-700">{{ process.process }}</span>
              </h3>
              <p class="text-[12.5px] text-ink-faint">
                {{ process.preferred ? '用起来最省力的一侧' : '还没有偏好的过程' }}
                · 第 {{ process.order }} 位
              </p>
            </div>
            <p class="mt-2 text-[14.5px] leading-relaxed text-ink">{{ process.what }}</p>
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
        class="mt-8"
        aria-labelledby="report-process-plan"
        data-process-plan
      >
        <h2 id="report-process-plan" class="section-title">按这套结构可以做的事</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          下面的建议都由上面那四个过程派生而来，同样不是另一次测量的结论。
          四个过程没有高下：主导只是「用起来最省力」的那一个。
        </p>

        <!-- 三段发展任务 -->
        <div class="mt-4 space-y-3" data-development-order>
          <article
            v-for="stage in view.processPlan.developmentOrder"
            :key="stage.order"
            class="rounded-question border border-line bg-surface px-4 py-4"
            :data-development-stage="stage.order"
          >
            <h3 class="text-[16px] font-semibold text-ink">{{ stage.order }}. {{ stage.title }}</h3>
            <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">{{ stage.body }}</p>
            <ul class="mt-2 space-y-2">
              <li
                v-for="item in stage.processes"
                :key="item.process"
                class="rounded-control bg-paper-soft px-3 py-2.5"
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
              class="rounded-question border px-4 py-4"
              :class="step.preferred ? 'border-line bg-surface' : 'border-line-strong bg-paper-soft'"
              :data-decision-step="step.function"
            >
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h4 class="text-[15.5px] font-semibold text-ink">{{ step.order }}. {{ step.title }}</h4>
                <p class="text-[12.5px]" :class="step.preferred ? 'text-ink-faint' : 'text-primary-700'">
                  {{ step.slotTitle }} · {{ step.process }}
                </p>
              </div>
              <!--
                「用不上你偏好的功能」两步必须**显式**标出来：跳过决策步骤的人，
                跳过的往往正是与自己不同的那两步，而这两步恰恰是最需要外部补上的。
              -->
              <p
                v-if="!step.preferred"
                class="mt-2 inline-block rounded-full bg-surface px-2.5 py-1 text-[12.5px] font-medium text-primary-700"
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

      <!-- ══ 自我理解（与问卷结果并列，不覆盖） ═════════════════════════ -->
      <section class="mt-10 rounded-question border border-line bg-surface px-4 py-5" aria-labelledby="report-self">
        <h2 id="report-self" class="section-title">你自己的理解（与上面的结果并列）</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          问卷结果是问卷算出来的；这里是你自己的判断。两者分开显示，
          <strong class="font-medium">谁都不会覆盖谁</strong>。
        </p>
        <div class="mt-4 grid gap-4 tablet:grid-cols-[10rem_minmax(0,1fr)]">
          <div>
            <label :for="typeId" class="block text-[14px] font-medium text-ink">你更认同哪一型</label>
            <select
              :id="typeId"
              v-model="reflectionType"
              class="mt-1.5 w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
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
      <section class="mt-8 rounded-question border border-line bg-surface px-4 py-5" aria-labelledby="report-share">
        <h2 id="report-share" class="section-title">带走这份报告</h2>
        <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
          复制的文字、导出的图片、图片的替代文本都来自同一份报告快照，说的永远是同一件事。
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="btn-primary" data-copy-share :disabled="copying" @click="copyShareText">
            {{ copying ? '正在复制…' : '复制报告文字' }}
          </button>
          <button type="button" class="btn-secondary" data-download-share @click="downloadShareImage">
            导出分享图（{{ view.share.filename }}）
          </button>
        </div>
        <!-- alt 与复制文字都展示出来，便于人工核对（图片的 alt 也用它） -->
        <div class="mt-3 space-y-2">
          <p class="text-[13px] text-ink-soft">
            图片替代文本：<span class="text-ink">{{ view.share.alt }}</span>
          </p>
          <pre class="whitespace-pre-wrap rounded-control bg-paper-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft" data-share-text>{{ view.share.text }}</pre>
        </div>
      </section>

      <!-- ══ 方法与删除 ═══════════════════════════════════════════════ -->
      <section class="mt-8 section-rule" aria-labelledby="report-method">
        <h2 id="report-method" class="section-title">这份报告是怎么来的</h2>
        <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
          量表：<strong class="font-medium text-ink">{{ instrument.facts.title }}</strong>。下面这些
          版本号与指纹来自报告自己的 <code class="text-[12.5px]">methodology</code> 字段；量表名来自
          <code class="text-[12.5px]">/api/v3/catalog/current</code>（报告正文里不重复下发包标题）。
        </p>
        <ul class="mt-2 space-y-1 text-[13px] leading-relaxed text-ink-faint">
          <li>计分版本：{{ view.methodology.scoringVersion }}（规则版本 {{ view.methodology.policyVersion }}）</li>
          <li>内容版本：{{ view.methodology.reportContentVersion }}（{{ view.methodology.contentStatus }}）</li>
          <li>内容包：{{ view.methodology.packageId }} · 指纹 {{ view.methodology.contentSha256.slice(0, 12) }}…</li>
          <!--
            过程层用的是**另一份内容**（过程文案包）和**另一套推导规则**，
            所以它们的版本与指纹必须也列在这里 —— 这个区块的意义就是"让用户能自己核对
            这份报告是按哪一版规则和内容生成的"，少列了这两行它就是不完整的。
            旧快照没有这两个键（`null`），如实写"这份快照没有记录"，不编一个版本号顶上。
          -->
          <li data-method-process-copy>
            过程内容：
            <template v-if="view.methodology.processCopyVersion">
              {{ view.methodology.processCopyVersion }}
              <template v-if="view.methodology.processCopySha256">
                · 指纹 {{ view.methodology.processCopySha256.slice(0, 12) }}…
              </template>
            </template>
            <template v-else>这份快照没有记录（生成时还没有过程层）</template>
          </li>
          <li data-method-dynamics-version>
            过程推导版本：
            {{ view.methodology.dynamicsVersion ?? '这份快照没有记录（生成时还没有过程层）' }}
          </li>
          <li>提交时间：{{ view.methodology.submittedAt }}</li>
          <li>报告指纹：{{ view.reportHash.slice(0, 16) }}…（内容被改过就对不上）</li>
          <li>
            未答/无法判断的处理：每维至少
            {{ view.methodology.minBaseRatingsPerDimension }} 题可计分才会给出方向；
            边界判定用 {{ view.methodology.boundaryNumerator }}/{{ view.methodology.boundaryDenominator }} 规则。
          </li>
        </ul>
        <!--
          署名：报告页过去由公共壳统一写「题目基于 IPIP … 属公有领域」，而这份报告其实是
          十六型量表算出来的（浏览器验收报告问题 2）。这里如实写清新测自己的来源，
          不再引用旧内容包的许可。
        -->
        <p class="mt-3 text-[13px] leading-relaxed text-ink-soft" data-instrument-attribution>
          {{ instrument.facts.title }}的题目与报告文案为本项目自行撰写；本站
          <strong class="font-medium text-ink">不隶属</strong>
          任何商业人格测评机构，也不是任何机构的官方测评。浏览器里那点即时倾向只用于答题时预览，
          最终结论一律以这份服务端报告为准。
        </p>
        <div class="mt-4 flex flex-wrap gap-2">
          <RouterLink to="/reports" class="btn-secondary">回到历史报告</RouterLink>
          <button type="button" class="btn-danger" data-delete-report @click="confirmDelete = true">删除这份报告</button>
        </div>
      </section>

      <!-- 页脚固定声明 -->
      <p class="mt-8 rounded-control bg-paper-soft px-4 py-3 text-[12.5px] leading-relaxed text-ink-soft" data-disclaimer>
        这是参考测评，不是心理诊断，也不用于招聘或任何筛选。内容仍在内部审校中
        （contentStatus = {{ view.methodology.contentStatus }}）。如果这些描述让你不舒服，
        以你自己的感受为准。
      </p>
    </template>

    <p v-else class="text-[15px] text-ink-soft">没有指定报告。可以到 <RouterLink to="/reports" class="link">历史报告</RouterLink>里挑一份。</p>
    </template>

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
      @confirm="deleteTarget && removeFromList(deleteTarget)"
      @cancel="deleteTarget = null"
    />
  </PageContainer>
</template>
