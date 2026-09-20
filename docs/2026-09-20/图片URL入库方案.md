# 图片 URL 入库方案（对象存储地址改为数据库驱动）

> 状态：**已实现（W1+W2）；三项决定已定：CSP 按修法 A 改完、入库 SQL 作为手工交付件、首屏维持甲**
>
> - **CSP（修法 A）已改**：`SecurityConfig` 里那个空的 `contentSecurityPolicy(csp -> {})` 已删除。
>   回归断言在 `IllustrationAssetIT#noContentSecurityPolicyHeader`（同时断言其余安全响应头仍在，
>   防止"把整段 `headers(...)` 删掉"也能通过）。负向探针已验证：把空 lambda 加回去，
>   该用例立刻变红——响应头里出现 `Content-Security-Policy: default-src 'self'`。
>   ⚠️ **还剩一步**：改的是后端代码，要等**后端重新构建部署**才生效。部署后请核对一次真实响应头
>   （`curl.exe -sI <地址>/`），确认没有 `Content-Security-Policy`，图片才会真的走 COS。
> - **入库 SQL 是手工交付件，不是 Flyway 迁移**：`docs/2026-09-20/illustration-asset.sql`。
>   它刻意**不**放在 `backend/src/main/resources/db/migration/` 下：不会打进应用包、
>   部署时不会被 Flyway 自动执行，由你在服务器上 `mysql ... < illustration-asset.sql` 跑一次。
>   执行前读接口返回 500（表不存在），前端按"读表失败"用本地素材，页面照常、不会崩。
> - 首屏取 **甲**（启动读一次小接口 + 1.2s 上限 + `localStorage`），已实现并实测。
>
> 实现与证据落点：`backend/.../IllustrationAssetService.java`、`PlatformController`（GET/PUT）、
> `docs/2026-09-20/illustration-asset.sql`、`frontend/src/stores/illustrationAssetsV3.ts`、
> `frontend/src/design/{illustrationAssets,remoteImageUrl}.ts`、`IllustrationFrame.vue`；
> 验证见 §11 的"实际执行结果"。
> 原始诉求：用户希望"图片 URL 存到库里"，而不是构建期写死在前端包里。

## 1. 目标与非目标

**目标**

1. 插画的远端地址成为**数据库里的数据**：改一张图的地址、加一张图，不必重新构建和发布前端。
2. 全站仍然只有**一个地址解析处**，页面里不出现硬编码远程 URL（保持现有不变量）。
3. 首次/回访的加载体验不回退：占位不跳版、解码后淡入、单次受控回退到本地素材、远端失败不裂图。
4. 匿名访客（首页首屏）也能拿到远端地址 —— 首页是公开页，这里正是迁移要省流量的地方。

**非目标（本轮不做）**

- 不做图片上传的后台管理页面（先给接口与脚本；UI 另立切片）。
- 不把用户私密产物（报告、答题记录、账号信息）纳入本表，也不允许它们走远端。
- 不做图片处理（缩略图/`srcset`/格式转换）——独立优化项。
- 不改 COS 桶配置、不接 CDN、不改域名。

## 2. 现状与证据

| 事实 | 位置 |
| --- | --- |
| 地址解析只有一个入口，读构建期环境变量 + 构建期清单 | `frontend/src/design/illustrationAssets.ts`、`imageBaseUrl.ts`、`illustrationPublish.json`（21 项） |
| 消费方只有 `IllustrationFrame.vue`；`primarySrc` 是**同步** computed | `frontend/src/components/IllustrationFrame.vue:32-36` |
| 首屏 `home-hero` 是 `eager` + `fetchpriority=high`，其余 20 张 `loading=lazy` | 同上 + 验收 REPORT §10 |
| **库里已经有"内容/配置入库"的先例** | `assessment_package`（内容包 JSON + `sha256` + 版本）、`typeme_ai_setting`（运行期可改配置 + 管理员 PUT） |
| **公开只读接口的先例** | `SecurityConfig.java:101-103` 只放开 `GET /api/v3/platform/instruments`、`/instruments/*` |
| 目录类接口是 `authenticated`，匿名读不到 | `SecurityConfig.java:106`；`frontend/src/stores/instrumentV3.ts:20`（注释记了实测 401） |
| 前端启动有全局初始化钩子 | `frontend/src/App.vue:122,137`（`fetchMeta()`、`instrument.load()`） |
| 管理员写入路径与鉴权范式 | `AdminController` 类级 `@PreAuthorize("hasRole('ADMIN')")`，方法级判定；`PUT /api/v3/admin/ai-settings` |
| 现有迁移到 `V9`；本方案的建表/种子**不进迁移目录**，作为手工交付件 | `backend/src/main/resources/db/migration/`（到 V9）；交付件 `docs/2026-09-20/illustration-asset.sql` |
| ~~后端会发 `Content-Security-Policy: default-src 'self'`~~ → **已修（修法 A）** | 空 lambda 已从 `SecurityConfig` 删除；回归断言 `IllustrationAssetIT#noContentSecurityPolicyHeader` |

