/**
 * 生成多测评平台的第一批量表内容（后端与前端同构可读的 JSON）。
 *
 * 用法：
 *   node scripts/gen-platform-content.mjs            # 写文件
 *   node scripts/gen-platform-content.mjs --check    # 只比对，不写（CI / prebuild）
 *
 * 产出：
 *
 *   1. `backend/src/main/resources/content/typeme-jung48-zh-v2.json`
 *      十六型内容包的**新版本**。v1 一个字节都不改 —— 已绑定 v1 的旧草稿、
 *      旧报告与旧 sha256 必须继续可读，所以修正只能通过新 packageId 发布。
 *
 *      v2 相对 v1 的实质变化（逐条理由见 `docs/2026-09-18-platform-plan/题目审校与版本决策.md`）：
 *        - `JP-02`：题面语义（先选定一套做法往下推进 = J；留着几套看情况 = P）与原有
 *          `leftPole/rightPole` 相反。**只改键值，不改题面**。
 *        - `JP-03`：左端「很快接受改动，重新安排就好」描述的是"变更来了就顺"，
 *          按框架更接近 P；原题面写成"接受改动"容易被读成 J。v2 **重写左端**为
 *          "先不急着改，按原来那样试下去"（保留选择、不提前定死 = P），右端保留 J。
 *          这样 JP 主测仍然是左右各 6 题负极，既不制造系统偏差，也不靠调平衡掩盖错配。
 *        - 增加"可读层"（`readable`）：类型首屏一句话 + 每维一个可观察问题，
 *          让固定报告不再要求用户先学人格理论。
 *
 *   2. `backend/src/main/resources/content/typeme-type-report-zh-v2.json`
 *      16 型报告文案的新版本：逐字含 v1 的八个章节与三条行动（不删内容），
 *      另加 `readableSummary` / `readableFirstSteps` 两个**首屏易懂字段**。
 *
 *   3. `backend/src/main/resources/content/typeme-jung48-zh-v4.json`
 *      十六型内容包的**下一代阈值政策**。题目与维度文案逐字沿用 v3，只有
 *      `scoringPolicy` 的 `boundaryDenominator` 从 10 改成 5（`T(n) = B(n) = floor(2n/5)`）。
 *      这是产品阈值取舍，**不提高测量准确性**；v1/v2/v3 一个字节都不改。
 *
 *   4. `backend/src/main/resources/content/bigfive50-zh-v1.json`
 *      大五（IPIP-50）服务端内容包：50 题、五维、正反计分键、维度解释、
 *      缺答政策与来源/许可说明。题面与逐题解释取自仓库既有的
 *      `backend/src/main/resources/assessment-packages/ipip50-zh1.yml`
 *      （编号与计分键与 IPIP 官方 Big-Five Factor Markers 一致），
 *      这里只做"转成新平台可读的版本化快照 + 补五维解释"，不改题目、不改键值。
 *
 * 三条纪律（与 `scripts/convert-jung-content.mjs` 一致）：
 *   1. 运行期不解析 YAML；JSON 才是运行期输入。
 *   2. 指纹由本脚本与 Java 加载器用**同一套规范形**算出，两边不一致会变成
 *      "每天校验失败"从而被无视。
 *   3. `--check` 只比对不写：改了源却忘了生成会在这里非零退出。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseYaml } from './lib/yaml.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const CONTENT_OUT_DIR = join(root, 'backend/src/main/resources/content')
const V1_PACKAGE_PATH = join(CONTENT_OUT_DIR, 'typeme-jung48-zh-v1.json')
const V1_TYPE_REPORT_PATH = join(CONTENT_OUT_DIR, 'typeme-type-report-zh-v1.json')
const IPIP_SOURCE_PATH = join(root, 'backend/src/main/resources/assessment-packages/ipip50-zh1.yml')

const V2_PACKAGE_PATH = join(CONTENT_OUT_DIR, 'typeme-jung48-zh-v2.json')
const V2_TYPE_REPORT_PATH = join(CONTENT_OUT_DIR, 'typeme-type-report-zh-v2.json')
const IPIP_PACKAGE_PATH = join(CONTENT_OUT_DIR, 'bigfive50-zh-v1.json')

const V2_PACKAGE_ID = 'typeme-jung48-zh-v2'
const V2_SCORING_VERSION = 'typeme-jung48-score-v2'
const V2_REPORT_CONTENT_VERSION = 'typeme-type-report-zh-v2'
const V2_CONTENT_STATUS = 'draft_review_pending'

const V3_PACKAGE_PATH = join(CONTENT_OUT_DIR, 'typeme-jung48-zh-v3.json')
const V3_PACKAGE_ID = 'typeme-jung48-zh-v3'
const V3_SCORING_VERSION = 'typeme-jung48-score-v3'

const V4_PACKAGE_PATH = join(CONTENT_OUT_DIR, 'typeme-jung48-zh-v4.json')
const V4_PACKAGE_ID = 'typeme-jung48-zh-v4'
const V4_SCORING_VERSION = 'typeme-jung48-score-v4'
/*
 * v3 只换计分口径（边界与触发同尺度），**不改任何题目与报告文案**，因此复用一个已有的报告文案版本。
 *
 * 复用哪一版：**v1** —— 也就是当前新草稿实际在用的那一版。
 * 为什么不是更新的 v2：v2 的报告文案带 `readableSummary` / `readableFirstSteps`，
 * 服务端构造器一旦取到它就会把"八段 + 3 条成长行动"换成"一句话摘要 + 1 个可观察动作"，
 * 而那是另一条在途的易读性改造，不该由"换计分口径"这一件事顺带推上线。
 * 本次决定保持"新草稿的报告文案与今天完全一致"，只让计分规则变 ——
 * 判断依据是运行期**按包声明的版本解析**（取不到即启动失败），不是任何默认常量。
 */
const V3_REPORT_CONTENT_VERSION = 'typeme-type-report-zh-v1'

/*
 * v4 与 v3 一样**只换计分口径、不改任何题目与报告文案**，所以同样复用 v1 报告文案。
 * 复用理由与 v3 相同：v2 报告文案带 readableSummary / readableFirstSteps，会在服务端把
 * "八段 + 3 条成长行动"换成"一句话摘要 + 1 个可观察动作" —— 那是另一条在途的易读性改造。
 */
const V4_REPORT_CONTENT_VERSION = 'typeme-type-report-zh-v1'

