/**
 * 后端内容 → 规范化 JS 对象（IM-1）。
 *
 * 三份前端内置副本（题库 / 16 型文案 / 方法页）**唯一**的来源就是这里的三个 YAML 文件：
 *   backend/src/main/resources/content/questionnaire-quick.yml
 *   backend/src/main/resources/content/types.yml
 *   backend/src/main/resources/content/method.yml
 *
 * 生成脚本与跨源一致性测试都走这个模块，保证「读到的后端内容」只有一种解释方式。
 * 读取本身也做形状校验：字段缺失 / 类型不对就抛错，而不是把 undefined 写进前端。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { parseYaml } from './yaml.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 仓库根目录（scripts/lib/ → ../..）。 */
export const REPO_ROOT = resolve(HERE, '..', '..')

export const CONTENT_DIR = resolve(REPO_ROOT, 'backend/src/main/resources/content')
export const APPLICATION_YML = resolve(REPO_ROOT, 'backend/src/main/resources/application.yml')
export const FRONTEND_CONTENT_DIR = resolve(REPO_ROOT, 'frontend/src/content')
export const ASSESSMENT_PACKAGES_DIR = resolve(
  REPO_ROOT,
  'backend/src/main/resources/assessment-packages',
)

/** 与 ContentService.REQUIRED_TYPE_CODES 一致。 */
export const REQUIRED_TYPE_CODES = [
  'INTJ', 'INTP', 'ENTJ', 'ENTP', 'INFJ', 'INFP', 'ENFJ', 'ENFP',
  'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ', 'ISTP', 'ISFP', 'ESTP', 'ESFP',
]

/** 与 ContentService.OFFICIAL_CONSTANTS 一致——不一致就是内容被人改坏了。 */
export const OFFICIAL_CONSTANTS = { EI: 30, SN: 12, TF: 30, JP: 18 }
export const OFFICIAL_MIDPOINT = 24
export const OFFICIAL_SIGNS = {
  EI: { 3: -1, 7: -1, 11: -1, 15: 1, 19: -1, 23: 1, 27: 1, 31: -1 },
  SN: { 4: 1, 8: 1, 12: 1, 16: 1, 20: 1, 24: -1, 28: -1, 32: 1 },
  TF: { 2: -1, 6: 1, 10: 1, 14: -1, 18: -1, 22: 1, 26: -1, 30: -1 },
  JP: { 1: 1, 5: 1, 9: -1, 13: 1, 17: -1, 21: 1, 25: -1, 29: 1 },
}
export const DIMENSIONS = ['EI', 'SN', 'TF', 'JP']

/**
 * 仪器档案（Node 侧的独立抄录）——与前端
 * `frontend/src/domain/assessmentPackage.ts` 的 `INSTRUMENT_PROFILES` 必须一致。
 *
 * 存在两份是**刻意的**：生成脚本要把后端 YAML 抄成前端内置副本，抄错方向符号的后果是
 * 「页面能跑、结果全错」。这里用独立抄录的官方数据核对，才能在生成期就判红。
 */
export const INSTRUMENT_PROFILES = {
  oejts32: {
    id: 'oejts32',
    questionnaireVersion: 'quick',
    format: 'bipolar',
    hasTypeCode: true,
    questionCount: 32,
    dimensionOrder: DIMENSIONS,
    perDimension: 8,
    midpoint: OFFICIAL_MIDPOINT,
    constants: OFFICIAL_CONSTANTS,
    signs: OFFICIAL_SIGNS,
    poles: {
      EI: { low: 'I', high: 'E' },
      SN: { low: 'S', high: 'N' },
      TF: { low: 'F', high: 'T' },
      JP: { low: 'J', high: 'P' },
    },
    attributionMustMatchMethod: true,
  },
  /**
   * IPIP-50 = Goldberg 的 Big-Five Factor Markers（10 题/因素，公有领域）。
   * 符号表照官方计分键逐题抄录：E 5正5反、A 6正4反、C 6正4反、ES 2正8反、O 7正3反。
   */
  ipip50: {
    id: 'ipip50',
    questionnaireVersion: 'ipip50',
    format: 'agreement',
    hasTypeCode: false,
    questionCount: 50,
    dimensionOrder: ['E', 'A', 'C', 'ES', 'O'],
    perDimension: 10,
    midpoint: 30,
    constants: { E: 30, A: 24, C: 24, ES: 48, O: 18 },
    signs: {
      E: { 1: 1, 6: -1, 11: 1, 16: -1, 21: 1, 26: -1, 31: 1, 36: -1, 41: 1, 46: -1 },
      A: { 2: -1, 7: 1, 12: -1, 17: 1, 22: -1, 27: 1, 32: -1, 37: 1, 42: 1, 47: 1 },
      C: { 3: 1, 8: -1, 13: 1, 18: -1, 23: 1, 28: -1, 33: 1, 38: -1, 43: 1, 48: 1 },
      ES: { 4: -1, 9: 1, 14: -1, 19: 1, 24: -1, 29: -1, 34: -1, 39: -1, 44: -1, 49: -1 },
      O: { 5: 1, 10: -1, 15: 1, 20: -1, 25: 1, 30: -1, 35: 1, 40: 1, 45: 1, 50: 1 },
    },
    poles: {
      E: { low: '低', high: '高' },
      A: { low: '低', high: '高' },
      C: { low: '低', high: '高' },
      ES: { low: '低', high: '高' },
      O: { low: '低', high: '高' },
    },
    attributionMustMatchMethod: false,
  },
}

