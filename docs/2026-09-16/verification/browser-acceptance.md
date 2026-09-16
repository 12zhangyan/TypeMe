# TypeMe 浏览器验收报告（真实浏览器截图 + 走查）

- 验收日期：2026-09-16
- 被测地址（base URL）：`http://127.0.0.1:8099`（Vue 3 SPA，hash 路由；实际页面形如 `http://127.0.0.1:8099/#/assess`）
- 后端：Spring Boot，与前端同源（`frontend/dist` 打进同一端口），验收期间实测 `GET /` 返回 200
- 浏览器：Google Chrome 144.0.7559.60（CDP Protocol 1.3，V8 14.4）
  - User-Agent（CDP `Browser.getVersion` 实测）：`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36`
  - 截图方式：CDP `Emulation.setDeviceMetricsOverride` 设定视口 + `Page.captureScreenshot`（`deviceScaleFactor=1`），全部为真实浏览器截图，未做任何合成/占位图
- 使用的视口：`320 x 720`、`390 x 844`、`1440 x 900`
- 本次使用的临时账号（一次性，通过 UI 注册）：`shot_890012` / `Shot-Passw0rd!2026`
- 实测产生的关键 ID：
  - 测评 attempt：`c2fb5f53-b93b-4aa9-a1dc-5e047d2535d3`
  - 报告 reportId：`4b2fe73f-54ea-31a4-b3c9-2da842540128`
  - 内容包：`typeme-jung48-zh-v1`（`GET /api/v3/catalog/current` 返回 `title=十六型人格参考测评`、`questionCount=64`、`basePerDimension=12`、`clarificationPerDimension=4`）
  - 报告结果：`REFERENCE` / `本次参考类型 ENFP 追风者`

> 说明（环境事件）：验收进行到一半时，后端被运维侧重启为**全新空库**（`typeme_e2e`）。第一次跑出来的账号/进度/报告全部失效，因此**整个流程已在重启后的环境上完整重跑一遍**，本报告中的截图与 ID 全部来自重跑后的这一次。

## 截图清单与逐步骤结果

