<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { describeError, isForbidden, type ErrorDisplay } from '@/api/v3'
import {
  fetchAdminAiSettings,
  fetchAdminUsers,
  updateAdminAiSettings,
  type AdminAiSettings,
  type AdminAiSettingsPatch,
  type AdminUserPage,
} from '@/api/v3Admin'

/**
 * 管理后台 · AI 设置（2026-09-17 新增，用户明确要求做这个页面）。
 *
 * 后端 `GET/PUT /api/v3/admin/ai-settings` 与 `GET /api/v3/admin/users` 早已实现，
 * 缺的一直是前端入口。这一页把它们接上，并且只做**这一件事**：
 * 让管理员改 AI 运行参数，以及看到"现在到底生效的是什么"。
 *
 * ## 四条必须守住的规矩
 *
 * 1. **apiKey 只写不读。** 页面上永远不显示 key 的明文或密文，只有"已配置/未配置"
 *    与 8 位指纹（用于确认换没换）。填了就提交，提交完输入框立刻清空 ——
 *    留在 DOM 里哪怕只多一秒，都可能被浏览器密码管理器或下一次截图带走。
 * 2. **只发改动的字段。** 全量提交会把"我没碰过的字段"和"我确认过的字段"混在一起，
 *    一旦页面上有一个值解析错了，保存就会把错值写进库。所以提交前逐个比较，
 *    没有变化的字段根本不进请求体。
 * 3. **改 baseUrl 必须重新输入完整 URL。** 读接口只回主机名（后端刻意如此），
 *    所以页面拿不到完整值，"预填 + 保存"会把主机名写成缺协议的坏 URL。
 * 4. **权限由被保护的那一侧回答，不由 /me 回显。** `/me` 不回 role，
 *    所以这一页挂载时去问一次后台接口：200 就是管理员，403 就是没有权限，
 *    其它情况是"没问到"—— 三态分开，不把后端抖动说成"你没有权限"。
 */

type Access = 'checking' | 'granted' | 'denied' | 'unavailable'

const access = ref<Access>('checking')
const accessError = ref<ErrorDisplay | null>(null)

/** 服务端上次回写的状态（用于"有没有未保存改动"的比较基准）。 */
const saved = ref<AdminAiSettings | null>(null)

/**
 * 表单。所有字段都是字符串：输入框给的就是字符串，转换只在提交时做一次。
 *
 * 写成显式接口而不是字面量推断，是为了让 `form[field.key]` 这种按字段名取值
 * 在类型上成立 —— 否则只能到处 `as` 断言，等于把拼错字段名的检查关掉。
 */
interface AdminForm {
  enabled: boolean
  mockMode: boolean
  baseUrl: string
  model: string
  promptVersion: string
  dailyLimitPerUser: string
  retryLimitPerHour: string
  globalDailyCallBudget: string
  globalDailyTokenBudget: string
  workerConcurrency: string
  connectTimeoutMs: string
  requestDeadlineMs: string
  maxTokens: string
}

/** 会被当作正整数校验的字段名（与界面上的数字输入框一一对应）。 */
type NumericField =
  | 'dailyLimitPerUser'
  | 'retryLimitPerHour'
  | 'globalDailyCallBudget'
  | 'globalDailyTokenBudget'
  | 'workerConcurrency'
  | 'connectTimeoutMs'
  | 'requestDeadlineMs'
  | 'maxTokens'

const form = ref<AdminForm>({
  enabled: false,
  mockMode: false,
  baseUrl: '',
  model: '',
  promptVersion: '',
  dailyLimitPerUser: '',
  retryLimitPerHour: '',
  globalDailyCallBudget: '',
  globalDailyTokenBudget: '',
  workerConcurrency: '',
  connectTimeoutMs: '',
  requestDeadlineMs: '',
  maxTokens: '',
})

/** 新 key。空 = 不动；提交成功后清空。有一个"清除"按钮显式表达另一种意图。 */
const newApiKey = ref('')
const clearKeyRequested = ref(false)

const saving = ref(false)
const saveError = ref<ErrorDisplay | null>(null)
const savedNotice = ref<string | null>(null)

const users = ref<AdminUserPage | null>(null)
const usersError = ref<ErrorDisplay | null>(null)

const fieldId = useId()

function id(name: string): string {
  return `${fieldId}-${name}`
}

/* ── 解析与展示 ─────────────────────────────────────────────────────────── */

