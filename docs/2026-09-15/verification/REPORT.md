# TypeMe 浏览器验收记录（本轮实测）

- 被测地址：http://127.0.0.1:5173（Vite dev server（/api/v1 代理到打包 jar 的内容接口））
- 前端：Vue 3 应用；开发服务器会把 /api/v1 代理到 127.0.0.1:8080
- 后端：`java -jar target/typeme-backend-1.0.0.jar --server.address=127.0.0.1 --server.port=8080`
- 浏览器：Playwright + Chromium（headless）
- 视口：390×844、320×568、768×1024、1440×900、1920×1080、844×390 横屏、195×422（模拟 200% 缩放）

## 断言结果

- 通过断言：156 条；失败：0 条

## 截图

- `01-landing-mobile.png`
- `01-landing-narrow320.png`
- `01-landing-pc.png`
- `01-landing-wide1920.png`
- `03-quiz-mobile-q1.png`
- `04-quiz-mobile-card.png`
- `05-quiz-mobile-last.png`
- `06-result-mobile-full.png`
- `07-result-pc.png`
- `07-result-wide1920.png`
- `08-result-balanced-mobile.png`
- `08-result-balanced-pc.png`
- `09-share-preview-mobile.png`
- `10-share-after-download-mobile.png`
- `11-share-preview-pc.png`
- `12-about-mobile.png`
- `12-about-pc.png`
- `13-quiz-landscape.png`
- `14-landing-tablet.png`
- `15-result-tablet.png`
- `16-share-preview-balanced-mobile.png`
- `18-result-sn-boundary-mobile.png`
- `share-export-balanced-1080x1920.png`
- `share-export-infp-1080x1920.png`

## 备注

- 本轮验收同时跑过两条内容路径：**内容服务 API**（页面显示「内容来自服务端」）与**内置副本降级**（停掉内容服务后页面显示「服务端不可用，正在使用内置内容副本」，功能与结果不变）。
- 打包产物 `java -jar target/typeme-backend-1.0.0.jar` 另行验证：`/#/`、`/#/quiz`、`/#/result`、`/#/about`、`/actuator/health` 与四个只读接口均正常。生产构建里 `#/quiz?seed=` 验收种子**已按设计关闭**，所以在打包产物上跑本脚本时，依赖种子的段落会失败；截图与全量断言请用 `npm run dev` 的地址。
- **未验证**：iOS Safari / Android Chrome **真机**（本机没有真机与对应内核）；微信等内置浏览器未测；未做 Lighthouse 分数类评估。
- 刷新恢复：第 5 题 + 1 条作答
- 本轮验收跑在**内容服务 API** 路径
