/**
 * `backend-content.mjs` 的类型声明。
 *
 * 这个 `.mjs` 是构建期脚本（IM-1：从后端 YAML 单向生成前端内置副本），
 * 但它同时被 `frontend/src/content/consistency.spec.ts` 引用做**跨源一致性断言**，
 * 因此需要类型声明，否则 `vue-tsc --noEmit` 会因 TS7016 失败、阻断 `npm run build`。
 *
 * 只声明一致性测试实际用到的形状；字段与后端 YAML / model 保持一致。
 */

export const REPO_ROOT: string
export const CONTENT_DIR: string
export const APPLICATION_YML: string
export const FRONTEND_CONTENT_DIR: string
export const ASSESSMENT_PACKAGES_DIR: string
export const REQUIRED_TYPE_CODES: readonly string[]
export const OFFICIAL_CONSTANTS: Record<string, number>
export const OFFICIAL_MIDPOINT: number
export const OFFICIAL_SIGNS: Record<string, Record<number, 1 | -1>>
export const DIMENSIONS: readonly string[]
/** v2 内容包注册表（与 ContentService.ASSESSMENT_PACKAGE_IDS 必须一致）。 */
export const ASSESSMENT_PACKAGE_IDS: readonly string[]
export const DEFAULT_PACKAGE_ID: string
export const CONTENT_STATUSES: readonly string[]
export const RISK_CODES: readonly string[]
export const FORBIDDEN_HELP_FRAGMENTS: readonly string[]
export const REPORT_COPY_FIELDS: readonly string[]

export class ContentShapeError extends Error {}

export interface BackendQuestion {
  id: number
  textLeft: string
  textRight: string
  dimension: string
  direction: 1 | -1
}

export interface BackendQuestionnaire {
  version: string
  title: string
  questionCount: number
  estimatedMinutes: number
  scoring: { midpoint: number; constants: Record<string, number> }
  questions: BackendQuestion[]
}

export interface BackendTypeProfile {
  code: string
  nameCn: string
  tagline: string
  dimensions: Record<string, string>
  strengths: string[]
  blindSpots: string[]
  resonance: string[]
  growth: string[]
}

export interface BackendAttribution {
  source: string
  author: string
  url: string
  license: string
  licenseUrl: string
}

export interface BackendMethod {
  attribution: BackendAttribution
  sections: Array<{ title: string; body: string }>
}

export interface BackendSiteMeta {
  contentVersion: string
  appVersion: string
}

export interface BackendContent {
  questionnaire: BackendQuestionnaire
  types: BackendTypeProfile[]
  method: BackendMethod
  meta: BackendSiteMeta
}

export function loadQuestionnaire(version?: string): BackendQuestionnaire
export function loadTypes(): BackendTypeProfile[]
export function loadMethod(): BackendMethod
export function loadSiteMeta(): BackendSiteMeta
export function loadBackendContent(): BackendContent

/* ── v2 内容包（`assessment-packages/*.yml`） ─────────────────────────── */

export interface BackendPoleCopy {
  label: string
  description: string
  observation: string
  action: string
}

export interface BackendDimensionCopy {
  name: string
  negative: BackendPoleCopy
  positive: BackendPoleCopy
  balanced: { summary: string; observation: string }
  insufficient: { summary: string; nextStep: string }
}

export interface BackendItemHelp {
  explanation: string
  reviewStatus: string
  riskCodes: string[]
}

export interface BackendAssessmentPackage {
  schemaVersion: 2
  packageId: string
  locale: string
  localeRevision: string
  helpRevision: string
  copyRevision: string
  contentStatus: string
  instrument: { id: string; revision: string; scoringVersion: string }
  interpretation: {
    version: string
    minRatingsPerDimension: number
    typeMinDistance: number
    markedDistance: number
  }
  title: string
  estimatedMinutes: number
  questionnaire: BackendQuestionnaire
  itemHelp: Record<string, BackendItemHelp>
  dimensionCopy: Record<string, BackendDimensionCopy>
  reportCopy: Record<string, string>
  nextSteps: string[]
  attribution: BackendAttribution
}

export function loadAssessmentPackage(
  packageId: string,
  expectedAttribution?: BackendAttribution,
): BackendAssessmentPackage
export function loadAssessmentPackages(): BackendAssessmentPackage[]