const IPIP_PACKAGE_ID = 'typeme-bigfive50-zh-v1'
const IPIP_INSTRUMENT_ID = 'ipip50'
const IPIP_SCORING_VERSION = 'ipip-bfm50-1.0'
const IPIP_REPORT_CONTENT_VERSION = 'typeme-bigfive-report-zh-v1'
const IPIP_CONTENT_STATUS = 'draft_review_pending'

const TYPE_SECTION_ORDER = [
  'dailyLife',
  'strengths',
  'blindSpots',
  'communication',
  'studyWork',
  'stress',
  'growth',
  'neighbors',
]

const problems = []

function fail(message) {
  problems.push(message)
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} 不存在：${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 与 Java `JungPackageLoader.canonicalNode` 字段集合、顺序严格一致的规范形。 */
function jungCanonicalSource(pkg) {
  return {
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    instrument: {
      id: pkg.instrument.id,
      revision: pkg.instrument.revision,
      scoringVersion: pkg.instrument.scoringVersion,
      reportContentVersion: pkg.instrument.reportContentVersion,
      format: pkg.instrument.format,
      hasTypeCode: pkg.instrument.hasTypeCode,
      baseItemsPerDimension: pkg.instrument.baseItemsPerDimension,
      clarificationItemsPerDimension: pkg.instrument.clarificationItemsPerDimension,
      maxClarificationItems: pkg.instrument.maxClarificationItems,
    },
    title: pkg.title,
    contentStatus: pkg.contentStatus,
    scoringPolicy: {
      version: pkg.scoringPolicy.version,
      minBaseRatingsPerDimension: pkg.scoringPolicy.minBaseRatingsPerDimension,
      boundaryNumerator: pkg.scoringPolicy.boundaryNumerator,
      boundaryDenominator: pkg.scoringPolicy.boundaryDenominator,
      ratingMin: pkg.scoringPolicy.ratingMin,
      ratingMax: pkg.scoringPolicy.ratingMax,
      ratingNeutral: pkg.scoringPolicy.ratingNeutral,
    },
    dimensions: pkg.dimensions.map((dimension) => ({
      dimension: dimension.dimension,
      name: dimension.name,
      question: dimension.question,
      negativePole: dimension.negativePole,
      positivePole: dimension.positivePole,
      balanced: dimension.balanced,
      tiedNotice: dimension.tiedNotice,
    })),
    questions: pkg.questions.map((question) => ({
      id: question.id,
      stage: question.stage,
      dimension: question.dimension,
      scenario: question.scenario,
      textLeft: question.textLeft,
      textRight: question.textRight,
      leftPole: question.leftPole,
      rightPole: question.rightPole,
      help: question.help,
      facet: question.facet,
      order: question.order,
      reviewStatus: question.reviewStatus,
      provenance: question.provenance,
    })),
  }
}

function jungSha256(pkg) {
  return sha256(JSON.stringify(jungCanonicalSource(pkg)))
}

/**
 * 确认某个报告内容版本**确实存在于已生成的内容目录**，并读回它自己声明的版本号。
 *
 * <p>为什么必须查文件而不是只看常量：内容包声明的是 `reportContentVersion`，
 * 运行期 `JungPackageLoader` 按**包自己声明的那个版本**去 `typeReportContents` 里取文案，
 * 取不到就在启动期抛异常。如果只在生成期比较常量，就可能产出一个"常量对得上、
 * 但文件不存在"的包 —— 那时错误要等到服务启动才暴露。
 */
function requireTypeReportVersion(version, label) {
  // 报告内容文件名就是它自己声明的版本号（typeme-type-report-zh-vN.json）。
  const path = join(CONTENT_OUT_DIR, `${version}.json`)
  if (!existsSync(path)) {
    fail(`${label} 引用的报告内容版本 ${version} 没有对应文件（${path.replace(root, '.')}），`
      + '请先生成该版本报告再生成内容包')
    return null
  }
  const report = readJson(path, `${label} 报告内容`)
  if (report.reportContentVersion !== version) {
    fail(`${label} 引用 ${version}，但该文件自己声明的是 ${report.reportContentVersion}`)
    return null
  }
  return report
}

/* ── 十六型 v2：逐题修正 ────────────────────────────────────────────────── */

/**
 * v2 相对 v1 的逐题修正。**只列真正改动过的题**；未列出的题逐字沿用 v1。
 *
 * 每一项都必须写清"为什么改"：审校表（`题目审校与版本决策.md`）从这份数据
 * 与 v1/v2 的 diff 生成，不允许出现"改了但没人说得清为什么"的题。
 */
const JUNG_V2_ITEM_CORRECTIONS = {
  'JP-02': {
    reason:
      '键值与题面语义相反：左端「先定下一套做法，往下推进」按本项目定义偏 J，'
      + '右端「同时留着几套做法，看情况再说」偏 P。v2 用**交换两端呈现**修正：'
      + '把「先定下一套做法」放到右端、把「同时留着几套做法」放到左端，键值随之 P/J→J/P。'
      + '为什么不是只交换键值：JP 组主测原有的"左端为负极 6 题"是靠这题的错配凑出来的，'
      + '只换键值会让该组变成 7:5，给"一直点左边"引入系统偏差。交换呈现同时把语义和左右平衡一起修正，'
      + '且不因此重写任何一题的构念。',
    kind: 'swap-ends',
    scenario: '没有期限的任务',
    textLeft: '同时留着几套做法，看情况再说',
    textRight: '先定下一套做法，往下推进',
    leftPole: 'P',
    rightPole: 'J',
    help: '想一件不急、又有几种做法都行的事。如果你两种都做过，选你更常自然发生的那个。',
  },
  'JP-03': {
    reason:
      '原左端「很快接受改动，重新安排就好」把"接受变化"与"重新排计划"挤在一句里：'
      + '接受变化像 P，而重新排一遍时间表是典型的 J，用户无法判断这题在比较什么。'
      + '原键值 leftPole=P / rightPole=J 在方向上成立，所以 v2 **只重写两端文字、不改键值**：'
      + '左端改为"不重新排，顺着当时的情况走"，右端改为"马上重新排一遍，把后面的时间重新定下来"。',
    kind: 'rewrite',
    scenario: '原定安排被改动',
    textLeft: '不重新排，顺着当时的情况走',
    textRight: '马上重新排一遍，把后面的时间重新定下来',
    leftPole: 'P',
    rightPole: 'J',
    help: '想一次原来定好的安排被临时改掉的情形。如果你两种都做过，选你更常自然发生的那个。',
  },
  'JP-04': {
    reason:
      '键值与题面语义相反：左端「先告一段落，剩下的地方以后再改」是**尽快把事情收掉、不再挂着**（J），'
      + '右端「再多留一点时间，接着改下去」是**保留继续改的余地**（P），原键值恰好标反。'
      + '与 JP-02 同样用**交换两端呈现**修正：左端放"再多留一点时间，接着改下去"（P），'
      + '右端放"先告一段落，剩下的地方以后再改"（J），键值 J/P→P/J，JP 组左右平衡不受影响。',
    kind: 'swap-ends',
    scenario: '事情快做完的时候',
    textLeft: '再多留一点时间，接着改下去',
    textRight: '先告一段落，剩下的地方以后再改',
    leftPole: 'P',
    rightPole: 'J',
    help: '想一件快做完、自己还觉得有地方能改的事。如果你两种都做过，选你更常自然发生的那个。',
  },
  'JP-10': {
    reason:
      '原左端「就让它这样，留些地方以后再看」容易被读成"做事不积极"，而它要表达的是'
      + '**不把结果定死**（P）；原右端「顺手把还能改的地方改掉」是**把它收尾定下来**（J）。'
      + '键值方向成立，问题在题面把构念混进了"勤快/拖沓"，因此 v2 **只重写文字、不改键值**：'
      + '左端改为"先不做最终决定，放一放再看看"，右端改为"尽快收个尾，把它定下来"。',
    kind: 'rewrite',
    scenario: '一件暂时做完的事',
    textLeft: '先不做最终决定，放一放再看看',
    textRight: '尽快收个尾，把它定下来',
    leftPole: 'P',
    rightPole: 'J',
    help: '想一件你已经做得差不多、还没最终定下的事。如果你两种都做过，选你更常自然发生的那个。',
  },
}

/** 可读层：类型首屏一句话。模板化的，不是本人结论；必须与维度证据同现。 */
const TYPE_READABLE_SUMMARY = {
  summary:
    '这次回答里，四个方面的倾向组合起来更接近 {code}。这说的是你在本次题目里的选择方式，'
    + '不是对你的定论，也不说明能力高低。',
  observation:
    '可以留意一件事：{firstObservation}',
}

/** 每维一个"可以观察什么"的问题，用于报告第二层的可读解释（不出现字母术语）。 */
const DIMENSION_READABLE = {
  EI: {
    dailyLife: '和人聊完之后，你通常想再找人接着聊，还是想先安静一会儿？',
    caution: '它只说明精力更容易从哪里回来，不说明你合不合群、会不会社交。',
    observation: '下一次聚会结束、回到家时，留意自己最想做的是说话还是安静。',
  },
  SN: {
    dailyLife: '听人介绍一件新东西时，你更想先要一个能照着做的例子，还是先听整体怎么回事？',
    caution: '它只说明你更信哪一类信息，不说明想象力高低，也不说明务实与否。',
    observation: '下次学一样新东西时，留意自己第一反应是先找例子还是先问原理。',
  },
  TF: {
    dailyLife: '要在两个都办得成的做法里选一个时，你更先看标准是否一致，还是先看影响到了谁？',
    caution: '它只说明做取舍时的先后顺序，不说明你讲不讲道理、在不在乎别人。',
    observation: '最近一次为难的取舍里，留意自己先想到的是依据还是人的处境。',
  },
  JP: {
    dailyLife: '有一件不着急、几种做法都行的事，你更愿意先选定一种，还是先都留着？',
    caution: '它只说明你更舒服的推进节奏，不说明自律程度，也不说明做事快慢。',
    observation: '下一次安排空出来的一天时，留意自己是先定顺序还是先留着再决定。',
  },
}

function buildJungV2() {
  const v1 = readJson(V1_PACKAGE_PATH, '十六型 v1 内容包')
  const questions = v1.questions.map((question) => {
    const fix = JUNG_V2_ITEM_CORRECTIONS[question.id]
    if (!fix) return { ...question }
    // 只把"内容字段"合进去：`reason` / `kind` 是审校元数据，不进内容包
    // （内容包的规范形参与指纹计算，多一个字段就等于换了一份内容）。
    const { reason, kind, ...contentFields } = fix
    void reason
    void kind
    return { ...question, ...contentFields }
  })

  // 结构不变量：v2 不允许在数量、左右平衡、题号形状上偷偷变松。
  const baseByDimension = new Map()
  for (const question of questions) {
    if (question.stage !== 'base') continue
    const entry = baseByDimension.get(question.dimension) ?? { total: 0, negativeOnLeft: 0 }
    entry.total += 1
    const negativePole = { EI: 'I', SN: 'S', TF: 'T', JP: 'J' }[question.dimension]
    if (question.leftPole === negativePole) entry.negativeOnLeft += 1
    baseByDimension.set(question.dimension, entry)
  }
  for (const [dimension, entry] of baseByDimension) {
    if (entry.total !== 12) fail(`v2 ${dimension}：主测应有 12 题，实际 ${entry.total}`)
    if (entry.negativeOnLeft !== 6) {
      fail(`v2 ${dimension}：左端为负极的主测题应为 6，实际 ${entry.negativeOnLeft}（会造成一直点左边的系统偏差）`)
    }
  }
  if (questions.length !== 64) fail(`v2 题目总数应为 64，实际 ${questions.length}`)

  // JP-02 / JP-04 的极性修正必须真的生效 —— 这两条断言是本次修正的核心，
  // 不能只靠人眼看 diff。交换呈现后：左端是 P（保留选项）、右端是 J（定下来），
  // 于是"选左端"的贡献为负，落到 J 的对面 P 上，与题面语义一致。
  for (const id of ['JP-02', 'JP-04']) {
    const item = questions.find((question) => question.id === id)
    if (!item) {
      fail(`v2 ${id} 不存在`)
      continue
    }
    if (item.leftPole !== 'P' || item.rightPole !== 'J') {
      fail(`v2 ${id} 修正后左端应为 P、右端应为 J，实际 ${item.leftPole}/${item.rightPole}`)
    }
  }
  const jp02 = questions.find((question) => question.id === 'JP-02')
  if (jp02 && !jp02.textRight.includes('先定下一套做法')) {
    fail('v2 JP-02 右端应为「先定下一套做法，往下推进」（语义与键值必须同时正确）')
  }
  const jp04 = questions.find((question) => question.id === 'JP-04')
  if (jp04 && !jp04.textLeft.includes('接着改下去')) {
    fail('v2 JP-04 左端应为「再多留一点时间，接着改下去」（保留继续改 = P）')
  }

  const pkg = {
    schemaVersion: v1.schemaVersion,
    packageId: V2_PACKAGE_ID,
    instrument: {
      ...v1.instrument,
      revision: 'v2',
      scoringVersion: V2_SCORING_VERSION,
      reportContentVersion: V2_REPORT_CONTENT_VERSION,
    },
    title: v1.title,
    contentStatus: V2_CONTENT_STATUS,
    scoringPolicy: {
      ...v1.scoringPolicy,
      version: V2_SCORING_VERSION,
    },
    readable: {
      typeSummary: TYPE_READABLE_SUMMARY.summary,
      typeObservation: TYPE_READABLE_SUMMARY.observation,
      dimensions: DIMENSION_READABLE,
    },
    dimensions: v1.dimensions.map((dimension) => ({ ...dimension })),
    questions,
  }
  pkg.sha256 = jungSha256(pkg)
  return pkg
}

/* ── 十六型 v3：只换计分口径的声明，题目与文案逐字沿用 v2 ───────────────── */

/**
 * 十六型 v3：**只改版本声明**（`scoringVersion` 从 `…-score-v2` 到 `…-score-v3`），
 * 题目、维度文案、报告文案一律不动。
 *
 * <p>为什么需要新包而不是原地改 v2：`assessment_package` 按 `packageId + sha256` 登记，
 * 内容包一旦被草稿/报告绑定就不能静默替换（改了就等于让同一个 packageId 指向两份内容，
 * 历史报告无法解释）。计分规则由 `scoringVersion` 分派，所以"换规则"必须落在一个新的
 * `scoringVersion` 上，并且要有一个声明它的内容包。
 *
 * <p>本次改动**不涉及任何题面**：下面用深比较钉住这一点，任何人顺手改题都会在生成期失败。
 *
 * @param {object} v2 buildJungV2() 的结果（必须是同一份会被写盘的字节来源）
 */
function buildJungV3(v2) {
  if (v2.questions.length !== 64) fail(`v3 题目总数应沿用 v2 的 64，实际 ${v2.questions.length}`)
  // 复用 v2 的报告文案版本前，先确认那个版本的文件真的存在、且自己声明的版本号对得上。
  requireTypeReportVersion(V3_REPORT_CONTENT_VERSION, 'v3')

  const pkg = {
    // 先整体沿用 v2，再覆盖与版本有关的字段：这样 v2 将来新增字段（例如 readable）
    // 不会被 v3 悄悄丢掉，也不需要在这里维护一份字段清单。
    ...v2,
    packageId: V3_PACKAGE_ID,
    instrument: {
      ...v2.instrument,
      revision: 'v3',
      scoringVersion: V3_SCORING_VERSION,
      reportContentVersion: V3_REPORT_CONTENT_VERSION,
    },
    contentStatus: v2.contentStatus,
    scoringPolicy: {
      ...v2.scoringPolicy,
      version: V3_SCORING_VERSION,
    },
    dimensions: v2.dimensions.map((dimension) => ({ ...dimension })),
    questions: v2.questions.map((question) => ({ ...question })),
  }
  delete pkg.sha256
  // 本次不改题面：派生结果必须与 v2 的题目、维度逐字相同。
  if (JSON.stringify(pkg.questions) !== JSON.stringify(v2.questions)) {
    fail('v3 应逐字沿用 v2 的题目：本次是计分口径调整，不允许夹带题面改动')
  }
  if (JSON.stringify(pkg.dimensions) !== JSON.stringify(v2.dimensions)) {
    fail('v3 应逐字沿用 v2 的维度文案：本次是计分口径调整，不允许夹带文案改动')
  }
  pkg.sha256 = jungSha256(pkg)
  return pkg
}

/* ── 十六型 v4：只换阈值（边界与触发同尺度，分母 10 → 5） ───────────────── */

/**
 * 十六型 v4：**只改阈值政策的数值**（`boundaryDenominator` 从 `10` 到 `5`，
 * 即 `T(n) = B(n) = floor(2n/5)`），题目、维度文案、报告文案一律不动。
 *
 * <p>为什么是 5 而不是把分子改成 4：`floor(2n/5)` 与 `floor(4n/10)` 在整数上恒等，
 * 但后者会让"分母恒为 10"这条隐含约定出现在内容包里，与 `v1/v2/v3` 的写法不一致。
 * 这里直接写 `2/5`，与契约 §4.1 的 `T(n) = B(n) = floor(2n/5)` 逐字对应。
 *
 * <p>为什么需要新包而不是原地改 v3：`assessment_package` 按 `packageId + sha256` 登记，
 * 内容包一旦被草稿/报告绑定就不能静默替换。计分规则由 `scoringVersion` 分派，
 * 所以"换规则"必须落在一个新的 `scoringVersion` 上，并且要有一个声明它的内容包。
 *
 * <p><b>本次改动不提高测量准确性</b>：0.20 是产品阈值取舍，没有本次可核验的
 * 信度/效度依据；文档必须如实写明这一点，不得写成"更准"。
 *
 * @param {object} v3 buildJungV3() 的结果（必须是同一份会被写盘的字节来源）
 */
function buildJungV4(v3) {
  if (v3.questions.length !== 64) fail(`v4 题目总数应沿用 v3 的 64，实际 ${v3.questions.length}`)
  requireTypeReportVersion(V4_REPORT_CONTENT_VERSION, 'v4')
  if (v3.scoringPolicy.boundaryNumerator !== 2 || v3.scoringPolicy.boundaryDenominator !== 10) {
    fail('v4 的前置假设不成立：v3 的边界尺度应为 2/10')
  }

  const pkg = {
    // 先整体沿用 v3，再覆盖与版本/阈值有关的字段：v3 将来新增字段不会被 v4 悄悄丢掉。
    ...v3,
    packageId: V4_PACKAGE_ID,
    instrument: {
      ...v3.instrument,
      revision: 'v4',
      scoringVersion: V4_SCORING_VERSION,
      reportContentVersion: V4_REPORT_CONTENT_VERSION,
    },
    contentStatus: v3.contentStatus,
    scoringPolicy: {
      ...v3.scoringPolicy,
      version: V4_SCORING_VERSION,
      // floor(2n/5)：触发与边界共用这一条尺度（与 v3 同口径，只换数值）。
      boundaryNumerator: 2,
      boundaryDenominator: 5,
    },
    dimensions: v3.dimensions.map((dimension) => ({ ...dimension })),
    questions: v3.questions.map((question) => ({ ...question })),
  }
  delete pkg.sha256

  // 本次不改题面、不改维度文案、不改可读层：派生结果必须与 v3 逐字相同。
  if (JSON.stringify(pkg.questions) !== JSON.stringify(v3.questions)) {
    fail('v4 应逐字沿用 v3 的题目：本次是阈值调整，不允许夹带题面改动')
  }
  if (JSON.stringify(pkg.dimensions) !== JSON.stringify(v3.dimensions)) {
    fail('v4 应逐字沿用 v3 的维度文案：本次是阈值调整，不允许夹带文案改动')
  }
  if (JSON.stringify(pkg.readable) !== JSON.stringify(v3.readable)) {
    fail('v4 应逐字沿用 v3 的可读层：本次是阈值调整，不允许夹带文案改动')
  }

  // 阈值政策只允许在这些字段上区别于 v3 —— 多改一个字节都说明"顺手夹带"。
  const allowedPolicyDifference = new Set(['version', 'boundaryDenominator'])
  const policyKeys = new Set([...Object.keys(v3.scoringPolicy), ...Object.keys(pkg.scoringPolicy)])
  for (const key of policyKeys) {
    if (v3.scoringPolicy[key] === pkg.scoringPolicy[key]) continue
    if (!allowedPolicyDifference.has(key)) {
      fail(`v4 的 scoringPolicy.${key} 与 v3 不同：本次只允许改 version 与 boundaryDenominator`)
    }
  }
  if (pkg.scoringPolicy.minBaseRatingsPerDimension !== 9 || pkg.scoringPolicy.ratingMin !== 1
    || pkg.scoringPolicy.ratingMax !== 5 || pkg.scoringPolicy.ratingNeutral !== 3) {
    fail('v4 不得改动覆盖下限与量表端点：这些不属于本次阈值调整')
  }

  // 触发/边界跳档点按 floor(2n/5) 写死：改错分母时生成期先红，而不是等测试。
  const expectedThreshold = (n) => (n <= 0 ? 0 : Math.floor((2 * n) / 5))
  for (const [n, expected] of [[9, 3], [12, 4], [16, 6], [5, 2], [4, 1], [3, 1], [2, 0]]) {
    if (expectedThreshold(n) !== expected) fail(`v4 契约表不自洽：floor(2*${n}/5) 应为 ${expected}`)
  }

  pkg.sha256 = jungSha256(pkg)
  return pkg
}

/* ── 16 型报告 v2 ──────────────────────────────────────────────────────── */

/** 首屏一句话：按类型码给"这一组倾向通常意味着什么"，不下个体断言。 */
function readableSummaryOf(report) {
  return `本次的参考类型是 ${report.code}（${report.nameCn}）。${report.tagline}`
    + '下面先说这次回答里比较明显和不太明显的部分，再分别展开四个方面。'
    + '这只是一次回答的整理，不是对你的定论，也不说明能力高低。'
}

/** 首屏"可以观察的一件事"：由类型码指向一个具体、可自查的生活动作。 */
function readableFirstStepsOf(report) {
  const letters = report.code.split('')
  const steps = []
  steps.push(
    letters[0] === 'I'
      ? '下一次讨论前，先花一分钟把自己的想法写下来，看看这样是不是更容易开口。'
      : '下一次有想法时，试着一有念头就说出来，看看边说边想是否比想好再说更顺。',
  )
  steps.push(
    letters[1] === 'S'
      ? '下一次听人介绍新方案时，先要一个具体的例子或数字，再看整体。'
      : '下一次收到一堆细节时，先问一句"它整体要解决什么"，再回到细节。',
  )
  return steps
}

function buildJungV2TypeReports() {
  const v1 = readJson(V1_TYPE_REPORT_PATH, '16 型报告 v1')
  const types = Array.isArray(v1.types) ? v1.types : []
  if (types.length !== 16) fail(`16 型报告 v1 应有 16 份，实际 ${types.length}`)

  const reports = types
    .map((report) => ({
      code: report.code,
      nameCn: report.nameCn,
      tagline: report.tagline,
      summary: report.summary,
      readableSummary: readableSummaryOf(report),
      readableFirstSteps: readableFirstStepsOf(report),
      ...Object.fromEntries(TYPE_SECTION_ORDER.map((key) => [key, report[key]])),
      nextActions: (report.nextActions ?? []).map((action) => ({
        title: action.title,
        steps: [...(action.steps ?? [])],
      })),
    }))
    .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0))

  for (const report of reports) {
    if (!report.code || !report.nameCn) fail('16 型报告缺少 code / nameCn')
    for (const key of TYPE_SECTION_ORDER) {
      if (typeof report[key] !== 'string' || report[key].length < 100) {
        fail(`${report.code} 的章节 ${key} 缺失或过短`)
      }
    }
    if (report.nextActions.length !== 3) fail(`${report.code} 的 nextActions 应为 3 条`)
    if (typeof report.readableSummary !== 'string' || report.readableSummary.length < 40) {
      fail(`${report.code} 的 readableSummary 过短`)
    }
    if (!Array.isArray(report.readableFirstSteps) || report.readableFirstSteps.length !== 2) {
      fail(`${report.code} 的 readableFirstSteps 应为 2 条`)
    }
  }

  // 指纹字段集合与顺序必须与 `JungPackageLoader.sha256OfTypeReports` 一致。
  const canonical = {
    schemaVersion: 1,
    reportContentVersion: V2_REPORT_CONTENT_VERSION,
    contentStatus: V2_CONTENT_STATUS,
    types: reports.map((report) => {
      const node = {
        code: report.code,
        nameCn: report.nameCn,
        tagline: report.tagline,
        summary: report.summary,
        readableSummary: report.readableSummary,
        readableFirstSteps: report.readableFirstSteps,
      }
      for (const key of TYPE_SECTION_ORDER) node[key] = report[key]
      node.nextActions = report.nextActions
      return node
    }),
  }

  return {
    schemaVersion: 1,
    reportContentVersion: V2_REPORT_CONTENT_VERSION,
    contentStatus: V2_CONTENT_STATUS,
    sha256: sha256(JSON.stringify(canonical)),
    types: reports,
  }
}

