#!/usr/bin/env node
/**
 * 把人工编写的 YAML 内容转成后端运行期读取的规范化 JSON。
 *
 * 用法：node scripts/convert-jung-content.mjs [--check]
 *
 *   docs/2026-09-16/implementation/content/jung48-questions.yml
 *     + content/dimension-copy-zh-v1.yml
 *       → backend/src/main/resources/content/typeme-jung48-zh-v1.json
 *   docs/2026-09-16/implementation/content/type-reports-zh-v1.yml
 *       → backend/src/main/resources/content/typeme-type-report-zh-v1.json
 *   docs/2026-09-16/implementation/content/process-copy-zh-v1.yml
 *       → backend/src/main/resources/content/typeme-process-copy-zh-v1.json
 *
 * 为什么要有这一步，而不是让 Java 直接读 YAML：
 *   1. 运行期不该依赖 YAML 解析器 —— 内容里出现一个没加引号的 `:` 就让全站起不来；
 *   2. JSON 的**规范化**（字段顺序固定、无多余空白）是 `sha256` 内容指纹的前提，
 *      指纹写进 `assessment_package.sha256`，用来证明"报告是按哪份内容生成的"；
 *   3. 校验集中在这里做：YAML 阶段错一行能给出人话，运行期报错只能给堆栈。
 *
 * `--check` 不写文件，只比对现有 JSON 是否与 YAML 一致（CI / prebuild 用），
 * 发现漂移就非零退出 —— 防止"改了 YAML 忘了重新生成"。
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from './lib/yaml.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const CONTENT_DIR = join(root, 'docs/2026-09-16/implementation/content')
const OUT_DIR = join(root, 'backend/src/main/resources/content')

const PACKAGE_PATH = join(OUT_DIR, 'typeme-jung48-zh-v1.json')
const TYPE_REPORT_PATH = join(OUT_DIR, 'typeme-type-report-zh-v1.json')
const PROCESS_COPY_PATH = join(OUT_DIR, 'typeme-process-copy-zh-v1.json')

const PACKAGE_ID = 'typeme-jung48-zh-v1'
const INSTRUMENT_ID = 'typeme-jung48'
const SCORING_VERSION = 'typeme-jung48-score-v1'
const REPORT_CONTENT_VERSION = 'typeme-type-report-zh-v1'
const PROCESS_COPY_VERSION = 'typeme-process-copy-zh-v1'
const CONTENT_STATUS = 'draft_review_pending'

/**
 * 过程层的结构常量。**顺序即权威序**：指纹依赖顺序，调整顺序等于换内容。
 *
 * `PROCESS_ORDER` 不是"按字母排的 8 个代号"，而是"感知两项、判断两项，各自先内后外"：
 * 报告里主导/辅助/两个未偏好过程按**类型自己的结构**排，不按这个表；
 * 这个表只用来校验"八个过程齐不齐"。
 */
const PROCESS_ORDER = ['Si', 'Se', 'Ni', 'Ne', 'Ti', 'Te', 'Fi', 'Fe']
const DECISION_FUNCTIONS = ['S', 'N', 'T', 'F']
const COMPLEMENT_POLES = ['S', 'N', 'T', 'F']
const COMMUNICATION_AXES = ['EI', 'SN', 'TF', 'JP']

/**
 * 过程层额外声明的禁用词。
 *
 * 过程层引用了框架的推导，**比四字母更容易被读成"你就适合干这个"**，
 * 所以"匹配""适配"这类把推导变成判决的说法在这一层尤其不能出现。
 *
 * 注意这五个词同时也进了全局 {@link BANNED_WORDS}：这里保留一份是为了让"这一层最怕什么"
 * 在代码里显式可读（`checkCopy` 的 `extraBanned` 参数也仍然收它）；
 * 真正的拦截靠全局表 —— 报告运行期的 `JungReportBuilder.BANNED_WORDS` 用同一张表，
 * 两边不一致会变成"构建通过、运行期炸掉"。
 */
const PROCESS_EXTRA_BANNED = ['匹配率', '适配度', '适合度', '职业匹配', '恋爱配对']

