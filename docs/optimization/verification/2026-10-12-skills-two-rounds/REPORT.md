# TypeMe 两轮 skill 实用优化与验收（2026-10-12）

## 范围与版本

本轮从 TypeMe f04ecc4cba12089d9ceadf36ee2758e31b185f4c 工作区开始；已跟踪业务文件初始无改动，已有未跟踪日志及文档全部保留。两轮均使用 yan-code-review 的单 Agent loop：check → 已证实 findings 的 repair → 验证与复审。过程中按 skill-creator 修正技能参考并重新安装。没有提交、推送、部署或数据库操作。

skill 集合工作区基于 b0babc9a8260dae1921f1b835426c7e22a58fe06；2026-10-12 通过现有系统代理实时核对远端 main 为 063a09a7e6f86b21d52d1fa6cf4c2ea9ce7c0d6d，且已被本地 HEAD 包含。安装包含仓库原有未提交更新和本轮修正；不能只用提交号区分两次安装，逐文件指纹见 skill 仓库的安装审计。

## 第一轮：测评入口恢复与导航

- IM-1：目录加载失败时误报量表不存在，并提前消费自动开始标记；目录重试成功不能继续原目标。同一组件更换量表参数也被旧布尔标记挡住。现在只有目录与草稿成功就绪才处理量表，按实际 slug 记录已处理目标，失败可重试。
- IM-2：创建测评请求尚未完成时离开页面，迟到成功会跳回答题页。现在确认组件仍存活且路由仍是发起位置后才导航或显示该次错误。已经发到服务端的创建请求不会被回滚。
- 文件：frontend/src/views/AssessChooserView.vue、assessChooserView.spec.ts。
- 旧实现新增 4 项回归全部失败；修复后该文件 14/14 通过。第一次浏览器验收 20/20，通过 320、390、1440 宽度、键盘重试、无重复创建与迟到响应后的导航检查。

## 中间修正 skill 并重装

实用中专项参考没有具体覆盖跨页面/会话的异步归属；最初的单测夹具又直接卸载整个路由宿主，导致宿主重置干扰断言。按 skill-creator 仅在行为测试与浏览器验收的条件资源补充：保持真实路由/状态宿主，用可控延迟验证旧成功、错误和清理回调，观察当前身份、页面以及请求次数。新增两个结果导向的 repair eval 场景；公共入口与加载路径保持原模式。

执行维护安装器重新安装到用户共享目录，再读取安装后的修订参考应用于第二轮。Windows 下 skill-creator 的 quick_validate 默认 GBK 解码失败，改用 python -X utf8 后通过，未修改系统技能或全局 Python 设置。

## 第二轮：请求与会话隔离

- IM-3：A 请求返回前退出并登录 B，旧 401 能清除 B；旧 CSRF 错误会按 B 的 cookie 自动重发 A 的写入；等待 token 的旧写入也可能在换号后才发出。请求层现在记录会话修订号，在发送、自动重试、响应/正文完成时校验归属；过期请求以 SESSION_CHANGED 结束，不触发新会话失效。
- IM-4：迟到的个人资料或导出正文可能被交给新账号；旧动作 finally 会提前清除新登录的 busy。会话变化后拒绝旧正文，auth 不采用旧错误，busy 只由所属操作结束。
- IM-5：目录 reset 没有解除旧 loading，导致新账号无法立即重载；旧结果和 finally 也会覆盖当前状态。目录读取增加 generation，reset 解除 loading 并失效旧回调。
- CSRF 缓存清理同时失效在途获取；旧 token 响应及 finally 不再污染新缓存或移除新请求的合并状态。
- 文件：frontend/src/api/v3.ts、csrf.ts、sessionIsolation.spec.ts、frontend/src/stores/auth.ts、instrumentsV3.ts。
- 核心 9 项测试旧实现 8 失败、1 项当前会话 401 正常失效的对照通过；继续沿调用方补充导出、目录与 CSRF 清理检查，最终该文件 12 项通过。旧构建浏览器也真实复现 B 登录后被旧 401 送回登录页，见 round2-browser-before.log。

## 最终验证

| 命令/证据 | 结果与证明范围 |
|---|---|
| npm.cmd test（frontend） | 57 个文件、1197 项全部通过；round2-full-tests.log |
| npm.cmd run typecheck | 通过；round2-typecheck.log |
| npm.cmd run build | 含 vue-tsc、Vite 和资源地址检查，退出 0；round2-build.log |
| python -X utf8 scripts/browser-verify-skills-two-rounds.py --round all | 构建产物 + Chromium；三种宽度共 44 项通过，0 pageerror、0 未声明 API；roundall-browser.json 与截图 |
| 最终 26 项相关用例运行在隔离副本的原实现上 | 15 失败、11 通过，失败来自目标业务断言；isolated-before-regressions.log。未替换或回滚用户工作区 |
| git diff --check | 无空白错误；本轮创建的新文件仍未纳管，未擅自 add |

浏览器只替换网络边界并从页面控件操作，没有注入 store 或修改 DOM 伪造成功。测试账号与响应全为合成数据，外部网络被阻断。上述结果证明前端请求发出、状态隔离、重试与导航行为，不证明真实后端鉴权、MySQL 事务/持久化、跨标签页 Cookie 变化或生产部署。当前任务的问题位于前端，因此未使用所授权的本地数据库，也未启动可能执行迁移的后端或发起真实 AI 调用。

## 文件边界

新增回归：frontend/src/api/sessionIsolation.spec.ts；新增可复跑浏览器脚本：scripts/browser-verify-skills-two-rounds.py。本目录包含本轮日志、合成截图与此报告。所有原有未跟踪文件按启动指纹检查保持原字节；没有删除已有文件，两个仓库 HEAD 未变。skill 的独立夹具复测、逐文件安装指纹与本轮增量报告在 dev-workflow-skills/docs/research/2026-10-12-typeme-two-rounds/。

复跑浏览器时，先完成前端构建；在仓库根目录另起终端执行 `python -m http.server 5212 --bind 127.0.0.1 --directory frontend/dist`，再运行上述浏览器命令。此服务仅提供静态构建产物，不连接后端。当前任务启动的临时服务在验收完成后关闭。
