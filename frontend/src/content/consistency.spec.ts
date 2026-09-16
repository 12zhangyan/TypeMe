import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSESSMENT_PACKAGE_IDS as BACKEND_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID as BACKEND_DEFAULT_PACKAGE_ID,
  DIMENSIONS as BACKEND_DIMENSIONS,
  FRONTEND_CONTENT_DIR,
  REPORT_COPY_FIELDS as BACKEND_REPORT_COPY_FIELDS,
  REPO_ROOT,
  loadAssessmentPackages,
  loadBackendContent,
} from '../../../scripts/lib/backend-content.mjs'
import * as backendContentModule from '../../../scripts/lib/backend-content.mjs'
import {
  ASSESSMENT_PACKAGE_IDS,
  DEFAULT_PACKAGE_ID,
  FALLBACK_ASSESSMENT_PACKAGES,
  FALLBACK_META,
  FALLBACK_METHOD,
  FALLBACK_QUESTIONNAIRE,
  FALLBACK_ATTRIBUTION,
  getFallbackTypeProfile,
} from './fallback'
import { FALLBACK_TYPE_PROFILES, TYPE_CODES } from './typeProfiles'
import {
  CONTENT_STATUSES,
  INSTRUMENT_PROFILES,
  OFFICIAL_CONSTANTS,
  OFFICIAL_MIDPOINT,
  OFFICIAL_SIGNS,
  REPORT_COPY_FIELDS,
  assessmentPackageProblems,
  instrumentHasTypeCode,
  instrumentProfileOf,
  packageDimensionOrder,
  packageFormat,
} from '@/domain/assessmentPackage'

/**
 * IM-1：**跨源一致性**——前端内置副本必须与后端 YAML 逐字段相等。
 *
 * 修复前的状态是「两份独立真相」：题库 30/32 题措辞不同、16 型文案全部字段不同
 * （连 nameCn 都 0/16 相同）、方法页 4 节 vs 6 节、contentVersion 不一致，
 * 而没有任何测试会红。
 *
 * 现在的守卫分三层：
 *   1. `gen-fallback-content.mjs --check`：产物与后端 YAML 字节级一致（能抓住手改生成文件）；
 *   2. 本文件下面的逐字段断言：把后端 YAML 解析成对象后与前端导出的对象深比（含每一句正文）；
 *   3. `fallback.spec.ts`：把内置副本当**内容**再校验一遍（符号表、左右端关键词、红线词）。
 *
 * 验证方式（也是这条守卫的验收方式）：随便改后端 YAML 的一处正文 → 本文件必须红。
 *
 * 本轮（IPIP 大五接入）：v2 内容包的断言不再假设"一定是 OEJTS 四维 32 题双极量表"，
 * 而是按**每个包自己的仪器档案**（`INSTRUMENT_PROFILES`）参数化。
 * OEJTS 专属断言（zh1 题面与 FALLBACK_QUESTIONNAIRE 全等、官方 1.2 符号表、
 * attribution 必须等于 method.yml）逐条保留，只是限定在 `instrument.id === 'oejts32'` 的包上；
 * IPIP 包有同等强度的独立断言（50 题 / 逐题符号 / 中点 30 / 常量 / 区间 / 不产出类型码）。
 */

const GENERATOR = `${REPO_ROOT}/scripts/gen-fallback-content.mjs`

/**
 * Node 侧仪器档案（`backend-content.mjs` 的 `INSTRUMENT_PROFILES`）。
 *
 * 该模块的类型声明文件 `.d.mts` 目前没有声明这个导出（也不在本轮允许修改的文件里），
 * 所以这里用一次受控读取拿到运行时导出，避免 `vue-tsc --noEmit` 报 TS2305。
 * 它不是"绕开类型检查"：下面的断言会先确认它确实存在，再逐字段与前端档案比对。
 */
const BACKEND_INSTRUMENT_PROFILES = (
  backendContentModule as unknown as {
    INSTRUMENT_PROFILES: Readonly<Record<string, unknown>>
  }
).INSTRUMENT_PROFILES

/** 只比较数据本身：去掉 undefined、统一对象键顺序。 */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null))
}

const backend = loadBackendContent()

describe('IM-1 生成脚本自身的守卫', () => {
  it('生成脚本存在，且 --check 时报告产物与后端 YAML 完全一致', () => {
    // 用 --check 而非「生成后 git diff」：产物被手改、或后端 YAML 改了却忘了重新生成，
    // 都会让这里非零退出。stdio 继承，失败时错误直接就打在测试输出里。
    const run = () => execFileSync(process.execPath, [GENERATOR, '--check'], { stdio: 'inherit' })

    // 第一次跑之前先确保产物是最新的（prebuild / pretest 正常情况下已经跑过生成）
    execFileSync(process.execPath, [GENERATOR], { stdio: 'inherit' })
    expect(run).not.toThrow()
  })

  it('生成脚本解析到的是本仓库的后端内容目录（防止脚本被搬走后路径静默失效）', () => {
    for (const filename of ['questionnaire-quick.yml', 'types.yml', 'method.yml']) {
      expect(existsSync(resolve(REPO_ROOT, 'backend/src/main/resources/content', filename)),
        `${filename} 必须能在仓库的后端内容目录里找到`).toBe(true)
    }
    expect(existsSync(GENERATOR), '生成脚本必须在 scripts/ 下').toBe(true)
    expect(existsSync(resolve(FRONTEND_CONTENT_DIR, 'fallback.ts')),
      '生成产物必须落在 frontend/src/content/ 下').toBe(true)
  })
})

describe('IM-1 题目副本与后端 YAML 逐字段一致', () => {
  it('version / title / questionCount / estimatedMinutes / scoring 全等', () => {
    expect(FALLBACK_QUESTIONNAIRE.version).toBe(backend.questionnaire.version)
    expect(FALLBACK_QUESTIONNAIRE.title).toBe(backend.questionnaire.title)
    expect(FALLBACK_QUESTIONNAIRE.questionCount).toBe(backend.questionnaire.questionCount)
    expect(FALLBACK_QUESTIONNAIRE.estimatedMinutes).toBe(backend.questionnaire.estimatedMinutes)
    expect(plain(FALLBACK_QUESTIONNAIRE.scoring)).toEqual(plain(backend.questionnaire.scoring))
  })

  it('32 道题逐题全等：题号、左右两端文字、维度、符号（含 Q9 的 BK-2 措辞）', () => {
    expect(FALLBACK_QUESTIONNAIRE.questions).toHaveLength(backend.questionnaire.questions.length)
    // 逐题比较而不是整体 toEqual：失败信息会直接指出是哪一题、哪个字段
    for (const [index, expected] of backend.questionnaire.questions.entries()) {
      const actual = FALLBACK_QUESTIONNAIRE.questions[index]
      expect(actual, `第 ${index + 1} 题缺失`).toBeDefined()
      expect(actual.id).toBe(expected.id)
      expect(actual.textLeft, `Q${expected.id} 左端`).toBe(expected.textLeft)
      expect(actual.textRight, `Q${expected.id} 右端`).toBe(expected.textRight)
      expect(actual.dimension, `Q${expected.id} 维度`).toBe(expected.dimension)
      expect(actual.direction, `Q${expected.id} 符号`).toBe(expected.direction)
    }
    // 整体也来一次，防止上面漏掉新增字段
    expect(plain(FALLBACK_QUESTIONNAIRE)).toEqual(plain(backend.questionnaire))
  })

  it('Q9 用的是 BK-2 裁决后的中性措辞，且左右极向没有写反', () => {
    const q9 = FALLBACK_QUESTIONNAIRE.questions.find((question) => question.id === 9)
    expect(q9?.textLeft).toBe('随性，有点乱')
    expect(q9?.textRight).toBe('有条理，按规矩放')
    expect(q9?.direction).toBe(-1)
  })
})

