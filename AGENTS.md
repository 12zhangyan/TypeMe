# TypeMe 项目协作规则

适用于本仓库。默认使用中文，简洁汇报结论、改动和验证证据。先读相关代码与规则，再行动；普通范围内的文件编辑无需反复确认。

## 项目定位与事实来源

- 当前主流程是登录版十六型人格参考测评：`typeme-jung48`，48 道主测题、最多 16 道补充题，服务端保存草稿与报告；AI 分析是可选能力。
- IPIP-50 / OEJTS 是保留的旧流程。不要把旧流程的“纯浏览器计分、后端只读、无需登录”套用到新站，也不要把新站的数据处理说明套用到旧流程。
- 先读 `README.md` 顶部的新测说明，再按任务读取：
  - `docs/2026-09-16/TypeMe-MBTI测评站-产品方案.md`
  - `docs/2026-09-16/TypeMe-MBTI测评站-开发方案.md`
  - `docs/2026-09-16/implementation/_contracts/` 中相关契约
  - `docs/2026-09-16/TypeMe-分析建议方法论-v2.md`（涉及报告与分析建议时）
- `docs/2026-09-16/implementation/README.md` 与 `verification/` 记录历史实现、缺口和验收。历史测试数量、缺口清单及 README 旧章节不是当前状态证明，应核对当前代码和运行结果。
- 用户当前明确要求优先。代码说明实际行为，产品方案和契约说明预期；两者冲突时先定位偏差，不以旧注释或错误测试断言替代业务判断。

## 代码地图

- 前端：Vue 3 + TypeScript + Pinia + Vue Router（hash）+ Vite + Tailwind。入口与布局在 `frontend/src/App.vue`、`style.css`；路由在 `router/index.ts`。
- 新流程页面：`frontend/src/views/` 下的 `LandingView`、`LoginView`、`RegisterView`、`RecoverView`、`AccountView`、`AssessView`、`ReportV3View`。
- 新流程状态与接口：`frontend/src/stores/*V3.ts`、`auth.ts`、`frontend/src/api/`；计分与报告模型在 `frontend/src/domain/jung/` 和 `reportV3.ts`。
- 后端：Java 21 + Spring Boot 3.3.5 + Spring Security + JdbcTemplate + Flyway；根包 `backend/src/main/java/com/typeme/`，新流程主要在 `account/`、`jung/`、`ai/`、`security/`、`common/`。
- 数据库迁移：`backend/src/main/resources/db/`。已有迁移的历史含义不得通过原地修改抹掉；需要 schema 变化时准备增量迁移，执行迁移另受数据库授权约束。
- 旧流程：前端 `QuizView`、`ResultView`、`stores/quiz.ts` 与原计分模型；后端 v1/v2 内容接口和 `service/ContentService.java`。保留旧记录可读、计分、版本绑定和授权署名。

## 实施方式

- 开始先看 `git status --short` 与相关 diff，区分已有工作和本轮改动。未跟踪文件也可能是用户正在做的功能，不得删除或重写。
- 优先最小改动与已有模式。不为了“优化”重写整个项目、统一无关格式、替换技术栈或新增依赖。
- 复杂、跨模块或高风险行为改动，先简述问题证据、方案、边界和验证方法；业务语义明确且权限已有时继续执行。
- 对前端问题沿页面 → store → API → 后端追踪；对后端变更检查响应契约和前端消费者，避免单边修复。
- 修缺陷应有可复现证据和有意义的回归验证。测试应断言用户结果、业务不变量或安全边界，不照抄实现制造通过；不得跳过失败、降低断言或伪造结果。

## 前端体验要求

- 主流程文案、题数、导航、页脚、报告与分享必须使用对应量表的真实口径；内部包 ID、修订号、开发状态等不进入普通用户界面。
- 复用现有视觉风格、组件和样式。改善信息层级、中文可读性、操作反馈、移动端布局及键盘可用性；避免无依据的装饰和动效。
- 有异步请求的页面需要准确的加载、空态、失败、重试、会话失效反馈；“未保存”不得显示成“已保存”，失败不能静默吞掉。
- 关键按钮防重复操作；加载结束、异常与离开页面时正确清理状态。答题回退、刷新恢复和跨设备冲突不能丢失或静默覆盖答案。
- 页面变更按影响范围进行真实浏览器验证，至少覆盖窄屏 320、常见手机 390、桌面 1440 宽度；检查滚动、溢出、遮挡、焦点和主要操作可达性，保留脱敏证据。

## 业务不变量

