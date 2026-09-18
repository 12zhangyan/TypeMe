<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AdminReportReadout from '@/components/AdminReportReadout.vue'
import * as api from '@/api/adminMembers'
import { describeError, isForbidden } from '@/api/v3'
import type { MyAttemptRow, MyReportRow, ReportDetailView } from '@/api/platformV3'
const empty = <T>(): api.Page<T> => ({ items: [], page: 0, size: 10, total: 0 })
const users = ref(empty<api.Member>())
const invites = ref(empty<api.Invitation>())
const userAttempts = ref(empty<MyAttemptRow>())
const userReports = ref(empty<MyReportRow>())
const selected = ref<api.Member | null>(null)
const detail = ref<ReportDetailView | null>(null)
const loading = ref(false), busy = ref(false), denied = ref(false), ready = ref(false)
const error = ref(''), notice = ref(''), newCode = ref(''), newCodeExpiry = ref('')
const dailyLimit = ref(0)
const expiryDays = ref(7)
const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const expiresAt = ref(localDate(new Date(Date.now() + 7 * 86400000)))
const time = (value: string | null) => value ? new Date(value).toLocaleString() : '暂无记录'
const labels: Record<string, string> = { ACTIVE: '正常', DISABLED: '已禁用', DELETION_PENDING: '注销处理中', AVAILABLE: '待使用', USED: '已使用', EXPIRED: '已过期', REVOKED: '已撤销', DRAFT: '答题中', BASE_IN_PROGRESS: '主测答题中', CLARIFICATION_IN_PROGRESS: '补充答题中', READY_TO_SUBMIT: '待提交', PROFILE: '五维参考结果', IN_PROGRESS: '答题中', SUBMITTED: '已完成', COMPLETED: '已完成', ABANDONED: '已结束', REFERENCE: '参考结果', TENTATIVE: '倾向较轻', TIED: '两边接近' }
const label = (value: string) => labels[value] ?? value
function fail(e: unknown) {
  const display = describeError(e)
  if (isForbidden(e) || display.sessionExpired) { denied.value = isForbidden(e); ready.value = false; selected.value = null; detail.value = null; newCode.value = ''; users.value = empty(); invites.value = empty() }
  error.value = display.message
}
async function load() {
  if (loading.value) return
  loading.value = true; error.value = ''; denied.value = false
  try { users.value = await api.members(); invites.value = await api.invitations(); ready.value = true }
  catch (e) { fail(e) } finally { loading.value = false }
}
async function action(work: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
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
  if (!user || !Number.isInteger(dailyLimit.value) || dailyLimit.value < 0 || dailyLimit.value > 10000) { error.value = '每日额度请输入 0–10000 的整数。'; return }
  await action(async () => {
    const updated = await api.setDailyLimit(user.id, dailyLimit.value)
    selected.value = updated; users.value.items = users.value.items.map(item => item.id === user.id ? updated : item)
    notice.value = '每日额度已保存。今天已经使用的次数保留。'
  })
}
function presetExpiry() { expiresAt.value = localDate(new Date(Date.now() + expiryDays.value * 86400000)) }
async function create() {
  const date = new Date(expiresAt.value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > Date.now() + 365 * 86400000) { error.value = '请选择未来一年内的过期时间。'; return }
  await action(async () => {
    newCode.value = ''
    const created = await api.createInvitation(date.toISOString())
    newCode.value = created.code; newCodeExpiry.value = created.expiresAt
    notice.value = '邀请码已生成，请现在保存；完整内容只显示这一次。'
    invites.value = await api.invitations()
  })
}
async function copy() {
  try { await navigator.clipboard.writeText(newCode.value); notice.value = '已复制邀请码。请通过可信渠道交给受邀人。' }
  catch { error.value = '浏览器不允许复制，请手动选中邀请码复制。' }
}
onMounted(load)
</script>
<template>
  <PageContainer page="home" class="members-page">
    <header class="members-heading">
      <div><p class="section-kicker">管理后台 / 成员空间</p><h1>让每一次探索，<br><em>都有照应。</em></h1><p class="prose-cn mt-5">管理邀请、了解测评进度，为成员分配 AI 解读额度。</p></div>
      <RouterLink to="/admin" class="link">AI 服务设置 ↗</RouterLink>
    </header>
    <p v-if="loading" role="status" class="card">正在读取成员与邀请…</p>
    <div v-if="error" class="notice-error mt-5" role="alert">{{ error }} <button v-if="!ready && !denied" class="link" :disabled="loading" @click="load">重试</button><RouterLink to="/login" class="link ml-3">重新登录</RouterLink></div>
    <p v-if="denied" class="notice-uncertain mt-4">此页面仅对管理员开放。<RouterLink to="/account" class="link">返回账号页</RouterLink></p>
    <p v-if="notice" class="notice-success mt-4" role="status">{{ notice }}</p>
    <template v-if="ready && !denied">
      <section class="members-section" aria-labelledby="invite-title">
        <div class="section-top"><div><p class="section-kicker">01 / 邀请加入</p><h2 id="invite-title">从一份邀请开始</h2></div><p class="caption">一码一人 · 使用即失效</p></div>
        <form class="invite-form" @submit.prevent="create">
          <label>有效时长<select v-model="expiryDays" class="input" :disabled="busy" @change="presetExpiry"><option :value="1">1 天</option><option :value="7">7 天</option><option :value="30">30 天</option></select></label>
          <label>过期时间（本地时间）<input v-model="expiresAt" class="input" type="datetime-local" required :disabled="busy" /></label>
          <button class="btn-primary" :disabled="busy">生成邀请码</button>
        </form>
        <div v-if="newCode" class="invite-result" role="status"><p>完整邀请码 · 请现在保存</p><code data-testid="new-invitation">{{ newCode }}</code><p class="caption">到期：{{ time(newCodeExpiry) }}。刷新或离开页面后无法再次查看。</p><div class="flex flex-wrap gap-4 mt-3"><button class="btn-secondary" @click="copy">复制邀请码</button><button class="link" @click="newCode = ''">我已保存，隐藏</button></div></div>
        <div class="invite-list"><p v-if="!invites.items.length" class="caption">还没有邀请码。生成一份邀请，让成员加入。</p>
          <div v-for="item in invites.items" :key="item.id" class="invite-row"><span class="status-tag">{{ label(item.status) }}</span><div><p>{{ item.usedByUsername ? `使用人：${item.usedByUsername}` : '一次性注册邀请' }}</p><p class="caption">创建 {{ time(item.createdAt) }} · 到期 {{ time(item.expiresAt) }}</p></div><button v-if="item.status === 'AVAILABLE'" class="link" :disabled="busy" @click="action(async () => { await api.revokeInvitation(item.id); notice = '邀请码已撤销。'; invites = await api.invitations(invites.page) })">撤销</button></div>
        </div>
        <nav class="pagination" aria-label="邀请码翻页"><button :disabled="busy || invites.page === 0" @click="action(async () => { invites = await api.invitations(invites.page - 1) })">上一页</button><span>第 {{ invites.page + 1 }} 页 · 共 {{ invites.total }} 份</span><button :disabled="busy || (invites.page + 1) * invites.size >= invites.total" @click="action(async () => { invites = await api.invitations(invites.page + 1) })">下一页</button></nav>
      </section>
      <section class="members-section" aria-labelledby="members-title">
        <div class="section-top"><div><p class="section-kicker">02 / 成员档案</p><h2 id="members-title">每个人的探索足迹</h2></div><span class="caption">{{ users.total }} 位成员</span></div>
        <p class="caption mb-5">最近活动表示会话最后使用时间，不代表此刻在线。每日额度于 UTC 00:00（北京时间 08:00）重置。</p>
        <p v-if="!users.items.length" class="caption">暂无成员。</p>
        <div class="member-grid"><button v-for="user in users.items" :key="user.id" class="member-card" :class="{ selected: selected?.id === user.id }" :disabled="busy" @click="choose(user)"><div class="flex justify-between gap-3"><strong>{{ user.nickname || user.username }}</strong><span class="status-tag">{{ label(user.status) }}</span></div><p class="caption">{{ user.username }} · {{ user.role === 'ADMIN' ? '管理员' : '成员' }}</p><p class="member-stat">{{ user.reportCount ?? '—' }} <small>份报告</small><span>{{ user.attemptCount }} 次测评</span></p><p class="caption">AI 今日已用 {{ user.aiUsedToday }} / {{ user.effectiveAiDailyLimit }} 次</p><p class="caption">最近活动 {{ time(user.lastSeenAt) }}</p><span class="member-open">查看档案与报告 →</span></button></div>
        <nav class="pagination" aria-label="成员翻页"><button :disabled="busy || users.page === 0" @click="action(async () => { users = await api.members(users.page - 1) })">上一页</button><span>第 {{ users.page + 1 }} 页</span><button :disabled="busy || (users.page + 1) * users.size >= users.total" @click="action(async () => { users = await api.members(users.page + 1) })">下一页</button></nav>
      </section>
      <p v-if="busy" role="status" class="caption">正在处理，请稍等…</p>
      <section v-if="selected" class="member-detail members-section" aria-labelledby="detail-title">
        <div class="section-top"><div><p class="section-kicker">成员档案</p><h2 id="detail-title">{{ selected.nickname || selected.username }}</h2><p class="caption">{{ label(selected.status) }} · 注册于 {{ time(selected.createdAt) }}</p></div><button class="link" :disabled="busy" @click="selected = null; detail = null">收起档案</button></div>
        <form class="quota-form" @submit.prevent="saveLimit"><label>每日 AI 额度<input v-model.number="dailyLimit" class="input" type="number" min="0" max="10000" step="1" required :disabled="busy" /></label><button class="btn-primary" :disabled="busy">保存额度</button><p class="caption">0 次会停止接受新请求。{{ selected.aiDailyLimit === null ? '当前沿用系统默认额度。' : '当前使用单独分配的额度。' }}今日已用 {{ selected.aiUsedToday }} 次，剩余 {{ selected.aiRemainingToday }} 次。正在执行的请求不取消，仍受全站 AI 开关和总预算限制。</p></form>
        <h3 class="mt-8 font-semibold">测评进度</h3><p v-if="!userAttempts.items.length" class="caption mt-3">还没有开始测评。</p>
        <div v-for="a in userAttempts.items" :key="a.attemptId" class="record-row"><div><strong>{{ a.instrumentTitle }}</strong><p class="caption">{{ time(a.updatedAt) }}</p></div><p>{{ label(a.status) }} · 已答 {{ a.answeredCount }} / {{ a.requiredCount }} 题</p></div>
        <nav class="pagination" aria-label="测评翻页"><button :disabled="busy || userAttempts.page === 0" @click="action(async () => { userAttempts = await api.attempts(selected!.id, userAttempts.page - 1) })">上一页</button><span>共 {{ userAttempts.total }} 次</span><button :disabled="busy || (userAttempts.page + 1) * userAttempts.size >= userAttempts.total" @click="action(async () => { userAttempts = await api.attempts(selected!.id, userAttempts.page + 1) })">下一页</button></nav>
        <h3 class="mt-8 font-semibold">测评报告</h3><p v-if="!userReports.items.length" class="caption mt-3">还没有生成报告。</p>
        <div v-for="r in userReports.items" :key="r.reportId" class="record-row"><div><strong>{{ r.instrumentTitle }}</strong><p>{{ r.summaryLine }}</p><p class="caption">{{ time(r.createdAt) }} · {{ label(r.status) }}</p></div><button class="link" :disabled="busy" @click="action(async () => { detail = null; detail = await api.report(selected!.id, r.reportId) })">阅读报告 →</button></div>
        <nav class="pagination" aria-label="报告翻页"><button :disabled="busy || userReports.page === 0" @click="action(async () => { userReports = await api.reports(selected!.id, userReports.page - 1) })">上一页</button><span>共 {{ userReports.total }} 份</span><button :disabled="busy || (userReports.page + 1) * userReports.size >= userReports.total" @click="action(async () => { userReports = await api.reports(selected!.id, userReports.page + 1) })">下一页</button></nav>
        <div v-if="detail" class="report-paper mt-6"><AdminReportReadout :detail="detail" /></div>
      </section>
    </template>
  </PageContainer>
