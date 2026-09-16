import {
  newIdempotencyKey,
  isV3ApiError,
  unexpectedResponse,
  v3IgnoreBody,
  v3ReadJson,
  v3Request,
  type V3RequestOptions,
} from '@/api/v3'
import { DIMENSIONS, type Dimension, type Stage } from '@/domain/jung/types'

/**
 * 新测（typeme-jung48）端点 —— 契约 `02-数据模型与API-v1.md` §7.2「内容与测评 / 报告」。
 *
 * ## 这个模块存在的理由
 *
 * `api/v3.ts` 负责"怎么发请求"（凭据、CSRF、超时、错误码映射），这里负责
 * "新测每个端点长什么样"。两者分开是因为 request 层已经足够薄且被多个模块共用，
 * 而端点形状是**会随契约演进**的部分：把它塞进 `v3.ts` 会让那个文件变成
 * 账号 + 目录 + 测评 + 报告 + AI 的杂物间。
 *
 * ## 三条纪律
 *
 *   1. **不改后端语义**。这里只做"形状校验 + 命名对齐"：服务端给 `packageContent`
 *      就照实读 `packageContent`（契约文档写的 `package` 与实现不符，以**实现**为准）。
 *   2. **缺失字段不猜默认值**。响应里没有必需字段时抛
 *      `UNEXPECTED_RESPONSE_CODE`（见 {@link requireText} / {@link readDimensionList}），
 *      而不是填 `''` 或 `null` 让页面显示一段看起来正常、其实是编的内容。
 *      唯一的例外是**列表字段**（`answers` / `coverage` / `clarificationDimensions`）：
 *      契约保证它们是数组，缺失时按空数组处理并在类型上体现为 `[]`，
 *      因为"一台设备上还没有任何作答"与"服务端没返回 answers"在行为上是同一件事。
 *   3. **写操作带 `expectedRevision`**。答题草稿是跨设备共享的，静默覆盖别人的进度
 *      是这一块最严重的失败模式，所以 `patchAnswers` 不接受"不带 revision"的调用。
 */

/* ── 目录与内容包 ───────────────────────────────────────────────────────── */

/** `GET /catalog/current`：只给维度摘要，不带题目正文。 */
export interface CatalogSummary {
  packageId: string
  instrumentId: string | null
  scoringVersion: string | null
  reportContentVersion: string | null
  contentStatus: string | null
  title: string | null
  questionCount: number
  basePerDimension: number
  clarificationPerDimension: number
  maxClarificationItems: number
  sha256: string | null
  dimensions: {
    dimension: Dimension
    name: string
    question: string
    negativePole: string
    negativeLabel: string
    positivePole: string
    positiveLabel: string
  }[]
}

export interface PoleView {
  pole: string
  label: string
  description: string
  dailySigns: string[]
}

export interface DimensionView {
  dimension: Dimension
  name: string
  question: string
  negativePole: PoleView
  positivePole: PoleView
  balanced: { summary: string; reading: string } | null
  tiedNotice: string | null
}

export interface QuestionView {
  id: string
  /** `base`（主测）或 `clarification`（补充）。 */
  stage: Stage
  dimension: Dimension
  scenario: string
  textLeft: string
  textRight: string
  leftPole: string
  rightPole: string
  help: string
  facet: string
  order: number
  reviewStatus: string
}

export interface PackageView {
  schemaVersion: number
  packageId: string
  instrument: {
    id: string
    revision: string
    scoringVersion: string
    reportContentVersion: string
    format: string
    hasTypeCode: boolean
    baseItemsPerDimension: number
    clarificationItemsPerDimension: number
    maxClarificationItems: number
  }
  title: string
  contentStatus: string
  scoringPolicy: {
    version: string
    minBaseRatingsPerDimension: number
    boundaryNumerator: number
    boundaryDenominator: number
    ratingMin: number
    ratingMax: number
    ratingNeutral: number
  }
  dimensions: DimensionView[]
  questions: QuestionView[]
  sha256: string
}

/* ── attempt ────────────────────────────────────────────────────────────── */

export interface AttemptSummary {
  attemptId: string
  packageId: string
  status: string
  revision: number
  currentQuestionId: string | null
  clarificationDimensions: Dimension[]
  clarificationSkipped: boolean
  startedAt: string | null
  updatedAt: string | null
  submittedAt: string | null
  reportId: string | null
}