export class ContentShapeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContentShapeError'
  }
}

function readYaml(path) {
  if (!existsSync(path)) {
    throw new ContentShapeError(`后端内容文件不存在：${path}`)
  }
  return parseYaml(readFileSync(path, 'utf8'))
}

function requireString(value, where) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ContentShapeError(`${where} 必须是非空字符串，实际：${JSON.stringify(value)}`)
  }
  return value
}

function requireStringArray(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ContentShapeError(`${where} 必须是非空数组，实际：${JSON.stringify(value)}`)
  }
  return value.map((item, index) => requireString(item, `${where}[${index}]`))
}

// --------------------------------------------------------------------- 题库

/**
 * 读取快速版题库并做与后端一致的形状校验。
 *
 * ⚠️ 这里**刻意重复**了一遍后端 ContentService 的硬断言（题号、维度、符号、常量、中点）：
 * 生成脚本是「把后端内容抄成前端内容」的那一步，抄错方向符号的后果是「页面能跑、结果全错」，
 * 而且前端没有服务端那种启动期断言。两份断言必须都过。
 */
export function loadQuestionnaire(version = 'quick') {
  const path = resolve(CONTENT_DIR, `questionnaire-${version}.yml`)
  const raw = readYaml(path)
  const where = path
  const loadedVersion = requireString(raw.version, `${where} version`)
  if (loadedVersion !== version) {
    throw new ContentShapeError(`${where} 期望 version=${version}，实际 ${loadedVersion}`)
  }
  return loadQuestionnaireObject(raw, where, { profile: INSTRUMENT_PROFILES.oejts32 })
}

/**
 * 题库对象的形状校验（文件读取之外的**全部**规则）。
 *
 * 抽出来是因为 v2 内容包内嵌了一份题库：它必须和 v1 的题库走**同一套**断言，
 * 否则「v1 拦得住、内容包拦不住」，用户会从新入口拿到一份符号错掉的量表。
 *
 * 本轮泛化：不再假设"必须有 OEJTS 的四个维度"，而是
 *   ① 先做与量表无关的结构校验（两种作答格式各自的必需字段、常量配平、题号升序）；
 *   ② 有仪器档案时，再用**独立抄录**的官方数据逐题核对（题数/维度/常量/中点/符号）。
 */
