import { defineStore } from 'pinia'
import type { Dimension, Pole, Question, Questionnaire } from '@/domain/types'
import { fetchAssessmentPackage, builtinAssessmentPackage } from '@/api/client'
import { isValidQuestionnaire } from '@/domain/questionnaire'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import {
  assessmentPackageProblems,
  assessmentPackageSignature,
  isValidAssessmentPackage,
  packageDimensionOrder,
  poleTokensOf,
} from '@/domain/assessmentPackage'
import {
  coerceAnswerValue,
  isCorruptResponse,
  isValidAnswerValue,
  normalizeAnswers,
  normalizeResponses,
  responseState,
  UNKNOWN_REASONS,
  type Response,
  type ResponseMap,
  type UnknownReason,
} from '@/domain/answers'
import { analyzeAssessment, AssessmentError } from '@/domain/assessment'
import type { AssessmentAnalysis } from '@/domain/assessment'
import { buildReportViewModel, reportIdOf } from '@/domain/report'
import type { ReportViewModel } from '@/domain/report'
import { canScore, ScoringError } from '@/domain/scoring'
import { DEFAULT_PACKAGE_ID, FALLBACK_ASSESSMENT_PACKAGES } from '@/content/fallback'
import type { ContentSource } from '@/domain/contentTypes'

/**
 * 答题会话 v3 —— `docs/2026-09-15/TypeMe-测评可信度调整-开发方案.md` §6。
 *
 * 与 v2 的关键差异：
 *   1. 会话里保存的是**整个 v2 内容包快照**（题面 + 帮助 + 维度解释 + 报告文案 + 解释政策），
 *      签名覆盖整个快照 —— 只改帮助也会让签名变化，因此不会「用新帮助解释旧作答」；
 *   2. 回答是 `ResponseMap`：数字评分与「暂时无法判断」分开存储，**损坏值不会被算成中立 3**；
 *   3. 报告不再缓存「类型文案快照」，而是每次从回答重建维度分析与展示模型 ——
 *      旧的政策不再有权威性，也就不可能把旧结论泄漏到新报告里；
 *   4. 旧 v2 记录**只读**：可以显式派生成本地迁移会话（原题面 + 新解释政策），
 *      原键保留不删；旧 v1 记录仍然只识别、不迁移。
 */

export const STORAGE_KEY = 'typeme.quiz.v3'
/**
 * 「上次选的内容版本」偏好键。
 *
 * 与作答会话分开存：会话（v3）是**一次作答**的快照，偏好是**这台设备的选择**。
 * 分开的理由是刷新恢复：用户在第一题之前切到可选旧版本，还没有任何作答、
 * 因此没有会话可恢复，如果只存在内存里，一刷新就悄悄回到站点默认量表 ——
 * 那等于在没有提示的情况下换掉了题目。
 */
export const PREFERRED_PACKAGE_KEY = 'typeme.package.v1'
/** 旧版 v2 键：只读，只在用户显式清除时删除。 */
export const LEGACY_V2_STORAGE_KEY = 'typeme.quiz.v2'
/** 更早的 v1 键：只识别不迁移。 */
export const LEGACY_STORAGE_KEY = 'typeme.quiz.v1'
export const SCHEMA_VERSION = 3
export const DEFAULT_VERSION = 'quick'

/** 单条记录大小上限（§6.1 建议 128KiB）。全量内容包快照必须装得下，由单测断言。 */
export const MAX_SESSION_BYTES = 128 * 1024

/** 本地迁移专用包标识：不进入服务端注册表，也不允许出现在接口请求里。 */
export const LEGACY_LOCAL_PACKAGE_ID = 'legacy-v2-local'

/** 历史题目没有单独审校的释义时使用的通用说明（不编造专门释义）。 */
export const LEGACY_HELP_NOTICE =
  '这份历史题目暂无单独审校的释义。如果不能判断，可以保留“暂时无法判断”，或先选择更接近平常状态的一侧。'

export type StorageStatus = 'unknown' | 'ok' | 'unavailable' | 'conflict'

export interface SelfReflectionEntry {
  preference: Pole | null
  updatedAt: number
}

export interface LocalAssessmentSessionV3 {
  schemaVersion: 3
  source: 'native_v3' | 'legacy_v2'
  sessionId: string
  packageSnapshot: AssessmentPackage
  packageSignature: string
  responses: ResponseMap
  currentQuestionId: number
  startedAt: number
  updatedAt: number
  submittedAt: number | null
  selfReflection: Partial<Record<Dimension, SelfReflectionEntry>>
}

/* ── 旧版记录（只读识别用，不迁移） ─────────────────────────────────────── */

export interface LegacyQuizV1 {
  version: string
  answers: Record<number, number>
  currentIndex: number
  startedAt: number
  updatedAt: number
  answeredCount: number
}

export interface LegacyQuizV2 {
  questionnaire: Questionnaire
  questionnaireSignature: string
  answers: Record<number, number>
  currentQuestionId: number
  startedAt: number
  updatedAt: number
  completedAt: number | null
}