**结论性事实**：同一形态（运行期可改的配置存库 + 管理员写入 + 前端启动读一次）在本仓库已经跑通两次
（`assessment_package`、`typeme_ai_setting`），所以本方案不是新架构，而是把插画地址并入既有范式。

## 3. 方案总览

```
上传脚本 ──PUT──> COS 对象（内容哈希键，已存在）
   │
   └─生成 SQL/JSON─> illustration_asset 表（库，权威）
                          │
        GET /api/v3/platform/illustrations   （公开、只读、带 ETag）
                          │
        frontend: stores/illustrationAssets.ts  （启动读一次 + localStorage 缓存）
                          │
        design/illustrationAssets.ts  ← 唯一解析处（map 作为入参，纯函数）
                          │
                  IllustrationFrame.vue
                    ├─ 远端地址（map 命中）
                    ├─ 本地打包素材（map 未命中/失败/超时）
                    └─ 兜底 SVG（本地也没有）
```

## 4. 库表（已定稿；执行方式是**手工交付件**）

```sql
-- docs/2026-09-20/illustration-asset.sql（手工执行，不是 Flyway 迁移）
-- 公开插画的远端地址表。只放"本来就是公开资源"的插画，不含任何用户数据。
CREATE TABLE IF NOT EXISTS illustration_asset (
    -- 逻辑名，与 assets/illustrations/<name>.webp 的文件名一致（home-hero / type-intj / …）
    -- COLLATE 钉 as_cs 的理由同 V1/V6：默认 *_ai_ci 大小写不敏感会放过 'HOME-HERO' 这类错值。
    asset_name  VARCHAR(64)  NOT NULL COLLATE utf8mb4_0900_as_cs,
    -- 绝对地址（https）。内容哈希在路径里，所以"换图 = 换键 = 天然无缓存问题"。
    url         VARCHAR(512) NOT NULL,
    -- 与本地素材一致的字节哈希；用于三方核对（库 ↔ 本地文件 ↔ 远端对象）
    sha256      CHAR(64)     NOT NULL,
    -- 发布批次，例如 2026-09-20；便于整体回退与审计
    release     VARCHAR(32)  NOT NULL,
    updated_at  DATETIME(6)  NOT NULL,
    CONSTRAINT pk_illustration_asset PRIMARY KEY (asset_name)
);
```

- 主键 `asset_name` ⇒ 一个名字只有一条"当前地址"。**历史变更由交付件 SQL 与上传清单承担**，表只存现值。
- 两个引擎的语法交集、`COLLATE` 只能写在列定义末尾 —— 这些坑 V1/V2/V6 的注释已踩过。
  本表**同时**在真实 MySQL（手工执行交付件）与 H2（后端契约测试执行同一份文件）上跑，
  所以语法必须落在两者的交集里：`CREATE TABLE IF NOT EXISTS` + `CURRENT_TIMESTAMP` 都已验证可行。
- 种子数据（21 行）由第 8 节工具从**真实素材**生成（`--emit-sql`），**不手写**；
  生成结果与仓库里的交付件**逐字节一致**（重新生成可核对）。
