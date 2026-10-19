# 第 98 轮 · 修复审查发现：比较页「一侧无方向」与交卷状态拆分（2026-10-18）

## 起点

第 97 轮后的整体审查（只读）发现 1 个 Important 问题，并把一处残余风险收口：

- **IM-1**：比较页在「某一维只有一份报告给出方向」时标成 **方向不同**；
- **残余风险**：`POST /attempts/{id}/submit` 的 `status` 同时承载「报告状态」与「测评状态」，
  A149 正是由此触发，契约却没写清。

## 改了什么

### 1. 比较页不再把「一侧无方向」写成「方向不同」

| 层 | 改动 |
|---|---|
| 后端 | `ReportService.directionChanged()`：只有**两侧都有方向且不同**才算 `changed`。此前 `!Objects.equals(fromPole, toPole)` 在一侧为 null 时也返回 true（[ReportService.java:485](backend/src/main/java/com/typeme/jung/service/ReportService.java#L485)） |
| 前端 | 比较表新增「一侧没有给出方向」分支，排在 `row.changed` 之前（[CompareView.vue:396](frontend/src/views/CompareView.vue#L396)） |
| 测试 | 后端 `ReportServiceCompareDirectionTest` 2 条；前端 `compareView.spec.ts` 新增 1 条「changed=true + 一侧为空」的防御用例 |

### 2. 交卷响应的 `status` 与 `reportStatus` 拆分

- `status` 只表示**测评状态**（`SUBMITTED` / `NEEDS_REVIEW` / `INCOMPLETE`），与其他 attempt 接口一致；
- 新增 `reportStatus` 表示**报告状态**（`REFERENCE` / `TENTATIVE` / `TIED` / `PROFILE`），没有报告时为 null；
- 覆盖两套 DTO（`JungDtos.SubmitResponse`、`PlatformDtos.SubmitResponse`）与全部 9 个构造点；
- 前端 `SubmitResult` 增加 `reportStatus`，store 不再用 `reportId` 猜状态；
- 契约 `02-数据模型与API-v1.md` 的交卷行写明两个字段；
- 测试：`SubmitReportIT` 断言 `status=SUBMITTED`、`reportStatus` 非空；覆盖不足时 `reportStatus` 为 null；
  `BigFivePlatformIT` 三处断言同步；前端 `v3Assessment.spec.ts` 增加成功交卷的字段拆分用例。

## 验证

| 项 | 结果 |
|---|---|
| `frontend: npm.cmd run typecheck` | exit 0 |
| `frontend: vitest run` | **60 文件 / 1246 条通过** |
| `backend: mvn test`（排除 3 个真实 MySQL IT） | **427 run / 0 failed / 0 error / 1 skip**，BUILD SUCCESS |
| 判别力（IM-1）：把 `directionChanged` 改回旧写法 | `ReportServiceCompareDirectionTest` **1 failed**（`E` vs `null` 被当成变化），还原后 2/2 |
| 判别力（状态拆分）：成功交卷把 `status` 改回报告状态 | `SubmitReportIT#submitCreatesReportWith201AndIsIdempotent` **1 failed**（`expected: "SUBMITTED"`），还原后 4/4 |
| 前端 build / `mvn -o package` | 均成功；jar 内是本轮产物 |
| **真实栈**：真 jar + 真 MySQL 隔离库 + 真 Chromium，不 mock `/api` | **17 / 17** |

### 真实栈构造（`real_stack_compare.py`）

- A：EI 全选中间档（该维平分、无方向），其余三维指向正极；
- B：四维都指向正极。
- 结果：交卷响应 `status=SUBMITTED`、`reportStatus=TIED` / `REFERENCE`；
  比较接口 EI `changed=false`；页面上 EI 行写「一侧没有给出方向」，**不**写「方向不同」；SN 行写「方向一致」。

证据：`real-stack-result.json`、`shots/compare-one-side-missing-390.png`。

## 边界

- 未跑 3 个真实 MySQL IT；未部署；隔离库跑完即删；未触碰 `typeme_dev`。
- 截图未人工目视（当前模型无图像输入）。
