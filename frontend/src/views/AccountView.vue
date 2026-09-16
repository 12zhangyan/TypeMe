<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import PageContainer from '@/components/PageContainer.vue'

/**
 * 账号与数据 —— 契约 `02-数据模型与API-v1.md` §7.2（`/api/v3/me/**`）。
 *
 * 这一页承担的是"用户能自己掌控自己的账号"这件事，所以每一块都遵守同一条纪律：
 * **说清楚会发生什么，然后照实做**。
 *   - 改密之后其他设备的登录会退出（当前这个保留）；
 *   - 恢复码只显示一次，且旧的作废；已经生成过的那组**查不出来**（服务端只存 hash）；
 *   - 导出是真实的 JSON 文件，包含账号资料、测评、答案、报告与 AI 记录；
 *   - 注销是异步受理（202），但会话立刻失效，页面上不写"已经删干净了"。
 *
 * 危险操作走两步：先展开确认区，再由"勾选 + 密码 + 明确的红色按钮"完成。
 * 这里不放行任何"点一下就删"的路径，也不默认把焦点落在删除按钮上。
 */
const auth = useAuthStore()
const router = useRouter()

type Section = 'nickname' | 'password' | 'codes' | 'export' | 'delete'

const profile = computed(() => auth.profile)
const error = computed(() => auth.lastError)
/** 错误只显示在发起它的那一块里，不要四个表单同时报同一个错 */
const errorSection = ref<Section | null>(null)

/* ── 账号资料 ──────────────────────────────────────────────────────────── */
const nickname = ref('')
const nicknameSaved = ref(false)
const nicknameId = `acc-nickname-${useId()}`
const nicknameHintId = `acc-nickname-hint-${useId()}`

/* ── 改密码 ────────────────────────────────────────────────────────────── */
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordChanged = ref(false)
const currentPasswordId = `acc-current-${useId()}`
const newPasswordId = `acc-new-${useId()}`
const confirmPasswordId = `acc-confirm-${useId()}`
const passwordHintId = `acc-password-hint-${useId()}`

/* ── 恢复码 ────────────────────────────────────────────────────────────── */
const codesPassword = ref('')
const recoveryCodes = ref<string[]>([])
const codesCopied = ref(false)
const codesPasswordId = `acc-codes-pw-${useId()}`
const codesHintId = `acc-codes-hint-${useId()}`
const codesCopiedId = `acc-codes-copied-${useId()}`

/* ── 导出 ──────────────────────────────────────────────────────────────── */
const exportMessage = ref<string | null>(null)
const exportHintId = `acc-export-hint-${useId()}`

/* ── 注销 ──────────────────────────────────────────────────────────────── */
const deletePanelOpen = ref(false)
const deleteAcknowledged = ref(false)
const deletePassword = ref('')
const deletionJobId = ref<string | null>(null)
const deletionAccepted = ref(false)
const deletePasswordId = `acc-delete-pw-${useId()}`
const deleteAckId = `acc-delete-ack-${useId()}`
const deleteHintId = `acc-delete-hint-${useId()}`

onMounted(() => {
  auth.clearError()
  nickname.value = profile.value?.nickname ?? ''
})

