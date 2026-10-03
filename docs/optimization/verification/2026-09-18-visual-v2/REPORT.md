# 浏览器验收报告 —— 前端视觉重构与 AI 体验（2026-09-18 第 2 轮）

- 被验收地址：`http://127.0.0.1:5175`
- 账号：`visual_4278…`（随机后缀；密码与恢复码不落盘、不入报告）
- 后端 AI：enabled=True mock=True（**模拟适配器**，没有调用真实模型）
- PASS 155 / FAIL 0 / SKIP 0


## 判据

- 每个视口/页面：`scrollWidth - clientWidth ≤ 0`；
- 文字对比度：普通字号 ≥4.5:1、大字号 ≥3.0:1（在渲染结果上量，取最近的不透明背景）；
- 交互控件：≤390 宽要求 ≥44×44，≥768 宽按 WCAG 2.5.8 的 ≥24×24；
- 200% 缩放：`zoom: 2` 与 720px 视口都不许横向滚动；
- reduced-motion：所有 `animation-duration ≤ 0.01s`；
- 键盘：第一个 Tab 是「跳到主要内容」且可见；每一站都有可见焦点环；
- AI：生成前有结构预览、生成前必须显式确认发送范围、进行中不编百分比、结果五段齐全；
- 结果出来与离开页面后各静置 6s：不允许出现新的 `/api/v3/ai/` 请求。

## 失败项

- 无

## 跳过项

- 无

## 实测记录

- 后端 AI 能力：enabled=True mock=True model=deepseek-flash promptVersion=typeme-ai-prompt-v2
- 主测共点击作答 47 次（每题选第 1 档）；脚本自身撞到 409 冲突 0 次
- 报告 id 形如 60c0f824…（UUID，不含个人信息）
- 打开报告页期间的 AI 请求：2 个，全部是读接口=True
- 提交后 AI 相关请求 4 次（含创建与轮询）
- 首页动画元素 1 个（首屏内 1 个），最长动画 14.0s

## 截图

本轮（重构后）：

- `1440x900-home-focus.png`
- `1440x900-home-reduced-motion.png`
- `1440x900-home.png`
- `1440x900-login.png`
- `1440x900-report-zoom200.png`
- `320x568-home.png`
- `320x568-login.png`
- `320x568-reports.png`
- `390x844-account.png`
- `390x844-ai-before.png`
- `390x844-ai-consent.png`
- `390x844-ai-failed.png`
- `390x844-ai-quota-empty.png`
- `390x844-ai-result-problems.png`
- `390x844-ai-result.png`
- `390x844-ai-running.png`
- `390x844-home.png`
- `390x844-login.png`
- `390x844-report-toc.png`
- `390x844-reports-after-ai.png`
- `768x1024-home.png`
- `768x1024-login.png`

重构前对照（上一轮同一批页面的截图，用于前后对比）：

- `docs/optimization/verification/2026-09-17-layout/320x568-home.png`（首页）
- `docs/optimization/verification/2026-09-17-flow/32-assess-320.png`（答题页）
- `docs/optimization/verification/2026-09-17-flow/30-report-detail-390.png`（报告页）
- `docs/optimization/verification/2026-09-17-ai/10-report-before-ai-390.png`（AI 生成前）
- `docs/optimization/verification/2026-09-17-ai/10-ai-consent-390.png`（AI 范围确认）
- `docs/optimization/verification/2026-09-17-ai/11-ai-result-390.png`（AI 结果）

## 复现方式

```powershell
# 一次性内存库 + 模拟 AI（不碰任何既有库、不调用真实模型）
cd backend
$env:JAVA_HOME='D:\develop\jdk-21'
$env:SPRING_DATASOURCE_URL='jdbc:h2:mem:typeme_visual;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1'
$env:SPRING_DATASOURCE_DRIVER_CLASS_NAME='org.h2.Driver'
$env:SERVER_PORT='8110'
$env:TYPEME_AI_ENABLED='true'; $env:TYPEME_AI_MOCK_MODE='true'; $env:TYPEME_AI_API_KEY='verify-placeholder'
$env:TYPEME_SETTINGS_SECRET='verify-settings-secret'
mvn.cmd -q -o dependency:build-classpath '-Dmdep.outputFile=target/cp.txt' '-Dmdep.includeScope=test'
$cp = Get-Content target/cp.txt -Raw
& "$env:JAVA_HOME\bin\java.exe" -cp "target\classes;$cp" com.typeme.TypeMeApplication

cd ..\frontend
$env:VITE_DEV_API_TARGET='http://127.0.0.1:8110'
npm.cmd run dev -- --host 127.0.0.1 --port 5175

python scripts/browser-verify-visual-v2.py
```
