// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  deriveSessionFromLegacyV2,
  LEGACY_HELP_NOTICE,
  LEGACY_LOCAL_PACKAGE_ID,
  LEGACY_STORAGE_KEY,
  LEGACY_V2_STORAGE_KEY,
  MAX_SESSION_BYTES,
  parseLegacyV2,
  parseSession,
  PREFERRED_PACKAGE_KEY,
  questionnaireSignature,
  readLegacyV1,
  readPersistedLegacyV2,
  STORAGE_KEY,
  useQuizStore,
  type LocalAssessmentSessionV3,
} from './quiz'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES } from '@/content/fallback'
import { assessmentPackageSignature, isValidAssessmentPackage, packageDimensionOrder, packageFormat } from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import type { ResponseMap } from '@/domain/answers'
import type { Questionnaire } from '@/domain/types'
import { ratingsForOffsets } from '@/dev/seed'

/**
 * 本地会话 v3 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §6，
 * 对应测试矩阵里的 STATE-01…STATE-05 与 INPUT-01/02/04/05。
 *
 * 这里钉住的核心行为：
 *   题库**内容包**快照与整包签名、数字/无法判断分开存储、位置按题号保存、
 *   存储不可用时如实反馈、旧 v2 记录只读且可显式派生、跨标签页冲突时停止覆盖、
 *   改答案即作废旧报告、自我观察不影响量表分数。
 */

const pkg = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] as AssessmentPackage

/** 站点默认包已换成 IPIP-50；本文件里断言 32 题 / 四字母 / OEJTS 旧记录的用例显式指名 OEJTS 包。 */
const OEJTS_PACKAGE_ID = 'oejts32-zh1-report2'
const oejtsPkg = FALLBACK_ASSESSMENT_PACKAGES[OEJTS_PACKAGE_ID] as AssessmentPackage

/**
 * 四维齐全、给定每维偏移的评分答案（用于构造可判型的答卷）。
 *
 * ⚠️ 只有 **OEJTS**（四维、每维 8 题）能用这个助手：`ratingsForOffsets` 要求每维正好 8 题。
 * IPIP-50 是五维、每维 10 题，要用下面的 `fullResponses`。
 */
function responsesWithOffsets(offsets: Partial<Record<'EI' | 'SN' | 'TF' | 'JP', number>>): ResponseMap {
  const ratings = ratingsForOffsets(oejtsPkg.questionnaire.questions, { EI: 0, SN: 0, TF: 0, JP: 0, ...offsets })
  return Object.fromEntries(
    Object.entries(ratings).map(([id, value]) => [id, { kind: 'rating', value }]),
  ) as ResponseMap
}

/** 与仪器无关的「每题都选同一个分」答卷：题号/题数全部由内容包推导，不写死 32 或 4。 */
function fullResponses(target: AssessmentPackage, value: 1 | 2 | 3 | 4 | 5 = 3): ResponseMap {
  return Object.fromEntries(
    target.questionnaire.questions.map((question) => [question.id, { kind: 'rating', value }]),
  ) as ResponseMap
}

function sessionOf(
  responses: ResponseMap,
  currentQuestionId = 1,
  overrides: Partial<LocalAssessmentSessionV3> = {},
): LocalAssessmentSessionV3 {
  const packageSnapshot = overrides.packageSnapshot ?? pkg
  return {
    schemaVersion: 3,
    source: 'native_v3',
    sessionId: 'session-test-1',
    packageSnapshot,
    // 签名永远按最终快照现算，避免测试自己造出"签名不匹配"的假记录
    packageSignature: assessmentPackageSignature(packageSnapshot),
    responses,
    currentQuestionId,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    submittedAt: null,
    selfReflection: {},
    ...overrides,
  }
}

function write(value: unknown) {
  localStorage.setItem(STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value))
}