- 发布版本仍在库里登记（`release` 列），供人读与整体回退；但**页面地址的事实来源是这张表**，
  仓库里不再保留一份"名字 → 对象键"的运行时映射（`illustrationPublish.json` 已删除，见 §9）。

## 5. 读接口（公开、只读）

```
GET /api/v3/platform/illustrations
```

- `SecurityConfig` 里与 `/api/v3/platform/instruments` 并列 `permitAll`。**必须公开**：首页是匿名页，
  若挂在 `authenticated` 下，匿名首屏拿不到远端地址，迁移对最重要的那部分流量等于没做。
- 响应（字段缺失一律让前端抛 `UNEXPECTED_RESPONSE`，不补默认值 —— 沿用 `platformV3.ts` 的纪律）：

```json
{
  "release": "2026-09-20",
  "version": "21:2026-09-20T12:00:00Z",
  "assets": [
    { "name": "home-hero", "url": "https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/home-hero.4583aa734b96.webp", "sha256": "…" }
  ]
}
```

- `version` 是**不透明字符串**（实现取"行数 + 最新 `updated_at`"）：前端只拿它判断本地缓存是否还有效，
  不解析内部结构。任何一行被改/加/删都会变。
- **不做 ETag/304**：`Cache-Control: no-cache` 已经让它每次都取到最新；5KB 的响应不值得再引入
  "地址改了但 304 命中"这种难查的状态。
- 响应体量级：21 条 ×（名字 + URL + sha256）≈ **5 KB**；`sha256` 只被核对脚本用于三方核对。
- 不含任何用户数据、不含桶内私有路径。
- 失败语义：HTTP 500/超时/字段缺失 → 前端继续用本地素材，**不编造地址、不降级成空图**。

## 6. 写路径（两个切片，都要）

**切片 W1（B 端一次性，必须）**：交付件 `docs/2026-09-20/illustration-asset.sql` 自带 21 行种子，
在服务器上手工执行一次。改了地址要么改库（见 W2），要么重新生成一份新的交付件再执行。
可审计（文件进仓库历史）、可回滚（删行或删表）。

**切片 W2（运行期可改，已按你的选择实现）**：

```
GET  /api/v3/platform/illustrations      # 公开只读（匿名可访问）
PUT  /api/v3/platform/illustrations      # 仅 ADMIN；整批校验、整批生效
```

- 写接口与读接口**同路径**、同一份 DTO 与错误形状；鉴权用**方法级** `@PreAuthorize("hasRole('ADMIN')")`，
  `SecurityConfig` 只对该路径放开 `GET`（`PUT` 落在 `authenticated` 之下，另需 ADMIN）。
  为什么不放到 `/api/v3/admin/**`：那个前缀归账号模块，错误形状与会话约定是另一套；
  同一份资源分成两种错误形状，只能让前端按路径分叉。
- 入参校验（**这是安全边界，不是格式美化**，实现在 `IllustrationAssetService#validate`）：
  - 名字必须在白名单内（5 个场景名 + `type-<四字母>`，类型码合法性交给 `JungTypeCode.isLegal`）；
  - 只接受 `https://`，禁止带用户名密码与 `#` 片段；
  - host 必须命中允许清单（配置项 `typeme.illustration.allowed-hosts`，当前
    `yan-public-1407914221.cos.ap-beijing.myqcloud.com`），否则站点会变成"可以挂任意第三方图片"；
  - `sha256` 必须 64 位小写十六进制；`release` 必须是 1–32 位标签；
  - 一次请求内名字不得重复；**任何一条不合法就整批拒绝**（不做部分成功，否则页面会一半新图一半旧图）。
- 与 CSP 的联动（**已按修法 A 解决，这里只留结论**）：如果当初选了修法 B，新域名必须同时写进
  CSP 的 `img-src` 白名单里 —— 那正是"地址成为数据之后，硬编码策略会变成对数据的策略"的体现。
  现在 CSP 这条头已不再发出（`SecurityConfig` 里那个空 lambda 已删除），因此**改地址不再需要考虑 CSP**。
- 失败与审计：拒绝写入时返回既有错误形状（`VALIDATION_FAILED` + `details.fields`）；
  写入即更新 `updated_at`（是否需要 admin 审计表另议）。

