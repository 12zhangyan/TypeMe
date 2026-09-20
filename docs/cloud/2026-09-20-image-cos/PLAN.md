# 插画图片迁移：腾讯云 COS 官方默认域名直连

日期：2026-09-20。状态：**方案、代码接入、上传与匿名核对已完成；云资源只有这一个桶，未改 DNS、未开通任何付费项。**

> **地址来源已变更（2026-09-20 晚，同一日期第二轮）**：页面用哪个地址不再由构建期
> `VITE_IMAGE_BASE_URL` 决定，而是**运行期读数据库表 `illustration_asset`**
> （`GET /api/v3/platform/illustrations`，改地址用 `PUT`，仅 ADMIN）。
> 因此本文档里所有"设置 `VITE_IMAGE_BASE_URL` 再构建"的步骤**都已作废**，
> 替换为"生成 `V10` 迁移 → 随部署由 Flyway 执行"；`illustrationPublish.json` 已删除，
> `check-image-base-url.mjs` 已由 `check-bundled-image-urls.mjs` 取代。
> 方案、依据与验证证据见 **`docs/2026-09-20/图片URL入库方案.md`**。
> **前置问题已修**：后端那条 `default-src 'self'` CSP（空 `contentSecurityPolicy` lambda 的意外产物）
> 已按修法 A 删除，回归断言在 `IllustrationAssetIT#noContentSecurityPolicyHeader`；
> **要等后端重新部署后才在生产生效**，部署后请核对一次响应头（见 `REPORT.md` §12 与本目录 §10）。
> **建表也交回 Flyway 了**（2026-09-20 晚再修一轮）：`V10__illustration_asset.sql` 随部署自动建表并播种，
> 且写成幂等（`CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE`），所以"人工已经建过表"的库也不会在
> 部署时因主键冲突起不来。原先"手工执行 SQL"的做法会让新环境上读接口 500、前端只能用本地素材。

本轮做三件事：① 把 21 张公开插画传到对象存储并匿名核对字节；
② 让前端在"本地资源 / 远端地址"之间正确切换，并保证远端失败时只回退一次；
③ 用真实素材生成可核对的上传清单与权限/费用/切换步骤。**云上的每一步都需要你单独授权后执行。**

- 目标：把插画的字节从网站服务器搬到对象存储，降低源站带宽依赖；**不代替**前端加载体验修复
  （尺寸预留、占位、解码后淡入在 2026-09-18 已完成并有独立验证报告）。
- 已定事实（你已确认）：桶 `yan-public-1407914221`、地域 `ap-beijing`、
  图片域名 `https://yan-public-1407914221.cos.ap-beijing.myqcloud.com`（COS 官方默认域名，不挂自有域名）。
- 事实来源：`frontend/src/assets/illustrations/`（21 张已压缩 WebP）、`scripts/gen-image-publish.mjs`、
  `docs/optimization/verification/2026-09-20-image-cdn/REPORT.md`。

---

## 1. 现状与目标（先确认事实）

| 项 | 事实 |
| --- | --- |
| 需要迁移的素材 | 21 张 WebP：5 张场景（`home-hero`、`assessment-jung`、`assessment-bigfive`、`reflection`、`welcome`）+ 16 张人物（`type-xxxx`） |
| 总体积 | 2,622,284 字节（约 2.5 MiB），单张 68–251 KB |
| 消费者 | 只有 `frontend/src/components/IllustrationFrame.vue`；由 `PlatformIntro`、`PersonalityPortrait`、`InstrumentCard`、`LoginView`、`RegisterView`、`RecoverView` 使用 |
| 地址解析处 | `frontend/src/design/illustrationAssets.ts`（全站唯一，页面不拼远程 URL） |
| 首屏关键图 | 首页 `home-hero`（`eager` + `fetchpriority="high"`）；其余 20 张 `loading="lazy"`，没有 `<link rel="preload" as="image">` |
| 远端失败后的兜底 | 远端 → 本地打包资源（**一次**）→ 现成的兜底 SVG |

迁移的收益边界要说清：省下的是**源站出流量**，不是"下载总量"。图片总字节不变，除非另外做缩略图（见 §13）。