function fill(store: ReturnType<typeof useQuizStore>, value: 1 | 2 | 3 | 4 | 5 = 3) {
  store.activePackage = pkg
  for (const question of pkg.questionnaire.questions) store.selectRating(question.id, value)
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('计数口径：已处理 / 已选择倾向 / 待判断 / 尚未处理', () => {
  it('三种状态分开计数，且都只统计属于本题库的题号', () => {
    const store = useQuizStore()
    store.activePackage = oejtsPkg
    store.responses = {
      1: { kind: 'rating', value: 3 },
      2: { kind: 'unknown', reason: 'unclear' },
      99: { kind: 'rating', value: 3 }, // 不属于本题库
    }
    expect(store.total).toBe(32)
    expect(store.processedCount).toBe(2)
    expect(store.ratingCount).toBe(1)
    expect(store.unknownCount).toBe(1)
    expect(store.unansweredCount).toBe(30)
    expect(store.missingCount).toBe(30)
    expect(store.isProcessed).toBe(false)
    expect(store.progressRatio).toBeCloseTo(2 / 32, 5)
  })

  it('未知题号不会让 missingCount 变成负数', () => {
    const store = useQuizStore()
    store.activePackage = oejtsPkg
    store.responses = { ...responsesWithOffsets({}), 999: { kind: 'rating', value: 3 } }
    expect(store.processedCount).toBe(32)
    expect(store.unansweredCount).toBe(0)
    expect(store.isProcessed).toBe(true)
  })
})

describe('STATE-01 刷新恢复（数字 + 无法判断混合）', () => {
  it('恢复到同一题号、同一内容包快照、同样的混合作答', () => {
    const responses = responsesWithOffsets({ EI: -12, SN: 8 })
    delete responses[3]
    responses[3] = { kind: 'unknown', reason: 'no_experience' }
    write(sessionOf(responses, 13, { packageSnapshot: oejtsPkg }))

    const store = useQuizStore()
    expect(store.restore()).toBe(true)

    expect(store.processedCount).toBe(32)
    expect(store.unknownCount).toBe(1)
    expect(store.ratingCount).toBe(31)
    expect(store.currentQuestionId).toBe(13)
    expect(store.currentIndex).toBe(12)
    expect(store.responses[3]).toEqual({ kind: 'unknown', reason: 'no_experience' })
    expect(store.activePackage?.packageId).toBe(oejtsPkg.packageId)
    expect(assessmentPackageSignature(store.activePackage!)).toBe(assessmentPackageSignature(oejtsPkg))
    expect(store.resumed).toBe(true)
    // 无法判断的题目让该维信息不足，而不是被填成 3 分
    const ei = store.analysis?.dimensions.find((item) => item.dimension === 'EI')!
    expect(ei.status).toBe('insufficient')
    expect(ei.score).toBeNull()
  })

  it('位置按**题号**保存，题库顺序变化也能定位到同一道题', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.goToId(20)
    expect(store.currentQuestionId).toBe(20)
    expect(store.currentIndex).toBe(19)
    expect(store.currentQuestion?.id).toBe(20)
  })

  it('一条完整会话（含整包快照）必须能装进 128KiB 上限', () => {
    // 用**当前默认包**（IPIP-50）算：快照体积由默认包决定，与仪器无关。
    const payload = JSON.stringify(sessionOf(fullResponses(pkg)))
    expect(payload.length).toBeLessThan(MAX_SESSION_BYTES)
    // 上限本身不能大到失去意义：整包快照就是主要体积来源
    expect(payload.length).toBeGreaterThan(10_000)
  })
})

describe('STATE-02 存储不可用', () => {
  it('setItem 抛错时仍可作答，且 status 如实标为 unavailable', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    store.selectRating(1, 3)
    expect(store.responses[1]).toEqual({ kind: 'rating', value: 3 })
    expect(store.storageStatus).toBe('unavailable')
    expect(store.storageUnavailable).toBe(true)
    expect(store.storageError).toContain('无法保存进度')
    spy.mockRestore()
  })

  it('写进去的记录必须能被自己读回来（写读同口径）', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    store.selectRating(1, 3)
    expect(store.storageStatus).toBe('ok')
    expect(spy).toHaveBeenCalled()
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const reparsed = parseSession(raw)
    expect(reparsed.error).toBeNull()
    expect(reparsed.session!.responses[1]).toEqual({ kind: 'rating', value: 3 })
    spy.mockRestore()
  })
})

describe('STATE-03 坏数据不假装恢复成功', () => {
  it('坏 JSON / 非对象 / 超限记录都返回可读错误且不抛错', () => {
    expect(parseSession('{oops').session).toBeNull()
    expect(parseSession('{oops').error).toContain('JSON')
    expect(parseSession('"a string"').session).toBeNull()
    expect(parseSession('x'.repeat(MAX_SESSION_BYTES + 1)).error).toContain('大小上限')
  })

  it('schemaVersion 不是 3 的记录不会被当成 v3（v2 记录另有入口）', () => {
    const asV2 = { ...sessionOf({ 1: { kind: 'rating', value: 3 } }), schemaVersion: 2 }
    const parsed = parseSession(JSON.stringify(asV2))
    expect(parsed.session).toBeNull()
    expect(parsed.error).toContain('版本不是 3')
  })

  it('来源标识 / 会话标识 / 时间戳不合法都被拒绝', () => {
    const badSource = { ...sessionOf({}), source: 'from-nowhere' }
    expect(parseSession(JSON.stringify(badSource)).session).toBeNull()
    const noId = { ...sessionOf({}), sessionId: '' }
    expect(parseSession(JSON.stringify(noId)).error).toContain('会话标识')
    const badTime = { ...sessionOf({}), startedAt: 0 }
    expect(parseSession(JSON.stringify(badTime)).error).toContain('时间戳')
  })

  it('坏掉的内容包快照会被拒绝（不信任任意快照）', () => {
    const broken = { ...sessionOf({}), packageSnapshot: { ...pkg, itemHelp: {} } }
    expect(parseSession(JSON.stringify(broken)).session).toBeNull()
    const noConstants = {
      ...sessionOf({}),
      packageSnapshot: {
        ...pkg,
        questionnaire: { ...pkg.questionnaire, scoring: { midpoint: 24, constants: {} } },
      },
    }
    expect(parseSession(JSON.stringify(noConstants)).session).toBeNull()
  })

  it('整包签名不匹配（帮助被改过）会被拒绝', () => {
    const tampered: AssessmentPackage = {
      ...pkg,
      itemHelp: {
        ...pkg.itemHelp,
        1: { ...pkg.itemHelp['1'], explanation: `${pkg.itemHelp['1'].explanation}（被改过）` },
      },
    }
    const parsed = parseSession(JSON.stringify({ ...sessionOf({}), packageSnapshot: tampered }))
    expect(parsed.session).toBeNull()
    expect(parsed.error).toContain('签名')
  })

  it('损坏的回答被丢弃并计数，其余合法回答保留；坏值不会被当成 unknown', () => {
    const raw = {
      ...sessionOf({}),
      responses: {
        1: { kind: 'rating', value: 3 },
        2: { kind: 'rating', value: 9 },
        3: { kind: 'nonsense' },
        4: { kind: 'unknown', reason: 'not-a-reason' },
        5: '3',
        999: { kind: 'rating', value: 3 },
      },
    }
    const parsed = parseSession(JSON.stringify(raw))
    expect(parsed.session).not.toBeNull()
    expect(parsed.dropped).toBe(3) // 2 / 3 / 999
    expect(Object.keys(parsed.session!.responses).sort()).toEqual(['1', '4', '5'])
    expect(parsed.session!.responses[1]).toEqual({ kind: 'rating', value: 3 })
    // 非法 reason 收敛成 null，而不是丢掉整条或算成评分
    expect(parsed.session!.responses[4]).toEqual({ kind: 'unknown', reason: null })
    // 历史字符串 '3' 被显式适配成评分（旧数据兼容）
    expect(parsed.session!.responses[5]).toEqual({ kind: 'rating', value: 3 })
    // 没有任何被丢弃的条目变成 unknown
    expect(Object.values(parsed.session!.responses).filter((item) => item.kind === 'unknown')).toHaveLength(1)
  })

  it('当前题号不是本题库的题时，回落到一个合法题号', () => {
    const parsed = parseSession(JSON.stringify(sessionOf({}, 999)))
    expect(parsed.session!.currentQuestionId).toBe(pkg.questionnaire.questions[0].id)
  })
})

