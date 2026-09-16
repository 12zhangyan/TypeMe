#!/usr/bin/env node
/**
 * 临时分析脚本（非交付物）：统计 `backend/src/main/resources/content/types.yml`
 * 的跨类型自我重复，为 MI-12 去重提供可核验的清单。
 *
 * 做法：先把每型切成「文本单元」（tagline / dimensions.* / strengths[i] / ...），
 * 再对每对单元求最长公共子串；报告所有 >= 阈值（默认 6 字）的重合。
 *
 * 用法：node scripts/_dedup-report.mjs [阈值，默认 6]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const TYPES_PATH = resolve(repoRoot, 'backend/src/main/resources/content/types.yml')
const MIN_LEN = Number(process.argv[2] ?? 6)

function unquote(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** 只解析 types.yml 用到的 YAML 子集：固定缩进层级。 */
function parseTypesYaml(text) {
  const types = []
  let current = null
  let section = null // dimensions | strengths | blindSpots | resonance | growth

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const line = raw.trim()
    if (line === 'types:') continue

    if (indent === 2 && line.startsWith('- ')) {
      current = { dimensions: {}, strengths: [], blindSpots: [], resonance: [], growth: [] }
      types.push(current)
      section = null
      const kv = line.slice(2).match(/^(\w+):\s*(.*)$/)
      if (kv) current[kv[1]] = unquote(kv[2])
      continue
    }
    if (!current) continue

    const kv = line.match(/^(\w+):\s*(.*)$/)
    if (indent === 4 && kv) {
      const [, key, value] = kv
      if (value === '') {
        section = key
      } else {
        current[key] = unquote(value)
        section = null
      }
      continue
    }
    if (indent === 6 && line.startsWith('- ')) {
      if (!section) throw new Error(`列表项没有归属：${line}`)
      current[section].push(unquote(line.slice(2)))
      continue
    }
    if (indent === 6 && kv && section === 'dimensions') {
      current.dimensions[kv[1]] = unquote(kv[2])
      continue
    }
    throw new Error(`解析器未覆盖的行（indent=${indent}）：${line}`)
  }
  return types
}

const types = parseTypesYaml(readFileSync(TYPES_PATH, 'utf8'))
console.log(`解析到 ${types.length} 个类型：${types.map((t) => t.code).join(', ')}\n`)

function unitsOf(profile) {
  const units = [{ field: 'tagline', text: profile.tagline }]
  for (const [dim, body] of Object.entries(profile.dimensions)) {
    units.push({ field: `dimensions.${dim}`, text: body })
  }
  for (const key of ['strengths', 'blindSpots', 'resonance', 'growth']) {
    profile[key].forEach((item, index) => units.push({ field: `${key}[${index}]`, text: item }))
  }
  return units
}

/** 最长公共子串（两行 DP，够用）。 */
function longestCommonSubstring(a, b) {
  let best = { len: 0, text: '' }
  const prev = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let diag = 0
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1
        if (prev[j] > best.len) best = { len: prev[j], text: a.slice(i - prev[j], i) }
      } else {
        prev[j] = 0
      }
      diag = tmp
    }
  }
  return best
}

const withUnits = types.map((profile) => ({ code: profile.code, units: unitsOf(profile) }))
const findings = []
for (let i = 0; i < withUnits.length; i++) {
  for (let j = i + 1; j < withUnits.length; j++) {
    for (const left of withUnits[i].units) {
      for (const right of withUnits[j].units) {
        const lcs = longestCommonSubstring(left.text, right.text)
        if (lcs.len >= MIN_LEN) {
          findings.push({
            a: withUnits[i].code,
            aField: left.field,
            b: withUnits[j].code,
            bField: right.field,
            len: lcs.len,
            text: lcs.text,
          })
        }
      }
    }
  }
}
findings.sort((x, y) => y.len - x.len || x.a.localeCompare(y.a))

console.log(`跨类型公共子串 >= ${MIN_LEN} 字：共 ${findings.length} 处\n`)
for (const f of findings) {
  console.log(`${String(f.len).padStart(3)}  ${f.a}.${f.aField} <-> ${f.b}.${f.bField}\n     「${f.text}」`)
}
const byLength = new Map()
for (const f of findings) byLength.set(f.len, (byLength.get(f.len) ?? 0) + 1)
console.log(
  '\n按长度分布：',
  [...byLength.entries()].sort((a, b) => b[0] - a[0]).map(([k, v]) => `${k}字×${v}`).join(', '),
)
