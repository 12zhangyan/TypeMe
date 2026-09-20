#!/usr/bin/env node
/**
 * 生成「图片发布映射」（前端运行时用）与「上传清单」（运维用）。
 *
 * 目的：网站公开插画要迁到对象存储时，必须**按真实的素材文件名**映射，
 * 而不是猜 Vite 构建后的文件名（构建产物名带 Vite 自己的哈希，且随时会变）。
 * 所以这里以 `frontend/src/assets/illustrations/` 里的实际文件为唯一事实来源：
 *
 *   1. 逐个算 SHA-256（上传前/上线后都能核对字节，避免"传了旧图"）；
 *   2. 对象键带**内容哈希**（`illustrations/<发布版本>/<名字>.<哈希>.webp`），
 *      文件名一变就是一个新对象，旧缓存不会和新页面混用；
 *   3. 同一份扫描结果同时产出运行时映射与上传清单，两边不可能对不上。
 *
 * 只输出**网站公开插画**。脚本用白名单反向约束：
 *   - 类型人物：必须能在 `frontend/src/design/personalityPortraits.json` 里找到对应代码；
 *   - 场景插画：必须是 `SCENE_ILLUSTRATIONS` 里列出的名字，且真的在 `frontend/src` 里被引用。
 * 素材目录里出现白名单以外的图片（报告截图、答卷、账号相关的任何图片）会**直接报错**，
 * 不允许"顺手一起传上去"。
 *
 * 用法（仓库根目录）：
 *
 *     node scripts/gen-image-publish.mjs            # 生成 / 更新上传清单
 *     node scripts/gen-image-publish.mjs --check     # 只校验与素材一致，不写文件
 *     node scripts/gen-image-publish.mjs --emit-sql [--out <文件>] [--force]
 *                                                   # 生成"图片地址入库"的手工交付 SQL
 *
 * 环境变量：
 *
 *     TYPEME_IMAGE_RELEASE   对象键里的发布版本段（默认 2026-09-20）
 *
 * 产物：
 *
 *     docs/cloud/2026-09-20-image-cos/upload-manifest.json          上传清单（机器可读）
 *     docs/cloud/2026-09-20-image-cos/upload-manifest.md            上传清单（人可读）
 *
 * 以前还产出一份随前端发布的 `frontend/src/design/illustrationPublish.json`（名字 → 对象键）。
 * 地址改成数据库驱动后它没有消费者了：前端不再拼地址，入库 SQL 里的 INFO 已经包含
 * 名字、地址与哈希，上传清单里也有对象键。**同一份事实不再生成两份**，所以它被删掉了。
 * 历史文件仍能在 git 里查到。
 *
 * 关于 `--emit-sql`：运行期地址的事实来源是数据库表 `illustration_asset`（见
 * `docs/2026-09-20/图片URL入库方案.md`）。这个模式把当前素材对应的绝对地址生成成
 * **一份手工交付的 SQL**（`docs/2026-09-20/illustration-asset.sql`）：
 *
 *   - 默认写到 stdout；给了 `--out` 才写文件（约定就是上面那个路径）；
 *   - **它刻意不是 Flyway 迁移**：不放在 `db/migration/` 下，所以不会随部署自动执行，
 *     由人在服务器上跑一次。仓库里也没有对应的 Flyway 版本号。
 *   - **已存在的文件一律拒绝覆盖**（这份文件是交付记录，改地址请新建一份并改名或先用
 *     `PUT /api/v3/platform/illustrations`），除非显式 `--force`；
 *   - 域名取 `--base-url` 或 `TYPEME_IMAGE_BASE_URL`，默认 COS 官方域名；
 *     它只在"生成 SQL"时用到，**不再进入前端包**（这正是入库要解决的问题）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ASSET_DIR = join(ROOT, 'frontend/src/assets/illustrations')
const SRC_DIR = join(ROOT, 'frontend/src')
const PORTRAITS_JSON = join(ROOT, 'frontend/src/design/personalityPortraits.json')

const MANIFEST_DIR = join(ROOT, 'docs/cloud/2026-09-20-image-cos')
const MANIFEST_JSON = join(MANIFEST_DIR, 'upload-manifest.json')
const MANIFEST_MD = join(MANIFEST_DIR, 'upload-manifest.md')

const RELEASE = (process.env.TYPEME_IMAGE_RELEASE || '2026-09-20').trim()
const CHECK = process.argv.includes('--check')
const EMIT_SQL = process.argv.includes('--emit-sql')
const FORCE = process.argv.includes('--force')

/** 约定的图片域名（COS 官方默认域名）。只在生成 SQL 时用到，不进前端包。 */
const DEFAULT_IMAGE_BASE_URL = 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com'