describe('STATE-04 内容包变化', () => {
  it('草稿继续使用保存的合法快照，而不是被新内容替换', () => {
    const snapshot: AssessmentPackage = { ...pkg, title: '草稿当时的标题' }
    write(sessionOf({ 1: { kind: 'rating', value: 3 } }, 1, { packageSnapshot: snapshot }))
    const store = useQuizStore()
    // 先装载一份"新内容"（模拟服务端已更新）
    store.activePackage = { ...pkg, title: '服务端的新标题' }
    expect(store.restore()).toBe(true)
    expect(store.activePackage?.title).toBe('草稿当时的标题')
  })

  it('没有同 ID 内置副本时 selectPackage 失败并给出可读原因', async () => {
    const store = useQuizStore()
    expect(await store.selectPackage('nope-not-registered')).toBe(false)
    expect(store.loadError).toContain('暂不可用')
  })

  it('已有作答时不允许切换内容版本（避免半新半旧的会话）', async () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 3)
    expect(await store.selectPackage('oejts32-zh2-preview-r1')).toBe(false)
    expect(store.responses[1]).toEqual({ kind: 'rating', value: 3 })
  })

  it('空会话下可以切换到另一个内置包', async () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 3)
    store.reset()
    expect(await store.selectPackage('oejts32-zh2-preview-r1')).toBe(true)
    expect(store.packageId).toBe('oejts32-zh2-preview-r1')
    expect(Object.keys(store.responses)).toHaveLength(0)
  })
})

/**
 * 内容版本偏好（`typeme.package.v1`）。
 *
 * 站点默认量表换成 IPIP-50 之后，首页的版本选择不再只是「本次试用」：
 * 用户切到可选旧版本、还没答第一题就刷新时，如果偏好只存在内存里，
 * 页面会**在没有提示的情况下换回另一份题目**。这一组把偏好钉住。
 */
