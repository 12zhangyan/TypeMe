import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
  FALLBACK_METHOD,
  FALLBACK_META,
  FALLBACK_QUESTIONNAIRE,
  getFallbackTypeProfile,
} from './fallback'
import { TYPE_CODES } from './typeProfiles'
import { buildDimensionScales, extremeScore, scoreQuestionnaire } from '@/domain/scoring'
import type { Dimension } from '@/domain/types'
import {
  CONTENT_STATUSES,
  FORBIDDEN_HELP_FRAGMENTS,
  INSTRUMENT_PROFILES,
  REPORT_COPY_FIELDS,
  RISK_CODES,
  assessmentPackageProblems,
  instrumentHasTypeCode,
  instrumentProfileOf,
  packageDimensionOrder,
  packageFormat,
  poleTokensOf,
} from '@/domain/assessmentPackage'

/**
 * 内置副本的内容校验 —— 这一份是**站点在后端挂掉时真正跑的内容**，
 * 所以它必须和后端 YAML 一样被硬校验。
 *
 * 这里钉死的是 `docs/任务拆解.md` §1.1 的常量表与符号表，以及陷阱 1（左右端顺序）：
 * 只要有人改中文题干时把左右写反、或改错一个符号，这里就会红。
 * 逐题左右顺序对照 `research/_sources/OEJTS1.2.txt` 官方 PDF 原文。
 *
 * ⚠️ v2 内容包部分（文件下半段）不再假设"一定是 OEJTS 四维 32 题双极量表"：
 * 所有形状断言都按**每个包自己的仪器档案**参数化，OEJTS 与 IPIP 各跑一套。
 * 双极专属的检查（左右两端不同、textLeft/textRight）只对 `bipolar` 包跑，
 * `agreement` 包改为检查单句 `text` 非空且唯一、且没有双极字段。
 */

const EXPECTED_SIGNS: Record<Dimension, Record<number, 1 | -1>> = {
  EI: { 3: -1, 7: -1, 11: -1, 15: 1, 19: -1, 23: 1, 27: 1, 31: -1 },
  SN: { 4: 1, 8: 1, 12: 1, 16: 1, 20: 1, 24: -1, 28: -1, 32: 1 },
  TF: { 2: -1, 6: 1, 10: 1, 14: -1, 18: -1, 22: 1, 26: -1, 30: -1 },
  JP: { 1: 1, 5: 1, 9: -1, 13: 1, 17: -1, 21: 1, 25: -1, 29: 1 },
}

/**
 * 左右端关键词表 —— 用来反查 textLeft / textRight 有没有写反（陷阱 1）。
 *
 * ⚠️ 关键词取自**官方英文原句的语义**（OEJTS 1.2 第 2 页逐题核对），不是从中文题库里抄回来的，
 * 所以它能独立发现"左右写反"这一缺陷。**左右两端都校验**，避免只查单边带来的盲区。
 */
const LEFT_KEYWORDS: Record<number, string> = {
  1: '清单', // makes lists
  2: '怀疑', // sceptical
  3: '独处', // bored by time alone
  4: '接受', // accepts things as they are
  5: '整洁', // keeps a clean room
  6: '贬义', // thinks "robotic" is an insult
  7: '精力', // energetic
  8: '选择题', // prefer to take multiple choice test
  9: '乱', // chaotic
  10: '伤', // easily hurt
  11: '群体', // works best in groups
  12: '当下', // focused on the present
  13: '很早', // plans far ahead
  14: '敬重', // wants people's respect
  15: '疲惫', // gets worn out by parties
  16: '融入', // fits in
  17: '保留', // keeps options open
  18: '修理', // wants to be good at fixing things
  19: '说得更多', // talks more
  20: '发生了什么', // will tell people what happened
  21: '立刻', // gets work done right away
  22: '内心', // follows the heart
  23: '待在家里', // stays at home
  24: '整体', // wants the big picture
  25: '临场发挥', // improvises
  26: '公正', // bases morality on justice
  27: '很难大声喊', // finds it difficult to yell very loudly
  28: '理论', // theoretical
  29: '工作起来很拼', // works hard
  30: '不太自在', // uncomfortable with emotions
  31: '在人前表现', // likes to perform in front of other people
  32: '谁、什么、什么时候', // likes to know "who?", "what?", "when?"
}

/** 官方 PDF 里每题「圈 5 端」的关键词。 */
const RIGHT_KEYWORDS: Record<number, string> = {
  1: '凭记忆', // relies on memory
  2: '先相信', // wants to believe
  3: '需要独处', // needs time alone
  4: '不满足', // unsatisfied with the ways things are
  5: '随手放', // just puts stuff where ever
  6: '精确', // strives to have a mechanical mind
  7: '平和沉静', // mellow
  8: '论述题', // prefer essay answers
  9: '有条理', // organized
  10: '不太往心里去', // thick-skinned
  11: '独处时状态最好', // works best alone
  12: '关注未来', // focused on the future
  13: '事到临头', // plans at the last minute
  14: '喜爱', // wants their love
  15: '兴奋', // gets fired up by parties
  16: '与众不同', // stands out
  17: '确定下来', // commits
  18: '帮人解决问题', // wants to be good at fixing people
  19: '听得更多', // listens more
  20: '意味着什么', // will tell people what it meant
  21: '拖到最后', // procrastinates
  22: '理智', // follows the head
  23: '出门', // goes out on the town
  24: '细节', // wants the details
  25: '事先准备', // prepares
  26: '同情心', // bases morality on compassion
  27: '隔着老远喊人', // yelling to others when they are far away comes naturally
  28: '实证', // empirical
  29: '玩起来很拼', // plays hard
  30: '很看重情绪', // values emotions
  31: '避免', // avoids public speaking
  32: '为什么', // likes to know "why?"
}

