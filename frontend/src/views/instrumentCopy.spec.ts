// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import App from '@/App.vue'
import LandingView from '@/views/LandingView.vue'
import AboutView from '@/views/AboutView.vue'
import { useQuizStore } from '@/stores/quiz'
import {
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
} from '@/content/fallback'
import { instrumentHasTypeCode, packageDimensionOrder } from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import { POLE_META } from '@/domain/scoring'

/**
 * 跨量表文案守卫 —— 站点默认量表从 OEJTS 四字母换成 IPIP-50 大五之后，
 * 「四维 / 四字母 / 非商业 / 未获得 MBTI 授权」这些句子不再到处成立。
 *
 * 这一组测试把**同一批页面**分别按两个内容包渲染，逐条钉住：
 *   - 与量表有关的文案必须跟着当前内容包走（题数、维度数、署名与许可、免责声明）；
 *   - 与量表无关的纪律（不出现红线词、不给人群百分位）在两种情况下都成立；
 *   - 大五报告里不出现任何四字母类型码或类型专属文案。
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
  store.restore()
  return store
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
      const wrapper = mount(App as never, { global: { plugins: [makeRouter()] } })
      await flushPromises()
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
  it('会测到的维度数、题数与轨道数都等于当前内容包（4 vs 5）', async () => {
    for (const { id } of packages) {
      setActivePinia(createPinia())
      const store = mountStore(id)
      const pkg = pkgOf(id)
      const order = packageDimensionOrder(pkg)
      const wrapper = await mountAt('/', LandingView)
      const text = wrapper.text()

      expect(store.total, `${id} 题数`).toBe(pkg.questionnaire.questionCount)
      expect(text, `${id} 首屏题数`).toContain(`${pkg.questionnaire.questionCount} 道题`)

      // 维度说明逐维渲染，顺序与内容包一致
      const rows = wrapper.findAll('[data-dimension-list] [data-dimension]')
      expect(rows.map((row) => row.attributes('data-dimension')), `${id} 维度顺序`).toEqual([
        ...order,
      ])
      // OEJTS 四维沿用 `POLE_META` 的展示名（与旧版一致）；大五用内容包自己的维度名
      for (const dimension of order) {
        const expectedName = instrumentHasTypeCode(pkg)
          ? POLE_META[dimension as keyof typeof POLE_META].name
          : pkg.dimensionCopy[dimension].name
        expect(text, `${id} 缺少维度名 ${dimension}`).toContain(expectedName)
      }

      // 抽象图形的轨道数 = 维度数（图形不再固定四条）
      const glyph = wrapper.find('svg[role="presentation"]')
      const labels = glyph.findAll('g')
      expect(labels.length, `${id} 抽象图形轨道数`).toBe(order.length)
      expect(glyph.text(), `${id} 图形说明`).toContain(
        `${order.length} 条轨道对应 ${order.length} 个维度`,
      )

      // 类型示例卡只属于产出类型码的量表
      const example = wrapper.find('[data-result-example]')
      if (instrumentHasTypeCode(pkg)) {
        expect(example.exists(), `${id} 应渲染类型示例卡`).toBe(true)
      } else {
        expect(example.exists(), `${id} 不应渲染四字母示例卡`).toBe(false)
        expect(text).not.toContain('结果示例')
      }
    }
  })

  it('来源与许可按当前内容包区分：OEJTS 非商业 / IPIP 公有领域', async () => {
    setActivePinia(createPinia())
    mountStore(DEFAULT_PACKAGE_ID)
    const ipip = await mountAt('/', LandingView)
    const ipipText = ipip.text()
    expect(ipipText).toContain('IPIP 公有领域量表（大五），非官方测评')
    expect(ipipText).toContain('公有领域')
    expect(ipipText).not.toContain('非商业用途')
    expect(ipipText).not.toContain('CC BY-NC-SA 4.0')

    setActivePinia(createPinia())
    mountStore(OEJTS_PACKAGE_ID)
    const oejts = await mountAt('/', LandingView)
    const oejtsText = oejts.text()
    expect(oejtsText).toContain('基于 OEJTS 1.2，非官方 MBTI 测验')
    expect(oejtsText).toContain('CC BY-NC-SA 4.0')
    expect(oejtsText).toContain('非商业用途')
    expect(oejtsText).not.toContain('IPIP 公有领域量表')
  })

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

  it('教学例子与 FAQ 按作答格式讲，不把另一份量表的话留在首页', async () => {
    const expectations = [
      {
        id: DEFAULT_PACKAGE_ID,
        teaching: '每题是一句自我描述：1 表示非常不贴切，5 表示非常贴切。',
        forbidden: ['两边都读完', '左边是 1，右边是 5'],
        valueTitle: '五个维度各自的结果，而不是一个标签',
        faqKey: '五个维度各自是连续分数',
        versionAnswer: 'IPIP',
      },
      {
        id: OEJTS_PACKAGE_ID,
        teaching: '两边都读完：左边是 1，右边是 5。',
        forbidden: ['每题是一句自我描述'],
        valueTitle: '四个维度的结果，而不是一个默认类型',
        faqKey: '四个维度是连续分数',
        versionAnswer: 'OEJTS 1.2',
      },
    ] as const

    for (const item of expectations) {
      setActivePinia(createPinia())
      mountStore(item.id)
      const wrapper = await mountAt('/', LandingView)
      const text = wrapper.text()

      expect(text, `${item.id} 教学例子`).toContain(item.teaching)
      for (const forbidden of item.forbidden) {
        expect(text, `${item.id} 首页串了另一份量表的说法`).not.toContain(forbidden)
      }
      expect(text, `${item.id} 价值三项`).toContain(item.valueTitle)
      expect(text, `${item.id} FAQ 连续分数`).toContain(item.faqKey)
      // 部署版首页不再回答「内容版本是什么状态」这种维护向的问题
      expect(text, `${item.id} 首页不该出现内容状态问答`).not.toContain('内容状态')
    }
  })
})

describe('方法页（AboutView.vue）：只留用户需要的事实', () => {
  it('门槛、维度数与两端说明按当前题库推导（OEJTS 4 维 / IPIP 5 维）', async () => {
    const expectations = [
      { id: DEFAULT_PACKAGE_ID, bandMax: 5, marked: 11 },
      { id: OEJTS_PACKAGE_ID, bandMax: 4, marked: 9 },
    ] as const

    for (const item of expectations) {
      setActivePinia(createPinia())
      mountStore(item.id)
      const wrapper = await mountAt('/about', AboutView)
      const text = wrapper.text()
      const pkg = pkgOf(item.id)
      const marked = pkg.interpretation.markedDistance
      expect(marked, `${item.id} 门槛`).toBe(item.marked)

      expect(text, `${item.id} 略偏档上界`).toContain(`距中点 1–${item.bandMax} 分`)
      expect(text, `${item.id} 偏向门槛`).toContain(`|偏移| ≥ ${marked} 分`)
      expect(text, `${item.id} 维度数`).toContain(`${packageDimensionOrder(pkg).length} 个维度`)

      // 非类型量表不得出现「四字母 / 参考组合」的说法
      if (!instrumentHasTypeCode(pkg)) {
        expect(text).toContain('没有类型码')
        expect(text).not.toContain('四字母')
      } else {
        expect(text).toContain('四字母')
        expect(text).toContain('S–N 维度本身就难测准')
      }
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
})
