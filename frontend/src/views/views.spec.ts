// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import LandingView from './LandingView.vue'
import QuizView from './QuizView.vue'
import ResultView from './ResultView.vue'
import AboutView from './AboutView.vue'
import { STORAGE_KEY, questionnaireSignature, useQuizStore } from '@/stores/quiz'
import {
  assessmentPackageSignature,
  packageDimensionOrder,
  packageFormat,
  responseAnchorsOf,
} from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import {
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
  FALLBACK_TYPE_PROFILES,
  TYPE_CODES,
} from '@/content/fallback'
import { ratingsForOffsets } from '@/dev/seed'
import type { Dimension, Pole } from '@/domain/types'
import type { ResponseMap } from '@/domain/answers'

/**
 * 页面级测试（jsdom）—— `docs/2026-09-15/TypeMe-测评可信度调整-产品方案.md`
 * §3 / §4.2 / §5 / §8 与 `...-开发方案.md` §7 / §10.3 / §10.4。
 *
 * 目的不是替代浏览器验收（真机、真实导出图片、像素宽度必须人工做），而是把
 * **可以被自动化的验收条目**钉住。本轮的三个重点：
 *
 *   1. **全中立/未定时没有任何默认类型**：页面、分享文字、文件名、无障碍名称
 *      四条导出渠道都不许出现 16 个四字母码或类型描述名（旧的「兼容写法 ISFJ」
 *      行为已经在本轮被删除，不能再作为验收点保留）；
 *   2. **一个维度改变不能导致其他三维解释一起翻转**：边界改答后，EI / TF / JP 的
 *      `details` 与 `actions` 必须逐条不变；
 *   3. **帮助展开不改变答案或分数**：展开、收起、反复多次都不产生任何回答写入。
 *
 * jsdom 下 `fetch('/api/v1/...')` 因相对 URL 直接抛错，正好顺带验证降级路径。
 */

const BANNED_IN_RESULT = ['解锁', '升级', '会员', '购买', '订阅', '限时', '立即支付']

/** 16 个四字母码（来自内容层，不写死）。未定报告里任何一处都不允许出现。 */
const ALL_TYPE_CODES: string[] = [...TYPE_CODES]
/** 类型描述名（例如 INFP 的「价值探索者」）。未定报告同样不许出现。 */
const ALL_TYPE_NAMES: string[] = Object.values(FALLBACK_TYPE_PROFILES).map(
  (profile) => profile.nameCn,
)

const SESSION_ID = 'spec-session-0001'
const STARTED_AT = 1_700_000_000_000

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const query = {
    matches,
    media: '(min-width: 768px)',
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (media: string) => ({ ...query, media }),
  })
}

/**
 * 最小 canvas 2D 替身：jsdom 没有 2d 上下文，而分享的可见反馈必须被测到。
 * 这里只验证"流程与反馈"，绘制内容正确性由浏览器验收负责。
 */
const ORIGINAL_CANVAS = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: HTMLCanvasElement.prototype.toDataURL,
  toBlob: HTMLCanvasElement.prototype.toBlob,
}

function restoreCanvas() {
  for (const [key, value] of Object.entries(ORIGINAL_CANVAS)) {
    Object.defineProperty(HTMLCanvasElement.prototype, key, {
      configurable: true,
      writable: true,
      value,
    })
  }
}

function stubCanvas2d(options: { toBlob?: Blob | null; dataUrl?: string | null } = {}) {
  const ctx = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'measureText') return () => ({ width: 42 })
        if (prop === 'canvas') return undefined
        return () => undefined
      },
      set: () => true,
    },
  )
  const blob =
    options.toBlob === undefined
      ? new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
      : options.toBlob
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => ctx,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    writable: true,
    value: () =>
      options.dataUrl === undefined ? 'data:image/png;base64,c3R1Yg==' : options.dataUrl,
  })
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: (callback: (value: Blob | null) => void) => callback(blob),
  })
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/quiz', name: 'quiz', component: QuizView },
      { path: '/result', name: 'result', component: ResultView },
      { path: '/about', name: 'about', component: AboutView },
    ],
  })
}

async function mountAt(path: string, component: unknown, attachToBody = false) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as never, {
    global: { plugins: [router] },
    ...(attachToBody ? { attachTo: document.body } : {}),
  })
  await flushPromises()
  return { wrapper, router }
}

/* ── 内容与答卷脚手架 ───────────────────────────────────────────────────── */

function builtinPackage(packageId = DEFAULT_PACKAGE_ID): AssessmentPackage {
  const pkg = FALLBACK_ASSESSMENT_PACKAGES[packageId]
  expect(pkg, `内置内容包 ${packageId} 必须存在`).toBeTruthy()
  return pkg
}

/** 装载内置内容包（可指定版本），走与 `load()` 相同的恢复路径。 */
function mountStore(packageId = DEFAULT_PACKAGE_ID) {
  const store = useQuizStore()
  store.activePackage = builtinPackage(packageId)
  store.responses = {}
  store.selfReflection = {}
  store.submittedAt = null
  // `load()` 在包已就绪时会跳过网络请求，但**仍会 restore()**；
  // 这里显式补上，才能让"旧版记录识别"等路径与真实装载一致。
  store.restore()
  return store
}

/**
 * 站点默认包已换成 IPIP-50；本文件里断言四字母/32 题/四维的用例显式指名 OEJTS 包。
 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

/**
 * 用 `@/dev/seed` 的 `ratingsForOffsets` 精确控制每维偏移，写入 store。
 * 每维题数由题库决定（OEJTS 8 题，|偏移| ≤ 16；IPIP 10 题，|偏移| ≤ 20）。
 */
function seedOffsets(
  store: ReturnType<typeof useQuizStore>,
  offsets: Partial<Record<Dimension, number>>,
) {
  const questions = store.activePackage!.questionnaire.questions
  const ratings = ratingsForOffsets(questions, offsets)
  for (const [id, value] of Object.entries(ratings)) {
    if (typeof value === 'number') store.selectRating(Number(id), value)
  }
  return ratings
}

/** 全中立：当前内容包每一维的偏移都是 0（OEJTS 四维 / IPIP 五维走同一条路径）。 */
function seedAllNeutral(store: ReturnType<typeof useQuizStore>) {
  const pkg = store.activePackage!
  const offsets: Partial<Record<Dimension, number>> = {}
  for (const dimension of packageDimensionOrder(pkg)) offsets[dimension] = 0
  const ratings = ratingsForOffsets(pkg.questionnaire.questions, offsets)
  for (const [id, value] of Object.entries(ratings)) store.selectRating(Number(id), value)
}

function seedAllUnknown(store: ReturnType<typeof useQuizStore>, reason: 'unclear' = 'unclear') {
  for (const question of store.activePackage!.questionnaire.questions) {
    store.selectUnknown(question.id, reason)
  }
}

/** 组装一份合法的 v3 会话对象（用于验证真实的 localStorage 恢复路径）。 */
function v3Session(options: {
  responses: ResponseMap
  submittedAt?: number | null
  currentQuestionId?: number
}): Record<string, unknown> {
  const pkg = builtinPackage()
  return {
    schemaVersion: 3,
    source: 'native_v3',
    sessionId: SESSION_ID,
    packageSnapshot: pkg,
    packageSignature: assessmentPackageSignature(pkg),
    responses: options.responses,
    currentQuestionId: options.currentQuestionId ?? pkg.questionnaire.questions[0].id,
    startedAt: STARTED_AT,
    updatedAt: STARTED_AT,
    submittedAt: options.submittedAt ?? null,
    selfReflection: {},
  }
}

/** 写入一份合法的 v2（旧版）会话 —— v3 只识别、不自动迁移。 */
function writeLegacyV2Session() {
  const pkg = builtinPackage()
  const answers: Record<number, number> = {}
  for (const question of pkg.questionnaire.questions) answers[question.id] = 3
  localStorage.setItem(
    'typeme.quiz.v2',
    JSON.stringify({
      schemaVersion: 2,
      questionnaire: pkg.questionnaire,
      questionnaireSignature: questionnaireSignature(pkg.questionnaire),
      answers,
      currentQuestionId: pkg.questionnaire.questions[0].id,
      startedAt: STARTED_AT,
      updatedAt: STARTED_AT,
      completedAt: null,
    }),
  )
  return answers
}

function lastResponseId(store: ReturnType<typeof useQuizStore>): number {
  const responses = store.responses
  const ids = Object.keys(responses).map(Number)
  expect(ids.length).toBeGreaterThan(0)
  return Math.max(...ids)
}

function submitAll(store: ReturnType<typeof useQuizStore>) {
  expect(store.submit(), '全部处理完之后必须可以提交').toBe(true)
}

/** 结果页「为什么这样描述」的某个维度：点击折叠标题并返回 DOM 文本。 */
async function openDimensionReview(
  wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'],
  heading: string,
): Promise<string> {
  const button = wrapper
    .find('#review')
    .findAll('button')
    .find((item) => item.text().includes(heading))
  expect(button, `「为什么这样描述」里必须有 ${heading} 的折叠按钮`).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
  return wrapper.find('#review').text()
}

function dimensionTextOf(
  wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'],
  dimension: Dimension,
): string {
  const node = wrapper.find(`article[data-dimension-text][data-dimension="${dimension}"]`)
  expect(node.exists(), `结果页必须渲染 ${dimension} 的维度说明`).toBe(true)
  return node.text()
}

function actionTextOf(
  wrapper: Awaited<ReturnType<typeof mountAt>>['wrapper'],
  dimension: Dimension,
): string {
  const nodes = wrapper.findAll('#actions li')
  // 维度名取**当前装载的内容包**（OEJTS 用 EI/SN/TF/JP，IPIP 用 E/A/C/ES/O）
  const name = useQuizStore().activePackage!.dimensionCopy[dimension].name
  const node = nodes.find((item) => item.text().includes(name))
  expect(node, `「可以尝试的做法」里必须有 ${dimension} 的条目`).toBeTruthy()
  return node!.text()
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  stubMatchMedia(false)
  stubCanvas2d()
})

