#!/usr/bin/env node
/**
 * 生成新测计分的共享测试夹具。
 *
 * 用法：node scripts/gen-jung-fixtures.mjs [--check]
 *
 * 为什么需要生成器而不是手写夹具：
 *   「四维各 12 题、贡献分别为 +12/+10/−14/−8」这种断言，手写 64 行答案极易数错一格，
 *   而数错的答案会得到一个"看起来合理"的期望值 —— 夹具本身错了，测试反而在保护错误行为。
 *   这里把 `fill` 语法展开成显式答案（展开逻辑是确定性的），再由**与 Java 同构的一份**
 *   参考实现算出期望值；Java 与 TypeScript 都读展开后的同一份夹具。
 *
 * 生成器里的参考实现是**第二实现**，不是权威：权威是 Java（`JungScorer`）。
 * 两边结论不一致时，先当作契约问题查清楚，而不是改夹具迁就某一边 —— 夹具的 `--check`
 * 与 Java 侧的 fixtures 测试会同时把这种分歧暴露出来。
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/**
 * 题目与计分政策的**唯一来源：当前内容包**（不再是 YAML 维护源）。
 *
 * <p>为什么换来源：夹具的期望值必须与 Java / 前端**真正加载的那份内容**逐字对应。
 * YAML 维护源与生成出来的包并不总是相同 —— v2 对 `JP-02` / `JP-04` 做过极性修正，
 * 而 YAML 仍是修正前的版本。继续从 YAML 算期望值，会在"默认包切到带修正的版本"时
 * 静默错位（题目极性变了，按极点分配的答案跟着变，期望值却不是）。
 * YAML → 包的转换本身由 `scripts/convert-jung-content.mjs --check` 与
 * `scripts/gen-platform-content.mjs --check` 各自守住，不靠这里兼管。
 */
const PACKAGE_SOURCE = join(root, 'backend/src/main/resources/content/typeme-jung48-zh-v3.json')
const OUTPUTS = [
  join(root, 'docs/2026-09-16/implementation/fixtures/score-cases.json'),
  join(root, 'backend/src/test/resources/fixtures/score-cases.json'),
  join(root, 'frontend/src/domain/__fixtures__/score-cases.json'),
]

if (!existsSync(PACKAGE_SOURCE)) {
  throw new Error(`当前内容包还没生成：${PACKAGE_SOURCE}（先跑 node scripts/gen-platform-content.mjs）`)
}
const PACKAGE = JSON.parse(readFileSync(PACKAGE_SOURCE, 'utf8'))
/** 与内容包 `scoringPolicy` 同形；夹具的期望值完全按它计算。 */
const POLICY = { ...PACKAGE.scoringPolicy }
if (PACKAGE.instrument?.scoringVersion !== POLICY.version) {
  throw new Error(
    `内容包自身不一致：instrument.scoringVersion=${PACKAGE.instrument?.scoringVersion}`
    + ` 但 scoringPolicy.version=${POLICY.version}`,
  )
}

const DIMENSIONS = ['EI', 'SN', 'TF', 'JP']
const POSITIVE = { EI: 'E', SN: 'N', TF: 'F', JP: 'P' }
const NEGATIVE = { EI: 'I', SN: 'S', TF: 'T', JP: 'J' }

/** 过程层推导算法版本；与 Java `JungReportBuilder.DYNAMICS_VERSION` 同步。 */
const DYNAMICS_VERSION = 'typeme-jung48-dynamics-v1'

const ALL_TYPE_CODES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
]

/**
 * 过程结构的**参考实现**，与 Java `com.typeme.jung.domain.JungTypeDynamics` 同构。
 *
 * 这一层没有"分数"，全是符号推导，所以它比计分更容易被一次静默的改写弄反：
 * 内倾型的推导写错一支，16 个类型里有 8 个的主导与辅助整对互换，
 * 而报告照样能生成、页面照样能渲染。夹具把 16 个类型逐个钉住，
 * 让 Java、前端与这里的三份实现必须给出同一张表。
 */
function deriveProcesses(typeCode) {
  const [ei, sn, tf, jp] = typeCode.split('')
  // 对外使用的功能族：J -> 判断族(T/F)，P -> 感知族(S/N)；剩下那一族朝里。
  const outer = (jp === 'J' ? tf : sn) + 'e'
  const inner = (jp === 'J' ? sn : tf) + 'i'
  const dominant = ei === 'E' ? outer : inner
  const auxiliary = ei === 'E' ? inner : outer
  // 第三位/第四位 = 同族的**另一个**功能、方向取反。
  const otherInFamilyOpposite = (process) => {
    const fn = process[0]
    const attitude = process[1]
    const other = fn === 'S' ? 'N' : fn === 'N' ? 'S' : fn === 'T' ? 'F' : 'T'
    return other + (attitude === 'i' ? 'e' : 'i')
  }
  return {
    typeCode,
    dominant,
    auxiliary,
    tertiary: otherInFamilyOpposite(auxiliary),
    inferior: otherInFamilyOpposite(dominant),
  }
}

const triggerThreshold = (n) => (n <= 0 ? 0 : Math.floor((POLICY.boundaryNumerator * n) / POLICY.boundaryDenominator))

/**
 * 边界与触发**同一条尺度**（`B(n) = T(n)`，不再减一）的计分版本。
 * 与 Java `JungScoringPolicy.UNIFIED_SCALE_VERSIONS`、前端 `types.ts` 同一张表。
 */