/**
 * 题库签名 —— 固定顺序字段的规范化 JSON（v2 会话校验用，v3 用整包签名）。
 */
export function questionnaireSignature(questionnaire: Questionnaire): string {
  const questions = [...questionnaire.questions]
    .sort((a, b) => a.id - b.id)
    .map((question) => [
      question.id,
      question.textLeft,
      question.textRight,
      question.dimension,
      question.direction,
    ])
  return JSON.stringify([
    questionnaire.version,
    questionnaire.questionCount,
    questionnaire.scoring.midpoint,
    [
      questionnaire.scoring.constants.EI,
      questionnaire.scoring.constants.SN,
      questionnaire.scoring.constants.TF,
      questionnaire.scoring.constants.JP,
    ],
    questions,
  ])
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 忽略：退回时间戳方案 */
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ── 读取 v3 ─────────────────────────────────────────────────────────────── */

export interface ReadSessionResult {
  session: LocalAssessmentSessionV3 | null
  dropped: number
  error: string | null
}

/**
 * 读回自我观察。
 *
 * ⚠️ 这里过去只看它是不是 `EISNTFJP` 里的单个字母、且只遍历 OEJTS 的
 * `DIMENSION_ORDER`，于是**大五会话的自我观察一刷新就整片丢失**
 * （维度名是 E/A/C/ES/O，记号是「低/高」，两条门槛都不满足）。
 * 现在：维度与记号都按**本地快照里的内容包**取，只有两者都对得上才收下。
 */
function readSelfReflection(
  value: unknown,
  pkg: AssessmentPackage,
): Partial<Record<Dimension, SelfReflectionEntry>> {
  const out: Partial<Record<Dimension, SelfReflectionEntry>> = {}
  if (typeof value !== 'object' || value === null) return out
  for (const dimension of packageDimensionOrder(pkg)) {
    const entry = (value as Record<string, unknown>)[dimension]
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as { preference?: unknown; updatedAt?: unknown }
    const tokens = poleTokensOf(pkg, dimension)
    const allowed: unknown[] = [null, tokens.low, tokens.high]
    if (!allowed.includes(candidate.preference)) continue
    out[dimension] = {
      preference: (candidate.preference as Pole | null) ?? null,
      updatedAt: isFiniteTimestamp(candidate.updatedAt) ? candidate.updatedAt : Date.now(),
    }
  }
  return out
}

export function parseSession(raw: string | null): ReadSessionResult {
  if (!raw) return { session: null, dropped: 0, error: null }
  if (raw.length > MAX_SESSION_BYTES) {
    return { session: null, dropped: 0, error: '本地记录超过大小上限，已忽略。' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { session: null, dropped: 0, error: '本地记录不是合法 JSON，已忽略。' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { session: null, dropped: 0, error: '本地记录结构不正确，已忽略。' }
  }

  const candidate = parsed as Partial<LocalAssessmentSessionV3>
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    return { session: null, dropped: 0, error: '本地记录的版本不是 3，已忽略。' }
  }
  if (candidate.source !== 'native_v3' && candidate.source !== 'legacy_v2') {
    return { session: null, dropped: 0, error: '本地记录的来源标识不合法，已忽略。' }
  }
  if (typeof candidate.sessionId !== 'string' || candidate.sessionId.length === 0) {
    return { session: null, dropped: 0, error: '本地记录缺少会话标识，已忽略。' }
  }
  // 本地快照也必须满足内容包契约：不能因为「有快照」就信任任意题库/帮助
  if (!isValidAssessmentPackage(candidate.packageSnapshot)) {
    const problems = assessmentPackageProblems(candidate.packageSnapshot)
    return {
      session: null,
      dropped: 0,
      error: `本地记录里的内容包不符合契约，已忽略：${problems.slice(0, 3).join('；')}`,
    }
  }
  const packageSnapshot = candidate.packageSnapshot
  if (candidate.packageSignature !== assessmentPackageSignature(packageSnapshot)) {
    return { session: null, dropped: 0, error: '本地记录的内容包签名不匹配，已忽略。' }
  }
  if (
    !isFiniteTimestamp(candidate.startedAt) ||
    !isFiniteTimestamp(candidate.updatedAt) ||
    (candidate.submittedAt !== null && candidate.submittedAt !== undefined && !isFiniteTimestamp(candidate.submittedAt))
  ) {
    return { session: null, dropped: 0, error: '本地记录的时间戳不合法，已忽略。' }
  }

  const { responses, dropped } = normalizeResponses(candidate.responses, packageSnapshot.questionnaire)
  const rawId = candidate.currentQuestionId
  const currentQuestionId =
    typeof rawId === 'number' &&
    packageSnapshot.questionnaire.questions.some((question) => question.id === rawId)
      ? rawId
      : packageSnapshot.questionnaire.questions[0].id

  return {
    session: {
      schemaVersion: SCHEMA_VERSION,
      source: candidate.source,
      sessionId: candidate.sessionId,
      packageSnapshot,
      packageSignature: candidate.packageSignature,
      responses,
      currentQuestionId,
      startedAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
      submittedAt: candidate.submittedAt ?? null,
      selfReflection: readSelfReflection(candidate.selfReflection, packageSnapshot),
    },
    dropped,
    error: null,
  }
}

/* ── 读取旧版 v1 / v2 ────────────────────────────────────────────────────── */

export function readLegacyV1(): LegacyQuizV1 | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LegacyQuizV1>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'string' ||
      typeof parsed.answers !== 'object' ||
      parsed.answers === null
    ) {
      return null
    }
    const values = Object.values(parsed.answers).filter((value) => isValidAnswerValue(value))
    return {
      version: parsed.version,
      answers: { ...(parsed.answers as Record<number, number>) },
      currentIndex:
        typeof parsed.currentIndex === 'number' ? Math.max(0, Math.floor(parsed.currentIndex)) : 0,
      startedAt: isFiniteTimestamp(parsed.startedAt) ? parsed.startedAt : 0,
      updatedAt: isFiniteTimestamp(parsed.updatedAt) ? parsed.updatedAt : 0,
      answeredCount: values.length,
    }
  } catch (error) {
    console.warn('[typeme] 读取旧版（v1）作答记录失败，已忽略', error)
    return null
  }
}

