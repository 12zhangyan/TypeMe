#!/usr/bin/env node
/**
 * IM-1：从后端 YAML **单向生成**前端的三份内置副本。
 *
 *   backend/src/main/resources/content/questionnaire-quick.yml → frontend/src/content/questionnaireFallback.ts
 *   backend/src/main/resources/content/types.yml               → frontend/src/content/typeProfiles.ts
 *   backend/src/main/resources/content/method.yml              → frontend/src/content/methodFallback.ts
 *   （三份的汇总出口 frontend/src/content/fallback.ts 也是生成的）
 *
 * 为什么要有这个脚本：此前前端这四份内容是**独立手写的第二份真相**——30/32 道题措辞不同、
 * 16 型文案全部字段不同（连 nameCn 都 0/16 相同）、方法页 4 节 vs 6 节、contentVersion 不一致。
 * 也就是说用户看到的题目与人格解读取决于「后端那一刻是不是可达」，而没有任何测试会红。
 *
 * 现在的规则很简单：**后端 YAML 是唯一真相**，前端副本是它的构建产物。
 *   - 改内容 → 改后端 YAML → `npm run build`（prebuild 会重跑本脚本）；
 *   - 手改生成的文件 → 立刻被 `npm run build` 覆盖，并被跨源一致性测试判红；
 *   - 改坏了后端 YAML（符号写反 / 缺字段 / 少一个类型）→ 本脚本直接失败，不会产出半成品。
 *
 * 用法：
 *   node scripts/gen-fallback-content.mjs            # 生成
 *   node scripts/gen-fallback-content.mjs --check    # 只校验产物是否与后端一致（CI / 测试用）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ASSESSMENT_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID,
  FRONTEND_CONTENT_DIR,
  loadAssessmentPackages,
  loadBackendContent,
} from './lib/backend-content.mjs'

const CHECK_ONLY = process.argv.includes('--check')

const BANNER = `// ⚠️ 本文件由 scripts/gen-fallback-content.mjs 从后端 YAML 自动生成，请勿手改。
//
// 唯一真相在 backend/src/main/resources/ 下：
//   content/questionnaire-quick.yml / content/types.yml / content/method.yml
//   assessment-packages/<packageId>.yml（v2 内容包：题面 + 帮助 + 维度解释 + 报告文案）
// 改内容请改后端 YAML，然后在前端目录执行 \`npm run build\`（prebuild 会重新生成）。
// 手改这里会在下一次构建时被覆盖，并被 src/content/consistency.spec.ts 判红。
`

// --------------------------------------------------------------------- 序列化

function tsString(value) {
  if (value.includes("'") && !value.includes('"')) {
    return `"${value}"`
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * 渲染一个 TS 字符串数组，数组字面量整体缩进 `indent` 空格（`[` 与 `]` 对齐在 indent 上，
 * 元素在 indent + 2）。
 */
function renderStringArray(values, indent) {
  const open = ' '.repeat(indent)
  const close = ' '.repeat(indent)
  const item = ' '.repeat(indent + 2)
  return `[\n${values.map((value) => `${item}${tsString(value)},`).join('\n')}\n${close}]`
}

// --------------------------------------------------------------------- 题库

function renderQuestionnaire(questionnaire) {
  const questions = questionnaire.questions
    .map(
      (question) =>
        `    { id: ${question.id}, textLeft: ${tsString(question.textLeft)}, ` +
        `textRight: ${tsString(question.textRight)}, dimension: '${question.dimension}', ` +
        `direction: ${question.direction} },`,
    )
    .join('\n')

  return `${BANNER}
import type { Questionnaire } from '@/domain/types'

/**
 * 快速版题库（${questionnaire.title}）—— \`GET /api/v1/questionnaires/quick\` 的内置副本。
 *
 * 计分常量 EI ${questionnaire.scoring.constants.EI} / SN ${questionnaire.scoring.constants.SN} / ` +
      `TF ${questionnaire.scoring.constants.TF} / JP ${questionnaire.scoring.constants.JP}，` +
      `midpoint ${questionnaire.scoring.midpoint}。
 * \`direction\` 是官方 OEJTS 1.2 公式的直接展开；\`textLeft\` 对应官方「圈 1」的一端。
 */
export const FALLBACK_QUESTIONNAIRE: Questionnaire = {
  version: ${tsString(questionnaire.version)},
  title: ${tsString(questionnaire.title)},
  questionCount: ${questionnaire.questionCount},
  estimatedMinutes: ${questionnaire.estimatedMinutes},
  scoring: {
    midpoint: ${questionnaire.scoring.midpoint},
    constants: {
      EI: ${questionnaire.scoring.constants.EI},
      SN: ${questionnaire.scoring.constants.SN},
      TF: ${questionnaire.scoring.constants.TF},
      JP: ${questionnaire.scoring.constants.JP},
    },
  },
  questions: [
${questions}
  ],
}
`
}