/* ── 大五（IPIP-50）内容包 ──────────────────────────────────────────────── */

const BIG_FIVE_DIMENSIONS = ['E', 'A', 'C', 'ES', 'O']

/**
 * 五个维度的中文解释。
 *
 * 三条硬约束（`docs/2026-09-18-platform-plan/整体改造方案.md` §4.2）：
 *   1. 只说"这一维描述什么"，不说"你是什么样的人"；
 *   2. 明确"不能据此判断什么"，尤其不能从取向推断能力、疾病或职业成败；
 *   3. 不出现百分位、常模、高于平均之类没有本地数据的说法。
 */
const BIG_FIVE_DIMENSION_COPY = {
  E: {
    name: '外向性',
    question: '和别人相处时你的活跃程度',
    lowLabel: '偏安静',
    highLabel: '偏活跃',
    lowDescription:
      '在人群里你更常是观察和听的那一个。人多、节奏快的场合你能应付，但连续待久了会觉得消耗，'
      + '更愿意和少数熟人说深一点的话。',
    highDescription:
      '在人群里你更容易先开口、先行动。你常常边说边想清楚，和别人一起做事的效率往往比自己闷头做更高，'
      + '一个人待久了会觉得有点闷。',
    lowDailySigns: [
      '和不熟的人在一起时话不多',
      '更喜欢一对一聊天而不是一群人',
      '热闹的场合结束后需要缓一缓',
      '主动搭话这件事对你来说要费点力气',
    ],
    highDailySigns: [
      '在陌生场合比较快就能和人聊起来',
      '常主动起话头、接话',
      '喜欢一边讨论一边把想法理清',
      '参加完热闹的场合通常不觉得被耗空',
    ],
    caution:
      '这一维说的是社交活跃程度，不是社交能力，也不说明你会不会和人相处、是否受欢迎。'
      + '安静的人可以很擅长沟通，活跃的人也可能很怕冲突。',
    observation: '下一次和别人待了一整个下午之后，留意自己是松了一口气还是更有精神。',
  },
  A: {
    name: '宜人性',
    question: '你对别人的体贴与配合程度',
    lowLabel: '偏直接',
    highLabel: '偏体贴',
    lowDescription:
      '你更愿意把事情本身说清楚，不太绕弯，对不同意的意见会直接讲出来。'
      + '这不等于不在乎别人，只是你更习惯用"把问题解决"来表达在意。',
    highDescription:
      '你比较容易注意到别人的处境和感受，说话前会先想对方接不接得住，'
      + '不太愿意为了坚持自己的看法把关系弄僵。',
    lowDailySigns: [
      '不同意时会直接说，不太先铺垫',
      '更在意事情有没有办成，而不是话说得好不好听',
      '不太会为了照顾气氛改口',
      '别人反复诉苦时容易觉得该讲点实际的',
    ],
    highDailySigns: [
      '别人情绪不对时你比较容易察觉',
      '提意见前会先想怎么说对方才听得进去',
      '不太愿意和人硬碰',
      '别人请你帮忙时比较难开口拒绝',
    ],
    caution:
      '这一维说的是相处时的默认方式，不是人品好坏，也不能说明你会不会被喜欢。'
      + '低分不等于冷漠，高分也不等于没有原则。',
    observation: '下一次你要说出不同意见时，留意自己是先说结论还是先说顾虑。',
  },
  C: {
    name: '尽责性',
    question: '你做事时的条理与投入程度',
    lowLabel: '偏随性',
    highLabel: '偏有序',
    lowDescription:
      '你更习惯同时推进几件事，按当下的状态决定先做哪一件。计划对你来说是参考，'
      + '临时换方向不算困难，只是东西容易乱、事情容易拖到最后。',
    highDescription:
      '你习惯先把事情安排清楚再动手，答应下来的事倾向于按时完成，'
      + '东西放在固定的地方会让你踏实。计划被打乱会让你不太舒服。',
    lowDailySigns: [
      '东西常常随手一放，过后再找',
      '习惯一次开几件事，交替着推进',
      '不到最后期限不太着急',
      '同一件事做久了会想换个新鲜的',
    ],
    highDailySigns: [
      '出门前习惯检查一遍有没有带齐',
      '待办事项会记下来，做完再划掉',
      '不喜欢事情停在半途',
      '答应了的事会挂在心上',
    ],
    caution:
      '这一维说的是做事的习惯，不是能力，也不是道德评价。'
      + '随性的人也可以把重要的事做得很扎实，有序的人也可能在别处拖延。',
    observation: '下一次同时有几件事要办时，留意自己是对着清单做还是凭当下的心情选。',
  },
  ES: {
    name: '情绪稳定性',
    question: '你对压力与情绪起伏的一般反应',
    lowLabel: '偏敏感',
    highLabel: '偏平稳',
    lowDescription:
      '你的情绪对周围的变化反应比较快：事情悬着的时候容易反复想，'
      + '心里不痛快时状态会明显受影响。这也意味着你常常比身边的人更早察觉气氛和风险。',
    highDescription:
      '大多数时候你的状态比较平，事情出岔子也不太容易搅乱你一整天。'
      + '这让你在乱的时候显得靠得住，但也可能让你低估自己在累积的压力。',
    lowDailySigns: [
      '事情还没发生就容易先担心',
      '心情起伏比较频繁',
      '被临时改变的安排影响得比较久',
      '睡前的状态常常取决于白天发生了什么',
    ],
    highDailySigns: [
      '大多数时候心是平的',
      '事情办砸了也能较快翻篇',
      '不太容易被人一句话影响一整天',
      '压力上来时自己不太容易先察觉',
    ],
    caution:
      '这一维说的是情绪反应的常见方式。它**不是**心理健康筛查，不能用来判断焦虑、抑郁或任何身心状况，'
      + '也不能说明抗压能力高低。如果你长期为此感到困扰，值得找专业的人聊，而不是看一份自测。',
    observation: '下一次计划被临时改动时，留意自己需要多久才不再想着这件事。',
  },
  O: {
    name: '开放性',
    question: '你对新想法与新经验的兴趣',
    lowLabel: '偏实际',
    highLabel: '偏好奇',
    lowDescription:
      '你更信看得见、用得上的东西：具体做法、实际例子、跑通过的方案。'
      + '对纯概念的推演兴趣有限，讨论如果一直不落到具体，你会想把它拉回来。',
    highDescription:
      '你容易被新的想法、假设和不一样的做法吸引，愿意为了"挺有意思"去了解暂时用不上的东西，'
      + '也常常把不同领域的事连起来想。',
    lowDailySigns: [
      '听人讲理论时容易想问"所以具体怎么做"',
      '更愿意沿用已经好用的做法',
      '对抽象话题的耐心有限',
      '不太喜欢为了新奇而换掉原来的方式',
    ],
    highDailySigns: [
      '对新领域比较容易被勾起兴趣',
      '常从一个话题联想到别的领域',
      '愿意花时间琢磨没有直接用处的问题',
      '喜欢假设和"如果……会怎样"的讨论',
    ],
    caution:
      '这一维说的是兴趣方向，不是聪明程度、学识水平或创造力高低。'
      + '偏好实际的人同样能想出新办法，好奇的人也可能做事很落地。',
    observation: '下一次接触完全陌生的领域时，留意自己是先找能用的做法还是先弄懂里面的道理。',
  },
}

