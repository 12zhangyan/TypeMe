# 新测（`typeme-jung48`）验收证据

- 验收日期：2026-09-16
- 验收范围：工程实现（后端 / 内容 / 迁移 / 账号 / AI）+ 前端账号与计分
- 相关文档：[`../implementation/README.md`](../implementation/README.md)（实施记录）、
  [`deploy-and-rollback.md`](../implementation/deploy-and-rollback.md)（部署手册）、
  [`mysql-migration-verification.md`](./mysql-migration-verification.md)（迁移专项验证）

> **本文件只记录实际跑过的命令与真实输出。**
> 没跑过的一律标注"未验证"，不写成"应该没问题"。

---

## 1. 后端测试

```
cd backend
$env:JAVA_HOME='D:\develop\jdk-21'
mvn.cmd -o test
```

真实输出（末尾）：

```
[WARNING] Tests run: 242, Failures: 0, Errors: 0, Skipped: 1
[INFO] BUILD SUCCESS
```

- **242 条通过、0 失败、0 错误、1 跳过。**（§10 加入过程层后复验；此前为 213 条）
- **跳过的 1 条是刻意的**，不是失败被掩盖：`AssessmentPackageLoadingTest` 用两条
  **互斥**的 `Assumptions` 覆盖"内容包目录为空"与"内容包目录非空"两种情形，
  实际目录里已有内容包，于是"目录为空"那条跳过。两个分支都有断言覆盖，不存在漏测。
- 相比上一轮（148 条）新增 65 条：账号模块与 AI 模块的补充用例，
  加上**专门为钉住本轮 E2E 找到的 3 个真实缺陷而写的 13 条**（见 §6）：

  | 新增测试 | 条数 | 钉住的缺陷 |
  |---|---|---|
  | `PasswordEncoderParametersTest` | 6 | 缺陷甲（PBKDF2 参数错位） |
  | `JungPackageRegistrarTest` | 4 | 缺陷乙（内容包播种） |
  | `LoginPrincipalCarriesUserIdIT` | 2 | 缺陷丙（主体缺 `getUserId()`） |
  | `AssessmentCreationThroughRealSessionIT` | 1 | 甲乙丙三条接缝一起（走真实会话） |

  这 13 条**全部做过变异验证** —— 把缺陷重新注入，确认它们真的会红。
  没有变异验证的测试不算防线（见 §6.4）。

> ⚠️ Maven 在只有 stderr 输出时也会回 `exit code: 1`，**即使 `BUILD SUCCESS`**。
> 判断成败要看 `BUILD` 行，不要看退出码。
>
> ⚠️ `mvn -Dtest=A+B` 在 surefire 里**不成立**，多个测试类必须用**逗号**分隔。

### 1.1 新增：`JungReportSchemaTest`（10 条）

这一条是本次特意补的，写它的原因值得记下来：契约 §7 曾经与实现**双向不一致**——
文档多写了不存在的 `candidates[].tied`，又漏写了 `selfSelectedTypeCode`、
`typeTagline`、`clarificationApplied`、`details`、`dailySigns` 以及 `share` 的
`imageTitle` / `filename` / `text` / `alt`。前端照着文档写就会在运行时才发现字段不存在。

所以现在把约定**钉成断言**，覆盖：

| 断言 | 钉住什么 |
|---|---|
| 顶层字段名与顺序 | 字段拼错/少一个/多一个都失败；顺序也断言，因为 `reportHash` 是对含顺序的 JSON 算的 |
| `dimensions[]` 四行字段与权威序 | 顺序必须是 `EI,SN,TF,JP` |
| `candidates[]` 字段，且**不得**有 `tied` | 谁平分由顶层 `tiedDimensions` 表达 |
| `share` 字段；`kind` 与 `status` 一致；TENTATIVE 必须有 `boundaryLine` | |
| `boundaries[]` 字段 | |
| `typeSections[]` 的 key / 标题 / 顺序 = 契约八段 | |
| `nextActions` 恰好 3 条 | |
| `methodology` 字段 | |
| TIED：无四字母、不套用类型报告、主标题不含四字母 | 平分时不许制造确定性 |
| **`reportHash` 覆盖除自己以外的每个字段** | 逐字段篡改后断言哈希失配 |

最后一条不是凑数：报告"提交后不可变"这个承诺靠的就是任何人能重算哈希发现自己手里的
报告被改过。**如果哈希漏算了某个字段，改那个字段就不会被发现，而表面上一切正常** ——
这种缺陷除非专门逐个字段去测，否则永远不会暴露。

### 1.2 跨实现夹具（`JungScoringFixtureTest`，4 条）

同一份夹具（18 个用例）由 Java 与 TypeScript 两套**独立实现**各自计算并比对。
任何一侧改坏都会立刻失败。

---

## 2. 前端

```
cd frontend
npm.cmd run typecheck   # vue-tsc --noEmit
npm.cmd test            # vitest
npm.cmd run build       # 含 typecheck
```

| 命令 | 结果 |
|---|---|
| `npm.cmd run typecheck` | **exit 0，零错误** |
| `npm.cmd test` | **17 文件 / 693 条全部通过**（§10 复验；此前为 16 文件 / 584 条） |
| `npm.cmd run build` | **成功**，`dist/assets/index-C3EV3P3G.js 418.12 kB`（gzip 162.37 kB）（§10 复验；此前 `index-CbIUbNlj.js 408.97 kB`） |

其中计分引擎的夹具测试 `scoring.fixture.spec.ts` 单独贡献 **129 条**，
与后端跑同一份数据；新测模块另贡献 `v3Assessment`(9)、`reportV3`(23)、
`assessView`(16)、`reportV3View`(18) 等用例。

> 注意：本仓库 vitest **只收集 `*.spec.ts`**。写成 `*.test.ts` 会被静默忽略
> （表现为"测试文件消失"而不是报错），这一点踩过一次。
>
> 另外 vitest 的输出会被大量 `[typeme] GET /meta 请求失败，已降级到内置副本`
> 之类的**降级日志**淹掉汇总行 —— 这是前端离线兜底逻辑的正常行为（单测环境没有后端），
> 不是错误。**抓汇总行要落盘后再过滤，不要看管道前 25 行。**

---

## 3. 迁移脚本（真实 MySQL + H2 双向）

专项报告见 [`mysql-migration-verification.md`](./mysql-migration-verification.md)，
此处只摘结论。

| 方法 | 结果 |
|---|---|
| Flyway 10.10.0 + mysql-connector-j 8.3.0，空库 `typeme_test` | `Successfully applied 8 migrations, now at version v8` |
| 第二遍（幂等） | `Successfully validated 8 migrations` + `No migration necessary` |
| mysql 8.4 客户端逐文件 `source` 到 `typeme_dev` | 8/8 `exit=0`、零输出 |
| H2 2.2.224 对照 | `migrationsExecuted=8 target=8`，探针结果与 MySQL 逐条一致 |

建出 **15 张业务表** + `flyway_schema_history`，全 InnoDB / 全 utf8mb4；
`PRIMARY KEY 16` / `UNIQUE 6` / `CHECK 12` / `FOREIGN KEY 11`，
每条约束都用非法数据打穿验证过。

### 3.1 这一轮找到并修掉的真实缺陷

**（甲）库默认排序规则把 8 个枚举列的 CHECK 白名单悄悄放宽。**
库默认 `utf8mb4_0900_ai_ci` 是大小写不敏感的，于是
`role='user'`、`computed_type_code='istj'`、`kind='rating'`、`status='in_progress'`、
`api_key_source='ENV'`、`self_selected_type_code='istj'` 等在 MySQL 上**插得进去**，
而同一批值在 H2 上**全部被拒**。修复 = 给这 8 列钉 `COLLATE utf8mb4_0900_as_cs`，
修后两边都返回 `ERROR 3819 Check constraint is violated`。

写法必须是**列定义最末尾的裸 `COLLATE`**。四种候选写法实测：
`CHARACTER SET x COLLATE y` 紧跟类型 → H2 语法错误；
放在 `DEFAULT` 之前 → MySQL 1064；只有末尾裸形式两边都过。

