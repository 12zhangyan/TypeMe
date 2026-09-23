/** Freeze an item-by-item review worksheet from the currently published content snapshots. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from './lib/yaml.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const content = join(root, 'backend/src/main/resources/content')
const sourcePath = join(root, 'backend/src/main/resources/assessment-packages/ipip50-zh1.yml')
const outputPath = join(root, 'docs/2026-09-23-optimization/06-当前题目审校矩阵.md')
const jung = JSON.parse(readFileSync(join(content, 'typeme-jung48-zh-v4.json'), 'utf8'))
const bigFive = JSON.parse(readFileSync(join(content, 'bigfive50-zh-v1.json'), 'utf8'))
const sourceText = readFileSync(sourcePath, 'utf8')
const source = parseYaml(sourceText).questionnaire.questions
const check = process.argv.includes('--check')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function cell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>')
}
function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n')
}

assert(jung.packageId === 'typeme-jung48-zh-v4' && jung.questions.length === 64, 'Current Jung package changed; review generator needs inspection')
assert(bigFive.packageId === 'typeme-bigfive50-zh-v1' && bigFive.questions.length === 50, 'Current Big Five package changed; review generator needs inspection')
assert(source.length === 50, 'IPIP source count changed')

// English originals are YAML comments, not fields in the runtime content. Require one
// immediately before every source item instead of silently pairing by order.
const originals = new Map()
const lines = sourceText.split(/\r?\n/)
for (let i = 0; i < lines.length - 1; i++) {
  const match = lines[i].match(/^\s*# en: (\d+)\. (.+)$/)
  if (!match) continue
  const next = lines[i + 1].match(/^\s*- id: (\d+)\s*$/)
  assert(next && next[1] === match[1] && !originals.has(match[1]), `IPIP original/item mismatch at line ${i + 1}`)
  originals.set(match[1], match[2])
}
assert(originals.size === 50, 'IPIP English originals are incomplete')

const jungRows = jung.questions.map((q, index) => {
  assert(q.order === index + 1 && q.leftPole !== q.rightPole, `Jung item mismatch: ${q.id}`)
  return [q.id, q.stage, q.dimension, q.scenario, q.textLeft, q.leftPole, q.textRight, q.rightPole,
    q.help, q.facet, '待审校', '—']
})
const bigFiveRows = bigFive.questions.map((q, index) => {
  const original = source[index]
  assert(q.order === index + 1 && q.sourceItemId === String(original.id) && q.text === original.text
    && q.dimension === original.dimension && q.direction === original.direction, `Big Five source/snapshot mismatch: ${q.id}`)
  return [q.id, q.sourceItemId, originals.get(q.sourceItemId), q.text, q.dimension, q.direction,
    q.help, '待审校', '—']
})
const result = `# 当前题目审校矩阵（自动生成，未完成人工审校）

源：\`backend/src/main/resources/content/typeme-jung48-zh-v4.json\`（${jung.packageId}，SHA-256 ${jung.sha256}）；\`backend/src/main/resources/content/bigfive50-zh-v1.json\`（${bigFive.packageId}，SHA-256 ${bigFive.sha256}）；英文原句与大五中文源：\`backend/src/main/resources/assessment-packages/ipip50-zh1.yml\`。

运行 \`node scripts/gen-assessment-review.mjs --check\` 只读核对；源或当前包变化时须先审查版本策略，不能直接覆盖已绑定包。本表的“待审校”不是结论，不能据此宣称语言等值、信效度或常模。真人审校意见请另附记录，不直接填写在自动生成文件里。

## 十六型 v4（48 主测 + 16 补充）

左右极点按当前绑定内容包原样列出，不通过本表重定向计分。两名独立审校者应另记语义风险、重复、情境偏差与原始意见。

${table(['题号', '阶段', '维度', '情境', '左端', '左极', '右端', '右极', '帮助', '侧面', '状态', '证据编号'], jungRows)}

## 大五 v1（IPIP-50 原句 / 中文题面）

direction 是当前逐题计分键，不是效度结论；保留五维独立与原英文对照。中文解释较长，此处逐题保留以供理解检查。

${table(['包题号', '原题号', '英文原句', '中文题面', '维度', '计分方向', '中文帮助', '状态', '证据编号'], bigFiveRows)}
`

if (check) {
  assert(readFileSync(outputPath, 'utf8') === result, 'Review worksheet is missing or out of date; inspect sources before regenerating')
  console.log('Current assessment review worksheet matches the content snapshots')
} else {
  writeFileSync(outputPath, result)
  console.log('Generated current assessment review worksheet')
}