export function loadQuestionnaireObject(raw, where, options = {}) {
  const profile = options.profile
  if (raw === null || typeof raw !== 'object') {
    throw new ContentShapeError(`${where} 必须是一个映射`)
  }
  const loadedVersion = requireString(raw.version, `${where} version`)
  const format = raw.format === 'agreement' ? 'agreement' : 'bipolar'
  if (profile && profile.format !== format) {
    throw new ContentShapeError(`${where} format 必须是 ${profile.format}，实际 ${format}`)
  }

  const questions = raw.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new ContentShapeError(`${where} questions 必须是非空数组`)
  }

  const normalized = questions.map((question, index) => {
    const at = `${where} questions[${index}]`
    const id = question.id
    if (!Number.isInteger(id) || id < 1) {
      throw new ContentShapeError(`${at}.id 必须是 >= 1 的整数，实际 ${JSON.stringify(id)}`)
    }
    const dimension = requireString(question.dimension, `${at}.dimension`)
    if (question.direction !== 1 && question.direction !== -1) {
      throw new ContentShapeError(`${at}.direction 只能是 +1/-1，实际 ${JSON.stringify(question.direction)}`)
    }
    if (format === 'agreement') {
      const text = requireString(question.text, `${at}.text`)
      return { id, text, dimension, direction: question.direction }
    }
    const textLeft = requireString(question.textLeft, `${at}.textLeft`)
    const textRight = requireString(question.textRight, `${at}.textRight`)
    if (textLeft === textRight) {
      throw new ContentShapeError(`${at} 的左右两端文本完全相同，疑似笔误`)
    }
    return { id, textLeft, textRight, dimension, direction: question.direction }
  })

  const questionCount = raw.questionCount
  if (questionCount !== normalized.length) {
    throw new ContentShapeError(
      `${where} questionCount=${questionCount} 与 questions 实际条数 ${normalized.length} 不一致`,
    )
  }

  // 五档文案：可缺省（bipolar 用 OEJTS 默认文案）；声明了就必须恰好 5 条
  if (raw.responseAnchors !== undefined) {
    if (!Array.isArray(raw.responseAnchors) || raw.responseAnchors.length !== 5) {
      throw new ContentShapeError(`${where} responseAnchors 必须是 5 条，实际 ${JSON.stringify(raw.responseAnchors)}`)
    }
    raw.responseAnchors.forEach((anchor, index) =>
      requireString(anchor, `${where} responseAnchors[${index}]`),
    )
  }

  const scoring = raw.scoring
  if (scoring === null || typeof scoring !== 'object') {
    throw new ContentShapeError(`${where} 缺少 scoring`)
  }
  if (typeof scoring.midpoint !== 'number' || !Number.isFinite(scoring.midpoint)) {
    throw new ContentShapeError(`${where} scoring.midpoint 必须是有限数值，实际 ${scoring.midpoint}`)
  }
  const constants = scoring.constants

  // 逐维度的题号 / 符号必须与官方公式一致，且题号按 id 升序
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index].id <= normalized[index - 1].id) {
      throw new ContentShapeError(`${where} questions 必须按 id 升序排列（第 ${index + 1} 项乱序）`)
    }
  }

  const dimensions = []
  for (const question of normalized) {
    if (!dimensions.includes(question.dimension)) dimensions.push(question.dimension)
  }

  // ① 通用不变量（与量表无关）
  const counts = {}
  const sumDirection = {}
  for (const question of normalized) {
    counts[question.dimension] = (counts[question.dimension] ?? 0) + 1
    sumDirection[question.dimension] = (sumDirection[question.dimension] ?? 0) + question.direction
  }
  for (const dimension of dimensions) {
    const constant = constants?.[dimension]
    if (typeof constant !== 'number' || !Number.isFinite(constant)) {
      throw new ContentShapeError(`${where} scoring.constants.${dimension} 必须是有限数值，实际 ${constant}`)
    }
    const neutralScore = constant + 3 * sumDirection[dimension]
    if (neutralScore !== scoring.midpoint) {
      throw new ContentShapeError(
        `${where} ${dimension} 的常量没有配平：每题都选 3 时得到 ${neutralScore}，不等于中点 ${scoring.midpoint}`,
      )
    }
  }

  if (raw.dimensionOrder !== undefined) {
    if (!Array.isArray(raw.dimensionOrder)) {
      throw new ContentShapeError(`${where} dimensionOrder 必须是数组`)
    }
    const declared = raw.dimensionOrder.map((item, index) =>
      requireString(item, `${where} dimensionOrder[${index}]`),
    )
    if (declared.length !== dimensions.length || declared.some((item) => !dimensions.includes(item))) {
      throw new ContentShapeError(
        `${where} dimensionOrder（${declared.join('/')}）必须与题目里出现的维度集合一致（${dimensions.join('/')}）`,
      )
    }
  }

  // ② 仪器档案核对
  if (profile) {
    if (normalized.length !== profile.questionCount) {
      throw new ContentShapeError(
        `${where} 必须恰好 ${profile.questionCount} 题，实际 ${normalized.length}`,
      )
    }
    if (loadedVersion !== profile.questionnaireVersion) {
      throw new ContentShapeError(`${where} version 必须是 ${profile.questionnaireVersion}，实际 ${loadedVersion}`)
    }
    if (scoring.midpoint !== profile.midpoint) {
      throw new ContentShapeError(`${where} scoring.midpoint 必须是 ${profile.midpoint}，实际 ${scoring.midpoint}`)
    }
    for (const dimension of profile.dimensionOrder) {
      if (constants?.[dimension] !== profile.constants[dimension]) {
        throw new ContentShapeError(
          `${where} scoring.constants.${dimension} 必须是 ${profile.constants[dimension]}，实际 ${constants?.[dimension]}`,
        )
      }
      const actual = {}
      for (const question of normalized) {
        if (question.dimension === dimension) actual[question.id] = question.direction
      }
      const expected = profile.signs[dimension]
      const actualKeys = Object.keys(actual).sort((a, b) => a - b)
      const expectedKeys = Object.keys(expected).sort((a, b) => a - b)
      if (actualKeys.join(',') !== expectedKeys.join(',')) {
        throw new ContentShapeError(
          `${where} ${dimension} 维度的题号与官方不一致。期望 ${expectedKeys}，实际 ${actualKeys}`,
        )
      }
      for (const key of expectedKeys) {
        if (actual[key] !== expected[key]) {
          throw new ContentShapeError(
            `${where} ${dimension} 维度 Q${key} 的符号必须是 ${expected[key]}，实际 ${actual[key]}`,
          )
        }
      }
    }
    const extra = dimensions.filter((dimension) => !profile.dimensionOrder.includes(dimension))
    if (extra.length > 0) {
      throw new ContentShapeError(`${where} 出现了档案之外的维度：${extra.join('/')}`)
    }
  }

  const result = {
    version: loadedVersion,
    title: requireString(raw.title, `${where} title`),
    questionCount,
    estimatedMinutes: raw.estimatedMinutes,
    scoring: { midpoint: scoring.midpoint, constants: { ...constants } },
    questions: normalized,
  }
  // 作答格式与五档文案必须一起带出：前端按它们选择题卡版式与档位文案。
  // 只有 bipolar 才省略（这正是既有 OEJTS 包保持字节不变的方式）。
  if (format === 'agreement') result.format = 'agreement'
  if (raw.responseAnchors !== undefined) result.responseAnchors = [...raw.responseAnchors]
  if (raw.dimensionOrder !== undefined) result.dimensionOrder = [...raw.dimensionOrder]
  return result
}

