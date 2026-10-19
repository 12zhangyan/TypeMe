# 第 46–62 轮验证（2026-10-14）

50 轮任务进行中。本文件只记录已经跑过的隔离测试。没有浏览器截图，没有真实 AI 调用，没有写现有数据库，没有跑三类真实 MySQL 测试。

## 第 46–56 轮

| 命令 | 结果 |
|---|---|
| `frontend: npx.cmd vitest run src/views/reportsListView.spec.ts src/views/bigFiveAssessView.spec.ts` | 15 条通过（当时大五答题页还是 11 条） |
| `frontend: npx.cmd vitest run src/views/assessView.spec.ts -t 冲突出现在后一题` | 1 条通过 |
| 第 49–55 轮相关 7 个 spec 一起跑 | 69 条通过 |
| `frontend: npx.cmd vitest run src/views/assessChooserView.spec.ts` | 15 条通过 |

本机 MySQL 只读核对过 `typeme_dev`：Flyway 成功记录停在 V10。没有改数据。

## 第 57–62 轮

`frontend: npx.cmd vitest run src/views/assessView.spec.ts src/views/bigFiveAssessView.spec.ts src/views/compareView.spec.ts src/views/bigFiveCompareView.spec.ts src/stores/aiAnalysisV3.spec.ts`

5 个文件、94 条通过，exit 0。其中新增用例覆盖：十六型与大五草稿载入被打断后仍停在第一题；两份比较重读后仍有对照；AI 状态与已有分析重读后不记成失败。

## 第 63–64 轮

`frontend: npx.cmd vitest run src/views/assessView.spec.ts -t 冲突`：12 条通过，其中包含「跳到未答题时，记住位置撞上冲突就停在当前题」。

`frontend: npx.cmd vitest run src/views/assessView.spec.ts -t 补充题`：4 条通过，其中包含「回到主测时记住位置撞上冲突，仍停在补充题」，以及原先成功回到主测的用例。

## 第 65 轮

`backend: mvn.cmd test -Dtest=BigFivePlatformIT,InvitationAdminIT`（`JAVA_HOME` 指向 JDK 21）

21 条通过，exit 0。其中 `BigFivePlatformIT` 13 条，包含「未完成列表的已答数只算主测」：同一份十六型草稿写入 `EI-01` 与 `EI-C1` 后，开放列表的 `answeredCount` 为 1、`requiredCount` 为 48。`InvitationAdminIT` 8 条仍要求只含主测答案时已答数为 48。使用 H2，没有连接本机 MySQL，没有改 `typeme_dev`。

## 第 66 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts`

12 条通过，exit 0。新增用例先失败：开放草稿总数为 2、当前续答是大五时，说明里没有「另外还有 1 份没答完」。改用开放列表的 `total` 之后通过。十六型列表读不到、只靠旧草稿接口时，原有「另外还有 1 份」用例仍然通过。

## 第 67–68 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts`

15 条通过，exit 0。新增「翻到下一题」用例在修复前失败：页面已是第 2 题，请求里的 `currentQuestionId` 仍是 `Q01`。修复后该题号为 `Q02`，重新打开仍显示「第 2 / 50 题」。跳到第 5 题时记下 `Q05`。

`frontend: npx.cmd vitest run src/views/assessChooserView.spec.ts src/views/bigFiveAssessView.spec.ts`

31 条通过，exit 0。其中选择页 16 条，包含「草稿状态用中文」：大五卡片写「答题中」且不含 `BASE_IN_PROGRESS` 和「主测」；十六型主测写「主测答题中」；补充阶段写「补充答题中」。

## 第 69–70 轮

`backend: mvn.cmd test -Dtest=BigFivePlatformIT#submitAndCreateAreIdempotent`（JDK 21，H2）

修复前 1 条失败：第二次交卷 `unprocessedCount` 期望 0，实际 50。修复后 1 条通过，exit 0。没有连接本机 MySQL，没有改 `typeme_dev`。

`frontend: npx.cmd vitest run src/views/reportsListView.spec.ts src/views/compareView.spec.ts`

20 条通过，exit 0。其中报告列表 6 条、比较页 14 条。新增用例在修复前失败：列表卡片和比较选择框只写「并列」，没有「几个方向并列」。

## 第 71–73 轮

`backend: mvn.cmd test -Dtest=BigFivePlatformIT#samePackageCompareReadsNestedMethodology`（JDK 21，H2）

修复前 1 条失败：两份当前十六型报告比较的 `samePackage` 是 false，`packageId` 与 `scoringVersion` 都是 null。修复后 1 条通过，exit 0。

`backend: mvn.cmd test -Dtest=BigFivePlatformIT#reportListCoversBothKinds`（JDK 21，H2）

