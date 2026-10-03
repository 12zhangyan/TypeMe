# 真实上游 401 验收：AI 失败时界面说什么、固定报告受不受影响

- 被验收地址：`http://127.0.0.1:5176`（后端 `TYPEME_AI_MOCK_MODE=false` + 一把**故意写错**的 key）
- 使用账号：`r19ai_fb25e982`（一次性合成账号，密码未记录）
- 结论：**PASS**（PASS 21 / FAIL 0 / SKIP 0）
- 后端进程：10:24:58 启动，**已包含第 19 轮全部 Java 改动**（201 交卷状态码、A53② 配额语义、
  A53⑤ 并发注销、A57 清理任务），所以这一次浏览器验收里的"答满 → 交卷 → 报告"
  走的也是 `201 Created` 那条新路径；数据源是一次性 H2 内存库。
- 复跑方式：

  ```powershell
  $env:TYPEME_BACKEND_LOG='output/r19-final-backend-8111.log'
  python scripts/browser-verify-ai-upstream-failure.py
  ```

## 这次是真的打到上游了

- 后端没有开 mock：`TYPEME_AI_MOCK_MODE=false`，`TYPEME_AI_API_KEY` 是一把不存在的 key。
- 于是 worker 真的向 `https://api.deepseek.com` 发起请求，上游在鉴权阶段就返回 401。
- 发出去的内容是**这个一次性账号的合成报告**（48 题全选同一档），没有任何真实用户的个人数据；
  401 不产生费用，也没有任何模型输出被采纳。
- 任务详情里 `errorCode=UPSTREAM_401`、`mock` 不是 true —— 这两点由脚本直接问服务端拿到，
  不是从界面文字反推的。

## 观察记录

- 后端设置行：main] c.t.ai.config.AiRuntimeSettingsProvider  : AI 设置已加载：enabled=true, model=deepseek-flash, apiKeySource=env, mockMode=false, baseUrl=https://api.deepseek.com
- 本次作答选了第 4 档，实际点击「下一题」47 次
- 这份报告的四个维度里至少有一维打平，按契约不给四字母类型码（本轮不据此断言）
- 报告页：#/reports/0234b674-21d3-36eb-9f7a-d5dda04a9d37
- 任务详情：status=FAILED errorCode=UPSTREAM_401 mock=False

## 截图

- `390x844-report-before-ai.png`
- `390x844-ai-consent.png`
- `390x844-ai-failed.png`
- `390x844-ai-retry.png`

## 判据

- **失败必须落成 FAILED**：不能一直转圈，也不能静默消失。
- **原因必须来自服务端分类**：`errorCode=UPSTREAM_401` 是服务端的判断；
  界面文案必须说「密钥无效/过期 + 需要管理员」，而不是「网络问题」或「AI 暂时不可用」。
- **不许有结果**：失败时不能显示 `data-ai-result`，也不能出现 mock 标记。
- **固定报告不受影响**：报告概览文本与分享文本在 AI 失败前后必须完全一致
  （类型码可能因为某一维打平而**合法缺席**，不拿它当锚点）。

## 诚实交代

1. 这是**故意制造失败**的验收：真实上游成功生成那条路径由第 14 轮的真实调用与
   第 17 轮的 mock 流程分别覆盖，本轮不复验。
2. 上游返回 401 的具体原因（key 无效）由**我们提供的 key 决定**，不是上游故障；
   这条验收证明的是「上游拒绝 → 服务端归类 → 界面表达」这条链路，不是上游的可用性。
3. 重试那一条只断言「重试被接受」，没有等它第二次失败（会再打一次上游，没有必要）。
4. 弱网/超时/429/截断等其它错误分支仍然只有 mock 证据。