---

## 2. 架构（已按你的选择定稿）

```
浏览器 ──https──> yan-public-1407914221.cos.ap-beijing.myqcloud.com
                  （COS 官方默认域名 = COS 源站，直接读对象）
                         │
                         ▼
                  COS 桶 yan-public-1407914221 / illustrations/2026-09-20/
                  公有读私有写（前端不持有任何密钥）
```

**特点与代价（必须知情）：**

1. **没有 CDN**。请求直达 COS 源站：省掉了网站服务器的带宽，但没有边缘节点就近缓存，
   冷启动延迟取决于 COS 与访客之间的网络，而不是 CDN 节点。
2. **没有自有域名**，因此**不需要 ICP 备案、不需要证书、不需要改 DNS** ——
   COS 默认域名自带腾讯云证书，实测 HTTPS 正常（见 §4.1）。
3. **必须是公有读**。前端不能持有密钥，也就无法为私有桶生成签名 URL；
   私有桶 + CDN 回源鉴权那套在"只用官方域名"时走不通（以后要私有桶见 §14）。
4. **主要计费项从 CDN 流量变成 COS 外网下行流量**，单价高于 CDN，且没有"HTTPS 请求数百万次免费"那类额度（见 §8）。

---

## 3. COS 配置

| 项 | 取值 | 说明 |
| --- | --- | --- |
| 存储桶 | `yan-public-1407914221` | 已定 |
| 地域 | `ap-beijing`（北京） | 已定 |
| 默认访问域名 | `https://yan-public-1407914221.cos.ap-beijing.myqcloud.com` | COS 按桶名 + 地域自动生成，即"COS 源站域名"（[域名管理概述](https://cloud.tencent.cn/document/product/436/18424)） |
| 访问权限 | **公有读私有写** | 匿名可读对象、不可列举、不可写 |
| 对象前缀 | `illustrations/2026-09-20/` | 每次发布换新日期前缀；旧前缀可整段清理，不必逐个对象判断 |
| 对象键 | `illustrations/2026-09-20/<名字>.<sha256 前 12 位>.webp` | 含内容哈希 → 同名文件改了内容就是**新对象**，旧缓存不会与新页面混用 |
| 对象元数据 | `Content-Type: image/webp`、`Cache-Control: public, max-age=31536000, immutable` | 直连 COS 时没有 CDN 层，**必须真的写到对象上**，否则回访每次都要重新校验 |
| 存储类型 | 标准存储 | 总量 2.5 MiB，低频/归档没有意义（还有取回费用与最短存储期） |
| 版本控制 | 不开 | 对象键已含内容哈希，版本控制只会增加存储与费用 |
| 生命周期 | 建议先不配 | 目前只有 1 个发布前缀；等出现第 2 个前缀再决定保留几个 |

上传内容**只有** `frontend/src/assets/illustrations/` 里的公开插画。`scripts/gen-image-publish.mjs` 用白名单反向约束，
素材目录里出现名单以外的图片（报告截图、答卷、账号相关图片等）会直接报错中止，不允许"顺手一起传上去"
（已实测：放一个 `report-draft-screenshot.webp` 进去，生成器以非 0 退出并指名拒绝）。

---

## 4. 权限与防盗链

### 4.1 公有读是"官方域名直连"的前提

实测（只读探测，未带任何凭据）：

| 探测 | 结果 | 含义 |
| --- | --- | --- |
| `HEAD https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/` | 403 | 桶根不是对象请求，不能据此判断权限 |
| `HEAD /illustrations/2026-09-20/home-hero.4583aa734b96.webp`（尚未上传） | 404 `NoSuchKey` | **不是 403**：匿名 GetObject 已经放行 |
| `HEAD /does-not-exist-probe` | 404 | 同上 |
| `GET /?list-type=2&max-keys=1`（匿名列举） | 403 | 列举未开放 |
| `https://` 握手 | 证书正常，无告警 | 默认域名自带有效证书 |

"匿名读不存在对象 → 404，匿名列举 → 403"符合**公有读私有写**的表现。
上传第一个对象后可做确定性复核（§9 最后两项）。

### 4.2 防盗链：可以开，但必须先理解本站的 Referer 情况

站点自己声明了"跨域不发送 Referer"：

- `frontend/index.html`：`<meta name="referrer" content="no-referrer">`
- 后端 `SecurityConfig`：`Referrer-Policy: SAME_ORIGIN`

而 COS 是**另一个源**，所以浏览器取图时**不带 Referer**。COS 原生支持防盗链
（[设置防盗链](https://cloud.tencent.com/document/product/436/13319)），作用于**默认访问地址**，规则是：

- 白名单模式 + **不允许空 Referer** → 本站**所有图片 403**。这是最容易踩的坑。
- 白名单模式 + **允许空 Referer** → 本站正常；别的网站带自己的 Referer 来盗链 → 403。
  仍然有效，但任何客户端只要不发送 Referer（`curl`、剥离 Referer 的页面）就能通过。
- 黑名单模式：需要预先知道盗链方域名，被动。
- 另外：带签名的请求**不校验**防盗链；如果以后挂了 CDN，CDN 的防盗链优先生效。

**建议**：先**不开**防盗链。理由与取舍写在这里供你决定：

1. 这些图是网站公开插画，不是隐私内容；对象键含内容哈希，且列举已关闭，URL 无法被枚举。
2. 开防盗链的直接风险是"某天浏览器/网关策略变化导致全站图片 403"，收益只是挡住普通盗链。
3. 如果确实担心被刷流量，用**白名单模式 + 勾选"允许空 Referer"**，并给 COS 外网下行流量配用量告警。
   不要用"时间戳防盗链"：它需要前端计算签名，与"前端只有公开图片地址"的目标冲突。

---

## 5. 上传清单（已生成，**21 个对象已全部上传并通过公开核对**）

产物：

- `docs/cloud/2026-09-20-image-cos/upload-manifest.json`：本地路径、对象键、SHA-256、字节数、Content-Type、Cache-Control
- `docs/cloud/2026-09-20-image-cos/upload-manifest.md`：同一份内容的人读版本
- `frontend/src/design/illustrationPublish.json`：前端运行时用的"名字 → 对象键"映射（与上面同源生成）

清单内容可逐条审阅：21 条，每条都能对上 `frontend/src/assets/illustrations/` 里的真实文件。

---

## 6. 上传步骤（**本轮已按此执行完成**）

### 6.1 执行器

`scripts/cos-upload-images.mjs`（本轮新增）：不依赖 coscmd 或任何 npm 包，
用 Node 内置 `crypto` 直接按官方算法签 COS 请求
（对照 `cos-python-sdk-v5/qcloud_cos/cos_auth.py` 与[请求签名](https://cloud.tencent.com/document/product/436/7778) 实现）。三个阶段：

| 命令 | 作用 | 是否联网 |
| --- | --- | --- |
| `--plan`（默认） | 校验本地字节、打印对象键与元数据 | 否 |
| `--verify-key` | 签一个 `GET /`，确认**签名被 COS 接受**，不读不写任何数据 | 是（只读） |
| `--execute` | 逐个 PUT，并 HEAD 复核长度/`Content-Type`/`Cache-Control` | 是 |

为什么先跑 `--verify-key`：上传子账号没有列举权限，所以**签名算对了**会返回 `403 AccessDenied`，
**签名算错了**会返回 `403 SignatureDoesNotMatch` —— 用 `AccessDenied` 还是 `SignatureDoesNotMatch`
就能在写任何数据之前确认签名实现没问题。它的边界也要说清：`AccessDenied` 与匿名请求的返回码相同，
所以它不能证明 SecretId 本身有效；SecretId 无效时 PUT 会立刻失败且不写入任何对象。

凭据只从两处取，**不落仓库、不回显**：

1. 环境变量 `TYPEME_COS_SECRET_ID` / `TYPEME_COS_SECRET_KEY`（STS 再加 `TYPEME_COS_TOKEN`）；
2. 仓库外的文件（默认 `%USERPROFILE%\.typeme-cos-upload.json`，可用 `--credential-file=` 指定），
   内容形如 `{"secretId":"...","secretKey":"...","token":"..."}`。

脚本还有一道闸：任何要打印的文本里若出现密钥就立刻中止（防止"顺手打印请求体"这类失误）。

### 6.2 步骤

1. `node scripts/gen-image-publish.mjs --check` —— 确认清单与素材一致（不一致会以非 0 退出）。
2. `node scripts/upload-image-manifest.mjs --check-local` —— 重新计算本地字节 SHA-256，确认"要传的就是清单里那批字节"。
3. `node scripts/cos-upload-images.mjs --plan` —— 打印逐条计划（**不联网、不读密钥**）。
4. `node scripts/cos-upload-images.mjs --verify-key` —— 先确认签名被接受（见 6.1）。
5. `node scripts/cos-upload-images.mjs --execute` —— 上传并复核；失败会停下并指出是哪个对象。
   对象键含内容哈希，重复执行是幂等的（同名对象内容相同，重传只是覆盖同一份字节）。
6. 上传后按 §9 核对，再按 §10 切换前端。

**若你更想用 coscmd**（本机未安装）：安装后逐条执行 `node scripts/upload-image-manifest.mjs` 打印的
`coscmd upload -H "Cache-Control: ..."` 命令即可，效果等价。

**为什么默认不真上传**：在没有凭据、也没有上传授权的前提下，任何"看起来能跑"的上传客户端都无法被验证，
反而给出虚假的安全感。所以真实上传必须显式加 `--execute`，且要先过 `--verify-key`。

---

## 7. 最小权限（只需一个上传子账号）

只允许对 `illustrations/` 前缀做 `PutObject` 与 `HeadObject`（HEAD 用于上传后核对）。
**不含** `GetObject`、`DeleteObject`、列举权限。

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["cos:PutObject", "cos:HeadObject"],
      "resource": ["qcs::cos:ap-beijing:uid/1407914221:yan-public-1407914221/illustrations/*"]
    }
  ]
}
```

- `resource` 里的地域必须与桶所在地域一致（这里都是 `ap-beijing`）。
- 建议只发放**有效期数小时的 STS 临时密钥**（用完即失效），而不是长期密钥。
- 需要清理旧发布版本时，另外申请一次性的 `DeleteObject` 授权，不要写进日常策略。
- 文件都很小（最大 251 KB），用简单 PUT 即可，不需要分片上传权限。
- **不需要 CDN 回源子账号**：本方案不走 CDN，桶本身就是公有读。

### 7.1 密钥纪律（本轮已遵守，后续也必须遵守）

- SecretId / SecretKey 不进入前端、仓库、日志、截图和对话回复；`frontend/.env.example` 里只有公开图片地址。
- 前端构建**不需要**任何密钥；`VITE_IMAGE_BASE_URL` 只是一个公开域名。
- 本方案文档、清单脚本、验证脚本都不读取、不打印密钥。
- 执行上传时用的密钥放在**仓库外**的 `%USERPROFILE%\.typeme-cos-upload.json`，
  用完即删；`scripts/cos-upload-images.mjs` 从不打印密钥，并有"输出里出现密钥就中止"的兜底闸。

### 7.2 本轮上传用掉的密钥：两点必须处理

1. **权限大于所需**：`--verify-key` 的 `GET /` 返回 200，说明这把密钥**能列举存储桶**，
   而不只是 `PutObject` + `HeadObject`。建议改用 §7 的最小权限子账号，或至少不要长期保留这把。
2. **轮到它退役了**：执行过程中一次脚本报错把凭据文件的**首行打印到了终端**（Node 的崩溃回显会带出出错的源码行）。
   该缺陷已修复（读取凭据时剥离 BOM 并把解析失败包成不带内容的错误、加未捕获异常兜底），
   但**那把 SecretKey 已经进过一次日志**。上传任务已经完成，建议直接在 CAM 控制台**删除或轮换**这把密钥。

---

## 8. 费用项与量级估算

计费项（价格以 [COS 定价中心](https://buy.cloud.tencent.com/price/cos) 实时公示为准；
计费口径见 [流量费用](https://cloud.tencent.com/document/product/436/53863)）：

| 计费项 | 触发条件 | 本文场景量级 |
| --- | --- | --- |
| 标准存储容量 | 对象占用 | 2.5 MiB → 月费用可忽略 |
| **外网下行流量** | 用户经**对象链接**（即官方默认域名）下载对象 | **本方案的主要成本项**：每个冷缓存访客最多 2.5 MiB，回访因长缓存不再下载 |
| 请求次数 | 按请求方法计 | 21 次 PUT + 少量 HEAD；浏览时每次对象请求计 1 次 |
| 外网上行流量 | 上传 | **免费** |
| CDN 回源流量 / CDN 下行 / HTTPS 请求数 | — | **不适用**（没有 CDN，也就不享受 CDN 的 HTTPS 请求免费额度） |

量级估算（只为确认"不是数量级问题"，不是承诺）：

- 21 张素材合计 **2,622,284 字节（约 2.5 MiB）**；实测一轮首页 + 图鉴的冷缓存访问下载 **2,483,153 字节（约 2.37 MiB）**。
- 1 万个这样的访客 ≈ **24 GB 外网下行**。用定价中心的"外网下行流量"单价乘一下即可估出月成本。
- 回访用户因为 `immutable` 长缓存**不再下载**（实测二次加载传输 0 字节），费用趋近 0。

代价对比要写清：**同样的字节走 CDN 更便宜**（CDN 有 0–2 TB 档阶梯价与 HTTPS 请求免费额度），
但 CDN 需要自有域名 + 备案 + 证书 + DNS。你当前选择"官方域名直连"，换来的是一条**当天就能上线、零备案零证书**的路径。
如果计费超出预期，再走 §14 的升级路径即可，**前端代码不用改**（只是换一个 `VITE_IMAGE_BASE_URL`）。

建议在腾讯云控制台为 COS 外网下行流量设置**用量告警**（例如按月 100 GB）。

---

## 9. 上传后核对（**本文档更新时已完成**）

- [x] 对象数 21，前缀下没有多余对象（上传前桶内为 0）
- [x] `HEAD` 每个对象：200、`Content-Length` 与清单一致、`Content-Type: image/webp`、`Cache-Control` 为清单值
- [x] 全量下载后本地 `sha256` 与 `upload-manifest.json` 一致（21/21 逐字节相同）
- [x] 匿名 `GET` **真实**对象：**200** —— 确定性确认公有读成立
- [x] 匿名 `GET` 不存在的键：404 NoSuchKey，**不是** 403 AccessDenied
- [x] 对象 URL 形如 `https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/home-hero.4583aa734b96.webp`
- [x] 额外：带 `Referer: https://example.com/` 的匿名请求同样 21/21 通过 → **防盗链当前未开启**

