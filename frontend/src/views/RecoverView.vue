<script setup lang="ts">
import EditorialScene from '@/components/EditorialScene.vue'
import IllustrationFrame from '@/components/IllustrationFrame.vue'
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { refreshCsrfToken } from '@/api/v3'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 用恢复码重置密码 —— 契约 `02-数据模型与API-v1.md` §7.2（`POST /auth/recover`）。
 *
 * 服务端的行为要在界面上**如实**说明，否则用户会以为"只是改了密码"：
 *   - 恢复码是一次性的（`used_at` 原子消费），用完就作废；
 *   - 同一账号**其余**恢复码全部作废；
 *   - 该账号**所有**会话被撤销（包括别的设备），必须用新密码重新登录。
 *
 * 所以成功后不自动登录，而是把用户送回登录页 —— 这也是"新密码确实能用"的最短验证路径。
 */
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/**
 * 重置成功后回登录页时要带上的 `redirect`。
 *
 * <p>用户是从别的页面被送到这里的（"登录态失效，请重新登录" → 登录页 → "用恢复码重置"），
 * 原来这里写死 `/account`，等于在重置密码之后把用户**从原来的目的地丢掉**：
 * 他是从答题页来的，就再也回不到那道题（第 17 轮）。
 */
const loginRedirect = computed(() => {
  const raw = route.query.redirect
  if (typeof raw !== 'string') return '/account'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/account'
  return raw
})

const username = ref('')
const recoveryCode = ref('')
const newPassword = ref('')
const confirm = ref('')
const succeeded = ref(false)

const usernameId = `rec-username-${useId()}`
const codeId = `rec-code-${useId()}`
const passwordId = `rec-password-${useId()}`
const confirmId = `rec-confirm-${useId()}`
const hintId = `rec-hint-${useId()}`

const error = computed(() => auth.lastError)

const localProblem = computed(() => {
  if (!username.value.trim()) return '先填用户名。'
  if (!recoveryCode.value.trim()) return '先填一个恢复码。'
  if (recoveryCode.value.trim().length > 64) return '恢复码不会这么长，检查一下是不是粘多了别的内容。'
  if (newPassword.value.length < 8) return '新密码至少 8 位。'
  if (newPassword.value.length > 72) return '新密码最多 72 位。'
  if (!/^[\x20-\x7E]+$/.test(newPassword.value)) return '新密码只能用英文、数字和键盘上的符号，暂不支持中文。'
  if (confirm.value !== newPassword.value) return '两次输入的新密码不一样。'
  return null
})

const disabledReason = computed(() => {
  if (auth.busy) return '正在提交，请稍等。'
  return localProblem.value
})

onMounted(() => {
  auth.clearError()
  void refreshCsrfToken()
})

async function onSubmit() {
  if (disabledReason.value) return
  try {
    await auth.recover(username.value.trim(), recoveryCode.value.trim(), newPassword.value)
    succeeded.value = true
  } catch {
    // 失败已存进 auth.lastError
  }
}

function goLogin() {
  void router.replace({ name: 'login', query: { redirect: loginRedirect.value } })
}
</script>

