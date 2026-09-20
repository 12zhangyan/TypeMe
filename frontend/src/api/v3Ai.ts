import { v3ReadJson, v3Request, unexpectedResponse, type ErrorDisplay } from '@/api/v3'

/**
 * AI 分析接口（契约 `03-AI与前端契约-v1.md` §2 / §3）。
 *
 * ## 这个模块只做三件事
 *
 * 1. 调五个端点，把响应收窄成可用的类型；
 * 2. **保守地**解析 §3 的结构化输出 —— 只渲染确实读得懂的部分，
 *    读不懂的**如实说读不懂**，不猜、不补默认值；
 * 3. 明确区分"AI 没开 / 额度用完 / 还没跑完 / 跑失败了"，因为页面对这四种
 *    要给完全不同的下一步动作。
 *
 * ## 为什么解析用"宽容 + 逐项上报"而不是像报告那样严格抛错
 *
 * 固定报告是**服务端用同一份代码生成的**，形状错了就是 bug，所以 `domain/reportV3.ts`
 * 选择抛错、整页拒绝渲染。AI 输出不同：它是模型生成的、结构校验在服务端已经做过一遍
 * （不合规的输出根本不会入库），但**前端仍可能拿到历史 job 的旧 schema**。
 * 在这种情况下把整块分析吞掉（什么都不显示）比少显示一段更糟 ——
 * 用户会以为"分析没生成"。所以这里逐项检查，并把被丢掉的部分明确列出来。
 *
 * ## 绝不显示的东西
 *
 * `modelReturned`、`promptVersion`、`mock` 之外的内部字段一律不上界面；
 * 尤其是**不显示 apiKey、baseUrl、内部 job 的原始 JSON**。
 */

/* ── 主题 ───────────────────────────────────────────────────────────────── */

export type AnalysisTopic = 'overall' | 'communication' | 'studyWork' | 'growth'

/** 主题的中文名与一句说明。顺序即界面顺序。 */
export const ANALYSIS_TOPICS: { value: AnalysisTopic; label: string; hint: string }[] = [
  { value: 'overall', label: '全面认识自己', hint: '把四维放一起看，先给一个整体印象。' },
  { value: 'communication', label: '沟通相处', hint: '和别人来往时，你的表达与理解方式。' },
  { value: 'studyWork', label: '学习工作方式', hint: '怎么进入状态、怎么推进一件事。' },
  { value: 'growth', label: '成长建议', hint: '接下来可以练什么、避开什么。' },
]

const TOPIC_LABELS = new Map(ANALYSIS_TOPICS.map((topic) => [topic.value, topic.label]))

export function topicLabel(topic: string): string {
  return TOPIC_LABELS.get(topic as AnalysisTopic) ?? topic
}

/* ── 发送范围同意 ───────────────────────────────────────────────────────── */

/**
 * 同意政策的版本。必须非空才会被服务端接受（缺了直接 400 `CONSENT_REQUIRED`）。
 *
 * 与后端 `AiRuntimeSettingsProvider.loadConsentPolicyVersion()` 的当前返回值一致。
 * 它**不**参与 request_hash（进 hash 的是 `scopeVersion`），所以这里对不上不会
 * 造成去重错乱，只会让 `ai_consent.policy_version` 记成另一个字符串。
 */
export const AI_CONSENT_POLICY_VERSION = 'typeme-ai-consent-v1'

/**
 * 发送范围的版本。**必须与后端一致** —— 它进 `request_hash`，
 * 写错会让同一份报告在升级前后被当成两个范围（见契约 §4 那段说明）。
 */
export const AI_SCOPE_VERSION = 'typeme-ai-scope-v3'

/**
 * 「可读版分析契约」对应的提示词版本。
 *
 * 与后端 `com.typeme.ai.input.ReadableReportInput.PROMPT_VERSION` 一致：只有这个版本的
 * 提示词才会产出可读版结构（一句话结论 / 为什么这样说 / 可以试一次 / 哪些还不能确定），
 * 大五报告也只有在这个版本下才允许生成。
 *
 * **刻意用"等于"而不是"大于等于"**：未来新增提示词版本时，它的输出结构是否仍满足这份契约
 * 需要人**明确确认**，不能靠版本号猜。因此升版时三件事必须一起做：更新后端常量、更新这里、
 * 并让后端 `PromptVersionClassificationTest`（枚举 prompts 目录）与前端
 * `aiAnalysisPanel` 的用例一起给出信号。写在一个常量里也是为了不让面板里出现第二份字面量 ——
 * 两份字面量一旦漂开，界面就会一边说"不支持"、一边又按新版渲染。
 */
