import {
  clearCsrfToken,
  currentCsrfHeader,
  ensureCsrfToken,
  type CsrfTokenInfo,
} from '@/api/csrf'

/**
 * `/api/v3` 类型化客户端 —— 契约 `02-数据模型与API-v1.md` §7、`03-AI与前端契约-v1.md` §7.1。
 *
 * 与 `api/client.ts`（v1/v2 只读内容接口）刻意分开，两者约束完全不同：
 *   - v1/v2 是**只读、无认证、必须降级**的：接口挂了就用内置副本，绝不让页面白屏；
 *   - v3 是**带会话、写操作、绝不能假装成功**的：失败就是把失败如实告诉用户，
 *     没有"内置副本"这种退路（答案、报告、账号都不在浏览器里）。
 *
 * 本模块负责四件事：
 *   1. 统一带凭据（`credentials: 'include'`）与 CSRF 头；
 *   2. 把契约 §7.1 的错误体 `{code,message,requestId,details}` 解析成
 *      {@link V3ApiError}，并给出**人能看懂**的中文说明（`describeError`）；
 *   3. `CSRF_INVALID` 时刷新 token 重试**一次**（服务端明确要求前端这么做）；
 *   4. 幂等键生成与 409 语义辅助（`newIdempotencyKey` / `isRevisionConflict`）。
 *
 * 这里**不**碰 localStorage：会话是 HttpOnly cookie，前端只负责带上去。
 */

/**
 * 同源相对路径：后端把 `frontend/dist` 打进同一个 jar，前端与 `/api/v3` 永远同源。
 * 开发时 Vite 的 `/api` 代理指到 127.0.0.1:8080，仍然是相对路径。
 * 不引入新的 `VITE_*` 变量：多一个构建期开关，就多一种"线上配错却没测试覆盖"的可能。
 */
const V3_BASE = '/api/v3'

/** 普通接口的总超时。 */
const DEFAULT_TIMEOUT_MS = 15000

/** 导出个人数据的超时：它要序列化全部答卷与报告，可能明显更慢。 */
const EXPORT_TIMEOUT_MS = 60000

/** 网络层失败（没连上、被中断、超时）的客户端错误码——不是服务端给的码。 */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR'

/** 服务端返回了 2xx，但响应体不是我们认识的形状。 */
export const UNEXPECTED_RESPONSE_CODE = 'UNEXPECTED_RESPONSE'

/** CSRF 校验失败（契约 §7.1）。 */
export const CSRF_INVALID_CODE = 'CSRF_INVALID'

/** 未登录 / 会话过期（契约 §7.1）。 */
export const UNAUTHENTICATED_CODE = 'UNAUTHENTICATED'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type QueryValue = string | number | boolean | null | undefined

/** 契约 §7.2 账号资料（`GET /me`、`PATCH /me`、`POST /auth/login` 的响应）。 */
export interface AccountProfile {
  userId: string
  username: string
  nickname: string | null
  /** ISO-8601 字符串（UTC）；服务端没给就是 null。 */
  createdAt: string | null
  passwordChangedAt: string | null
}

/** `POST /auth/register` 的 201 响应。`recoveryCodes` 只在这里出现一次。 */
export interface RegisterResult {
  profile: AccountProfile
  recoveryCodes: string[]
  recoveryCodePolicyVersion: string | null
}

export interface ExportResult {
  blob: Blob
  filename: string
}

export interface DeletionResult {
  deletionJobId: string | null
}

/** 契约 §7.1 的错误体。 */
export interface V3ErrorPayload {
  code: string
  message: string
  requestId: string | null
  details: Record<string, unknown>
}

/** 直接用肉眼可读的方式呈现一个失败：主文案 + 字段提示 + 报障编号。 */
export interface ErrorDisplay {
  /** 一句话主文案（已按错误码翻译成人话）。 */
  message: string
  /** 服务端给的原始 message；与主文案重复时为 null。 */
  serverMessage: string | null
  /** 字段级提示（`VALIDATION_FAILED` 时才有内容）。 */
  fields: FieldMessage[]
  /** 限流时建议等待的秒数。 */
  retryAfterSeconds: number | null
  /** 报障编号；**必须显示给用户**，服务端日志靠它一对一对应。 */
  requestId: string | null
  code: string
  /** 是否是「登录已失效」，页面据此把用户送回登录页。 */
  sessionExpired: boolean
}

