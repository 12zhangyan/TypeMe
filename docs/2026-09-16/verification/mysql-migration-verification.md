# 数据库迁移脚本 · 真实 MySQL 8.4 验证报告

- 日期：2026-09-16
- 验证对象：`backend/src/main/resources/db/migration/` 下的 Flyway 迁移脚本
- 目标：找出这些脚本在**真实 MySQL 8.4** 上的问题（此前只在 H2 的 MySQL 兼容模式下验证过）
- 结论一句话：**8 个脚本在真实 MySQL 8.4 上全部成功执行，但其中 5 个脚本存在 2 类真实缺陷**（CHECK 白名单被 `utf8mb4_0900_ai_ci` 的大小写不敏感悄悄放宽；`ck_answer_rating` 因 CHECK 的 UNKNOWN 语义放行 `RATING + NULL`）。已修复并从头重跑通过。另发现 1 个会**直接阻断应用连库**的配置缺陷（不在迁移脚本内）。
- ⚠️ 任务书写的是 6 个脚本，实际开始验证时是 **7 个**（多一个 `V7`），验证过程中并行会话又新增了 **`V8__widen_credential_hash.sql`**，最终按 **8 个**全量验证（见 §2、§5.10）。所有结论对应的**确切文件版本**用 SHA256 钉在 §2。

---

## 1. 实测环境（全部为真实版本号，来自命令输出）

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| MySQL | `8.4.0` | `SELECT VERSION()` |
| 库字符集 / 排序规则 | `utf8mb4` / `utf8mb4_0900_ai_ci` | `@@character_set_server` / `information_schema` |
| `sql_mode` | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` | `@@sql_mode` |
| mysql 客户端 | `C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe` | — |
| Flyway | `10.10.0`（Spring Boot 3.3.5 托管，`flyway-core` + `flyway-mysql`） | `.tmp-cp.txt` 依赖清单 |
| MySQL 驱动 | `mysql-connector-j 8.3.0` | 同上 |
| H2（对照用） | `2.2.224`，`MODE=MySQL;DATABASE_TO_LOWER=TRUE` | 项目 `AccountIntegrationTestBase` 同款 URL |
| JDK | `openjdk 21.0.12.1+1-LTS`（Temurin，`D:\develop\jdk-21`） | `java -version` |

**安全边界**：全程只在 `typeme_test` / `typeme_dev` 两个本项目专用库内执行 DDL/DML。所有 `DROP TABLE` / `SHOW CREATE TABLE` / 探针语句都带库名前缀（`` `typeme_dev`.`x` ``），没有执行过任何 `CREATE DATABASE` / `DROP DATABASE` / `USE`。收尾时用
`SELECT table_schema, COUNT(*) FROM information_schema.tables GROUP BY table_schema` 复核过：`hl_eam_livetest`(10) / `hl_scm`(1) / `hl_wms`(1) / `interview_db`(6) / `nacos`(10) / `student_management`(4) / `study_room`(6) / `thumb_db`(4) / `yanai_learn`(2) 等库的表数量在验证前后一致，未被触碰。

---

## 2. 脚本清单：实际是 **8 个**，不是任务书写的 6 个

`ls backend/src/main/resources/db/migration`（验证结束时的状态）：

```
V1__account_and_session.sql
V2__assessment_content_and_attempt.sql
V3__report_and_self_reflection.sql
V4__ai_analysis.sql
V5__idempotency_and_deletion.sql
V6__admin_and_ai_settings.sql
V7__ai_job_user_note.sql            <-- 任务书未列出，验证开始时就存在
V8__widen_credential_hash.sql       <-- 验证进行中由并行会话新增（11:04 左右出现）
```

- `V7__ai_job_user_note.sql`：`ALTER TABLE ai_analysis_job ADD COLUMN user_note VARCHAR(320) NULL;`
  **它是迁移链的一部分**：只跑 V1–V6 而不跑 V7，`ai_analysis_job` 会缺 `user_note` 列，AI 模块写 `note` 会报 `Unknown column`。
- `V8__widen_credential_hash.sql`：把 `app_user.password_hash` 与 `account_recovery_code.code_hash` 从 `VARCHAR(255)` 加宽到 `VARCHAR(512)`。我把它一并验证了（§5.10），因为 Flyway 一旦应用过 V7，后续迁移的存在与否会直接决定 `flyway migrate` 是否成功。
- 本次验证按真实情况跑 **V1–V8 全部 8 个**。

**被验证的确切版本（SHA256，`Get-FileHash -Algorithm SHA256`，小写）**：

| 文件 | SHA256 |
| --- | --- |
| `V1__account_and_session.sql` | `88a91e2c9cce893f6c9cc4370dd2b85f85484750d7164bfb14b9c1151763d818` |
| `V2__assessment_content_and_attempt.sql` | `a37142424d4b67d41c73ad463b0d895fdd3fd4c21ecb24a8c515185c483893ae` |
| `V3__report_and_self_reflection.sql` | `25b7091fdc60d2cb60241c91fbc190600e601365a6722cb734447773ae85a043` |
| `V4__ai_analysis.sql` | `0d159d145a3ec21b0116620cf6760c3e8622c4a2be131b0c9f9e7f4932ae20be` |
| `V5__idempotency_and_deletion.sql` | `155adc2b4f35210d8d1e3d36fa62426285d3fd56671f57f6860b9ffc55416698` |
| `V6__admin_and_ai_settings.sql` | `55b02c48dedb5402ad061a073a7d149032c5d2d0ac63a741251b1a04ff1de521` |
| `V7__ai_job_user_note.sql` | `ab93accc11402c7e375821ddd638fd99a68c9250ddb492298c33335f60993fe8` |
| `V8__widen_credential_hash.sql` | `a49885ef8e87234c3e64da61161662cc135a4adddda8d15db736fa8084590932` |

（V1–V3、V5、V6 是我修改后的内容；V4、V7、V8 未被我改动。若并行会话之后又改了这些文件，哈希会对不上，需要重跑。）

**脚本内不含任何禁用语句**：正则扫描 `CREATE DATABASE` / `DROP DATABASE` / `USE <db>` / `ON UPDATE CURRENT_TIMESTAMP` / `ENGINE=` / `COMMENT=` / `DEFAULT CHARSET` / `COLLATE` / `TINYINT(1)` / `REGEXP` / `AUTO_INCREMENT` / `DELIMITER` / `SET @`，命中**全部落在注释行**，可执行 DDL 里一条都没有。所以没有"发现禁用语句、不予执行"的情况。（例外：V1–V6 里那 8 个**列级** `COLLATE` 是我为修 §5.2 主动加的，不是禁用项，详见 §5.2。）

> 注：`MigratonAndSchemaIT.migrationsNeverTouchOtherDatabases` 那条测试会把这些**注释**里的 `CREATE DATABASE` 当成违规命中 —— 详见 §5.9。

---

## 3. 实际执行的完整命令（可复制粘贴）

### 3.1 依赖 classpath（供下面的 Java 执行器使用，只跑一次）

```powershell
$env:JAVA_HOME='D:\develop\jdk-21'
cd D:\develop\develop\code\TypeMe\backend
& mvn.cmd -q -o dependency:build-classpath "-Dmdep.outputFile=D:\develop\develop\code\TypeMe\.tmp-cp.txt"
```

### 3.2 用真实 Flyway 在 `typeme_test` 上跑全部迁移

执行器源码：`docs/2026-09-16/verification/FlywayRunner.java`（`Flyway.configure().dataSource(...).locations("filesystem:<migration dir>")`）。

```powershell
$env:JAVA_HOME='D:\develop\jdk-21'
$java  = 'D:\develop\jdk-21\bin\java.exe'
$javac = 'D:\develop\jdk-21\bin\javac.exe'
$work  = "$env:TEMP\typeme-verify"
$cp    = (Get-Content 'D:\develop\develop\code\TypeMe\.tmp-cp.txt' -Raw).Trim()