核对方式：`node scripts/check-remote-images.mjs`（完全匿名，无凭据），脚本与结果见
`docs/optimization/verification/2026-09-20-image-cdn/REPORT.md` §10.1。

---

## 10. 切换步骤（代码已就绪；SQL 由你在服务器执行、后端需重新部署才生效）

> ✅ **必须一起处理的那条 CSP 已经改了（修法 A）**：`SecurityConfig` 里那个空的
> `contentSecurityPolicy(csp -> {})` 已删除 —— 它并不等于"不加这条头"，而是会让 Spring Security 6
> 发出 `default-src 'self'`，把发往 COS 的图片全部拦掉（页面看着正常，因为回退到了本地素材，
> 实测 20/20 被拦、21/21 张图仍来自源站）。细节与字节码证据见 **REPORT §12**；
> 回归断言 `IllustrationAssetIT#noContentSecurityPolicyHeader`（加回空 lambda 即变红，已用负向探针验证）。
> **注意**：这是后端代码改动，**要等一次正常部署才在生产生效** —— 部署后请核对响应头。

上传已完成。**"切换"这件事在 2026-09-20 晚已经改掉了**：不再是"构建时给域名 + 发版"，
而是"把地址写进库表 + 前端启动时读一次"。原来的两种切换方式（环境变量 / `.env.production`）
**已作废**，下面是现在的做法。

