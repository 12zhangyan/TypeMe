# TypeMe · 多量表测评平台（十六型参考测评 + 大五倾向测评）

**管理员与邀请注册（2026-09-18）：** 新账号必须使用管理员生成的一次性邀请码。成员管理入口 `/#/admin/members`，支持查看状态、进度、固定报告和分配每日 AI 额度。默认管理员用户名为 `typeme_admin`，首次创建需要通过部署环境提供初始密码；部署与迁移说明见 [管理员上线说明](docs/handoffs/2026-09-18/admin-invitations-deployment.md)。

> **站点是一个多量表平台，当前提供两项测评。**
>
> - **十六型人格参考测评**（`typeme-jung48`，新测）：注册/登录后作答 48 道场景化题目 + 最多 16 道
>   补充题，得到一个**四字母参考类型**与完整中文解读；可跨设备继续未完成的作答、回看历史报告、
>   导出或删除自己的全部数据。
> - **大五人格倾向测评**（`typeme-bigfive50`，IPIP-50 中文版）：50 道陈述句五星量表，
>   五个方面**各自独立**评分，**没有类型码、没有总分、没有补充题轮次**。
>
> 两项测评共享账号、草稿、报告与数据管理，但**题目形式、完成规则、计分与报告各自独立**：
> 大五不会被压成四个维度或四个字母，十六型也不会被讲成"五个分数"。
>
> 页面入口：`/instruments` 选测评 · `/instruments/{slug}/method` 看口径与版本 ·
> `/assess` 开始或继续 · `/reports` 我的全部报告（两种报告在同一个列表里，按报告种类分流详情页）。
>
> 新测的详细说明见 [`docs/2026-09-16/implementation/README.md`](docs/2026-09-16/implementation/README.md)，
> 多量表改造方案见 [`docs/2026-09-18-platform-plan/`](docs/2026-09-18-platform-plan/)，
> 验收证据见 [`docs/2026-09-16/verification/`](docs/2026-09-16/verification/)。
>
> **本文件下半部分记录的是旧的只读量表站点（IPIP-50 大五 / OEJTS 1.2），
> 它仍然可用、行为未改动**，但已不再是站点主体。两套东西的授权与计分规则**不同，不要混淆**。
> 特别注意：新的「大五人格倾向测评」与下半部分那个**旧 IPIP-50 只读流程是两套东西**
> （前者服务端计分、要登录、进账号数据；后者纯浏览器计分、后端只读）——不要把两者的
> 数据处理说明互相套用。

## 当前两项测评的差别（最容易被做错的地方）

| | 十六型人格参考测评 `jung48` | 大五人格倾向测评 `bigfive50` |
|---|---|---|
| 题目形式 | 一对场景化描述 + 5 档位置 | 一句陈述 + 5 档"符合程度" |
| 「说不好」 | 有（与"未作答"是两件不同的事） | 有（同样与服务端"未处理"区分） |
| 补充题 | 有（覆盖不足时最多 16 题） | **没有** |
| 计分 | 每维 `c = 方向 × (评分 − 3)`，`m = S/(2n)` | 每维 `分数 = 常数 + Σ 方向×作答`，完整作答的可达范围均为 **10–50** |
| 类型码 | 有（16 个四字母或 NULL） | **永远没有**（数据库 CHECK 也不允许） |
| 证据不足时 | `NEEDS_REVIEW`，不出报告 | 该维度不给方向，其余维度照常出报告 |
| 结果状态 | `REFERENCE` / `TENTATIVE` / `TIED` / `NEEDS_REVIEW` | `PROFILE`（每维各自"有结论/证据不足"） |
| 中点 | 3（五档的中间档） | 30；反向题补偿常量不是中点。旧报告若保存了错误范围，页面明确提示而不重算快照 |
| AI 解读 | 可选、默认关闭；新版为简短解释与一个行动，旧分析仍可读 | 提示词 v3 支持；若管理员仍固定在旧提示词版本，界面说明暂不支持 |
| 内容状态 | 内测待审校 | 内测待审校（**尚未经过真人试读与试测**） |

