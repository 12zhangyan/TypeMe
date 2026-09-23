<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { deleteReport } from '@/api/v3Assessment'
import { fetchMyReports, type MyReportRow } from '@/api/platformV3'
import { formatLocalTime } from '@/domain/localTime'

/**
 * 历史报告（`/reports`）。
 *
 * ## 为什么这一页必须按报告种类分流链接
 *
 * 改造前这一页只渲染十六型报告：类型码大字、四个状态、候选类型。大五报告进来之后，
 * 它的 `computedTypeCode` 永远是 null，于是每一行都会显示"——"和一个
 * "这一份没有单一类型"的说明 —— 用户看到的是"这份报告坏了"，实际是
 * **这一页渲染的不是它**。所以每一行按 `reportKind` 决定跳到哪个报告页，
 * 并按自己的口径显示摘要：十六型显示类型码，大五显示"五个维度"。
 *
 * ## 为什么不再用 `reportV3` store 的列表
 *
 * 那个 store 的列表模型（`ReportSummary`）是十六型专属的。这里改用平台接口，
 * 一行就带齐量表名、种类、状态、摘要，两种量表共用一套渲染。
 * 报告**详情**仍然走各自原有的接口与页面 —— 详情页才是真正量表专属的部分。
 */

const items = ref<MyReportRow[]>([])
const loading = ref(true)
const error = ref<ErrorDisplay | null>(null)
const deleteTarget = ref<string | null>(null)
const removingId = ref<string | null>(null)
const removeError = ref<ErrorDisplay | null>(null)
const page = ref(0)
const total = ref(0)
const filter = ref<'all' | 'jung' | 'big_five'>('all')
const pageSize = 20
let loadSequence = 0