if (CHECK && EMIT_SQL) {
  console.error('--check 与 --emit-sql 不能同时使用：前者只校验产物，后者生成迁移 SQL。')
  process.exit(1)
}

/** 取 `--name value` 形式的参数；缺值直接报错，避免"静默用了默认值"。 */
function optionValue(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) {
    console.error(`${name} 后面缺少取值`)
    process.exit(1)
  }
  return value
}

/**
 * 图片域名（只用于生成 `INSERT` 里的绝对地址）。规则与前端 `remoteImageUrl.ts` 刻意保持一致：
 * 只允许 https；回环地址额外允许 http（那是"本地模拟图片域名"验收用的）。
 */
function resolveBaseUrl() {
  const raw = (optionValue('--base-url') || process.env.TYPEME_IMAGE_BASE_URL || DEFAULT_IMAGE_BASE_URL).trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    console.error(`图片域名不是合法 URL：${raw}`)
    process.exit(1)
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    console.error(`图片域名必须是 https（回环地址除外）：${raw}`)
    process.exit(1)
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/** SQL 字符串字面量：单引号翻倍。值本身还会被格式校验，这里是第二道。 */
const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`

/** 场景插画白名单：与 `assets/illustrations/README.md` 的「场景文件」一节一致。 */
const SCENE_ILLUSTRATIONS = ['assessment-bigfive', 'assessment-jung', 'home-hero', 'reflection', 'welcome']

const EXTENSIONS = ['.webp', '.avif', '.png']
const CONTENT_TYPES = { '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png' }
/**
 * 对象键含内容哈希，同一路径的字节永不改变，所以可以长缓存 + immutable。
 * 这里和 `docs/.../PLAN.md` 里的缓存策略、以及 COS 上的对象元数据必须一致。
 * 直连 COS 官方域名时没有 CDN 那一层，客户端缓存（浏览器）就是唯一的缓存，
 * 因此这个头必须真的带到对象上，不能只写在文档里。
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

const problems = []
const fail = (message) => problems.push(message)

/* ── 1. 允许上传的名字（白名单） ───────────────────────────────────────── */

const portraits = JSON.parse(readFileSync(PORTRAITS_JSON, 'utf8'))
const typeNames = portraits.map((item) => `type-${String(item.code).toLowerCase()}`)
const allowed = new Set([...SCENE_ILLUSTRATIONS, ...typeNames])

/* ── 2. 校验场景插画确实被前端引用（避免白名单变成"残留下载目录"） ─────── */

function sourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue
      found.push(...sourceFiles(full))
    } else if (/\.(vue|ts|mts|js|mjs|css)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      found.push(full)
    }
  }
  return found
}

const sourceText = sourceFiles(SRC_DIR)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

for (const name of SCENE_ILLUSTRATIONS) {
  if (!sourceText.includes(`'${name}'`) && !sourceText.includes(`"${name}"`)) {
    fail(`场景插画「${name}」在 frontend/src 里找不到引用：白名单过期了，先确认它是否仍是公开页面素材`)
  }
}

/* ── 3. 扫描素材目录 ───────────────────────────────────────────────────── */

const byName = new Map()
for (const entry of readdirSync(ASSET_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  const extension = extname(entry.name).toLowerCase()
  if (!EXTENSIONS.includes(extension)) continue
  const name = entry.name.slice(0, -extension.length)
  const existing = byName.get(name)
  if (existing) {
    fail(`素材「${name}」同时存在 ${existing.extension} 与 ${extension}：同名多格式无法确定上传哪一个，先删掉不用的`)
    continue
  }
  byName.set(name, { name, extension, file: join(ASSET_DIR, entry.name) })
}

for (const name of byName.keys()) {
  if (!allowed.has(name)) {
    fail(`素材「${name}」不在公开插画白名单内：本清单只允许网站公开插画，报告、答卷、账号信息等私人文件不得上传`)
  }
  // 名字会直接进对象键、进数据库主键、进 SQL 字面量：先钉住形状，别让奇怪的文件名流下去。
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`素材「${name}」的名字不符合 ^[a-z0-9][a-z0-9-]*$：改文件名后再发布（它要进对象键与数据库主键）`)
  }
}
for (const name of allowed) {
  if (!byName.has(name)) {
    fail(`公开插画「${name}」缺少素材文件：发布映射会缺一项，页面配置图片域名后会回退到本地资源`)
  }
}

/* ── 4. 计算哈希与对象键 ───────────────────────────────────────────────── */

const items = [...byName.values()]
  .filter((entry) => allowed.has(entry.name))
  .map((entry) => {
    const bytes = readFileSync(entry.file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const objectKey = `illustrations/${RELEASE}/${entry.name}.${sha256.slice(0, 12)}${entry.extension}`
    return {
      name: entry.name,
      localPath: relative(ROOT, entry.file).split('\\').join('/'),
      objectKey,
      sha256,
      bytes: bytes.length,
      contentType: CONTENT_TYPES[entry.extension],
      cacheControl: CACHE_CONTROL,
    }
  })
  .sort((a, b) => (a.name < b.name ? -1 : 1))

if (items.length === 0) fail('素材目录里没有扫到任何公开插画，拒绝生成空清单')

if (problems.length > 0) {
  console.error('图片发布清单生成中止：\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error('')
  process.exit(1)
}

/* ── 5. 产物 ───────────────────────────────────────────────────────────── */

const manifest = {
  _comment: '由 scripts/gen-image-publish.mjs 生成。只包含网站公开插画，不含报告、答卷或账号信息。',
  release: RELEASE,
  objectPrefix: `illustrations/${RELEASE}/`,
  reason: '对象键含内容哈希：同名文件重新导出后是新对象，旧缓存不会与新页面混用。',
  totals: {
    count: items.length,
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
  },
  items,
}

const mdRows = items
  .map(
    (item) =>
      `| \`${item.localPath.split('/').pop()}\` | \`${item.objectKey}\` | \`${item.sha256.slice(0, 16)}…\` | ${item.bytes} | \`${item.contentType}\` | \`${item.cacheControl}\` |`,
  )
  .join('\n')