// --------------------------------------------------------------------- 内容包 v2

/** 与 `ContentService` / 前端校验器一致的白名单：只有这些包会被注册。 */
export const ASSESSMENT_PACKAGE_IDS = [
  // 顺序即「默认包」：第一项是站点默认量表（大五 IPIP-50，公版可商用）。
  // OEJTS 32 题保留为可选旧版本，不再是默认入口。
  'ipip50-zh1',
  'oejts32-zh1-report2',
  'oejts32-zh2-preview-r1',
]

export const DEFAULT_PACKAGE_ID = ASSESSMENT_PACKAGE_IDS[0]

export const CONTENT_STATUSES = ['draft', 'reviewed', 'field_checked']
const STATUS_RANK = { draft: 0, reviewed: 1, field_checked: 2 }
export const RISK_CODES = ['L', 'B', 'C']
export const FORBIDDEN_HELP_FRAGMENTS = ['该解释的场景范围须与最终题面一致', '若采用']

export const REPORT_COPY_FIELDS = [
  'typedTitle',
  'typedSubtitle',
  'partialTitle',
  'partialSubtitle',
  'undeterminedTitle',
  'undeterminedSubtitle',
  'insufficientTitle',
  'insufficientSubtitle',
  'typeReadingLead',
  'scoreMethodNote',
  'dimensionReviewLead',
  'selfReflectionLead',
]

function requireObject(value, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentShapeError(`${where} 必须是一个映射，实际：${JSON.stringify(value)}`)
  }
  return value
}

function requireInteger(value, where) {
  if (!Number.isInteger(value)) {
    throw new ContentShapeError(`${where} 必须是整数，实际：${JSON.stringify(value)}`)
  }
  return value
}

function requireExactKeys(object, expected, where) {
  const actual = Object.keys(object).sort()
  const wanted = [...expected].sort()
  if (actual.join(',') !== wanted.join(',')) {
    throw new ContentShapeError(
      `${where} 的键必须恰好是 ${wanted.join('/')}，实际 ${actual.join('/') || '（空）'}`,
    )
  }
}

function requirePoleCopy(value, where) {
  const copy = requireObject(value, where)
  return {
    label: requireString(copy.label, `${where}.label`),
    description: requireString(copy.description, `${where}.description`),
    observation: requireString(copy.observation, `${where}.observation`),
    action: requireString(copy.action, `${where}.action`),
  }
}