// --------------------------------------------------------------------- 类型文案

function renderTypeProfiles(types) {
  const entries = types
    .map((profile) => {
      return `  ${profile.code}: {
    code: ${tsString(profile.code)},
    nameCn: ${tsString(profile.nameCn)},
    tagline: ${tsString(profile.tagline)},
    dimensions: {
      EI: ${tsString(profile.dimensions.EI)},
      SN: ${tsString(profile.dimensions.SN)},
      TF: ${tsString(profile.dimensions.TF)},
      JP: ${tsString(profile.dimensions.JP)},
    },
    strengths: ${renderStringArray(profile.strengths, 4)},
    blindSpots: ${renderStringArray(profile.blindSpots, 4)},
    resonance: ${renderStringArray(profile.resonance, 4)},
    growth: ${renderStringArray(profile.growth, 4)},
  },`
    })
    .join('\n\n')

  const codes = types.map((profile) => `  ${tsString(profile.code)},`).join('\n')

  return `${BANNER}
import type { TypeProfile } from '@/domain/contentTypes'

/**
 * 16 个类型的中文文案（内置副本）。
 *
 * schema 与 \`content/types.yml\`（\`docs/任务拆解.md\` §1.2）逐字段一致：
 *   code / nameCn / tagline / dimensions{EI,SN,TF,JP} / strengths / blindSpots / resonance / growth
 *
 * \`nameCn\` 用的是通行中文译名（调停者 / 建筑师 / 竞选者…），
 * 不再使用本项目早期自创的那一套名字（BK-1 裁决）。
 */
export const FALLBACK_TYPE_PROFILES: Record<string, TypeProfile> = {
${entries}
}

/** 16 个类型码（用于校验内置文案齐全，缺一个都算内容事故）。 */
export const TYPE_CODES = [
${codes}
] as const
`
}

// --------------------------------------------------------------------- 方法页

function renderMethod(method) {
  const sections = method.sections
    .map(
      (section) =>
        `  {\n    title: ${tsString(section.title)},\n    body:\n      ${tsString(section.body)},\n  },`,
    )
    .join('\n')

  return `${BANNER}
import type { Attribution, MethodContent } from '@/domain/contentTypes'

/** OEJTS 1.2 的署名信息 —— 落地页与关于页必须展示（CC BY 的硬性义务）。 */
export const FALLBACK_ATTRIBUTION: Attribution = {
  source: ${tsString(method.attribution.source)},
  author: ${tsString(method.attribution.author)},
  url: ${tsString(method.attribution.url)},
  license: ${tsString(method.attribution.license)},
  licenseUrl: ${tsString(method.attribution.licenseUrl)},
}

/** 方法说明页内容（\`GET /api/v1/method\` 的内置副本）。 */
export const FALLBACK_METHOD: MethodContent = {
  attribution: FALLBACK_ATTRIBUTION,
  sections: [
${sections}
  ],
}
`
}

// --------------------------------------------------------------------- 内容包 v2 内置副本

/**
 * 通用 JS → TS 字面量渲染。
 *
 * v2 内容包是纯数据（字符串 / 数字 / 布尔 / null / 数组 / 映射），
 * 用通用序列化比逐字段手写渲染更不容易漏字段——漏一个字段在这里是编译期错误，
 * 而不是「页面上少一段文案」这种没人发现的问题。
 */
function renderTsValue(value, indent) {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)
  if (value === null) return 'null'
  if (typeof value === 'string') return tsString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => `${inner}${renderTsValue(item, indent + 2)},`).join('\n')
    return `[\n${items}\n${pad}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const lines = entries
      .map(([key, item]) => {
        const renderedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : tsString(key)
        return `${inner}${renderedKey}: ${renderTsValue(item, indent + 2)},`
      })
      .join('\n')
    return `{\n${lines}\n${pad}}`
  }
  throw new Error(`内容包里出现了无法序列化的值：${String(value)}`)
}

function renderAssessmentPackages(packages) {
  const entries = packages
    .map((pkg) => `  ${tsString(pkg.packageId)}: ${renderTsValue(pkg, 2)},`)
    .join('\n\n')

  return `${BANNER}
import type { AssessmentPackage } from '@/domain/assessmentPackage'

/**
 * v2 内容包的内置副本（按 packageId 索引）。
 *
 * 使用规则（开发方案 §5.3 / §5.4）：
 *   - 接口超时、报错或结构非法时，**只能**用同一个 packageId 的内置副本；
 *     没有同包时显示不可用，不得悄悄切换到另一版内容；
 *   - 运行时一次只选择一个完整包，题面与帮助必须来自同一个包；
 *   - 内容包是不可变的：任何题面/帮助/报告文案改动都要换新的 packageId，
 *     因此这里的键只会增加，不会原地替换。
 */
