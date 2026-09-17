<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { compareReports, fetchReports, type CompareResult, type ReportSummary } from '@/api/v3Assessment'

/**
 * 复测比较（2026-09-17 新增）—— 契约 `02-数据模型与API-v1.md` §7.2
 * `GET /reports/compare?ids=a,b`。
 *
 * ## 为什么这一页必须"少说一点"
 *
 * 两次测评之间变化的原因太多了：当时的处境、睡得好不好、题面理解变了、甚至单纯
 * 手滑选错。后端只做一件确定的事 —— 在**同一内容包版本**下算出各维方向与强度；
 * 不同版本连着都不算，只并列（`samePackage: false`）。所以这一页：
 *
 *   - **不出现**"成长""退步""进步了多少"这类判断。`changed` 只表示"这次这一维的方向
 *     和上次不一样"，不表示变好或变差；
 *   - `fromMFinal` / `toMFinal` 是**强度**（离中间有多远），不是分数、不是概率、不是匹配度；
 *   - 版本不同时把"不计算变化"的原因写在最上面，而不是让用户从空表里猜。
 *
 * ## 两份报告怎么选
 *
 * 选择放在**查询参数**里（`a` 与 `b` 两个参数），不放在组件内部状态：
 * 这样"我比较了哪两份"可以被刷新、被收藏、被复制给别人看，
 * 而不是刷新一下就回到空白选择。
 */

const route = useRoute()
const router = useRouter()

const list = ref<ReportSummary[]>([])
const listLoading = ref(false)
const listError = ref<ErrorDisplay | null>(null)

const result = ref<CompareResult | null>(null)
const comparing = ref(false)
const compareError = ref<ErrorDisplay | null>(null)

/**
 * 请求代号：只有最后一次选择的响应才允许写进页面。
 *
 * 不加这个的话，先选 A、再改选 B 时，A 的响应可能后到并把 B 的结果覆盖掉 ——
 * 用户看到的表格与下拉框里选的对不上，而且没有任何提示。
 */
let generation = 0

const idA = computed(() => (typeof route.query.a === 'string' ? route.query.a : ''))
const idB = computed(() => (typeof route.query.b === 'string' ? route.query.b : ''))

/**
 * 列表按时间倒序（`ReportSummary.createdAt` 可能为 null，null 排最后）。
 * 比较时通常想看"最近一次 vs 上一次"，所以顺序对体验有影响。
 */
const sortedList = computed(() =>
  [...list.value].sort((x, y) => (y.createdAt ?? '').localeCompare(x.createdAt ?? '')),
)

/** 两份都选了、且不是同一份，才允许点"开始比较"。 */
const canCompare = computed(
  () => idA.value !== '' && idB.value !== '' && idA.value !== idB.value && !comparing.value,
)

/** 维度中文名。与报告页保持同一套说法（页面不自己造词）。 */
const DIMENSION_LABELS: Record<string, { name: string; left: string; right: string }> = {
  EI: { name: '精力方向', left: 'I 内倾', right: 'E 外倾' },
  SN: { name: '信息取向', left: 'S 实感', right: 'N 直觉' },
  TF: { name: '决策依据', left: 'T 思考', right: 'F 情感' },
  JP: { name: '生活节奏', left: 'J 计划', right: 'P 弹性' },
}

function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension]?.name ?? dimension
}

/** 把存着的代码翻成"字母 + 中文"，两边都不为空时才拼。 */
function poleText(dimension: string, pole: string | null): string {
  if (!pole) return '（这一维没有给出方向）'
  const labels = DIMENSION_LABELS[dimension]
  if (!labels) return pole
  if (pole === labels.left.charAt(0)) return labels.left
  if (pole === labels.right.charAt(0)) return labels.right
  return pole
}

/** 强度：两位小数，缺失时如实说"没有记录"，不显示 0.00 冒充。 */
function magnitude(value: number | null): string {
  return value === null ? '未记录' : value.toFixed(2)
}

function formatTime(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '（没有记录时间）'
}

function statusLabel(status: string): string {
  switch (status) {
    case 'REFERENCE':
      return '参考类型'
    case 'TENTATIVE':
      return '倾向较轻'
    case 'TIED':
      return '并列'
    case 'NEEDS_REVIEW':
      return '信息不足'
    default:
      return status
  }
}