export const READABLE_PROMPT_VERSION = 'typeme-ai-prompt-v3'

/* ── 解析工具 ───────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => readText(item)).filter((item): item is string => item !== null)
}

/* ── §3 结构化输出 ─────────────────────────────────────────────────────── */

export interface AnalysisSection {
  key: string
  title: string
  body: string
}

export interface AnalysisAction {
  title: string
  steps: string[]
}

export interface AnalysisResultView {
  schemaVersion: string
  referenceType: string | null
  summary: string
  sections: AnalysisSection[]
  boundaryNotes: string[]
  actions: AnalysisAction[]
  reflectionQuestions: string[]
  /**
   * 解析时发现的结构问题（每条一句中文）。
   *
   * 非空时页面必须**显式**告诉用户"这份分析有一部分读不出来"，
   * 而不是安静地少显示几段 —— 后者会让用户以为模型只写了这么多。
   * 允许为空数组（正常情况）。
   */
  problems: string[]
}

/**
 * 解析 §3 的结构化输出。永不抛异常：读不出来就返回 null 并说明原因。
 *
 * 没有任何可显示内容（summary 与 sections 都空）时返回 `view: null` +
 * 一条说明 —— 这种情况下"显示一个空壳标题"比什么都不显示更糟。
 */
export function parseAnalysisResult(raw: unknown): AnalysisResultView | null {
  if (!isRecord(raw)) return null
  if (raw['schemaVersion'] === 'analysis-readable-v2') return parseReadableAnalysis(raw)
  const problems: string[] = []

  // schemaVersion 只做**提示**，不做拒绝：未知版本意味着前端比后端旧，
  // 此时能读多少读多少，并明确告诉用户。
  const schemaVersion = readText(raw['schemaVersion']) ?? '(未标注)'
  if (schemaVersion !== '1') {
    problems.push(`这份分析的输出格式版本是「${schemaVersion}」，与当前页面认识的「1」不同。`)
  }

  const summary = readText(raw['summary']) ?? ''
  if (!summary) problems.push('缺少「整体印象」这一段。')

  const sections: AnalysisSection[] = []
  const rawSections = raw['sections']
  if (Array.isArray(rawSections)) {
    for (const item of rawSections) {
      if (!isRecord(item)) continue
      const body = readText(item['body'])
      const title = readText(item['title'])
      if (!body || !title) continue
      sections.push({ key: readText(item['key']) ?? title, title, body })
    }
  }
  if (sections.length === 0 && !summary) {
    // 真的没东西可显示：交给调用方按"读不出来"处理，不要渲染空壳。
    return null
  }
  if (sections.length === 0) problems.push('缺少分节内容，只拿到了整体印象。')

  const actions: AnalysisAction[] = []
  const rawActions = raw['actions']
  if (Array.isArray(rawActions)) {
    for (const item of rawActions) {
      if (!isRecord(item)) continue
      const title = readText(item['title'])
      const steps = readTextList(item['steps'])
      if (!title || steps.length === 0) continue
      actions.push({ title, steps })
    }
  }

  return {
    schemaVersion,
    referenceType: readText(raw['referenceType']),
    summary,
    sections,
    boundaryNotes: readTextList(raw['boundaryNotes']),
    actions,
    reflectionQuestions: readTextList(raw['reflectionQuestions']),
    problems,
  }
}

/* ── 任务 ───────────────────────────────────────────────────────────────── */

