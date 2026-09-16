import type { Dimension } from './types'

/**
 * 接口响应相关的补充类型（`docs/技术方案.md` §5）。
 *
 * 与 `docs/任务拆解.md` §1.5 冻结的前端契约分开存放：§1.5 那份是**唯一冻结**的，
 * 不放任何额外声明，避免以后有人误以为这些也是契约的一部分。
 */

/** `GET /api/v1/meta`、`GET /api/v1/method` 里的 attribution —— CC BY 的硬性义务字段。 */
export interface Attribution {
  source: string
  author: string
  url: string
  license: string
  licenseUrl: string
}

/** `GET /api/v1/meta` */
export interface Meta {
  appVersion: string
  contentVersion: string
  questionnaireVersions: string[]
  attribution: Attribution
}

/** `GET /api/v1/types/{code}` —— 对应 `content/types.yml` 的单条（§1.2） */
export interface TypeProfile {
  code: string
  nameCn: string
  tagline: string
  dimensions: Record<Dimension, string>
  strengths: string[]
  blindSpots: string[]
  /** 「这说的就是我」：具体、可证伪的反巴纳姆条目（需求文档 §6.3） */
  resonance: string[]
  growth: string[]
}

/** `GET /api/v1/method` —— 对应 `content/method.yml`（§1.3） */
export interface MethodSection {
  title: string
  body: string
}

export interface MethodReference {
  label: string
  url: string
}

export interface MethodContent {
  attribution: Attribution
  sections: MethodSection[]
  references?: MethodReference[]
}

/** 内容来自接口还是内置副本 —— UI 会据此做一句低调的说明。 */
export type ContentSource = 'api' | 'fallback'

export interface Resolved<T> {
  data: T
  source: ContentSource
}
