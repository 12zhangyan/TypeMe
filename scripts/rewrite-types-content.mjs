#!/usr/bin/env node
/**
 * 用 `scripts/content/types-content.mjs` 重写后端 YAML 维护源
 * `backend/src/main/resources/content/types.yml`。
 *
 * 为什么要脚本而不是手改 YAML：
 *   - 16 型 × 9 个中文长文本字段，手改容易漏字段、也容易让引号/缩进漂移；
 *   - YAML 是运行时唯一真相，必须先保证结构稳定，再由 gen-fallback-content.mjs
 *     生成前端副本（**不分别手改两份数据**）。
 *
 * 用法：
 *   node scripts/rewrite-types-content.mjs           # 写入
 *   node scripts/rewrite-types-content.mjs --check   # 只校验 YAML 是否与数据源一致
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { CONTENT_DIR, DIMENSIONS, REQUIRED_TYPE_CODES, loadTypes } from './lib/backend-content.mjs'
import { TYPES, TYPES_HEADER } from './content/types-content.mjs'

const CHECK_ONLY = process.argv.includes('--check')
const TARGET = resolve(CONTENT_DIR, 'types.yml')

/** YAML 双引号字符串：反斜杠与双引号转义。 */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function render() {
  const lines = [...TYPES_HEADER, '', 'types:']
  for (const type of TYPES) {
    lines.push(`  - code: ${quote(type.code)}`)
    lines.push(`    nameCn: ${quote(type.nameCn)}`)
    lines.push(`    tagline: ${quote(type.tagline)}`)
    lines.push('    dimensions:')
    for (const dimension of DIMENSIONS) {
      lines.push(`      ${dimension}: ${quote(type.dimensions[dimension])}`)
    }
    for (const field of ['strengths', 'blindSpots', 'resonance', 'growth']) {
      lines.push(`    ${field}:`)
      for (const item of type[field]) {
        lines.push(`      - ${quote(item)}`)
      }
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

// --------------------------------------------------------------------- 数据源自检

const problems = []
if (TYPES.length !== REQUIRED_TYPE_CODES.length) {
  problems.push(`数据源类型数量应为 ${REQUIRED_TYPE_CODES.length}，实际 ${TYPES.length}`)
}
for (const code of REQUIRED_TYPE_CODES) {
  if (!TYPES.some((type) => type.code === code)) problems.push(`数据源缺少类型 ${code}`)
}
for (const type of TYPES) {
  const at = `${type.code}`
  if (!REQUIRED_TYPE_CODES.includes(type.code)) problems.push(`${at} 不是合法的类型码`)
  for (const field of ['nameCn', 'tagline']) {
    if (typeof type[field] !== 'string' || type[field].trim() === '') problems.push(`${at}.${field} 为空`)
  }
  for (const dimension of DIMENSIONS) {
    const value = type.dimensions?.[dimension]
    if (typeof value !== 'string' || value.trim() === '') problems.push(`${at}.dimensions.${dimension} 为空`)
  }
  for (const field of ['strengths', 'blindSpots', 'resonance', 'growth']) {
    if (!Array.isArray(type[field]) || type[field].length === 0) {
      problems.push(`${at}.${field} 必须是非空数组`)
      continue
    }
    type[field].forEach((item, index) => {
      if (typeof item !== 'string' || item.trim() === '') problems.push(`${at}.${field}[${index}] 为空`)
    })
  }
  // 描述名不做唯一性以外的硬校验，但重复一定说明抄错了
  if (TYPES.filter((other) => other.nameCn === type.nameCn).length > 1) {
    problems.push(`${at} 的描述名「${type.nameCn}」与其他类型重复`)
  }
}

if (problems.length > 0) {
  console.error('✗ 数据源自检失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

// --------------------------------------------------------------------- 写入 / 校验

const content = render()

if (CHECK_ONLY) {
  const existing = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : ''
  if (existing !== content) {
    console.error(`\n✗ ${TARGET} 与 scripts/content/types-content.mjs 不一致。`)
    console.error('  请执行 `node scripts/rewrite-types-content.mjs` 重新生成。\n')
    process.exit(1)
  }
  console.log('✓ types.yml 与内容数据源一致')
  process.exit(0)
}

writeFileSync(TARGET, content, 'utf8')

// 重新读一遍，确认生成结果是可解析、字段完整的（不信任"写成功"）
const reloaded = loadTypes()
if (reloaded.length !== TYPES.length) {
  console.error(`✗ 生成后读回的型数不对：${reloaded.length}`)
  process.exit(1)
}

console.log(`✓ 已重写 ${TARGET}`)
console.log(
  `  ${reloaded.length} 型 · 名称：${reloaded.map((type) => type.nameCn).join(' / ')}`,
)