| # | 步骤 | 路由 | 截图文件 | 截图内容（实测） | 结论 |
|---|------|------|----------|------------------|------|
| 1 | 首页 / 落地页 | `#/` | `01-landing-1440.png`、`01-landing-390.png`、`01-landing-320.png` | 未登录态首页：顶栏 `TypeMe / 大五人格倾向自测` + `开始测评 / 关于 / 登录 / 注册`；主标题「了解你的偏好，也保留还不确定的部分。」；主按钮「开始测评（50 题）」；说明块、五维示意、题目版本、常见问题、页脚署名 | 通过（存在文案/量表不一致，见问题 1） |
| 2 | 注册表单已填写 | `#/register` | `02-register-filled-1440.png` | 表单标题「注册」，4 个输入框（用户名 / 昵称（可不填）/ 密码 / 再输一次密码）均已填入，`创建账号` 按钮由禁用变为可点 | 通过。**实测该表单没有任何勾选框、也没有免责声明文案**（见「未能验证的部分」） |
| 2b | 注册成功后的恢复码屏 | `#/register`（同页换屏） | `03-register-recovery-codes-1440.png`、`03b-register-recovery-checked-1440.png` | 8 个恢复码列表 + 「只显示这一次」提示；`03b` 为勾选「我已经把这 8 个恢复码抄下来…」之后的状态 | 通过。勾选前底部按钮 `disabled=true`，勾选后 `disabled=false`（实测） |
| 3 | 登录后状态（账号页） | `#/account` | `04-post-login-account-1440.png` | 顶栏出现 `shot890012` 与 `退出`，「账号与数据」页：账号信息（用户名 `shot_890012`、登录状态 已登录）、昵称、修改密码、恢复码、导出数据、删除数据 | 通过 |
| 4 | 测评页（题目可见） | `#/assess/c2fb5f53-…` | `05-assess-q1-1440.png`、`05-assess-q1-390.png`、`05-assess-q1-320.png` | 左栏 `主测 0 / 48`、第 1 题 / 共 48 题、保存状态、四维即时预览；题卡 `EI · 精力方向`、情境「活动之后的精力」、左右两侧陈述、五档按钮（1 很像左边 … 5 很像右边）、`这题我说不好`、`上一题/下一题` | 通过（320 宽度下首屏截断与文案不一致见问题 1/3/4） |
| 5 | 连答数题、进度可见 | `#/assess/c2fb5f53-…` | `06-assess-progress-6of48-1440.png` | 左栏变为 `主测 6 / 48`、`第 7 题 / 共 48 题`、`已保存`，进度条推进，即时预览显示「精力方向：目前偏向 E / 信息取向：目前偏向 N / 决策依据：目前偏向 F / 生活节奏：目前两边差不多」 | 通过 |
| 6 | 答完主测后的复核 / 覆盖页 | `#/assess/c2fb5f53-…` | `07-review-clarify-offer-1440.png`、`07-review-clarify-offer-390.png` | `主测 48 / 48` 后出现复核屏「主测答完了，这几维还需要再问几题」，说明「生活节奏这一维两边差不多，再问几题才能看出方向」，提供 `开始补充题（4 题）` 与 `跳过补充题，直接交卷` | 通过 |
| 7 | 生成的报告页顶部（含类型码） | `#/reports/4b2fe73f-…` | `08-report-top-1440.png`、`08c-report-top-390.png`、`08c-report-top-320.png`、`08b-report-fullpage-1440.png`（全页 1424x4457） | 大标题「本次参考类型 ENFP 追风者」+ `参考类型` 眉标 + 类型名「追风者」+ 摘要，下面接「四个维度各自落在哪里」 | 通过 |
| 8 | 报告页向下滚动（详细章节） | `#/reports/4b2fe73f-…` | `09-report-scroll1-1440.png`、`09b-report-scroll2-1440.png`、`09c-report-bottom-1440.png`、`09d-report-scroll-390.png`、`09d-report-scroll-320.png` | 四维得分条与位置点、边界说明、「这一型的读法」（八段解读）、「可以试试」、「你自己的理解」表单、「带走这份报告」（复制文字 / 导出分享图）、「这份报告是怎么来的」与页脚固定声明 | 通过（页脚署名与实际量表不符，见问题 2） |
| 9 | 历史报告列表 | `#/reports` | `10-report-list-1440.png`、`10-report-list-390.png`、`10-report-list-320.png` | 「你的测评记录」，1 条记录：`ENFP` + `参考类型` 徽标 + 时间 `2026年9月16日 12:44` + 摘要 + `打开报告 / 删除` | 通过 |

三档宽度覆盖情况（任务要求 landing / assess / report 至少三档）：首页 `01-landing-{1440,390,320}.png`、测评页 `05-assess-q1-{1440,390,320}.png`、报告页 `08-report-top-1440.png` + `08c-report-top-{390,320}.png`，均已覆盖。

## 实测发现的界面问题

> 判定口径：本会话的模型**不具备读图能力**，因此下面每一条都不是"凭图观感"，而是**在截图同一渲染状态下**用 Chrome 实际布局盒模型（`getBoundingClientRect`）、计算样式（`getComputedStyle`）与 console / network 事件测出来的确定值；每条都给出可对照的截图文件名。

### 问题 1：首页主按钮标称「50 题（大五）」，点进去实际是「十六型 64 题」量表

