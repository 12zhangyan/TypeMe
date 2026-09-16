#!/usr/bin/env node
/**
 * 跨类型重复自检 —— 与后端 `ContentValidationTest.typesHaveNoCrossTypeDuplication` 同一算法。
 *
 * 后端那条断言要求：**16 型任意两个字段之间不得出现 ≥6 字的连续重合**。
 * 在 Java 里跑一次要几十秒且中文输出在 Windows 控制台会乱码，所以这里做一个
 * 等价的本地检查器（最长公共子串 + 同一阈值），方便在改文案时快速迭代。
 *
 * 用法：node scripts/check-type-duplication.mjs
 */
import { loadTypes } from './lib/backend-content.mjs'

const MAX_SHARED_RUN = 6

function longestCommonSubstring(a, b) {
  let best = ''
  const prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i += 1) {
    let lastDiagonal = 0
    for (let j = 1; j <= b.length; j += 1) {
      const saved = prev[j]
      prev[j] = a[i - 1] === b[j - 1] ? lastDiagonal + 1 : 0
      if (prev[j] > best.length) best = a.substring(i - prev[j], i)
      lastDiagonal = saved
    }
  }
  return best
}

function unitsOf(type) {
  const units = [['tagline', type.tagline]]
  for (const [dimension, body] of Object.entries(type.dimensions)) {
    units.push([`dimensions.${dimension}`, body])
  }
  for (const field of ['strengths', 'blindSpots', 'resonance', 'growth']) {
    type[field].forEach((value, index) => units.push([`${field}[${index}]`, value]))
  }
  return units
}

const types = loadTypes()
const findings = []
for (let i = 0; i < types.length; i += 1) {
  for (let j = i + 1; j < types.length; j += 1) {
    for (const [leftKey, leftValue] of unitsOf(types[i])) {
      for (const [rightKey, rightValue] of unitsOf(types[j])) {
        const shared = longestCommonSubstring(leftValue, rightValue)
        if (shared.length >= MAX_SHARED_RUN) {
          findings.push({
            left: `${types[i].code}.${leftKey}`,
            right: `${types[j].code}.${rightKey}`,
            run: shared,
            length: shared.length,
          })
        }
      }
    }
  }
}

// 按重合长度倒序：先修最长的，改动一次常常会同时消掉好几条
findings.sort((a, b) => b.length - a.length)

console.log(`跨类型 >= ${MAX_SHARED_RUN} 字连续重合：${findings.length} 处\n`)
for (const item of findings) {
  console.log(`[${String(item.length).padStart(2)}] ${item.left} <-> ${item.right}`)
  console.log(`     「${item.run}」`)
}

if (findings.length === 0) {
  console.log('✓ 无跨类型模板复用')
  process.exit(0)
}
process.exit(1)
