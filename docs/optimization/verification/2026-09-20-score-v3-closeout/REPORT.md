# score-v3 三项收尾复核（2026-09-20）

本次重新执行，不沿用9月18日的通过数字。范围仅为模拟接口浏览器验收、旧版固定期望回归、报告文案基线。未改业务代码、内容包或其他会话文件。

## 1. 浏览器：170项通过，320 / 390 / 1440

从当前工作区复制491个相关文件到独立临时目录，复制后逐文件SHA-256复查，构建和Java测试均在副本进行，未覆盖工作区dist/target。源码快照及基线提交 `59fbb98c88d85a436e8b8bf530d2026adba1b90a` 见 [snapshot.json](snapshot.json)。结束时原491个文件内容未变化，见 [source-checks.json](source-checks.json)。这代表本次副本的证据，不给其他会话的整体修改背书。

前端先执行 `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit`（exit 0），再执行 `node node_modules/vite/bin/vite.js build`（exit 0）；使用直接入口避免prebuild重新生成工作区内容。[构建日志](build.log)。

报告由当前Java生产计分器与报告构造器的纯逻辑测试生成，无数据库上下文。复用既有 `scripts/browser-verify-score-v3.py`，在副本中增加外部请求阻断、元素滚动到可见位置以及候选区域截图；此次实际脚本保存为 [browser-checks.py](browser-checks.py)。Chromium访问副本dist的本地静态服务，API全部拦截模拟，未定义接口为0、未捕获JS异常为0；完成后静态服务关闭。

| 三个宽度均覆盖 | 本次结果 |
|---|---|
| v3，EI n=12/S=2，跳过补充 | TENTATIVE、参考ENFP、ENFP/INFP两个候选、轻微倾向提示存在 |
| 同答案按v1生成的合成旧快照 | REFERENCE、ENFP、零候选；页面没有根据当前v3默认包重新计分 |
| TIED | 无唯一四字母结果；四个候选可展示，候选不是被选定的类型 |
| 覆盖不足无报告的模拟404 | 显示报告不存在状态；没有报告概览、类型码或候选 |

结果见 [browser-results.json](browser-results.json)，170/170通过。为补拍候选区域复跑一次，仍170/170，不相加报340。保存12张全页与6张候选区域截图；本次查看了三个宽度的报告概览/空态拼图及候选区域拼图，文字可换行、未发现本次目标区域横向溢出或类型/候选丢失。[320概览](review-320.png)、[390概览](review-390.png)、[1440概览](review-1440.png)、[候选对照](review-candidates.png)。长区域截图可能带吸顶导航，不能把截图滚动状态当作首屏状态。

**限制**：旧快照为生产构造器生成的合成数据，并非数据库中真实历史报告。NEEDS_REVIEW这里验证的是“无报告接口返回404后的页面”，没有执行浏览器作答→提交→后端拒绝生成的完整链路；亦未验证真实会话、保存、数据库或AI。本次没有把该404模拟称为服务端不落报告的运行证据。

复跑入口（`$snapshot` 取snapshot.json里的path，另起只绑定127.0.0.1的静态服务）：

```powershell
python -m http.server 5189 --bind 127.0.0.1 --directory "$snapshot/frontend/dist"
# 另一个终端；以下脚本只访问本地静态服务，API模拟
$env:TYPEME_SNAPSHOT=$snapshot
$env:TYPEME_BROWSER_BASE='http://127.0.0.1:5189'
$env:TYPEME_BROWSER_EVIDENCE='<新的证据目录，避免覆盖本次记录>'
python docs/optimization/verification/2026-09-20-score-v3-closeout/browser-checks.py
```

## 2. 旧版回归：确认已有测试，并补实际缺口

已有 `JungLegacyScoringRegressionTest` 8项固定期望覆盖多种v1/v2行为，但补充题完整断言及边界外一格主要只对v1执行；前端 `thresholds.spec.ts` 的旧版部分验证阈值函数，不覆盖完整计分/候选链。原共享输入还会随v3夹具再生成变化。

本次只新增三个文件，不覆盖任何既有测试或期望：

- `backend/src/test/resources/fixtures/legacy-score-closeout.json`：冻结7组输入，期望依据旧规则写成固定值，不读取v3的expect字段，也不接入生成器。
- `backend/src/test/java/com/typeme/jung/scoring/JungLegacyCloseoutTest.java`：v1/v2各7组，共14项。
- `frontend/src/domain/jung/legacyScoring.closeout.spec.ts`：同一批固定输入/期望，两版各7组，共14项。

覆盖旧边界等号与外一格、n=9、补充题跳过/有效合并/中立档、TIED与候选顺序及cost、NEEDS_REVIEW与n=0、追问集合、包/计分政策/报告文案版本绑定。所有断言使用独立固定值，不将新版结果反抄为旧版期望；这不是对所有可能答卷的穷举保证。

隔离副本实跑：

```powershell
# backend目录，JDK 21，离线；以下四类均为纯逻辑/资源加载，无Spring数据库上下文
mvn.cmd -o test '-Dtest=JungLegacyScoringRegressionTest,JungLegacyCloseoutTest,JungReportCopyBaselineTest,JungReportSchemaTest'
# frontend目录
node node_modules/vitest/vitest.mjs run src/domain/jung/legacyScoring.closeout.spec.ts src/domain/jung/scoring.fixture.spec.ts src/domain/jung/thresholds.spec.ts
```

后端41项，0失败/错误/跳过，BUILD SUCCESS且exit 0；前端3文件177项全部通过、exit 0。[后端日志](backend.log)、[前端日志](frontend-tests.log)。不是完整前后端套件。

## 3. 报告文案：源码基线未从v2退回v1

实际核对 `git show HEAD:<path>`，而非只看报告默认常量：

1. 修改前 `jung/api/JungController.java` 创建草稿调用 `catalog.defaultRelease(slug)`；`platform/catalog/AssessmentCatalog.java` 的Jung定义引用 `JungPackageLoader.CURRENT_PACKAGE_ID`，当时为 `typeme-jung48-zh-v1`。平台创建端点同样查目录，但其创建分支只接大五，不能误称两个入口都建Jung草稿。
2. 修改前v1包声明 `typeme-type-report-zh-v1`；`ReportService` 用 `attempts.requirePackage(row)` 找绑定包，向构造器传 `loader.findTypeReports(pkg.reportContentVersion())`。源码基线新草稿实际走v1文案。
3. 当前v3仍声明v1文案；`JungReportCopyBaselineTest` 4项本次重新通过：声明一致、实际解析v1形态（同时以v2含readable字段作反证）、同答案且同状态的报告除版本/哈希字段逐字段一致、生成浏览器夹具并校验。
4. v1/v2题包和v1/v2报告文案四个文件与HEAD逐字节一致，结果及哈希见source-checks.json。

**结论边界**：没有发现本次阈值修改将源码默认新草稿的报告文案从v2退回v1；这不是现网部署版本证明，也不是所有报告正文不变的证明。阈值改判时状态说明和候选本来就会改变。既有v2绑定报告仍使用它自己的v2文案。

## 保留事项

题目审校文档的旧口径仍待其所属会话落定后同步，本次未写该文件。未执行数据库登记/迁移、真实MySQL IT、真实AI、提交、推送、部署或发布。临时副本保留以便复核；原工作区所有已有修改均未覆盖。