> **两项测评的测试通过都不等于信度或效度验证**：题面与解释仍是 `draft_review_pending`，
> 没有任何真人试读、试测或常模数据。

2026-09-18 易读性续作：多量表首页、报告分层阅读、`analysis-readable-v2`、大五量程修复及验证记录见
[本轮实施与验收](docs/optimization/verification/2026-09-18-readable/REPORT.md)。本轮没有更新现有数据库或调用真实 AI；配置显式保留旧提示词版本时不会自动覆盖。

## 新测（`typeme-jung48`）要点

| | 新测 |
|---|---|
| 量表 | 本项目原创的 48 题主测 + 最多 16 题补充（场景化题面，无翻译腔） |
| 维度 | 4 个：EI 精力方向 / SN 信息取向 / TF 决策依据 / JP 生活节奏 |
| 作答 | 一对场景化描述 + 5 档位置，另有「这题我说不好」（与"未作答"是两件不同的事） |
| 结果 | 四字母**参考**类型 + 八段中文解读；平分或倾向较轻时降级表述（见下） |
| 账号 | 注册/登录、跨设备草稿、历史报告、恢复码找回、导出/删除数据、注销账号 |
| 注册前置 | 注册时必须勾选「我已阅读并理解测评定位与作答数据怎么存」（2026-09-17 起；服务端校验，见 `typeme.auth.disclaimer-required`） |
| AI 分析 | **可选**能力，默认关闭；基础报告与固定计分完全不依赖它 |

### 四种结果状态（这是新测最容易被做错的地方）

| 状态 | 什么时候出现 | 呈现方式 |
|---|---|---|
| `REFERENCE` | 四维方向都明确 | 给出四字母 + 完整解读 |
| `TENTATIVE` | 至少一维"只是略偏" | "本次更接近 XXXX"，并明确说明这一侧只是略偏、另一侧也值得读 |
| `TIED` | 有维度两边证据完全对等 | **不给出四字母**，并列展示多个候选并解释为什么都可能 |
| `NEEDS_REVIEW` | 主测没答完，或某维有效作答不足 | 不出报告，指出还差哪几维 |

**平分时不给字母是刻意的**：那说明该维两边证据对等，报出任何一个字母都是在制造
并不存在的确定性。

### 候选排序的 `cost` **不是概率**

报告会列出"另外也值得一起看的类型"，每个候选带一个 `cost`。
它的含义是**"换成这个类型需要偏离多少证据"**，不是"有多像"、不是可能性、不是分数高低。
任何把它讲成概率/准确率/百分位的文案都不允许出现（内容生成器会拦）。

### 过程层：由四个字母推导出的结构，以及由它派生的建议

报告里另有两块 `dynamics` / `processPlan`：四个精神活动过程（主导 / 辅助 / 两个尚未偏好的），
以及发展三段任务、四步决策法、对立面互补与沟通规则。方法论、书中依据（章节与页码）、
以及每一条的推导过程见
[`docs/2026-09-16/TypeMe-分析建议方法论-v2.md`](docs/2026-09-16/TypeMe-分析建议方法论-v2.md)。

三条必须守住的纪律：

- **这是推导，不是测量**：它完全由四个字母决定（J/P 决定哪个过程对外使用；内倾者对外露出的是辅助过程）。
  `basis` 与 `notes.frameworkCaveat` 必须与它同现，否则会被读成"另一个测试结果"。
- **`TIED` 时不推导**：字母都没定，`dynamics` 与 `processPlan` 都是 `null`。
- **四个过程没有高下**：主导过程只是"用起来最省力"的一个，两个尚未偏好的过程只是"还没练过"。
  这一层最容易被读成"你适合干什么"，所以禁用词表新加了
  `匹配率/适配度/适合度/职业匹配/恋爱配对`（进的是**全局**表，构建期的内容生成器与运行期的
  报告构造用同一张表 —— 两边不一致会变成"构建期通过、运行期抛异常"）。

