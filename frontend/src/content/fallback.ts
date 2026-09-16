// ⚠️ 本文件由 scripts/gen-fallback-content.mjs 从后端 YAML 自动生成，请勿手改。
//
// 唯一真相在 backend/src/main/resources/ 下：
//   content/questionnaire-quick.yml / content/types.yml / content/method.yml
//   assessment-packages/<packageId>.yml（v2 内容包：题面 + 帮助 + 维度解释 + 报告文案）
// 改内容请改后端 YAML，然后在前端目录执行 `npm run build`（prebuild 会重新生成）。
// 手改这里会在下一次构建时被覆盖，并被 src/content/consistency.spec.ts 判红。

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
 * ⚠️ 三份内容都从后端 YAML 生成（`scripts/gen-fallback-content.mjs`），
 * 因此与接口下发的内容逐字段相同；`contentVersion` 也直接取自
 * `backend/src/main/resources/application.yml`，不再是另一套写死的版本号。
 */
export const FALLBACK_META: Meta = {
  appVersion: '1.0.0',
  contentVersion: '2026-09-01',
  questionnaireVersions: ['quick'],
  attribution: FALLBACK_ATTRIBUTION,
}

export const FALLBACK_TYPES = FALLBACK_TYPE_PROFILES

/**
 * 取内置类型文案。查不到时返回 `undefined`（由调用方决定如何提示），
 * 不伪造一份兜底文案——那样只会掩盖内容缺失。
 */
export function getFallbackTypeProfile(code: string): (typeof FALLBACK_TYPE_PROFILES)[string] | undefined {
  return FALLBACK_TYPE_PROFILES[code.toUpperCase()]
}

/** 便于测试与 UI 统一引用的一份索引。 */
export type FallbackTypeCode = keyof typeof FALLBACK_TYPE_PROFILES
