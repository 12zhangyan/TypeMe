<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { RouterLink } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AdminReportReadout from '@/components/AdminReportReadout.vue'
import AdminHeader from '@/components/AdminHeader.vue'
import FormErrorNotice from '@/components/FormErrorNotice.vue'
import * as api from '@/api/adminMembers'
import { describeError, isForbidden, type ErrorDisplay } from '@/api/v3'
import type { MyAttemptRow, MyReportRow, ReportDetailView } from '@/api/platformV3'
const empty = <T>(): api.Page<T> => ({ items: [], page: 0, size: 10, total: 0 })
const users = ref(empty<api.Member>())
const userAttempts = ref(empty<MyAttemptRow>())
const userReports = ref(empty<MyReportRow>())
const selected = ref<api.Member | null>(null)
const detail = ref<ReportDetailView | null>(null)
const loading = ref(false), busy = ref(false), denied = ref(false), ready = ref(false)
const error = ref(''), notice = ref('')
// 接口失败保留完整的 describeError 结果：服务端原话与报障编号都要给管理员看（A38 同类问题）。
const apiError = ref<ErrorDisplay | null>(null), needsLogin = ref(false)
// 提示块在页面顶部，手机上点的按钮往往在下方：出错时滚到可见处，否则失败原因落在视口外。
// 顶栏在窄屏会折行（320 宽约 150px），按实际底边让开，不用固定的 --header-h。
const errorArea = ref<HTMLElement | null>(null)
function revealError() {
  const area = errorArea.value
  if (!area || typeof window.scrollBy !== 'function') return
  const top = area.getBoundingClientRect().top
  const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0
  if (top < headerBottom + 8 || top > window.innerHeight - 48) window.scrollBy({ top: top - headerBottom - 12 })
}
watch([error, apiError], ([local, remote]) => { if (local || remote) void nextTick(revealError) })
const dailyLimit = ref(0)
const time = (value: string | null) => value ? new Date(value).toLocaleString() : '暂无记录'
const labels: Record<string, string> = { ACTIVE: '正常', DISABLED: '已禁用', DELETION_PENDING: '注销处理中', DRAFT: '答题中', BASE_IN_PROGRESS: '主测答题中', CLARIFICATION_IN_PROGRESS: '补充答题中', READY_TO_SUBMIT: '待提交', PROFILE: '五维参考结果', IN_PROGRESS: '答题中', SUBMITTED: '已完成', COMPLETED: '已完成', ABANDONED: '已结束', REFERENCE: '参考结果', TENTATIVE: '倾向较轻', TIED: '两边接近' }
const label = (value: string) => labels[value] ?? value
function attemptStatusLabel(attempt: MyAttemptRow): string {
  if (attempt.status === 'BASE_IN_PROGRESS') {
    return attempt.instrumentKind === 'jung' ? '主测答题中' : '答题中'
  }
  if (attempt.status === 'CLARIFICATION_IN_PROGRESS') return '补充答题中'
  return label(attempt.status)
}
function attemptProgressLabel(attempt: MyAttemptRow): string {
  if (attempt.status === 'CLARIFICATION_IN_PROGRESS') {
    return `主测 ${attempt.answeredCount} / ${attempt.requiredCount}`
  }
  return `已答 ${attempt.answeredCount} / ${attempt.requiredCount} 题`
}
function reportStatusLabel(report: MyReportRow): string {
  if (report.reportKind === 'big_five_profile') {
    return report.status === 'PROFILE' ? '五维画像' : label(report.status)
  }
  switch (report.status) {
    case 'REFERENCE': return '参考类型'
    case 'TENTATIVE': return '倾向较轻'
    case 'TIED': return '几个方向并列'
    case 'NEEDS_REVIEW': return '信息不足'
    default: return label(report.status)
  }
}
function fail(e: unknown) {
  const display = describeError(e)
  // 只有没权限或会话失效才建议重新登录；冲突、校验失败与网络错误重新登录也解决不了。
  needsLogin.value = isForbidden(e) || display.sessionExpired
  if (needsLogin.value) { denied.value = isForbidden(e); ready.value = false; selected.value = null; detail.value = null; users.value = empty() }
  apiError.value = display
}
function clearErrors() { error.value = ''; apiError.value = null; needsLogin.value = false }
// 只看今日 AI 额度已用完的成员；切换、翻页、保存后的重载都带上这个条件。
// exhaustedOnly 是开关状态，shownExhausted 是当前列表实际按什么条件取回：请求返回前两者可能不同，
// 计数与空态文案只看后者，否则切换瞬间会把未筛选的总数显示成“N 位今日额度已用完”。
const exhaustedOnly = ref(false), shownExhausted = ref(false)
async function fetchMembers(page: number, exhausted: boolean) {
  const result = await api.members(page, exhausted)
  users.value = result; shownExhausted.value = exhausted
  return result
}
async function load() {
  if (loading.value) return
  loading.value = true; clearErrors(); denied.value = false
  try { await fetchMembers(0, exhaustedOnly.value); ready.value = true }
  catch (e) { fail(e) } finally { loading.value = false }
}
async function toggleExhausted(next: boolean) {
  const previous = exhaustedOnly.value
  exhaustedOnly.value = next
  resetBatch()
  await action(async () => {
    try { await fetchMembers(0, next) }
    catch (e) { exhaustedOnly.value = previous; throw e } // 失败时开关回到与列表一致的状态
  })
}
function goPage(page: number) {
  resetBatch()
  return action(async () => { await fetchMembers(page, exhaustedOnly.value) })
}
/**
 * 重读当前页（带筛选）；当前页因此变空且不是第一页时退回上一页。
 * 勾选只保留仍在当前页的成员（需求 Q-1）：重读后看不到的人不能留在“已选”里被批量修改。
 */
