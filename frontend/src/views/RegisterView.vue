<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { refreshCsrfToken } from '@/api/v3'
import { DISCLAIMER_TEXT } from '@/domain/disclaimerV3'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 注册 —— 契约 `02-数据模型与API-v1.md` §7.2（`POST /auth/register`）。
 *
 * 两段式界面：先填表，成功后**换一屏**显示恢复码。
 * 恢复码在响应里只出现一次（服务端只存 hash），所以这一屏必须做到三件事：
 *   1. 说清楚"只显示这一次"，让用户真的去抄；
 *   2. **不自动复制到剪贴板** —— 剪贴板里多出 8 个码而用户不知道，
 *      下一次粘贴别的东西时就会把它顺手覆盖掉，反而更危险；
 *   3. 需要一个显式动作才能离开（勾选 + 按钮），避免误触返回键就再也看不到。
 *
 * 表单里的规则与服务端 `AccountFieldRules` 对齐（用户名 `^[A-Za-z0-9_]{4,32}$`、
 * 密码 8–72 位可见 ASCII 字符），但**服务端才是权威**：
 * 前端只负责少打一次注定失败的请求，真正的判断不改写、不隐瞒。
 */
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const username = ref('')
const nickname = ref('')
const password = ref('')
const confirm = ref('')
/**
 * 免责声明同意（2026-09-17 新增）。默认**不勾**：默认勾上等于替用户同意，
 * 那正是这条要求想避免的事。后端同样要求显式 true。
 */
const disclaimerAccepted = ref(false)

/** 注册成功后的恢复码（只活在内存里，刷新就没了——这正是"只显示一次"的含义）。 */
const recoveryCodes = ref<string[]>([])
const policyVersion = ref<string | null>(null)
const codesCopied = ref(false)
const registered = ref(false)

const usernameId = `reg-username-${useId()}`
const nicknameId = `reg-nickname-${useId()}`
const passwordId = `reg-password-${useId()}`
const confirmId = `reg-confirm-${useId()}`
const hintId = `reg-hint-${useId()}`
const copiedId = `reg-copied-${useId()}`
const disclaimerId = `reg-disclaimer-${useId()}`
const disclaimerText = DISCLAIMER_TEXT

const error = computed(() => auth.lastError)
const done = computed(() => registered.value)
/** 账号建好了但服务端没回恢复码：不能假装成功，也不能让用户以为手里有码。 */
const codesMissing = computed(() => registered.value && recoveryCodes.value.length === 0)

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw !== 'string') return '/account'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/account'
  return raw
})

const localProblem = computed(() => {
  const name = username.value.trim()
  if (!name) return '先填用户名。'
  if (!/^[A-Za-z0-9_]{4,32}$/.test(name)) return '用户名要是 4–32 位的字母、数字或下划线。'
  if (password.value.length < 8) return '密码至少 8 位。'
  if (password.value.length > 72) return '密码最多 72 位。'
  if (!/^[\x20-\x7E]+$/.test(password.value)) return '密码只能用英文、数字和键盘上的符号，暂不支持中文。'
  if (confirm.value !== password.value) return '两次输入的密码不一样。'
  if (nickname.value.trim().length > 32) return '昵称最多 32 个字。'
  // 同意项放在最后校验：前面的格式问题更常发生，先让人把字打对。
  // 服务端也校验这一条 —— 这里只是让用户少一次注定失败的往返。
  if (!disclaimerAccepted.value) return '请先勾选并阅读下面的说明，再创建账号。'
  return null
})

const disabledReason = computed(() => {
  if (auth.busy) return '正在创建账号，请稍等。'
  return localProblem.value
})

const leaveReason = computed(() => {
  if (auth.busy) return '正在处理，请稍等。'
  if (codesMissing.value) return null
  if (!codesCopied.value) return '先确认你已经把恢复码抄下来了。'
  return null
})

onMounted(() => {
  auth.clearError()
  void refreshCsrfToken()
})