### 这不是诊断

16 型框架在学界有争议，本工具定位是**自我探索的参考起点**，不是心理测量工具，
不能用于诊断、招聘筛选或任何对人的评判。页面与报告中不允许出现
准确率/概率/百分位/置信/确诊之类表述。

**不是官方 MBTI 测验**，与 The Myers-Briggs Foundation 等机构无任何关联。
题目为本项目原创，未使用 MBTI 官方、16Personalities 或 OEJTS 的任何原题。

---

# 以下为旧的只读量表站点（仍可用，行为未改动）

## TypeMe · 人格倾向自测（默认大五 IPIP-50）

一个中文网页人格倾向自测工具：回答 50 个简短问题，得到**五个维度各自**的方向、倾向解读，
以及日常情境里的观察与可执行建议。**手机操作顺手，PC 排版舒展。**

站点默认量表已从 OEJTS 四字母类型换成**大五人格（IPIP-50，公有领域，允许商用）**；
OEJTS 1.2（32 题）保留为**可选旧版本**，在首页「题目版本」里选择，旧记录继续可读。

> **当前定位：默认量表为公有领域内容。** OEJTS 旧版本仍依其
> [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) 授权，非商业用途。
> 仓库许可分三类（代码 / IPIP / OEJTS），见 [`LICENSE`](LICENSE) —— **整站不能直接商用**，
> 除非先移除全部 OEJTS 相关内容。

## 两份量表的差别（不要混淆）

| | IPIP-50（默认） | OEJTS 1.2（可选旧版本） |
|---|---|---|
| 维度 | 5 个：E 外向性 / A 宜人性 / C 尽责性 / ES 情绪稳定性 / O 开放性 | 4 个：EI / SN / TF / JP |
| 作答 | 单句自我描述 + 5 档贴切度（1 非常不贴切 … 5 非常贴切） | 一对相反描述 + 5 档位置（左 1 … 右 5） |
| 每维题数 / 区间 | 10 题，区间 10–50，中点 30 | 8 题，区间 8–40，中点 24 |
| 类型码 | **没有**（五维各自给方向，不拼字母） | 有（四维都达到展示条件才拼四字母） |
| 展示门槛 | `typeMinDistance 6` / `markedDistance 11` | `typeMinDistance 5` / `markedDistance 9` |
| 授权 | 公有领域（IPIP，允许包括商用在内的自由使用） | CC BY-NC-SA 4.0（署名 + 非商业 + 相同方式共享） |

两个包的题面、帮助、维度解释与报告文案都**整体锁定在 `packageId` 里**，界面上一开始就标出
用的是哪一版；换版本要重新测试，不会静默替换。**不是官方 MBTI 测验**，与
The Myers-Briggs Foundation 等机构无任何关联；IPIP 也不是任何机构的官方大五测评。

## 架构

| 层 | 说明 |
|---|---|
| 前端 | Vue 3 + TypeScript + Pinia + Vue Router(hash) + Vite + Tailwind |
| 内容服务 | Java 21 + Spring Boot 3，**只读** GET 接口，内容在 classpath 的 YAML 里 |
| 计分 | **浏览器本地**：答案与分数不进入任何请求参数、body、日志或第三方分析 |
| 内容降级 | 接口不可用时用**同版本**内置副本（由后端 YAML 单向生成），功能与结果不变 |
| 打包 | Maven 把 `frontend/dist` 复制进 jar，一个 `java -jar` 同时提供页面与接口 |

> 旧 README 写的「纯前端、零后端」与现状不符，已按实际架构更正。

接口（没有提交答案、创建报告或登录接口）：