describe('内容版本偏好：选过哪一版，刷新后还是哪一版', () => {
  it('切换内容版本会写下偏好键；不指定包 ID 的 load() 读回这一版', async () => {
    const store = useQuizStore()
    store.activePackage = pkg
    expect(await store.selectPackage('oejts32-zh1-report2')).toBe(true)
    expect(localStorage.getItem(PREFERRED_PACKAGE_KEY)).toBe('oejts32-zh1-report2')

    // 新的一页（新 store、同一份 localStorage）
    setActivePinia(createPinia())
    const revived = useQuizStore()
    expect(revived.preferredPackageId).toBe('oejts32-zh1-report2')
    expect(revived.activePackage).toBeNull()
    await revived.load()
    expect(revived.packageId).toBe('oejts32-zh1-report2')
    expect(revived.total).toBe(32)
    expect(revived.loadError).toBeNull()
  })

  it('没有偏好时回到站点默认包，偏好不会被前一次测试或旧版本带偏', async () => {
    const store = useQuizStore()
    expect(store.preferredPackageId).toBeNull()
    await store.load()
    expect(store.packageId).toBe(DEFAULT_PACKAGE_ID)
    expect(store.packageId).toBe('ipip50-zh1')
  })

  it('认不出来的偏好（旧版本残留 / 被人手改）被忽略，仍然装默认包', async () => {
    localStorage.setItem(PREFERRED_PACKAGE_KEY, 'oejts16-zh1-不存在的包')
    const store = useQuizStore()
    expect(store.preferredPackageId).toBeNull()
    await store.load()
    expect(store.packageId).toBe(DEFAULT_PACKAGE_ID)
    expect(store.loadError).toBeNull()
  })

  it('显式传入包 ID 时优先于偏好（调用方明确指定就不该被本地偏好覆盖）', async () => {
    localStorage.setItem(PREFERRED_PACKAGE_KEY, 'oejts32-zh1-report2')
    const store = useQuizStore()
    await store.load('ipip50-zh1')
    expect(store.packageId).toBe('ipip50-zh1')
  })

  it('恢复会话时把会话里的量表同步成偏好（答完刷新仍是同一版）', () => {
    write(sessionOf({ 1: { kind: 'rating', value: 3 } }, 1, { packageSnapshot: oejtsPkg }))
    const store = useQuizStore()
    expect(store.restore()).toBe(true)
    expect(store.packageId).toBe('oejts32-zh1-report2')
    expect(localStorage.getItem(PREFERRED_PACKAGE_KEY)).toBe('oejts32-zh1-report2')
  })

  it('派生会话用的本地临时包 ID 不写进偏好（不冲掉有效选择）', () => {
    const derived = { ...oejtsPkg, packageId: LEGACY_LOCAL_PACKAGE_ID }
    write(sessionOf({ 1: { kind: 'rating', value: 3 } }, 1, { packageSnapshot: derived }))
    localStorage.setItem(PREFERRED_PACKAGE_KEY, 'ipip50-zh1')
    const store = useQuizStore()
    expect(store.restore()).toBe(true)
    expect(store.packageId).toBe(LEGACY_LOCAL_PACKAGE_ID)
    expect(localStorage.getItem(PREFERRED_PACKAGE_KEY)).toBe('ipip50-zh1')
  })

  it('清除本地记录会连偏好一起清掉，之后回到默认量表', async () => {
    const store = useQuizStore()
    store.activePackage = pkg
    await store.selectPackage('oejts32-zh1-report2')
    expect(localStorage.getItem(PREFERRED_PACKAGE_KEY)).not.toBeNull()

    store.clearPreferredPackage()
    expect(localStorage.getItem(PREFERRED_PACKAGE_KEY)).toBeNull()
    expect(store.preferredPackageId).toBeNull()
  })

  it('偏好键不含任何作答内容，且与 v3 会话键互不影响', async () => {
    const store = useQuizStore()
    store.activePackage = pkg
    await store.selectPackage('oejts32-zh1-report2')
    const raw = localStorage.getItem(PREFERRED_PACKAGE_KEY)
    expect(raw).toBe('oejts32-zh1-report2')
    expect(raw).not.toContain('responses')
    // 切换版本会清掉旧会话，但偏好键仍然在
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('STATE-05 旧版记录：只读识别 + 显式派生', () => {
  it('v1 只识别不迁移、不删除', () => {
    localStorage.setItem(
      LEGACY_STORAGE_KEY,
      JSON.stringify({ version: 'quick', answers: { 1: 3, 2: 4 }, currentIndex: 2, startedAt: 1, updatedAt: 1 }),
    )
    const store = useQuizStore()
    store.activePackage = pkg
    store.detectLegacy()
    expect(store.legacyV1?.answeredCount).toBe(2)
    store.restore()
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).not.toBeNull()
    expect(Object.keys(store.responses)).toHaveLength(0)
    expect(readLegacyV1()?.answeredCount).toBe(2)
    store.dropLegacyV1()
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
  })

  it('v2 记录被识别但不自动迁移，原键保留', () => {
    const v2 = {
      schemaVersion: 2,
      questionnaire: pkg.questionnaire,
      questionnaireSignature: questionnaireSignature(pkg.questionnaire),
      answers: Object.fromEntries(pkg.questionnaire.questions.map((question) => [question.id, 3])),
      currentQuestionId: 5,
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      completedAt: null,
      reportProfile: null,
    }
    localStorage.setItem(LEGACY_V2_STORAGE_KEY, JSON.stringify(v2))
    const store = useQuizStore()
    store.activePackage = pkg
    store.detectLegacy()
    expect(store.legacyV2).not.toBeNull()
    expect(store.canMigrateLegacyV2).toBe(true)
    // 没有自动迁移：新会话里没有任何作答
    expect(Object.keys(store.responses)).toHaveLength(0)
    expect(localStorage.getItem(LEGACY_V2_STORAGE_KEY)).not.toBeNull()
  })

  it('派生会话沿用**当时的题面**、使用通用帮助、并且可被 v3 校验通过', () => {
    const legacyQuestionnaire: Questionnaire = {
      ...oejtsPkg.questionnaire,
      // 历史题面与当前不同：派生会话必须保留历史那一份
      questions: oejtsPkg.questionnaire.questions.map((question) =>
        question.id === 1 ? { ...question, textLeft: '历史版本的左端描述' } : question,
      ),
    }
    const legacy = {
      questionnaire: legacyQuestionnaire,
      questionnaireSignature: questionnaireSignature(legacyQuestionnaire),
      answers: { 1: 3, 2: 4, 3: 2 },
      currentQuestionId: 2,
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      completedAt: null,
    }
    const parsed = parseLegacyV2(JSON.stringify({ schemaVersion: 2, ...legacy }))
    expect(parsed.session).not.toBeNull()
    const derived = deriveSessionFromLegacyV2(parsed.session!, oejtsPkg)

    expect(derived.source).toBe('legacy_v2')
    expect(derived.packageSnapshot.packageId).toBe(LEGACY_LOCAL_PACKAGE_ID)
    expect(derived.packageSnapshot.questionnaire.questions[0].textLeft).toBe('历史版本的左端描述')
    // 帮助是通用说明，不编造专门释义
    expect(derived.packageSnapshot.itemHelp['1'].explanation).toBe(LEGACY_HELP_NOTICE)
    expect(Object.keys(derived.packageSnapshot.itemHelp)).toHaveLength(32)
    // 维度解释与报告文案用新版政策
    expect(derived.packageSnapshot.reportCopy).toEqual(oejtsPkg.reportCopy)
    expect(derived.packageSnapshot.interpretation).toEqual(oejtsPkg.interpretation)
    // 只有 3 题有答案 → 各维信息不足，但会话本身合法
    expect(derived.responses[1]).toEqual({ kind: 'rating', value: 3 })
    expect(derived.responses[4]).toBeUndefined()
    expect(assessmentPackageSignature(derived.packageSnapshot)).toBe(
      derived.packageSignature,
    )
  })

  it('派生包本身也满足 v3 的包校验（否则恢复时会整条丢弃）', () => {
    const derived = deriveSessionFromLegacyV2(
      {
        questionnaire: pkg.questionnaire,
        questionnaireSignature: questionnaireSignature(pkg.questionnaire),
        answers: { 1: 3 },
        currentQuestionId: 1,
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        completedAt: null,
      },
      pkg,
    )
    // 本地派生包是迁移特例：不参与服务端注册表校验，但结构必须自洽
    expect(isValidAssessmentPackage(derived.packageSnapshot)).toBe(true)
    const reparsed = parseSession(JSON.stringify(derived))
    expect(reparsed.session).not.toBeNull()
    expect(reparsed.error).toBeNull()
  })

  it('migrateLegacyV2 写入 v3 且不动 v2 键；无法解析时返回 false', () => {
    localStorage.setItem(
      LEGACY_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: oejtsPkg.questionnaire,
        questionnaireSignature: questionnaireSignature(oejtsPkg.questionnaire),
        answers: Object.fromEntries(oejtsPkg.questionnaire.questions.map((question) => [question.id, 3])),
        currentQuestionId: 7,
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        completedAt: 1_700_000_100_000,
      }),
    )
    const store = useQuizStore()
    store.activePackage = oejtsPkg
    store.detectLegacy()
    expect(store.migrateLegacyV2()).toBe(true)
    expect(store.sessionSource).toBe('legacy_v2')
    expect(store.processedCount).toBe(32)
    expect(store.submittedAt).not.toBeNull()
    expect(store.currentQuestionId).toBe(7)
    expect(localStorage.getItem(LEGACY_V2_STORAGE_KEY)).not.toBeNull()
    expect(parseSession(localStorage.getItem(STORAGE_KEY)!).session).not.toBeNull()

    // 坏签名 → 不迁移
    localStorage.removeItem(STORAGE_KEY)
    localStorage.setItem(
      LEGACY_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: oejtsPkg.questionnaire,
        questionnaireSignature: 'tampered',
        answers: { 1: 3 },
        currentQuestionId: 1,
        startedAt: 1,
        updatedAt: 1,
        completedAt: null,
      }),
    )
    const store2 = useQuizStore()
    store2.activePackage = oejtsPkg
    store2.detectLegacy()
    expect(store2.legacyV2).toBeNull()
    expect(store2.migrateLegacyV2()).toBe(false)
  })

  it('readPersistedLegacyV2 与 parseLegacyV2 共用同一口径', () => {
    expect(readPersistedLegacyV2().session).toBeNull()
    localStorage.setItem(
      LEGACY_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: pkg.questionnaire,
        questionnaireSignature: questionnaireSignature(pkg.questionnaire),
        answers: { 1: 3 },
        currentQuestionId: 1,
        startedAt: 1,
        updatedAt: 1,
        completedAt: null,
      }),
    )
    expect(readPersistedLegacyV2().session).not.toBeNull()
  })
})

