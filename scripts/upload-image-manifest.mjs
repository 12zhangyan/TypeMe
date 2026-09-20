#!/usr/bin/env node
/**
 * 上传**计划**：把 `upload-manifest.json` 变成一份可人工审阅、可逐条核对的待上传列表。
 *
 * 这个脚本刻意**不联网、不写任何东西、也不读密钥**：
 *   - 默认只做两件事：① 重新计算本地素材的 SHA-256，确认"要传的就是清单里那批字节"；
 *     ② 打印每个对象的本地路径、对象键、字节数、Content-Type、Cache-Control，
 *        以及对应的 coscmd 命令。
 *   - 真正执行上传由人按 `PLAN.md` 的第 5 步来做（资源创建、上传与付费都需另行授权）。
 *
 * 之所以不在这里直接签 COS 请求：在没有凭据、也没有上传授权的情况下，
 * 任何"看起来能跑"的上传代码都无法被验证，反而会给出虚假的安全感。
 * 如果之后希望脚本化上传，再加 SDK 执行器也不迟。
 *
 * 用法（仓库根目录）：
 *
 *     node scripts/upload-image-manifest.mjs                # 打印上传计划
 *     node scripts/upload-image-manifest.mjs --check-local   # 只校验本地字节是否与清单一致
 *
 * 真上传时需要的最小权限见 `docs/cloud/2026-09-20-image-cos/PLAN.md` 第 6 节。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'docs/cloud/2026-09-20-image-cos/upload-manifest.json')
const CHECK_ONLY = process.argv.includes('--check-local')

if (!existsSync(MANIFEST)) {
  console.error(`✗ 找不到上传清单 ${MANIFEST}`)
  console.error('  先运行 node scripts/gen-image-publish.mjs')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const problems = []
let totalBytes = 0

for (const item of manifest.items) {
  const local = join(ROOT, item.localPath)
  if (!existsSync(local)) {
    problems.push(`缺少本地文件：${item.localPath}`)
    continue
  }
  const bytes = readFileSync(local)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== item.sha256) {
    problems.push(`字节与清单不一致：${item.localPath}（清单 ${item.sha256.slice(0, 12)}…，实际 ${sha256.slice(0, 12)}…）`)
    continue
  }
  if (bytes.length !== item.bytes) problems.push(`长度与清单不一致：${item.localPath}`)
  if (!item.objectKey.startsWith(manifest.objectPrefix)) {
    problems.push(`对象键不在发布前缀 ${manifest.objectPrefix} 下：${item.objectKey}`)
  }
  totalBytes += bytes.length
}

if (problems.length > 0) {
  console.error('上传计划校验失败：\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(`✓ 本地素材与清单一致：${manifest.items.length} 个对象，${totalBytes} 字节，发布版本 ${manifest.release}`)
console.log(`  桶内前缀：${manifest.objectPrefix}`)
console.log('  范围：仅网站公开插画（5 张场景 + 16 张人物）；不含报告、答卷、账号信息或任何私人文件。\n')

if (CHECK_ONLY) process.exit(0)

const BUCKET = process.env.TYPEME_COS_BUCKET || 'yan-public-1407914221'
const REGION = process.env.TYPEME_COS_REGION || 'ap-beijing'
const ACCESS_DOMAIN = `https://${BUCKET}.cos.${REGION}.myqcloud.com`

console.log('待上传列表（对象键含内容哈希，同名文件改了内容就是新对象）：\n')
for (const item of manifest.items) {
  console.log(`  ${item.localPath}`)
  console.log(`    → ${item.objectKey}`)
  console.log(`      ${item.bytes} 字节 · ${item.contentType} · ${item.cacheControl}`)
}

console.log(`
审阅通过后，按 docs/cloud/2026-09-20-image-cos/PLAN.md 第 6 节执行上传。

桶 / 地域 / 访问域名（本仓库当前约定值）：
    TYPEME_COS_BUCKET=${BUCKET}
    TYPEME_COS_REGION=${REGION}
    图片地址前缀（**不再进前端包**，只用于生成入库 SQL 与核对） = ${ACCESS_DOMAIN}

密钥只放在当前终端的环境变量里，不要写进文件、不要写进命令、不要回显
（建议用有效期数小时的 STS 临时密钥，用完即失效）：

    coscmd config -a <SecretId> -s <SecretKey> -b ${BUCKET} -r ${REGION}

逐条上传（带 Cache-Control：直连 COS 官方域名时没有 CDN 那一层，
浏览器缓存是唯一的缓存，这个头必须真的写到对象上）：
`)

for (const item of manifest.items) {
  console.log(
    `    coscmd upload -H "Cache-Control: ${manifest.items[0].cacheControl}" ` +
      `"${item.localPath}" "/${item.objectKey}"`,
  )
}

console.log(`
上传后核对（对象数、Content-Length、sha256 与清单一致）见 PLAN.md 第 9 节。
按 PLAN.md 第 9 节的清单逐项复核时，图片地址形如：
    ${ACCESS_DOMAIN}/${manifest.items[0].objectKey}

地址怎么进到页面：生成**手工交付 SQL**、在服务器上执行一次之后，前端启动时读
GET /api/v3/platform/illustrations：

    node scripts/gen-image-publish.mjs --emit-sql --out docs/2026-09-20/illustration-asset.sql
    # 该文件不是 Flyway 迁移：不放进 db/migration，由人在服务器上执行（见文件头注释）
    node scripts/check-remote-images.mjs --from-api <服务地址>     # 库 ↔ 本地素材 ↔ 远端对象 三方核对

本脚本没有执行任何上传、没有创建任何云资源、没有改动 DNS。`)