const manifestMd = `# 图片上传清单（发布版本 ${RELEASE}）

由 \`node scripts/gen-image-publish.mjs\` 生成，请勿手改。素材来源：\`frontend/src/assets/illustrations/\`
（已压缩的网页版本，共 ${items.length} 张、${manifest.totals.bytes} 字节）。

**只包含网站公开插画**：5 张场景图 + 16 张人物图。不含报告、答卷、账号信息或任何私人文件；
脚本按白名单校验，素材目录里出现名单以外的图片会直接报错。

对象键一律为 \`illustrations/${RELEASE}/<名字>.<内容哈希前 12 位><扩展名>\`。
同名文件改了内容就是新对象，因此可以放心长缓存（\`${CACHE_CONTROL}\`），
永远不需要刷缓存，也不会出现"旧内容配新页面"。

| 文件名 | 对象键 | SHA-256（前 16 位） | 字节 | Content-Type | Cache-Control |
| --- | --- | --- | ---: | --- | --- |
${mdRows}

完整 SHA-256 与本地路径见同目录 \`upload-manifest.json\`（上传脚本应以该文件为输入）。
云端方案、最小权限与切换步骤见 \`PLAN.md\`。
`

const outputs = [
  [MANIFEST_JSON, JSON.stringify(manifest, null, 2) + '\n'],
  [MANIFEST_MD, manifestMd],
]

/* ── 6. 交付 SQL（--emit-sql）：把"当前素材对应的绝对地址"变成库里的数据 ── */

/** 交付件 SQL 的固定位置：手工执行、不进 db/migration（因此不会被 Flyway 自动执行）。 */
const DELIVERY_SQL = 'docs/2026-09-20/illustration-asset.sql'

