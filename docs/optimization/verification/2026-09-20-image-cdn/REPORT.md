# 图片资源迁到对象存储：本地模拟图片域名验收

日期：2026-09-20。范围：`VITE_IMAGE_BASE_URL` 配置切换、远端 404、慢网、缓存命中、快速切换与失败回退，
外加 320/390/1440 的布局与加载体验回归。
浏览器侧全部用**本地模拟图片域名**完成；另有产物级与真实端点的只读检查（见 §10）。
**没有创建 COS 桶/CDN 资源、没有上传任何文件、没有改 DNS 或权限、没有开通任何计费项。**

- 方案与云端步骤（桶、权限、防盗链、最小权限、费用、切换与回退）：`docs/cloud/2026-09-20-image-cos/PLAN.md`
- 上传清单：`docs/cloud/2026-09-20-image-cos/upload-manifest.json` / `upload-manifest.md`
- 复现脚本：`scripts/browser-verify-image-cdn.py`（本地模拟图片域名）、`scripts/browser-verify-real-images.py`（真实域名）、
  `scripts/check-remote-images.mjs`（匿名核对已上传对象）、`scripts/gen-image-publish.mjs`、
  `scripts/upload-image-manifest.mjs`、`scripts/cos-upload-images.mjs`、`scripts/check-image-base-url.mjs`

## 1. 结论

对象已上传，前端接入已验证。三轮验收：

| 轮次 | 图片从哪来 | 结果 |
| --- | --- | --- |
| 对照（不配置域名） | 站点服务器 `/assets/*.webp` | **PASS 134 / FAIL 0** |
| 远端（本地模拟图片域名，可注入 404/挂起） | 本地模拟图片域名 | **PASS 152 / FAIL 0** |
| **真实域名（COS 官方域名，浏览器真的去 COS 取图）** | `yan-public-1407914221.cos.ap-beijing.myqcloud.com` | **PASS 70 / FAIL 0** |

**同一份源码、三次构建，图片链路确实换了，加载体验没有退化：**

| 判据 | 未配置图片域名（本地） | 配置图片域名后（远端） |
| --- | --- | --- |
| 检查项 | **PASS 134 / FAIL 0** | **PASS 152 / FAIL 0** |
| 首页 21 张插画的请求去向 | 站点服务器 `/assets/*.webp` 20 条 | 图片域名 `/illustrations/2026-09-20/*.webp` 20 条 |
| 站点收到的图片请求 | 20 条 | **0 条** |
| 首图容器尺寸变化（320/390/1440） | 0px | 0px |
| 图片相关 CLS | 0 | 0（整体 0.00169–0.00234，来源是导航按钮） |
| 淡入 | 9 / 9 / 7 中间帧，`opacity 0.2s` | 9 / 9 / 9 中间帧，`opacity 0.2s` |
| 远端 404 | 不适用 | 恰好 1 次远端失败 + 1 次本地成功 → 正常显示 |
| 远端 + 本地都失败 | 1 次失败 → 兜底 SVG | 恰好 2 次请求 → 兜底 SVG，无第三次 |
| 缓存命中 | 0 次新请求、0ms 占位窗口 | 0 次新请求、0ms 占位窗口 |

真实域名那一轮（§10）用的是线上真实链路，它单独回答"线上形状能不能用"。

**没有测到、也不宣称："加载变快"。** 下面这些数字是真实观测，不是提速承诺：冷启动时 20 张插图
合计传输 2,483,153 字节（约 2.37 MB），最慢一张 985–1708 ms，都是由 COS 源站直出（没有 CDN 边缘缓存）。
按当前方案真正的收益是**源站不再承担图片流量**，不是首屏更快。

## 2. 验证方式

隔离构建 + 两个本地服务器扮演两个角色，不装 Playwright 路由（否则浏览器 HTTP 缓存不按真实规则工作，
"缓存命中"根本测不出来）：

```
http://127.0.0.1:5196   站点：页面、JS/CSS，以及**兜底用的本地图片**（dist 里 21 张都在）
http://127.0.0.1:5199   模拟图片域名：按上传清单的对象键提供同一批图片，可注入 404 / 挂起响应
```

