# 第 31 轮证据：真实全栈（真实 jar + 真实 MySQL）上的 v4 验收

日期：2026-09-22　轮次：第 31 轮（接第 30 轮「阈值方案 B → score-v4」）
范围：本目录只记录**本轮新增**的真实链路证据。第 30 轮的 mock 浏览器证据在
`../2026-09-22-threshold-v4/`，两者不是替代关系。

---

## 1. 为什么还要再做一遍

第 30 轮结束时，v4 的验证是：

| 层次 | 覆盖 |
|---|---|
| 计分政策 / 夹具 | Java `JungScoringPolicyTest`、`JungLegacyScoringRegressionTest`、共享夹具 25 例、前端 `thresholds.spec.ts` |
| 报告构造 | `JungReportCopyBaselineTest`（含磁盘夹具）、`JungReportSchemaTest` |
| 页面渲染 | `scripts/browser-verify-score-v4.py`（**把 `/api/**` 全 mock**） |

缺口是**中间那一段**：没有任何证据证明「真实的 `GET /api/v3/reports/{id}`
真的会下发 `methodology.boundaryDenominator`」。如果后端漏发这个字段，前端
`readScoringPolicy` 会退回缺省值 `2/10`，报告页会显示「每 10 题…」——
而上面三层**全部保持绿色**（mock 版验收喂的是手写 JSON，H2/MockMvc 的用例
只断言包绑定与状态码）。

顺带补上的第二个缺口：第 30 轮的判别力（D1–D4）都在**单元/夹具层**；
本轮把判别力做到了**部署产物层**（改内容源 → 重打包 → 真跑）。

---

## 2. 证据链：三条，各自独立

### 2.1 部署链路（全新库 → Flyway → 内容包落库）

```
Database: jdbc:mysql://127.0.0.1:3306/typeme_r31_e2e (MySQL 8.4)
Successfully applied 10 migrations to schema `typeme_r31_e2e`, now at version v10
内容包已落库：packageId=typeme-jung48-zh-v1 sha256=939232e360a2…
内容包已落库：packageId=typeme-jung48-zh-v2 sha256=9e61f1459725…
内容包已落库：packageId=typeme-jung48-zh-v3 sha256=44fbb3d374f1…
内容包已落库：packageId=typeme-jung48-zh-v4 sha256=a5208fcd387c…   ← 当前默认包
内容包已落库：packageId=typeme-bigfive50-zh-v1 sha256=47a09253ce7a…
量表目录登记：slug=jung48 默认版本=typeme-jung48-zh-v4 主测题数=48 补充题上限=16
```

要点：
- **V1–V10 在真 MySQL 8.4 上从零全部迁移成功**（V10 就是第 28 轮修掉的保留字问题；
  此前它从未在任何库上真正执行过）。
- `JungPackageRegistrar` 一次把 **v1/v2/v3/v4 + 大五** 全部登记，不是只登记当前版 ——
  这是「历史草稿按自己的版本继续」的前提。

### 2.2 API 级真实全栈（16/16）

脚本：`work/r31_e2e.py`（Windows Python，直连 8099 上的真实 jar）
结果：`api-e2e-results.json`

要点（判别力设计）：故意造一份 **v3 与 v4 结论不同**的答卷 —— EI 维
`|S|=3, n=12`：

| | v3 `B(12)=2` | v4 `B(12)=4` |
|---|---|---|
| EI 是否「略偏」 | 否 | **是** |
| 整份报告状态 | REFERENCE | **TENTATIVE** |

于是「后端跑的是不是 v4」由**报告状态本身**证明，而不是靠断言某个字段存在。

12 条关键断言全部通过，其中最能说明问题的是：

```
PASS  整包接口下发的边界口径是 2/5（不是 2/10） :: {'version':'typeme-jung48-score-v4',
      'minBaseRatingsPerDimension':9,'boundaryNumerator':2,'boundaryDenominator':5,...}
PASS  v4 下 EI（|S|=3 <= T(12)=4）被安排补充题 :: review={"status":"CLARIFICATION_IN_PROGRESS",
      "clarificationDimensions":["EI"],...}
PASS  报告状态是 TENTATIVE —— 这正是 v4 与 v3 的分歧点（v3 会同卷判 REFERENCE）
PASS  报告 methodology.scoringVersion = typeme-jung48-score-v4
PASS  报告 methodology.boundaryNumerator / boundaryDenominator = 2 / 5
```

### 2.3 真实浏览器（19/19）

脚本：`scripts/browser-verify-real-stack-v4.py`（新增）
结果：`browser-results.json`、4 张全页截图

真实路径：注册（真实邀请码 + 真实 CSRF + 生产档 PBKDF2）→ 选择页点「开始」→
逐题作答 47 题 + 第 48 题 → 跳过补充题 → 交卷 → 读报告页 → 三档宽度。

```
PASS  真实后端把这份草稿绑到 typeme-jung48-zh-v4 :: typeme-jung48-zh-v4
PASS  能连续作答到主测结束 :: 实际 47 题
PASS  交卷后进入报告详情页 :: .../#/reports/deeea6fa-…
PASS  真实后端下报告页写明 v4 口径「有效作答每 5 题」
PASS  真实后端下报告页没有退回缺省口径「每 10 题」
PASS  320/390/1440 宽无横向溢出
PASS  320/390/1440 宽阈值文案仍是「每 5 题」
PASS  整页没有未捕获的前端异常
```