**（乙）`ck_answer_rating` 因 CHECK 的 UNKNOWN 语义放行 `RATING + NULL`。**
实测修复前 `kind='RATING' AND rating IS NULL` 这种自相矛盾的行 INSERT **成功**
（MySQL 的 CHECK 在结果为 NULL/UNKNOWN 时视为通过）。补 `rating IS NOT NULL` 后
返回 `ERROR 3819`。这是本批脚本里唯一受该语义影响的约束（其余判据列都是 NOT NULL）。

> 这两条正是"迁移必须在真实 MySQL 上验"的价值：只跑 H2 会漏掉甲，
> 只跑 MySQL 不会发现乙在两边的差异。

### 3.2 清理与边界

- 全程只在 `typeme_dev` / `typeme_test` 内执行 DDL/DML，全部带库名前缀。
- **未执行**任何 `CREATE DATABASE` / `DROP DATABASE` / `USE`。
- 脚本里也不含这三者（有测试断言拦着）。
- 收尾复核：同一实例上另外 9 个真实业务库的表数量**不变**。

---

## 4. 内容验收（脚本化检查）

内容生成器 `scripts/convert-jung-content.mjs` 在产出前后校验以下各项，全部通过：

| 检查项 | 结果 |
|---|---|
| 题目总数 / 分段 | 64 = 主测 48 + 补充 16 |
| id 唯一 / `order` 连续 | 1..64 连续无缺 |
| 每维题数 | 主测 12、补充 4 |
| 左右平衡 | 主测每维 6:6、补充每维 2:2 |
| facet 覆盖 | EI/SN/JP 各 4、TF 6（均 ≥3） |
| 题面长度 8–24 字 / `help` 25–60 字 | 全部在区间内 |
| 16 型齐备 | 是，8 段 + summary + 恰好 3 条 `nextActions` |
| 每型汉字数 | 八段 1272–1433（要求 1200–1800）；生成器另按 `summary + 八段`字符数校验 [1200, 2000]，实际 1562–1750 |
| 跨类型 ≥20 汉字连续重复 | **0** |
| 禁用词（准确率/概率/百分位/置信/确诊/命中注定/科学证明/MBTI 官方/16Personalities/OEJTS…） | **0 命中** |

**跨类型重复必须机器查**：16 篇各写一遍，最容易出现的就是"换个类型名其余照抄"，
而人眼读第 9 篇时已经记不住第 2 篇了。

---

## 5. 事件记录：题面方向与所标极点相反的 4 道题

审校中发现 **`TF-07`、`TF-12`、`TF-C3`、`EI-C4`** 的文案方向与其声明的极点**相反**。
例：`TF-07` 的 `textLeft` 是"先把要求列出来，再挑合适的做法"（T 味），却被标成 `leftPole: F`。

- **后果**：这 4 题会被**反向计分** —— 用户在这些题上选"立标准"反而推高 F 的分。
- **为什么自动校验没抓到**：契约 §2.4 的校验只检查"极点属于本维且两端互异"，
  而"文字说的是不是这个极点"是语义判断，机器校验不了。
- **修法**：交换 `textLeft` / `textRight` 的**文案**而非极点。
  极点与 `facet`、左右平衡计数绑定；改极点会牵动平衡与 facet 覆盖，
  而"哪一侧文字放哪一列"纯粹是排版。修完左右平衡仍是 6:6。
- **验证**：修后重跑生成器全量校验通过；Java 与前端夹具测试（148 + 129）全绿。

**这是一类只能靠人工审读发现的缺陷。** 因此 `jung48-item-review.md` 里逐题给出了
"方向说明"列与结论（保留 42 / 建议改写 22），供真人试测时对照。

---

## 6. 端到端实测：单测全绿仍然漏掉的 3 个真实缺陷

这一节是本次验收**最有价值的部分**，因为它推翻了"测试全绿 ⇒ 功能可用"这个假设。

触发方式：把 jar 打包后对着**全新空库**启动，用真实 HTTP 请求走完整流程。
在此之前，**148 条后端测试 + 518 条前端测试全部通过，typecheck 零错误**。
即便如此，下面三个缺陷一个都没被测试发现 —— 而其中任意一个都足以让产品完全不可用。

> 结论先行：**集成测试里自己造出来的假主体、假数据、以及被测试档位调低的安全参数，
> 会把"约定"在测试侧满足了、在生产侧没满足这件事完全掩盖掉。**
> 只有对着真实登录、真实数据库、默认配置发一次请求才会暴露。

### 6.1 缺陷甲：PBKDF2 参数错位 —— 密码只做了 32 轮拉伸

`PasswordEncoderConfig` 构造 `Pbkdf2PasswordEncoder` 时把第 3、4 个实参写反了：

```java
// 修复前（错）
new Pbkdf2PasswordEncoder("", 8, 32, iterations)
// 修复后（对）—— 真实签名是 (secret, saltLength, iterations, hashWidth)
new Pbkdf2PasswordEncoder("", 8, iterations, 32)
```

参数错位的实际后果（实测数据）：

| 配置 | 修复前哈希长度 | 说明 |
|---|---|---|
| `iterations=1000` | 266 字符 | 测试档位，VARCHAR(512) 装得下 |
| `iterations=210000` | **52516 字符** | 生产默认值 |

两个后果都很严重，且**互相独立**：

1. **安全**：实际只跑了 **32 轮** PBKDF2 迭代，而不是 210000 轮。
   也就是说密钥拉伸基本不存在。**而登录功能完全正常** —— 存进去、取出来、
   `matches()` 都对，没有任何可观察的异常。
2. **可用性**：生产默认配置下，注册写入会以
   `Data truncation: Data too long for column 'password_hash'` → **HTTP 500** 失败。
   `app_user.password_hash` 是 `VARCHAR(512)`，52516 字符装不下。

**为什么 210 条测试全都没抓到**：测试档位把 `pbkdf2-iterations` 调到 1000，
此时哈希 266 字符，恰好塞得进 512。**这个"为了跑得快"的调整，
正好把唯一能暴露该缺陷的维度给抹掉了。**

**修复与回归**：改为正确实参顺序后新增 `PasswordEncoderParametersTest`（6 条），
反射读私有 `iterations` / `hashWidth` 并断言：
迭代数真的是 210000、哈希宽度真的是 32、哈希长度**不随迭代数增长**、
能校验自己产出的哈希、拒绝 `iterations < 1000`。
该测试**做过变异验证**：把缺陷重新注入后 4 条失败
（`expected: 210000 but was: 32`、`expected: 32 but was: 210000`、`266 -> 52516`），
说明它确实能拦住这个缺陷、不是空跑。

### 6.2 缺陷乙：内容包从未播种 —— 新测评一个都建不出来

`assessment_attempt.package_id` 有外键指向 `assessment_package`，
但 **`src/main` 里没有任何代码插入过 `assessment_package` 行** ——
只有测试辅助代码会插。于是：

```
POST /api/v3/attempts  →  HTTP 500
Cannot add or update a child row: a foreign key constraint fails
(`assessment_attempt`, CONSTRAINT `fk_attempt_package` ...)
```

登录、注册、目录接口全部正常，**唯独"开始做测评"这一步必然失败**。

**为什么测试没抓到**：所有集成测试都自己 `INSERT` 了内容包行（否则它们的断言无从下手），
等于**把被测的那一步在生产代码里的缺失替它补上了**。

**修复**：新增 `JungPackageRegistrar`（`ApplicationRunner`），
启动时把加载到的内容包 upsert 进 `assessment_package`；
同时 `AttemptService.create()` 前置检查该行是否存在，
不存在时返回 `503 PACKAGE_NOT_SEEDED`（而不是让数据库抛外键违例）。
新增 `JungPackageRegistrarTest`（4 条）钉住"启动后行存在 / 存的 sha256 与重算一致 /
元数据一致 / 重复注册幂等"。

> 启动期 seeding 而非 Flyway 迁移里写死：内容包是**随 jar 走的资源**，
> 它的哈希要能对着磁盘上的真实文件重算验证；写进迁移脚本就变成一份无法自证的副本。