- 三次构建除了 `VITE_IMAGE_BASE_URL` 之外完全相同，产物差异只在打包进去的图片地址：
  - 对照（不设置）`index-BCJZdUvd.js` 647.16 kB；模拟域名 `index-DsO7Mpt0.js` 647.49 kB；
    真实域名 `index-CiPquA7h.js` 647.53 kB。接入带来的增量约 0.3 kB。
  - 产物名里的哈希会随**任何**源码改动变化（例如同时进行的 `reportV3.ts` 修改），
    所以别把哈希当成接口；判断"打进的是哪个域名"请用 `scripts/check-image-base-url.mjs`。
  - 远端产物里同时存在三种字符串：图片域名 1 处、对象键前缀 21 处、以及带 Vite 哈希的本地资源名
    （如 `type-infp-DWAc8UWa.webp`）—— 前者是主地址，后者是回退目标，两者都在包里。
- API 全部由站点服务器模拟回答；未连数据库、未调用 AI、未访问外网；脚本对未定义的 API 路径会失败。
- 慢网用"把响应挂住直到放行"实现，而不是 sleep 固定时长：这样"占位截图"一定拍在还没拿到图片的时刻。
  脚本会断言这次挂起是被主动放行的（不是等超时放行），避免把"拍晚了"当成"加载态"。

```powershell
cd frontend; npm.cmd run build; cd ..
$env:TYPEME_IMAGE_MODE='local';  $env:TYPEME_LABEL='local';  python scripts/browser-verify-image-cdn.py
$env:VITE_IMAGE_BASE_URL='http://127.0.0.1:5199'; cd frontend; npm.cmd run build; cd ..
$env:TYPEME_IMAGE_MODE='remote'; $env:TYPEME_LABEL='remote'; python scripts/browser-verify-image-cdn.py
```

## 3. 配置切换（远程是否真的接管）

320/390/1440 三个宽度各自独立验证，证据取自**两个服务器的请求日志**而不是页面上写了什么：

| 判据（remote 模式） | 实测 |
| --- | --- |
| 首屏主图地址 | `http://127.0.0.1:5199/illustrations/2026-09-20/home-hero.4583aa734b96.webp` |
| 21 张插画的来源 host | `{"127.0.0.1:5199": 21}`（只有一个 host） |
| 站点服务器收到的图片请求 | `[]`（0 条，源站不出图） |
| `data-artwork-attempt` | 全程 `primary`（正常路径不触发回退） |
| 预加载 | `<link rel="preload" as="image">` 0 个；`fetchpriority=high` 只有 1 张（主图）；`loading=lazy` 20 张 |

local 模式同样三个宽度：图片域名请求 0 条、站点请求 20 条、主图地址以站点开头 —— 未配置时行为与接入前一致。

## 4. 远端失败 → 一次受控本地回退（以首页主图为例，页面上只有这一张，请求次数可断言精确值）

| 判据 | 实测 |
| --- | --- |
| 远端 404 后 | `attempt=local-fallback`、`state=ready`、`source=image`、显示 host 是站点、`naturalWidth=960`、`opacity=1` |
| 远端请求次数 | **1** |
| 本地请求次数 | **1**（`/assets/home-hero-D6cgdiEp.webp`） |
| 正文与按钮 | `h1Visible=true`、按钮未禁用 |
| 图片容器位移 | 来源 `[]`，CLS 0.00169 |

**双重失败（远端 404 + 本地也 404）**：`state=fallback`、`source=vector`、`img` 已移除、兜底 SVG 顶上，
远端 1 次 + 本地 1 次 = **总共 2 次请求，没有第三次**；同一页面其余 20 张仍全部 `ready`，正文与图鉴不受影响。

**本地模式下的本地失败**：直接进兜底（`attempt=primary`，不进入回退档），只请求 1 次，图片域名 0 次请求 —— 与接入前完全一致。

## 5. 慢网 / 占位 / 淡入 / 布局（320、390、1440）

主图响应被挂住约 1.0–1.2 秒，在这段时间内：

| 判据 | 320 / 390 / 1440 |
| --- | --- |
| `data-artwork-state` | `loading` / `loading` / `loading` |
| 图片计算不透明度 | `0` / `0` / `0` |
| 首屏主图属性 | `loading=eager` + `fetchpriority=high` |
| 正文与 CTA | 可用（`h1Visible`、按钮未禁用），页面文案已渲染 |
| 整页 loading 遮罩 | 0 个 |
| 图片区细节（stddev） | 4.16 / 3.39 / 2.59（46–64 色） |
| 显示后图片区细节 | 60.53 / 60.36 / 61.59（3453–3499 色） |
| 显示前后像素变化占比 | 90.1%（平均差约 110） |

