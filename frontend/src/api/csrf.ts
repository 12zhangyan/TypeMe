/**
 * CSRF token —— 契约 `02-数据模型与API-v1.md` §7.3、`03-AI与前端契约-v1.md` §7.1。
 *
 * 服务端用 `CookieCsrfTokenRepository.withHttpOnlyFalse()`：token 同时存在于
 *   - 可读 cookie `XSRF-TOKEN`（`withHttpOnlyFalse()` 就是为了让前端读得到），以及
 *   - `GET /api/v3/auth/csrf` 的 JSON 响应 `{token, headerName, parameterName}`。
 *
 * 两条路径都支持，取值优先级刻意是「cookie 优先、头名以服务端为准」：
 *   1. **头名不写死**。服务端每次响应都会重新生成 token 并 `Set-Cookie`，
 *      所以 cookie 里的值永远是最新的，比内存里缓存的字符串更可信；
 *      但 header 叫什么名字是服务端的实现细节，只能由它告诉我们。
 *   2. 万一拿不到头名（例如取 token 的请求自己失败了），才退回
 *      {@link FALLBACK_CSRF_HEADER_NAME} 并 `console.warn` —— 见下方注释。
 *
 * 本模块**不读也不写任何持久化存储**：token 只在内存里活到页面卸载为止。
 * 会话本身是 HttpOnly cookie，前端无从读取，也无从伪造。
 */

/** 取 token 的接口（契约 §7.2 认证）。 */
const CSRF_ENDPOINT = '/api/v3/auth/csrf'

/** 单独给 token 请求的超时：它挡在写入操作前面，不能让用户等太久。 */
const CSRF_TIMEOUT_MS = 5000

/** cookie 名由服务端 `CookieCsrfTokenRepository` 固定为这个值（契约写死的一端）。 */
export const CSRF_COOKIE_NAME = 'XSRF-TOKEN'

/**
 * ⚠️ 头名的**兜底值**，只在「取 token 的请求失败、但 cookie 里有值」时使用。
 *
 * 这不是把协议写死在前端：正常路径上头名一律来自 `GET /auth/csrf` 的 `headerName`。
 * 之所以保留兜底，是因为那种情况下不发这个头就一定会 403，
 * 而拿 cookie 值 + 已知的默认头名去试一次，是这个场景里唯一可能成功的动作。
 * 一旦命中兜底就 `console.warn` 一次，避免它被当成正常路径。
 */
export const FALLBACK_CSRF_HEADER_NAME = 'X-XSRF-TOKEN'

export interface CsrfTokenInfo {
  token: string
  /** 服务端指定的请求头名（正常路径下它一定来自服务端响应）。 */
  headerName: string
  parameterName: string | null
}

export interface CsrfHeader {
  name: string
  value: string
  /** 值的来源：`cookie` 是服务端每次响应刷新的；`response` 是 `/auth/csrf` 返回的那一份。 */
  source: 'cookie' | 'response'
}

let remembered: CsrfTokenInfo | null = null
let inflight: Promise<CsrfTokenInfo | null> | null = null
let warnedFallback = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function fallbackHeaderName(reason: string): string {
  if (!warnedFallback) {
    warnedFallback = true
    console.warn(
      `[typeme] 拿不到服务端给的 CSRF 头名（${reason}），这次先用 ${FALLBACK_CSRF_HEADER_NAME} 试一次；` +
        '如果一直 403，请确认后端 SecurityConfig 的 csrfRepository.setHeaderName(...) 是否变过。',
    )
  }
  return FALLBACK_CSRF_HEADER_NAME
}

/** 读 `XSRF-TOKEN` cookie 的当前值；读不到（没有 document / 没有 cookie）返回 null。 */
export function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const jar = document.cookie
  if (!jar) return null
  for (const part of jar.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() !== CSRF_COOKIE_NAME) continue
    const raw = part.slice(index + 1).trim()
    if (!raw) return null
    try {
      return decodeURIComponent(raw)
    } catch {
      // cookie 值不是合法百分号编码：原样用，交给服务端判定
      return raw
    }
  }
  return null
}

/**
 * 记住一份服务端给的 token（`GET /auth/csrf` 的响应）。
 *
 * 没有 `token` 就整份丢弃——半份 token 比没有更危险：看起来有值，实际必然 403。
 */
export function rememberCsrfToken(payload: unknown): CsrfTokenInfo | null {
  if (!isRecord(payload)) return null
  const token = typeof payload.token === 'string' ? payload.token.trim() : ''
  if (!token) return null
  const rawHeader = typeof payload.headerName === 'string' ? payload.headerName.trim() : ''
  const headerName = rawHeader || remembered?.headerName || fallbackHeaderName('响应里没有 headerName')
  const parameterName =
    typeof payload.parameterName === 'string' ? payload.parameterName : (remembered?.parameterName ?? null)
  remembered = { token, headerName, parameterName }
  return remembered
}

/** 忘掉内存里的 token。登录 / 退出 / 恢复密码之后必须调用：那时会话已换，旧 token 一定失效。 */
export function clearCsrfToken(): void {
  remembered = null
}

/** 当前可直接用于请求头的 token；没有就返回 null（调用方应先 `ensureCsrfToken()`）。 */
export function currentCsrfHeader(): CsrfHeader | null {
  const cookie = readCsrfCookie()
  if (cookie) {
    const name = remembered?.headerName ?? fallbackHeaderName('还没有调过 ' + CSRF_ENDPOINT)
    return { name, value: cookie, source: 'cookie' }
  }
  if (remembered) return { name: remembered.headerName, value: remembered.token, source: 'response' }
  return null
}

/**
 * 保证手里有一个可用的 token。
 *
 * - 已经有头名时**不再发请求**（只在 cookie 里取值，避免每个写操作前多一次往返）；
 * - 需要首次获取 / 刷新时合并并发请求（多个写操作同时发起只打一次 `/auth/csrf`）；
 * - 彻底失败返回 null，由调用方照常发出请求：让它去撞 403 拿 `CSRF_INVALID`，
 *   比在前端编一个「安全校验失败」更接近真相。
 */
export async function ensureCsrfToken(): Promise<CsrfTokenInfo | null> {
  if (remembered) {
    const cookie = readCsrfCookie()
    return cookie ? { ...remembered, token: cookie } : remembered
  }
  if (typeof fetch !== 'function') return null
  if (!inflight) {
    inflight = fetchCsrfToken().finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function fetchCsrfToken(): Promise<CsrfTokenInfo | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), CSRF_TIMEOUT_MS) : null
  try {
    const response = await fetch(CSRF_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // 同源部署 + 会话 cookie：必须带凭据，否则每次都拿到一份「给匿名访客的」token
      credentials: 'include',
      cache: 'no-store',
      ...(controller ? { signal: controller.signal } : {}),
    })
    if (!response.ok) throw new Error(`GET ${CSRF_ENDPOINT} 返回 ${response.status}`)
    return rememberCsrfToken(await response.json())
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const cookie = readCsrfCookie()
    if (cookie) {
      console.warn(`[typeme] 取 CSRF token 失败（${reason}），改用 cookie ${CSRF_COOKIE_NAME} 里的值。`)
      return {
        token: cookie,
        headerName: fallbackHeaderName('取 token 的请求失败'),
        parameterName: remembered?.parameterName ?? null,
      }
    }
    console.warn(
      `[typeme] 取 CSRF token 失败（${reason}），且读不到 ${CSRF_COOKIE_NAME} cookie；` +
        '写操作可能会被服务端以 CSRF_INVALID 拒绝。',
    )
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}
