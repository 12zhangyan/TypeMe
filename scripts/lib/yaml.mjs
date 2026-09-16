/**
 * 极小的 YAML 子集解析器（IM-1 生成链路的唯一依赖）。
 *
 * 为什么不用 js-yaml：本仓库的前端 Node 工具链是离线的（`frontend/node_modules` 里既没有
 * `js-yaml` 也没有 `yaml`），而生成脚本要在本地与 CI 上都能跑。这里只实现
 * `backend/src/main/resources/content/*.yml` 实际用到的那一小撮语法，并且**遇到不认识的
 * 写法立刻抛错**——宁可构建失败，也不要静默解析出一份错的内容写进前端。
 *
 * 支持的子集：
 *   - 块映射 / 块序列，含 `- key: value` 之后继续写同级键的写法；缩进用空格；
 *   - 单引号 / 双引号标量（双引号支持 `\"`、`\\`、`\n`、`\t`、`\uXXXX`）；
 *   - 纯标量自动识别为整数 / 浮点 / 布尔 / null / 字符串；
 *   - 空集合 `{}` 与 `[]`；
 *   - 折叠标量 `>-` 与保留标量 `|-`（按最小缩进剥离，折叠式行间用单空格连接、空行变换行）；
 *   - `#` 注释（引号外、行首或前面有空白）、空行、`---` 文档分隔符。
 *
 * 明确不支持（抛错并指出行号）：锚点/别名 `&`/`*`、标签 `!!`、多文档、非空流式集合、
 * 显式键 `?`、块标量缩进指示符（`|2`）、制表符缩进。
 */

export class YamlParseError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `第 ${line + 1} 行：${message}`)
    this.name = 'YamlParseError'
  }
}

const UNSUPPORTED_LEADING = [
  ['&', '锚点（&）'],
  ['*', '别名（*）'],
  ['!', '标签（!）'],
  ['?', '显式键（?）'],
]

/** 预处理成物理行：去掉行尾注释，但保留空行（块标量需要它们）。 */
function toLines(text) {
  const raw = text.split(/\r?\n/)
  const lines = []

  for (let index = 0; index < raw.length; index++) {
    const line = stripTrailingComment(raw[index])
    if (line.includes('\t') && line.trim() !== '') {
      throw new YamlParseError('缩进里不允许出现制表符（本仓库统一用空格）', index)
    }
    const trimmed = line.trim()
    if (trimmed === '' || trimmed === '---') {
      lines.push({ blank: true, lineNumber: index })
      continue
    }
    const indent = line.length - line.trimStart().length
    const content = line.slice(indent)
    for (const [symbol, label] of UNSUPPORTED_LEADING) {
      if (content.startsWith(symbol)) {
        throw new YamlParseError(`生成脚本的 YAML 解析器不支持${label}`, index)
      }
    }
    lines.push({ blank: false, indent, content, lineNumber: index })
  }

  return lines
}

/** 去掉行尾注释，跳过引号内的 `#`。 */
function stripTrailingComment(line) {
  let inSingle = false
  let inDouble = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (inDouble) {
      if (char === '\\') {
        index++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }
    if (inSingle) {
      if (char === "'") {
        if (line[index + 1] === "'") {
          index++
        } else {
          inSingle = false
        }
      }
      continue
    }
    if (char === '"') {
      inDouble = true
      continue
    }
    if (char === "'") {
      inSingle = true
      continue
    }
    if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index)
    }
  }

  return line
}

function isSequenceItem(content) {
  return content === '-' || content.startsWith('- ')
}

class Parser {
  constructor(text) {
    this.lines = toLines(text)
    this.index = 0
  }

  parse() {
    this.skipBlank()
    if (this.index >= this.lines.length) {
      return null
    }
    const first = this.lines[this.index]
    if (first.indent !== 0) {
      throw new YamlParseError(`顶层内容不能有缩进（缩进 ${first.indent} 空格）`, first.lineNumber)
    }
    const value = this.parseNode(0)
    this.skipBlank()
    if (this.index < this.lines.length) {
      throw new YamlParseError('解析结束后仍有未处理的内容（缩进不匹配？）', this.lines[this.index].lineNumber)
    }
    return value
  }

  skipBlank() {
    while (this.index < this.lines.length && this.lines[this.index].blank) {
      this.index++
    }
  }

  /** 读下一个有效行（不移动指针），返回 { line, cursor }；没有则返回 undefined。 */
  peekSignificant() {
    let cursor = this.index
    while (cursor < this.lines.length && this.lines[cursor].blank) {
      cursor++
    }
    return cursor < this.lines.length ? { line: this.lines[cursor], cursor } : undefined
  }