function fillForm(settings: AdminAiSettings): void {
  saved.value = settings
  form.value = {
    enabled: settings.enabled,
    mockMode: settings.mockMode,
    // 只回主机名 → 无法预填完整 URL。留空并提示"要改请重新输入完整地址"。
    baseUrl: '',
    model: settings.model,
    promptVersion: settings.promptVersion,
    dailyLimitPerUser: String(settings.dailyLimitPerUser),
    retryLimitPerHour: String(settings.retryLimitPerHour),
    globalDailyCallBudget: String(settings.globalDailyCallBudget),
    globalDailyTokenBudget: String(settings.globalDailyTokenBudget),
    workerConcurrency: String(settings.workerConcurrency),
    connectTimeoutMs: String(settings.connectTimeoutMs),
    requestDeadlineMs: String(settings.requestDeadlineMs),
    maxTokens: String(settings.maxTokens),
  }
  newApiKey.value = ''
  clearKeyRequested.value = false
}

const KEY_SOURCE_LABELS: Record<string, string> = {
  db: '后台设置',
  env: '部署环境变量',
  none: '未配置',
}

const keySourceLabel = computed(() => {
  const settings = saved.value
  if (!settings) return ''
  if (!settings.apiKeyConfigured) return '未配置'
  // 服务端只要给出 source，就一定会是 db/env/none 之一；null 只可能是"响应里没带上
  // 这一项"。这时不去猜是环境变量还是后台设置 —— 猜错会让管理员改错地方。
  if (!settings.apiKeySource) return '已配置（来源未记录）'
  return KEY_SOURCE_LABELS[settings.apiKeySource] ?? settings.apiKeySource
})

const updatedLine = computed(() => {
  const settings = saved.value
  if (!settings?.updatedAt) return '还没有人在后台改过这里的设置。'
  const at = settings.updatedAt.replace('T', ' ').slice(0, 19)
  return settings.updatedBy ? `${at} 由 ${settings.updatedBy} 修改` : `${at} 修改`
})

/* ── 提交 ───────────────────────────────────────────────────────────────── */

/**
 * 把输入框里的数字读成正整数；留空或非法返回 null（= 不改动）。
 *
 * ⚠️ 参数类型写 `unknown` 而不是 `string` 是有依据的：`type="number"` 的输入框
 * 在**真实浏览器与 jsdom 里**都会把 `v-model` 绑定的值改成 number（Vue 对
 * `v-model` + number 输入做了自动转换）。第一个版本的实现直接 `.trim()`，
 * 于是"把 maxTokens 改成 2000"这条最普通的路径会抛 `raw.trim is not a function`。
 * 类型系统看不出这件事（`form.maxTokens` 声明为 string），所以这里按运行时事实处理。
 */
function readPositive(raw: unknown): number | null {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null
  return value
}

/** 哪些字段格式不对。空对象表示可以提交。 */
const invalidFields = computed<Record<string, string>>(() => {
  const problems: Record<string, string> = {}
  const numeric: [NumericField, string][] = [
    ['dailyLimitPerUser', '每人每日次数'],
    ['retryLimitPerHour', '每小时重试上限'],
    ['globalDailyCallBudget', '全局每日调用预算'],
    ['globalDailyTokenBudget', '全局每日 token 预算'],
    ['workerConcurrency', '并发数'],
    ['connectTimeoutMs', '连接超时（毫秒）'],
    ['requestDeadlineMs', '请求总超时（毫秒）'],
    ['maxTokens', '单次最大 token'],
  ]
  for (const [field, label] of numeric) {
    const raw = String(form.value[field] ?? '')
    if (raw.trim() === '') continue
    if (readPositive(raw) === null) problems[field] = `${label}要填正整数。`
  }
  const baseUrl = form.value.baseUrl.trim()
  if (baseUrl && !/^https?:\/\/.+/.test(baseUrl)) {
    problems.baseUrl = '这里要填完整地址，以 http:// 或 https:// 开头。'
  }
  return problems
})

/**
 * 组装补丁：**只放真正变了的字段**。
 *
 * 注意"读了主机名但没有填 baseUrl"不算改动 —— 那只是我们凑不出完整值，
 * 不是管理员想改。所以 baseUrl 只在输入框非空时才进补丁。
 */