占位与显示后是**同一取景**的两张图（CDP 按文档坐标裁切），所以"变化像素 90.1%"直接证明图片真的画上了内容，
而不是靠人眼看截图。占位阶段 stddev 2.6–4.2 也说明它是设计里那块低细节底色，不是"半张图"。

淡入与布局：

| 判据 | 320 | 390 | 1440 |
| --- | --- | --- | --- |
| 淡入中间帧 | 9 帧 | 9 帧 | 9 帧 |
| 过渡属性 | `opacity 0.2s` | `opacity 0.2s` | `opacity 0.2s` |
| `.atelier-cover-art` 尺寸变化 | 0px（272） | 0px（330） | 0px（562） |
| `.assessment-card-art` | 0px（230） | 0px（230） | 0px（290） |
| `.portrait-spotlight-art` | 0px（286） | 0px（286） | 0px（355） |
| `.atelier-reflection-art` | 0px（255） | 0px（255） | 0px（410） |
| 图片相关 CLS | 0 | 0 | 0 |
| 整体 CLS | 0.00208 | 0.00169 | 0.00234 |

唯一位移来源是导航按钮 `A.btn-ghost.btn-sm`（与图片无关，与 2026-09-18 的结论一致）。

## 6. 缓存命中

同一文档内 首页 → 关于页 → 首页（保留浏览器缓存，不禁用）：

| 判据 | 390 | 1440 |
| --- | --- | --- |
| 图片域名新请求 | 9 → 9（**0 条新增**） | 10 → 10（**0 条新增**） |
| 占位窗口 | 0.0ms | 0.0ms |
| 淡入中间帧 | 0 帧 | 0 帧 |
| 图片相关位移 | 0 | 0 |

即：命中缓存时既不重新下载，也不演一遍淡入、不闪占位（"缓存命中不故意延迟"）。

## 7. 快速连续切换（INTJ 慢 2.5s，连点 INTJ→ESFP→INTP→ENFP）

| 判据 | 390 / 1440 |
| --- | --- |
| 最终插画 / 状态 | `type-enfp` / `ready`，文件就是 `type-enfp.c06b798e47d3.webp`，`opacity=1` |
| 选中态与标题 | `aria-pressed` 与标题都指向 ENFP（"灵感漫游者"） |
| 可见插画属于当前选择 | 不一致样本 **0** |
| 晚到的旧图（INTJ）可见样本 | **0** |
| 切换过程触发回退 | 否（全程 `primary`） |
| 每个名字的请求次数 | `{type-intj: 1, type-esfp: 2, type-intp: 2, type-enfp: 2}`（有界；同一张图在图鉴缩略图与主展示各请求一次） |
| 图片容器位移 | 0 |

## 8. 单元测试与构建

| 项 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过（exit 0） |
| `npm.cmd test` | **46 文件 / 996 例全通过**（exit 0），含本轮新增：`imageBaseUrl.spec.ts` 6 例、`illustrationAssets.spec.ts` 8 例、`illustrationFrame.spec.ts` +3 例 |
| `npm.cmd run build` | 通过（两种配置各一次） |
| `node scripts/gen-image-publish.mjs --check` | 通过：21 张、2,622,284 字节、版本 2026-09-20 |
| 白名单负向测试 | 往素材目录放一个 `report-draft-screenshot.webp` → 生成器以非 0 退出并指名拒绝；删除后恢复通过 |
| `node scripts/upload-image-manifest.mjs --check-local` | 通过：本地 21 个文件字节与清单 SHA-256 全部一致 |
| `node scripts/check-image-base-url.mjs` | 通过：对照构建的产物里没有任何绝对远程图片地址 |
| `node scripts/check-remote-images.mjs` | 通过：**匿名**取回 21/21，字节与本地素材逐字节一致（含带 Referer 的一遍） |

新增单测钉住的是**用户可见结果**，不是实现细节：未配置时地址不外链且等于本地资源；配置后按发布清单对象键拼接；
公网 `http://` 被忽略并回落本地；回退地址只在"确实在用远端"时给出；远端失败只回退一次、本地再失败即兜底、换图后回退状态重置。

## 9. 产物与证据

`docs/optimization/verification/2026-09-20-image-cdn/`