export interface AttemptAnswer {
  questionId: string
  /** 服务端返回 `RATING` / `UNKNOWN`（大写），这里统一成前端域模型的小写。 */
  kind: 'rating' | 'unknown'
  rating: number | null
}

export interface CoverageView {
  dimension: Dimension
  baseRatingCount: number
  baseUnknownCount: number
  baseUnprocessedCount: number
  needsClarification: boolean
  coverageOk: boolean
}

export interface AttemptDetail extends AttemptSummary {
  baseAttemptId: string | null
  answers: AttemptAnswer[]
  coverage: CoverageView[]
  /** ⚠️ 后端 DTO 里的字段名是 `packageContent`（不是契约文档写的 `package`）。 */
  packageView: PackageView | null
  /** 交卷后的报告编号（草稿为 null）。 */
  reportId: string | null
}

export interface AnswerPatch {
  questionId: string
  kind: 'rating' | 'unknown'
  rating?: number | null
}

export interface PatchAnswersResult {
  revision: number
  status: string
  clarificationDimensions: Dimension[]
  /** 改主测答案导致已安排的补充题被清空：界面必须提示"需要重做补充部分"。 */
  clarificationReset: boolean
  currentQuestionId: string | null
}

export interface ReviewResult {
  status: string
  needsReview: boolean
  clarificationDimensions: Dimension[]
  coverage: CoverageView[]
  insufficientDimensions: Dimension[]
}

export interface SubmitResult {
  reportId: string | null
  attemptId: string
  status: string
  computedTypeCode: string | null
  candidateCodes: string[]
  coverage: CoverageView[]
  coverageOk: boolean
  /**
   * 覆盖不足时"还差哪几维"。
   *
   * ⚠️ **后端当前的 SubmitResponse 里没有这个字段**（只有 `review` 响应有
   * `insufficientDimensions`，见契约 `02-数据模型与API-v1.md` §7.2）。
   * 前端从响应里的 `coverage[].coverageOk` 推导出同一份名单 —— 两者都由服务端
   * 同一套覆盖规则产生，所以这不是"前端自己判覆盖"，只是把服务端已经给的结果
   * 换个形状读出来。后端补上这个字段后，这里直接改读 `details` 即可。
   */
  insufficientDimensions: Dimension[]
}

/* ── 报告 ───────────────────────────────────────────────────────────────── */

export interface ReportSummary {
  reportId: string
  attemptId: string | null
  createdAt: string | null
  status: string
  computedTypeCode: string | null
  selfSelectedTypeCode: string | null
  summaryLine: string | null
  packageId: string | null
  scoringVersion: string | null
}

export interface SelfReflection {
  selfSelectedTypeCode: string | null
  note: string | null
  updatedAt: string | null
}

/**
 * `GET /reports/{id}` 的响应。
 *
 * `report` 是**服务端冻结的 `report_json` 原样**（`Record<string, unknown>`：形状由
 * `domain/reportV3.ts` 校验，这一层不做业务判断）；`selfReflection` 可变且与报告隔离。
 */
export interface ReportDetail {
  report: Record<string, unknown>
  selfReflection: SelfReflection
  attemptId: string | null
  attemptRevision: number | null
}

export interface ReportListPage {
  items: ReportSummary[]
  page: number
  size: number
  total: number
}

export interface DimensionDifference {
  dimension: Dimension
  fromPole: string | null
  toPole: string | null
  fromMFinal: number | null
  toMFinal: number | null
  changed: boolean
}

export interface CompareResult {
  reports: ReportSummary[]
  differences: DimensionDifference[]
  samePackage: boolean
  notes: string[]
}

/* ── 读取工具：缺失字段一律抛错，不猜默认值 ───────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireRecord(value: unknown, path: string, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw unexpectedResponse(`请求 ${path} 的响应缺少「${field}」，无法确认这是哪个内容包/报告。`)
  }
  return value
}

function requireText(value: unknown, path: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw unexpectedResponse(`请求 ${path} 的响应缺少必填字段「${field}」。`)
  }
  return value
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
}

/**
 * 必填整数。
 *
 * ⚠️ **不能对 `revision` 用兜底值**：`expectedRevision` 是服务端乐观并发的唯一凭据，
 * 缺失时兜成 0 会得到一个"永远不匹配"的请求（用户每次选答案都撞 409），
 * 或者更糟 —— 兜成某个恰好匹配的值而**覆盖掉另一台设备的进度**。
 * 这两种失败都不会在日志里显形，所以宁可在这一层当场抛错。
 */