### 6.3 缺陷丙：认证主体缺 `getUserId()` —— 把用户名当主键用

这是**跨模块约定的断裂**，也是三个缺陷里最有代表性的一個。

新测模块（`jung.api.CurrentUser`）与 AI 模块（`ai.controller.AiCurrentUser`）
刻意**不依赖账号模块的类名**（并行开发时跨模块编译依赖会互相卡住），
约定是"主体上有 `getUserId()`，取不到就退回 `Authentication#getName()`"。

但账号模块建立会话时用的是：

```java
new UsernamePasswordAuthenticationToken(username, null, authorities)
```

主体就是**用户名字符串**，根本没有 `getUserId()`。于是那两个模块**每次都走退路**，
把 username 当成 userId。真实表现：

```
POST /api/v3/attempts  →  HTTP 500
Cannot add or update a child row: a foreign key constraint fails
(`assessment_attempt`, CONSTRAINT `fk_attempt_user`
 FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))
```

`app_user.id` 是 UUID，username 不是主键，于是**每个建测评请求都撞外键**。
AI 分析同理。

**为什么测试没抓到**：集成测试大量用 `@WithMockUser` 或自建假主体，
而 AI 的测试辅助 `AiTestAuthentication` **自己实现了 `getUserId()`** ——
于是"约定"在测试里被满足了、在生产代码里没有。**测试替生产代码履了约。**

**修复**：新增 `TypemeUserPrincipal implements UserDetails`（带 `getUserId()`），
`TypemeUserDetailsService` 与 `AccountService.establishSession` 都用它作主体。
新增 `LoginPrincipalCarriesUserIdIT`（2 条），走**真实注册接口**（不 mock 认证），
断言主体确实有 `getUserId()`、该值等于 `app_user.id`、且**不等于 username**。
方法名 `getUserId` 上写了"不可改名"的注释 —— 改名不会编译失败，
只会让那两个模块静默退回 username，然后在**外键上**炸掉。

### 6.4 新增的跨模块接缝测试，以及它的变异验证

前两个缺陷都发生在**账号模块与新测模块的接缝**上，而接缝恰恰是单元测试与
mock 化集成测试的盲区。所以新增 `AssessmentCreationThroughRealSessionIT`：
**不 mock 任何东西** —— 走真实的 `POST /api/v3/auth/register`（真 CSRF +
真 `SecurityFilterChain`）建立会话，再用同一会话去 `POST /api/v3/attempts`，
并断言新建的测评确实出现在**该用户自己**的列表里、且**另一个账号看不到**。

这个测试做了两次**变异验证**（把缺陷重新注入，确认它真的会红）：

| 变异 | 预期失败方式 | 实测结果 |
|---|---|---|
| 把主体从 `TypemeUserPrincipal` 换回 `username` 字符串 | 插入测评时撞 `fk_attempt_user` 外键 | ✅ `DataIntegrityViolationException`，失败在 `INSERT INTO assessment_attempt` |
| 移除 `JungPackageRegistrar` 的 `@Component`（不播种内容包） | 建测评返回 `503 PACKAGE_NOT_SEEDED` | ✅ `Tests run: 1, Failures: 1`，断言 `期望 201，实际 503` |

**没有做变异验证的测试，不能算作防线。** 一条永远为真的断言（例如
§7.1 里那两个假通过陷阱）在报告里看起来和真测试一模一样，
只有把缺陷注进去才知道它拦不拦得住。

### 6.5 这一节的直接教训

| 测试侧做法 | 掩盖了什么 |
|---|---|
| 测试档位调低 `pbkdf2-iterations` | 哈希长度不随迭代数增长这个缺陷 |
| 测试自己 `INSERT` 内容包行 | 生产代码从未播种内容包 |
| 测试自建带 `getUserId()` 的假主体 | 生产主体根本没有这个方法 |

**共同点：测试为了让断言可写而补上的那部分，恰好就是生产代码缺的那部分。**
因此本项目的验收不再以"单测全绿"作为可用性结论，而是必须跑
[`run-e2e-smoke.mjs`](./run-e2e-smoke.mjs) 这条**对真实库、真实会话**的链路。

**留一条给未来的检查**：这三个缺陷有同一个模式 ——
**约定只写在注释里，没有任何编译期或测试期的强制**。
`getUserId()` 这个方法名改名不会编译失败；内容包该由谁播种没有类型层面的约束。
后续如果还有类似的跨模块约定，应当优先考虑让它**编译不过**（共享接口/类型），
而不是靠注释和"记得"。

---

## 7. 端到端冒烟（真实 MySQL + 真实 HTTP 会话）

脚本：[`run-e2e-smoke.mjs`](./run-e2e-smoke.mjs)（Node ESM，零依赖，自带 cookie jar 与 CSRF 处理）
结果落盘：[`e2e-smoke-result.json`](./e2e-smoke-result.json)

```
# 建一个一次性空库（不使用既有 typeme_dev）
mysql -h 127.0.0.1 -uroot -p123456 -e "CREATE DATABASE typeme_e2e CHARACTER SET utf8mb4;"

# 用默认档位起 jar（不调低 pbkdf2-iterations，这样才能撞到缺陷甲那种问题）
java -jar backend/target/typeme-backend-1.0.0.jar --server.port=8099

node docs/2026-09-16/verification/run-e2e-smoke.mjs \
  --base http://127.0.0.1:8099 \
  --out docs/2026-09-16/verification/e2e-smoke-result.json
```

真实输出：**步骤 27 项：PASS 27 / FAIL 0**

覆盖的关键点（每条都是真实 HTTP 往返，不是 mock）：

| # | 验收点 | 实测结果 |
|---|---|---|
| 1 | 未登录访问受保护资源 | `401 [UNAUTHENTICATED]` |
| 2 | CSRF 下发 | cookie `XSRF-TOKEN` 长度 36 |
| 3 | 注册 | `201`，返回顶层 `userId` + **8 个恢复码** |
| 4 | 登录后会话可用 | `GET /me` 200；`userId` 与注册一致且 **≠ username** |
| 5 | 目录 | `typeme-jung48-zh-v1`，题库 64（48 基础 + 16 补充），每维基础题 12，维度序 `EI,SN,TF,JP` |
| 6 | 建测评 | `201`（缺陷乙、丙修复前此处 500） |
| 7 | 取内容包 | base 48 / clarification 16，`revision=0` |
| 8 | 批量作答 48 题 | `revision=1`，状态 `BASE_IN_PROGRESS` |
| 9–10 | 覆盖预检 | 四维 RATING 计数均 12，全部 `coverageOk` |
| 11–12 | 提交出报告 | 状态 `REFERENCE`，类型 `ENFP` |
| 13–14 | 报告详情 | 有 `reportHash`，类型码与预期一致 |
| 15 | 四维位置 | `EI=SN=TF=JP=1.000`，两端标签齐备 |
| 16 | 报告结构 | 8 段解读 + **恰好 3 条** `nextActions` |
| 17 | 措辞合规 | 候选 0 条；无概率/准确率类禁用措辞 |
| 18 | 分享三件套 | `text` / `alt` / `filename` 齐备 |
| 19 | methodology | 10 个字段，含非诊断声明 |
| 20 | 自我理解 | 保存成功，且**问卷结论未被改写**（ENFP 保持 ENFP） |
| 21 | 报告列表 | 含刚生成的 1 份 |
| 22 | 账号导出 | 13.5 KB JSON |
| 23 | 二次提交 | **幂等**：reportId 不变、报告仍 1 份、`reportHash` 未变 |
| 24 | 旧只读量表未被破坏 | `/api/v1/meta` 与 `/api/v2/...` 均 200 |
| 25 | 前端 SPA 入口 | 200 |
| 26 | 删除报告 | 删后 GET 返回 404 |
| 27 | 登出 | `/me` 变 401 |

### 7.1 修脚本时踩到的两个"假通过"陷阱（值得单独记）

写这条脚本时我自己造出过**两次假通过**，都比较隐蔽，记下来避免重犯：

