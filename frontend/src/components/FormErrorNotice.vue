<script setup lang="ts">
import type { ErrorDisplay } from '@/api/v3'
import AppIcon from '@/components/AppIcon.vue'

/**
 * 表单失败的统一提示块（主文案 + 字段提示 + 服务器原文 + 限流秒数 + 报障编号）。
 *
 * <p>为什么单独抽出来：这一段原本在 `LoginView` / `RegisterView` / `RecoverView` 与
 * `AccountView` 里被**逐字抄了 8 份**，抄的时候各有增减 —— 结果账号页的五个表单
 * 都漏掉了「服务器说明」，于是"当前密码不正确。"这种服务端给的精确说法被丢掉，
 * 用户看到的是给登录页写的映射文案「用户名或密码不对」，而这几个表单里根本没有用户名字段。
 * 一份提示块的字段集合必须是**一处定义**：漏一个字段应当是编译错误，而不是某个页面上的
 * 一句不准确的话。
 *
 * <p>调用方只需要给 `error`；间距（`mt-3` / `mt-4` / `max-w-prose`）与
 * `data-*` 钩子照常从外面传进来，会合并到根元素上。
 */
/**
 * 字段默认值必须显式给（A59）。
 *
 * <p>这里原来是 `defineProps<{ requestHint?: boolean }>()` + 模板里 `v-if="requestHint !== false"`，
 * 想法是"不传就显示"。但 Vue 对**布尔** prop 有一个容易忘的规则：缺席的布尔 prop 会被转成
 * `false`（`disabled` 那套语义），于是 `undefined !== false` 这个判断永远不成立 ——
 * 「（反馈问题时把这个编号一起发过来，能直接查到这次请求。）」这句话在
 * **所有页面上都没有渲染过**，而组件注释写的是"默认显示"。
 * 用 `withDefaults` 把默认值写进声明，让"默认"由类型系统而不是模板条件来保证。
 */
withDefaults(
  defineProps<{
    /** 已经整理好的失败信息（`describeError` 的产物）。 */
    error: ErrorDisplay
    /**
     * 报障编号下面那句"反馈问题时带上它"。
     *
     * <p>默认显示。抽出来是因为它属于"怎么用这个编号"，而不是编号本身；
     * 若将来某个场景需要更紧的排版，可以显式传 `false` 关掉，而不是再抄一份。
     */
    requestHint?: boolean
  }>(),
  { requestHint: true },
)
</script>

<template>
  <div class="notice-error" role="alert" aria-live="assertive">
    <p class="flex items-start gap-2 text-[14.5px] font-medium leading-relaxed">
      <AppIcon name="alert" :size="17" class="mt-0.5" />
      <span>{{ error.message }}</span>
    </p>
    <ul v-if="error.fields.length" class="mt-2 space-y-1 text-[13.5px] leading-relaxed">
      <li v-for="field in error.fields" :key="field.field">
        {{ field.label }}：{{ field.message }}
      </li>
    </ul>
    <!--
      服务端原文与主文案是两件事：主文案是"按错误码翻译成人话"，这一行是服务端到底说了什么。
      两者重复时上游已经把 serverMessage 置成 null，所以这里不需要再去重。
    -->
    <p v-if="error.serverMessage" class="mt-2 text-[13.5px] leading-relaxed">
      服务器说明：{{ error.serverMessage }}
    </p>
    <p v-if="error.retryAfterSeconds" class="mt-2 text-[13.5px] leading-relaxed">
      大约 {{ error.retryAfterSeconds }} 秒后再试就来得及。
    </p>
    <p v-if="error.requestId" class="mt-2 break-all text-[12.5px] leading-relaxed">
      报障编号：<code class="font-mono">{{ error.requestId }}</code>
      <span v-if="requestHint !== false" class="block text-ink-faint">
        （反馈问题时把这个编号一起发过来，能直接查到这次请求。）
      </span>
    </p>
  </div>
</template>