- 实测：首页主按钮文案为「开始测评（**50 题**）」，其链接为 `#/assess`（实测 `a[href="#/assess"]`）；而 `#/assess` 创建的这次测评，服务端内容包是 `typeme-jung48-zh-v1`（`GET /api/v3/catalog/current` 返回 `title=十六型人格参考测评`、`questionCount=64`、`basePerDimension=12`），答题页显示的是 `主测 0 / 48`、题卡维度 `EI · 精力方向`，与"大五 / 50 题 / 五个维度"完全不是一回事。
- 首页自己的「题目版本」区块也在宣传「大五人格 50 题（五个维度 · 50 题）」「快速版 32 题（四个维度 · 32 题）」——那两块是旧引擎（本地计分）的量表，和新测入口不是同一套题。
- 可对照截图：`01-landing-1440.png`（按钮文案「开始测评（50 题）」）、`05-assess-q1-1440.png`（`主测 0 / 48` + `EI · 精力方向`）。
- 代码位置（仅定位，未修改）：`frontend/src/views/LandingView.vue` 第 368–372 行把按钮指向 `/assess`，题量取自旧内容包；`frontend/src/App.vue` 第 61–66 行的副标题同样取自旧内容包。

### 问题 2：报告页的署名 / 归属与实际产出量表不一致（ENFP 报告署名 IPIP 大五）

- 实测：这次报告是 `typeme-jung48-zh-v1` 产出的十六型结果（`本次参考类型 ENFP 追风者`），但同一页顶栏写的是「**大五人格倾向自测**」，页脚署名写的是「题目基于 International Personality Item Pool (IPIP) — Goldberg's Big-Five Factor Markers（Lewis R. Goldberg / IPIP），依 Public Domain 使用。**中文题面为本项目自写候选稿；IPIP 量表属公有领域，不隶属任何商业人格测评机构**」。
- 也就是：一份十六型（ENFP）报告的正式署名，指向的是另一套量表。这对"署名/许可"这类必须准确的信息来说是真问题，不只影响观感。
- 可对照截图：`08-report-top-1440.png`（顶栏「大五人格倾向自测」+「本次参考类型 ENFP 追风者」）、`09c-report-bottom-1440.png`（页脚 IPIP 署名）、`10-report-list-1440.png`（列表页页脚同样是 IPIP 署名）。
- 与问题 1 同源：壳层署名/副标题取自旧内容包，而不是本次真正跑的量表。

### 问题 3：多处小字号辅助文字对比度低于 WCAG AA 4.5:1（实测计算值）

以 `text-ink-faint`（计算色 `rgb(124, 136, 146)`）打在 `rgb(247,246,242)` / `rgb(255,255,255)` 背景上，实测对比度只有 **3.35:1 ~ 3.62:1**，低于小字号正文 4.5:1 的门槛：

| 位置 | 字号 | 实测对比度 | 可对照截图 |
|------|------|-----------|------------|
| 顶栏副标题「大五人格倾向自测」 | 11.5px | 3.35 | `01-landing-1440.png`、`05-assess-q1-1440.png`、`08-report-top-1440.png`、`10-report-list-1440.png` |
| 测评页「左边这一侧 / 右边这一侧」 | 12px | 3.62 | `05-assess-q1-1440.png`、`05-assess-q1-320.png` |
| 测评页题卡右上「安排周末/任务的方式」 | 12.5px | 3.62 | `05-assess-q1-1440.png` |
| 测评页「这也是一次作答：不计分…」 | 12.5px | 3.62 | `05-assess-q1-1440.png` |
| 报告页「中点」 | 11.5px | 3.62 | `08-report-top-1440.png`、`09-report-scroll1-1440.png` |
| 报告页「可计分 12 题（主测 12 · 补充 0）」 | 12.5px | 3.62 | `08-report-top-1440.png`、`09-report-scroll1-1440.png` |
| 历史列表时间「2026年9月16日 12:44」 | 13px | 3.62 | `10-report-list-1440.png` |
| 页脚「结果仅供自我了解与娱乐参考…」 | 12px | 3.09 | `10-report-list-1440.png`、`09c-report-bottom-1440.png` |

- 需要说明的是：这些是"按 WCAG 公式算出来的确定值"，不是我觉得它难看；是否要改属于产品取舍（辅助文字降一级对比度本身是有意的视觉层级），但值确实没到 AA。

### 问题 4：320x720（以及 390x844 的主动作）首屏放不下答题操作区

