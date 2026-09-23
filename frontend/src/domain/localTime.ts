/** Server timestamps are UTC ISO strings; render them in the reader's local time zone. */
export function formatLocalTime(value: string | null | undefined): string {
  if (!value) return '（没有记录时间）'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '（时间不可解析）'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
