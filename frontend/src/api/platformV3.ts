import {
  unexpectedResponse,
  v3ReadJson,
  v3Request,
  V3ApiError,
} from '@/api/v3'
import type { Dimension } from '@/domain/jung/types'

/**
 * `/api/v3/platform`：**量表无关**的测评流程。
 *
 * ## 为什么另开一个模块而不是扩展 `v3Assessment.ts`
 *
 * `v3Assessment.ts` 里的类型（`CatalogSummary`、`PackageView`、`AttemptSummary`）
 * 描述的是十六型：四个维度、双极题、类型码。大五进来之后，把两者合成一个类型意味着
 * 几乎每个字段都要变成可空，而"这个字段什么时候有值"就只能靠注释说明 ——
 * 那正是"看起来能跑但读错"的来源。所以这里的类型是**中性**的，
 * 量表专属的部分由 `instrumentKind` / `reportKind` 分流。
 *
 * ## 字段缺失一律拒绝，不补默认值
 *
 * 与 `v3Assessment.ts` 同一条纪律：缺少必需字段时抛 `UNEXPECTED_RESPONSE_CODE`。
 * 补默认值的后果在大五上尤其严重 —— 例如 `direction` 补成 1，
 * 会让一个反向题的题面标注变成"越符合越高"，而用户看到的一切都正常。
 */

/* ── 类型 ───────────────────────────────────────────────────────────────── */

export type InstrumentKind = 'jung' | 'big_five'
export type ReportKind = 'jung_reference' | 'big_five_profile'
export type ItemKind = 'bipolar_pair' | 'agreement_statement'
export type AnswerKind = 'RATING' | 'UNKNOWN'

/** 目录里的一张卡片。数字全部来自服务端，页面**不许**自己写题数与时长。 */
export interface InstrumentCard {
  slug: string
  kind: InstrumentKind
  title: string
  tagline: string
  summary: string
  whatYouLearn: string[]
  notFor: string[]
  format: 'bipolar' | 'agreement'
  hasTypeCode: boolean
  supportsClarification: boolean
  dimensions: string[]
  defaultPackageId: string
  baseItemCount: number
  clarificationItemCount: number
  maxClarificationItems: number
  estimatedMinutes: number
  contentStatus: string
}

export interface DimensionCopyView {
  dimension: string
  name: string
  question: string
  lowLabel: string
  lowDescription: string
  lowSigns: string[]
  highLabel: string
  highDescription: string
  highSigns: string[]
  balancedSummary: string | null
  caution: string
  observation: string | null
}

export interface VersionView {
  packageId: string
  revision: string
  scoringVersion: string
  reportContentVersion: string
  contentStatus: string
  sha256: string
  isDefault: boolean
  baseItemCount: number
  clarificationItemCount: number
}

export interface InstrumentDetail {
  instrument: InstrumentCard
  dimensions: DimensionCopyView[]
  versions: VersionView[]
}

/**
 * 一道题。
 *
 * `kind` 决定看哪几个字段：双极题看 `left` / `right`，单句题看 `statement`。
 * 另一组字段为 null 是**约定**，不是"可能忘了填"。
 */
export interface ItemView {
  id: string
  kind: ItemKind
  stage: 'base' | 'clarification'
  dimension: string
  order: number
  scenario: string | null
  left: string | null
  right: string | null
  statement: string | null
  leftPole: string | null
  rightPole: string | null
  direction: number | null
  help: string | null
}

export interface AnswerView {
  questionId: string
  kind: AnswerKind
  rating: number | null
}

export interface AttemptView {
  attemptId: string
  instrumentSlug: string
  instrumentKind: InstrumentKind
  instrumentTitle: string
  packageId: string
  reportKind: ReportKind
  status: string
  revision: number
  currentQuestionId: string | null
  clarificationDimensions: string[]
  clarificationSkipped: boolean
  startedAt: string
  updatedAt: string
  submittedAt: string | null
  baseAttemptId: string | null
  reportId: string | null
  answers: AnswerView[]
  items: ItemView[]
  answeredCount: number
  requiredCount: number
  answerComplete: boolean
}