| 请求 | 用途 |
|---|---|
| `GET /api/v1/questionnaires/quick` | OEJTS 旧版题库（32 题，v1 兼容入口） |
| `GET /api/v1/types/{code}` | 一种类型的文案（**只作参考阅读**，仅 OEJTS） |
| `GET /api/v1/meta` | 站点与署名信息 |
| `GET /api/v1/method` | 方法说明（OEJTS 旧版本正文；关于页在默认大五下会显式标注） |
| `GET /api/v2/assessment-packages/{packageId}` | **v2 内容包**：题面 + 逐题帮助 + 维度解释 + 报告文案 + 解释政策（只读，整包锁定） |
| `GET /actuator/health` | 健康检查（根路径，不是 `/api/v1/actuator/health`） |

## 判型与报告的三层结构（本轮调整，不要绕过）

```
原始计分（各量表的官方公式：OEJTS 1.2 / IPIP-50 官方键值，均未改动，由内容包驱动）
  → 每维状态（信息不足 / 本次两侧相近 / 略偏待观察 / 达到展示条件）
    → 唯一的 ReportViewModel（页面、图片、复制文字、文件名、无障碍名称共用一个来源）
```

- **保留未定**：某一维缺任一题的数字答案 → `信息不足`（不补 3、不按比例补分、不缩短分母）；
  距中点 0 分 → `本次两侧相近`（没有主导侧）；小于展示门槛 → `略偏，继续观察`；
  达到 `typeMinDistance` → 可参与「本次问卷参考组合」（OEJTS）或直接按方向解读（大五）。
  OEJTS 四维都达到展示条件时才拼出四字母；大五没有类型码，五维都达到条件时给的是
  「五个维度都有方向」的完整总结（分享文件名 `typeme-profile-clear.png`）。
- **门槛是展示策略，不是置信阈值**：`typeMinDistance` / `markedDistance` 写在内容包里并随
  `interpretation.version` 版本化，不得宣传成经过验证的准确率或官方规则。
- **「暂时无法判断」不是 3 分**：它与「两边相近」分开存储；相关维度显示信息不足，其余维度照常出结果。
- **未定结果不得回退成默认类型**：页面、分享图片、复制文字、下载文件名、图片 alt 都不出现
  任何完整四字母或类型描述名（大五报告里连类型文章都不取）。改答即失效旧报告与旧分享产物。

## 内容维护：后端 YAML 是唯一真相

```
backend/src/main/resources/content/questionnaire-quick.yml   ← OEJTS 32 题（v1 题库，旧版兼容）
backend/src/main/resources/content/types.yml                 ← 16 型文案（只作参考阅读，仅 OEJTS）
backend/src/main/resources/content/method.yml                ← 方法说明（OEJTS 旧版本正文）
backend/src/main/resources/assessment-packages/*.yml         ← v2 内容包（题面+帮助+解释+报告文案）
        │  node scripts/gen-fallback-content.mjs        （单向生成，勿手改产物）
        ▼
frontend/src/content/{questionnaireFallback,typeProfiles,methodFallback,assessmentPackagesFallback,fallback}.ts
```

- 改内容：改后端 YAML → `npm run build`（prebuild 会自动重新生成）。
- 检查是否漂移：`node scripts/gen-fallback-content.mjs --check`（同时覆盖 v2 内容包）。
- 16 型文案另有一份**结构化数据源**（避免手改 YAML 时字段/缩进漂移）：
  `scripts/content/types-content.mjs`；`node scripts/rewrite-types-content.mjs` 写回 YAML，
  `--check` 校验一致性。
- 跨类型文案不得出现 ≥6 字的连续重合（后端 `ContentValidationTest` 会判红）。
  本地快速自检：`node scripts/check-type-duplication.mjs`。
- **v2 内容包是不可变的**：任何题面/帮助/解释/报告文案改动都必须换新的 `packageId`；
  注册表在 `backend/.../service/ContentService.java` 与 `scripts/lib/backend-content.mjs`
  （两处白名单必须同时加，顺序即默认包顺序）。当前三个包：
  `ipip50-zh1`（**默认**，大五 50 题）、`oejts32-zh1-report2`（现行题面 + 新报告政策）、
  `oejts32-zh2-preview-r1`（审校候选题面，试用）。
  三个包的 `contentStatus` 都是 `draft`：题面/帮助尚未完成真人审校与认知访谈。