const sorted = computed(() =>
  [...items.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
)

const bigFiveCount = computed(() => items.value.filter((item) => item.reportKind === 'big_five_profile').length)
const jungCount = computed(() => items.value.filter((item) => item.reportKind === 'jung_reference').length)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const hasPreviousPage = computed(() => page.value > 0)
const hasNextPage = computed(() => page.value + 1 < pageCount.value)

function filterLabel(value: typeof filter.value): string {
  return value === 'jung' ? '十六型' : value === 'big_five' ? '大五' : '全部'
}

async function load(): Promise<void> {
  const sequence = ++loadSequence
  loading.value = true
  error.value = null
  try {
    const result = await fetchMyReports(page.value, pageSize, filter.value === 'all' ? undefined : filter.value)
    if (sequence !== loadSequence) return
    items.value = result.items
    total.value = result.total
    if (page.value >= Math.max(1, Math.ceil(result.total / pageSize))) {
      page.value = Math.max(0, Math.ceil(result.total / pageSize) - 1)
      void load()
    }
  } catch (loadError) {
    if (sequence !== loadSequence) return
    error.value = describeError(loadError)
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

onMounted(load)

watch(deleteTarget, (value) => {
  if (value) removeError.value = null
})

function reportLink(item: MyReportRow): string {
  return item.reportKind === 'big_five_profile'
    ? `/reports/big-five/${item.reportId}`
    : `/reports/${item.reportId}`
}

function statusLabel(item: MyReportRow): string {
  if (item.reportKind === 'big_five_profile') {
    switch (item.status) {
      case 'PROFILE':
        return '五维画像'
      default:
        return item.status
    }
  }
  switch (item.status) {
    case 'REFERENCE':
      return '参考类型'
    case 'TENTATIVE':
      return '倾向较轻'
    case 'TIED':
      return '并列'
    case 'NEEDS_REVIEW':
      return '信息不足'
    default:
      return item.status
  }
}

function formatTime(iso: string): string {
  return formatLocalTime(iso)
}

function selectFilter(value: typeof filter.value): void {
  if (filter.value === value) return
  filter.value = value
  page.value = 0
  void load()
}

function goToPage(next: number): void {
  const target = Math.min(Math.max(0, next), pageCount.value - 1)
  if (target === page.value || loading.value) return
  page.value = target
  void load()
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target || removingId.value !== null) return
  removingId.value = target
  removeError.value = null
  try {
    await deleteReport(target)
    items.value = items.value.filter((item) => item.reportId !== target)
    total.value = Math.max(0, total.value - 1)
    deleteTarget.value = null
    if (page.value >= Math.max(1, Math.ceil(total.value / pageSize))) page.value = Math.max(0, page.value - 1)
    await load()
  } catch (deleteError) {
    removeError.value = describeError(deleteError)
  } finally {
    removingId.value = null
  }
}
</script>

<template>
  <PageContainer page="home">
    <header class="max-w-prose">
      <h1 class="text-[26px] font-semibold leading-snug text-ink tablet:text-[30px]">历史报告</h1>
      <p class="mt-3 text-[15.5px] leading-relaxed text-ink-soft">
        每一次提交都会留下一份当时的报告。规则以后若有更新，旧报告仍按当时那次解释，不会被重算。
      </p>
      <p v-if="!loading && total > 0" class="caption mt-2" data-report-counts>
        共 {{ total }} 份；当前筛选：{{ filterLabel(filter) }}，本页 {{ items.length }} 份（十六型 {{ jungCount }}，大五 {{ bigFiveCount }}）。
      </p>
    </header>

    <div class="mt-5 flex flex-wrap items-center gap-2" data-report-filters role="group" aria-label="报告筛选">
      <button
        v-for="option in ([['all', '全部'], ['jung', '十六型'], ['big_five', '大五']] as const)"
        :key="option[0]"
        type="button"
        class="chip min-h-[44px]"
        :class="filter === option[0] ? 'chip-primary' : 'chip-neutral'"
        :aria-pressed="filter === option[0]"
        @click="selectFilter(option[0])"
      >
        {{ option[1] }}
      </button>
    </div>

    <div v-if="error" class="notice-error mt-6 max-w-prose" role="alert" data-reports-error>
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>{{ error.message }}</span>
      </p>
      <p v-if="error.requestId" class="mt-2 break-all text-[12.5px]">
        报障编号：<code class="font-mono">{{ error.requestId }}</code>
      </p>
      <button type="button" class="btn-secondary btn-sm mt-3" @click="load">重试</button>
    </div>

    <p v-else-if="loading" class="mt-6 text-[15px] text-ink-soft" data-reports-loading>正在载入记录…</p>

    <div v-else-if="sorted.length === 0" class="notice-neutral mt-6 max-w-prose text-[14px] leading-relaxed" data-reports-empty>
      <template v-if="filter === 'all'">还没有完成的测评。做完一次之后，报告会出现在这里，换设备登录也能看到。</template>
      <template v-else>还没有{{ filterLabel(filter) }}的报告，可以切换筛选查看其他报告。</template>
      <RouterLink to="/instruments" class="link">去选一项测评</RouterLink>。
    </div>

    <ul v-else class="mt-6 grid gap-3" data-report-rows>
      <li
        v-for="item in sorted"
        :key="item.reportId"
        class="rounded-question border border-line bg-surface px-4 py-4 shadow-card transition-shadow hover:shadow-lift tablet:px-5"
        :data-report-row="item.reportId"
        :data-report-kind="item.reportKind"
      >
        <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <!-- 十六型显示类型码；大五结构上没有类型码，显示的是"五维"而不是一个破折号 -->
              <span
                v-if="item.computedTypeCode"
                class="font-display text-[22px] font-bold leading-none tracking-[0.04em] text-ink"
              >
                {{ item.computedTypeCode }}
              </span>
              <span v-else class="text-[15px] font-semibold leading-none text-ink">
                {{ item.instrumentTitle }}
              </span>
              <span class="chip" :class="item.status === 'NEEDS_REVIEW' ? 'chip-neutral' : 'chip-primary'">
                {{ statusLabel(item) }}
              </span>
              <span class="chip chip-neutral">{{ item.reportKind === 'big_five_profile' ? '五个维度' : '四个维度' }}</span>
            </p>
            <p class="caption mt-1.5">{{ item.instrumentTitle }}</p>
          </div>
          <p class="text-[13px] text-ink-faint">{{ formatTime(item.createdAt) }}</p>
        </div>

        <p v-if="item.summaryLine" class="mt-2.5 max-w-[46rem] text-[14px] leading-relaxed text-ink-soft">
          {{ item.summaryLine }}
        </p>

        <div class="mt-3 flex flex-wrap gap-2">
          <RouterLink :to="reportLink(item)" class="btn-secondary btn-sm" data-report-open>打开报告</RouterLink>
          <button
            type="button"
            class="btn-ghost btn-sm"
            :data-delete-report="item.reportId"
            :disabled="removingId !== null"
            @click="deleteTarget = item.reportId"
          >
            {{ removingId === item.reportId ? '正在删除…' : '删除' }}
          </button>
        </div>
      </li>
    </ul>

    <div v-if="!loading && !error && total > 0" class="mt-6 flex flex-wrap items-center gap-3" data-report-pagination>
      <button type="button" class="btn-secondary btn-sm" :disabled="!hasPreviousPage || loading" @click="goToPage(page - 1)">上一页</button>
      <span class="caption">第 {{ page + 1 }} / {{ pageCount }} 页</span>
      <button type="button" class="btn-secondary btn-sm" :disabled="!hasNextPage || loading" @click="goToPage(page + 1)">下一页</button>
    </div>

    <div v-if="removeError" class="notice-error mt-5 max-w-prose" role="alert" data-reports-remove-error>
      <p class="text-[14.5px] leading-relaxed">删除没能完成：{{ removeError.message }}</p>
      <p class="caption mt-1">这份报告仍然在列表里，可以再试一次。</p>
    </div>

    <div class="mt-8 flex flex-wrap gap-2">
      <RouterLink to="/instruments" class="btn-primary btn-sm">再测一次</RouterLink>
      <RouterLink to="/reports/compare" class="btn-ghost btn-sm">比较两份十六型报告</RouterLink>
      <RouterLink to="/reports/compare/big-five" class="btn-ghost btn-sm">比较两份大五报告</RouterLink>
    </div>

    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删除这份报告？"
      description="删除立刻生效，链接会失效，也无法恢复。这份报告对应的测评记录不会被删掉。"
      confirm-label="删除"
      cancel-label="取消"
      danger
      :busy="removingId !== null"
      @cancel="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </PageContainer>
</template>