describe('内置题库（fallback）结构与契约', () => {
  it('32 题、每维 8 题、id 是 1..32 且唯一', () => {
    const { questions } = FALLBACK_QUESTIONNAIRE
    expect(questions).toHaveLength(32)
    expect(FALLBACK_QUESTIONNAIRE.questionCount).toBe(32)
    expect(new Set(questions.map((q) => q.id)).size).toBe(32)
    expect(questions.map((q) => q.id).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 1),
    )
    for (const dimension of ['EI', 'SN', 'TF', 'JP'] as Dimension[]) {
      expect(questions.filter((q) => q.dimension === dimension)).toHaveLength(8)
    }
  })

  it('常量与中点照 §1.1：EI 30 / SN 12 / TF 30 / JP 18，midpoint 24', () => {
    expect(FALLBACK_QUESTIONNAIRE.scoring.constants).toEqual({
      EI: 30,
      SN: 12,
      TF: 30,
      JP: 18,
    })
    expect(FALLBACK_QUESTIONNAIRE.scoring.midpoint).toBe(24)
  })

  it('逐题维度与符号与 §1.1 常量表完全一致（硬断言）', () => {
    for (const [dimension, table] of Object.entries(EXPECTED_SIGNS) as [
      Dimension,
      Record<number, 1 | -1>,
    ][]) {
      const actual: Record<number, 1 | -1> = {}
      for (const question of FALLBACK_QUESTIONNAIRE.questions) {
        if (question.dimension === dimension) actual[question.id] = question.direction
      }
      expect(actual).toEqual(table)
    }
    // 反向确认：任何一道题都不属于表外维度
    const total = Object.values(EXPECTED_SIGNS).reduce(
      (sum, table) => sum + Object.keys(table).length,
      0,
    )
    expect(total).toBe(32)
  })

  it('左右端顺序没有写反（陷阱 1：textLeft 是官方"圈 1"端、textRight 是"圈 5"端）', () => {
    for (const question of FALLBACK_QUESTIONNAIRE.questions) {
      const left = LEFT_KEYWORDS[question.id]
      const right = RIGHT_KEYWORDS[question.id]
      expect(left, `题目 #${question.id} 缺少左端关键词`).toBeTruthy()
      expect(right, `题目 #${question.id} 缺少右端关键词`).toBeTruthy()
      // OEJTS 题库是双极格式：两端都必须真的存在（`Question` 类型现在两种格式共用）
      expect(typeof question.textLeft, `#${question.id} 必须有 textLeft`).toBe('string')
      expect(typeof question.textRight, `#${question.id} 必须有 textRight`).toBe('string')
      const leftText = question.textLeft ?? ''
      const rightText = question.textRight ?? ''
      expect(leftText, `#${question.id} textLeft 与官方左端不符`).toContain(left)
      expect(rightText, `#${question.id} textRight 与官方右端不符`).toContain(right)
      expect(rightText).not.toBe(leftText)
      expect(leftText.length).toBeGreaterThan(0)
      expect(rightText.length).toBeGreaterThan(0)
    }
  })

  it('题干不含占位符/繁体残留/TODO', () => {
    for (const question of FALLBACK_QUESTIONNAIRE.questions) {
      for (const text of [question.textLeft ?? '', question.textRight ?? '']) {
        expect(text).not.toMatch(/TODO|XXX|占位|待译|待定|\?\?\?/)
        expect(text.trim()).toBe(text)
      }
      // 中文题干必须真的有中文
      expect(question.textLeft).toMatch(/[\u4e00-\u9fa5]/)
      expect(question.textRight).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('两端语义对等、不出现明显的褒贬配对（需求文档 §3.5）', () => {
    // 只做低成本的机械检查：两端不能出现"很好/很差""聪明/愚蠢"这类评价性对立词
    const JUDGEMENTAL = ['邋遢', '懒惰', '蠢', '很差', '糟糕', '优秀', '完美']
    for (const question of FALLBACK_QUESTIONNAIRE.questions) {
      for (const word of JUDGEMENTAL) {
        expect(question.textLeft).not.toContain(word)
        expect(question.textRight).not.toContain(word)
      }
    }
  })

  it('这份题库能直接喂给 scoreQuestionnaire，且极值正好是 8 / 40', () => {
    const scales = buildDimensionScales(FALLBACK_QUESTIONNAIRE)
    for (const dimension of ['EI', 'SN', 'TF', 'JP'] as Dimension[]) {
      expect(extremeScore(scales[dimension], 'left')).toBe(8)
      expect(extremeScore(scales[dimension], 'right')).toBe(40)
    }
    const answers = Object.fromEntries(FALLBACK_QUESTIONNAIRE.questions.map((q) => [q.id, 3]))
    const result = scoreQuestionnaire(answers, FALLBACK_QUESTIONNAIRE)
    expect(result.typeCode).toBe('ISFJ')
    for (const item of result.dimensions) expect(item.score).toBe(24)
  })
})

describe('内置类型文案（16 条）', () => {
  it('16 个类型码齐全，且每条的 code 字段与键一致', () => {
    expect(TYPE_CODES).toHaveLength(16)
    for (const code of TYPE_CODES) {
      const profile = getFallbackTypeProfile(code)
      expect(profile, `${code} 缺少文案`).toBeTruthy()
      expect(profile?.code).toBe(code)
    }
  })

  it('字段齐全：中文名、tagline、四维解读、优势/盲区/共鸣/成长', () => {
    for (const code of TYPE_CODES) {
      const profile = getFallbackTypeProfile(code)!
      expect(profile.nameCn.length).toBeGreaterThan(1)
      expect(profile.tagline.length).toBeGreaterThan(8)
      for (const dimension of ['EI', 'SN', 'TF', 'JP'] as Dimension[]) {
        expect(profile.dimensions[dimension]?.length ?? 0).toBeGreaterThan(10)
      }
      expect(profile.strengths.length).toBeGreaterThanOrEqual(3)
      expect(profile.blindSpots.length).toBeGreaterThanOrEqual(3)
      expect(profile.resonance.length).toBeGreaterThanOrEqual(3)
      expect(profile.growth.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('小写/大写都能查到（接口按 code 查询时不要因为大小写失败）', () => {
    expect(getFallbackTypeProfile('infp')?.code).toBe('INFP')
    expect(getFallbackTypeProfile('INTJ')?.code).toBe('INTJ')
    expect(getFallbackTypeProfile('XXXX')).toBeUndefined()
  })

  it('文案红线检查：没有"最准/官方/权威/诊断"、"你就是…的人"、"注定"，也没有人群百分位', () => {
    const BANNED = ['最准', '官方', '权威', '诊断', '注定', '天生', '百分位', '人群占比', '准确率', '科学证明']
    for (const code of TYPE_CODES) {
      const profile = getFallbackTypeProfile(code)!
      const texts = [
        profile.nameCn,
        profile.tagline,
        ...Object.values(profile.dimensions),
        ...profile.strengths,
        ...profile.blindSpots,
        ...profile.resonance,
        ...profile.growth,
      ]
      for (const text of texts) {
        for (const word of BANNED) {
          expect(text, `${code} 的文案出现了红线词「${word}」：${text}`).not.toContain(word)
        }
        expect(text).not.toMatch(/你就是.{0,12}的人/)
      }
    }
  })
})

describe('内置 meta 与 method', () => {
  it('meta 带 attribution（CC BY 的署名义务），且许可写明 NC', () => {
    expect(FALLBACK_META.attribution.author).toContain('Jorgenson')
    expect(FALLBACK_META.attribution.license).toBe('CC BY-NC-SA 4.0')
    expect(FALLBACK_META.attribution.licenseUrl).toContain('creativecommons.org')
    expect(FALLBACK_META.questionnaireVersions).toContain('quick')
  })

  it('method 覆盖四个必备章节：来源与许可 / 计分 / S–N / 免责', () => {
    const titles = FALLBACK_METHOD.sections.map((section) => section.title).join('|')
    expect(titles).toContain('题库来源与许可')
    expect(titles).toContain('计分方法')
    expect(titles).toContain('S–N')
    expect(titles).toContain('免责声明')
    for (const section of FALLBACK_METHOD.sections) {
      expect(section.body.length).toBeGreaterThan(40)
    }
  })

  it('方法说明里包含"人格是连续的，类型是人为的切分"与"不给百分位"的说明', () => {
    const body = FALLBACK_METHOD.sections.map((section) => section.body).join('')
    expect(body).toContain('人格是连续的，类型是人为的切分')
    expect(body).toContain('常模')
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * v2 内容包（题面 + 逐题帮助 + 维度解释 + 报告文案 + 解释政策）也要被当成**内容**再校验一遍。
 *
 * 与 v1 内置题库同理：接口不可用时站点跑的就是这一份，所以它必须自己通过完整契约
 * 校验（`assessmentPackageProblems`），并且遵守与 16 型文案同一套内容红线。
 *
 * 本轮（IPIP 大五接入）：这一段的形状断言全部按 `INSTRUMENT_PROFILES` 参数化 ——
 * 题数、每维题数、维度集合、两端记号、作答格式都从该包自己的仪器档案取，
 * OEJTS 与 IPIP 各跑一套，不再出现"32""EI""DIMENSION_ORDER"这类写死假设。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 内置内容包（按注册表顺序），沿用 `fallback.ts` 的 packageId。 */
type V2Package = (typeof FALLBACK_ASSESSMENT_PACKAGES)[string]
type V2RiskCode = V2Package['itemHelp'][string]['riskCodes'][number]

const V2_PACKAGES: ReadonlyArray<readonly [string, V2Package]> = ASSESSMENT_PACKAGE_IDS.map(
  (packageId) => [packageId, FALLBACK_ASSESSMENT_PACKAGES[packageId]] as const,
)

/** 帮助与维度文案里不得出现的断言式表述（产品方案 §5.2）。 */
const ASSERTIVE_WORDS = ['你天生', '你一定', '你总是'] as const

/** 与 16 型文案同一套红线词（「诊断」单列：只允许出现在否定式边界说明里）。 */
const PACKAGE_RED_LINE_WORDS = ['最准', '官方', '权威', '注定', '你就是'] as const

/** 深拷贝一份内容包：只在测试内部把副本改坏，用来验证守卫真的会判红。 */
function clonePackage(pkg: V2Package): V2Package {
  return JSON.parse(JSON.stringify(pkg)) as V2Package
}

/** 该包题库里的全部题号（升序字符串）—— itemHelp 的合法键集合与覆盖条数都由它决定。 */
function itemHelpKeysOf(pkg: V2Package): string[] {
  return pkg.questionnaire.questions
    .map((question) => String(question.id))
    .sort((a, b) => Number(a) - Number(b))
}

/** 该包题库里出现的维度（按题目首次出现顺序）。 */
function questionDimensionsOf(pkg: V2Package): string[] {
  const seen: string[] = []
  for (const question of pkg.questionnaire.questions) {
    if (!seen.includes(question.dimension)) seen.push(question.dimension)
  }
  return seen
}

/** 包内 itemHelp 证据状态里最低的那一个（draft < reviewed < field_checked）。 */
function lowestEvidenceStatus(pkg: V2Package): string {
  const rank = (status: string): number => (CONTENT_STATUSES as readonly string[]).indexOf(status)
  const statuses = Object.values(pkg.itemHelp).map((entry) => entry.reviewStatus)
  return statuses.reduce((lowest, status) => (rank(status) < rank(lowest) ? status : lowest), statuses[0])
}

/**
 * 由题库自己的数据（scoring.constants + 逐题 direction）手工累加每维区间与"每题都选 3"的原始分。
 * 刻意不调用计分引擎：那会变成"拿被测代码验算它自己"。
 */
function manualRangeOf(
  pkg: V2Package,
  dimension: string,
): { min: number; max: number; neutral: number } {
  const constant = pkg.questionnaire.scoring.constants[dimension]
  let min = constant
  let max = constant
  let neutral = constant
  for (const question of pkg.questionnaire.questions) {
    if (question.dimension !== dimension) continue
    min += Math.min(question.direction * 1, question.direction * 5)
    max += Math.max(question.direction * 1, question.direction * 5)
    neutral += question.direction * 3
  }
  return { min, max, neutral }
}

interface VisibleText {
  label: string
  text: string
}

/** 包里所有**用户可见**的文字（帮助 + 维度解释 + 报告文案 + 建议），带可读定位。 */
function userVisibleTexts(pkg: V2Package): VisibleText[] {
  const entries: VisibleText[] = []
  const push = (label: string, text: string): void => {
    if (text.trim().length > 0) entries.push({ label, text })
  }
  for (const key of Object.keys(pkg.itemHelp).sort((a, b) => Number(a) - Number(b))) {
    push(`itemHelp["${key}"].explanation`, pkg.itemHelp[key].explanation)
  }
  // ⚠️ 必须遍历**该包声明/档案里的每一个维度**（OEJTS 是 EI/SN/TF/JP，IPIP 是 E/A/C/ES/O），
  //    不能只查 `dimensionCopy.EI` —— 那会让第二份量表的文案完全逃过红线检查。
  for (const [dimension, copy] of Object.entries(pkg.dimensionCopy)) {
    push(`${dimension}.name`, copy.name)
    push(`${dimension}.negative.label`, copy.negative.label)
    push(`${dimension}.negative.description`, copy.negative.description)
    push(`${dimension}.negative.observation`, copy.negative.observation)
    push(`${dimension}.negative.action`, copy.negative.action)
    push(`${dimension}.positive.label`, copy.positive.label)
    push(`${dimension}.positive.description`, copy.positive.description)
    push(`${dimension}.positive.observation`, copy.positive.observation)
    push(`${dimension}.positive.action`, copy.positive.action)
    push(`${dimension}.balanced.summary`, copy.balanced.summary)
    push(`${dimension}.balanced.observation`, copy.balanced.observation)
    push(`${dimension}.insufficient.summary`, copy.insufficient.summary)
    push(`${dimension}.insufficient.nextStep`, copy.insufficient.nextStep)
  }
  for (const field of REPORT_COPY_FIELDS) push(`reportCopy.${field}`, pkg.reportCopy[field])
  pkg.nextSteps.forEach((text, index) => push(`nextSteps[${index}]`, text))
  return entries
}

/** 没写明「它不等于什么」的维度侧（返回 `EI.negative` 这类定位，遍历该包的每一个维度）。 */
function sidesWithoutNotEquals(pkg: V2Package): string[] {
  const missing: string[] = []
  for (const [dimension, copy] of Object.entries(pkg.dimensionCopy)) {
    if (!copy.negative.description.includes('不等于')) missing.push(`${dimension}.negative`)
    if (!copy.positive.description.includes('不等于')) missing.push(`${dimension}.positive`)
  }
  return missing
}

/** 帮助为空、过短或首尾带空白的题号。 */
function emptyHelpKeys(pkg: V2Package): string[] {
  return Object.keys(pkg.itemHelp)
    .sort((a, b) => Number(a) - Number(b))
    .filter((key) => {
      const explanation = pkg.itemHelp[key].explanation
      return explanation.trim().length <= 20 || explanation.trim() !== explanation
    })
}

/** 帮助里含开发者批注的题号。 */
function helpKeysWithForbiddenFragments(pkg: V2Package): string[] {
  return Object.keys(pkg.itemHelp)
    .sort((a, b) => Number(a) - Number(b))
    .filter((key) =>
      FORBIDDEN_HELP_FRAGMENTS.some((fragment) => pkg.itemHelp[key].explanation.includes(fragment)),
    )
}

/** 命中断言式表述的文案定位。 */
function assertiveHits(pkg: V2Package): string[] {
  const hits: string[] = []
  for (const { label, text } of userVisibleTexts(pkg)) {
    for (const word of ASSERTIVE_WORDS) {
      if (text.includes(word)) hits.push(`${label}:${word}`)
    }
  }
  return hits
}

/** 非法或重复的风险码定位。 */
function invalidRiskCodeHits(pkg: V2Package): string[] {
  const hits: string[] = []
  for (const key of Object.keys(pkg.itemHelp).sort((a, b) => Number(a) - Number(b))) {
    const codes = pkg.itemHelp[key].riskCodes
    for (const code of codes) {
      if (!(RISK_CODES as readonly string[]).includes(code)) hits.push(`${key}:${code}`)
    }
    if (new Set(codes).size !== codes.length) hits.push(`${key}:duplicate`)
  }
  return hits
}

/** 把「诊断」当结论用的文案定位（否定式边界说明不算）。 */
function diagnosisAsConclusion(pkg: V2Package): string[] {
  const hits: string[] = []
  for (const { label, text } of userVisibleTexts(pkg)) {
    if (!text.includes('诊断')) continue
    const stripped = text.split('不是心理诊断').join('').split('诊断证据').join('')
    if (stripped.includes('诊断')) hits.push(label)
  }
  return hits
}

describe('内置 v2 内容包（接口不可用时的唯一内容来源）', () => {
  it('注册表里的每个包都在副本里，且默认包是注册表第一项', () => {
    expect(ASSESSMENT_PACKAGE_IDS.length).toBeGreaterThan(0)
    expect(DEFAULT_PACKAGE_ID).toBe(ASSESSMENT_PACKAGE_IDS[0])
    expect(Object.keys(FALLBACK_ASSESSMENT_PACKAGES).sort()).toEqual([...ASSESSMENT_PACKAGE_IDS].sort())
    for (const packageId of ASSESSMENT_PACKAGE_IDS) {
      expect(FALLBACK_ASSESSMENT_PACKAGES[packageId], `${packageId} 缺少内置副本`).toBeDefined()
    }
  })

  it('每个包都通过完整契约校验（assessmentPackageProblems 返回空数组）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      expect(pkg.packageId, `${packageId} 的 packageId 必须等于键`).toBe(packageId)
      // 内置副本本身必须合法：缺帮助、缺维度、符号错、状态升格都在这里拦住
      expect(assessmentPackageProblems(pkg), `${packageId} 未通过内容包契约校验`).toEqual([])
    }
  })

  it('逐题帮助：条数等于该包题数、每条 explanation 非空且不含开发者批注', () => {
    expect(FORBIDDEN_HELP_FRAGMENTS.length, '批注碎片表不能被清空').toBeGreaterThan(0)
    for (const [packageId, pkg] of V2_PACKAGES) {
      const expectedKeys = itemHelpKeysOf(pkg)
      // 条数 = 该包题数（OEJTS 32 / IPIP 50），键集合 = 该包题库的全部题号
      expect(expectedKeys, `${packageId} 题号条数`).toHaveLength(pkg.questionnaire.questionCount)
      expect(new Set(expectedKeys).size, `${packageId} 题号必须唯一`).toBe(expectedKeys.length)
      expect(
        Object.keys(pkg.itemHelp).sort((a, b) => Number(a) - Number(b)),
        `${packageId}.itemHelp 必须恰好覆盖该包题库的全部题号`,
      ).toEqual(expectedKeys)
      for (const key of expectedKeys) {
        expect(pkg.itemHelp[key], `${packageId}.itemHelp["${key}"] 缺失`).toBeDefined()
      }
      expect(emptyHelpKeys(pkg), `${packageId} 有空/过短的帮助`).toEqual([])
      expect(
        helpKeysWithForbiddenFragments(pkg),
        `${packageId} 的帮助含开发者批注`,
      ).toEqual([])
    }
  })

  it('每个包每条维度文案的键恰好等于该包题库的维度集合', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const dimensions = questionDimensionsOf(pkg)
      expect(Object.keys(pkg.dimensionCopy).sort(), `${packageId}.dimensionCopy 键集合`).toEqual(
        [...dimensions].sort(),
      )
      expect(dimensions.length, `${packageId} 维度个数`).toBe(
        instrumentProfileOf(pkg)?.dimensionOrder.length,
      )
    }
  })

  it('每个包每维的两侧 description 都写明「它不等于什么」', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      expect(
        sidesWithoutNotEquals(pkg),
        `${packageId} 有维度侧没有写明「它不等于什么」`,
      ).toEqual([])
    }
  })

  it('riskCodes 只含 L / B / C，且同一条里不重复', () => {
    expect([...RISK_CODES]).toEqual(['L', 'B', 'C'])
    for (const [packageId, pkg] of V2_PACKAGES) {
      for (const key of Object.keys(pkg.itemHelp)) {
        expect(Array.isArray(pkg.itemHelp[key].riskCodes), `${packageId} Q${key}.riskCodes`).toBe(true)
      }
      expect(invalidRiskCodeHits(pkg), `${packageId} 出现了非法/重复风险码`).toEqual([])
    }
  })

  it('内容红线：帮助、维度解释与报告文案里不出现「你天生」「你一定」「你总是」', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      // 防呆：确认红线检查真的扫过该包的每一个维度（不是只看 EI）
      const labels = userVisibleTexts(pkg).map((entry) => entry.label)
      for (const dimension of Object.keys(pkg.dimensionCopy)) {
        expect(labels, `${packageId}.${dimension} 的文案没有被红线检查覆盖`).toContain(
          `${dimension}.name`,
        )
        expect(labels).toContain(`${dimension}.negative.description`)
        expect(labels).toContain(`${dimension}.positive.description`)
      }
      expect(assertiveHits(pkg), `${packageId} 的文案出现了断言式表述`).toEqual([])
      for (const { label, text } of userVisibleTexts(pkg)) {
        for (const word of PACKAGE_RED_LINE_WORDS) {
          expect(text, `${packageId} ${label} 出现了红线词「${word}」：${text}`).not.toContain(word)
        }
      }
    }
  })

  it('内容红线：「诊断」只能出现在否定式边界说明里（不允许当结论用）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      expect(diagnosisAsConclusion(pkg), `${packageId} 把「诊断」当结论用了`).toEqual([])
    }
  })

  it('reportCopy 12 个字段齐全且都非空，nextSteps ≥ 3，attribution 五项非空', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      for (const field of REPORT_COPY_FIELDS) {
        const value = pkg.reportCopy[field]
        expect(typeof value, `${packageId}.reportCopy.${field} 必须是字符串`).toBe('string')
        expect(value.trim().length, `${packageId}.reportCopy.${field} 不能为空`).toBeGreaterThan(0)
      }
      expect(Object.keys(pkg.reportCopy).sort(), `${packageId}.reportCopy 键集合`).toEqual(
        [...REPORT_COPY_FIELDS].sort(),
      )
      // 至少 3 条建议，且每条都非空
      expect(pkg.nextSteps.length, `${packageId}.nextSteps 至少 3 条`).toBeGreaterThanOrEqual(3)
      for (const step of pkg.nextSteps) {
        expect(step.trim().length, `${packageId}.nextSteps 不能为空`).toBeGreaterThan(0)
      }
      // 署名五项（公有领域的 IPIP 同样要有来源/许可，只是不要求等于 method.yml）
      for (const field of ['author', 'license', 'licenseUrl', 'source', 'url'] as const) {
        expect(pkg.attribution[field].trim().length, `${packageId}.attribution.${field}`)
          .toBeGreaterThan(0)
      }
    }
  })

  it('contentStatus 等于包内 itemHelp 的最低证据状态（三个包都是 draft）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const statuses = Object.values(pkg.itemHelp).map((entry) => entry.reviewStatus)
      expect(statuses, `${packageId} 必须至少有一条 draft 帮助`).toContain('draft')
      expect(pkg.contentStatus, `${packageId}.contentStatus 必须等于包内最低证据状态`).toBe(
        lowestEvidenceStatus(pkg),
      )
      expect(pkg.contentStatus, `${packageId}.contentStatus`).toBe('draft')
    }
  })

  it('每条帮助都给「暂时无法判断」留出口，且条数等于该包题数、各不相同（不是占位复制）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const explanations = itemHelpKeysOf(pkg).map((key) => pkg.itemHelp[key].explanation)
      expect(explanations, `${packageId} 帮助条数`).toHaveLength(pkg.questionnaire.questionCount)
      expect(new Set(explanations).size, `${packageId} 出现了重复的帮助文字`).toBe(
        pkg.questionnaire.questionCount,
      )
      for (const [index, explanation] of explanations.entries()) {
        expect(
          explanation,
          `${packageId} 第 ${index + 1} 条帮助没有给出「暂时无法判断」的出口`,
        ).toMatch(/无法判断|暂不判断/)
      }
    }
  })

  it('每个包的题数、题号、每维题数、维度集合与仪器档案一致（OEJTS 32×8 / IPIP 50×10）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${packageId} 必须有本地仪器档案`).toBeDefined()
      if (!profile) continue
      const { questions } = pkg.questionnaire
      expect(questions, `${packageId} 题数`).toHaveLength(profile.questionCount)
      expect(pkg.questionnaire.questionCount, `${packageId}.questionCount`).toBe(profile.questionCount)
      // 题号必须是 1..N 升序连续且唯一
      expect(questions.map((question) => question.id), `${packageId} 题号`).toEqual(
        Array.from({ length: profile.questionCount }, (_, index) => index + 1),
      )
      expect(new Set(questions.map((question) => question.id)).size).toBe(profile.questionCount)
      // 维度集合（题目在数组里的出现顺序不参与展示：OEJTS 的题号是打散的，顺序由 dimensionOrder 决定）
      expect([...questionDimensionsOf(pkg)].sort(), `${packageId} 题目里的维度集合`).toEqual(
        [...profile.dimensionOrder].sort(),
      )
      expect(packageDimensionOrder(pkg), `${packageId} 的展示顺序`).toEqual([
        ...profile.dimensionOrder,
      ])
      for (const dimension of profile.dimensionOrder) {
        expect(
          questions.filter((question) => question.dimension === dimension),
          `${packageId} ${dimension} 每维题数`,
        ).toHaveLength(profile.perDimension)
      }
      expect(instrumentHasTypeCode(pkg), `${packageId} 是否产出类型码`).toBe(profile.hasTypeCode)
    }
  })

  it('题面字段与作答格式一致：双极用 textLeft/textRight，agreement 用单句 text', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const format = packageFormat(pkg)
      expect(['bipolar', 'agreement'], `${packageId} 的作答格式`).toContain(format)
      expect(format, `${packageId} 的格式必须与仪器档案一致`).toBe(
        instrumentProfileOf(pkg)?.format,
      )
      const texts: string[] = []
      for (const question of pkg.questionnaire.questions) {
        if (format === 'agreement') {
          // 单句贴切度：只有 text，没有双极的两端字段
          expect(typeof question.text, `${packageId} Q${question.id} 必须有单句 text`).toBe('string')
          expect(question.text?.trim().length ?? 0, `${packageId} Q${question.id}.text`).toBeGreaterThan(0)
          expect(question.textLeft, `${packageId} Q${question.id} 不应有双极字段 textLeft`).toBeUndefined()
          expect(question.textRight, `${packageId} Q${question.id} 不应有双极字段 textRight`).toBeUndefined()
          texts.push(question.text ?? '')
        } else {
          // 双极：两端都必须存在、都不能为空、且必须真的不同（左右写反/抄成一样的防线）
          expect(typeof question.textLeft, `${packageId} Q${question.id} 必须有 textLeft`).toBe('string')
          expect(typeof question.textRight, `${packageId} Q${question.id} 必须有 textRight`).toBe('string')
          expect(question.textLeft?.trim().length ?? 0).toBeGreaterThan(0)
          expect(question.textRight?.trim().length ?? 0).toBeGreaterThan(0)
          expect(
            question.textRight,
            `${packageId} Q${question.id} 的两端描述不能相同`,
          ).not.toBe(question.textLeft)
          expect(question.text, `${packageId} Q${question.id} 不应有单句字段 text`).toBeUndefined()
          texts.push(`${question.textLeft ?? ''}/${question.textRight ?? ''}`)
        }
        // 两种格式都不许有占位符
        expect(texts[texts.length - 1]).not.toMatch(/TODO|XXX|占位|待译|待定|\?\?\?/)
      }
      expect(new Set(texts).size, `${packageId} 题面不能重复`).toBe(texts.length)
    }
  })

  it('每个包两端的展示记号与仪器档案一致（包可覆盖，但不能与档案脱节）', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${packageId} 必须有本地仪器档案`).toBeDefined()
      if (!profile) continue
      for (const dimension of packageDimensionOrder(pkg)) {
        const tokens = poleTokensOf(pkg, dimension)
        expect(tokens, `${packageId}.${dimension} 的两端记号`).toEqual(profile.poles[dimension])
        expect(tokens.low.trim().length, `${packageId}.${dimension}.lowPole`).toBeGreaterThan(0)
        expect(tokens.high.trim().length, `${packageId}.${dimension}.highPole`).toBeGreaterThan(0)
        expect(tokens.low, `${packageId}.${dimension} 两端记号不能相同`).not.toBe(tokens.high)
        const copy = pkg.dimensionCopy[dimension]
        expect(copy.lowPole ?? profile.poles[dimension].low).toBe(tokens.low)
        expect(copy.highPole ?? profile.poles[dimension].high).toBe(tokens.high)
      }
    }
  })

  it('每个包：每题都选 3 时每维原始分正好等于中点，区间是「中点 ∓ 2×每维题数」', () => {
    for (const [packageId, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${packageId} 必须有本地仪器档案`).toBeDefined()
      if (!profile) continue
      const { scoring } = pkg.questionnaire
      expect(scoring.midpoint, `${packageId}.scoring.midpoint`).toBe(profile.midpoint)
      for (const dimension of packageDimensionOrder(pkg)) {
        const questions = pkg.questionnaire.questions.filter(
          (question) => question.dimension === dimension,
        )
        // 独立验算：constant + 3 × Σdirection —— 不走计分引擎
        const sumDirection = questions.reduce((sum, question) => sum + question.direction, 0)
        expect(
          scoring.constants[dimension] + 3 * sumDirection,
          `${packageId} ${dimension} 每题选 3 的原始分`,
        ).toBe(scoring.midpoint)
        const { min, max, neutral } = manualRangeOf(pkg, dimension)
        expect(neutral, `${packageId} ${dimension} 中立分`).toBe(scoring.midpoint)
        expect(min, `${packageId} ${dimension}.min = 中点 − 2×题数`).toBe(
          scoring.midpoint - 2 * questions.length,
        )
        expect(max, `${packageId} ${dimension}.max = 中点 + 2×题数`).toBe(
          scoring.midpoint + 2 * questions.length,
        )
        // 顺带用计分引擎复核一次：引擎与手算式必须给出同一区间（不是替代上面的独立验算）
        const scale = buildDimensionScales(pkg.questionnaire)[dimension]
        expect(scale.min, `${packageId} ${dimension} 引擎下界`).toBe(min)
        expect(scale.max, `${packageId} ${dimension} 引擎上界`).toBe(max)
        expect(extremeScore(scale, 'left'), `${packageId} ${dimension} 推向负极`).toBe(min)
        expect(extremeScore(scale, 'right'), `${packageId} ${dimension} 推向正极`).toBe(max)
      }
    }
  })

  it('守卫自检：把内容改坏之后必须判红（上面几条不是空跑）', () => {
    const base = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]
    const firstDimension = packageDimensionOrder(base)[0]
    const firstItemKey = itemHelpKeysOf(base)[0]

    // 1) 内容状态升格：包里仍有 draft 帮助，就不允许标成 reviewed
    expect(
      assessmentPackageProblems({ ...base, contentStatus: 'reviewed' }).length,
      'contentStatus 升格必须被判红',
    ).toBeGreaterThan(0)

    // 2) 维度文案丢掉「不等于」
    const noNotEquals = clonePackage(base)
    noNotEquals.dimensionCopy[firstDimension].negative.description = '这一侧描述更偏好独处或内部整理的空间。'
    expect(sidesWithoutNotEquals(noNotEquals)).toEqual([`${firstDimension}.negative`])

    // 3) 帮助为空 / 含开发者批注
    const brokenHelp = clonePackage(base)
    brokenHelp.itemHelp[firstItemKey].explanation = ''
    expect(emptyHelpKeys(brokenHelp)).toEqual([firstItemKey])
    expect(assessmentPackageProblems(brokenHelp).length, '空帮助必须被判红').toBeGreaterThan(0)

    const annotated = clonePackage(base)
    const secondItemKey = itemHelpKeysOf(base)[1]
    annotated.itemHelp[secondItemKey].explanation =
      `若采用这个写法，${annotated.itemHelp[secondItemKey].explanation}`
    expect(helpKeysWithForbiddenFragments(annotated)).toEqual([secondItemKey])
    expect(assessmentPackageProblems(annotated).length, '开发者批注必须被判红').toBeGreaterThan(0)

    // 4) 断言式表述
    const assertive = clonePackage(base)
    const thirdItemKey = itemHelpKeysOf(base)[2]
    assertive.itemHelp[thirdItemKey].explanation += ' 你天生就是这样。'
    expect(assertiveHits(assertive)).toEqual([`itemHelp["${thirdItemKey}"].explanation:你天生`])

    // 5) 非法 / 重复风险码
    const badRisk = clonePackage(base)
    const fourthItemKey = itemHelpKeysOf(base)[3]
    badRisk.itemHelp[fourthItemKey].riskCodes = ['X' as unknown as V2RiskCode]
    expect(invalidRiskCodeHits(badRisk)).toEqual([`${fourthItemKey}:X`])
    expect(assessmentPackageProblems(badRisk).length, '非法风险码必须被判红').toBeGreaterThan(0)

    const dupRisk = clonePackage(base)
    const fifthItemKey = itemHelpKeysOf(base)[4]
    dupRisk.itemHelp[fifthItemKey].riskCodes = ['L', 'L']
    expect(invalidRiskCodeHits(dupRisk)).toEqual([`${fifthItemKey}:duplicate`])

    // 6) 把「诊断」当结论用
    const diagnosed = clonePackage(base)
    diagnosed.reportCopy.undeterminedSubtitle = '这份诊断说明你属于未定类型。'
    expect(diagnosisAsConclusion(diagnosed)).toEqual(['reportCopy.undeterminedSubtitle'])

    // 7) 原始副本仍然是零命中——证明上面几条不是「恒真」
    expect(sidesWithoutNotEquals(base)).toEqual([])
    expect(emptyHelpKeys(base)).toEqual([])
    expect(helpKeysWithForbiddenFragments(base)).toEqual([])
    expect(assertiveHits(base)).toEqual([])
    expect(invalidRiskCodeHits(base)).toEqual([])
    expect(diagnosisAsConclusion(base)).toEqual([])
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 第二份量表：IPIP 大五 50 题（`ipip50-zh1`）。
 *
 * 它不产出类型码、题目是单句贴切度，所以上面那些"双极 32 题"的断言对它不适用；
 * 下面这些是它的**同等强度**替代：结构、题面字段、五档文案、中点/常量/区间、
 * 中立作答等于中点，以及公有领域署名。
 * ──────────────────────────────────────────────────────────────────────────── */

describe('内置 v2 内容包中的 IPIP 大五 50 题（ipip50-zh1）', () => {
  const ipip = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1']
  const IPIP_DIMENSIONS = ['E', 'A', 'C', 'ES', 'O'] as const

  it('50 题、id 1..50 升序连续、每维 10 题、维度集合与顺序是 E/A/C/ES/O', () => {
    const { questions } = ipip.questionnaire
    expect(questions).toHaveLength(50)
    expect(ipip.questionnaire.questionCount).toBe(50)
    expect(questions.map((question) => question.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(new Set(questions.map((question) => question.id)).size).toBe(50)
    expect(questionDimensionsOf(ipip)).toEqual([...IPIP_DIMENSIONS])
    expect(packageDimensionOrder(ipip)).toEqual([...IPIP_DIMENSIONS])
    expect([...questionDimensionsOf(ipip)].sort()).toEqual([...IPIP_DIMENSIONS].sort())
    for (const dimension of IPIP_DIMENSIONS) {
      expect(
        questions.filter((question) => question.dimension === dimension),
        `${dimension} 必须恰好 10 题`,
      ).toHaveLength(10)
    }
    // 维度集合里没有第六个维度
    expect(new Set(questions.map((question) => question.dimension)).size).toBe(5)
    // 官方 50 题的题干必须都有中文（不是占位/英文残留）
    for (const question of questions) {
      expect(question.text, `Q${question.id}.text 必须是中文`).toMatch(/[\u4e00-\u9fa5]/)
    }
  })

  it('单句 text + 五档 anchor：没有 textLeft/textRight，50 条题面互不相同', () => {
    const anchors = ipip.questionnaire.responseAnchors
    expect(anchors).toHaveLength(5)
    expect(anchors?.every((anchor) => anchor.trim().length > 0)).toBe(true)
    expect(new Set(anchors).size).toBe(5)
    const texts: string[] = []
    for (const question of ipip.questionnaire.questions) {
      expect(question.text?.trim().length ?? 0, `Q${question.id}.text`).toBeGreaterThan(0)
      expect(question.textLeft, `Q${question.id} 不应有 textLeft`).toBeUndefined()
      expect(question.textRight, `Q${question.id} 不应有 textRight`).toBeUndefined()
      texts.push(question.text ?? '')
    }
    expect(new Set(texts).size, '题面必须互不相同').toBe(50)
  })

  it('中点 30、常量 E30/A24/C24/ES48/O18、区间 10–50、中立作答正好落在中点', () => {
    expect(ipip.questionnaire.scoring.midpoint).toBe(30)
    expect(ipip.questionnaire.scoring.constants).toEqual({
      E: 30,
      A: 24,
      C: 24,
      ES: 48,
      O: 18,
    })
    for (const dimension of IPIP_DIMENSIONS) {
      const { min, max, neutral } = manualRangeOf(ipip, dimension)
      expect(neutral, `${dimension} 每题选 3 的原始分`).toBe(30)
      expect(neutral, `${dimension} 每题选 3 必须等于中点`).toBe(
        ipip.questionnaire.scoring.midpoint,
      )
      expect(min, `${dimension}.min`).toBe(10)
      expect(max, `${dimension}.max`).toBe(50)
      expect(min, `${dimension}.min = 中点 − 2×每维题数`).toBe(30 - 2 * 10)
      expect(max, `${dimension}.max = 中点 + 2×每维题数`).toBe(30 + 2 * 10)
    }
  })

  it('不产出类型码，且 attribution 表明公有领域、指向 ipip.ori.org（不与 method.yml 比较）', () => {
    expect(ipip.instrument.id).toBe('ipip50')
    expect(instrumentHasTypeCode(ipip)).toBe(false)
    expect(ipip.instrument.hasTypeCode).toBe(false)
    expect(INSTRUMENT_PROFILES.ipip50.hasTypeCode).toBe(false)
    expect(packageFormat(ipip)).toBe('agreement')
    expect(ipip.questionnaire.format).toBe('agreement')
    expect(ipip.attribution.license).toMatch(/public domain/i)
    expect(ipip.attribution.license).not.toContain('CC BY')
    expect(ipip.attribution.url).toContain('ipip.ori.org')
    expect(ipip.attribution.licenseUrl).toContain('ipip.ori.org')
    expect(INSTRUMENT_PROFILES.ipip50.attributionMustMatchMethod).toBe(false)
  })
})
