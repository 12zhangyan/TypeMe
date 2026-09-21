<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import PageContainer from '@/components/PageContainer.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useAssessmentStore, SCALE_CAPTIONS } from '@/stores/assessmentV3'
import { useAuthStore } from '@/stores/auth'
import { describeError, isSessionExpired } from '@/api/v3'
import type { Dimension, Item } from '@/domain/jung/types'
import { DIMENSION_SHORT_NAME } from '@/domain/jung/labels'
import { ANSWER_VALUES } from '@/domain/answers'
import { questionExample } from '@/domain/readingCompanion'

/**
 * 五档文案本身定义在 store（`SCALE_CAPTIONS`），因为同步冲突提示也要引用同一份。
 * 这里保留 `captionOf` 作为"1 基档位 → 文案"的取值口，避免各处写 `[value - 1]`。
 */

/** 档位 → 文案（1 基）。 */
function captionOf(value: number): string {
  return SCALE_CAPTIONS[value - 1] ?? ''
}

/**
 * 答题页（新测）—— 契约 `03-AI与前端契约-v1.md` §7.4。
 *
 * ## 与旧答题页一致的一点
 *
 * **选完答案不自动跳题**，必须手动点「下一题」。自动跳题在手机上会让人来不及改主意，
 * 也会让"我到底点上没有"变得不可确认（`views.spec.ts` 里有一条守卫测试专门钉这个）。
 *
 * ## unknown 与「未作答」是两件事
 *
 *   - **未作答**：这一题在服务端根本没有任何记录 → 主测覆盖检查会失败 → 不能出报告；
 *   - **这题我说不好（unknown）**：这是一次**作答**，会写进服务端 → 计入覆盖，不计入分数。
 *
 * 界面上两者必须能一眼区分（未作答显示"还没有作答"，unknown 显示"我说不好 · 不计分"），
 * 因为用户对它们的期待完全不同：前者是"待办"，后者是"已经处理完了"。
 *
 * ## 跨设备草稿
 *
 * 每次作答都带 `expectedRevision` 落库。收到 `409 CONFLICT_REVISION` 时**停止写入**，
 * 明确提示"另一台设备改过进度"，并让用户点一下"载入最新进度"才继续 —— 绝不静默覆盖。
 */

const route = useRoute()
const router = useRouter()
const assessment = useAssessmentStore()
const auth = useAuthStore()

/** 三段式流程：主测 → （可能）补充题说明 → 完成。 */
type Step = 'base' | 'clarify-offer' | 'clarification' | 'needs-review'
const step = ref<Step>('base')

const baseIndex = ref(0)
const clarificationIndex = ref(0)
const hint = ref<string | null>(null)
const liveMessage = ref('')
const loading = ref(false)
const loadFailure = ref<string | null>(null)
const showUnanswered = ref(false)
/** 交卷请求进行中（防连点）。 */
const submitting = ref(false)
const submitNotice = ref<string | null>(null)
/** 覆盖不足时服务端给的"还差哪几维"。 */
const needsReview = ref<{ dimension: Dimension; name: string; note: string }[]>([])
/**
 * 会话在答题过程中失效了。
 *
 * <p>答题页在 `App.vue` 里是**隐藏常规导航**的（只剩「暂时离开」），登录入口不在页面上，
 * 所以这里必须自己给出回登录的路：否则用户看到"请先登录"+一个注定失败的「重试」，
 * 页面上没有任何能走通的操作。路由守卫本来就支持 `redirect`，登录后会回到原处续答。
 */
const sessionExpired = ref(false)
/**
 * 载入失败的**错误码**（用于区分"再试一次就能好"和"再试一万次也不会变"）。
 *
 * <p>没有它的时候，任何载入失败都只给一个「重试」：测评被删掉（404）或内容包已下线
 * （409 `PACKAGE_UNAVAILABLE`）时，用户会对着一个必然失败的按钮反复点（第 17 轮）。
 */
const loadErrorCode = ref<string | null>(null)
/**
 * 这一类失败重试不会改变结果，必须给别的出路。
 *
 * <p>`NOT_FOUND`：这份测评在服务端已经不存在（被删除、或链接来自别的账号/别的时间）。
 * `PACKAGE_UNAVAILABLE`：这次测评锁定的内容包已经不能用了，草稿无法继续。
 * `FORBIDDEN`：这份测评不属于当前账号 —— 重试同样没有意义。
 */
const loadUnrecoverable = computed(
  () =>
    !sessionExpired.value &&
    loadErrorCode.value !== null &&
    ['NOT_FOUND', 'PACKAGE_UNAVAILABLE', 'FORBIDDEN'].includes(loadErrorCode.value),
)
const attemptId = computed(() => (typeof route.params.attemptId === 'string' ? route.params.attemptId : null))
const baseQuestions = computed(() => assessment.baseQuestions)
const clarificationQuestions = computed(() => assessment.scheduledClarificationQuestions)
const totalBase = computed(() => baseQuestions.value.length)
const totalClarification = computed(() => clarificationQuestions.value.length)

/** 当前阶段要显示的题集。 */
const activeQuestions = computed<Item[]>(() =>
  step.value === 'clarification' ? clarificationQuestions.value : baseQuestions.value,
)
const activeIndex = computed(() =>
  step.value === 'clarification' ? clarificationIndex.value : baseIndex.value,
)
const currentQuestion = computed<Item | null>(() => activeQuestions.value[activeIndex.value] ?? null)
const readingExample = computed(() => questionExample(assessment.packageView?.packageId, currentQuestion.value))
const activeNumber = computed(() => activeIndex.value + 1)
const activeTotal = computed(() => activeQuestions.value.length)
const isLastInStage = computed(() => activeTotal.value > 0 && activeIndex.value === activeTotal.value - 1)