const UNIFIED_BOUNDARY_SCALE_VERSIONS = ['typeme-jung48-score-v3']

/** 边界阈值 `B(n) = max(0, T(n) − 1)`（历史）或 `max(0, T(n))`（统一尺度）。 */
const boundaryThreshold = (n) => {
  const trigger = triggerThreshold(n)
  return UNIFIED_BOUNDARY_SCALE_VERSIONS.includes(POLICY.version)
    ? Math.max(0, trigger)
    : Math.max(0, trigger - 1)
}

/**
 * 是否需要把该维标成"倾向较轻"。
 *
 * 统一尺度版本额外要求 `nFinal > 0`：没有有效数字回答时不存在"较轻的倾向"，
 * 那种情况该走覆盖不足（NEEDS_REVIEW）。历史版本保持原样。
 *
 * 注意 `B(n) === 0`（历史规则下 n=9 时）的含义：只有 `S = 0` 才算"轻"，
 * 也就是只有平分；非零倾向在这一档**不**算轻。这一格曾经被写反过，
 * 所以夹具专门钉住 n=9、|S|=1 的结论。
 */
const isBoundary = (s, n) => {
  if (UNIFIED_BOUNDARY_SCALE_VERSIONS.includes(POLICY.version) && n <= 0) return false
  return Math.abs(s) <= boundaryThreshold(n)
}

/* ── 题库读取 ─────────────────────────────────────────────────────────── */

function loadQuestions() {
  const questions = PACKAGE?.questions
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`内容包里没有 questions 列表：${PACKAGE_SOURCE}`)
  }
  return questions
}

/**
 * 按维度与阶段归集题目。
 *
 * `order` 字段是**必须**的：它决定"前几题点左、后几题点右"的确定性顺序。
 * 早期版本忘了从 YAML 里读它，`a.order - b.order` 全是 NaN、比较恒为 false，
 * 排序静默失效，于是所有 fill 都算成空答案 —— 断言仍然"通过"，测的却是别的东西。
 * 所以这里缺字段直接抛错，宁可跑不起来。
 */
function indexQuestions(questions) {
  const byId = new Map()
  const base = new Map(DIMENSIONS.map((d) => [d, []]))
  const clarification = new Map(DIMENSIONS.map((d) => [d, []]))
  for (const question of questions) {
    if (!Number.isInteger(question.order)) {
      throw new Error(`题目 ${question.id} 缺少整数 order 字段（当前：${JSON.stringify(question.order)}）`)
    }
    if (!DIMENSIONS.includes(question.dimension)) {
      throw new Error(`题目 ${question.id} 的维度非法：${JSON.stringify(question.dimension)}`)
    }
    if (!['base', 'clarification'].includes(question.stage)) {
      throw new Error(`题目 ${question.id} 的 stage 非法：${JSON.stringify(question.stage)}`)
    }
    if (byId.has(question.id)) {
      throw new Error(`题目 id 重复：${question.id}`)
    }
    byId.set(question.id, question)
    const bucket = question.stage === 'base' ? base : clarification
    bucket.get(question.dimension).push(question)
  }
  for (const [, list] of base) list.sort((a, b) => a.order - b.order)
  for (const [, list] of clarification) list.sort((a, b) => a.order - b.order)
  return { byId, base, clarification }
}

/** 单题贡献：右侧是正极记 +1，否则 −1。 */
function contribution(question, rating) {
  const direction = question.rightPole === POSITIVE[question.dimension] ? 1 : -1
  return direction * (rating - 3)
}

/* ── 答案展开 ─────────────────────────────────────────────────────────── */

/**
 * 把 6 道题分成三组：`s` 道贡献 +2、`p` 道贡献 +1、其余贡献 −2，贡献和为 `target`。
 * 各段用的 rating 由调用方决定（两段的"正极方向"相反）。
 *
 * 为什么可以这么凑：`2s + p − 2j`（j = 6−s−p）= `4s + 3p − 12`，
 * s 从 0 到 6 遍历保证了 `target` 的**奇偶**两种情形都能命中。
 */
function splitSix(target) {
  for (let s = 0; s <= 6; s += 1) {
    const remainder = target + 12 - 4 * s
    if (remainder < 0 || remainder % 3 !== 0) continue
    const p = remainder / 3
    const j = 6 - s - p
    if (p < 0 || p > 6 || j < 0) continue
    return { s, p, j }
  }
  return null
}

/**
 * 为某个维度算出一组恰好贡献 `magnitude` 的答案（方向为正极）。
 *
 * 为什么不能只用 1 / 5 两档：一段 6 题的贡献和只能是 `4k − 12`，**恒为 4 的倍数**，
 * 所以 `±10`、`±2` 这类目标值用两档根本凑不出来 —— 硬凑会得到 `+8` 或 `+12`，
 * 夹具于是静默地测了另一个用例。这里放开中间档（rating 4 得 +1）按段精确求解。
 *
 * @returns 按 ordered 顺序排列的 rating 数组；无解返回 null
 */