<template>
  <PageContainer page="article" class="auth-page">
    <section v-if="succeeded" class="auth-complete" aria-labelledby="recover-done-heading">
      <header>
        <p class="section-kicker">账号</p>
        <h1
          id="recover-done-heading"
          class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
        >
          新密码已经生效
        </h1>
        <IllustrationFrame name="welcome" class="auth-art auth-scene"><EditorialScene scene="welcome" /></IllustrationFrame>
      </header>
      <!-- 这一屏是"已完成"的确认，不是解释：所以用 notice-success，和上面的失败红块分得开 -->
      <div class="notice-success mt-5 max-w-prose text-[14.5px] leading-relaxed" role="status" aria-live="polite">
        <p class="flex items-start gap-2">
          <AppIcon name="check" :size="17" class="mt-0.5" />
          <span>这个恢复码已经用掉了。同一账号其余恢复码也一并作废，需要的话登录后重新生成一组。</span>
        </p>
        <p class="mt-2">
          为了安全，这个账号在<strong class="font-medium">所有设备</strong>上的登录都已经退出 ——
          包括你可能还开着的手机或另一台电脑。请用新密码重新登录一次。
        </p>
      </div>
      <button type="button" class="btn-primary mt-5" @click="goLogin">去登录</button>
    </section>

    <section v-else class="auth-body" aria-labelledby="recover-heading">
      <header>
        <p class="section-kicker">账号</p>
        <h1
          id="recover-heading"
          class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
        >
          用恢复码重置密码
        </h1>
        <p class="mt-3 prose-cn max-w-prose">
          注册时那 8 个恢复码里，任意一个都可以用来设置新密码。用掉一个就少一个，
          而且成功之后其他设备上的登录都会退出。
        </p>
        <IllustrationFrame name="welcome" class="auth-art auth-scene"><EditorialScene scene="welcome" /></IllustrationFrame>
      </header>

      <!-- 表单是这一页唯一的焦点元素，所以收进一张卡片，和页头的说明拉开层次 -->
      <form class="card mt-6 max-w-[30rem]" novalidate @submit.prevent="onSubmit">
        <div>
          <label :for="usernameId" class="block text-[14.5px] font-medium text-ink">用户名</label>
          <input
            :id="usernameId"
            v-model="username"
            name="username"
            type="text"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
        </div>

        <div class="mt-4">
          <label :for="codeId" class="block text-[14.5px] font-medium text-ink">恢复码</label>
          <input
            :id="codeId"
            v-model="recoveryCode"
            name="recovery-code"
            type="text"
            autocomplete="off"
            autocapitalize="characters"
            autocorrect="off"
            spellcheck="false"
            :aria-describedby="`${codeId}-help`"
            class="mt-1.5 w-full min-w-0 break-all rounded-control border border-line-strong bg-surface px-3 py-2.5 font-mono text-[15.5px] text-ink"
          />
          <p :id="`${codeId}-help`" class="caption mt-1.5">
            照着纸上的抄就行。大小写、连字符和空格都没关系，服务端会自己规范化。
          </p>
        </div>

        <div class="mt-4">
          <label :for="passwordId" class="block text-[14.5px] font-medium text-ink">新密码</label>
          <input
            :id="passwordId"
            v-model="newPassword"
            name="new-password"
            type="password"
            autocomplete="new-password"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
          <p class="caption mt-1.5">8–72 位，只能用英文、数字和键盘上的符号。</p>
        </div>

        <div class="mt-4">
          <label :for="confirmId" class="block text-[14.5px] font-medium text-ink">再输一次新密码</label>
          <input
            :id="confirmId"
            v-model="confirm"
            name="confirm-password"
            type="password"
            autocomplete="new-password"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
        </div>

        <div v-if="error" class="notice-error mt-4" role="alert" aria-live="assertive" data-recover-error>
          <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
            <AppIcon name="alert" :size="17" class="mt-0.5" />
            <span>{{ error.message }}</span>
          </p>
          <ul v-if="error.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
            <li v-for="field in error.fields" :key="field.field">
              {{ field.label }}：{{ field.message }}
            </li>
          </ul>
          <p v-if="error.serverMessage" class="mt-2 text-[13.5px] leading-relaxed">
            服务器说明：{{ error.serverMessage }}
          </p>
          <p v-if="error.retryAfterSeconds" class="mt-2 text-[13.5px] leading-relaxed">
            大约 {{ error.retryAfterSeconds }} 秒后再试就来得及。
          </p>
          <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
            报障编号：<code class="font-mono">{{ error.requestId }}</code>
            <span class="block text-ink-faint">（反馈问题时把这个编号一起发过来，能直接查到这次请求。）</span>
          </p>
        </div>

        <p v-if="disabledReason" :id="hintId" class="caption mt-3">{{ disabledReason }}</p>

        <button
          type="submit"
          class="btn-primary btn-block mt-5"
          :disabled="disabledReason !== null"
          :aria-describedby="disabledReason ? hintId : undefined"
        >
          {{ auth.busy ? '正在重置…' : '设置新密码' }}
        </button>
      </form>

      <div class="mt-6 max-w-prose space-y-2">
        <p class="prose-sm">
          想起来了密码？<RouterLink to="/login" class="link">直接登录</RouterLink>。
        </p>
        <p class="fineprint">
          恢复码全丢了也没关系：还能登录的话，到「账号与数据」里用密码重新生成一组；
          再也登录不进去的话，这个账号里的记录无法找回，只能用新账号重新开始。
        </p>
      </div>
    </section>
  </PageContainer>
</template>