function buildPatch(): AdminAiSettingsPatch {
  const current = saved.value
  const patch: AdminAiSettingsPatch = {}
  if (!current) return patch

  if (form.value.enabled !== current.enabled) patch.enabled = form.value.enabled
  if (form.value.mockMode !== current.mockMode) patch.mockMode = form.value.mockMode
  if (form.value.model.trim() !== current.model) patch.model = form.value.model.trim()
  if (form.value.promptVersion.trim() !== current.promptVersion) {
    patch.promptVersion = form.value.promptVersion.trim()
  }
  const baseUrl = form.value.baseUrl.trim()
  if (baseUrl) patch.baseUrl = baseUrl

  const numbers: [NumericField, number][] = [
    ['dailyLimitPerUser', current.dailyLimitPerUser],
    ['retryLimitPerHour', current.retryLimitPerHour],
    ['globalDailyCallBudget', current.globalDailyCallBudget],
    ['globalDailyTokenBudget', current.globalDailyTokenBudget],
    ['workerConcurrency', current.workerConcurrency],
    ['connectTimeoutMs', current.connectTimeoutMs],
    ['requestDeadlineMs', current.requestDeadlineMs],
    ['maxTokens', current.maxTokens],
  ]
  for (const [field, previous] of numbers) {
    const value = readPositive(form.value[field])
    if (value !== null && value !== previous) patch[field] = value
  }
  if (clearKeyRequested.value) {
    // 空串是**明确的清除意图**，与"没填"（字段缺席）是两件事。
    patch.apiKey = ''
  } else if (newApiKey.value.trim()) {
    patch.apiKey = newApiKey.value.trim()
  }
  return patch
}

const patchPreview = computed(() => Object.keys(buildPatch()))

const canSave = computed(
  () => access.value === 'granted' && !saving.value && Object.keys(invalidFields.value).length === 0,
)

const dirtyHint = computed(() => {
  if (patchPreview.value.length === 0) return '还没有改动。'
  return `将提交 ${patchPreview.value.length} 项改动：${patchPreview.value.join('、')}。`
})

async function save(): Promise<void> {
  if (!canSave.value) return
  const patch = buildPatch()
  if (Object.keys(patch).length === 0) return
  saving.value = true
  saveError.value = null
  savedNotice.value = null
  const changedKey = patch.apiKey !== undefined
  try {
    fillForm(await updateAdminAiSettings(patch))
    savedNotice.value = changedKey
      ? '已保存。密钥只写不读，这里只能确认它已更新（见指纹）。'
      : '已保存，下面显示的是服务端当前生效的值。'
  } catch (error) {
    saveError.value = describeError(error)
  } finally {
    saving.value = false
  }
}

async function load(): Promise<void> {
  access.value = 'checking'
  accessError.value = null
  try {
    fillForm(await fetchAdminAiSettings())
    access.value = 'granted'
    void loadUsers()
  } catch (error) {
    accessError.value = describeError(error)
    // 只有服务端明确说"没权限"才是 denied；其它情况是"没问到"。
    access.value = isForbidden(error) ? 'denied' : 'unavailable'
  }
}

async function loadUsers(): Promise<void> {
  usersError.value = null
  try {
    users.value = await fetchAdminUsers({ size: 20 })
  } catch (error) {
    usersError.value = describeError(error)
  }
}

onMounted(load)
</script>

