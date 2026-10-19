# 第 96 轮 · 320 / 390 / 1440 页面复核 + 两处环境依赖的假红（2026-10-18）

## 起点：完整套件并不是真的全绿

先跑基线（`JAVA_HOME=jdk-21`，排除 3 个会建/删真实 MySQL 库的 IT）：

| 项 | 命令 | 结果 |
|---|---|---|
| 前端 typecheck | `npm.cmd run typecheck` | exit 0 |
| 前端全量 | `node node_modules/vitest/vitest.mjs run` | **1 failed / 1242 passed**（60 文件） |
| 后端全量（排除 3 个真实 MySQL IT） | `work\run-backend-tests.cmd` | **422 run / 1 failed / 0 error / 1 skip**，BUILD FAILURE |

两条红都不是产品行为变坏，而是**验证本身依赖了机器环境**：

1. **前端时区假红**：`bigFiveCompareView.spec.ts` 里用 `2026-09-01T02:00:00Z` 当夹具，断言页面写出「2026 年 9 月」。
   页面按**读者本地时区**显示（`domain/localTime.ts`），本机是 `America/Los_Angeles`，那一刻是 8 月 31 日 19:00，
   断言必然失败；在 UTC+8 的机器上则永远是绿的。
2. **后端用户名假红**：完整套件里 `BigFivePlatformIT#unknownWithRatingIsNotDescribedAsTheMiddleRating`
   报 `建草稿必须是 201，实际 401`。日志显示**前一步注册**其实拿到了
   `400 VALIDATION_FAILED / 用户名需为 4–32 位字母、数字或下划线`：
   `uniqueUsername("bigfive_unknown_rating")` 生成的是 `bigfive_unknown_rating_111900_136`（**34 位**）。
   登录没建立，后面的建草稿自然是 401。单独跑这个类却是 15/15 —— 因为后缀长度随 `nanoTime % 1_000_000` 的数字位数变化。

## 改了什么

| 位置 | 改动 |
|---|---|
| `frontend/src/views/bigFiveCompareView.spec.ts` | 时间夹具改成 UTC **正午**（`2026-10-14T12:00:00Z` / `2026-09-01T12:00:00Z`），并写明原因：页面按读者本地时区显示，夹具不能依赖跑测试的机器时区 |
| `backend/src/test/java/com/typeme/account/AccountIntegrationTestBase.java` | `uniqueUsername` 改为「序列号 + 时间种子（36 进制、取绝对值）」后缀；**前缀过长时截断前缀**，总长压到 32 以内；`nanoTime` 取模后取绝对值，避免负号进用户名 |
| `backend/src/test/java/com/typeme/account/UniqueUsernameTest.java`（新） | 3 条回归：长前缀 × 多组序列/种子仍满足 `AccountFieldRules.USERNAME_PATTERN`；截断后仍不撞名；短前缀保留、负种子不产生非法字符 |

`USERNAME_MAX = 32` 在测试基类里与 `AccountFieldRules` 的规则再写了一遍 —— 这里是**规则的下游消费者**，
基类注释写清了原因，并由上面 3 条测试钉住，不靠注释维持。

## 真实浏览器复核（第 46–95 轮页面改动的补验）

`docs/optimization/verification/2026-10-18-round96/browser_check.py`：
构建 `frontend/dist` → 静态托管 `127.0.0.1:5191` → Playwright 拦截**全部** `/api/v3/**`（合成账号、合成报告、不连后端、不写库）。

覆盖 7 个页面状态 × 320 / 390 / 1440：

| 页面 | 钉住的行为 |
|---|---|
| 首页（十六型草稿） | 续答说明是「已答 10/48 题」、首屏量表名/题数、四个维度、结果示例仍在 |
| 首页（大五草稿） | 进度按 9/50 写且不称「主测」、折叠标题按大五、五个方面、来源说明为 IPIP-50、**不出现**十六型报告预览/结果示例 |
| `/assess` 开始页 | 补充题草稿写「补充答题中 · 主测 48 / 48」，不写「48 / 48 题」、不出现内部状态码、两个量表都能开始 |
| `/reports` 列表 | 三行都在、并列写「几个方向并列」、大五行是「五个维度」且链到 `/reports/big-five/…` |
| `/reports/compare` | 两边都没方向时写「都没有给出方向」，不写「方向一致」 |
| 十六型答题页 | 五档都在、「说不好」独立按钮、未作答没有被伪选中的档位、中间档写「两边差不多」 |
| 大五答题页 | 题干用「从「非常不符合」到「非常符合」」、不再出现「贴切」、「说不好」与中间档分开说明 |

每页同时断言 **无横向溢出** 与 **无未捕获异常**（控制台里管理员探针的 403 单独收集，不算页面异常），
每个宽度存一张首屏截图。

**结果：159 / 159 通过，exit 0，未登记接口 0。**

## 真实栈走查：真浏览器 + 真 jar + 真 MySQL（隔离库）