function allocateRatings(ordered, dimension, magnitude) {
  const positiveOnLeft = ordered
    .map((q, index) => ({ index, ok: q.leftPole === POSITIVE[dimension] }))
    .filter((entry) => entry.ok)
    .map((entry) => entry.index)
  const negativeOnLeft = ordered
    .map((q, index) => ({ index, ok: q.leftPole !== POSITIVE[dimension] }))
    .filter((entry) => entry.ok)
    .map((entry) => entry.index)
  if (positiveOnLeft.length !== 6 || negativeOnLeft.length !== 6) return null

  for (let firstPositive = 0; firstPositive <= 6; firstPositive += 1) {
    // 第一段（左端即正极）：恰好 firstPositive 道贡献 +2，其余贡献 −2
    const firstSum = 4 * firstPositive - 12
    const split = splitSix(magnitude - firstSum)
    if (!split) continue

    const first = Array(6).fill(-2)
    for (let i = 0; i < firstPositive; i += 1) first[i] = 2
    // 正贡献靠段尾，负贡献靠段首 —— 同一道题在不同 magnitude 下的取值可预测，便于人工核对
    if (firstPositive > 3) first.reverse()

    const second = [
      ...Array(split.s).fill(2),
      ...Array(split.p).fill(1),
      ...Array(split.j).fill(-2),
    ]

    const ratings = new Array(ordered.length).fill(3)
    positiveOnLeft.forEach((position, i) => {
      const level = first[i]
      // 左端即正极：评 1 得 +2、评 4 得 +1、评 5 得 −2
      ratings[position] = level === 2 ? 1 : level === 1 ? 4 : 5
    })
    negativeOnLeft.forEach((position, i) => {
      const level = second[i]
      // 左端为负极：评 5 得 +2、评 4 得 +1、评 1 得 −2
      ratings[position] = level === 2 ? 5 : level === 1 ? 4 : 1
    })

    const achieved = ordered.reduce((sum, q, index) => sum + contribution(q, ratings[index]), 0)
    if (achieved === magnitude) return ratings
  }
  return null
}

/**
 * 把 `{ "EI": "left" }` / `{ "EI": "+2" }` 展开成显式 rating 答案。
 *
 * 顺序是**确定性**的：先取"左端为负极"的题（按 order），再取其余题（按 order）。
 * 这样 `+2` 只有一种解释，而且夹具里写 `+2` 一眼就能看出"该维贡献总和是 +2"。
 */
function expandAnswers(index, spec, problems) {
  const { base } = index
  const out = {}
  for (const dimension of DIMENSIONS) {
    const items = base.get(dimension)
    const want = spec.fill?.[dimension]
    if (want === undefined) continue

    // 顺序是**确定性**且与"左右平衡"无关：
    //   idx 0..5   = 左端为正极的题（点在右边即贡献 +2）
    //   idx 6..11  = 左端为负极的题（点在右边即贡献 −2）
    // 于是 `+N` 只能有一种解释：后 N 题点最右（各 +2）；`-N`：前 N 题点最左（各 −2）。
    const positiveLeft = items.filter((q) => q.leftPole === POSITIVE[dimension])
    const negativeLeft = items.filter((q) => q.leftPole === NEGATIVE[dimension])
    if (positiveLeft.length !== 6 || negativeLeft.length !== 6) {
      problems.push(
        `${dimension} 左右不平衡：左端为正极 ${positiveLeft.length} 题、左端为负极 ${negativeLeft.length} 题，各应为 6`,
      )
      continue
    }
    const ordered = [...positiveLeft, ...negativeLeft]
    if (process.env.JUNG_FIXTURE_DEBUG2) {
      console.log(`  [${dimension}] ordered=${ordered.map((q) => `${q.id}:${q.leftPole}->${q.rightPole}`).join(' ')}`)
    }

    if (want === 'left') {
      for (const q of items) out[q.id] = { kind: 'rating', rating: 1 }
      continue
    }
    if (want === 'right') {
      for (const q of items) out[q.id] = { kind: 'rating', rating: 5 }
      continue
    }
    if (want === 'neutral') {
      for (const q of items) out[q.id] = { kind: 'rating', rating: 3 }
      continue
    }
    if (want === 'alternate') {
      // 每一段内各三个 +2 / 三个 −2：真实代数和为 0，用来验证"平分"来自真实抵消
      ordered.forEach((q, index) => {
        const segmentIndex = index % 6
        const positiveOnRight = q.rightPole === POSITIVE[dimension]
        const needsPositivePole = positiveOnRight ? segmentIndex >= 3 : segmentIndex < 3
        out[q.id] = { kind: 'rating', rating: needsPositivePole ? (positiveOnRight ? 5 : 1) : (positiveOnRight ? 1 : 5) }
      })
      continue
    }

    const match = /^([+-])(\d+)$/.exec(String(want))
    if (!match) {
      problems.push(`fill 值无法识别：${dimension} = ${want}`)
      continue
    }
    const sign = match[1] === '+' ? 1 : -1
    const magnitude = Number(match[2])
    if (magnitude > 24) {
      problems.push(`${dimension} 的 fill 幅度 ${magnitude} 超过 12 题 × 单题最大 |c|=2 的上限 24`)
      continue
    }

    const ratings = allocateRatings(ordered, dimension, magnitude)
    if (!ratings) {
      problems.push(`${dimension} 的 fill 幅度 ${magnitude} 无法用 1/4/5 三档精确凑出`)
      continue
    }
    ordered.forEach((q, index) => {
      out[q.id] = { kind: 'rating', rating: ratings[index] }
      if (process.env.JUNG_FIXTURE_DEBUG2) {
        console.log(
          `    ${dimension} ${q.id} idx=${index} rating=${ratings[index]} c=${contribution(q, ratings[index])}`,
        )
      }
    })
  }
  return out
}

/* ── 参考实现（与 Java 同构） ─────────────────────────────────────────── */