& $javac -encoding UTF-8 -cp $cp -d $work "$work\FlywayRunner.java"
& $java -cp "$work;$cp" FlywayRunner `
    "jdbc:mysql://127.0.0.1:3306/typeme_test?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC&characterEncoding=UTF-8" `
    root 123456 `
    "filesystem:D:/develop/develop/code/TypeMe/backend/src/main/resources/db/migration"
```

> ⚠️ URL 里的 `characterEncoding` 必须是 `UTF-8`，**不能用任务书给的 `utf8mb4`** —— 见 §5.1，那是一个真实缺陷。

### 3.3 用 mysql 客户端按顺序手工执行（`typeme_dev`）

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
$dir   = "D:/develop/develop/code/TypeMe/backend/src/main/resources/db/migration"
foreach ($f in (Get-ChildItem "D:\develop\develop\code\TypeMe\backend\src\main\resources\db\migration\*.sql" | Sort-Object Name)) {
  & $mysql "--host=127.0.0.1" "--port=3306" "--user=root" "--password=123456" `
           "--default-character-set=utf8mb4" "--database=typeme_dev" "--show-warnings" `
           "--execute=source $dir/$($f.Name)"
  Write-Host "$($f.Name) exit=$LASTEXITCODE"
}
```

### 3.4 约束/行为探针（逐条独立执行，真实报错逐条捕获）

探针脚本：`docs/2026-09-16/verification/probe-mysql.sql`；逐条执行器：`docs/2026-09-16/verification/run-probes.ps1`。

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass `
    -File "D:\develop\develop\code\TypeMe\docs\2026-09-16\verification\run-probes.ps1" `
    -Db typeme_dev `
    -SqlFile "D:\develop\develop\code\TypeMe\docs\2026-09-16\verification\probe-mysql.sql"
```

探针执行器把 `-- [Pn]` 注释当分隔符，每条 SQL 单独起一次 `mysql.exe`，所以每条探针的 `ERROR ... (code)` 与退出码都是独立、可核对的。原始输出见 `probe-output-mysql-BEFORE-fix.txt`（修复前）与 `probe-output-mysql.txt`（修复后）。

### 3.5 H2 对照 + 项目自带 H2 测试

```powershell
# H2 上没有 mysql 客户端这类工具，用同一份探针 SQL 走 JDBC 跑（H2Probe 会跳过含 @@ 的 MySQL 会话变量语句）
& $java -cp "$work;$cp" H2Probe "$work\probe-final.sql" `
    "D:/develop/develop/code/TypeMe/backend/src/main/resources/db/migration"

# 项目自己的 H2 迁移测试
$env:JAVA_HOME='D:\develop\jdk-21'
cd D:\develop\develop\code\TypeMe\backend
& mvn.cmd -o -B -Dtest='MigrationAndSchemaIT' -DfailIfNoSpecifiedTests=false test
```

### 3.6 清库重跑（每次修复后都要"从零"验证）

```powershell
$mysql = "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe"
$base  = @("--host=127.0.0.1","--port=3306","--user=root","--password=123456","--default-character-set=utf8mb4")
foreach ($db in @('typeme_test','typeme_dev')) {
  $tables = & $mysql @base --batch --skip-column-names `
      -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' ORDER BY table_name;"
  $drops = ($tables | ForEach-Object { "DROP TABLE IF EXISTS ``$db``.``$_``;" }) -join "`n"
  & $mysql @base -e "SET FOREIGN_KEY_CHECKS=0;`n$drops`nSET FOREIGN_KEY_CHECKS=1;"
}
```

---

## 4. 第一轮：修复前的真实结果（能跑通，但行为有问题）

**Flyway 结果：当时存在的 7 个脚本全部成功。**（V8 尚未出现，故为 7/7；加入 V8 后的最终结果是 8/8，见 §7。）

```
10:48:09.692 INFO  DbMigrate -- Current version of schema `typeme_test`: << Empty Schema >>
10:48:09.739 INFO  DbMigrate -- Migrating schema `typeme_test` to version "1 - account and session"
10:48:09.982 INFO  DbMigrate -- Migrating schema `typeme_test` to version "2 - assessment content and attempt"
10:48:10.249 INFO  DbMigrate -- Migrating schema `typeme_test` to version "3 - report and self reflection"
10:48:10.439 INFO  DbMigrate -- Migrating schema `typeme_test` to version "4 - ai analysis"
10:48:10.690 INFO  DbMigrate -- Migrating schema `typeme_test` to version "5 - idempotency and deletion"
10:48:10.874 INFO  DbMigrate -- Migrating schema `typeme_test` to version "6 - admin and ai settings"
10:48:10.949 INFO  DbMigrate -- Migrating schema `typeme_test` to version "7 - ai job user note"
10:48:11.023 INFO  DbMigrate -- Successfully applied 7 migrations to schema `typeme_test`, now at version v7
[runner] migrationsExecuted = 7   success = true   warnings = []
```

同时，Flyway 自身给出两条真实告警（**不是脚本的错，是运行时的版本匹配问题**）：

```
WARN Database -- Flyway upgrade recommended: MySQL 8.4 is newer than this version of Flyway
                 and support has not been tested. The latest supported version of MySQL is 8.1.
WARN Database -- Flyway upgrade recommended: H2 2.2.224 is newer than this version of Flyway
                 and support has not been tested. The latest supported version of H2 is 2.2.220.
```

**mysql 客户端逐文件顺序执行：7/7 全部 `exit=0`、无任何输出（含空 warning）。** 所以脚本的**语法**在两个引擎上都没有问题，问题在**语义**。
---

## 5. 发现的问题（逐条附真实证据）

### 5.1 【阻断级·不在迁移脚本内】JDBC URL 的 `characterEncoding=utf8mb4` 让驱动直接拒连

任务书给的连接串、以及 `backend/src/main/resources/application.yml:38` 的默认值都写了 `characterEncoding=utf8mb4`。Connector/J 要求这里填 **Java 字符集名**，不认 MySQL 的字符集名：

```
[runner] url = jdbc:mysql://127.0.0.1:3306/typeme_test?...&characterEncoding=utf8mb4
Exception in thread "main" org.flywaydb.core.internal.exception.FlywaySqlException:
Unable to obtain connection from database ... for user 'root': Unsupported character encoding 'utf8mb4'
SQL State  : S1009
Caused by: java.io.UnsupportedEncodingException: utf8mb4
    at java.base/java.lang.String.lookupCharset(String.java:850)
```

跨驱动版本复现与修正对照（实测）：

| URL 的 encoding 参数 | Connector/J 8.3.0 | Connector/J 9.7.0 |
| --- | --- | --- |
| `characterEncoding=utf8mb4` | `FAIL SQLState=S1009 Unsupported character encoding 'utf8mb4'` | `FAIL SQLState=S1009` 同上 |
| `characterEncoding=UTF-8` | `OK client=utf8mb4 connection=utf8mb4 collation=utf8mb4_0900_ai_ci` | `OK` 同上 |

改成 `UTF-8` 后服务端协商出来就是 `utf8mb4` / `utf8mb4_0900_ai_ci`，语义完全正确。

**影响**：应用默认配置（不设 `TYPEME_DB_URL`）时连不上本机 MySQL，Flyway 与应用都不会起来。
**本次未改这个文件**：`application.yml` 正被并行会话修改（`git status` 显示它是 ` M`），跨会话改同一文件有互相覆盖的风险。建议由拥有该文件的会话把
`characterEncoding=utf8mb4` → `characterEncoding=UTF-8`（`application-prod.yml` 若有同款也要一起改）。这一条**不需要改迁移脚本**。

### 5.2 【真实缺陷】库默认排序规则 `utf8mb4_0900_ai_ci` 把 7 条 CHECK 白名单悄悄放宽成"大小写不敏感"

脚本刻意不写 `DEFAULT CHARSET` / `COLLATE`（为了 H2 兼容），于是所有字符串列继承库默认的 `utf8mb4_0900_ai_ci`（大小写 + 重音都不敏感）。结果是**脚本注释里写的"白名单钉在数据库里"在 MySQL 上并不成立**：小写值全部能写进库。

修复前 MySQL 实测（`probe-output-mysql-BEFORE-fix.txt`）：

```
-- [P5] lowercase legal role
   [mysql exit=0]                                     <-- 'user' 插进去了！没有任何报错