- `local/`、`remote/`、`real/`
  - `summary-{local,remote,real}.json`：134 / 152 / 70 项判据原文、请求日志、说明
  - `traces-{local,remote,real}.json`：逐帧状态与容器盒（60fps 采样）
  - 截图：`switch-{320,390,1440}-full.png`（整页）、`cold-{320,390,1440}-{loading,fade,after}.png`、
    `cold-*-frame-{loading,ready}.png`（同取景，用于像素比对）、`remote-404-390.png`、
    `double-failure-390.png`、`local-failure-390.png`、`cache-{390,1440}-after.png`、`switch-{390,1440}-final.png`；
    `real/` 下另有 `real-{320,390,1440}-full.png`、`real-cold-*-after.png`、`real-warm-*-after.png`
  - `video/*.webm`：390 宽冷缓存淡入与快速切换
- `logs/`：构建（对照 / 模拟域名 / 真实域名 / 上传后对照）、浏览器验收（本地模拟 / 真实域名）、
  前端全量测试、产物检查的完整输出

## 10. 真实域名轮次：浏览器真的去 COS 取图

上面第 2–7 节用的是**回环地址**当图片域名。对象上传完成后，补做了**真实域名**这一轮
（`scripts/browser-verify-real-images.py`）：站点仍由本地静态服务器提供，但图片由浏览器直接从
`https://yan-public-1407914221.cos.ap-beijing.myqcloud.com` 取——真实证书、真实响应头、真实缓存、真实延迟。

请求账目不依赖任何本地服务器日志，而是用 CDP 的 Network 事件独立记（请求、状态码、传输字节、缓存事件）。

| 判据 | 结果 |
| --- | --- |
| 检查项 | **PASS 70 / FAIL 0**（320 / 390 / 1440，各含一次冷启动 + 一次二次加载） |
| 图片请求去向 | 全部 `https://yan-public-1407914221.cos.ap-beijing.myqcloud.com/illustrations/2026-09-20/…` |
| 响应状态 | 全部 200，无 4xx/5xx，无加载失败 |
| 本地兜底请求 | **0 条**（真实域名这条路是通的，没有退化到本地资源） |
| 插画位渲染 | 全部 `<img>`，没有一个停在兜底 SVG |
| `data-artwork-attempt` | 全程 `primary`，没有发生回退 |
| 主图容器高度变化 | 0px（320/390/1440） |
| 图片相关 CLS | 0（整体 < 0.01） |
| 淡入 | 9 个中间帧，`opacity 0.2s` |
| 预加载策略 | `preload=0 high=1 lazy≥10`（与本地一致，不预加载全部人物） |
| 二次加载（浏览器缓存） | 20 条图片请求**传输 0 字节**，占位窗口 190–201ms（冷启动 465–1804ms） |
| 等待图片期间版面无阻塞 | 主按钮仍在版面上（宽高均 > 0） |

### 10.1 匿名可读核对（不带任何凭据）

`scripts/check-remote-images.mjs` 用**完全匿名**的 GET 逐个取回 21 个对象：
21/21 都是 200，`Content-Type: image/webp`、`Cache-Control: public, max-age=31536000, immutable`，
字节与本地素材 **SHA-256 逐字节一致**。另外用 `--referer=https://example.com/` 再跑一遍，同样 21/21 通过
——说明**防盗链当前没有开启**，站点不发 Referer（no-referrer）这件事目前不构成风险。

### 10.2 上传执行与复核

- `--verify-key`：签一个 `GET /`，返回 **HTTP 200** → 签名实现被 COS 接受（这是最直接的证明；
  顺带说明这把密钥**能列举存储桶**，权限大于上传所需）。
- `--execute`：21 个对象 PUT 全部 200，并逐个 HEAD 复核 `Content-Length` / `Content-Type` / `Cache-Control`，21/21 通过。
- 上传前桶内 0 个对象；上传后再由匿名客户端按 §10.1 全量核对。

### 10.3 一个仍然没法在本机复现的东西

"把真实域名解析到本地 mock"依旧做不到（本机系统代理 `127.0.0.1:12000` 会绕过 Chromium 的
`--host-resolver-rules`，改 hosts 属于改系统配置）。现在不需要它了：真实端点已经可用，
而失败分支（404 / 挂起 / 双重失败）继续由第 2 节的本地模拟覆盖。两者各管一段，不重叠也不留空。

## 11. 未覆盖与风险