同一题在 scrollY=0 时的实测盒模型：

| 视口 | 五档按钮（`[data-rating="1"]`） | `这题我说不好` | `下一题` |
|------|------------------------------|----------------|----------|
| 320 x 720 | top=676，bottom=**761**（视口高 720，**底部被切掉 41px**） | top=**773**（在首屏之外） | top=**1042**（在首屏之外） |
| 390 x 844 | top=676，bottom=761（完整可见） | top=773，bottom=817（可见） | top=**1022**（在首屏之外） |
| 1440 x 900 | top=272，bottom=346 | top=358，bottom=402 | top=524，bottom=572（都在首屏内） |

- 结论：桌面端一屏内可完成"读题—选档—下一题"；**320x720 上连五档按钮都只露出上半截**，`这题我说不好` 与 `下一题` 都要滚动才够得到；390x844 上五档可见，但主动作 `下一题` 仍在首屏之外（页面可滚动，`documentElement.scrollHeight=1154`，所以是"要点滚动"，不是"点不到"）。
- 可对照截图：`05-assess-q1-320.png`（选项行贴着视口底边被截断）、`05-assess-q1-390.png`。

### 问题 5：320px 宽度下 sticky 顶栏吃掉约 19% 首屏高度

- 实测 `header` 高度：`1440x900` → 69px；`390x844` → 90px；**`320x720` → 138px**（导航换行成两行，`nav` 本身 92px），而它是 `position: sticky; top: 0; z-index: 30`，滚动时始终占位。
- 在 320x720 上 138px 相当于首屏高度的 19%。首页本身没问题，但在本就吃紧的 320 宽度上叠加问题 4，会进一步压缩答题区。
- 可对照截图：`01-landing-320.png`（顶栏两行导航）、`05-assess-q1-320.png`。

### 复查过但**没有**发现问题的项（实测通过，避免误报）

- **无横向滚动**：`320x720` 下 `documentElement.scrollWidth = 305 = clientWidth`，`390x844` 下 `375 = 375`，均无横向溢出；越界元素扫描（元素 `right > innerWidth`）结果为 0。
- **无破图**：所有页面 `document.images` 中 `naturalWidth === 0` 的数量为 0。
- **无文字互相压盖**：排除"sticky 顶栏压住滚到其下方的正文"（该顶栏为 `bg-paper/90 + backdrop-blur-sm`，属分层设计）与多行 `inline` 元素的并集矩形之后，各页面文本两两相交数为 0。
- **无 console 报错、无失败请求**：对 7 条路由（`#/`、`#/register`、`#/login`、`#/reports`、`#/reports/:id`、`#/assess/:id`、`#/account`）各做一次真正的整页加载，累计 `Runtime.consoleAPICalled(error/warning)`、`Runtime.exceptionThrown`、`Log.entryAdded(error/warning)`、`Network.loadingFailed`、HTTP >= 400 的事件数为 **0**。
- **无过小的可点区域**：宽度 < 24px 的可交互元素只有类名为 `skip-link` 的「跳到主要内容」（1x1，聚焦时才显形的无障碍跳转链接），属正常实现。
- **禁用态逻辑正确**：注册表单在填齐前 `创建账号` 为 `disabled`，填齐后可点；恢复码屏未勾选时离开按钮 `disabled=true`，勾选后为 `false`（实测）。

## 未能验证的部分

