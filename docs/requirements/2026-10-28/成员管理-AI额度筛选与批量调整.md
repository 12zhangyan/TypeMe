# 成员管理：AI 额度筛选与批量调整 需求分析

> 状态：Confirmed ｜ 日期：2026-10-28 ｜ 基线：git main@3789b11（工作区另有与本需求无关的未提交改动） ｜ 澄清轮次：3 ｜ 来源：用户口述第 1 轮（含转述的运营意见），第 2、3 轮答复

## 背景与目标
管理员在「成员」页处理 AI 额度时，只能逐个打开成员档案、逐个保存。目标是能直接找出今天额度已用完的成员，一次给多人调整额度并立即生效，必要时把额度恢复为站点默认。

- 非目标 / 不改变的行为：不改全站默认额度的设置入口、全站 AI 开关和总预算；不改 UTC 日重置规则；不取消正在执行的 AI 请求；不清零今日已用次数；不新增管理员操作记录（Q-2）。

## 功能点

### REQ-1 筛选"今日 AI 次数已用完"的成员（P1）
- 规则："已用完"＝今日已用次数 ≥ 生效额度，且生效额度 > 0；额度为 0 的成员属于主动停用，不算用完（默认采纳，第 1 轮）。"今天"按 UTC 日。筛选覆盖全部成员，不只是当前页。
- 结果：开启筛选后只显示符合条件的成员，"共 N 位"与翻页按筛选结果计算；没有符合者时显示区别于"暂无成员"的空态；可取消筛选回到全部成员。

### REQ-2 勾选当前页成员批量修改每日 AI 额度（P1）
- 规则：只能勾选当前页成员，可"全选本页"，一次最多 20 人（Q-1）。所有选中成员统一设为同一个值，取值与单人一致（0–10000 的整数），不是"每人加 N 次"。列表中可见的成员都可以被修改，包括已禁用、注销处理中和管理员自己。提交前显示"将修改 N 位成员的每日额度为 X"，确认后提交。
- 结果：保存成功后，被修改成员的下一次 AI 请求按新额度判定，今日已用次数保留；调高后已用完的成员当天即可继续使用，调低到已用次数以下时剩余为 0。逐个处理，成功的保留；失败的列出成员和原因并可重试，未保存的不得显示为已保存。

### REQ-3 一键恢复为站点默认额度（P2）
- 规则：恢复默认＝清除成员的单独额度，回到"沿用站点默认"，之后跟随站点默认变化；不是把当前默认数字写成个人额度（默认采纳，第 1 轮）。作用于 REQ-2 的同一批选中成员，同样需要提交前确认。
- 结果：成员显示"沿用系统默认额度"，生效额度等于当前站点默认；今日已用次数保留；本来就沿用默认的成员不报错。

## 现状对照
| 功能点 | 现有行为（路径:行） | 差异与影响 |
|---|---|---|
| REQ-1 | 列表只接受 `page`/`size`，`total` 为全部成员（`backend/src/main/java/com/typeme/account/service/AdminUserService.java:54-68`）；前端固定每页 20（`frontend/src/api/adminMembers.ts:27`），服务端上限 100（`backend/src/main/java/com/typeme/account/service/AdminUserService.java:37`）；今日已用逐行从用量表现算（`backend/src/main/java/com/typeme/account/service/AdminUserService.java:125-129`） | 没有筛选能力；已用次数不在成员表上，只在前端过滤当前页会漏人且总数不准 |
| REQ-1 | 额度日为 UTC（`backend/src/main/java/com/typeme/ai/service/AiBudgetRepository.java:39-40`），页面已说明北京时间 08:00 重置（`frontend/src/views/AdminMembersView.vue:111`） | 口径一致，无需改动 |
| REQ-2 | 只有单人接口 `PUT /admin/users/{id}/ai-limit`（`backend/src/main/java/com/typeme/account/controller/AdminController.java:97`），整类仅管理员可用（`backend/src/main/java/com/typeme/account/controller/AdminController.java:35`）；成员卡片整体是一个打开档案的按钮（`frontend/src/views/AdminMembersView.vue:113`） | 缺批量能力；卡片上没有可勾选的位置 |
| REQ-2 | 每次创建 AI 分析都实时读取并锁定成员额度（`backend/src/main/java/com/typeme/ai/service/AnalysisCreationWriter.java:66`、`backend/src/main/java/com/typeme/ai/service/AnalysisCreationWriter.java:123`）；单人保存保留今日已用（`frontend/src/views/AdminMembersView.vue:93`） | "马上生效"现状已满足，批量需保持同一行为 |
| REQ-2 | 列表已排除已删除账号（`backend/src/main/java/com/typeme/account/repository/UserRepository.java:144`、`backend/src/main/java/com/typeme/account/repository/UserRepository.java:151`），单人接口拒绝已删除成员（`backend/src/main/java/com/typeme/account/service/AdminUserService.java:95`） | 部分失败只在加载后、提交前有人被删除时出现 |
| REQ-3 | `ai_daily_limit` 为 NULL 表示沿用站点默认、0 表示停用（`backend/src/main/java/com/typeme/ai/service/AiBudgetRepository.java:103-104`、`backend/src/main/resources/db/migration/V9__invitations_and_user_ai_limit.sql:2-3`）；页面已区分两种状态（`frontend/src/views/AdminMembersView.vue:119`）；但接口拒绝空值（`backend/src/main/java/com/typeme/account/controller/AdminController.java:93`、`backend/src/main/java/com/typeme/account/service/AdminUserService.java:94`） | 数据模型已支持，但现在没有任何途径把单独额度清回默认 |