function deliverySql(baseUrl) {
  const rows = items
    .map((item) => `    (${sqlLiteral(item.name)}, ${sqlLiteral(`${baseUrl}/${item.objectKey}`)}, ${sqlLiteral(item.sha256)}, ${sqlLiteral(RELEASE)}, CURRENT_TIMESTAMP)`)
    .join(',\n')
  return `-- 公开插画的远端地址（数据库驱动）——**手工交付件，不是 Flyway 迁移**。
--
-- 位置是有意的：它**不在** backend/src/main/resources/db/migration/ 下，
-- 所以既不会打进应用包、也不会在部署时被 Flyway 自动执行；由你在服务器上手工跑一次。
-- 从 GitHub 拉代码构建部署的 jar 不会带上它。
--
-- 生成方式：node scripts/gen-image-publish.mjs --emit-sql --out ${DELIVERY_SQL}
-- 运行时消费：GET /api/v3/platform/illustrations（公开只读，匿名可访问）
-- 运行期修改：PUT /api/v3/platform/illustrations（仅 ADMIN，改地址不必发版）
-- 方案与边界：docs/2026-09-20/图片URL入库方案.md
--
-- 执行方式（服务器上，只跑一次）：
--     mysql -h <主机> -u <用户> -p <库名> < illustration-asset.sql
-- 已经建表或插过数据时不要重复执行：CREATE 加了 IF NOT EXISTS，但 21 条 INSERT 会主键冲突。
-- 想改某一张图的地址请用 PUT 接口，不要改本文件再跑一遍。
--
-- 只放**网站公开插画**（5 张场景图 + 16 张人物图）：不含报告、答卷、账号信息或任何私人文件。
-- url 里带内容哈希，改图 = 换对象键 = 天然无缓存问题；sha256 用于"库 ↔ 本地素材 ↔ 远端对象"
-- 三方核对（scripts/check-remote-images.mjs）。
--
-- COLLATE 钉 as_cs 的理由同 V1/V6：默认的 *_ai_ci 大小写不敏感会让 'home-hero' 与
-- 'HOME-HERO' 变成同一个主键值，白名单校验就白做了。COLLATE 只能写在列定义最末尾
-- （MySQL 与 H2 MySQL 模式的语法交集 —— 后端契约测试也在 H2 上执行本文件）。
CREATE TABLE IF NOT EXISTS illustration_asset (
    asset_name VARCHAR(64)  NOT NULL COLLATE utf8mb4_0900_as_cs,
    url        VARCHAR(512) NOT NULL,
    sha256     CHAR(64)     NOT NULL,
    release    VARCHAR(32)  NOT NULL,
    updated_at DATETIME(6)  NOT NULL,
    CONSTRAINT pk_illustration_asset PRIMARY KEY (asset_name)
);

INSERT INTO illustration_asset (asset_name, url, sha256, release, updated_at) VALUES
${rows};
`
}

if (EMIT_SQL) {
  const sql = deliverySql(resolveBaseUrl())
  const out = optionValue('--out')
  if (!out) {
    process.stdout.write(sql)
    process.exit(0)
  }
  const target = resolve(out)
  if (existsSync(target) && !FORCE) {
    // 交付件是"这一批地址曾经入库"的记录：不允许被静默重新生成覆盖，
    // 否则"库里现在是什么"就说不清了（改地址应当用 PUT 接口）。
    console.error(`✗ 目标已存在，拒绝覆盖：${relative(ROOT, target).split('\\').join('/')}`)
    console.error('  这份文件是交付记录：改地址请用 PUT /api/v3/platform/illustrations，')
    console.error('  确实要重新生成（例如换了发布版本，另存一份）时加 --force。')
    process.exit(1)
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, sql, 'utf8')
  console.log(`✓ 交付 SQL 已生成（${items.length} 行，版本 ${RELEASE}）`)
  console.log(`  · ${relative(ROOT, target).split('\\').join('/')}`)
  console.log('  这一步只生成文件；执行迁移受数据库写入授权约束，本脚本不会连库。')
  process.exit(0)
}

if (CHECK) {
  const drift = []
  for (const [file, expected] of outputs) {
    let actual = null
    try {
      actual = readFileSync(file, 'utf8')
    } catch {
      actual = null
    }
    if (actual !== expected) drift.push(relative(ROOT, file).split('\\').join('/'))
  }
  if (drift.length > 0) {
    console.error(`✗ 图片发布清单与素材不一致：${drift.join('、')}`)
    console.error('  运行 node scripts/gen-image-publish.mjs 重新生成后再提交。')
    process.exit(1)
  }
  console.log(`✓ 图片发布清单与素材一致（${items.length} 张，${manifest.totals.bytes} 字节，版本 ${RELEASE}）`)
  process.exit(0)
}

for (const [file, content] of outputs) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
}

console.log(`✓ 图片发布清单已生成（${items.length} 张，${manifest.totals.bytes} 字节，版本 ${RELEASE}）`)
for (const [file] of outputs) console.log(`  · ${relative(ROOT, file).split('\\').join('/')}`)
