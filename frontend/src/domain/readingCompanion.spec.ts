import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { questionExample } from './readingCompanion'
import { plainJungRows, plainBigFiveRow, readingParagraphs } from './plainReport'
import type { DimensionRowV3 } from './reportV3'
import type { BigFiveDimensionView } from '@/api/platformV3'
import examples from '@/content/readingCompanion.json'
import v1 from '../../../backend/src/main/resources/content/typeme-jung48-zh-v1.json'
import v2 from '../../../backend/src/main/resources/content/typeme-jung48-zh-v2.json'
import v3 from '../../../backend/src/main/resources/content/typeme-jung48-zh-v3.json'
import big from '../../../backend/src/main/resources/content/bigfive50-zh-v1.json'

/**
 * 目录里**所有已发布**的十六型内容包，而不是写死几个版本号。
 *
 * 写死 `[v1, v2]` 正是这次漏掉 v3 的原因：`JungPackageLoader.CURRENT_PACKAGE_ID`
 * 已经换成 `typeme-jung48-zh-v3`，新草稿一律绑定 v3，而阅读说明只覆盖到 v2 ——
 * 主流程每一道题的"想一个这样的场景"都不显示，测试却全绿。
 * 以后再加 v4、v5，只要文件进了内容目录就会被这里逐个检查。
 */
const CONTENT_DIR = resolve(__dirname, '../../../backend/src/main/resources/content')
const jungPackages = readdirSync(CONTENT_DIR)
  .filter((name) => /^typeme-jung48-zh-v\d+\.json$/.test(name))
  .sort()
  .map((name) => JSON.parse(readFileSync(resolve(CONTENT_DIR, name), 'utf8')) as typeof v1)

describe('题目阅读说明与历史版本', () => {
  it('每一版十六型的 64 题和大五 50 题均匹配实际题面', () => {
    // 178 = 十六型 v1 64 + v2 64 + 大五 50。v3 复用 v2 的记录（题面逐字相同，见下一条），
    // 所以这里不因 v3 变多；真要给 v3 补自己的记录时，改这个数字并去掉复用声明。
    expect(examples).toHaveLength(178)
    expect(jungPackages.map((pkg) => pkg.packageId)).toEqual(
      expect.arrayContaining(['typeme-jung48-zh-v1', 'typeme-jung48-zh-v2', 'typeme-jung48-zh-v3']),
    )
    for (const pkg of jungPackages) for (const question of pkg.questions) {
      expect(questionExample(pkg.packageId, question), `${pkg.packageId}/${question.id}`).toBeTruthy()
    }
    for (const question of big.questions) expect(questionExample(big.packageId, { id: question.id, statement: question.text })).toBeTruthy()
  })
  it('记录不会挂在一个并不存在的内容包上（写错版本号就等于没写）', () => {
    const known = new Set<string>([...jungPackages.map((pkg) => pkg.packageId), big.packageId])
    for (const copy of examples) expect(known.has(copy.packageId), copy.packageId).toBe(true)
  })
  it('复用另一版的说明只在题面逐字相同时成立，不按版本号"认亲"', () => {
    // 这是"v3 可以复用 v2 的说明"这个前提本身：v3 与 v2 的差别只在 scoringPolicy。
    // 一旦有人改了 v3 的题面，这里先红，提示要么给 v3 补自己的记录，要么重新核对后
    // 再声明复用 —— 而不是让页面继续拿旧说法解释一道已经改过的题。
    expect(v3.questions).toEqual(v2.questions)
    const item = v3.questions[0]
    expect(questionExample(v3.packageId, { ...item, scenario: `${item.scenario}（改过的题面）` })).toBeNull()
    expect(questionExample(v3.packageId, { ...item, textRight: '改过的另一端' })).toBeNull()
  })
  it('不拿旧说明解释另一个版本、被改过的题面或缺失的题', () => {
    const item = v1.questions[0]
    expect(questionExample('future-package', item)).toBeNull()
    expect(questionExample(v1.packageId, { ...item, textLeft: '另一种含义' })).toBeNull()
    expect(questionExample(v1.packageId, null)).toBeNull()
    expect(questionExample(v1.packageId, { ...item, id: 'unknown' })).toBeNull()
  })
})

describe('报告简明解释保留不确定性', () => {
  const row = { dimension: 'EI', negativePole: 'I', positivePole: 'E', computedPole: 'I', boundary: false, coverageOk: true } as DimensionRowV3
  it('按存档方向解释，不使用候选类型或重新计算分数', () => {
    const original = JSON.stringify(row)
    expect(plainJungRows([row])[0].result).toContain('先想好再说')
    expect(plainJungRows([{ ...row, computedPole: 'E' }])[0].result).toContain('边说边想')
    expect(JSON.stringify(row)).toBe(original)
  })
  it('略偏同时解释两边，平分不给方向，缺答不解释成中间', () => {
    const boundary = plainJungRows([{ ...row, boundary: true }])[0].result
    expect(boundary).toContain('差距很小')
    expect(boundary).toContain('先想好再说')
    expect(boundary).toContain('边说边想')
    expect(plainJungRows([{ ...row, computedPole: null }])[0].result).toContain('没有偏向哪边')
    expect(plainJungRows([{ ...row, coverageOk: false }])[0].result).toBe('这方面可用的回答还不够，暂时不能判断。')
  })
  it('大五保持五个独立方向，信息不足不变成有结果', () => {
    const row = { dimension: 'ES', hasResult: true, direction: 'low' } as BigFiveDimensionView
    expect(plainBigFiveRow(row)?.result).toContain('紧张或心情起伏')
    expect(plainBigFiveRow({ ...row, direction: 'high' })?.result).toContain('心情比较平稳')
    expect(plainBigFiveRow({ ...row, direction: 'middle' })?.result).toContain('没有明显偏向')
    expect(plainBigFiveRow({ ...row, hasResult: false })?.result).toContain('暂时不能判断')
    expect(plainBigFiveRow({ ...row, dimension: 'unknown' })).toBeNull()
  })
  it('长段落只分段，不删除或替换原文', () => {
    const text = '“这是什么？”先看具体例子。'.repeat(15) + '最后一句没有句号'
    const paragraphs = readingParagraphs(text)
    expect(paragraphs.length).toBeGreaterThan(1)
    expect(paragraphs.join('')).toBe(text)
  })
})
