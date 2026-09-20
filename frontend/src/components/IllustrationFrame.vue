<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { illustrationAsset, illustrationLocalFallback } from '@/design/illustrationAssets'
import { useIllustrationAssetsStore } from '@/stores/illustrationAssetsV3'
const props = withDefaults(defineProps<{ name: string; alt?: string; eager?: boolean; fit?: 'cover' | 'contain' }>(), { alt: '', eager: false, fit: 'cover' })

/**
 * 图片出现得突兀，原因不是"尺寸塌陷"，而是**没有加载态**：容器一直有确定尺寸，
 * 但图片本身从"什么都没有"直接变成完整画面，中间没有任何过渡。
 *
 * 这里只做三件事，不动页面视觉：
 *   1. 未就绪时不透明度为 0，容器由各消费者既有的尺寸/比例撑住（不塌陷、不改布局）；
 *   2. `load` 且 `decode()` 完成后淡入约 200ms，只改透明度，不缩放、不位移；
 *   3. 异步回调绑定"当前这次 name"的令牌——换图后旧请求晚到不会覆盖新选择；
 *      加载失败或解码失败都走同一条受控回退（见下），不无限等待、不反复重试。
 *
 * 兜底 SVG 仍然只在"没有素材"或"加载失败"时渲染：正常加载阶段不再拿 SVG 顶替，
 * 免得出现"先默认 SVG、后突然换位图"的二次跳变。
 *
 * 失败链（顺序固定，最多各一次）：
 *
 *     远端图片地址 --失败--> 本地打包资源 --失败--> 兜底 SVG
 *
 * 也就是"一次受控回退"：`retrySrc` 只可能被写成非空一次，本地再失败就直接进
 * `fallback` 状态，不会回到远端、也不会重试第三次。
 *
 * 地址表是**异步**读到的（`stores/illustrationAssetsV3`），所以在上面这条链之前还有一段：
 *
 *     地址表未到 --（占位，不下载任何图）--> 地址表到 / 等待预算用尽 --+
 *                                                                    ↓
 *                                                        上面的失败链
 *
 * 占位期间**不**先用本地资源顶着：那会从源站下一张马上要被远端地址替换掉的图，
 * 正是这次迁移要省掉的那次下载。等待有预算（store 的 `WAIT_BUDGET_MS`），
 * 用尽即按"地址表里没有这张图"处理。
 */
const illustrations = useIllustrationAssetsStore()
const failed = ref(false)
const revealed = ref(false)
const imgEl = ref<HTMLImageElement | null>(null)
/** 非空表示当前显示的是"回退后的本地地址"；只允许在初次失败时写一次。 */
const retrySrc = ref<string | null>(null)
/** 地址表是否已经有结论（拿到了 / 确定拿不到 / 等够了）。 */
const addressesSettled = computed(() => illustrations.settled)
const fallbackSrc = computed(() => illustrationLocalFallback(props.name, illustrations.urls))
/**
 * 这个位置**已经定下来的**地址；`null` 表示还没定（地址表还没有结论）。
 *
 * 为什么要"定下来"而不是每次都重新解析：地址表可能在本地素材已经开始渲染之后才到货
 * （等待预算超时、或接口慢）。那时若改用远端地址，同一张图就付了两次下载（本地 + 远端），
 * 而这次迁移省的就是这份字节。所以规则是：**一次渲染只用一个来源**，
 * 地址表到货前已经用上本地的位置保持本地，下一次访问（地址表已进 `localStorage`）才走远端。
 * 副作用（正面）：地址表刷新/换地址不会让已经在页面上的图突然换一次。
 */
const decidedSrc = ref<string | null>(null)
const primarySrc = computed(() => decidedSrc.value ?? illustrationAsset(props.name, illustrations.urls))
const src = computed(() => retrySrc.value ?? primarySrc.value)
const state = computed(() => {
  if (!addressesSettled.value) return 'pending'
  return !src.value || failed.value ? 'fallback' : revealed.value ? 'ready' : 'loading'
})
const attempt = computed(() => (retrySrc.value ? 'local-fallback' : 'primary'))

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

/**
 * 当前地址**用不了**时唯一的处理路径：换成本地同名图再试一次，本地也不行（或本来就用本地）
 * 才交给兜底 SVG。
 *
 * 网络失败（`error`）与"加载成功但解码失败"（`decode()` 被拒）都归到这里，因为对用户而言
 * 结果一样：现在这张地址的图**显示不出来**。曾经把解码失败单独处理成"直接进兜底"，于是
 * 字节损坏 / 编码不支持的远端图不会回退到随包的本地同名图 —— 明明本地那张能正常解码，
 * 用户却看到最差的兜底 SVG。同一个组件对两类失败给出两种体验，是实现漏了一条路径。
 * （Codex review 指出，2026-09-20 修。）
 */
function fallbackToLocalOrFail(): void {
  ticket += 1
  clearDecodeTimer()
  // `retrySrc` 只可能被写成非空一次：本地再失败就直接进兜底，不回到远端、不重试第三次。
  const fallback = retrySrc.value === null ? fallbackSrc.value : undefined
  if (fallback) {
    retrySrc.value = fallback
    failed.value = false
    revealed.value = false
    // 本地那张图可能已经在内存缓存里：走和挂载时一样的"缓存直出"判断，不演动画。
    void nextTick(adoptCached)
    return
  }
  failed.value = true
  revealed.value = false
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
      // 解码失败等同加载失败：交给上面那条受控回退，而不是把解不开的图留在页面上。
      fallbackToLocalOrFail()
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
  fallbackToLocalOrFail()
}

/**
 * 定下这个位置用哪个地址，并且**只定一次**。
 *
 * 挂载时若地址表已经有结论（回访访客走 `localStorage`，或地址表比组件先到）就当场定；
 * 否则等结论落地时再定。换图（`props.name` 变）视为新的一次渲染，重新定。
 */
function decideSrc(): void {
  decidedSrc.value = illustrationAsset(props.name, illustrations.urls) ?? null
}

onMounted(() => {
  if (addressesSettled.value) decideSrc()
  adoptCached()
})
// 地址表到达（或等待预算用尽）的那一刻才真正有 `<img>`：此时可能是从内存缓存直出，
// 走一次和挂载时相同的判断，不演一次"空 → 有图"的动画。
watch(addressesSettled, (settled) => {
  if (!settled) return
  if (decidedSrc.value === null) decideSrc()
  void nextTick(adoptCached)
})
watch(() => props.name, () => {
  failed.value = false
  revealed.value = false
  retrySrc.value = null
  decidedSrc.value = null
  if (addressesSettled.value) decideSrc()
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
  <div class="illustration-frame" :data-artwork="name" :data-artwork-source="addressesSettled && src && !failed ? 'image' : 'vector'" :data-artwork-state="state" :data-artwork-attempt="attempt">
    <img v-if="addressesSettled && src && !failed" ref="imgEl" :src="src" :alt="alt" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" :class="{ 'is-revealed': revealed }" :style="{ objectFit: fit }" @load="onLoad" @error="onError" />
    <!-- 地址表还没有结论时两者都不渲染：兜底 SVG 也是"另一个画面"，先给出来再换成位图
         会看到一次跳变。占位期间容器仍由消费者的尺寸/比例撑住。 -->
    <slot v-else-if="addressesSettled" />
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
