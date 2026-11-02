import { describe, expect, it } from 'vitest'
import { illustrationAsset, illustrationLocalAsset, illustrationLocalFallback } from './illustrationAssets'

/**
 * 统一资源解析处的接线：**同一份代码**在"地址表里没有这张图"与"有远端地址"下的行为。
 *
 * 关键断言不是"地址长什么样"，而是：
 *   - 地址表缺失 / 没有这张图 → 完全维持原来的本地资源行为（不产生任何外链）；
 *   - 地址表里有 → 用**库里的绝对地址原样加载**（前端不再拼域名，也不再猜构建产物名）；
 *   - 地址不可用（http、带凭据、不是 URL）→ 回落本地资源，而不是把一个必然加载不出来的
 *     地址塞进 `<img src>`；
 *   - 只有"当前确实在用远端地址"时才提供一次本地回退。
 */
const REMOTE = 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com'
const map = {
  'assessment-bigfive': `${REMOTE}/illustrations/2026-09-20/assessment-bigfive.e13c9e572c1c.webp`,
  'home-hero': `${REMOTE}/illustrations/2026-09-20/home-hero.4583aa734b96.webp`,
  'type-infp': `${REMOTE}/illustrations/2026-09-20/type-infp.6f366d5766eb.webp`,
}

describe('插画资源解析：本地 / 远端地址表两种模式', () => {
  it('没有地址表时使用本地打包资源，不产生任何外链', () => {
    const url = illustrationAsset('assessment-bigfive')
    expect(url).toBeTruthy()
    expect(url).not.toMatch(/^https?:/)
    expect(url).toBe(illustrationLocalAsset('assessment-bigfive'))
    expect(illustrationAsset('assessment-bigfive', {})).toBe(illustrationLocalAsset('assessment-bigfive'))
    expect(illustrationAsset('assessment-bigfive', null)).toBe(illustrationLocalAsset('assessment-bigfive'))
  })

  it('地址表里有这张图时用的是库里的绝对地址（不再拼接、不再猜文件名）', () => {
    expect(illustrationAsset('assessment-bigfive', map)).toBe(map['assessment-bigfive'])
    expect(illustrationAsset('type-infp', map)).toBe(map['type-infp'])
  })

  it('地址不可用时回落本地资源，不生成会被浏览器拦掉或把凭据送出去的地址', () => {
    for (const bad of [
      'http://yan-public-1407914221.cos.ap-beijing.myqcloud.com/a.webp',
      'https://user:pass@yan-public-1407914221.cos.ap-beijing.myqcloud.com/a.webp',
      'not-a-url',
      '/illustrations/a.webp',
      '',
    ]) {
      const url = illustrationAsset('assessment-bigfive', { 'assessment-bigfive': bad })
      expect(url, `地址「${bad}」不应被采用`).toBe(illustrationLocalAsset('assessment-bigfive'))
    }
  })

  it('地址表里没有的名字用本地资源；本地也没有时返回 undefined（走兜底 SVG，不请求缺失文件）', () => {
    expect(illustrationAsset('welcome', { 'assessment-bigfive': map['assessment-bigfive'] })).toBe(illustrationLocalAsset('welcome'))
    expect(illustrationAsset('type-zzzz', map)).toBeUndefined()
    expect(illustrationLocalAsset('type-zzzz')).toBeUndefined()
    expect(illustrationLocalFallback('type-zzzz', map)).toBeUndefined()
  })

  it('本地模拟图片域名（回环 http）被接受，用于验收', () => {
    const mock = 'http://127.0.0.1:5199/illustrations/2026-09-20/assessment-bigfive.e13c9e572c1c.webp'
    expect(illustrationAsset('assessment-bigfive', { 'assessment-bigfive': mock })).toBe(mock)
  })

  it('只为"当前确实在用远端地址"的图片提供一次本地回退', () => {
    const fallback = illustrationLocalFallback('assessment-bigfive', map)
    expect(fallback).toBeTruthy()
    expect(fallback).not.toMatch(/^https?:/)
    expect(fallback).not.toBe(illustrationAsset('assessment-bigfive', map))

    // 本地为主时没有回退目标：失败就直接是兜底 SVG，行为与接入前一致
    expect(illustrationLocalFallback('assessment-bigfive')).toBeUndefined()
    expect(illustrationLocalFallback('assessment-bigfive', {})).toBeUndefined()
  })

  it('仅远端提供的插画（本地不随包）：用库里的地址，没有本地回退，远端失败直接走兜底 SVG', () => {
    // home-hero / assessment-jung 自 2026-11-01 起只由图片域名提供，见 assets/illustrations/README.md
    for (const name of ['home-hero', 'assessment-jung']) {
      expect(illustrationLocalAsset(name)).toBeUndefined()
      expect(illustrationLocalFallback(name, map)).toBeUndefined()
      expect(illustrationAsset(name)).toBeUndefined()
    }
    expect(illustrationAsset('home-hero', map)).toBe(map['home-hero'])
  })
})