/**
 * 有些用例挂到 `document.body` 上（焦点、真实浮层需要真实 DOM）。
 * 必须每个用例结束后卸载，否则前一个用例的浮层会留在文档里，
 * 让后一个用例的"浮层不存在"断言假通过/假失败。
 */
enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
  restoreCanvas()
  delete (navigator as { share?: unknown }).share
  delete (navigator as { canShare?: unknown }).canShare
  document.body.style.overflow = ''
})

describe('首页（产品方案 §3.1）', () => {
  it('首屏出现新主文案、说明与题数耗时', async () => {
    const { wrapper } = await mountAt('/', LandingView)
    const text = wrapper.text()
    expect(text).toContain('了解你的偏好，也保留还不确定的部分。')
    expect(text).toContain('「暂时无法判断」')

    // 首屏的量表口径来自**新测自己**（`GET /api/v3/catalog/current`），不是旧引擎的内容包。
    // jsdom 下 `fetch('/api/v3/...')` 因相对 URL 直接抛错 → 走 store 里的新测内置口径
    // （主测 48 题、题库 64 题、四个维度、8–12 分钟）。
    //
    // 这一条替换的是此前的旧断言（`${store.total} 道题` / `约 ${pkg.estimatedMinutes} 分钟` /
    // `免费 · 无需登录`）—— 它忠实钉住的正是本次要修的 bug：首屏写 IPIP-50 的题数与时长，
    // 主按钮却链到 48 题主测的十六型测评（浏览器验收报告问题 1）。
    expect(text).toContain('十六型人格参考测评 · 主测 48 题 · 约 8–12 分钟')
    expect(text).toContain('主测 48 组日常情境描述。')
    expect(text).toContain('主测 48 道题')
    expect(text).toContain('免费 · 需登录')
    expect(text).toContain('开始测评（主测 48 题）')
    // 题库总数必须与主测题数一起说清楚，不能只丢一个裸的「64 题」在按钮旁边
    expect(text).toContain('题库共 64 题 = 主测 48 题 + 最多 16 道补充题')
    // 旧引擎的 50 题口径不许出现在首屏（页面下方的旧版本入口另有明确标注）
    expect(text).not.toContain('50 道题')
  })

  it('不计分的教学例子四条齐全，且不再承诺"测出真实类型"', async () => {
    const { wrapper } = await mountAt('/', LandingView)
    const text = wrapper.text()
    expect(text).toContain('开始前，先说清楚怎么答')
    // 首页主推的是**双极作答**的十六型新测：每题一对相反描述、左边是 1、右边是 5。
    // 教学例子必须按这个格式讲。2026-09-16：此前这里断言的是旧站点默认包（IPIP-50 大五）的
    // 「一句自我描述：1 表示非常不贴切」—— 那正是"页面说的量表和实际入口不是同一份"这个缺陷。
    expect(text).toContain('两边都读完：左边是 1，右边是 5。')
    expect(text).toContain('3 表示理解之后觉得两侧差不多符合，不代表没看懂。')
    expect(text).toContain('不确定该怎么理解、两边都不适用，或没有相关经历，点「暂时无法判断」。')
    expect(text).toContain('实际约束下的行为不必然等于偏好；不要为了选一个“好性格”而选答案。')
    expect(text).not.toContain('每题是一句自我描述')
    expect(text).toContain('上面的说明不计分，也不会收集任何个人资料。')
    expect(text).not.toContain('保证测出')
  })

  // 2026-09-16：首页按产品要求移除了「旧版本测试」入口，连带「题目版本」单选
  // （`input[name="content-version"]`）、干净版本名（「大五人格 50 题」/「快速版 32 题」）与
  // 维护向说明一起从 LandingView.vue 删除，首页已无对应 DOM，故删除用例
  // 「首页的版本选择只列两版、用干净版本名，维护向元信息不进界面」。
  // 其中「首页不出现包 ID / 包标题 / 修订号」的意图仍然成立，但已没有可附着的选择器；
  // 而「不出现『审校』」一条与新署名（`data-instrument-attribution`：「内容仍在内部审校中」）
  // 正好相反，不能保留。旧引擎两版内容包本身未变，仍可由 /quiz、/result、/about 直接进入。

  it('结果示例卡明确标「示例」，并用 INFP 的原创描述名（不冒充用户已有结果）', async () => {
    mountStore(OEJTS_PACKAGE_ID)
    const { wrapper } = await mountAt('/', LandingView)
    const text = wrapper.text()
    expect(text).toContain('结果示例')
    expect(text).toContain('不是你的结果')
    expect(text).toContain('INFP')
    expect(text).toContain(FALLBACK_TYPE_PROFILES['INFP'].nameCn)
    // 示例卡本身必须说明"类型介绍属于参考阅读"
    expect(text).toContain('类型介绍属于参考阅读')
    // 示例卡的标题也必须写明"四维都达到展示条件时才有"
    expect(text).toContain('四维都达到展示条件时才有')
  })

  // 2026-09-16：首页移除「旧版本测试」入口后，草稿/已交卷的四个旧引擎按钮
  // （继续测试 / 重新开始 / 查看上次报告 / 重新测试）、「已有作答时版本选择被禁用」的说明，
  // 以及「重新开始」ConfirmDialog（默认焦点、取消后记录仍在、确认后替换本机记录）在首页
  // 都已不存在，故删除以下五条用例：
  //   - 已有作答时版本选择被禁用，并给出说明（不允许会话中途混版本）
  //   - 有草稿时主按钮是「继续测试 · 已处理 n/32」，次级是「重新开始」
  //   - 有完整记录时主按钮是「查看上次报告」，次级是「重新测试」
  //   - 重新开始必须先确认，默认焦点在「保留记录」，取消后记录仍在
  //   - 确认重新开始会替换本机 v3 记录
  // 旧引擎的作答、提交与重置行为本身未变，仍由本文件下方的 /quiz、/result 用例覆盖。

  it('「你会得到什么」三项标题与 FAQ 前三项都在首屏', async () => {
    const { wrapper } = await mountAt('/', LandingView)
    const text = wrapper.text()
    expect(text).toContain('你会得到什么')
    // 首页主推的十六型新测产出四字母类型码（四维都达到展示条件时才有），
    // 所以价值三项讲的是「四个维度的结果」，不是旧 IPIP 内容包的「五个维度」。
    // 2026-09-16：这里此前断言的是「五个维度各自的结果，而不是一个标签」。
    expect(text).toContain('四个维度的结果，而不是一个默认类型')
    expect(text).toContain('看得懂、答得出的过程')
    expect(text).toContain('被答案支持的内容')
    expect(text).toContain('常见问题')
    expect(text).toContain('看不懂题目怎么办？')
    expect(text).toContain('选「暂时无法判断」会怎样？')
    expect(text).toContain('结果会不会一直固定不变？')
    expect(text).not.toContain('五个维度')
    for (const word of ['最准', '权威', '官方测评结果']) {
      expect(text, `首页不该出现红线词「${word}」`).not.toContain(word)
    }
  })

  // 2026-09-16：首页的「来源与许可」改为描述**新测自己**（`data-instrument-attribution`），
  // 旧内容包的署名（OEJTS 1.2 / Eric Jorgenson / CC BY-NC-SA 4.0 / 非商业用途 / 未获得授权）
  // 已不在首页渲染，故删除用例「来源署名含 OEJTS / Eric Jorgenson / CC BY-NC-SA 4.0 / 未获得授权」。
  // 旧包署名本身未取消，仍由 /about 与公共壳覆盖（instrumentCopy.spec.ts 的 App.vue 用例）。

  it('后端不可用时依然渲染（首页走新测自己的内置口径，不装载旧内容包）', async () => {
    const { wrapper } = await mountAt('/', LandingView)
    // 2026-09-16：本用例此前断言首页的 `onMounted` 会 `quiz.load()`、旧引擎降级到内置副本
    // （`store.packageSource === 'fallback'` / `store.total === 50 题`）。首页现在只描述主推的
    // 新测，已不再装载旧内容包 —— 那两条断言钉住的正是被本次修复取消的接线。
    // 旧引擎自己的降级路径未变（`stores/quiz.spec.ts` 与 /quiz、/result 用例仍覆盖）。
    const store = useQuizStore()
    expect(store.activePackage, '首页不该再顺手装载旧引擎的内容包').toBeNull()
    // 目录接口也读不到时，首页用新测自己的内置口径（主测 48 / 题库 64）。
    expect(wrapper.text()).toContain('主测 48 道题')
    expect(wrapper.text()).toContain('题库共 64 题 = 主测 48 题 + 最多 16 道补充题')
  })

  // 2026-09-16：首页移除「这台设备上有更早保存的作答」恢复区与 `migrateLegacyV2` 之后，
  // 「旧 v2 记录给出显式入口、点击前不自动套用、点开后载入为派生会话」在首页已无 DOM 可测，
  // 故删除用例「这台设备上有更早保存的作答时给出显式入口，且点击前不自动套用」。
  // 「不自动套用」的用户说明与旧键保留仍由 /about 用例（下方「更早保存的作答只用人话说明」）
  // 覆盖，`migrateLegacyV2` 的迁移语义仍由 stores/quiz.spec.ts 直接覆盖。
})

