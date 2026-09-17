import { describeError, isForbidden, unexpectedResponse, v3ReadJson, v3Request, type ErrorDisplay } from '@/api/v3'

/**
 * 管理后台接口（契约 `02-数据模型与API-v1.md` §7.2 `/admin/**`）。
 *
 * ## 为什么这里**没有**"先查我是谁"
 *
 * `/me` 刻意不回 `role`（见后端 `MeResponse` 注释：内部状态不出现在公开资料里）。
 * 所以"我是不是管理员"这个问题的唯一答案，就是去问后台接口本身：
 * 200 就是，`403 FORBIDDEN` 就不是。这里提供一个 {@link probeAdminAccess}
 * 把这件事说清楚，页面据此决定显示表单还是"你没有权限"。
 * 加一个 `role` 字段到 `/me` 会更省事，但那等于让所有用户都能看到自己的角色位，
 * 而权限判断本来就该由被保护的那一侧回答。
 *
 * ## 绝不出现在这个模块里的东西
 *
 * `apiKey` 的**明文与密文**。读接口只回 `apiKeyConfigured` / `apiKeyFingerprint` /
 * `apiKeySource`；写接口只**发**不收。因此 {@link AdminAiSettings} 是一个"没有秘密"的类型。
 */

/* ── AI 设置 ────────────────────────────────────────────────────────────── */

/** `apiKeySource` 的三种取值（后端 `AiSettingRecord`）。null 表示后端没给这一项。 */
export type ApiKeySource = 'db' | 'env' | 'none'

export interface AdminAiSettings {
  enabled: boolean
  /**
   * 只回**主机名**，不回完整 URL。
   *
   * 后端刻意这么设计：`baseUrl` 可能带查询串或私有网关主机名，回主机名足够管理员
   * 确认"打到哪儿"，又不至于让后台读接口变成信息出口。因此这个页面也**不能**
   * 直接编辑它 —— 见下面 `AdminAiSettingsPatch.baseUrl` 的说明。
   */
  baseUrlHost: string | null
  model: string
  promptVersion: string
  dailyLimitPerUser: number
  retryLimitPerHour: number
  globalDailyCallBudget: number
  globalDailyTokenBudget: number
  workerConcurrency: number
  connectTimeoutMs: number
  requestDeadlineMs: number
  maxTokens: number
  mockMode: boolean
  apiKeyConfigured: boolean
  /** sha256 前 8 位，只用来确认"换没换"，不可逆。 */
  apiKeyFingerprint: string | null
  apiKeySource: ApiKeySource | null
  updatedAt: string | null
  updatedBy: string | null
}

/**
 * 写请求。**null / undefined = 不改动**（与服务端 DTO 一致）。
 *
 * `baseUrl`：读接口只回主机名，所以这个页面**无法**预填完整值。用户要改 baseUrl 时
 * 必须自己重新输入完整 URL —— 我们不提供"提交主机名当完整 URL"的路径，那会写出
 * 一个缺协议的坏值。见 `AdminView` 里那段说明。
 *
 * `apiKey`：`null`=不改、`''`=清除、非空=替换。这三个语义必须由调用方明确表达，
 * 不能用"空字符串"同时表示"没填"和"清掉"。
 */
export interface AdminAiSettingsPatch {
  enabled?: boolean
  baseUrl?: string
  model?: string
  promptVersion?: string
  dailyLimitPerUser?: number
  retryLimitPerHour?: number
  globalDailyCallBudget?: number
  globalDailyTokenBudget?: number
  workerConcurrency?: number
  connectTimeoutMs?: number
  requestDeadlineMs?: number
  maxTokens?: number
  mockMode?: boolean
  apiKey?: string
}

export interface AdminUserSummary {
  id: string
  username: string
  nickname: string | null
  role: string
  status: string
  createdAt: string | null
  /** ⚠️ `null` 表示**未知**（聚合查询失败），不是 0。0 与"未知"在后台是两件事。 */
  reportCount: number | null
}

export interface AdminUserPage {
  items: AdminUserSummary[]
  page: number
  size: number
  total: number
}

/* ── 解析工具 ───────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 数值字段：读到非数就用服务端本该给的值兜底。
 *
 * 与报告解析的"严格抛错"不同：这里的每个数字都有**服务端保证的**取值，
 * 缺一个数字就把整个后台页面变成错误页，代价大于收益（管理员要的是"能改 key"，
 * 不是"看到一条 JSON 形状投诉"）。但**布尔与字符串不猜** —— 见 `parseAiSettings`。
 */
function readInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readSource(value: unknown): ApiKeySource | null {
  return value === 'db' || value === 'env' || value === 'none' ? value : null
}

/**
 * 解析后台 AI 设置。
 *
 * `enabled` / `mockMode` 这两个**开关**不兜底：它们决定"AI 到底开不开"，
 * 猜错的后果是管理员看到一个与自己配置相反的状态并据此做决定。
 * 读不到就让整个读取失败（调用方会显示错误与重试），而不是显示一个猜出来的开关。
 */