1. **信封层级读错**。`GET /api/v3/reports/{id}` 返回的是信封
   `{ report: {...}, selfReflection, attemptId, attemptRevision }`，
   报告本体在 `.report` 里。我第一版读的是顶层 `doc.computedTypeCode`，
   于是所有断言拿到 `undefined`，而 **`undefined === undefined` 成立** ——
   一整批断言全都"通过"了。修法：先断言 `r.json.report` 存在，再往下读。
2. **`step()` 返回值不是我以为的东西**。`step()` 返回给调用方的是**给人看的那句说明字符串**，
   不是 `fn` 的返回值。于是 `registration.userId` 恒为 `undefined`，
   而"`/me` 的 userId == 注册时的 userId"这条断言把
   `undefined` 拿去比了。修法是引入 `ok(message, value)` 显式区分
   "日志说明"与"传给下一步的结构化值"。

另外一条**是我判断错了、不是实现错了**：我最初断言"二次提交必须被拒"，
实际服务端设计是**幂等**——重复提交返回同一份报告（一份 attempt 只对应一份报告），
所以 HTTP 200 是正确行为。已改为断言语义正确的东西：
reportId 不变、报告仍只有 1 份、`reportHash` 不变。
（把"幂等"误判成"必须报错"是一个真实存在的审查盲点。）

### 7.2 顺带验证到的一条防护

探测过程中连续注册把 **注册限流打满了**（`429`，`register.ip-limit=5/小时`），
说明限流**在真实运行路径上确实生效**，不是只写在配置里。

> 清理这些限流桶只针对一次性库 `typeme_e2e`，未触碰任何既有业务库。

---

## 8. 明确未验证的部分

**以下项目本轮没有验证，不要当成已验证：**

| 项目 | 状态 | 说明 |
|---|---|---|
| **真人题目试测** | **未做** | 没有任何真人作答数据。题面可读性、是否有歧义、是否诱发社会赞许作答，全部未经真人验证 |
| **真实 DeepSeek 联调** | **未做** | 没有 API key。AI 全流程走 `MockDeepSeekClient`；`HttpDeepSeekClient` 的超时、错误码映射、宽松解析只做了代码级验证，**从未调用过真实接口** |
| **生产部署** | **未做** | 没有部署、没有压测、没有真实流量 |
| **浏览器实机验收的"人眼判断"** | 部分 | 截图已产出并做过结构性校验（尺寸、非空白）；但视觉/文案质量的判断依赖截图审读，见 §9 的说明 |
| 恢复码"消费一次"的原子 UPDATE | 仅 H2 验证 | 逻辑在 MySQL 上应等价，但未在真实 MySQL 上跑过该路径 |
| 限流 / AI 额度的 upsert 路径 | 仅 H2 验证 | 同上 |
| **AI 分析的前后端联调** | **未做** | 后端接口与适配器已实现，前端无对应页面（见 `../implementation/README.md` §10） |
| **注册时的免责声明同意** | **未实现** | 前端注册表单无此项、后端不校验。详见 §9.1 —— 同时纠正了我此前"后端要求此项"的错误说法 |
| 界面美观度 / 语气 | 未评判 | 走查方与撰写方**都不具备图像输入能力**，只做了计算值实测；见 §9.2 |
| 320/390 报告页全页截图 | 未做 | 320 下 `scrollHeight=7381`，全页体积过大；已用分屏截图替代 |
| 并发 / 多设备同时编辑同一草稿 | 未做 | `expectedRevision` 冲突分支有单测，但没做真实并发压测 |
| 长期运行（会话过期、定时任务、连接池耗尽） | 未做 | 没跑过 soak test |
| 键盘纯操作路径 / 屏幕阅读器 | 未做 | 走查未覆盖纯键盘作答 |

> **端到端接口联调（浏览器 → 后端 → MySQL）已经做了**：
> 见 §7。这一条上一轮还写着"未做"，本轮已补齐 ——
> 而且正是它抓出了 §6 的三个缺陷。

### 8.1 关于 `mock-mode` 的诚实性要求

`mock-mode=true` 时结果里带 `mock=true` 标记，**界面必须显示"这是演示数据"**。
绝不能让用户以为看到的是真实 AI 分析结果 —— 这条已写进实现注释与前端契约。

---

## 9. 浏览器实机验收

见 [`browser-acceptance.md`](./browser-acceptance.md)。
覆盖 320 / 390 / 1440 三个宽度，截图存于 [`screenshots/`](./screenshots/)。

截图**结构与内容**做过校验（不是人眼审读的替代品）：

| 校验项 | 结果 |
|---|---|
| PNG 可解码、尺寸符合预期 | **32/32** 通过 |
| 三个视口都覆盖 | 320×720 **8 张**、390×844 **8 张**、1440×900 **15 张**、1424×4457 整页 **1 张** |
| 非空白（降采样后量化色数 > 4 且亮度标准差 ≥ 3） | **32/32** 通过，无一张疑似空白 |
| 截图分批 | 修复前走查 **25 张**（`01-`…`10-`）；修复后复验 **7 张**（`11-landing-fixed-*`、`12-report-fixed-*`、`13-assess-review-*`） |

### 9.1 界面缺陷（浏览器实测发现，均已复核到源码）

浏览器走查抓到 **2 个硬缺陷**（文案与实际量表不一致）与 **3 个可用性/无障碍问题**。
它们都不是"观感"，而是同一渲染状态下用 `getBoundingClientRect`、
`getComputedStyle` 与 console/network 事件测出的确定值。**每条都在源码里复核过。**

#### 硬缺陷 1：首页宣传的量表与实际入口不是同一套

首页主按钮写「开始测评（**50 题**）」、副标题写「**大五人格倾向自测**」，
但它链接到 `#/assess` —— 那儿跑的是 `typeme-jung48-zh-v1` 十六型量表
（`questionCount=64`、`basePerDimension=12`、题卡是 `EI · 精力方向`、`主测 0 / 48`）。

**源码复核**：`LandingView.vue` 的 `total` / `estimatedMinutes` / `hasTypeCode`
全部取自 `useQuizStore().activePackage`（旧 IPIP-50 大五包或它的内置降级副本），
`App.vue` 的顶栏副标题同源。**新站页面读了旧引擎的内容包**，于是文案是旧量表的。

这类缺陷单测抓不到：`instrumentCopy.spec.ts` 断言的正是
"IPIP 包要显示大五文案" —— 它**忠实验证了一个错误的接线**。

#### 硬缺陷 2：报告的正式署名指向另一套量表

一份 `jung48` 产出的 **ENFP 报告**，顶栏写「大五人格倾向自测」，
页脚署名是「题目基于 International Personality Item Pool (IPIP) — Goldberg's
Big-Five Factor Markers … IPIP 量表属公有领域」。

**署名与许可信息必须准确**，这里指向了完全不相关的另一套量表 ——
对"这是哪份量表的结果"这种信息来说是真问题，不只是观感。

#### 三个可用性/无障碍问题（产品取舍，未修）

| # | 问题 | 实测值 |
|---|---|---|
| 3 | 小字号辅助文字对比度不足 WCAG AA | `text-ink-faint` = `rgb(124,136,146)`，在 `rgb(247,246,242)` 上 **3.35:1**、白底 **3.62:1**（AA 要求 4.5:1）。涉及顶栏副标题 11.5px、题卡侧标签 12px、报告「中点」、列表时间戳 13px、页脚 12px(**3.09:1**) |
| 4 | 320×720 首屏放不下操作区 | 五档按钮 `bottom=761` 超出视口 720 共 **41px**；「这题我说不好」`top=773`、「下一题」`top=1042` 均在首屏外（可滚动，非不可达）。390×844 的「下一题」`top=1022` 也在首屏外 |
| 5 | 320 宽度 sticky 顶栏过高 | **138px**（1440 时 69px、390 时 90px），占 320×720 首屏约 **19%** |

> 第 3 条是"辅助文字降一级对比度"这一**有意视觉层级**与 WCAG 门槛的冲突，
> 属于产品取舍；第 4/5 条是移动端首屏效率问题。三者都**未修改**，
> 现状如实记录在此，是否调整由产品决定。