const selected = computed(() => {
  const question = currentQuestion.value
  return question ? assessment.answerOf(question.id) : null
})
const selectedRating = computed(() =>
  selected.value?.kind === 'rating' ? (selected.value.rating ?? null) : null,
)
const isUnknown = computed(() => selected.value?.kind === 'unknown')
const isUnanswered = computed(() => selected.value === null)

/** 主测进度：分母固定 48，不倒退。 */
const processedBase = computed(() => assessment.processedBaseCount)
const unansweredBaseIds = computed(() => assessment.unansweredBaseIds)
const clarificationProcessed = computed(() =>
  clarificationQuestions.value.filter((question) => assessment.answerOf(question.id)).length,
)

/** 本地预览：**明确标注为"目前的粗略倾向"**，不是结论。 */
const preview = computed(() => assessment.previewScores)
const previewLines = computed(() => {
  const result = preview.value
  if (!result) return []
  return result.dimensions.map((row) => ({
    dimension: row.dimension,
    name:
      assessment.contentPackage?.dimensions.find((copy) => copy.dimension === row.dimension)?.name ??
      DIMENSION_SHORT_NAME[row.dimension],
    pole: row.computedPole,
    text:
      row.computedPole === null
        ? '目前两边差不多'
        : row.boundary
          ? `目前略偏 ${row.computedPole}`
          : `目前偏向 ${row.computedPole}`,
  }))
})

/** 保存状态三态（契约 §7.4）：正在保存 / 已保存 / 未同步。 */
const saveLabel = computed(() => {
  switch (assessment.saveState) {
    case 'saving':
      return '正在保存…'
    case 'saved':
      return '已保存'
    case 'conflict':
      return '未同步（另一台设备改过进度）'
    case 'error': {
      // 说清"还有几条没写上去"，而不是笼统一句"未同步"：
      // 用户需要知道回去补哪几题，也需要知道这不是又一次徒劳的重试。
      const outstanding = assessment.listUnconfirmedIds().length
      return outstanding > 0 ? `未同步（${outstanding} 题的作答还没写上去）` : '未同步（网络或登录已失效）'
    }
    default:
      return '还没有需要保存的内容'
  }
})

const saveTone = computed(() => {
  switch (assessment.saveState) {
    case 'saved':
      return 'text-primary-700'
    case 'conflict':
    case 'error':
      return 'text-accent-700 font-medium'
    default:
      return 'text-ink-faint'
  }
})

const clarificationReason = computed(() => {
  const dimensions = assessment.clarificationDimensions
  if (dimensions.length === 0) return ''
  const names = dimensions
    .map(
      (dimension) =>
        assessment.contentPackage?.dimensions.find((copy) => copy.dimension === dimension)?.name ??
        DIMENSION_SHORT_NAME[dimension],
    )
    .join('、')
  return `${names}这${dimensions.length > 1 ? '几' : '一'}维两边差不多，再问几题才能看出方向。`
})

/** 还没写上去的作答条数（保存失败提示里要说清"几题"）。 */
const unsavedCount = computed(() => assessment.listUnconfirmedIds().length)

/**
 * 这次保存失败是**会话失效**造成的吗？
 *
 * <p>是的话就不该给「重试保存」：在那个状态下重试必然再失败一次，
 * 用户会一直点一个永远不会成功的按钮。要给的是"去登录"（第 17 轮）。
 */
const saveNeedsLogin = computed(() => assessment.lastError?.sessionExpired === true)

/**
 * 重试把没写上去的作答保存好。
 *
 * <p>`retryUnconfirmed()` 不抛异常：成败都反映在 `saveState`/`lastError` 里
 * （失败时 store 自己记好），这里只负责把结果播报给屏幕阅读器 —— 它们看不到横幅变化。
 */
async function retrySave(): Promise<void> {
  await assessment.retryUnconfirmed()
  announce(
    assessment.saveState === 'saved'
      ? '刚才没保存上的作答已经补写好了。'
      : '还是没能保存，可以稍后再试。',
  )
}

/* ── 载入 / 断点续答 ─────────────────────────────────────────────────────── */

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await bootstrap()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})

async function bootstrap(): Promise<void> {
  loading.value = true
  loadFailure.value = null
  try {
    if (attemptId.value) {
      await assessment.load(attemptId.value)
      // 这份测评**已经交过卷**了（交卷成功但用户当时没看到结果、或直接刷新了页面）：
      // 这一页已经没有可做的事，直接把他送到那份报告。以前这里会把他留在题目页，
      // 再点交卷只会得到一句没有链接的「已经提交过」（第 17 轮）。
      if (assessment.status === 'SUBMITTED' && assessment.reportId) {
        await router.replace({ name: 'report-detail', params: { reportId: assessment.reportId } })
        return
      }
    } else {
      if (!auth.isAuthenticated) {
        await router.replace({ name: 'login', query: { redirect: '/assess' } })
        return
      }
      const detail = await assessment.create()
      // 用 replace：答题页的 URL 必须能直接分享/刷新续答
      await router.replace({ name: 'assess-attempt', params: { attemptId: detail.attemptId } })
    }
    restorePosition()
  } catch (error) {
    // 会话失效要单独说：答题页没有登录入口，只给「重试」会让用户卡死在这里。
    sessionExpired.value = isSessionExpired(error)
    loadErrorCode.value = describeError(error).code
    if (sessionExpired.value) {
      loadFailure.value = '登录状态已经失效。登录后可以接着答，已经保存的作答不会丢。'
    } else if (loadUnrecoverable.value) {
      loadFailure.value =
        loadErrorCode.value === 'PACKAGE_UNAVAILABLE'
          ? '这次测评已经下线，没法继续。可以重新开始一次。'
          : loadErrorCode.value === 'FORBIDDEN'
            ? '这份测评不属于当前登录的账号，所以打不开。'
            : '这份测评已经不存在了（可能已经被删除，或这个链接不是本机的）。'
    } else {
      loadFailure.value = error instanceof Error ? error.message : '这份测评没能载入。'
    }
  } finally {
    loading.value = false
  }
}

