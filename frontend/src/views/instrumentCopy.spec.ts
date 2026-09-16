// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import App from '@/App.vue'
import LandingView from '@/views/LandingView.vue'
import AboutView from '@/views/AboutView.vue'
import ResultView from '@/views/ResultView.vue'
import { useQuizStore } from '@/stores/quiz'
import {
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
} from '@/content/fallback'
import { instrumentHasTypeCode, packageDimensionOrder } from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import { ratingsForOffsets } from '@/dev/seed'
import type { Dimension } from '@/domain/types'

/**
 * 跨量表文案守卫 —— 站点默认量表从 OEJTS 四字母换成 IPIP-50 大五之后，
 * 「四维 / 四字母 / 非商业 / 未获得 MBTI 授权」这些句子不再到处成立。
 *
 * 这一组测试把**同一批页面**分别按两个内容包渲染，逐条钉住：
 *   - **公共壳（`App.vue`）**与量表有关的文案必须跟着当前内容包走
 *     （维度数、署名与许可、免责声明）；
 *   - 与量表无关的纪律（不出现红线词、不给人群百分位）在两种情况下都成立；
 *   - 大五报告里不出现任何四字母类型码或类型专属文案。
 *
 * ⚠️ 2026-09-16：**首页与方法页都不再属于"跟着当前内容包走"的那一批**。首页主推的是
 * `typeme-jung48-zh-v1` 十六型新测，方法页（`/about`）是首页那个「方法与隐私」入口的落点，
 * 它讲的也必须是这同一份量表（四维、双极 1–5、产出四字母类型码、门槛取自这份量表自己的
 * 计分规则）。旧内容包装成什么都不会改变这两页的文案 —— 这正是本文件下半段对两个旧包
 * 跑同一批断言的原因。旧引擎的 `/quiz`、`/result` 与公共壳的量表口径**未受影响**。
 */

const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'

const packages = [
  { id: DEFAULT_PACKAGE_ID, label: '默认包（IPIP-50 大五）' },
  { id: OEJTS_PACKAGE_ID, label: '可选旧版本（OEJTS 四维）' },
] as const

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/about', name: 'about', component: AboutView },
      // 2026-09-16：`/about` 已不再算旧引擎页面（它整页改讲首页主推的新测，
      // 旧内容包的署名不再挂在它上面）。要验"公共壳跟随当前内容包"必须挂到
      // 真正的旧引擎路由上；用 `/result` 而不是 `/quiz`，因为答题页按 §4.5
      // 刻意不渲染页脚（`App.vue` 的 `v-if="!quizActive"`），那里没有署名可验。
      { path: '/result', name: 'result', component: ResultView },
      // `ResultView` 在"作答未完成"时会 `router.replace({ name: 'quiz' })`
      // （ResultView.vue 的 onMounted）。这里注册占位路由有两个作用，缺一不可：
      //   1. 不注册时那次跳转会以 `No match for {"name":"quiz"}` 被拒绝 ——
      //      它是一个 **unhandled error**，表现为"用例全绿、进程却 exit 1"。
      //      这种"绿着失败"最容易被当成环境噪音放过去，所以必须注册。
      //   2. 注册之后，**跳转真的会发生**，而答题页按设计不渲染页脚
      //      （`App.vue` 的 `v-if="!quizActive"`）—— 也就是说，"停在 /result 上
      //      断言页脚"这件事从此不可能靠"路由没有 quiz 而失败"侥幸成立。
      //      因此下面挂 `/result` 的用例必须先把答卷填满（见 `seedAllNeutral`），
      //      让结果页走正常分支；一旦有人把它改回未完成状态，那次跳转会让页脚消失、
      //      断言立刻变红 —— 这正是我们要的：**响亮地失败**，而不是安静地跳过。
      // 用空组件而不是真的 QuizView：本 spec 不验答题页，挂真组件只会引入无关依赖。
      { path: '/quiz', name: 'quiz', component: { template: '<div />' } },
    ],
  })
}

function pkgOf(packageId: string): AssessmentPackage {
  const pkg = FALLBACK_ASSESSMENT_PACKAGES[packageId]
  expect(pkg, `内置内容包 ${packageId} 必须存在`).toBeTruthy()
  return pkg
}