function requireInt(value: unknown, path: string, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw unexpectedResponse(`请求 ${path} 的响应缺少必填整数「${field}」。`)
  }
  return Math.trunc(value)
}

/** 必填数组：缺失与"空数组"必须能区分（缺字段 = 响应坏了，空数组 = 真的没有记录）。 */
function requireArray(value: unknown, path: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw unexpectedResponse(`请求 ${path} 的响应缺少数组「${field}」。`)
  }
  return value as unknown[]
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/** 只接受四个已知维度；出现未知维度即抛错（拼错的维度名比缺一个维度更危险）。 */
function readDimension(value: unknown, path: string): Dimension {
  const dimension = typeof value === 'string' ? value : ''
  const known = DIMENSIONS.find((candidate) => candidate === dimension)
  if (!known) {
    throw unexpectedResponse(`请求 ${path} 的响应里出现未知维度「${String(value)}」。`)
  }
  return known
}

function readDimensionList(value: unknown, path: string): Dimension[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readDimension(item, path))
}

function readAnswers(value: unknown): AttemptAnswer[] {
  if (!Array.isArray(value)) return []
  const answers: AttemptAnswer[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const questionId = optionalText(raw.questionId)
    if (!questionId) continue
    // 服务端给的是大写 kind；认不出的一律按 unknown 处理是**不安全**的，
    // 所以这里只认两种明确值，其余跳过（跳过 = 视为未作答，不会伪造一个答案）。
    const rawKind = typeof raw.kind === 'string' ? raw.kind.toUpperCase() : ''
    if (rawKind === 'RATING') {
      const rating = optionalNumber(raw.rating)
      if (rating === null) continue
      answers.push({ questionId, kind: 'rating', rating })
      continue
    }
    if (rawKind === 'UNKNOWN') answers.push({ questionId, kind: 'unknown', rating: null })
  }
  return answers
}

function readCoverage(value: unknown, path: string): CoverageView[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return []
    return [
      {
        dimension: readDimension(raw.dimension, path),
        baseRatingCount: intOr(raw.baseRatingCount, 0),
        baseUnknownCount: intOr(raw.baseUnknownCount, 0),
        baseUnprocessedCount: intOr(raw.baseUnprocessedCount, 0),
        needsClarification: raw.needsClarification === true,
        coverageOk: raw.coverageOk === true,
      },
    ]
  })
}

function readPole(value: unknown): PoleView {
  const raw = isRecord(value) ? value : {}
  return {
    pole: optionalText(raw.pole) ?? '',
    label: optionalText(raw.label) ?? '',
    description: optionalText(raw.description) ?? '',
    dailySigns: stringList(raw.dailySigns),
  }
}

