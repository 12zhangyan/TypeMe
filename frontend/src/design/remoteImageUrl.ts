/**
 * 远端图片地址的校验与归一化。
 *
 * 地址的**事实来源是数据库**（`illustration_asset` 表，前端从
 * `GET /api/v3/platform/illustrations` 读一次），不再由前端用"构建期域名 + 对象键"拼出来。
 * 所以这里只剩一件事：判断一个地址**能不能、该不该**拿去做 `<img src>`。
 *
 * 为什么前端还要再校验一遍（服务端写入时已经校验过）：
 *
 *   1. 加载一个 URL 就等于把它交给那个域名：浏览器会带上 **Referer、来源 IP、时间**。
 *      库里被手改过、或将来换了写入路径而少了校验时，这一层是"别把用户送到任意第三方"
 *      的最后一道；
 *   2. 校验失败不会让页面出错：该图直接用本地打包资源（见 `illustrationAssets.ts`），
 *      与"远端加载失败"是同一条降级路径。
 *
 * 关于协议，规则与迁移前刻意保持一致：
 *
 *   1. 只接受 `https://`——HTTPS 页面上的 HTTP 图片会被浏览器按混合内容拦掉，
 *      与其生成一批必然加载不出来的地址，不如直接用本地资源；
 *   2. 唯一的例外是回环地址（`localhost`、`127.0.0.1`、`::1`）：浏览器把它们视为
 *      可信来源，http 不会被拦，用于"本地模拟图片域名"的验收；
 *   3. 空值、协议不对、不是合法 URL、带用户名密码 → `undefined`，语义是"这个地址别用"。
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

/** 归一化远端图片地址；不合法或不该使用时返回 `undefined`（调用方据此改用本地资源）。 */
export function normalizeRemoteImageUrl(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return undefined
  }
  if (!parsed.hostname) return undefined

  const isHttps = parsed.protocol === 'https:'
  const isLoopbackHttp = parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())
  if (!isHttps && !isLoopbackHttp) return undefined

  // 带用户名密码的地址会把凭据交给那个域名，没有正当用途。
  if (parsed.username !== '' || parsed.password !== '') return undefined

  // 片段不会发给服务器，留着只会让"两个地址是否相同"的比较变得难以理解。
  parsed.hash = ''
  return parsed.href
}