/** 新契约整份校验；旧分析继续走原解析器。 */
function parseReadableAnalysis(raw: Record<string, unknown>): AnalysisResultView | null {
  const text = (value: unknown, max: number): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= max
  const ids = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.length <= 8 &&
    value.every(id => text(id, 100)) && new Set(value).size === value.length
  const exact = (value: Record<string, unknown>, keys: string[]): boolean =>
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
  if (!exact(raw, ['schemaVersion', 'referenceType', 'summary', 'observations', 'suggestedAction', 'limitations'])) return null
  if (raw.referenceType !== null && (typeof raw.referenceType !== 'string' || !/^[EI][SN][TF][JP]$/.test(raw.referenceType))) return null
  if (!text(raw.summary, 200) || !Array.isArray(raw.observations) || raw.observations.length > 2) return null
  if (!Array.isArray(raw.limitations) || raw.limitations.length < 1 || raw.limitations.length > 4 ||
      !raw.limitations.every(value => text(value, 160))) return null
  const sections: AnalysisSection[] = []
  for (const [index, item] of raw.observations.entries()) {
    if (!isRecord(item) || !exact(item, ['plainText', 'example', 'evidenceIds']) ||
        !text(item.plainText, 180) || (item.example !== null && !text(item.example, 120)) || !ids(item.evidenceIds)) return null
    sections.push({ key: `observation-${index}`, title: '为什么这样说',
      body: item.plainText + (item.example ? `\n${item.example}` : '') })
  }
  const actions: AnalysisAction[] = []
  const action = raw.suggestedAction
  if (action !== null) {
    if (!isRecord(action) || !exact(action, ['what', 'when', 'observe', 'evidenceIds']) ||
        !text(action.what, 120) || !text(action.when, 120) || !text(action.observe, 120) || !ids(action.evidenceIds)) return null
    actions.push({ title: '可以试一次', steps: [action.what, action.when, action.observe] })
  }
  return { schemaVersion: 'analysis-readable-v2', referenceType: raw.referenceType as string | null,
    summary: raw.summary, sections, boundaryNotes: raw.limitations as string[], actions,
    reflectionQuestions: [], problems: [] }
}

/**
 * 任务状态。`QUEUED` / `RUNNING` 是"还在跑"，`SUCCEEDED` 是终态，
 * `FAILED` / `UNKNOWN` 可重试（契约 §2 的 retry 只接受这两种）。
 */
export type AnalysisStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'

export interface AnalysisJob {
  jobId: string
  reportId: string
  status: AnalysisStatus
  topic: string
  promptVersion: string | null
  modelRequested: string | null
  modelReturned: string | null
  errorCode: string | null
  attemptCount: number
  createdAt: string | null
  finishedAt: string | null
  /** 未成功时为 null；成功但结构读不出来时也是 null（另给 `resultProblems`）。 */
  result: AnalysisResultView | null
  /** `result` 明明有内容却读不出来时的一句话说明。 */
  resultProblems: string[]
  /** true 表示这次输出是**演示数据**（mock 适配器），界面必须标明。 */
  mock: boolean
}

function parseStatus(value: unknown): AnalysisStatus {
  const text = readText(value) ?? ''
  if (text === 'QUEUED' || text === 'RUNNING' || text === 'SUCCEEDED' || text === 'FAILED') {
    return text
  }
  // 认不出的状态一律当 UNKNOWN：它对页面意味着"还不能显示结果、可以重试"，
  // 比硬塞一个 SUCCEEDED 安全得多。
  return 'UNKNOWN'
}

function readJob(raw: unknown): AnalysisJob {
  if (!isRecord(raw)) {
    throw unexpectedResponse('AI 分析接口返回了无法识别的任务结构。')
  }
  const jobId = readText(raw['jobId'])
  if (!jobId) {
    throw unexpectedResponse('AI 分析接口返回的任务没有编号。')
  }
  const status = parseStatus(raw['status'])
  const parsed = status === 'SUCCEEDED' ? parseAnalysisResult(raw['result']) : null
  return {
    jobId,
    reportId: readText(raw['reportId']) ?? '',
    status,
    topic: readText(raw['topic']) ?? '',
    promptVersion: readText(raw['promptVersion']),
    modelRequested: readText(raw['modelRequested']),
    modelReturned: readText(raw['modelReturned']),
    errorCode: readText(raw['errorCode']),
    attemptCount: typeof raw['attemptCount'] === 'number' ? raw['attemptCount'] : 0,
    createdAt: readText(raw['createdAt']),
    finishedAt: readText(raw['finishedAt']),
    result: parsed,
    resultProblems:
      // 判据只能是"服务端说成功、但页面读不出内容"。
      // 以前还额外要求 `result` 得是个对象（`hasRawResult`），于是"成功 + result 缺失/非对象"
      // 会走成**零提示的空成功**：面板渲染 `data-ai-result` 却没有正文也没有说明。
      // 那种响应在当前后端产生不了（校验器拒绝非对象），但"只有后端恰好不这么干才不出问题"
      // 不是一条能依赖的性质 —— 少一个条件比多一个条件更安全。
      status === 'SUCCEEDED' && parsed === null
        ? ['这份分析的输出没能被当前页面解析出来（可能是旧版本的输出格式）。']
        : (parsed?.problems ?? []),
    mock: raw['mock'] === true,
  }
}