/** 装载指定内容包，走与页面相同的恢复路径。 */
function mountStore(packageId: string) {
  const store = useQuizStore()
  store.activePackage = pkgOf(packageId)
  store.responses = {}
  store.selfReflection = {}
  store.submittedAt = null
  // 先清掉上一轮用例可能写进 localStorage 的会话，否则 `restore()` 会把它读回来：
  // 会话里**带着 `packageId`**，于是下一轮明明装了 OEJTS（32 题）却渲染出 IPIP（50 题），
  // 表现为 `expected 50 to be 32` 这种看起来与内容包无关的错。
  // 本文件只验文案，不验持久化恢复（那条路径由 `stores/quiz.spec.ts` 负责），
  // 所以每个用例都从零开始才是它原本的语义。
  localStorage.clear()
  store.restore()
  return store
}

/**
 * 把每一维都填成中性答案并提交，使答卷**完整且已提交**。
 *
 * 只有这两件事都做到，`ResultView` 才会渲染"结果"分支：它的 `classify()` 要求
 * `isProcessed && submittedAt !== null`，否则 `router.replace` 到答题页，
 * 而答题页按设计不渲染页脚 —— 那样"结果页的页脚署名"就无从断言了（见 `makeRouter`）。
 * 全中性是最省事又不引入任何类型偏向的填法：这里只验公共壳的署名，不验结果内容。
 * 提交失败就直接抛：宁可在这里响亮地失败，也不要让用例悄悄跑到另一个页面上做断言。
 */
function seedCompleted(store: ReturnType<typeof useQuizStore>) {
  const pkg = store.activePackage
  if (!pkg) throw new Error('先把内容包装进 store 再填答卷')
  const offsets: Partial<Record<Dimension, number>> = {}
  for (const dimension of packageDimensionOrder(pkg)) offsets[dimension] = 0
  const ratings = ratingsForOffsets(pkg.questionnaire.questions, offsets)
  for (const [id, value] of Object.entries(ratings)) store.selectRating(Number(id), value)
  if (!store.submit()) throw new Error('填满后仍无法提交：结果页会跳去答题页，这条断言就失去意义了')
  if (store.submittedAt === null) throw new Error('提交后 submittedAt 仍为空：ResultView 仍会跳走')
}

async function mountAt(path: string, component: unknown) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component as never, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('公共壳的量表文案（App.vue）', () => {
  it('副标题与页脚署名跟着当前内容包走（四维 / 大五，各自不许串台）', async () => {
    for (const { id } of packages) {
      setActivePinia(createPinia())
      const store = mountStore(id)
      const pkg = pkgOf(id)
      // 挂到**旧引擎**的结果页 `/result`：只有旧引擎的页面（`/quiz`、`/result`）
      // 才该用当前内容包的量表名与署名。首页、`/about`、`/assess`、`/reports` 属于
      // 新站，它们的量表口径来自新测自己的目录接口 —— 挂在首页上就测不到这条接线了。
      // 2026-09-16：`/about` 已从旧引擎路由中移除（它整页改讲首页主推的新测），
      // 所以这条接线改挂在 `/result` 上；`/about` 的"永远讲新测"由本文件后一条用例钉住。
      // 挂之前先把答卷填满并提交：空答卷会让结果页跳去答题页，而答题页不渲染页脚
      // （见 `makeRouter`），那样这条断言测到的就不是"结果页的页脚"了。
      seedCompleted(store)
      const wrapper = await mountAt('/result', App)
      const text = wrapper.text()

      // 副标题：类型量表写「N 维」，大五写「大五」
      if (instrumentHasTypeCode(pkg)) {
        expect(text, `${id} 副标题`).toContain('4 维人格倾向自测')
        expect(text, `${id} 不许出现大五字样`).not.toContain('大五人格倾向自测')
      } else {
        expect(text, `${id} 副标题`).toContain('大五人格倾向自测')
        expect(text, `${id} 不许写四维`).not.toContain('四维人格倾向自测')
      }

      // 页脚署名取当前内容包的 source / author / license
      expect(text, `${id} 页脚署名`).toContain(pkg.attribution.source)
      expect(text, `${id} 页脚作者`).toContain(pkg.attribution.author)
      expect(text, `${id} 页脚许可`).toContain(pkg.attribution.license)

      // MBTI 免责声明只对 OEJTS 成立（大五不是 MBTI 的衍生量表）
      if (instrumentHasTypeCode(pkg)) {
        expect(text).toContain('Myers')
      } else {
        expect(text, '大五页脚不该出现 MBTI 机构免责声明').not.toContain('Myers')
        expect(text, '大五页脚必须写明公有领域').toContain('公有领域')
      }
      expect(store.packageId).toBe(id)
    }
  })
})