- 仪器档案（维度顺序、每维题数、常量、逐题符号、中点、展示门槛、是否产出类型码）在三处
  镜像声明，必须逐字段一致：`frontend/src/domain/assessmentPackage.ts`、
  `scripts/lib/backend-content.mjs`、`backend/.../service/ContentService.java`。
  没有档案的 `instrument.id` 会被直接拒绝，不会「跑得通但全错」。

## 本地开发

```powershell
# 1. 前端（开发服务器；/api 代理到 127.0.0.1:8080。后端不在也能跑，会降级到内置副本）
Set-Location frontend
npm.cmd ci            # 已有 node_modules 时跳过
npm.cmd run dev -- --host 127.0.0.1

# 2. 后端（需要 JDK 21）
Set-Location ..\backend
$env:JAVA_HOME='D:\develop\jdk-21'
mvn.cmd test
mvn.cmd package -DskipTests
java -jar target\typeme-backend-1.0.0.jar --server.address=127.0.0.1
#   打开 http://127.0.0.1:8080/ —— 页面与接口由同一个 jar 提供
```

## 打包与部署（单 jar：页面 + 只读接口）

`pom.xml` **不会**替你构建前端，它只把已经存在的 `frontend/dist` 复制进 `target/classes/static`。
所以顺序不能反：

```powershell
Set-Location frontend
npm.cmd run build                       # 必须先构建前端（含内容包的 prebuild 生成）

Set-Location ..\backend
$env:JAVA_HOME='D:\develop\jdk-21'
Remove-Item -Recurse -Force target\classes\static\*   # copy-resources 只增不删，避免打包进过期 bundle
mvn.cmd package -DskipTests             # 产出 target\typeme-backend-1.0.0.jar（fat jar）
java -jar target\typeme-backend-1.0.0.jar --server.address=0.0.0.0 --server.port=8080
```

- 部署形态只有这一种：**同一个 jar 提供页面与 `/api/v2` 内容包接口**，没有数据库、没有写接口，
  答案与计分全在浏览器里完成（服务端拿不到作答）。
- 只想托管静态页面时，把 `frontend/dist` 交给任意静态服务器，并让 `/api` 指到后端的
  `--server.address` 即可（前端在接口不可达时会用**同一个内容版本**的内置副本，不会静默换题）。
- 部署版文案纪律（本轮清理后的约定）：**维护细节不进访客界面** —— 内容包 ID、`draft`/审校状态、
  修订号、解释政策版本号、本地键名、服务端/内置副本这类字眼只允许出现在控制台日志、接口响应
  与仓库文档里。首页版本选择只给干净版本名（`大五人格 50 题` / `快速版 32 题`），
  内部那版审校候选仍登记在注册表里但不再作为入口。
  对应的守卫：`frontend/src/views/instrumentCopy.spec.ts` + `views.spec.ts` 与两条浏览器验收脚本。

### 开发专用的可复现答卷（验收 / 截图用）

只在 `npm run dev` 下生效（生产构建会被 tree-shaking 掉）。目标偏移**按量表分表**声明
（OEJTS 每维 8 题 → ±16；IPIP 每维 10 题 → ±20），同一组数字不跨量表复用：