/**
 * 断点续答的落点选择。
 *
 * 规则刻意简单且可解释：
 *   - **优先回到第一道还没作答的主测题**；
 *   - 主测都处理过了、且已安排补充题时，直接进入补充阶段；
 *   - 都答完了才回到服务端记下的那一题（此时它是"最后停在哪"，用于回看）。
 *
 * 顺序为什么是"未答优先"而不是"记住的指针优先"（2026-09-17 真实浏览器抓到）：
 * `next()` 写进服务端的 `currentQuestionId` 是**刚答完的那一题**（见那里的注释：
 * 这是安全值，写下一题会让跳过未答题变得可能）。如果恢复时把这个安全值当权威，
 * 就会出现"答到第 47 题 → 刷新 → 回到第 1 题"——因为指针一直停在第 47 题，
 * 而第 48 题是未作答的。实测就是如此。放在已答完的题上既不丢数据也说不通，
 * 所以恢复落点以"第一道未作答"为准；两个条件在常见情况下指向同一题
 * （指针=刚答完的题，它已经有答案，所以第一道未作答其实是它的下一题附近）。
 */
function restorePosition(): void {
  const base = baseQuestions.value
  const firstUnanswered = base.findIndex((question) => !assessment.answerOf(question.id))
  if (firstUnanswered >= 0) {
    baseIndex.value = firstUnanswered
    step.value = 'base'
    return
  }
  if (clarificationQuestions.value.length > 0) {
    step.value = 'clarification'
    return
  }
  const remembered = assessment.currentQuestionId
  if (remembered) {
    const index = base.findIndex((question) => question.id === remembered)
    if (index >= 0) {
      baseIndex.value = index
      step.value = 'base'
      return
    }
    const clarificationIndexFound = clarificationQuestions.value.findIndex(
      (question) => question.id === remembered,
    )
    if (clarificationIndexFound >= 0) {
      clarificationIndex.value = clarificationIndexFound
      step.value = 'clarification'
      return
    }
  }
  step.value = 'base'
}

/* ── 作答 ───────────────────────────────────────────────────────────────── */

async function chooseRating(value: number): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (assessment.conflict) {
    hint.value = '先处理上方的同步提示，再继续作答（避免把另一台设备的进度覆盖掉）。'
    return
  }
  hint.value = null
  await assessment.select(question.id, 'rating', value)
  announce(`第 ${activeNumber.value} 题已选：${captionOf(value)}。点「下一题」继续。`)
}

async function chooseUnknown(): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (assessment.conflict) {
    hint.value = '先处理上方的同步提示，再继续作答（避免把另一台设备的进度覆盖掉）。'
    return
  }
  hint.value = null
  await assessment.select(question.id, 'unknown')
  announce('已记下「这题我说不好」。这是一次作答，不会计入分数，但不会再算作未作答。')
}

function announce(message: string): void {
  liveMessage.value = message
}

/** 手动前进。未作答时**不前进**，只给可见提示（与旧答题页一致）。 */
async function next(): Promise<void> {
  const question = currentQuestion.value
  if (!question) return
  if (!assessment.answerOf(question.id)) {
    hint.value = '这一题还没有作答。请选一档，或选「这题我说不好」（两者都算处理过这一题）。'
    announce('还没有作答，不能前进。')
    return
  }
  hint.value = null
  if (!isLastInStage.value) {
    // 先记住"我刚刚在哪一题"，再前进：反过来会把下一题的位置写上去，
    // 下次回来就从更后面开始了。
    await assessment.rememberPosition(question.id)
    if (step.value === 'clarification') clarificationIndex.value += 1
    else baseIndex.value += 1
    announce(`第 ${activeNumber.value} 题。`)
    return
  }
  await finishStage()
}

async function previous(): Promise<void> {
  hint.value = null
  if (activeIndex.value === 0) return
  if (step.value === 'clarification') clarificationIndex.value -= 1
  else baseIndex.value -= 1
}

/** 主动跳到某道题（未答题入口用）。 */
async function jumpTo(questionId: string): Promise<void> {
  const baseAt = baseQuestions.value.findIndex((question) => question.id === questionId)
  if (baseAt >= 0) {
    step.value = 'base'
    baseIndex.value = baseAt
    showUnanswered.value = false
    hint.value = null
    await assessment.rememberPosition(questionId)
    return
  }
  const clarificationAt = clarificationQuestions.value.findIndex(
    (question) => question.id === questionId,
  )
  if (clarificationAt >= 0) {
    step.value = 'clarification'
    clarificationIndex.value = clarificationAt
    showUnanswered.value = false
    hint.value = null
  }
}

/**
 * needs-review 时「回去改答」该落在哪一题。
 *
 * <p>`finishStage()` 只在**本地没有未答题**时才调 `runReview()`，所以走进
 * needs-review 这一步时「未答清单」通常是空的 —— 原先 `jumpToFirstUnanswered()`
 * 在这种情况下**静默返回**，按钮点了毫无反应，用户只能刷新页面才出得来（死路）。
 *
 * <p>所以这里按"用户能做什么"排优先级：
 * <ol>
 *   <li>真有未答的题 → 去那一题（把它答掉最直接）；</li>
 *   <li>否则去覆盖不足那一维的第一道主测题 —— 那一维多半有题被标了「这题我说不好」，
 *       改成一个真实档位就能把有效作答数补上去；</li>
 *   <li>再不行才退回第一道主测题。</li>
 * </ol>
 */