describe('STATE-06 跨标签页冲突', () => {
  it('v3 冲突时禁止写入与交卷，载入最新后恢复', () => {
    write(sessionOf(fullResponses(pkg), 2))
    const store = useQuizStore()
    store.activePackage = pkg
    store.restore()
    expect(store.writesBlocked).toBe(false)

    store.flagExternalChange()
    expect(store.externalChange).toBe(true)
    expect(store.writesBlocked).toBe(true)

    const before = localStorage.getItem(STORAGE_KEY)
    store.selectRating(5, 4)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)

    store.loadLatest()
    expect(store.writesBlocked).toBe(false)
  })

  it('绑定 storage 事件后：v3 改动标记冲突，v2 改动只提示"存在另一版会话"', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    const unbind = store.bindStorageSync()

    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEY, newValue: JSON.stringify(sessionOf({})) }),
    )
    expect(store.externalChange).toBe(true)
    expect(store.writesBlocked).toBe(true)

    // 载入最新进度后才解除冲突（storageStatus 也要一起恢复）
    store.loadLatest()
    expect(store.writesBlocked).toBe(false)

    // 旧客户端写入 v2：只提示"存在另一版会话"，**不**让本页停止保存
    window.dispatchEvent(
      new StorageEvent('storage', { key: LEGACY_V2_STORAGE_KEY, newValue: '{"schemaVersion":2}' }),
    )
    expect(store.legacyV2External).toBe(true)
    expect(store.externalChange).toBe(false)
    expect(store.writesBlocked).toBe(false)

    store.legacyV2External = false
    window.dispatchEvent(new StorageEvent('storage', { key: 'other-app', newValue: 'x' }))
    expect(store.legacyV2External).toBe(false)
    unbind()
  })
})