export interface FieldMessage {
  field: string
  label: string
  message: string
}

export class V3ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId: string | null
  readonly details: Record<string, unknown>
  readonly fieldErrors: Record<string, string>
  readonly retryAfterSeconds: number | null
  /**
   * 底层异常（网络层才有）。
   *
   * ⚠️ 刻意不叫 `cause`：`Error.cause` 是 ES2022 的标准字段，而本项目的
   * `lib` 是 ES2020，用它既拿不到类型，又会在将来升级 lib 时变成一个被野字段遮蔽的坑。
   */
  readonly originalError: unknown

  constructor(payload: V3ErrorPayload, options: { status: number; originalError?: unknown } = { status: 0 }) {
    super(payload.message || payload.code)
    this.name = 'V3ApiError'
    this.code = payload.code
    this.status = options.status
    this.requestId = payload.requestId
    this.details = payload.details
    this.fieldErrors = extractFieldErrors(payload.details, payload.code)
    this.retryAfterSeconds = readRetryAfterSeconds(payload.details)
    this.originalError = options.originalError
  }
}

export function isV3ApiError(value: unknown): value is V3ApiError {
  return value instanceof V3ApiError
}

/** 网络层错误（服务端没参与）：同样用 V3ApiError 表示，只是 code 由前端给。 */
function networkError(message: string, originalError?: unknown): V3ApiError {
  return new V3ApiError(
    { code: NETWORK_ERROR_CODE, message, requestId: null, details: {} },
    { status: 0, originalError },
  )
}

/* ── 错误翻译 ─────────────────────────────────────────────────────────────
 * 契约把 `code` 定为前端分支依据，所以这里的表就是"错误码 → 人话"。
 * 表里没有的码一律退回服务端 `message`（后端文案本身就是给人看的），
 * 再不济给一句不撒谎的兜底，绝不把原始 JSON 甩给用户。
 */
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: '有几项填写需要改一下。',
  INVALID_REQUEST: '这次请求没能被接受，请检查填写的内容后重试。',
  INVALID_TYPE_CODE: '类型代码不合法，请重新选择。',
  INVALID_CREDENTIALS: '用户名或密码不对。',
  UNAUTHENTICATED: '登录状态已经失效，请重新登录。',
  CSRF_INVALID: '页面停留得有点久，安全校验过期了。已经自动重试过一次，请再点一次按钮。',
  FORBIDDEN: '这个操作需要更高的权限。',
  NOT_FOUND: '没找到这个内容，可能已经被删掉了。',
  CONFLICT: '这一步和服务器上的现有数据冲突了。',
  CONFLICT_REVISION: '另一台设备已经改过这份进度，请先载入最新版本再继续。',
  IDEMPOTENCY_KEY_REUSED: '同一个操作编号提交了不一样的内容，为避免重复写入已经停下。',
  ATTEMPT_SUBMITTED: '这份测评已经交卷，不能再改答案了。',
  ATTEMPT_NOT_SUBMITTED: '这份测评还没有交卷，暂时做不了这个操作。',
  NEEDS_REVIEW: '还有内容需要你先确认一下。',
  RATE_LIMITED: '操作太频繁了，请等一会儿再试。',
  BUDGET_EXCEEDED: '今天的 AI 分析额度已经用完，明天再试。',
  AI_NOT_CONFIGURED: '本站还没有配置 AI 能力，这个功能暂时用不了。',
  CONSENT_REQUIRED: '需要先确认发送范围，才能开始分析。',
  NOT_CONFIGURED: '这个功能还没有配置好，请联系站点维护者。',
  INTERNAL: '服务器出了点问题，请稍后再试。',
  [NETWORK_ERROR_CODE]: '没能连上服务器，请检查网络后重试。',
  [UNEXPECTED_RESPONSE_CODE]: '服务器返回了看不懂的内容，请把这个编号告诉站点维护者。',
}

/** 字段名 → 中文标签。后端只回字段名（不回显输入值），标签由前端给。 */
const FIELD_LABELS: Record<string, string> = {
  username: '用户名',
  password: '密码',
  currentPassword: '当前密码',
  newPassword: '新密码',
  nickname: '昵称',
  recoveryCode: '恢复码',
  confirm: '确认词',
}