const reviewFallbackQuestionId = computed<string | null>(() => {
  const firstUnanswered = unansweredBaseIds.value[0]
  if (firstUnanswered) return firstUnanswered
  const baseQuestions =
    assessment.contentPackage?.questions.filter((item) => item.stage === 'base') ?? []
  const firstShortDimension = needsReview.value[0]?.dimension
  if (firstShortDimension) {
    const inDimension = baseQuestions.find((item) => item.dimension === firstShortDimension)
    if (inDimension) return inDimension.id
  }
  return baseQuestions[0]?.id ?? null
})

/** needs-review 这一步按钮该说什么：有未答题就是"回到未答的题"，否则是"回去改答"。 */
const reviewFallbackLabel = computed(() =>
  unansweredBaseIds.value.length > 0 ? '回到未答的题' : '回到题目继续调整',
)

/** 跳到第一道未作答的主测题；没有未答题时退回到覆盖不足那一维（见上面说明）。 */
async function jumpToFirstUnanswered(): Promise<void> {
  const target = reviewFallbackQuestionId.value
  if (!target) return
  await jumpTo(target)
}

/**
 * 从补充题阶段回到主测改答。
 *
 * <p>回到**第一道主测题**而不是"刚才离开的那道"：用户点这个按钮的动机通常是
 * "发现前面某题选错了"，而第一道未答题（若有）或开头是最容易找起的位置；
 * 主测阶段的「跳到未答的题」也能立刻把他送到真正还没处理的地方。
 */
async function backToBase(): Promise<void> {
  const first = baseQuestions.value[0]
  if (!first) return
  step.value = 'base'
  baseIndex.value = 0
  showUnanswered.value = false
  hint.value = null
  announce('已回到主测。改答会重新计算要问的补充题。')
  await assessment.rememberPosition(first.id)
}

/* ── 阶段收尾：review → 补充题或直接交卷 ─────────────────────────────────── */

async function finishStage(): Promise<void> {
  if (step.value === 'clarification') {
    await submit(false)
    return
  }
  // 主测结束：先看有没有未答题，再让服务端决定是否安排补充题
  if (unansweredBaseIds.value.length > 0) {
    showUnanswered.value = true
    hint.value = `还有 ${unansweredBaseIds.value.length} 题没有处理，先看完再交卷。`
    announce('主测还有未作答的题。')
    return
  }
  await runReview()
}

async function runReview(): Promise<void> {
  loading.value = true
  try {
    const result = await assessment.runReview()
    if (result.needsReview) {
      needsReview.value = assessment.insufficientDetails()
      step.value = 'needs-review'
      announce('还差几维信息，暂时不能出报告。')
      return
    }
    if (result.clarificationDimensions.length > 0) {
      step.value = 'clarify-offer'
      announce(clarificationReason.value)
      return
    }
    await submit(false)
  } catch (error) {
    hint.value = error instanceof Error ? error.message : '提交前的检查没能完成。'
  } finally {
    loading.value = false
  }
}

async function startClarification(): Promise<void> {
  step.value = 'clarification'
  clarificationIndex.value = 0
  hint.value = null
  announce(`补充题开始，共 ${totalClarification.value} 题。`)
}

/** 跳过补充题：**跳过 ≠ 未答**，如实说明代价。 */
async function skipClarification(): Promise<void> {
  assessment.markClarificationSkipped()
  announce('已选择跳过补充题：这几维只按主测作答说明，方向可能仍然看不清。')
  await submit(true)
}

async function submit(skipped: boolean): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  submitNotice.value = null
  try {
    const result = await assessment.submit({ clarificationSkipped: skipped })
    if (result.status === 'NEEDS_REVIEW') {
      needsReview.value = assessment.insufficientDetails()
      step.value = 'needs-review'
      submitNotice.value = '服务端复核后认为信息还不够，没有生成报告。草稿已经留下，可以接着补答。'
      announce('覆盖不足，未生成报告。')
      return
    }
    if (!result.reportId) {
      submitNotice.value = '服务端没有返回报告编号，暂时无法打开报告。可以稍后在报告列表里查看。'
      announce('提交成功但没有报告编号。')
      return
    }
    await router.push({ name: 'report-detail', params: { reportId: result.reportId } })
  } catch (error) {
    sessionExpired.value = isSessionExpired(error)
    // 交卷失败里最常见、也最让用户卡住的一种是"其实已经交上去了"（响应丢在路上、
    // 或用户重复点了交卷）。这时把他留在一句错误上没有意义：报告已经生成，
    // 契约里 `attempt.reportId` 就是为这条路准备的，只是前端以前从来没读它（第 17 轮）。
    if (!sessionExpired.value) {
      const probe = await assessment.probeSubmission()
      if (probe.submitted) {
        if (probe.reportId) {
          submitNotice.value =
            '这次测评其实已经交上去了 —— 上一次交卷的响应没有回到浏览器。正在打开那份报告。'
          announce('这次测评已经提交过了，正在打开报告。')
          await router.push({ name: 'report-detail', params: { reportId: probe.reportId } })
          return
        }
        // 交上去了，但服务端复核后没有生成报告（信息不足）：如实说明，并给出补答入口。
        needsReview.value = assessment.insufficientDetails()
        step.value = 'needs-review'
        submitNotice.value =
          '这次测评其实已经交上去了；服务端复核后认为信息还不够，没有生成报告。草稿完整保留，可以接着补答。'
        announce('这次测评已经提交过了，覆盖不足未生成报告。')
        return
      }
    }
    const display = sessionExpired.value
      ? '登录状态已经失效，所以这次没能交卷。登录后可以接着答，草稿还在。'
      : error instanceof Error
        ? error.message
        : '提交没能完成。'
    submitNotice.value = display
    if (sessionExpired.value && step.value !== 'needs-review') {
      step.value = 'needs-review'
      needsReview.value = assessment.insufficientDetails()
    }
    announce(sessionExpired.value ? '登录状态已失效。' : '提交失败。')
  } finally {
    submitting.value = false
  }
}