/** ISO 时间 → 本地时间；服务端给的时间一律按 UTC 存，展示要按用户时区。 */
function formatTime(value: string | null): string {
  if (!value) return '没有记录'
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

async function run(section: Section, action: () => Promise<void>) {
  errorSection.value = section
  try {
    await action()
  } catch {
    // 失败已经整理进 auth.lastError（含 requestId），模板按 section 渲染
  }
}

/* ── 昵称 ──────────────────────────────────────────────────────────────── */
const nicknameProblem = computed(() => {
  if (auth.busy) return '正在保存，请稍等。'
  if (!nickname.value.trim()) return '昵称不能留空 —— 不想用真名的话，写个代号也行。'
  if (nickname.value.trim().length > 32) return '昵称最多 32 个字。'
  return null
})

async function saveNickname() {
  if (nicknameProblem.value) return
  nicknameSaved.value = false
  await run('nickname', async () => {
    await auth.saveNickname(nickname.value.trim())
    nickname.value = profile.value?.nickname ?? nickname.value.trim()
    nicknameSaved.value = true
  })
}

/* ── 改密 ──────────────────────────────────────────────────────────────── */
const passwordProblem = computed(() => {
  if (auth.busy) return '正在提交，请稍等。'
  if (!currentPassword.value) return '先填当前密码。'
  if (newPassword.value.length < 8) return '新密码至少 8 位。'
  if (newPassword.value.length > 72) return '新密码最多 72 位。'
  if (!/^[\x20-\x7E]+$/.test(newPassword.value)) return '新密码只能用英文、数字和键盘上的符号。'
  if (confirmPassword.value !== newPassword.value) return '两次输入的新密码不一样。'
  if (newPassword.value === currentPassword.value) return '新密码和当前密码是同一个，换一个吧。'
  return null
})

async function changePassword() {
  if (passwordProblem.value) return
  passwordChanged.value = false
  await run('password', async () => {
    await auth.changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordChanged.value = true
  })
}

/* ── 恢复码 ────────────────────────────────────────────────────────────── */
const codesProblem = computed(() => {
  if (auth.busy) return '正在生成，请稍等。'
  if (!codesPassword.value) return '生成新恢复码需要重新输入一次密码。'
  return null
})

const codesLeaveReason = computed(() => {
  if (auth.busy) return '正在处理，请稍等。'
  if (!codesCopied.value) return '先确认你已经把新的恢复码抄下来了。'
  return null
})

async function regenerateCodes() {
  if (codesProblem.value) return
  codesCopied.value = false
  await run('codes', async () => {
    recoveryCodes.value = await auth.issueRecoveryCodes(codesPassword.value)
    codesPassword.value = ''
  })
}

/* ── 导出 ──────────────────────────────────────────────────────────────── */
async function exportData() {
  exportMessage.value = null
  await run('export', async () => {
    const { blob, filename } = await auth.exportData()
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
      exportMessage.value = '这台设备不支持直接下载文件，请在桌面浏览器里再试一次。'
      return
    }
    const url = URL.createObjectURL(blob)
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.rel = 'noopener'
      document.body.appendChild(link)
      link.click()
      link.remove()
    } finally {
      // 立刻 revoke 会让部分浏览器下载中断，等一会儿再释放
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    exportMessage.value = `已经导出 ${filename}：账号资料、测评记录、答案、报告与 AI 分析记录都在里面。`
  })
}

/* ── 注销 ──────────────────────────────────────────────────────────────── */
const deleteProblem = computed(() => {
  if (auth.busy) return '正在提交，请稍等。'
  if (!deleteAcknowledged.value) return '先勾选"我知道这会删除全部记录、无法恢复"。'
  if (!deletePassword.value) return '注销需要再输入一次密码。'
  return null
})

async function deleteAccount() {
  if (deleteProblem.value) return
  await run('delete', async () => {
    // 契约 §6.2 要求请求体里 `confirm` 逐字为 DELETE：勾选框就是那句确认，
    // 字面量由客户端填（服务端校验的是"这次请求确实带了确认词"）。
    const result = await auth.deleteAccount(deletePassword.value)
    deletionJobId.value = result.deletionJobId
    deletionAccepted.value = true
    deletePassword.value = ''
    deleteAcknowledged.value = false
    deletePanelOpen.value = false
  })
}

function goHome() {
  void router.replace({ name: 'landing' })
}
</script>

