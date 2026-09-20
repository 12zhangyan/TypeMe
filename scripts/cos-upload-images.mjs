#!/usr/bin/env node
/**
 * 按上传清单把公开插画上传到 COS（**需要授权后手动执行**，默认只做计划，不联网）。
 *
 * 为什么不用 coscmd：这台机器上没有 coscmd/coscli/tccli，装一个工具属于改环境。
 * 这里用 Node 内置 crypto 自己签 COS 请求，算法严格照官方实现写
 * （参考 `cos-python-sdk-v5/qcloud_cos/cos_auth.py` 的 CosS3Auth 与
 *  https://cloud.tencent.com/document/product/436/7778 ），不引入任何依赖。
 *
 * 三个阶段，按顺序用：
 *
 *   node scripts/cos-upload-images.mjs --plan           # 默认：只校验本地字节并打印计划，不联网、不读密钥
 *   node scripts/cos-upload-images.mjs --verify-key     # 用密钥签一个**无害**请求，确认签名真的被 COS 接受
 *   node scripts/cos-upload-images.mjs --execute        # 真正上传，并逐个 HEAD 复核元数据
 *
 * `--verify-key` 是这套脚本的关键：它签一个 `GET /`（列出存储桶）。
 * 上传子账号没有列举权限，所以**签名算对了**会返回 `403 AccessDenied`（权限不足），
 * **签名算错了**会返回 `403 SignatureDoesNotMatch`，两者用响应体里的 <Code> 区分，
 * 于是"签名实现对不对"可以在写任何数据之前就确定下来，且这个请求不读取、不写入任何数据。
 * 说清它**不能**证明什么：AccessDenied 与"匿名请求"的返回码相同，
 * 所以它不能证明 SecretId 本身有效；SecretId 无效时 PUT 会立刻失败且不会写入任何东西。
 * 凭据来源：
 *   1) 环境变量 TYPEME_COS_SECRET_ID / TYPEME_COS_SECRET_KEY / TYPEME_COS_TOKEN
 *   2) 仓库外的 JSON 文件（默认 %USERPROFILE%\.typeme-cos-upload.json，可用 --credential-file 指定）
 *      形如 {"secretId":"...","secretKey":"...","token":"..."}（token 是 STS 临时密钥才需要）
 */
