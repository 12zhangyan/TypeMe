# TypeMe 前端（T-B）

32 题四维人格倾向测评的纯前端实现。**计分、结果、分享图全部在浏览器里完成**，
后端只负责下发内容；后端不可用时自动降级到内置副本，站点依然完整可用。

> ⚠️ **许可（不可绕过）**：题目取自 **Open Extended Jungian Type Scales (OEJTS) 1.2**，
> 作者 Eric Jorgenson，来自 Open-Source Psychometrics Project，许可 **CC BY-NC-SA 4.0**
> （署名 / 非商业 / 相同方式共享）。本仓库的中文题目与文案是**衍生作品**，
> 同样以 CC BY-NC-SA 4.0 发布。**一旦本站出现广告、付费、赞助或任何引流变现，此许可立即失效。**
>
> 本项目未获得 Myers & Briggs Foundation、The Myers-Briggs Company 或 CPP, Inc. 的任何授权或背书。

## 技术栈

Vite 5 · Vue 3（`<script setup>`）· TypeScript · Tailwind CSS 3 · Pinia · Vue Router 4 · Vitest。
**不引入任何组件库**（需求文档已决定用 Tailwind 定制）。

## 命令

```bash
npm install
npm run dev        # 本地开发（/api 代理到 http://127.0.0.1:8080，可用 VITE_DEV_API_TARGET 覆盖）
npx vitest run     # 计分引擎与内容校验单测
npx vue-tsc --noEmit   # 类型检查
npm run build      # 先 vue-tsc 再 vite build，产物在 dist/
npm run build:only # 只构建，不做类型检查
```

## 目录

```
src/
├── domain/
│   ├── types.ts         # ★ docs/任务拆解.md §1.5 冻结契约（不得改字段名）
│   ├── scoring.ts       # ★ 计分引擎：constants[dim] + Σ(direction × answer)，判定 > midpoint
│   ├── scoring.spec.ts  # ★ 三组极端输入 + 极值 8/40 + 1000 组随机不变量
│   ├── clarity.ts       # 清晰度分级 d≥9 A / 5–8 B / 2–4 C / d≤1 D
│   ├── clarity.spec.ts
│   └── contentTypes.ts  # Meta / TypeProfile / MethodContent（非契约，单独存放）
├── content/
│   ├── fallback.ts      # ★ 内置 32 题中文题库 + meta + method（后端不可用时使用）
│   ├── fallback.spec.ts # 逐题校验维度/符号/左右端顺序与红线词
│   └── typeProfiles.ts  # 16 类型中文文案（内置副本）
├── api/client.ts        # 4 个 GET + 超时 + 结构校验 + 静默降级
├── stores/quiz.ts       # 答题进度 + localStorage 续答
├── components/          # LikertScale / DimensionBar / ClarityBadge / ShareCard / AttributionBlock
├── views/               # Landing / Quiz / Result / About
├── utils/shareImage.ts  # canvas 生成 1080×1920 竖版分享图
└── router/index.ts      # hash 模式（静态托管 / 单文件分发都能跑）
```

## 内置题库（`src/content/fallback.ts`）的来源

`backend/src/main/resources/content/questionnaire-quick.yml` **在本次交付时尚不存在**（后端由另一个代理并行实现），
因此内置副本是**手写**的，来源是：

1. `research/_sources/OEJTS1.2.txt`（官方 1.2 版 PDF 的提取文本）——左右端陈述、Q1–Q32 顺序、四条计分公式；
2. `research/01-题库来源.md` §A1 的逐题表格——维度归属与计分方向符号；
3. `docs/任务拆解.md` §1.1 的常量表——`EI 30 / SN 12 / TF 30 / JP 18`、`midpoint 24`。

中文题干为**原创本地化改写**（未采用任何第三方中文译本），并按需求文档 §3.5 的规范处理了
文化语义错位：`party` 不译作"酒局/应酬"，`theoretical` 不直译为带贬义的"理论的"，
`goes out on the town` 不直译为"上城"。

**待办（重要）**：`questionnaire-quick.yml` 落地后，应新增 `scripts/gen-fallback-content.mjs`
从同一份 YAML 生成 `fallback.ts`，以消除"两份内容漂移"的风险。当前用 `fallback.spec.ts`
逐题硬断言维度、符号与左右端顺序作为过渡防线。

## 与文档的一处勘误（已由文档侧修正）

`docs/任务拆解.md` B5（及技术方案 §7.2）原写的「全部选 1 → 每维 8 分 / ISFJ」、
「全部选 5 → 每维 40 分 / ENTP」与同一文档规定的官方公式**数学上不可能同时成立**：
那组期望值对应的是"8 题原值直接相加"的错误算法（丢符号与常数）。
按官方公式与 `EI 30 / SN 12 / TF 30 / JP 18`：

| 输入 | 四维得分 | 类型 |
|---|---|---|
| 全部选 1 | 28 / 16 / 28 / 20 | **ESTJ** |
| 全部选 3 | 24 / 24 / 24 / 24 | **ISFJ** |
| 全部选 5 | 20 / 32 / 20 / 28 | **INFP** |
| 负号题选 5、正号题选 1 | 8 / 8 / 8 / 8 | ISFJ |
| 负号题选 1、正号题选 5 | 40 / 40 / 40 / 40 | ENTP |

`scoring.spec.ts` 把上表全部钉住。**其中"极值 8/40"两条是关键的回归防线**：
丢掉符号的实现会在那两条上立刻失败，而"全选 3 = 24"那条不会。

## 尚未自动化验证的部分

- **微信内置浏览器（iOS / Android）能否保存图片到相册** —— 需要人工实测。
  `downloadShareCard` 的 `<a download>` 在部分微信版本里会失效，因此分享浮层里
  始终提供"长按图片保存"的兜底路径。
- canvas 实际渲染效果（jsdom 没有 2d 上下文，单测只覆盖尺寸与文案约束）。
- 32 题在手机上的真实用时与放弃点。