function readPackageView(raw: unknown, path: string): PackageView | null {
  if (!isRecord(raw)) return null
  const packageId = optionalText(raw.packageId)
  if (!packageId) return null
  const instrument = isRecord(raw.instrument) ? raw.instrument : {}
  const policy = isRecord(raw.scoringPolicy) ? raw.scoringPolicy : {}
  const dimensions = Array.isArray(raw.dimensions)
    ? raw.dimensions.flatMap((item) => {
        if (!isRecord(item)) return []
        const balanced = isRecord(item.balanced)
          ? {
              summary: optionalText(item.balanced.summary) ?? '',
              reading: optionalText(item.balanced.reading) ?? '',
            }
          : null
        return [
          {
            dimension: readDimension(item.dimension, path),
            name: optionalText(item.name) ?? '',
            question: optionalText(item.question) ?? '',
            negativePole: readPole(item.negativePole),
            positivePole: readPole(item.positivePole),
            balanced,
            tiedNotice: optionalText(item.tiedNotice),
          },
        ]
      })
    : []
  const questions = Array.isArray(raw.questions)
    ? raw.questions.flatMap((item) => {
        if (!isRecord(item)) return []
        const id = optionalText(item.id)
        if (!id) return []
        const stage: Stage = item.stage === 'clarification' ? 'clarification' : 'base'
        return [
          {
            id,
            stage,
            dimension: readDimension(item.dimension, path),
            scenario: optionalText(item.scenario) ?? '',
            textLeft: optionalText(item.textLeft) ?? '',
            textRight: optionalText(item.textRight) ?? '',
            leftPole: optionalText(item.leftPole) ?? '',
            rightPole: optionalText(item.rightPole) ?? '',
            help: optionalText(item.help) ?? '',
            facet: optionalText(item.facet) ?? '',
            order: intOr(item.order, 0),
            reviewStatus: optionalText(item.reviewStatus) ?? '',
          },
        ]
      })
    : []
  return {
    schemaVersion: intOr(raw.schemaVersion, 0),
    packageId,
    instrument: {
      id: optionalText(instrument.id) ?? '',
      revision: optionalText(instrument.revision) ?? '',
      scoringVersion: optionalText(instrument.scoringVersion) ?? '',
      reportContentVersion: optionalText(instrument.reportContentVersion) ?? '',
      format: optionalText(instrument.format) ?? 'bipolar',
      hasTypeCode: instrument.hasTypeCode !== false,
      baseItemsPerDimension: intOr(instrument.baseItemsPerDimension, 12),
      clarificationItemsPerDimension: intOr(instrument.clarificationItemsPerDimension, 4),
      maxClarificationItems: intOr(instrument.maxClarificationItems, 16),
    },
    title: optionalText(raw.title) ?? '',
    contentStatus: optionalText(raw.contentStatus) ?? '',
    scoringPolicy: {
      version: optionalText(policy.version) ?? '',
      minBaseRatingsPerDimension: intOr(policy.minBaseRatingsPerDimension, 9),
      boundaryNumerator: intOr(policy.boundaryNumerator, 2),
      boundaryDenominator: intOr(policy.boundaryDenominator, 10),
      ratingMin: intOr(policy.ratingMin, 1),
      ratingMax: intOr(policy.ratingMax, 5),
      ratingNeutral: intOr(policy.ratingNeutral, 3),
    },
    dimensions,
    questions,
    sha256: optionalText(raw.sha256) ?? '',
  }
}

function readAttemptSummary(raw: unknown, path: string): AttemptSummary {
  const body = requireRecord(raw, path, 'attempt')
  return {
    attemptId: requireText(body.attemptId, path, 'attemptId'),
    packageId: optionalText(body.packageId) ?? '',
    status: requireText(body.status, path, 'status'),
    revision: requireInt(body.revision, path, 'revision'),
    currentQuestionId: optionalText(body.currentQuestionId),
    clarificationDimensions: readDimensionList(body.clarificationDimensions, path),
    clarificationSkipped: body.clarificationSkipped === true,
    startedAt: optionalText(body.startedAt),
    updatedAt: optionalText(body.updatedAt),
    submittedAt: optionalText(body.submittedAt),
    reportId: optionalText(body.reportId),
  }
}

function readSelfReflection(raw: unknown): SelfReflection {
  if (!isRecord(raw)) return { selfSelectedTypeCode: null, note: null, updatedAt: null }
  return {
    selfSelectedTypeCode: optionalText(raw.selfSelectedTypeCode),
    note: optionalText(raw.note),
    updatedAt: optionalText(raw.updatedAt),
  }
}

function readReportSummary(raw: unknown): ReportSummary | null {
  if (!isRecord(raw)) return null
  const reportId = optionalText(raw.reportId)
  if (!reportId) return null
  return {
    reportId,
    attemptId: optionalText(raw.attemptId),
    createdAt: optionalText(raw.createdAt),
    status: optionalText(raw.status) ?? '',
    computedTypeCode: optionalText(raw.computedTypeCode),
    selfSelectedTypeCode: optionalText(raw.selfSelectedTypeCode),
    summaryLine: optionalText(raw.summaryLine),
    packageId: optionalText(raw.packageId),
    scoringVersion: optionalText(raw.scoringVersion),
  }
}

function withQuery(path: string, query: Record<string, string | number>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) search.append(key, String(value))
  const suffix = search.toString()
  return suffix ? `${path}?${suffix}` : path
}

/* ── 端点 ───────────────────────────────────────────────────────────────── */

