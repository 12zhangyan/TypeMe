# 图片加载体验修复（2026-09-18）：原因、改动与验证

- 范围：前端共享图片组件 `frontend/src/components/IllustrationFrame.vue` 及其消费者（首页主图、十六型人物切换、报告配图、测评卡片、登录/注册/找回）。
- 边界：不改页面视觉、不替换图片、不改裁切与响应式布局、不改计分与业务规则、不新增依赖；加载策略（`eager`/`lazy`/`fetchpriority`）保持原样。
- 与本轮"答题分流修复"是两件独立的事，本文只覆盖图片加载体验；改动文件与它不重叠。
- 数据库只读；全程隔离构建 + 模拟 API，未调用真实 AI，未提交/推送/部署。

## 1. 结论

**"突兀"的实际原因不是尺寸跳动，而是没有加载态与过渡**：容器一直有确定尺寸（实测变化 0px），但图片从"什么都没有"直接变成完整画面。

- 修复前：`<img>` 一插入就 `opacity: 1`，主图数据到达的那一帧整块贴上来；快照显示到达瞬间已是 `alpha=1.000`。所谓"加载中"其实是空白，`data-artwork-state` 这类状态压根不存在。
- 修复后：未就绪时 `opacity: 0`（由各消费者既有尺寸/比例占位，不塌陷），`load` + `decode()` 完成后 200ms 只改不透明度淡入；主图数据到达（t≈1.88s）后 t≈1.90s 开始淡入、t≈2.10s 完成。
- 最终画面**像素级未变**（修复前后最终态截图差异像素 0.00%）。

## 2. 逐条核查（按任务清单，全部有实测证据）

| 待查项 | 实测结论 | 证据 |
| --- | --- | --- |
| 是否"先显示默认 SVG，加载后突然换位图" | **否**。`v-if="src && !failed"` 意味着正常加载阶段不渲染兜底 slot；修复前后全程 `data-artwork-source=image`、slot 始终为 `null`。兜底 SVG 只在缺素材/失败时出现 | 场景 1「从不先用兜底 SVG 顶替」「加载期间不渲染兜底 SVG 内容」 |
| 是否缺宽高/比例导致跳动 | **否**。`.atelier-cover-art` 272/330/562px、`.portrait-spotlight-art` 286/286/355px、`.assessment-card-art` 230/230/290px、报告角色区 177px、报告人物 144px，加载全程**变化 0px**；CLS 0.0017–0.0023，唯一位移来源是与图片无关的 `A.btn-ghost`（导航按钮） | 场景 1/5/6 的 `.boxes` 与 `.shifts`（见 `traces-*.json`） |
| 是否未解码就显示 | **是，这才是主因**。`decoding="async"` 之后没有任何"解码完成"信号：修复前可见即完整（快照 alpha 1.000），修复后先把 `naturalWidth>0`（数据到达）与 `opacity=1`（解码完成）分开 | `cold-slow-390` 时间线：`t=1882ms nw=960 opacity=0` → `t=1900ms state=ready` → `t=2099ms opacity=1` |
| 首屏是否误用懒加载 | **否**。主图 `loading=eager` + `fetchpriority=high`，其余 20 张 `loading=lazy`，无 `<link rel=preload as=image>` | 场景 1「主图 eager + 高优先级」「屏外图片仍走懒加载」「只有首屏主图是高优先级，且没有额外 preload」 |
| 旧图片晚到是否覆盖新选择 | 浏览器换 `src` 本身不会画出旧图（修复前后"不一致样本"都是 0）；真正的风险来自**本轮新增的异步 decode 回调**，已用令牌绑定"当前这次 name" | 单测「换图后旧资源的解码回调无权把新选择标成 ready」+ 场景 4「晚到的旧图片不会覆盖新选择」 |

附带查清的两件事（**不是**本轮问题，未改）：

1. headless Chromium 在 313–348ms 就把 16 张 `loading=lazy` 人物图全请求了（此时 picker 在 y=2264、视口 844）。DOM 标注正确，属该浏览器/环境未按距离阈值延后，修复前后一致 → 记为观察项。
2. 报告页整体 CLS=0.49458，来源是 `FOOTER.site-footer`（t=229ms，远早于配图 t=2028ms），属报告流式渲染的既有问题，与本轮无关。

## 3. 改动

`frontend/src/components/IllustrationFrame.vue`（唯一功能改动，+103 / −5 行）