#### 一条产品要求确认未实现：注册时的免责声明同意

**我此前在 E2E 脚本里断言"未同意免责声明不给注册"，这是我的错误。**
实测与源码复核：

- 注册页 DOM 里 `input[type=checkbox]` 数量为 **0**；唯一的勾选框在**注册成功之后**的
  恢复码屏（"我已经把这 8 个恢复码抄下来…"），不是免责声明。
- 注册页**没有任何免责声明文案**；不勾任何东西即可注册成功（201）。
- 后端 `RegisterRequest` 里**没有** `disclaimerAccepted` 字段，
  **全仓没有任何地方读 `disclaimer`** —— E2E 脚本发的那个键被静默忽略。

也就是说：**"必须显式同意免责声明"这条产品要求，前端没有这一项、后端也不校验。**
已作为未实现项记入 §8；E2E 脚本里那个误导性的字段与注释也已删除并改正。

### 9.2 这批截图的证据能力边界（必须说明）

**执行走查的模型本身也不具备图像输入能力**（它尝试改调 3 组带视觉的
provider/model 做截图判读，6 次调用全部返回空）。因此：

| 能证明 | 不能证明 |
|---|---|
| 截图是真实 Chrome 捕获、尺寸正确、画面非空白 | 界面**美观度** |
| 文案内容（DOM `innerText` 实测） | 视觉**层次是否好看** |
| 对比度、盒模型、越界、console 报错（计算值实测） | 文案的**语气是否得体** |
| 完整流程可走通（真实点击） | 是否存在只有人眼能发现的渲染瑕疵 |

撰写本文件时的会话模型同样不支持图像输入，我**没有看过这些截图**。
上面的"能证明"一列是执行方声明的能力，我独立复核的是
**像素尺寸、非空白性、以及硬缺陷在源码里的对应位置** ——
后者是我唯一能确证的部分，也恰好是硬缺陷的关键：
**文案错误不需要看图，读源码就能确证。**

### 9.3 两个硬缺陷已修复并在 jar 产物上复验

修复后重新构建、重启，在**不拦截任何请求**的情况下于 `http://127.0.0.1:8099`
（jar 内 `index-B7iHxEtT.js`）原样复验：

| 项 | 修复前（实测） | 修复后（实测 DOM） |
|---|---|---|
| 首页眉标 | `大五人格倾向自测 · 50 题 · 约 5 分钟` | `十六型人格参考测评 · 主测 48 题 · 约 8–12 分钟` |
| 主按钮 | `开始测评（50 题）` | `开始测评（主测 48 题）` |
| 题量口径 | 无 | `题库共 64 题 = 主测 48 题 + 最多 16 道补充题。补充题只在你某一维两边差不多时才会出现，也可以跳过。` |
| 顶栏副标题 | `大五人格倾向自测` | `十六型人格参考测评` |
| 报告页署名 | `IPIP — Goldberg's Big-Five Factor Markers` | `十六型人格参考测评的题目与报告文案为本项目自行撰写；本站不隶属任何商业人格测评机构` |
| 报告页全文扫描 | 命中 `IPIP`/`Goldberg`/`Big-Five`/`大五` | **`/IPIP\|Goldberg\|Big-Five/` → false；`/大五/` → false** |

**根因与修法**：新站页面从旧引擎的 `useQuizStore().activePackage`（IPIP-50 包）
读量表名与题数。新增 `stores/instrumentV3.ts` 作为新测量表口径的**唯一来源**
（读 `GET /api/v3/catalog/current`，未登录/离线退到**新测自己的**内置口径，
**绝不退回旧内容包** —— 退回旧包正是这个 bug 本身），
`utils/instrumentNaming.ts` 负责旧引擎的量表名与路由判定；
`App.vue` / `LandingView.vue` / `ReportV3View.vue` / `SharePreview.vue` 按路由分代取口径。

**旧站回归（实测未破坏）**：

| 路由 | 实测结果 |
|---|---|
| `#/quiz` | 顶栏 `大五人格倾向自测`，`已处理 0 / 50`，答题卡 1–50 全部渲染 |
| `#/about` | 顶栏 `大五人格倾向自测`，页脚 IPIP / Public Domain 署名原样 |
| `#/result` | 无旧记录时按原行为回到答题页（仍是大五 50 题） |

复验后 `npm.cmd run typecheck` exit 0、`npm.cmd test` **16 文件 / 584 条全绿**、
`npm.cmd run build` exit 0。
（这是**那一轮**的实测值；加入过程层后的当前基线是 17 文件 / 693 条，见 §2 与 §10.1。）

**同步修正的静态元信息**：`frontend/index.html` 的静态
`<title>` / `<meta name="description">` / `<noscript>` 此前也是旧文案
（`TypeMe · 大五人格倾向自测（IPIP-50）`，且写着"**免费无需登录**"、
"所有计算都在你的浏览器里完成，**没有服务器参与**"）——
这与新站的"需登录、数据存账号里"**直接矛盾**，而且它是
分享预览与爬虫看到的文案（JS 起来后才被路由覆盖）。已改为描述当前主入口，
并去掉与现状不符的隐私表述。

**两条测试断言被同步更新**（如实说明，不是为了让测试变绿）：

1. `views.spec.ts` 里"首屏写 `${questionCount} 道题`"等断言，
   **忠实钉住的正是这个缺陷本身**（首页宣传旧包题数）。
   已改为断言新测口径，并把旧包题数的断言移到旧版本入口处。
2. `instrumentCopy.spec.ts` 里 `mount(App)`（隐式挂在 `/`，即新站首页）
   断言旧包副标题/署名 —— 已改为 `mountAt('/about', App)`（旧引擎方法页），
   旧断言逐条保留、只是挂到了真正属于旧引擎的路由上。

> 这条又一次印证了 §6.5 的教训：**测试也可以忠实地验证一个错误的接线。**
> `instrumentCopy.spec.ts` 断言的"IPIP 包要显示大五文案"完全正确，
> 但它没问过"新站首页该不该是 IPIP 包"。

### 9.4 修复后仍存在的残留（如实列出，未修）

| 残留 | 说明 |
|---|---|
| **首页下半部分仍由旧内容包驱动** | `你会得到什么` / `会测到的五个维度` / `常见问题` / `本地记录与清除` / `来源与许可`（`基于 IPIP 公有领域量表（大五）`）仍是旧包文案。**首屏以上已无此类字样**，但匿名首页**全文**扫描仍能命中 `大五` / `50 题`（命中位置都在已标注为「旧版本测试」的区域及其下方）。要不要把这几块也归入"旧版本测试"或补一套新测文案，需产品定范围 |
| 对比度 / 320 首屏 / 顶栏高度 | §9.1 的问题 3/4/5 **未修、也未复测**（属产品取舍） |
| `#/recover`、注销、导出、删除报告、自我理解、分享图导出、AI 分析、纯键盘作答、多设备冲突 | 修复后未复验（修复前也未覆盖） |
| 分享图导出 | `SharePreview.vue` 的署名改动**只有单测覆盖**，没有在浏览器里真导一张图 |

### 9.5 后续变更：首页移除「旧版本测试」入口（产品要求，2026-09-16）

产品要求：**首页不再出现旧版本测试的入口**。范围为「只从首页移除入口」，
旧引擎本身与已有旧作答记录**保留不动**。

**已从首页移除**：旧引擎入口按钮组（开始旧版本测试 / 继续测试 / 查看上次报告 / 重新测试）、
两版题目版本单选、「这台设备上更早保存的作答」恢复区、「重新开始」确认框、
旧内容包的来源与许可署名；连带 `PACKAGE_LABELS` / `packageOptions` / `choosePackage` /
`selectedPackageLabel` / `hasDraft` / `hasFinished` / `migrateLegacyV2` /
`total` / `activeAttribution` 等只服务这些区块的代码一并删除。
`fetchMeta()`（`GET /api/v1/meta`）在首页变成只写不读，也一并去掉。

**保留未动**：`/quiz`、`/result`、`/about` 三个旧站页面与 `stores/quiz.ts`、
两套旧内容包、以及用户已有的旧作答记录。旧站自 `#/quiz` 仍可正常进入。