1. **没有在真实站点上跑**：三轮验收都在"隔离构建 + 本地静态服务器 + 模拟 API"里完成，
   没有部署、没有连数据库、没有调 AI。上线后的表现（尤其是真实用户网络与并发）没有验证过。
2. `img.decode()` 行为只在 Playwright 自带 headless Chromium 上验证，未覆盖 Firefox/Safari 与真机。
   真实域名那一轮证明了**链路**可用，但没有在手机浏览器上验证过。
3. 慢网是"服务端把响应挂住"，不是真实弱网抖动；它验证了挂起期间的状态与可用性，不替代真机弱网。
   真实域名轮的 985–1708 ms 是本机到 COS 的一次观测，受本机网络影响，不代表用户侧分布。
4. 只有首页 + 图鉴两条链路做了完整回归。登录/注册/找回/报告页共用同一个 `IllustrationFrame`，
   但没有逐页重复跑本轮场景（2026-09-18 的 atelier 回归覆盖过这些页面的图片加载）。
5. **已存在的观察项（本轮未改）**：headless Chromium 仍会在启动阶段把 20 张 `loading=lazy` 图片全部请求掉
   （DOM 标注为 lazy，是浏览器按距离阈值提前取）。迁移后这些请求打到对象存储，属流量成本项而非正确性问题；
   真正的改进需要"缩略图 + `srcset`"（图鉴缩略图实际只有几十像素宽却下载 640×800 原图），属独立优化项。
   这也是**外网下行成本的主要来源**：每个冷访问约 2.37 MB。
6. **计费没有实测**：费用估算在 PLAN §8，是按单价推算，不是账单证据。建议上线后看一天真实用量。
7. 给后续维护者的三个坑：
   - Playwright 的 `page.screenshot()` / `locator.screenshot()` 每次都会等 `document.fonts.ready`，
     而它要等文档 `load`；只要还有图片请求挂着，截图就会一直等（本次实测等到 30s 超时）。
     "请求未返回时"的截图必须走 CDP（脚本里的 `cdp_shot`）。
   - 本机系统代理会绕过 Chromium 的 `--host-resolver-rules`；任何"把真实域名指到本地"的验证思路
     在改 hosts 之前都不会生效。
   - CDP 的 `Network.requestServedFromCache` 在 Chromium **内存缓存**命中时不会触发
     （实测 20 条图片全部命中缓存，该事件 0 条）。判断"是否命中缓存"要看 `encodedDataLength` 是否为 0。

## 12. 阻塞项：后端的 CSP 会在生产环境拦掉跨域图片（**尚未修复**）

**这是本轮发现的最严重问题，本文档第 2–10 节的验证方法天然看不到它。**

### 12.1 事实

`backend/src/main/java/com/typeme/security/SecurityConfig.java:118-128`：

```java
.headers(headers -> headers
        .contentTypeOptions(Customizer.withDefaults())        // X-Content-Type-Options: nosniff
        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.SAME_ORIGIN))
        .frameOptions(frame -> frame.deny())
        // 刻意不配置 CSP：本轮不动前端，加 CSP 会打断既有行内脚本（契约 §7.3 同义）。
        // 这里给一个空配置 lambda（等价于"不加这条头"），而不是调用某个 disable()。
        .contentSecurityPolicy(csp -> {
        }));
```

注释认为"空 lambda 等价于不加这条头"。**这个判断是错的。** 逐字节核对过 Spring Boot 3.3.5
实际使用的 spring-security 6.3.4（`spring-boot-dependencies-3.3.5.pom` 里
`<spring-security.version>6.3.4</spring-security.version>`）：

| 事实 | 证据（`javap -c` 字节码） |
| --- | --- |
| `ContentSecurityPolicyHeaderWriter()` 无参构造的默认策略是 `default-src 'self'` | `ldc "default-src 'self'"` → `setPolicyDirectives` |
| `contentSecurityPolicy(Customizer)` 会**立刻创建** writer 并挂到配置上 | `new ContentSecurityPolicyHeaderWriter` → `invokespecial <init>:()V` → `putfield ContentSecurityPolicyConfig.writer`（发生在调用那个空 lambda **之前**） |
| 这个 writer 一定会进响应头列表 | `HeadersConfigurer` 里 `addIfNotNull(writers, contentSecurityPolicy.writer)` |
| `default-src` 会兜住 `img-src` | CSP 规范：未声明的取指令回落到 `default-src` |
| 反过来，只要**不调用**该方法，writer 字段一直是 null，也就没有这条头 | `ContentSecurityPolicyConfig` 的私有构造函数只设置 `this$0`，不初始化 `writer` |

