/**
 * 中文数字 —— 报告与首页里「N 个维度」这类计数文案的唯一出处。
 *
 * 为什么需要它：站点默认量表已换成**五维**的大五，而页面里多处写死了「四个维度」。
 * 计数文案一旦各处自己拼，换量表就会出现「五个维度本次都有较明确的方向」配
 * 「四个维度上的结果」这种自相矛盾（真实出现过）。统一走这里，就不会再各写一份。
 *
 * 只处理 0–10（量表维度数的现实范围）：超出范围时回退成阿拉伯数字，不编造中文读法。
 */
export function chineseNumeral(value: number): string {
  const NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (!Number.isInteger(value) || value < 0 || value >= NUMERALS.length) return String(value)
  return NUMERALS[value]
}

/** 「五个维度」这样的计数短语（维度数为 0 时也说「0 个维度」，不隐藏事实）。 */
export function dimensionCountPhrase(count: number): string {
  return `${chineseNumeral(count)}个维度`
}