-- [P12] lowercase 'istj'
   [mysql exit=0]                                     <-- 小写类型码落库

-- [P20] lowercase kind='rating'
   [mysql exit=0]                                     <-- 小写枚举落库

-- [P27] status='in_progress' lowercase
   [mysql exit=0]                                     <-- 小写幂等状态落库

-- [P24] id = 'DEFAULT'
   ERROR 1062 (23000): Duplicate entry 'DEFAULT' for key 'typeme_ai_setting.PRIMARY'
                                                      <-- 单行约束只是"碰巧"被主键挡住，CHECK 本身没拦住

-- [Q6] UPDATE typeme_ai_setting SET api_key_source='ENV' WHERE id='default'   （第二轮探针）
   [mysql exit=0]                                     <-- 大写 'ENV' 通过白名单
```

> 说明：`api_key_source` 的那条探针**第一版写错了**（用了一个新 `id='env-test'`，于是先撞上单行约束 `ck_ai_setting_singleton` 报 3819，证明不了 `ck_ai_setting_source` 的事）。改成对 `id='default'` 这一行做 `UPDATE` 后（第二轮 `[Q6]`）才拿到上面这条 `exit=0` 的真实证据。修复后的 `probe-mysql.sql` 里已经是修正版。

同一条探针在 H2 上的结果**相反**（H2 默认大小写敏感）：

```
-- [P5]  FAIL 23513 Check constraint violation: "ck_app_user_role"
-- [P12] FAIL 23513 Check constraint violation: "ck_report_type_code"
-- [P20] FAIL 23513 Check constraint violation: "ck_answer_kind"
-- [P27] FAIL 23513 Check constraint violation: "ck_idempotency_status"
```

也就是说：**同一份脚本，MySQL 放行、H2 拒绝**。这是本任务要找的"H2 兼容写法在 MySQL 上不成立"的核心命中项。它对应用是真实风险（不是纯理论）：`TypemeUserDetailsService` 把 role 映射成 `ROLE_<role>`，`AiRuntimeSettingsProvider` 用 `'db'/'env'/'none'` 分支，幂等层用大写状态比较 —— 库里存进小写后这些 `equals` 分支会静默走错，而数据库本该是最后一道防线。

**修复**：把这 8 个"枚举列"钉成 `utf8mb4_0900_as_cs`（大小写敏感）。

| 脚本 | 列 | 对应 CHECK |
| --- | --- | --- |
| V1 | `app_user.role` | `ck_app_user_role` |
| V2 | `assessment_answer.kind` | `ck_answer_kind`、`ck_answer_rating` |
| V3 | `assessment_report.computed_type_code` | `ck_report_type_code` |
| V3 | `report_self_reflection.self_selected_type_code` | `ck_reflection_type_code` |
| V5 | `api_idempotency.status` | `ck_idempotency_status` |
| V5 | `account_deletion_job.status` | `ck_deletion_job_status` |
| V6 | `typeme_ai_setting.id` | `ck_ai_setting_singleton` |
| V6 | `typeme_ai_setting.api_key_source` | `ck_ai_setting_source` |

**修复写法为什么是"列定义最末尾的裸 `COLLATE`"**：这是两个引擎唯一的语法交集，四种写法都实测过：

| 写法 | MySQL 8.4 | H2 2.2.224 |
| --- | --- | --- |
| `VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'USER'` | OK | **FAIL 语法错误** |
| `VARCHAR(16) NOT NULL DEFAULT 'USER' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs` | **FAIL 1064** | OK |
| `VARCHAR(16) COLLATE utf8mb4_0900_as_cs`（仅此） | OK | OK |
| **`VARCHAR(16) NOT NULL DEFAULT 'USER' COLLATE utf8mb4_0900_as_cs`** | **OK** | **OK** | ← 采用

MySQL 会把最后一种规范化成 `varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'USER'`（`SHOW CREATE TABLE` 可见），语义完全到位。

**附带前提（必须在部署手册里写清）**：`COLLATE utf8mb4_0900_as_cs` 要求列字符集是 utf8mb4。两个目标库都是 utf8mb4，实测通过；若某环境把库建成 latin1，MySQL 会报 collation 与字符集不匹配。**H2 能解析这个 `COLLATE` 但不会真正应用它** —— H2 本来就大小写敏感，所以两个引擎的**最终行为一致**（见 §9）。

### 5.3 【真实缺陷】`ck_answer_rating` 对 NULL 放行，`kind='RATING'` 却可以没有评分

原 CHECK：

```sql
CONSTRAINT ck_answer_rating CHECK (kind = 'UNKNOWN' AND rating IS NULL
                                   OR kind = 'RATING' AND rating BETWEEN 1 AND 5)
```

`kind='RATING'` 且 `rating IS NULL` 时，`(TRUE AND NULL)` 的结果是 **NULL/UNKNOWN 而不是 FALSE**，MySQL（与 H2 一致）对 UNKNOWN 是**放行**的。修复前实测：

```
-- [P17] kind='RATING' with rating NULL
   [mysql exit=0]        <-- 插入成功，"RATING 却没有评分"落库
-- [P18] rating=9
   ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.   <-- 越界能挡住
-- [P19] UNKNOWN 带 rating
   ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.   <-- 反向也能挡住
```

**修复**：为 RATING 分支显式补 `rating IS NOT NULL`（保留原中文注释风格）。修复后 `[P17]` 变成
`ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.`

> 关于模板里提到的"MySQL 的 CHECK 对 NULL 结果是 UNKNOWN，视为通过"——**实测确认成立**，而且这是本批脚本里**唯一**一处受它影响的约束：其余 CHECK 的判据列都是 `NOT NULL`（`role` / `kind` / `status` / `id` / `api_key_source` / `clarification_skipped` / `enabled` / `mock_mode`），不存在 UNKNOWN 放行的空间。

### 5.4 【注释与实测事实不符】`CHAR_LENGTH` 挡不住 CHAR(4) 的"末尾空格脏值"

V3 原注释写"CHAR(4) 上的 CHAR_LENGTH 对末尾空格敏感，能把 'EI ' 这类脏值挡住"。实测：

```sql
SELECT CHAR_LENGTH(CAST('EI' AS CHAR(4))) AS char4_len_ei, ... ;
+--------------+----------------+------------------+------------+------------+-------+--------+
| char4_len_ei | char4_len_istj | literal_len_istj | ci_in_list | cs_in_list | ci_eq | pad_eq |
+--------------+----------------+------------------+------------+------------+-------+--------+
|            2 |              4 |                4 |          1 |          1 |     1 |      0 |
+--------------+----------------+------------------+------------+------------+-------+--------+
```

`CHAR_LENGTH(CAST('EI' AS CHAR(4))) = 2` —— MySQL 取回 CHAR 列时会剥掉补位空格，`CHAR_LENGTH` **看不见**补位空格。真正挡住 `'EI'` / `'XXXX'` 的是 `IN` 白名单（两者实测都是 `ERROR 3819`）。
**修复**：只改注释说清事实（长度判断在两个引擎上都是冗余但无害、零成本），**不动 CHECK 逻辑**，避免为了注释一致性引入新的跨引擎风险。

### 5.5 【潜在·未改】hex 摘要列的大小写不敏感唯一键

`ai_analysis_job.request_hash CHAR(64)` 上的 `uk_ai_job_request (user_id, request_hash)` 走 `ai_ci`，实测两个只差十六进制字母大小写的 hash 被视为**同一行**：

```
-- [Q8] 第二条 request_hash 用大写 ''
ERROR 1062 (23000) at line 5: Duplicate entry
   '11111111-...-AAAAAAAAAAAAAAAAAAAAAAAAAAA' for key 'ai_analysis_job.uk_ai_job_request'