1. **「注册表单需要勾选免责声明」这一条不成立，因此无法验证**。实测 `#/register` 页面 DOM：`input` 共 4 个（`username` / `nickname` / `new-password` / `confirm-password`），`input[type=checkbox]` 数量为 **0**，`label` 只有「用户名 / 昵称（可不填）/ 密码 / 再输一次密码」，页面文案里没有任何免责声明或"我已阅读并同意"字样。我用一个全新账号实测：不勾任何东西即可直接提交并注册成功。可对照截图：`02-register-filled-1440.png`。
2. **图像层面的"肉眼读图"未能完成**。本次模型不支持图像输入（`read_image` 返回 "model does not declare image input"），我尝试用带视觉能力的模型（`deepseek-v4-flash-vision-exp` 等 3 个 provider/model 组合）做截图判读，6 次调用全部失败返回空。因此本报告的缺陷判定全部建立在**真实渲染态的几何/计算样式/对比度测量 + console/network 日志**上；截图是同一渲染状态的实拍，但我不能声称"我从像素上看出来……"。
3. **未验证的流程**（本次没有走到）：`#/recover` 用恢复码重置密码、账号注销、数据导出 JSON、单份报告删除、报告页「保存我的理解」提交、分享图导出（`导出分享图`）、AI 分析/同意流程、旧引擎 `#/quiz`、`#/about`。
4. **报告页未做 320 / 390 的全页截图**：320 下报告页 `scrollHeight = 7381`、390 下 `6540`，全页 PNG 体积会明显偏大（1440 全页已是 455 KB / 4457px 高），因此小屏只保留了视口截图（顶部 + 滚动一屏）。
5. **中途失败的那次"记录没能载入"无法作为缺陷证据**：重启前的那一轮，`#/reports` 曾显示「记录没能载入：没能连上服务器，请检查网络后重试。」。事后确认原因是运维侧在这一刻重启了 8099 的后端（进程启动时间 12:39:45，与失败时刻吻合，且重启后会话失效、`/api/v3/reports` 返回 401 `UNAUTHENTICATED`），属于环境事件而非应用缺陷；该轮截图已被重跑覆盖，无法引用，故不计入缺陷。恢复后同一路径正常（`10-report-list-*.png`，1 条记录）。
6. **未做多设备/多标签页同步冲突（`data-conflict-banner`）与断点续答的跨设备验证**，也未做键盘操作（数字键 1–5 / 方向键）的实测。

## 完成 / 跳过 的步骤说明

**已完成（全部为真实浏览器操作 + 截图）**

1. 首页三档宽度截图（1440 / 390 / 320）。
2. 通过 UI 注册全新一次性账号 `shot_890012`（无勾选任何声明），拿到 8 个恢复码屏，勾选"已抄下"后离开。
3. 登录后状态（`#/account`）截图。
4. 进入 `#/assess` 新建测评（attemptId `c2fb5f53-b93b-4aa9-a1dc-5e047d2535d3`），三档宽度截取题目页。
5. 用真实鼠标点击（CDP `Input.dispatchMouseEvent`）逐题作答：先答 6 题截图留存进度，再答满 48 题主测。
6. 主测答完后的复核 / 覆盖屏（补充题说明）截图。
7. 进入补充题（4 题）作答并交卷，服务端生成报告 `4b2fe73f-54ea-31a4-b3c9-2da842540128`，结果 `REFERENCE / ENFP 追风者`。
8. 报告页顶部（含类型码）、1440 全页、向下滚动两屏 + 滚到底、390/320 视口截图。
9. 历史报告列表（1440 / 390 / 320）截图。
10. 7 条路由的 console / network 错误巡检（0 问题），以及各页面的横向溢出、破图、文本重叠、可点区域尺寸、对比度测量。

**跳过 / 未做**

1. `#/recover` 恢复码重置密码流程。
2. 账号注销、数据导出、报告删除、自我理解保存、分享图导出、AI 分析。
3. 旧引擎 `#/quiz` / `#/result` 与 `#/about` 页面走查。
4. 多设备同步冲突（409 `CONFLICT_REVISION`）与跨设备续答验证。
5. 纯键盘作答路径（数字键 1–5、←/→）的实测。
6. 基于图像像素的视觉判读（能力所限，见「未能验证的部分」第 2 条）。

---

### 附：本次验收用到的检测口径（可复现）