describe('答题页（产品方案 §3.2 / §3.3）', () => {
  it('显示题号、进度与 5 个等权选项', async () => {
    mountStore(OEJTS_PACKAGE_ID)
    const { wrapper } = await mountAt('/quiz', QuizView)
    expect(wrapper.text()).toContain('第')
    expect(wrapper.text()).toContain('/ 32 题')
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(5)
    expect(wrapper.text()).toContain('哪一侧更接近平常的你？')
    expect(wrapper.text()).toContain('1 = 明显偏左 · 3 = 两边相近（也算作答，不代表没想好）· 5 = 明显偏右')
  })

  it('三档计数同时可见：已处理 / 已选择倾向 / 待判断 / 尚未处理', async () => {
    const store = mountStore()
    const questions = store.activePackage!.questionnaire.questions
    store.selectRating(questions[0].id, 3)
    store.selectUnknown(questions[1].id, 'unclear')
    const { wrapper } = await mountAt('/quiz', QuizView)
    expect(store.processedCount).toBe(2)
    expect(store.ratingCount).toBe(1)
    expect(store.unknownCount).toBe(1)
    expect(store.unansweredCount).toBe(store.total - 2)
    const counts = wrapper.find('aside').text().replace(/\s+/g, '')
    expect(counts).toContain(`已处理2/${store.total}`)
    expect(counts).toContain('已选择倾向1')
    expect(counts).toContain('待判断1')
    expect(counts).toContain(`尚未处理${store.total - 2}`)
    // 手机头部也有已处理计数
    expect(wrapper.text()).toContain(`已处理 2/${store.total}`)
  })

  it('帮助展开不改变答案或分数：未作答时展开后仍为空、已处理仍为 0', async () => {
    const store = mountStore()
    const questionId = store.activePackage!.questionnaire.questions[0].id
    const explanation = store.activePackage!.itemHelp[String(questionId)].explanation
    const { wrapper } = await mountAt('/quiz', QuizView)
    const help = wrapper.findAll('button').find((button) => button.text().includes('这题是什么意思？'))!
    expect(help.attributes('aria-expanded')).toBe('false')
    await help.trigger('click')
    await flushPromises()
    expect(help.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain(explanation)
    expect(store.responses).toEqual({})
    expect(store.processedCount).toBe(0)
    expect(store.report).not.toBeNull()
  })

  it('帮助展开/收起多次后，已选答案与报告指纹都不变', async () => {
    const store = mountStore()
    const questionId = store.activePackage!.questionnaire.questions[0].id
    const explanation = store.activePackage!.itemHelp[String(questionId)].explanation
    store.selectRating(questionId, 3)
    const { wrapper } = await mountAt('/quiz', QuizView)
    const reportId = store.report!.reportId
    const help = wrapper.findAll('button').find((button) => button.text().includes('这题是什么意思？'))!
    for (let index = 0; index < 3; index += 1) {
      await help.trigger('click')
      await flushPromises()
    }
    expect(help.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain(explanation)
    await help.trigger('click')
    await flushPromises()
    expect(help.attributes('aria-expanded')).toBe('false')
    expect(store.responses[questionId]).toEqual({ kind: 'rating', value: 3 })
    expect(store.report!.reportId).toBe(reportId)
    expect(store.processedCount).toBe(1)
  })

  it('「暂时无法判断」不是 3 分：该维变成信息不足、score 为 null，且可被数字答案替换', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    const questions = store.activePackage!.questionnaire.questions
    const eiIndex = questions.findIndex((question) => question.dimension === 'EI')
    const eiTarget = questions[eiIndex]
    const { wrapper } = await mountAt('/quiz', QuizView)
    store.goTo(eiIndex)
    await flushPromises()

    const unknownButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('暂时无法判断'))!
    await unknownButton.trigger('click')
    await flushPromises()

    expect(store.responses[eiTarget.id]).toMatchObject({ kind: 'unknown' })
    expect(store.unknownCount).toBe(1)
    expect(store.ratingCount).toBe(0)
    expect(store.processedCount).toBe(1)
    const ei = store.analysis!.dimensions.find((item) => item.dimension === 'EI')!
    expect(ei.status).toBe('insufficient')
    expect(ei.score).toBeNull()
    // 它没有被悄悄写成 3 分
    expect(store.responses[eiTarget.id]).not.toEqual({ kind: 'rating', value: 3 })

    // 再点一个数字：原子替换，两者不可能同时存在
    await wrapper.findAll('[role="radio"]')[2].trigger('click')
    await flushPromises()
    expect(store.responses[eiTarget.id]).toEqual({ kind: 'rating', value: 3 })
    expect(store.unknownCount).toBe(0)
    expect(store.ratingCount).toBe(1)
  })

  it('带原因的选择（select 下拉）能落库：选中的原因必须原样保留', async () => {
    const store = mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    // 选项顺序：0 不填 / 1 没理解题目 / 2 没有相关经历 / 3 两边都不适用 / 4 说不清
    const select = wrapper.find('select').element as HTMLSelectElement
    expect(Array.from(select.options).map((option) => option.textContent?.trim())).toEqual([
      '不填',
      '没理解题目',
      '没有相关经历',
      '两边都不适用',
      '说不清',
    ])
    select.value = Array.from(select.options).find(
      (option) => option.textContent?.trim() === '两边都不适用',
    )!.value
    select.dispatchEvent(new Event('change'))
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('暂时无法判断'))!
      .trigger('click')
    await flushPromises()
    expect(store.responses[lastResponseId(store)]).toEqual({
      kind: 'unknown',
      // ⚠️ 已知实现缺陷：QuizView 用 UNKNOWN_REASONS[unknownReasonId] 取值，
      // 而 select 的选项值是 index + 1，因此用户选「两边都不适用」（第 3 项）
      // 落库成 UNKNOWN_REASONS[3] === 'unsure'（整体错位一位）。
      // 这条断言保留「选中的原因必须原样保留」的验收要求，不放宽为 'unsure'。
      reason: 'not_applicable',
    })
    expect(wrapper.text()).toContain('原因只留在本机，用于你自己回顾。')
  })

  it('未处理就点「下一题」给可见提示且不前进', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const store = useQuizStore()
    await wrapper.findAll('button').find((button) => button.text() === '下一题')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('先选择一个位置，或标记「暂时无法判断」')
    expect(store.currentIndex).toBe(0)
  })

  it('最后一题未处理时点「查看报告」只出现复查区（含未处理题号），不导航', async () => {
    const store = mountStore()
    const questions = store.activePackage!.questionnaire.questions
    store.selectRating(questions[0].id, 3)
    const { wrapper, router } = await mountAt('/quiz', QuizView)
    // 当前内容包的最后一题（题数由包决定，不再写死 32）
    store.goTo(store.total - 1)
    await flushPromises()
    // 最后一题仍有未处理时，主操作是「还差 N 题」（不是「查看报告」）
    await wrapper
      .findAll('button')
      .find((button) => button.text() === `还差 ${store.total - 1} 题`)!
      .trigger('click')
    await flushPromises()

    const review = wrapper.find('#review-heading')
    expect(review.exists()).toBe(true)
    expect(review.text()).toContain('交卷前看一下')
    const text = wrapper.text()
    expect(text).toContain(`尚未处理 ${store.total - 1} 题`)
    expect(text).toContain('第 2、3、4')
    expect(text).toContain('这些题需要你选择数字或标记「暂时无法判断」，系统不会替你猜一个答案。')
    expect(router.currentRoute.value.name).toBe('quiz')
    expect(store.submittedAt).toBeNull()
  })

  it('全部处理但有「暂时无法判断」：给出复查文案，点了「按现有答案查看报告」才提交并跳转', async () => {
    const store = mountStore()
    seedAllUnknown(store)
    const { wrapper, router } = await mountAt('/quiz', QuizView)
    store.goTo(store.total - 1)
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看报告')!
      .trigger('click')
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain(`有 ${store.total} 题暂时无法判断，部分维度将暂不判型`)
    expect(text).toContain('待判断题：第 1、2、3')
    expect(router.currentRoute.value.name).toBe('quiz')
    expect(store.submittedAt).toBeNull()

    const back = wrapper
      .findAll('button')
      .filter((button) => button.text() === '回去看看' && !button.attributes('disabled'))
    expect(back.length).toBeGreaterThan(0)
    await back[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('#review-heading').exists()).toBe(false)
    // 「回去看看」只关闭复查区，不提交、不跳转
    expect(store.submittedAt).toBeNull()
    expect(router.currentRoute.value.name).toBe('quiz')

    // 再次点「查看报告」→ 复查区重新出现，点「按现有答案查看报告」才真正提交
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看报告')!
      .trigger('click')
    await flushPromises()
    const submit = wrapper
      .findAll('button')
      .find((button) => button.text() === '按现有答案查看报告')!
    expect(submit.attributes('disabled')).toBeUndefined()
    await submit.trigger('click')
    await flushPromises()
    expect(store.submittedAt).not.toBeNull()
    expect(router.currentRoute.value.name).toBe('result')
  })

  it('答题卡：题号 aria-label 区分「已选倾向 / 待判断 / 未处理」，点题号跳题不改答案', async () => {
    const store = mountStore()
    const questions = store.activePackage!.questionnaire.questions
    store.selectRating(questions[0].id, 1)
    store.selectUnknown(questions[2].id, 'unclear')
    const { wrapper } = await mountAt('/quiz', QuizView, true)

    await wrapper.findAll('button').find((button) => button.text() === '答题卡')!.trigger('click')
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"][aria-label="答题卡"]')
    expect(dialog).toBeTruthy()
    expect(dialog!.textContent).toContain(`已处理 2 / ${store.total}（待判断 1）`)
    const nums = dialog!.querySelectorAll('.qnum')
    expect(nums).toHaveLength(store.total)
    expect(nums[0].getAttribute('aria-label')).toContain('第 1 题')
    expect(nums[0].getAttribute('aria-label')).toContain('已选倾向')
    expect(nums[0].getAttribute('aria-label')).toContain('当前题')
    expect(nums[2].getAttribute('aria-label')).toContain('待判断')
    expect(nums[5].getAttribute('aria-label')).toContain('未处理')

    ;(nums[5] as HTMLButtonElement).click()
    await flushPromises()
    expect(store.currentIndex).toBe(5)
    expect(store.responses[questions[0].id]).toEqual({ kind: 'rating', value: 1 })
    expect(store.responses[questions[2].id]).toEqual({ kind: 'unknown', reason: 'unclear' })
    expect(store.responses[questions[5].id]).toBeUndefined()
    expect(document.querySelector('[role="dialog"][aria-label="答题卡"]')).toBeNull()
  })

  it('手机/PC 都必须手动点「下一题」才前进（没有自动跳题）', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const store = useQuizStore()
    await wrapper.findAll('[role="radio"]')[2].trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(store.currentIndex).toBe(0)

    await wrapper.findAll('button').find((button) => button.text() === '下一题')!.trigger('click')
    await flushPromises()
    expect(store.currentIndex).toBe(1)
    expect(store.currentQuestionId).toBe(2)
  })

  it('上一题保留原选择，题号与选中态跟着回来', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const store = useQuizStore()
    await wrapper.findAll('[role="radio"]')[1].trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '下一题')!.trigger('click')
    await flushPromises()
    expect(store.currentIndex).toBe(1)

    await wrapper.findAll('button').find((button) => button.text() === '上一题')!.trigger('click')
    await flushPromises()
    expect(store.currentIndex).toBe(0)
    expect(store.responses[store.currentQuestionId!]).toEqual({ kind: 'rating', value: 2 })
    expect(wrapper.findAll('[role="radio"]')[1].attributes('aria-checked')).toBe('true')
  })

  it('第 1 题不允许退到第 0 题', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const previous = wrapper.findAll('button').find((button) => button.text() === '上一题')!
    expect(previous.attributes('disabled')).toBeDefined()
  })

  it('进度条按已处理题数而不是当前题号计算', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const store = useQuizStore()
    await flushPromises()
    store.goTo(store.total - 1)
    await flushPromises()
    const bars = wrapper.findAll('[role="progressbar"]')
    expect(bars.length).toBeGreaterThan(0)
    expect(bars[0].attributes('aria-valuenow')).toBe('0')

    store.selectRating(store.activePackage!.questionnaire.questions[store.total - 1].id, 3)
    await flushPromises()
    // 只处理了 1 题：进度必须是 1/题数，而不是当前题号（按题号算会接近 100%）
    expect(wrapper.find('[role="progressbar"]').attributes('aria-valuenow')).toBe(
      String(Math.round(store.progressRatio * 100)),
    )
  })

  it('键盘：数字键选择后焦点回到组内选项', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView, true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }))
    await flushPromises()
    const store = useQuizStore()
    expect(store.responses[store.currentQuestionId!]).toEqual({ kind: 'rating', value: 3 })
    const radios = wrapper.findAll('[role="radio"]')
    expect(document.activeElement).toBe(radios[2].element)
    expect(radios[2].attributes('aria-checked')).toBe('true')
  })

  it('键盘：未作答时按 Enter 不静默、不跳题，并给出可见反馈', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const store = useQuizStore()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(wrapper.text()).toContain('先选择一个位置，或标记「暂时无法判断」')
    expect(store.currentIndex).toBe(0)
  })

  it('键盘：方向键在组内移动并选中，且**不会同时切换题目**', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView, true)
    const store = useQuizStore()
    const radios = wrapper.findAll('[role="radio"]')
    await radios[0].trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    expect(store.responses[store.currentQuestionId!]).toEqual({ kind: 'rating', value: 2 })
    expect(store.currentIndex).toBe(0)
    expect(wrapper.findAll('[role="radio"]')[1].attributes('aria-checked')).toBe('true')
  })

  it('radiogroup 使用 roving tabindex（Tab 进组只停一次）', async () => {
    mountStore()
    const { wrapper } = await mountAt('/quiz', QuizView)
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios.map((radio) => radio.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1'])
  })

  it('内容包装载失败时给出错误态与重试入口（不白屏）', async () => {
    setActivePinia(createPinia())
    const store = useQuizStore()
    store.activePackage = null
    const { wrapper } = await mountAt('/quiz', QuizView)
    // 组件挂载时会 load()：jsdom 下接口必然失败，但同 ID 内置副本可用
    expect(store.activePackage, '内置副本必须能装载，否则这条用例失去意义').not.toBeNull()
    expect(wrapper.text()).not.toContain('题目没有准备好')

    // 真正的错误态：接口与内置副本都不可用
    store.activePackage = null
    store.loading = false
    store.loadError = '接口与内置副本都不可用'
    await flushPromises()
    expect(wrapper.text()).toContain('题目没有准备好')
    expect(wrapper.text()).toContain('接口与内置副本都不可用')
    expect(wrapper.findAll('button').map((button) => button.text()).join('|')).toContain('重试')
  })
})