async function reloadPage() {
  const page = await fetchMembers(users.value.page, exhaustedOnly.value)
  if (!page.items.length && page.page > 0) await fetchMembers(page.page - 1, exhaustedOnly.value)
  picked.value = picked.value.filter(id => users.value.items.some(user => user.id === id))
}
/** 保存已成功后刷新列表：刷新失败不能吞掉“已保存”的结果，只补充说明列表可能不是最新。 */
async function reloadAfterSave() {
  try { await reloadPage() }
  catch (e) { fail(e); notice.value += ' 但刷新成员列表失败，列表可能不是最新，请稍后翻页或刷新页面核对。' }
}
// 批量修改只作用于当前页的勾选（需求 Q-1）；换页、切换筛选、取消或成功后清空。
const picked = ref<string[]>([])
const batchLimit = ref<number | ''>('')
// 待确认的批量操作：设为同一额度，或恢复为沿用系统默认；null 表示没有待确认的操作。
const confirming = ref<'set' | 'reset' | null>(null)
const batchFailures = ref<{ id: string; name: string; message: string }[]>([])
const allPicked = computed(() => users.value.items.length > 0 && users.value.items.every(user => picked.value.includes(user.id)))
function resetBatch() { picked.value = []; confirming.value = null; batchFailures.value = [] }
function togglePick(id: string, on: boolean) {
  picked.value = on ? [...picked.value, id] : picked.value.filter(item => item !== id)
  confirming.value = null; batchFailures.value = []
}
function togglePickAll(on: boolean) {
  picked.value = on ? users.value.items.map(user => user.id) : []
  confirming.value = null; batchFailures.value = []
}
function askConfirm(mode: 'set' | 'reset') {
  const limit = batchLimit.value
  if (mode === 'set' && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > 10000)) { clearErrors(); error.value = '每日额度请输入 0–10000 的整数。'; return }
  clearErrors(); batchFailures.value = []; confirming.value = mode
}
async function submitBatch() {
  const mode = confirming.value
  if (!mode) return
  const ids = [...picked.value], limit = batchLimit.value as number
  const names = new Map(users.value.items.map(user => [user.id, user.nickname || user.username]))
  await action(async () => {
    const result = mode === 'reset' ? await api.resetDailyLimits(ids) : await api.setDailyLimits(ids, limit)
    confirming.value = null
    const saved = result.results.find(item => item.ok && item.member?.id === selected.value?.id)?.member
    if (saved) { selected.value = saved; dailyLimit.value = saved.effectiveAiDailyLimit }
    // 服务端已写入：先把结果落到页面上，再刷新列表，刷新失败也不丢失失败名单。
    const failed = result.results.filter(item => !item.ok)
    batchFailures.value = failed.map(item => ({ id: item.userId, name: names.get(item.userId) ?? item.userId, message: item.message ?? '保存失败。' }))
    // 失败者保持勾选方便重试；刷新后不在当前页的会被 reloadPage 去掉。
    picked.value = failed.map(item => item.userId)
    notice.value = result.failed
      ? `已保存 ${result.updated} 位成员，${result.failed} 位未保存，见下方名单。`
      : mode === 'reset'
        ? `已将 ${result.updated} 位成员恢复为沿用系统默认额度。今天已经使用的次数保留。`
        : `已将 ${result.updated} 位成员的每日额度设为 ${limit}。今天已经使用的次数保留。`
    await reloadAfterSave()
  })
}
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; clearErrors(); notice.value = ''
  try { await work() } catch (e) { fail(e) } finally { busy.value = false }
}
async function choose(user: api.Member) {
  await action(async () => {
    selected.value = null; detail.value = null
    const [a, r] = await Promise.all([api.attempts(user.id), api.reports(user.id)])
    userAttempts.value = a; userReports.value = r; dailyLimit.value = user.effectiveAiDailyLimit; selected.value = user
  })
}
async function saveLimit() {
  const user = selected.value
  if (!user || !Number.isInteger(dailyLimit.value) || dailyLimit.value < 0 || dailyLimit.value > 10000) { clearErrors(); error.value = '每日额度请输入 0–10000 的整数。'; return }
  await action(async () => {
    const updated = await api.setDailyLimit(user.id, dailyLimit.value)
    selected.value = updated; users.value.items = users.value.items.map(item => item.id === user.id ? updated : item)
    notice.value = '每日额度已保存。今天已经使用的次数保留。'
    // 筛选状态下改额度可能让成员不再符合条件：重载当前页，不留已不符合的卡片。
    if (exhaustedOnly.value) await reloadAfterSave()
  })
}
onMounted(load)
</script>
<template>
  <PageContainer page="home" class="members-page">
    <AdminHeader active="members" title="成员" lead="了解成员的测评进度，为成员分配 AI 解读额度。" />
    <p v-if="loading" role="status" class="card">正在读取成员…</p>
    <div ref="errorArea">
      <div v-if="error" class="notice-error mt-5" role="alert">{{ error }}</div>
      <div v-if="apiError" class="mt-5" data-admin-error><FormErrorNotice :error="apiError" /><p class="mt-2"><button v-if="!ready && !denied" class="link" :disabled="loading" @click="load">重试</button><RouterLink v-if="needsLogin" to="/login" class="link ml-3">重新登录</RouterLink></p></div>
    </div>
    <p v-if="denied" class="notice-uncertain mt-4">此页面仅对管理员开放。<RouterLink to="/account" class="link">返回账号页</RouterLink></p>
    <p v-if="notice" class="notice-success mt-4" role="status">{{ notice }}</p>
    <div v-if="batchFailures.length" class="notice-error mt-4" role="alert" data-batch-failures><p>以下成员未保存：</p><ul class="batch-failures"><li v-for="item in batchFailures" :key="item.id">{{ item.name }}：{{ item.message }}</li></ul></div>
    <template v-if="ready && !denied">
      <section class="members-section" aria-labelledby="members-title">
        <div class="section-top"><div><p class="section-kicker">成员档案</p><h2 id="members-title">成员</h2></div><span class="caption">{{ shownExhausted ? `${users.total} 位今日额度已用完` : `${users.total} 位成员` }}</span></div>
        <p class="caption mb-3">最近活动表示会话最后使用时间，不代表此刻在线。每日额度于 UTC 00:00（北京时间 08:00）重置。</p>
        <div class="member-tools mb-4"><label class="filter-toggle"><input type="checkbox" :checked="exhaustedOnly" :disabled="busy || loading" data-exhausted-filter @change="toggleExhausted(($event.target as HTMLInputElement).checked)" />只看今日额度已用完</label><label v-if="users.items.length" class="filter-toggle"><input type="checkbox" :checked="allPicked" :disabled="busy" data-pick-all @change="togglePickAll(($event.target as HTMLInputElement).checked)" />全选本页</label></div>
        <p v-if="!users.items.length" class="caption">{{ shownExhausted ? '没有今天额度已用完的成员。' : '暂无成员。' }}</p>
        <div class="member-grid"><div v-for="user in users.items" :key="user.id" class="member-item"><button class="member-card" :class="{ selected: selected?.id === user.id }" :disabled="busy" @click="choose(user)"><div class="flex justify-between gap-3"><strong>{{ user.nickname || user.username }}</strong><span class="status-tag">{{ label(user.status) }}</span></div><p class="caption">{{ user.username }} · {{ user.role === 'ADMIN' ? '管理员' : '成员' }}</p><p class="member-stat">{{ user.reportCount ?? '—' }} <small>份报告</small><span>{{ user.attemptCount }} 次测评</span></p><p class="caption">AI 今日已用 {{ user.aiUsedToday }} / {{ user.effectiveAiDailyLimit }} 次</p><p class="caption">最近活动 {{ time(user.lastSeenAt) }}</p><span class="member-open">查看档案与报告 →</span></button><label class="member-pick"><input type="checkbox" :checked="picked.includes(user.id)" :disabled="busy" :aria-label="`选中 ${user.nickname || user.username}`" data-member-pick @change="togglePick(user.id, ($event.target as HTMLInputElement).checked)" />选中</label></div></div>
        <form v-if="picked.length" class="batch-bar" data-batch-bar @submit.prevent="askConfirm('set')">
          <p class="batch-count">已选 {{ picked.length }} 位</p>
          <label>每日 AI 额度<input v-model.number="batchLimit" class="input" type="number" min="0" max="10000" step="1" required :disabled="busy" /></label>
          <button class="btn-primary" :disabled="busy">设为该额度</button><button type="button" class="btn-secondary" :disabled="busy" data-batch-reset @click="askConfirm('reset')">恢复系统默认</button><button type="button" class="link" :disabled="busy" @click="resetBatch">取消选择</button>
          <div v-if="confirming" class="batch-confirm" data-batch-confirm><p v-if="confirming === 'reset'">将 {{ picked.length }} 位成员恢复为沿用系统默认额度，之后随系统默认变化。今天已经使用的次数保留；原来单独设定的额度会被清除，且无法查回。</p><p v-else>将修改 {{ picked.length }} 位成员的每日额度为 {{ batchLimit }}。今天已经使用的次数保留；原来单独设定的额度会被覆盖，且无法查回。</p><button type="button" class="btn-primary" :disabled="busy" @click="submitBatch">确认修改</button><button type="button" class="link" :disabled="busy" @click="confirming = null">再想想</button></div>
        </form>
        <nav class="pagination" aria-label="成员翻页"><button :disabled="busy || users.page === 0" @click="goPage(users.page - 1)">上一页</button><span>第 {{ users.page + 1 }} 页</span><button :disabled="busy || (users.page + 1) * users.size >= users.total" @click="goPage(users.page + 1)">下一页</button></nav>
      </section>
      <p v-if="busy" role="status" class="caption">正在处理，请稍等…</p>
      <section v-if="selected" class="member-detail members-section" aria-labelledby="detail-title">
        <div class="section-top"><div><p class="section-kicker">成员档案</p><h2 id="detail-title">{{ selected.nickname || selected.username }}</h2><p class="caption">{{ label(selected.status) }} · 注册于 {{ time(selected.createdAt) }}</p></div><button class="link" :disabled="busy" @click="selected = null; detail = null">收起档案</button></div>
        <form class="quota-form" @submit.prevent="saveLimit"><label>每日 AI 额度<input v-model.number="dailyLimit" class="input" type="number" min="0" max="10000" step="1" required :disabled="busy" /></label><button class="btn-primary" :disabled="busy">保存额度</button><p class="caption">0 次会停止接受新请求。{{ selected.aiDailyLimit === null ? '当前沿用系统默认额度。' : '当前使用单独分配的额度。' }}今日已用 {{ selected.aiUsedToday }} 次，剩余 {{ selected.aiRemainingToday }} 次。正在执行的请求不取消，仍受全站 AI 开关和总预算限制。</p></form>
        <h3 class="mt-8 font-semibold">测评进度</h3><p v-if="!userAttempts.items.length" class="caption mt-3">还没有开始测评。</p>
        <div v-for="a in userAttempts.items" :key="a.attemptId" class="record-row"><div><strong>{{ a.instrumentTitle }}</strong><p class="caption">{{ time(a.updatedAt) }}</p></div><p>{{ attemptStatusLabel(a) }} · {{ attemptProgressLabel(a) }}</p></div>
        <nav class="pagination" aria-label="测评翻页"><button :disabled="busy || userAttempts.page === 0" @click="action(async () => { userAttempts = await api.attempts(selected!.id, userAttempts.page - 1) })">上一页</button><span>共 {{ userAttempts.total }} 次</span><button :disabled="busy || (userAttempts.page + 1) * userAttempts.size >= userAttempts.total" @click="action(async () => { userAttempts = await api.attempts(selected!.id, userAttempts.page + 1) })">下一页</button></nav>
        <h3 class="mt-8 font-semibold">测评报告</h3><p v-if="!userReports.items.length" class="caption mt-3">还没有生成报告。</p>
        <div v-for="r in userReports.items" :key="r.reportId" class="record-row"><div><strong>{{ r.instrumentTitle }}</strong><p>{{ r.summaryLine }}</p><p class="caption">{{ time(r.createdAt) }} · {{ reportStatusLabel(r) }}</p></div><button class="link" :disabled="busy" @click="action(async () => { detail = null; detail = await api.report(selected!.id, r.reportId) })">阅读报告 →</button></div>
        <nav class="pagination" aria-label="报告翻页"><button :disabled="busy || userReports.page === 0" @click="action(async () => { userReports = await api.reports(selected!.id, userReports.page - 1) })">上一页</button><span>共 {{ userReports.total }} 份</span><button :disabled="busy || (userReports.page + 1) * userReports.size >= userReports.total" @click="action(async () => { userReports = await api.reports(selected!.id, userReports.page + 1) })">下一页</button></nav>
        <div v-if="detail" class="report-paper mt-6"><AdminReportReadout :detail="detail" /></div>
      </section>
    </template>
  </PageContainer>