- 视口：`Emulation.setDeviceMetricsOverride(width, height, deviceScaleFactor=1, mobile=false)`；hash 路由下改 hash **不会**重新加载文档，因此需要整页加载的巡检使用「先 `Page.navigate` 到 `about:blank`，再导航到目标 URL」。
- 横向溢出：`document.documentElement.scrollWidth > window.innerWidth + 1`，并逐个元素判断 `getBoundingClientRect().right > innerWidth + 1`。
- 文本重叠：只取叶子文本节点（排除 `display:inline`、排除 `header` 内的 sticky 顶栏），两两求矩形交集，`ox > 3 && oy > 3` 记为重叠。
- 对比度：前景取元素 `color`，背景向上回溯到第一个 `alpha > 0.9` 的祖先背景色，按 WCAG 相对亮度公式计算比值。
- 截图尺寸与体积：25 张 PNG，合计约 2.0 MB，最大单张为 1440 全页报告 `08b-report-fullpage-1440.png`（1424x4457，455 KB）。

---

## 修复后复验（问题 1 / 问题 2）

- 复验日期：2026-09-16（同日晚些时候，紧接着修复提交）
- 被测地址：仍是 `http://127.0.0.1:8099`，**未做任何请求拦截**，页面、API、cookie 全部走真实后端
- 关键前提：运维侧已停服 → `mvn.cmd -o clean package` 重打包 → 重新起服。实测 jar 内前端产物与 `frontend/dist` 同名（`assets/index-B7iHxEtT.js`），`GET /` 返回的 `index.html` 就引用这一份，所以下面读到的是**修复后的真实产物**
- 浏览器：Google Chrome 144.0.7559.60（headless=new），CDP 端口 `9333`、独立临时 profile（验收前半段用的那个 Chrome 实例已被关闭；`browser-use` 守护进程在本机起不来，因此改用自写的 CDP 脚本）
- 复验账号：一次性账号 `fixverify1`（第一轮 `POST /api/v3/auth/register` 已创建；后续轮次为省注册限流额度直接登录）
- 复验产生的报告：
  - `98cf8692-ba17-3d8d-ba10-2f6348169445`（`TIED`，1 个维度并列）— 走完整 UI：`#/assess` 答满 48 题 → 复核屏点 `跳过补充题，直接交卷`
  - `a6a94a6f-1edb-38be-89ac-1f6a2a503417`（`REFERENCE` / `ENFP 追风者`）— 定向作答（按题目 `leftPole`/`rightPole` 每维统一选同一侧），用来确认**结论明确**的报告页文案也正确
- 读取方式：CDP `Runtime.evaluate` 返回 `document.body.innerText` 与定位元素文本。**本次模型同样不具备读图能力**，因此新增的 7 张截图是同一渲染状态的实拍（已核验为真实 PNG：尺寸 1440x900 / 390x844 / 320x720，体积 45–118 KB），但我不能声称"从像素上看出"。

### 修复内容（`frontend/src` 内）

| 文件 | 改动 |
|------|------|
| `frontend/src/stores/instrumentV3.ts` | **新增**。新测量表口径的唯一来源：读 `GET /api/v3/catalog/current`（标题 / 题量 / 维度名 / 时长推算），匿名或离线时退到**新测内置口径**（十六型人格参考测评 / 主测 48 / 题库 64 / 补充 16 / 四个维度），**不会**退回旧内容包 |
| `frontend/src/utils/instrumentNaming.ts` | **新增**。旧引擎量表名 helper（`legacyInstrumentTagline`）与旧引擎路由判定（`quiz` / `result` / `about`） |
| `frontend/src/App.vue` | 顶栏副标题与页脚署名按路由分代：旧引擎页仍跟 `useQuizStore().activePackage`；首页 / `assess` / `reports` / 账号等新站页面改用新测口径 |
| `frontend/src/views/LandingView.vue` | 首屏眉标、引言、事实行、题量口径说明、主按钮、维度示意图改用新测口径；旧版本入口明确标注为另一套量表 |
| `frontend/src/views/ReportV3View.vue` | 报告页「这份报告是怎么来的」加入量表名（来自目录接口），署名段落替换掉 IPIP 大五那套 |
| `frontend/src/components/SharePreview.vue` | 去掉写死的「TypeMe 大五人格倾向自测」，改由当前旧内容包推导（该组件只被旧引擎 `ResultView` 使用） |