用户要求"真实在浏览器测试"后补做的一组（`real_browser_check.py`）：**不拦截任何 `/api`**。

环境：`frontend/dist` 重新构建 → `mvn -o package -DskipTests` 重打 jar →
新建隔离库 `typeme_r96_e2e`（Flyway V1–V10 全部从零应用成功，登记 v1–v4 与大五）→
jar 跑在 `127.0.0.1:8097` → Playwright 用真实表单注册（隔离库里插一行邀请码）、真实 CSRF 与会话。

流程：注册 → 发现页（两项测评、公共目录口径）→ 选择页 → 建 v4 草稿 → 答 5 题回首页看到「已答 5/48 题」→
续答 → 答完 48 题 → 跳过补充题 → 报告页 → 历史列表（仅十六型）→ 大五 50 题 → 大五报告（五个方面）→
历史两行按种类分流 → 两份交卷后首页不再续答。报告页与大五报告各做 320 / 390 / 1440 宽度检查。

**结果：40 / 40 通过，exit 0。**（`real-browser-result.json`、`real-browser-shots/` 11 张截图）

### 这一步抓到的真缺陷（A149，P0）

点「跳过补充题，直接交卷」后，隔离库里 attempt 已是 `SUBMITTED`、报告已是 `TIED`，
**浏览器却停在 `/#/assess/{id}`**：没有错误横幅、没有对话框，只有一条"已选择跳过补充题"的读屏播报。

根因：`assessmentV3.submit()` 把 `SubmitResponse.status`（**报告状态**：REFERENCE / TIED / …）
写进了 store 的 `status`；而 `AssessView.protectDeparture()` 只认 `status === 'SUBMITTED'`。
`await router.push(报告页)` 时离页守卫看到 `status` 不是 SUBMITTED、`submitting` 又仍为 true，
返回 false —— Vue Router 的 `push` **不抛错**，导航被静默取消。

修法：`submit()` 写回测评状态 `this.status = result.reportId ? 'SUBMITTED' : (result.status || this.status)`，
并新增 `assessView.spec.ts`「正常交卷（有报告编号）后进入报告页」。
判别力：改回旧写法 → 精确红 1 条（`expected 'REFERENCE' to be 'SUBMITTED'`），还原后 44/44。

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `frontend: npm.cmd run typecheck` | exit 0 |
| `frontend: node node_modules/vitest/vitest.mjs run` | **60 文件 / 1244 条通过**，exit 0 |
| `frontend: npm.cmd run build` | exit 0；`postbuild` 产物地址检查通过 |
| `backend: mvn.cmd test -Dtest=UniqueUsernameTest` | **3 / 0 / 0**，BUILD SUCCESS |
| 判别力：把 `uniqueUsername` 临时改回旧实现 | 同一条命令 **2 failed / 1 passed**（长前缀、负种子两条精确红），还原后 3/3 绿 |
| 判别力：把 `submit` 状态写法改回旧实现 | `assessView.spec.ts -t 正常交卷` **1 failed / 43 skipped**，还原后 44/44 |
| `backend: work\run-backend-tests.cmd`（排除 3 个真实 MySQL IT） | **425 run / 0 failed / 0 error / 1 skip**，BUILD SUCCESS（本轮新增 3 条） |
| `python …/browser_check.py`（合成接口，320/390/1440） | **159 / 159，exit 0** |
| `python …/real_browser_check.py`（真 jar + 真 MySQL 隔离库） | **40 / 40，exit 0** |
| 图片 | `shots/*.png` 21 张 + `real-browser-shots/*.png` 11 张 |

## 边界与未覆盖

- 合成接口那一组是 **Playwright 拦截后的响应**：覆盖页面状态，不覆盖真实会话；
  真实栈那一组才是真的注册/作答/交卷/写库，但只跑在**新建的隔离库**上，跑完即删。
- **截图未做人工目视**（当前模型不接受图像输入）：以 DOM 断言、`scrollWidth`/`clientWidth` 溢出检查替代。
- **没有跑 3 个真实 MySQL IT**（`AccountSqlDialectMySqlIT` / `AiSqlDialectMySqlIT` / `ConcurrencyMySqlIT`）。
- 没有触碰 `typeme_dev` 或任何现有库；未部署、未提交。
- `frontend/dist` 与 `backend/target/typeme-backend-1.0.0.jar` 已由本轮重新构建（本地产物，未发布）。

## 事故记录：`docs/optimization/backlog.md` 的 120–138 行

本轮用 PowerShell 的 `Get-Content | Set-Content` 给 backlog 做一次字符串替换时，把整份文件写成了乱码
（UTF-8 字节按 GBK 解码）。其中第 1–119 行与 139–242 行已从原始输出（工具 stdout 日志、`read` 结果）**逐字恢复**；
原第 120–138 行（A76–A83）无法逐字还原，已按 `progress.md` 第 30/31 轮记录重述并在文件中标注。
教训：中文文件一律用 `edit` / `write` 工具，不用 PowerShell 文本管道做原地改写。