describe('STATE-07 改答案即作废旧报告', () => {
  it('selectRating / selectUnknown 都清空提交状态', () => {
    const store = useQuizStore()
    fill(store)
    expect(store.isProcessed).toBe(true)
    expect(store.submit()).toBe(true)
    expect(store.hasReport).toBe(true)
    const before = store.reportId

    store.selectRating(3, 2)
    expect(store.submittedAt).toBeNull()
    expect(store.hasReport).toBe(false)
    expect(store.reportId).not.toBe(before)

    store.submit()
    const afterRating = store.reportId
    store.selectUnknown(3, 'unclear')
    expect(store.submittedAt).toBeNull()
    expect(store.reportId).not.toBe(afterRating)
  })

  it('submit 在没有处理完时拒绝（不隐式补答）', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 3)
    expect(store.submit()).toBe(false)
    expect(store.submittedAt).toBeNull()
  })

  it('数字与无法判断是原子替换，不可能同时存在', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 3)
    store.selectUnknown(1, 'not_applicable')
    expect(store.responses[1]).toEqual({ kind: 'unknown', reason: 'not_applicable' })
    store.selectRating(1, 5)
    expect(store.responses[1]).toEqual({ kind: 'rating', value: 5 })
    expect(store.ratingCount).toBe(1)
    expect(store.unknownCount).toBe(0)
  })

  it('非法评分与未知题号被忽略', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.selectRating(1, 9)
    store.selectRating(999, 3)
    store.selectUnknown(999, 'unclear')
    expect(Object.keys(store.responses)).toHaveLength(0)
  })
})

describe('STATE-05（自我观察）不改量表分数', () => {
  it('saveSelfReflection 只更新独立区域；responses 与报告指纹不变', () => {
    const store = useQuizStore()
    fill(store)
    store.submit()
    const responsesBefore = JSON.stringify(store.responses)
    const reportBefore = store.reportId

    // 维度取**当前内容包**的维度（`fill` 装的是默认的大五包 E/A/C/ES/O）
    store.saveSelfReflection('O', '高')
    expect(store.selfReflection.O?.preference).toBe('高')
    expect(JSON.stringify(store.responses)).toBe(responsesBefore)
    expect(store.reportId).toBe(reportBefore)

    store.saveSelfReflection('O', null)
    expect(store.selfReflection.O?.preference).toBeNull()
    expect(store.reportId).toBe(reportBefore)

    store.clearSelfReflection()
    expect(Object.keys(store.selfReflection)).toHaveLength(0)
    expect(store.reportId).toBe(reportBefore)
  })

  it('不是当前内容包的维度会被忽略（不许把 OEJTS 的 SN 写进大五会话）', () => {
    const store = useQuizStore()
    fill(store)
    expect(packageDimensionOrder(store.activePackage!)).toEqual(['E', 'A', 'C', 'ES', 'O'])

    store.saveSelfReflection('SN', 'N')
    store.saveSelfReflection('EI', 'I')
    expect(store.selfReflection).toEqual({})

    // 换成 OEJTS 包之后，同一对键就是合法的（门槛跟包走，而不是跟包无关的常量表走）
    store.activePackage = oejtsPkg
    store.saveSelfReflection('SN', 'N')
    expect(store.selfReflection.SN?.preference).toBe('N')
  })

  it('自我观察会被保存并随会话恢复', () => {
    const store = useQuizStore()
    fill(store)
    store.saveSelfReflection('E', '低')

    setActivePinia(createPinia())
    const fresh = useQuizStore()
    expect(fresh.restore()).toBe(true)
    expect(fresh.selfReflection.E?.preference).toBe('低')
  })

  it('大五会话里的自我观察在刷新后仍然恢复（token 是「低/高」，不是字母）', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    for (const question of pkg.questionnaire.questions) store.selectRating(question.id, 4)
    store.submit()
    const rows = store.report!.dimensionRows
    expect(rows.map((row) => row.lowToken)).toEqual(['低', '低', '低', '低', '低'])

    for (const row of rows) store.saveSelfReflection(row.dimension, row.highToken)

    setActivePinia(createPinia())
    const fresh = useQuizStore()
    expect(fresh.restore()).toBe(true)
    for (const row of rows) {
      expect(fresh.selfReflection[row.dimension]?.preference).toBe('高')
    }
  })
})