export interface PatchAnswersResponse {
  revision: number
  status: string
  answeredCount: number
  requiredCount: number
  answerComplete: boolean
  currentQuestionId: string | null
}

/**
 * 提交结果。
 *
 * `status === 'INCOMPLETE'` 时 `incompleteQuestionIds` 非空且 `reportId` 为 null ——
 * 这不是错误，是"还没答完"，页面应回到答题页把缺的题标出来。
 */
export interface SubmitResponse {
  reportId: string | null
  attemptId: string
  status: string
  reportKind: ReportKind
  incompleteQuestionIds: string[]
  unknownCount: number
  unprocessedCount: number
}

export interface MyAttemptRow {
  attemptId: string
  instrumentSlug: string
  instrumentKind: InstrumentKind | 'unknown'
  instrumentTitle: string
  packageId: string
  reportContentVersion: string | null
  status: string
  revision: number
  startedAt: string
  updatedAt: string
  submittedAt: string | null
  reportId: string | null
  reportStatus: string | null
  computedTypeCode: string | null
  answeredCount: number
  requiredCount: number
}

export interface MyReportRow {
  reportId: string
  attemptId: string
  instrumentSlug: string
  instrumentKind: InstrumentKind | 'unknown'
  instrumentTitle: string
  reportKind: ReportKind
  packageId: string
  status: string
  computedTypeCode: string | null
  summaryLine: string
  createdAt: string
}

export interface ReportDetailView {
  reportId: string
  attemptId: string
  instrumentSlug: string
  instrumentKind: InstrumentKind | 'unknown'
  instrumentTitle: string
  reportKind: ReportKind
  packageId: string
  createdAt: string
  status: string
  computedTypeCode: string | null
  summaryLine: string | null
  /** **原样**的报告快照：v2 有外壳，v1 只有报告体。渲染前必须判断结构。 */
  report: Record<string, unknown>
  selfReflection: Record<string, unknown>
  attemptRevision: number
}

/* ── 解析 ───────────────────────────────────────────────────────────────── */