- 新测固定计分以服务端为权威，前端预览与 Java / TypeScript 共享夹具保持一致。不能为了更容易出类型而修改题目极性、阈值或补齐答案。
- 未作答、明确“说不好”、中间档评分是不同状态；补充题与覆盖不足的处理遵守新测契约。
- `REFERENCE`、`TENTATIVE`、`TIED`、`NEEDS_REVIEW` 分开处理：平分不强行给完整四字母；信息不足不生成有效报告。候选 `cost` 不是概率、准确率或匹配率。
- `dynamics` / `processPlan` 是从字母推导的结构，不是额外测量；保留 `basis` 和框架限制说明，`TIED` 时不推导。
- 测评用于自我探索参考，不是诊断或官方 MBTI；不得包装成职业、招聘、恋爱配对的判定工具，不混用第三方题目与许可。
- 资源访问必须按当前认证用户校验归属；不能信任客户端传入的 owner/userId。保留 CSRF、会话、安全错误响应及限流边界。
- 草稿遵守 `expectedRevision` 乐观锁与 409 冲突语义，不自动拿新 revision 覆盖别人修改。重复提交遵守幂等语义，同一 attempt 不产生重复报告。
- 报告、内容版本与哈希绑定，不静默用新算法重算旧报告；分享、导出与页面使用一致的报告模型。
- AI 关闭、超时或失败不影响基础测评与固定报告；AI 不得改写固定计分。真实调用、个人数据外发和付费资源使用须有对应授权。

## 内容生成

- 旧量表内容源在后端 YAML；`scripts/gen-fallback-content.mjs` 生成 `frontend/src/content/` 副本，不直接手改生成文件。
- 新测 YAML 源在 `docs/2026-09-16/implementation/content/`；`scripts/convert-jung-content.mjs` 生成后端 JSON，`scripts/gen-jung-fixtures.mjs` 同步共享夹具。
- 题面、计分、报告或内容版本变更前检查契约与历史兼容；已绑定的内容包不得静默替换。生成前先用 `--check` 留基线，改源后再生成并复查 diff。
- `npm test` 与 `npm run build` 的前置脚本会生成旧量表内容；这不等于自动完成新测内容生成与校验。

## 验证与运行

以下是命令入口，按变更风险选择；先检查环境和副作用，不机械地全部执行。

```powershell
# 仓库根目录：只读内容一致性检查
node scripts/gen-fallback-content.mjs --check
node scripts/rewrite-types-content.mjs --check
node scripts/check-type-duplication.mjs
node scripts/convert-jung-content.mjs --check
node scripts/gen-jung-fixtures.mjs --check

# frontend 目录
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# backend 目录，先确认 JDK 21 和测试数据源隔离
# 当前三类真实 MySQL 测试会自动建库/删库，未获授权时明确排除。
mvn.cmd test '-Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT'
```

- 排除上述三类后的结果只能称为相应子集通过。测试新增或配置变化时重新检查数据库副作用；执行完整 `mvn.cmd test` 前必须确认真实 MySQL 测试的授权与目标。
- 测试优先纯逻辑、mock 与一次性内存 H2；H2 通过不等于真实 MySQL 方言、事务、锁和并发验证通过。
- 开发前端使用 `npm.cmd run dev -- --host 127.0.0.1`；API 代理通过 `VITE_DEV_API_TARGET` 配置。后端启动可能自动执行 Flyway、内容登记和后台任务，未经数据库写入授权不得直接启动到现有库。
- Maven 只复制已有 `frontend/dist`，不替你构建前端。验证整站 jar 前先构建前端，再打包并核对静态资源，避免旧 bundle 混入；`build:only`、`-DskipTests` 不是完整测试证据。
- 同时检查命令退出码、完整输出和测试报告；若 `BUILD SUCCESS` 与退出码冲突，查明原因后再下结论。跳过项、未处理异常、未执行的真实浏览器/数据库/AI 验证都要明确报告。

## 权限与交付

- 数据库默认只读。现有数据库的 DML/DDL、建库删库、执行迁移及经接口触发的数据写入，须有用户对具体操作与目标的授权；不以“本地”“测试”或“启动应用”为由绕过。
- 不暴露或写入真实密码、Token、Cookie、恢复码、私钥或连接串；截图、日志、导出和测试证据均需脱敏。配置、鉴权和会话改动额外检查安全影响。
- 不擅自删除、覆盖或丢弃用户已有工作，不执行 reset、提交、推送、发布、部署或外部发送。已有授权在其明确范围内持续有效。
- 最终说明改了什么、解决了什么、实际执行的验证及结果、未覆盖风险；区分源码、构建产物、数据库和运行证据。纯文档修改检查内容、路径和 diff 即可，无需运行整套业务测试。

持续优化任务的启动提示词见 `docs/DSH-持续优化提示词.md`。
