# A34 / A40 闭环（2026-09-22，第 33 轮）

## 0. 结论速览

| ID | 问题 | 处置 | 判别力（撤掉修复→精确红） |
| --- | --- | --- | --- |
| **A34** | `ReportService.submit` 在**覆盖检查之前**就把 `clarification_skipped = 1` 落库 | 已修：落库推迟到「确定要写报告」之后（与 `status='SUBMITTED'` 同事务） | 后端 IT：**1 failed / 2 passed**，失败点正是新用例；还原后 3/3 |
| **A40** | 账号页与对比页的「提示／按钮」间距节奏不一致（`mt-3` = 12px vs `mt-4` = 16px） | 已修：对比页操作组与其错误提示统一到 `mt-3` | 前端用例 + **真实构建产物**浏览器验收：32/32 → 撤掉修复后 **23/32**（9 条精确红，全是 16px vs 12px） |

两条都是「先把现象变成可自动判定的数字」，再谈改法。A34 的动作是**可用性**问题（草稿被锁死），A40 是纯节奏问题（无功能影响）。

---

## 1. A34：覆盖不足的那次「跳过补充题」把草稿锁死了

### 1.1 原记录低估了可达性

backlog 原来的判断是「要真撞上需要覆盖率在 review 与 submit 之间由 ok 变回不 ok」，因此标为「低（当前不可达）」。**这个前提不成立**：

`clarification_skipped = 1` 的写入发生在 `submit` 里**紧接覆盖检查之前**，它与「草稿是否已经进入澄清阶段」无关。也就是说：

- 只要一次提交带了 `clarificationSkipped: true` 而当时覆盖不足 → 写库 1，然后返回 `200 + NEEDS_REVIEW`（**没有报告**）；
- 草稿状态仍是 `BASE_IN_PROGRESS`，所以之后补答主测题**不会**触发 `AttemptService.patchAnswers` 里的 `resetClarification`（那条只在 `CLARIFICATION_IN_PROGRESS` + 改主测答案时才清标记）；
- 用户补完主测题、求澄清、老实答完补充题，再交卷（这次没选跳过）→ 服务端从库里读到 1，判定「他仍然选择跳过」，撞上
  `400 已选择跳过补充题，就不应该再有补充题答案`；
- 而第一次提交**没有产生报告**，用户也无法靠「从旧报告派生新测评」绕开 —— 这份草稿就此锁死。

所以可达路径只需要「带跳过标记 + 覆盖不足」一次提交，不需要覆盖率来回翻转。

### 1.2 改动

`backend/src/main/java/com/typeme/jung/service/ReportService.java`

- `skipRequested`（请求里是否明确跳过）与 `skipped`（本次提交是否按跳过语义计算）仍在这里算，**但不再落库**；
- 真正的 `UPDATE assessment_attempt SET clarification_skipped = 1` 移到**报告 INSERT 成功之后、`status='SUBMITTED'` 之前**，与它们同事务：要么报告与标记一起生效，要么都不生效。

选这条而不是「多加一个字段记住上一次成功的结果」：本问题的实质是**写入时机**，不是缺状态。新增列会让 schema 与状态机一起变复杂，而修好时序即可。

### 1.3 验证与判别力

新增 `SubmitReportIT#skipChoiceIsNotPersistedWhenTheSubmitProducesNoReport`，走完整用户路径而不是只断言那一列：

1. EI 只答 8 题（低于每维最低题数），其余三维答满 → 覆盖不足；
2. 带 `clarificationSkipped: true` 交卷 → `200 + NEEDS_REVIEW`（响应里 `coverage` 显示 `EI baseRatingCount=8 coverageOk=false`）；
3. 断言库里 `clarification_skipped` 仍为 0；
4. 补完 EI 剩下的题；
5. `POST /review` 拿到安排的澄清维度，把该维度补充题全部答完；
6. 不带跳过标记交卷 → **201** 且 `reportId` 非空。

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 修复态 | `mvn test -Dtest=SubmitReportIT` | **3 passed** |
| 判别力 | 把落库位置改回「覆盖检查之前」 | **1 failed / 2 passed**，失败点：`覆盖不足的提交没有产生报告，草稿必须保持「还没决定跳过」的样子 —— Expecting value to be false but was true`（`SubmitReportIT.java:124`） |
| 还原后 | 同上 | **3 passed** |
| 后端全量 | `mvn test -Dtest=*,!AccountSqlDialectMySqlIT,!AiSqlDialectMySqlIT,!ConcurrencyMySqlIT` | **407 run / 0 fail / 0 error / 1 skip**，BUILD SUCCESS |

原始输出：`submit-report-it-fixed.txt`、`submit-report-it-discriminator.txt`。

---

## 2. A40：账号页 / 对比页的间距节奏

### 2.1 先定「哪一边是基准」