import { createHash, createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(ROOT, 'docs/cloud/2026-09-20-image-cos/upload-manifest.json')
const BUCKET = process.env.TYPEME_COS_BUCKET || 'yan-public-1407914221'
const REGION = process.env.TYPEME_COS_REGION || 'ap-beijing'
const HOST = `${BUCKET}.cos.${REGION}.myqcloud.com`
const ENDPOINT = `https://${HOST}`

const argv = process.argv.slice(2)
const EXECUTE = argv.includes('--execute')
const VERIFY_KEY = argv.includes('--verify-key')
const SHOW_SIGN = argv.includes('--show-canonical')

// 兜底：Node 默认的未捕获异常回显会把出错的源码整行打出来，若那一行正好含有密钥就等于写进日志。
process.on('uncaughtException', (error) => {
  console.error(`✗ 未捕获的错误（只打印消息，不打印源码）：${error?.message || error}`)
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  console.error(`✗ 未处理的 Promise 拒绝（只打印消息）：${reason?.message || reason}`)
  process.exit(1)
})
const credArg = argv.find((item) => item.startsWith('--credential-file='))
const CRED_FILE = credArg ? resolve(credArg.split('=').slice(1).join('=')) : join(homedir(), '.typeme-cos-upload.json')

/** COS 的百分号编码：只保留 -_.~，其余全编码（空格是 %20，不是 +）。 */
const encodeCos = (value) =>
  encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * 生成 COS 的 Authorization 头。
 *   格式化串 = "method\npath\n参数串\n头部串\n"（参数串按 key 排序、头部串按小写 key 排序，各自 encode 后 '&' 连接）
 *   SignKey  = HMAC-SHA1(SecretKey, signTime)      —— 注意用的是十六进制字符串，不是原始字节
 *   Signature= HMAC-SHA1(SignKey, "sha1\nsignTime\nSHA1(格式化串)\n")
 */
function signRequest({ method, path, headers, secretId, secretKey, token, now = Math.floor(Date.now() / 1000), expire = 3600 }) {
  const signed = { ...headers }
  if (token) signed['x-cos-security-token'] = token
  const lower = {}
  for (const [key, value] of Object.entries(signed)) lower[key.toLowerCase()] = String(value)
  const names = Object.keys(lower).sort()
  const headerString = names.map((name) => `${encodeCos(name)}=${encodeCos(lower[name])}`).join('&')
  const httpString = `${method.toLowerCase()}\n${path}\n\n${headerString}\n`
  const signTime = `${now - 60};${now + expire}`
  const httpStringSha1 = createHash('sha1').update(httpString, 'utf8').digest('hex')
  const stringToSign = `sha1\n${signTime}\n${httpStringSha1}\n`
  const signKey = createHmac('sha1', secretKey).update(signTime, 'utf8').digest('hex')
  const signature = createHmac('sha1', signKey).update(stringToSign, 'utf8').digest('hex')
  return {
    authorization:
      `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${signTime}&q-key-time=${signTime}` +
      `&q-header-list=${names.join(';')}&q-url-param-list=&q-signature=${signature}`,
    signedHeaders: signed,
    canonical: { httpString, signTime, httpStringSha1, stringToSign, signature },
  }
}

function loadCredentials() {
  const fromEnv = {
    secretId: process.env.TYPEME_COS_SECRET_ID || '',
    secretKey: process.env.TYPEME_COS_SECRET_KEY || '',
    token: process.env.TYPEME_COS_TOKEN || '',
  }
  if (fromEnv.secretId && fromEnv.secretKey) return { ...fromEnv, source: '环境变量' }
  if (!existsSync(CRED_FILE)) {
    console.error('✗ 找不到凭据。二选一：')
    console.error(`    1) 环境变量 TYPEME_COS_SECRET_ID / TYPEME_COS_SECRET_KEY（STS 再加 TYPEME_COS_TOKEN）`)
    console.error(`    2) 仓库外的文件 ${CRED_FILE}`)
    console.error('      内容形如 {"secretId":"...","secretKey":"...","token":"..."}')
    console.error('  凭据不要写进仓库、不要贴进对话；本脚本也不会打印它们的值。')
    process.exit(2)
  }
  let parsed
  try {
    // strip BOM：PowerShell 的 Set-Content -Encoding utf8 可能带 BOM
    parsed = JSON.parse(readFileSync(CRED_FILE, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    // 这里绝不能把文件内容放进错误信息：Node 的崩溃回显会把源码整行打出来，等于把密钥写进日志。
    console.error(`✗ ${CRED_FILE} 不是合法 JSON（文件内容未回显）。`)
    console.error('  常见原因：编码带 BOM（用 node 写一遍即可）、引号缺失、或复制时把命令提示符一起粘进去了。')
    process.exit(2)
  }
  const secretId = parsed.secretId || parsed.SecretId || ''
  const secretKey = parsed.secretKey || parsed.SecretKey || ''
  const token = parsed.token || parsed.Token || parsed.sessionToken || ''
  if (!secretId || !secretKey) {
    console.error(`✗ ${CRED_FILE} 里缺少 secretId / secretKey`)
    process.exit(2)
  }
  return { secretId, secretKey, token, source: CRED_FILE }
}

/** 最后一道闸：任何要打印的内容里都不许出现密钥。 */
function safeToPrint(text, credentials) {
  if (!credentials) return text
  for (const secret of [credentials.secretKey, credentials.token]) {
    if (secret && text.includes(secret)) throw new Error('检测到输出里含有密钥，已中止（这是脚本的缺陷，请报告）')
  }
  return text
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
const items = manifest.items
console.log(`桶：${BUCKET}　地域：${REGION}　访问域名：${ENDPOINT}`)
console.log(`发布版本：${manifest.release}　对象数：${items.length}　总字节：${manifest.totals.bytes}`)
console.log(`前缀：${manifest.objectPrefix}`)

// ---------------------------------------------------------------- 计划（默认，不联网）
if (!EXECUTE && !VERIFY_KEY) {
  let total = 0
  const problems = []
  for (const item of items) {
    const local = join(ROOT, item.localPath)
    if (!existsSync(local)) {
      problems.push(`缺少本地文件：${item.localPath}`)
      continue
    }
    const bytes = readFileSync(local)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== item.sha256) problems.push(`字节与清单不一致：${item.localPath}`)
    if (!item.objectKey.startsWith(manifest.objectPrefix)) problems.push(`对象键不在发布前缀下：${item.objectKey}`)
    total += bytes.length
    console.log(`  ${item.objectKey}`)
    console.log(`    ← ${item.localPath}（${item.bytes} 字节 · ${item.contentType} · ${item.cacheControl}）`)
  }
  if (problems.length > 0) {
    console.error('\n✗ 计划校验失败：')
    for (const problem of problems) console.error(`    ${problem}`)
    process.exit(1)
  }
  console.log(`\n✓ 本地 ${items.length} 个文件与清单逐条一致（${total} 字节）`)
  console.log('\n下一步（都需要你先提供凭据）：')
  console.log('  1) node scripts/cos-upload-images.mjs --verify-key   # 先确认签名被 COS 接受，不写任何数据')
  console.log('  2) node scripts/cos-upload-images.mjs --execute      # 上传并逐个 HEAD 复核')
  console.log('本命令没有联网、没有读凭据。')
  process.exit(0)
}

// ---------------------------------------------------------------- 密钥自检（签一个无害请求）
const credentials = loadCredentials()
console.log(`凭据来源：${credentials.source}（值不回显${credentials.token ? '，使用 STS 临时密钥' : ''}）`)

const baseHeaders = { host: HOST }

if (VERIFY_KEY) {
  const signed = signRequest({ ...credentials, method: 'GET', path: '/', headers: baseHeaders })
  if (SHOW_SIGN) {
    console.log('—— 参与签名的规范化串（不含密钥）——')
    console.log(safeToPrint(JSON.stringify(signed.canonical, null, 2), credentials))
  }
  const response = await fetch(`${ENDPOINT}/`, {
    method: 'GET',
    headers: { Authorization: signed.authorization, ...(credentials.token ? { 'x-cos-security-token': credentials.token } : {}) },
  })
  const body = await response.text()
  const code = (body.match(/<Code>([^<]+)<\/Code>/) || [])[1] || ''
  const requestId = (body.match(/<RequestId>([^<]+)<\/RequestId>/) || [])[1] || response.headers.get('x-cos-request-id') || ''
  console.log(`GET / → HTTP ${response.status}　Code=${code || '(无)'}　RequestId=${requestId}`)
  const keys = [...body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((match) => match[1])
  if (response.ok) {
    console.log(`✓ 签名被 COS 接受（HTTP 200）——这是最直接的证明。`)
    console.log(`  注意：能列出存储桶说明这把密钥的权限**大于上传所需**（只要 PutObject + HeadObject 就够）。`)
    console.log(`  桶内当前对象数（本次列举所见）：${keys.length}`)
    for (const key of keys.slice(0, 25)) console.log(`    ${key}`)
    if (keys.length > 25) console.log(`    ……还有 ${keys.length - 25} 个`)
    console.log('  这个请求只读，没有写入任何数据。')
    process.exit(0)
  }
  if (code === 'SignatureDoesNotMatch' || code === 'InvalidAccessKeyId' || code === 'InvalidSecretId') {
    console.error(`✗ 签名没被接受（${code}）：不要继续上传，先排查签名实现或密钥。`)
    process.exit(1)
  }
  if (code === 'AccessDenied') {
    console.log('✓ 签名格式被 COS 接受（返回的是"权限不足"而不是"签名不匹配"）——可以继续 --execute。')
    console.log('  注意这一步无法证明 SecretId 本身有效：它的返回码与匿名请求相同。')
    console.log('  如果 SecretId 是错的，下一次 PUT 会立刻失败，而且不会写入任何对象。')
    process.exit(0)
  }
  console.error(`✗ 预期之外的响应，先排查（HTTP ${response.status}，Code=${code || '无'}）`)
  process.exit(1)
}

// ---------------------------------------------------------------- 执行上传
console.log(`\n开始上传 ${items.length} 个对象（PUT，带 Content-Type 与 Cache-Control）……`)
const results = []
for (const item of items) {
  const local = join(ROOT, item.localPath)
  const body = readFileSync(local)
  const signed = signRequest({
    ...credentials,
    method: 'put',
    path: `/${item.objectKey}`,
    headers: { ...baseHeaders, 'content-type': item.contentType, 'cache-control': item.cacheControl },
  })
  const put = await fetch(`${ENDPOINT}/${item.objectKey}`, {
    method: 'PUT',
    headers: {
      'content-type': item.contentType,
      'cache-control': item.cacheControl,
      Authorization: signed.authorization,
      ...(credentials.token ? { 'x-cos-security-token': credentials.token } : {}),
    },
    body,
  })
  const putBody = await put.text()
  const putCode = (putBody.match(/<Code>([^<]+)<\/Code>/) || [])[1] || ''
  if (put.status !== 200) {
    results.push({ key: item.objectKey, ok: false, note: `PUT HTTP ${put.status} ${putCode}` })
    console.error(`  ✗ ${item.objectKey} → HTTP ${put.status} ${putCode}`)
    if (putCode === 'SignatureDoesNotMatch' || putCode === 'AccessDenied') break
    continue
  }

  // HEAD 复核：长度、Content-Type、Cache-Control 与清单一致
  const headSigned = signRequest({ ...credentials, method: 'head', path: `/${item.objectKey}`, headers: baseHeaders })
  const head = await fetch(`${ENDPOINT}/${item.objectKey}`, {
    method: 'HEAD',
    headers: { Authorization: headSigned.authorization, ...(credentials.token ? { 'x-cos-security-token': credentials.token } : {}) },
  })
  const length = head.headers.get('content-length')
  const type = head.headers.get('content-type')
  const cache = head.headers.get('cache-control')
  const ok = head.status === 200 && length === String(item.bytes) && type === item.contentType && (cache || '').includes('immutable')
  results.push({ key: item.objectKey, ok, note: `${head.status} ${length}B ${type} cache=${cache}` })
  console.log(`  ${ok ? '✓' : '✗'} ${item.objectKey} → ${head.status} ${length}B ${type} cache=${cache}`)
}

const failed = results.filter((item) => !item.ok)
console.log(`\n上传完成：${results.length - failed.length}/${items.length} 通过复核`)
for (const item of failed) console.error(`  ✗ ${item.key} —— ${item.note}`)
if (failed.length > 0) {
  console.error('\n有对象没通过复核，先不要切前端。可以重复执行本命令：对象键含内容哈希，重传是幂等的。')
  process.exit(1)
}
console.log('\n✓ 全部对象已上传并通过复核。接下来：')
console.log(`  1) 匿名核对（不带任何凭据）：${ENDPOINT}/${items[0].objectKey} 应返回 200`)
console.log('  2) 按 docs/cloud/2026-09-20-image-cos/PLAN.md 第 10 节切换前端构建。')
