// Curated local images only. Missing artwork uses the designed SVG fallback, without 404 requests.
// Add files using the names in assets/illustrations/README.md, then rebuild.
//
// 这个文件是**全站唯一的插画地址解析处**（消费者只有 `components/IllustrationFrame.vue`），
// 页面里不硬编码任何远程 URL。
//
// ## 地址从哪来（2026-09-20 起改为数据库驱动）
//
// 远端地址不再由构建期环境变量拼出来，而是：
//
//     数据库 illustration_asset ──GET /api/v3/platform/illustrations──> stores/illustrationAssetsV3
//                                                                          │  （名字 → 绝对地址）
//                                                                          ▼
//                                                        illustrationAsset(name, 地址表)
//
// 这么改的原因：换一张图以前要重新构建、发布前端；现在改库里的行即可（管理接口
// `PUT /api/v3/platform/illustrations`）。见 `docs/2026-09-20/图片URL入库方案.md`。
//
// 代价与对策：地址表是**异步**到的，首屏第一次访问时它可能还没到。取舍是
// "宁可短暂占位，也不从源站下一张即将被替换的图"：等不到就用本地资源，
// 上限由 store 的等待预算控制（`stores/illustrationAssetsV3.ts`）。
//
// 本地素材**继续随包发布**：它既是"地址表里没有这张图"时的资源，也是远端加载失败时
// 唯一一次回退的目标（见 `illustrationLocalFallback`）。
import { normalizeRemoteImageUrl } from './remoteImageUrl'

const files = import.meta.glob<string>('../assets/illustrations/*.{webp,png,avif}', {
  eager: true, import: 'default', query: '?url',
})

/**
 * 远端地址表：`名字 → 绝对地址`。
 *
 * 由调用方（store）提供，**不在这里读 store**：这个模块要能被单测直接调用，
 * 也要在"地址表还没到"时有明确的行为（传空表）。
 */
export type RemoteIllustrationUrls = Readonly<Record<string, string>> | null | undefined

/** 本地打包资源地址；名字不存在时返回 `undefined`（页面据此走兜底 SVG，不请求缺失文件）。 */
export function illustrationLocalAsset(name: string): string | undefined {
  for (const extension of ['webp', 'avif', 'png']) {
    const url = files[`../assets/illustrations/${name}.${extension}`]
    if (url) return url
  }
  return undefined
}

/**
 * 页面实际使用的地址：地址表里有这张图且地址可用 → 远端对象存储；否则本地资源。
 *
 * 地址不可用（协议不对、带凭据、不是 URL）时**不报错、不抛**：改用本地资源。
 * 这与"远端加载失败"落到同一个地方，页面表现一致。
 */
export function illustrationAsset(name: string, remote?: RemoteIllustrationUrls): string | undefined {
  const local = illustrationLocalAsset(name)
  const candidate = remote?.[name]
  if (!candidate) return local
  return normalizeRemoteImageUrl(candidate) ?? local
}

/**
 * 远端失败后允许回退**一次**的本地地址。
 *
 * 只有"当前用的确实是远端地址、且本地确实有同一张图"时才给出；否则返回 `undefined`，
 * 调用方据此直接走兜底 SVG——既不会回退到同一个远端地址，也不会反复重试。
 */
export function illustrationLocalFallback(name: string, remote?: RemoteIllustrationUrls): string | undefined {
  const local = illustrationLocalAsset(name)
  if (!local) return undefined
  return local === illustrationAsset(name, remote) ? undefined : local
}