/**
 * 读取并校验一个 v2 内容包。
 *
 * 这里的规则与后端 `ContentService.validateAssessmentPackage`、前端
 * `domain/assessmentPackage.ts` 的 `assessmentPackageProblems` 是**同一套**：
 * 三处都拦得住，才不会出现「生成脚本放过去、用户看到的内容却是坏的」。
 */
export function loadAssessmentPackage(packageId, expectedAttribution) {
  const path = resolve(ASSESSMENT_PACKAGES_DIR, `${packageId}.yml`)
  if (!existsSync(path)) {
    throw new ContentShapeError(`内容包文件不存在：${path}`)
  }
  const where = path
  const raw = requireObject(parseYaml(readFileSync(path, 'utf8')), where)

  if (raw.schemaVersion !== 2) {
    throw new ContentShapeError(`${where} schemaVersion 必须是 2，实际 ${raw.schemaVersion}`)
  }
  if (requireString(raw.packageId, `${where} packageId`) !== packageId) {
    throw new ContentShapeError(`${where} packageId 必须等于文件名（${packageId}），实际 ${raw.packageId}`)
  }
  if (raw.locale !== 'zh-CN') {
    throw new ContentShapeError(`${where} locale 必须是 zh-CN，实际 ${raw.locale}`)
  }

  const instrument = requireObject(raw.instrument, `${where} instrument`)
  const instrumentId = requireString(instrument.id, `${where} instrument.id`)
  requireString(instrument.revision, `${where} instrument.revision`)
  requireString(instrument.scoringVersion, `${where} instrument.scoringVersion`)
  const profile = INSTRUMENT_PROFILES[instrumentId]
  if (!profile) {
    throw new ContentShapeError(
      `${where} instrument.id=${instrumentId} 没有本地仪器档案，符号/常量/维度无法独立核对，拒绝装载`,
    )
  }
  // 声明值优先；未声明时由档案补齐（已锁定的 OEJTS 包因此不需要改一个字节）
  const declaredFormat = instrument.format ?? profile.format
  const declaredTypeCode = instrument.hasTypeCode ?? profile.hasTypeCode
  if (declaredFormat !== profile.format) {
    throw new ContentShapeError(
      `${where} instrument.format 与档案不一致：${profile.id} 应为 ${profile.format}，实际 ${declaredFormat}`,
    )
  }
  if (declaredTypeCode !== profile.hasTypeCode) {
    throw new ContentShapeError(
      `${where} instrument.hasTypeCode 与档案不一致：${profile.id} 应为 ${String(profile.hasTypeCode)}`,
    )
  }

  const interpretation = requireObject(raw.interpretation, `${where} interpretation`)
  const minRatings = requireInteger(
    interpretation.minRatingsPerDimension,
    `${where} interpretation.minRatingsPerDimension`,
  )
  if (minRatings !== profile.perDimension) {
    throw new ContentShapeError(
      `${where} interpretation.minRatingsPerDimension 必须是 ${profile.perDimension}（${profile.id} 每维题数），实际 ${minRatings}`,
    )
  }
  const typeMinDistance = requireInteger(
    interpretation.typeMinDistance,
    `${where} interpretation.typeMinDistance`,
  )
  const markedDistance = requireInteger(
    interpretation.markedDistance,
    `${where} interpretation.markedDistance`,
  )
  if (typeMinDistance < 1 || markedDistance <= typeMinDistance) {
    throw new ContentShapeError(
      `${where} interpretation 的门槛必须满足 1 <= typeMinDistance < markedDistance，实际 ${typeMinDistance}/${markedDistance}`,
    )
  }
  requireString(interpretation.version, `${where} interpretation.version`)

  const estimatedMinutes = requireInteger(raw.estimatedMinutes, `${where} estimatedMinutes`)
  if (estimatedMinutes < 1 || estimatedMinutes > 60) {
    throw new ContentShapeError(`${where} estimatedMinutes 必须在 1–60，实际 ${estimatedMinutes}`)
  }

  // 内嵌题库：走与 v1 同一套规则，并带上该仪器的档案
  const questionnaire = loadQuestionnaireObject(raw.questionnaire, `${where} questionnaire`, { profile })

  // 维度展示顺序：包声明优先，否则用档案
  const dimensionOrder = Array.isArray(raw.dimensionOrder)
    ? raw.dimensionOrder.map((item, index) => requireString(item, `${where} dimensionOrder[${index}]`))
    : [...profile.dimensionOrder]
  const dimensionKeys = [...new Set(questionnaire.questions.map((question) => question.dimension))]
  if (
    dimensionOrder.length !== dimensionKeys.length ||
    dimensionOrder.some((dimension) => !dimensionKeys.includes(dimension))
  ) {
    throw new ContentShapeError(
      `${where} dimensionOrder（${dimensionOrder.join('/')}）与题库维度集合不一致（${dimensionKeys.join('/')}）`,
    )
  }

  // 逐题帮助：键必须恰好覆盖题库的全部题号
  const itemHelpRaw = requireObject(raw.itemHelp, `${where} itemHelp`)
  const expectedItemKeys = questionnaire.questions.map((question) => String(question.id))
  requireExactKeys(itemHelpRaw, expectedItemKeys, `${where} itemHelp`)
  const itemHelp = {}
  for (const key of expectedItemKeys) {
    const at = `${where} itemHelp["${key}"]`
    const entry = requireObject(itemHelpRaw[key], at)
    const explanation = requireString(entry.explanation, `${at}.explanation`)
    for (const fragment of FORBIDDEN_HELP_FRAGMENTS) {
      if (explanation.includes(fragment)) {
        throw new ContentShapeError(`${at}.explanation 含开发者批注「${fragment}」，不得作为用户可见帮助`)
      }
    }
    if (!CONTENT_STATUSES.includes(entry.reviewStatus)) {
      throw new ContentShapeError(`${at}.reviewStatus 不合法：${entry.reviewStatus}`)
    }
    const riskCodes = entry.riskCodes
    if (!Array.isArray(riskCodes) || riskCodes.some((code) => !RISK_CODES.includes(code))) {
      throw new ContentShapeError(`${at}.riskCodes 只能包含 ${RISK_CODES.join('/')}`)
    }
    itemHelp[key] = { explanation, reviewStatus: entry.reviewStatus, riskCodes: [...riskCodes] }
  }

  // contentStatus 不得高于包内最低证据状态
  const contentStatus = raw.contentStatus
  if (!CONTENT_STATUSES.includes(contentStatus)) {
    throw new ContentShapeError(`${where} contentStatus 不合法：${contentStatus}`)
  }
  const lowest = Object.values(itemHelp).reduce(
    (min, entry) => (STATUS_RANK[entry.reviewStatus] < STATUS_RANK[min] ? entry.reviewStatus : min),
    'field_checked',
  )
  if (STATUS_RANK[contentStatus] > STATUS_RANK[lowest]) {
    throw new ContentShapeError(
      `${where} contentStatus=${contentStatus} 高于包内最低证据状态 ${lowest}（含 draft 必须保持 draft）`,
    )
  }

  // 维度解释文案：键必须与题库维度集合一致
  const dimensionCopyRaw = requireObject(raw.dimensionCopy, `${where} dimensionCopy`)
  requireExactKeys(dimensionCopyRaw, dimensionKeys, `${where} dimensionCopy`)
  const dimensionCopy = {}
  for (const dimension of dimensionKeys) {
    const at = `${where} dimensionCopy.${dimension}`
    const copy = requireObject(dimensionCopyRaw[dimension], at)
    const balanced = requireObject(copy.balanced, `${at}.balanced`)
    const insufficient = requireObject(copy.insufficient, `${at}.insufficient`)
    dimensionCopy[dimension] = {
      name: requireString(copy.name, `${at}.name`),
      // 两端记号：包可覆盖，缺省用仪器档案
      lowPole: copy.lowPole === undefined ? profile.poles[dimension].low : requireString(copy.lowPole, `${at}.lowPole`),
      highPole:
        copy.highPole === undefined ? profile.poles[dimension].high : requireString(copy.highPole, `${at}.highPole`),
      negative: requirePoleCopy(copy.negative, `${at}.negative`),
      positive: requirePoleCopy(copy.positive, `${at}.positive`),
      balanced: {
        summary: requireString(balanced.summary, `${at}.balanced.summary`),
        observation: requireString(balanced.observation, `${at}.balanced.observation`),
      },
      insufficient: {
        summary: requireString(insufficient.summary, `${at}.insufficient.summary`),
        nextStep: requireString(insufficient.nextStep, `${at}.insufficient.nextStep`),
      },
    }
  }

  // 报告文案
  const reportCopyRaw = requireObject(raw.reportCopy, `${where} reportCopy`)
  requireExactKeys(reportCopyRaw, REPORT_COPY_FIELDS, `${where} reportCopy`)
  const reportCopy = {}
  for (const field of REPORT_COPY_FIELDS) {
    reportCopy[field] = requireString(reportCopyRaw[field], `${where} reportCopy.${field}`)
  }

  const nextSteps = requireStringArray(raw.nextSteps, `${where} nextSteps`)
  if (nextSteps.length < 3) {
    throw new ContentShapeError(`${where} nextSteps 至少要有 3 条，实际 ${nextSteps.length}`)
  }

  // attribution：形状必须齐全；只有档案要求"与 method.yml 逐字相等"的仪器
  // （OEJTS，CC BY-NC-SA 的署名义务）才做那一步比较。IPIP 是公有领域，署名另有来源。
  const attributionRaw = requireObject(raw.attribution, `${where} attribution`)
  const attribution = {
    source: requireString(attributionRaw.source, `${where} attribution.source`),
    author: requireString(attributionRaw.author, `${where} attribution.author`),
    url: requireString(attributionRaw.url, `${where} attribution.url`),
    license: requireString(attributionRaw.license, `${where} attribution.license`),
    licenseUrl: requireString(attributionRaw.licenseUrl, `${where} attribution.licenseUrl`),
  }
  if (profile.attributionMustMatchMethod && expectedAttribution !== undefined) {
    for (const field of ['source', 'author', 'url', 'license', 'licenseUrl']) {
      if (attribution[field] !== expectedAttribution[field]) {
        throw new ContentShapeError(
          `${where} attribution.${field} 必须与 method.yml 逐字相等：期望 ${JSON.stringify(expectedAttribution[field])}，实际 ${JSON.stringify(attribution[field])}`,
        )
      }
    }
  }

  return {
    schemaVersion: 2,
    packageId,
    locale: 'zh-CN',
    localeRevision: requireString(raw.localeRevision, `${where} localeRevision`),
    helpRevision: requireString(raw.helpRevision, `${where} helpRevision`),
    copyRevision: requireString(raw.copyRevision, `${where} copyRevision`),
    contentStatus,
    instrument: {
      id: profile.id,
      revision: requireString(instrument.revision, `${where} instrument.revision`),
      scoringVersion: requireString(instrument.scoringVersion, `${where} instrument.scoringVersion`),
      format: profile.format,
      hasTypeCode: profile.hasTypeCode,
    },
    interpretation: {
      version: requireString(interpretation.version, `${where} interpretation.version`),
      minRatingsPerDimension: minRatings,
      typeMinDistance,
      markedDistance,
    },
    title: requireString(raw.title, `${where} title`),
    estimatedMinutes,
    dimensionOrder,
    questionnaire,
    itemHelp,
    dimensionCopy,
    reportCopy,
    nextSteps,
    attribution,
  }
}

