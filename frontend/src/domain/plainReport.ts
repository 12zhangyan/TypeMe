import type { DimensionRowV3 } from './reportV3'
import type { BigFiveDimensionView } from '@/api/platformV3'

export interface PlainReading { title: string; result: string; example: string }

/** Preserve every character of stored prose; only add paragraph boundaries for reading. */
export function readingParagraphs(text: string): string[] {
  const sentences = text.split(/(?<=[。！？])/u)
  const paragraphs: string[] = []
  let current = ''
  for (const sentence of sentences) {
    current += sentence
    if (current.length >= 65) { paragraphs.push(current); current = '' }
  }
  if (current) paragraphs.push(current)
  return paragraphs
}

const jung = {
  EI: { title: '和人相处、整理想法', I: '独处一会儿，或先想好再说', E: '和人交流，或边说边想', example: '比如，有个新想法时，你想先自己想一想，还是找人聊聊？' },
  SN: { title: '了解一件新事物', S: '先看具体例子和实际细节', N: '先看整体思路和可能的发展', example: '比如，学习新东西时，你想先看操作示范，还是先知道它为什么这样运作？' },
  TF: { title: '拿主意时先考虑什么', T: '先比较理由和判断标准', F: '先考虑人的感受和在意的事', example: '比如，几个人意见不同时，你会先比较方案，还是先了解大家的顾虑？' },
  JP: { title: '怎样安排要做的事', J: '先定好安排，再按计划推进', P: '留一些余地，边做边调整', example: '比如，有一天自由时间，你想先排好安排，还是当天再决定？' },
} as const

/** Explain stored poles and uncertainty; do not rescore or infer ability from a type label. */
export function plainJungRows(rows: readonly DimensionRowV3[]): PlainReading[] {
  return rows.map(row => {
    const copy = jung[row.dimension]
    const sides = Object.fromEntries(Object.entries(copy).filter(([key]) => key.length === 1))
    const both = `${sides[row.negativePole]}；${sides[row.positivePole]}`
    let result: string
    if (!row.coverageOk) result = '这方面可用的回答还不够，暂时不能判断。'
    else if (row.computedPole === null) result = `这次两边得分相同，没有偏向哪边。两种做法都可以看看：${both}。`
    else if (!sides[row.computedPole]) result = '请查看下方保存的原报告说明。'
    else if (row.boundary) result = `这次稍微偏向「${sides[row.computedPole]}」，但差距很小。另一边是「${sides[row.computedPole === row.negativePole ? row.positivePole : row.negativePole]}」，也值得一起看。`
    else result = `这次回答更偏向「${sides[row.computedPole]}」。`
    return { title: copy.title, result, example: copy.example }
  })
}

const bigFive = {
  E: ['和别人相处', '偏安静、少说一些', '偏活跃、主动交流', '比如，一群人聊天时，你更常听别人说，还是主动加入？'],
  A: ['怎样与人相处', '更直接表达自己的看法', '更留意别人的感受与需要', '比如，意见不同时，你通常怎样表达自己的想法？'],
  C: ['做事和安排时间', '做事安排更随意', '更重视准备、顺序和完成计划', '比如，几件事同时要做时，你会不会先排好顺序？'],
  ES: ['面对压力时的感受', '更容易紧张或心情起伏', '心情比较平稳、不容易受干扰', '比如，安排临时变动后，你的心情通常会受多大影响？这不是心理健康判断。'],
  O: ['对新事物的兴趣', '更喜欢熟悉、具体的内容', '更喜欢新想法和不同的体验', '比如，遇到一个没接触过的话题，你会想继续了解吗？'],
} as const

export function plainBigFiveRow(row: BigFiveDimensionView): PlainReading | null {
  const copy = bigFive[row.dimension as keyof typeof bigFive]
  if (!copy) return null
  const result = !row.hasResult ? '这方面可用的回答还不够，暂时不能判断。'
    : row.direction === 'middle' ? `这次没有明显偏向。两边分别是「${copy[1]}」和「${copy[2]}」。`
    : `这次回答偏向「${row.direction === 'high' ? copy[2] : copy[1]}」。偏向的程度请看本项结果标签。`
  return { title: copy[0], result, example: copy[3] }
}