<template>
  <PageContainer page="article">
    <!--
      后台不是普通阅读页：页头用整页唯一一块深色面板把它和前台区分开，
      同时把"这里改的是服务端当前生效的值"这件事放在最显眼的位置。
      下面所有设置与表格仍然留在浅色表面上 —— 管理员要逐项核对数字。
    -->
    <header class="deep-panel deep-grid rounded-cover px-5 py-7 shadow-deep tablet:px-10 tablet:py-10">
      <p class="chip chip-on-deep">
        <AppIcon name="sliders" :size="14" />
        管理后台
      </p>
      <h1 class="display-hero mt-4 text-[24px] leading-tight text-white tablet:text-[30px]">
        AI 分析设置
      </h1>
      <p class="mt-3 max-w-prose text-[15px] leading-[1.75] text-navy-100 tablet:text-[16.5px]">
        这里改的是<strong class="font-semibold text-white">服务端当前生效</strong>的运行参数。保存后立刻生效，不需要重启 ——
        正在排队的分析会按新参数继续。
      </p>
    </header>

    <!-- ── 正在确认权限 ─────────────────────────────────────────────── -->
    <p
      v-if="access === 'checking'"
      class="mt-6 flex items-center gap-2 prose-sm"
      data-admin-checking
    >
      <AppIcon name="clock" :size="17" class="text-ink-faint" />
      正在确认你的权限…
    </p>

    <!-- ── 没有权限（403）─────────────────────────────────────────── -->
    <div v-else-if="access === 'denied'" class="notice-neutral mt-6 max-w-prose" data-admin-denied role="note">
      <p class="flex items-start gap-2 text-[15px] font-medium text-ink">
        <AppIcon name="lock" :size="18" class="mt-0.5" />
        <span>这个页面只对管理员开放。</span>
      </p>
      <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">
        你现在是登录状态，但当前账号不是管理员。权限是在服务端判定的，
        所以这个页面看不到任何设置内容 —— 不是加载失败，也不是网络问题。
      </p>
      <p class="mt-2 text-[14px] leading-relaxed text-ink-soft">
        需要权限的话，请让已有的管理员在后台把你的账号角色改成 ADMIN；
        如果系统里还没有任何管理员，可以用部署配置
        <code class="font-mono text-[13px]">typeme.admin.bootstrap-username</code>
        指定一个已注册账号，重启后它会被提升（系统中已有管理员时这项自动失效）。
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <RouterLink to="/account" class="btn-secondary btn-sm">回到账号页</RouterLink>
      </div>
    </div>

    <!-- ── 没问到（网络/5xx）──────────────────────────────────────── -->
    <div v-else-if="access === 'unavailable'" class="notice-error mt-6 max-w-prose" data-admin-unavailable role="alert">
      <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
        <AppIcon name="alert" :size="17" class="mt-0.5" />
        <span>没能确认你的权限：{{ accessError?.message }}</span>
      </p>
      <p class="mt-2 text-[13.5px] leading-relaxed">
        这不代表你没有权限，可能只是后端暂时没响应。请不要据此去改权限配置。
      </p>
      <p v-if="accessError?.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
        报障编号：<code class="font-mono">{{ accessError.requestId }}</code>
      </p>
      <button type="button" class="btn-secondary mt-3" @click="load">重试</button>
    </div>

    <!-- ── 有权限 ──────────────────────────────────────────────────── -->
    <template v-else>
      <section class="section-rule mt-8" aria-labelledby="admin-current-heading">
        <h2 id="admin-current-heading" class="section-title flex items-center gap-2">
          <AppIcon name="chart" :size="18" class="text-primary-600" />
          当前状态
        </h2>
        <dl class="mt-3 grid gap-x-6 gap-y-2 text-[14.5px] tablet:grid-cols-2" data-admin-summary>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">AI 分析</dt>
            <dd class="font-medium text-ink" data-admin-enabled>{{ saved?.enabled ? '已开启' : '已关闭' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">上游地址</dt>
            <dd class="font-mono text-[13.5px] text-ink" data-admin-base-host>
              {{ saved?.baseUrlHost ?? '未记录' }}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">API 密钥</dt>
            <dd class="font-medium text-ink" data-admin-key-state>{{ keySourceLabel }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">密钥指纹</dt>
            <dd class="font-mono text-[13.5px] text-ink" data-admin-key-fingerprint>
              {{ saved?.apiKeyFingerprint ?? '—' }}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">演示模式</dt>
            <dd class="text-ink" data-admin-mock>{{ saved?.mockMode ? '开启（不调用真实模型）' : '关闭' }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3 border-b border-line py-2">
            <dt class="text-ink-soft">最近修改</dt>
            <dd class="text-ink" data-admin-updated>{{ updatedLine }}</dd>
          </div>
        </dl>
        <p class="caption mt-3 max-w-prose">
          指纹是密钥的 sha256 前 8 位，只用来确认密钥有没有换过；它不可逆，也不能用来调用上游。
          密钥本身在这个页面上永远不回显。
        </p>
      </section>

      <section class="section-rule mt-8" aria-labelledby="admin-key-heading">
        <h2 id="admin-key-heading" class="section-title flex items-center gap-2">
          <AppIcon name="lock" :size="18" class="text-primary-600" />
          API 密钥
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          只写不读：填入新密钥后保存会替换掉现有的；留空则不动。要彻底清除，勾选下面的「清除密钥」。
          保存前请确认部署中已配置
          <code class="font-mono text-[13px]">typeme.security.settings-secret</code>，
          否则服务端会拒绝写入（不会退化成明文保存）。
        </p>

        <div class="mt-4 max-w-prose">
          <label :for="id('api-key')" class="block text-[14.5px] font-medium text-ink">新的 API 密钥</label>
          <input
            :id="id('api-key')"
            v-model="newApiKey"
            name="admin-api-key"
            type="password"
            autocomplete="off"
            spellcheck="false"
            data-admin-key-input
            placeholder="留空表示不改动"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 font-mono text-[15px] text-ink"
          />
          <p class="caption mt-2">
            填在这里的值只用于本次提交，保存成功后输入框会被清空；页面上不会显示已保存的密钥。
          </p>

          <div class="mt-4 flex items-start gap-2.5">
            <input
              :id="id('clear-key')"
              v-model="clearKeyRequested"
              type="checkbox"
              :disabled="!saved?.apiKeyConfigured"
              data-admin-clear-key
              class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong"
            />
            <label :for="id('clear-key')" class="text-[14px] leading-relaxed text-ink">
              清除已保存的密钥
              <span v-if="!saved?.apiKeyConfigured" class="text-ink-faint">（当前没有已保存的密钥）</span>
            </label>
          </div>
          <p
            v-if="clearKeyRequested"
            class="notice-uncertain mt-3 flex items-start gap-2 text-[13.5px] leading-relaxed"
            data-admin-clear-warning
          >
            <AppIcon name="alert" :size="17" class="mt-0.5" />
            <span>
              保存后会清除已保存的密钥。如果部署环境变量里还有密钥，则会回落到那一份 ——
              想彻底断开，请同时处理环境变量。
            </span>
          </p>
        </div>
      </section>

      <section class="section-rule mt-8" aria-labelledby="admin-params-heading">
        <h2 id="admin-params-heading" class="section-title flex items-center gap-2">
          <AppIcon name="sliders" :size="18" class="text-primary-600" />
          运行参数
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          留空表示保持当前值。所有数值都是正整数，输入不合法时保存按钮会被禁用并说明原因。
        </p>

        <div class="mt-4 grid max-w-[46rem] gap-5 tablet:grid-cols-2">
          <div class="tablet:col-span-2">
            <label :for="id('base-url')" class="block text-[14.5px] font-medium text-ink">上游完整地址</label>
            <input
              :id="id('base-url')"
              v-model="form.baseUrl"
              name="admin-base-url"
              type="text"
              inputmode="url"
              autocomplete="off"
              spellcheck="false"
              data-admin-base-url
              :placeholder="saved?.baseUrlHost ? `当前是 ${saved.baseUrlHost}，要改请填完整地址` : 'https://…'"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 font-mono text-[15px] text-ink"
            />
            <p class="caption mt-2">
              读取接口只返回主机名（<span class="font-mono">{{ saved?.baseUrlHost ?? '未记录' }}</span>），
              所以这里<strong class="font-medium text-ink-soft">不预填</strong>：改地址必须重新输入完整 URL，避免把主机名写成缺协议的坏值。
            </p>
            <p v-if="invalidFields.baseUrl" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.baseUrl }}</p>
          </div>

          <div>
            <label :for="id('model')" class="block text-[14.5px] font-medium text-ink">模型名</label>
            <input
              :id="id('model')"
              v-model="form.model"
              name="admin-model"
              type="text"
              autocomplete="off"
              spellcheck="false"
              data-admin-model
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            />
          </div>
          <div>
            <label :for="id('prompt-version')" class="block text-[14.5px] font-medium text-ink">提示词版本</label>
            <input
              :id="id('prompt-version')"
              v-model="form.promptVersion"
              name="admin-prompt-version"
              type="text"
              autocomplete="off"
              spellcheck="false"
              data-admin-prompt-version
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink"
            />
          </div>

          <!--
            八个数字字段逐个写出来，而不是 `v-for` + `form[field.key]`。
            动态下标会让 `v-model` 的类型检查失效（`form[key]` 是 any），
            于是"拼错字段名"这件事要等到运行时才发现 —— 而这里恰恰是最不能
            写错的地方：写错就是把一个配额改成了别的配额。
          -->
          <div>
            <label :for="id('dailyLimitPerUser')" class="block text-[14.5px] font-medium text-ink">每人每日次数</label>
            <input :id="id('dailyLimitPerUser')" v-model="form.dailyLimitPerUser" name="admin-dailyLimitPerUser" type="number" min="1" step="1" inputmode="numeric" data-admin-number="dailyLimitPerUser" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.dailyLimitPerUser" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.dailyLimitPerUser }}</p>
          </div>
          <div>
            <label :for="id('retryLimitPerHour')" class="block text-[14.5px] font-medium text-ink">每小时重试上限</label>
            <input :id="id('retryLimitPerHour')" v-model="form.retryLimitPerHour" name="admin-retryLimitPerHour" type="number" min="1" step="1" inputmode="numeric" data-admin-number="retryLimitPerHour" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.retryLimitPerHour" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.retryLimitPerHour }}</p>
          </div>
          <div>
            <label :for="id('globalDailyCallBudget')" class="block text-[14.5px] font-medium text-ink">全局每日调用预算</label>
            <input :id="id('globalDailyCallBudget')" v-model="form.globalDailyCallBudget" name="admin-globalDailyCallBudget" type="number" min="1" step="1" inputmode="numeric" data-admin-number="globalDailyCallBudget" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.globalDailyCallBudget" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.globalDailyCallBudget }}</p>
          </div>
          <div>
            <label :for="id('globalDailyTokenBudget')" class="block text-[14.5px] font-medium text-ink">全局每日 token 预算</label>
            <input :id="id('globalDailyTokenBudget')" v-model="form.globalDailyTokenBudget" name="admin-globalDailyTokenBudget" type="number" min="1" step="1" inputmode="numeric" data-admin-number="globalDailyTokenBudget" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.globalDailyTokenBudget" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.globalDailyTokenBudget }}</p>
          </div>
          <div>
            <label :for="id('workerConcurrency')" class="block text-[14.5px] font-medium text-ink">并发数</label>
            <input :id="id('workerConcurrency')" v-model="form.workerConcurrency" name="admin-workerConcurrency" type="number" min="1" step="1" inputmode="numeric" data-admin-number="workerConcurrency" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.workerConcurrency" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.workerConcurrency }}</p>
          </div>
          <div>
            <label :for="id('maxTokens')" class="block text-[14.5px] font-medium text-ink">单次最大 token</label>
            <input :id="id('maxTokens')" v-model="form.maxTokens" name="admin-maxTokens" type="number" min="1" step="1" inputmode="numeric" data-admin-number="maxTokens" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.maxTokens" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.maxTokens }}</p>
          </div>
          <div>
            <label :for="id('connectTimeoutMs')" class="block text-[14.5px] font-medium text-ink">连接超时（毫秒）</label>
            <input :id="id('connectTimeoutMs')" v-model="form.connectTimeoutMs" name="admin-connectTimeoutMs" type="number" min="1" step="1" inputmode="numeric" data-admin-number="connectTimeoutMs" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.connectTimeoutMs" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.connectTimeoutMs }}</p>
          </div>
          <div>
            <label :for="id('requestDeadlineMs')" class="block text-[14.5px] font-medium text-ink">请求总超时（毫秒）</label>
            <input :id="id('requestDeadlineMs')" v-model="form.requestDeadlineMs" name="admin-requestDeadlineMs" type="number" min="1" step="1" inputmode="numeric" data-admin-number="requestDeadlineMs" class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[15px] text-ink" />
            <p v-if="invalidFields.requestDeadlineMs" class="mt-1.5 text-[13px] text-accent-700">{{ invalidFields.requestDeadlineMs }}</p>
          </div>
        </div>

        <fieldset class="mt-6 max-w-[46rem]">
          <legend class="text-[14.5px] font-medium text-ink">开关</legend>
          <div class="mt-3 flex items-start gap-2.5">
            <input :id="id('enabled')" v-model="form.enabled" type="checkbox" data-admin-enabled-toggle class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong" />
            <label :for="id('enabled')" class="text-[14px] leading-relaxed text-ink">
              开启 AI 分析（关掉后报告页只显示固定报告，不再提供分析入口）
            </label>
          </div>
          <div class="mt-3 flex items-start gap-2.5">
            <input :id="id('mock')" v-model="form.mockMode" type="checkbox" data-admin-mock-toggle class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong" />
            <label :for="id('mock')" class="text-[14px] leading-relaxed text-ink">
              演示模式：返回固定示例文本，不调用真实模型（用于联调与演练）
            </label>
          </div>
        </fieldset>
      </section>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="btn-primary"
          :disabled="!canSave || patchPreview.length === 0"
          data-admin-save
          @click="save"
        >
          {{ saving ? '正在保存…' : '保存设置' }}
        </button>
        <RouterLink to="/account" class="btn-ghost">回到账号页</RouterLink>
        <p class="caption" data-admin-dirty>{{ dirtyHint }}</p>
      </div>

      <div v-if="saveError" class="notice-error mt-4 max-w-prose" role="alert" data-admin-save-error>
        <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>{{ saveError.message }}</span>
        </p>
        <ul v-if="saveError.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
          <li v-for="item in saveError.fields" :key="item.field">{{ item.label }}：{{ item.message }}</li>
        </ul>
        <p v-if="saveError.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
          报障编号：<code class="font-mono">{{ saveError.requestId }}</code>
        </p>
      </div>

      <!-- 保存成功 = 已确认写入，用成功色（与上面的失败红块分开） -->
      <p
        v-if="savedNotice"
        class="notice-success mt-4 flex max-w-prose items-start gap-2 text-[14px] leading-relaxed"
        role="status"
        data-admin-saved
      >
        <AppIcon name="check" :size="17" class="mt-0.5" />
        <span>{{ savedNotice }}</span>
      </p>

      <!-- ── 只读的用户概览 ─────────────────────────────────────────── -->
      <section class="section-rule mt-8" aria-labelledby="admin-users-heading">
        <h2 id="admin-users-heading" class="section-title flex items-center gap-2">
          <AppIcon name="user" :size="18" class="text-primary-600" />
          账号概览（只读）
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          用来确认"设置到底对谁生效"。这一页<strong class="font-medium text-ink-soft">不提供</strong>改角色或禁用账号的操作：
          禁用会撤销对方的全部会话、把账号置为不可登录，属于不可逆操作，
          需要单独确认后再开放入口。
        </p>

        <div v-if="usersError" class="notice-error mt-3 max-w-prose" role="alert">
          <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
            <AppIcon name="alert" :size="17" class="mt-0.5" />
            <span>账号列表没能载入：{{ usersError.message }}</span>
          </p>
          <button type="button" class="btn-secondary mt-3" @click="loadUsers">重试</button>
        </div>

        <p v-else-if="!users" class="mt-3 prose-sm">正在载入账号…</p>

        <p v-else-if="users.items.length === 0" class="notice-neutral mt-3 text-[14px]">还没有账号。</p>

        <div v-else class="mt-4">
          <!-- 表格是一组只读事实：给一张卡片，横向滚动收在卡片里 -->
          <div class="overflow-hidden rounded-question border border-line bg-surface shadow-card">
            <div class="overflow-x-auto px-4 tablet:px-5">
              <table class="w-full min-w-[36rem] border-collapse text-left text-[14px]" data-admin-users>
                <caption class="sr-only">账号列表（只读，共 {{ users.total }} 个）</caption>
                <thead>
                  <tr class="border-b border-line-strong text-[13px] text-ink-soft">
                    <th scope="col" class="py-2 pr-3 font-medium">用户名</th>
                    <th scope="col" class="py-2 pr-3 font-medium">角色</th>
                    <th scope="col" class="py-2 pr-3 font-medium">状态</th>
                    <th scope="col" class="py-2 pr-3 font-medium">注册时间</th>
                    <th scope="col" class="py-2 font-medium">报告数</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="user in users.items" :key="user.id" class="border-b border-line last:border-b-0" :data-admin-user="user.username">
                    <th scope="row" class="py-2.5 pr-3 font-medium text-ink">
                      {{ user.username }}
                      <span v-if="user.nickname" class="ml-1.5 text-[13px] font-normal text-ink-faint">{{ user.nickname }}</span>
                    </th>
                    <td class="py-2.5 pr-3 text-ink-soft">{{ user.role }}</td>
                    <td class="py-2.5 pr-3 text-ink-soft">{{ user.status }}</td>
                    <td class="py-2.5 pr-3 text-ink-soft">
                      {{ user.createdAt ? user.createdAt.replace('T', ' ').slice(0, 16) : '—' }}
                    </td>
                    <td class="py-2.5 text-ink-soft">
                      <!-- null = 未知，不是 0。把未知显示成 0 会让管理员以为这个账号没测过。 -->
                      <span v-if="user.reportCount === null" class="text-ink-faint">未知</span>
                      <span v-else class="tabular">{{ user.reportCount }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <p class="caption mt-3">共 {{ users.total }} 个账号，这里显示前 {{ users.items.length }} 个。</p>
        </div>
      </section>
    </template>
  </PageContainer>
</template>