export interface ReadLegacyV2Result {
  session: LegacyQuizV2 | null
  dropped: number
  error: string | null
}

/**
 * 读取 v2 记录。**只读**：不迁移、不删除、不改写。
 * 只有用户显式选择「载入为派生会话」时才由 `deriveSessionFromLegacyV2` 转换。
 */
export function parseLegacyV2(raw: string | null): ReadLegacyV2Result {
  if (!raw) return { session: null, dropped: 0, error: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { session: null, dropped: 0, error: '旧版（v2）记录不是合法 JSON。' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { session: null, dropped: 0, error: '旧版（v2）记录结构不正确。' }
  }
  const candidate = parsed as {
    schemaVersion?: unknown
    questionnaire?: unknown
    questionnaireSignature?: unknown
    answers?: unknown
    currentQuestionId?: unknown
    startedAt?: unknown
    updatedAt?: unknown
    completedAt?: unknown
  }
  if (candidate.schemaVersion !== 2) {
    return { session: null, dropped: 0, error: '旧版记录不是 v2 会话。' }
  }
  if (!isValidQuestionnaire(candidate.questionnaire)) {
    return { session: null, dropped: 0, error: '旧版记录里的题库结构不合法。' }
  }
  const questionnaire = candidate.questionnaire
  if (!canScore(questionnaire)) {
    return { session: null, dropped: 0, error: '旧版记录里的题库无法计分。' }
  }
  if (candidate.questionnaireSignature !== questionnaireSignature(questionnaire)) {
    return { session: null, dropped: 0, error: '旧版记录里的题库签名不匹配。' }
  }
  if (!isFiniteTimestamp(candidate.startedAt) || !isFiniteTimestamp(candidate.updatedAt)) {
    return { session: null, dropped: 0, error: '旧版记录的时间戳不合法。' }
  }
  const { answers, dropped } = normalizeAnswers(candidate.answers, questionnaire)
  const rawId = candidate.currentQuestionId
  const currentQuestionId =
    typeof rawId === 'number' && questionnaire.questions.some((question) => question.id === rawId)
      ? rawId
      : questionnaire.questions[0].id

  return {
    session: {
      questionnaire,
      questionnaireSignature: candidate.questionnaireSignature,
      answers,
      currentQuestionId,
      startedAt: candidate.startedAt,
      updatedAt: candidate.updatedAt,
      completedAt:
        candidate.completedAt === null || candidate.completedAt === undefined
          ? null
          : isFiniteTimestamp(candidate.completedAt)
            ? candidate.completedAt
            : null,
    },
    dropped,
    error: null,
  }
}

/**
 * 把 v2 记录派生成本地迁移会话。
 *
 * 三条硬规则（§6.2）：
 *   1. 用**旧记录自己的题面快照**，不套用当前中文题面；
 *   2. 每个题号都填**明确的通用说明**（`LEGACY_HELP_NOTICE`），不编造专门释义；
 *   3. 派生包带保留标识 `legacy-v2-local`，不冒充服务端同名包，也不允许发起 API 请求。
 *
 * 派生包使用**新版维度解释与报告政策**：政策是产品解释层，不是量表本身，
 * 因此历史数值结构可以配新解释政策；但题面与帮助必须仍是历史那一份。
 */
export function deriveSessionFromLegacyV2(
  legacy: LegacyQuizV2,
  template: AssessmentPackage,
): LocalAssessmentSessionV3 {
  const itemHelp: AssessmentPackage['itemHelp'] = {}
  for (const question of legacy.questionnaire.questions) {
    itemHelp[String(question.id)] = {
      explanation: LEGACY_HELP_NOTICE,
      reviewStatus: 'draft',
      riskCodes: [],
    }
  }

  const derived: AssessmentPackage = {
    schemaVersion: 2,
    packageId: LEGACY_LOCAL_PACKAGE_ID,
    locale: 'zh-CN',
    localeRevision: `legacy-v2-${legacy.questionnaire.version}`,
    helpRevision: 'legacy-v2-generic-r1',
    copyRevision: template.copyRevision,
    contentStatus: 'draft',
    instrument: template.instrument,
    interpretation: template.interpretation,
    title: `历史记录派生会话（${legacy.questionnaire.title}）`,
    estimatedMinutes: template.estimatedMinutes,
    questionnaire: legacy.questionnaire,
    itemHelp,
    dimensionCopy: template.dimensionCopy,
    reportCopy: template.reportCopy,
    nextSteps: template.nextSteps,
    attribution: template.attribution,
  }

  const responses: ResponseMap = {}
  for (const [key, value] of Object.entries(legacy.answers)) {
    responses[Number(key)] = { kind: 'rating', value: value as 1 | 2 | 3 | 4 | 5 }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    source: 'legacy_v2',
    sessionId: newSessionId(),
    packageSnapshot: derived,
    packageSignature: assessmentPackageSignature(derived),
    responses,
    currentQuestionId: legacy.currentQuestionId,
    startedAt: legacy.startedAt,
    updatedAt: Date.now(),
    submittedAt: legacy.completedAt,
    selfReflection: {},
  }
}

/* ── store ──────────────────────────────────────────────────────────────── */

interface QuizState {
  activePackage: AssessmentPackage | null
  packageSource: ContentSource
  loading: boolean
  loadError: string | null
  sessionId: string | null
  sessionSource: LocalAssessmentSessionV3['source']
  responses: ResponseMap
  currentQuestionId: number | null
  startedAt: number | null
  submittedAt: number | null
  selfReflection: Partial<Record<Dimension, SelfReflectionEntry>>
  resumed: boolean
  droppedResponses: number
  storageError: string | null
  legacyV1: LegacyQuizV1 | null
  legacyV2: LegacyQuizV2 | null
  /** 另一标签页写入了**旧版 v2** 客户端的数据：只提示，不互相覆盖。 */
  legacyV2External: boolean
  storageStatus: StorageStatus
  externalChange: boolean
}

let suppressStorageEvent = false

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch (error) {
    console.warn('[typeme] 读取本地记录失败', error)
    return null
  }
}