describe('IM-1 类型文案副本与后端 YAML 逐字段一致', () => {
  it('16 型齐全，且顺序与后端一致', () => {
    expect(TYPE_CODES).toHaveLength(16)
    expect([...TYPE_CODES]).toEqual(backend.types.map((profile) => profile.code))
  })

  it('每型每个字段全等（nameCn / tagline / 四维正文 / 四个列表逐条）', () => {
    for (const expected of backend.types) {
      const actual = getFallbackTypeProfile(expected.code)
      expect(actual, `${expected.code} 缺少内置文案`).toBeDefined()
      expect(plain(actual)).toEqual(plain(expected))
      // 逐字段再点一遍，失败信息更可读
      expect(actual?.nameCn, `${expected.code}.nameCn`).toBe(expected.nameCn)
      expect(actual?.tagline, `${expected.code}.tagline`).toBe(expected.tagline)
      expect(plain(actual?.dimensions), `${expected.code}.dimensions`).toEqual(plain(expected.dimensions))
      expect(plain(actual?.strengths), `${expected.code}.strengths`).toEqual(plain(expected.strengths))
      expect(plain(actual?.blindSpots), `${expected.code}.blindSpots`).toEqual(plain(expected.blindSpots))
      expect(plain(actual?.resonance), `${expected.code}.resonance`).toEqual(plain(expected.resonance))
      expect(plain(actual?.growth), `${expected.code}.growth`).toEqual(plain(expected.growth))
    }
    expect(Object.keys(FALLBACK_TYPE_PROFILES)).toHaveLength(16)
  })

  it('描述名用的是后端 types.yml 的原创描述名，不再是 16Personalities 式的角色名', () => {
    const expectedNames = Object.fromEntries(backend.types.map((profile) => [profile.code, profile.nameCn]))
    for (const [code, name] of Object.entries(expectedNames)) {
      expect(getFallbackTypeProfile(code)?.nameCn, `${code} 的名字必须与后端一致`).toBe(name)
    }
    // 文档 §8.4 的描述名
    expect(getFallbackTypeProfile('INFP')?.nameCn).toBe('价值探索者')
    expect(getFallbackTypeProfile('INTJ')?.nameCn).toBe('系统规划者')
    expect(getFallbackTypeProfile('ENFP')?.nameCn).toBe('灵感连接者')
    expect(getFallbackTypeProfile('ESFP')?.nameCn).toBe('活力参与者')
    // 描述名必须 16 型互不重复
    expect(new Set(backend.types.map((profile) => profile.nameCn)).size).toBe(16)
    // 外部平台的角色名与本项目早期自创名都必须彻底消失
    const all = JSON.stringify(FALLBACK_TYPE_PROFILES)
    for (const old of [
      '建筑师',
      '逻辑学家',
      '指挥官',
      '辩论家',
      '提倡者',
      '调停者',
      '主人公',
      '竞选者',
      '物流师',
      '守卫者',
      '总经理',
      '执政官',
      '鉴赏家',
      '探险家',
      '企业家',
      '表演者',
      '长线布局者',
      '原理拆解者',
      '内心守望者',
      '火花点燃者',
      '气氛点燃者',
    ]) {
      expect(all, `旧类型名「${old}」应已删除（§8.4）`).not.toContain(old)
    }
  })

  it('每型的字段条数符合文档 §8.3 的内容契约（resonance/strengths/blindSpots 各 3，growth 2）', () => {
    for (const profile of backend.types) {
      expect(profile.resonance, `${profile.code}.resonance`).toHaveLength(3)
      expect(profile.strengths, `${profile.code}.strengths`).toHaveLength(3)
      expect(profile.blindSpots, `${profile.code}.blindSpots`).toHaveLength(3)
      expect(profile.growth, `${profile.code}.growth`).toHaveLength(2)
    }
  })

  it('四维解读里不出现超出"距离计算"含义的稳定性/准确性承诺', () => {
    // §7.3：分档是展示口径，不是置信区间、正确率或回答一致性指标
    const banned = ['非常稳定', '高度准确', '准确率', '置信度', '信度很高', '你比', '百分位', '最稀有']
    for (const profile of backend.types) {
      const text = [
        profile.tagline,
        ...Object.values(profile.dimensions),
        ...profile.strengths,
        ...profile.blindSpots,
        ...profile.resonance,
        ...profile.growth,
      ].join('\n')
      for (const word of banned) {
        expect(text, `${profile.code} 正文里出现了「${word}」`).not.toContain(word)
      }
    }
  })
})

describe('IM-1 方法页副本与后端 YAML 逐字段一致', () => {
  it('署名五项全等（CC BY 的硬性义务）', () => {
    expect(plain(FALLBACK_ATTRIBUTION)).toEqual(plain(backend.method.attribution))
    expect(plain(FALLBACK_METHOD.attribution)).toEqual(plain(backend.method.attribution))
  })

  it('小节标题与正文逐节全等（含 BK-3 的「致谢与参考文献」）', () => {
    expect(FALLBACK_METHOD.sections).toHaveLength(backend.method.sections.length)
    for (const [index, expected] of backend.method.sections.entries()) {
      const actual = FALLBACK_METHOD.sections[index]
      expect(actual, `第 ${index + 1} 节缺失`).toBeDefined()
      expect(actual.title, `第 ${index + 1} 节标题`).toBe(expected.title)
      expect(actual.body, `「${expected.title}」正文`).toBe(expected.body)
    }
    expect(plain(FALLBACK_METHOD)).toEqual(plain(backend.method))
    expect(FALLBACK_METHOD.sections.map((section) => section.title)).toContain('致谢与参考文献')
  })

  it('IM-5：许可小节承认中文本地化改写，不再声称「没有改写」', () => {
    const license = FALLBACK_METHOD.sections[0].body
    expect(license).toContain('中文本地化改写')
    expect(license).toContain('左右两端的极向与计分符号未改动')
    expect(license).not.toContain('没有改写')
  })
})