describe('结果页（产品方案 §4.2 / §5 / §8）', () => {
  /** 全中立：当前包每一维都 balanced → 没有任何默认类型。 */
  async function mountNeutral(packageId = DEFAULT_PACKAGE_ID) {
    const store = mountStore(packageId)
    seedAllNeutral(store)
    submitAll(store)
    return { store, ...(await mountAt('/result', ResultView)) }
  }

  it('全中立：store 层四维都是 balanced，且根本没有默认类型', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedAllNeutral(store)
    submitAll(store)
    const analysis = store.analysis!
    expect(analysis.dimensions.map((item) => item.status)).toEqual([
      'balanced',
      'balanced',
      'balanced',
      'balanced',
    ])
    for (const dimension of analysis.dimensions) {
      expect(dimension.score).toBe(24)
      expect(dimension.pole).toBeNull()
    }
    expect(analysis.overallStatus).toBe('undetermined')
    expect(analysis.suggestedTypeCode).toBeNull()
    expect(store.report!.suggestedTypeCode).toBeNull()
  })

  it('全中立：页面/分享文字/文件名/无障碍名称四条渠道都不出现任何类型码或类型描述名', async () => {
    const { store, wrapper } = await mountNeutral(OEJTS_PACKAGE_ID)
    const report = store.report!
    expect(report.suggestedTypeCode).toBeNull()
    expect(report.share.kind).toBe('undetermined')
    expect(report.share.headline).toBeNull()
    expect(report.share.typeLine).toBeNull()

    // ① 页面正文
    const pageText = wrapper.text()
    for (const code of ALL_TYPE_CODES) {
      expect(pageText, `页面出现了默认类型码 ${code}`).not.toContain(code)
    }
    for (const name of ALL_TYPE_NAMES) {
      expect(pageText, `页面出现了类型描述名 ${name}`).not.toContain(name)
    }
    expect(pageText).toContain(report.title)
    expect(report.title).toBe(builtinPackage(OEJTS_PACKAGE_ID).reportCopy.undeterminedTitle)

    // ② ③ ④ 导出渠道（复制文字 / 文件名 / 图片无障碍名称）
    for (const code of ALL_TYPE_CODES) {
      expect(report.share.text, `复制文字出现了 ${code}`).not.toContain(code)
      expect(report.share.filename, `文件名出现了 ${code}`).not.toContain(code)
      expect(report.share.alt, `图片 alt 出现了 ${code}`).not.toContain(code)
    }
    for (const name of ALL_TYPE_NAMES) {
      expect(report.share.text).not.toContain(name)
      expect(report.share.alt).not.toContain(name)
    }
    expect(report.share.filename).toBe('typeme-profile-undetermined.png')
    expect(report.share.text).toContain('没有形成完整参考类型')
    expect(wrapper.find('[data-share-text]').text()).toContain(report.share.text)
    expect(pageText).toContain(report.share.filename)
  })

  it('全中立：没有参考组合时不出现「可选参考阅读」与类型介绍按钮', async () => {
    const { wrapper } = await mountNeutral(OEJTS_PACKAGE_ID)
    expect(wrapper.text()).not.toContain('可选参考阅读')
    expect(wrapper.find('#reference').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('类型介绍（参考资料）')
  })

  it('全中立（有参考组合的完整答卷）：四维 leaning 才给出 INFP，且提供参考阅读入口', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedOffsets(store, { EI: -12, SN: 8, TF: -8, JP: 10 })
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)
    expect(store.analysis!.overallStatus).toBe('typed')
    expect(store.report!.suggestedTypeCode).toBe('INFP')
    expect(wrapper.text()).toContain('INFP')
    expect(wrapper.text()).toContain('本次问卷参考组合')
    expect(wrapper.find('#reference').exists()).toBe(true)
    expect(wrapper.text()).toContain('阅读 INFP 类型介绍（参考资料）')
    // 参考阅读入口在被点击前不出现用户主动打开的文章
    expect(wrapper.find('[data-type-reference]').exists()).toBe(false)
  })

  it('部分未定：tentative 维度写「继续观察」，leaning 维度给出偏向，未定维度不出现主导字母', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedOffsets(store, { EI: -12, SN: 4, TF: -8, JP: 10 })
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)
    const analysis = store.analysis!
    expect(analysis.dimensions.map((item) => item.status)).toEqual([
      'leaning',
      'tentative',
      'leaning',
      'leaning',
    ])
    expect(analysis.suggestedTypeCode).toBeNull()
    expect(store.report!.suggestedTypeCode).toBeNull()
    expect(store.report!.title).toBe(builtinPackage(OEJTS_PACKAGE_ID).reportCopy.partialTitle)

    const sn = wrapper.find('article[data-dimension-text][data-dimension="SN"]')
    expect(sn.exists()).toBe(true)
    expect(sn.attributes('data-status')).toBe('tentative')
    // 状态名（含「建议继续观察」）由维度倾向条输出，释义由维度说明输出 —— 两者都在
    // 「四个维度上的结果」这一段里
    const dimensions = wrapper.find('#dimensions').text()
    expect(dimensions).toContain('建议继续观察')
    expect(dimensions).toContain('本次略偏某侧，建议继续观察')
    expect(dimensions).toContain('略偏直觉 N')
    const snDetails = sn.findAll('p').map((item) => item.text()).join('\n')
    expect(snDetails).toContain('不写进完整类型')
    expect(snDetails).toContain('继续观察')
    expect(snDetails).toContain('另一侧「实感 S」')

    const ei = wrapper.find('article[data-dimension-text][data-dimension="EI"]')
    expect(ei.attributes('data-status')).toBe('leaning')
    expect(ei.text()).toContain('内向 I')
    expect(ei.text()).toContain('达到本产品的展示条件')
    // leaning 维度只给偏向与展示条件，不带"继续观察"的保留
    expect(ei.findAll('p').map((item) => item.text()).join('\n')).not.toContain('继续观察')

    // 四维状态速览：未定维度不显示字母，只显示状态标记
    const summary = wrapper.find('[data-dimension-summary]')
    expect(summary.exists()).toBe(true)
    const items = summary.findAll('li')
    expect(items).toHaveLength(4)
    expect(items[1].text()).toContain('未定')
    expect(items[1].text()).toContain('待观察')
    expect(items[1].text()).not.toMatch(/\bN\b/)
    expect(items[0].text()).toContain('I')
    // 页面里没有完整四字母
    for (const code of ALL_TYPE_CODES) {
      expect(wrapper.text(), `部分未定报告里出现了 ${code}`).not.toContain(code)
    }
  })

  it('全部无法判断：正常渲染未定/信息不足报告，没有任何伪造分数，维度条不画数值点', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedAllUnknown(store)
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)

    const analysis = store.analysis!
    expect(analysis.dimensions.map((item) => item.status)).toEqual([
      'insufficient',
      'insufficient',
      'insufficient',
      'insufficient',
    ])
    for (const dimension of analysis.dimensions) {
      expect(dimension.score).toBeNull()
      expect(dimension.pole).toBeNull()
    }
    expect(analysis.suggestedTypeCode).toBeNull()
    expect(store.report!.share.kind).toBe('undetermined')
    expect(store.report!.share.filename).toBe('typeme-profile-undetermined.png')

    const text = wrapper.text()
    expect(text).toContain(builtinPackage(OEJTS_PACKAGE_ID).reportCopy.insufficientTitle)
    for (const row of store.report!.dimensionRows) {
      expect(row.position, `${row.dimension} 信息不足时不能有位置点`).toBeNull()
      expect(row.score).toBeNull()
    }
    expect(text).toContain('本次未计算分数')
    expect(text).toContain('未计分')
    expect(text).not.toContain('得分 0')
    expect(text).not.toContain('0 分')
    expect(text).not.toContain('0%')
    expect(text).not.toContain('24 分')
    for (const code of ALL_TYPE_CODES) {
      expect(text, `全部无法判断时出现了 ${code}`).not.toContain(code)
    }
  })

  it('部分维度信息不足：SN 记信息不足、其余三维持续给出方向', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    store.responses = {}
    seedAllUnknown(store, 'unclear')
    const questions = store.activePackage!.questionnaire.questions
    // 每维偏移都要显式给出（seed 只会为给出的维度生成评分）
    const ratings = ratingsForOffsets(questions, { EI: -10, SN: 4, TF: 10, JP: 10 })
    let snRatings = 0
    for (const question of questions) {
      if (question.dimension === 'SN') {
        if (snRatings < 3) {
          store.selectRating(question.id, ratings[question.id])
          snRatings += 1
        }
        continue
      }
      store.selectRating(question.id, ratings[question.id])
    }
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)

    const analysis = store.analysis!
    expect(analysis.dimensions.map((item) => item.status)).toEqual([
      'leaning',
      'insufficient',
      'leaning',
      'leaning',
    ])
    expect(analysis.suggestedTypeCode).toBeNull()
    const sn = analysis.dimensions.find((item) => item.dimension === 'SN')!
    expect(sn.score).toBeNull()
    expect(sn.ratingCount).toBe(3)
    expect('unknownIds' in sn && sn.unknownIds.length).toBe(5)

    expect(store.report!.title).toBe(builtinPackage(OEJTS_PACKAGE_ID).reportCopy.partialTitle)
    expect(store.report!.subtitle).toBe(builtinPackage(OEJTS_PACKAGE_ID).reportCopy.partialSubtitle)
    expect(store.report!.share.kind).toBe('partial')
    expect(store.report!.share.filename).toBe('typeme-profile-partial.png')
    const dimensions = wrapper.find('#dimensions').text()
    expect(dimensions).toContain('信息不足')
    expect(dimensions).toContain('未计分')
    expect(dimensions).toContain('本次未计算分数')
    const snText = dimensionTextOf(wrapper, 'SN')
    expect(snText).toContain('本次不计算这一维的分数，也不判定方向')
    expect(snText).toContain('可计分的数字答案 3 题')
    expect(snText).toContain('标记“暂时无法判断” 5 题')
    const ei = wrapper.find('article[data-dimension-text][data-dimension="EI"]')
    expect(ei.attributes('data-status')).toBe('leaning')
    for (const code of ALL_TYPE_CODES) {
      expect(wrapper.text(), `部分信息不足时出现了 ${code}`).not.toContain(code)
    }
  })

  it('边界改答：只改一道 SN 题就撤销完整类型，且 EI / TF / JP 的说明与建议逐条不变', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedOffsets(store, { EI: -12, SN: 8, TF: -8, JP: 10 })
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)
    expect(store.report!.suggestedTypeCode).toBe('INFP')
    expect(wrapper.text()).toContain('INFP')

    // 记下另外三维的「维度说明」与「可以尝试的做法」原文
    const untouched: Dimension[] = ['EI', 'TF', 'JP']
    const beforeDetails = Object.fromEntries(
      untouched.map((dimension) => [dimension, dimensionTextOf(wrapper, dimension)]),
    ) as Record<Dimension, string>
    const beforeActions = Object.fromEntries(
      untouched.map((dimension) => [dimension, actionTextOf(wrapper, dimension)]),
    ) as Record<Dimension, string>
    const beforeRows = Object.fromEntries(
      untouched.map((dimension) => [
        dimension,
        {
          status: store.report!.dimensionRows.find((row) => row.dimension === dimension)!.status,
          details: [
            ...store.report!.dimensionRows.find((row) => row.dimension === dimension)!.details,
          ],
          actions: [
            ...store.report!.dimensionRows.find((row) => row.dimension === dimension)!.actions,
          ],
        },
      ]),
    ) as Record<Dimension, { status: string; details: string[]; actions: string[] }>

    // 只改一道 SN 题：让 SN 的偏移从 8 降到 4（距中点 4 分 → 待观察）。
    // seed 在偏移 8 时给前 4 道 SN 题 +2，因此把其中一道改成 −2（差 4 分）
    // 正好让偏移落到 4；这就是"一道题跨过展示门槛"的最小改动。
    const questions = store.activePackage!.questionnaire.questions
    const snFull = ratingsForOffsets(questions, { SN: 8 })
    const snTarget = questions.find(
      (question) => question.dimension === 'SN' && snFull[question.id] === 5,
    )!
    expect(snTarget, '必须能框出一道 SN 的 +2 题').toBeTruthy()
    const beforeOffset = store.analysis!.dimensions.find(
      (item) => item.dimension === 'SN',
    )!.signedOffset
    expect(beforeOffset).toBe(8)
    store.selectRating(snTarget.id, 1)
    await flushPromises()
    expect(store.responses[snTarget.id]).toEqual({ kind: 'rating', value: 1 })
    const afterOffset = store.analysis!.dimensions.find(
      (item) => item.dimension === 'SN',
    )!.signedOffset
    expect(afterOffset, '只改一道 SN 题应把偏移从 8 降到 4').toBe((beforeOffset ?? 0) - 4)
    expect(afterOffset).toBe(4)

    expect(store.analysis!.suggestedTypeCode).toBeNull()
    expect(store.report!.suggestedTypeCode).toBeNull()
    expect(store.analysis!.dimensions.find((item) => item.dimension === 'SN')!.status).toBe('tentative')
    expect(store.analysis!.dimensions.find((item) => item.dimension === 'SN')!.signedOffset).toBe(4)

    // 另外三维：模型层逐条不变
    for (const dimension of untouched) {
      const row = store.report!.dimensionRows.find((item) => item.dimension === dimension)!
      expect(row.status).toBe(beforeRows[dimension].status)
      expect(row.details).toEqual(beforeRows[dimension].details)
      expect(row.actions).toEqual(beforeRows[dimension].actions)
    }
    // 页面层逐条不变
    for (const dimension of untouched) {
      expect(dimensionTextOf(wrapper, dimension)).toBe(beforeDetails[dimension])
      expect(actionTextOf(wrapper, dimension)).toBe(beforeActions[dimension])
    }
    // SN 变成待观察，完整类型被撤销，页面不再出现 INFP
    expect(wrapper.find('article[data-dimension-text][data-dimension="SN"]').attributes('data-status')).toBe(
      'tentative',
    )
    expect(wrapper.text()).toContain('建议继续观察')
    expect(wrapper.text()).not.toContain('INFP')
    expect(wrapper.find('#reference').exists()).toBe(false)
  })

  it('「为什么这样描述」默认折叠：展开后能看题面、你的选择与释义，再点收起', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedAllNeutral(store)
    const questions = store.activePackage!.questionnaire.questions
    // 两题：一题「暂时无法判断」，一题数字答案 —— 两种状态都要能回看
    store.selectUnknown(questions[0].id, 'unclear')
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)

    const review = wrapper.find('#review')
    expect(review.exists()).toBe(true)
    expect(review.text()).toContain('为什么这样描述')
    const firstToggle = review.findAll('button')[0]
    expect(firstToggle.attributes('aria-expanded')).toBe('false')
    expect(review.findAll('ul')).toHaveLength(0)

    const expanded = await openDimensionReview(
      wrapper,
      builtinPackage(OEJTS_PACKAGE_ID).dimensionCopy.JP.name,
    )
    expect(expanded).toContain(questions[0].textLeft)
    expect(expanded).toContain(questions[0].textRight)
    expect(expanded).toContain('你的选择：暂时无法判断')
    expect(expanded).toContain('释义：')
    expect(expanded).toContain(
      store.activePackage!.itemHelp[String(questions[0].id)].explanation,
    )
    expect(expanded).toContain('你的选择：3')

    const toggle = wrapper
      .find('#review')
      .findAll('button')
      .find((item) => item.text().includes(builtinPackage(OEJTS_PACKAGE_ID).dimensionCopy.JP.name))!
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('#review').findAll('ul')).toHaveLength(0)
  })

  it('自我观察：改自我理解不改变 responses 与 reportId，「暂不确定」为 null，可清除', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedOffsets(store, { EI: -12, SN: 4, TF: -8, JP: 10 })
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)

    const responsesBefore = JSON.parse(JSON.stringify(store.responses))
    const reportIdBefore = store.report!.reportId

    // 待观察维度里必须有自我观察按钮；leaning 维度没有
    const snCard = wrapper
      .findAll('#self article')
      .find((item) => item.text().includes(builtinPackage(OEJTS_PACKAGE_ID).dimensionCopy.SN.name))!
    expect(snCard).toBeTruthy()
    const buttons = snCard.findAll('button')
    const negative: Pole = 'S'
    const positive: Pole = 'N'
    await buttons.find((button) => button.text() === '更偏 实感')!.trigger('click')
    await flushPromises()
    expect(store.selfReflection.SN?.preference).toBe(negative)
    expect(store.selfReflection.SN?.updatedAt).toBeGreaterThan(0)
    expect(store.responses).toEqual(responsesBefore)
    expect(store.report!.reportId).toBe(reportIdBefore)
    expect(wrapper.text()).toContain('已记录你的自我观察')

    await buttons.find((button) => button.text() === '更偏 直觉')!.trigger('click')
    await flushPromises()
    expect(store.selfReflection.SN?.preference).toBe(positive)
    expect(store.responses).toEqual(responsesBefore)
    expect(store.report!.reportId).toBe(reportIdBefore)

    await buttons.find((button) => button.text() === '暂不确定')!.trigger('click')
    await flushPromises()
    expect(store.selfReflection.SN?.preference).toBeNull()
    expect(store.responses).toEqual(responsesBefore)
    expect(store.report!.reportId).toBe(reportIdBefore)

    const clear = wrapper
      .findAll('button')
      .find((button) => button.text() === '清除自我观察记录')!
    await clear.trigger('click')
    await flushPromises()
    expect(store.selfReflection).toEqual({})
    expect(store.responses).toEqual(responsesBefore)
  })

  it('没有付费墙、没有人群百分位、没有判决句', async () => {
    const { wrapper } = await mountNeutral()
    const text = wrapper.text()
    for (const word of BANNED_IN_RESULT) {
      expect(text, `结果页出现了付费相关字样「${word}」`).not.toContain(word)
    }
    const buttonTexts = wrapper.findAll('button').map((button) => button.text())
    expect(buttonTexts.length).toBeGreaterThan(0)
    for (const label of buttonTexts) {
      expect(label, `出现了付费导向的按钮「${label}」`).not.toMatch(
        /付费|解锁|升级|会员|购买|订阅|支付|打赏/,
      )
    }
    expect(text).not.toMatch(/\d+(\.\d+)?\s*%\s*的?人/)
    expect(text).not.toMatch(/你比\s*\d/)
    expect(text).not.toMatch(/你就是.{0,12}的人/)
    expect(text).not.toContain('注定')
    expect(text).not.toContain('最准')
    expect(text).not.toContain('不代表人群中的位置或占比')
  })

  it('CR-1：越界作答必须渲染错误态且不发生 replace（当前实现把越界值当成未处理 → 弹回答题页）', async () => {
    const store = mountStore()
    seedAllNeutral(store)
    submitAll(store)
    // 把一道题写成越界值：这属于"作答被写坏"，应原地渲染错误态
    store.responses = {
      ...store.responses,
      3: { kind: 'rating', value: 9 },
    } as unknown as ResponseMap
    const { wrapper, router } = await mountAt('/result', ResultView)

    // ⚠️ 已知实现缺陷：`domain/answers.ts` 的 `responseState()` 只看 `kind`，
    // 而 `ratingOf()` 会把越界值判成 null。两者口径不一致导致
    //   processedCount / isProcessed 把这题算成「已处理」，
    //   `analyzeDimension` 却把它算成「尚未处理」→ 该维 ratingCount 少 1 → 信息不足，
    //   结果 ResultView 判定为 incomplete 并 `replace('/quiz')`。
    // 下面的断言保留 CR-1 的验收要求（错误态 + 不 replace），不改成"接受弹回"。
    expect(router.currentRoute.value.name).toBe('result')
    expect(wrapper.text()).toContain('这次没能生成报告')
    expect(wrapper.text()).toContain('清空本地进度并重新测试')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.find('#conclusion').exists()).toBe(false)
  })

  it('CR-1：坏 constants 渲染错误态，不 replace', async () => {
    setActivePinia(createPinia())
    const store = useQuizStore()
    const broken: AssessmentPackage = {
      ...builtinPackage(),
      questionnaire: {
        ...builtinPackage().questionnaire,
        scoring: { midpoint: 24, constants: {} as never },
      },
    }
    store.activePackage = broken
    seedAllNeutral(store)
    submitAll(store)
    expect(store.analysisError, '坏 constants 必须让分析失败').not.toBeNull()
    const { wrapper, router } = await mountAt('/result', ResultView)
    expect(router.currentRoute.value.name).toBe('result')
    expect(wrapper.text()).toContain('这次没能生成报告')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('未处理完时访问 /result 会 replace 回 /quiz', async () => {
    const store = mountStore()
    store.selectRating(store.activePackage!.questionnaire.questions[0].id, 3)
    const { router } = await mountAt('/result', ResultView)
    expect(router.currentRoute.value.name).toBe('quiz')
    expect(store.submittedAt).toBeNull()
  })

  it('从合法的 v3 本地会话恢复后：报告按该快照生成，未定结果同样不带默认类型', async () => {
    const pkg = builtinPackage()
    const responses: ResponseMap = {}
    for (const question of pkg.questionnaire.questions) {
      responses[question.id] = { kind: 'rating', value: 3 }
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(v3Session({ responses, submittedAt: STARTED_AT + 1 })),
    )
    const store = useQuizStore()
    expect(store.restore()).toBe(true)
    expect(store.resumed).toBe(true)
    expect(store.processedCount).toBe(pkg.questionnaire.questionCount)
    const { wrapper } = await mountAt('/result', ResultView)
    expect(store.report!.suggestedTypeCode).toBeNull()
    expect(wrapper.text()).not.toContain('ISFJ')
    expect(wrapper.text()).toContain(pkg.reportCopy.undeterminedTitle)
  })
})