这条链没有 `securityMatcher`（只有授权用 `permitAll`，而 `permitAll` 只管授权、不管响应头），
所以 `headers` 作用于**所有响应**——包括 `/`、`/index.html` 与 `/assets/*`。

为什么一直没被发现：本站此前**没有任何跨域请求**（这也是 2026-09-18 那份体验验证里
"首屏无任何跨域请求"的由来）。CSP 只拦跨域资源，所以它对旧站是无害的。
**图片迁到 COS 恰好引入了本站第一个跨域资源**，于是它是第一个被这条 CSP 打到的东西。

### 12.2 复现（真的跑过，不是推理）

`scripts/browser-verify-real-images.py` 新增 `TYPEME_CSP`：让本地静态服务器发送与后端**完全相同**的
响应头，再让浏览器用真实 COS 域名取图。

```powershell
$env:TYPEME_CSP="default-src 'self'"; python scripts/browser-verify-real-images.py
```

结果（`real/summary-csp.json`、`real/csp-390-after.png`、`logs/image-cdn-verify-csp.log`）：

| 观测 | 数值 |
| --- | --- |
| 发往 COS 的图片请求 | 20 条，**全部被拦**（CDP `Network.loadingFailed`，`blockedReason: csp`） |
| CSP 违规报错 | 41 条（`Loading the image 'https://yan-public-…' violates the following Content Security Policy directive`） |
| 页面实际显示的图片 | **21/21 全部来自源站**（`{"127.0.0.1:5197": 21}`） |
| 回退到本地资源 | 20 条 |
| 插画位渲染 | `frames=21 withImg=21` —— **看起来完全正常** |

也就是说：**切换后生产环境的表现是"页面一切正常，但图片一张都没走 COS"**。
对象存储白传、流量白花，线上没有任何肉眼可见的异常，只有控制台里的 CSP 报错。
被拦的请求连网络都没发出去（`blockedReason: csp`），所以复现本身不产生 COS 流量。

### 12.3 修法与最终处置（**已按修法 A 修掉**）

**修法 A（最小、符合原意）：把那个空调用删掉 —— 已采用。**

```java
.headers(headers -> headers
        .contentTypeOptions(Customizer.withDefaults())
        .referrerPolicy(referrer -> referrer.policy(ReferrerPolicy.SAME_ORIGIN))
        .frameOptions(frame -> frame.deny()));
        // 不调用 contentSecurityPolicy(...)：writer 字段保持 null，不会发出这条头
```

删掉之后**没有任何 CSP 头**，与注释里写的意图一致。补充说明：现在 `default-src 'self'` 已经在生效，
而 `index.html` 里只有外链 `<script type="module" src="...">`、没有行内脚本或行内样式，
所以它目前没打断前端 —— 但它一直在悄悄限制跨域资源。

**修法 B（保留 CSP，把图片域名加白）：未采用。**

```java
.contentSecurityPolicy(csp -> csp.policyDirectives(
        "default-src 'self'; img-src 'self' https://yan-public-1407914221.cos.ap-beijing.myqcloud.com"))
```

不采用的理由：地址已经变成**运行期可改的数据**（`PUT /api/v3/platform/illustrations`），
而白名单写死在 Java 里 —— 改一次地址就要改代码、重新部署，否则图片又被拦。
"CSP 加固"应作为独立任务（先 `Content-Security-Policy-Report-Only` 观察），而不是绑在这次迁移上。

**已落地的验证**（2026-09-20 晚）：

| 项 | 证据 |
| --- | --- |
| 删掉后这条头确实不再出现 | `IllustrationAssetIT#noContentSecurityPolicyHeader`（断言 200 + 无 `Content-Security-Policy`，同时断言 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、`X-Frame-Options: DENY` 仍在，防止"整段 headers 被删"也能通过） |
| 这条断言真的抓得住回归 | 负向探针：把 `.contentSecurityPolicy(csp -> {})` 加回去单独跑该用例 → **FAIL**，响应头里出现 `Content-Security-Policy:"default-src 'self'"`；改回后 PASS |
| 生产是否已生效 | **尚未**：这是后端代码改动，要等一次正常部署。部署后跑 §12.4 的命令确认 |