```
# 默认大五（IPIP-50，无类型码）
http://127.0.0.1:5173/#/quiz?seed=3            全选 3                    → 五维相近，无方向
http://127.0.0.1:5173/#/quiz?seed=left         推向低分端                → 五维有方向（clear）
http://127.0.0.1:5173/#/quiz?seed=opposing     每维 5 题 +2 / 5 题 −2    → 同分但符号分布不同
http://127.0.0.1:5173/#/quiz?seed=unknown      50 题全部无法判断         → 信息不足，无任何分数
http://127.0.0.1:5173/#/quiz?seed=mixed        ES 信息不足，其余可判方向 → partial + insufficient
http://127.0.0.1:5173/#/quiz?seed=ref-typed    −14/+8/−16/+14/+8        → 五维都达到展示条件（clear）
http://127.0.0.1:5173/#/quiz?seed=ref-partial  −14/+4/−16/+14/+8        → A 不足以给方向，partial

# 可选旧版本 OEJTS（首页把题目版本切到 oejts32-zh1-report2）
http://127.0.0.1:5173/#/quiz?seed=1            全选 1                    → 只有 S/N 可判型（partial）
http://127.0.0.1:5173/#/quiz?seed=5            全选 5                    → 只有 S/N 可判型（partial）
http://127.0.0.1:5173/#/quiz?seed=right        推向 E/N/T/P               → 参考组合 ENTP
http://127.0.0.1:5173/#/quiz?seed=ref-typed    偏移 −12/+8/−8/+10        → 参考组合 INFP
http://127.0.0.1:5173/#/quiz?seed=ref-partial  偏移 −12/+4/−8/+10        → S/N 待观察，完整类型为空
```

写的是**真实会话**（走正常的 `selectRating()` / `selectUnknown()`，会落盘），因此刷新、回改、
报告页、分享全部按正常路径工作。见 `frontend/src/dev/seed.ts`。

## 验证命令

```powershell
# 仓库根目录：先留基线（只检查不写），再生成
node scripts/gen-fallback-content.mjs --check
node scripts/rewrite-types-content.mjs --check
node scripts/check-type-duplication.mjs
# 新测（typeme-jung48）：内容包（含过程层文案）与跨 Java/TS 的共享夹具
node scripts/convert-jung-content.mjs --check
node scripts/gen-jung-fixtures.mjs --check

Set-Location frontend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build      # 含 vue-tsc；build:only 会跳过类型检查，不能当作完整构建通过

Set-Location ..\backend
mvn.cmd test

# 当前基线（2026-09-16 过程层落地后实测，原始输出见
# docs/2026-09-16/verification/acceptance-evidence.md §10）：
#   内容包与夹具 --check 一致；前端 17 文件 / 693 条全绿、exit 0；
#   后端 242 条 0 失败 0 错误（1 条是刻意的 skip）。
# 三条纪律：`npm test` 必须 **exit 0**（只有"用例全绿"不够，unhandled error 会让进程失败）；
#          `npm run build` 不能用 build:only 代替；改内容后必须重跑两个 --check。
#
# 更新的基线（2026-09-17 持续优化第 14 轮，原始输出见 docs/optimization/progress.md）：
#   前端 25 文件 / 769 条；后端子集 259 条（0 失败 1 跳过）；
#   注意后端完整 `mvn.cmd test` 会包含两个会**建库/删库**的真实 MySQL 用例，
#   未获授权时按下面的写法排除，并称结果为"相应子集通过"：
#     mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT'

# 浏览器验收（需先起着前端与后端；含视口矩阵、真实 50 题流程与真实导出图片）
python scripts\browser-verify-ipip.py   # 默认大五入口（IPIP-50）
python scripts\browser-verify.py        # OEJTS 旧版本路径（先把题目版本切到 oejts32-zh1-report2）
# 产出：docs/2026-09-15/verification/{assessment-ipip50,assessment-v2}/*.png 与 REPORT.md

# 新测（登录版十六型）的浏览器验收。都需要一个**可写的一次性后端**（建议内存 H2），
# 脚本会真实注册账号、作答、交卷 —— 不要指向含真实用户数据的库。
$env:TYPEME_BASE='http://127.0.0.1:5174'   # 指向转发到测试后端的 dev server
python scripts\browser-verify-jung-flow.py       # 主流程 34 项：注册→作答→刷新恢复→交卷→报告→归属边界→视口
python scripts\browser-verify-ai-analysis.py     # 报告页 AI 面板 31 项（后端需 TYPEME_AI_MOCK_MODE=true）
#   该脚本也支持**真实模式**（mock=false）：此时会真的调用外部模型服务并产生费用，
#   只应在明确授权下执行；脚本会改判"不得出现演示数据标注"，其余结构性断言对真实输出同样适用。
python scripts\browser-verify-compare.py         # 复测比较 28 项（脚本自己做两份报告）
python scripts\browser-verify-conflict.py        # 跨设备草稿冲突 22 项：两个独立浏览器上下文真的撞 409
#   验证冲突横幅逐条列出「被丢弃的是第几题、自己选了什么」（不需要 AI，也不写 AI 配置）。
python scripts\browser-verify-admin-members.py  # 成员/邀请/报告：320、390、1440，静态构建 + 全接口模拟
# 原 browser-verify-admin.py 的注册后自动提权流程已不适用于邀请码版本，不再用于新站验收。
python scripts\browser-verify-narrow-layout.py   # 320/360/390/768/1440 × 首页/登录/注册/关于 的顶栏与溢出
python scripts\browser-verify-optimization.py    # 顶栏导航、真实渲染对比度、横向溢出
# 产出：docs/optimization/verification/<日期>-<主题>/*.png 与 REPORT.md
```