/* ── 端点 ───────────────────────────────────────────────────────────────── */

export interface AiStatus {
  enabled: boolean
  mock: boolean
  model: string
  dailyLimitPerUser: number
  remainingToday: number
  /** db / env / none —— 只用来解释"为什么不能用"，**不显示 key 本身**。 */
  apiKeySource: string
  promptVersion: string | null
}

/**
 * `GET /ai/status`。
 *
 * 未登录时也返回 200（服务端刻意允许），`remainingToday = -1` 表示"算不清"
 * （未登录，或服务端读额度失败）——前端据此**不显示次数**，而不是显示 0 次。
 * 这里不做登录判断，交给调用方。
 */
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  const response = await v3Request('GET', '/ai/status', { signal, withCsrf: false })
  const raw = await v3ReadJson<unknown>(response, '/ai/status')
  const record = isRecord(raw) ? raw : {}
  return {
    enabled: record['enabled'] === true,
    mock: record['mock'] === true,
    model: readText(record['model']) ?? '',
    dailyLimitPerUser:
      typeof record['dailyLimitPerUser'] === 'number' ? record['dailyLimitPerUser'] : 0,
    /*
     * 字段缺失时按 **-1（算不清）** 而不是 0：0 在界面上的意思是"今天用完了"，
     * 那是替服务端下一个它没下过的结论；-1 只会让页面不显示次数（A53②）。
     */
    remainingToday: typeof record['remainingToday'] === 'number' ? record['remainingToday'] : -1,
    apiKeySource: readText(record['apiKeySource']) ?? 'none',
    promptVersion: readText(record['promptVersion']),
  }
}

export interface CreateAnalysisResult {
  jobId: string
  status: AnalysisStatus
  /** true 表示命中了去重：拿到的是**同一份范围**已有的任务，没有新建、也没有再扣额度。 */
  cached: boolean
}

/**
 * `POST /reports/{id}/analyses`。
 *
 * `idempotencyKey` **必填**（契约 §2.1）：同一次点击必须复用同一个键，
 * 换一次点击才换新的键。调用方负责保存它 —— 页面把它存在 ref 里，
 * 直到这次任务结束。
 */
export async function createAnalysis(input: {
  reportId: string
  topic: AnalysisTopic
  note?: string
  idempotencyKey: string
  signal?: AbortSignal
  scopeVersion?: string
}): Promise<CreateAnalysisResult> {
  const body: Record<string, unknown> = {
    consent: {
      policyVersion: AI_CONSENT_POLICY_VERSION,
      scopeVersion: input.scopeVersion ?? AI_SCOPE_VERSION,
    },
    topic: input.topic,
  }
  const note = input.note?.trim()
  if (note) body.note = note

  const response = await v3Request('POST', `/reports/${encodeURIComponent(input.reportId)}/analyses`, {
    body,
    idempotencyKey: input.idempotencyKey,
    signal: input.signal,
    // 创建是同步写库 + 可能读整份报告构造输入，给足时间但不要无限等。
    timeoutMs: 30000,
  })
  const raw = await v3ReadJson<unknown>(response, '/reports/{id}/analyses')
  const record = isRecord(raw) ? raw : {}
  const jobId = readText(record['jobId'])
  if (!jobId) throw unexpectedResponse('创建分析后服务端没有返回任务编号。')
  return {
    jobId,
    status: parseStatus(record['status']),
    cached: record['cached'] === true,
  }
}

/** `GET /analyses/{id}`。 */
export async function fetchAnalysis(jobId: string, signal?: AbortSignal): Promise<AnalysisJob> {
  const response = await v3Request('GET', `/analyses/${encodeURIComponent(jobId)}`, {
    signal,
    withCsrf: false,
  })
  return readJob(await v3ReadJson<unknown>(response, '/analyses/{id}'))
}