### 12.4 一条核对命令

```powershell
# 线上（或本地起后端）确认这条头到底在不在：**应当没有任何输出**
curl.exe -sI https://<地址>/ | Select-String -Pattern 'Content-Security-Policy|Referrer-Policy'
```

---

## 13. 第二轮：地址改成数据库驱动后的重跑（2026-09-20 晚）

本节是**同一批验收在新接线下的重跑**，不是新问题。接线变化与方案见
`docs/2026-09-20/图片URL入库方案.md`：

- 页面地址来自运行期接口 `GET /api/v3/platform/illustrations`（库表 `illustration_asset`），
  不再由构建期 `VITE_IMAGE_BASE_URL` 拼出来；前端产物里**不得**再出现任何图片域名；
- 因此两个验收脚本改为**由接口 mock 提供地址表**：本地模拟轮给模拟域名，真实域名轮给真实 COS 地址；
- `IllustrationFrame` 多了一个"地址表未就绪"的占位态，以及"一次渲染只用一个来源"的定源
  （地址表迟到时不再把已经用本地素材渲染过的位置换成远端，避免同一张图付两次下载）。

### 13.1 结果（全部真跑）

| 轮次 | 命令 | 结果 | 证据目录 |
| --- | --- | --- | --- |
| 本地模拟图片域名（404 / 挂起 / 慢网 / 缓存 / 快速切换） | `TYPEME_LABEL=dbmap-mock python scripts/browser-verify-image-cdn.py` | **PASS 152 / FAIL 0** | `dbmap-mock/` |
| 真实 COS 域名（320/390/1440，冷启动 + 同上下文再加载） | `TYPEME_LABEL=dbmap-real python scripts/browser-verify-real-images.py` | **PASS 70 / FAIL 0** | `dbmap-real/` |
| 生产 CSP 复现 | `TYPEME_LABEL=dbmap-csp TYPEME_CSP="default-src 'self'" python scripts/browser-verify-real-images.py` | PASS 3 / FAIL 0（=复现成功） | `dbmap-csp/` |

真实域名轮的关键数字（390 宽冷启动 / 缓存命中）：21 个插画位全部来自
`yan-public-1407914221.cos.ap-beijing.myqcloud.com`、**0 条本地回退**、全部 200、
CLS 0.002、`preload=0 high=1 lazy=20`；冷启动占位窗口 434–524ms（含读一次地址表），
二次加载 199–247ms（≈淡入 200ms 本身，说明地址表已从 `localStorage` 直接读到、没有多等一轮 RTT）。

### 13.2 CSP 复现（修法 A 之前的现象；该问题已修）
`dbmap-csp/summary-csp.json`：20 条发往 COS 的请求**全部** `blockedReason: csp`（41 条 CSP 报错），
页面实际显示的来源是 `{"127.0.0.1:5197": 21}`、19 条回退到本地资源 —— 页面看上去完全正常，
所以**只看页面是发现不了的**。地址改成库驱动之后，修法 B（写死 `img-src` 白名单）的代价更高了：
地址可以运行期修改，而白名单不能，两者必然漂移，因此选了修法 A。

**处置**：修法 A 已落地（`SecurityConfig` 里那个空 lambda 已删除），
回归断言与负向探针见 §12.3。本节这一轮证据保留为"问题确实存在过"的原始记录。
**注意**：后端要重新部署，这条改动才在生产生效。

### 13.3 本轮**没有**覆盖的（需要你执行或真实环境）

- **真实 MySQL 上执行建表迁移**：`V10__illustration_asset.sql` 随部署由 Flyway 执行。本机只在 H2 上
  验证过（Flyway 应用 v10、并把同一份脚本**再执行一遍**证明幂等）；真实 MySQL 的方言差异要等首次
  部署时看启动日志确认 —— 目前还没有人在真实 MySQL 上执行过它。
- **真实后端 + 真实库的端到端**：本轮浏览器验收的地址表来自接口 mock（形状与后端 IT 断言的完全一致），
  真实链路（MySQL → 后端 → 浏览器）要在后端重新部署后跑一次：
  `node scripts/check-remote-images.mjs --from-api=<服务地址>`，
  再核对线上响应头（§12.4），并在真实响应头下重跑一次浏览器验收。
- 防盗链、COS 下行告警、`check-bundled-image-urls.mjs` 接入 `prebuild` —— 都未做。