  parseNode(indent) {
    this.skipBlank()
    const line = this.lines[this.index]
    if (line === undefined) {
      throw new YamlParseError('期望一个值，但内容已结束')
    }
    if (line.indent !== indent) {
      throw new YamlParseError(`期望 ${indent} 空格缩进，实际 ${line.indent}`, line.lineNumber)
    }
    if (isSequenceItem(line.content)) {
      return this.parseSequence(indent)
    }
    if (findMappingColon(line.content) !== -1) {
      return this.parseMapping(indent)
    }
    throw new YamlParseError(
      `无法理解这一行（既不是序列项也不是键值对）：${line.content}`,
      line.lineNumber,
    )
  }

  parseMapping(indent) {
    const result = {}
    for (;;) {
      this.skipBlank()
      const line = this.lines[this.index]
      if (line === undefined || line.indent < indent) {
        break
      }
      if (line.indent > indent) {
        throw new YamlParseError(`意外的缩进（期望 ${indent}）`, line.lineNumber)
      }
      if (isSequenceItem(line.content)) {
        throw new YamlParseError('映射里出现了序列项', line.lineNumber)
      }
      const colon = findMappingColon(line.content)
      if (colon === -1) {
        throw new YamlParseError(`缺少冒号的键值对：${line.content}`, line.lineNumber)
      }
      const key = parseScalarKey(line.content.slice(0, colon), line.lineNumber)
      const rest = line.content.slice(colon + 1).trim()
      this.index++
      result[key] = this.parseValueAfterKey(rest, indent, line.lineNumber)
    }
    return result
  }

  parseSequence(indent) {
    const result = []
    for (;;) {
      this.skipBlank()
      const line = this.lines[this.index]
      if (line === undefined || line.indent < indent) {
        break
      }
      if (line.indent > indent) {
        throw new YamlParseError(`序列项的缩进不一致（期望 ${indent}）`, line.lineNumber)
      }
      if (!isSequenceItem(line.content)) {
        break
      }

      const rest = line.content === '-' ? '' : line.content.slice(2).trim()
      this.index++

      if (rest === '') {
        result.push(this.parseNestedOrNull(indent))
        continue
      }
      if (isBlockScalarMarker(rest)) {
        result.push(this.parseBlockScalar(rest, indent, line.lineNumber))
        continue
      }

      const colon = findMappingColon(rest)
      if (colon === -1) {
        result.push(parseScalarValue(rest, line.lineNumber))
        continue
      }

      // `- key: value`：这一项是映射，后续同级键的缩进比 `-` 深 2
      const itemIndent = indent + 2
      const item = {}
      const key = parseScalarKey(rest.slice(0, colon), line.lineNumber)
      const inline = rest.slice(colon + 1).trim()
      item[key] = this.parseValueAfterKey(inline, itemIndent, line.lineNumber)

      for (;;) {
        this.skipBlank()
        const next = this.lines[this.index]
        if (next === undefined || next.indent < itemIndent) {
          break
        }
        if (next.indent > itemIndent) {
          throw new YamlParseError(`序列项内部的缩进不一致（期望 ${itemIndent}）`, next.lineNumber)
        }
        if (isSequenceItem(next.content)) {
          break
        }
        const nextColon = findMappingColon(next.content)
        if (nextColon === -1) {
          throw new YamlParseError(`序列项内缺少冒号：${next.content}`, next.lineNumber)
        }
        const nextKey = parseScalarKey(next.content.slice(0, nextColon), next.lineNumber)
        const nextValue = next.content.slice(nextColon + 1).trim()
        this.index++
        item[nextKey] = this.parseValueAfterKey(nextValue, itemIndent, next.lineNumber)
      }

      result.push(item)
    }
    return result
  }

  /** 键后面那一坨值的统一处理：内联标量 / 块标量 / 更深缩进的块 / null。 */
  parseValueAfterKey(rest, indent, lineNumber) {
    if (rest === '') {
      return this.parseNestedOrNull(indent)
    }
    if (isBlockScalarMarker(rest)) {
      return this.parseBlockScalar(rest, indent, lineNumber)
    }
    return parseScalarValue(rest, lineNumber)
  }

  /** 键后面没有内联值：下一有效行更深就是它的块，否则是 null。 */
  parseNestedOrNull(indent) {
    const next = this.peekSignificant()
    if (next === undefined || next.line.indent <= indent) {
      return null
    }
    this.index = next.cursor
    return this.parseNode(next.line.indent)
  }

