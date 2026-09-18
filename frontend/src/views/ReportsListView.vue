<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { describeError, type ErrorDisplay } from '@/api/v3'
import { deleteReport } from '@/api/v3Assessment'
import { fetchMyReports, type MyReportRow } from '@/api/platformV3'

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

const sorted = computed(() =>
  [...items.value].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
)

const bigFiveCount = computed(() => items.value.filter((item) => item.reportKind === 'big_five_profile').length)
const jungCount = computed(() => items.value.filter((item) => item.reportKind === 'jung_reference').length)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await fetchMyReports(0, 50)
    items.value = page.items
  } catch (loadError) {
    error.value = describeError(loadError)
  } finally {
    loading.value = false
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
  return iso ? iso.replace('T', ' ').slice(0, 16) : '（没有记录时间）'
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  removingId.value = target
  removeError.value = null
  try {
    await deleteReport(target)
    items.value = items.value.filter((item) => item.reportId !== target)
    deleteTarget.value = null
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
        每一次提交都会留下一份按当时内容版本冻结的报告。报告不会因为规则更新而被重算，
        所以旧报告可能与新做的报告口径不同 —— 这一点在每份报告里都会写明。
      </p>
      <p v-if="!loading && items.length > 0" class="caption mt-2" data-report-counts>
        共 {{ items.length }} 份：十六型 {{ jungCount }} 份、大五 {{ bigFiveCount }} 份。
      </p>
    </header>

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
      还没有完成的测评。做完一次之后，报告会出现在这里，换设备登录也能看到。
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

    <div v-if="removeError" class="notice-error mt-5 max-w-prose" role="alert" data-reports-remove-error>
      <p class="text-[14.5px] leading-relaxed">删除没能完成：{{ removeError.message }}</p>
      <p class="caption mt-1">这份报告仍然在列表里，可以再试一次。</p>
    </div>

    <div class="mt-8 flex flex-wrap gap-2">
      <RouterLink to="/instruments" class="btn-primary btn-sm">再测一次</RouterLink>
      <RouterLink to="/reports/compare" class="btn-ghost btn-sm">比较两份十六型报告</RouterLink>
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