describe('分享（产品方案 §5.1 第 7 条 / 开发方案 §7.4）', () => {
  async function mountShare(options: { neutral?: boolean; packageId?: string } = {}) {
    const store = mountStore(options.packageId ?? DEFAULT_PACKAGE_ID)
    if (options.neutral === false) {
      seedOffsets(store, { EI: -12, SN: 8, TF: -8, JP: 10 })
    } else {
      seedAllNeutral(store)
    }
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView, true)
    const button = wrapper.findAll('button').find((item) => item.text().includes('生成分享卡片'))
    expect(button, '结果页必须有生成分享卡片按钮').toBeTruthy()
    return { store, wrapper, button: button! }
  }

  it('点生成后打开预览：img[alt] 等于 report.share.alt，文件名也一致，且有复制结果文字按钮', async () => {
    const { store, wrapper, button } = await mountShare({ packageId: OEJTS_PACKAGE_ID })
    expect(wrapper.findAll('button').some((item) => item.text() === '复制结果文字')).toBe(true)

    await button.trigger('click')
    await flushPromises()
    const dialog = document.querySelector('[role="dialog"][aria-label="分享卡片预览"]')
    expect(dialog).toBeTruthy()
    const image = dialog!.querySelector('img') as HTMLImageElement
    expect(image.src.startsWith('data:image/png')).toBe(true)
    expect(image.alt).toBe(store.report!.share.alt)
    expect(image.alt).toContain('没有形成完整参考类型')
    expect(dialog!.textContent).toContain(store.report!.share.filename)
    expect(store.report!.share.filename).toBe('typeme-profile-undetermined.png')
    const labels = Array.from(dialog!.querySelectorAll('button')).map((item) =>
      item.textContent?.trim(),
    )
    expect(labels).toContain('下载图片')
    expect(labels).toContain('复制文字')
  })

  it('typed 报告：预览 alt / 文件名 / 复制文字都指向同一个参考组合，且不含未定措辞', async () => {
    const { store, button } = await mountShare({ neutral: false, packageId: OEJTS_PACKAGE_ID })
    expect(store.report!.suggestedTypeCode).toBe('INFP')
    expect(store.report!.share.filename).toBe('typeme-profile-INFP.png')
    await button.trigger('click')
    await flushPromises()
    const image = document.querySelector(
      '[role="dialog"][aria-label="分享卡片预览"] img',
    ) as HTMLImageElement
    expect(image.alt).toBe(store.report!.share.alt)
    expect(image.alt).toContain('INFP')
  })

  it('下载后提示「已发起下载」，不说「已保存到相册」', async () => {
    const links: HTMLAnchorElement[] = []
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = originalCreate(tag)
      if (tag === 'a') links.push(element as HTMLAnchorElement)
      return element
    })
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:stub'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })

    const { store, button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    const download = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '下载图片',
    ) as HTMLButtonElement
    download.click()
    await flushPromises()

    const status = document.querySelector('[role="dialog"] [role="status"]')!
    expect(status.textContent).toContain('已发起下载')
    expect(status.textContent).not.toContain('已保存到相册')
    expect(status.textContent).not.toContain('相册')
    expect(links.some((link) => link.download === store.report!.share.filename)).toBe(true)
  })

  it('系统分享成功只说「已交给系统分享」', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { configurable: true, value: share })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    const { button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    const systemShare = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '系统分享',
    ) as HTMLButtonElement
    expect(systemShare).toBeTruthy()
    systemShare.click()
    await flushPromises()

    expect(share).toHaveBeenCalledTimes(1)
    const status = document.querySelector('[role="dialog"] [role="status"]')!
    expect(status.textContent).toContain('已交给系统分享')
    expect(status.textContent).not.toContain('相册')
  })

  it('用户取消系统分享是中性结果，不报错误', async () => {
    const abort = new DOMException('cancelled', 'AbortError')
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn().mockRejectedValue(abort),
    })
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    const { button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    const systemShare = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '系统分享',
    ) as HTMLButtonElement
    systemShare.click()
    await flushPromises()
    const status = document.querySelector('[role="dialog"] [role="status"]')!
    expect(status.textContent).toContain('已取消分享')
    expect(status.textContent).not.toContain('失败')
  })

  it('canvas 不可用时给出可复制文字的失败反馈，报告仍在', async () => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      writable: true,
      value: () => null,
    })
    const { wrapper, button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('生成分享卡片没有成功')
    expect(wrapper.text()).toContain('复制结果文字')
    expect(document.querySelector('[role="dialog"][aria-label="分享卡片预览"]')).toBeNull()
    // 报告本体仍在（标题按当前包写「五个维度上的结果」，不再写死四维）
    expect(wrapper.text()).toContain('五个维度上的结果')
  })

  it('Blob 为空也按失败处理，不给用户一张空图', async () => {
    stubCanvas2d({ toBlob: null, dataUrl: 'data:image/png;base64,' })
    const { wrapper, button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('生成分享卡片没有成功')
    expect(document.querySelector('[role="dialog"][aria-label="分享卡片预览"]')).toBeNull()
  })

  it('剪贴板被拒绝时给出可手动复制的纯文本（内容等于 share.text）', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })
    const { store, button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    const copy = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '复制文字',
    ) as HTMLButtonElement
    copy.click()
    await flushPromises()

    const status = document.querySelector('[role="dialog"] [role="status"]')!
    expect(status.textContent).toContain('不允许自动复制')
    const textarea = document.querySelector(
      '[role="dialog"] textarea',
    ) as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    expect(textarea.value).toBe(store.report!.share.text)
    expect(textarea.value).toContain('我在 TypeMe 的本次回答')
  })

  it('结果页的「复制结果文字」在剪贴板不可用时给出可手动复制的失败反馈', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    })
    const store = mountStore()
    seedAllNeutral(store)
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)
    const copy = wrapper.findAll('button').find((item) => item.text() === '复制结果文字')!
    await copy.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('复制没有成功')
    expect(wrapper.find('[data-share-text]').text()).toContain(store.report!.share.text)
  })

  it('关闭预览会释放产物（再做一次分享需要重新生成）', async () => {
    const { button } = await mountShare()
    await button.trigger('click')
    await flushPromises()
    const close = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '关闭',
    ) as HTMLButtonElement
    close.click()
    await flushPromises()
    expect(document.querySelector('[role="dialog"][aria-label="分享卡片预览"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })
})

describe('关于页（产品方案 §3 / §8）', () => {
  it('包含四个必需部分', async () => {
    const { wrapper } = await mountAt('/about', AboutView)
    const text = wrapper.text()
    expect(text).toContain('如何作答')
    expect(text).toContain('如何理解结果')
    expect(text).toContain('来源与限制')
    expect(text).toContain('本地记录')
  })

  it('使用统一的隐私表达，不写「不存储任何数据」', async () => {
    const { wrapper } = await mountAt('/about', AboutView)
    const text = wrapper.text()
    expect(text).toContain(
      '题目答案与计分在你的浏览器中处理。为了让你能接着上次继续，这台设备会保留最近一次作答，',
    )
    expect(text).toContain('你可以随时清除。')
    expect(text).not.toContain('不存储任何数据')
  })

  it('本地记录部分说明「保存了什么」，但不写本地键名（部署版不暴露实现细节）', async () => {
    // 「32 题快照 / 32 个选择」是 32 题量表（OEJTS）的记录说明，显式指名该包；
    // 关于页的题数跟着当前内容包走（默认的 IPIP-50 是 50 题）。
    mountStore(OEJTS_PACKAGE_ID)
    const { wrapper } = await mountAt('/about', AboutView)
    const text = wrapper.text()
    expect(text).toContain('保存了什么')
    // 模板里这句跨行渲染，段落文字之间会有一个空白；按两段分别断言，
    // 不把模板换行产生的空白当成文案差异。
    expect(text).toContain('这次用到的 32 道题、你的 32 个选择、当前答到哪一题，')
    expect(text).toContain('以及开始与更新时间。')
    for (const key of ['typeme.quiz.v3', 'typeme.package.v1', 'localStorage', '快照']) {
      expect(text, `关于页不该出现本地键名/存储实现「${key}」`).not.toContain(key)
    }
  })

  it('PRIV-02：清除本地记录要确认，且只删本应用的三个键', async () => {
    const store = mountStore()
    store.selectRating(store.activePackage!.questionnaire.questions[0].id, 3)
    writeLegacyV2Session()
    localStorage.setItem(
      'typeme.quiz.v1',
      JSON.stringify({
        version: 'quick',
        answers: { 1: 3 },
        currentIndex: 0,
        startedAt: 1,
        updatedAt: 1,
      }),
    )
    localStorage.setItem('other-app-key', 'keep-me')
    const { wrapper } = await mountAt('/about', AboutView, true)

    const clearButton = wrapper.findAll('button').find((button) => button.text() === '清除本地记录')!
    expect(clearButton.attributes('disabled')).toBeUndefined()
    await clearButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('清除本地记录会删掉这台设备上保存的本次作答，是否继续？')
    const confirm = Array.from(document.querySelectorAll('[role="dialog"] button')).find(
      (item) => item.textContent?.trim() === '清除记录',
    ) as HTMLButtonElement
    confirm.click()
    await flushPromises()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('typeme.quiz.v2')).toBeNull()
    expect(localStorage.getItem('typeme.quiz.v1')).toBeNull()
    expect(localStorage.getItem('other-app-key')).toBe('keep-me')
    expect(wrapper.text()).toContain('已清除本站在这台设备上保存的记录')
  })

  it('更早保存的作答只用人话说明：不会自动套用，且不出现 v1/v2/派生会话等术语', async () => {
    writeLegacyV2Session()
    localStorage.setItem(
      'typeme.quiz.v1',
      JSON.stringify({
        version: 'quick',
        answers: { 1: 3, 2: 5 },
        currentIndex: 0,
        startedAt: 1,
        updatedAt: 1,
      }),
    )
    const { wrapper } = await mountAt('/about', AboutView)
    const text = wrapper.text()
    // 部署版只说人话：不说 v1/v2、不说「派生会话」，但要如实说明「不会自动套用」
    expect(text).toContain('更早保存的作答')
    expect(text).toContain(`一份 ${builtinPackage().questionnaire.questionCount} 题的作答`)
    expect(text).toContain('一份更早的作答（2 题）')
    expect(text).toContain('不会被套到现在的题目上，也不会被自动删除')
    for (const jargon of ['v1', 'v2', '派生会话', '快照', '签名']) {
      expect(text, `关于页不该出现旧版记录术语「${jargon}」`).not.toContain(jargon)
    }
    // 旧键在被识别后依然保留
    expect(localStorage.getItem('typeme.quiz.v2')).not.toBeNull()
    expect(localStorage.getItem('typeme.quiz.v1')).not.toBeNull()
  })
})

