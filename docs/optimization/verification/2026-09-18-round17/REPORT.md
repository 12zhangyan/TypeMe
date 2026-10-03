# 真实浏览器验收：第 17 轮（假冲突 / 会话失效 / 交卷响应丢失 / 删除失败 / 404 / 比较换选）

- 被验收地址：`http://127.0.0.1:5175`
- 使用账号：`r17_14322dbc`（密码为脚本生成的合成值，未记录）
- 报告数：2
- 结论：**PASS**（PASS 58 / FAIL 0 / SKIP 0）

## 故障注入（响应是造的，请求时序与页面渲染是真的）

- 保存请求返回 401（Playwright 路由注入）
- 交卷请求送达后端但响应被丢弃（Playwright route.fetch + abort）
- 删除报告返回 500（Playwright 路由注入）

## 观察记录

- 本次作答选了第 5 档，实际点击 47 次
- 320px reports 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 92x19
- 390px reports 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 1440px reports 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 320px compare 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 92x19
- 390px compare 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 1440px compare 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 320px report-detail 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 92x19
- 390px report-detail 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 1440px report-detail 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22
- 320px 答题页 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 92x19
- 390px 答题页 顶栏文字链接高度 <24px：TypeMe 十六型人格参考 203x22

## 说明

- 本脚本跑在一次性内存库后端上（`TYPEME_AI_MOCK_MODE=true`），不碰任何既有数据库、不调用真实模型。
- 第 2/3/4 节用了 Playwright 路由注入：**注入的那几个响应是造的**，
  其余断言（页面文案、列表是否被顶掉、URL 是否落到报告、删除后行数）都是真实数据流的结果。
- 断言的是页面上真实出现的东西（`data-*` 钩子与文案）与真实 URL，不读内部 state。

## 判据

- 横向溢出：`documentElement.scrollWidth - clientWidth ≤ 1`，并列出越过右边界的元素；
- 控件尺寸：`button / [role=radio] / select / textarea / input` 在 ≤390 宽要求 ≥44×44、
  1440 宽按 WCAG 2.5.8 要求 ≥24×24（**与第 16 轮 `browser-verify-visual-v2.py` 同一口径**）；
- 纯文字链接不计入该判据（WCAG 2.5.8 对「尺寸由文字决定」的目标有豁免）；
  顶栏里高度 <24px 的文字链接只作为**观察记录**列出来，见下方「观察记录」与被记入 backlog 的 A54；
- 假冲突：连点两档后不许出现 `[data-conflict-banner]`，且刷新后第 1 题必须是最后点的那一档；
- 会话失效：401 之后用户必须在**能走通**的位置（登录页，且带 `redirect` 回到原页）；
- 交卷响应丢失：URL 必须落到 `/reports/{id}`；
- 删除失败：列表行数不变、不出现「记录没能载入」、不出现冲突横幅；
- 404：出现「这份报告打不开了」，**不出现**「还没有报告可看」；
- 比较页换选：旧 `[data-compare-result]` 与 `[data-compare-subject]` 必须同时消失。

## 截图

- `390x844-assess-rapid-two-taps.png`（连点两档 / 无横幅）
- `390x844-assess-after-reload.png`（刷新回到第 1 题，仍是最后点的那一档）
- `390x844-assess-save-401-to-login.png`（保存 401 → 登录页）
- `1440x900-report-after-lost-submit.png`（交卷响应丢失后仍然进到报告）
- `390x844-report-not-found.png`（404 说的是「这份报告打不开了」）
- `390x844-compare-subject.png` / `390x844-compare-cleared.png`（表头写明比的是哪两份 / 清空后旧表消失）
- `390x844-reports-delete-failed.png` / `390x844-reports-after-delete.png`（删除失败与成功）
- `{320x568,390x844,1440x900}-{reports,compare,report-detail}.png` 与 `{320x568,390x844}-assess.png`（三视口布局）

### 前后对照（同一批页面，第 16 轮之前 vs 本轮）

- `verification/2026-09-18-visual-v2/390x844-reports-after-ai.png` → `390x844-reports.png`（历史列表）
- `verification/2026-09-18-compare-after-visual/21-compare-result-390.png` → `390x844-compare-subject.png`（比较页多了表头）
- `verification/2026-09-18-flow-after-visual/30-report-detail-390.png` → `390x844-report-detail.png`（报告详情）
- 本轮新增的失败态没有「之前」的截图：它们在第 17 轮之前**没有对应的界面**
  （删除失败会把列表顶掉、404 会说「你还没做完」、会话失效只有一个重试按钮），
  所以这几张只能作为「修好之后长什么样」的证据，不存在修之前的同框对照。

## 本轮诚实交代

- 脚本第一版把**纯文字链接**也按 44×44 量，于是 11 条判据全红（`跳到主要内容 1x1`、品牌链接 92x19 等）。
  那不是产品缺陷，是**我的判据比第 16 轮宽**：已改回与第 16 轮相同的选择器，
  并把顶栏文字链接的实测值改成观察记录 + backlog A54（下面那条）。
  **改判据这件事本身也记在这里**，因为它同样能「把红灯变绿」。
- A54 的实测值（翻看历史时顶栏被压缩的状态）：`关于 24x16`、`首页 27x22`；
  在本轮新脚本里顶栏各链接是 44 高、只有品牌链接 19–22 高。两组数字都来自真实测量，
  差别在于**量的是顶栏的哪个状态**（压缩后 / 展开时），我没有把两者混为一谈。
- 保存 401 那条：**页面内**的「登录后接着答」在真实浏览器里通常看不到 ——
  App 层的会话失效桥会先把用户送到登录页（带 `redirect` 回到原页）。
  本轮把**实际发生的那条路**验了（送登录页 + 回跳成功），页面内那条分支只有组件测试。
- AI 只验了 mock 适配器；本轮的 AI 相关断言只有一条（离开报告页后不残留轮询）。