## 7. 前端接线与首屏时序

**这一节是方案里最容易做错的地方，必须按此顺序实现。**

1. `api/platformV3.ts` 增加 `fetchIllustrations()`：用现有 `v3ReadJson`/`V3ApiError`/`unexpectedResponse` 封装。
   形状不对（缺字段）就抛 `UNEXPECTED_RESPONSE`；**地址"能不能用"不在这一层判**（那是解析层的事），
   这样"契约形状不对"与"地址不该用"两类问题不会混成一个错误。
2. 新增 `stores/illustrationAssetsV3.ts`（实现名）：
   - `state`：`urls: Record<string, string>`、`release`、`version`、`status: 'idle'|'loading'|'ready'|'failed'`、
     `error`、`waitedOut`、`attempted`；
   - `load()`：只发一次（`attempted` 语义同 `instrumentsV3`）；在 `main.ts` 里**先于 `app.mount()`** 发起；
   - `hydrate()`：**同步**读 `localStorage`（键 `typeme.illustration-urls.v1`）作为初值 ⇒ 回访访客首帧就有地址；
   - 到货后写 `localStorage`；失败时若已有缓存**不降级**（仍 `ready`），无缓存则 `failed`；
   - `settled` getter：`ready || failed || waitedOut` —— 组件的"可以开始解析地址了吗"只问它。
3. `design/illustrationAssets.ts` 保持"唯一解析处"，但把地址表作为**显式入参**（纯函数，好测）：
   `illustrationAsset(name, urls)`；`illustrationLocalAsset`、`illustrationLocalFallback` 语义不变。
   地址校验抽到 `design/remoteImageUrl.ts`（`normalizeRemoteImageUrl`，只认 https + 回环 http、禁凭据、去片段），
   原来那个"域名 + 对象键拼接"的 `imageBaseUrl.ts` 随构建期域名一起删除。
4. `IllustrationFrame.vue` 的**状态机必须区分三态**（改造前 `state` 把 `!src` 判为 `fallback`，
   直接用会闪一下兜底 SVG）：

   | 情况 | `src` | 界面 | 是否允许之后再换成远端 |
   | --- | --- | --- | --- |
   | 地址表未就绪（`settled=false`） | 不渲染 `<img>` | **占位**（既不是 SVG，也不下载本地素材） | 允许：到货后直接接管 |
   | 地址表命中 | 远端地址 | 占位 → 解码后淡入 | — |
   | 地址表未命中 / `failed` / 超时 | 本地素材 | 占位 → 解码后淡入 | 不允许（原本就用的是本地） |
   | 远端失败 | 本地素材（一次） | 同上 | 不允许（现有一次性回退语义不变） |
   | 本地也没有 | 无 | 兜底 SVG | — |

   - 超时上限建议 **1.2 s**：超时即按"map 未命中"处理并用本地素材，**绝不让首屏无限等接口**。
   - 只要曾经用本地素材渲染过，就不允许再被后来的 map 换成远端（"一次渲染只用一个来源"，
     组件里由 `decidedSrc` 落实）—— 这条有单测。
5. 首屏时延控制（**必须实测，不能假设**）：
   - map 请求在 `main.ts` 一并发出，早于 Vue 挂载；响应体约 5 KB，同源；
   - 可选：在 `index.html` 加静态 `<link rel="preload" as="fetch" href="/api/v3/platform/illustrations">`。
     **风险**：`as=fetch` 的 preload 只有在请求模式/凭据与后续 `fetch()` 完全一致时才会被复用，
     否则变成**两次请求**。这一条必须用真实浏览器核对（现有脚本有 CDP 网络事件，可判定是否双请求），
     不通过就去掉这个 preload。
   - 验收要求：`home-hero` 的"发起时刻"相对现状的劣化要**量化**（见 §11.4），不接受"应该差不多"。

## 8. 工具链改动