```

**没有改**，因为当前方向对去重是"更严"的（Java `HexFormat.of()` / `String.format("%02x")` 都产出小写；万一某条代码路径产出大写，`ai_ci` 反而能把重复任务挡住）。改成 `as_cs` 会削弱去重。列为已知语义、需应用层保证 canonical 小写。

### 5.6 【设计/遗留·未改】几处刻意或未说明的"无外键"

- `app_user_session.user_id` 无 FK —— **V1 注释里明确说明是刻意的**。实测确认：给不存在的 user 插会话 `exit=0`，随后按 `session_id` 清理也不被 FK 阻挡（探针 `[S6]` / `[S7]`）。
- `api_idempotency.user_id`、`account_deletion_job.user_id` 无 FK —— 脚本里**没有**说明原因。后果：注销 worker 删掉 `app_user` 行之后，这两个表里会留下指向已删用户的行，需要 worker 自己按 `user_id` 清理（`api_idempotency` 有 `expires_at` + `idx_idempotency_expires` 可兜底，`account_deletion_job` 没有）。
- `ai_consent.user_id` 无 FK（只对 `job_id` 建了 FK）。

### 5.7 【可观测性·未改】冗余索引

MySQL 实际建出的索引里有 3 处是左前缀冗余（实测 `information_schema.statistics`）：

| 表 | 冗余索引 | 已被谁覆盖 |
| --- | --- | --- |
| `assessment_answer` | `idx_answer_attempt (attempt_id)` | `PRIMARY (attempt_id, question_id)` |
| `assessment_attempt` | `idx_attempt_user_status (user_id, status)` | `idx_attempt_user (user_id, updated_at)` 的左前缀 |
| `report_self_reflection` | `uk_self_reflection (report_id, user_id)` | `PRIMARY (report_id)` |

属于"多占一点写入开销、不影响正确性"，**未改**（改索引会影响 `EXPLAIN` 与后续迁移编号，超出本次修复边界）。

### 5.8 【引擎差异·已实测确认，非缺陷】MySQL 会为 FK 自动建索引，并在稍后出现等价索引时**删掉**它

这解释了为什么 `SHOW CREATE TABLE` 里有些 FK 有同名索引、有些没有。受控实验（`probe-mysql2.sql` `[Q12]–[Q15]`）：

```
-- [Q13] CREATE TABLE 之后（仅声明 FK，无显式索引）
+-----------------------+------+
| INDEX_NAME            | cols |
| fk_probe_child_parent | pid  |     <-- MySQL 自动建，名字 = 约束名
| PRIMARY               | id   |
-- [Q14] CREATE INDEX idx_probe_child_pid ON probe_child (pid, at);
-- [Q15] 再查
| idx_probe_child_pid   | pid,at |   <-- 自动建的 fk_probe_child_parent **消失了**
| PRIMARY               | id     |
```

所以 `account_recovery_code` / `ai_consent` 最终只剩脚本显式建的索引，而 `ai_analysis_job` / `assessment_attempt` / `report_self_reflection` 留着 MySQL 自动命名（= 约束名）的索引。**H2 不会自动建这些索引**，所以两边的 `SHOW CREATE TABLE` 必然不同。含义：以后若要 `DROP INDEX` 这些自动索引，**索引名是引擎生成的**（等于 FK 名），不能凭空猜。

### 5.9 【测试侧·重要】项目自带的 H2 迁移测试此前**根本编译不过**，且其中 1 条断言在任何时候都必失败

第一次跑 `mvn -o -Dtest=MigrationAndSchemaIT test` 的真实输出：

```
[ERROR] COMPILATION ERROR :
[ERROR] .../AccountIntegrationTestBase.java:[12,45] 找不到符号
  符号: 类 TypeExcludeFilters
  位置: 程序包 org.springframework.boot.test.context
