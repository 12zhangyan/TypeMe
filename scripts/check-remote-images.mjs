#!/usr/bin/env node
/**
 * 匿名核对公开插画（**不带任何凭据**，只发公开 GET）。
 *
 * 两种取地址的来源，选一种：
 *
 *   1. **上传清单**（默认）：上传后按 PLAN.md §9 的清单逐项确认对象真的可匿名读取、
 *      响应头是我们要的、字节与本地素材逐字节一致；
 *   2. **服务端接口**（`--from-api=<服务地址>`）：读页面实际用的那份数据
 *      （`GET /api/v3/platform/illustrations`，事实来源是 `illustration_asset` 表），
 *      再逐个匿名下载核对。这是**库 ↔ 本地素材 ↔ 远端对象**的三方核对：
 *      前两种来源都对着清单时，漏掉的正是"库里那条地址指向的到底是不是这张图"。
 *
 *   node scripts/check-remote-images.mjs                                  # 清单模式
 *   node scripts/check-remote-images.mjs --from-api=http://127.0.0.1:8080
 *   node scripts/check-remote-images.mjs --referer=https://example.com/    # 额外验证带 Referer
 *
 * 只读：不发 PUT、不写库、不传对象。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'docs/cloud/2026-09-20-image-cos/upload-manifest.json')
const ASSET_DIR = join(ROOT, 'frontend/src/assets/illustrations')
const DEFAULT_BASE = 'https://yan-public-1407914221.cos.ap-beijing.myqcloud.com'

const refererArg = process.argv.find((item) => item.startsWith('--referer='))
const referer = refererArg ? refererArg.split('=').slice(1).join('=') : ''
const apiArg = process.argv.find((item) => item.startsWith('--from-api='))
const apiBase = apiArg ? apiArg.split('=').slice(1).join('=').replace(/\/+$/, '') : ''

/** 本地素材的名字 → 路径与哈希（`--from-api` 模式下用它做第三方的锚点）。 */
function localAssets() {
  const files = new Map()
  for (const entry of readdirSync(ASSET_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const extension = extname(entry.name).toLowerCase()
    if (!['.webp', '.avif', '.png'].includes(extension)) continue
    files.set(entry.name.slice(0, -extension.length), join(ASSET_DIR, entry.name))
  }
  return files
}

/**
 * 统一成一份"待核对目标"。
 *
 * 清单模式知道字节数、Content-Type 与本地路径；接口模式只知道 URL 与哈希，
 * 于是本地路径与 Content-Type 就地推出来——推不出来（仓库里没有这张素材）不是错误，
 * 而是值得说出来的事实：库里有一行页面会去加载、仓库里却没有对应素材。
 */
async function collectTargets() {
  if (!apiBase) {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
    console.log(`地址来源：上传清单（${manifest.items.length} 个对象，发布版本 ${manifest.release}）`)
    return {
      label: '上传清单',
      targets: manifest.items.map((item) => ({
        label: item.objectKey,
        url: `${process.env.TYPEME_IMAGE_BASE_URL || DEFAULT_BASE}/${item.objectKey}`,
        sha256: item.sha256,
        bytes: item.bytes,
        contentType: item.contentType,
        localPath: item.localPath,
      })),
    }
  }

  const path = '/api/v3/platform/illustrations'
  const response = await fetch(`${apiBase}${path}`)
  if (!response.ok) {
    console.error(`✗ 读地址表失败：${apiBase}${path} → HTTP ${response.status}`)
    process.exit(1)
  }
  const payload = await response.json()
  const assets = Array.isArray(payload.assets) ? payload.assets : []
  console.log(`地址来源：服务端接口 ${apiBase}${path}`)
  console.log(`发布版本：${payload.release ?? '(未登记)'}　版本号：${payload.version ?? '(缺失)'}　对象数：${assets.length}`)
  const files = localAssets()
  const targets = assets.map((asset) => {
    const localPath = files.get(asset.name)
    const extension = localPath ? extname(localPath).toLowerCase() : ''
    return {
      label: `${asset.name} → ${asset.url}`,
      url: asset.url,
      sha256: asset.sha256,
      bytes: null,
      contentType: extension === '.webp' ? 'image/webp' : extension === '.avif' ? 'image/avif' : extension === '.png' ? 'image/png' : null,
      localPath,
    }
  })
  // 库里没有、仓库里有的素材：不是错误（可能还没发布），但要看得见。
  const listed = new Set(assets.map((asset) => asset.name))
  const unlisted = [...files.keys()].filter((name) => !listed.has(name))
  if (unlisted.length > 0) {
    console.log(`提示：仓库里有 ${unlisted.length} 张素材不在库表里（页面会继续用随包的本地副本）：${unlisted.join('、')}`)
  }
  return { label: '服务端接口', targets }
}

const { label, targets } = await collectTargets()
if (referer) console.log(`本轮的 Referer：${referer}`)
console.log('')

const failures = []
let totalBytes = 0
for (const target of targets) {
  const headers = referer ? { Referer: referer } : {}
  let response
  try {
    response = await fetch(target.url, { headers })
  } catch (error) {
    failures.push(`${target.label}：请求失败（${error.cause?.code || error.message}）`)
    console.log(`  ✗ ${target.label} → 请求失败`)
    continue
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const type = response.headers.get('content-type')
  const cache = response.headers.get('cache-control')
  const problems = []
  if (response.status !== 200) problems.push(`HTTP ${response.status}`)
  if (sha256 !== target.sha256) {
    problems.push(`字节与登记的不一致（登记 ${target.sha256.slice(0, 12)}…，实际 ${sha256.slice(0, 12)}…）`)
  }
  if (target.bytes !== null && bytes.length !== target.bytes) problems.push(`长度 ${bytes.length} ≠ ${target.bytes}`)
  if (target.contentType && type !== target.contentType) problems.push(`Content-Type ${type} ≠ ${target.contentType}`)
  if (!(cache || '').includes('max-age=31536000')) problems.push(`Cache-Control=${cache}`)
  if (!target.url.startsWith('https://')) problems.push('地址不是 https')

  // 第三种锚点：**当前仓库里的素材**。库表可能登记的是上一次上传的内容，
  // 只比"库里那条哈希"会漏掉"页面还在用旧图"这种漂移。
  if (target.localPath && existsSync(target.localPath)) {
    const localSha = createHash('sha256').update(readFileSync(target.localPath)).digest('hex')
    if (localSha !== sha256) {
      problems.push(`远端对象与当前素材不一致（素材 ${localSha.slice(0, 12)}… ≠ 远端 ${sha256.slice(0, 12)}…）：改了图但没重新上传/入库？`)
    }
  }

  totalBytes += bytes.length
  if (problems.length > 0) {
    failures.push(`${target.label}：${problems.join('；')}`)
    console.log(`  ✗ ${target.label} → ${problems.join('；')}`)
  } else {
    console.log(`  ✓ ${target.label} → 200 ${bytes.length}B ${type} cache="${cache}"`)
  }
}

console.log(`\n匿名读取 ${targets.length - failures.length}/${targets.length} 通过（来源：${label}）；本轮下载合计 ${totalBytes} 字节`)
if (failures.length > 0) {
  console.error('\n✗ 有对象没通过：')
  for (const failure of failures) console.error(`    ${failure}`)
  process.exit(1)
}
console.log('✓ 全部对象都能被匿名客户端取到，且字节与登记值、当前素材逐字节一致。')