> 说明：截图是**机器几何断言**（元素存在 / 横向不越界 / 文案包含关系）的产物，
> 本报告不声称对图片做过目视审阅。

---

## 3. 部署产物层的判别力（改回去 → 精确红 → 还原）

| # | 变异 | 期望 | 实测 |
|---|---|---|---|
| D5 | `typeme-jung48-zh-v4.json` 的 `boundaryDenominator` 5 → 10（**重打包 + 重启**，包哈希变成 `4923071243f5…`） | API 级验收红 | **12/16，4 条精确红**；其中 `报告状态` 由 TENTATIVE 翻成 **REFERENCE**，`review.clarificationDimensions` 变成 `[]` |
| D6 | 同上，跑真实浏览器验收 | 浏览器级验收红 | **14/19，5 条精确红**（主文案、缺省文案、320/390/1440 三档） |

D5 的 4 条红：

```
FAIL  整包接口下发的边界口径是 2/5（不是 2/10） :: boundaryDenominator: 10
FAIL  v4 下 EI（|S|=3 <= T(12)=4）被安排补充题 :: clarificationDimensions: []
FAIL  报告状态是 TENTATIVE :: REFERENCE
FAIL  报告 methodology.boundaryNumerator / boundaryDenominator = 2 / 5 :: {...10}
```

**还原**：内容源从 `work/v4-baseline/pkg.json` 覆盖回来（`boundaryDenominator: 5`），
重打包重启后 `评估包已落库 … sha256=a5208fcd387c…`，API 级 **16/16**、
浏览器 **19/19** 两个脚本各自复跑回到全绿。

判据不是「还原后没红」，而是「变异时红的位置和原因都对得上」。

---

## 4. 过程中发现的两件事（都不是产品缺陷）

### 4.1 注册 IP 限流会挡住重复验收（已写进脚本注释）

第一次跑浏览器验收时卡在注册页 40s。直接探接口：

```
status 429 {"code":"RATE_LIMITED","message":"注册请求太频繁，请稍后再试。",
            "details":{"retryAfterSeconds":2370}}
```

这是**产品正确行为**（注册按来源 IP 固定窗口限流）。问题在验收侧：同一条脚本
连跑几次就会被自己的历史请求挡住，红的原因与代码无关。处置：脚本启动时
**只删隔离库里 `register:%` 这一个桶**（`clear_register_rate_limit()`），
不碰别的库、不动登录/找回的计数。

### 4.2 `/assess` 已经是**选择页**，不再是「进去就建一份草稿」

按旧的假设（第 30 轮 mock 脚本与 2026-09-17 的 flow 脚本里是同一套）直接跳
`/#/assess` 会停在原地不建测评。真实路径是在选择页点 `[data-start='jung48']`。
这是多量表之后的既定改动（路由注释里写了原因），验收脚本已按真实路径改。

---

## 5. 必须单独说明的一件事：`typeme_dev` 被迁移了

第一次起 jar 时我用 WSL 的 `export` 传 `TYPEME_DB_URL`，**WSL→Windows 互操作默认不透传
自定义环境变量**，于是 jar 拿到了 `application.yml` 的默认值 `typeme_dev`：

```
Migrating schema `typeme_dev` to version "9 - invitations and user ai limit"
Migrating schema `typeme_dev` to version "10 - illustration asset"
Successfully applied 2 migrations to schema `typeme_dev`, now at version v10
```

也就是说 `typeme_dev` 上**已应用 V9/V10 并登记了 v1–v4 + 大五**。
这是在「全部授权」范围内（用户已授权对现有库执行迁移与写入），且结果与「待执行的部署步骤」
一致；但**它不是我的本意**，所以在此显式记录，并核对过没有破坏既有数据：

| 指标 | 迁移前 | 迁移后 |
|---|---|---|
| `assessment_attempt` | 9 | 9 |
| `assessment_report` | 5 | 5 |
| `flyway_schema_history` | V1–V8 | V1–V10 |
| `assessment_package` | v1/v2 + bigfive + `pkg-1` | 追加 v3、v4 |

后续所有验收都改到**隔离库**（`typeme_r31_e2e` / `typeme_r31_disc`），跑完已
`DROP DATABASE`；`typeme_dev`、`typeme_show`、`typeme_test` 未被继续改动。

---

## 6. 交付状态

| 项 | 状态 |
|---|---|
| 本轮新增脚本 | `scripts/browser-verify-real-stack-v4.py`；固定装置 `work/r31_e2e.py` |
| 证据 | 本目录（`browser-results.json` + 4 PNG + 2 份 results.json） |
| 产物 | `frontend/dist` 重建 + `backend/target/typeme-backend-1.0.0.jar`（含 v4 内容与 V10 迁移） |
| v4 落库 | 隔离库（已删）+ `typeme_dev`（见 §5） |
| 未做 | 未提交、未推送、未部署；未跑 3 个真实 MySQL IT（本轮无关）；真人试测仍缺 |