把两页里同一角色的元素摊开看，账号页自己的表单反馈一直是 `mt-3`（12px）：

| 位置 | 账号页 | 对比页（改前） |
| --- | --- | --- |
| 提示 → 紧随其后的操作 | `caption / notice-success / notice-error` + 按钮都是 `mt-3` | 操作组 `mt-4` |
| 操作 → 它的结果提示 | `notice-*` 用 `mt-3` | 错误提示 `mt-4` |

所以改的是对比页这一侧，方向是「向账号页的既有节奏靠」。分节之间的大间距（`mt-5 / mt-6 / mt-8`、卡片与区块）不动 —— 那是层级间距，不是本节说的"提示与按钮"。

### 2.2 改动

`frontend/src/views/CompareView.vue`：操作组 `mt-4` → `mt-3`；比较失败提示 `notice-error mt-4` → `mt-3`。两处都写了注释说明节奏规则，避免后人又改回去。

### 2.3 验证

**① 组件层**（`compareView.spec.ts` 新增 1 条，10 passed）：断言操作组与错误提示都落在 `mt-3`、不是 `mt-4`。撤掉修复 → **1 failed / 9 passed**，`expected 'mt-4 flex flex-wrap items-center gap-2' to contain 'mt-3'`。

**② 真实构建产物 + 真实浏览器**（新脚本 `scripts/browser-verify-spacing.py`）：

- 用 `frontend/dist`（真实构建产物，Tailwind 已产出/裁剪）自带静态服务；
- 打桩 `/api/**`（本项只看布局与 CSS，与后端行为无关；A34 的后端行为由上面的 IT 在真实 HTTP 链路覆盖）；
- 在 **320 / 390 / 1440** 三个宽度量：对比页操作组与错误提示的 `marginTop`、账号页「保存昵称」按钮的 `marginTop`、两页是否横向溢出；
- 核心断言是**两页必须相等**（这才是「节奏一致」）。

| 构建 | 结果 |
| --- | --- |
| 修复后 | **32/32 通过** |
| **撤掉修复重新构建** | **23/32**，9 条精确红且全是同一原因：`对比页 16 vs 账号页 12`（三个宽度 × 三条断言），**没有任何一条溢出失败** |

判别力做到了构建产物这一层：它证明的不是「源码里改了个类名」，而是「打出来的 CSS 里这个节奏真的生效了」。

原始输出：`result.json`（32/32）、`result-before-fix.json`（23/32）与 12 张截图（`compare-*` / `account-*` 为修复后，`before-fix-*` 为撤掉修复后）。

---

## 3. 本轮文件清单

源码：

- `backend/src/main/java/com/typeme/jung/service/ReportService.java`（A34）
- `backend/src/test/java/com/typeme/jung/api/SubmitReportIT.java`（+1 用例 + 3 个读数/取题辅助）
- `frontend/src/views/CompareView.vue`（A40）
- `frontend/src/views/compareView.spec.ts`（+1 用例）
- `scripts/browser-verify-spacing.py`（新增，A40 的真实浏览器验收）

证据：

| 文件 | 内容 |
| --- | --- |
| `submit-report-it-fixed.txt` | A34 修复态（3 passed） |
| `submit-report-it-discriminator.txt` | A34 判别力（1 failed / 2 passed，含断言原文） |
| `backend-full-subset.txt` | 后端全量（407 / 0 / 0 / 1） |
| `frontend-full.txt` / `frontend-typecheck.txt` | 前端全量 50 文件 / 1075 条、typecheck 0 |
| `result.json` / `result-before-fix.json` | A40 浏览器验收：32/32 与 23/32 |
| `compare-*.png` / `account-*.png` / `before-fix-*.png` | 320/390/1440 截图（修复后 / 撤掉修复后） |

## 4. 未覆盖与边界

- **A40 的浏览器验收是打桩 API**：它回答「布局与 CSS 是否生效」，不回答「真后端返回真数据时这一页长什么样」。
  真后端的同类走查由 `scripts/browser-verify-compare.py`（第 16 轮）覆盖，本轮未重跑（需要真后端 + 两份完整测评）。
- **截图未经人工目视**：执行环境没有图像输入能力，本轮不声称"看过截图"；断言全部是机器可判定的数字
  （元素存在、有可见尺寸、`marginTop == 12`、`scrollWidth <= clientWidth + 1`）。
- **A34 只覆盖了主测/澄清的 HTTP 路径**，没有覆盖并发下的同一草稿（那条由 `ConcurrencyMySqlIT` 在真实 MySQL 上覆盖，本轮未跑）。
- **`touchesClarification` 变量**（`AttemptService.patchAnswers` 里）只赋值未使用，属于顺手发现的小死代码，本轮**未动**
  （与 A34/A40 无关，避免把无关改动混进来）。