/* ── 冲突处理 ───────────────────────────────────────────────────────────── */

async function reloadLatest(): Promise<void> {
  loading.value = true
  try {
    await assessment.reload()
    restorePosition()
    hint.value = null
    announce('已载入另一台设备上的最新进度。')
  } catch (error) {
    hint.value = error instanceof Error ? error.message : '没能载入最新进度。'
  } finally {
    loading.value = false
  }
}

/* ── 键盘 ───────────────────────────────────────────────────────────────── */

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * 焦点已经在按钮/链接上时**不**接管 Enter / 空格：
 * 那种情况浏览器自己的"激活"行为更符合预期，接管会让一次按键变成两次操作。
 * 数字键与方向键不受此限制（radio group 内部自己 stopPropagation）。
 */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('button, a, summary, [role="radio"]') !== null
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  if (isTypingTarget(event.target)) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  // 数字键 1–5 作答
  const digit = Number.parseInt(event.key, 10)
  if (Number.isInteger(digit) && ANSWER_VALUES.includes(digit)) {
    event.preventDefault()
    void chooseRating(digit)
    return
  }
  const activatable = isActivatable(event.target)
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      void next()
      return
    case 'ArrowLeft':
      event.preventDefault()
      void previous()
      return
    case 'Enter':
      if (activatable) return
      event.preventDefault()
      void next()
      return
    case 'Backspace':
      event.preventDefault()
      void previous()
      return
    default:
      return
  }
}

/** 主测是否全部处理完（决定"完成主测"按钮是否可用）。 */
const baseReady = computed(() => totalBase.value > 0 && unansweredBaseIds.value.length === 0)
/** 当前这一题**之前**还有多少题没处理（服务端要求全处理，界面要提前说清楚）。 */
const earlierUnanswered = computed(() =>
  activeQuestions.value
    .slice(0, activeIndex.value)
    .filter((question) => !assessment.answerOf(question.id)).length,
)
</script>