describe('首页的量表文案与抽象图形（LandingView.vue）', () => {
  it('维度说明与首屏图形永远是首页主推的新测四维，不跟随本机装载的旧内容包', async () => {
    // 2026-09-16：本用例此前断言「维度行数 = 当前内容包维度数（OEJTS 4 / IPIP 5）、
    // 行顺序 = 内容包维度顺序、大五不渲染四字母示例卡」—— 它钉住的正是本次要修的缺陷：
    // 首页主推十六型新测，页面下方却按旧内容包讲五个维度、并把示例卡藏起来。
    // 首页现在只描述主推的 `typeme-jung48-zh-v1`（四个维度、产出四字母类型码），
    // 旧内容包装成什么都不会改变它；这里对**两个旧内容包**跑同一批断言钉住这件事。
    // 首页主推的量表（`typeme-jung48-zh-v1`）自己的四维：两端记号 = `POLE_META`
    // 的「负极 – 正极」，维度名 = 目录下发的名字。这里写死成期望值，
    // 才能在不依赖实现的情况下发现"某一天又跟着旧包走了"。
    const expectedDimensions = [
      { dimension: 'EI', label: 'I – E', name: '精力方向' },
      { dimension: 'SN', label: 'S – N', name: '信息取向' },
      { dimension: 'TF', label: 'F – T', name: '决策依据' },
      { dimension: 'JP', label: 'J – P', name: '生活节奏' },
    ] as const
    const newInstrumentNames: readonly string[] = expectedDimensions.map((item) => item.name)
    // 旧内容包**独有**的维度名（大五的「宜人性」、OEJTS 的「安排方式」这类）：
    // 与首页主推量表同名的（「决策依据」）不算，它们本来就在新测的目录里。
    const legacyOnlyNames = [
      ...new Set(
        packages.flatMap(({ id }) => {
          const pkg = pkgOf(id)
          return packageDimensionOrder(pkg).map((dimension) => pkg.dimensionCopy[dimension].name)
        }),
      ),
    ].filter((name) => !newInstrumentNames.includes(name))

    for (const { id } of packages) {
      setActivePinia(createPinia())
      const store = mountStore(id)
      const pkg = pkgOf(id)
      const wrapper = await mountAt('/', LandingView)
      const text = wrapper.text()

      // 旧引擎自己的 store 仍然装载着当前包（旧站未受影响）……
      expect(store.total, `${id} 题数`).toBe(pkg.questionnaire.questionCount)
      // ……但首页的题数不跟它走：主入口是 48 题主测的新测，题数取自
      // `/api/v3/catalog/current`（jsdom 下读不到 → 新测内置口径）。
      expect(text, `${id} 首屏题数`).toContain('主测 48 道题')

      // 维度说明：顺序、数量、两端记号与维度名都来自新测自己，与装载的旧包无关
      const rows = wrapper.findAll('[data-dimension-list] [data-dimension]')
      expect(rows.map((row) => row.attributes('data-dimension')), `${id} 维度顺序`).toEqual(
        expectedDimensions.map((item) => item.dimension),
      )
      expect(text, `${id} 维度数`).toContain('四个维度')
      for (const item of expectedDimensions) {
        expect(text, `${id} 缺少 ${item.dimension} 的两端记号`).toContain(item.label)
        expect(text, `${id} 缺少维度名 ${item.name}`).toContain(item.name)
      }
      for (const name of legacyOnlyNames) {
        expect(text, `${id} 首页串了旧内容包的维度名「${name}」`).not.toContain(name)
      }

      // 首屏抽象图形画的也是新测自己的四个维度
      const glyph = wrapper.find('svg[role="presentation"]')
      const labels = glyph.findAll('g')
      expect(labels.length, `${id} 首屏图形轨道数`).toBe(4)
      expect(glyph.text(), `${id} 图形说明`).toContain('4 条轨道对应 4 个维度')
      for (const name of newInstrumentNames) {
        expect(glyph.text(), `${id} 首屏图形缺维度 ${name}`).toContain(name)
      }

      // 结果示例卡：首页主推的量表产出类型码 → 任何旧内容包下都渲染
      const example = wrapper.find('[data-result-example]')
      expect(example.exists(), `${id} 应渲染类型示例卡`).toBe(true)
    }
  })

  // 2026-09-16：首页的「来源与许可」改为描述**新测自己**（`data-instrument-attribution`，
  // 文案里只说「本项目自行撰写 / 不隶属任何商业人格测评机构」），旧内容包按包区分的署名与许可
  // （OEJTS 非商业 CC BY-NC-SA 4.0 / IPIP 公有领域）已不在首页渲染，故删除用例
  // 「来源与许可按当前内容包区分：OEJTS 非商业 / IPIP 公有领域」。
  // 旧包的署名接线没有被取消，仍由本文件顶部的「公共壳（App.vue）」用例挂在 /about 上钉住。

  it('两个包都不出现「最准 / 权威 / 官方测评结果」这类红线词', async () => {
    for (const { id } of packages) {
      setActivePinia(createPinia())
      mountStore(id)
      const wrapper = await mountAt('/', LandingView)
      const text = wrapper.text()
      for (const word of ['最准', '权威', '官方测评结果']) {
        expect(text, `${id} 首页出现红线词「${word}」`).not.toContain(word)
      }
    }
  })

  it('教学例子、价值三项与 FAQ 只讲首页主推新测的双极作答格式', async () => {
    // 2026-09-16：本用例此前按**两个旧内容包**分别断言教学例子（IPIP 的单句贴切度 /
    // OEJTS 的双极）与「五个维度 / 四个维度」两套价值文案 —— 它钉住的正是本次要修的缺陷。
    // 首页现在只描述主推的新测（`typeme-jung48-zh-v1`：一对相反描述里选位置，左 1 右 5），
    // 因此只保留双极这一份口径，并对两个旧内容包都断言「单句贴切度」的说法不在首页。
    for (const { id } of packages) {
      setActivePinia(createPinia())
      mountStore(id)
      const wrapper = await mountAt('/', LandingView)
      const text = wrapper.text()

      expect(text, `${id} 教学例子`).toContain('两边都读完：左边是 1，右边是 5。')
      for (const forbidden of ['每题是一句自我描述', '1 表示非常不贴切', '五个维度']) {
        expect(text, `${id} 首页串了另一份量表的说法`).not.toContain(forbidden)
      }
      expect(text, `${id} 价值三项`).toContain('四个维度的结果，而不是一个默认类型')
      expect(text, `${id} FAQ 连续分数`).toContain('四个维度是连续分数')
      // 部署版首页不再回答「内容版本是什么状态」这种维护向的问题
      expect(text, `${id} 首页不该出现内容状态问答`).not.toContain('内容状态')
    }
  })
})