| 脚本 | 改动 | 状态 |
| --- | --- | --- |
| `scripts/gen-image-publish.mjs` | 新增 `--emit-sql`：从真实素材生成**手工交付 SQL**（默认 stdout，`--out` 才写文件，**已存在的文件拒绝覆盖**，除非 `--force`）。不再产出 `illustrationPublish.json`；`--check` 保留 | 已完成 |
| `scripts/check-remote-images.mjs` | 新增 `--from-api=<服务地址>`：读**公开接口**取地址（不需要库凭据），核对三方一致 —— 库里的 `sha256` ↔ 本地素材字节 ↔ 远端对象字节；漂移即失败。不带参数时仍按上传清单核对 | 已完成 |
| `scripts/check-bundled-image-urls.mjs`（原 `check-image-base-url.mjs`） | 语义变化：产物里**不应**再出现任何绝对图片地址或图片主机（不再有构建期域名）。已用负向探针确认能抓出写死的地址 | 已完成 |
| `scripts/cos-upload-images.mjs` | 未改（它只管上传；入库 SQL 由 `--emit-sql` 产出，在服务器上手工执行） | — |
| `scripts/browser-verify-{image-cdn,real-images}.py` | 改为由**接口 mock**提供地址表（`/api/v3/platform/illustrations`），不再依赖构建期域名；真实域名脚本额外断言"产物里不得出现域名" | 已完成 |

## 9. 与现有机制的关系（退场与保留）

| 机制 | 处置 |
| --- | --- |
| `VITE_IMAGE_BASE_URL` / `.env.production` / 构建期注入 | **已退场**。地址来自运行期接口，于是"切换方式 A/B"、"忘设环境变量导致静默回退"这两个风险一起消失 |
| `illustrationPublish.json` | **已删除**。运行期地址由库表决定；对象键在上传清单里、种子在交付件 SQL 里，同一份事实不再生成两份 |
| Flyway 迁移 | 本方案**不进** `db/migration`：表是手工执行的交付件（见 §4/§6），所以部署不会自动建表，也不会和"手工已建表"冲突 |
| 本地打包素材（2.5 MB 仍在包里） | **保留**。它仍是"接口失败/超时""库里没有这个名字""离线开发"时的唯一回退目标 |
| `IllustrationFrame` 的占位/淡入/一次回退 | **完全保留**，本方案只加了一个"地址表未就绪"的占位态与"一次渲染只用一个来源"的定源 |
| CSP | **已修（修法 A）**：空 lambda 删除，`default-src 'self'` 不再发出；回归断言见 `IllustrationAssetIT`。**需要后端重新部署后才在生产生效** |

## 10. 工作切片（各自可独立验证）

| # | 切片 | 依赖 | 完成判据 | 实际状态 |
| --- | --- | --- | --- | --- |
| S1 | 交付件 SQL + 种子数据（**执行需你在服务器上做**） | 无 | 真实 MySQL 与 H2 都能执行成功；21 行与素材一致 | 文件已生成（`--emit-sql`，与仓库交付件逐字节一致），**H2 上随契约测试执行通过**；真实 MySQL 由你执行 |
| S2 | 公开读接口 + 后端测试 | S1 | 匿名 200、字段完整、无用户数据 | 已完成（`IllustrationAssetIT` 5 用例全绿） |
| S3 | 前端 store + 解析处改签名 + 单测 | S2 的响应形状 | 三态状态机、超时回退、localStorage 复用均有断言 | 已完成（store 8 用例 + 解析 6 用例 + 组件 12 用例） |
| S4 | `IllustrationFrame` 状态机改造 + 浏览器验收 | S3 | §11.4 的量化结论 + 现有占位/淡入/CLS 断言全绿 | 已完成（真实 COS 域名 320/390/1440，70 项全绿） |
| S5 | 工具链改造（§8） | S1/S2 | 三方一致检查能真的抓出"改了图没重新上传/没更新库" | 已完成（`--from-api` 三方核对 + 产物零绝对地址检查，后者做过负向探针） |
| S6 | 管理员写接口 | S2 | ADMIN 才能写；非 https/非白名单 host/非白名单名字被拒；写后读接口立刻生效 | 已完成（同一 IT 覆盖 401/403/200 与 10 组非法输入） |
| S7 | **CSP 修法 A**（本轮新增） | 无 | 响应头里没有 `Content-Security-Policy`，其余安全头不受影响 | 已完成（含负向探针：加回空 lambda 即变红）；部署后需核对线上响应头 |