### 修复后实测文本（逐条对应问题 1 / 问题 2）

| 位置 | 路由 / 状态 | 实测 `document.body.innerText` | 结论 |
|------|-------------|-------------------------------|------|
| 首页眉标 | `#/`（匿名，`/api/v3/catalog/current` 实测 401） | `十六型人格参考测评 · 主测 48 题 · 约 8–12 分钟` | 问题 1 已修：不再写「大五 … 50 题」；且**离线/未登录时也没有退回旧内容包** |
| 首页事实行 | `#/`（匿名） | `主测 48 道题 · 约 8–12 分钟 · 免费 · 需登录` | 同上；「需登录」纠正了原来"无需登录"的不实说明 |
| 首页题量口径 | `#/` | `题量口径：题库共 64 题 = 主测 48 题 + 最多 16 道补充题。补充题只在你某一维两边差不多时才会出现，也可以跳过。` | 64 题与 48 题的关系写清楚了，不再出现"裸 64 题配 48 题按钮" |
| 首页旧版本入口 | `#/` | `旧版本测试（保留）` + `这里是「大五人格 50 题」，和上面这次主测不是同一份量表：它把结果与进度存在这台设备的浏览器里，不需要登录。…` | 旧站入口保留、且明确标注为另一套量表 |
| 首页主按钮 | `#/` | `开始测评（主测 48 题）`（`data-primary-entry`，链接 `#/assess`） | 问题 1 已修：按钮标称与实际入口一致 |
| 顶栏副标题 | `#/`（匿名与登录各测一次） | `TypeMe` + `十六型人格参考测评` | 问题 1 已修 |
| 顶栏副标题 | `#/reports/98cf8692-…`、`#/reports/a6a94a6f-…`、`#/assess/…` | `TypeMe` + `十六型人格参考测评` | 问题 2 已修 |
| 顶栏副标题 | `#/quiz`、`#/about`、`#/result` | `TypeMe` + `大五人格倾向自测` | 旧引擎未被破坏（见下） |
| 报告页方法节 | `#/reports/a6a94a6f-…`（`REFERENCE / ENFP 追风者`） | `量表：十六型人格参考测评。下面这些版本号与指纹来自报告自己的 methodology 字段；量表名来自 /api/v3/catalog/current（报告正文里不重复下发包标题）。` + `计分版本：typeme-jung48-score-v1` + `内容版本：typeme-type-report-zh-v1（draft_review_pending）` + `内容包：typeme-jung48-zh-v1 · 指纹 939232e360a2…` | 问题 2 已修：量表名 + 版本字段都指向实际产出的内容包 |
| 报告页署名 | 同上，`[data-instrument-attribution]` | `十六型人格参考测评的题目与报告文案为本项目自行撰写；本站不隶属任何商业人格测评机构，也不是任何机构的官方测评。浏览器里那点即时倾向只用于答题时预览，最终结论一律以这份服务端报告为准。` | 问题 2 已修：IPIP / Goldberg 大五的署名已从报告页移除 |
| 报告页全文扫描 | 三份报告（`TIED` ×2、`REFERENCE` ×1） | `/IPIP\|Goldberg\|Big-Five/` → **false**；`/大五/` → **false** | 同上，且并列（`TIED`）与明确（`REFERENCE`）两种结论下都成立 |
| 站点页脚 | 所有新站页面 | `TypeMe · 十六型人格参考测评` + `十六型人格参考测评的题目与报告文案为本项目自行撰写；…` | 问题 2 已修 |
| 站点页脚 | `#/about` | `TypeMe · 大五人格倾向自测` + `题目基于 International Personality Item Pool (IPIP) — Goldberg's Big-Five Factor Markers…依 Public Domain 使用。…答案只在你的浏览器里参与计算。` | 旧引擎未被破坏：`/about` 的 1–3 节本来就是 IPIP/OEJTS 的来源与许可，壳层署名与它自身内容一致 |

