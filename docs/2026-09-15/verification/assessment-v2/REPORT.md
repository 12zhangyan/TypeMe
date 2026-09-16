# TypeMe 可信度调整 · 浏览器验收记录

- 被测地址：http://127.0.0.1:5173
- 内容路径：服务端 v2 内容包 API
- 浏览器：Playwright + Chromium（headless）
- 视口：390×844、320×568、768×1024、1440×900、844×390 横屏、195×422（模拟 200% 缩放）

## 断言结果

- 通过：906 条；失败：0 条

## 产物

- `10-landing-mobile.png`（167681 bytes）
- `10-landing-narrow320.png`（37611 bytes）
- `10-landing-pc.png`（110644 bytes）
- `10-landing-tablet.png`（86943 bytes）
- `20-quiz-mobile-q1.png`（156161 bytes）
- `21-quiz-mobile-help-open.png`（185929 bytes）
- `22-quiz-mobile-mixed.png`（160209 bytes）
- `30-result-undetermined-mobile.png`（203679 bytes）
- `30-result-undetermined-pc.png`（96132 bytes）
- `31-share-undetermined-pc.png`（161318 bytes）
- `32-result-partial-mobile.png`（185006 bytes）
- `32-result-partial-pc.png`（98715 bytes）
- `33-share-partial-pc.png`（161083 bytes）
- `34-result-typed-mobile.png`（257747 bytes）
- `34-result-typed-pc.png`（111364 bytes）
- `35-share-typed-pc.png`（169042 bytes）
- `36-result-boundary-after.png`（98715 bytes）
- `37-result-all-unknown-mobile.png`（197895 bytes）
- `38-result-mixed-desktop.png`（93783 bytes）
- `40-about-desktop.png`（109918 bytes）
- `41-quiz-landscape.png`（21700 bytes）
- `50-packaged-landing-8082-pc.png`（117928 bytes）
- `share-export-INFP-1080x1920.png`（285561 bytes）
- `share-export-partial-1080x1920.png`（280107 bytes）
- `share-export-undetermined-1080x1920.png`（276584 bytes）

## 备注

- 均衡（未定）：导出 share-export-undetermined-1080x1920.png（276584 bytes，建议文件名 typeme-profile-undetermined.png）
- 部分未定：导出 share-export-partial-1080x1920.png（280107 bytes，建议文件名 typeme-profile-partial.png）
- 完整参考组合：导出 share-export-INFP-1080x1920.png（285561 bytes，建议文件名 typeme-profile-INFP.png）
- 隐私检查：45 个请求，全部 GET，无第三方主机，无 answers/responses 载荷

- 本轮验收覆盖开发方案 §10.3 / §10.4 的浏览器条目：全中立无默认类型、全部无法判断、部分维度不足、边界改答只影响一维、帮助展开不改变答案、混合数字与无法判断的刷新恢复、三类真实导出图、手机/PC 主流程、无横向溢出、无答案外发。
- **未验证**：iOS Safari / Android Chrome **真机**（本机没有真机与对应内核）；微信等内置浏览器未测；未做 Lighthouse 分数类评估。
- 截图与导出图只证明工程行为与版式，不构成任何心理测量结论。