1. **状态机**：`loading / ready / fallback` 暴露为 `data-artwork-state`（与既有 `data-artwork-source` 同一约定，便于验收与断言）。
2. **解码后淡入**：`load` 后 `img.decode()`，解决后才置 `ready`；CSS 为
   `.illustration-frame > img { opacity: 0 }`、`.is-revealed { opacity: 1; transition: opacity 200ms ease-out }`。
   `transition` 只写在显示态 → 换图时**瞬间隐藏**（不让旧画面留在台上），出现时才是淡入；只改不透明度，无缩放/位移/模糊/骨架屏/转圈。
3. **缓存命中直出**：挂载与换名后 `nextTick` 检查 `img.complete && naturalWidth > 0`，命中直接显示，不走淡入、不闪占位（实测占位窗口 0.0ms）。
4. **竞态与失败**：`ticket` 令牌 + 回调内记下的 `name` 双重校验，旧资源的 `load`/`error`/decode 回调无权改写新选择；`error` 或 decode 失败立即退出 loading 交回兜底 SVG；`decode()` 超过 500ms 未落地也会退出（避免内容长期空白）；`onBeforeUnmount` 置 `disposed` 并清定时器。
5. **reduced motion**：`@media (prefers-reduced-motion: reduce)` 下显示态 `transition: none`，解码完成即直接显示。
6. **不加背景色块**：占位沿用页面/父容器自身的低对比底色（透明人物不会出现矩形色块），因此最终态与修复前像素一致。

配套改动：

- `frontend/src/components/illustrationFrame.spec.ts`（新增，6 例）：加载→解码→ready；解码失败→兜底→换图恢复；旧回调不得改写新选择；缓存直出且不重复解码；decode 不落地的兜底；卸载后旧回调与定时器不再改状态。
- `scripts/browser-verify-image-loading.py`（新增）：本文全部浏览器证据的生成脚本。
- `scripts/browser-verify-atelier.py`（+3 行）：截图前等淡入结束（否则会拍到半透明中间帧，把过渡误记成"图片没显示"）。
- 证据目录：`docs/optimization/verification/2026-09-18-image-loading/{before,after,atelier-regression}/`。

## 4. 验证

### 4.1 方式

```powershell
cd frontend; npm.cmd run build; cd ..
python scripts/browser-verify-image-loading.py                                   # after 证据
$env:TYPEME_LABEL='before'; $env:TYPEME_DIST="$env:TEMP\typeme-dist-baseline"    # 修复前基线快照
$env:TYPEME_PORT='5197'; python scripts/browser-verify-image-loading.py
python -m http.server 5178 --directory frontend/dist --bind 127.0.0.1            # 独立回归
$env:TYPEME_BROWSER_EVIDENCE='docs/optimization/verification/2026-09-18-image-loading/atelier-regression'
python scripts/browser-verify-atelier.py
```

- 隔离构建：`frontend/dist`（before 用的是修复前同一构建的快照副本）；API 全部由同源静态服务器模拟（**不装 Playwright 路由**，否则浏览器 HTTP 缓存不按真实规则工作，"缓存命中"测不出来）。
- before/after 使用**同一份脚本、同一组延迟规则**（主图与默认人物图各延迟 1.8s，快速切换场景 INTJ 延迟 2.5s），可比。
- 每个场景都有：状态机变化序列（`traces-*.json`，60fps 采样）、容器盒子范围、CLS 及其来源节点、服务器请求日志、截图；冷缓存与快速切换各录一段 webm。

### 4.2 结果

**120 项判据：修复前 PASS 91 / FAIL 29 → 修复后 PASS 120 / FAIL 0。**
修复前的 29 项失败全部落在"没有加载态/没有过渡/没有 ready 状态"这一类（`state=None`、`opacity=1`、中间帧 0、`transition=all 0s`），无一项与本轮改动无关。

冷缓存 + 慢网首屏（320/390/1440，主图延迟 1.8s、缓存禁用）：

| 判据 | 修复前 | 修复后 |
| --- | --- | --- |
| 主图未到时状态 | 无（`state=None`） | `loading`，`opacity=0` |
| 淡入中间帧 | 0 帧 | 9 / 9 / 7 帧 |
| 过渡属性 | `all 0s` | `opacity 0.2s` |
| 数据到达 → 完全显示 | 到达即完整（截图 alpha 1.000） | t=1.882s → 1.900s 起淡入 → 2.099s 完成（alpha 0.540 → 1.000） |
| 图片容器尺寸变化 | 0px | 0px |
| 图片相关 CLS | 0 | 0 |
| 正文/按钮可用、无整页遮罩 | 通过 | 通过 |

