<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useAdminProbe } from '@/composables/useAdminProbe'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import FormErrorNotice from '@/components/FormErrorNotice.vue'

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
/** 导出不完整时的警告。与 exportMessage 分开：一条是"成功了"，一条是"成功了但不完整"。 */
const exportWarning = ref<string | null>(null)
/**
 * 服务端降级段落名 → 页面文案。
 *
 * <p>键是服务端 `DataExportService` 里写死的那几个段名；这里只做展示翻译。
 * 认不出来的段名原样显示（宁可露出英文标识，也不能把"有东西没导出"说成没事）。
 */
const EXPORT_SECTION_LABELS: Record<string, string> = {
  attempts: '测评记录',
  answers: '作答明细',
  reports: '报告',
  selfReflections: '自我理解',
  aiJobs: 'AI 分析记录',
  assessment_attempt: '测评记录',
  assessment_answer: '作答明细',
  assessment_report: '报告',
  report_self_reflection: '自我理解',
  ai_analysis_job: 'AI 分析记录',
}

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

/**
 * 后台入口只在"确认是管理员"时出现。
 *
 * 这不是"靠隐蔽做安全"（服务端每个请求都重新判权限），而是因为对普通用户来说
 * 一个点进去必然没用的链接就是纯噪音。探测失败时也**不显示**入口，
 * 但不会把失败说成"你不是管理员"——那种话只有服务端明确回 403 时才成立。
 */
const { isAdmin, refresh: refreshAdminProbe } = useAdminProbe()