/**
 * 设计完成度守卫（§4.3 / §4.7）——真实像素宽度由浏览器验收截图确认，
 * 这里只防止有人把断点与容器规则删回去而测试全绿。
 */
describe('设计系统守卫（§4）', () => {
  const viewSources = import.meta.glob('./*.vue', { query: '?raw', import: 'default', eager: true }) as
    Record<string, string>
  const componentSources = import.meta.glob('../components/*.vue', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
  const allSources = { ...viewSources, ...componentSources }
  const joined = Object.values(allSources).join('\n')

  it('页面与组件使用新版断点 prefix（tablet:/laptop:/desktop:）', () => {
    expect(joined).toContain('tablet:')
    expect(joined).toContain('laptop:')
    expect(joined).toContain('desktop:')
  })

  it('Tailwind 配了每页各自的容器上限，而不是一个 max-width 套全部', async () => {
    const config = await import('../../tailwind.config.js')
    const maxWidth = config.default.theme.extend.maxWidth
    expect(maxWidth['shell-quiz']).toBe('70rem')
    expect(maxWidth['shell-result']).toBe('75rem')
    expect(maxWidth['shell-wide']).toBe('75rem')
    expect(maxWidth['shell-article']).toBe('48rem')
    expect(maxWidth['prose-result']).toBe('47.5rem')
  })

  it('新版语义色齐备（奶白 / 墨蓝 / 杏橙）', async () => {
    const config = await import('../../tailwind.config.js')
    const colors = config.default.theme.extend.colors as {
      paper: { DEFAULT: string }
      ink: { DEFAULT: string }
      primary: Record<string, string>
      accent: Record<string, string>
      line: { DEFAULT: string }
    }
    expect(colors.paper.DEFAULT).toBe('#F7F6F2')
    expect(colors.ink.DEFAULT).toBe('#1D2D3A')
    expect(colors.primary[600]).toBe('#264E70')
    expect(colors.accent[500]).toBe('#B85332')
    expect(colors.line.DEFAULT).toBe('#DCDDD7')
  })

  it('答题页在 laptop: 起是「左进度 + 右题卡」两栏，而不是单列窄条', () => {
    const quiz = viewSources['./QuizView.vue']
    expect(quiz).toContain('laptop:grid-cols-[17rem_minmax(0,1fr)]')
  })

  it('结果页在 laptop: 起是「正文 + 目录」两栏', () => {
    const result = viewSources['./ResultView.vue']
    expect(result).toContain('laptop:grid-cols-[minmax(0,47.5rem)_15rem]')
  })

  it('报告目录的每个锚点都能在结果页里找到对应章节（避免点了没反应的死链）', () => {
    const result = viewSources['./ResultView.vue']
    const ids = [...result.matchAll(/\{ id: '([a-zA-Z-]+)', label:/g)].map((match) => match[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(result, `目录锚点 #${id} 没有对应的 id="..."`).toContain(`id="${id}"`)
    }
  })

  it('没有任何自动跳题计时器（手机端也必须手动下一题）', () => {
    const quiz = viewSources['./QuizView.vue']
    expect(quiz).not.toContain('ADVANCE_DELAY_MS')
    expect(quiz).not.toMatch(/setTimeout\([^)]*\{\s*quiz\.next\(\)/)
  })

  it('不引入外部图片或远程字体（首页装饰必须是本地 SVG/CSS）', () => {
    expect(joined).not.toMatch(/https?:\/\/[^"' )]+\.(png|jpe?g|webp|gif|svg|woff2?|ttf)/i)
    expect(joined).not.toContain('fonts.googleapis.com')
    expect(joined).not.toContain('fonts.gstatic.com')
    expect(joined).not.toContain('<img src="http')
  })
})

/**
 * 站点默认包换成 IPIP-50 大五之后，**默认这一层**必须由页面钉住：
 * 默认装载哪个包、答题页是不是单句贴切度 + 五档锚点、
 * 结果页的两端记号与计数是不是跟着当前包走。断言全部从内容包推导（不写死 32 / 四维）。
 *
 * 2026-09-16：首页已按产品要求删除「旧版本测试」入口与版本选择器，并且整页改为只描述
 * 主推的十六型新测 —— 首页的题数、维度说明、教学例子与结果示例卡**都不再跟着当前内容包走**
 * （见下面的删除说明与新注释）。本 describe 只剩旧引擎页面（`/quiz`、`/result`）的默认包接线。
 */
describe('站点默认包（IPIP-50 大五）', () => {
  it('mountStore() 不带参数时装载站点默认包 ipip50-zh1', () => {
    const store = mountStore()
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(store.packageId).toBe('ipip50-zh1')
    expect(store.activePackage!.instrument.id).toBe('ipip50')
    expect(store.total).toBe(store.activePackage!.questionnaire.questionCount)
  })

  // 2026-09-16：本 describe 里原有的两条**首页**用例已删除 —— 它们钉住的是
  // 「首页的维度说明/结果示例卡跟着当前装载的旧内容包走」：
  //   - 「首页的维度说明按当前内容包的维度渲染：IPIP 默认包 5 行，且不出现四字母示例卡」
  //   - 「选中 OEJTS 包时首页仍是四维说明与 INFP 结果示例卡」
  // 这正是本次要修的缺陷（首页主推十六型新测，页面下方却讲大五五维、并藏起示例卡）。
  // 首页现在**永远**只描述主推的 `typeme-jung48-zh-v1`（四维 EI/SN/TF/JP、双极 1–5、
  // 产出四字母类型码），与装载了哪个旧内容包无关；这条新行为由
  // `instrumentCopy.spec.ts` 的「首页的量表文案与抽象图形（LandingView.vue）」对**两个旧内容包**
  // 跑同一批断言钉住，不再需要在"默认包"这一层重复。
  // 旧内容包自己仍由本 describe 下方的 /quiz、/result 用例与 stores/quiz.spec.ts 覆盖。

  it('默认包为 IPIP 时答题页用「单句陈述 + 五档贴切度」，不出现双极两端的提示', async () => {
    const store = mountStore()
    const pkg = store.activePackage!
    expect(packageFormat(pkg)).toBe('agreement')
    const anchors = responseAnchorsOf(pkg) ?? []
    expect(anchors).toHaveLength(5)

    const { wrapper } = await mountAt('/quiz', QuizView)
    const text = wrapper.text()
    // 题面是内容包里的那一句自我描述
    expect(text).toContain(String(pkg.questionnaire.questions[0].text))
    expect(text).toContain('这句描述对你有多贴切？')
    // 五档锚点就是内容包声明的那五条
    for (const anchor of anchors) expect(text).toContain(anchor)
    expect(wrapper.findAll('[role="radio"]')).toHaveLength(5)
    // 不再是「哪一侧更接近平常的你？」的左右两端选择
    expect(text).not.toContain('哪一侧更接近平常的你？')
    expect(text).not.toContain('左边这一侧')
    expect(text).not.toContain('右边这一侧')
    expect(text).not.toContain('1 = 明显偏左')
  })

  /**
   * 结果页的两端记号与计数。
   *
   * 真实踩过的缺陷：结果页与分享图都直接查 OEJTS 专用的 `NEGATIVE_POLE` /
   * `POSITIVE_POLE`（只有 EI/SN/TF/JP），大五的 E/A/C/ES/O 查不到 → 页面里两端记号
   * 变成空白、导出图上被画成字面量 "undefined"；同时「四个维度」被写死在标题、
   * 目录与说明里。这一组用**当前默认包**逐条钉住。
   */
  async function mountIpipReport(offsets: Partial<Record<Dimension, number>>) {
    const store = mountStore()
    const pkg = store.activePackage!
    expect(packageDimensionOrder(pkg)).toEqual(['E', 'A', 'C', 'ES', 'O'])
    seedOffsets(store, offsets)
    submitAll(store)
    return { store, ...(await mountAt('/result', ResultView)) }
  }

  it('结果页两端记号是内容包的「低/高」：页面里既不空白也不出现 undefined', async () => {
    const { store, wrapper } = await mountIpipReport({ E: 12, A: -12, C: 12, ES: 12, O: -12 })
    const rows = store.report!.dimensionRows
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.lowToken).toBe('低')
      expect(row.highToken).toBe('高')
    }

    const dimensions = wrapper.find('#dimensions').text()
    expect(dimensions).not.toContain('undefined')
    // 每个维度的两端标签都能在页面上看到（「低」「高」各出现至少一次）
    expect(dimensions).toContain('低')
    expect(dimensions).toContain('高')
    // OEJTS 的极点字母一个都不该出现在大五报告里
    const dimensionText = Array.from(
      wrapper.findAll('[data-dimension-text]'),
      (item) => item.text(),
    ).join('\n')
    for (const row of rows) {
      expect(dimensionText, `${row.heading} 缺少低端记号`).toContain(row.lowToken)
      expect(dimensionText, `${row.heading} 缺少高端记号`).toContain(row.highToken)
    }
    expect(dimensionText).not.toMatch(/[IENSFTJP]\s*↔/)
  })

  it('结果页的计数跟当前包走：标题/目录/说明都说「五个维度」，并说明大五不拼类型', async () => {
    const { store, wrapper } = await mountIpipReport({ E: 12, A: -12, C: 12, ES: 12, O: -12 })
    const report = store.report!
    expect(report.dimensionCount).toBe(5)
    expect(report.share.kind).toBe('clear')

    const text = wrapper.text()
    expect(text).toContain('五个维度上的结果')
    expect(text).not.toContain('四个维度')
    // 目录里的名称同样跟着维度数
    expect(text).toContain('五个维度')
    // 「有方向但没有类型」时的抬头不许写成「没有明确方向」
    expect(text).toContain('本次偏好概览（每个维度都有方向）')
    expect(text).not.toContain('本次偏好概览（没有明确方向）')
    // 大五不产出类型码：方法与边界说明里说「完整结论」，且不出现 MBTI 免责声明
    expect(text).toContain('完整结论就为空')
    expect(text).not.toContain('这不是 MBTI 官方测评')
    expect(text).not.toContain('The Myers')
  })

  it('结果页的 OEJTS 旧版本仍然说「四个维度」，并保留 MBTI 免责声明', async () => {
    const store = mountStore(OEJTS_PACKAGE_ID)
    seedOffsets(store, { EI: 0, SN: 12, TF: 0, JP: 0 })
    submitAll(store)
    const { wrapper } = await mountAt('/result', ResultView)
    const text = wrapper.text()
    expect(store.report!.dimensionCount).toBe(4)
    expect(text).toContain('四个维度上的结果')
    expect(text).toContain('完整类型就为空')
    expect(text).toContain('这不是 MBTI 官方测评')
    expect(text).toContain('The Myers')
    // 两端记号仍取内容包的档案值（OEJTS 是字母）
    const dimensionText = Array.from(
      wrapper.findAll('[data-dimension-text]'),
      (item) => item.text(),
    ).join('\n')
    expect(dimensionText).toContain('内向 I')
    expect(dimensionText).toContain('直觉 N')
  })

  it('「继续认识自己」的选择在大五下也能存下来（不能因为记号是 undefined 而失效）', async () => {
    // 四维都 leaning、ES 落在中点 → 只有 ES 需要额外观察
    const { store, wrapper } = await mountIpipReport({ E: 12, A: -12, C: 12, ES: 0, O: -12 })
    const esRow = store.report!.dimensionRows.find((row) => row.dimension === 'ES')!
    expect(esRow.status).toBe('balanced')

    const section = wrapper.find('#self')
    const buttons = section.findAll('button')
    const lowButton = buttons.find((item) => item.text().includes(`更偏 ${esRow.negativeLabel}`))
    const highButton = buttons.find((item) => item.text().includes(`更偏 ${esRow.positiveLabel}`))
    expect(lowButton, '缺少低端「更偏…」按钮').toBeTruthy()
    expect(highButton, '缺少高端「更偏…」按钮').toBeTruthy()

    await lowButton!.trigger('click')
    expect(store.selfReflection.ES?.preference).toBe(esRow.lowToken)
    expect(section.find('[data-self-reflection]').text()).toContain(`更偏 ${esRow.negativeLabel}`)
    expect(lowButton!.attributes('aria-pressed')).toBe('true')
    expect(highButton!.attributes('aria-pressed')).toBe('false')

    // 换到另一侧：必须能改，且两侧不共用一个值
    await highButton!.trigger('click')
    expect(store.selfReflection.ES?.preference).toBe(esRow.highToken)
    expect(esRow.highToken).not.toBe(esRow.lowToken)
    expect(section.find('[data-self-reflection]').text()).toContain(`更偏 ${esRow.positiveLabel}`)

    await buttons.find((item) => item.text().includes('暂不确定'))!.trigger('click')
    expect(store.selfReflection.ES?.preference).toBeNull()
    expect(section.find('[data-self-reflection]').text()).toContain('暂不确定')
  })
})
