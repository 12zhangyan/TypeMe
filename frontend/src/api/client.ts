import type { Questionnaire } from '@/domain/types'
import { isValidQuestionnaire } from '@/domain/questionnaire'
import { isValidAssessmentPackage } from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'
import type {
  ContentSource,
  Meta,
  MethodContent,
  Resolved,
  TypeProfile,
} from '@/domain/contentTypes'
import {
  FALLBACK_ASSESSMENT_PACKAGES,
  FALLBACK_META,
  FALLBACK_METHOD,
  FALLBACK_QUESTIONNAIRE,
  getFallbackTypeProfile,
} from '@/content/fallback'

/**
 * API 客户端 —— `docs/技术方案.md` §5、`docs/任务拆解.md` §1.4。
 *
 * 只有 4 个 GET，无写接口，无认证：
 *   GET /api/v1/meta
 *   GET /api/v1/questionnaires/{version}
 *   GET /api/v1/types/{code}
 *   GET /api/v1/method
 *
 * ADR-4：**任何一个请求失败都静默降级到内置副本**，并把 `source` 返回给 UI，
 * 让页面可以低调地说明"当前用的是内置题库"。后端挂掉不该导致全站白屏。
 *
 * 另外做了两层防御：
 *   1. 超时（默认 4s）——后端假死时不能让首屏一直转圈；
 *   2. 结构校验——接口返回的 JSON 形状不对时也走降级，而不是把脏数据喂给计分引擎。
 */

/**
 * 内容请求的**总等待预算**（`docs/2026-09-15/...重构开发文档.md` §11.2）。
 *
 * 超过预算就使用**同版本**有效内置内容。这是新体验预算，不是测得的现状：
 * 首页自己可以立即渲染，只有"开始测试"按钮需要题库就绪。
 */
const DEFAULT_TIMEOUT_MS = 1500

/** 允许用 VITE_API_BASE 覆盖（部署到同源 /api/v1 时不需要设置）。 */
const API_BASE = (import.meta.env?.VITE_API_BASE ?? '/api/v1').replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function requestJson<T>(path: string, signal?: AbortSignal, base = API_BASE): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
    // 同源静态部署下带 cookie 没有意义，这里显式关掉，表明本站不利用任何凭据
    credentials: 'omit',
    cache: 'no-cache',
  })
  if (!response.ok) {
    throw new ApiError(`GET ${path} 返回 ${response.status}`, response.status)
  }
  return (await response.json()) as T
}

/** 某些环境（例如 jsdom 的 AbortController 配 Node 的 fetch，两者不同 realm）会拒绝 signal。 */
function isSignalRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /AbortSignal|abort signal|signal/i.test(message)
}