export function parseAiSettings(raw: unknown): AdminAiSettings {
  if (!isRecord(raw)) throw unexpectedResponse('后台设置响应不是对象。')
  if (typeof raw['enabled'] !== 'boolean' || typeof raw['mockMode'] !== 'boolean') {
    throw unexpectedResponse('后台设置响应缺少 enabled / mockMode 开关状态。')
  }
  return {
    enabled: raw['enabled'],
    mockMode: raw['mockMode'],
    baseUrlHost: readText(raw['baseUrlHost']),
    model: readText(raw['model']) ?? '',
    promptVersion: readText(raw['promptVersion']) ?? '',
    dailyLimitPerUser: readInt(raw['dailyLimitPerUser'], 0),
    retryLimitPerHour: readInt(raw['retryLimitPerHour'], 0),
    globalDailyCallBudget: readInt(raw['globalDailyCallBudget'], 0),
    globalDailyTokenBudget: readInt(raw['globalDailyTokenBudget'], 0),
    workerConcurrency: readInt(raw['workerConcurrency'], 0),
    connectTimeoutMs: readInt(raw['connectTimeoutMs'], 0),
    requestDeadlineMs: readInt(raw['requestDeadlineMs'], 0),
    maxTokens: readInt(raw['maxTokens'], 0),
    apiKeyConfigured: readBool(raw['apiKeyConfigured'], false),
    apiKeyFingerprint: readText(raw['apiKeyFingerprint']),
    apiKeySource: readSource(raw['apiKeySource']),
    updatedAt: readText(raw['updatedAt']),
    updatedBy: readText(raw['updatedBy']),
  }
}

function parseUser(raw: unknown): AdminUserSummary {
  if (!isRecord(raw)) throw unexpectedResponse('后台用户列表里有不是对象的条目。')
  const id = readText(raw['id'])
  const username = readText(raw['username'])
  if (!id || !username) throw unexpectedResponse('后台用户条目缺少 id 或 username。')
  const reportCount = raw['reportCount']
  return {
    id,
    username,
    nickname: readText(raw['nickname']),
    role: readText(raw['role']) ?? 'USER',
    status: readText(raw['status']) ?? 'ACTIVE',
    createdAt: readText(raw['createdAt']),
    // 只有明确是数字才是数字；null / undefined 一律保留为"未知"。
    reportCount: typeof reportCount === 'number' && Number.isFinite(reportCount) ? reportCount : null,
  }
}

/* ── 端点 ───────────────────────────────────────────────────────────────── */

/** `GET /admin/ai-settings`。非管理员得到 `403 FORBIDDEN`。 */
export async function fetchAdminAiSettings(signal?: AbortSignal): Promise<AdminAiSettings> {
  const response = await v3Request('GET', '/admin/ai-settings', { signal, withCsrf: false })
  return parseAiSettings(await v3ReadJson<unknown>(response, '/admin/ai-settings'))
}

/** `PUT /admin/ai-settings`，回写后的完整视图。 */
export async function updateAdminAiSettings(
  patch: AdminAiSettingsPatch,
  signal?: AbortSignal,
): Promise<AdminAiSettings> {
  const response = await v3Request('PUT', '/admin/ai-settings', {
    body: patch,
    signal,
    // 写库 + 加密，正常很快；但不要把用户的等待变成无限。
    timeoutMs: 20000,
  })
  return parseAiSettings(await v3ReadJson<unknown>(response, '/admin/ai-settings'))
}

/** `GET /admin/users`。只读：本轮不提供改角色/禁用入口（见 progress 记录）。 */
export async function fetchAdminUsers(
  options: { page?: number; size?: number; signal?: AbortSignal } = {},
): Promise<AdminUserPage> {
  const response = await v3Request('GET', '/admin/users', {
    query: { page: options.page ?? 0, size: options.size ?? 20 },
    signal: options.signal,
    withCsrf: false,
  })
  const raw = await v3ReadJson<unknown>(response, '/admin/users')
  if (!isRecord(raw)) throw unexpectedResponse('后台用户列表响应不是对象。')
  const items = Array.isArray(raw['items']) ? raw['items'].map(parseUser) : []
  return {
    items,
    page: readInt(raw['page'], 0),
    size: readInt(raw['size'], items.length),
    total: readInt(raw['total'], items.length),
  }
}

/* ── 权限探测 ───────────────────────────────────────────────────────────── */

export type AdminAccess =
  | { kind: 'granted'; settings: AdminAiSettings }
  | { kind: 'denied'; error: ErrorDisplay }
  | { kind: 'unavailable'; error: ErrorDisplay }

/**
 * 问一次后台接口来判断权限，并把结果分成**三种**而不是两种。
 *
 * 把"不是管理员"和"后端没连上"混成一种，会让后端抖动时管理员看到"你没有权限"，
 * 然后去到处找权限配置 —— 这和登录态那三条纪律里 `anonymous` 与 `unavailable`
 * 必须分开是同一个道理。
 */
export async function probeAdminAccess(signal?: AbortSignal): Promise<AdminAccess> {
  try {
    return { kind: 'granted', settings: await fetchAdminAiSettings(signal) }
  } catch (error) {
    if (isForbidden(error)) return { kind: 'denied', error: describeError(error) }
    return { kind: 'unavailable', error: describeError(error) }
  }
}