<template>
  <PageContainer page="quiz" tight>
    <div class="jung-workspace py-4 tablet:py-6 laptop:grid laptop:grid-cols-[17rem_minmax(0,1fr)] laptop:gap-8">
      <!-- 左栏：进度与状态（laptop 起固定在左） -->
      <aside class="laptop:sticky laptop:top-6 laptop:self-start">
        <!--
          进度与保存状态收进一张卡里（2026-09-18 视觉重构）。
          答题页是"一屏一题"的专注界面，散落的几行小字会让"我答到哪了、存住了吗"
          这两件事没有落点；收成一块面板后，它在左栏里是明确的、可一眼扫过的，
          同时不与右边的题卡抢焦点。
        -->
        <div class="jung-progress">
          <p class="section-kicker">人格倾向自测（新测）</p>
          <h1 class="mt-1 font-display text-[19px] font-bold leading-tight text-ink tablet:text-[22px]">
            一屏一题，选完点「下一题」
          </h1>

          <div class="mt-4 space-y-1.5">
            <p v-if="step === 'base' || step === 'clarify-offer'" class="text-[14px] font-medium text-ink">
              主测 {{ processedBase }} / {{ totalBase }}
            </p>
            <p
              v-if="step === 'clarification' || (step === 'clarify-offer' && totalClarification > 0)"
              class="text-[14px] font-medium text-ink"
            >
              补充 {{ clarificationProcessed }} / {{ totalClarification }}
            </p>
            <p v-if="step === 'base'" class="text-[13px] text-ink-soft">
              第 {{ activeNumber }} 题 / 共 {{ activeTotal }} 题
            </p>
            <p v-else-if="step === 'clarification'" class="text-[13px] text-ink-soft">
              补充题 第 {{ activeNumber }} 题 / 共 {{ activeTotal }} 题
            </p>
          </div>

          <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-line-soft" role="presentation">
            <div
              class="h-full rounded-full bg-primary-500 transition-[width] duration-300"
              :style="{
                width: `${totalBase > 0 ? Math.round((processedBase / totalBase) * 100) : 0}%`,
              }"
            />
          </div>

          <p class="mt-3 flex items-start gap-2 text-[13px] leading-relaxed" :class="saveTone" data-save-state>
            <AppIcon name="refresh" :size="14" class="mt-[3px] shrink-0 opacity-70" />
            <span>{{ saveLabel }}</span>
          </p>

        <!--
          保存失败的真实三态之一：**未同步**。
          原先这里只有一行字，既没有原因（`assessment.lastError` 从来没被渲染过），
          也没有重试入口；而下一次成功保存把状态翻回「已保存」之后，
          那几条没写上去的作答就再也看不出问题了。
        -->
        <div
          v-if="assessment.saveState === 'error'"
          class="notice-uncertain mt-2 rounded-control px-3 py-2.5"
          role="alert"
          aria-live="assertive"
          data-save-failed
        >
          <p class="text-[13px] leading-relaxed">
            有 {{ unsavedCount }} 题的作答还没写上去，刷新或离开会丢掉它们。
          </p>
          <p v-if="assessment.lastError" class="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            {{ assessment.lastError.message }}
            <span v-if="assessment.lastError.requestId" class="ml-1">
              （报障编号 <code class="font-mono">{{ assessment.lastError.requestId }}</code>）
            </span>
          </p>
          <!--
            保存失败的原因里有一种是**重试永远不会成功**的：会话已经失效。
            那时只给「重试保存」等于把用户按在一个必然失败的按钮上（第 17 轮）。
            这里据 `lastError.sessionExpired` 换成一个真的能解决问题的入口。
          -->
          <template v-if="saveNeedsLogin">
            <RouterLink
              :to="{ name: 'login', query: { redirect: route.fullPath } }"
              class="btn-primary btn-sm mt-2"
              data-save-login-link
            >
              登录后接着答
            </RouterLink>
            <p class="mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
              已经写上去的作答留在服务端，登录后回到这一页就能接着答。
            </p>
          </template>
          <button
            v-else
            type="button"
            class="btn-secondary btn-sm mt-2"
            data-retry-save
            :disabled="assessment.loading"
            @click="retrySave"
          >
            重试保存
          </button>
        </div>
        </div>

        <!-- 本地预览：明确标注为"目前的粗略倾向"，不是结论。放在进度卡外面：
             它是"参考"，和"答到哪了 / 存住了吗"不是同一层级。 -->
        <details v-if="previewLines.length > 0" class="jung-preview mt-4">
          <summary class="cursor-pointer min-h-[44px] py-2 text-[13px] text-ink-soft">查看目前的粗略倾向</summary>
          <p class="flex items-center gap-2 text-[12.5px] font-medium text-ink-soft">
            <AppIcon name="chart" :size="14" class="text-primary-500" />
            目前的粗略倾向（仅供参考）
          </p>
          <p class="mt-1 text-[12px] leading-relaxed text-ink-faint">
            这是边答边算的即时预览，不是结论；交卷后以服务端生成的报告为准。
          </p>
          <ul class="mt-2 space-y-1">
            <li v-for="line in previewLines" :key="line.dimension" class="text-[13px] text-ink-soft">
              {{ line.name }}：{{ line.text }}
            </li>
          </ul>
        </details>

        <div class="mt-4 hidden laptop:block">
          <button type="button" class="btn-secondary btn-block" data-jump-unanswered @click="jumpToFirstUnanswered">
            {{
              unansweredBaseIds.length > 0
                ? `跳到未答的题（还剩 ${unansweredBaseIds.length} 题）`
                : '主测已全部处理'
            }}
          </button>
        </div>
      </aside>

      <!-- 右栏：题卡 -->
      <section class="mt-5 min-w-0 laptop:mt-0">
        <!-- 同步冲突：绝不静默覆盖 -->
        <div
          v-if="assessment.conflict"
          class="notice-uncertain"
          role="alert"
          aria-live="assertive"
          data-conflict-banner
        >
          <p class="text-[14.5px] font-medium leading-relaxed">
            另一台设备改过这次的进度
          </p>
          <p class="mt-1 text-[13.5px] leading-relaxed">
            {{ assessment.conflict.message }}
          </p>
          <!-- 只写"没写上去"是不够的：用户需要知道**是哪一题、自己选了什么**，
               否则他既没法核对，也没法在载入之后把那题补回来。 -->
          <ul
            v-if="assessment.lostAnswerLabels.length"
            class="mt-2 space-y-1 text-[13.5px] leading-relaxed"
            data-lost-answers
          >
            <li v-for="label in assessment.lostAnswerLabels" :key="label" data-lost-answer>
              · {{ label }}
            </li>
          </ul>
          <p class="mt-1 text-[13px] leading-relaxed">
            上面这些本机改动没有写上去；载入最新进度后，以另一台设备的版本为准，
            被覆盖的题需要重新作答一遍。
          </p>
          <button
            type="button"
            class="btn-secondary mt-3"
            data-reload-latest
            :disabled="loading"
            @click="reloadLatest"
          >
            {{ loading ? '正在载入…' : '载入最新进度' }}
          </button>
        </div>

        <!-- 载入失败 -->
        <div v-if="loadFailure" class="notice-error mt-4" role="alert">
          <p class="text-[14.5px] font-medium">
            {{ sessionExpired ? loadFailure : `这份测评没能载入：${loadFailure}` }}
          </p>
          <!--
            会话失效时给的是**去登录**而不是「重试」：答题页没有登录入口
            （App.vue 在这一路由下隐藏了常规导航），而重试在登录之前必然再失败一次。
            路由守卫支持 redirect，登录后会回到当前这一页继续答。
          -->
          <RouterLink
            v-if="sessionExpired"
            class="btn-secondary mt-3 inline-block"
            data-assess-login-link
            :to="{ name: 'login', query: { redirect: route.fullPath } }"
          >
            去登录，然后接着答
          </RouterLink>
          <!--
            重试不会改变结果的那几类失败：给"重新开始一次"，而不是一个必然失败的按钮。
            同时把「重试」也留着，但不再是唯一出路。
          -->
          <template v-else-if="loadUnrecoverable">
            <RouterLink to="/assess" class="btn-primary mt-3 inline-block" data-assess-restart>
              重新开始一次测评
            </RouterLink>
            <button type="button" class="btn-ghost btn-sm ml-2 mt-3" @click="bootstrap">再试一次</button>
          </template>
          <button v-else type="button" class="btn-secondary mt-3" @click="bootstrap">重试</button>
        </div>

        <p v-else-if="loading && !currentQuestion" class="mt-6 text-[15px] text-ink-soft">正在载入题目…</p>

        <!-- 补充题说明：说清原因，并允许跳过 -->
        <div v-else-if="step === 'clarify-offer'" class="card" data-clarify-offer>
          <h2 class="section-title">主测答完了，这几维还需要再问几题</h2>
          <p class="mt-2 prose-cn">{{ clarificationReason }}</p>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            补充题只有 {{ totalClarification }} 道，都是同一批维度上的固定题目；答完会一起计入最终结果。
          </p>
          <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">
            可以跳过。跳过的意思是：这几维只按主测作答来说明，
            <strong class="font-medium">方向可能仍然看不清</strong>，报告也不会给出倾向较轻的边界说明。
            跳过<strong class="font-medium">不等于</strong>没答——主测的作答会原样保留并计分。
          </p>
          <div class="mt-4 flex flex-col gap-2 tablet:flex-row">
            <button type="button" class="btn-primary" data-start-clarification @click="startClarification">
              开始补充题（{{ totalClarification }} 题）
            </button>
            <button
              type="button"
              class="btn-secondary"
              data-skip-clarification
              :disabled="submitting"
              @click="skipClarification"
            >
              {{ submitting ? '正在交卷…' : '跳过补充题，直接交卷' }}
            </button>
          </div>
        </div>

        <!-- 覆盖不足：还差哪几维 -->
        <div v-else-if="step === 'needs-review'" class="card" data-needs-review>
          <h2 class="section-title">还差一点信息，暂时不能出报告</h2>
          <p v-if="submitNotice" class="mt-2 prose-cn">{{ submitNotice }}</p>
          <p v-else class="mt-2 prose-cn">
            服务端复核后认为信息还不够，所以没有生成报告。草稿完整保留，可以接着补答。
          </p>
          <ul class="mt-3 space-y-2">
            <li v-for="item in needsReview" :key="item.dimension" class="rounded-control bg-paper-soft px-3 py-2.5">
              <p class="text-[14px] font-medium text-ink">{{ item.name }}</p>
              <p class="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{{ item.note }}</p>
            </li>
          </ul>
          <p class="mt-3 prose-cn text-[13.5px]">
            标成「这题我说不好」的题不计入有效作答，所以把其中几道改成一个更接近你的档位就行。
          </p>
          <div class="mt-4 flex flex-col gap-2 tablet:flex-row">
            <button type="button" class="btn-primary" data-back-to-unanswered @click="jumpToFirstUnanswered">
              {{ reviewFallbackLabel }}
            </button>
            <button
              type="button"
              class="btn-secondary"
              :disabled="submitting"
              @click="submit(assessment.clarificationSkipped)"
            >
              再交一次
            </button>
          </div>
        </div>

        <!-- 题卡：整页唯一的焦点，所以它拿到最大的留白与最重的一层投影 -->
        <div v-else-if="currentQuestion" class="jung-question card tablet:px-7 tablet:py-6" data-question-card>
          <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span class="chip chip-primary">
              日常选择
            </span>
            <span class="ml-auto text-[12.5px] text-ink-faint">第 {{ activeNumber }} / {{ activeTotal }} 题</span>
          </div>
          <h2 class="mt-3 font-display text-[20px] font-bold leading-[1.45] text-ink tablet:text-[24px]">
            {{ currentQuestion.scenario }}
          </h2>
          <p v-if="readingExample" class="reading-example" data-question-example><span>想一个这样的场景</span>{{ readingExample }}</p>
          <p class="mt-3 text-[13px] leading-relaxed text-ink-soft">下面两种做法，哪一种更像平时的你？按真实习惯选，不用选你觉得“应该”做到的。</p>

          <!--
            两端陈述：中间加一条短轴线，让"这两句是同一根轴的两端"在没有刻度的情况下
            也看得出来。轴线是装饰（`aria-hidden`），语义仍由两段文字自己承担。
          -->
          <div class="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 tablet:gap-x-10">
            <p class="border-t-2 border-line-strong pt-3 text-[16px] font-medium leading-[1.5] text-ink tablet:text-[19px]">
              <span class="mb-1 block text-[12px] font-normal text-ink-faint">左边这一侧</span>
              {{ currentQuestion.textLeft }}
            </p>
            <p class="border-t-2 border-line-strong pt-3 text-[16px] font-medium leading-[1.5] text-ink tablet:text-[19px]">
              <span class="mb-1 block text-[12px] font-normal text-ink-faint">右边这一侧</span>
              {{ currentQuestion.textRight }}
            </p>
          </div>

          <!-- 五档：1 左 ── 中间 ── 5 右 -->
          <p class="mt-5 flex items-center justify-between text-[11.5px] leading-none text-ink-faint" aria-hidden="true">
            <span>← 更靠近左边这一侧</span>
            <span>两边差不多</span>
            <span>更靠近右边这一侧 →</span>
          </p>
          <div
            class="mt-2 grid grid-cols-5 gap-1.5 tablet:gap-3"
            role="radiogroup"
            :aria-label="`第 ${activeNumber} 题的五档选择，1 为最靠左，5 为最靠右`"
          >
            <button
              v-for="value in ANSWER_VALUES"
              :key="value"
              type="button"
              role="radio"
              class="option-cell"
              :aria-checked="selectedRating === value"
              :aria-label="`${captionOf(value)}（第 ${value} 档，1 最靠左、5 最靠右）${selectedRating === value ? '，当前已选' : ''}`"
              :data-rating="value"
              @click="chooseRating(value)"
            >
              <!--
                选中不能只靠颜色（色觉差异 / 灰度打印 / 低对比屏幕都会丢掉这个信息），
                所以补上 CSS 里早就定义好、模板里一直没渲染的勾标。
              -->
              <AppIcon v-if="selectedRating === value" name="check" :size="14" class="option-check" />
              <span class="option-index">{{ value }}</span>
              <span class="option-caption">{{ captionOf(value) }}</span>
            </button>
          </div>

          <!-- unknown：与"未作答"是不同的两件事 -->
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-secondary btn-sm"
              data-unknown
              :aria-pressed="isUnknown"
              @click="chooseUnknown"
            >
              <!-- 已选状态同时给图标与文字，不靠按钮颜色区分 -->
              <AppIcon :name="isUnknown ? 'check' : 'question'" :size="15" />
              {{ isUnknown ? '已选：这题我说不好' : '这题我说不好' }}
            </button>
            <span class="text-[12.5px] leading-relaxed text-ink-faint">
              没经历过、没看明白，或两边都不像你，可以选这个。已作答，但不计分。
            </span>
          </div>

          <p class="mt-3 text-[13px] leading-relaxed" data-answer-state>
            <template v-if="isUnanswered">
              <span class="font-medium text-accent-700">还没有作答。</span>
              选一档，或点「这题我说不好」——两者都算处理过这一题。
            </template>
            <template v-else-if="isUnknown">
              <span class="font-medium text-primary-700">我说不好（已作答，不计分）。</span>
              之后想改也可以再选一档。
            </template>
            <template v-else>
              <span class="font-medium text-primary-700">
                已选：{{ selectedRating }} · {{ captionOf(selectedRating ?? 3) }}
              </span>
            </template>
          </p>

          <p class="mt-3 text-[12.5px] leading-relaxed text-ink-soft">“两边差不多”是指两种做法都像你、出现得差不多；“说不好”是现在无法判断，不是中间档。</p>
          <details v-if="currentQuestion.help" class="mt-3">
            <summary class="link cursor-pointer text-[13.5px]">这题是什么意思？</summary>
            <p class="mt-2 text-[13.5px] leading-relaxed text-ink-soft">{{ currentQuestion.help }}</p>
          </details>

          <p v-if="hint" class="notice-uncertain mt-4 text-[13.5px] leading-relaxed" role="status" aria-live="polite">
            {{ hint }}
          </p>

          <p v-if="earlierUnanswered > 0" class="mt-3 text-[13px] leading-relaxed text-ink-faint" data-earlier-note>
            前面还有 {{ earlierUnanswered }} 题没有处理；全部处理完才能出报告。
          </p>
          <p v-else-if="baseReady" class="mt-3 text-[13px] text-primary-700" data-base-ready>
            主测 {{ totalBase }} 题都处理过了。
          </p>

          <!-- 操作区 -->
          <div class="mt-5 flex flex-col gap-2 tablet:flex-row tablet:justify-between">
            <button
              type="button"
              class="btn-secondary"
              data-previous
              :disabled="activeIndex === 0"
              @click="previous"
            >
              上一题
            </button>
            <button
              type="button"
              class="btn-primary"
              data-next
              :disabled="submitting || loading"
              @click="next"
            >
              {{ isLastInStage ? (step === 'clarification' ? '完成并交卷' : '完成主测') : '下一题' }}
            </button>
          </div>

          <!--
            补充阶段必须留一个回主测的出口。契约把「跳过补充题」写成用户可以选的动
            作，但原先只有 `clarify-offer` 那一步有跳过按钮；一旦点了「开始补充题」，
            就只能把补充题全部答完，刷新也会被 restorePosition() 重新落回补充阶段。
          -->
          <div v-if="step === 'clarification'" class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn-ghost btn-sm"
              data-back-to-base
              @click="backToBase"
            >
              回到主测改答
            </button>
            <button
              type="button"
              class="btn-ghost btn-sm"
              data-skip-clarification-in-progress
              :disabled="submitting"
              @click="skipClarification"
            >
              跳过补充题，直接交卷
            </button>
          </div>

          <div class="mt-3 flex flex-wrap gap-2 laptop:hidden">
            <button type="button" class="btn-ghost btn-sm" @click="jumpToFirstUnanswered">
              跳到未答的题（还剩 {{ unansweredBaseIds.length }} 题）
            </button>
          </div>
        </div>

        <p v-else class="mt-6 text-[15px] text-ink-soft">
          这次测评没有可以继续作答的题目。可以到
          <RouterLink to="/reports" class="link">历史报告</RouterLink>看看已经完成的记录。
        </p>

        <!-- 未作答清单 -->
        <div v-if="showUnanswered && unansweredBaseIds.length > 0" class="card mt-4" data-unanswered-list>
          <h3 class="section-title">主测还有 {{ unansweredBaseIds.length }} 题没有处理</h3>
          <p class="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
            未作答的题必须处理（选一档，或标「这题我说不好」）才可能生成报告。
          </p>
          <ul class="mt-3 flex flex-wrap gap-2">
            <li v-for="questionId in unansweredBaseIds" :key="questionId">
              <button
                type="button"
                class="qnum qnum-unanswered"
                :aria-label="`跳到第 ${baseQuestions.findIndex((item) => item.id === questionId) + 1} 题（未作答）`"
                @click="jumpTo(questionId)"
              >
                {{ baseQuestions.findIndex((item) => item.id === questionId) + 1 }}
              </button>
            </li>
          </ul>
        </div>

        <p v-if="step !== 'base'" class="mt-4 text-[13px] text-ink-faint">
          主测已处理 {{ processedBase }} / {{ totalBase }} 题。
        </p>

        <p class="sr-only" aria-live="polite" data-live>{{ liveMessage }}</p>
      </section>
    </div>
  </PageContainer>
</template>