function fail(path: string, field: string, why: string): never {
  throw unexpectedResponse(`接口 ${path} 返回的数据不符合约定：${field} ${why}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function obj(source: unknown, field: string, path: string): Record<string, unknown> {
  if (!isRecord(source)) fail(path, field, '不是对象')
  const value = source[field]
  if (!isRecord(value)) fail(path, field, '缺失或不是对象')
  return value
}

function str(source: Record<string, unknown>, field: string, path: string): string {
  const value = source[field]
  if (typeof value !== 'string') fail(path, field, '缺失或不是字符串')
  return value
}

function nullableStr(source: Record<string, unknown>, field: string, path: string): string | null {
  const value = source[field]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') fail(path, field, '不是字符串也不是 null')
  return value
}

function num(source: Record<string, unknown>, field: string, path: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, field, '缺失或不是数字')
  return value
}

function bool(source: Record<string, unknown>, field: string, path: string): boolean {
  const value = source[field]
  if (typeof value !== 'boolean') fail(path, field, '缺失或不是布尔值')
  return value
}

function arr(source: Record<string, unknown>, field: string, path: string): unknown[] {
  const value = source[field]
  if (!Array.isArray(value)) fail(path, field, '缺失或不是数组')
  return value
}

function strArray(source: Record<string, unknown>, field: string, path: string): string[] {
  return arr(source, field, path).map((item, index) => {
    if (typeof item !== 'string') fail(path, `${field}[${index}]`, '不是字符串')
    return item
  })
}

function oneOf<T extends string>(value: string, allowed: readonly T[], field: string, path: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    fail(path, field, `是「${value}」，不在允许的取值里（${allowed.join(' / ')}）`)
  }
  return value as T
}

const INSTRUMENT_KINDS = ['jung', 'big_five'] as const
const REPORT_KINDS = ['jung_reference', 'big_five_profile'] as const
const ITEM_KINDS = ['bipolar_pair', 'agreement_statement'] as const

function parseCard(raw: unknown, path: string): InstrumentCard {
  const source = obj({ card: raw }, 'card', path)
  const format = str(source, 'format', path)
  if (format !== 'bipolar' && format !== 'agreement') fail(path, 'format', `是「${format}」`)
  return {
    slug: str(source, 'slug', path),
    kind: oneOf(str(source, 'kind', path), INSTRUMENT_KINDS, 'kind', path),
    title: str(source, 'title', path),
    tagline: str(source, 'tagline', path),
    summary: str(source, 'summary', path),
    whatYouLearn: strArray(source, 'whatYouLearn', path),
    notFor: strArray(source, 'notFor', path),
    format,
    hasTypeCode: bool(source, 'hasTypeCode', path),
    supportsClarification: bool(source, 'supportsClarification', path),
    dimensions: strArray(source, 'dimensions', path),
    defaultPackageId: str(source, 'defaultPackageId', path),
    baseItemCount: num(source, 'baseItemCount', path),
    clarificationItemCount: num(source, 'clarificationItemCount', path),
    maxClarificationItems: num(source, 'maxClarificationItems', path),
    estimatedMinutes: num(source, 'estimatedMinutes', path),
    contentStatus: str(source, 'contentStatus', path),
  }
}

function parseDimensionCopy(raw: unknown, path: string): DimensionCopyView {
  const source = obj({ copy: raw }, 'copy', path)
  return {
    dimension: str(source, 'dimension', path),
    name: str(source, 'name', path),
    question: str(source, 'question', path),
    lowLabel: str(source, 'lowLabel', path),
    lowDescription: str(source, 'lowDescription', path),
    lowSigns: strArray(source, 'lowSigns', path),
    highLabel: str(source, 'highLabel', path),
    highDescription: str(source, 'highDescription', path),
    highSigns: strArray(source, 'highSigns', path),
    balancedSummary: nullableStr(source, 'balancedSummary', path),
    caution: str(source, 'caution', path),
    observation: nullableStr(source, 'observation', path),
  }
}

function parseVersion(raw: unknown, path: string): VersionView {
  const source = obj({ version: raw }, 'version', path)
  return {
    packageId: str(source, 'packageId', path),
    revision: str(source, 'revision', path),
    scoringVersion: str(source, 'scoringVersion', path),
    reportContentVersion: str(source, 'reportContentVersion', path),
    contentStatus: str(source, 'contentStatus', path),
    sha256: str(source, 'sha256', path),
    isDefault: bool(source, 'isDefault', path),
    baseItemCount: num(source, 'baseItemCount', path),
    clarificationItemCount: num(source, 'clarificationItemCount', path),
  }
}

function parseInt2(raw: unknown, path: string): ItemView {
  const source = obj({ item: raw }, 'item', path)
  const kind = oneOf(str(source, 'kind', path), ITEM_KINDS, 'kind', path)
  const stage = str(source, 'stage', path)
  if (stage !== 'base' && stage !== 'clarification') fail(path, 'stage', `是「${stage}」`)
  const direction = source['direction']
  if (direction !== null && direction !== undefined && typeof direction !== 'number') {
    fail(path, 'direction', '既不是数字也不是 null')
  }
  return {
    id: str(source, 'id', path),
    kind,
    stage,
    dimension: str(source, 'dimension', path),
    order: num(source, 'order', path),
    scenario: nullableStr(source, 'scenario', path),
    left: nullableStr(source, 'left', path),
    right: nullableStr(source, 'right', path),
    statement: nullableStr(source, 'statement', path),
    leftPole: nullableStr(source, 'leftPole', path),
    rightPole: nullableStr(source, 'rightPole', path),
    direction: typeof direction === 'number' ? direction : null,
    help: nullableStr(source, 'help', path),
  }
}

function parseAnswer(raw: unknown, path: string): AnswerView {
  const source = obj({ answer: raw }, 'answer', path)
  const kind = str(source, 'kind', path)
  if (kind !== 'RATING' && kind !== 'UNKNOWN') fail(path, 'kind', `是「${kind}」`)
  const rating = source['rating']
  if (rating !== null && rating !== undefined && typeof rating !== 'number') {
    fail(path, 'rating', '既不是数字也不是 null')
  }
  return {
    questionId: str(source, 'questionId', path),
    kind,
    rating: typeof rating === 'number' ? rating : null,
  }
}

function parseAttempt(raw: unknown, path: string): AttemptView {
  const source = obj({ attempt: raw }, 'attempt', path)
  return {
    attemptId: str(source, 'attemptId', path),
    instrumentSlug: str(source, 'instrumentSlug', path),
    instrumentKind: oneOf(str(source, 'instrumentKind', path), INSTRUMENT_KINDS, 'instrumentKind', path),
    instrumentTitle: str(source, 'instrumentTitle', path),
    packageId: str(source, 'packageId', path),
    reportKind: oneOf(str(source, 'reportKind', path), REPORT_KINDS, 'reportKind', path),
    status: str(source, 'status', path),
    revision: num(source, 'revision', path),
    currentQuestionId: nullableStr(source, 'currentQuestionId', path),
    clarificationDimensions: strArray(source, 'clarificationDimensions', path),
    clarificationSkipped: bool(source, 'clarificationSkipped', path),
    startedAt: str(source, 'startedAt', path),
    updatedAt: str(source, 'updatedAt', path),
    submittedAt: nullableStr(source, 'submittedAt', path),
    baseAttemptId: nullableStr(source, 'baseAttemptId', path),
    reportId: nullableStr(source, 'reportId', path),
    answers: arr(source, 'answers', path).map((item, index) => parseAnswer(item, `${path}.answers[${index}]`)),
    items: arr(source, 'items', path).map((item, index) => parseInt2(item, `${path}.items[${index}]`)),
    answeredCount: num(source, 'answeredCount', path),
    requiredCount: num(source, 'requiredCount', path),
    answerComplete: bool(source, 'answerComplete', path),
  }
}

export function parseMyAttempt(raw: unknown, path: string): MyAttemptRow {
  const source = obj({ row: raw }, 'row', path)
  const kind = str(source, 'instrumentKind', path)
  return {
    attemptId: str(source, 'attemptId', path),
    instrumentSlug: str(source, 'instrumentSlug', path),
    instrumentKind: kind === 'jung' || kind === 'big_five' ? kind : 'unknown',
    instrumentTitle: str(source, 'instrumentTitle', path),
    packageId: str(source, 'packageId', path),
    reportContentVersion: nullableStr(source, 'reportContentVersion', path),
    status: str(source, 'status', path),
    revision: num(source, 'revision', path),
    startedAt: str(source, 'startedAt', path),
    updatedAt: str(source, 'updatedAt', path),
    submittedAt: nullableStr(source, 'submittedAt', path),
    reportId: nullableStr(source, 'reportId', path),
    reportStatus: nullableStr(source, 'reportStatus', path),
    computedTypeCode: nullableStr(source, 'computedTypeCode', path),
    answeredCount: num(source, 'answeredCount', path),
    requiredCount: num(source, 'requiredCount', path),
  }
}

export function parseMyReport(raw: unknown, path: string): MyReportRow {
  const source = obj({ row: raw }, 'row', path)
  const kind = str(source, 'instrumentKind', path)
  return {
    reportId: str(source, 'reportId', path),
    attemptId: str(source, 'attemptId', path),
    instrumentSlug: str(source, 'instrumentSlug', path),
    instrumentKind: kind === 'jung' || kind === 'big_five' ? kind : 'unknown',
    instrumentTitle: str(source, 'instrumentTitle', path),
    reportKind: oneOf(str(source, 'reportKind', path), REPORT_KINDS, 'reportKind', path),
    packageId: str(source, 'packageId', path),
    status: str(source, 'status', path),
    computedTypeCode: nullableStr(source, 'computedTypeCode', path),
    summaryLine: str(source, 'summaryLine', path),
    createdAt: str(source, 'createdAt', path),
  }
}

export function parseReportDetail(raw: unknown, path: string): ReportDetailView {
  const source = obj({ detail: raw }, 'detail', path)
  if (!isRecord(source['report'])) fail(path, 'report', '缺失或不是对象')
  const kind = str(source, 'instrumentKind', path)
  return {
    reportId: str(source, 'reportId', path),
    attemptId: str(source, 'attemptId', path),
    instrumentSlug: str(source, 'instrumentSlug', path),
    instrumentKind: kind === 'jung' || kind === 'big_five' ? kind : 'unknown',
    instrumentTitle: str(source, 'instrumentTitle', path),
    reportKind: oneOf(str(source, 'reportKind', path), REPORT_KINDS, 'reportKind', path),
    packageId: str(source, 'packageId', path),
    createdAt: str(source, 'createdAt', path),
    status: str(source, 'status', path),
    computedTypeCode: nullableStr(source, 'computedTypeCode', path),
    summaryLine: nullableStr(source, 'summaryLine', path),
    report: source['report'] as Record<string, unknown>,
    selfReflection: isRecord(source['selfReflection'])
      ? (source['selfReflection'] as Record<string, unknown>)
      : {},
    attemptRevision: num(source, 'attemptRevision', path),
  }
}

/* ── 报告体解包 ─────────────────────────────────────────────────────────── */

/**
 * 取出报告体：整份快照 → 外壳里的 `report`。
 *
 * v2 报告是「中性外壳 + `report` 体」，v1 报告体就是根节点本身。
 * **判据是"根节点有没有 `report` 对象"，不是 `schemaVersion`** —— 有些早期快照没写版本号。
 * 历史报告只读不改，所以这里只做一次下钻，绝不去补字段。
 *
 * 两层结构的意义（2026-09-20 故障复盘）：`reportHash` 挂在外壳层、结论字段在报告体层，
 * 所以解析器一律**先接整份快照、再调这里下钻一次**；调用方既不要自己传下钻后的对象，
 * 也不要自己再下钻 —— 多钻或少钻都会让页面显示「这份报告读不出来」。
 */
export function reportBodyOf(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw['report']
  return isRecord(nested) ? nested : raw
}

/** 报告是否为 v2 外壳结构（页面据此决定是否显示"按哪一版内容生成"）。 */
export function isEnvelopedReport(raw: Record<string, unknown>): boolean {
  return isRecord(raw['instrument']) && isRecord(raw['report'])
}

/* ── 请求 ───────────────────────────────────────────────────────────────── */

/**
 * 平台端点的**相对**路径前缀。
 *
 * 必须相对：`v3Request` 自己会在前面加 `/api/v3`（见 `api/v3.ts` 的 `V3_BASE`）。
 * 这里写全 `/api/v3/platform` 会让每个请求都变成 `/api/v3/api/v3/platform/...`，
 * 而失败的样子是 404 —— 在页面测试里表现为"目录永远是空的、列表永远没有草稿"，
 * 很容易被当成'服务端还没准备好'而不是客户端拼错了路径。
 */
const BASE = '/platform'

/** 页面需要区分"服务端还没准备好"（503 PACKAGE_NOT_SEEDED）等具体错误码时用它收窄。 */
export function isPlatformError(error: unknown): error is V3ApiError {
  return error instanceof V3ApiError
}

export async function fetchInstruments(): Promise<InstrumentCard[]> {
  const path = `${BASE}/instruments`
  const response = await v3Request('GET', path)
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  return arr(payload, 'items', path).map((item, index) =>
    parseCard(item, `${path}.items[${index}]`),
  )
}

/* ── 公开插画地址 ───────────────────────────────────────────────────────── */

/** 库里的一条插画地址。`sha256` 供核对脚本用，页面不使用它。 */
export interface IllustrationAssetView {
  name: string
  url: string
  sha256: string
}

/**
 * 一份**完整**的插画地址映射以及它的版本号。
 *
 * `urls` 是 `名字 → 绝对地址`。**地址原样带回**：这里不做"能不能用"的判断，
 * 那是解析层（`design/illustrationAssets.ts`）的事，这样"契约形状不对"与
 * "地址不该用"两类问题不会混在一个错误里。
 *
 * `version` 由服务端给出（行数 + 最新更新时间），前端只拿它判断本地缓存是否还有效，
 * **不要解析它的内部结构**。
 */
export interface IllustrationMap {
  release: string | null
  version: string
  urls: Record<string, string>
}

function parseIllustrationAsset(raw: unknown, path: string): IllustrationAssetView {
  const source = obj({ asset: raw }, 'asset', path)
  return {
    name: str(source, 'name', path),
    url: str(source, 'url', path),
    sha256: str(source, 'sha256', path),
  }
}

/**
 * 读公开插画地址（匿名可读）。
 *
 * 表为空时返回空映射，**不是错误**：页面会继续用本地打包资源。
 */
export async function fetchIllustrations(): Promise<IllustrationMap> {
  const path = `${BASE}/illustrations`
  const response = await v3Request('GET', path)
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  const urls: Record<string, string> = {}
  arr(payload, 'assets', path).forEach((item, index) => {
    const asset = parseIllustrationAsset(item, `${path}.assets[${index}]`)
    urls[asset.name] = asset.url
  })
  return {
    release: nullableStr(payload, 'release', path),
    version: str(payload, 'version', path),
    urls,
  }
}

export async function fetchInstrumentDetail(slug: string): Promise<InstrumentDetail> {
  const path = `${BASE}/instruments/${encodeURIComponent(slug)}`
  const response = await v3Request('GET', path)
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  const source = obj({ detail: payload }, 'detail', path)
  return {
    instrument: parseCard(source['instrument'], `${path}.instrument`),
    dimensions: arr(source, 'dimensions', path).map((item, index) =>
      parseDimensionCopy(item, `${path}.dimensions[${index}]`),
    ),
    versions: arr(source, 'versions', path).map((item, index) =>
      parseVersion(item, `${path}.versions[${index}]`),
    ),
  }
}

/**
 * 开始一次测评。
 *
 * `idempotencyKey` 由调用方生成并在**重试时保持不变**：否则请求超时后重试会多出
 * 一份用户看不见的草稿。
 */
export async function createPlatformAttempt(input: {
  instrument: string
  baseReportId?: string | null
  idempotencyKey?: string | null
}): Promise<AttemptView> {
  const path = `${BASE}/attempts`
  const response = await v3Request('POST', path, {
    body: { instrument: input.instrument, baseReportId: input.baseReportId ?? null },
    // 只有真的有键时才传：传 undefined 与不传等价，但传 null 会让类型与运行时语义分叉。
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  })
  return parseAttempt(await v3ReadJson<unknown>(response, path), path)
}

export async function fetchPlatformAttempt(attemptId: string): Promise<AttemptView> {
  const path = `${BASE}/attempts/${encodeURIComponent(attemptId)}`
  const response = await v3Request('GET', path)
  return parseAttempt(await v3ReadJson<unknown>(response, path), path)
}

export async function patchPlatformAnswers(
  attemptId: string,
  input: {
    expectedRevision: number
    currentQuestionId?: string | null
    responses: { questionId: string; kind: AnswerKind; rating?: number | null }[]
  },
): Promise<PatchAnswersResponse> {
  const path = `${BASE}/attempts/${encodeURIComponent(attemptId)}/answers`
  const response = await v3Request('PATCH', path, {
    body: {
      expectedRevision: input.expectedRevision,
      currentQuestionId: input.currentQuestionId ?? null,
      responses: input.responses.map((item) => ({
        questionId: item.questionId,
        kind: item.kind,
        rating: item.rating ?? null,
      })),
    },
  })
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  return {
    revision: num(payload, 'revision', path),
    status: str(payload, 'status', path),
    answeredCount: num(payload, 'answeredCount', path),
    requiredCount: num(payload, 'requiredCount', path),
    answerComplete: bool(payload, 'answerComplete', path),
    currentQuestionId: nullableStr(payload, 'currentQuestionId', path),
  }
}

export async function submitPlatformAttempt(
  attemptId: string,
  expectedRevision: number | null,
): Promise<SubmitResponse> {
  const path = `${BASE}/attempts/${encodeURIComponent(attemptId)}/submit`
  const response = await v3Request('POST', path, {
    body: { expectedRevision },
  })
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  return {
    reportId: nullableStr(payload, 'reportId', path),
    attemptId: str(payload, 'attemptId', path),
    status: str(payload, 'status', path),
    reportKind: oneOf(str(payload, 'reportKind', path), REPORT_KINDS, 'reportKind', path),
    incompleteQuestionIds: strArray(payload, 'incompleteQuestionIds', path),
    unknownCount: num(payload, 'unknownCount', path),
    unprocessedCount: num(payload, 'unprocessedCount', path),
  }
}

export async function fetchMyAttempts(page = 0, size = 20): Promise<{
  items: MyAttemptRow[]
  page: number
  size: number
  total: number
}> {
  const path = `${BASE}/attempts?page=${page}&size=${size}`
  const response = await v3Request('GET', path)
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  return {
    items: arr(payload, 'items', path).map((item, index) =>
      parseMyAttempt(item, `${path}.items[${index}]`),
    ),
    page: num(payload, 'page', path),
    size: num(payload, 'size', path),
    total: num(payload, 'total', path),
  }
}

export async function fetchMyReports(page = 0, size = 20): Promise<{
  items: MyReportRow[]
  page: number
  size: number
  total: number
}> {
  const path = `${BASE}/reports?page=${page}&size=${size}`
  const response = await v3Request('GET', path)
  const payload = await v3ReadJson<Record<string, unknown>>(response, path)
  return {
    items: arr(payload, 'items', path).map((item, index) =>
      parseMyReport(item, `${path}.items[${index}]`),
    ),
    page: num(payload, 'page', path),
    size: num(payload, 'size', path),
    total: num(payload, 'total', path),
  }
}

export async function fetchPlatformReport(reportId: string): Promise<ReportDetailView> {
  const path = `${BASE}/reports/${encodeURIComponent(reportId)}`
  const response = await v3Request('GET', path)
  return parseReportDetail(await v3ReadJson<unknown>(response, path), path)
}

export async function fetchPlatformReportByAttempt(attemptId: string): Promise<ReportDetailView> {
  const path = `${BASE}/attempts/${encodeURIComponent(attemptId)}/report`
  const response = await v3Request('GET', path)
  return parseReportDetail(await v3ReadJson<unknown>(response, path), path)
}

/* ── 大五报告体（渲染用） ───────────────────────────────────────────────── */

export interface BigFiveDimensionView {
  dimension: string
  name: string
  question: string
  hasResult: boolean
  rawScore: number | null
  rangeLow: number
  rangeHigh: number
  /** 服务端给出的量表中点。历史快照的量程可能错误，不能据此重算中点。 */
  midpoint: number
  distance: number | null
  level: string | null
  levelLabel: string | null
  direction: 'high' | 'low' | 'middle'
  validCount: number
  unknownCount: number
  unprocessedCount: number
  sideLabel: string | null
  description: string | null
  dailySigns: string[]
  reading: string
  observation: string | null
  caution: string
}

export interface BigFiveReportView {
  status: string
  profileTitle: string
  summary: string
  dimensions: BigFiveDimensionView[]
  coverage: {
    completed: boolean
    coverageOk: boolean
    unknownCount: number
    unprocessedCount: number
    incompleteDimensions: string[]
  }
  readingOrder: { step: string; why: string }[]
  limitations: string[]
}

/**
 * 解析大五报告快照。
 *
 * 只在 `reportKind === 'big_five_profile'` 时调用。字段缺失时抛错而不是补默认值：
 * 报告页是用户最终看到的东西，宁可显示"这份报告无法渲染"也不要把一维的缺失
 * 悄悄画成"接近中间"。
 *
 * ⚠️ 参数是**整份快照的根节点**（`ReportDetail.report` 原样，含外壳），
 * 函数内部自己下钻到外壳里的报告体 —— 与 `buildReportView` 同一套约定。
 * 两层结构的意义见 `reportBodyOf` 的说明。
 */
export function parseBigFiveReport(snapshot: Record<string, unknown>): BigFiveReportView {
  const path = '大五报告'
  const body = reportBodyOf(snapshot)
  const coverageRaw = obj(body, 'coverage', path)
  return {
    status: str(body, 'status', path),
    profileTitle: str(body, 'profileTitle', path),
    summary: str(body, 'summary', path),
    dimensions: arr(body, 'dimensions', path).map((item, index) => {
      const where = `${path}.dimensions[${index}]`
      const source = obj({ dimension: item }, 'dimension', where)
      const direction = str(source, 'direction', where)
      if (direction !== 'high' && direction !== 'low' && direction !== 'middle') {
        fail(where, 'direction', `是「${direction}」`)
      }
      const rawScore = source['rawScore']
      const distance = source['distance']
      return {
        dimension: str(source, 'dimension', where),
        name: str(source, 'name', where),
        question: str(source, 'question', where),
        hasResult: bool(source, 'hasResult', where),
        rawScore: typeof rawScore === 'number' ? rawScore : null,
        rangeLow: num(source, 'rangeLow', where),
        rangeHigh: num(source, 'rangeHigh', where),
        midpoint: num(source, 'midpoint', where),
        distance: typeof distance === 'number' ? distance : null,
        level: nullableStr(source, 'level', where),
        levelLabel: nullableStr(source, 'levelLabel', where),
        direction,
        validCount: num(source, 'validCount', where),
        unknownCount: num(source, 'unknownCount', where),
        unprocessedCount: num(source, 'unprocessedCount', where),
        sideLabel: nullableStr(source, 'sideLabel', where),
        description: nullableStr(source, 'description', where),
        dailySigns: strArray(source, 'dailySigns', where),
        reading: str(source, 'reading', where),
        observation: nullableStr(source, 'observation', where),
        caution: str(source, 'caution', where),
      }
    }),
    coverage: {
      completed: bool(coverageRaw, 'completed', path),
      coverageOk: bool(coverageRaw, 'coverageOk', path),
      unknownCount: num(coverageRaw, 'unknownCount', path),
      unprocessedCount: num(coverageRaw, 'unprocessedCount', path),
      incompleteDimensions: strArray(coverageRaw, 'incompleteDimensions', path),
    },
    readingOrder: arr(body, 'readingOrder', path).map((item, index) => {
      const where = `${path}.readingOrder[${index}]`
      const source = obj({ step: item }, 'step', where)
      return { step: str(source, 'step', where), why: str(source, 'why', where) }
    }),
    limitations: strArray(body, 'limitations', path),
  }
}

/** 大五维度 code（用于与目录/文案对照，不作为类型使用）。 */
export type BigFiveDimensionCode = 'E' | 'A' | 'C' | 'ES' | 'O'

/** 十六型维度（`ItemView.dimension` 在十六型上是这四个）。 */
export type JungDimensionCode = Dimension