async function loadList(): Promise<void> {
  listLoading.value = true
  listError.value = null
  try {
    // 一次多取一些：比较页要能选到"更早那次"，默认 20 条常常不够。
    const page = await fetchReports({ size: 100 })
    list.value = page.items
  } catch (error) {
    listError.value = describeError(error)
  } finally {
    listLoading.value = false
  }
}

/** 改选择只改 URL，真正的比较交给 watch 触发（这样刷新/前进后退都一致）。 */
function select(which: 'a' | 'b', value: string): void {
  const query = { ...route.query, [which]: value || undefined }
  void router.replace({ path: '/reports/compare', query })
}

async function runCompare(): Promise<void> {
  if (!canCompare.value) return
  generation += 1
  const myGeneration = generation
  comparing.value = true
  compareError.value = null
  try {
    const data = await compareReports([idA.value, idB.value])
    if (myGeneration !== generation) return
    result.value = data
  } catch (error) {
    if (myGeneration !== generation) return
    result.value = null
    compareError.value = describeError(error)
  } finally {
    if (myGeneration === generation) comparing.value = false
  }
}

/** URL 里已经带齐两份时自动比较：从报告页点"与另一份比较"过来应直接看到结果。 */
function maybeAutoCompare(): void {
  if (canCompare.value) void runCompare()
}

onMounted(async () => {
  await loadList()
  maybeAutoCompare()
})
</script>