/**
 * v2 内容包注册表：只加载白名单里的包，且**必须全部存在**。
 * 缺一个就整体失败——内容包是交付内容的一部分，不是可选项。
 */
export function loadAssessmentPackages() {
  if (!existsSync(ASSESSMENT_PACKAGES_DIR)) {
    throw new ContentShapeError(
      `内容包目录不存在：${ASSESSMENT_PACKAGES_DIR}（v2 内容包是交付内容的一部分）`,
    )
  }
  const method = loadMethod()
  const onDisk = readdirSync(ASSESSMENT_PACKAGES_DIR).filter((name) => name.endsWith('.yml'))
  const known = onDisk.map((name) => name.replace(/\.yml$/, ''))
  const unknown = known.filter((id) => !ASSESSMENT_PACKAGE_IDS.includes(id))
  if (unknown.length > 0) {
    throw new ContentShapeError(
      `${ASSESSMENT_PACKAGES_DIR} 出现未注册的内容包：${unknown.join(', ')}（注册表白名单见 backend-content.mjs）`,
    )
  }
  const missing = ASSESSMENT_PACKAGE_IDS.filter((id) => !known.includes(id))
  if (missing.length > 0) {
    throw new ContentShapeError(`${ASSESSMENT_PACKAGES_DIR} 缺少已注册的内容包：${missing.join(', ')}`)
  }
  return ASSESSMENT_PACKAGE_IDS.map((id) => loadAssessmentPackage(id, method.attribution))
}