### 修复后旧引擎回归（要求：不要破坏旧站）

- `#/quiz`：顶栏 `TypeMe 大五人格倾向自测`，页面 `已处理 0 / 50`、答题卡 1–50 逐题渲染，均正常打开。
- `#/result`：本地没有旧记录时按旧行为回到答题页（页面仍是大五 50 题）。
- `#/about`：顶栏与页脚都是旧量表口径（含 IPIP / Public Domain），正文 `IPIP` 命中、`OEJTS` 未在本页出现。
- 首页下部的「旧版本测试」区块仍然可用，并保留了 `大五人格 50 题` / `快速版 32 题` 的版本选择。

### 本次复验**没有**覆盖的部分（如实列出）

1. **问题 3（对比度）、问题 4（320 首屏放不下答题区）、问题 5（320 顶栏高度）没有复测**：这三条本次没有重新做几何 / 计算样式测量，`11-landing-fixed-320.png`、`13-assess-review-1440.png` 只是同状态的实拍，不构成对 3/4/5 的结论。
2. **首页下部仍由旧内容包驱动**（超出本次修复范围）：`会测到的五个维度`、教学示例、价值观、常见问题、来源与许可明细、旧版本选择器都还是旧包的文案；匿名首页全文扫描仍能命中 `大五` / `50 题`（命中位置都在明确标注为「旧版本测试」的区域及其下方）。**首屏以上已经不再出现这类字样**（`h1` + 眉标 + 主按钮合并扫描 `大五人格倾向自测 · |50 道题|五个维度` → false）。维度示意图（`svg[role="presentation"]`）已改为新测四维（`4 条轨道对应 4 个维度`），不再与首屏文案矛盾。
3. **`frontend/index.html` 的静态 `<title>` 与 `<meta name="description">` 仍是旧文案**（`TypeMe · 大五人格趋势自测（IPIP-50）`）：本次修复被限定在 `frontend/src` 内，该文件在 `frontend/src` 之外，因此未改动。它在 JS 启动后会被路由的 `document.title` 覆盖，但首屏极短一瞬与"分享/爬虫看到的标题"仍是旧的。
4. **不是从像素上判读的**：本模型无图像输入能力，见上文「读取方式」。
5. **未复验**：`#/recover`、账号注销、数据导出、报告删除、自我理解保存、分享图导出（`SharePreview.vue` 的改动只做了单测，没有在浏览器里导出分享图看一眼）、AI 分析流程、纯键盘作答、多设备冲突。
6. **答题过程的一处非缺陷现象**：用 API 写满 48 题后，只在 hash 上改路由（`#/assess/<id>` → 同 URL）不会重新加载文档，页面会停留在旧的内存态（仍显示 `主测 0 / 48`）。`Page.reload()` 后立刻显示 `主测 48 / 48 · 已保存`，说明是 hash 路由的正常行为，不是应用缺陷。

### 复验用到的检测口径（与上文一致，可复现）

- 无头实例：`chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<临时目录>`，`Target.createTarget` + `Target.attachToTarget(flatten)` 后走 `Page` / `Runtime` / `Network` 域。
- 整页加载判定：`Page.navigate` 后轮询 `document.readyState === 'complete'`，再等 1.2–1.4s 让 Vue 渲染与接口回填完成。
- 文本取样：`document.body.innerText.replace(/\s+/g,' ')`，以及 `[data-instrument-kicker]` / `[data-primary-entry]` / `[data-instrument-scope]` / `[aria-labelledby="report-method"]` / `[data-instrument-attribution]` / `header` / `footer` 的定位文本。
- 新增截图：`11-landing-fixed-{1440,390,320}.png`、`12-report-fixed-{1440,390,320}.png`（报告为 `REFERENCE / ENFP 追风者` 那一份）、`13-assess-review-1440.png`（复核屏）。