function ipipCanonicalSource(pkg) {
  return {
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    instrument: {
      id: pkg.instrument.id,
      revision: pkg.instrument.revision,
      scoringVersion: pkg.instrument.scoringVersion,
      reportContentVersion: pkg.instrument.reportContentVersion,
      format: pkg.instrument.format,
      hasTypeCode: pkg.instrument.hasTypeCode,
      baseItemsPerDimension: pkg.instrument.baseItemsPerDimension,
      clarificationItemsPerDimension: pkg.instrument.clarificationItemsPerDimension,
      maxClarificationItems: pkg.instrument.maxClarificationItems,
    },
    title: pkg.title,
    contentStatus: pkg.contentStatus,
    scoringPolicy: {
      version: pkg.scoringPolicy.version,
      minBaseRatingsPerDimension: pkg.scoringPolicy.minBaseRatingsPerDimension,
      ratingMin: pkg.scoringPolicy.ratingMin,
      ratingMax: pkg.scoringPolicy.ratingMax,
      ratingNeutral: pkg.scoringPolicy.ratingNeutral,
      midpoint: pkg.scoringPolicy.midpoint,
      constants: pkg.scoringPolicy.constants,
      markedDistance: pkg.scoringPolicy.markedDistance,
      strongDistance: pkg.scoringPolicy.strongDistance,
    },
    dimensions: pkg.dimensions,
    questions: pkg.questions,
  }
}