const DIMENSIONS = ['EI', 'SN', 'TF', 'JP']
const POSITIVE = { EI: 'E', SN: 'N', TF: 'F', JP: 'P' }
const NEGATIVE = { EI: 'I', SN: 'S', TF: 'T', JP: 'J' }
const POLES = { EI: ['I', 'E'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P'] }

const SECTION_KEYS = [
  'dailyLife', 'strengths', 'blindSpots', 'communication',
  'studyWork', 'stress', 'growth', 'neighbors',
]

const SECTION_TITLES = {
  dailyLife: '日常表现',
  strengths: '可能用得顺手的地方',
  blindSpots: '容易卡住的地方',
  communication: '沟通与关系',
  studyWork: '学习与工作方式',
  stress: '压力下的观察',
  growth: '成长行动',
  neighbors: '相邻类型区别',
}

const ALL_TYPE_CODES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
]

/** 文案里不允许出现的词：安全、法务与"别把参考说成结论"三条都靠它兜底。 */
const BANNED_WORDS = [
  '准确率', '概率', '百分位', '置信', '确诊', '命中注定', '科学证明',
  'MBTI 官方', 'MBTI官方', '16Personalities', 'OEJTS',
  // 这五个词进全局表（而不是只进过程层的 PROCESS_EXTRA_BANNED），是因为它们属于
  // "把参考说成结论"这一类，任何一层的文案都不该出现；只在过程层拦会让 16 型文案
  // 躲过这道检查，而报告运行期又会用同一张表把它拦下来 —— 那样的不对称只会
  // 变成"构建通过、线上炸"。两边同一张表，构建期就能给出精确位置。
  '匹配率', '适配度', '适合度', '职业匹配', '恋爱配对',
]

const PLACEHOLDERS = ['TODO', 'XXX', 'FIXME', 'lorem', '待补', '占位']

const problems = []

function fail(message) {
  problems.push(message)
}

function readYaml(relativePath) {
  const path = join(root, relativePath)
  if (!existsSync(path)) {
    throw new Error(`缺少内容源文件：${relativePath}`)
  }
  return parseYaml(readFileSync(path, 'utf8'))
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function checkCopy(label, text, { min = 1, max = Infinity, extraBanned = [] } = {}) {
  if (!isNonEmptyString(text)) {
    fail(`${label}：缺失或为空`)
    return
  }
  const length = text.length
  if (length < min || length > max) {
    fail(`${label}：长度 ${length} 超出 [${min}, ${max}]`)
  }
  for (const word of [...BANNED_WORDS, ...extraBanned]) {
    if (text.includes(word)) fail(`${label}：出现禁用词「${word}」`)
  }
  for (const word of PLACEHOLDERS) {
    if (text.includes(word)) fail(`${label}：出现占位符「${word}」`)
  }
}

/* ── 内容包 ───────────────────────────────────────────────────────────── */

/** 最近一次构建出的"参与指纹计算"的对象，供 `--dump-canonical` 使用。 */
let lastCanonicalPackageSource = null

function buildPackage() {
  const questionsYaml = readYaml('docs/2026-09-16/implementation/content/jung48-questions.yml')
  const copyYaml = readYaml('docs/2026-09-16/implementation/content/dimension-copy-zh-v1.yml')

  const rawQuestions = questionsYaml.questions
  if (!Array.isArray(rawQuestions)) throw new Error('jung48-questions.yml 缺少 questions 列表')

  const questions = []
  const seenIds = new Set()
  const seenOrders = new Set()

  for (const raw of rawQuestions) {
    const label = `题目 ${raw?.id ?? '(无 id)'}`
    if (!isNonEmptyString(raw?.id)) { fail('存在没有 id 的题目'); continue }
    if (seenIds.has(raw.id)) fail(`${label}：id 重复`)
    seenIds.add(raw.id)

    if (!DIMENSIONS.includes(raw.dimension)) { fail(`${label}：维度非法 ${raw.dimension}`); continue }
    if (!['base', 'clarification'].includes(raw.stage)) { fail(`${label}：stage 非法 ${raw.stage}`); continue }
    if (!Number.isInteger(raw.order)) { fail(`${label}：order 必须是整数`); continue }
    if (seenOrders.has(raw.order)) fail(`${label}：order 重复 ${raw.order}`)
    seenOrders.add(raw.order)

    const [negative, positive] = POLES[raw.dimension]
    if (raw.leftPole === raw.rightPole) fail(`${label}：左右极点相同`)
    if (![negative, positive].includes(raw.leftPole) || ![negative, positive].includes(raw.rightPole)) {
      fail(`${label}：极点 ${raw.leftPole}/${raw.rightPole} 不属于维度 ${raw.dimension}`)
    }

    const expectPattern = raw.stage === 'base'
      ? new RegExp(`^${raw.dimension}-(0[1-9]|1[0-2])$`)
      : new RegExp(`^${raw.dimension}-C[1-4]$`)
    if (!expectPattern.test(raw.id)) fail(`${label}：题号不符合规则（${expectPattern}）`)

    checkCopy(`${label} textLeft`, raw.textLeft, { min: 8, max: 24 })
    checkCopy(`${label} textRight`, raw.textRight, { min: 8, max: 24 })
    checkCopy(`${label} scenario`, raw.scenario, { min: 3, max: 20 })
    checkCopy(`${label} help`, raw.help, { min: 25, max: 60 })
    checkCopy(`${label} facet`, raw.facet, { min: 2, max: 20 })
    if (raw.textLeft === raw.textRight) fail(`${label}：两端文字相同`)
    if (raw.reviewStatus !== CONTENT_STATUS) fail(`${label}：reviewStatus 应为 ${CONTENT_STATUS}`)
    if (!isNonEmptyString(raw.provenance)) fail(`${label}：缺少 provenance`)

    questions.push({
      id: raw.id,
      stage: raw.stage,
      dimension: raw.dimension,
      scenario: raw.scenario,
      textLeft: raw.textLeft,
      textRight: raw.textRight,
      leftPole: raw.leftPole,
      rightPole: raw.rightPole,
      help: raw.help,
      facet: raw.facet,
      order: raw.order,
      reviewStatus: raw.reviewStatus,
      provenance: raw.provenance,
    })
  }

  questions.sort((a, b) => a.order - b.order)

  // ── 每个维度的结构性校验：数量、左右平衡、facet 多样性、场景多样性
  const facets = new Map(DIMENSIONS.map((d) => [d, new Set()]))
  const scenarios = new Map(DIMENSIONS.map((d) => [d, new Set()]))
  for (const question of questions) {
    facets.get(question.dimension).add(question.facet)
    scenarios.get(question.dimension).add(question.scenario)
  }

  for (const dimension of DIMENSIONS) {
    const base = questions.filter((q) => q.dimension === dimension && q.stage === 'base')
    const clarification = questions.filter((q) => q.dimension === dimension && q.stage === 'clarification')
    if (base.length !== 12) fail(`${dimension}：主测题数 ${base.length}，应为 12`)
    if (clarification.length !== 4) fail(`${dimension}：补充题数 ${clarification.length}，应为 4`)

    const baseLeftNegative = base.filter((q) => q.leftPole === NEGATIVE[dimension]).length
    const clarLeftNegative = clarification.filter((q) => q.leftPole === NEGATIVE[dimension]).length
    if (baseLeftNegative !== 6) {
      fail(`${dimension}：主测左右不平衡（leftPole 为负极 ${baseLeftNegative} 题，应为 6）—— 会让"一直点左边"产生系统偏差`)
    }
    if (clarLeftNegative !== 2) {
      fail(`${dimension}：补充题左右不平衡（leftPole 为负极 ${clarLeftNegative} 题，应为 2）`)
    }
    if (facets.get(dimension).size < 3) {
      fail(`${dimension}：facet 只有 ${facets.get(dimension).size} 种，应 ≥3（否则 12 题在问同一件事）`)
    }
    if (scenarios.get(dimension).size < 3) {
      fail(`${dimension}：生活场景只有 ${scenarios.get(dimension).size} 种，应 ≥3`)
    }
  }

  if (questions.length !== 64) fail(`题目总数 ${questions.length}，应为 64`)

  // order 必须连续 1..64
  const orders = questions.map((q) => q.order)
  for (let i = 0; i < orders.length; i += 1) {
    if (orders[i] !== i + 1) { fail(`order 不连续：第 ${i + 1} 个是 ${orders[i]}`); break }
  }

  // ── 维度文案
  const rawCopy = copyYaml.dimensions
  if (!Array.isArray(rawCopy) || rawCopy.length !== 4) {
    fail(`dimension-copy-zh-v1.yml 需要恰好 4 个维度，实际 ${Array.isArray(rawCopy) ? rawCopy.length : 0}`)
  }
  const dimensions = []
  for (const dimension of DIMENSIONS) {
    const raw = (rawCopy ?? []).find((entry) => entry.dimension === dimension)
    if (!raw) { fail(`缺少维度文案：${dimension}`); continue }

    const label = `维度文案 ${dimension}`
    checkCopy(`${label} name`, raw.name, { min: 2, max: 12 })
    checkCopy(`${label} question`, raw.question, { min: 5, max: 30 })
    checkCopy(`${label} tiedNotice`, raw.tiedNotice, { min: 10, max: 120 })
    checkCopy(`${label} balanced.summary`, raw.balanced?.summary, { min: 10, max: 200 })
    checkCopy(`${label} balanced.reading`, raw.balanced?.reading, { min: 20, max: 400 })

    const [negative, positive] = POLES[dimension]
    const side = {}
    for (const [key, pole] of [['negativePole', negative], ['positivePole', positive]]) {
      const entry = raw[key]
      if (!entry) { fail(`${label} 缺少 ${key}`); continue }
      if (entry.pole !== pole) fail(`${label} ${key}.pole 应为 ${pole}，实际 ${entry.pole}`)
      checkCopy(`${label} ${key}.label`, entry.label, { min: 2, max: 8 })
      checkCopy(`${label} ${key}.description`, entry.description, { min: 20, max: 400 })
      if (!Array.isArray(entry.dailySigns) || entry.dailySigns.length < 3) {
        fail(`${label} ${key}.dailySigns 至少 3 条`)
      } else {
        entry.dailySigns.forEach((sign, i) => checkCopy(`${label} ${key}.dailySigns[${i}]`, sign, { min: 6, max: 60 }))
      }
      side[key] = {
        pole: entry.pole,
        label: entry.label,
        description: entry.description,
        dailySigns: entry.dailySigns ?? [],
      }
    }

    dimensions.push({
      dimension,
      name: raw.name,
      question: raw.question,
      negativePole: side.negativePole,
      positivePole: side.positivePole,
      balanced: { summary: raw.balanced?.summary, reading: raw.balanced?.reading },
      tiedNotice: raw.tiedNotice,
    })
  }

  const packageId = questionsYaml.packageId ?? PACKAGE_ID

  /*
   * 规范化与指纹：**只对"计分相关"的部分算**。
   *
   * `license` / `attribution` 是给人看的说明，不是内容本身：把它们算进指纹，
   * 会导致"改一句版权说明 → 所有报告的内容指纹变化 → 看起来像题库被改了"。
   * 更要紧的是 `JungPackage` 里根本没有这两个字段，若把它们算进哈希，
   * Java 侧就永远算不出同一个值，指纹校验只能退化成"没人验"。
   *
   * 所以这里的算法与 `JungPackageLoader.canonicalNode` 的字段集合严格一致，
   * 且顺序也一致（JSON.stringify 的插入顺序）。
   */
  const canonicalSource = {
    schemaVersion: 3,
    packageId,
    instrument: {
      id: INSTRUMENT_ID,
      revision: 'v1',
      scoringVersion: SCORING_VERSION,
      reportContentVersion: REPORT_CONTENT_VERSION,
      format: 'bipolar',
      hasTypeCode: true,
      baseItemsPerDimension: 12,
      clarificationItemsPerDimension: 4,
      maxClarificationItems: 16,
    },
    title: questionsYaml.title ?? '十六型人格参考测评',
    contentStatus: questionsYaml.contentStatus ?? CONTENT_STATUS,
    scoringPolicy: {
      version: SCORING_VERSION,
      minBaseRatingsPerDimension: 9,
      boundaryNumerator: 2,
      boundaryDenominator: 10,
      ratingMin: 1,
      ratingMax: 5,
      ratingNeutral: 3,
    },
    dimensions,
    questions,
  }
  const sha256 = sha256Of(canonicalSource)
  lastCanonicalPackageSource = canonicalSource

  return {
    ...canonicalSource,
    license: {
      contentLicense: 'CC BY-NC-SA 4.0',
      codeLicense: 'All rights reserved',
      note: '题目与报告文案为本项目原创，未使用 MBTI 官方、16Personalities 或 OEJTS 任何原题。',
    },
    attribution: {
      instrument: INSTRUMENT_ID,
      framework: 'Jung 四维偏好框架（公开常识描述）',
      contentStatus: questionsYaml.contentStatus ?? CONTENT_STATUS,
      reviewNote: '题目内容为内部初稿，未经真人审读与试测，不作为心理测量学意义上的信效度声明。',
    },
    sha256,
  }
}

/* ── 16 型报告 ────────────────────────────────────────────────────────── */

function buildTypeReports() {
  const yaml = readYaml('docs/2026-09-16/implementation/content/type-reports-zh-v1.yml')
  const rawTypes = yaml.types
  if (!Array.isArray(rawTypes)) throw new Error('type-reports-zh-v1.yml 缺少 types 列表')

  const types = []
  const seenCodes = new Set()

  for (const raw of rawTypes) {
    const label = `类型报告 ${raw?.code ?? '(无 code)'}`
    if (!isNonEmptyString(raw?.code)) { fail('存在没有 code 的类型报告'); continue }
    if (!ALL_TYPE_CODES.includes(raw.code)) { fail(`${label}：不是合法的 16 型类型码`); continue }
    if (seenCodes.has(raw.code)) fail(`${label}：类型码重复`)
    seenCodes.add(raw.code)

    checkCopy(`${label} nameCn`, raw.nameCn, { min: 2, max: 8 })
    checkCopy(`${label} tagline`, raw.tagline, { min: 8, max: 40 })
    checkCopy(`${label} summary`, raw.summary, { min: 100, max: 220 })

    const sections = {}
    let total = 0
    for (const key of SECTION_KEYS) {
      const body = raw.sections?.[key]
      checkCopy(`${label} ${key}`, body, { min: 100, max: 260 })
      if (isNonEmptyString(body)) total += body.length
      sections[key] = body ?? ''
    }
    if (isNonEmptyString(raw.summary)) total += raw.summary.length
    if (total < 1200 || total > 2000) {
      fail(`${label}：正文合计 ${total} 字，超出 [1200, 2000]`)
    }

    const nextActions = Array.isArray(raw.nextActions) ? raw.nextActions : []
    /*
     * 恰好 3 条，与 `JungPackageLoader` 的校验一致，而且是有意的产品约束：
     * 2 条显得敷衍，5 条以上会变成待办清单 —— 用户看完报告要的是"能马上试一下的几件事"，
     * 不是又一份作业。数量固定也便于前端排版。
     */
    if (nextActions.length !== 3) {
      fail(`${label}：nextActions 必须恰好 3 条，实际 ${nextActions.length}`)
    }
    const actions = nextActions.map((action, index) => {
      checkCopy(`${label} nextActions[${index}].title`, action?.title, { min: 4, max: 20 })
      const steps = Array.isArray(action?.steps) ? action.steps : []
      if (steps.length < 2) fail(`${label} nextActions[${index}] 至少 2 步`)
      steps.forEach((step, i) => checkCopy(`${label} nextActions[${index}].steps[${i}]`, step, { min: 6, max: 60 }))
      return { title: action?.title ?? '', steps }
    })

    types.push({
      code: raw.code,
      nameCn: raw.nameCn,
      tagline: raw.tagline,
      summary: raw.summary,
      // 八个章节**扁平**展开在类型对象里，与加载器读 `node.get(key)` 一致
      ...sections,
      nextActions: actions,
    })
  }

  const missing = ALL_TYPE_CODES.filter((code) => !seenCodes.has(code))
  if (missing.length > 0) fail(`缺少类型报告：${missing.join(', ')}`)
  if (types.length !== 16) fail(`类型报告数量 ${types.length}，应为 16`)

  // 跨类型长串重复：16 份内容最容易退化成"一份模板换 16 个名字"
  const seen = new Map()
  for (const type of types) {
    for (const key of SECTION_KEYS) {
      const body = type[key]
      if (typeof body !== 'string') continue
      for (let i = 0; i + 20 <= body.length; i += 5) {
        const chunk = body.slice(i, i + 20)
        const previous = seen.get(chunk)
        if (previous && previous !== type.code) {
          fail(`跨类型重复 20 字：${previous} / ${type.code}：${chunk}`)
        } else if (!previous) {
          seen.set(chunk, type.code)
        }
      }
    }
  }

  // 顺序按类型码字典序，保证规范化输出稳定（与维度序不同，这里是内容文件）
  types.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))

  // 与内容包同理：指纹只对 `types` + 版本字段算，Java 侧可独立复算
  const canonicalSource = {
    schemaVersion: 1,
    reportContentVersion: yaml.reportContentVersion ?? REPORT_CONTENT_VERSION,
    contentStatus: yaml.contentStatus ?? CONTENT_STATUS,
    types,
  }
  const sha256 = sha256Of(canonicalSource)
  return { ...canonicalSource, sectionOrder: SECTION_KEYS, sha256 }
}

