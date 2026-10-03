<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import { fetchMyReports, fetchPlatformReport, parseBigFiveReport, type MyReportRow, type BigFiveReportView, type ReportDetailView } from '@/api/platformV3'
import { bigFiveComparable } from '@/domain/bigFiveExport'
import { formatLocalTime } from '@/domain/localTime'
import { describeError } from '@/api/v3'

const route = useRoute()
const router = useRouter()
const rows = ref<MyReportRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const comparing = ref(false)
const compareError = ref<string | null>(null)
const first = ref<{ detail: ReportDetailView; report: BigFiveReportView } | null>(null)
const second = ref<{ detail: ReportDetailView; report: BigFiveReportView } | null>(null)
let generation = 0
let listGeneration = 0
const idA = computed(() => typeof route.query.a === 'string' ? route.query.a : '')
const idB = computed(() => typeof route.query.b === 'string' ? route.query.b : '')
const canCompare = computed(() => !!idA.value && !!idB.value && idA.value !== idB.value
  && rows.value.some((row) => row.reportId === idA.value)
  && rows.value.some((row) => row.reportId === idB.value) && !loading.value && !comparing.value)
const comparable = computed(() => first.value && second.value && bigFiveComparable(first.value.detail, second.value.detail))
const differences = computed(() => {
  if (!comparable.value || !first.value || !second.value) return []
  return first.value.report.dimensions.map((a) => {
    const b = second.value!.report.dimensions.find((candidate) => candidate.dimension === a.dimension)
    const valid = a.hasResult && b?.hasResult && a.rawScore !== null && b.rawScore !== null
    return { name: a.name, before: a.rawScore, after: b?.rawScore ?? null, delta: valid ? b.rawScore! - a.rawScore! : null }
  })
})

async function loadList(): Promise<void> {
  if (loading.value) return
  const current = ++listGeneration
  generation++
  first.value = second.value = null
  compareError.value = null
  loading.value = true
  error.value = null
  try {
    const found: MyReportRow[] = []
    let page = 0
    let total = 0
    do {
      const result = await fetchMyReports(page++, 50, 'big_five')
      if (current !== listGeneration) return
      if (!result.items.length && found.length < result.total) throw new Error('报告列表未能完整载入，请重试。')
      found.push(...result.items)
      total = result.total
      if (!result.items.length) break
    } while (found.length < total)
    if (current === listGeneration) rows.value = found
  } catch (cause) {
    if (current !== listGeneration) return
    rows.value = []
    error.value = describeError(cause).message
  } finally {
    if (current === listGeneration) loading.value = false
  }
}

function select(which: 'a' | 'b', value: string): void {
  void router.replace({ query: { ...route.query, [which]: value || undefined } })
}

async function compare(): Promise<void> {
  if (!canCompare.value) return
  const current = ++generation
  first.value = second.value = null
  compareError.value = null
  comparing.value = true
  try {
    const [a, b] = await Promise.all([fetchPlatformReport(idA.value), fetchPlatformReport(idB.value)])
    if (current !== generation) return
    if (a.reportKind !== 'big_five_profile' || b.reportKind !== 'big_five_profile') throw new Error('只能比较两份大五报告')
    first.value = { detail: a, report: parseBigFiveReport(a.report) }
    second.value = { detail: b, report: parseBigFiveReport(b.report) }
  } catch (cause) {
    if (current === generation) compareError.value = describeError(cause).message
  } finally {
    if (current === generation) comparing.value = false
  }
}

watch([idA, idB], () => {
  generation++
  first.value = second.value = null
  comparing.value = false
  compareError.value = null
})
onMounted(() => { void loadList() })
onBeforeUnmount(() => { listGeneration++; generation++ })
</script>

<template>
  <PageContainer page="home">
    <h1 class="section-title">比较两次大五倾向</h1>
    <p class="caption mt-2 max-w-prose">同版本报告才能比较分数差值；差值不代表进步或退步。</p>
    <p v-if="loading" role="status" class="mt-5">正在读取报告…</p>
    <div v-else-if="error" role="alert" class="notice-error mt-5">{{ error }}
      <button type="button" class="btn-secondary btn-sm mt-2" @click="loadList">重试</button>
    </div>
    <p v-else-if="rows.length < 2" class="notice-neutral mt-5">至少需要两份大五报告才能比较。</p>
    <template v-else>
      <div class="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 tablet:grid-cols-2">
        <label class="grid min-w-0 gap-1">第一次
          <select class="input w-full min-w-0" :value="idA" @change="select('a', ($event.target as HTMLSelectElement).value)">
            <option value="">请选择</option>
            <option v-for="(row, index) in rows" :key="row.reportId" :value="row.reportId">第 {{ index + 1 }} 份 · {{ formatLocalTime(row.createdAt) }} · {{ row.summaryLine }}</option>
          </select>
        </label>
        <label class="grid min-w-0 gap-1">第二次
          <select class="input w-full min-w-0" :value="idB" @change="select('b', ($event.target as HTMLSelectElement).value)">
            <option value="">请选择</option>
            <option v-for="(row, index) in rows" :key="row.reportId" :value="row.reportId">第 {{ index + 1 }} 份 · {{ formatLocalTime(row.createdAt) }} · {{ row.summaryLine }}</option>
          </select>
        </label>
      </div>
      <p v-if="idA && idA === idB" class="caption mt-2">请选择两份不同的报告。</p>
      <button type="button" class="btn-primary mt-4" :disabled="!canCompare" :title="!idA || !idB ? '请先选两份报告' : idA === idB ? '请选择不同的报告' : undefined" @click="compare">{{ comparing ? '正在比较…' : '比较这两份' }}</button>
      <p v-if="compareError" role="alert" class="notice-error mt-4">{{ compareError }}</p>
      <section v-if="first && second" class="mt-6" data-big-five-comparison>
        <p v-if="!comparable" class="notice-uncertain">这两份报告的内容包或计分版本不同，或旧报告缺少版本记录。不计算分数差值；请分别阅读原报告。</p>
        <template v-else>
          <p class="caption">正数仅表示第二次自报的原始分更高，负数表示更低；不是人群排名。</p>
          <div class="mt-3 overflow-x-auto"><table class="w-full text-left text-[14px]">
            <thead><tr><th scope="col">方面</th><th scope="col">第一次</th><th scope="col">第二次</th><th scope="col">差值</th></tr></thead>
            <tbody><tr v-for="row in differences" :key="row.name" class="border-t border-line">
              <th scope="row" class="py-3">{{ row.name }}</th><td>{{ row.before ?? '信息不足' }}</td><td>{{ row.after ?? '信息不足' }}</td><td>{{ row.delta === null ? '不计算' : row.delta > 0 ? `+${row.delta}` : row.delta }}</td>
            </tr></tbody>
          </table></div>
        </template>
        <div class="mt-4 flex flex-wrap gap-3"><RouterLink :to="`/reports/big-five/${idA}`" class="link">阅读第一次报告</RouterLink><RouterLink :to="`/reports/big-five/${idB}`" class="link">阅读第二次报告</RouterLink></div>
      </section>
    </template>
    <RouterLink to="/reports" class="btn-ghost btn-sm mt-6">回到历史报告</RouterLink>
  </PageContainer>
</template>