function buildBigFivePackage() {
  if (!existsSync(IPIP_SOURCE_PATH)) throw new Error(`IPIP 源文件不存在：${IPIP_SOURCE_PATH}`)
  const source = parseYaml(readFileSync(IPIP_SOURCE_PATH, 'utf8'))
  const rawQuestions = source?.questionnaire?.questions
  if (!Array.isArray(rawQuestions) || rawQuestions.length !== 50) {
    throw new Error(`IPIP 源应有 50 题，实际 ${Array.isArray(rawQuestions) ? rawQuestions.length : 0}`)
  }
  const itemHelp = source?.itemHelp ?? {}

  const questions = rawQuestions.map((raw, index) => {
    const id = `Q${String(raw.id).padStart(2, '0')}`
    const dimension = String(raw.dimension)
    const direction = Number(raw.direction)
    if (!BIG_FIVE_DIMENSIONS.includes(dimension)) fail(`${id}：维度非法 ${dimension}`)
    if (direction !== 1 && direction !== -1) fail(`${id}：direction 必须是 ±1，实际 ${direction}`)
    if (typeof raw.text !== 'string' || raw.text.trim().length < 4) fail(`${id}：题面过短`)
    const help = itemHelp[String(raw.id)]?.explanation ?? ''
    if (typeof help !== 'string' || help.length < 20) fail(`${id}：缺少逐题解释（itemHelp）`)
    return {
      id,
      sourceItemId: String(raw.id),
      dimension,
      direction,
      order: index + 1,
      text: raw.text,
      help,
      reviewStatus: itemHelp[String(raw.id)]?.reviewStatus === 'reviewed' ? 'draft_review_pending' : 'draft_review_pending',
      provenance: 'IPIP-50（Goldberg Big-Five Factor Markers）条目，公有领域；中文题面与逐题解释为本仓库改写稿，'
        + '尚未完成真人试读与试测；计分键与官方 Big-Five Factor Markers 键表一致。',
    }
  })

  const perDimension = new Map()
  for (const question of questions) {
    perDimension.set(question.dimension, (perDimension.get(question.dimension) ?? 0) + 1)
  }
  for (const dimension of BIG_FIVE_DIMENSIONS) {
    const count = perDimension.get(dimension) ?? 0
    if (count !== 10) fail(`大五 ${dimension}：应有 10 题，实际 ${count}`)
    const copy = BIG_FIVE_DIMENSION_COPY[dimension]
    if (!copy) fail(`大五 ${dimension}：缺少维度解释文案`)
  }

  const dimensions = BIG_FIVE_DIMENSIONS.map((dimension) => {
    const copy = BIG_FIVE_DIMENSION_COPY[dimension]
    return {
      dimension,
      name: copy.name,
      question: copy.question,
      low: { label: copy.lowLabel, description: copy.lowDescription, dailySigns: copy.lowDailySigns },
      high: { label: copy.highLabel, description: copy.highDescription, dailySigns: copy.highDailySigns },
      caution: copy.caution,
      observation: copy.observation,
    }
  })

  const pkg = {
    schemaVersion: 1,
    packageId: IPIP_PACKAGE_ID,
    instrument: {
      id: IPIP_INSTRUMENT_ID,
      revision: 'goldberg-bfm-50-zh1',
      scoringVersion: IPIP_SCORING_VERSION,
      reportContentVersion: IPIP_REPORT_CONTENT_VERSION,
      format: 'agreement',
      hasTypeCode: false,
      baseItemsPerDimension: 10,
      clarificationItemsPerDimension: 0,
      maxClarificationItems: 0,
    },
    title: '大五人格倾向测评',
    contentStatus: IPIP_CONTENT_STATUS,
    scoringPolicy: {
      version: IPIP_SCORING_VERSION,
      // 未完成维度不补中点：50 题全部处理完（含"说不好"）才出报告。
      minBaseRatingsPerDimension: 10,
      ratingMin: 1,
      ratingMax: 5,
      ratingNeutral: 3,
      // 每题都选 3 时原始分正好落在中点（10 题 × 3 = 30）：常量配平关系由生成期断言守住。
      midpoint: 30,
      // 展示分档：与仓库既有 IPIP 档案一致（typeMinDistance 6 / markedDistance 11），
      // 按量程比例换算的**展示策略**，不是心理测量阈值。
      markedDistance: 6,
      strongDistance: 11,
    },
    answerAnchors: [
      '非常不符合',
      '比较不符合',
      '说不上符合或不符合',
      '比较符合',
      '非常符合',
    ],
    attribution: {
      source: 'IPIP-50（International Personality Item Pool，Goldberg Big-Five Factor Markers）',
      author: 'Lewis R. Goldberg / IPIP',
      url: 'https://ipip.ori.org/',
      license: '公有领域（Public Domain）',
      licenseUrl: 'https://ipip.ori.org/newPermission.htm',
    },
    dimensions,
    questions,
  }

  // 配平断言：常量必须由"每题都选中立档 = 中点"推出，不能手写。
  //
  // 这一维的公式是仓库既有的 IPIP 口径（`frontend/src/domain/scoring.ts`）：
  //
  //     score = constant + Σ direction×answer        （answer ∈ 1..5）
  //
  // 常量是**整维的一个基准分**（不是逐题项）：
  //
  //     constant = midpoint − neutral×Σdirection
  //               = 30 − 3×Σdirection
  //
  // 于是在中立档（都选 3）时正好落在中点 30。E 维 Σdirection=0 → 常量 30；
  // ES 维 2 正 8 反 → Σdirection=−6 → 常量 48。这与仓库既有 IPIP 内容包的常量
  // 逐项相同，用户可以拿这份包核对旧报告。
  //
  // 量程宽度 = 4×题数 = 40（answer 1↔5 相距 4，每题在两端各贡献 ±2）：
  //   全部偏向低端 = 正向题选 1、反向题选 5 → constant − 2×题数
  //   全部偏向高端 = 正向题选 5、反向题选 1 → constant + 2×题数
  // 跨过中点即可，不要求每维都恰好 10–50（ES 这类反向题多的维度天然是 6–50）。
  const constants = {}
  for (const dimension of BIG_FIVE_DIMENSIONS) {
    const items = questions.filter((question) => question.dimension === dimension)
    const sumDirection = items.reduce((total, item) => total + Number(item.direction), 0)
    const constant = pkg.scoringPolicy.midpoint - pkg.scoringPolicy.ratingNeutral * sumDirection
    constants[dimension] = constant
    const neutralScore = constant + pkg.scoringPolicy.ratingNeutral * sumDirection
    if (neutralScore !== pkg.scoringPolicy.midpoint) {
      fail(`大五 ${dimension} 的常量没有配平：每题都选 3 得 ${neutralScore}，中点应为 ${pkg.scoringPolicy.midpoint}`)
    }
    const low = constant - 2 * items.length
    const high = constant + 2 * items.length
    if (low >= pkg.scoringPolicy.midpoint || high <= pkg.scoringPolicy.midpoint) {
      fail(`大五 ${dimension} 的量程没有跨过中点（${low}–${high}，中点 ${pkg.scoringPolicy.midpoint}）`)
    }
    if (high - low !== 4 * items.length) {
      fail(`大五 ${dimension} 的量程宽度应为 4×题数（${4 * items.length}），实际 ${high - low}`)
    }
  }
  pkg.scoringPolicy.constants = constants
  // 指纹在补上 constants 之后重算 —— 规范形里包含它。
  pkg.sha256 = sha256(JSON.stringify(ipipCanonicalSource(pkg)))
  return pkg
}