列表过滤修复前失败：`total` 期望 1，实际 2，第一行是大五 `PROFILE`。过滤之后，混合比较仍是 200，`differences` 为空。拒绝非十六型内容包之后，这条与同内容包比较一起跑：2 条通过，exit 0。没有连接本机 MySQL，没有改 `typeme_dev`。

## 第 74 轮

`frontend: npx.cmd vitest run src/views/adminMembersView.spec.ts`

修复前 1 条失败：档案里同时出现「主测答题中」和「两边接近」。修复后 1 条通过，exit 0。没有做 320 / 390 / 1440 浏览器验收。

## 第 75–76 轮

`frontend: npx.cmd vitest run src/views/compareView.spec.ts`

修复前新增用例失败：两边方向都为空时，行文是「这一维没有给出方向」加上「方向一致」。修复后 15 条通过，exit 0。版本不同且方向相反的那条改为要求「这次不标记变化」。

`frontend: npx.cmd vitest run src/views/bigFiveCompareView.spec.ts`

修复前 1 条失败：较新的选项是「第 1 份 · 2026 年 10 月 14 日 10:00 · 最近一次」。修复后 7 条通过，exit 0。同一时刻、摘要相同的两份仍然能区分。没有做 320 / 390 / 1440 浏览器验收。

## 第 77–78 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts`

修复前 1 条失败：缺题后页面已是 `Q07`，但 `currentQuestionId` 为 `Q07` 的 PATCH 数量是 0。修复后 15 条通过，exit 0。

`frontend: npx.cmd vitest run src/views/bigFiveCompareView.spec.ts`

修复前 1 条失败：页面以「第一次」开头，没有「先看的那份」。修复后 8 条通过，exit 0。没有做 320 / 390 / 1440 浏览器验收。

## 第 79 轮

`frontend: npx.cmd vitest run src/views/adminView.spec.ts -t UTC`

修复前 1 条失败：页面是 `2026-09-17 08:00`，本地时间是 `2026 年 9 月 17 日 16:00`。修复后整个文件 16 条通过，exit 0。没有做 320 / 390 / 1440 浏览器验收。

## 第 80 轮

`frontend: npx.cmd vitest run src/views/adminView.spec.ts -t 翻到后面`

修复前 1 条失败：共 21 个账号，页面没有 `[data-admin-users-next]`。修复后整个文件 17 条通过，exit 0。翻页后请求带 `page: 1`，列表换成后面那一页。没有做 320 / 390 / 1440 浏览器验收。

## 第 81 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts -t 开放草稿属于大五`

修复前 1 条失败：续答按钮旁是「主测 48 题」和「暂时无法判断」，没有「说不好」。修复后整个文件 12 条通过，exit 0。十六型草稿的续答说明仍写「主测」。没有做 320 / 390 / 1440 浏览器验收。

## 第 82 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts -t 开放草稿属于大五`

修复前 1 条失败：展开块的标题是「十六型测评：答题和报告示例」。修复后整个文件 12 条通过，exit 0。「怎么答」改为符合程度和「说不好」，不再写「左边这一侧」。十六型草稿仍用原来的作答说明。没有做 320 / 390 / 1440 浏览器验收。

## 第 83 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts -t 开放草稿属于大五`

修复前 1 条失败：展开块里仍有「选「暂时无法判断」会怎样」。修复后整个文件 12 条通过，exit 0。常见问题、价值说明和维度列表改成五个方面；INFP 与十六型报告示例在这份续答里不展开。未续答时的首页文案用例仍通过，双极说明还在。没有做 320 / 390 / 1440 浏览器验收。

## 第 84 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts -t 开放草稿属于大五`

修复前 1 条失败：展开块里仍有「十六型倾向自测：来源与许可」。修复后整个文件 12 条通过，exit 0。大五续答的来源改为 IPIP-50、公有领域，不再写「自行撰写，没有照搬」。没有续答时仍用十六型的自行撰写说明。没有做 320 / 390 / 1440 浏览器验收。

## 第 85 轮

`frontend: npx.cmd vitest run src/views/assessChooserView.spec.ts -t 草稿状态`

修复前 1 条失败：补充题草稿的卡片是「补充答题中」加上「48 / 48 题」。修复后整个文件 16 条通过，exit 0。这一状态改为「主测 48 / 48」。大五未完成草稿仍写「答题中」，不写「主测」。没有做 320 / 390 / 1440 浏览器验收。

## 第 86 轮

`frontend: npx.cmd vitest run src/views/adminMembersView.spec.ts -t 整份已答完`

修复前 1 条失败：档案是「补充答题中 · 已答 48 / 48 题」。修复后整个文件 2 条通过，exit 0。改为「主测 48 / 48」。大五未完成仍是「答题中 · 已答 3 / 50 题」。没有做 320 / 390 / 1440 浏览器验收。