// --------------------------------------------------------------------- 类型文案

export function loadTypes() {
  const path = resolve(CONTENT_DIR, 'types.yml')
  const raw = readYaml(path)
  if (!Array.isArray(raw?.types) || raw.types.length === 0) {
    throw new ContentShapeError(`${path} types 必须是非空数组`)
  }

  const byCode = {}
  for (const entry of raw.types) {
    const code = requireString(entry.code, `${path} types[].code`).toUpperCase()
    if (byCode[code] !== undefined) {
      throw new ContentShapeError(`${path} 类型码重复：${code}`)
    }
    const at = `${path} ${code}`
    const dimensions = entry.dimensions
    if (dimensions === null || typeof dimensions !== 'object') {
      throw new ContentShapeError(`${at} 缺少 dimensions`)
    }
    const normalizedDimensions = {}
    for (const dimension of DIMENSIONS) {
      normalizedDimensions[dimension] = requireString(dimensions[dimension], `${at}.dimensions.${dimension}`)
    }
    byCode[code] = {
      code,
      nameCn: requireString(entry.nameCn, `${at}.nameCn`),
      tagline: requireString(entry.tagline, `${at}.tagline`),
      dimensions: normalizedDimensions,
      strengths: requireStringArray(entry.strengths, `${at}.strengths`),
      blindSpots: requireStringArray(entry.blindSpots, `${at}.blindSpots`),
      resonance: requireStringArray(entry.resonance, `${at}.resonance`),
      growth: requireStringArray(entry.growth, `${at}.growth`),
    }
  }

  const missing = REQUIRED_TYPE_CODES.filter((code) => byCode[code] === undefined)
  if (missing.length > 0) {
    throw new ContentShapeError(`${path} 缺少类型文案：${missing.join(', ')}`)
  }
  const unknown = Object.keys(byCode).filter((code) => !REQUIRED_TYPE_CODES.includes(code))
  if (unknown.length > 0) {
    throw new ContentShapeError(`${path} 出现非法类型码：${unknown.join(', ')}`)
  }

  // 按契约里的固定顺序输出，保证生成的 TS 文件 diff 稳定
  return REQUIRED_TYPE_CODES.map((code) => byCode[code])
}