**顺带修掉的四处「页面说的和实际不是同一套」**（都属于 §9.1 的同一类问题）：

| 位置 | 改前 | 改后 |
|---|---|---|
| 首页 FAQ「我的答案会上传吗？」 | 「**不会**。答案与计分都在你的浏览器里完成，**没有提交答案的接口**」——与登录版事实直接相反 | 说明答案存在账号里、可跨设备继续、可导出或删除 |
| 首页 FAQ「测到一半关掉页面怎么办？」 | 「进度保存在这台设备的浏览器里…清除浏览器数据后就没了」 | 说明进度在账号里，换设备登录可继续 |
| 首页页脚署名 | 按旧内容包渲染：`基于 OEJTS 1.2` 或 `基于 IPIP 公有领域量表（大五）` | `data-instrument-attribution`：`十六型人格参考测评` 自行撰写、不隶属任何商业机构、内容仍在内部审校中 |
| `/about` 的「更早保存的作答」说明 | 「可以**在首页**按当时的题目打开」——首页入口已删，属断链文案 | 说明首页已不再提供该入口，只能在此查看数量并一并清除 |

**同时把首页下半部分也改成描述新测自己**（即上表 §9.4 的第一条残留项已解决）：
`会测到的N个维度`、教学例子、结果示例卡、FAQ 与「你会得到什么」此前都由
**旧内容包**驱动，于是十六型首页写着「会测到的五个维度」（E/A/C/ES/O）、
教学例子说「1 表示非常不贴切」（那是大五的单句贴切度格式，与实际的双极 1–5 不同）。
现已全部改由 `stores/instrumentV3.ts` 驱动。

**测试的处置（如实说明）**：这次变更让 **12 条测试失败**。逐条核对后——
**9 条删除、3 条更新**，无一条是为让测试变绿而弱化：

| 处置 | 条数 | 理由 |
|---|---|---|
| 删除 | 9 | 断言的是首页上**已被移除的 DOM**（版本单选、旧入口按钮、确认框、旧包署名、恢复区）。每条都在原位留了 `2026-09-16` 注释说明删了什么、为什么、覆盖迁到哪去了 |
| 更新 | 3 | 断言的维度数/维度名**仍然成立**，只有「题数」不再跟着旧包走（首页只剩新测的 48 题口径） |
| 刻意不改 | — | 没有把「旧包题数」改成 `not.toContain('50 题')` 之类。子串匹配会与将来「150 题」这类文案假冲突，属于为过测试而扭曲断言 |

> 被删的 9 条里有一条值得特别记下：`来源署名含 OEJTS / Eric Jorgenson / CC BY-NC-SA 4.0`
> 断言的正是「首页按旧内容包渲染署名」这个**错误行为**。
> 它的存在说明这类接线缺陷会被测试**固化**下来 —— 与 §9.3 的结论一致。

**这次留下的、明确未做的缺口**：

| 缺口 | 说明 |
|---|---|
| 旧 v2 记录对用户已不可打开 | `migrateLegacyV2` 现在没有任何视图调用（只剩 store 单测）。现状：只能看数量并清除 |
| 旧包署名的测试覆盖变薄 | 首页不再按包渲染 attribution；该语义现由 `/about` 与公共壳的用例覆盖 |
| 新首页署名无测试守卫 | `data-instrument-attribution` 的文案（自行撰写 / 不隶属 / 内部审校中）目前没有测试钉住 |
| FAQ 文案修正无测试守卫 | 全仓 spec 里没有断言「上传 / 关掉页面」这两条 FAQ |
| `instrumentCopy.spec.ts` 的 `expectations[].versionAnswer` | 从未被断言的死字段（上一轮遗留），未清理 |

### 9.6 真实浏览器复核：这次改动**漏掉**的三处（2026-09-16）

§9.5 的改动是靠单测与源码审阅完成的。之后用 CDP 直接读**渲染后的 DOM**
（无头 Chrome + `Page.navigate` → `document.body.innerText`）复核，
又查出三处单测**测不到**的残留 —— 记录在此，因为它们正好说明 9.3/9.5 的结论：

| # | 残留 | 为什么单测没抓到 | 已修 |
|---|---|---|---|
| 1 | **顶栏在每一个非首页页面都还挂着「旧版本测试」链接**（`App.vue`，指向 `/quiz`） | 测试挂载 `App.vue` 时只注册两三条路由，没人在意顶栏那几个链接；首页的用例又只断言首页 | 删除该链接，改为指向 `/assess` 的「开始测评」；`/quiz` 路由本身保留，直接改 hash 仍可进入旧站 |
| 2 | **`/about`（首页「方法与隐私」的落点）整页仍在讲旧的大五量表** | `AboutView` 不在「首页」范围内，首页的用例看不到它 | 整页改由 `stores/instrumentV3.ts` 驱动（§9.7） |
| 3 | **极向顺序与维度名对不上内容包**：`POLE_META` 写 TF 为 `F – T`，内容包写的是 `neg=T/pos=F`；SN 名三处不一致（`信息偏好`/`信息关注`/`信息取向`） | 三处各有一条测试，各自都过 | SN 统一为内容包的 `信息取向`；TF **保持 `F – T`**，见下面的重要教训 |

**⚠️ 重要教训（这次差点改错计分约定）**：我先把 `POLE_META` 的 TF 改成
`neg=T/pos=F` 去"对齐内容包"，结果 **7 条用例失败**，包括
`极点映射唯一出处（MI-6 回归防线）`：*「负极为 I/S/F/J、正极为 E/N/T/P，与 §1.1 的
判定规则一致」*、以及 `IM-4` 的 *「把中点整体上移 1 → 同一份作答的极性方向全部反过来」*。
说明 `POLE_META` 的 `F/J` 顺序**不是展示文案，而是计分约定**（`markDefinition` 判
「落负极」用的就是这套）——内容包 `TF: neg=T/pos=F` 只是内容包的写法，
**不能**当作改计分约定的依据。已回滚，只在 `scoring.ts` 留下注释说明这个坑。

> 这与 §9.3 的结论是同一件事的两面：**测试能忠实地验证一个错误的接线**（首页接错内容包），
> 也能忠实地阻止一个错误的"修复"（改错计分约定）。两者都只有跑测试才知道。

**复核方法与能力边界**：CDP 取的是 `innerText`、`document.title`、
`querySelectorAll` 计数与 `location.hash`，属于**渲染结果的程序化核对**，
**不是人眼视觉审阅**（§9.2 的图像输入限制依旧成立）。
对 `/`、`/about`、`/quiz`、`/assess`、`/reports` 五个路由各扫一遍
`旧版本测试 / 大五 / IPIP / OEJTS / 五个维度 / 50 题` 与
`十六型 / 主测 48 题 / 四个维度` 等字样：

| 路由 | 旧量表字样命中 | 结论 |
|---|---|---|
| `/`（首页） | 全部 **0** | 只讲新测 |
| `/about`（方法与隐私） | 全部 **0** | 只讲新测（§9.7） |
| `/assess`（未登录）→ 跳登录页 | 全部 **0** | 壳与页都讲新测 |
| `/reports`（未登录）→ 跳登录页 | 全部 **0** | 同上 |
| `/quiz`（旧站，仅直接改 hash 可达） | `大五` 1 / `50 题` 2 | 旧站**按预期**保留旧量表（本次未改动它） |

### 9.7 `/about` 改由新测驱动（2026-09-16）

首页的「方法与隐私」链接承诺回答「分数怎么算、门槛是怎么定的」，
但该页当时整篇讲的是旧的大五量表。现整页改由 `stores/instrumentV3.ts` 驱动：

- 作答格式改为**双极 1–5**（「两边都读完…左边永远是 1，右边永远是 5」），
  单句贴切度那一支删除；