async function onSubmit() {
  if (disabledReason.value) return
  try {
    const result = await auth.register(
      username.value.trim(),
      password.value,
      nickname.value.trim(),
      disclaimerAccepted.value,
    )
    recoveryCodes.value = result.recoveryCodes
    policyVersion.value = result.recoveryCodePolicyVersion
    registered.value = true
  } catch {
    // 失败已存进 auth.lastError
  }
}

async function leave() {
  if (leaveReason.value) return
  await router.replace(redirectTarget.value)
}
</script>

<template>
  <PageContainer page="article">
    <!-- 第二屏：恢复码。只显示这一次，所以文案与操作都围绕"抄下来"设计。 -->
    <section v-if="done" aria-labelledby="recovery-heading">
      <p class="section-kicker">最后一步</p>
      <h1
        id="recovery-heading"
        class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
      >
        账号建好了。这 8 个恢复码，请抄下来 —— 只显示这一次
      </h1>
      <p class="mt-3 prose-cn max-w-prose">
        忘记密码时，用其中任意一个就能重置密码。每个码只能用一次，用完即作废。
        离开这一页之后就再也查不到这组码了；真丢了，只能登录后用密码重新生成一组。
      </p>

      <!-- 服务端没回恢复码：不装作成功，也不把用户留在一个空列表前面 -->
      <div v-if="codesMissing" class="notice-error mt-5 text-[14px] leading-relaxed" role="alert" aria-live="assertive">
        <p class="flex items-start gap-2 font-medium">
          <AppIcon name="alert" :size="17" class="mt-0.5" />
          <span>账号已经建好、也登录上了，但服务器这次没有返回恢复码。</span>
        </p>
        <p class="mt-1">
          不要关掉这个页面就以为手里有码。请到「账号与数据」里输入密码重新生成一组，
          并当场抄下来。
        </p>
      </div>

      <div v-else class="notice-uncertain mt-5 text-[14px] leading-relaxed" role="note">
        <p class="flex items-start gap-2 font-medium">
          <AppIcon name="shield" :size="17" class="mt-0.5" />
          <span>现在请用纸笔或你自己的密码管理器记下来。</span>
        </p>
        <p class="mt-1">
          页面不会自动把它们复制到剪贴板 —— 那样你很容易在下次粘贴时把它覆盖掉，而自己还不知道。
          也不要把它们截图发到聊天工具或群里：那等于把账号的另一把钥匙公开了。
        </p>
      </div>

      <!-- 8 个码是一个整体：收在一张卡里、用细分隔线分开，避免八块相同的方框把页面压碎 -->
      <ol
        v-if="!codesMissing"
        class="card mt-5 max-w-[30rem] divide-y divide-line-soft"
        data-recovery-codes
      >
        <li
          v-for="(code, index) in recoveryCodes"
          :key="code"
          class="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0"
        >
          <span class="w-5 shrink-0 text-right text-[13px] text-ink-faint tabular">{{ index + 1 }}</span>
          <code class="min-w-0 break-all font-mono text-[15.5px] tracking-wide text-ink">{{ code }}</code>
        </li>
      </ol>
      <p v-if="policyVersion && !codesMissing" class="mt-3 fineprint max-w-prose">
        恢复码规则版本：<code class="font-mono">{{ policyVersion }}</code>
      </p>

      <div class="mt-6 max-w-[30rem]">
        <div v-if="!codesMissing" class="flex items-start gap-2.5">
          <input
            :id="copiedId"
            v-model="codesCopied"
            type="checkbox"
            class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong"
          />
          <label :for="copiedId" class="text-[14.5px] leading-relaxed text-ink">
            我已经把这 8 个恢复码抄下来，并放在只有我能拿到的地方了。
          </label>
        </div>

        <p v-if="leaveReason" :id="hintId" class="caption mt-3">{{ leaveReason }}</p>

        <button
          type="button"
          class="btn-primary btn-block mt-4"
          :disabled="leaveReason !== null"
          :aria-describedby="leaveReason ? hintId : undefined"
          @click="leave"
        >
          去「账号与数据」
        </button>
      </div>
    </section>

    <!-- 第一屏：注册表单 -->
    <section v-else aria-labelledby="register-heading">
      <header>
        <p class="section-kicker">账号</p>
        <h1
          id="register-heading"
          class="mt-2 font-display text-[26px] font-bold leading-tight text-ink tablet:text-[32px]"
        >
          注册
        </h1>
        <p class="mt-3 prose-cn max-w-prose">
          注册后测评进度和报告会存在服务器上，换设备也能接着看。只需要一个用户名和密码，不要邮箱、不要手机号。
        </p>
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
            :aria-describedby="`${usernameId}-help`"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
          <p :id="`${usernameId}-help`" class="caption mt-1.5">
            4–32 位的字母、数字或下划线，登录时用它。
          </p>
        </div>

        <div class="mt-4">
          <label :for="nicknameId" class="block text-[14.5px] font-medium text-ink">
            昵称（可不填）
          </label>
          <input
            :id="nicknameId"
            v-model="nickname"
            name="nickname"
            type="text"
            autocomplete="nickname"
            maxlength="32"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
          <p class="caption mt-1.5">页面上显示的名字，最多 32 个字，可以随时改。</p>
        </div>

        <div class="mt-4">
          <label :for="passwordId" class="block text-[14.5px] font-medium text-ink">密码</label>
          <input
            :id="passwordId"
            v-model="password"
            name="new-password"
            type="password"
            autocomplete="new-password"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
          <p class="caption mt-1.5">
            8–72 位，只能用英文、数字和键盘上的符号（暂不支持中文和表情符号）。
          </p>
        </div>

        <div class="mt-4">
          <label :for="confirmId" class="block text-[14.5px] font-medium text-ink">再输一次密码</label>
          <input
            :id="confirmId"
            v-model="confirm"
            name="confirm-password"
            type="password"
            autocomplete="new-password"
            class="mt-1.5 w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-2.5 text-[16px] text-ink"
          />
        </div>

        <div class="mt-5">
          <!--
            免责声明同意（2026-09-17）。三件事是刻意的：
              1. 默认不勾 —— 默认勾上等于替用户同意；
              2. 整句都包在一个 <label> 里（含两个链接）—— 点文字也能勾，读屏一次读完；
              3. 两个链接指向 /about 里**已经写实的**那两节，不在这里另写一套说法。
                 注意 /about 的锚点滚不动：`router/index.ts` 的 scrollBehavior 固定回顶部
                 （hash 模式下 `#/about#source` 这种二级 hash 也解析不了）。所以只承诺
                 "到关于页去读"，不写"直接跳到那一节"。
          -->
          <!-- 同意项是一整块需要读的文字：用下沉的浅底把它和上面的输入框分开，不要靠再加一层白卡 -->
          <div class="rounded-card border border-line bg-surface-soft px-4 py-3.5">
            <div class="flex items-start gap-2.5">
              <input
                :id="disclaimerId"
                v-model="disclaimerAccepted"
                name="disclaimer-accepted"
                type="checkbox"
                class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong"
                :aria-describedby="`${disclaimerId}-help`"
              />
              <label :for="disclaimerId" class="text-[14px] leading-relaxed text-ink">
                {{ disclaimerText.before
                }}<RouterLink to="/about" class="link">{{ disclaimerText.limitLink }}</RouterLink
                >{{ disclaimerText.middle
                }}<RouterLink to="/about" class="link">{{ disclaimerText.dataLink }}</RouterLink
                >{{ disclaimerText.after }}
              </label>
            </div>
            <p :id="`${disclaimerId}-help`" class="caption mt-1.5">
              这一项必须勾选才能创建账号；不做职业、招聘、恋爱配对之类的判定，也不给人群比较结论。
            </p>
          </div>
        </div>

        <div
          v-if="error"
          class="notice-error mt-4"
          role="alert"
          aria-live="assertive"
          data-register-error
        >
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
          {{ auth.busy ? '正在创建…' : '创建账号' }}
        </button>
      </form>

      <p class="mt-5 prose-sm">
        已经有账号了？<RouterLink to="/login" class="link">直接登录</RouterLink>。
      </p>

      <p class="mt-6 fineprint max-w-prose">
        注册成功后会给一组恢复码，用来在忘记密码时重置，所以下一步别急着关掉页面。
      </p>
    </section>
  </PageContainer>
</template>