export const FALLBACK_ASSESSMENT_PACKAGES: Record<string, AssessmentPackage> = {
${entries}
}

/** 所有内置包 ID（顺序即注册表顺序）。 */
export const ASSESSMENT_PACKAGE_IDS = [
${ASSESSMENT_PACKAGE_IDS.map((id) => `  ${tsString(id)},`).join('\n')}
] as const

/** 默认内容包：现行中文题面 + 新报告政策。 */
export const DEFAULT_PACKAGE_ID = ${tsString(DEFAULT_PACKAGE_ID)}
`
}

// --------------------------------------------------------------------- 汇总出口

function renderFallbackIndex() {
  return `${BANNER}
export {
  FALLBACK_QUESTIONNAIRE,
} from './questionnaireFallback'
export {
  FALLBACK_ATTRIBUTION,
  FALLBACK_METHOD,
} from './methodFallback'
export {
  FALLBACK_TYPE_PROFILES,
  TYPE_CODES,
} from './typeProfiles'
export {
  ASSESSMENT_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
} from './assessmentPackagesFallback'

import { FALLBACK_TYPE_PROFILES } from './typeProfiles'
import { FALLBACK_ATTRIBUTION } from './methodFallback'

import type { Meta } from '@/domain/contentTypes'

/**
 * 内置副本（ADR-4）—— 后端不可用时站点仍能完整作答与出结果。
 *
 * ⚠️ 三份内容都从后端 YAML 生成（\`scripts/gen-fallback-content.mjs\`），
 * 因此与接口下发的内容逐字段相同；\`contentVersion\` 也直接取自
 * \`backend/src/main/resources/application.yml\`，不再是另一套写死的版本号。
 */
export const FALLBACK_META: Meta = {
  appVersion: ${tsString(siteMeta.appVersion)},
  contentVersion: ${tsString(siteMeta.contentVersion)},
  questionnaireVersions: ['quick'],
  attribution: FALLBACK_ATTRIBUTION,
}

export const FALLBACK_TYPES = FALLBACK_TYPE_PROFILES

/**
 * 取内置类型文案。查不到时返回 \`undefined\`（由调用方决定如何提示），
 * 不伪造一份兜底文案——那样只会掩盖内容缺失。
 */
export function getFallbackTypeProfile(code: string): (typeof FALLBACK_TYPE_PROFILES)[string] | undefined {
  return FALLBACK_TYPE_PROFILES[code.toUpperCase()]
}

/** 便于测试与 UI 统一引用的一份索引。 */
export type FallbackTypeCode = keyof typeof FALLBACK_TYPE_PROFILES
`
}

// --------------------------------------------------------------------- 主流程

const { questionnaire, types, method, meta: siteMeta } = loadBackendContent()
// v2 内容包：任何包缺失/损坏都在这里失败，不会产出半成品内置副本
const assessmentPackages = loadAssessmentPackages()

const OUTPUTS = [
  ['questionnaireFallback.ts', () => renderQuestionnaire(questionnaire)],
  ['typeProfiles.ts', () => renderTypeProfiles(types)],
  ['methodFallback.ts', () => renderMethod(method)],
  ['assessmentPackagesFallback.ts', () => renderAssessmentPackages(assessmentPackages)],
  ['fallback.ts', () => renderFallbackIndex()],
]

mkdirSync(FRONTEND_CONTENT_DIR, { recursive: true })

const changed = []
const stale = []

for (const [filename, render] of OUTPUTS) {
  const path = resolve(FRONTEND_CONTENT_DIR, filename)
  const content = render()
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null

  if (existing === content) {
    continue
  }
  if (CHECK_ONLY) {
    stale.push(filename)
    continue
  }
  writeFileSync(path, content, 'utf8')
  changed.push(filename)
}

if (CHECK_ONLY) {
  if (stale.length > 0) {
    console.error(
      `\n✗ 前端内置副本与后端 YAML 不一致：${stale.join(', ')}\n` +
        '  请在前端目录执行 `npm run build`（或 `npm run gen:content`）重新生成。\n',
    )
    process.exit(1)
  }
  console.log('✓ 前端内置副本与后端 YAML 一致')
  process.exit(0)
}

if (changed.length === 0) {
  console.log('前端内置副本已是最新，无需改动')
} else {
  console.log(`已从后端 YAML 生成 ${changed.length} 个文件：${changed.join(', ')}`)
}
console.log(
  `  题库 ${questionnaire.questionCount} 题 / 类型文案 ${types.length} 型 / 方法页 ${method.sections.length} 节` +
    ` / 内容包 ${assessmentPackages.length} 个（${assessmentPackages.map((pkg) => pkg.packageId).join(', ')}）` +
    ` / contentVersion ${siteMeta.contentVersion}`,
)
