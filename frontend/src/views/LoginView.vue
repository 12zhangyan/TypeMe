<script setup lang="ts">
import EditorialScene from '@/components/EditorialScene.vue'
import IllustrationFrame from '@/components/IllustrationFrame.vue'
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { refreshCsrfToken } from '@/api/v3'
import PageContainer from '@/components/PageContainer.vue'

/**
 * 登录 —— 契约 `03-AI与前端契约-v1.md` §7.2（`/login` 公开；已登录访问则跳回 redirect）。
 *
 * 几个刻意的选择：
 *   - 密码框永远是 `type="password"` + `autocomplete="current-password"`：
 *     浏览器/密码管理器能不能正确填充，全靠这两个属性；
 *   - 失败文案**不区分**"用户名不存在"与"密码错误"（服务端也不区分，避免账号枚举），
 *     所以这里也不写"用户名不存在"这种话；
 *   - 错误块里一定带上服务端的 `requestId`：用户报障时那是唯一能对上日志的线索。
 */
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref('')
const password = ref('')
const usernameId = `login-username-${useId()}`
const passwordId = `login-password-${useId()}`
const hintId = `login-hint-${useId()}`
const error = computed(() => auth.lastError)

/** 登录成功后回哪儿：只接受站内路径，挡掉 `//evil.example` 这类开放重定向。 */
const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw !== 'string') return '/account'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/account'
  return raw
})

const disabledReason = computed(() => {
  if (auth.busy) return '正在登录，请稍等。'
  if (!username.value.trim()) return '先填用户名。'
  if (!password.value) return '先填密码。'
  return null
})

onMounted(() => {
  auth.clearError()
  // 登录是写操作，需要 CSRF token：进页面就先取一份，别让用户点下去才等这次往返。
  // 取不到也不提示：真正的失败理由由提交时的响应说了算。
  void refreshCsrfToken()
})

async function onSubmit() {
  if (disabledReason.value) return
  try {
    await auth.login(username.value.trim(), password.value)
    await router.replace(redirectTarget.value)
  } catch {
    // 失败已经存进 auth.lastError（含 requestId），模板直接渲染
  }
}
</script>

<template>
  <PageContainer page="article" class="auth-page">
    <header>
      <p class="section-kicker">账号</p>
      <h1 class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]">
        登录
      </h1>
      <p class="mt-3 prose-cn max-w-prose">
        登录后才能把测评记录和报告放在服务器上，换设备也能接着看。答案与报告只属于你自己。
      </p>
      <IllustrationFrame name="welcome" class="auth-art auth-scene"><EditorialScene scene="welcome" /></IllustrationFrame>
    </header>

    <!-- 会话检查没成功（网络/服务端问题）时的低调提示：这**不是**登录失败 -->
    <p
      v-if="auth.sessionNotice"
      class="notice-neutral mt-5 max-w-prose text-[14px] leading-relaxed"
      role="status"
      aria-live="polite"
    >
      {{ auth.sessionNotice }}
    </p>

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
        <label :for="passwordId" class="block text-[14.5px] font-medium text-ink">密码</label>
        <input
          :id="passwordId"
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
        />
      </div>

      <FormErrorNotice
        v-if="error"
        :error="error"
        class="mt-4"
        data-login-error
      />

      <p v-if="disabledReason" :id="hintId" class="caption mt-3">
        {{ disabledReason }}
      </p>

      <button
        type="submit"
        class="btn-primary btn-block mt-5"
        :disabled="disabledReason !== null"
        :aria-describedby="disabledReason ? hintId : undefined"
      >
        {{ auth.busy ? '正在登录…' : '登录' }}
      </button>
    </form>

    <p class="mt-5 prose-sm">
      还没有账号？
      <RouterLink :to="{ name: 'register', query: route.query }" class="link">注册一个</RouterLink>
      。忘记了密码？
      <RouterLink :to="{ name: 'recover', query: route.query }" class="link">用恢复码重置</RouterLink>
      。
    </p>
  </PageContainer>
</template>