function sumOf(items, answers) {
  if (!Array.isArray(items)) {
    throw new Error(`sumOf 收到非数组题集：${JSON.stringify(items)}`)
  }
  let n = 0
  let s = 0
  for (const item of items) {
    const answer = answers[item.id]
    if (answer && answer.kind === 'rating') {
      n += 1
      s += contribution(item, answer.rating)
    }
  }
  return { n, s }
}

function checkCoverage(index, answers) {
  const report = {}
  /*
   * `insufficientDimensions` 是 NEEDS_REVIEW 时唯一能指出"还差哪一维"的信息：
   * 前端要靠它把未完成的维度标出来。只给出一个 `ok=false` 的布尔值，
   * 用户只会看到"还没完成"却不知道该回去补哪里。
   */
  const insufficientDimensions = []
  let ok = true
  for (const dimension of DIMENSIONS) {
    const items = index.base.get(dimension)
    let rating = 0
    let unknown = 0
    let unprocessed = 0
    for (const item of items) {
      const answer = answers[item.id]
      if (!answer) unprocessed += 1
      else if (answer.kind === 'rating') rating += 1
      else unknown += 1
    }
    const { s } = sumOf(items, answers)
    const needsClarification =
      rating >= POLICY.minBaseRatingsPerDimension && Math.abs(s) <= triggerThreshold(rating)
    const coverageOk = rating >= POLICY.minBaseRatingsPerDimension && unprocessed === 0
    if (!coverageOk) {
      ok = false
      insufficientDimensions.push(dimension)
    }
    report[dimension] = { rating, unknown, unprocessed, needsClarification, coverageOk }
  }
  return { perDimension: report, ok, insufficientDimensions }
}

function score(index, answers, skipped) {
  const coverage = checkCoverage(index, answers)
  /*
   * `scheduled` 表示**服务端决定安排哪些维度的补充题**，与用户是否跳过无关：
   * 这是澄清前的评审结论，用户点"跳过"只是不回答，不会改变"本来安排了什么"。
   * 早期版本在跳过时把它清空，于是"提交了未安排维度的补充答案"这类校验
   * 会因为集合为空而对一切提交都报错 —— 一个字段承担了两种含义。
   */
  const scheduled = coverage.ok
    ? DIMENSIONS.filter((d) => coverage.perDimension[d].needsClarification)
    : []

  const dimensions = {}
  for (const dimension of DIMENSIONS) {
    const base = sumOf(index.base.get(dimension), answers)
    const clar = sumOf(index.clarification.get(dimension), answers)
    const scheduledThis = coverage.perDimension[dimension].needsClarification
    const effective = scheduledThis && !skipped && clar.n > 0
    const finalS = effective ? base.s + clar.s : base.s
    const finalN = effective ? base.n + clar.n : base.n
    const m = (v, n) => (n === 0 ? null : v / (2 * n))
    const pole = finalS > 0 ? POSITIVE[dimension] : finalS < 0 ? NEGATIVE[dimension] : null
    dimensions[dimension] = {
      SBase: base.s,
      nBase: base.n,
      mBase: m(base.s, base.n),
      SClar: clar.s,
      nClar: clar.n,
      mClar: m(clar.s, clar.n),
      SFinal: finalS,
      nFinal: finalN,
      mFinal: m(finalS, finalN),
      position: finalN === 0 ? null : (m(finalS, finalN) + 1) / 2,
      computedPole: pole,
      tiedSide: pole === null ? 'tied' : pole === POSITIVE[dimension] ? 'positive' : 'negative',
      boundary: isBoundary(finalS, finalN),
      clarificationScheduled: scheduledThis,
      clarificationSkipped: scheduledThis && skipped,
      clarificationApplied: effective,
      clarificationRatingCount: clar.n,
    }
  }

  if (!coverage.ok) {
    return { status: 'NEEDS_REVIEW', computedTypeCode: null, dimensions, tiedDimensions: [], scheduled, candidates: [], coverage }
  }

  const tiedDimensions = DIMENSIONS.filter((d) => dimensions[d].computedPole === null)
  const anyBoundary = DIMENSIONS.some((d) => dimensions[d].boundary)
  const status = tiedDimensions.length > 0 ? 'TIED' : anyBoundary ? 'TENTATIVE' : 'REFERENCE'

  const typeCode = status === 'REFERENCE' || status === 'TENTATIVE'
    ? DIMENSIONS.map((d) => dimensions[d].computedPole).join('')
    : null

  let candidates = []
  if (status !== 'REFERENCE') {
    const choices = DIMENSIONS.map((d) => {
      const row = dimensions[d]
      if (row.computedPole === null) return [NEGATIVE[d], POSITIVE[d]]
      if (row.boundary) return [row.computedPole, row.computedPole === POSITIVE[d] ? NEGATIVE[d] : POSITIVE[d]]
      return [row.computedPole]
    })
    let total = 1
    choices.forEach((c) => { total *= c.length })
    for (let i = 0; i < total; i += 1) {
      let remainder = i
      const poles = new Array(4)
      for (let d = 3; d >= 0; d -= 1) {
        poles[d] = choices[d][remainder % choices[d].length]
        remainder = Math.floor(remainder / choices[d].length)
      }
      let cost = 0
      const differsOn = []
      DIMENSIONS.forEach((d, index2) => {
        if (poles[index2] !== dimensions[d].computedPole) {
          cost += Math.abs(dimensions[d].SFinal)
          differsOn.push(d)
        }
      })
      const orderKey = DIMENSIONS.reduce((key, d, index2) => {
        const row = dimensions[d]
        const preferred = row.computedPole !== null ? row.computedPole : NEGATIVE[d]
        return key * 10 + (poles[index2] === preferred ? 0 : 1)
      }, 0)
      candidates.push({ typeCode: poles.join(''), cost, differsOn, orderKey })
    }
    candidates.sort((a, b) => a.cost - b.cost || a.orderKey - b.orderKey)
  }

  return { status, computedTypeCode: typeCode, dimensions, tiedDimensions, scheduled, candidates, coverage }
}