/* ── 过程层文案 ───────────────────────────────────────────────────────── */

/**
 * 四个精神活动过程 + 由它派生的建议文案。
 *
 * 这一份**不参与内容包的 sha256**：它是报告的解释层，不是计分内容。
 * 它与内容包、16 型报告一样有自己的版本号与指纹，报告里记的是它自己的那一对
 * （`methodology.processCopyVersion` / `processCopySha256`）——
 * 否则"改了几句建议文案"会看起来像"题库被改了"。
 *
 * 八个过程、四个决策步、四条互补、四条沟通规则都按**固定顺序**处理：
 * 指纹依赖顺序，而顺序来自本文件的权威序列（不是文件里的书写顺序）。
 */
function buildProcessCopy() {
  const yaml = readYaml('docs/2026-09-16/implementation/content/process-copy-zh-v1.yml')
  const version = yaml.processCopyVersion ?? PROCESS_COPY_VERSION
  if (version !== PROCESS_COPY_VERSION) {
    fail(`过程层文案版本必须是 ${PROCESS_COPY_VERSION}，实际 ${version}`)
  }

  const banned = { extraBanned: PROCESS_EXTRA_BANNED }

  const rawProcesses = Array.isArray(yaml.processes) ? yaml.processes : []
  if (rawProcesses.length !== PROCESS_ORDER.length) {
    fail(`过程层需要恰好 ${PROCESS_ORDER.length} 个过程，实际 ${rawProcesses.length}`)
  }
  const processes = PROCESS_ORDER.map((token) => {
    const raw = rawProcesses.find((entry) => entry?.process === token)
    const label = `过程 ${token}`
    if (!raw) { fail(`${label}：缺失`); return { process: token, what: '', asDominant: '', whenUnpreferred: '' } }
    checkCopy(`${label} what`, raw.what, { min: 20, max: 140, ...banned })
    checkCopy(`${label} asDominant`, raw.asDominant, { min: 20, max: 140, ...banned })
    checkCopy(`${label} whenUnpreferred`, raw.whenUnpreferred, { min: 20, max: 160, ...banned })
    return {
      process: token,
      what: raw.what ?? '',
      asDominant: raw.asDominant ?? '',
      whenUnpreferred: raw.whenUnpreferred ?? '',
    }
  })
  const unknownProcesses = rawProcesses
    .map((entry) => entry?.process)
    .filter((token) => !PROCESS_ORDER.includes(token))
  if (unknownProcesses.length > 0) {
    fail(`存在无法识别的过程代号：${unknownProcesses.join(', ')}`)
  }

  const rawSteps = Array.isArray(yaml.decisionSteps) ? yaml.decisionSteps : []
  if (rawSteps.length !== DECISION_FUNCTIONS.length) {
    fail(`四步决策法需要恰好 ${DECISION_FUNCTIONS.length} 步，实际 ${rawSteps.length}`)
  }
  const decisionSteps = DECISION_FUNCTIONS.map((fn) => {
    const raw = rawSteps.find((entry) => entry?.function === fn)
    const label = `决策步 ${fn}`
    if (!raw) { fail(`${label}：缺失`); return { function: fn, title: '', prompt: '', whenUnpreferred: '' } }
    checkCopy(`${label} title`, raw.title, { min: 4, max: 24, ...banned })
    checkCopy(`${label} prompt`, raw.prompt, { min: 10, max: 80, ...banned })
    checkCopy(`${label} whenUnpreferred`, raw.whenUnpreferred, { min: 20, max: 200, ...banned })
    return {
      function: fn,
      title: raw.title ?? '',
      prompt: raw.prompt ?? '',
      whenUnpreferred: raw.whenUnpreferred ?? '',
    }
  })

  const rawComplements = Array.isArray(yaml.complements) ? yaml.complements : []
  if (rawComplements.length !== COMPLEMENT_POLES.length) {
    fail(`互补清单需要恰好 ${COMPLEMENT_POLES.length} 条，实际 ${rawComplements.length}`)
  }
  const complements = COMPLEMENT_POLES.map((pole) => {
    const raw = rawComplements.find((entry) => entry?.pole === pole)
    const label = `互补 ${pole}`
    if (!raw) { fail(`${label}：缺失`); return { pole, offers: '' } }
    checkCopy(`${label} offers`, raw.offers, { min: 15, max: 140, ...banned })
    return { pole, offers: raw.offers ?? '' }
  })

  const rawRules = Array.isArray(yaml.communicationRules) ? yaml.communicationRules : []
  if (rawRules.length !== COMMUNICATION_AXES.length) {
    fail(`沟通规则需要恰好 ${COMMUNICATION_AXES.length} 条，实际 ${rawRules.length}`)
  }
  const communicationRules = COMMUNICATION_AXES.map((axis) => {
    const raw = rawRules.find((entry) => entry?.axis === axis)
    const label = `沟通规则 ${axis}`
    if (!raw) { fail(`${label}：缺失`); return { axis, negative: '', positive: '' } }
    checkCopy(`${label} negative`, raw.negative, { min: 20, max: 220, ...banned })
    checkCopy(`${label} positive`, raw.positive, { min: 20, max: 220, ...banned })
    return { axis, negative: raw.negative ?? '', positive: raw.positive ?? '' }
  })

  checkCopy('决策法导语 decisionIntro', yaml.decisionIntro, { min: 20, max: 300, ...banned })
  checkCopy('决策法说明 decisionNote', yaml.decisionNote, { min: 20, max: 300, ...banned })

  const notes = {
    frameworkCaveat: yaml.notes?.frameworkCaveat,
    developmentNote: yaml.notes?.developmentNote,
    greyAreaNote: yaml.notes?.greyAreaNote,
  }
  checkCopy('说明 frameworkCaveat', notes.frameworkCaveat, { min: 20, max: 420, ...banned })
  checkCopy('说明 developmentNote', notes.developmentNote, { min: 20, max: 420, ...banned })
  checkCopy('说明 greyAreaNote', notes.greyAreaNote, { min: 20, max: 420, ...banned })

  const canonicalSource = {
    schemaVersion: 1,
    processCopyVersion: version,
    contentStatus: yaml.contentStatus ?? CONTENT_STATUS,
    processes,
    decisionSteps,
    decisionIntro: yaml.decisionIntro ?? '',
    decisionNote: yaml.decisionNote ?? '',
    complements,
    communicationRules,
    notes,
  }
  const sha256 = sha256Of(canonicalSource)
  return {
    ...canonicalSource,
    license: {
      contentLicense: 'CC BY-NC-SA 4.0',
      note: yaml.license?.note
        ?? '按《天资差异》所述方法重写的中文说明，非原书摘录。',
    },
    sha256,
  }
}

