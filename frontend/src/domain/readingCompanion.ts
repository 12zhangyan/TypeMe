import examples from '@/content/readingCompanion.json'

type Copy = (typeof examples)[number]

/**
 * 显式声明"哪一版可以复用另一版的阅读说明"。
 *
 * `typeme-jung48-zh-v3` 与 v2 的题目**逐字相同**，差别只在它声明的
 * `scoringVersion`（见 `JungPackageLoader.CURRENT_PACKAGE_ID` 的注释）；v3 是当前默认包，
 * 新草稿一律绑定它，所以这里必须能查到说明，否则主流程 48 主测题 + 16 补充题都不会显示
 * "想一个这样的场景"。
 *
 * 复用是**显式且可校验**的，不靠版本号猜：
 * 1. 只有本版本**一条记录都没有**时才会走到这张表（见 `questionExample`），
 *    以后给 v3 补了自己的记录，它们自动优先，不会被这里顶掉；
 * 2. 命中之后仍然逐字比对题面（`scenario`/`textLeft`/`textRight` 或 `statement`），
 *    有一字不同就返回 `null`，绝不会拿旧说法解释一道改过的题；
 * 3. `readingCompanion.spec.ts` 钉住前提"v3 题面 == v2 题面"，题面一改就红，
 *    提醒要么补 v3 自己的记录，要么重新核对后再声明复用。
 */
const REUSED_WORDING: Record<string, string> = {
  'typeme-jung48-zh-v3': 'typeme-jung48-zh-v2',
}

/** 按内容包分组，避免每次渲染都遍历整份记录。 */
const byPackage = new Map<string, Copy[]>()
for (const copy of examples as Copy[]) {
  const list = byPackage.get(copy.packageId)
  if (list) list.push(copy)
  else byPackage.set(copy.packageId, [copy])
}

/** Reading aid only. Match both the saved version and wording; never infer from an item ID alone. */
export function questionExample(packageId: string | undefined, item: {
  id: string; scenario?: string | null; textLeft?: string | null; textRight?: string | null; statement?: string | null
} | null): string | null {
  if (!packageId || !item) return null
  // 有自己记录的版本只认自己的记录：哪怕缺了某一道题，也不借别的版本来补。
  const own = byPackage.get(packageId)
  const pool = own ?? byPackage.get(REUSED_WORDING[packageId] ?? '')
  const copy = pool?.find((entry) => entry.id === item.id)
  if (!copy) return null
  if (copy.statement !== undefined) return copy.statement === item.statement ? copy.example : null
  return copy.scenario === item.scenario && copy.textLeft === item.textLeft && copy.textRight === item.textRight ? copy.example : null
}