现在的切换 = 两步：

```powershell
# ① 生成入库迁移（只写文件，不连库、不动数据库）
node scripts/gen-image-publish.mjs --emit-sql --out backend/src/main/resources/db/migration/V10__illustration_asset.sql
#    该迁移是幂等的：库里已经人工建过表/插过行时重复执行也不会失败
# ② 后端重新构建部署：Flyway 会应用 V10（建表 + 21 行种子），CSP 那条改动同时生效
```

部署后：匿名访客打开首页即可拿到远端地址；想只改某一张图的地址，用
`PUT /api/v3/platform/illustrations`（仅 ADMIN），**不需要发版**。

切换/回退都不需要改前端代码，也不需要重新构建前端：
把库表清空（或删表）就等于回退到"全部用本地素材"。

核对命令（旧命令已作废）：

```powershell
node scripts/check-bundled-image-urls.mjs                        # 产物里不得出现任何绝对图片地址
node scripts/check-remote-images.mjs --from-api=<服务地址>        # 库 ↔ 本地素材 ↔ 远端对象 三方核对
curl.exe -sI <站点地址>/ | Select-String 'Content-Security-Policy'   # 应当**没有输出**
```

（本机已在新接线下用真实域名跑过一轮真实浏览器验收：**PASS 70 / FAIL 0**，
见 REPORT §13。但那是接口 mock 提供地址、真实 COS 取图的隔离环境，不等于线上已验证。）