/* ── 用例定义 ─────────────────────────────────────────────────────────── */

/*
 * 每个用例只声明**输入**（fill / unknown / drop / clarification / skip）和一句"想钉住什么"，
 * 不写期望结果 —— 期望一律由参考实现算出，标题由结果派生。
 * 这样调整输入时不会留下过期的期望值。
 */
const CASES = [
  { id: 'CASE-01', note: '四维都给出明确的一侧：钉住 TF/JP 的正负极方向（与旧 OEJTS 相反）',
    fill: { EI: '+12', SN: '+10', TF: '-12', JP: '-8' } },
  { id: 'CASE-02', note: 'n=12、|S|=1：落在带内（B(12)=2）而用户**跳过**了补充题 → TENTATIVE。与 CASE-14（同一份主测但完成补充题）构成「跳过 / 完成」对照',
    fill: { EI: '+1', SN: '+10', TF: '+12', JP: '-10' }, skip: ['EI'] },
  { id: 'CASE-03', note: '补充题与主测同向叠加（不是翻转）：最终方向与边界都必须按合并后的 S 判定，本例落成 n=16、|S|=6',
    fill: { EI: '+2', SN: '+10', TF: '+12', JP: '-10' },
    clarification: { answers: {
      'EI-C1': { kind: 'rating', rating: 1 }, 'EI-C2': { kind: 'rating', rating: 5 },
      'EI-C3': { kind: 'rating', rating: 1 }, 'EI-C4': { kind: 'rating', rating: 1 } } } },
  { id: 'CASE-04', note: '主测全部中立档：四维 S=0，不得默认给出一个类型',
    fill: { EI: 'neutral', SN: 'neutral', TF: 'neutral', JP: 'neutral' },
    skip: ['EI', 'SN', 'TF', 'JP'] },
  { id: 'CASE-05', note: '每维恰好 9 个数字回答 + 3 个未知：覆盖达标，n 只数数字回答',
    fill: { EI: '+4', SN: '+10', TF: '+12', JP: '-10' },
    unknown: { EI: ['EI-10', 'EI-11', 'EI-12'], SN: ['SN-10', 'SN-11', 'SN-12'],
      TF: ['TF-10', 'TF-11', 'TF-12'], JP: ['JP-10', 'JP-11', 'JP-12'] } },
  { id: 'CASE-06', note: '每维只有 8 个数字回答：即使没有未处理项也必须回退，不给报告',
    fill: { EI: '+8', SN: '+8', TF: '+8', JP: '+8' },
    unknown: { EI: ['EI-09', 'EI-10', 'EI-11', 'EI-12'], SN: ['SN-09', 'SN-10', 'SN-11', 'SN-12'],
      TF: ['TF-09', 'TF-10', 'TF-11', 'TF-12'], JP: ['JP-09', 'JP-10', 'JP-11', 'JP-12'] } },
  { id: 'CASE-07', note: '缺一道题没处理：未处理 ≠ 无法判断，必须回退',
    fill: { EI: '+12', SN: '+10', TF: '+12', JP: '-10' }, drop: ['JP-12'] },
  { id: 'CASE-08', note: '单维真实平分 + 其余非零：平分维不参与类型判定',
    fill: { EI: 'alternate', SN: '+10', TF: '+8', JP: '-10' }, skip: ['EI'] },
  { id: 'CASE-09', note: 'n=12、|S|=2 恰好等于 B(12)=2：跳过补充题、结果仍在带内 → TENTATIVE。这条钉住 v3 的政策要点 —— 跳过不会再让结论显得更明确（旧规则 B=T−1=1 时它是 REFERENCE）',
    fill: { EI: '+2', SN: '+10', TF: '+12', JP: '-10' }, skip: ['EI'] },
  { id: 'CASE-10', note: '平分维与**真边界维**同时出现（EI 平分、JP |S|=1 落在 B(12)=2 之内）：平分优先，状态是 TIED 而不是 TENTATIVE，也不给完整四字母',
    fill: { EI: 'alternate', SN: '+10', TF: '-8', JP: '+1' }, skip: ['EI', 'JP'] },
  { id: 'CASE-11', note: '四维倾向都极轻（EI/TF/JP 恰好压在 B(12)=2 上、SN |S|=1 在带内）：候选数量应等于各维可选极点的笛卡尔积',
    fill: { EI: '+2', SN: '+1', TF: '-2', JP: '+2' }, skip: ['EI', 'SN', 'TF', 'JP'] },
  { id: 'CASE-12', note: 'n=12、|S|=3：超过触发阈值 T(12)=2 故不安排补充题，也刚好越出带一格（B(12)=2+1）→ REFERENCE',
    fill: { EI: '+3', SN: '+10', TF: '+12', JP: '-10' } },
  { id: 'CASE-13', note: 'n=9、|S|=1 恰好等于 B(9)=1：覆盖下限这一档也有「倾向较轻」区间（旧规则 B(9)=0，任何非零倾向都会被判成明确）→ TENTATIVE',
    fill: { EI: '+1', SN: '+10', TF: '+12', JP: '-10' },
    unknown: { EI: ['EI-10', 'EI-11', 'EI-12'] }, skip: ['EI'] },
  { id: 'CASE-14', note: '与 CASE-02 同一份主测（EI=+1）但**完成**了补充题：合并后 n=16、|S|=5 越出带（B(16)=3）→ REFERENCE。与 CASE-02 构成「跳过 / 完成」对照',
    fill: { EI: '+1', SN: '+10', TF: '+12', JP: '-10' },
    clarification: { answers: {
      'EI-C1': { kind: 'rating', rating: 1 }, 'EI-C2': { kind: 'rating', rating: 5 },
      'EI-C3': { kind: 'rating', rating: 1 }, 'EI-C4': { kind: 'rating', rating: 1 } } } },
  { id: 'CASE-15', note: '补充题全部回答"无法判断"：最终 n 回到主测数字回答数',
    fill: { EI: 'neutral', SN: '+10', TF: '+12', JP: '-10' },
    clarification: { answers: {
      'EI-C1': { kind: 'unknown' }, 'EI-C2': { kind: 'unknown' },
      'EI-C3': { kind: 'unknown' }, 'EI-C4': { kind: 'unknown' } } } },
  { id: 'CASE-16', note: '四维都真实平分：证明 S 是代数和而不是逐题绝对值累加',
    fill: { EI: 'alternate', SN: 'alternate', TF: 'alternate', JP: 'alternate' },
    skip: ['EI', 'SN', 'TF', 'JP'] },
  { id: 'CASE-17', note: '两维轻、两维明确：EI |S|=2 与 SN |S|=1 都落在 B(12)=2 之内，候选只发生在这两维上，TF/JP 不进候选',
    fill: { EI: '+2', SN: '+1', TF: '+12', JP: '-10' }, skip: ['EI', 'SN'] },
  { id: 'CASE-18', note: '只有 EI 不足 9 个数字回答：覆盖按维判定，其余维充足也要回退',
    fill: { EI: '+8', SN: '+10', TF: '+12', JP: '-10' },
    unknown: { EI: ['EI-09', 'EI-10', 'EI-11', 'EI-12'] } },
  { id: 'CASE-19', note: '某一维 12 题全部「说不好」：n=0，m 必须是 null（不能用 0 冒充「正好居中」），状态先回退 NEEDS_REVIEW',
    fill: { SN: '+10', TF: '+12', JP: '-10' },
    unknown: { EI: ['EI-01', 'EI-02', 'EI-03', 'EI-04', 'EI-05', 'EI-06',
      'EI-07', 'EI-08', 'EI-09', 'EI-10', 'EI-11', 'EI-12'] } },
  { id: 'CASE-20', note: '覆盖不足与平分、边界同时出现：NEEDS_REVIEW 优先于 TIED 与 TENTATIVE，且不给四字母、不给候选',
    fill: { EI: 'alternate', SN: '+10', TF: '+12', JP: '+1' },
    unknown: { SN: ['SN-09', 'SN-10', 'SN-11', 'SN-12'] }, skip: ['EI', 'JP'] },
  { id: 'CASE-21', note: 'n=16、|S|=2 落在带内（B(16)=3）：补充题全答中立档，边界在**最终合并题集**上判定，合并后仍算轻 → TENTATIVE',
    fill: { EI: '+2', SN: '+10', TF: '+12', JP: '-10' },
    clarification: { answers: {
      'EI-C1': { kind: 'rating', rating: 3 }, 'EI-C2': { kind: 'rating', rating: 3 },
      'EI-C3': { kind: 'rating', rating: 3 }, 'EI-C4': { kind: 'rating', rating: 3 } } } },
]

