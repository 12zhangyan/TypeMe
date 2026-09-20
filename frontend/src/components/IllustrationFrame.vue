<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { illustrationAsset } from '@/design/illustrationAssets'
const props = withDefaults(defineProps<{ name: string; alt?: string; eager?: boolean; fit?: 'cover' | 'contain' }>(), { alt: '', eager: false, fit: 'cover' })

/**
 * 图片出现得突兀，原因不是"尺寸塌陷"，而是**没有加载态**：容器一直有确定尺寸，
 * 但图片本身从"什么都没有"直接变成完整画面，中间没有任何过渡。
 *
 * 这里只做三件事，不动页面视觉：
 *   1. 未就绪时不透明度为 0，容器由各消费者既有的尺寸/比例撑住（不塌陷、不改布局）；
 *   2. `load` 且 `decode()` 完成后淡入约 200ms，只改透明度，不缩放、不位移；
 *   3. 异步回调绑定"当前这次 name"的令牌——换图后旧请求晚到不会覆盖新选择；
 *      加载或解码失败立刻退出加载态，交给现成的兜底 SVG，不无限等待、不反复重试。
 *
 * 兜底 SVG 仍然只在"没有素材"或"加载失败"时渲染：正常加载阶段不再拿 SVG 顶替，
 * 免得出现"先默认 SVG、后突然换位图"的二次跳变。
 */
const failed = ref(false)
const revealed = ref(false)
const imgEl = ref<HTMLImageElement | null>(null)
const src = computed(() => illustrationAsset(props.name))
const state = computed(() => (!src.value || failed.value ? 'fallback' : revealed.value ? 'ready' : 'loading'))

// 每次换图或失败都换一个令牌；异步回调只有拿着当前令牌才有权改状态。
let ticket = 0
let disposed = false
let decodeTimer: ReturnType<typeof setTimeout> | null = null

function clearDecodeTimer(): void {
  if (decodeTimer !== null) {
    clearTimeout(decodeTimer)
    decodeTimer = null
  }
}

/** 已经在内存缓存里的图片：插入当帧直接显示，不闪占位、也不为动画拖延。 */
function adoptCached(): void {
  const img = imgEl.value
  if (disposed || !img || !src.value) return
  if (!img.complete) return
  if (img.naturalWidth > 0) {
    failed.value = false
    revealed.value = true
  } else {
    failed.value = true
    revealed.value = false
  }
}

function onLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  const expected = src.value
  if (!expected || img.getAttribute('src') !== expected) return
  const name = props.name
  const own = ticket
  const settle = (ok: boolean): void => {
    if (disposed || own !== ticket || props.name !== name) return
    clearDecodeTimer()
    if (ok) {
      failed.value = false
      revealed.value = true
    } else {
      // 解码失败等同加载失败：退出 loading 交给兜底，不把解不开的图留在页面上。
      failed.value = true
      revealed.value = false
    }
  }
  if (typeof img.decode !== 'function') {
    settle(true)
    return
  }
  // 解码通常只差一帧；万一 decode() 不落地，也不该让整块内容一直空着。
  decodeTimer = setTimeout(() => settle(true), 500)
  img.decode().then(() => settle(true), () => settle(false))
}

function onError(event: Event): void {
  const img = event.target as HTMLImageElement
  if (src.value && img.getAttribute('src') !== src.value) return
  ticket += 1
  clearDecodeTimer()
  failed.value = true
  revealed.value = false
}

onMounted(adoptCached)
watch(() => props.name, () => {
  failed.value = false
  revealed.value = false
  ticket += 1
  clearDecodeTimer()
  void nextTick(adoptCached)
})
onBeforeUnmount(() => {
  // 卸载后不再有回调改状态，也不让未完成的 decode 继续持有这个组件。
  disposed = true
  ticket += 1
  clearDecodeTimer()
  imgEl.value = null
})
</script>
<template>
  <div class="illustration-frame" :data-artwork="name" :data-artwork-source="src && !failed ? 'image' : 'vector'" :data-artwork-state="state">
    <img v-if="src && !failed" ref="imgEl" :src="src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" :class="{ 'is-revealed': revealed }" :style="{ objectFit: fit }" @load="onLoad" @error="onError" />
    <slot v-else />
  </div>
</template>
<style scoped>
.illustration-frame { position: relative; min-width: 0; overflow: hidden; }
/* 未就绪时整块留白（各消费者既有的尺寸/比例负责占位）；淡入只改不透明度，
   不做缩放、位移、模糊；关闭动画偏好时直接显示。 */
.illustration-frame > img { display: block; width: 100%; height: 100%; opacity: 0; }
.illustration-frame > img.is-revealed { opacity: 1; transition: opacity 200ms ease-out; }
@media (prefers-reduced-motion: reduce) { .illustration-frame > img.is-revealed { transition: none; } }
</style>
