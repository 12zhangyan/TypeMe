# TypeMe 新版本（2026-09-22 · 第 34 轮）

这一轮的目的只有一个：**确认"能产出一个新版本"，并且这个新版本真的跑得起来**。
下面所有数字都是本轮实测；没有实测的部分单独列在最后一节。

## 1. 版本标识

| 项 | 值 |
| --- | --- |
| 代码版本 | git `674bcec`（分支 `wip/score-v4-and-a58`，PR #17） |
| 产物 | `backend/target/typeme-backend-1.0.0.jar` |
| 大小 | 35,997,665 字节 |
| sha256 | `9475273a2a4136293f59f2f649c266e13e6f122a1654dfb374c01d570c6bea13` |
| 构建时间 | 2026-09-22 17:09（本机） |
| 构建方式 | `frontend: npm run build` → `backend: mvn -o clean package`（先 clean，不留旧 class） |
| 工具链 | JDK 21（`D:\develop\jdk-21`）；177 个主源码 + 71 个测试源码 |
| 前端产物 | `index-BlPyPWyL.js`（650.51 kB / gzip 245.89 kB）、`index-CRL1UZfK.css`（88.31 kB / gzip 16.95 kB） |
| 应用内部版本号 | 仍是 `1.0.0`（`backend/pom.xml` / `frontend/package.json`）—— 见 §5 |

> 内部版本号没有改：本项目的版本号不出现在用户界面（`AboutView.vue` 明确"不把内部版本号印给访客看"），
> 改不改号属于项目版本策略，需要用户决定。**这一版的真实身份是"从当前源码重新构建、并已在真栈上验证过的那一份"**，
> 用 git 提交 + 产物 sha256 标识，比一个手工维护的字符串更可靠。

## 2. 这一版比上一份产物多了什么

上一份可运行的 jar 是第 31 轮打的（13:25）。此后源码累计 9 个提交（相对 `origin/main` 的 #16）：

| 提交 | 内容 | 用户可见影响 |
| --- | --- | --- |
| `3e14979` | 提示词默认升级到 v4；允许对已完成分析重新生成 | AI 解读更短、更贴题 |
| `50df235` | 目录 GET 按契约放开为公开（A58，含 A74/A75） | 未登录也能看到测评目录；限流对匿名也生效 |
| `6bc09ca` | V10 的 `release` 是 MySQL 8 保留字；IT 不再把迁移失败当环境缺失 | 首次在真实 MySQL 8 上能建出 `illustration_asset` |
| `ba7c382` | 阈值方案 B：新计分版本 `typeme-jung48-score-v4` | 「倾向较轻」的判定边界放宽到 `floor(2n/5)` |
| `666e84f` | 第 27–31 轮决策记录与验证账本 | — |
| `b55bc81` | 重新生成失败不再隐藏上一次成功的分析正文（A84） | 失败时仍能读旧分析 |
| `fdc7fa2` / `1d3ad99` | PR #17 评审处置记录与一处误导性证据文件的更正 | — |
| `674bcec` | A34：无报告时不再落库「跳过补充题」；A40：对比页间距取齐账号页 | 草稿不再被锁死；两页节奏一致 |

## 3. 验证证据（本轮实测）

| 内容 | 命令 / 脚本 | 结果 | 原始输出 |
| --- | --- | --- | --- |
| 内容一致性 6 条（只读） | `*-content/fixtures --check` 等 | 全部 exit 0，夹具 sha256 `96943e4bbc1e` | `content-checks.txt` |
| 后端**全量**测试（含 3 个真实 MySQL IT） | `mvn -o clean package` | **415 run / 0 failure / 0 error / 1 skipped**，BUILD SUCCESS | `backend-full-tests.txt` |
| 前端构建 | `npm run build` | exit 0；产物地址检查通过（无写死的远程图片） | `frontend-build.txt` |
| 产物核对 | `work/r34-artifact-check.py` | **12/12**：jar 内 `index.html` / `index-*.js` / `index-*.css` 与 `frontend/dist` 哈希一致；反汇编 `ReportService.submit` 后，`UPDATE … clarification_skipped = 1` 的 `ldc` 在**偏移 983**，`JungScorer.checkCoverage` 在**偏移 171** → 顺序与 A34 的修法一致（这条专门用来排除"jar 里是旧 class"） | `artifact-check.json` |
| 应用启动 | 新 jar 打隔离库 `typeme_r31_e2e` | Flyway 从零迁到 V10，4 个内容包登记（v1–v4）+ 大五；`Started TypeMeApplication in 9.81 seconds` | `app-startup.txt` |
| **真实全栈 API e2e**（真 jar + 真 MySQL + 真会话） | `work/r31_e2e.py` | **16/16 通过**（判别性设计：`|S|=3, n=12` 在 v3 是 REFERENCE、在 v4 是 TENTATIVE，报告状态本身就证明跑的是 v4） | `api-e2e.txt` / `api-e2e-results.json` |
| **真实浏览器 · 真实栈** | `scripts/browser-verify-real-stack-v4.py` | **19/19 通过**：注册 → 建测评 → 逐题作答 → 交卷 → 报告页；320/390/1440 均无横向溢出；阈值文案仍是「每 5 题」 | `browser-real-stack.txt` / `browser-results.json` / 4 张截图 |

隔离库 `typeme_r31_e2e` 用完已删；三个 TypeMe 库回到 `typeme_dev` / `typeme_show` / `typeme_test`，**本轮没有写任何已有库**。
应用进程（PID 33112）已结束，8099 端口已释放。

## 4. 怎么部署这一版

```powershell
# 1. 前端产物必须在打包前就位（Maven 只负责复制，不替你构建）
cd frontend; npm.cmd run build

# 2. 打包
cd ..\backend; mvn.cmd -o clean package    # 产物：target\typeme-backend-1.0.0.jar

# 3. 运行（示例：只监听本机；数据库指向要部署的库）
$env:TYPEME_DB_URL='jdbc:mysql://127.0.0.1:3306/<库名>?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8'
java -jar target\typeme-backend-1.0.0.jar --server.port=8080 --server.address=127.0.0.1
```

启动时会自动执行 Flyway 迁移（V1…V10）并登记内容包。**对已有库执行迁移属于数据库写操作，需要明确授权。**

## 5. 这一版**没有**验证 / 需要你知道的

- **内部版本号仍是 `1.0.0`**：本节标题里的"新版本"指产物，不指语义化版本号。要不要改号（例如 `1.1.0`）属于项目版本策略。
- **AI 能力未做真实外发**：本轮验证全程 `DEEPSEEK_API_KEY` / `TYPEME_AI_API_KEY` 为空，AI 默认关闭（`enabled=false`）。提示词 v4、A84 的失败态呈现都只有 mock 证据。
- **内容审校状态是「内测待审校」**：启动日志逐包打印该警告 —— 48 题主测与 16 型报告未做真人试读与试测，阈值方案 B（0.20）是产品口径而非测量学结论。
- **真实浏览器只走了一条主路径**：报告页在 320/390/1440 三档 + 交卷到出报告；没有覆盖 AI 面板、账号页、后台、大五流程。
- **截图未经人工目视**：断言全部是机器可判定的数字（元素存在、`scrollWidth <= clientWidth + 1`、文案匹配）。
- **未做灰度、未部署到任何长期运行的环境**：本轮只在本机临时进程 + 隔离库上验证，验证完即删库、停进程。
- **大五/旧量表（IPIP-50 / OEJTS）未在本版做端到端验收**，它们的内容与接口仍在（启动日志可见），但本轮只验了 jung48 主流程。
