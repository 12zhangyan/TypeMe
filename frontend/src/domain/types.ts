/**
 * 前端领域类型 —— 与 `docs/任务拆解.md` §1.5 冻结契约同源。
 *
 * ⚠️ 从本轮（IPIP 大五接入）起，`Dimension` / `Pole` 不再写死成 OEJTS 的四个维度与八个字母：
 * 维度键与两端展示记号都由**内容包**声明（OEJTS 用 EI/SN/TF/JP 与 I/E/S/N/T/F/J/P，
 * IPIP-50 用 E/A/C/ES/O 与 低/高）。这样同一套引擎可以承载不同量表，
 * 而 OEJTS 的官方符号表仍然在 `assessmentPackage.ts` 的仪器档案里被逐题钉死。
 */

/** 维度键。取值由内容包声明（OEJTS: 'EI'|'SN'|'TF'|'JP'；IPIP-50: 'E'|'A'|'C'|'ES'|'O'）。 */
export type Dimension = string

/** 维度某一端的展示记号（OEJTS: 'I'/'E'；IPIP-50: '低'/'高'）。 */
export type Pole = string

/**
 * 作答格式。
 *   - `bipolar`：一对相反描述 + 五档位置（OEJTS，1 = 左侧，5 = 右侧）
 *   - `agreement`：单句陈述 + 五档贴切度（IPIP，1 = 非常不贴切，5 = 非常贴切）
 */
export type AnswerFormat = 'bipolar' | 'agreement'

export interface Question {
  id: number
  /** `bipolar` 题的左端描述（1 端） */
  textLeft?: string
  /** `bipolar` 题的右端描述（5 端） */
  textRight?: string
  /** `agreement` 题的陈述句 */
  text?: string
  dimension: Dimension
  direction: 1 | -1
}

export interface ScoringConfig {
  midpoint: number
  constants: Record<Dimension, number>
}

export interface Questionnaire {
  version: string
  title: string
  questionCount: number
  estimatedMinutes: number
  scoring: ScoringConfig
  questions: Question[]
  /** 缺省 `bipolar`（兼容既有 OEJTS 包，不改其内容与签名） */
  format?: AnswerFormat
  /** 五档作答的文案（长度必须为 5）。缺省时用 `domain/answers` 的 OEJTS 文案。 */
  responseAnchors?: string[]
  /** 维度展示顺序；缺省时取仪器档案，再退化为"题目中首次出现的顺序"。 */
  dimensionOrder?: string[]
}

export type Clarity = 'A' | 'B' | 'C' | 'D'

/** 旧的四字母引擎结果（v1 只读入口用；新报告不再消费它）。 */
export interface DimensionResult {
  dimension: Dimension
  score: number
  intensity: number
  dominant: Pole
  secondary: Pole
  clarity: Clarity
  distance: number
}

export interface QuizResult {
  typeCode: string
  dimensions: DimensionResult[]
}