</template>
<style scoped>
.members-page { padding-top: 3rem; padding-bottom: 5rem; }
.members-heading,.section-top { display: flex; justify-content: space-between; align-items: baseline; gap: 1.5rem; flex-wrap: wrap; }
h1 { font: 3.5rem/1.22 SimSun, serif; letter-spacing: -.04em; margin-top: 1rem; } h1 em { color: #315642; font-style: normal; }
h2 { font: 1.8rem/1.5 SimSun, serif; margin-top: .5rem; }
.members-section { margin-top: 3.5rem; padding-top: 2rem; border-top: 1px solid #cbd1c6; }
.section-top { margin-bottom: 1.5rem; }
.invite-form,.quota-form { display: flex; align-items: end; gap: 1rem; flex-wrap: wrap; }
label { font-size: .85rem; display: grid; gap: .5rem; max-width: 100%; } .input { min-height: 2.8rem; width: 100%; border: 1px solid #ccd4c6; border-radius: .5rem; background: #fffef9; padding: .6rem .8rem; font-size: 1rem; }
.quota-form > p { flex-basis: 100%; }.quota-form input { max-width: 12rem; }
.invite-result { padding: 1.5rem; background: #e5eddf; margin-top: 1.5rem; border-radius: 1rem; }
.invite-result code { display: block; font-size: 1.35rem; overflow-wrap: anywhere; margin: .8rem 0; user-select: all; }
.invite-list { margin-top: 1.5rem; }.invite-row,.record-row { display: flex; gap: 1rem; align-items: center; border-bottom: 1px solid #e1e3d9; padding: 1rem 0; flex-wrap: wrap; }
.invite-row > div,.record-row > div { flex: 1; min-width: 150px; overflow-wrap: anywhere; }
.status-tag { color: #315642; background: #e8eddf; padding: .25rem .6rem; border-radius: 20px; font-size: .72rem; white-space: nowrap; }
.member-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 1rem; }
.member-card { text-align: left; padding: 1.5rem; background: #fffef9; border: 1px solid #dfe2d6; border-radius: 1rem; overflow-wrap: anywhere; transition: border-color .15s; }
.member-card:hover,.member-card.selected { border-color: #315642; }.member-card:focus-visible { outline: 2px solid #315642; outline-offset: 3px; }
.member-stat { font: 2.5rem/1.3 Georgia,serif; margin: 1.5rem 0 .8rem; }.member-stat small,.member-stat span { font: .8rem/1.5 sans-serif; }.member-stat span { display: block; color: #627161; }
.member-open { display: block; margin-top: 1.2rem; color: #315642; font-size: .85rem; }
.pagination { display: flex; align-items: center; justify-content: end; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; font-size: .8rem; }.pagination button { padding: .5rem; min-height: 44px; min-width: 44px; }button:disabled { opacity: .45; cursor: not-allowed; }
.report-paper { background: #fffef9; padding: 2rem; border-radius: 1rem; }
@media(max-width:900px) { .member-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media(max-width:600px) { .members-page { padding-top: 1.5rem; }h1 { font-size: 2.5rem; }.member-grid { grid-template-columns: 1fr; }.invite-form > label { width: 100%; }.invite-form > button { width: 100%; }.report-paper { padding: 1rem; } }
</style>