/**
 * `details` 里那些**不是字段错误**的键。
 *
 * 为什么需要它：契约 §7.1 说校验失败的字段放在 `details.fields`，但后端实现里
 * `GlobalExceptionHandler.handleValidation` 与 `ApiException.validation` 是把字段表
 * **平铺**在 `details` 上的（见交付报告里的接口不符说明）。前端两种都吃，
 * 因此平铺时必须能区分"这是字段"还是"这是 currentRevision 之类的元信息"。
 */
const RESERVED_DETAIL_KEYS = new Set([
  'fields',
  'currentRevision',
  'retryAfterSeconds',
  'scope',
  'needsReview',
  'coverage',
  'cached',
])

function extractFieldErrors(details: Record<string, unknown>, code: string): Record<string, string> {
  if (code !== 'VALIDATION_FAILED' && code !== 'INVALID_REQUEST') return {}
  const nested = details['fields']
  const source = isRecord(nested) ? nested : details
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (RESERVED_DETAIL_KEYS.has(key)) continue
    if (typeof value !== 'string' || !value.trim()) continue
    out[key] = value.trim()
  }
  return out
}

function readRetryAfterSeconds(details: Record<string, unknown>): number | null {
  const raw = details['retryAfterSeconds']
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.ceil(raw)
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed)
  }
  return null
}

/**
 * 把任何失败（`V3ApiError` 或普通 `Error`）整理成可以直接渲染的结构。
 *
 * ⚠️ `requestId` 一律原样带出去，页面**必须**展示它：没有它，用户报障时
 * 服务端日志里那一行根本搜不出来，等于没有日志。
 */
export function describeError(error: unknown): ErrorDisplay {
  if (isV3ApiError(error)) {
    const mapped = ERROR_MESSAGES[error.code]
    const serverMessage = error.message && error.message !== mapped ? error.message : null
    const fields: FieldMessage[] = Object.entries(error.fieldErrors).map(([field, message]) => ({
      field,
      label: FIELD_LABELS[field] ?? field,
      message,
    }))
    return {
      message: mapped ?? serverMessage ?? '操作没有成功，请稍后重试。',
      serverMessage: mapped ? serverMessage : null,
      fields,
      retryAfterSeconds: error.retryAfterSeconds,
      requestId: error.requestId,
      code: error.code,
      sessionExpired: error.code === UNAUTHENTICATED_CODE,
    }
  }
  const reason = error instanceof Error ? error.message : String(error)
  console.warn('[typeme] 未预期的前端错误：', reason, error)
  return {
    message: ERROR_MESSAGES[NETWORK_ERROR_CODE],
    serverMessage: null,
    fields: [],
    retryAfterSeconds: null,
    requestId: null,
    code: NETWORK_ERROR_CODE,
    sessionExpired: false,
  }
}

/** revision 冲突时把服务端的 `currentRevision` 取出来（契约 §7.1）。 */
export function isRevisionConflict(error: unknown): boolean {
  return isV3ApiError(error) && error.code === 'CONFLICT_REVISION'
}

/** 需要重新登录吗。 */
export function isSessionExpired(error: unknown): boolean {
  return isV3ApiError(error) && error.code === UNAUTHENTICATED_CODE
}

/**
 * 幂等键（契约 §6.1：`user_id + operation + idempotency_key`）。
 *
 * 同一次点击必须复用同一个键；换一次点击要换一个新的。调用方负责保存它。
 */
export function newIdempotencyKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 忽略：退回时间戳方案 */
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ── 请求实现 ───────────────────────────────────────────────────────────── */