<template>
  <PageContainer page="result">
    <!--
      这一页的焦点是"把两份报告并排读"，所以页头做成整页唯一一块深色面板：
      它不承载任何表单与结果表格，只是把口径（不判断好坏）放在最前面。
      表格本身留在浅色表面上，长文与数字仍然是最好读的。
    -->
    <header class="deep-panel deep-grid rounded-cover px-5 py-7 shadow-deep tablet:px-10 tablet:py-10">
      <p class="chip chip-on-deep">
        <AppIcon name="compare" :size="14" />
        复测比较
      </p>
      <h1 class="display-hero mt-4 text-[24px] leading-tight text-white tablet:text-[30px]">
        把两次测评放在一起看
      </h1>
      <p class="mt-3 max-w-prose text-[15px] leading-[1.75] text-navy-100 tablet:text-[16.5px]">
        这里只做一件事：把两份报告里四个维度的方向与强度<strong class="font-semibold text-white">并列</strong>出来，标出哪几维方向不同。
        它不判断你变好了还是变差了 —— 两次作答之间的处境、状态、甚至手滑选错，
        都会影响结果，而这些都不在这份数据里。
      </p>
    </header>

    <div v-if="listError" class="notice-error mt-5" role="alert">
      <p class="flex items-start gap-2 text-[14.5px] font-medium">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>记录没能载入：{{ listError.message }}</span>
      </p>
      <button type="button" class="btn-secondary mt-3" @click="loadList">重试</button>
    </div>

    <p v-else-if="listLoading" class="mt-6 text-[15px] text-ink-soft">正在载入记录…</p>

    <div v-else-if="sortedList.length < 2" class="notice-neutral mt-6 max-w-prose text-[14px] leading-relaxed" data-compare-need-two>
      至少要有两份报告才能比较。现在有 {{ sortedList.length }} 份 ——
      <RouterLink to="/assess" class="link">再测一次</RouterLink>之后回来就能比了。
    </div>

    <template v-else>
      <!-- 选择区是这一页唯一的表单：收进一张卡，和结果区拉开层次 -->
      <div class="card mt-6 grid gap-4 tablet:grid-cols-2" data-compare-pickers>
        <div>
          <label for="compare-a" class="block text-[14.5px] font-medium text-ink">先看这一份</label>
          <select
            id="compare-a"
            name="compare-a"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            :value="idA"
            data-compare-select-a
            @change="select('a', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择</option>
            <option v-for="item in sortedList" :key="item.reportId" :value="item.reportId">
              {{ formatTime(item.createdAt) }} · {{ item.computedTypeCode ?? '（没有单一类型）' }} ·
              {{ statusLabel(item.status) }}
            </option>
          </select>
        </div>
        <div>
          <label for="compare-b" class="block text-[14.5px] font-medium text-ink">再看这一份</label>
          <select
            id="compare-b"
            name="compare-b"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            :value="idB"
            data-compare-select-b
            @change="select('b', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">请选择</option>
            <option v-for="item in sortedList" :key="item.reportId" :value="item.reportId">
              {{ formatTime(item.createdAt) }} · {{ item.computedTypeCode ?? '（没有单一类型）' }} ·
              {{ statusLabel(item.status) }}
            </option>
          </select>
        </div>
      </div>

      <p v-if="idA !== '' && idA === idB" class="caption mt-3" data-compare-same>
        两份选的是同一份报告，换一份再比。
      </p>

      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-primary btn-sm"
          :disabled="!canCompare"
          data-compare-run
          @click="runCompare"
        >
          {{ comparing ? '正在比较…' : '开始比较' }}
        </button>
        <RouterLink to="/reports" class="btn-ghost btn-sm">回到历史报告</RouterLink>
      </div>

      <div v-if="compareError" class="notice-error mt-4" role="alert" data-compare-error>
        <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>{{ compareError.message }}</span>
        </p>
        <p v-if="compareError.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
          报障编号：<code class="font-mono">{{ compareError.requestId }}</code>
        </p>
      </div>

      <section v-if="result" class="mt-8" aria-labelledby="compare-result" data-compare-result>
        <h2 id="compare-result" class="section-title flex items-center gap-2">
          <AppIcon name="compare" :size="18" class="text-primary-600" />
          两份报告的四个维度
        </h2>

        <!--
          版本不同 → 服务端不算变化。这件事必须在最上面说，不能让用户从
          "全部未标记变化"的表格里自己猜。
        -->
        <p
          v-if="!result.samePackage"
          class="notice-uncertain mt-3 flex max-w-prose items-start gap-2 text-[14px] leading-relaxed"
          role="note"
          data-compare-different-package
        >
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>
            <span class="font-medium">这两次用的题目或计分规则版本不同，所以没有计算变化。</span>
            版本变了以后，"某一维移动了多少"就不再是同一把尺子量出来的，算出来的差值没有意义。
            下面只把两份并列放出来供你自己读。
          </span>
        </p>

        <!-- 结论是这一页真正的焦点：给表格一张卡片，横向滚动收在卡片内部 -->
        <div class="mt-4 overflow-hidden rounded-question border border-line bg-surface shadow-card">
          <div class="overflow-x-auto px-4 tablet:px-5">
            <table class="w-full min-w-[34rem] border-collapse text-left text-[14px]">
              <caption class="sr-only">两份报告在四个维度上的方向与强度对照</caption>
              <thead>
                <tr class="border-b border-line-strong text-[13px] text-ink-soft">
                  <th scope="col" class="py-2 pr-3 font-medium">维度</th>
                  <th scope="col" class="py-2 pr-3 font-medium">先看的那份</th>
                  <th scope="col" class="py-2 pr-3 font-medium">再看的那份</th>
                  <th scope="col" class="py-2 font-medium">方向是否不同</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in result.differences" :key="row.dimension" class="border-b border-line last:border-b-0" :data-compare-row="row.dimension">
                  <th scope="row" class="py-2.5 pr-3 font-medium text-ink">{{ dimensionLabel(row.dimension) }}</th>
                  <td class="py-2.5 pr-3 text-ink-soft">
                    {{ poleText(row.dimension, row.fromPole) }}
                    <span class="text-ink-faint">（强度 {{ magnitude(row.fromMFinal) }}）</span>
                  </td>
                  <td class="py-2.5 pr-3 text-ink-soft">
                    {{ poleText(row.dimension, row.toPole) }}
                    <span class="text-ink-faint">（强度 {{ magnitude(row.toMFinal) }}）</span>
                  </td>
                  <td class="py-2.5">
                    <span v-if="row.changed" class="chip chip-accent">方向不同</span>
                    <span v-else class="chip chip-neutral">方向一致</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <p class="caption mt-3 max-w-prose">
          「强度」是这一维离中间有多远（越接近 0 越靠中间），不是分数、不是概率，也不是匹配度。
        </p>

        <div v-if="result.notes.length > 0" class="mt-4">
          <ul class="space-y-1.5 prose-cn max-w-prose">
            <li v-for="note in result.notes" :key="note" class="list-dot" data-compare-note>{{ note }}</li>
          </ul>
        </div>

        <p class="fineprint mt-4 max-w-prose">
          方向不同不等于变好或变差。如果你觉得某次的结果更像当时的自己，
          以你自己的判断为准 —— 页面上的「自我理解」区块就是留给这件事的。
        </p>
      </section>
    </template>
  </PageContainer>
</template>