/**
 * 规范化 JSON 与指纹。
 *
 * 规范形 = **插入顺序** + 紧凑分隔符（无空格），与 Java 侧
 * `JungPackageLoader.canonicalNode` 构造 `ObjectNode` 的顺序逐字段对应。
 *
 * 两个容易踩的坑，这里都刻意避开了：
 *   1. **不要按字母序排键**。曾经这里用递归 key 排序，结果 Java（按代码里写死的字段顺序）
 *      与 Node（按字母序）对同一份内容算出两个不同的哈希。字段顺序必须由**同一份约定**
 *      决定，而那份约定就是两侧代码里字段的书写顺序 —— 排字母序等于把"约定"换成
 *      "恰好也排对了"，一旦有人重命名字段就会再次分叉。
 *   2. **不要用 `JSON.stringify(obj, null, 2)`**。缩进与换行会进哈希，改一次排版就全变。
 */
function canonicalJson(value) {
  return JSON.stringify(value)
}

function sha256Of(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */

let packageJson
let typeReportJson
let processCopyJson
try {
  packageJson = `${JSON.stringify(buildPackage(), null, 2)}\n`
  typeReportJson = `${JSON.stringify(buildTypeReports(), null, 2)}\n`
  processCopyJson = `${JSON.stringify(buildProcessCopy(), null, 2)}\n`
} catch (error) {
  console.error(error?.stack ?? String(error))
  process.exit(1)
}

if (problems.length > 0) {
  console.error(`内容校验未通过（${problems.length} 项）：`)
  for (const problem of problems.slice(0, 60)) console.error(` - ${problem}`)
  if (problems.length > 60) console.error(` …还有 ${problems.length - 60} 项`)
  process.exit(1)
}

const targets = [
  [PACKAGE_PATH, packageJson],
  [TYPE_REPORT_PATH, typeReportJson],
  [PROCESS_COPY_PATH, processCopyJson],
]

/*
 * `--dump-canonical <path>`：导出"参与指纹计算的那部分内容"的规范形。
 *
 * 用途只有一个：Java 与 Node 的 sha256 对不上时，两边必须能各导一份纯文本，逐字节 diff。
 * 否则只能看到"两个 64 位十六进制串不同"，无法判断是字段集合、顺序还是编码的差异 ——
 * 那种情况下最省事的做法（改掉一方的算法去迁就）恰好是最危险的。
 */
const dumpIndex = process.argv.indexOf('--dump-canonical')
if (dumpIndex >= 0) {
  const target = process.argv[dumpIndex + 1]
  if (!target) {
    console.error('--dump-canonical 需要跟一个输出路径')
    process.exit(1)
  }
  const dump = canonicalJson(lastCanonicalPackageSource)
  mkdirSync(dirname(resolve(root, target)), { recursive: true })
  writeFileSync(resolve(root, target), dump, 'utf8')
  console.log(`已导出规范形（${Buffer.byteLength(dump, 'utf8')} 字节）：${target}`)
  process.exit(0)
}

if (process.argv.includes('--check')) {
  let drift = false
  for (const [path, payload] of targets) {
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null
    if (current !== payload) {
      console.error(`内容包已漂移：${path.replace(root, '.')}`)
      drift = true
    }
  }
  if (drift) {
    console.error('请运行 node scripts/convert-jung-content.mjs 重新生成。')
    process.exit(1)
  }
  console.log('内容包与 YAML 一致。')
  process.exit(0)
}

for (const [path, payload] of targets) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, payload, 'utf8')
  console.log(`已写入 ${path.replace(root + '\\', '').replace(root + '/', '')}`)
}

console.log('')
console.log(`packageId              ${PACKAGE_ID}`)
console.log(`内容包 sha256          ${JSON.parse(packageJson).sha256}`)
console.log(`类型报告 sha256        ${JSON.parse(typeReportJson).sha256}`)
console.log(`过程层文案 sha256      ${JSON.parse(processCopyJson).sha256}`)
console.log(`题目 64 题（主测 48 / 补充 16），16 型报告齐备，过程层 8 过程 + 4 决策步 + 4 互补 + 4 沟通规则。`)