interface RequestOptions {
  query?: Record<string, QueryValue>
  body?: unknown
  idempotencyKey?: string
  signal?: AbortSignal
  timeoutMs?: number
  /** 写操作默认带 CSRF 头；只有 `/auth/csrf` 自己不需要。 */
  withCsrf?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${V3_BASE}${path}`
  if (!query) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    search.append(key, String(value))
  }
  const suffix = search.toString()
  return suffix ? `${url}?${suffix}` : url
}

/**
 * 某些环境（jsdom 的 AbortController 配 Node 的 fetch，两者不同 realm）会拒绝 signal。
 *
 * ⚠️ 必须先把"URL 都解析不了"排除掉：那种 TypeError 的文案里也可能出现英文单词，
 * 一旦被误判成 signal 问题，就会用一个**同样会失败**的请求再试一次，
 * 而且第二次抛出的原始 TypeError 会绕过这里的错误包装（真的踩过一次）。
 */
function isSignalRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to parse url|invalid url/i.test(message)) return false
  return /AbortSignal|abort signal|signal/i.test(message)
}

function fallbackCodeForStatus(status: number): string {
  if (status === 400) return 'INVALID_REQUEST'
  if (status === 401) return UNAUTHENTICATED_CODE
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 409) return 'CONFLICT'
  if (status === 413) return 'INVALID_REQUEST'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'INTERNAL'
  return `HTTP_${status}`
}

async function readErrorPayload(response: Response, path: string): Promise<V3ErrorPayload> {
  // requestId 也在响应头里（后端 RequestIdFilter 对**每个**响应都写 X-Request-Id），
  // 错误体没解析出来时（例如被网关替换成 HTML）仍然拿得到报障编号。
  const headerRequestId = response.headers.get('X-Request-Id')
  let raw: unknown = null
  try {
    if ((response.headers.get('content-type') ?? '').includes('json')) raw = await response.json()
  } catch {
    raw = null
  }
  const body = isRecord(raw) ? raw : {}
  const code = typeof body.code === 'string' && body.code ? body.code : fallbackCodeForStatus(response.status)
  const message =
    typeof body.message === 'string' && body.message
      ? body.message
      : `请求 ${path} 失败（HTTP ${response.status}）。`
  const requestId =
    typeof body.requestId === 'string' && body.requestId
      ? body.requestId
      : headerRequestId && headerRequestId.length > 0
        ? headerRequestId
        : null
  return { code, message, requestId, details: isRecord(body.details) ? body.details : {} }
}

async function send(method: HttpMethod, path: string, options: RequestOptions): Promise<Response> {
  if (typeof fetch !== 'function') throw networkError('当前环境不支持网络请求。')

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && options.withCsrf !== false) {
    // 先确保手里有 token（拿不到也照发：让服务端用 CSRF_INVALID 说清楚，比前端猜更准）
    await ensureCsrfToken()
    const header = currentCsrfHeader()
    if (header) headers[header.name] = header.value
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey

  const external = options.signal
  if (external?.aborted) throw networkError('请求已取消。')

  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const onExternalAbort = () => controller?.abort()
  if (controller && external) external.addEventListener('abort', onExternalAbort, { once: true })

  // 不带 signal 的那一份：环境拒绝 signal 时用它重试
  const baseInit: RequestInit = {
    method,
    headers,
    // 会话是 HttpOnly cookie：同源请求必须带上，且**不能**改成 'omit'
    credentials: 'include',
    cache: 'no-store',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  }
  const url = buildUrl(path, options.query)

  try {
    return await fetch(url, controller ? { ...baseInit, signal: controller.signal } : baseInit)
  } catch (error) {
    if (controller && external && external.aborted) throw networkError('请求已取消。', error)
    if (controller && !external && isSignalRejection(error)) {
      // 环境不接受 signal：去掉超时再试一次，别把"环境限制"当成"服务器不可用"。
      // 这次失败同样要包装：原始 TypeError 直接抛出去，页面只能显示"未知错误"。
      try {
        return await fetch(url, baseInit)
      } catch (retryError) {
        throw networkError(`没能连上服务器（${method} ${path}），请检查网络后重试。`, retryError)
      }
    }
    if (controller?.signal.aborted && timer !== null) {
      throw networkError(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请重试。`, error)
    }
    throw networkError(`没能连上服务器（${method} ${path}），请检查网络后重试。`, error)
  } finally {
    if (timer !== null) clearTimeout(timer)
    if (controller && external) external.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * 发一个请求并处理错误。
 *
 * `CSRF_INVALID` 的处理是**契约要求**的（契约 §7.3：前端靠这个码决定"重新取 token 重试"）：
 * 清掉旧 token、重新拉一份、原样重试**一次**。只重试一次：第二次还是 403 说明问题不在 token 上，
 * 无限重试只会把用户的按钮点成死循环。
 */
async function request(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<Response> {
  const response = await send(method, path, options)
  if (response.ok) return response

  const payload = await readErrorPayload(response, path)
  if (payload.code === CSRF_INVALID_CODE && method !== 'GET' && options.withCsrf !== false) {
    clearCsrfToken()
    await ensureCsrfToken()
    const retried = await send(method, path, options)
    if (retried.ok) return retried
    throw new V3ApiError(await readErrorPayload(retried, path), { status: retried.status })
  }
  throw new V3ApiError(payload, { status: response.status })
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) {
    throw new V3ApiError(
      {
        code: UNEXPECTED_RESPONSE_CODE,
        message: `请求 ${path} 成功了，但返回的不是 JSON。`,
        requestId: response.headers.get('X-Request-Id'),
        details: {},
      },
      { status: response.status },
    )
  }
  try {
    return (await response.json()) as T
  } catch (error) {
    throw new V3ApiError(
      {
        code: UNEXPECTED_RESPONSE_CODE,
        message: `请求 ${path} 成功了，但响应体不是合法 JSON。`,
        requestId: response.headers.get('X-Request-Id'),
        details: {},
      },
      { status: response.status, originalError: error },
    )
  }
}

/** 204 / 空响应统一吃掉：调用方拿到 `void`。 */
async function ignoreBody(response: Response): Promise<void> {
  // 显式读取并丢弃，避免连接因为未消费的 body 迟迟不释放
  try {
    await response.arrayBuffer()
  } catch {
    /* 空响应读不到内容是正常的 */
  }
}

/* ── 给同族模块的公开出口 ────────────────────────────────────────────────
 * `api/v3Assessment.ts`（新测端点）与 `api/v3Ai.ts` 走的必须是**同一条**请求路径：
 * 同一个错误体解析、同一个 CSRF 重试、同一个超时与 `credentials: 'include'`。
 * 复制一份"差不多的 fetch 包装"是最容易慢慢分叉的做法（一份加了 CSRF 重试、
 * 另一份忘了 `credentials`，症状是"某些接口偶发 401"），所以这里把内部实现
 * 显式导出，而不是让调用方各自造轮子。
 *
 * 刻意只导出两个函数 + 一个选项类型：调用方拿到的仍然是「解析好的 JSON 或抛
 * V3ApiError」，不需要（也不应该）自己读 Response。
 */
export type { RequestOptions as V3RequestOptions }

/** 发一个带凭据 / CSRF / 超时的请求并完成错误映射（CSRF_INVALID 自动重试一次）。 */
export async function v3Request(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<Response> {
  return request(method, path, options)
}

/** 读取 JSON 响应体；不是 JSON 或解析失败时抛 `UNEXPECTED_RESPONSE_CODE`。 */
export async function v3ReadJson<T>(response: Response, path: string): Promise<T> {
  return readJson<T>(response, path)
}

/** 忽略响应体（204 / 空响应）。 */
export async function v3IgnoreBody(response: Response): Promise<void> {
  await ignoreBody(response)
}

/** 服务端返回了 2xx，但字段形状不是我们认识的样子。 */
export function unexpectedResponse(message: string, requestId: string | null = null): V3ApiError {
  return new V3ApiError(
    { code: UNEXPECTED_RESPONSE_CODE, message, requestId, details: {} },
    { status: 200 },
  )
}

/* ── 响应字段读取（服务端多给字段、少给字段都不该让页面崩） ─────────────── */

function readText(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function readInstant(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  // 万一哪天 Jackson 被配成写时间戳（毫秒），也不能把数字原样塞进界面
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return null
}

function readProfile(raw: unknown): AccountProfile {
  const body = isRecord(raw) ? raw : {}
  const userId = readText(body.userId)
  if (!userId) {
    throw new V3ApiError(
      {
        code: UNEXPECTED_RESPONSE_CODE,
        message: '账号资料里没有用户 ID，无法确认这是哪个账号。',
        requestId: null,
        details: {},
      },
      { status: 200 },
    )
  }
  return {
    userId,
    username: readText(body.username) ?? '',
    nickname: readText(body.nickname),
    createdAt: readInstant(body.createdAt),
    passwordChangedAt: readInstant(body.passwordChangedAt),
  }
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/* ── CSRF ───────────────────────────────────────────────────────────────── */

/** 主动刷新一份 token（进入登录页、退出之后调用；头名由服务端给）。 */
export async function refreshCsrfToken(): Promise<CsrfTokenInfo | null> {
  clearCsrfToken()
  return ensureCsrfToken()
}

/** 忘掉内存里的 token（不改 cookie，cookie 只能由服务端 Set-Cookie 覆盖）。 */
export function forgetCsrfToken(): void {
  clearCsrfToken()
}

/* ── 认证（契约 §7.2 认证） ─────────────────────────────────────────────── */

export async function loginAccount(input: { username: string; password: string }): Promise<AccountProfile> {
  const response = await request('POST', '/auth/login', {
    body: { username: input.username, password: input.password },
  })
  return readProfile(await readJson<unknown>(response, '/auth/login'))
}

export async function registerAccount(input: {
  username: string
  password: string
  nickname?: string | null
}): Promise<RegisterResult> {
  const body: Record<string, unknown> = { username: input.username, password: input.password }
  const nickname = input.nickname?.trim()
  if (nickname) body.nickname = nickname
  const response = await request('POST', '/auth/register', { body })
  const raw = await readJson<unknown>(response, '/auth/register')
  const record = isRecord(raw) ? raw : {}
  return {
    // 注册响应本身就是一份完整资料（契约 §7.2），字段与 /me 同名
    profile: readProfile(raw),
    recoveryCodes: readStringList(record.recoveryCodes),
    recoveryCodePolicyVersion: readText(record.recoveryCodePolicyVersion),
  }
}

export async function logoutAccount(): Promise<void> {
  const response = await request('POST', '/auth/logout')
  await ignoreBody(response)
}

export async function recoverAccount(input: {
  username: string
  recoveryCode: string
  newPassword: string
}): Promise<void> {
  const response = await request('POST', '/auth/recover', {
    body: {
      username: input.username,
      recoveryCode: input.recoveryCode,
      newPassword: input.newPassword,
    },
  })
  await ignoreBody(response)
}

/* ── 账号（契约 §7.2 账号） ─────────────────────────────────────────────── */

export async function fetchMe(signal?: AbortSignal): Promise<AccountProfile> {
  const response = await request('GET', '/me', { ...(signal ? { signal } : {}) })
  return readProfile(await readJson<unknown>(response, '/me'))
}

export async function updateNickname(nickname: string): Promise<AccountProfile> {
  const response = await request('PATCH', '/me', { body: { nickname } })
  return readProfile(await readJson<unknown>(response, '/me'))
}

export async function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<void> {
  const response = await request('POST', '/me/password', {
    body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
  })
  await ignoreBody(response)
}

/** 重新生成恢复码：旧码全部作废，新码**只返回这一次**（契约 §7.2）。 */
export async function regenerateRecoveryCodes(currentPassword: string): Promise<string[]> {
  const response = await request('POST', '/me/recovery-codes', { body: { currentPassword } })
  const raw = await readJson<unknown>(response, '/me/recovery-codes')
  return readStringList(isRecord(raw) ? raw.recoveryCodes : null)
}

/**
 * 导出个人数据（JSON 附件）。
 *
 * 返回 Blob 而不是立刻触发下载：下载这个动作属于页面（要能给出成功/失败的可见反馈），
 * 客户端只管把文件拿到手。文件名优先用服务端 `Content-Disposition` 给的那个。
 */
export async function exportAccountData(): Promise<ExportResult> {
  const response = await request('GET', '/me/export', { timeoutMs: EXPORT_TIMEOUT_MS })
  const header = response.headers.get('Content-Disposition') ?? ''
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(header)
  const raw = match?.[1]?.replace(/"/g, '').trim()
  let filename = 'typeme-export.json'
  if (raw) {
    try {
      filename = decodeURIComponent(raw)
    } catch {
      // 文件名不是合法百分号编码：原样用，宁可名字丑一点也不能让下载整体失败
      filename = raw
    }
  }
  return { blob: await response.blob(), filename }
}

/** 注销账号（202：请求已受理，后台异步清理）。 */
export async function requestAccountDeletion(input: {
  password: string
  /** 契约 §6.2：必须逐字为 `DELETE`。 */
  confirm: 'DELETE'
}): Promise<DeletionResult> {
  const response = await request('DELETE', '/me', {
    body: { password: input.password, confirm: input.confirm },
  })
  const raw = await readJson<unknown>(response, '/me')
  return { deletionJobId: isRecord(raw) ? readText(raw.deletionJobId) : null }
}