- 新增「会测到的维度」区块，四个维度名取目录、字母与一句话说明取 `POLE_META`；
- **门槛不再印任何具体数字**：新测的 `scoringPolicy`（`minBaseRatingsPerDimension=9`、
  `boundaryNumerator/Denominator=2/10`、中点 3）只在需要登录的
  `GET /api/v3/catalog/current/package` 与报告 `methodology` 里，匿名访客读不到。
  页面改为讲清规则形状（每题折算成带符号的数 → 同维相加 → 方向看符号；
  「略偏」的线随该维可计分题数一起放宽），并指明**确切数值写在每份报告的
  「这份报告是怎么来的」一节**。**不编造数字**是本条的验收标准。
- 「来源与限制」重写为「题目与文案为本项目自撰、不隶属任何商业机构」，
  并明写「仍在内部核对中」「**没有信度或效度方面的证据**」；
  原 OEJTS/IPIP 署名与 MBTI 免责声明段落删除。
- 「本地记录」一节**保留可用**（它讲的确实是旧引擎的本机数据），
  但标明「首页已不再提供它的入口」并指向「新测的数据怎么存」。

**同时从 `LEGACY_ENGINE_ROUTE_NAMES` 里移除了 `about`**（`utils/instrumentNaming.ts`）：
它此前被当成旧引擎路由，于是整页顶栏副标题与页脚署名都用旧内容包渲染，
出现"页内说十六型、顶栏说大五"。移出后 `/about` 归入新站口径。

**由此改动的测试**（均非削弱）：`App.vue` 那条"公共壳跟随当前内容包"的用例
从挂载 `/about` 改为挂载 **`/result`** —— 因为 `/about` 已不属于旧引擎，
且答题页（`/quiz`）按 §4.5 刻意不渲染页脚（`v-if="!quizActive"`），那里没有署名可验。
这条用例此前是**挂着错误的路由、验着错误的接线**。

> ⚠️ **2026-09-16 补记（§10 修复的第二个"绿着坏"）**：这次搬家把它推进了另一个坑。
> 用空答卷挂 `/result` 时，`ResultView` 会 `router.replace({ name: 'quiz' })`（作答未完成），
> 而该 spec 自建的测试 router **没有注册 `quiz`** —— 于是跳转的 Promise 被拒绝，
> 位置停在 `/result`，页脚还在，**断言恰好通过**。也就是说：这条用例当时是**靠着一次失败的跳转**
> 才绿的，同时那次拒绝以 vitest 的 *unhandled error* 形式让 `npm test` **exit 1**
> （用例全绿、进程失败的"绿着坏"）。§10 已按"填满并提交答卷 + 注册 `quiz` 占位路由"修复：
> 现在它验的确实是**结果页**的页脚，且任何跳走都会让断言立刻变红。

---

## 10. 过程层（方法论 v2，2026-09-16）

对应交付：[`../TypeMe-分析建议方法论-v2.md`](../TypeMe-分析建议方法论-v2.md)。
本轮新增 L3「由四字母推导过程结构」与 L4「由结构派生建议」，并把它们接进报告、前端与 AI 提示词。

### 10.1 本轮真实跑过的命令与输出

四侧全部在同一份盘上代码上跑完（2026-09-16 17:1x）：

```
node scripts/convert-jung-content.mjs --check
→ 内容包与 YAML 一致。                                   exit 0

node scripts/gen-jung-fixtures.mjs --check
→ 夹具一致（3 份，sha256=67ae28a95fd1）                  exit 0

cd backend; mvn.cmd -o test        （JAVA_HOME=D:\develop\jdk-21）
→ [WARNING] Tests run: 242, Failures: 0, Errors: 0, Skipped: 1
→ [INFO] BUILD SUCCESS                                   exit 0
   （此后的补记把这一行推到了 243 条，见 §10.5；其余命令的结论不变）

cd frontend; npm.cmd run typecheck → exit 0（零错误）
cd frontend; npm.cmd test
→ Test Files  17 passed (17) / Tests  693 passed (693)    exit 0
   （**没有 unhandled error**：见 §10.4）
cd frontend; npm.cmd run build
→ dist/assets/index-C3EV3P3G.js  418.12 kB │ gzip: 162.37 kB
→ ✓ built in 5.27s                                       exit 0
```

本轮新增/加强的测试：`JungTypeDynamicsTest`（9 条，含 16 型逐行表与"三方一致"）、
`JungReportSchemaTest`（14 条，含两块字段契约、TIED 两块皆 null、`**`/反引号零泄漏）、
`dynamics.spec.ts`（94 条，前端镜像读同一份夹具）、
`ReportInputBuilderTest`（11 条，含三档"静默退化"的日志断言）、`SystemPromptTest`（4 条）。

### 10.2 16 型过程表是**三方**钉住的

Java（`JungTypeDynamics`，权威）、Node 参考实现（`scripts/gen-jung-fixtures.mjs`）、
前端镜像（`frontend/src/domain/jung/dynamics.ts`）三处独立实现，
必须与同一份夹具 `score-cases.json` 的 `typeProcesses` 的 **16 行逐行相等**
（`JungTypeDynamicsTest.agreesWithSharedFixture` + `dynamics.spec.ts`）。

之所以要三重钉：这一层是纯符号推导，写错**不会**产生任何异常 ——
报告照样生成、页面照样渲染、类型码照样正确，只有"主导/辅助整对错位"这一个后果，
而它恰好是这份报告最核心的那句话。

### 10.3 本轮找到并修掉的真实缺陷（都不是测试写错）

| # | 缺陷 | 后果 | 怎么发现的 |
|---|---|---|---|
| 1 | 推导规则把内倾支写成"同族换方向" | ISTP 被推成 `Ni` 主导（应为 `Ti`）；16 型里 **8 型**主导/辅助整对错位，且**全程无报错** | `JungTypeDynamicsTest` 的 16 型表逐行断言 |
| 2 | 第三位写成"辅助的同功能反方向"（`Te→Ti`） | 四个过程只覆盖两个功能族，而四步决策法要求"功能族→过程"唯一 | 新增的"四过程各占 S/N/T/F"构造期不变量 |
| 3 | `JungProcess.auxiliary()` 语义错误（辅助的族不能由主导单独推出：`Si` 可配 `Te` 也可配 `Fe`） | 一个会引导后来人写错的 API（虽未被调用） | 逐型核对时发现，已删除 |
| 4 | `flipNote` 把字面 `**互换**` 写进了 `report_json` | 页面上直接显示两颗星号 | 打印真实报告 JSON 目视检查 |
| 5 | 两处决策步文案都自称"这一步对你是最生的" | 自相矛盾（只有一步能"最"） | 同上；已改为"这一步用不上你偏好的功能"，排序只留 `hardestStepsNote` |
| 6 | 前端只按 `computedTypeCode` 判"两块必须在" | **过程层上线前的旧快照**会显示"这份报告读不出来"（历史数据被新版读崩） | 前端实现者提出，改为按 `methodology.dynamicsVersion` 判别 |
| 7 | `instrumentCopy.spec.ts` 靠**一次失败的跳转**才绿，同时让 `npm test` exit 1 | "绿着坏"：用例全绿而进程失败，最容易被当噪音放过 | 修 #7 相关路由时暴露（见 §9.7 补记） |
| 8 | `selectRating` 会把会话写进 localStorage，**会话带着 `packageId`** | 下一轮用例 `restore()` 读回上一轮的内容包 → `expected 50 to be 32` | 修 #7 时新引入并当场复现，已加 `localStorage.clear()` |
| 9 | `ReportInputBuilder` 在 `JungReportBuilder` 改键名时会**静默**丢掉整层 | AI 分析悄悄少一层依据，报告照出、测试照绿 | 实现者主动提出，改为"合法缺席安静、异常缺席 WARN" |
| 10 | **换边后果的语义写反**：把 J/P 写成"主导与辅助互换"、E/I 写成"方向整体对调"，两条正好**对调** | 用户在一维略偏时会读到一句关于自己结构错话；报告照出、测试**全绿** | 写 `neighbors` 文案前逐条核对结构时发现（见 §10.5） |

