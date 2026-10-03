#!/usr/bin/env node
/**
 * 校验构建产物里**没有**任何绝对远程图片地址。
 *
 * 为什么需要它：插画地址从 2026-09-20 起是**运行期**从数据库读的
 * （`GET /api/v3/platform/illustrations`）。也就是说，前端包里**不应该**再出现
 * COS 域名、CDN 域名或任何写死的图片地址——一旦出现，说明有人又把域名写回了源码，
 * 换域名/换图就会重新变成"要发版"，而这正是那次改造要消掉的东西。
 *
 * 注意产物里仍然会出现本地素材的**文件名**（远端失败时的回退目标）与 `illustrations`
 * 这个目录名，所以判据是"绝对 URL"和"对象键路径"，不是关键词。
 *
 * 扫描范围：`dist/assets/*.js`、`dist/assets/*.css` **与 `dist/index.html`**。
 * index.html 也要查：在模板里写一个 `<link rel="preload" href="https://…">` 同样会把域名
 * 钉进"换域名要发版"的老路上，而它不在 assets 目录里（2026-09-20 补）。
 *
 * 真正"页面实际加载了哪个地址"由浏览器验收证明（`scripts/browser-verify-real-images.py`）。
 *
 * 用法（仓库根目录，先 `cd frontend && npm.cmd run build`）：
 *
 *     node scripts/check-bundled-image-urls.mjs
 *
 * 它已经接进 `frontend/package.json` 的 `postbuild`：`npm run build` 之后自动跑，
 * 有人把域名写回源码时当场构建失败。用 `postbuild` 而不是 `prebuild`，是因为 prebuild
 * 只能查"上一次"的产物，而 postbuild 查的正是刚生成的那一份。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'frontend/dist')
const DIST_ASSETS = join(DIST, 'assets')
const DIST_INDEX = join(DIST, 'index.html')

let files
try {
  files = readdirSync(DIST_ASSETS).filter((name) => /\.(js|css)$/.test(name))
} catch {
  console.error(`✗ 找不到 ${DIST_ASSETS}，先执行 cd frontend && npm.cmd run build`)
  process.exit(2)
}
if (files.length === 0) {
  console.error(`✗ ${DIST_ASSETS} 里没有任何 .js/.css，先执行 cd frontend && npm.cmd run build`)
  process.exit(2)
}

const scanned = files.map((name) => join(DIST_ASSETS, name))
try {
  readFileSync(DIST_INDEX)
  scanned.push(DIST_INDEX)
} catch {
  console.error(`✗ 找不到 ${DIST_INDEX}，先执行 cd frontend && npm.cmd run build`)
  process.exit(2)
}

const bundle = scanned.map((file) => readFileSync(file, 'utf8')).join('\n')

const problems = []

// ① 任何绝对远程图片地址。对象键形如 illustrations/<版本>/<名字>.<哈希>.<扩展名>，
//    所以先按"URL + 图片扩展名"找，再按"URL + illustrations/"找（防止漏掉没扩展名的写法）。
const imageUrls = new Set(bundle.match(/https?:\/\/[^"'\s\\)]*\.(?:webp|avif|png|jpe?g|gif|svg)/gi) || [])
const objectUrls = new Set(bundle.match(/https?:\/\/[^"'\s\\)]*illustrations\/[^"'\s\\)]*/gi) || [])
for (const url of [...imageUrls, ...objectUrls]) problems.push(`产物里有绝对图片地址：${url}`)

// ② 写死的图片主机（含本地模拟域名）：即使没有扩展名，也不该出现在包里。
const hosts = new Set(bundle.match(/https?:\/\/(?:[a-z0-9-]+\.)*(?:myqcloud\.com|cos\.[a-z-]+\.myqcloud\.com)(?::\d+)?/gi) || [])
for (const host of hosts) problems.push(`产物里有对象存储域名：${host}`)
const loopbacks = new Set(bundle.match(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/gi) || [])
for (const loopback of loopbacks) problems.push(`产物里有本地地址：${loopback}`)

console.log(`查了 ${scanned.length} 个产物文件（${scanned.map((f) => f.slice(DIST.length + 1)).join('、')}）`)
if (problems.length > 0) {
  console.error('✗ 构建产物里出现了写死的图片地址：')
  for (const problem of problems.slice(0, 10)) console.error(`    ${problem}`)
  if (problems.length > 10) console.error(`    …另有 ${problems.length - 10} 条`)
  console.error('  插画地址应当只在数据库里（illustration_asset 表）：前端源码里不要写域名或绝对地址。')
  process.exit(1)
}
console.log('✓ 产物里没有任何绝对远程图片地址、没有写死的图片主机：地址只可能来自运行期读到的库表。')
