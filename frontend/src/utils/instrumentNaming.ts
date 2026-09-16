import { instrumentHasTypeCode, packageDimensionOrder } from '@/domain/assessmentPackage'
import type { AssessmentPackage } from '@/domain/assessmentPackage'

/**
 * 量表展示名 —— 站点上每一处说"这是哪份量表"的地方都从这里取，不各写一遍。
 *
 * 这里**只**描述旧引擎（本地计分，`/quiz` + `/result` + 方法页 `/about`）的两版内容包。
 * 新测（`typeme-jung48`）的名称与题数一律走 `stores/instrumentV3.ts`（目录接口
 * `GET /api/v3/catalog/current`），不要在这里取 —— 把新站的顶栏副标题挂到旧内容包上
 * 正是 `docs/2026-09-16/verification/browser-acceptance.md` 的问题 1 / 问题 2。
 *
 * 为什么不是写死「四维 / 大五」：旧引擎挂着两版内容包，OEJTS-32 产出四字母类型码，
 * IPIP-50 是不产出类型码的五维大五量表 —— 把「四维」按到 IPIP 头上会让用户以为
 * 它也会给出一个类型。
 */
export function legacyInstrumentTagline(pkg: AssessmentPackage | null | undefined): string {
  if (!pkg) return '人格倾向自测'
  if (instrumentHasTypeCode(pkg)) {
    return `${packageDimensionOrder(pkg).length} 维人格倾向自测`
  }
  return '大五人格倾向自测'
}

/**
 * 旧引擎的路由名 —— 与 `router/index.ts` 里注册的 `name` 一一对应。
 *
 * 为什么只有这两个：
 *   - `quiz` / `result`：旧引擎的答题页与结果页，跑的确实是本地计分的旧量表。
 *
 * ⚠️ 2026-09-16：`about` **已从这个列表移除**。
 * 方法页（`/about`）此前被当成旧引擎页面，于是它整页的顶栏副标题与页脚署名都用
 * 旧内容包渲染 —— 而这一页现在整篇讲的是新测（`typeme-jung48`），并且是首页
 * 「方法与隐私」链接的落点。结果是"页内说十六型、顶栏说大五"的自相矛盾。
 * `/about` 里只剩「本地记录」一节还在讲旧引擎，那一节自带说明，不需要整页挂旧署名。
 */
const LEGACY_ENGINE_ROUTE_NAMES: readonly string[] = ['quiz', 'result']

/** 当前路由是不是旧引擎（旧站）的页面。 */
export function isLegacyEngineRoute(name: unknown): boolean {
  return typeof name === 'string' && LEGACY_ENGINE_ROUTE_NAMES.includes(name)
}