describe('清除本地记录（PRIV-02）', () => {
  it('只删除 TypeMe 自己的键，不执行 localStorage.clear()', () => {
    localStorage.setItem('other-app-key', 'keep-me')
    write(sessionOf({ 1: { kind: 'rating', value: 3 } }))
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ version: 'quick', answers: { 1: 3 } }))
    localStorage.setItem(LEGACY_V2_STORAGE_KEY, JSON.stringify({ schemaVersion: 2 }))

    const store = useQuizStore()
    store.activePackage = pkg
    store.restore()
    store.clearSession()
    store.dropLegacyV1()
    store.dropLegacyV2()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_V2_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('other-app-key')).toBe('keep-me')
  })

  it('没有任何作答时不留下空会话键', () => {
    const store = useQuizStore()
    store.activePackage = pkg
    store.persist()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

/**
 * 站点默认内容包已从 OEJTS-32 换成 **IPIP-50 大五**。
 *
 * 这一组把新默认钉住：不指定包 ID 时装的是谁、题数与维度顺序、作答格式、
 * 为它写下的 v3 会话能否原样恢复，以及「OEJTS 旧记录不会被悄悄套上 IPIP 模板」。
 */
describe('新默认包：IPIP-50 大五（无类型码）', () => {
  it('不指定包 ID 时装载站点默认包 ipip50-zh1；题数 50、维度顺序 E/A/C/ES/O', async () => {
    const store = useQuizStore()
    await store.load()
    expect(store.packageId).toBe(DEFAULT_PACKAGE_ID)
    expect(store.packageId).toBe('ipip50-zh1')
    expect(DEFAULT_PACKAGE_ID).toBe('ipip50-zh1')
    expect(store.total).toBe(50)
    expect(packageDimensionOrder(store.activePackage!)).toEqual(['E', 'A', 'C', 'ES', 'O'])
  })

  it('默认包的作答格式是 agreement（单句贴切度），不再是 OEJTS 的双极选择', async () => {
    const store = useQuizStore()
    await store.load()
    expect(packageFormat(store.activePackage!)).toBe('agreement')
    expect(store.activePackage?.instrument.format).toBe('agreement')
  })

  it('为 IPIP 写下的 v3 会话原样恢复：同一份快照、同一个整包签名', () => {
    write(sessionOf(fullResponses(pkg), 7))
    const store = useQuizStore()
    expect(store.restore()).toBe(true)
    expect(store.packageId).toBe('ipip50-zh1')
    expect(store.total).toBe(50)
    expect(store.processedCount).toBe(50)
    expect(store.ratingCount).toBe(50)
    expect(store.droppedResponses).toBe(0)
    expect(store.currentQuestionId).toBe(7)
    expect(store.activePackage?.packageId).toBe(pkg.packageId)
    expect(assessmentPackageSignature(store.activePackage!)).toBe(assessmentPackageSignature(pkg))
    expect(store.resumed).toBe(true)
  })

  it('OEJTS 旧记录派生时保留 OEJTS 题面；拿 IPIP 默认包当模板会产出不合法快照（被 v3 拒绝）', () => {
    const parsed = parseLegacyV2(
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: oejtsPkg.questionnaire,
        questionnaireSignature: questionnaireSignature(oejtsPkg.questionnaire),
        answers: { 1: 3, 2: 4, 3: 2 },
        currentQuestionId: 2,
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        completedAt: null,
      }),
    )
    expect(parsed.session).not.toBeNull()

    // ① 用 OEJTS 包当模板：派生包保留当时的 32 题 OEJTS 题面，能被 v3 校验并通过恢复
    const withOejts = deriveSessionFromLegacyV2(parsed.session!, oejtsPkg)
    expect(withOejts.packageSnapshot.packageId).toBe(LEGACY_LOCAL_PACKAGE_ID)
    expect(withOejts.packageSnapshot.questionnaire.version).toBe('quick')
    expect(withOejts.packageSnapshot.questionnaire.questions).toHaveLength(32)
    expect(packageDimensionOrder(withOejts.packageSnapshot)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(isValidAssessmentPackage(withOejts.packageSnapshot)).toBe(true)
    expect(parseSession(JSON.stringify(withOejts)).session).not.toBeNull()

    // ② 用默认的 IPIP 包当模板：题面仍是 OEJTS，但仪器/题数/文案是 IPIP →
    //    整包不合法，parseSession 整条拒绝（不把 OEJTS 旧记录悄悄塞进 IPIP 默认包）
    const withIpip = deriveSessionFromLegacyV2(parsed.session!, pkg)
    expect(withIpip.packageSnapshot.questionnaire.version).toBe('quick')
    expect(withIpip.packageSnapshot.questionnaire.questions).toHaveLength(32)
    expect(isValidAssessmentPackage(withIpip.packageSnapshot)).toBe(false)
    const rejected = parseSession(JSON.stringify(withIpip))
    expect(rejected.session).toBeNull()
    expect(rejected.error).toContain('内容包')
  })

  it('IPIP 自己的 v2 记录（自带 IPIP 题面）在默认包下仍可派生并通过 v3 校验', () => {
    const parsed = parseLegacyV2(
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: pkg.questionnaire,
        questionnaireSignature: questionnaireSignature(pkg.questionnaire),
        answers: { 1: 3, 2: 4 },
        currentQuestionId: 1,
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        completedAt: null,
      }),
    )
    // 真实行为：v2 记录自带题面与签名，IPIP 题面本身是合法题库，因此**不**被拒绝
    expect(parsed.session).not.toBeNull()
    const derived = deriveSessionFromLegacyV2(parsed.session!, pkg)
    expect(derived.packageSnapshot.packageId).toBe(LEGACY_LOCAL_PACKAGE_ID)
    expect(derived.packageSnapshot.questionnaire.version).toBe('ipip50')
    expect(derived.packageSnapshot.questionnaire.questions).toHaveLength(50)
    expect(packageDimensionOrder(derived.packageSnapshot)).toEqual(['E', 'A', 'C', 'ES', 'O'])
    expect(isValidAssessmentPackage(derived.packageSnapshot)).toBe(true)
    expect(parseSession(JSON.stringify(derived)).session).not.toBeNull()
  })

  it('默认包是 IPIP 时，OEJTS 的 v2 记录不会被静默迁移进新会话', () => {
    localStorage.setItem(
      LEGACY_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        questionnaire: oejtsPkg.questionnaire,
        questionnaireSignature: questionnaireSignature(oejtsPkg.questionnaire),
        answers: { 1: 3, 2: 4 },
        currentQuestionId: 1,
        startedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        completedAt: null,
      }),
    )
    const store = useQuizStore()
    store.activePackage = pkg
    store.detectLegacy()
    expect(store.legacyV2).not.toBeNull()
    expect(store.canMigrateLegacyV2).toBe(true)
    // 模板是 IPIP、旧题面是 OEJTS → 派生包不合法，迁移失败且不写 v3（旧键保留）
    expect(store.migrateLegacyV2()).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_V2_STORAGE_KEY)).not.toBeNull()
  })
})

