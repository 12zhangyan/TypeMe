import { DIMENSIONS, type Dimension } from './types'

/**
 * 新测的中文标签。
 *
 * ⚠️ **这些标签只用于说明"哪一维"**（例如"换到 INFP 需要在精力方向上偏离"），
 * 以及候选解释里指认维度。它们**不是**内容包里的维度名 —— 报告里每一维的
 * `name` / `question` / 两端标签一律取 `report_json` 里 `dimensions[]` 的同名字段
 * （见 `domain/reportV3.ts`），因为那才是与服务端内容包同版本、可复算的文案。
 *
 * 之所以仍然需要这份短名：候选解释要在一句话里指认维度，用内容包里的完整维度名
 * （"精力方向"）没问题，但**不能**凭空发明，所以这里按维度给一个与内容包一致的短名，
 * 并且在 `reportV3.ts` 里优先使用 `report_json.dimensions[].name`，这份常量只作为
 * 「报告里没有这一维的 name 时的指认用词」与「候选排序的展示顺序」使用。
 */
export const DIMENSION_SHORT_NAME: Record<Dimension, string> = {
  EI: '精力方向',
  SN: '信息偏好',
  TF: '判断依据',
  JP: '生活方式',
}

/** 按权威序（EI, SN, TF, JP）列出报告里出现的维度。 */
export function orderDimensions(values: readonly string[]): Dimension[] {
  const set = new Set(values)
  return DIMENSIONS.filter((dimension) => set.has(dimension))
}

/** 把任意字符串收窄成维度；认不出返回 null（不猜）。 */
export function asDimension(value: unknown): Dimension | null {
  if (typeof value !== 'string') return null
  return DIMENSIONS.find((dimension) => dimension === value) ?? null
}
