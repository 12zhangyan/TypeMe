# 历史报告 AI 提示词增强（2026-09-21）

用户目标：分析更深入、更个性化，建议可操作。

## 改动与生效范围

- 新增 `backend/src/main/resources/ai/prompts/typeme-ai-prompt-v4.txt`，v1/v2/v3 文件保留原文。默认配置改为 v4，管理员设置和环境变量显式指定的版本仍优先；本轮没有更改现有数据库或部署实例。
- v4 要求围绕选定主题、用户自述和本次维度证据，解释适用场景与可能代价；综合维度只提出待核对假设，不生成测得的因果关系。四个主题有不同的切入点。
- 行动包含具体做法、触发场景、低成本时长与可观察结果；不再满足于“多沟通、提升自己”等口号。正文目标由 250–450 字调整为 450–700 字，证据不足不凑字数，各字段原长度限制仍生效。
- 保留轻微倾向、平分和大五维度信息不足；历史快照不能用于断言当前人格或变化趋势。用户自述、假设情境与测量证据须区分。
- v3/v4 共用 `analysis-readable-v2` 与 `typeme-ai-scope-v3`。发送范围没有新增字段，不发送完整答卷、其他报告或身份信息；提示注入、固定计分、类型与证据引用边界继续保留。
- 前后端改为显式登记 v3/v4 可读版本，避免 v4 被错误分流为旧版。请求哈希保留实际提示词版本，因此 v4 新建任务不会复用 v3 的缓存。旧任务执行和重试依旧使用绑定版本；升级后的生成入口按当前配置新建或去重，不批量重算旧报告。
- 保留开始时已有的重新生成入口和服务层改动；本轮只在相关前端文件中补齐版本判断与测试。

## 验证

1. JDK 21，`backend` 下运行：

   `mvn.cmd test '-Dtest=SystemPromptTest,PromptFileContractTest,PromptVersionClassificationTest,ReadableAnalysisTest,ReportInputBuilderTest,ReportAnalysisValidatorTest,AnalysisFlowTest'`

   实际匹配并执行 6 个测试类、68 项，失败/错误/跳过均为 0，退出码 0。仓库没有名为 `ReportAnalysisValidatorTest` 的类；输出校验由 `ReadableAnalysisTest` 等实际执行的用例覆盖。测试使用纯逻辑、mock 客户端与一次性内存 H2，未运行真实 MySQL 测试。

   新增回归覆盖：两量表及历史报告外壳的 v3/v4 输入一致、版本各自绑定、去重哈希分离；排队后配置切换仍发送原版本提示词并接受原输出契约。

2. `frontend` 下运行：

   `npm.cmd exec -- vitest run src/components/aiAnalysisPanel.spec.ts src/stores/aiAnalysisV3.spec.ts src/api/v3Ai.spec.ts`

   3 个文件、42 项通过，退出码 0。覆盖 v3/v4 大五入口、确认范围、创建请求发送范围与既有结果读取。一个列表读取失败用例会按预期记录模拟的 `boom` 错误，测试通过。

3. `npm.cmd run typecheck`：退出码 0。

4. `python scripts/browser-verify-ai-prompt-v4.py`：50 项检查通过，退出码 0。使用当前 Vite 源码、合成报告、全量 API 拦截，并阻断外部请求。检查 320/390/1440 宽度下十六型与大五历史 v3 结果阅读、v4 生成入口、发送范围、勾选确认、键盘操作和横向溢出。机器结果见 `browser-results.json`，截图为 `consent-*.png`；已目检 320 宽度大五确认页截图。首次脚本遗漏插画目录请求，补齐模拟响应后完整复跑通过。

5. `git diff --check` 通过；v1/v2/v3 提示词文件与 Git 基线无差异。

## 限制

没有真实模型调用、现有数据库写入、生产部署或整站打包。上述验证证明版本接入、兼容性和页面行为，不证明模型必然遵循提示词或实际文案质量已提升；真实分析质量仍需经授权后使用脱敏样例验收。若现有管理员设置固定在 v3，需发布代码后显式选择 v4 才能用于新生成。