  /**
   * `>-` / `|-`：收集所有缩进大于块缩进的物理行（**含空行**），按最小缩进去掉公共缩进。
   * 折叠式（`>`）把行间换行折成单空格、空行折成换行；保留式（`|`）原样保留。
   */
  parseBlockScalar(marker, indent, lineNumber) {
    if (/[0-9]/.test(marker)) {
      throw new YamlParseError('不支持带缩进指示符的块标量（如 |2）', lineNumber)
    }
    const folded = marker.startsWith('>')
    const stripFinalNewline = marker.endsWith('-')

    const collected = []
    let minIndent = Infinity
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      if (line.blank) {
        collected.push(line)
        this.index++
        continue
      }
      if (line.indent <= indent) {
        break
      }
      if (line.indent < minIndent) {
        minIndent = line.indent
      }
      collected.push(line)
      this.index++
    }

    while (collected.length > 0 && collected[collected.length - 1].blank) {
      collected.pop()
    }
    if (collected.length === 0) {
      return ''
    }

    const parts = collected.map((line) => {
      if (line.blank) {
        return ''
      }
      return ' '.repeat(line.indent - minIndent) + line.content
    })

    let value
    if (folded) {
      // 连续非空行用单空格连接；空行代表段落分隔，折成一个换行
      value = ''
      let previousBlank = false
      for (const part of parts) {
        if (part === '') {
          value += '\n'
          previousBlank = true
          continue
        }
        if (value !== '' && !previousBlank) {
          value += ' '
        }
        value += part
        previousBlank = false
      }
    } else {
      value = parts.join('\n')
    }

    return stripFinalNewline ? value.replace(/\n+$/, '') : value
  }
}

function isBlockScalarMarker(value) {
  return value === '>' || value === '>-' || value === '|' || value === '|-'
}

/** 找「键: 值」的分隔冒号（跳过引号内的冒号），找不到返回 -1。 */
function findMappingColon(content) {
  let inSingle = false
  let inDouble = false

  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    if (inDouble) {
      if (char === '\\') {
        index++
      } else if (char === '"') {
        inDouble = false
      }
      continue
    }
    if (inSingle) {
      if (char === "'") {
        if (content[index + 1] === "'") {
          index++
        } else {
          inSingle = false
        }
      }
      continue
    }
    if (char === '"') {
      inDouble = true
      continue
    }
    if (char === "'") {
      inSingle = true
      continue
    }
    if (char === ':' && (index + 1 === content.length || /\s/.test(content[index + 1]))) {
      return index
    }
  }
  return -1
}

function parseScalarKey(raw, lineNumber) {
  const key = raw.trim()
  if (key === '') {
    throw new YamlParseError('键不能为空', lineNumber)
  }
  if (key.startsWith('"') || key.startsWith("'")) {
    const value = parseScalarValue(key, lineNumber)
    if (typeof value !== 'string') {
      throw new YamlParseError(`键必须是字符串：${raw}`, lineNumber)
    }
    return value
  }
  return key
}

function parseScalarValue(raw, lineNumber) {
  const value = raw.trim()

  if (value === '{}') return {}
  if (value === '[]') return []
  if (value.startsWith('"')) return parseDoubleQuoted(value, lineNumber)
  if (value.startsWith("'")) return parseSingleQuoted(value, lineNumber)
  if (value.startsWith('{') || value.startsWith('[')) {
    throw new YamlParseError('不支持非空的流式集合', lineNumber)
  }
  if (value.startsWith('&') || value.startsWith('*') || value.startsWith('!')) {
    throw new YamlParseError('不支持锚点 / 别名 / 标签', lineNumber)
  }
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  if (/^-?\d+\.\d+$/.test(value)) return Number.parseFloat(value)
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null

  return value
}

function parseDoubleQuoted(value, lineNumber) {
  if (!value.endsWith('"') || value.length < 2) {
    throw new YamlParseError(`双引号没有闭合：${value}`, lineNumber)
  }
  const inner = value.slice(1, -1)
  let result = ''
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index]
    if (char !== '\\') {
      result += char
      continue
    }
    const next = inner[++index]
    switch (next) {
      case 'n':
        result += '\n'
        break
      case 't':
        result += '\t'
        break
      case '"':
        result += '"'
        break
      case '\\':
        result += '\\'
        break
      case 'u': {
        const hex = inner.slice(index + 1, index + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new YamlParseError(`\\u 转义不合法：${hex}`, lineNumber)
        }
        result += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
        break
      }
      default:
        throw new YamlParseError(`不支持的转义 \\${next}`, lineNumber)
    }
  }
  return result
}

function parseSingleQuoted(value, lineNumber) {
  if (!value.endsWith("'") || value.length < 2) {
    throw new YamlParseError(`单引号没有闭合：${value}`, lineNumber)
  }
  return value.slice(1, -1).replace(/''/g, "'")
}

export function parseYaml(text) {
  return new Parser(text).parse()
}