/**
 * 内容包**接口路径**（`source === 'api'`）。
 *
 * 这一组补的是真空中最贵的一类缺陷：接口返回 200、JSON 也"看起来对"，
 * 但因为契约校验把显式 `null` 当成声明值，整包被判非法 → 页面静默降级到内置副本，
 * 服务端内容一次都没被用上（浏览器验收里表现为「一直 fallback」）。
 * 单元测试在这里喂一份**Jackson 线上形态**（缺省字段 = 显式 null）的包。
 */
describe('内容包接口路径：线上形态（显式 null）必须被真正采用', () => {
  /** 把内置包改写成服务端序列化出来的形态。 */
  function wireForm(packageId: string): Record<string, unknown> {
    const clone = structuredClone(FALLBACK_ASSESSMENT_PACKAGES[packageId]) as unknown as Record<
      string,
      unknown
    >
    const questionnaire = clone.questionnaire as Record<string, unknown>
    const instrument = clone.instrument as Record<string, unknown>
    questionnaire.format = questionnaire.format ?? null
    questionnaire.responseAnchors = questionnaire.responseAnchors ?? null
    questionnaire.dimensionOrder = questionnaire.dimensionOrder ?? null
    instrument.format = instrument.format ?? null
    instrument.hasTypeCode = instrument.hasTypeCode ?? null
    for (const question of questionnaire.questions as Record<string, unknown>[]) {
      question.text = question.text ?? null
      question.textLeft = question.textLeft ?? null
      question.textRight = question.textRight ?? null
    }
    return clone
  }

  it.each([DEFAULT_PACKAGE_ID, OEJTS_PACKAGE_ID])(
    '%s：接口 200 + 显式 null → packageSource 是 api（不是悄悄降级的 fallback）',
    async (packageId) => {
      const payload = wireForm(packageId)
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      try {
        const store = useQuizStore()
        await store.load(packageId)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(store.loadError).toBeNull()
        expect(store.packageId).toBe(packageId)
        expect(store.packageSource, '接口形态合法时必须采用服务端内容').toBe('api')
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )

  it('接口形态与内置形态装载出的包完全一致（签名相同，判型不会因来源而变）', async () => {
    const payload = wireForm(DEFAULT_PACKAGE_ID)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    try {
      const store = useQuizStore()
      await store.load(DEFAULT_PACKAGE_ID)
      const fromApi = store.activePackage!
      const builtin = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID] as AssessmentPackage
      expect(assessmentPackageSignature(fromApi)).toBe(assessmentPackageSignature(builtin))
      expect(packageDimensionOrder(fromApi)).toEqual(packageDimensionOrder(builtin))
      expect(packageFormat(fromApi)).toBe('agreement')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('接口返回另一个包的 ID 时仍然降级，不会把 B 的题面贴到 A 上', async () => {
    const payload = wireForm(OEJTS_PACKAGE_ID)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    try {
      const store = useQuizStore()
      await store.load(DEFAULT_PACKAGE_ID)
      expect(store.packageId).toBe(DEFAULT_PACKAGE_ID)
      expect(store.packageSource).toBe('fallback')
      expect(store.total).toBe(50)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
