import { describe, expect, it } from 'vitest'
import { normalizeRemoteImageUrl } from './remoteImageUrl'

/**
 * 远端图片地址的准入规则。
 *
 * 这些断言守的不是"格式好看"，而是两条真实后果：
 *   - 公网 http 地址在 HTTPS 页面上必然被浏览器拦掉（生成它就是生成一个死链）；
 *   - 带凭据的地址会把凭据交给那个域名（没有任何正当用途）。
 */
describe('远端图片地址校验', () => {
  it('空值与缺失一律返回 undefined（语义是"这个地址别用"）', () => {
    expect(normalizeRemoteImageUrl(undefined)).toBeUndefined()
    expect(normalizeRemoteImageUrl(null)).toBeUndefined()
    expect(normalizeRemoteImageUrl('')).toBeUndefined()
    expect(normalizeRemoteImageUrl('   ')).toBeUndefined()
  })

  it('只接受 https，且保留完整路径与内容哈希', () => {
    const url = 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/home-hero.4583aa734b96.webp'
    expect(normalizeRemoteImageUrl(url)).toBe(url)
    expect(normalizeRemoteImageUrl(`  ${url}  `)).toBe(url)
  })

  it('公网 http / 非 http 协议 / 相对地址一律拒绝', () => {
    expect(normalizeRemoteImageUrl('http://img.example.com/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('//img.example.com/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('img.example.com/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('ftp://img.example.com/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizeRemoteImageUrl('data:image/webp;base64,AAAA')).toBeUndefined()
  })

  it('回环地址额外允许 http，用于本地模拟图片域名的验收', () => {
    expect(normalizeRemoteImageUrl('http://127.0.0.1:5199/illustrations/a.webp'))
      .toBe('http://127.0.0.1:5199/illustrations/a.webp')
    expect(normalizeRemoteImageUrl('http://localhost:5199/a.webp')).toBe('http://localhost:5199/a.webp')
    // 看着像回环但不是：`127.0.0.1.evil.com` 是公网域名，不能因为前缀而被放行
    expect(normalizeRemoteImageUrl('http://127.0.0.1.evil.com/a.webp')).toBeUndefined()
  })

  it('带用户名密码的地址被拒绝', () => {
    expect(normalizeRemoteImageUrl('https://user:pass@img.example.com/a.webp')).toBeUndefined()
    expect(normalizeRemoteImageUrl('https://user@img.example.com/a.webp')).toBeUndefined()
  })

  it('保留查询串、丢掉片段（片段本来就不会发给服务器）', () => {
    expect(normalizeRemoteImageUrl('https://img.example.com/a.webp?v=2')).toBe('https://img.example.com/a.webp?v=2')
    expect(normalizeRemoteImageUrl('https://img.example.com/a.webp#top')).toBe('https://img.example.com/a.webp')
  })
})