/* ── 主流程 ────────────────────────────────────────────────────────────── */

function writeOrCheck(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  const exists = existsSync(path)
  const current = exists ? readFileSync(path, 'utf8') : ''
  if (checkOnly) {
    if (!exists) {
      console.log(`✗ ${path.replace(root, '.')} 不存在（需要生成）`)
      return false
    }
    if (current !== text) {
      console.log(`✗ ${path.replace(root, '.')} 与生成结果不一致（源改了但没重新生成？）`)
      return false
    }
    console.log(`✓ ${path.replace(root, '.')} 与源一致`)
    return true
  }
  if (current !== text) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text, 'utf8')
    console.log(`✓ 已写入 ${path.replace(root, '.')}`)
  } else {
    console.log(`= ${path.replace(root, '.')} 无变化`)
  }
  return true
}

const checkOnly = process.argv.includes('--check')

let jungV2
let jungV3
let jungV4
let typeReportsV2
let bigFive
try {
  jungV2 = buildJungV2()
  // 先生成 v2 报告：v3/v4 包要复用报告文案版本，requireTypeReportVersion 会去核对那份文件。
  typeReportsV2 = buildJungV2TypeReports()
  jungV3 = buildJungV3(jungV2)
  jungV4 = buildJungV4(jungV3)
  bigFive = buildBigFivePackage()
} catch (error) {
  console.error(`内容生成失败：${error.message}`)
  process.exit(1)
}