**与初稿的差异（实现时定的，都是实现细节，语义未变）**

1. 写接口路径放在 **`PUT /api/v3/platform/illustrations`**（而不是 `/api/v3/admin/illustrations`），
   与读接口同路径、同一份 DTO 与错误形状；鉴权用方法级 `@PreAuthorize("hasRole('ADMIN')")`，
   `SecurityConfig` 只放开**该路径的 GET**。理由：资源只有一份，读写分两个模块/两种错误形状
   会让前端按路径分叉；而 `/api/v3/admin/**` 那一套是账号模块的会话与错误约定。
2. 响应字段用 `assets[{name,url,sha256}]` + `release` + `version`（版本号 = 行数 + 最新 `updated_at`），
   不做 ETag/304：`Cache-Control: no-cache` + 约 5KB 的响应 + 前端 `localStorage` 更简单，
   也不会把"地址改了但 304 命中"变成一类难查的问题。
3. 生成器不再产出 `frontend/src/design/illustrationPublish.json`：地址改成运行期读库后它没有消费者，
   对象键仍在上传清单里。**同一份事实不再生成两份**。

## 11. 验证设计（每项能证明什么）

1. **建表 + 种子**：交付件 SQL 在真实 MySQL 上手工执行（你在服务器上做）；H2 上由
   `IllustrationAssetIT` 执行**同一份文件**，因此 SQL 的语法与内容每次 `mvn test` 都被验证一次。
2. **后端**：匿名 GET 200（且不返回任何用户字段）；未知名字/非法行不会进响应（校验在写入侧）；
   `PUT` 未登录 401 / 非 ADMIN 403 / ADMIN 200；**响应头里没有 `Content-Security-Policy`**（CSP 修法 A 的回归）。
3. **前端单测（vitest + jsdom）**：地址表命中→远端；未就绪→占位且不渲染 `img`；失败/超时→本地；
   迟到不换源；`localStorage` 初值同步可用。证明状态机与"不双下载"。
4. **浏览器验收（真实 COS 域名，320/390/1440）**：见下面的实际结果。
5. **三方一致性**：`node scripts/check-remote-images.mjs --from-api=<服务地址>`。

### 实际执行结果（2026-09-20 本轮）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 交付件 SQL + 读/写接口 + 响应头 | `mvn.cmd test -Dtest=IllustrationAssetIT` | **5/5 通过**（H2 上执行交付件 SQL；真实 MySQL 由你在服务器执行） |
| CSP 回归负向探针 | 把空 lambda 加回 `SecurityConfig` 再跑上面这条 | **如预期变红**（响应头出现 `Content-Security-Policy: default-src 'self'`），改回后转绿 |
| 前端单测 | `npm.cmd test` | **47 文件 / 1006 用例通过** |
| 后端测试子集（排除三类真实 MySQL IT） | `mvn.cmd test "-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT"` | **383 用例通过 / 0 失败**（1 跳过） |
| 类型检查 / 构建 | `npm.cmd run typecheck` / `npm.cmd run build` | 0 退出码 |
| 生成产物一致 | `node scripts/gen-image-publish.mjs --check` | 21 张、2,622,284 字节与素材一致 |
| 交付件可重现 | `node scripts/gen-image-publish.mjs --emit-sql --out <临时>` 后比对 | 与仓库交付件**逐字节一致** |
| 产物零绝对地址 | `node scripts/check-bundled-image-urls.mjs` | 通过（负向探针能抓出写死的域名） |
| **真实 COS 浏览器验收** | `TYPEME_LABEL=dbmap-real python scripts/browser-verify-real-images.py` | **PASS 70 / FAIL 0**；21 个插画位全部来自 COS、无本地回退、CLS≈0.002、`high=1 / lazy=20`；冷启动占位 434–524ms、缓存命中 199–247ms |
| 本地模拟域名（失败分支） | `TYPEME_LABEL=dbmap-mock python scripts/browser-verify-image-cdn.py` | **PASS 152 / FAIL 0** |
| **CSP 复现（修法 A 之前）** | `TYPEME_LABEL=dbmap-csp TYPEME_CSP="default-src 'self'" …` | 20 条请求全部 `blockedReason: csp`，21 个位置全部回退本地 —— 这就是修法 A 要修掉的现象 |