// --------------------------------------------------------------------- 方法页

export function loadMethod() {
  const path = resolve(CONTENT_DIR, 'method.yml')
  const raw = readYaml(path)
  const where = path

  const attribution = raw.attribution
  if (attribution === null || typeof attribution !== 'object') {
    throw new ContentShapeError(`${where} 缺少 attribution（CC BY 的署名义务，必须有）`)
  }
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    throw new ContentShapeError(`${where} sections 必须是非空数组`)
  }

  return {
    attribution: {
      source: requireString(attribution.source, `${where} attribution.source`),
      author: requireString(attribution.author, `${where} attribution.author`),
      url: requireString(attribution.url, `${where} attribution.url`),
      license: requireString(attribution.license, `${where} attribution.license`),
      licenseUrl: requireString(attribution.licenseUrl, `${where} attribution.licenseUrl`),
    },
    sections: raw.sections.map((section, index) => ({
      title: requireString(section.title, `${where} sections[${index}].title`),
      body: requireString(section.body, `${where} sections[${index}].body`),
    })),
  }
}

// --------------------------------------------------------------------- meta

/**
 * `contentVersion` 是站点级元信息，来源是 application.yml 的 `typeme.content-version`。
 * 早先前端内置副本写死成 `builtin-2026-01`，与后端 `2026-09-01` 不一致（IM-1 的一部分），
 * 现在改成从同一处读取。
 */
export function loadSiteMeta() {
  const text = readFileSync(APPLICATION_YML, 'utf8')
  const appVersion = matchScalar(text, 'app-version')
  const contentVersion = matchScalar(text, 'content-version')
  if (appVersion === null) {
    throw new ContentShapeError(`${APPLICATION_YML} 里找不到 typeme.app-version`)
  }
  if (contentVersion === null) {
    throw new ContentShapeError(`${APPLICATION_YML} 里找不到 typeme.content-version`)
  }
  return { appVersion, contentVersion }
}

function matchScalar(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))
  if (match === null) {
    return null
  }
  return match[1].trim().replace(/^["']|["']$/g, '')
}

/** 一次性读出全部后端内容。 */
export function loadBackendContent() {
  const questionnaire = loadQuestionnaire('quick')
  const types = loadTypes()
  const method = loadMethod()
  const meta = loadSiteMeta()
  return { questionnaire, types, method, meta }
}