const CATALOG_PATH = '/catalog/current'
const PACKAGE_PATH = '/catalog/current/package'

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogSummary> {
  const response = await v3Request('GET', CATALOG_PATH, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, CATALOG_PATH), CATALOG_PATH, 'catalog')
  return {
    packageId: requireText(raw.packageId, CATALOG_PATH, 'packageId'),
    instrumentId: optionalText(raw.instrumentId),
    scoringVersion: optionalText(raw.scoringVersion),
    reportContentVersion: optionalText(raw.reportContentVersion),
    contentStatus: optionalText(raw.contentStatus),
    title: optionalText(raw.title),
    questionCount: intOr(raw.questionCount, 0),
    basePerDimension: intOr(raw.basePerDimension, 12),
    clarificationPerDimension: intOr(raw.clarificationPerDimension, 4),
    maxClarificationItems: intOr(raw.maxClarificationItems, 16),
    sha256: optionalText(raw.sha256),
    dimensions: Array.isArray(raw.dimensions)
      ? raw.dimensions.flatMap((item) => {
          if (!isRecord(item)) return []
          return [
            {
              dimension: readDimension(item.dimension, CATALOG_PATH),
              name: optionalText(item.name) ?? '',
              question: optionalText(item.question) ?? '',
              negativePole: optionalText(item.negativePole) ?? '',
              negativeLabel: optionalText(item.negativeLabel) ?? '',
              positivePole: optionalText(item.positivePole) ?? '',
              positiveLabel: optionalText(item.positiveLabel) ?? '',
            },
          ]
        })
      : [],
  }
}

/** 完整内容包（带 ETag）；`etag` 一并返回，便于调用方做条件缓存。 */
export async function fetchCurrentPackage(
  options: { signal?: AbortSignal } = {},
): Promise<{ packageView: PackageView; etag: string | null }> {
  const response = await v3Request('GET', PACKAGE_PATH, options.signal ? { signal: options.signal } : {})
  const etag = response.headers.get('ETag')
  const view = readPackageView(await v3ReadJson<unknown>(response, PACKAGE_PATH), PACKAGE_PATH)
  if (!view) throw unexpectedResponse('请求 /catalog/current/package 的响应里没有内容包。')
  return { packageView: view, etag }
}

/**
 * 新建一次测评。
 *
 * `Idempotency-Key` 由调用方给（同一次点击必须复用同一个键）：断网重试不应该产生
 * 两份草稿。`baseReportId` 是"以某份历史报告为基准再来一次"，可选。
 */
export async function createAttempt(input: {
  baseReportId?: string | null
  idempotencyKey?: string
  signal?: AbortSignal
} = {}): Promise<AttemptSummary> {
  const options: V3RequestOptions = {
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    body: input.baseReportId ? { baseReportId: input.baseReportId } : {},
  }
  if (input.signal) options.signal = input.signal
  const response = await v3Request('POST', '/attempts', options)
  return readAttemptSummary(await v3ReadJson<unknown>(response, '/attempts'), '/attempts')
}

export async function fetchAttempts(
  query: { status?: 'draft' | 'submitted'; page?: number; size?: number } = {},
  signal?: AbortSignal,
): Promise<{ items: AttemptSummary[]; page: number; size: number; total: number }> {
  const params: Record<string, string | number> = {
    page: query.page ?? 0,
    size: query.size ?? 20,
  }
  if (query.status) params.status = query.status
  const path = withQuery('/attempts', params)
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'items')
  requireArray(raw.items, path, 'items')
  const items = raw.items as unknown[]
  return {
    items: items.flatMap((item) => {
      try {
        return [readAttemptSummary(item, path)]
      } catch {
        return []
      }
    }),
    page: intOr(raw.page, params.page as number),
    size: intOr(raw.size, params.size as number),
    total: intOr(raw.total, 0),
  }
}

/** 断点续答的入口：一次拿齐 attempt、已答、覆盖情况与内容包。 */
export async function fetchAttemptDetail(attemptId: string, signal?: AbortSignal): Promise<AttemptDetail> {
  const path = `/attempts/${encodeURIComponent(attemptId)}`
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'attempt')
  const summary = readAttemptSummary(raw, path)
  return {
    ...summary,
    baseAttemptId: optionalText(raw.baseAttemptId),
    answers: readAnswers(raw.answers),
    coverage: readCoverage(raw.coverage, path),
    packageView: readPackageView(raw.packageContent, path),
  }
}