/* ── 生成 ─────────────────────────────────────────────────────────────── */

function build() {
  const questions = loadQuestions()
  const index = indexQuestions(questions)
  const problems = []
  const cases = []

  for (const spec of CASES) {
    const answers = expandAnswers(index, spec, problems)

    for (const [dimension, ids] of Object.entries(spec.unknown ?? {})) {
      for (const id of ids) {
        const question = index.byId.get(id)
        if (!question) { problems.push(`${spec.id}: 未知题号 ${id}`); continue }
        if (question.dimension !== dimension) { problems.push(`${spec.id}: ${id} 不属于 ${dimension}`); continue }
        answers[id] = { kind: 'unknown' }
      }
    }
    for (const id of spec.drop ?? []) {
      if (!index.byId.has(id)) { problems.push(`${spec.id}: 未知题号 ${id}`); continue }
      delete answers[id]
    }

    const clarificationAnswers = { ...(spec.clarification?.answers ?? {}) }
    const skipped = Array.isArray(spec.skip) && spec.skip.length > 0

    // 跳过澄清时，提交内容里不应有任何补充答案 —— 服务端也会拒绝这种组合（502 契约 §4.3）。
    if (skipped) {
      for (const id of Object.keys(clarificationAnswers)) {
        problems.push(`${spec.id}: 已声明跳过澄清，却还提交了 ${id}`)
      }
      for (const dimension of spec.skip) {
        for (const item of index.clarification.get(dimension)) delete clarificationAnswers[item.id]
      }
    }

    // 先算出"服务端会安排哪些补充题"，用它校验用例提供的补充答案是否合法
    const reference = score(index, answers, skipped)
    if (process.env.JUNG_FIXTURE_DEBUG3) {
      const pd = Object.fromEntries(DIMENSIONS.map((d) => [d, reference.coverage.perDimension[d]]))
      console.log(spec.id, 'skipped=' + skipped, 'ok=' + reference.coverage.ok,
        'scheduled=' + JSON.stringify(reference.scheduled), JSON.stringify(pd))
    }

    if (process.env.JUNG_FIXTURE_DEBUG) {
      const dist = DIMENSIONS.map((d) => {
        const items = index.base.get(d)
        const counts = {}
        let s = 0
        for (const q of items) {
          const a = answers[q.id]
          if (!a) continue
          counts[a.rating] = (counts[a.rating] ?? 0) + 1
          s += contribution(q, a.rating)
        }
        return `${d}[${Object.entries(counts).map(([k, v]) => k + '×' + v).join(' ')}] S=${s} trig=${reference.scheduled.includes(d)}`
      })
      console.log(spec.id, 'skipped=' + skipped, dist.join(' | '))
    }

    let finalAnswers = answers
    if (Object.keys(clarificationAnswers).length > 0) {
      for (const [id] of Object.entries(clarificationAnswers)) {
        const question = index.byId.get(id)
        if (!question) { problems.push(`${spec.id}: 未知澄清题号 ${id}`); continue }
        if (!reference.scheduled.includes(question.dimension)) {
          problems.push(`${spec.id}: ${id} 属于未安排的维度 ${question.dimension}，服务端会拒绝这种提交`)
        }
      }
      finalAnswers = { ...answers, ...clarificationAnswers }
    } else if (!skipped && reference.scheduled.length > 0) {
      problems.push(`${spec.id}: 有维度 ${reference.scheduled.join(',')} 需要澄清，但用例既没给澄清答案也没写 skip`)
    }

    const result = score(index, finalAnswers, skipped)

    /*
     * 夹具自检：不检查"参考实现算得对不对"（那要靠 Java 交叉验证），
     * 只检查**结果内部自洽** —— 这些不变式一旦破了，就说明期望值本身是矛盾的，
     * 拿去当基准只会把错误固化成"契约"。
     */
    const expectDimOrder = ['EI', 'SN', 'TF', 'JP']
    if (result.status === 'NEEDS_REVIEW') {
      if (result.computedTypeCode !== null) problems.push(`${spec.id}: NEEDS_REVIEW 不应有四字母`)
      if (result.candidates.length !== 0) problems.push(`${spec.id}: NEEDS_REVIEW 不应有候选`)
    } else if (result.status === 'TIED') {
      // TIED 的语义是"没有唯一类型可给"：四字母必须缺席，候选必须存在
      if (result.computedTypeCode !== null) problems.push(`${spec.id}: TIED 不应有四字母`)
      if (result.candidates.length < 2) problems.push(`${spec.id}: TIED 至少要有 2 个候选`)
    } else {
      if (!/^[EI][SN][TF][JP]$/.test(result.computedTypeCode ?? '')) {
        problems.push(`${spec.id}: ${result.status} 的四字母非法：${result.computedTypeCode}`)
      }
      const hasAmbiguity = result.tiedDimensions.length > 0 ||
        expectDimOrder.some((d) => result.dimensions[d].boundary)
      if (hasAmbiguity && result.candidates.length === 0) {
        problems.push(`${spec.id}: 存在平分/边界却没有候选`)
      }
      if (!hasAmbiguity && result.candidates.length !== 0) {
        problems.push(`${spec.id}: 没有平分也没有边界，不应产生候选`)
      }
      if (result.candidates.length > 0 &&
        !result.candidates.some((c) => c.typeCode === result.computedTypeCode)) {
        problems.push(`${spec.id}: 候选里缺少计算出的类型 ${result.computedTypeCode}`)
      }
    }
    for (const candidate of result.candidates) {
      if (!/^[EI][SN][TF][JP]$/.test(candidate.typeCode)) {
        problems.push(`${spec.id}: 候选类型码格式非法：${candidate.typeCode}`)
      }
      // 候选只能在"平分的两个极"与"轻的那一维的正反两极"上偏离计算出的类型
      for (let d = 0; d < 4; d += 1) {
        const dimension = expectDimOrder[d]
        const row = result.dimensions[dimension]
        const pole = candidate.typeCode[d]
        if (row.computedPole === null) continue
        if (pole !== row.computedPole && !row.boundary) {
          problems.push(`${spec.id}: 候选 ${candidate.typeCode} 在非边界维 ${dimension} 上偏离`)
        }
      }
      const recomputed = expectDimOrder.reduce((sum, dimension) => (
        candidate.differsOn.includes(dimension) ? sum + Math.abs(result.dimensions[dimension].SFinal) : sum
      ), 0)
      if (recomputed !== candidate.cost) {
        problems.push(`${spec.id}: 候选 ${candidate.typeCode} 的 cost ${candidate.cost} ≠ 重算值 ${recomputed}`)
      }
    }
    for (let i = 1; i < result.candidates.length; i += 1) {
      const previous = result.candidates[i - 1]
      const current = result.candidates[i]
      if (previous.cost > current.cost ||
        (previous.cost === current.cost && previous.orderKey > current.orderKey)) {
        problems.push(`${spec.id}: 候选排序不稳定（${previous.typeCode} 在 ${current.typeCode} 之前）`)
      }
    }
    if (result.status === 'TIED' && result.tiedDimensions.length === 0) {
      problems.push(`${spec.id}: TIED 但没有平分维`)
    }
    if (result.status === 'TENTATIVE' && !expectDimOrder.some((d) => result.dimensions[d].boundary)) {
      problems.push(`${spec.id}: TENTATIVE 但没有轻的维度`)
    }
    if (result.status === 'REFERENCE' && expectDimOrder.some((d) => result.dimensions[d].boundary)) {
      problems.push(`${spec.id}: REFERENCE 却有轻的维度`)
    }

    const expectDimensions = {}
    for (const dimension of DIMENSIONS) {
      const row = result.dimensions[dimension]
      const coverageRow = result.coverage.perDimension[dimension]
      expectDimensions[dimension] = {
        SBase: row.SBase, nBase: row.nBase, mBase: row.mBase,
        SClar: row.SClar, nClar: row.nClar, mClar: row.mClar,
        SFinal: row.SFinal, nFinal: row.nFinal, mFinal: row.mFinal,
        position: row.position,
        computedPole: row.computedPole, tiedSide: row.tiedSide,
        boundary: row.boundary,
        coverageOk: coverageRow.coverageOk,
        baseRatingCount: coverageRow.rating,
        baseUnknownCount: coverageRow.unknown,
        baseUnprocessedCount: coverageRow.unprocessed,
        clarificationScheduled: row.clarificationScheduled,
        clarificationApplied: row.clarificationApplied,
        clarificationRatingCount: row.clarificationRatingCount,
      }
    }

    const expectCoverageBase = {}
    for (const dimension of DIMENSIONS) {
      const row = result.coverage.perDimension[dimension]
      expectCoverageBase[dimension] = { rating: row.rating, unknown: row.unknown, unprocessed: row.unprocessed }
    }

    /*
     * 候选的 `differsOn` 与 `cost` 一起进夹具：只钉类型码和 cost 时，
     * 一个"类型码对、但偏离维列错"的实现仍然能通过 —— 而那个字段正是报告页
     * "为什么还给了另一个候选"的文案来源。
     */
    const expectCoverage = {}
    for (const dimension of DIMENSIONS) {
      const row = result.coverage.perDimension[dimension]
      expectCoverage[dimension] = { rating: row.rating, unknown: row.unknown, unprocessed: row.unprocessed }
    }

    /*
     * `title` 不手写，而是由**已算出的结果**拼出来。
     *
     * 手写标题会烂：这 18 个用例在开发过程中不断调整 fill 值，而标题往往留在原地，
     * 于是"参考类型 ENTJ"这种句子会和实际期望的 ENFP 一起被当成正确值固化下来
     * —— 读夹具的人相信标题，就不再去核对数字。让标题从结果派生，二者不可能不一致。
     */
    const title = [
      `状态 ${result.status}`,
      result.computedTypeCode ? `四字母 ${result.computedTypeCode}` : '无四字母',
      `候选 ${result.candidates.length} 个`,
      `服务端安排补充题 [${result.scheduled.join(',') || '无'}]`,
      skipped ? '用户跳过' : '未跳过',
      result.coverage.ok ? '覆盖达标' : '覆盖不足',
    ].join('｜')

    cases.push({
      id: spec.id,
      title,
      note: spec.note ?? null,
      answers: finalAnswers,
      clarification: {
        scheduled: result.scheduled,
        skipped,
        submitted: Object.keys(clarificationAnswers),
      },
      expect: {
        reviewScheduled: reference.scheduled,
        status: result.status,
        computedTypeCode: result.computedTypeCode,
        coverageOk: result.coverage.ok,
        dimensionOrder: DIMENSIONS,
        dimensions: expectDimensions,
        coverage: expectCoverage,
        // 「哪几维主测没凑够」必须进夹具：它是 NEEDS_REVIEW 时唯一能告诉前端
        // 「还差哪一维」的字段。前端要靠它高亮未完成的维度，
        // 少了它前端只能显示"覆盖不足"却指不出位置。
        insufficientDimensions: result.coverage.insufficientDimensions,
        tiedDimensions: result.tiedDimensions,
        candidateCodes: result.candidates.map((c) => c.typeCode),
        candidateCosts: result.candidates.map((c) => c.cost),
        candidateDiffersOn: result.candidates.map((c) => c.differsOn),
      },
    })
  }

  if (problems.length > 0) {
    throw new Error(`夹具定义有问题（${problems.length} 项）：\n - ${problems.join('\n - ')}`)
  }

  const canonical = JSON.stringify(
    {
      scoringVersion: POLICY.version,
      packageId: PACKAGE.packageId,
      dynamicsVersion: DYNAMICS_VERSION,
      cases,
      // 16 型的过程结构：不只是"参考值"，它是过程层唯一能守住"内倾那一支没写反"的凭据
      typeProcesses: ALL_TYPE_CODES.map(deriveProcesses),
    },
    null,
    2,
  )
  return `${canonical}\n`
}

const check = process.argv.includes('--check')
let payload
try {
  payload = build()
} catch (error) {
  console.error(error?.stack ?? String(error.message ?? error))
  process.exit(1)
}

if (check) {
  let drift = false
  for (const target of OUTPUTS) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current !== payload) {
      console.error(`夹具已漂移：${target}`)
      drift = true
    }
  }
  if (drift) process.exit(1)
  console.log(`夹具一致（${OUTPUTS.length} 份，sha256=${createHash('sha256').update(payload).digest('hex').slice(0, 12)}）`)
  process.exit(0)
}

for (const target of OUTPUTS) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, payload, 'utf8')
  console.log(`已写入 ${target}`)
}