### 10.1 切换后的逐项核对清单

- [x] 每个对象 URL 返回 200，`Content-Type: image/webp`，`Cache-Control` 含 `immutable`（匿名核对，21/21）
- [x] 页面图片请求全部指向 `yan-public-1407914221.cos.ap-beijing.myqcloud.com`；
      **站点服务器没有收到任何 `/assets/*.webp` 图片请求**（真实域名轮，320/390/1440）
- [x] 首屏主图仍是 `eager` + `fetchpriority="high"`，其余仍 `lazy`，没有新增预加载（`preload=0 high=1 lazy≥10`）
- [x] 冷缓存下占位不跳版（容器尺寸 0px 变化、图片相关 CLS 为 0），解码后淡入（9 个中间帧）
- [x] 回访命中浏览器缓存：图片**传输 0 字节**，占位窗口降到淡入时长（190–201ms）
- [x] 远端不可达：每张图恰好"远端 1 次失败 + 本地 1 次成功"，页面不出现裂图（本地模拟注入）
- [x] 故意让对象返回 404：一次本地回退后正常显示，无重复请求（本地模拟注入）
- [x] 图鉴快速连续切换：晚到的旧图不覆盖新选择（本地模拟注入）
- [ ] 线上环境实测（需要发版后执行；本机数据不能替代）