证据目录：`docs/optimization/verification/2026-09-20-image-cdn/{dbmap-real,dbmap-csp,dbmap-mock}/`。

## 12. 边界、风险与未决项

**硬边界**

- 数据库默认只读：交付件 SQL 由**你**在服务器上执行；本次改动不含任何数据库写入。
- 不进库的内容：报告、答题记录、账号信息、任何按用户归属的资源。发布白名单是唯一允许的名字集合。
- 凭据不进前端/仓库/日志；上传脚本沿用现有 `TYPEME_COS_*` 与凭据文件纪律。
- 不新增云资源、不改桶配置、不发版（CSP 的代码改动要等一次正常部署才生效）。

**风险**

| 风险 | 级别 | 处置 |
| --- | --- | --- |
| 首屏多一次接口依赖（`home-hero` 发起时刻变晚） | 中 | 已按甲实现：早发起 + 1.2s 上限 + 量化验收（冷启动占位 434–524ms）。劣化不可接受时改用"服务端注入 index.html"（零 RTT，但要改 SPA 静态服务路径并牵动 `SpaRoutingTest` 契约） |
| 库成为单点：库挂了图片退回本地 | 低 | 本地素材保留；且库不可用时登录等功能本就不可用 |
| 两处真相（库 vs 上传清单）漂移 | 中 | S5 的三方一致性检查；清单降级为种子/基线 |
| ~~地址可运行期改动 → 与 CSP 白名单不一致~~ | ~~高~~ → **已消除** | 修法 A 已落地：不再发 CSP 头，改地址与策略无关 |
| `localStorage` 缓存导致"改地址后老访客仍是旧图" | 低 | 缓存带 `version`，启动即以接口 `version` 决定是否替换；且旧地址失效时有一次性本地回退 |
| 交付件 SQL 未执行时读接口 500（表不存在） | 低 | 前端按"读表失败"用本地素材，页面正常；如果你希望安静一点，可让读接口在表不存在时返回空表（尚未做） |

**未决项**

1. ~~写路径：只做 W1 还是 W1+W2~~ → **已定：W1+W2**（你选的 `w2`），已实现。
2. ~~存绝对 URL 还是"对象键 + 域名配置项"~~ → **已定：存绝对 URL**（最直接，且可指向任意合规 host；
   域名允许清单在服务端配置项 `typeme.illustration.allowed-hosts` 里，换域名不必改 Java）。
3. ~~首屏取舍（甲/乙/丙）~~ → **已定：甲**（启动读一次小接口 + 1.2s 上限 + `localStorage` 复用）。
4. ~~CSP 修法 A / B~~ → **已定：A，已改**（空 lambda 已删）。
5. ~~是否授权执行建表 SQL~~ → **已定：改成手工交付件**（`docs/2026-09-20/illustration-asset.sql`），
   由你在服务器上执行；它不进 `db/migration`，因此不会被 Flyway 自动执行。
   执行前读接口 500（表不存在）→ 前端用本地素材，页面正常。
6. 可选加固（未做）：COS 防盗链白名单、外网下行流量告警、把 `check-bundled-image-urls.mjs` 接进
   `prebuild`（现在只是手动/CI 可跑）、表不存在时读接口返回空表而不是 500。

## 13. 回滚

- 前端：读取失败/接口下线时自动退回本地素材，不需要发版回滚；
- 后端：接口保留但返回 404/关闭时，前端按"未命中"处理；
- 数据：`illustration_asset` 删行或整表回退（`DROP TABLE` 需授权），对象存储里的对象不受影响；
- CSP：把那个空的 `.contentSecurityPolicy(csp -> {})` 加回 `SecurityConfig.headers(...)` 即可
  （但那会重新拦掉跨域图片，等于回滚本次迁移）；
- 完全回退到"构建期域名"：删除前端 store 接线，恢复构建期清单路径（现有代码在 git 历史里完整可查）。
