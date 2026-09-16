<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ReportViewModel } from '@/domain/report'
import {
  copyText,
  deliverShareImage,
  type ShareOutcome,
} from '@/utils/shareImage'

/**
 * 分享预览浮层 —— `docs/2026-09-15/...重构开发文档.md` §4.5 / §9.2，
 * 视频/复制/文件名统一展示模型见 `TypeMe-测评可信度调整-开发方案.md` §7.4。
 *
 * 组件**只接收 `ReportViewModel`**：复制文字、下载文件名、图片无障碍名称都从
 * `report.share` 读取。因此未定结果不可能在这里被重新拼成某个类型
 * （过去正是「页面提示均衡、图片大字 ISFJ」这类跨渠道不一致的温床）。
 */
const props = defineProps<{
  /** 已生成好的 preview dataURL；为 null 时不渲染 */
  image: string | null
  open: boolean
  report: ReportViewModel
  /** 生成图片用的 Blob（下载/系统分享都用它，避免二次绘制） */
  blob: Blob | null
}>()
const emit = defineEmits<{ close: [] }>()

type Tone = 'success' | 'neutral' | 'error'
interface Status {
  tone: Tone
  text: string
}

const status = ref<Status | null>(null)
const busy = ref(false)
const copyState = ref<'idle' | 'done' | 'failed'>('idle')
const panel = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
const manualText = ref<HTMLTextAreaElement | null>(null)
const manualValue = computed(() => props.report.share.text)

/** 系统分享面板的标题：随报告模型是否产出类型码而变（不再一律写"四维"）。 */
const sharePanelTitle = computed(() =>
  props.report.hasTypeCode ? 'TypeMe 四维人格倾向自测' : 'TypeMe 大五人格倾向自测',
)

const shareSupported = computed(() => {
  if (typeof navigator === 'undefined') return false
  return typeof (navigator as Navigator).share === 'function'
})

let previouslyFocused: HTMLElement | null = null

function setStatus(tone: Tone, text: string) {
  status.value = { tone, text }
}

function onClose() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    onClose()
    return
  }
  if (event.key !== 'Tab') return
  const items = panel.value?.querySelectorAll<HTMLElement>('button, a[href], textarea')
  if (!items || items.length === 0) return
  const list = Array.from(items)
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    if (typeof document === 'undefined') return
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKeydown, true)
      document.body.style.overflow = 'hidden'
      await nextTick()
      closeButton.value?.focus()
    } else {
      document.removeEventListener('keydown', onKeydown, true)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
      previouslyFocused = null
      status.value = null
      copyState.value = 'idle'
    }
  },
)

onBeforeUnmount(() => {
  if (typeof document === 'undefined') return
  document.removeEventListener('keydown', onKeydown, true)
  document.body.style.overflow = ''
})

function describeOutcome(outcome: ShareOutcome) {
  if (outcome === 'shared') {
    setStatus('success', '已交给系统分享。是否发送或保存由你在系统面板里决定。')
    return
  }
  if (outcome === 'cancelled') {
    setStatus('neutral', '已取消分享，图片还在预览里，可以随时重新保存。')
    return
  }
  if (outcome === 'downloaded') {
    setStatus('success', '已发起下载，请查看浏览器的下载记录。')
    return
  }
  setStatus('error', '这个浏览器不支持直接下载。可以长按图片手动保存，或改用「复制文字」。')
}

async function download() {
  if (!props.blob || busy.value) return
  busy.value = true
  try {
    const outcome = await deliverShareImage({
      blob: props.blob,
      filename: props.report.share.filename,
      preferShare: false,
    })
    describeOutcome(outcome)
  } catch (error) {
    console.warn('[typeme] 下载分享图失败', error)
    setStatus('error', '下载没有成功。可以长按图片手动保存，或改用「复制文字」。')
  } finally {
    busy.value = false
  }
}

async function systemShare() {
  if (!props.blob || busy.value) return
  busy.value = true
  try {
    const outcome = await deliverShareImage({
      blob: props.blob,
      filename: props.report.share.filename,
      preferShare: true,
      shareTitle: sharePanelTitle.value,
    })
    describeOutcome(outcome)
  } catch (error) {
    console.warn('[typeme] 系统分享失败', error)
    setStatus('error', '系统分享没有成功。可以改用「下载图片」或「复制文字」。')
  } finally {
    busy.value = false
  }
}

async function copy() {
  const ok = await copyText(props.report.share.text)
  copyState.value = ok ? 'done' : 'failed'
  if (ok) {
    setStatus('success', '分享文案已复制到剪贴板。')
    return
  }
  setStatus('error', '这个浏览器不允许自动复制，请在下面的文本框里手动选中复制。')
  await nextTick()
  manualText.value?.focus()
  manualText.value?.select()
}
</script>

<template>
  <div
    v-if="open && image"
    class="fixed inset-0 z-[60] flex flex-col bg-ink/70"
    role="dialog"
    aria-modal="true"
    aria-label="分享卡片预览"
  >
    <div class="absolute inset-0" aria-hidden="true" @click="onClose" />

    <div
      ref="panel"
      class="relative z-10 mx-auto flex h-full w-full max-w-[36rem] flex-col px-3 pt-3 tablet:px-5 tablet:pt-5"
    >
      <div class="flex min-h-0 flex-1 items-center justify-center">
        <img
          :src="image"
          :alt="report.share.alt"
          class="max-h-full w-auto max-w-full rounded-control border border-white/20 bg-paper object-contain shadow-lg"
        />
      </div>

      <div
        class="safe-bottom mt-3 rounded-t-cover border border-white/15 bg-surface px-4 pb-3 pt-4 tablet:mb-4 tablet:rounded-cover"
      >
        <div class="mb-2.5 flex items-center justify-between gap-3">
          <h2 class="text-[15px] font-semibold text-ink">分享卡片预览</h2>
          <button ref="closeButton" type="button" class="btn-ghost btn-sm" @click="onClose">
            关闭
          </button>
        </div>

        <p
          v-if="status"
          class="mb-3 rounded-control px-3 py-2 text-[13px] leading-relaxed"
          :class="
            status.tone === 'success'
              ? 'bg-primary-50 text-primary-800'
              : status.tone === 'neutral'
                ? 'bg-paper-soft text-ink-soft'
                : 'bg-accent-100 text-accent-700'
          "
          role="status"
          aria-live="polite"
        >
          {{ status.text }}
        </p>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary btn-sm flex-1" :disabled="busy || !blob" @click="download">
            下载图片
          </button>
          <button
            v-if="shareSupported"
            type="button"
            class="btn-secondary btn-sm flex-1"
            :disabled="busy || !blob"
            @click="systemShare"
          >
            系统分享
          </button>
          <button type="button" class="btn-secondary btn-sm flex-1" @click="copy">
            <span v-if="copyState === 'done'">已复制</span>
            <span v-else>复制文字</span>
          </button>
        </div>

        <label v-if="copyState === 'failed'" class="mt-3 block">
          <span class="text-[13px] text-ink-soft">手动复制这段文字：</span>
          <textarea
            ref="manualText"
            class="mt-1 h-20 w-full select-all rounded-control border border-line bg-paper-soft px-3 py-2 text-[13px] leading-relaxed text-ink"
            readonly
            :value="manualValue"
            @focus="($event.target as HTMLTextAreaElement).select()"
          />
        </label>

        <p class="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
          文件名：{{ report.share.filename }}。卡片只包含本次真正成立的内容，没有逐题答案或任何个人信息。
          手机上也可以长按图片保存。
        </p>
      </div>
    </div>
  </div>
</template>
