// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import LandingView from './LandingView.vue'
import { invalidateSessionRequests } from '@/api/v3'
import { useAuthStore } from '@/stores/auth'
import { useAssessmentStore } from '@/stores/assessmentV3'

/**
 * 首页的「继续上次没答完的测评」（A51）。
 *
 * <p>这一组测试钉的是**首页那句承诺与界面是否一致**：页面上一直写着
 * 「登录后可以跨设备接着答，也能回看自己历次的报告」，但在第 18 轮之前，
 * 草稿虽然在服务端保存得好好的，前端**没有任何地方读过草稿列表**
 * （`GET /attempts?status=draft` 没有消费者），用户中途关掉浏览器之后
 * 除了那次会话的地址栏再也回不到那份草稿。承诺与界面不一致，就是缺陷。
 *
 * <p>四件事必须分别成立，任何一条塌掉都会让"续答"变成骗人：
 *   1. 未登录时**不发**草稿请求，也不显示续答入口（草稿是账号的东西）；
 *   2. 有一份草稿时，主入口变成「继续」，并且指向**那一份**（不是随便一份）；
 *   3. 读不到草稿列表时退回普通入口，且**不编造**进度；
 *   4. 进度读不到（详情失败）时仍然能续答，但**不显示**「已答 N 题」。
 */
const DRAFT_ID = 'attempt-draft-1'

const PACKAGE = {
  schemaVersion: 1,
  packageId: 'typeme-jung48-zh-v1',
  instrument: {
    id: 'typeme-jung48',
    revision: 'r1',
    scoringVersion: 'typeme-jung48-score-v1',
    reportContentVersion: 'typeme-type-report-zh-v1',
    format: 'bipolar',
    hasTypeCode: true,
    baseItemsPerDimension: 1,
    clarificationItemsPerDimension: 1,
    maxClarificationItems: 4,
  },
  title: '十六型倾向自测',
  contentStatus: 'draft_review_pending',
  scoringPolicy: {
    version: 'typeme-jung48-score-v1',
    minBaseRatingsPerDimension: 1,
    boundaryNumerator: 2,
    boundaryDenominator: 10,
    ratingMin: 1,
    ratingMax: 5,
    ratingNeutral: 3,
  },
  dimensions: ['EI', 'SN', 'TF', 'JP'].map((dimension) => ({
    dimension,
    name: `维度 ${dimension}`,
    question: '这一维问什么',
    negativePole: { pole: 'I', label: '内倾', description: '独处恢复精力。', dailySigns: ['话不多'] },
    positivePole: { pole: 'E', label: '外倾', description: '与人来往恢复精力。', dailySigns: ['话多'] },
    balanced: { summary: '两边接近。', reading: '两边都可以读。' },
    tiedNotice: '这一维两边接近。',
  })),
  questions: [
    { id: 'q1', stage: 'base', dimension: 'EI', scenario: '一', textLeft: '左', textRight: '右', leftPole: 'I', rightPole: 'E', help: '提示', facet: 'f', order: 1, reviewStatus: 'reviewed' },
    { id: 'q2', stage: 'base', dimension: 'SN', scenario: '二', textLeft: '左', textRight: '右', leftPole: 'I', rightPole: 'E', help: '提示', facet: 'f', order: 2, reviewStatus: 'reviewed' },
    { id: 'c1', stage: 'clarification', dimension: 'TF', scenario: '三', textLeft: '左', textRight: '右', leftPole: 'I', rightPole: 'E', help: '提示', facet: 'f', order: 101, reviewStatus: 'reviewed' },
  ],
  sha256: 'c'.repeat(64),
}

function draftSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: DRAFT_ID,
    packageId: PACKAGE.packageId,
    status: 'BASE_IN_PROGRESS',
    revision: 3,
    currentQuestionId: 'q2',
    clarificationDimensions: [],
    clarificationSkipped: false,
    startedAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T12:34:00Z',
    submittedAt: null,
    reportId: null,
    ...overrides,
  }
}

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...draftSummary(),
    baseAttemptId: null,
    answers: [
      { questionId: 'q1', kind: 'rating', rating: 2 },
      { questionId: 'c1', kind: 'rating', rating: 4 },
    ],
    coverage: [],
    packageContent: PACKAGE,
    ...overrides,
  }
}