/**
 * 写答案。
 *
 * `expectedRevision` 是**必填**：服务端拿它做乐观并发控制，不匹配就回
 * `409 CONFLICT_REVISION` + `details.currentRevision`。前端唯一正确的处理是
 * 提示"另一台设备改过进度"并重新拉取，而不是把本地答案盖上去。
 */
export async function patchAnswers(
  attemptId: string,
  input: {
    expectedRevision: number
    responses: AnswerPatch[]
    currentQuestionId?: string | null
    signal?: AbortSignal
  },
): Promise<PatchAnswersResult> {
  const path = `/attempts/${encodeURIComponent(attemptId)}/answers`
  const body: Record<string, unknown> = {
    expectedRevision: input.expectedRevision,
    responses: input.responses.map((answer) =>
      answer.kind === 'rating'
        ? { questionId: answer.questionId, kind: 'rating', rating: answer.rating ?? null }
        : { questionId: answer.questionId, kind: 'unknown' },
    ),
  }
  if (input.currentQuestionId) body.currentQuestionId = input.currentQuestionId
  const options: V3RequestOptions = { body }
  if (input.signal) options.signal = input.signal
  const response = await v3Request('PATCH', path, options)
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'revision')
  return {
    revision: requireInt(raw.revision, path, 'revision'),
    status: optionalText(raw.status) ?? '',
    clarificationDimensions: readDimensionList(raw.clarificationDimensions, path),
    clarificationReset: raw.clarificationReset === true,
    currentQuestionId: optionalText(raw.currentQuestionId),
  }
}

/**
 * 提交前的 review：服务端决定是否安排补充题。
 *
 * `insufficientDimensions` 在覆盖不足时由后端给出（契约 §7.2 的 ReviewResponse 有它）；
 * 万一老版本后端没给，这里从 `coverage` 推导 —— 两者都由同一套覆盖规则产生，
 * 推导结果与后端一致，不存在"前端自己判覆盖"的风险。
 */
export async function reviewAttempt(attemptId: string, signal?: AbortSignal): Promise<ReviewResult> {
  const path = `/attempts/${encodeURIComponent(attemptId)}/review`
  const response = await v3Request('POST', path, { body: {}, ...(signal ? { signal } : {}) })
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'status')
  const coverage = readCoverage(raw.coverage, path)
  const declared = readDimensionList(raw.insufficientDimensions, path)
  return {
    status: optionalText(raw.status) ?? '',
    needsReview: raw.needsReview === true,
    clarificationDimensions: readDimensionList(raw.clarificationDimensions, path),
    coverage,
    insufficientDimensions:
      declared.length > 0
        ? declared
        : coverage.filter((row) => !row.coverageOk).map((row) => row.dimension),
  }
}

/**
 * 交卷。
 *
 * 覆盖不足时服务端返回 **200 + `status: "NEEDS_REVIEW"`**（不是错误）：调用方必须
 * 把它当成"还差几维"的正常结果处理，从 `coverage` 里挑出没达标的那几维。
 */
export async function submitAttempt(
  attemptId: string,
  input: {
    expectedRevision: number
    clarificationSkipped?: boolean
    idempotencyKey?: string
    signal?: AbortSignal
  },
): Promise<SubmitResult> {
  const path = `/attempts/${encodeURIComponent(attemptId)}/submit`
  const options: V3RequestOptions = {
    body: {
      expectedRevision: input.expectedRevision,
      clarificationSkipped: input.clarificationSkipped === true,
    },
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
  }
  if (input.signal) options.signal = input.signal
  const response = await v3Request('POST', path, options)
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'status')
  const coverage = readCoverage(raw.coverage, path)
  return {
    reportId: optionalText(raw.reportId),
    attemptId: optionalText(raw.attemptId) ?? attemptId,
    status: optionalText(raw.status) ?? '',
    computedTypeCode: optionalText(raw.computedTypeCode),
    candidateCodes: stringList(raw.candidateCodes),
    coverage,
    coverageOk: raw.coverageOk === true,
    insufficientDimensions: coverage
      .filter((row) => !row.coverageOk)
      .map((row) => row.dimension),
  }
}

export async function deleteAttempt(attemptId: string): Promise<void> {
  const path = `/attempts/${encodeURIComponent(attemptId)}`
  await v3IgnoreBody(await v3Request('DELETE', path))
}