[ERROR] BUILD FAILURE
```

`AccountIntegrationTestBase.java:12` 当时 import 的是 `org.springframework.boot.test.context.TypeExcludeFilters`，正确包是 `org.springframework.boot.test.autoconfigure.filter.TypeExcludeFilters`（同仓库的 `ExcludeCrossModuleTestConfigs.java:4` 用的是后者）。**这是本次验证开始时的既存状态，不是我改出来的**（我只改了 `db/migration/*.sql`，没碰任何测试源码）。在我核对期间该 import 已被并行会话修正，于是测试终于能跑。

修正 import 后的真实结果：

```
[INFO] Running com.typeme.account.MigrationAndSchemaIT
[ERROR] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0, Time elapsed: 23.75 s <<< FAILURE!
[ERROR] com.typeme.account.MigrationAndSchemaIT.migrationsNeverTouchOtherDatabases <<< FAILURE!
[ERROR]   MigrationAndSchemaIT.migrationsNeverTouchOtherDatabases:150 [V1__account_and_session.sql 不得含 CREATE DATABASE]
```

`5 条里 4 条通过`——**包括"15 张表都建出来了"和"CHECK 挡住非法角色"这两条**，即修改后的脚本在 H2 上是真跑通的。

唯一失败的 `migrationsNeverTouchOtherDatabases` 是**既存缺陷，与本次修改无关**：它把文件原文 `toUpperCase()` 后直接断言"不含 CREATE DATABASE"，而**注释里的"不写 CREATE DATABASE"这句话本身就会命中**。实测命中的三个文件里，`V4` 与 `V7` 我**一行都没改**：

```
V1__account_and_session.sql:6: --   * 不写 CREATE DATABASE / USE。
V4__ai_analysis.sql:5:         --   * 不写 CREATE DATABASE / USE / DROP DATABASE，也不引用其它库；
V7__ai_job_user_note.sql:14:   -- 兼容性：与 V4 同样的限制 —— 不用 ENGINE=/COMMENT=/ON UPDATE，不写 USE / CREATE DATABASE，
```

V1 第 6 行也是**改动前就有的原文**。所以这条断言从写完起就不可能通过。
**建议修法**（属测试源码，不在我的修复范围，未动）：扫描前先剥掉 `--` 注释行再断言，或改成按语句边界匹配 `^\s*CREATE\s+DATABASE`。

### 5.10 验证期间新增的 `V8` —— 已一并验证通过（真实 MySQL 8.4）

`V8__widen_credential_hash.sql` 在我验证到一半时（约 11:04）由并行会话加入：

```sql
ALTER TABLE app_user MODIFY COLUMN password_hash VARCHAR(512) NOT NULL;
ALTER TABLE account_recovery_code MODIFY COLUMN code_hash VARCHAR(512) NOT NULL;
```

真实 MySQL 8.4 实测结果：

```
########## FINAL: mysql client sequential on typeme_dev (all 8) ##########
SOURCE V8__widen_credential_hash.sql -> exit=0 (no output)
```

```
+-----------------------+---------------+--------------+--------------------------+--------------------+
| TABLE_NAME            | COLUMN_NAME   | COLUMN_TYPE  | CHARACTER_MAXIMUM_LENGTH | COLLATION_NAME     |
+-----------------------+---------------+--------------+--------------------------+--------------------+
| account_recovery_code | code_hash     | varchar(512) |                      512 | utf8mb4_0900_ai_ci |
| app_user              | password_hash | varchar(512) |                      512 | utf8mb4_0900_ai_ci |
+-----------------------+---------------+--------------+--------------------------+--------------------+
```

并且**验证了 V8 的动机在真实 MySQL 上成立**（`ALTER ... MODIFY` 语义正确、加宽确实必要）：

```
-- 266 字符的 PBKDF2 编码串写进 V8 之后的列，回读长度一致
INSERT INTO app_user (..., password_hash, ...) VALUES (..., REPEAT('x',266), ...);
+------------+
| stored_len |
+------------+
|        266 |
+------------+

-- 同样的 266 字符写进旧宽度 VARCHAR(255) 会被拒（这正是 V8 要修的问题）
CREATE TABLE probe_v8 (h VARCHAR(255) NOT NULL);
INSERT INTO probe_v8 (h) VALUES (REPEAT('x',266));
   ERROR 1406 (22001) at line 1: Data too long for column 'h' at row 1
```

结论：**V8 在真实 MySQL 8.4 上验证通过**，`ALTER TABLE ... MODIFY COLUMN` 是 MySQL 8.4 与 H2(MODE=MySQL) 都支持的写法；`MODIFY` 后两列仍保持表默认的 `utf8mb4_0900_ai_ci`（这两列不承载枚举白名单，不需要钉 `as_cs`）。V8 未被我修改。

---

## 6. 修复内容（共 5 个文件，保留原有中文注释风格）

| 文件 | 改了什么 | 为什么 |
| --- | --- | --- |
| `V1__account_and_session.sql` | `role` 加 `COLLATE utf8mb4_0900_as_cs`（放在列定义末尾） | §5.2：`ai_ci` 让 `ck_app_user_role` 放行 `'user'` |
| `V2__assessment_content_and_attempt.sql` | `kind` 加同样的 `COLLATE`；`ck_answer_rating` 补 `rating IS NOT NULL` | §5.2 + §5.3 |
| `V3__report_and_self_reflection.sql` | `computed_type_code`、`self_selected_type_code` 加同样的 `COLLATE`；修正 `CHAR_LENGTH` 的注释使其与实测一致 | §5.2 + §5.4 |
| `V5__idempotency_and_deletion.sql` | `api_idempotency.status`、`account_deletion_job.status` 加同样的 `COLLATE` | §5.2 |
| `V6__admin_and_ai_settings.sql` | `id`、`api_key_source` 加同样的 `COLLATE` | §5.2 |
| `V4__ai_analysis.sql`、`V7__ai_job_user_note.sql` | **未改动** | 实测无缺陷 |

每个改动点都写了中文注释说明"为什么这么改 + 实测证据 + 为什么 COLLATE 必须放在列定义末尾"。

**关于 Flyway checksum**：改文件会改 checksum。本次验证开始时 `typeme_test` 与 `typeme_dev` 都是**空库**（`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=...` 均为 `0`），仓库里也没有任何已应用过 V1–V8 的库；`git status` 显示 `backend/src/main/resources/db/migration/` 整个目录都还是**未跟踪的新文件**（`?? backend/src/main/resources/db/`）。所以直接原地改脚本是安全的，不需要 `flyway repair`，也不会造成版本冲突。

---

## 7. 修复后从零重跑的真实结果

1. 清空 `typeme_test` / `typeme_dev`（全部项目表 `DROP`，退出码 0）。
2. **Flyway on MySQL 8.4（全部 8 个，最终状态）**：

```
INFO DbValidate -- Successfully validated 8 migrations (execution time 00:00.044s)
INFO DbMigrate  -- Current version of schema `typeme_test`: << Empty Schema >>
INFO DbMigrate  -- Migrating schema `typeme_test` to version "1 - account and session"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "2 - assessment content and attempt"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "3 - report and self reflection"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "4 - ai analysis"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "5 - idempotency and deletion"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "6 - admin and ai settings"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "7 - ai job user note"
INFO DbMigrate  -- Migrating schema `typeme_test` to version "8 - widen credential hash"
INFO DbMigrate  -- Successfully applied 8 migrations to schema `typeme_test`, now at version v8 (execution time 00:00.716s)
[runner] targetSchemaVersion = 8   migrationsExecuted = 8   success = true   warnings = []
```

`flyway_schema_history` 8 行全部 `SUCCESS`。

3. **Flyway 第二遍（幂等性）**（此时是 7 个脚本时的记录，加入 V8 后同样的 `validate` + "无待执行迁移" 行为）：

```
INFO DbValidate  -- Successfully validated 7 migrations (execution time 00:00.051s)
INFO DbMigrate   -- Current version of schema `typeme_test`: 7
INFO DbMigrate   -- Schema `typeme_test` is up to date. No migration necessary.
[runner] migrationsExecuted = 0   success = true
```

4. **mysql 客户端逐文件顺序执行（全部 8 个）：8/8 `exit=0`、零输出**。
5. **H2（Flyway 直跑，全部 8 个）：`migrationsExecuted=8 target=8 success=true`** —— 修复后的脚本在 H2 上仍然全部可执行（这一步是必须的：我第一版修复用了 `CHARACTER SET ... COLLATE ... NOT NULL DEFAULT`，在 MySQL OK 但 **H2 直接语法错误**，正是这一步抓出来的）。
6. **项目自带 `MigrationAndSchemaIT`：`Tests run: 5, Failures: 1`**，失败的那条是 §5.9 说明的既存注释扫描断言。

---

## 8. 每张表的最终结构核对结论（`typeme_test`，Flyway 建出）

共 **15 张业务表 + `flyway_schema_history`**。全部 `ENGINE=InnoDB` / `ROW_FORMAT=Dynamic` / `TABLE_COLLATION=utf8mb4_0900_ai_ci`。完整 `SHOW CREATE TABLE` 原文见 `show-create-table-typeme_test.sql`。

约束字典实测计数：`PRIMARY KEY 16`（15 业务表 + history）、`UNIQUE 6`、`CHECK 12`、`FOREIGN KEY 11`。

| # | 表 | 主键 | 唯一约束 | CHECK | 外键 | 索引 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `app_user` | `id` | `uk_app_user_username(username_normalized)` | `ck_app_user_role`（已钉 as_cs，只收 `USER/ADMIN`） | 无（被引用方） | 主键 + 唯一 | ✅ 字符集 utf8mb4；`role` 默认 `'USER'` 实测生效；**V8 后 `password_hash` 为 `varchar(512)`** |
| 2 | `account_recovery_code` | `id` | — | — | `fk_recovery_user → app_user(id) ON DELETE CASCADE` | `idx_recovery_user(user_id,used_at)` | ✅ 级联实测生效（删用户后 2→0 行）；**V8 后 `code_hash` 为 `varchar(512)`** |
| 3 | `app_user_session` | `session_id` | — | — | **无（V1 注释说明是刻意的）** | `idx_session_user(user_id)` | ✅ 与设计一致 |
| 4 | `assessment_package` | `package_id` | — | — | 无 | 主键 | ✅ `content_json` 为 `mediumtext NOT NULL`，实测存 100000 字符不截断 |
| 5 | `assessment_attempt` | `id` | — | `ck_attempt_clarification_skipped (0,1)` | `fk_attempt_user→app_user`、`fk_attempt_package→assessment_package` | `idx_attempt_user`、`idx_attempt_user_status`、`fk_attempt_package`(自动) | ✅ 类；`clarification_skipped=2` 实测 `ERROR 3819` |
| 6 | `assessment_answer` | `(attempt_id,question_id)` | — | `ck_answer_kind`、`ck_answer_rating`（**已修**） | `fk_answer_attempt→assessment_attempt ON DELETE CASCADE` | `idx_answer_attempt`（与主键左前缀冗余） | ✅ 修复后 `RATING+NULL` 与 `rating` 小写均被拒 |
| 7 | `assessment_report` | `id` | `uk_report_attempt(attempt_id)` | `ck_report_type_code`（**已钉 as_cs**） | `fk_report_attempt→assessment_attempt`、`fk_report_user→app_user` | `idx_report_user(user_id,created_at)` | ✅ `'XX'`/`'EI'`/`'XXXX'`/`'istj'` 全部 `ERROR 3819`；`NULL`（TIED）与 16 个合法码通过 |
| 8 | `report_self_reflection` | `report_id` | `uk_self_reflection(report_id,user_id)`（与主键完全冗余） | `ck_reflection_type_code`（**已钉 as_cs**） | `fk_reflection_report→assessment_report ON DELETE CASCADE`、`fk_reflection_user→app_user` | `fk_reflection_user`(自动) | ✅ |
| 9 | `ai_analysis_job` | `id` | `uk_ai_job_idem(user_id,idempotency_key)`、`uk_ai_job_request(user_id,request_hash)` | 无（`status` 未在库层白名单） | `fk_ai_job_user→app_user`、`fk_ai_job_report→assessment_report ON DELETE CASCADE` | `idx_ai_job_pending(status,next_run_at)`、`fk_ai_job_report`(自动) | ✅ V7 的 `user_note VARCHAR(320) NULL` 已建 |
| 10 | `ai_consent` | `id` | — | — | `fk_ai_consent_job→ai_analysis_job ON DELETE CASCADE` | `idx_ai_consent_job(job_id)` | ✅ 二级级联实测生效（删报告 → job 0 行、consent 0 行） |
| 11 | `ai_usage_budget` | `(scope_key,budget_date)` | — | — | 无 | 主键 | ✅ `date`/`bigint` 无字符集问题 |
| 12 | `api_idempotency` | `(user_id,operation,idempotency_key)` | — | `ck_idempotency_status`（**已钉 as_cs**） | **无**（§5.6） | `idx_idempotency_expires(expires_at)` | ✅ `'in_progress'`/`'BOGUS'` 均 `ERROR 3819` |
| 13 | `account_deletion_job` | `id` | `uk_deletion_job_user(user_id)` | `ck_deletion_job_status`（**已钉 as_cs**） | **无**（§5.6） | `idx_deletion_job_pending(status,requested_at)` | ✅ `'pending'` `ERROR 3819`、`'PENDING'` 通过 |
| 14 | `rate_limit_bucket` | `bucket_key` | — | — | 无 | `idx_rate_limit_window(window_start)` | ✅ |
| 15 | `typeme_ai_setting` | `id` | — | `ck_ai_setting_singleton`/`_source`（**已钉 as_cs**）、`_enabled`、`_mock` | 无 | 主键 | ✅ `'other'`/`'DEFAULT'`/`'ENV'` 均 `ERROR 3819`；`'default'`/`'env'` 通过 |

字符集总账（`information_schema.columns`）：`utf8mb4 / utf8mb4_0900_ai_ci` 共 **79** 列，`utf8mb4 / utf8mb4_0900_as_cs` 共 **8** 列（即上表 8 个枚举列）。**没有任何列落在 utf8mb4 之外。**

表数 15、CHECK 12、FK 11、UNIQUE 6 这四项计数在**加入 V8 前后完全一致**（V8 只是改列宽，没有增删表/约束）。

---

## 9. 约束生效性验证：真实报错原文

以下全部来自 `probe-output-mysql.txt`（修复后、`typeme_dev`），每条探针单独一次 `mysql.exe` 调用。

### 9.1 修复后必被拒绝的非法写入（真实报错）

| 探针 | 语句要点 | 真实返回 |
| --- | --- | --- |
| P4 | `app_user.role='SUPERUSER'` | `ERROR 3819 (HY000): Check constraint 'ck_app_user_role' is violated.` |
| P5 | `app_user.role='user'` | `ERROR 3819 (HY000): Check constraint 'ck_app_user_role' is violated.` |
| P6 | `UPDATE app_user SET role='HACKER'` | `ERROR 3819 (HY000): Check constraint 'ck_app_user_role' is violated.`（UPDATE 路径同样强制） |
| P8 | `clarification_skipped=2` | `ERROR 3819 (HY000): Check constraint 'ck_attempt_clarification_skipped' is violated.` |
| **P9** | `assessment_report.computed_type_code='XX'` | `ERROR 3819 (HY000): Check constraint 'ck_report_type_code' is violated.` |
| P12 | 同上 `='istj'` | `ERROR 3819 (HY000): Check constraint 'ck_report_type_code' is violated.` |
| P13 | 同上 `='EI'` | `ERROR 3819 (HY000): Check constraint 'ck_report_type_code' is violated.` |
| P14 | 同上 `='XXXX'` | `ERROR 3819 (HY000): Check constraint 'ck_report_type_code' is violated.` |
| **P15** | 同一 `attempt_id` 插第二条报告 | `ERROR 1062 (23000): Duplicate entry '22222222-2222-2222-2222-222222222222' for key 'assessment_report.uk_report_attempt'` |
| P16 | `user_id` 指向不存在的用户 | ``ERROR 1452 (23000): Cannot add or update a child row: a foreign key constraint fails (`typeme_dev`.`assessment_report`, CONSTRAINT `fk_report_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))`` |
| P17 | `kind='RATING'` 且 `rating IS NULL`（修复前放行） | `ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.` |
| P18 | `kind='RATING', rating=9` | `ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.` |
| P19 | `kind='UNKNOWN', rating=3` | `ERROR 3819 (HY000): Check constraint 'ck_answer_rating' is violated.` |
| P20 | `kind='rating'` | `ERROR 3819 (HY000): Check constraint 'ck_answer_kind' is violated.` |
| P1 | 重复 `username_normalized='alice'` | `ERROR 1062 (23000): Duplicate entry 'alice' for key 'app_user.uk_app_user_username'` |
| P23 | `typeme_ai_setting.id='other'` | `ERROR 3819 (HY000): Check constraint 'ck_ai_setting_singleton' is violated.` |
| P24 | `id='DEFAULT'` | `ERROR 3819 (HY000): Check constraint 'ck_ai_setting_singleton' is violated.` |
| P25 | `UPDATE ... api_key_source='ENV'` | `ERROR 3819 (HY000): Check constraint 'ck_ai_setting_source' is violated.` |
| P26 | `enabled=7` | `ERROR 3819 (HY000): Check constraint 'ck_ai_setting_enabled' is violated.` |
| P27 | `status='in_progress'` | `ERROR 3819 (HY000): Check constraint 'ck_idempotency_status' is violated.` |
| P28 | `status='BOGUS'` | `ERROR 3819 (HY000): Check constraint 'ck_idempotency_status' is violated.` |
| S1 | `account_deletion_job.status='pending'` | `ERROR 3819 (HY000): Check constraint 'ck_deletion_job_status' is violated.` |
| S3 | `self_selected_type_code='istj'` | `ERROR 3819 (HY000): Check constraint 'ck_reflection_type_code' is violated.` |
| Q3 | `username_normalized` 写 65 字符 | `ERROR 1406 (22001): Data too long for column 'username_normalized' at row 1`（`STRICT_TRANS_TABLES` 生效，**不静默截断**） |
| P31 | `DELETE FROM app_user`（其名下有 attempt） | ``ERROR 1451 (23000): Cannot delete or update a parent row: a foreign key constraint fails (`typeme_dev`.`assessment_attempt`, CONSTRAINT `fk_attempt_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`))`` |

### 9.2 合法写入必须通过（实测 `exit=0`）

`role='USER'` / 省略 `role` 吃到 `DEFAULT 'USER'`（实测回读 `USER`）/ `computed_type_code='ISTJ'` / `computed_type_code IS NULL`（TIED）/ `kind='RATING', rating=5` / `id='default'` / `api_key_source='env'` / `status='PENDING'` / `self_selected_type_code='ISTJ'`。

### 9.3 类型与容量实测

- **`MEDIUMTEXT`**：向 `assessment_package.content_json` 写入 `REPEAT('x',100000)`，回读 `CHAR_LENGTH = 100000`。若当初按"更标准"的 `TEXT` 写，上限 65535 会截断/报错 —— 选 `MEDIUMTEXT` 是对的。
- **`DATETIME(6)`**：写入 `'2026-09-16 12:34:56.123456'`，回读 `2026-09-16 12:34:56.123456`、`MICROSECOND=123456`；`'...00:00:00.000001'` 回读 `000001`。微秒级完整保留。
- **`TINYINT`**：`rating`/`enabled`/`mock_mode`/`clarification_skipped` 的 CHECK 边界实测（`0/1` 通过、`2`/`7`/`9` 被拒）。
- **`CHAR(36)` / `CHAR(64)` / `CHAR(8)`**：UUID 与 sha256 正常建列建索引；`CHAR(64)` 唯一键可用（§5.5 的大小写语义另记）。
- **无 `ENGINE=` / `DEFAULT CHARSET` / `COLLATE`（表级）/ `COMMENT=` / `ON UPDATE CURRENT_TIMESTAMP`** —— 全部实测由库默认补成 `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`，没有引发任何问题。

---

## 10. H2 vs 真实 MySQL：同一份脚本、同一批探针的行为对照

`BEFORE` = 修复前；`AFTER` = 修复后。H2 用 `MODE=MySQL;DATABASE_TO_LOWER=TRUE`（与项目测试同款 URL）。

| 探针 | MySQL BEFORE | **MySQL AFTER** | H2 BEFORE | **H2 AFTER** | 一致性 |
| --- | --- | --- | --- | --- | --- |
| P1 重复 username | 1062 | 1062 | 23505 | 23505 | ✅ |
| **P2 username 仅大小写不同** | **1062 拒绝** | **1062 拒绝** | **OK 接受** | **OK 接受** | ❌ **仍不一致（刻意保留，见下）** |
| P3 username 带尾随空格 | OK | OK | OK | OK | ✅ |
| P4 非法 role | 3819 | 3819 | 23513 | 23513 | ✅ |
| **P5 小写 role `'user'`** | **OK（缺陷）** | **3819** | 23513 | 23513 | ✅ **修复后一致** |
| P6 UPDATE 非法 role | 3819 | 3819 | 23513 | 23513 | ✅ |
| P7 省略 role 取默认 | OK `USER` | OK `USER` | OK | OK | ✅ |
| P8 `clarification_skipped=2` | 3819 | 3819 | 23513 | 23513 | ✅ |
| P9 类型码 `'XX'` | 3819 | 3819 | 23513 | 23513 | ✅ |
| P10 类型码 `'ISTJ'` | OK | OK | OK | OK | ✅ |
| P11 类型码 `NULL` | OK | OK | OK | OK | ✅ |
| **P12 类型码 `'istj'`** | **OK（缺陷）** | **3819** | 23513 | 23513 | ✅ **修复后一致** |
| P13 类型码 `'EI'` | 3819 | 3819 | 23513 | 23513 | ✅ |
| P14 类型码 `'XXXX'` | 3819 | 3819 | 23513 | 23513 | ✅ |
| P15 重复 attempt_id | 1062 | 1062 | 23505 | 23505 | ✅ |
| P16 不存在 user_id | 1452 | 1452 | 23506 | 23506 | ✅ |
| **P17 RATING + NULL** | **OK（缺陷）** | **3819** | **OK（同样放行）** | **23513** | ✅ **修复后一致** |
| P18 rating=9 | 3819 | 3819 | 23513 | 23513 | ✅ |
| P19 UNKNOWN + rating | 3819 | 3819 | 23513 | 23513 | ✅ |
| **P20 小写 `'rating'`** | **OK（缺陷）** | **3819** | 23513 | 23513 | ✅ **修复后一致** |
| P21 合法 RATING | OK | OK | OK | OK | ✅ |
| P22 `id='default'` | OK | OK | OK | OK | ✅ |
| P23 `id='other'` | 3819 | 3819 | 23513 | 23513 | ✅ |
| **P24 `id='DEFAULT'`** | **1062（主键误挡）** | **3819（CHECK 正确拦下）** | 23513 | 23513 | ✅ **修复后一致** |
| **P25 `api_key_source='ENV'`** | **见注 ①** | **3819**（`ck_ai_setting_source`） | **见注 ①** | **23513**（`ck_ai_setting_source`） | ✅ **修复后一致** |
| P26 `enabled=7` | 3819 | 3819 | 23513 | 23513 | ✅ |
| **P27 小写 `'in_progress'`** | **OK（缺陷）** | **3819** | 23513 | 23513 | ✅ **修复后一致** |
| P28 `'BOGUS'` | 3819 | 3819 | 23513 | 23513 | ✅ |
| S1 小写 `'pending'`（删除任务） | 未测 | 3819 | 23513 | 23513 | ✅ |
| S3 小写 `'istj'`（自我理解） | 未测 | 3819 | 23513 | 23513 | ✅ |
| S5 `api_key_source='env'` | 未测 | OK | OK | OK | ✅ |
| S6/S7 无 FK 的会话表 | 未测 | OK / OK | OK / OK | OK / OK | ✅ |
| P31 删还有 attempt 的用户 | 1451 | 1451 | 23503 | 23503 | ✅ |

**唯一残留的不一致：P2。** MySQL 的 `uk_app_user_username` 走 `ai_ci`，`'alice'` 与 `'ALICE'` 视为同一行（`ERROR 1062`）；H2 大小写敏感，两行都能存在（`OK`）。**刻意不改**：V1 的列名就是 `username_normalized`（应用层负责规范化），唯一键大小写不敏感对"防止 `Alice` / `alice` 注册出两个账号"是**想要的**语义，H2 只是没实现这层保护。属于 H2 侧弱于 MySQL，不是 MySQL 侧缺陷。若要两引擎完全一致，得在 H2 测试里也能表达 `ai_ci`，H2 做不到。

> 注 ①：`P25` 在**修复前**的探针文件里是一条写错的 `INSERT`（用了新 `id='env-test'`，先撞 `ck_ai_setting_singleton`，实测 MySQL 与 H2 都报单行约束违规），因此它证明不了 `api_key_source` 的事；那一轮的真实证据是第二轮的 `[Q6]`（MySQL `exit=0`，大写 `'ENV'` 通过）。修复后的 `probe-mysql.sql` 已把 `P25` 改成对 `id='default'` 行做 `UPDATE`，于是 AFTER 一列在两个引擎上都直接落在 `ck_ai_setting_source` 上。

**另外确认**：`information_schema` 的差异会让同一条元数据查询在 H2 上报错（实测 `Column "column_type" not found`，探针 `[S8]`）—— 这是目录视图差异，不是脚本行为差异；写跨引擎的元数据断言时要避开这类 MySQL 专有列。

**汇总计数（最终一轮，8 个迁移已全部应用）**：同一份 `probe-mysql.sql` 在真实 MySQL 8.4 上产生 `25` 条错误行 / `17` 条 `exit=0` 行；在 H2 2.2.224 上产生 `25` 条 `FAIL` 行 / `16` 条 `OK` 行。差异的 1 条即上表 **P2**（MySQL 因 `ai_ci` 拒绝 `'ALICE'`，H2 接受），其余逐条一致。

---

## 11. 明确区分：哪些是"真实 MySQL 8.4 上验证通过"，哪些只是"H2 验证过"，哪些没验证

### ✅ 真实 MySQL 8.4 上实测通过（有命令输出为证）

1. V1–V8 全部 8 个脚本用 **Flyway 10.10.0 + mysql-connector-j 8.3.0** 在 `typeme_test` 上从空库跑通：`migrationsExecuted=8 target=v8 success=true warnings=[]`。
2. 同一批脚本用 **mysql 8.4 客户端**在 `typeme_dev` 上顺序执行：8/8 `exit=0`。
3. Flyway 第二遍幂等：`Successfully validated N migrations` + `No migration necessary` + `migrationsExecuted=0`。
4. 15 张业务表 + `flyway_schema_history` 全部建成，全 InnoDB / 全 utf8mb4。
5. 12 条 CHECK、11 条 FK、6 条 UNIQUE 全部出现在 `information_schema` 字典里，并且**逐条用非法数据打穿验证**（§9.1 的 3819/1062/1452/1451/1406 都是真实返回）。
6. `MEDIUMTEXT` 容量、`DATETIME(6)` 微秒精度、`STRICT_TRANS_TABLES` 防静默截断、`ON DELETE CASCADE`（单级与两级）都实测。
7. MySQL 自动建/自动删 FK 索引的行为用受控实验实测（§5.8）。
8. `characterEncoding=utf8mb4` 的拒连在 Connector/J 8.3.0 与 9.7.0 两个版本上实测复现（§5.1）。
9. **V8 的列宽修正实测**：`password_hash` / `code_hash` 为 `varchar(512)`，266 字符值写入并回读一致；同样的值写进旧宽度 `VARCHAR(255)` 报 `ERROR 1406 (22001)`（§5.10）。

### ✅ 同时也用 H2 2.2.224 实测过（不是"只在 H2 上"）

10. 修复后的 V1–V8 在 H2（`MODE=MySQL;DATABASE_TO_LOWER=TRUE`）上 Flyway `migrationsExecuted=8 target=8 success=true`。
11. 项目自带 `MigrationAndSchemaIT` 在（并行会话）修好那个错误的 import 之后跑出 `Tests run: 5, Failures: 1`，4 条通过（含"15 张表都在"与"CHECK 挡住非法角色"）。
12. §10 的两引擎对照表是我在两边**都跑过**同一份探针 SQL 得到的，不是推断。

### ⚠️ 只在 H2 上验证过（真实 MySQL 上**没有**验证）

13. `RateLimitService` / `AiBudgetRepository` 的 upsert 路径（`INSERT ... ON DUPLICATE KEY UPDATE` 与 `MERGE` 的方言分流）。我只验证了 `rate_limit_bucket` 与 `ai_usage_budget` 的**表结构**确实支持这些键（`PRIMARY KEY (bucket_key)`、`PRIMARY KEY (scope_key, budget_date)`），**没有**在真实 MySQL 上跑过应用的 upsert 语句。应用层 SQL 不在本次脚本验证范围内。
14. `account_recovery_code` 的"消费一次"原子 `UPDATE ... WHERE used_at IS NULL` 语义、`app_user_session` 的过期清理 SQL —— 只在 H2 测试里钉过，我没有在 MySQL 上执行应用的这些语句。
15. 前端 / 应用启动 / 端到端接口 —— 完全没验证。而且注意：**应用当前用默认配置连不上 MySQL**（§5.1），在修掉 `characterEncoding` 之前，任何"应用在真实 MySQL 上能起来"的说法都不成立。

### ❌ 本次完全没验证

16. InnoDB 之外的行为（本次全为 InnoDB）。
17. 生产库的既有数据迁移（`typeme_test` / `typeme_dev` 都是空库，V1 之前的基线不存在）。
18. `V4` 的 `ai_analysis_job.status` 未做库层白名单（`QUEUED/RUNNING/SUCCEEDED/FAILED/UNKNOWN/CANCELLED` 只在应用层），我**没有**验证应用是否真的只写这 6 个值。
19. 生产环境排序规则若与 `utf8mb4_0900_ai_ci` 不同（例如 DBA 建成 `utf8mb4_general_ci` 或 `utf8mb4_bin`），§5.2 的修复效果与 §5.5 的 hash 比较语义都会变 —— 只在当前这两个库上验证过。
20. 并发/性能（CHECK 与额外索引对写吞吐的影响、Flyway 迁移耗时在真实数据量下的表现）。迁移本身在空库上 8 个脚本共耗时 `00:00.716s`。
21. **验证期间仍在变化的文件**：`db/migration/` 是并行会话的活跃编辑区（V8 就是验证中途出现的）。§2 的 SHA256 钉住的是我实测的那一版；文件若再变，结论需要重跑。

---

## 12. 遗留问题清单（按优先级）

| 优先级 | 问题 | 位置 | 建议 |
| --- | --- | --- | --- |
| **P0** | `characterEncoding=utf8mb4` 让驱动拒连，应用起不来 | `application.yml:38`（`application-prod.yml` 若有同款） | 改为 `characterEncoding=UTF-8`。**不在迁移脚本内，本次未改**（该文件正被并行会话修改） |
| **P1** | `MigrationAndSchemaIT.migrationsNeverTouchOtherDatabases` 必失败（断言扫到了注释原文里的 "CREATE DATABASE"），且该测试此前因错误 import 整体编译不过 | `backend/src/test/java/com/typeme/account/` | 断言前剥掉 `--` 注释行，或按语句边界 `^\s*CREATE\s+DATABASE` 匹配 |
| **P2** | Flyway 10.10.0 未官方支持 MySQL 8.4（`Latest supported version of MySQL is 8.1`） | `backend/pom.xml` 的 `flyway-core`/`flyway-mysql` | 升级到声明支持 8.4 的 Flyway 版本，或固定 MySQL 到 8.0/8.1 并记录该组合未被官方测试 |
| **P3** | 启动期应校验库的字符集/排序规则前提（`COLLATE utf8mb4_0900_as_cs` 要求 utf8mb4 列字符集） | 部署手册 / 启动校验 | 加一条启动断言：`@@character_set_database='utf8mb4'`，否则给出可读报错而非迁移中途失败 |
| **P4** | `api_idempotency.user_id` / `account_deletion_job.user_id` 无 FK 且无注释说明；注销 worker 需自行清理 | V5 | 补注释说明清理责任，或在注销 worker 里显式删这两张表 |
| **P5** | hex 摘要列唯一键大小写不敏感（`uk_ai_job_request` / `uk_ai_job_idem`） | V4/V5 | 明确 canonical 小写约定并加测试；不改约束 |
| **P6** | 3 处左前缀冗余索引 | V2/V3 | 待有 `EXPLAIN` 依据时用新版本迁移清理 |
| **P7** | 自动生成的 FK 索引名 = 约束名，后续 `DROP INDEX` 需知道这个名字；H2 无此行为 | 全库 | 部署/运维文档记录；若要稳定索引名，可显式建索引（注意 §5.8 的自动删除行为） |
| **P8** | 迁移目录在验证期间被并行会话持续新增（V8 就是中途出现的），本报告结论绑定 §2 的 SHA256 | `db/migration/` | 迁移定稿后按 §3.6 清库重跑一次；Hash 不匹配即需重验 |

---

## 附录：本次产出的文件

| 文件 | 说明 |
| --- | --- |
| `mysql-migration-verification.md` | 本报告 |
| `probe-mysql.sql` | 约束/行为探针（P/S/Q 编号，逐条独立执行） |
| `run-probes.ps1` | 探针逐条执行器（每条单独一次 `mysql.exe`，独立捕获报错） |
| `FlywayRunner.java` | 最小 Flyway 执行器（`Flyway.configure()` 指向单个库，`cleanDisabled(true)`） |
| `show-create-table-typeme_test.sql` | 15 张表的完整 `SHOW CREATE TABLE` 原文（修复后） |
| `probe-output-mysql.txt` | 修复后 MySQL 探针原始输出 |
| `probe-output-mysql-BEFORE-fix.txt` | 修复前 MySQL 探针原始输出（缺陷证据所在） |
| `probe-output-h2.txt` | H2 2.2.224 同一批探针的原始输出（对照用） |
