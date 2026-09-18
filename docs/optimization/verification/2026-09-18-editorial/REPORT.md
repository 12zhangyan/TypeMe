# 编辑式视觉重做 · 2026-09-18

用户认为上一轮仍在原页面上微调，明确要求以美观为优先，大幅改变版式。本轮沿用已确认的暖白与森林绿，重做首页结构和视觉语言。

## 设计与实现

- 首页重写为编辑式封面：大尺度宋体中文、斜体品牌字标、交叠立体环、本地 SVG 材质渐变、图注与印章。主入口保留可访问名称与焦点移交。
- 两类测评从并排卡片改成横向专题，图文交错；手机改为纵向封面。真实名称、题数、补充题、耗时仍取目录。
- 新增深绿宣言章节与大字品牌页脚，形成页面节奏。
- 登录、注册、恢复改成左侧视觉说明与右侧表单；手机按阅读顺序堆叠。注册成功与恢复成功保持独立完成态。
- 答题页以纸页题卡、明确的五档选择、简洁进度构成；十六型即时预览默认折叠，大五导航与正文对齐。
- 大五报告改成个人档案封面与五个编号章节；十六型报告重做类型排版与档案抬头。内容、计分与不确定性语义保持。
- 没有新增依赖、远程图片或远程字体，图形使用仓库本地 SVG；正文继续使用无衬线字体，展示标题使用系统宋体回退。

## 验证

- `node node_modules/vitest/vitest.mjs run`：最终 38 文件、901 项通过。
- 最后调整期间额外聚焦对比度、两类答题、十六型报告：117 项通过。
- `npm.cmd run build`：vue-tsc + Vite 通过，136 modules。最终资源 `index-BOdhD4D_.css` / `index-C6Ruf-KL.js`。
- `python scripts/browser-verify-readable.py`：131 项通过。
- `python scripts/browser-verify-visual.py`：105 项通过。
- 上述两个浏览器脚本设置 `TYPEME_BROWSER_EVIDENCE=docs/optimization/verification/2026-09-18-editorial`，避免覆盖上一轮证据。
- Chromium 320 / 390 / 1440：首页、发现页、登录/注册/恢复、两类答题、新旧报告、平分、AI 关闭/失败/无结果、保存失败/重试、目录和详情键盘操作、主要点击区、无横向溢出。
- 实际截图复核发现并修复：320px 主图越界；注册/恢复的嵌套结构导致桌面单侧堆叠。为后者补充了桌面图文与表单并排的位置检查。
- `git diff --check -- frontend/src scripts/browser-verify-readable.py scripts/browser-verify-visual.py`：无 whitespace 错误，只有仓库既有 CRLF 提示。

## 直接查看

- [前后同尺寸对比](before-after.png)
- [新版首页封面](home-cover.png) / [首页全长](home-1440.png) / [手机首页](home-390.png)
- [登录](login-1440.png) / [注册](register-1440.png) / [恢复](recover-1440.png)
- [十六型答题](answer-jung-320.png) / [大五答题](answer-1440.png)
- [十六型报告](jung-v2-390.png) / [大五报告](bigfive-1440.png)

## 边界

浏览器运行真实生产前端产物，报告来自生产计分器生成的合成夹具，所有 API 拦截模拟，包括保存和会话。证据支持页面与客户端行为，不代表真实数据库、登录或 AI 服务验收。本轮不修改计分、后端或数据库，未调用真实 AI，未提交或部署。字体在不同设备可能有系统回退差异；本轮截图来自 Windows Chromium。