---

## 11. 回退（任何一步出问题都能退）

回退有**两层**，互相独立：

1. **前端层（分钟级生效，最常用）**：去掉 `VITE_IMAGE_BASE_URL` 重新构建部署即可，代码不需要改——
   未配置时行为与接入前完全一致（`illustrationAssets.spec.ts` 钉住了这一点）。
2. **运行时自愈（无需人工）**：即使图片域名突然不可用，`IllustrationFrame` 会在远端失败后
   **自动回退到本地打包资源一次**，本地再失败才显示兜底 SVG。
   所以故障的爆炸半径是"每张图多一次失败请求"，不是"整页裂图"。

对象可以保留不删（对象键含哈希，删除不影响已发布页面）。只想暂停成本时把对象删掉、前端回退即可。

---

## 12. 代码接线（本日期第二轮后的现状）

第一轮（构建期域名）的接线已被第二轮（数据库驱动）替换，下面只列**现状**；
第一轮的实现与验证记录保留在 REPORT.md 与 git 历史里。

| 文件 | 作用 |
| --- | --- |
| `backend/src/main/resources/db/migration/V10__illustration_asset.sql` | 库表 `illustration_asset` + 21 行种子，**随部署由 Flyway 执行**；幂等写法（`IF NOT EXISTS` + `INSERT IGNORE`）兼容人工建过表的库。由 `--emit-sql` 生成，与生成器输出逐字节一致 |
| `backend/.../platform/service/IllustrationAssetService.java` | 读（`list`）/写（`update`）与**安全边界校验**：名字白名单、https、域名允许清单、sha256 形状、整批拒绝 |
| `backend/.../platform/api/PlatformController.java` | `GET /api/v3/platform/illustrations`（公开）+ `PUT`（方法级 `@PreAuthorize("hasRole('ADMIN')")`） |
| `backend/.../security/SecurityConfig.java` | 该路径只放开 `GET`；**已删除**那个空的 `contentSecurityPolicy(...)`（见 §10 与 §13.0） |
| `backend/src/main/resources/application.yml` | `typeme.illustration.allowed-hosts`（可写进库的域名清单，换域名不必改 Java） |
| `frontend/src/stores/illustrationAssetsV3.ts` | 启动时读一次地址表：`hydrate()` 同步读 `localStorage`、`load()` 带 1.2s 等待预算、`settled` 决定组件是否可以开始解析 |
| `frontend/src/design/illustrationAssets.ts` | **唯一**解析处：地址表里没有 / 地址不可用 → 本地打包资源 |
| `frontend/src/design/remoteImageUrl.ts` | 地址校验（只接受 https，回环允许 http 供本地模拟，禁凭据、去片段） |
| `frontend/src/components/IllustrationFrame.vue` | 地址表未就绪 → 占位；就绪后 → 远端失败（含解码失败）回退本地**一次** → 兜底 SVG；`data-artwork-{state,attempt,source}` 供验收 |
| `frontend/src/api/platformV3.ts` | `fetchIllustrations()`：严格按契约解析，字段缺失即抛 `UNEXPECTED_RESPONSE` |
| `scripts/gen-image-publish.mjs` | 从真实素材生成上传清单与**入库迁移 SQL**（`--emit-sql`），支持 `--check` |
| `scripts/upload-image-manifest.mjs` / `cos-upload-images.mjs` | 上传计划与执行器（`--plan` / `--verify-key` / `--execute`），自带 COS 签名 |
| `scripts/check-bundled-image-urls.mjs` | 产物里**不得**出现任何绝对图片地址或图片主机（取代 `check-image-base-url.mjs`） |
| `scripts/check-remote-images.mjs` | 匿名核对已上传对象；`--from-api=<服务地址>` 做**库 ↔ 本地素材 ↔ 远端对象**三方核对 |
| `scripts/browser-verify-image-cdn.py` | 浏览器验收：两个本地服务器分别扮演站点（含接口 mock）与图片域名（失败分支注入） |
| `scripts/browser-verify-real-images.py` | 浏览器验收：地址由接口 mock 给出、浏览器真的去 COS 官方域名取图 |
| `frontend/src/assets/illustrations/README.md` | 素材侧的接入说明 |