<template>
  <PageContainer page="article">
    <!-- 注销已受理：这一屏取代整页，避免用户继续在"已经不存在的账号"上操作 -->
    <section v-if="deletionAccepted" aria-labelledby="deletion-heading">
      <p class="section-kicker">账号</p>
      <h1
        id="deletion-heading"
        class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
      >
        注销请求已受理
      </h1>
      <div class="notice-info mt-5 max-w-[34rem] text-[14.5px] leading-relaxed" role="status" aria-live="polite">
        <p>这个账号已经不能登录了，你的测评记录与报告正在被删除，删除过程无法中止。</p>
        <p class="mt-2">
          如果只是想换个用户名，很遗憾没有改名功能：账号删除后用户名会被释放，但记录不会跟着走。
        </p>
        <p v-if="deletionJobId" class="mt-2 break-all">
          删除任务编号：<code class="font-mono">{{ deletionJobId }}</code>
        </p>
      </div>
      <button type="button" class="btn-secondary mt-5" @click="goHome">回到首页</button>
    </section>

    <template v-else>
      <header>
        <p class="section-kicker">账号</p>
        <h1 class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]">
          账号与数据
        </h1>
        <p class="mt-3 prose-cn">
          这里能看到账号是什么状态，也能改密码、重新生成恢复码、把数据导出去，或者把账号注销掉。
          每一块都会先说明它到底做了什么。
        </p>
      </header>

      <p
        v-if="auth.sessionNotice"
        class="notice-neutral mt-5 max-w-[34rem] text-[13.5px] leading-relaxed"
        role="status"
        aria-live="polite"
      >
        {{ auth.sessionNotice }}
      </p>

      <!-- ① 账号信息 -->
      <section class="mt-8" aria-labelledby="account-profile-heading">
        <h2 id="account-profile-heading" class="section-title">账号信息</h2>

        <dl class="mt-4 grid gap-3 text-[14.5px] tablet:grid-cols-2">
          <div>
            <dt class="text-ink-faint">用户名</dt>
            <dd class="break-all font-medium text-ink">{{ profile?.username ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-ink-faint">登录状态</dt>
            <dd class="font-medium text-ink">
              {{ auth.isAuthenticated ? '已登录' : auth.status === 'unavailable' ? '没能确认' : '未登录' }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">注册时间</dt>
            <dd class="text-ink-soft">{{ formatTime(profile?.createdAt ?? null) }}</dd>
          </div>
          <div>
            <dt class="text-ink-faint">上次改密码</dt>
            <dd class="text-ink-soft">{{ formatTime(profile?.passwordChangedAt ?? null) }}</dd>
          </div>
        </dl>

        <form class="mt-4 max-w-[30rem]" novalidate @submit.prevent="saveNickname">
          <label :for="nicknameId" class="block text-[14.5px] font-medium text-ink">昵称</label>
          <input
            :id="nicknameId"
            v-model="nickname"
            name="nickname"
            type="text"
            autocomplete="nickname"
            maxlength="32"
            :aria-describedby="`${nicknameId}-help`"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
          <p :id="`${nicknameId}-help`" class="caption mt-1.5">
            最多 32 个字，会显示在页面上。留空是不允许的，不想显示昵称就保持现在的。
          </p>

          <div v-if="error && errorSection === 'nickname'" class="notice-error mt-3" role="alert" aria-live="assertive">
            <p class="text-[14.5px] font-medium leading-relaxed">{{ error.message }}</p>
            <ul v-if="error.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
              <li v-for="field in error.fields" :key="field.field">{{ field.label }}：{{ field.message }}</li>
            </ul>
            <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
              报障编号：<code class="font-mono">{{ error.requestId }}</code>
            </p>
          </div>
          <p v-if="nicknameSaved" class="notice-info mt-3 text-[13.5px]" role="status" aria-live="polite">
            昵称已经改好了。
          </p>

          <p v-if="nicknameProblem" :id="nicknameHintId" class="caption mt-3">{{ nicknameProblem }}</p>
          <button
            type="submit"
            class="btn-secondary mt-3"
            :disabled="nicknameProblem !== null"
            :aria-describedby="nicknameProblem ? nicknameHintId : undefined"
          >
            保存昵称
          </button>
        </form>
      </section>

      <!-- ② 修改密码 -->
      <section class="section-rule mt-8" aria-labelledby="account-password-heading">
        <h2 id="account-password-heading" class="section-title">修改密码</h2>
        <p class="mt-2 prose-sm max-w-[34rem]">
          改完之后，<strong class="font-medium text-ink">其他设备上的登录会全部退出</strong>，
          当前这台保留。新密码 8–72 位，只能用英文、数字和键盘上的符号。
        </p>

        <form class="mt-4 max-w-[30rem]" novalidate @submit.prevent="changePassword">
          <div>
            <label :for="currentPasswordId" class="block text-[14.5px] font-medium text-ink">当前密码</label>
            <input
              :id="currentPasswordId"
              v-model="currentPassword"
              name="current-password"
              type="password"
              autocomplete="current-password"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
            />
          </div>
          <div class="mt-4">
            <label :for="newPasswordId" class="block text-[14.5px] font-medium text-ink">新密码</label>
            <input
              :id="newPasswordId"
              v-model="newPassword"
              name="new-password"
              type="password"
              autocomplete="new-password"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
            />
          </div>
          <div class="mt-4">
            <label :for="confirmPasswordId" class="block text-[14.5px] font-medium text-ink">再输一次新密码</label>
            <input
              :id="confirmPasswordId"
              v-model="confirmPassword"
              name="confirm-password"
              type="password"
              autocomplete="new-password"
              class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
            />
          </div>

          <div v-if="error && errorSection === 'password'" class="notice-error mt-3" role="alert" aria-live="assertive">
            <p class="text-[14.5px] font-medium leading-relaxed">{{ error.message }}</p>
            <ul v-if="error.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
              <li v-for="field in error.fields" :key="field.field">{{ field.label }}：{{ field.message }}</li>
            </ul>
            <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
              报障编号：<code class="font-mono">{{ error.requestId }}</code>
            </p>
          </div>
          <p v-if="passwordChanged" class="notice-info mt-3 text-[13.5px]" role="status" aria-live="polite">
            密码已经改好了，其他设备上的登录已经退出。
          </p>

          <p v-if="passwordProblem" :id="passwordHintId" class="caption mt-3">{{ passwordProblem }}</p>
          <button
            type="submit"
            class="btn-primary mt-3"
            :disabled="passwordProblem !== null"
            :aria-describedby="passwordProblem ? passwordHintId : undefined"
          >
            修改密码
          </button>
        </form>
      </section>

      <!-- ③ 恢复码 -->
      <section class="section-rule mt-8" aria-labelledby="account-codes-heading">
        <h2 id="account-codes-heading" class="section-title">恢复码</h2>
        <p class="mt-2 prose-sm max-w-[34rem]">
          恢复码用来在忘记密码时重置密码。已经生成过的那一组<strong class="font-medium text-ink">查不出来</strong>：
          服务器只存了不可逆的校验值，谁也没法把它还原成你能抄下来的码。所以这里只能重新生成一组 ——
          新的一组生成后，旧的立刻全部作废。
        </p>

        <form class="mt-4 max-w-[30rem]" novalidate @submit.prevent="regenerateCodes">
          <label :for="codesPasswordId" class="block text-[14.5px] font-medium text-ink">
            当前密码（重新生成需要确认是你本人）
          </label>
          <input
            :id="codesPasswordId"
            v-model="codesPassword"
            name="current-password"
            type="password"
            autocomplete="current-password"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />

          <div v-if="error && errorSection === 'codes'" class="notice-error mt-3" role="alert" aria-live="assertive">
            <p class="text-[14.5px] font-medium leading-relaxed">{{ error.message }}</p>
            <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
              报障编号：<code class="font-mono">{{ error.requestId }}</code>
            </p>
          </div>

          <p v-if="codesProblem" :id="codesHintId" class="caption mt-3">{{ codesProblem }}</p>
          <button
            type="submit"
            class="btn-secondary mt-3"
            :disabled="codesProblem !== null"
            :aria-describedby="codesProblem ? codesHintId : undefined"
          >
            生成新的恢复码
          </button>
        </form>

        <!-- 新恢复码：与注册流程同一套纪律——只显示这一次、不自动复制、勾选后才能走 -->
        <div v-if="recoveryCodes.length" class="mt-5" data-account-recovery-codes>
          <div class="notice-uncertain max-w-[34rem] text-[14px] leading-relaxed" role="note">
            <p class="font-medium">这组新恢复码只显示这一次，请现在就抄下来。</p>
            <p class="mt-1">
              旧的恢复码已经全部作废。页面不会自动复制到剪贴板，也不会帮你保存到任何地方。
            </p>
          </div>
          <ol class="mt-4 max-w-[30rem] space-y-2">
            <li
              v-for="(code, index) in recoveryCodes"
              :key="code"
              class="flex items-baseline gap-3 rounded-control border border-line bg-surface px-3 py-2.5"
            >
              <span class="w-5 shrink-0 text-right text-[13px] text-ink-faint">{{ index + 1 }}</span>
              <code class="min-w-0 break-all font-mono text-[15.5px] tracking-wide text-ink">{{ code }}</code>
            </li>
          </ol>
          <div class="mt-4 flex items-start gap-2.5">
            <input
              :id="codesCopiedId"
              v-model="codesCopied"
              type="checkbox"
              class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong"
            />
            <label :for="codesCopiedId" class="text-[14.5px] leading-relaxed text-ink">
              我已经抄下来了。
            </label>
          </div>
          <p v-if="codesLeaveReason" class="caption mt-3">{{ codesLeaveReason }}</p>
          <button
            type="button"
            class="btn-primary mt-3"
            :disabled="codesLeaveReason !== null"
            @click="recoveryCodes = []"
          >
            收起这组码
          </button>
        </div>
      </section>

      <!-- ④ 导出数据 -->
      <section class="section-rule mt-8" aria-labelledby="account-export-heading">
        <h2 id="account-export-heading" class="section-title">导出数据</h2>
        <p class="mt-2 prose-sm max-w-[34rem]">
          导出一个 JSON 文件，里面有账号资料、每次测评与答案、报告全文、你的自我理解，以及 AI 分析记录。
          里面<strong class="font-medium text-ink">没有</strong>密码、恢复码、会话与内部记录 ——
          那些本来就不该离开服务器。
        </p>

        <div v-if="error && errorSection === 'export'" class="notice-error mt-3 max-w-[34rem]" role="alert" aria-live="assertive">
          <p class="text-[14.5px] font-medium leading-relaxed">{{ error.message }}</p>
          <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
            报障编号：<code class="font-mono">{{ error.requestId }}</code>
          </p>
        </div>
        <p v-if="exportMessage" class="notice-info mt-3 max-w-[34rem] text-[13.5px]" role="status" aria-live="polite">
          {{ exportMessage }}
        </p>

        <button
          type="button"
          class="btn-secondary mt-3"
          :disabled="auth.busy"
          :aria-describedby="auth.busy ? exportHintId : undefined"
          @click="exportData"
        >
          导出我的数据
        </button>
        <p v-if="auth.busy" :id="exportHintId" class="caption mt-2">正在准备文件，请稍等。</p>
      </section>

      <!-- ⑤ 删除数据 -->
      <section class="section-rule mt-8" aria-labelledby="account-delete-data-heading">
        <h2 id="account-delete-data-heading" class="section-title">删除数据</h2>
        <p class="mt-2 prose-sm max-w-[34rem]">
          现在这个页面只能做到<strong class="font-medium text-ink">整账号删除</strong>。
          按单份报告删除的功能还没有做好，所以在它做好之前，想删掉某几份记录只能连账号一起注销。
          如果你需要留下某几份数据，先导出，再从导出的文件里挑。
        </p>
        <p class="mt-2 prose-sm max-w-[34rem]">
          本机浏览器里还留着一份最近作答的副本（就是「方法与隐私」页里说的那份本地记录），
          它不在这里删 —— 那属于
          <RouterLink to="/about" class="link">本地记录</RouterLink>，清不清由你决定。
        </p>
      </section>

      <!-- ⑥ 注销账号 -->
      <section class="section-rule mt-8" aria-labelledby="account-delete-heading">
        <h2 id="account-delete-heading" class="section-title">注销账号</h2>
        <p class="mt-2 prose-sm max-w-[34rem]">
          注销会删除你的全部测评记录与报告，<strong class="font-medium text-ink">无法恢复</strong>，
          也不能撤销。导出数据是唯一能把它们带走的办法 —— 想留一份的话，请先导出。
        </p>

        <div v-if="error && errorSection === 'delete'" class="notice-error mt-3 max-w-[34rem]" role="alert" aria-live="assertive">
          <p class="text-[14.5px] font-medium leading-relaxed">{{ error.message }}</p>
          <ul v-if="error.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
            <li v-for="field in error.fields" :key="field.field">{{ field.label }}：{{ field.message }}</li>
          </ul>
          <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
            报障编号：<code class="font-mono">{{ error.requestId }}</code>
          </p>
        </div>

        <button
          v-if="!deletePanelOpen"
          type="button"
          class="btn-secondary mt-3"
          @click="deletePanelOpen = true"
        >
          我想注销账号
        </button>

        <div v-else class="mt-4 max-w-[34rem] rounded-question border border-accent-300 bg-accent-100 px-4 py-5">
          <h3 class="text-[15.5px] font-semibold text-accent-700">再确认一次</h3>
          <p class="mt-2 text-[14px] leading-relaxed text-accent-700">
            这会删除你的全部测评记录与报告，无法恢复。账号会立刻无法登录，用户名将被释放，
            但你不会因此找回之前的数据。
          </p>

          <div class="mt-4 flex items-start gap-2.5">
            <input
              :id="deleteAckId"
              v-model="deleteAcknowledged"
              type="checkbox"
              class="mt-1 h-5 w-5 shrink-0 rounded border-accent-300"
            />
            <label :for="deleteAckId" class="text-[14px] leading-relaxed text-accent-700">
              我知道这会删除我的全部测评记录与报告，无法恢复。
            </label>
          </div>

          <div class="mt-4">
            <label :for="deletePasswordId" class="block text-[14px] font-medium text-accent-700">
              再输入一次密码
            </label>
            <input
              :id="deletePasswordId"
              v-model="deletePassword"
              name="current-password"
              type="password"
              autocomplete="current-password"
              class="mt-1.5 w-full min-w-0 rounded-control border border-accent-300 bg-surface px-3 py-2.5 text-[16px] text-ink"
            />
          </div>

          <p v-if="deleteProblem" :id="deleteHintId" class="mt-3 text-[13px] leading-relaxed text-accent-700">
            {{ deleteProblem }}
          </p>

          <div class="mt-4 flex flex-col gap-2 tablet:flex-row">
            <button
              type="button"
              class="btn-danger"
              :disabled="deleteProblem !== null"
              :aria-describedby="deleteProblem ? deleteHintId : undefined"
              @click="deleteAccount"
            >
              {{ auth.busy ? '正在提交…' : '永久删除我的账号' }}
            </button>
            <button type="button" class="btn-secondary" :disabled="auth.busy" @click="deletePanelOpen = false">
              先不删了
            </button>
          </div>
        </div>
      </section>
    </template>
  </PageContainer>
</template>