async function getJson<T>(path: string, timeoutMs = DEFAULT_TIMEOUT_MS, base = API_BASE): Promise<T> {
  if (typeof fetch !== 'function') {
    throw new ApiError('当前环境没有 fetch，无法访问接口')
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined
  try {
    return await requestJson<T>(path, controller?.signal, base)
  } catch (error) {
    // 不要把"环境不接受 signal"误判成"接口不可用"：去掉超时信号再试一次
    if (controller && isSignalRejection(error)) {
      return await requestJson<T>(path, undefined, base)
    }
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 结构校验（题库）：唯一定义在 `@/domain/questionnaire`，
 * 与本地会话快照使用**同一份口径**（`docs/2026-09-15/...§10.2`）。
 * 这里再导出一次，保持既有引用可用。
 */
export { isValidQuestionnaire }

function isValidTypeProfile(value: unknown): value is TypeProfile {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TypeProfile>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.nameCn === 'string' &&
    typeof candidate.tagline === 'string' &&
    typeof candidate.dimensions === 'object' &&
    candidate.dimensions !== null &&
    Array.isArray(candidate.strengths) &&
    Array.isArray(candidate.blindSpots) &&
    Array.isArray(candidate.resonance) &&
    Array.isArray(candidate.growth)
  )
}

function isValidMeta(value: unknown): value is Meta {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Meta>
  return (
    Array.isArray(candidate.questionnaireVersions) &&
    typeof candidate.attribution === 'object' &&
    candidate.attribution !== null &&
    typeof candidate.attribution.license === 'string'
  )
}

function isValidMethod(value: unknown): value is MethodContent {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<MethodContent>
  return (
    Array.isArray(candidate.sections) &&
    candidate.sections.length > 0 &&
    typeof candidate.attribution === 'object' &&
    candidate.attribution !== null
  )
}

/**
 * 通用降级包装：接口成功且结构合法就用接口，否则用内置副本。
 * 只会记录一条 console.warn，不弹任何错误提示——用户不需要为后端的死活负责。
 */
async function withFallback<T>(
  label: string,
  loader: () => Promise<T>,
  fallback: T,
  validate?: (value: unknown) => value is T,
): Promise<Resolved<T>> {
  try {
    const data = await loader()
    if (validate && !validate(data)) {
      console.warn(`[typeme] ${label} 返回的数据结构不符合契约，已降级到内置副本`)
      return { data: fallback, source: 'fallback' }
    }
    return { data, source: 'api' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[typeme] ${label} 请求失败（${reason}），已降级到内置副本`)
    return { data: fallback, source: 'fallback' }
  }
}

export function fetchMeta(): Promise<Resolved<Meta>> {
  return withFallback('GET /meta', () => getJson<Meta>('/meta'), FALLBACK_META, isValidMeta)
}

/**
 * 拉取题库。
 *
 * 审查 MI-5：未知版本原先会"降级成内置题库但把 `version` 换成请求的那个"，
 * 于是 `standard` 这种不存在的版本也会拿到 32 题、并被贴上 `standard` 标签——
 * 将来一旦真的有标准版，就会拿快速版冒充它。现在未知版本直接报错，由调用方
 * 渲染一句可读的失败态（而不是静默冒充）。
 */
export async function fetchQuestionnaire(version = 'quick'): Promise<Resolved<Questionnaire>> {
  const isBuiltinVersion = version === FALLBACK_QUESTIONNAIRE.version
  try {
    const data = await getJson<Questionnaire>(`/questionnaires/${encodeURIComponent(version)}`)
    if (!isValidQuestionnaire(data)) {
      throw new ApiError('题库结构不符合契约')
    }
    // 接口返回的 version 必须与请求的一致，否则同样会出现"贴错标签"
    if (data.version !== version) {
      throw new ApiError(`题库版本不一致：请求 ${version}，返回 ${data.version}`)
    }
    return { data, source: 'api' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!isBuiltinVersion) {
      console.warn(`[typeme] GET /questionnaires/${version} 不可用（${reason}），且没有对应版本的内置副本`)
      throw new ApiError(
        `没有名为「${version}」的题库：接口不可用，且内置副本只有「${FALLBACK_QUESTIONNAIRE.version}」`,
      )
    }
    console.warn(`[typeme] GET /questionnaires/${version} 请求失败（${reason}），已降级到内置副本`)
    return { data: FALLBACK_QUESTIONNAIRE, source: 'fallback' }
  }
}

/**
 * 拉取某个类型的文案。
 *
 * NET-02：请求 INFP 却返回 ENTP 内容时必须**拒绝**，改用有效的内置副本——
 * 否则用户会看到"INFP 的字母 + ENTP 的解释"，而且没有任何测试会红。
 */
export async function fetchTypeProfile(code: string): Promise<Resolved<TypeProfile>> {
  const normalized = code.toUpperCase()
  const fallback = getFallbackTypeProfile(normalized)
  try {
    const data = await getJson<TypeProfile>(`/types/${encodeURIComponent(normalized)}`)
    if (!isValidTypeProfile(data)) {
      throw new ApiError('类型文案结构不符合契约')
    }
    if (data.code.toUpperCase() !== normalized) {
      throw new ApiError(`类型文案不一致：请求 ${normalized}，返回 ${data.code}`)
    }
    return { data, source: 'api' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[typeme] GET /types/${normalized} 不可用（${reason}）`)
    if (!fallback) {
      // 16 个内置类型文案必须齐全；缺了就是内容缺失，不能编一份假的糊过去
      throw new ApiError(`类型 ${normalized} 既不在接口里，也不在内置副本里`)
    }
    return { data: fallback, source: 'fallback' }
  }
}

export function fetchMethod(): Promise<Resolved<MethodContent>> {
  return withFallback('GET /method', () => getJson<MethodContent>('/method'), FALLBACK_METHOD, isValidMethod)
}

/* ── v2 内容包 ───────────────────────────────────────────────────────────── */

/**
 * 内容包接口必须走**独立的 base**：v1 是 `/api/v1`，v2 是 `/api/v2`。
 * 两者共用同一台只读内容服务，但版本号与语义都不同，不能混在一个预算里。
 */
const ASSESSMENT_API_BASE = (import.meta.env?.VITE_ASSESSMENT_API_BASE ?? '/api/v2').replace(/\/+$/, '')

const ASSESSMENT_PATH = '/assessment-packages'

/**
 * 拉取 v2 内容包。
 *
 * 降级规则（开发方案 §5.3 / §5.4）：
 *   - 接口超时 / 报错 / 结构非法 → 只能用**同一个 packageId** 的内置副本；
 *   - 没有同 ID 的内置副本 → 抛出可读错误，由页面显示「该版本暂不可用」，
 *     绝不悄悄切到另一版内容（否则用户看到的是另一套题面与帮助）。
 */
export async function fetchAssessmentPackage(packageId: string): Promise<Resolved<AssessmentPackage>> {
  const builtin = FALLBACK_ASSESSMENT_PACKAGES[packageId] as AssessmentPackage | undefined
  try {
    const data = await getJson<AssessmentPackage>(
      `${ASSESSMENT_PATH}/${encodeURIComponent(packageId)}`,
      DEFAULT_TIMEOUT_MS,
      ASSESSMENT_API_BASE,
    )
    if (!isValidAssessmentPackage(data)) {
      throw new ApiError('内容包结构不符合契约')
    }
    if (data.packageId !== packageId) {
      // 请求 A 却拿到 B：宁可降级，也不能把 B 的题面贴到 A 的会话上
      throw new ApiError(`内容包 ID 不一致：请求 ${packageId}，返回 ${data.packageId}`)
    }
    return { data, source: 'api' }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!builtin) {
      console.warn(
        `[typeme] GET ${ASSESSMENT_PATH}/${packageId} 不可用（${reason}），且没有同 ID 的内置副本`,
      )
      throw new ApiError(`内容版本「${packageId}」暂不可用：接口不可达，且本机没有同一版本的内置副本。`)
    }
    console.warn(
      `[typeme] GET ${ASSESSMENT_PATH}/${packageId} 请求失败（${reason}），已降级到同 ID 内置副本`,
    )
    return { data: builtin, source: 'fallback' }
  }
}

/** 内置（离线）内容包，供版本选择与测试使用。 */
export function builtinAssessmentPackage(packageId: string): AssessmentPackage | null {
  return (FALLBACK_ASSESSMENT_PACKAGES[packageId] as AssessmentPackage | undefined) ?? null
}

/** 供 UI 显示"当前用的是内置题库"用的一句话。 */
export function describeSource(source: ContentSource): string {
  return source === 'api' ? '内容来自服务端' : '服务端不可用，正在使用内置副本'
}

export const API_BASE_URL = API_BASE