不逐页面硬编码远程 URL：所有消费者（首页、图鉴、测评卡、登录/注册/找回）都通过同一个组件取地址。
`illustrationPublish.json` 与 `imageBaseUrl.ts` 已删除（无消费者）。

---

## 13. 四个容易误解的点

0. **"空 lambda"曾经真的发过 CSP，现在已经删掉了。** `SecurityConfig` 里 `.contentSecurityPolicy(csp -> {})`
   不等于"不加响应头"：Spring Security 会因此创建默认 writer，实际发出 `default-src 'self'`，
   于是本站第一个跨域资源（也就是迁移后的图片）会被浏览器拦掉。已按修法 A 删除，
   回归断言 `IllustrationAssetIT#noContentSecurityPolicyHeader`，详见 §10 与 REPORT §12。
   **注意它是后端改动，要重新部署才在生产生效。**
1. **本地图片仍然随包发布。** 它不是"迁移后应该删掉的冗余"，而是远端失败时唯一一次回退的目标，
   也是"没配置图片域名"时的正常资源。删掉它等于放弃回退能力（也让"去掉环境变量就能回退"这条退路失效）。
2. **迁移不改变下载总量。** 要减少字节，需要另做"缩略图 + `srcset`"（人物图目前统一用 640×800，
   图鉴缩略图却只有几十像素宽）。这是**独立优化项**，需要新的素材规格与验证，本轮不做。