/**
 * 写一条**非会话**的本地字符串（目前只有内容版本偏好）。
 *
 * 刻意不复用 `writeKey`：那个是会话写入，失败会把 `storageStatus` 置为
 * `unavailable` 并让页面提示「无法保存进度」。一个偏好项写不进去不该吓到用户，
 * 也不该覆盖真正的会话存储状态。
 */
function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    suppressStorageEvent = true
    try {
      localStorage.setItem(key, value)
    } finally {
      suppressStorageEvent = false
    }
  } catch (error) {
    console.warn('[typeme] 写入本地偏好失败（不影响作答）', error)
  }
}

export const useQuizStore = defineStore('quiz', {
  state: (): QuizState => ({
    activePackage: null,
    packageSource: 'fallback',
    loading: false,
    loadError: null,
    sessionId: null,
    sessionSource: 'native_v3',
    responses: {},
    currentQuestionId: null,
    startedAt: null,
    submittedAt: null,
    selfReflection: {},
    resumed: false,
    droppedResponses: 0,
    storageError: null,
    legacyV1: null,
    legacyV2: null,
    legacyV2External: false,
    storageStatus: 'unknown',
    externalChange: false,
  }),

  getters: {
    questions: (state) => state.activePackage?.questionnaire.questions ?? [],
    total: (state) => state.activePackage?.questionnaire.questions.length ?? 0,
    packageId: (state) => state.activePackage?.packageId ?? null,
    /**
     * 当前题的下标。
     *
     * ⚠️ 这里**只用 `state`、不用 `this`**：Pinia 的 getter 对象里混用 `this.xxx`
     * 会让整个 getters 的类型推断退化（`this.questions` 被解析成 getter 函数本身），
     * 报出「运算符不能用于 () => number」这种与真实原因无关的错误。
     * 老版本踩过同名坑（`currentIndex` 恒为 -1），现在统一改成纯函数式。
     */
    currentIndex: (state): number => {
      const list = state.activePackage?.questionnaire.questions ?? []
      const index = list.findIndex((question) => question.id === state.currentQuestionId)
      return index >= 0 ? index : 0
    },
    /**
     * 这台设备上次选定的内容版本（见 `PREFERRED_PACKAGE_KEY`）。
     *
     * 只认**内置副本里存在**的 ID：偏好是本地字符串，可能是旧版本留下的、
     * 或被人手改过。认不出来的偏好直接忽略，绝不能因为一个过期字符串就装载失败。
     */
    preferredPackageId(): string | null {
      const stored = readRaw(PREFERRED_PACKAGE_KEY)
      if (!stored) return null
      return stored in FALLBACK_ASSESSMENT_PACKAGES ? stored : null
    },
    currentQuestion: (state): Question | null => {
      const list = state.activePackage?.questionnaire.questions ?? []
      const index = list.findIndex((question) => question.id === state.currentQuestionId)
      return list[index >= 0 ? index : 0] ?? null
    },
    /** 用户已处理（数字答案 + 无法判断）的题数 —— 进度条与「已处理 n/32」都用它。 */
    processedCount: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) !== 'unanswered',
      ).length,
    /** 已选择倾向：有效 1–5 分值。 */
    ratingCount: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) === 'rating',
      ).length,
    /** 待判断：用户明确标记无法判断。 */
    unknownCount: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) === 'unknown',
      ).length,
    /** 尚未处理：既没有数字答案、也没有标记无法判断。 */
    unansweredCount: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) === 'unanswered',
      ).length,
    /** 兼容旧命名：缺答 = 尚未处理（**不是**「无法判断」）。 */
    missingCount: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) === 'unanswered',
      ).length,
    /**
     * 记录存在但**不可识别**的题号（本地数据被写坏）。
     *
     * 这些题既不是有效评分、也不是「无法判断」，因此不能计入"已处理"，
     * 但也不能当成"用户还没答"——报告页要按结构性错误渲染错误态（CR-1），
     * 答题页要如实提示并允许用户重新选择来修复。
     */
    corruptResponseIds: (state): number[] =>
      (state.activePackage?.questionnaire.questions ?? [])
        .filter((question) => isCorruptResponse(state.responses[question.id]))
        .map((question) => question.id),
    /** 32 题都处理过了（含无法判断）。这是允许生成部分报告的条件。 */
    isProcessed: (state): boolean => {
      const list = state.activePackage?.questionnaire.questions ?? []
      return list.length > 0 && list.every((question) => responseState(state.responses[question.id]) !== 'unanswered')
    },
    unansweredQuestions: (state) =>
      (state.activePackage?.questionnaire.questions ?? []).filter(
        (question) => responseState(state.responses[question.id]) === 'unanswered',
      ),
    firstUnansweredIndex: (state): number =>
      (state.activePackage?.questionnaire.questions ?? []).findIndex(
        (question) => responseState(state.responses[question.id]) === 'unanswered',
      ),
    hasProgress: (state): boolean => Object.keys(state.responses).length > 0,
    progressRatio: (state): number => {
      const list = state.activePackage?.questionnaire.questions ?? []
      if (list.length === 0) return 0
      const processed = list.filter(
        (question) => responseState(state.responses[question.id]) !== 'unanswered',
      ).length
      return Math.min(1, processed / list.length)
    },
    /** 提交过且 32 题都处理过 → 有一份可查看的报告。 */
    hasReport: (state): boolean => {
      const list = state.activePackage?.questionnaire.questions ?? []
      return (
        state.submittedAt !== null &&
        list.length > 0 &&
        list.every((question) => responseState(state.responses[question.id]) !== 'unanswered')
      )
    },
    scoringAvailable: (state): boolean => canScore(state.activePackage?.questionnaire ?? null),
    writesBlocked: (state): boolean => state.storageStatus === 'conflict' || state.externalChange,
    storageUnavailable: (state): boolean => state.storageStatus === 'unavailable',
    /** 维度分析；数据/内容异常时返回 null（页面据此渲染错误态，不弹回答题页）。 */
    analysis(state): AssessmentAnalysis | null {
      if (!state.activePackage) return null
      try {
        return analyzeAssessment(state.responses, state.activePackage)
      } catch (error) {
        if (error instanceof ScoringError || error instanceof AssessmentError) return null
        throw error
      }
    },
    analysisError(state): string | null {
      if (!state.activePackage) return this.loadError ?? '内容还没装载成功。'
      try {
        analyzeAssessment(state.responses, state.activePackage)
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
    /**
     * 唯一展示模型。页面、图片、复制文字、文件名、无障碍名称都消费它。
     * 未定时 `suggestedTypeCode` 必为 null。
     */
    report(state): ReportViewModel | null {
      if (!state.activePackage) return null
      try {
        const analysis = analyzeAssessment(state.responses, state.activePackage)
        return buildReportViewModel(analysis, state.activePackage, state.responses)
      } catch (error) {
        if (error instanceof ScoringError || error instanceof AssessmentError) return null
        throw error
      }
    },
    reportId(state): string | null {
      if (!state.activePackage) return null
      try {
        const analysis = analyzeAssessment(state.responses, state.activePackage)
        return reportIdOf(state.activePackage, analysis, state.responses)
      } catch {
        return null
      }
    },
    /** 是否可以由旧 v2 记录派生一个本地迁移会话。 */
    canMigrateLegacyV2: (state): boolean =>
      state.legacyV2 !== null && Object.keys(state.responses).length === 0,
  },

  actions: {
    /**
     * 装载内容包：优先接口，失败降级到**同 ID** 内置副本。
     * 只在这个时候联网，之后答题与生成报告都不需要网络。
     *
     * 不传 `packageId` 时优先用这台设备上次选定的版本（见 `PREFERRED_PACKAGE_KEY`），
     * 没有任何偏好或偏好已不在注册表里就回到站点默认包。
     */
    async load(packageId?: string) {
      const target = packageId ?? this.preferredPackageId ?? DEFAULT_PACKAGE_ID
      if (this.activePackage && this.activePackage.packageId === target) return
      this.loading = true
      this.loadError = null
      try {
        const resolved = await fetchAssessmentPackage(target)
        this.activePackage = resolved.data
        this.packageSource = resolved.source
        this.sessionSource = 'native_v3'
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : String(error)
      } finally {
        this.loading = false
      }
      this.restore()
    },

    /** 只在本机可用时用内置副本装载（用于"同 ID 内置副本"路径与离线测试）。 */
    loadBuiltin(packageId?: string) {
      const target = packageId ?? this.preferredPackageId ?? DEFAULT_PACKAGE_ID
      const pkg = builtinAssessmentPackage(target)
      if (!pkg) {
        this.loadError = `没有 ID 为「${target}」的内置内容副本。`
        return false
      }
      this.activePackage = pkg
      this.packageSource = 'fallback'
      this.sessionSource = 'native_v3'
      this.loadError = null
      this.restore()
      return true
    },

    /**
     * 在开始测试前切换内容版本（本地试用入口）。
     *
     * 只有在**还没有任何作答**时才允许切换：否则同一会话里会出现
     * 「前半段用旧题面、后半段用新题面」的混版本记录。
     * 切换后重建一个空会话，避免把上一版的包快照 restore 回来。
     */
    async selectPackage(packageId: string): Promise<boolean> {
      if (this.hasProgress) return false
      this.loading = true
      this.loadError = null
      try {
        const resolved = await fetchAssessmentPackage(packageId)
        this.activePackage = resolved.data
        this.packageSource = resolved.source
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : String(error)
        return false
      } finally {
        this.loading = false
      }
      this.removeKey(STORAGE_KEY)
      writeRaw(PREFERRED_PACKAGE_KEY, packageId)
      this.sessionId = null
      this.sessionSource = 'native_v3'
      this.responses = {}
      this.startedAt = null
      this.submittedAt = null
      this.selfReflection = {}
      this.resumed = false
      this.droppedResponses = 0
      this.storageError = null
      this.currentQuestionId = this.activePackage?.questionnaire.questions[0]?.id ?? null
      return true
    },

    detectLegacy() {
      const legacy = readLegacyV1()
      this.legacyV1 = legacy && legacy.answeredCount > 0 ? legacy : null
      const v2 = parseLegacyV2(readRaw(LEGACY_V2_STORAGE_KEY))
      // 只有真的有作答或已完成记录时才算「发现旧记录」
      this.legacyV2 =
        v2.session && (Object.keys(v2.session.answers).length > 0 || v2.session.completedAt !== null)
          ? v2.session
          : null
    },

    /**
     * 从 localStorage 恢复 v3 会话。
     * 恢复后**沿用保存的内容包快照完成本轮**：内容服务更新不会替换本轮题目与帮助。
     */
    restore(): boolean {
      this.detectLegacy()
      const raw = readRaw(STORAGE_KEY)
      const { session, dropped, error } = parseSession(raw)
      this.storageError = error
      if (!session) {
        if (error && this.storageStatus === 'unknown') this.storageStatus = 'ok'
        return false
      }
      this.activePackage = session.packageSnapshot
      // 会话里的包快照就是「这次用的量表」：把它同步成设备偏好，
      // 这样答完/清空后刷新仍然是同一版，而不是悄悄换题。
      // 派生会话（旧 v2 迁移）用的是本地临时包 ID，不写进偏好，免得把有效选择冲掉。
      if (session.packageSnapshot.packageId in FALLBACK_ASSESSMENT_PACKAGES) {
        writeRaw(PREFERRED_PACKAGE_KEY, session.packageSnapshot.packageId)
      }
      this.sessionId = session.sessionId
      this.sessionSource = session.source
      this.responses = session.responses
      this.currentQuestionId = session.currentQuestionId
      this.startedAt = session.startedAt
      this.submittedAt = session.submittedAt
      this.selfReflection = session.selfReflection
      this.droppedResponses = dropped
      this.resumed = true
      if (this.storageStatus !== 'unavailable') {
        this.storageStatus = 'unknown'
        this.persist()
        if (this.storageStatus === 'unknown') this.storageStatus = 'ok'
      }
      return true
    },

    /** 组装当前会话对象（不写入）。 */
    snapshot(): LocalAssessmentSessionV3 | null {
      if (!this.activePackage) return null
      const now = Date.now()
      return {
        schemaVersion: SCHEMA_VERSION,
        source: this.sessionSource,
        sessionId: this.sessionId ?? newSessionId(),
        packageSnapshot: this.activePackage,
        packageSignature: assessmentPackageSignature(this.activePackage),
        responses: { ...this.responses },
        currentQuestionId:
          this.currentQuestionId ?? this.activePackage.questionnaire.questions[0]?.id ?? 1,
        startedAt: this.startedAt ?? now,
        updatedAt: now,
        submittedAt: this.submittedAt,
        selfReflection: { ...this.selfReflection },
      }
    },

    persist() {
      if (!this.activePackage) return
      if (this.writesBlocked) return

      if (!this.hasProgress && this.submittedAt === null) {
        this.removeKey(STORAGE_KEY)
        return
      }
      this.writeKey(STORAGE_KEY, this.snapshot())
    },

    /** 「已开始、还没选任何答案」也要留下记录，刷新后才能回到第 1 题而不是丢失上下文。 */
    persistStarted() {
      if (!this.activePackage) return
      if (this.writesBlocked) return
      this.writeKey(STORAGE_KEY, this.snapshot())
    },

    writeKey(key: string, value: unknown) {
      try {
        if (typeof localStorage === 'undefined') throw new Error('当前环境没有 localStorage')
        const payload = JSON.stringify(value)
        if (payload.length > MAX_SESSION_BYTES) {
          // 不允许静默截断题目或解释：如实告知，内存里仍可继续作答
          throw new Error(`会话超过 ${Math.round(MAX_SESSION_BYTES / 1024)}KiB 上限`)
        }
        suppressStorageEvent = true
        try {
          localStorage.setItem(key, payload)
        } finally {
          suppressStorageEvent = false
        }
        this.storageStatus = 'ok'
      } catch (error) {
        console.warn('[typeme] 写入本地记录失败（不影响本次作答）', error)
        this.storageStatus = 'unavailable'
        this.storageError = '这台设备无法保存进度：本次仍可正常作答，但关闭或刷新后进度可能丢失。'
      }
    },

    removeKey(key: string) {
      try {
        if (typeof localStorage === 'undefined') return
        suppressStorageEvent = true
        try {
          localStorage.removeItem(key)
        } finally {
          suppressStorageEvent = false
        }
      } catch (error) {
        console.warn('[typeme] 清除本地记录失败', error)
      }
    },

    /**
     * 忘掉「上次选的内容版本」，下次打开回到站点默认量表。
     *
     * 它不含任何作答，单独给一个入口是因为「清除本地记录」是用户能理解的
     * 一键清空：既然他说了清除，就不要留一个看不见的偏好继续生效。
     */
    clearPreferredPackage() {
      this.removeKey(PREFERRED_PACKAGE_KEY)
    },

    /** 开一轮全新测评。会替换本机保留的上次作答（调用方必须先确认）。 */
    start(packageId?: string) {
      if (packageId && this.activePackage?.packageId !== packageId) {
        const pkg = builtinAssessmentPackage(packageId)
        if (pkg) {
          this.activePackage = pkg
          this.packageSource = 'fallback'
        }
      }
      this.sessionId = newSessionId()
      this.sessionSource = 'native_v3'
      this.responses = {}
      this.currentQuestionId = this.activePackage?.questionnaire.questions[0]?.id ?? null
      this.startedAt = Date.now()
      this.submittedAt = null
      this.selfReflection = {}
      this.resumed = false
      this.droppedResponses = 0
      this.storageError = null
      this.externalChange = false
      if (this.storageStatus !== 'unavailable') this.storageStatus = 'unknown'
      this.persistStarted()
    },

    /** 选中一个分值（1–5）。原子替换：数字与「无法判断」不可能同时存在。 */
    selectRating(questionId: number, value: number) {
      if (!isValidAnswerValue(value)) return
      if (!this.activePackage?.questionnaire.questions.some((question) => question.id === questionId)) {
        return
      }
      const previous = this.responses[questionId]
      if (previous?.kind === 'rating' && previous.value === value) return
      this.responses = { ...this.responses, [questionId]: { kind: 'rating', value: value as 1 | 2 | 3 | 4 | 5 } }
      this.afterResponseChange()
    },

    /** 标记「暂时无法判断」。原因可不填；它不会把这道题变成 3 分。 */
    selectUnknown(questionId: number, reason: UnknownReason | null = null) {
      if (!this.activePackage?.questionnaire.questions.some((question) => question.id === questionId)) {
        return
      }
      const normalizedReason =
        reason !== null && (UNKNOWN_REASONS as readonly string[]).includes(reason) ? reason : null
      const previous = this.responses[questionId]
      if (previous?.kind === 'unknown' && previous.reason === normalizedReason) return
      this.responses = { ...this.responses, [questionId]: { kind: 'unknown', reason: normalizedReason } }
      this.afterResponseChange()
    },

    /** 回答变化后的统一处理：起算时间、失效旧报告与旧分享产物、落盘。 */
    afterResponseChange() {
      if (this.startedAt === null) this.startedAt = Date.now()
      // 改动答案即清除提交状态 → 旧报告、旧图片、旧复制文字立即失效
      this.submittedAt = null
      this.persist()
    },

    goToId(questionId: number) {
      if (!this.activePackage) return
      if (!this.activePackage.questionnaire.questions.some((question) => question.id === questionId)) return
      this.currentQuestionId = questionId
      this.persist()
    },

    goTo(index: number) {
      const total = this.activePackage?.questionnaire.questions.length ?? 0
      if (total === 0) return
      const clamped = Math.min(Math.max(0, index), total - 1)
      this.goToId(this.activePackage!.questionnaire.questions[clamped].id)
    },

    next() {
      const index = this.currentIndex
      if (index < 0) return
      this.goTo(index + 1)
    },

    prev() {
      const index = this.currentIndex
      if (index <= 0) return
      this.goTo(index - 1)
    },

    goToFirstUnanswered() {
      const index = this.firstUnansweredIndex
      if (index < 0) return
      this.goTo(index)
    },

    /**
     * 自我观察（不计分）：只更新独立的「我的当前理解」区，不改 responses、不改报告。
     *
     * 维度合法性跟**当前内容包**走，而不是 OEJTS 的 `DIMENSION_ORDER`：
     * 大五的维度是 E/A/C/ES/O，用那张四维表做门槛会让大五下的自我观察
     * **静默失效**（点「更偏 内敛」什么都不会发生）。
     */
    saveSelfReflection(dimension: Dimension, preference: Pole | null) {
      const allowed = this.activePackage ? packageDimensionOrder(this.activePackage) : []
      if (!allowed.includes(dimension)) return
      this.selfReflection = {
        ...this.selfReflection,
        [dimension]: { preference, updatedAt: Date.now() },
      }
      this.persist()
    },

    clearSelfReflection() {
      this.selfReflection = {}
      this.persist()
    },

    /** 提交：只记录时间。没有隐式补答；未处理的题必须先显式处理。 */
    submit() {
      if (!this.isProcessed) return false
      this.submittedAt = Date.now()
      this.persist()
      return true
    },

    /** 由旧 v2 记录派生一个本地迁移会话（用户显式确认后调用）。 */
    migrateLegacyV2(): boolean {
      const legacy = this.legacyV2
      if (!legacy) return false
      const template = this.activePackage ?? builtinAssessmentPackage(DEFAULT_PACKAGE_ID)
      if (!template) return false
      const derived = deriveSessionFromLegacyV2(legacy, template)
      this.activePackage = derived.packageSnapshot
      this.sessionId = derived.sessionId
      this.sessionSource = 'legacy_v2'
      this.responses = derived.responses
      this.currentQuestionId = derived.currentQuestionId
      this.startedAt = derived.startedAt
      this.submittedAt = derived.submittedAt
      this.selfReflection = {}
      this.resumed = true
      this.droppedResponses = 0
      this.storageError = null
      // 先在内存完成迁移并验证报告，再写 v3；旧 v2 键保持不动
      if (!this.analysis) return false
      this.storageStatus = this.storageStatus === 'unavailable' ? 'unavailable' : 'unknown'
      this.persist()
      if (this.storageStatus === 'unknown') this.storageStatus = 'ok'
      return true
    },

    /** 清空 v3 本地记录（只删本应用的键）。 */
    clearSession() {
      this.reset()
    },

    /** 用户确认"载入最新进度"：丢弃本页内存状态，重新从存储读取。 */
    loadLatest() {
      this.externalChange = false
      this.storageStatus = this.storageStatus === 'unavailable' ? 'unavailable' : 'unknown'
      this.restore()
    },

    flagExternalChange() {
      if (suppressStorageEvent) return
      this.externalChange = true
      this.storageStatus = 'conflict'
    },

    reset() {
      this.sessionId = null
      this.sessionSource = 'native_v3'
      this.responses = {}
      this.currentQuestionId = null
      this.startedAt = null
      this.submittedAt = null
      this.selfReflection = {}
      this.resumed = false
      this.droppedResponses = 0
      this.storageError = null
      this.externalChange = false
      if (this.storageStatus !== 'unavailable') this.storageStatus = 'unknown'
      this.removeKey(STORAGE_KEY)
    },

    /** 用户确认后，删除更早的 v1 键。 */
    dropLegacyV1() {
      this.removeKey(LEGACY_STORAGE_KEY)
      this.legacyV1 = null
    },

    /** 用户确认后，删除旧版 v2 键。 */
    dropLegacyV2() {
      this.removeKey(LEGACY_V2_STORAGE_KEY)
      this.legacyV2 = null
      this.legacyV2External = false
    },

    /**
     * 监听另一标签页的存储改动（§6.3）。
     *   - v3 键被别的标签页改了 → 停止自动写回，提示载入最新记录；
     *   - 旧 v2 键被别的标签页写了 → 只提示「存在另一版会话」，两种格式不互相覆盖。
     */
    bindStorageSync() {
      if (typeof window === 'undefined') return () => {}
      const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
          this.flagExternalChange()
          return
        }
        if (event.key === LEGACY_V2_STORAGE_KEY) {
          this.legacyV2External = true
        }
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    },
  },
})

/** 供测试与"继续上次作答"提示使用。 */
export function readPersistedSession(): ReadSessionResult {
  return parseSession(readRaw(STORAGE_KEY))
}

export function readPersistedLegacyV2(): ReadLegacyV2Result {
  return parseLegacyV2(readRaw(LEGACY_V2_STORAGE_KEY))
}

/** 供 UI 显示某一题的处理状态。 */
export function responseOf(responses: ResponseMap, id: number): Response | undefined {
  return responses[id]
}

/** 与 `coerceAnswerValue` 一起导出，便于旧数据适配的调用方显式使用。 */
export { coerceAnswerValue }
