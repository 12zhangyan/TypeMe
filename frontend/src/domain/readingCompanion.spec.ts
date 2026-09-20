import { describe, expect, it } from 'vitest'
import { questionExample } from './readingCompanion'
import { plainJungRows, plainBigFiveRow, readingParagraphs } from './plainReport'
import type { DimensionRowV3 } from './reportV3'
import type { BigFiveDimensionView } from '@/api/platformV3'
import examples from '@/content/readingCompanion.json'
import v1 from '../../../backend/src/main/resources/content/typeme-jung48-zh-v1.json'
import v2 from '../../../backend/src/main/resources/content/typeme-jung48-zh-v2.json'
import big from '../../../backend/src/main/resources/content/bigfive50-zh-v1.json'

describe('题目阅读说明与历史版本', () => {
  it('两个十六型版本的 64 题和大五 50 题均匹配实际题面', () => {
    expect(examples).toHaveLength(178)
    for (const pkg of [v1, v2]) for (const question of pkg.questions) {
      expect(questionExample(pkg.packageId, question), `${pkg.packageId}/${question.id}`).toBeTruthy()
    }
    for (const question of big.questions) expect(questionExample(big.packageId, { id: question.id, statement: question.text })).toBeTruthy()
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