主图 390 宽完整淡入序列（`after` / `cold-slow-390`，每帧约 17ms）：
`t=1882ms nw=960 opacity=0（loading）` → `1900 opacity=0` → `1916 0.13` → `1933 0.26` → `1949 0.38` → `1965 0.49` → `1982 0.59` → `1999 0.68` → `2015 0.77` → `2032 0.84` → `2049 0.91` → `2066 0.96` → `2082 0.99` → `2099 1`。

其余场景（修复后全部通过）：

- **缓存命中**（390/1440，同文档离开首页再回来）：占位窗口 0.0ms、中间帧 0、**未重新下载主图**（请求数 4→4、5→5）→ 命中缓存既不演动画也不闪占位。
- **图片失败**（390，`type-infp` 返回 404）：`state=fallback`、失效 `img` 移除、兜底 SVG 顶上、请求 1 次不重试、换 ENFP 立刻恢复、正文与按钮不受影响、无图片相关位移。
- **快速连续切换**（390/1440，INTJ 延迟 2.5s 连点 INTJ→ESFP→INTP→ENFP）：最终 `type-enfp` ready、位图/标题/选中态三者一致；"可见插画属于当前选择"不一致样本 0；晚到的 INTJ 可见样本 0。
- **减少动画偏好**（390）：`matchMedia` 生效、显示态 `transition: none`、首个完全不透明样本已 `naturalWidth=960`、中间帧 0（修复前同项为 `naturalWidth=0`，即"可见"与"已解码"毫无关系）。
- **报告配图**（390）：`loading→ready`、9 中间帧、`[data-report-character]` 177px 与人物 144px 恒定、图片来源位移 0；报告页整体 CLS 0.49458 来源为 `FOOTER.site-footer`（与本轮无关，见第 2 节）。
- **独立回归**：`browser-verify-atelier.py` **265 项全部通过**（首页/测评列表/方法页/登录/注册/找回/报告，320/390/1440，16 型人物逐一切换、TIED 报告不给任意人物、缺失图不产生 404 请求）。
- **单元测试与构建**：`npm.cmd run typecheck` 通过；`npm.cmd test` 44 文件 977 例全通过（含新增 6 例）；`npm.cmd run build` 成功（CSS 88.12→88.34 kB，JS 644.09→645.20 kB）。

### 4.3 产物

- `before/`、`after/`：各 14–15 张截图（`cold-{320,390,1440}-{loading,fade-1,fade-2,after}`、`cache-*`、`failure-390-fallback`、`switch-*-final`、`report-390-portrait`、`reduced-390-after`）、`video/*.webm`（冷缓存淡入与快速切换各一段）、`summary-{before,after}.json`（120 项判据原文）、`traces-{before,after}.json`（逐帧状态）。
- `atelier-regression/`：265 项独立回归的截图与 `atelier-checks.json`。
- 静态截图用于证明"占位不塌陷、同一时刻的状态差异"；平滑度由逐帧不透明度序列 + webm 证明（对同一时刻截图做最小二乘拟合：修复前 alpha=1.000，修复后 alpha=0.357–0.578，即正好抓到淡入中间态；最终态两版差异 0.00%）。

## 5. 未覆盖与风险

1. 只在 Playwright 自带 headless Chromium 验证，未在 Firefox/Safari 与真机验证 `img.decode()` 行为差异；代码对无 `decode` 的浏览器走同步分支，并对 decode 不落地加了 500ms 兜底。
2. "慢网"是服务端对指定图片延迟 1.8s，不是真实 3G 抖动；同一延迟同时施加于 before/after，对比有效，但不能替代真机弱网验证。
3. 16 张人物图在 headless 下仍于启动阶段被请求（DOM 均为 `loading=lazy`）。若要在真实浏览器确认按距离延后，需要真机复测；本轮未改加载策略，也未新增预加载。
4. 报告页整体 CLS 0.49（页脚/导航流式渲染）是既有问题，本次未修。
5. 分享图导出走 canvas、与 DOM 图片无关，未纳入本轮；后台管理页无插画消费者。
6. webm 为 headless 录制（无声、视口尺寸），仅作过渡证据，不作为视觉定稿。