/** `GET /reports/{id}/analyses` —— 该报告下的全部任务，按创建时间倒序。 */
export async function fetchReportAnalyses(
  reportId: string,
  signal?: AbortSignal,
): Promise<AnalysisJob[]> {
  const response = await v3Request('GET', `/reports/${encodeURIComponent(reportId)}/analyses`, {
    signal,
    withCsrf: false,
  })
  const raw = await v3ReadJson<unknown>(response, '/reports/{id}/analyses')
  const record = isRecord(raw) ? raw : {}
  const items = Array.isArray(record['items']) ? record['items'] : []
  const jobs: AnalysisJob[] = []
  for (const item of items) {
    try {
      jobs.push(readJob(item))
    } catch {
      // 单个任务形状不对不该让整页失败：跳过它，其余照常显示。
      // （与 `readJob` 抛错并不矛盾：列表里的坏数据是"少显示一条"，
      //   详情里的坏数据才是"这次请求的结果不可信"。）
    }
  }
  return jobs
}

export interface RetryAnalysisResult {
  jobId: string
  status: AnalysisStatus
  attemptCount: number
}

/** `POST /analyses/{id}/retry` —— 只对 FAILED / UNKNOWN 有效；不新建任务行。 */
export async function retryAnalysis(jobId: string, signal?: AbortSignal): Promise<RetryAnalysisResult> {
  const response = await v3Request('POST', `/analyses/${encodeURIComponent(jobId)}/retry`, {
    body: {},
    signal,
    timeoutMs: 30000,
  })
  const raw = await v3ReadJson<unknown>(response, '/analyses/{id}/retry')
  const record = isRecord(raw) ? raw : {}
  return {
    jobId: readText(record['jobId']) ?? jobId,
    status: parseStatus(record['status']),
    attemptCount: typeof record['attemptCount'] === 'number' ? record['attemptCount'] : 0,
  }
}

/* ── 给页面用的状态判断 ─────────────────────────────────────────────────── */

export function isRunning(job: AnalysisJob | null): boolean {
  return job !== null && (job.status === 'QUEUED' || job.status === 'RUNNING')
}

export function isRetryable(job: AnalysisJob | null): boolean {
  return job !== null && (job.status === 'FAILED' || job.status === 'UNKNOWN')
}

/**
 * 把 AI 的错误码转成"用户该做什么"。
 *
 * 刻意不把服务端的 message 原样显示：AI 的错误码有一批是给运维看的
 * （例如 `TYPE_MISMATCH`），原样显示只会让用户困惑。
 */
export function aiFailureHint(errorCode: string | null, error: ErrorDisplay | null): string {
  if (error) {
    if (error.code === 'AI_NOT_CONFIGURED') {
      return '这台服务器还没有配置 AI 分析，所以暂时用不了。基础报告不受影响。'
    }
    if (error.code === 'BUDGET_EXCEEDED') {
      return '今天的 AI 分析额度已经用完了，明天再来。基础报告不受影响。'
    }
    if (error.code === 'CONSENT_REQUIRED') {
      return '需要先勾选确认要发送的范围，才能生成分析。'
    }
    return error.message
  }
  switch (errorCode) {
    case 'TIMEOUT':
      return '这次生成等超时了。可以重试一次。'
    case 'RATE_LIMITED':
      return '刚才请求太多，稍等一下再重试。'
    case 'UPSTREAM_401':
      return '服务器上的 AI 密钥无效或已过期，所以这次用不了。这需要站点管理员处理，你自己重试没有用。基础报告不受影响。'
    case 'UPSTREAM_402':
      return 'AI 服务的余额不足，所以这次用不了。这需要站点管理员处理。基础报告不受影响。'
    case 'UPSTREAM_429':
      return '模型服务那边正在限流，稍等一会儿再重试。'
    case 'UPSTREAM_5XX':
      return '模型服务那边出了临时故障。稍后重试；反复失败就先放下。基础报告不受影响。'
    case 'UPSTREAM_UNAVAILABLE':
      return '连不上模型服务（可能是网络问题）。可以稍后重试。'
    case 'TRUNCATED':
      return '这次输出被截断了，重试一次通常能拿到完整结果。'
    case 'CONTENT_VIOLATION':
      return '这次输出里出现了本站不允许的表述（例如把测评说成诊断），所以没有采纳。可以重试。'
    case 'EMPTY_CONTENT':
      return '这次没有拿到内容，重试一次试试。'
    case 'TYPE_MISMATCH':
    case 'INVALID_JSON':
      return '这次输出的格式不合格，已经被丢弃（不会拿一份格式不对的结果凑数）。可以重试。'
    case 'UPSTREAM_ERROR':
      return '模型服务拒绝了这次请求，稍后重试。'
    default:
      return '这次生成没有成功。可以重试一次；反复失败时先放下，基础报告不受影响。'
  }
}