</template>
<style scoped>
.members-page { padding-top: 3rem; padding-bottom: 5rem; }
.members-heading,.section-top { display: flex; justify-content: space-between; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; }
/* 小节标题与 AI 设置页（.section-title）同一口径：无衬线、加粗；原来的大号衬线只在这一页出现 */
h2 { font-family: inherit; font-weight: 700; font-size: 1.35rem; line-height: 1.5; margin-top: .5rem; }
.members-section { margin-top: 3.5rem; padding-top: 2rem; border-top: 1px solid var(--c-line-2); }
.section-top { margin-bottom: 1.5rem; }
.quota-form { display: flex; align-items: end; gap: 1rem; flex-wrap: wrap; }
.filter-toggle { display: inline-flex; align-items: center; gap: .5rem; min-height: 44px; font-size: .875rem; cursor: pointer; }.filter-toggle input,.member-pick input { width: 1.125rem; height: 1.125rem; }
.member-tools { display: flex; flex-wrap: wrap; gap: .25rem 1.5rem; }
.member-item { display: flex; flex-direction: column; gap: .25rem; min-width: 0; }.member-item > .member-card { flex: 1; }
.member-pick { display: inline-flex; align-items: center; gap: .5rem; min-height: 44px; padding: 0 .25rem; font-size: .875rem; cursor: pointer; }
.batch-bar { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: end; flex-wrap: wrap; gap: .75rem 1rem; margin-top: 1rem; padding: 1rem; background: #ffffff; border: 1px solid var(--c-line); border-radius: var(--r-lg); box-shadow: var(--shadow-soft); }
.batch-bar .input { max-width: 10rem; }.batch-bar .link { min-height: 44px; padding: 0 .25rem; }.batch-count { margin: 0; font-weight: 600; align-self: center; }
.batch-confirm { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1rem; }.batch-confirm > p { flex-basis: 100%; margin: 0; }
.batch-failures { margin: .5rem 0 0; padding-left: 1.25rem; list-style: disc; }
label { font-size: .85rem; display: grid; gap: .5rem; max-width: 100%; } .input { min-height: 2.8rem; width: 100%; border: 1px solid var(--c-line-2); border-radius: .5rem; background: #ffffff; padding: .6rem .8rem; font-size: 1rem; }
.quota-form > p { flex-basis: 100%; }.quota-form input { max-width: 12rem; }
.record-row { display: flex; gap: 1rem; align-items: center; border-bottom: 1px solid var(--c-line); padding: 1rem 0; flex-wrap: wrap; }
.record-row > div { flex: 1; min-width: 150px; overflow-wrap: anywhere; }
.status-tag { color: var(--c-brand-deep); background: var(--c-brand-tint); padding: .25rem .6rem; border-radius: 20px; font-size: .72rem; white-space: nowrap; }
.member-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1rem; }
.member-card { text-align: left; padding: 1.5rem; background: #ffffff; box-shadow: var(--shadow-soft); border: 1px solid var(--c-line); border-radius: var(--r-lg); overflow-wrap: anywhere; transition: border-color .15s, transform .15s; }
.member-card:hover,.member-card.selected { border-color: var(--c-brand-deep); }.member-card:focus-visible { outline: 2px solid var(--c-brand-deep); outline-offset: 3px; }
.member-stat { font-size: 2.5rem; font-weight: 800; line-height: 1.3; letter-spacing: -.03em; margin: 1.5rem 0 .8rem; }.member-stat small,.member-stat span { font: .8rem/1.5 sans-serif; }.member-stat span { display: block; color: var(--c-ink-3); }
.member-open { display: block; margin-top: 1.2rem; color: var(--c-brand-deep); font-size: .85rem; }
.pagination { display: flex; align-items: center; justify-content: end; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; font-size: .8rem; }.pagination button { padding: .5rem; min-height: 44px; min-width: 44px; }button:disabled { opacity: .45; cursor: not-allowed; }
.report-paper { background: #ffffff; padding: 2rem; border-radius: 1rem; }
@media(max-width:900px) { .member-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media(max-width:600px) { .members-page { padding-top: 1.5rem; }.member-grid { grid-template-columns: 1fr; }.report-paper { padding: 1rem; } }
</style>