第 4、5 条是**同一份产物**目视检查出来的：一份真实的 ISTJ `REFERENCE` 报告快照，
留在 `work/jung_report_sample.json`（生成它的临时测试类已删除）。
它值得留着 —— 那两条都不是任何断言能发现的（内容生成器不查 Markdown 标记、
也不查"两个字段不该说同一句最强的话"），只有把 `report_json` 打印出来读一遍才会撞上。
现在报告侧有了递归扫描 `**`/反引号的测试，属于把那次目视发现固化成机器可查。

第 9 条的分档值得记：`dynamics` 为 null（TIED / 旧快照）是**合法缺席**，安静；
`dynamics` 在但投影为空或只投影出 <4 个过程则是**异常**，必须 WARN 且带上
`reportId`/`reportHash`。给"没有这一层"和"读不到这一层"配上不同的声音，是本案的要点。

### 10.4 诚实性说明（本轮**没有**验证的东西）

- **没有做真实的 DeepSeek 调用验证。** AI 提示词 v2 的效果只经过
  `mock-mode` 与单元/集成测试，模型在真实调用下是否守得住第 8–13 条**未经验证**。
- 过程层文案 `contentStatus` 是 `draft_review_pending`：**没有经过真人审读**，
  页码依据来自转写稿（`output/天资差异-全文.md`），而转写是 OCR + 人工核对，不是原书扫描件逐字复核。
  > **页码更正**：转写稿注解里的内联 `（p.N）` 用的是**扫描锚点**，不是印刷页码
  > （印刷页码 = 锚点 − 17）。方法论附录 A 的页码已逐条按锚点实测换算。
- **16 型八段文案只重写了 `neighbors` 一段**：它已按过程机制重写并逐段机器核对（见 §10.5），
  其余七段（日常/优势/盲点/沟通/学习工作/压力/成长）仍是按四字母的通用描述，
  与新结构层之间没有互指。**这是本轮明确的范围决定，不是遗漏。**
- 本层**不引入任何群体分布数据**（不出现比例/概率/适配度/匹配率），
  引用政策已裁定但留给 v3，见方法论 §5.5。

---

## 10.5 补记（同日晚）：换边后果的语义修复 + 16 型 `neighbors` 重写

写 `neighbors` 文案前要先把"你和相邻类型的差别从哪来"逐条核对，核对时发现了第 10 个缺陷。

### 缺陷 10：换边后果写反了，而且**测试替它作证**

`flipEffect` 原来只有两个布尔：`dimensionsTraded` / `attitudesSwapped`。J/P 被标成
"连功能族都换"、E/I 被标成"只是方向对调"，**两条正好对调**。真实后果是：

| 换边 | 例子 | 真实后果 |
|---|---|---|
| E/I | ISTJ → ESTJ | 还是那四个过程（`Si/Te/Fi/Ne`），但主导与辅助互换、第三位与第四位也互换 |
| J/P | ISTJ → ISTP | 每个位置**方向都不变**，但每个位置上的过程都换成另一类（判断↔感知） |
| S/N | ISTJ → INTJ | 只有 S 与 N 两个位置换功能、方向不变（`Si→Ni`、`Ne→Se`） |
| T/F | ISTJ → ISFJ | 只有 T 与 F 两个位置换功能、方向不变（`Te→Fe`、`Fi→Ti`） |

它为什么一直是绿的：旧测试拿 **ESTJ**（那是 **E/I** 换边的结果）去"印证 J/P"，
注释就写着"ESTJ 的结果印证：主导与辅助互换（Si/Te -> Te/Si）"，断言因此永远成立。
这比"没测"更坏——**测试在为错误作证**。

修法三条：

1. 两个布尔换成 `FlipConsequence` 枚举（`DOMINANT_AUXILIARY_SWAP` / `CATEGORIES_SWAP_SLOTS` /
   `FUNCTIONS_SWAP`）：布尔组合看不出"哪两种后果不能同时成立"，正是它掩盖了这次错误；
2. `JungReportBuilder.flipNote` 不再讲抽象的方向对调，而是**点名换边后的类型码与实际过程**
   （"如果 EI 落到另一侧（ESTJ）：……原来是内倾感觉主导，换过去就是外倾思考主导"），
   用户拿自己的类型一对就能自己核对；换边后的结构一律用 `JungTypeCode.withPole(...)`
   换掉字母后**重新推导**，不手工拼结构（手工拼正是构造期不变量要拦的事）；
3. 测试改成 16 型 × 4 维 = **64 组**，每组都真的换掉那个字母、重新推导，再逐槽位对拍后果。

**变异验证**（确认新测试真能拦住，而不是"现在恰好是绿的"）：把 J/P 与 E/I 的后果改回
当初那两条对调的写法，测试立刻 2 条红：

```
[ERROR] Tests run: 10, Failures: 2, Errors: 0, Skipped: 0   ... BUILD FAILURE
org.opentest4j.AssertionFailedError: expected: DOMINANT_AUXILIARY_SWAP but was: CATEGORIES_SWAP_SLOTS
org.opentest4j.AssertionFailedError: expected: 'i' but was: 'e'      ← 槽位朝向被换掉
```

还原后 `Tests run: 10, Failures: 0, Errors: 0` / `BUILD SUCCESS`。
同一处错误还同步改掉了 AI 提示词 v2 第 9 条、方法论 §1.2/§3.2/§3.3，
以及前端两处夹具里的样例文案。

### 16 型 `neighbors` 段重写

每型仍只比四个"只差一个字母"的邻居，但改说机制，四种机制正好一一对应四个邻居：

| 邻居 | 机制 |
|---|---|
| 换 S/N 的那型 | **共享主导**（若主导是判断过程则共享辅助）：分岔在感知那一头 |
| 换 T/F 的那型 | **共享辅助**（若主导是感知过程则共享主导）：接收方式相同，判断落点不同 |
| 换 E/I 的那型 | **同一套四个过程、主辅互换** |
| 换 J/P 的那型 | **每个位置方向不变、类整体互换** |

- 16 段长度 150–219 字（生成器要求 100–260）；
- 跨类型连续 ≥20 汉字重复 = **0**、禁用词 = **0 命中**（生成器每次生成都会查）；
- 逐段过了 `node work/verify_neighbors.mjs`（16 型 × 4 邻居 × 4 项核对：邻居码对不对、
  这一维的说法与真实变化是否一致、段里出现的过程名有没有越界）。
  **它抓到过真问题**：初稿有 9 段的 E/I 说法里一个过程名都没点出来
  （只剩"同一套过程、主辅换了位置"这类抽象话；另有 3 段连这层意思都没说清）——
  与缺陷 10 是同一种毛病，已改成点名具体过程；
- `neighbors` 只影响**新生成**的报告：八段正文会写进报告快照，历史快照仍显示旧文案。

### 本轮的完整命令与输出

（以下取自**改完之后冻结的那一遍**：先跑两条 `--check`，再跑后端与前端全套。）

```
node scripts/convert-jung-content.mjs
→ 类型报告 sha256  a7fddcc61190b0142707a890be3502b2695ed4e6f0948cf105f0b3607c940b1d
  （内容包 939232e3… 与过程层文案 73fea78d… 都没变：改的只是 16 型报告这一个产物）

node scripts/convert-jung-content.mjs --check   → 内容包与 YAML 一致。                  exit 0
node scripts/gen-jung-fixtures.mjs --check      → 夹具一致（3 份，sha256=67ae28a95fd1） exit 0
cd backend; mvn.cmd -o test
→ [WARNING] Tests run: 243, Failures: 0, Errors: 0, Skipped: 1
→ [INFO] BUILD SUCCESS                                                   exit 0
cd frontend; npm.cmd run typecheck               → exit 0（零错误）
cd frontend; npm.cmd test
→ Test Files  17 passed (17) / Tests  693 passed (693)                   exit 0
cd frontend; npm.cmd run build
→ dist/assets/index-C3EV3P3G.js  418.12 kB │ gzip: 162.37 kB
→ ✓ built in 6.77s                                                      exit 0
```

后端 242 → **243** 条：新增的正是那一条 64 组对拍。
前端 bundle 哈希与上一轮**完全相同**（`index-C3EV3P3G.js`）：本轮改的是服务端内容与测试，
没有进入前端产物——这一点可直接核对，不是推测。