## 验收标准
- AC-1（REQ-1）：今日已用 2/2、1/2、0/0 的三位成员分布在不同页 → 开启筛选 → 只出现 2/2 那位，"共 1 位"，翻页按筛选结果。
- AC-2（REQ-1，边界）：没有成员已用完 → 开启筛选 → 显示"没有今天额度已用完的成员"，而不是"暂无成员"。
- AC-3（REQ-1，边界）：UTC 日切换后刷新筛选 → 前一天已用完的成员不再出现。
- AC-4（REQ-2）：在筛选结果页"全选本页"→ 设为 5 并确认 → 这些成员显示"今日已用 x / 5"，其中已用 < 5 的成员下一次 AI 请求成功。
- AC-5（REQ-2，保持）：批量调低到 1，某成员今日已用 2 → 该成员剩余 0、新请求被拒，已用次数仍为 2；正在执行的请求不受影响。
- AC-6（REQ-2，拒绝）：输入空值、小数、负数或大于 10000 → 不提交，提示与单人一致；非管理员调用批量能力 → 被拒绝，任何成员额度不变。
- AC-7（REQ-2，部分失败）：选中 3 人，其中 1 人在提交前被删除 → 另外 2 人保存成功，页面明确列出失败的那位及原因，不显示"全部已保存"。
- AC-8（REQ-3）：单独额度为 5 的成员 → 恢复默认并确认 → 显示"沿用系统默认额度"，生效额度等于站点默认；之后站点默认改变，该成员的生效额度随之改变。
- AC-9（REQ-3，保持）：选中的成员中有人本来就沿用默认 → 恢复默认 → 不报错，今日已用次数不变。

## 待确认问题
| 编号 | 问题 | 影响 | 推荐及依据（含主要备选） | 状态 |
|---|---|---|---|---|
| Q-1 | 批量勾选的范围 | REQ-2、AC-4 | 只勾选当前页，可全选本页；"选中全部筛选结果"留作后续。依据：批量修改不可追溯，范围小、看得见更稳妥，前端分页固定 20 | 已确认：第 2 轮，选 A |
| Q-2 | 是否记录谁改了谁的额度 | 范围（是否新增记录表、迁移和查看页） | 这一期不做，作为已知风险写明。依据：每次影响不超过 20 人且提交前可见；现有单人修改也不留痕。备选：只存不看，或附查看页 | 已确认：第 3 轮，按推荐 |

## 假设
- 默认清单第 1–10 条由用户在第 2、3 轮确认，已写入各功能点的规则；任何一条被推翻时，影响对应的 REQ 和 AC。
- 已知风险：批量修改和恢复默认会覆盖原有单独额度，且没有记录，事后无法查回原值（Q-2）。

## 变更记录
- 第 1 轮：整理三个功能点，提出 Q-1 和默认清单第 1–6 条。
- 第 2 轮：Q-1 选 A；第 1–6 条无异议；核实列表已排除已删除账号，部分失败降为默认项；提出 Q-2 和第 7–10 条。
- 第 3 轮：Q-2 与第 7–10 条按推荐确认；状态改为 Confirmed。

## 下一步
- 需求口径已确认。批量接口形状、筛选的查询方式、"恢复默认"的接口语义、卡片勾选结构等技术决策，建议以本文档为来源交给 `yan-dev-doc` 出方案。
- 本文档未经独立的可实施性检验（本次会话未派子 Agent）。