## 目录

```
backend/          Java 内容服务（YAML 内容 + 只读接口 + 把 dist 打进 jar）
frontend/
  src/domain/     计分、分档、答案口径、题库契约（纯函数，有单测）
  src/stores/     本地会话 v3（内容包快照 + 整包签名 + 恢复 + 跨标签页冲突）
  src/views/      首页 / 答题 / 结果 / 关于
  src/components/ 题卡选项、维度倾向条、分享预览、确认弹窗等
  src/dev/        仅开发环境的验收辅助（答卷种子）
  src/content/    ⚠️ 由后端 YAML 生成，勿手改
docs/
  2026-09-15/TypeMe-整体体验重构开发文档.md   ← 本轮体验改造的目标规格
  2026-09-15/verification/                    ← 本轮浏览器验收截图与记录
  需求文档.md / 技术方案.md / 任务拆解.md      ← 历史背景（各自顶部有提示）
scripts/          内容生成、重复度自检、浏览器验收
```

> 仓库里**刻意不发布**的内容（见 `.gitignore`）：抓取的第三方页面与截图（`_research/`、
> `_osint/`，版权与商标风险）、研究原始素材（`research/`）、以及改造过程中的工作备份
> （`.baseline-backup/`、`.work-backup/`）。构建产物（`node_modules/`、`frontend/dist/`、
> `backend/target/`）也不进仓库，按「打包与部署」一节重建。

## 许可（三类内容各不同）

| 内容 | 范围 | 许可 |
|---|---|---|
| 项目代码 | `frontend/`、`backend/src/`、`scripts/` | 保留所有权利（公开可见 ≠ 授予复用许可） |
| IPIP 量表内容 | 内容包 `ipip50-zh1` | 公有领域（中文题面为本项目自写改写稿） |
| OEJTS 内容 | 内容包 `oejts32-*` | **CC BY-NC-SA 4.0**：署名 + 非商业 + 相同方式共享 |

完整条款、署名文本与「无关联 / 免责」声明见 [`LICENSE`](LICENSE)。
本站与 MBTI®、16Personalities、Open Psychometrics 等机构无任何关联或授权。

## 计分与展示纪律（不要绕过）

- 计分用各量表的**官方**公式（带正负号与常数），题库/内容包驱动，不写死题号/符号/常量：
  OEJTS 1.2 的四条公式与 IPIP-50 的官方键值都没有被改动，改的只是上层的展示政策。
- **原始分与产品判型分层**：公式不改；「距中点 N 分才算达到展示条件」是本产品版本化的展示策略，
  不是量表阈值、置信区间或准确率。见 `frontend/src/domain/interpretation.ts`。
- **允许未定**：维度可以是「信息不足 / 本次两侧相近 / 略偏待观察」；完整类型可以为空，
  也不使用 `XXXX` 当第 17 种人格。见 `frontend/src/domain/assessment.ts`。
- **不输出人群百分位**：只有「本量表相对中点的偏移」，不给概率语言。
- **位置（position）与偏移（signedOffset）是两个量**：条上是一个标记点 + 可见中线，
  不把轨道涂满（score=20 与 28 的偏移绝对值相同，方向相反）。