if (problems.length > 0) {
  console.error(`内容生成前校验失败（${problems.length} 项）：`)
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}

const results = [
  writeOrCheck(V2_PACKAGE_PATH, jungV2),
  writeOrCheck(V2_TYPE_REPORT_PATH, typeReportsV2),
  writeOrCheck(V3_PACKAGE_PATH, jungV3),
  writeOrCheck(V4_PACKAGE_PATH, jungV4),
  writeOrCheck(IPIP_PACKAGE_PATH, bigFive),
]

if (!results.every(Boolean)) {
  console.error('\n内容与生成结果不一致：请运行 node scripts/gen-platform-content.mjs 重新生成。')
  process.exit(1)
}

if (!checkOnly) {
  console.log(`\n十六型 v2 指纹：${jungV2.sha256.slice(0, 12)}…（包）`)
  console.log(`16 型报告 v2 指纹：${typeReportsV2.sha256.slice(0, 12)}…`)
  console.log(`十六型 v3 指纹：${jungV3.sha256.slice(0, 12)}…（包；报告文案沿用 ${V3_REPORT_CONTENT_VERSION}）`)
  console.log(`十六型 v4 指纹：${jungV4.sha256.slice(0, 12)}…（包；报告文案沿用 ${V4_REPORT_CONTENT_VERSION}）`)
  console.log(`大五（IPIP-50）指纹：${bigFive.sha256.slice(0, 12)}…`)
}