## 第 87 轮

`frontend: npx.cmd vitest run src/views/landingResume.spec.ts -t 标明这是主测`

修复前 1 条失败：续答说明是「已答 48/48 题」。修复后整个文件 13 条通过，exit 0。补充题进行中改为「主测已答 48/48 题」。大五续答仍是「已答 9/50 题」，不写「主测」。没有做 320 / 390 / 1440 浏览器验收。

## 第 88 轮

`frontend: npx.cmd vitest run src/views/instrumentMethodView.spec.ts -t 不教人选边`

修复前 1 条失败：方面说明是「每一项都写成两端各长什么样，是为了让你判断自己更靠哪边」。修复后整个文件 11 条通过，exit 0。大五改为按符合程度作答，并写明「说不好」。十六型方法页仍写「两端各长什么样」。没有做 320 / 390 / 1440 浏览器验收。

## 第 89 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts -t 五档选项`

修复前 1 条失败：按钮旁是「说不好：暂时无法判断，不计分」。修复后整个文件 15 条通过，exit 0。改为「说不好」表示没有作答、不计分，中间档「说不上符合或不符合」仍会计分。没有做 320 / 390 / 1440 浏览器验收。

## 第 90 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts -t 五档选项`

修复前 1 条失败：按钮是「非常不符合」，说明却是「1 = 非常不贴切 · 3 = 谈不上贴切或不贴切 · 5 = 非常贴切」。修复后整个文件 15 条通过，exit 0。有五档文案时，说明改跟按钮走。没给文案时仍用原来的贴切度说法。没有做 320 / 390 / 1440 浏览器验收。

## 第 91 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts -t 五档选项`

修复前 1 条失败：题干是「这句描述对你有多贴切？」，按钮已是「非常不符合」到「非常符合」。修复后整个文件 15 条通过，exit 0。锚点含「符合」时，题干改为「从「非常不符合」到「非常符合」」，读屏说明也不再说贴切。

`frontend: npx.cmd vitest run src/views/views.spec.ts -t 贴切度`

1 条通过。旧 IPIP 答题页仍显示「这句描述对你有多贴切？」。没有做 320 / 390 / 1440 浏览器验收。

## 第 92 轮

`backend: JAVA_HOME=D:\develop\jdk-21 mvn.cmd test -Dtest=ReadableReportFixturesTest#bigFiveSummaryDoesNotCallUnknownAnswersTheMiddleRating`

修复前 1 条失败：摘要含「选了「说不上符合或不符合」，这些题不参与计分」。修复后整个类 3 条通过，BUILD SUCCESS。摘要改为「说不好」。中间档仍计分。已经保存的旧报告不改写。没有做浏览器验收。

## 第 93 轮

`backend: JAVA_HOME=D:\develop\jdk-21 mvn.cmd test -Dtest=BigFivePlatformIT#unknownWithRatingIsNotDescribedAsTheMiddleRating`

修复前 1 条失败：400 的 message 不含「说不好」，原文是中间档「说不上符合或不符合」不能同时带分值。修复后 1 条通过，BUILD SUCCESS。H2 内存库，没有写 `typeme_dev`。请求仍是 400，答案不写入。没有做浏览器验收。

## 第 94 轮

`backend: JAVA_HOME=D:\develop\jdk-21 mvn.cmd test -Dtest=ReadableReportFixturesTest#bigFiveInsufficientDimensionNamesUnknownAnswers`

修复前 1 条失败：方面说明是「另有 1 题没答或选了「说不上」」。修复后整个类 4 条通过，BUILD SUCCESS。改为「说不好」。中间档仍算有效作答。已经保存的旧报告不改写。没有做浏览器验收。没有写 `typeme_dev`。

## 第 95 轮

`frontend: npx.cmd vitest run src/views/bigFiveAssessView.spec.ts -t 记住题号`

修复前 1 条失败：位置保存请求已经发出，但离开确认框没有出现，页面直接走了。修复后整个文件 16 条通过，exit 0。记住题号失败时先问是否离开；选择留下则仍在答题页。没有未保存答案时，说明改为「下次打开可能不会停在这一题」。没有做 320 / 390 / 1440 浏览器验收。

## 未覆盖

- 上述页面改动没有在 320、390、1440 宽度做浏览器验收。第 65 轮只改列表计数，没有改页面。
- 没有跑前端 typecheck、全量 Vitest、`npm test` 内容生成前置脚本，也没有跑除上述两个测试类以外的后端测试。
- 保存答案、交卷、保存自我理解遇到会话变更时不自动重发。这些写入如果被打断，仍会显示失败，避免把一次可能已经到达服务端的写入再发一遍。