describe('IM-1 meta 副本与后端配置一致', () => {
  it('contentVersion 取自 application.yml，不再是另一套写死的版本号', () => {
    expect(FALLBACK_META.contentVersion).toBe(backend.meta.contentVersion)
    expect(FALLBACK_META.appVersion).toBe(backend.meta.appVersion)
    expect(backend.meta.contentVersion).not.toBe('builtin-2026-01')
  })

  it('questionnaireVersions 与后端已交付的版本一致', () => {
    expect(FALLBACK_META.questionnaireVersions).toEqual(['quick'])
    expect(FALLBACK_META.questionnaireVersions).toContain(FALLBACK_QUESTIONNAIRE.version)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * v2 内容包（IM-2）：题面 + 逐题帮助 + 维度解释 + 报告文案 + 解释政策整体锁定。
 *
 * 跨源守卫与 v1 三份副本完全相同：生成脚本 --check 覆盖它，本文件再把后端 YAML
 * 解析成对象后与前端内置副本**逐字段深比**。任何一处正文不同都必须判红——
 * 内置副本是接口不可用时真正展示给用户的那一份内容。
 *
 * 断言按「每个包自己的仪器档案」参数化：任何写死 OEJTS 题数/维度/符号的地方
 * 都必须改成读 `instrumentProfileOf(pkg)`；OEJTS 专属的官方表核对只对
 * `instrument.id === 'oejts32'` 的包跑（见下方 describe）。
 * ──────────────────────────────────────────────────────────────────────────── */

const GENERATOR_SOURCE = readFileSync(GENERATOR, 'utf8')
const backendPackages = loadAssessmentPackages()

type V2Package = (typeof FALLBACK_ASSESSMENT_PACKAGES)[string]

/** 内置内容包（按生成文件里的键顺序）。 */
const V2_PACKAGES: ReadonlyArray<readonly [string, V2Package]> = Object.entries(
  FALLBACK_ASSESSMENT_PACKAGES,
)

function sortedNumerically(keys: string[]): string[] {
  return [...keys].sort((a, b) => Number(a) - Number(b))
}

/** 该包题库里出现的维度（按题目首次出现的顺序）。 */
function questionDimensionsOf(pkg: V2Package): string[] {
  const seen: string[] = []
  for (const question of pkg.questionnaire.questions) {
    if (!seen.includes(question.dimension)) seen.push(question.dimension)
  }
  return seen
}

/** 该包题库的全部题号（升序、字符串形式）—— itemHelp 的合法键集合。 */
function questionIdKeysOf(pkg: V2Package): string[] {
  return sortedNumerically(pkg.questionnaire.questions.map((question) => String(question.id)))
}

/** 某一维在包里的**逐题**符号表（题号 → 符号）。 */
function signsOfDimension(pkg: V2Package, dimension: string): Record<number, 1 | -1> {
  const signs: Record<number, 1 | -1> = {}
  for (const question of pkg.questionnaire.questions) {
    if (question.dimension === dimension) signs[question.id] = question.direction
  }
  return signs
}

function sortedSignKeys(table: Readonly<Record<number, 1 | -1>>): string[] {
  return sortedNumerically(Object.keys(table))
}

/** 某一维的正/反符号题数（用于核对官方给出的 5正5反 这类分布）。 */
function directionCountsOf(pkg: V2Package, dimension: string): { positive: number; negative: number } {
  let positive = 0
  let negative = 0
  for (const question of pkg.questionnaire.questions) {
    if (question.dimension !== dimension) continue
    if (question.direction === 1) positive += 1
    else negative += 1
  }
  return { positive, negative }
}

/**
 * 由**题库自己的数据**（scoring.constants + 逐题 direction）手工累加出每维区间与
 * "每题都选 3"时的原始分。刻意不走计分引擎：否则就是拿被测代码验算它自己。
 */
function rawRangeOf(
  pkg: V2Package,
  dimension: string,
): { min: number; max: number; neutral: number } {
  const constant = pkg.questionnaire.scoring.constants[dimension]
  let min = constant
  let max = constant
  let neutral = constant
  for (const question of pkg.questionnaire.questions) {
    if (question.dimension !== dimension) continue
    const atOne = question.direction * 1
    const atFive = question.direction * 5
    min += Math.min(atOne, atFive)
    max += Math.max(atOne, atFive)
    neutral += question.direction * 3
  }
  return { min, max, neutral }
}

/** 包内 itemHelp 证据状态里最低的那一个（draft < reviewed < field_checked）。 */
function lowestEvidenceStatus(pkg: V2Package): string {
  const rank = (status: string): number => (CONTENT_STATUSES as readonly string[]).indexOf(status)
  const statuses = Object.values(pkg.itemHelp).map((entry) => entry.reviewStatus)
  return statuses.reduce((lowest, status) => (rank(status) < rank(lowest) ? status : lowest), statuses[0])
}

/**
 * 每个包**独立抄录**的仪器身份（不从内容包也不从仪器档案里读）。
 * 三个包必须逐条登记：新增包时这里不加就会红，避免"新量表悄悄上线、没人核对"。
 */
const OFFICIAL_INSTRUMENT_OF_PACKAGE: Readonly<
  Record<
    string,
    { id: string; revision: string; scoringVersion: string; format: string; hasTypeCode: boolean }
  >
> = {
  'oejts32-zh1-report2': {
    id: 'oejts32',
    revision: '1.2',
    scoringVersion: 'oejts-1.2',
    format: 'bipolar',
    hasTypeCode: true,
  },
  'oejts32-zh2-preview-r1': {
    id: 'oejts32',
    revision: '1.2',
    scoringVersion: 'oejts-1.2',
    format: 'bipolar',
    hasTypeCode: true,
  },
  'ipip50-zh1': {
    id: 'ipip50',
    revision: 'goldberg-bfm-50',
    scoringVersion: 'ipip-bfm50-1.0',
    format: 'agreement',
    hasTypeCode: false,
  },
}

/**
 * 解释门槛（文档 §8.1）是**该量表量程上的绝对分**，所以必须逐仪器独立登记：
 * OEJTS 32（每维 8，±16，区间 8–40）→ 5 / 9；IPIP-50（每维 10，±20，区间 10–50）→ 6 / 11。
 */
const OFFICIAL_POLICY_OF_INSTRUMENT: Readonly<
  Record<
    string,
    { minRatingsPerDimension: number; typeMinDistance: number; markedDistance: number }
  >
> = {
  oejts32: { minRatingsPerDimension: 8, typeMinDistance: 5, markedDistance: 9 },
  ipip50: { minRatingsPerDimension: 10, typeMinDistance: 6, markedDistance: 11 },
}

/**
 * IPIP-50（Goldberg Big-Five Factor Markers）官方计分键的**独立抄录**：
 * <https://ipip.ori.org/newBigFive5broadKey.htm> 逐题抄录，不从档案或内容包读取。
 * 与 `INSTRUMENT_PROFILES.ipip50.signs`、内容包三方互校，抄错一个正反号就会红。
 */
const IPIP_OFFICIAL_SIGNS: Readonly<Record<string, Readonly<Record<number, 1 | -1>>>> = {
  E: { 1: 1, 6: -1, 11: 1, 16: -1, 21: 1, 26: -1, 31: 1, 36: -1, 41: 1, 46: -1 },
  A: { 2: -1, 7: 1, 12: -1, 17: 1, 22: -1, 27: 1, 32: -1, 37: 1, 42: 1, 47: 1 },
  C: { 3: 1, 8: -1, 13: 1, 18: -1, 23: 1, 28: -1, 33: 1, 38: -1, 43: 1, 48: 1 },
  ES: { 4: -1, 9: 1, 14: -1, 19: 1, 24: -1, 29: -1, 34: -1, 39: -1, 44: -1, 49: -1 },
  O: { 5: 1, 10: -1, 15: 1, 20: -1, 25: 1, 30: -1, 35: 1, 40: 1, 45: 1, 50: 1 },
}

/** 官方公布的每维正/反题数分布。 */
const IPIP_OFFICIAL_DISTRIBUTION: Readonly<Record<string, readonly [number, number]>> = {
  E: [5, 5],
  A: [6, 4],
  C: [6, 4],
  ES: [2, 8],
  O: [7, 3],
}

describe('IM-2 生成脚本已覆盖 v2 内容包', () => {
  it('--check 会把内容包产物一起比较（产物清单里有它，并且真的读了注册表）', () => {
    expect(GENERATOR_SOURCE, '内容包产物必须在生成清单里').toContain('assessmentPackagesFallback.ts')
    expect(GENERATOR_SOURCE, '生成脚本必须从注册表加载内容包').toContain('loadAssessmentPackages')
    // 与其它三份副本同样走 --check 的字节级比较（不是只生成不校验）
    expect(GENERATOR_SOURCE).toMatch(/\[\s*'assessmentPackagesFallback\.ts'/)
  })

  it('注册表里声明的包在磁盘上全部存在，且覆盖两份仪器的档案', () => {
    // BACKEND_DIMENSIONS 是 OEJTS 专属的维度顺序常量，必须与 oejts32 仪器档案一致
    // （IPIP 的维度是 E/A/C/ES/O，不再用这个常量表达）
    expect(BACKEND_DIMENSIONS).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect([...BACKEND_DIMENSIONS]).toEqual([...INSTRUMENT_PROFILES.oejts32.dimensionOrder])
    expect(backendPackages.map((pkg) => pkg.packageId)).toEqual([...BACKEND_PACKAGE_IDS])
    // 注册表顺序 = 默认包顺序：第一项是站点默认量表（大五 IPIP-50），后面是 OEJTS 旧版本。
    // 这里连顺序一起钉住，避免「默认包」在没人注意时被换回四字母量表。
    expect(BACKEND_PACKAGE_IDS[0]).toBe('ipip50-zh1')
    expect(backendPackages.map((pkg) => pkg.instrument.id)).toEqual(['ipip50', 'oejts32', 'oejts32'])
    expect(backendPackages.length).toBeGreaterThan(0)
    // 两份仪器都要有包（名称里的「覆盖两份仪器的档案」不是空话）
    expect([...new Set(backendPackages.map((pkg) => pkg.instrument.id))].sort()).toEqual([
      'ipip50',
      'oejts32',
    ])
    // 每个包声明的 instrument.id 都必须有档案，否则前端无从校验维度/符号/中点
    for (const pkg of backendPackages) {
      expect(
        INSTRUMENT_PROFILES[pkg.instrument.id],
        `${pkg.packageId} 的 instrument.id="${pkg.instrument.id}" 没有对应的仪器档案`,
      ).toBeDefined()
    }
    // 仪器档案有两份实现（前端 / Node 生成器），必须逐字段一致
    expect(BACKEND_INSTRUMENT_PROFILES, 'Node 侧必须导出仪器档案').toBeDefined()
    expect(Object.keys(BACKEND_INSTRUMENT_PROFILES).sort()).toEqual(
      Object.keys(INSTRUMENT_PROFILES).sort(),
    )
    for (const id of Object.keys(INSTRUMENT_PROFILES)) {
      expect(plain(BACKEND_INSTRUMENT_PROFILES[id]), `仪器档案 ${id} 前后端必须一致`).toEqual(
        plain(INSTRUMENT_PROFILES[id]),
      )
    }
  })
})

describe('IM-2 v2 内容包内置副本与后端 YAML 逐字段一致', () => {
  it('键集合等于后端注册表 ASSESSMENT_PACKAGE_IDS（顺序一致）', () => {
    expect(Object.keys(FALLBACK_ASSESSMENT_PACKAGES)).toEqual([...BACKEND_PACKAGE_IDS])
    expect([...ASSESSMENT_PACKAGE_IDS]).toEqual([...BACKEND_PACKAGE_IDS])
    expect(Object.keys(FALLBACK_ASSESSMENT_PACKAGES)).toEqual([...ASSESSMENT_PACKAGE_IDS])
  })

  it('每个包与 loadAssessmentPackages() 的对应对象深比相等（含每一句帮助与文案）', () => {
    for (const [index, packageId] of BACKEND_PACKAGE_IDS.entries()) {
      const fallback = FALLBACK_ASSESSMENT_PACKAGES[packageId]
      expect(fallback, `${packageId} 缺少内置副本`).toBeDefined()
      const expected = backendPackages[index]
      // 整体深比：漏一个字段 / 改一句正文都会红
      expect(plain(fallback), `${packageId} 与后端 YAML 不一致`).toEqual(plain(expected))
      // 逐字段再点一遍，失败信息更可读
      expect(fallback?.packageId).toBe(expected.packageId)
      expect(fallback?.contentStatus).toBe(expected.contentStatus)
      expect(fallback?.localeRevision).toBe(expected.localeRevision)
      expect(fallback?.helpRevision).toBe(expected.helpRevision)
      expect(fallback?.copyRevision).toBe(expected.copyRevision)
      expect(fallback?.title).toBe(expected.title)
      expect(plain(fallback?.interpretation), `${packageId}.interpretation`).toEqual(
        plain(expected.interpretation),
      )
      expect(plain(fallback?.itemHelp), `${packageId}.itemHelp`).toEqual(plain(expected.itemHelp))
      expect(plain(fallback?.dimensionCopy), `${packageId}.dimensionCopy`).toEqual(
        plain(expected.dimensionCopy),
      )
      expect(plain(fallback?.reportCopy), `${packageId}.reportCopy`).toEqual(plain(expected.reportCopy))
      expect(plain(fallback?.nextSteps), `${packageId}.nextSteps`).toEqual(plain(expected.nextSteps))
      expect(plain(fallback?.attribution), `${packageId}.attribution`).toEqual(
        plain(expected.attribution),
      )
    }
    expect(Object.keys(FALLBACK_ASSESSMENT_PACKAGES)).toHaveLength(BACKEND_PACKAGE_IDS.length)
  })

  it('DEFAULT_PACKAGE_ID 等于注册表第一项（默认包不能与注册表脱节）', () => {
    expect(BACKEND_DEFAULT_PACKAGE_ID).toBe(BACKEND_PACKAGE_IDS[0])
    expect(DEFAULT_PACKAGE_ID).toBe(BACKEND_PACKAGE_IDS[0])
    expect(DEFAULT_PACKAGE_ID).toBe(ASSESSMENT_PACKAGE_IDS[0])
    expect(DEFAULT_PACKAGE_ID).toBe(Object.keys(FALLBACK_ASSESSMENT_PACKAGES)[0])
  })

  it('每个包都通过完整契约校验，且题数 / 键集合 / 建议 / 署名都齐全', () => {
    // 每个包**独立登记**的仪器身份必须齐全（漏登记就是漏核对）
    expect(Object.keys(OFFICIAL_INSTRUMENT_OF_PACKAGE).sort()).toEqual(
      Object.keys(FALLBACK_ASSESSMENT_PACKAGES).sort(),
    )
    for (const [key, pkg] of V2_PACKAGES) {
      // 内置副本本身必须合法：缺帮助、缺维度、符号错、状态升格都在这里拦住
      expect(assessmentPackageProblems(pkg), `${key} 未通过内容包契约校验`).toEqual([])
      const questionKeys = questionIdKeysOf(pkg)
      expect(questionKeys, `${key} 题号必须互不重复`).toHaveLength(
        new Set(questionKeys).size,
      )
      expect(questionKeys, `${key} 题号条数必须等于题数`).toHaveLength(pkg.questionnaire.questionCount)
      // itemHelp / dimensionCopy 的键必须恰好覆盖该包题库（32 题 / 50 题都适用）
      expect(Object.keys(pkg.itemHelp), `${key}.itemHelp 条数必须等于题数`).toHaveLength(
        pkg.questionnaire.questionCount,
      )
      expect(sortedNumerically(Object.keys(pkg.itemHelp)), `${key}.itemHelp 键集合`).toEqual(
        questionKeys,
      )
      expect(Object.keys(pkg.dimensionCopy).sort(), `${key}.dimensionCopy 键集合`).toEqual(
        [...questionDimensionsOf(pkg)].sort(),
      )
      // 建议至少 3 条，署名五项都非空
      expect(pkg.nextSteps.length, `${key}.nextSteps 至少 3 条`).toBeGreaterThanOrEqual(3)
      for (const step of pkg.nextSteps) {
        expect(step.trim().length, `${key}.nextSteps 不能为空`).toBeGreaterThan(0)
      }
      for (const field of ['author', 'license', 'licenseUrl', 'source', 'url'] as const) {
        expect(pkg.attribution[field].trim().length, `${key}.attribution.${field} 不能为空`)
          .toBeGreaterThan(0)
      }
    }
  })

  it('每个包 packageId 与键一致，schemaVersion=2、locale=zh-CN，仪器身份与档案一致', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      expect(pkg.packageId, `${key} 的 packageId 必须等于键`).toBe(key)
      expect(pkg.schemaVersion, `${key}.schemaVersion`).toBe(2)
      expect(pkg.locale, `${key}.locale`).toBe('zh-CN')
      const expected = OFFICIAL_INSTRUMENT_OF_PACKAGE[key]
      expect(expected, `${key} 缺少独立抄录的仪器身份`).toBeDefined()
      // 包声明 → 独立抄录 → 仪器档案，三方必须一致
      expect(pkg.instrument.id, `${key}.instrument.id`).toBe(expected.id)
      expect(pkg.instrument.revision, `${key}.instrument.revision`).toBe(expected.revision)
      expect(pkg.instrument.scoringVersion, `${key}.instrument.scoringVersion`).toBe(
        expected.scoringVersion,
      )
      expect(packageFormat(pkg), `${key} 的作答格式`).toBe(expected.format)
      expect(instrumentHasTypeCode(pkg), `${key} 是否产出类型码`).toBe(expected.hasTypeCode)
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${key} 的仪器 ${pkg.instrument.id} 必须有本地档案`).toBeDefined()
      expect(profile?.id, `${key} 的档案 id`).toBe(expected.id)
      expect(profile?.format, `${key} 的档案格式`).toBe(expected.format)
      expect(profile?.hasTypeCode, `${key} 的档案类型码`).toBe(expected.hasTypeCode)
      expect(pkg.instrument.format, `${key}.instrument.format`).toBe(expected.format)
      expect(pkg.instrument.hasTypeCode, `${key}.instrument.hasTypeCode`).toBe(expected.hasTypeCode)
      // 两个 oejts32 包必须逐字声明 OEJTS 1.2 的仪器身份（IPIP 包不参与这条）
      if (expected.id === 'oejts32') {
        expect(pkg.instrument, `${key} 的仪器身份必须是 OEJTS 1.2`).toEqual({
          id: 'oejts32',
          revision: '1.2',
          scoringVersion: 'oejts-1.2',
          format: 'bipolar',
          hasTypeCode: true,
        })
      }
    }
  })

  it('itemHelp 键恰好覆盖该包题库的全部题号（数量 = 该包题数、且没有多余键）', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      const expectedKeys = questionIdKeysOf(pkg)
      expect(expectedKeys, `${key} 题数`).toHaveLength(
        instrumentProfileOf(pkg)?.questionCount ?? -1,
      )
      expect(sortedNumerically(Object.keys(pkg.itemHelp)), `${key}.itemHelp 键集合`).toEqual(
        expectedKeys,
      )
      for (const itemKey of expectedKeys) {
        const entry = pkg.itemHelp[itemKey]
        expect(entry, `${key}.itemHelp["${itemKey}"] 缺失`).toBeDefined()
        expect(entry.explanation.trim().length, `${key}.itemHelp["${itemKey}"].explanation 为空`).toBeGreaterThan(0)
        expect(Array.isArray(entry.riskCodes)).toBe(true)
        expect(['draft', 'reviewed', 'field_checked']).toContain(entry.reviewStatus)
      }
    }
  })

  it('dimensionCopy 的键恰好是该包题库的维度集合（不含多余键）', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      const dimensions = questionDimensionsOf(pkg)
      expect(Object.keys(pkg.dimensionCopy).sort(), `${key}.dimensionCopy 键集合`).toEqual(
        [...dimensions].sort(),
      )
      for (const dimension of dimensions) {
        const copy = pkg.dimensionCopy[dimension]
        expect(copy, `${key}.dimensionCopy.${dimension} 缺失`).toBeDefined()
        expect(copy.name.trim().length, `${key}.${dimension}.name`).toBeGreaterThan(0)
        for (const field of ['negative', 'positive'] as const) {
          expect(copy[field].label.trim().length, `${key}.${dimension}.${field}.label`).toBeGreaterThan(0)
          expect(copy[field].description.trim().length, `${key}.${dimension}.${field}.description`).toBeGreaterThan(0)
        }
        expect(copy.balanced.summary.trim().length).toBeGreaterThan(0)
        expect(copy.insufficient.summary.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('reportCopy 12 个字段齐全（键集合与后端字段表逐项一致，且都非空）', () => {
    expect([...REPORT_COPY_FIELDS]).toEqual([...BACKEND_REPORT_COPY_FIELDS])
    expect(REPORT_COPY_FIELDS).toHaveLength(12)
    const expectedKeys = [...BACKEND_REPORT_COPY_FIELDS].sort()
    for (const [key, pkg] of V2_PACKAGES) {
      expect(Object.keys(pkg.reportCopy).sort(), `${key}.reportCopy 键集合`).toEqual(expectedKeys)
      for (const field of REPORT_COPY_FIELDS) {
        const value = pkg.reportCopy[field]
        expect(typeof value, `${key}.reportCopy.${field} 必须是字符串`).toBe('string')
        expect(value.trim().length, `${key}.reportCopy.${field} 不能为空`).toBeGreaterThan(0)
      }
    }
  })

  it('attribution 五项齐全；只有档案要求与 method.yml 全等的仪器才逐字比较（OEJTS 的 CC BY-NC-SA 署名义务）', () => {
    const expectedKeys = ['author', 'license', 'licenseUrl', 'source', 'url']
    for (const [key, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${key} 必须有本地仪器档案`).toBeDefined()
      expect(Object.keys(pkg.attribution).sort(), `${key}.attribution 键集合`).toEqual(expectedKeys)
      for (const field of expectedKeys as (keyof typeof pkg.attribution)[]) {
        expect(pkg.attribution[field].trim().length, `${key}.attribution.${field} 不能为空`)
          .toBeGreaterThan(0)
      }
      if (profile?.attributionMustMatchMethod) {
        expect(plain(pkg.attribution), `${key}.attribution 必须与 method.yml 逐字相等`).toEqual(
          plain(backend.method.attribution),
        )
        expect(plain(pkg.attribution)).toEqual(plain(FALLBACK_ATTRIBUTION))
      }
    }
    // 两个 oejts32 包必须真的走到上面那条比较（档案被改成 false 会在这里红）
    const mustMatch = V2_PACKAGES
      .filter(([, pkg]) => instrumentProfileOf(pkg)?.attributionMustMatchMethod === true)
      .map(([key]) => key)
    expect(mustMatch).toEqual(['oejts32-zh1-report2', 'oejts32-zh2-preview-r1'])
    expect(INSTRUMENT_PROFILES.oejts32.attributionMustMatchMethod).toBe(true)
    expect(INSTRUMENT_PROFILES.ipip50.attributionMustMatchMethod).toBe(false)
  })

  it('zh1 包的 questionnaire.questions 与 FALLBACK_QUESTIONNAIRE 逐题全等（题面 + 维度 + 符号）', () => {
    const zh1 = FALLBACK_ASSESSMENT_PACKAGES['oejts32-zh1-report2']
    expect(zh1, 'zh1 包必须存在（现行中文题面的对照包）').toBeDefined()
    // 这条是 OEJTS 专属的：zh1 包复用的就是 v1 的 quick 题库
    expect(zh1.instrument.id, 'zh1 包必须是 oejts32 包').toBe('oejts32')
    expect(zh1.questionnaire.questions).toHaveLength(FALLBACK_QUESTIONNAIRE.questions.length)
    for (const [index, expected] of FALLBACK_QUESTIONNAIRE.questions.entries()) {
      const actual = zh1.questionnaire.questions[index]
      expect(actual, `第 ${index + 1} 题缺失`).toBeDefined()
      expect(actual.id, `第 ${index + 1} 题 id`).toBe(expected.id)
      expect(actual.textLeft, `Q${expected.id} 左端`).toBe(expected.textLeft)
      expect(actual.textRight, `Q${expected.id} 右端`).toBe(expected.textRight)
      expect(actual.dimension, `Q${expected.id} 维度`).toBe(expected.dimension)
      expect(actual.direction, `Q${expected.id} 符号`).toBe(expected.direction)
    }
    // 整体也来一次，防止上面漏掉新增字段（含 scoring / version / title）
    expect(plain(zh1.questionnaire)).toEqual(plain(FALLBACK_QUESTIONNAIRE))
    expect(plain(zh1.questionnaire)).toEqual(plain(backend.questionnaire))
  })

  it('每个包的题数 / 维度集合 / 顺序 / 常量 / 中点 / 逐题符号都与自己的仪器档案一致', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${key} 的仪器必须有本地档案（否则拒绝装载）`).toBeDefined()
      if (!profile) continue
      expect(pkg.questionnaire.questions, `${key} 题数`).toHaveLength(profile.questionCount)
      expect(pkg.questionnaire.scoring.midpoint, `${key}.scoring.midpoint`).toBe(profile.midpoint)
      expect(plain(pkg.questionnaire.scoring.constants), `${key}.scoring.constants`).toEqual(
        plain(profile.constants),
      )
      expect(questionDimensionsOf(pkg).sort(), `${key} 题目里的维度集合`).toEqual(
        [...profile.dimensionOrder].sort(),
      )
      expect(packageDimensionOrder(pkg), `${key} 的维度展示顺序`).toEqual([...profile.dimensionOrder])
      for (const dimension of profile.dimensionOrder) {
        const questions = pkg.questionnaire.questions.filter(
          (question) => question.dimension === dimension,
        )
        expect(questions, `${key} ${dimension} 必须恰好 ${profile.perDimension} 题`).toHaveLength(
          profile.perDimension,
        )
        const actual = signsOfDimension(pkg, dimension)
        const expected = profile.signs?.[dimension]
        expect(expected, `${key} 的档案缺少 ${dimension} 的符号表`).toBeDefined()
        expect(sortedSignKeys(actual), `${key} ${dimension} 题号集合`).toEqual(
          sortedSignKeys(expected ?? {}),
        )
        for (const id of sortedSignKeys(expected ?? {}).map(Number)) {
          expect(actual[id], `${key} ${dimension} Q${id} 的符号`).toBe(expected?.[id])
        }
      }
    }
  })

  it('两个 oejts32 包与官方 OEJTS 1.2 表逐题一致（OFFICIAL_SIGNS 独立抄录，抄错方向会红）', () => {
    const oejtsPackages = V2_PACKAGES.filter(([, pkg]) => pkg.instrument.id === 'oejts32')
    expect(oejtsPackages.map(([key]) => key)).toEqual([
      'oejts32-zh1-report2',
      'oejts32-zh2-preview-r1',
    ])
    for (const [key, pkg] of oejtsPackages) {
      expect(pkg.questionnaire.questions).toHaveLength(32)
      expect(pkg.questionnaire.scoring.midpoint, `${key}.scoring.midpoint`).toBe(OFFICIAL_MIDPOINT)
      expect(plain(pkg.questionnaire.scoring.constants), `${key}.scoring.constants`).toEqual(
        plain(OFFICIAL_CONSTANTS),
      )
      for (const dimension of Object.keys(OFFICIAL_SIGNS)) {
        const actual = signsOfDimension(pkg, dimension)
        const questions = pkg.questionnaire.questions.filter(
          (question) => question.dimension === dimension,
        )
        expect(questions, `${key} ${dimension} 必须恰好 8 题`).toHaveLength(8)
        const expected = OFFICIAL_SIGNS[dimension]
        expect(sortedSignKeys(actual), `${key} ${dimension} 题号集合`).toEqual(
          sortedSignKeys(expected),
        )
        for (const id of sortedSignKeys(expected).map(Number)) {
          expect(actual[id], `${key} ${dimension} Q${id} 的符号`).toBe(expected[id])
        }
      }
    }
    // 档案里的 OEJTS 符号表本身就是官方表的抄录，不能与官方表脱节
    expect(plain(INSTRUMENT_PROFILES.oejts32.signs)).toEqual(plain(OFFICIAL_SIGNS))
  })

  it('每个包 contentStatus 都是 draft，且等于包内 itemHelp 的最低证据状态', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      expect(pkg.contentStatus, `${key}.contentStatus`).toBe('draft')
      // 包里确实存在 draft 证据：一旦有人把 contentStatus 改成 reviewed，这里会红
      const statuses = Object.values(pkg.itemHelp).map((entry) => entry.reviewStatus)
      expect(statuses, `${key} 必须至少有一条 draft 帮助`).toContain('draft')
      expect(pkg.contentStatus, `${key}.contentStatus 必须等于包内最低证据状态`).toBe(
        lowestEvidenceStatus(pkg),
      )
      expect(backendPackages.find((item) => item.packageId === key)?.contentStatus).toBe('draft')
    }
  })

  it('每个包都带解释政策与逐题帮助版本标识（门槛按该仪器的量程独立登记）', () => {
    for (const [key, pkg] of V2_PACKAGES) {
      const profile = instrumentProfileOf(pkg)
      expect(profile, `${key} 必须有本地仪器档案`).toBeDefined()
      expect(pkg.interpretation.version.trim().length, `${key}.interpretation.version`).toBeGreaterThan(0)
      // 每维题数由档案决定（OEJTS 8、IPIP-50 10），不再写死成 8
      expect(pkg.interpretation.minRatingsPerDimension, `${key}.interpretation.minRatingsPerDimension`)
        .toBe(profile?.perDimension)
      const expected = OFFICIAL_POLICY_OF_INSTRUMENT[profile?.id ?? '']
      expect(expected, `${key} 的仪器 ${String(profile?.id)} 缺少独立登记的解释门槛`).toBeDefined()
      expect(pkg.interpretation.typeMinDistance, `${key}.interpretation.typeMinDistance`).toBe(
        expected?.typeMinDistance,
      )
      expect(pkg.interpretation.markedDistance, `${key}.interpretation.markedDistance`).toBe(
        expected?.markedDistance,
      )
      expect(pkg.interpretation.markedDistance).toBeGreaterThan(pkg.interpretation.typeMinDistance)
      for (const field of ['localeRevision', 'helpRevision', 'copyRevision'] as const) {
        expect(pkg[field].trim().length, `${key}.${field}`).toBeGreaterThan(0)
      }
    }
  })

  it('守卫自检：深比与顺序断言真的能发现漂移（不是空跑）', () => {
    const pkg = FALLBACK_ASSESSMENT_PACKAGES[DEFAULT_PACKAGE_ID]
    // 改一个正文/一个字段都必须判成不一致
    expect(plain({ ...pkg, title: `${pkg.title}（手改）` })).not.toEqual(plain(pkg))
    expect(
      plain({
        ...pkg,
        itemHelp: { ...pkg.itemHelp, '1': { ...pkg.itemHelp['1'], explanation: '被手改过的帮助' } },
      }),
    ).not.toEqual(plain(pkg))
    // 只改对象键顺序不算漂移（否则会被生成器的格式化噪声误报）
    const reordered = {
      ...pkg,
      reportCopy: Object.fromEntries(
        Object.entries(pkg.reportCopy).reverse(),
      ) as typeof pkg.reportCopy,
    }
    expect(plain(reordered)).toEqual(plain(pkg))
    // 注册表顺序断言确实比较顺序（不是集合比较）
    expect([...BACKEND_PACKAGE_IDS].slice().reverse()).not.toEqual([...BACKEND_PACKAGE_IDS])
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * IPIP 大五 50 题（`ipip50-zh1`）的仪器事实 —— 与 OEJTS 同等强度的独立断言。
 *
 * 这一份是本轮新增的第二份量表：它**不产出类型码**，题目是单句贴切度而非双极。
 * 下面每条都只信"独立抄录"的官方数据（IPIP 官方计分键、中点 30、常量、区间 10–50），
 * 不从内容包或仪器档案里读回来再比对自己。
 * ──────────────────────────────────────────────────────────────────────────── */

describe('IM-2 IPIP 大五 50 题（ipip50-zh1）的仪器事实', () => {
  const ipip = FALLBACK_ASSESSMENT_PACKAGES['ipip50-zh1']
  const profile = INSTRUMENT_PROFILES.ipip50
  const IPIP_DIMENSIONS = ['E', 'A', 'C', 'ES', 'O'] as const

  it('包存在，且声明的就是 ipip50（agreement 格式、不产出类型码）', () => {
    expect(ipip, 'ipip50-zh1 必须在注册表与内置副本里').toBeDefined()
    expect(ipip.instrument.id).toBe('ipip50')
    expect(instrumentProfileOf(ipip)).toBe(profile)
    expect(instrumentHasTypeCode(ipip)).toBe(false)
    expect(ipip.instrument.hasTypeCode).toBe(false)
    expect(profile.hasTypeCode).toBe(false)
    expect(packageFormat(ipip)).toBe('agreement')
    expect(ipip.questionnaire.format).toBe('agreement')
  })

  it('50 题、id 1..50 升序连续、每维 10 题、维度集合与顺序是 E/A/C/ES/O', () => {
    const { questions } = ipip.questionnaire
    expect(questions).toHaveLength(50)
    expect(ipip.questionnaire.questionCount).toBe(50)
    expect(questions.map((question) => question.id)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    )
    expect(new Set(questions.map((question) => question.id)).size).toBe(50)
    expect(questionDimensionsOf(ipip)).toEqual([...IPIP_DIMENSIONS])
    expect(ipip.dimensionOrder).toEqual([...IPIP_DIMENSIONS])
    expect(packageDimensionOrder(ipip)).toEqual([...IPIP_DIMENSIONS])
    expect(profile.dimensionOrder).toEqual([...IPIP_DIMENSIONS])
    expect([...questionDimensionsOf(ipip)].sort()).toEqual([...profile.dimensionOrder].sort())
    // 官方 50 题按 E/A/C/ES/O 五维循环排列（结构本身也是核对点）
    expect(questions.map((question) => question.dimension)).toEqual(
      questions.map((_, index) => IPIP_DIMENSIONS[index % 5]),
    )
    for (const dimension of IPIP_DIMENSIONS) {
      expect(
        questions.filter((question) => question.dimension === dimension),
        `${dimension} 必须恰好 10 题`,
      ).toHaveLength(10)
      expect(profile.perDimension).toBe(10)
    }
    expect(new Set(questions.map((question) => question.dimension)).size).toBe(5)
  })

  it('逐题符号与官方计分键、仪器档案三方一致（E5正5反 / A6正4反 / C6正4反 / ES2正8反 / O7正3反）', () => {
    for (const dimension of IPIP_DIMENSIONS) {
      const official = IPIP_OFFICIAL_SIGNS[dimension]
      const archived = profile.signs?.[dimension]
      const actual = signsOfDimension(ipip, dimension)
      expect(archived, `档案缺少 ${dimension} 的符号表`).toBeDefined()
      expect(sortedSignKeys(actual), `${dimension} 在包里的题号集合`).toEqual(
        sortedSignKeys(official),
      )
      expect(sortedSignKeys(archived ?? {}), `${dimension} 在档案里的题号集合`).toEqual(
        sortedSignKeys(official),
      )
      for (const id of sortedSignKeys(official).map(Number)) {
        expect(actual[id], `${dimension} Q${id} 在包里的符号`).toBe(official[id])
        expect(archived?.[id], `${dimension} Q${id} 在档案里的符号`).toBe(official[id])
      }
      const [positive, negative] = IPIP_OFFICIAL_DISTRIBUTION[dimension]
      expect(directionCountsOf(ipip, dimension), `${dimension} 正/反题数`).toEqual({
        positive,
        negative,
      })
    }
  })

  it('midpoint === 30，constants === {E:30,A:24,C:24,ES:48,O:18}', () => {
    expect(ipip.questionnaire.scoring.midpoint).toBe(30)
    expect(profile.midpoint).toBe(30)
    expect(plain(ipip.questionnaire.scoring.constants)).toEqual({
      E: 30,
      A: 24,
      C: 24,
      ES: 48,
      O: 18,
    })
    expect(plain(profile.constants)).toEqual(plain(ipip.questionnaire.scoring.constants))
  })

  it('每题都选 3 时每维原始分正好等于中点（按 scoring + direction 独立验算，不用计分引擎）', () => {
    for (const dimension of IPIP_DIMENSIONS) {
      const questions = ipip.questionnaire.questions.filter(
        (question) => question.dimension === dimension,
      )
      const sumDirection = questions.reduce((sum, question) => sum + question.direction, 0)
      const manual = ipip.questionnaire.scoring.constants[dimension] + 3 * sumDirection
      expect(manual, `${dimension} 每题选 3 的原始分`).toBe(30)
      expect(manual, `${dimension} 每题选 3 必须落在中点上`).toBe(
        ipip.questionnaire.scoring.midpoint,
      )
      expect(rawRangeOf(ipip, dimension).neutral, `${dimension} 独立累加的中立分`).toBe(
        ipip.questionnaire.scoring.midpoint,
      )
    }
  })

  it('每维 min/max 分别是 10 / 50（由「中点 ∓ 2×每维题数」独立推出）', () => {
    for (const dimension of IPIP_DIMENSIONS) {
      const { min, max } = rawRangeOf(ipip, dimension)
      expect(min, `${dimension}.min`).toBe(10)
      expect(max, `${dimension}.max`).toBe(50)
      expect(min, `${dimension}.min = 中点 − 2×每维题数`).toBe(30 - 2 * 10)
      expect(max, `${dimension}.max = 中点 + 2×每维题数`).toBe(30 + 2 * 10)
    }
  })

  it('agreement 格式：题目用单句 text、五档 anchor 恰好 5 条、没有双极字段', () => {
    const anchors = ipip.questionnaire.responseAnchors
    expect(anchors).toHaveLength(5)
    expect(anchors?.every((anchor) => anchor.trim().length > 0)).toBe(true)
    expect(new Set(anchors).size).toBe(5)
    const texts: string[] = []
    for (const question of ipip.questionnaire.questions) {
      expect(question.text?.trim().length ?? 0, `Q${question.id}.text 不能为空`).toBeGreaterThan(0)
      expect(question.textLeft, `Q${question.id} 不应有 textLeft（这是双极字段）`).toBeUndefined()
      expect(question.textRight, `Q${question.id} 不应有 textRight（这是双极字段）`).toBeUndefined()
      expect(question.text, `Q${question.id}.text 必须是中文字面`).toMatch(/[\u4e00-\u9fa5]/)
      expect(question.text, `Q${question.id}.text 不得含占位符`).not.toMatch(/TODO|XXX|占位|待译|待定|\?\?\?/)
      texts.push(question.text ?? '')
    }
    expect(new Set(texts).size, '50 条题面必须互不相同').toBe(50)
  })

  it('attribution 表明公有领域、来源指向 ipip.ori.org（不与 method.yml 比较）', () => {
    expect(ipip.attribution.license).toMatch(/public domain/i)
    expect(ipip.attribution.license).not.toContain('CC BY')
    expect(ipip.attribution.url).toContain('ipip.ori.org')
    expect(ipip.attribution.licenseUrl).toContain('ipip.ori.org')
    expect(ipip.attribution.source.length).toBeGreaterThan(0)
    expect(ipip.attribution.author.length).toBeGreaterThan(0)
    expect(plain(ipip.attribution)).not.toEqual(plain(FALLBACK_ATTRIBUTION))
    expect(plain(ipip.attribution)).not.toEqual(plain(backend.method.attribution))
    expect(INSTRUMENT_PROFILES.ipip50.attributionMustMatchMethod).toBe(false)
  })
})