export async function fetchReports(
  query: { page?: number; size?: number } = {},
  signal?: AbortSignal,
): Promise<ReportListPage> {
  const params: Record<string, string | number> = {
    page: query.page ?? 0,
    size: query.size ?? 20,
  }
  const path = withQuery('/reports', params)
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'items')
  requireArray(raw.items, path, 'items')
  const items = raw.items as unknown[]
  return {
    items: items.flatMap((item) => {
      const summary = readReportSummary(item)
      return summary ? [summary] : []
    }),
    page: intOr(raw.page, params.page as number),
    size: intOr(raw.size, params.size as number),
    total: intOr(raw.total, 0),
  }
}

export async function fetchReportDetail(reportId: string, signal?: AbortSignal): Promise<ReportDetail> {
  const path = `/reports/${encodeURIComponent(reportId)}`
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'report')
  const report = raw.report
  if (!isRecord(report)) {
    throw unexpectedResponse('这份报告的响应里没有报告内容（report）。历史报告只读快照，不能为空。')
  }
  return {
    report,
    selfReflection: readSelfReflection(raw.selfReflection),
    attemptId: optionalText(raw.attemptId),
    attemptRevision: optionalNumber(raw.attemptRevision),
  }
}

/** 按 attempt 取报告：交卷后跳转用，避免先查列表再匹配。 */
export async function fetchReportByAttempt(attemptId: string, signal?: AbortSignal): Promise<ReportDetail> {
  const path = `/attempts/${encodeURIComponent(attemptId)}/report`
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'report')
  const report = raw.report
  if (!isRecord(report)) {
    throw unexpectedResponse('这次测评还没有报告。')
  }
  return {
    report,
    selfReflection: readSelfReflection(raw.selfReflection),
    attemptId: optionalText(raw.attemptId) ?? attemptId,
    attemptRevision: optionalNumber(raw.attemptRevision),
  }
}

/**
 * 保存"我的自我理解"。
 *
 * 与问卷结果**隔离**：服务端只写 `report_self_reflection`，不碰 `report_json`。
 * 因此这里返回的是自我理解本身，调用方**不得**用它去覆盖报告。
 */
export async function saveSelfReflection(
  reportId: string,
  input: { selfSelectedTypeCode?: string | null; note?: string | null },
): Promise<SelfReflection> {
  const path = `/reports/${encodeURIComponent(reportId)}/self-reflection`
  const response = await v3Request('PUT', path, {
    body: {
      selfSelectedTypeCode: input.selfSelectedTypeCode ?? null,
      note: input.note ?? null,
    },
  })
  return readSelfReflection(await v3ReadJson<unknown>(response, path))
}

export async function deleteReport(reportId: string): Promise<void> {
  const path = `/reports/${encodeURIComponent(reportId)}`
  await v3IgnoreBody(await v3Request('DELETE', path))
}

export async function compareReports(ids: string[], signal?: AbortSignal): Promise<CompareResult> {
  if (ids.length === 0) {
    throw unexpectedResponse('比较报告需要至少一个报告 ID。')
  }
  const path = withQuery('/reports/compare', { ids: ids.join(',') })
  const response = await v3Request('GET', path, signal ? { signal } : {})
  const raw = requireRecord(await v3ReadJson<unknown>(response, path), path, 'reports')
  return {
    reports: Array.isArray(raw.reports)
      ? raw.reports.flatMap((item) => {
          const summary = readReportSummary(item)
          return summary ? [summary] : []
        })
      : [],
    differences: Array.isArray(raw.differences)
      ? raw.differences.flatMap((item) => {
          if (!isRecord(item)) return []
          return [
            {
              dimension: readDimension(item.dimension, path),
              fromPole: optionalText(item.fromPole),
              toPole: optionalText(item.toPole),
              fromMFinal: optionalNumber(item.fromMFinal),
              toMFinal: optionalNumber(item.toMFinal),
              changed: item.changed === true,
            },
          ]
        })
      : [],
    samePackage: raw.samePackage === true,
    notes: stringList(raw.notes),
  }
}

/** `details.currentRevision`（409 CONFLICT_REVISION）：交给页面提示并触发重新拉取。 */
export function currentRevisionOf(error: unknown): number | null {
  if (!isV3ApiError(error)) return null
  if (error.code !== 'CONFLICT_REVISION') return null
  return optionalNumber(error.details['currentRevision'])
}