describe('方法页（AboutView.vue）：只留用户需要的事实', () => {
  it('无论本机装载哪个旧内容包，方法与隐私讲的都是首页主推的那份量表', async () => {
    // 2026-09-16：本用例此前逐个内容包断言「略偏档 1–5 / 1–4 分、|偏移| ≥ 11 / 9 分、
    // N 个维度、大五写"没有类型码"」—— 它钉住的正是本次要修的缺陷：首页的「方法与隐私」
    // 入口邀请访客读的是一份双极 1–5 的十六型测评，点进来却被讲成五个维度的大五、
    // 单句贴切度、并印着旧内容包自己的解释门槛。
    // 现在方法页与首页同源（`useInstrumentV3Store().facts`：四个维度、双极 1–5、
    // 产出四字母），旧内容包装成什么都不会改变它；门槛也不再抄旧包的数字。
    const expectedDimensions = [
      { dimension: 'EI', label: 'I – E', name: '精力方向' },
      { dimension: 'SN', label: 'S – N', name: '信息取向' },
      { dimension: 'TF', label: 'F – T', name: '决策依据' },
      { dimension: 'JP', label: 'J – P', name: '生活节奏' },
    ] as const
    // 旧内容包**独有**的维度名（大五的「宜人性」、OEJTS 的「信息偏好」这类）：
    // 与新测同名的（「精力方向」）不算，它们本来就在新测的目录里。
    const newInstrumentNames: readonly string[] = expectedDimensions.map((item) => item.name)
    const legacyOnlyNames = [
      ...new Set(
        packages.flatMap(({ id }) =>
          packageDimensionOrder(pkgOf(id)).map(
            (dimension) => pkgOf(id).dimensionCopy[dimension].name,
          ),
        ),
      ),
    ].filter((name) => !newInstrumentNames.includes(name))

    for (const { id } of packages) {
      setActivePinia(createPinia())
      const store = mountStore(id)
      const pkg = pkgOf(id)
      const wrapper = await mountAt('/about', AboutView)
      const text = wrapper.text()

      // 旧引擎自己的 store 仍然装载着当前包（旧站未受影响）……
      expect(store.total, `${id} 题数`).toBe(pkg.questionnaire.questionCount)

      // ……但方法页的维度口径不跟它走：顺序、数量、两端记号与维度名都来自新测自己
      const rows = wrapper.findAll('[data-dimension-list] [data-dimension]')
      expect(rows.map((row) => row.attributes('data-dimension')), `${id} 维度顺序`).toEqual(
        expectedDimensions.map((item) => item.dimension),
      )
      expect(text, `${id} 维度数`).toContain('四个维度')
      for (const item of expectedDimensions) {
        expect(text, `${id} 缺少 ${item.dimension} 的两端记号`).toContain(item.label)
        expect(text, `${id} 缺少维度名 ${item.name}`).toContain(item.name)
      }
      for (const name of legacyOnlyNames) {
        expect(text, `${id} 方法页串了旧内容包的维度名「${name}」`).not.toContain(name)
      }

      // 作答格式只讲双极 1–5；单句贴切度与大五的说法都属于另一份量表
      expect(text, `${id} 作答格式`).toContain('左边永远是 1，右边永远是 5')
      for (const forbidden of [
        '每题给出一句自我描述',
        '1 表示非常不贴切',
        '这句描述对你有多贴切',
        '大五量表',
        '没有类型码',
        '五个维度',
      ]) {
        expect(text, `${id} 方法页串了另一份量表的说法「${forbidden}」`).not.toContain(forbidden)
      }

      // 首页主推的量表产出四字母类型码 → 保留四字母这一支说法
      expect(text, `${id} 四字母`).toContain('四字母')

      // 门槛不再抄旧内容包的解释政策：那两个数字是另一份量表的
      const legacyBandMax = Math.max(0, pkg.interpretation.typeMinDistance - 1)
      expect(text, `${id} 抄了旧包的略偏档`).not.toContain(`距中点 1–${legacyBandMax} 分`)
      expect(text, `${id} 抄了旧包的偏向门槛`).not.toContain(
        `|偏移| ≥ ${pkg.interpretation.markedDistance} 分`,
      )
      // 但「略偏」这件事必须讲清楚，并指出确切数值写在哪
      expect(text, `${id} 门槛说明`).toContain('「略偏」也不是一条写死的分数线')
      expect(text, `${id} 门槛数值出处`).toContain('这份报告是怎么来的')
    }
  })

  it('页面不再出现内容包 ID、内容状态、键名、接口与内置副本这类维护细节', async () => {
    for (const { id } of packages) {
      setActivePinia(createPinia())
      mountStore(id)
      const wrapper = await mountAt('/about', AboutView)
      const text = wrapper.text()

      for (const forbidden of [
        'typeme.quiz.v3',
        'typeme.package.v1',
        '内容包',
        '解释政策',
        '内容状态',
        'draft',
        '审校',
        '服务端',
        '内置副本',
        'packageId',
        '旧版本（OEJTS 32 题）的方法说明',
      ]) {
        expect(text, `${id} 方法页出现维护细节「${forbidden}」`).not.toContain(forbidden)
      }

      // 用户真正需要的三块必须还在
      expect(text, `${id} 如何作答`).toContain('如何作答')
      expect(text, `${id} 本地记录`).toContain('保存了什么')
      expect(text, `${id} 清除入口`).toContain('清除本地记录')
    }
  })

  it('文案红线：方法页不出现准确率/概率/百分位/置信这类词，也不把量表写成已验证', async () => {
    // 2026-09-16：本页此前有「不给人群百分位」「不是统计置信阈值」两句 —— 那是旧引擎
    // 的写法，而这两个词本身正是站点对外禁用的表述（否定句里出现也会被读成"它在谈这个"）。
    // 现在改用「不给人群比较 / 不是统计上的显著性判断」，并明确写出没有信度与效度证据。
    for (const { id } of packages) {
      setActivePinia(createPinia())
      mountStore(id)
      const wrapper = await mountAt('/about', AboutView)
      const text = wrapper.text()

      for (const banned of [
        '准确率',
        '概率',
        '百分位',
        '置信',
        '确诊',
        '命中注定',
        '科学证明',
        'MBTI 官方',
        '16Personalities',
        'OEJTS',
      ]) {
        expect(text, `${id} 方法页出现禁用表述「${banned}」`).not.toContain(banned)
      }

      // 内容仍在核对、且没有信效度证据，必须如实写出来（不得写成已验证）
      expect(text, `${id} 内容状态`).toContain('仍在内部核对中')
      expect(text, `${id} 信效度`).toContain('没有信度或效度方面的证据')
      expect(text, `${id} 不是诊断`).toContain('不是心理诊断')
    }
  })
})