3. **不预加载全部人物。** 目前 `home-hero` 是 `eager` + `fetchpriority="high"`，其余 20 张是 `loading="lazy"`，
   页面里没有任何 `<link rel="preload" as="image">`。浏览器会按自己的距离阈值提前请求部分 lazy 图片，
   这是浏览器行为，不会因为换域名改变；**本轮没有新增任何预加载**。

---

## 14. 以后想升级成"自有域名 + CDN + 私有桶"时

代码不用改，只需换 `VITE_IMAGE_BASE_URL`。需要在云上补的部分（本条只是备忘，**本轮不做**）：

| 项 | 做法 |
| --- | --- |
| 域名 | `img.<主域名>`；中国大陆 CDN 需要该域名完成 ICP 备案（[域名管理概述](https://cloud.tencent.cn/document/product/436/18424)） |
| 桶权限 | 改成**私有读写**，对象不可被直连 |
| CDN 回源鉴权 | 开启"私有存储桶访问"，填一个只读子账号（见下）密钥，CDN 自动为回源签名 |
| HTTPS | 腾讯云免费 DV 证书或上传自有证书 |
| DNS | 加 `img` 的 CNAME 指向 CDN 控制台给出的加速域名 |
| 缓存规则 | 路径前缀 `/illustrations/` → 缓存 365 天 + 忽略全部查询参数 + 强制缓存 |
| 防盗链 | 同样受 §4.2 的 Referer 约束，优先用 CDN 鉴权配置而不是 Referer 白名单 |

回源只读子账号策略：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": ["cos:GetObject"],
      "resource": ["qcs::cos:ap-beijing:uid/1407914221:yan-public-1407914221/illustrations/*"]
    }
  ]
}
```

顺带提醒：**桶名已经叫 `yan-public`，且当前权限就是公有读**。如果之后要转私有桶，桶名会与实际权限不符，
建议那时**新建一个桶**（例如 `yan-img-1407914221`）而不是原地改权限——这样旧对象仍在，回退更容易。

---

## 15. 需要你确认的信息

1. **凭据（已完成，仅剩收尾）**：上传已用 `%USERPROFILE%\.typeme-cos-upload.json` 执行完毕，
   该文件已删除。请按 §7.2 处理那把密钥（**建议删除或轮换**）：它权限大于所需，且进过一次日志。
2. **防盗链**：确认按 §4.2 的"先不开"（当前实测未开启，站点不发 Referer 不构成风险），还是上"白名单 + 允许空 Referer"？
3. **费用告警**：是否要为 COS 外网下行流量配一个用量告警阈值（需要控制台操作，我没有代做）？
4. **切换与发版时机**：`frontend/dist` 目前是**默认（本地图片）**构建，线上没有切换。
   选 §10 的方式 A 或 B，然后发版——这一步需要你明确授权。

---

## 16. 本轮做了与没做的事

**已做**：

- 上传了 21 个公开插画到 `yan-public-1407914221` / `ap-beijing`，前缀 `illustrations/2026-09-20/`；
  逐个 HEAD 复核 + 匿名全量核对全部通过（§9）。**只上传了这 21 个公开素材**，没有上传报告、答卷或任何私人文件。
- 用真实域名跑了一轮真实浏览器验收（PASS 70 / FAIL 0），覆盖 320/390/1440 的冷启动与二次加载（§10）。

**没做**：

- 没有创建或修改桶的**配置**（权限、防盗链、生命周期、跨域规则都没动）；没有创建 CDN、证书或 DNS 记录。
- 没有开通任何付费项，没有配费用告警。
- **没有部署**：线上仍是旧版本。`frontend/dist` 已恢复为"不配置域名"的默认构建，仓库默认行为没有被改变。
- 没有改动后端、数据库、计分、报告或内容包；数据库全程只读；没有执行 `git commit`/`push`/部署。
- 没有新增 npm 依赖，没有重构既有页面与视觉。