onMounted(() => {
  auth.clearError()
  nickname.value = profile.value?.nickname ?? ''
  void refreshAdminProbe()
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
  exportWarning.value = null
  await run('export', async () => {
    const { blob, filename, degradedSections } = await auth.exportData()
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
    if (degradedSections.length) {
      // 有段落没导出成功就**不能说"都在里面"**：本页下方写着"注销会删除你的全部
      // 测评记录与报告……导出是唯一能把它们带走的办法"，把不完整的文件说成完整备份，
      // 会让用户按指引注销后永久丢掉那部分数据。
      const names = degradedSections.map((item) => EXPORT_SECTION_LABELS[item.section] ?? item.section)
      exportWarning.value =
        `已经导出 ${filename}，但其中 ${names.join('、')} 没能取到，这份文件不是完整备份。` +
        '请先不要注销账号，稍后重新导出；若一直这样，请把这条信息反馈给站点维护者。'
      return
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
      <header>
        <p class="section-kicker">账号</p>
        <h1
          id="deletion-heading"
          class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
        >
          注销请求已受理
        </h1>
      </header>
      <!-- 这一屏说的是"正在删除、无法中止"，不是成功：仍然用中性说明，不用成功色 -->
      <div class="notice-info mt-5 max-w-prose text-[14.5px] leading-relaxed" role="status" aria-live="polite">
        <p class="flex items-start gap-2">
          <AppIcon name="info" :size="17" class="mt-0.5" />
          <span>这个账号已经不能登录了，你的测评记录与报告正在被删除，删除过程无法中止。</span>
        </p>
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
        <p class="mt-3 prose-cn max-w-prose">
          这里能看到账号是什么状态，也能改密码、重新生成恢复码、把数据导出去，或者把账号注销掉。
          每一块都会先说明它到底做了什么。
        </p>
      </header>

      <p
        v-if="auth.sessionNotice"
        class="notice-neutral mt-5 max-w-prose text-[14px] leading-relaxed"
        role="status"
        aria-live="polite"
      >
        {{ auth.sessionNotice }}
      </p>

      <!-- ① 账号信息 -->
      <section class="mt-8" aria-labelledby="account-profile-heading">
        <h2 id="account-profile-heading" class="section-title flex items-center gap-2">
          <AppIcon name="user" :size="18" class="text-primary-600" />
          账号信息
        </h2>

        <!-- 四个只读事实是一组：给一张卡，页面顶部才有焦点，不和下面的表单糊在一起 -->
        <dl class="card-tight mt-4 grid gap-3 text-[14.5px] tablet:grid-cols-2">
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

          <FormErrorNotice
            v-if="error && errorSection === 'nickname'"
            :error="error"
            class="mt-3"
            data-account-error-nickname
          />
          <!-- 这里是"已确认保存"，用成功色；它和上面的失败红块必须一眼分得开 -->
          <p
            v-if="nicknameSaved"
            class="notice-success mt-3 flex items-start gap-2 text-[14px] leading-relaxed"
            role="status"
            aria-live="polite"
          >
            <AppIcon name="check" :size="17" class="mt-0.5" />
            <span>昵称已经改好了。</span>
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
        <h2 id="account-password-heading" class="section-title flex items-center gap-2">
          <AppIcon name="lock" :size="18" class="text-primary-600" />
          修改密码
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
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

          <FormErrorNotice
            v-if="error && errorSection === 'password'"
            :error="error"
            class="mt-3"
            data-account-error-password
          />
          <p
            v-if="passwordChanged"
            class="notice-success mt-3 flex items-start gap-2 text-[14px] leading-relaxed"
            role="status"
            aria-live="polite"
          >
            <AppIcon name="check" :size="17" class="mt-0.5" />
            <span>密码已经改好了，其他设备上的登录已经退出。</span>
          </p>

          <p v-if="passwordProblem" :id="passwordHintId" class="caption mt-3">{{ passwordProblem }}</p>
          <!--
            A39（第 19 轮）：这里原本是 `btn-primary`，而这一页的另外五个区块全是次级按钮 ——
            等于用一个主色按钮暗示"改密码是这一页最该做的事"，可它是**平权的六个设置区块**之一
            （改昵称、改密码、换恢复码、导出数据、注销账号），顺序上第一块还是"昵称"。
            主色应该表示"这一页的推荐动作"，这里没有；所以统一为次级，靠区块标题建立层级。
          -->
          <button
            type="submit"
            class="btn-secondary mt-3"
            :disabled="passwordProblem !== null"
            :aria-describedby="passwordProblem ? passwordHintId : undefined"
          >
            修改密码
          </button>
        </form>
      </section>

      <!-- ③ 恢复码 -->
      <section class="section-rule mt-8" aria-labelledby="account-codes-heading">
        <h2 id="account-codes-heading" class="section-title flex items-center gap-2">
          <AppIcon name="shield" :size="18" class="text-primary-600" />
          恢复码
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
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

          <FormErrorNotice
            v-if="error && errorSection === 'codes'"
            :error="error"
            class="mt-3"
            data-account-error-codes
          />

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
          <div class="notice-uncertain max-w-prose text-[14px] leading-relaxed" role="note">
            <p class="flex items-start gap-2 font-medium">
              <AppIcon name="shield" :size="17" class="mt-0.5" />
              <span>这组新恢复码只显示这一次，请现在就抄下来。</span>
            </p>
            <p class="mt-1">
              旧的恢复码已经全部作废。页面不会自动复制到剪贴板，也不会帮你保存到任何地方。
            </p>
          </div>
          <!-- 一组码收在一张卡里、用细分隔线分开，和注册页保持同一套读法 -->
          <ol class="card mt-4 max-w-[30rem] divide-y divide-line-soft">
            <li
              v-for="(code, index) in recoveryCodes"
              :key="code"
              class="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span class="w-5 shrink-0 text-right text-[13px] text-ink-faint tabular">{{ index + 1 }}</span>
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
          <!-- 「收起」是收尾动作，不该比页面主操作更响：降为次按钮 -->
          <button
            type="button"
            class="btn-secondary mt-3"
            :disabled="codesLeaveReason !== null"
            @click="recoveryCodes = []"
          >
            收起这组码
          </button>
        </div>
      </section>

      <!-- ④ 导出数据 -->
      <section class="section-rule mt-8" aria-labelledby="account-export-heading">
        <h2 id="account-export-heading" class="section-title flex items-center gap-2">
          <AppIcon name="download" :size="18" class="text-primary-600" />
          导出数据
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          导出一个 JSON 文件，里面有账号资料、每次测评与答案、报告全文、你的自我理解，以及 AI 分析记录。
          里面<strong class="font-medium text-ink">没有</strong>密码、恢复码、会话与内部记录 ——
          那些本来就不该离开服务器。
        </p>

        <FormErrorNotice
          v-if="error && errorSection === 'export'"
          :error="error"
          class="mt-3 max-w-prose"
          data-account-error-export
        />
        <!-- 导出成功 = 已确认，用成功色；这句正在被 spec 钉住（"都在里面"） -->
        <p
          v-if="exportMessage"
          class="notice-success mt-3 flex max-w-prose items-start gap-2 text-[14px] leading-relaxed"
          role="status"
          aria-live="polite"
        >
          <AppIcon name="check" :size="17" class="mt-0.5" />
          <span>{{ exportMessage }}</span>
        </p>
        <div v-if="exportWarning" class="notice-error mt-3 max-w-prose" role="alert" aria-live="assertive">
          <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
            <AppIcon name="alert" :size="17" class="mt-0.5" />
            <span>{{ exportWarning }}</span>
          </p>
          <p class="mt-2 text-[13px] leading-relaxed">
            文件里的 <code class="font-mono">degradedSections</code> 字段也记录了这次哪些部分没取到。
          </p>
        </div>

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
        <h2 id="account-delete-data-heading" class="section-title flex items-center gap-2">
          <AppIcon name="alert" :size="18" class="text-accent-500" />
          删除数据
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          现在这个页面只能做到<strong class="font-medium text-ink">整账号删除</strong>。
          按单份报告删除的功能还没有做好，所以在它做好之前，想删掉某几份记录只能连账号一起注销。
          如果你需要留下某几份数据，先导出，再从导出的文件里挑。
        </p>
        <p class="mt-2 prose-sm max-w-prose">
          本机浏览器里还留着一份最近作答的副本（就是「方法与隐私」页里说的那份本地记录），
          它不在这里删 —— 那属于
          <RouterLink to="/about" class="link">本地记录</RouterLink>，清不清由你决定。
        </p>
      </section>

      <!-- ⑦ 管理入口：只有确认过是管理员才出现 -->
      <section v-if="isAdmin" class="section-rule mt-8" aria-labelledby="account-admin-heading" data-admin-entry>
        <h2 id="account-admin-heading" class="section-title flex items-center gap-2">
          <AppIcon name="sliders" :size="18" class="text-primary-600" />
          管理后台
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          你的账号有管理员权限，可以配置 AI 分析的运行参数、查看账号概览。
        </p>
        <RouterLink to="/admin" class="btn-secondary mt-3" data-admin-entry-link>打开管理后台</RouterLink>
      </section>

      <!-- ⑥ 注销账号 -->
      <section class="section-rule mt-8" aria-labelledby="account-delete-heading">
        <h2 id="account-delete-heading" class="section-title flex items-center gap-2">
          <AppIcon name="alert" :size="18" class="text-accent-500" />
          注销账号
        </h2>
        <p class="mt-2 prose-sm max-w-prose">
          注销会删除你的全部测评记录与报告，<strong class="font-medium text-ink">无法恢复</strong>，
          也不能撤销。导出数据是唯一能把它们带走的办法 —— 想留一份的话，请先导出。
        </p>

        <!--
          刚才那次导出不完整时，必须在这里也说一遍：用户可能只看了导出区的提示就往下滚，
          而这条段落正是"别急着注销"的最后一道提示。
        -->
        <div
          v-if="exportWarning"
          class="notice-error mt-3 max-w-prose"
          role="alert"
          aria-live="assertive"
          data-export-incomplete-before-delete
        >
          <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
            <AppIcon name="alert" :size="17" class="mt-0.5" />
            <span>
              刚才那次导出<strong class="font-medium">不是完整备份</strong>，先别注销 ——
              请重新导出成功后再回来删除账号。
            </span>
          </p>
        </div>

        <FormErrorNotice
          v-if="error && errorSection === 'delete'"
          :error="error"
          class="mt-3 max-w-prose"
          data-account-error-delete
        />

        <button
          v-if="!deletePanelOpen"
          type="button"
          class="btn-secondary mt-3"
          @click="deletePanelOpen = true"
        >
          我想注销账号
        </button>

        <!--
          二次确认面板：它是"注意/不可逆"，不是"出错"，所以用 accent 系（与 .notice-uncertain 同底色），
          真正执行删除的那颗按钮才是 danger。
        -->
        <div v-else class="mt-4 max-w-prose rounded-question border border-accent-200 bg-accent-100 px-5 py-5 shadow-card">
          <h3 class="flex items-center gap-2 text-[15.5px] font-semibold text-accent-700">
            <AppIcon name="alert" :size="18" />
            再确认一次
          </h3>
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