interface ServerOptions {
  /** 草稿列表的响应；给 `null` 表示"请求失败"。 */
  drafts?: Record<string, unknown>[] | null
  /** 详情请求的状态码（200 时用 `detailBody`）。 */
  detailStatus?: number
  detailBody?: Record<string, unknown>
  platformDrafts?: Record<string, unknown>[] | null
  /** 开放草稿总数。缺省时等于返回的行数。真实接口在 size=1 时仍会给出全部总数。 */
  platformTotal?: number
}

let calls: string[] = []
let server: ServerOptions = {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installFetch(): void {
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${url}`)

    if (url.includes('/auth/csrf')) {
      return jsonResponse({ token: 'csrf-token', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' })
    }
    if (url.includes('/catalog/current/package')) {
      return jsonResponse(PACKAGE)
    }
    if (url.includes('/catalog/current')) {
      return jsonResponse({
        packageId: PACKAGE.packageId,
        title: PACKAGE.title,
        baseQuestions: 2,
        clarificationMax: 1,
        minutesLow: 8,
        minutesHigh: 12,
        dimensions: PACKAGE.dimensions.map((dimension) => ({
          dimension: dimension.dimension,
          name: dimension.name,
        })),
      })
    }
    if (method === 'GET' && url.includes('/platform/attempts?')) {
      if (server.platformDrafts === null || server.platformDrafts === undefined) return jsonResponse({ code: 'INTERNAL_ERROR', message: '读取失败' }, 500)
      const items = server.platformDrafts ?? []
      return jsonResponse({
        items: items.slice(0, 1),
        page: 0,
        size: 1,
        total: server.platformTotal ?? items.length,
      })
    }
    if (method === 'GET' && /\/attempts\/[^/?]+$/.test(url)) {
      if (server.detailStatus && server.detailStatus !== 200) {
        return jsonResponse(
          { code: 'NOT_FOUND', message: '这份测评不存在。', requestId: 'req-x', details: {} },
          server.detailStatus,
        )
      }
      return jsonResponse(server.detailBody ?? detail())
    }
    if (method === 'GET' && url.includes('/attempts')) {
      if (server.drafts === null) {
        return jsonResponse(
          { code: 'INTERNAL_ERROR', message: '服务暂时没能读取你的测评。', requestId: 'req-y', details: {} },
          500,
        )
      }
      const items = server.drafts ?? []
      return jsonResponse({ items, page: 0, size: 20, total: items.length })
    }
    return jsonResponse({ code: 'NOT_FOUND', message: `没有为 ${method} ${url} 准备替身` }, 404)
  }
  vi.stubGlobal('fetch', handler as never)
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'landing', component: LandingView },
      { path: '/assess', name: 'assess', component: { template: '<p>答题</p>' } },
      { path: '/assess/:attemptId', name: 'assess-attempt', component: { template: '<p>答题</p>' } },
      { path: '/reports', name: 'reports', component: { template: '<p>报告</p>' } },
      { path: '/login', name: 'login', component: { template: '<p>登录</p>' } },
      // 页脚里的「关于/方法说明」链接：不注册它，vue-router 会在每条用例里刷警告
      { path: '/about', name: 'about', component: { template: '<p>关于</p>' } },
    ],
  })
}

async function mountLanding({ signedIn }: { signedIn: boolean }): Promise<{ wrapper: ReturnType<typeof mount> }> {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  const auth = useAuthStore()
  if (signedIn) {
    auth.applyProfile({
      userId: 'user-1',
      username: 'draft_owner',
      nickname: null,
      createdAt: '2026-09-18T00:00:00Z',
      passwordChangedAt: null,
    })
  } else {
    auth.applyAnonymous()
  }
  const wrapper = mount(LandingView as never, { global: { plugins: [router] } })
  await flushPromises()
  await flushPromises()
  return { wrapper }
}

beforeEach(() => {
  setActivePinia(createPinia())
  calls = []
  server = {}
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('首页：继续上次没答完的测评（A51）', () => {
  it('开放草稿属于大五时，首页两处续答都直达该草稿而不是固定去十六型', async () => {
    server = { drafts: [], platformDrafts: [{
      attemptId: 'big-five-older', instrumentSlug: 'bigfive50', instrumentKind: 'big_five',
      instrumentTitle: '大五人格倾向测评', packageId: 'typeme-bigfive50-zh-v1', reportContentVersion: null,
      status: 'BASE_IN_PROGRESS', revision: 2, startedAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T12:34:00Z', submittedAt: null, reportId: null,
      reportStatus: null, computedTypeCode: null, answeredCount: 9, requiredCount: 50,
    }] }
    const { wrapper } = await mountLanding({ signedIn: true })
    expect(calls.some((call) => call.includes('/platform/attempts?page=0&size=1&scope=open'))).toBe(true)
    expect(wrapper.find('[data-resume-entry]').attributes('href')).toContain('/assess/big-five-older')
    expect(wrapper.find('[data-platform-resume]').attributes('href')).toContain('/assess/big-five-older')
    const note = wrapper.find('[data-resume-note]').text()
    expect(note).not.toContain('主测')
    expect(note).toContain('已答 9/50 题')
    const hero = wrapper.get('[data-hero]').text()
    expect(hero).toContain('说不好')
    expect(hero).not.toContain('暂时无法判断')
    expect(hero).not.toContain('主测')
    const panel = wrapper.get('[data-jung-introduction]')
    expect(panel.get('summary').text()).toContain('接着答')
    expect(panel.get('summary').text()).not.toContain('十六型')
    const howTo = panel.get('[data-how-to-answer]').text()
    expect(howTo).toContain('说不好')
    expect(howTo).toContain('说不上符合或不符合')
    expect(howTo).not.toContain('左边这一侧')
    expect(howTo).not.toContain('暂时无法判断')
    const unknownNote = panel.get('[data-unknown-note]').text()
    expect(unknownNote).toContain('说不好')
    expect(unknownNote).not.toContain('暂时无法判断')
    expect(panel.text()).not.toContain('选「暂时无法判断」会怎样')
    expect(panel.text()).toContain('选「说不好」会怎样')
    expect(panel.text()).not.toContain('四个维度各自的结果')
    expect(panel.get('[data-dimension-list]').text()).toContain('开放性')
    expect(panel.get('[data-dimension-list]').text()).not.toContain('精力方向')
    expect(panel.text()).not.toContain('INFP')
    expect(panel.text()).not.toContain('十六型倾向自测：来源与许可')
    const source = panel.get('[data-instrument-attribution]').text()
    expect(source).toContain('IPIP-50')
    expect(source).toContain('公有领域')
    expect(source).not.toContain('自行撰写，没有照搬')
  })

  it('补充题进行中时，续答说明标明这是主测题数', async () => {
    server = { drafts: [], platformDrafts: [{
      attemptId: 'jung-clar', instrumentSlug: 'jung48', instrumentKind: 'jung',
      instrumentTitle: '十六型人格参考测评', packageId: PACKAGE.packageId, reportContentVersion: null,
      status: 'CLARIFICATION_IN_PROGRESS', revision: 4, startedAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T12:34:00Z', submittedAt: null, reportId: null,
      reportStatus: null, computedTypeCode: null, answeredCount: 48, requiredCount: 48,
    }] }
    const { wrapper } = await mountLanding({ signedIn: true })
    const note = wrapper.find('[data-resume-note]').text()
    expect(note).toContain('主测已答 48/48 题')
  })

  it('首页挂上之后才确认登录，续答入口仍然出现', async () => {
    server = { drafts: [draftSummary()], platformDrafts: [{
      attemptId: DRAFT_ID, instrumentSlug: 'jung48', instrumentKind: 'jung',
      instrumentTitle: '十六型人格参考测评', packageId: PACKAGE.packageId, reportContentVersion: null,
      status: 'BASE_IN_PROGRESS', revision: 3, startedAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T12:34:00Z', submittedAt: null, reportId: null,
      reportStatus: null, computedTypeCode: null, answeredCount: 10, requiredCount: 48,
    }] }
    const { wrapper } = await mountLanding({ signedIn: false })
    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    useAuthStore().applyProfile({
      userId: 'user-1', username: 'draft_owner', nickname: null,
      createdAt: '2026-09-18T00:00:00Z', passwordChangedAt: null,
    })
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-resume-entry]').attributes('href')).toContain(`/assess/${DRAFT_ID}`)
    expect(wrapper.find('[data-resume-note]').text()).toContain('已答')
  })

  it('读取进度被会话确认打断后重读，首页不停在失败上', async () => {
    const platformDraft = {
      attemptId: 'big-five-older', instrumentSlug: 'bigfive50', instrumentKind: 'big_five',
      instrumentTitle: '大五人格倾向测评', packageId: 'typeme-bigfive50-zh-v1', reportContentVersion: null,
      status: 'BASE_IN_PROGRESS', revision: 2, startedAt: '2026-09-18T10:00:00Z',
      updatedAt: '2026-09-18T12:34:00Z', submittedAt: null, reportId: null,
      reportStatus: null, computedTypeCode: null, answeredCount: 9, requiredCount: 50,
    }
    let release: (value: Response) => void = () => {}
    const first = new Promise<Response>((resolve) => { release = resolve })
    let platformCalls = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/auth/csrf')) {
        return Promise.resolve(jsonResponse({ token: 'csrf', headerName: 'X-XSRF-TOKEN', parameterName: '_csrf' }))
      }
      if (url.includes('/catalog/current/package')) return Promise.resolve(jsonResponse(PACKAGE))
      if (url.includes('/catalog/current')) {
        return Promise.resolve(jsonResponse({
          packageId: PACKAGE.packageId, title: PACKAGE.title, baseQuestions: 2,
          clarificationMax: 1, minutesLow: 8, minutesHigh: 12, dimensions: [],
        }))
      }
      if (method === 'GET' && url.includes('/platform/attempts?')) {
        platformCalls += 1
        if (platformCalls === 1) return first
        return Promise.resolve(jsonResponse({ items: [platformDraft], page: 0, size: 1, total: 1 }))
      }
      if (method === 'GET' && url.includes('/attempts')) {
        return Promise.resolve(jsonResponse({ items: [], page: 0, size: 20, total: 0 }))
      }
      return Promise.resolve(jsonResponse({ code: 'NOT_FOUND', message: '没有替身' }, 404))
    }))
    const { wrapper } = await mountLanding({ signedIn: true })
    expect(platformCalls).toBe(1)
    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    invalidateSessionRequests()
    release(jsonResponse({ items: [], page: 0, size: 1, total: 0 }))
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[data-home-drafts-error]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('登录状态已改变')
    expect(wrapper.find('[data-resume-entry]').attributes('href')).toContain('/assess/big-five-older')
    expect(platformCalls).toBeGreaterThanOrEqual(2)
  })
  it('未登录时不请求草稿列表，也不显示续答入口', async () => {
    server = { drafts: [draftSummary()] }
    const { wrapper } = await mountLanding({ signedIn: false })

    expect(calls.some((call) => call.includes('/attempts'))).toBe(false)
    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    expect(wrapper.find('[data-primary-entry]').text()).toContain('开始测评')
  })

  it('有一份没答完的草稿时，主入口变成「继续」并指向那一份', async () => {
    server = { drafts: [draftSummary()] }
    const { wrapper } = await mountLanding({ signedIn: true })

    const resume = wrapper.find('[data-resume-entry]')
    expect(resume.exists()).toBe(true)
    expect(resume.attributes('href')).toContain(`/assess/${DRAFT_ID}`)
    expect(resume.text()).toContain('继续上次没答完的测评')
    // 主入口只有一个：不能同时留下「开始测评」当主按钮，否则用户点哪个是随机的
    expect(wrapper.findAll('[data-primary-entry]')).toHaveLength(1)
    expect(wrapper.find('[data-restart-entry]').text()).toContain('重新开始')
  })

  it('续答说明只写服务端真的给了的东西：已答题数按主测题算，时间来自列表', async () => {
    server = { drafts: [draftSummary()] }
    const { wrapper } = await mountLanding({ signedIn: true })

    const note = wrapper.find('[data-resume-note]').text()
    // 详情里有 2 条作答，但其中 c1 是补充题 → 主测只算 1 条，分母是主测题数 2
    expect(note).toContain('已答 1/2 题（主测）')
    expect(note).toContain('2026 年 9 月 18 日')
    expect(note).not.toContain('另外还有')
  })

  it('续答的是大五草稿时，另外几份按开放草稿总数算，不漏掉十六型', async () => {
    server = {
      drafts: [draftSummary()],
      platformDrafts: [{
        attemptId: 'big-five-newer', instrumentSlug: 'bigfive50', instrumentKind: 'big_five',
        instrumentTitle: '大五人格倾向测评', packageId: 'typeme-bigfive50-zh-v1', reportContentVersion: null,
        status: 'BASE_IN_PROGRESS', revision: 2, startedAt: '2026-09-18T10:00:00Z',
        updatedAt: '2026-09-18T13:00:00Z', submittedAt: null, reportId: null,
        reportStatus: null, computedTypeCode: null, answeredCount: 9, requiredCount: 50,
      }],
      platformTotal: 2,
    }
    const { wrapper } = await mountLanding({ signedIn: true })
    const note = wrapper.find('[data-resume-note]').text()
    expect(wrapper.find('[data-resume-entry]').attributes('href')).toContain('/assess/big-five-newer')
    expect(note).toContain('另外还有 1 份没答完')
  })

  it('还有别的草稿时说清"另外还有几份"，不假装只有一份', async () => {
    server = {
      drafts: [draftSummary(), draftSummary({ attemptId: 'attempt-draft-2', updatedAt: '2026-09-17T08:00:00Z' })],
    }
    const { wrapper } = await mountLanding({ signedIn: true })

    expect(wrapper.find('[data-resume-note]').text()).toContain('另外还有 1 份没答完')
    // 续答指向最近动过的那一份
    expect(wrapper.find('[data-resume-entry]').attributes('href')).toContain(`/assess/${DRAFT_ID}`)
  })

  it('草稿列表读不到时退回普通入口，且不显示任何进度', async () => {
    server = { drafts: null }
    const { wrapper } = await mountLanding({ signedIn: true })

    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    expect(wrapper.find('[data-resume-note]').exists()).toBe(false)
    expect(wrapper.find('[data-primary-entry]').text()).toContain('开始测评')
  })

  it('详情读不到时仍然能续答，但不编造"已答几题"', async () => {
    server = { drafts: [draftSummary()], detailStatus: 500 }
    const { wrapper } = await mountLanding({ signedIn: true })

    expect(wrapper.find('[data-resume-entry]').exists()).toBe(true)
    const note = wrapper.find('[data-resume-note]').text()
    expect(note).not.toContain('已答')
    expect(note).toContain('上次答到')
  })

  it('没有草稿时不显示续答入口（不能靠"读到空列表"就编一个入口）', async () => {
    server = { drafts: [] }
    const { wrapper } = await mountLanding({ signedIn: true })

    expect(calls.some((call) => call.includes('status=draft'))).toBe(true)
    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    expect(wrapper.find('[data-primary-entry]').text()).toContain('开始测评')
  })

  it('退出登录后草稿入口必须消失（共用设备上不能留下别人的进度）', async () => {
    server = { drafts: [draftSummary()] }
    const { wrapper } = await mountLanding({ signedIn: true })
    expect(wrapper.find('[data-resume-entry]').exists()).toBe(true)

    // 换账号/退出：store 里那份草稿必须被清掉，否则下一个人看到的入口是别人的
    const assessment = useAssessmentStore()
    assessment.clearDraftEntry()
    const auth = useAuthStore()
    auth.applyAnonymous()
    await flushPromises()

    expect(wrapper.find('[data-resume-entry]').exists()).toBe(false)
    expect(wrapper.find('[data-primary-entry]').text()).toContain('开始测评')
  })
})