- **一个维度改变只影响这一维**：某一维小改动不得翻转其他维度的解释（有反例测试钉住）。
- **不生成认知功能排序、荣格八维、A/T、职业匹配率、恋爱配对、类型稀有度** —— 当前量表没有对应信息。
- 类型文章只作**参考阅读**，且只在 OEJTS 形成参考组合时提供；未定报告与大五报告都不取任何类型文案。

## 本地记录与会话

- 当前键：`typeme.quiz.v3`（内容包快照 + 整包签名 + 数字/无法判断分装的回答 + 位置 + 自我观察）。
- 题目版本偏好：`typeme.package.v1`（只存 `packageId`）。默认入口是 `ipip50-zh1`；
  用户在首页「题目版本」里选过哪一版，刷新后仍是哪一版。这条偏好**只在恢复会话时同步**
  （派生自旧记录的会话不会覆盖用户的选择），「关于测试 → 本地记录」里的清除会一并清掉它。
- 旧键 `typeme.quiz.v2` **只读**：可显式「载入为派生会话」（保留当时的题面 + 本版解释政策），
  原键不删除；更早的 `typeme.quiz.v1` 只识别、不迁移。
- 存储不可用 / 超限 / 坏签名都**如实反馈**，不假称保存或恢复成功；跨标签页写入时停止覆盖并提示。
- 改答即失效旧报告、旧分享图与复制文字；打开题目帮助**不**改变答案或分数。

## 内容包的两条路径（只在 store 与控制台里可见）

- **服务端**：`GET /api/v2/assessment-packages/{packageId}`（Spring Boot 从
  `backend/src/main/resources/assessment-packages/*.yml` 直接提供）。
- **内置副本**：接口不可达 / 超时 / **结构不符合契约**时，只能用**同一个 `packageId`**
  的内置副本（`frontend/src/content/assessmentPackagesFallback.ts`，由 YAML 生成）；
  没有同 ID 副本时页面显示「这个题目版本暂时不可用」，绝不悄悄换到另一版内容。
- **部署版不再把这件事写在界面上**：装载路径只存在于 `quiz.packageSource`、控制台日志
  与浏览器验收记录里。验收脚本从 store 读真实路径（不靠页面文案判断），
  产物报告里会写明本次是 `api` 还是 `fallback`。
- 契约校验把 `null` 与「没有这个字段」**同等对待**：服务端（Jackson）会把 YAML 里缺省的
  可选字段序列化成显式 `null`（如 OEJTS 包的 `responseAnchors` / `dimensionOrder`），
  写成 `!== undefined` 会让整包被判非法、页面静默降级 —— 这是本轮真实踩过并已修掉的回归。

## 边界与免责

- 默认量表的题目来自 **IPIP（International Personality Item Pool）**，属**公有领域**，
  官方明确允许包括商业用途在内的自由使用；本项目自写了简体中文题面（候选稿），
  IPIP 不为译本提供信效度验证，本站也不声称经过验证。
- OEJTS 旧版本的题目依 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
  使用，并做了中文改写；使用旧版本时仍受「署名 + 非商业 + 相同方式共享」约束。
- 结果**仅供自我了解**，不是心理诊断，不用于招聘、晋升或任何筛选。四字母是「本次问卷参考组合」，
  只有 OEJTS 四维都达到本产品的展示条件时才会出现；大五不产出类型码。
- 题目答案与计分在你的浏览器中处理。为方便继续测试，本浏览器会保留**最近一次**作答
  （localStorage 键 `typeme.quiz.v3`），可随时在「关于测试 → 本地记录」清除。
  公开部署时的访问日志等事项需按实际部署方式另行核实，不由前端文案代替核实。
- 题目中文措辞、逐题帮助与候选修订均为**未完成真人审校/试用**的 draft 内容；
  本项目**没有**本版中文题目的信度/效度证据，不得声称「更准确」「官方认证」。
